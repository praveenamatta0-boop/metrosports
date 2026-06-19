// ─────────────────────────────────────────────────────────────────────────────
//  Metro Sports Lounge — Aria Call Assistant (TWILIO VERSION)
//  DTMF-only IVR (name=speech only), next-hour slot filtering, MongoDB storage,
//  multilingual (EN/HI/TE) — fully dynamic via TwiML, works out of the box.
// ─────────────────────────────────────────────────────────────────────────────

const express  = require("express");
const twilio   = require("twilio");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const cors     = require("cors");
const path     = require("path");
const mongoose = require("mongoose");
const { VoiceResponse } = twilio.twiml;

// Twilio REST client for sending SMS (uses Account SID + Auth Token from env)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || "";
const twilioClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

// Language selection prompt (separate from the intro/SMS-choice welcome message)
const L_LANG_PROMPT = "Press 1 for English. Press 2 for Hindi. Press 3 for Telugu.";

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || "";
const JWT_SECRET   = process.env.JWT_SECRET   || "msl-change-me";
const ADMIN_USER   = process.env.ADMIN_USER   || "admin";
const ADMIN_PASS   = process.env.ADMIN_PASS   || "msl@1234";
const ADMIN_HASH   = bcrypt.hashSync(ADMIN_PASS, 10);

// ── MongoDB Schemas ───────────────────────────────────────────────────────────
const bookingSchema = new mongoose.Schema({
  id:        { type: String, unique: true },
  gameId:    String,
  gameName:  String,
  gameRate:  Number,
  dateKey:   String,
  date:      String,
  timeSlot:  String,
  group:     String,
  name:      String,
  phone:     String,
  pay:       String,
  lang:      String,
  status:    { type: String, default: "confirmed" },
  createdAt: { type: Date, default: Date.now },
});
const Booking = mongoose.model("Booking", bookingSchema);

const settingsSchema = new mongoose.Schema({
  arenaName:    { type: String, default: "Metro Sports Lounge" },
  openHour:     { type: Number, default: 8 },
  closeHour:    { type: Number, default: 23 },
  games: [{
    id:      String,
    name:    String,
    rate:    Number,
    courts:  Number,
    active:  { type: Boolean, default: true },
  }],
  blockedDates: [String],
  blockedSlots: [{ gameId: String, dateKey: String, timeSlot: String }],
});
const Settings = mongoose.model("Settings", settingsSchema);

const DEFAULT_SETTINGS = {
  arenaName: "Metro Sports Lounge",
  openHour:  8,
  closeHour: 23,
  games: [
    { id:"pool",         name:"Pool Table",       rate:300, courts:4, active:true },
    { id:"cricket",      name:"Cricket Pitch",    rate:800, courts:2, active:true },
    { id:"volleyball",   name:"Beach Volleyball", rate:500, courts:2, active:true },
    { id:"table_tennis", name:"Table Tennis",     rate:250, courts:3, active:true },
    { id:"badminton",    name:"Badminton",        rate:400, courts:2, active:true },
  ],
  blockedDates: [],
  blockedSlots: [],
};

let SETTINGS = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  let s = await Settings.findOne();
  if (!s) { s = await Settings.create(DEFAULT_SETTINGS); console.log("Created default settings"); }
  SETTINGS = s.toObject();
  console.log("Settings loaded:", SETTINGS.arenaName);
}
async function saveSettings() {
  await Settings.findOneAndUpdate({}, SETTINGS, { upsert:true, new:true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function activeGames() { return SETTINGS.games.filter(g => g.active); }

function allTimeSlots() {
  const slots = [];
  for (let h = SETTINGS.openHour; h < SETTINGS.closeHour; h++) {
    slots.push(h < 12 ? h + " AM" : h === 12 ? "12 PM" : (h - 12) + " PM");
  }
  return slots;
}

function getDates() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      key:   d.toISOString().split("T")[0],
      label: d.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long" }),
    };
  });
}

function slotToHour(slot) {
  const m = slot.match(/(\d+)\s*(AM|PM)/);
  if (!m) return 0;
  let h = parseInt(m[1]);
  if (m[2] === "PM" && h !== 12) h += 12;
  if (m[2] === "AM" && h === 12) h = 0;
  return h;
}

// Next-hour logic: if booking for today, only show slots strictly after current hour
async function getAvailableSlots(gameId, dateKey) {
  const game = SETTINGS.games.find(g => g.id === gameId);
  if (!game || !game.active) return [];
  if (SETTINGS.blockedDates.includes(dateKey)) return [];

  const todayKey = new Date().toISOString().split("T")[0];
  const nowHour  = new Date().getHours();

  const existing = await Booking.find({ gameId, dateKey, status:"confirmed" }).lean();
  const countMap = {};
  for (const b of existing) countMap[b.timeSlot] = (countMap[b.timeSlot] || 0) + 1;

  return allTimeSlots().filter(slot => {
    const h = slotToHour(slot);
    if (dateKey === todayKey && h <= nowHour) return false;
    if (SETTINGS.blockedSlots.some(b => b.gameId===gameId && b.dateKey===dateKey && b.timeSlot===slot)) return false;
    return (countMap[slot] || 0) < game.courts;
  });
}

async function bookedCount(gameId, dateKey, slot) {
  return await Booking.countDocuments({ gameId, dateKey, timeSlot:slot, status:"confirmed" });
}

function genId() { return "MSL-" + Math.random().toString(36).substr(2,6).toUpperCase(); }

// Extract a clean 10-digit Indian mobile number from Twilio's caller ID format
// Twilio sends From as "+919515221555" or "09515221555" etc.
function extractIndianPhone(callerNumber) {
  if (!callerNumber) return null;
  const digitsOnly = callerNumber.replace(/[^0-9]/g, ""); // strip +, spaces, etc.
  const match = digitsOnly.match(/([6-9]\d{9})$/); // last 10 digits starting 6-9
  return match ? match[1] : null;
}

// ── Group labels ──────────────────────────────────────────────────────────────
const GRP = {
  en:["1-2 people","3-5 people","6-10 people","11-20 people","20+ people"],
  hi:["1-2 log","3-5 log","6-10 log","11-20 log","20+ log"],
  te:["1-2 mandi","3-5 mandi","6-10 mandi","11-20 mandi","20+ mandi"],
};

// ── Multilingual scripts — DTMF only except name ──────────────────────────────
function script(lang) {
  const name = SETTINGS.arenaName;
  const S = {
    en: {
      code:"en-IN", voice:"Polly.Aditi",
      welcome:  "Welcome to " + name + ". You can book online. Press 1, and we will text you the link. Or, continue booking on this call. Press 2.",
      game:     function(g){ return "Select game. "+g.map(function(x,i){return "Press "+(i+1)+" for "+x.name+".";}).join(" "); },
      date:     function(d){ return "Select date. "+d.map(function(x,i){return "Press "+(i+1)+" for "+x.label+".";}).join(" "); },
      time:     function(s){ return "Available slots. "+s.map(function(x,i){return "Press "+(i+1)+" for "+x+".";}).join(" "); },
      noSlots:  "No slots available. Press 1 for another date. Press 2 for another game.",
      group:    "How many people? Press 1 for 1 to 2. Press 2 for 3 to 5. Press 3 for 6 to 10. Press 4 for 11 to 20. Press 5 for more than 20.",
      namePr:   "Please say your name after the beep.",
      phone:    function(n){ return "Thanks "+(n?n.split(" ")[0]+". ":"")+"Press your 10 digit mobile number followed by hash."; },
      pay:      "Payment. Press 1 for Cash. Press 2 for Card. Press 3 for UPI.",
      confirm:  function(s){ return "Confirming: "+s.gameName+", "+s.date+", "+s.timeSlot+", "+s.group+", name "+s.name+", "+s.pay+". Press 1 to confirm. Press 2 to restart."; },
      done:     function(s){ return "Booking confirmed! ID is "+s.id+". "+s.gameName+" on "+s.date+" at "+s.timeSlot+". See you at "+name+"! Goodbye."; },
      restart:  "Starting again. ",
      invalid:  "Invalid. Try again. ",
      noHear:   "Did not catch that. ",
      bye:      "Thank you for calling "+name+". Goodbye.",
      blocked:  "Bookings are not available on that date. Please choose another date.",
    },
    hi: {
      code:"hi-IN", voice:"Polly.Aditi",
      welcome:  null,
      game:     function(g){ return "Game chuniye. "+g.map(function(x,i){return (i+1)+" dabaye "+x.name+".";}).join(" "); },
      date:     function(d){ return "Date chuniye. "+d.map(function(x,i){return (i+1)+" dabaye "+x.label+".";}).join(" "); },
      time:     function(s){ return "Available slots. "+s.map(function(x,i){return (i+1)+" dabaye "+x+".";}).join(" "); },
      noSlots:  "Koi slot nahi hai. 1 dabaye doosri date. 2 dabaye doosra game.",
      group:    "Kitne log? 1 dabaye 1-2. 2 dabaye 3-5. 3 dabaye 6-10. 4 dabaye 11-20. 5 dabaye 20 se zyada.",
      namePr:   "Beep ke baad apna naam boliye.",
      phone:    function(n){ return "Shukriya "+(n?n.split(" ")[0]+". ":"")+"Apna 10 digit number dabaye aur hash press kariye."; },
      pay:      "Payment. 1 dabaye Cash. 2 dabaye Card. 3 dabaye UPI.",
      confirm:  function(s){ return "Confirm karein: "+s.gameName+", "+s.date+", "+s.timeSlot+", "+s.group+", naam "+s.name+", "+s.pay+". 1 dabaye confirm. 2 dabaye restart."; },
      done:     function(s){ return "Booking ho gayi! ID hai "+s.id+". "+s.gameName+", "+s.date+", "+s.timeSlot+". "+name+" mein milenge! Alvida."; },
      restart:  "Phir se shuru. ",
      invalid:  "Galat. Dobara try kariye. ",
      noHear:   "Sunai nahi diya. ",
      bye:      name+" mein call ke liye shukriya. Alvida.",
      blocked:  "Us date pe booking band hai. Doosri date chuniye.",
    },
    te: {
      code:"te-IN", voice:"Polly.Aditi",
      welcome:  null,
      game:     function(g){ return "Game select cheskoundi. "+g.map(function(x,i){return (i+1)+" press chesthe "+x.name+".";}).join(" "); },
      date:     function(d){ return "Date select cheskoundi. "+d.map(function(x,i){return (i+1)+" press chesthe "+x.label+".";}).join(" "); },
      time:     function(s){ return "Available slots. "+s.map(function(x,i){return (i+1)+" press chesthe "+x+".";}).join(" "); },
      noSlots:  "Slots levu. 1 press chesthe vera date. 2 press chesthe vera game.",
      group:    "Entha mandi? 1 press chesthe 1-2. 2 press chesthe 3-5. 3 press chesthe 6-10. 4 press chesthe 11-20. 5 press chesthe 20 kante ekkuva.",
      namePr:   "Beep taruvata mee peru cheppandi.",
      phone:    function(n){ return "Dhanyavaadaalu "+(n?n.split(" ")[0]+". ":"")+"Mee 10 digit number type chesandi, hash press chesandi."; },
      pay:      "Payment. 1 press chesthe Cash. 2 press chesthe Card. 3 press chesthe UPI.",
      confirm:  function(s){ return "Confirm cheskoundi: "+s.gameName+", "+s.date+", "+s.timeSlot+", "+s.group+", peru "+s.name+", "+s.pay+". 1 press chesthe confirm. 2 press chesthe restart."; },
      done:     function(s){ return "Booking confirm! ID "+s.id+". "+s.gameName+", "+s.date+", "+s.timeSlot+". "+name+" lo kaladudam! Goodbye."; },
      restart:  "Malli modalupetudaam. ",
      invalid:  "Tappu. Malli try cheskoundi. ",
      noHear:   "Artham kaaledu. ",
      bye:      name+" ki call chesinduku dhanyavaadaalu. Goodbye.",
      blocked:  "Aa date ki bookings levu. Vera date select cheskoundi.",
    },
  };
  return S[lang] || S.en;
}

// ── Session store ─────────────────────────────────────────────────────────────
const sessions = {};
function sess(sid) {
  if (!sessions[sid]) sessions[sid] = { step:"lang", lang:"en" };
  return sessions[sid];
}

// ── TwiML gathers ──────────────────────────────────────────────────────────────
function dtmfGather(twiml, lang, numDigits) {
  return twiml.gather({ input:"dtmf", action:"/respond", method:"POST", timeout:8, numDigits:numDigits||1, language:script(lang).code });
}
function phoneGather(twiml, lang) {
  return twiml.gather({ input:"dtmf", action:"/respond", method:"POST", timeout:12, finishOnKey:"#", language:script(lang).code });
}
function nameGather(twiml, lang) {
  return twiml.gather({ input:"speech", action:"/respond", method:"POST", speechTimeout:"auto", timeout:8, language:script(lang).code });
}
function sendXml(res, twiml) { res.type("text/xml"); res.send(twiml.toString()); }

// ─────────────────────────────────────────────────────────────────────────────
//  IVR Routes (Twilio)
// ─────────────────────────────────────────────────────────────────────────────

app.post("/incoming", (req, res) => {
  const sid = req.body.CallSid;
  const from = req.body.From || "";
  sessions[sid] = { step:"intro", lang:"en", callerNumber: from };
  const twiml = new VoiceResponse();
  const g = dtmfGather(twiml, "en");
  g.say({ voice:"Polly.Aditi" }, script("en").welcome);
  twiml.redirect("/incoming");
  sendXml(res, twiml);
});

app.post("/respond", async (req, res) => {
  const sid    = req.body.CallSid;
  const digits = (req.body.Digits || "").trim();
  const speech = (req.body.SpeechResult || "").trim();
  const s      = sess(sid);
  const lc     = script(s.lang);
  const v      = lc.voice;
  const twiml  = new VoiceResponse();

  console.log("["+sid+"]["+s.lang+"]["+s.step+"] d="+digits+" sp="+speech);

  function askDtmf(prompt, nd) {
    const g = dtmfGather(twiml, s.lang, nd||1);
    g.say({ voice:v }, prompt);
    sessions[sid] = s;
    sendXml(res, twiml);
  }
  function askPhone(prompt) {
    const g = phoneGather(twiml, s.lang);
    g.say({ voice:v }, prompt);
    sessions[sid] = s;
    sendXml(res, twiml);
  }
  function askName(prompt) {
    const g = nameGather(twiml, s.lang);
    g.say({ voice:v }, prompt);
    sessions[sid] = s;
    sendXml(res, twiml);
  }
  function inv(prompt, nd) {
    const g = dtmfGather(twiml, s.lang, nd||1);
    g.say({ voice:v }, lc.invalid + prompt);
    sessions[sid] = s;
    sendXml(res, twiml);
  }
  function end(msg) {
    twiml.say({ voice:v }, msg);
    twiml.hangup();
    delete sessions[sid];
    sendXml(res, twiml);
  }

  if (s.step === "intro") {
    if (digits === "1") {
      // Send SMS with booking link
      const toNumber = s.callerNumber;
      const websiteUrl = process.env.WEBSITE_URL || "https://" + req.get("host");
      const smsBody =
        SETTINGS.arenaName + " - Book your slot: " + websiteUrl;
      try {
        if (toNumber && twilioClient && process.env.TWILIO_PHONE_NUMBER) {
          await twilioClient.messages.create({
            body: smsBody,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: toNumber,
          });
          console.log("[SMS] Sent booking link to " + toNumber);
        } else {
          console.log("[SMS] Skipped — missing TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER env vars or caller number");
        }
      } catch (e) {
        console.error("[SMS] Failed to send:", e.message);
      }
      return end("We have sent you the booking link by SMS. Thank you for calling " + SETTINGS.arenaName + ". Goodbye.");
    }
    if (digits === "2") {
      s.step = "lang";
      return askDtmf(L_LANG_PROMPT);
    }
    return inv(script("en").welcome);
  }

  if (s.step === "lang") {
    if (!["1","2","3"].includes(digits)) return inv(L_LANG_PROMPT);
    s.lang = digits==="1"?"en":digits==="2"?"hi":"te";
    s.step = "game";
    return askDtmf(script(s.lang).game(activeGames()));
  }

  if (s.step === "game") {
    const games = activeGames();
    const idx   = parseInt(digits)-1;
    if (isNaN(idx)||idx<0||idx>=games.length) return inv(lc.game(games));
    s.gameId = games[idx].id; s.gameName = games[idx].name; s.gameRate = games[idx].rate;
    s.step = "date";
    return askDtmf(lc.date(getDates()));
  }

  if (s.step === "date") {
    const dates = getDates();
    const idx   = parseInt(digits)-1;
    if (isNaN(idx)||idx<0||idx>=dates.length) return inv(lc.date(dates));
    if (SETTINGS.blockedDates.includes(dates[idx].key)) {
      return askDtmf(lc.blocked + " " + lc.date(dates));
    }
    s.dateKey = dates[idx].key; s.date = dates[idx].label;
    const slots = await getAvailableSlots(s.gameId, s.dateKey);
    if (!slots.length) { s.step="noSlots"; return askDtmf(lc.noSlots); }
    s.slots = slots; s.step = "time";
    return askDtmf(lc.time(slots), 2);
  }

  if (s.step === "noSlots") {
    if (digits==="1") { s.step="date"; return askDtmf(lc.date(getDates())); }
    if (digits==="2") { s.step="game"; return askDtmf(lc.game(activeGames())); }
    return inv(lc.noSlots);
  }

  if (s.step === "time") {
    const slots = s.slots||[];
    const idx   = parseInt(digits)-1;
    if (isNaN(idx)||idx<0||idx>=slots.length) return inv(lc.time(slots), 2);
    s.timeSlot = slots[idx]; s.step = "group";
    return askDtmf(lc.group);
  }

  if (s.step === "group") {
    const idx = parseInt(digits)-1;
    if (isNaN(idx)||idx<0||idx>4) return inv(lc.group);
    s.group = GRP[s.lang][idx]; s.step = "name";
    return askName(lc.namePr);
  }

  if (s.step === "name") {
    const name = speech.trim().replace(/^(my name is|i am|i'm|mera naam|naa peru)\s+/i,"").trim();
    if (!name||name.length<2) return askName(lc.noHear+lc.namePr);
    s.name = name;

    // Auto-capture phone number from caller ID instead of asking
    const callerPhone = extractIndianPhone(s.callerNumber);
    if (callerPhone) {
      s.phone = callerPhone;
      s.step  = "pay";
      return askDtmf(lc.pay);
    }

    // Fallback: if caller ID is unavailable/blocked, ask manually
    s.step = "phone";
    return askPhone(lc.phone(s.name));
  }

  if (s.step === "phone") {
    const raw = digits.replace(/[\s\-]/g,"");
    const ph  = raw.match(/([6-9]\d{9})/);
    if (!ph) return askPhone(lc.noHear+lc.phone(s.name));
    s.phone = ph[1]; s.step = "pay";
    return askDtmf(lc.pay);
  }

  if (s.step === "pay") {
    const map = {"1":"Cash","2":"Card","3":"UPI"};
    if (!map[digits]) return inv(lc.pay);
    s.pay = map[digits]; s.step = "confirm";
    return askDtmf(lc.confirm(s));
  }

  if (s.step === "confirm") {
    if (digits==="1") {
      try {
        const b = new Booking({
          id:genId(), gameId:s.gameId, gameName:s.gameName, gameRate:s.gameRate||0,
          dateKey:s.dateKey, date:s.date, timeSlot:s.timeSlot,
          group:s.group, name:s.name, phone:s.phone, pay:s.pay,
          lang:s.lang, status:"confirmed",
        });
        await b.save();
        s.id = b.id;
        return end(lc.done(s));
      } catch(e) {
        console.error("Booking save error:", e.message);
        return end("Sorry, something went wrong saving your booking. Please call again.");
      }
    }
    if (digits==="2") {
      sessions[sid] = { step:"game", lang:s.lang };
      const t2 = new VoiceResponse();
      const g2 = dtmfGather(t2, s.lang);
      g2.say({ voice:v }, script(s.lang).restart + script(s.lang).game(activeGames()));
      return sendXml(res, t2);
    }
    return inv(lc.confirm(s));
  }

  end(lc.bye);
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function auth(req,res,next) {
  const h = req.headers.authorization;
  if (!h||!h.startsWith("Bearer ")) return res.status(401).json({error:"Unauthorized"});
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({error:"Token invalid"}); }
}

// ── Admin API ─────────────────────────────────────────────────────────────────
app.post("/api/login", (req,res) => {
  const {username,password} = req.body;
  if (username!==ADMIN_USER||!bcrypt.compareSync(password,ADMIN_HASH))
    return res.status(401).json({error:"Wrong credentials"});
  res.json({ token:jwt.sign({username},JWT_SECRET,{expiresIn:"12h"}) });
});

app.get("/api/bookings", auth, async (req,res) => {
  const list = await Booking.find().sort({ createdAt:-1 });
  res.json(list);
});

app.patch("/api/bookings/:id/cancel", auth, async (req,res) => {
  const b = await Booking.findOneAndUpdate({ id:req.params.id }, { status:"cancelled" }, { new:true });
  if (!b) return res.status(404).json({error:"Not found"});
  res.json(b);
});

app.get("/api/stats", auth, async (req,res) => {
  const today = new Date().toISOString().split("T")[0];
  const [total, confirmed, cancelled, todayCount] = await Promise.all([
    Booking.countDocuments(),
    Booking.countDocuments({ status:"confirmed" }),
    Booking.countDocuments({ status:"cancelled" }),
    Booking.countDocuments({ dateKey:today, status:"confirmed" }),
  ]);
  const revResult = await Booking.aggregate([
    { $match:{ status:"confirmed" } },
    { $group:{ _id:null, total:{ $sum:"$gameRate" } } }
  ]);
  res.json({ total, confirmed, cancelled, today:todayCount, revenue: revResult[0]?.total || 0 });
});

// Fast availability — single bulk query
app.get("/api/availability", auth, async (req,res) => {
  const dates    = getDates();
  const slots    = allTimeSlots();
  const dateKeys = dates.map(d => d.key);

  const allBookings = await Booking.find({ dateKey:{ $in: dateKeys }, status:"confirmed" }).lean();
  const countMap = {};
  for (const b of allBookings) {
    const key = b.gameId + "|" + b.dateKey + "|" + b.timeSlot;
    countMap[key] = (countMap[key] || 0) + 1;
  }

  const grid = [];
  for (const game of SETTINGS.games) {
    for (const date of dates) {
      for (const slot of slots) {
        const key     = game.id + "|" + date.key + "|" + slot;
        const booked  = countMap[key] || 0;
        const blocked = SETTINGS.blockedSlots.some(b => b.gameId===game.id && b.dateKey===date.key && b.timeSlot===slot)
                     || SETTINGS.blockedDates.includes(date.key);
        grid.push({ gameId:game.id, gameName:game.name, gameMax:game.courts,
          dateKey:date.key, dateLabel:date.label, timeSlot:slot,
          booked, available:game.courts - booked, blocked, active:game.active });
      }
    }
  }
  res.json({ games:SETTINGS.games, dates, timeSlots:slots, grid });
});

app.get("/api/settings", auth, (req,res) => res.json(SETTINGS));

app.put("/api/settings", auth, async (req,res) => {
  const s = req.body;
  if (s.arenaName)              SETTINGS.arenaName  = s.arenaName;
  if (s.openHour  !== undefined) SETTINGS.openHour  = parseInt(s.openHour);
  if (s.closeHour !== undefined) SETTINGS.closeHour = parseInt(s.closeHour);
  await saveSettings();
  res.json(SETTINGS);
});

app.post("/api/settings/games", auth, async (req,res) => {
  const { id, name, rate, courts, active } = req.body;
  if (!id||!name) return res.status(400).json({error:"id and name required"});
  const ex = SETTINGS.games.find(g=>g.id===id);
  if (ex) {
    if (name    !== undefined) ex.name    = name;
    if (rate    !== undefined) ex.rate    = parseInt(rate);
    if (courts  !== undefined) ex.courts  = parseInt(courts);
    if (active  !== undefined) ex.active  = Boolean(active);
  } else {
    SETTINGS.games.push({ id, name, rate:parseInt(rate)||0, courts:parseInt(courts)||1, active:active!==false });
  }
  await saveSettings();
  res.json(SETTINGS.games);
});

app.delete("/api/settings/games/:id", auth, async (req,res) => {
  SETTINGS.games = SETTINGS.games.filter(g=>g.id!==req.params.id);
  await saveSettings();
  res.json(SETTINGS.games);
});

app.post("/api/settings/block-date", auth, async (req,res) => {
  const { dateKey } = req.body;
  if (!dateKey) return res.status(400).json({error:"dateKey required"});
  if (!SETTINGS.blockedDates.includes(dateKey)) SETTINGS.blockedDates.push(dateKey);
  await saveSettings();
  res.json(SETTINGS.blockedDates);
});

app.delete("/api/settings/block-date/:dateKey", auth, async (req,res) => {
  SETTINGS.blockedDates = SETTINGS.blockedDates.filter(d=>d!==req.params.dateKey);
  await saveSettings();
  res.json(SETTINGS.blockedDates);
});

app.post("/api/settings/block-slot", auth, async (req,res) => {
  const { gameId, dateKey, timeSlot } = req.body;
  if (!gameId||!dateKey||!timeSlot) return res.status(400).json({error:"gameId, dateKey, timeSlot required"});
  if (!SETTINGS.blockedSlots.some(b=>b.gameId===gameId&&b.dateKey===dateKey&&b.timeSlot===timeSlot))
    SETTINGS.blockedSlots.push({ gameId, dateKey, timeSlot });
  await saveSettings();
  res.json(SETTINGS.blockedSlots);
});

app.delete("/api/settings/block-slot", auth, async (req,res) => {
  const { gameId, dateKey, timeSlot } = req.body;
  SETTINGS.blockedSlots = SETTINGS.blockedSlots.filter(b=>
    !(b.gameId===gameId&&b.dateKey===dateKey&&b.timeSlot===timeSlot));
  await saveSettings();
  res.json(SETTINGS.blockedSlots);
});

// ── Public API (landing page) ─────────────────────────────────────────────────
app.get("/api/public/data", async (req,res) => {
  const dates    = getDates();
  const slots    = allTimeSlots();
  const dateKeys = dates.map(d => d.key);

  const allBookings = await Booking.find({ dateKey:{ $in: dateKeys }, status:"confirmed" }).lean();
  const countMap = {};
  for (const b of allBookings) {
    const key = b.gameId + "|" + b.dateKey + "|" + b.timeSlot;
    countMap[key] = (countMap[key] || 0) + 1;
  }

  const grid = [];
  for (const game of SETTINGS.games) {
    for (const date of dates) {
      for (const slot of slots) {
        const key     = game.id + "|" + date.key + "|" + slot;
        const booked  = countMap[key] || 0;
        const blocked = SETTINGS.blockedSlots.some(b => b.gameId===game.id && b.dateKey===date.key && b.timeSlot===slot)
                     || SETTINGS.blockedDates.includes(date.key);
        grid.push({ gameId:game.id, dateKey:date.key, timeSlot:slot,
          available:game.courts - booked, blocked, active:game.active });
      }
    }
  }
  res.json({
    settings: { arenaName:SETTINGS.arenaName, openHour:SETTINGS.openHour, closeHour:SETTINGS.closeHour, games:SETTINGS.games, blockedDates:SETTINGS.blockedDates },
    availability: { grid, dates, timeSlots:slots },
  });
});

app.post("/api/public/booking", async (req,res) => {
  const { name, phone, gameId, gameName, group, dateKey, date, timeSlot, pay } = req.body;
  if (!name||!phone||!gameId||!group||!dateKey||!timeSlot||!pay)
    return res.status(400).json({error:"All fields are required."});
  if (!/^[6-9]\d{9}$/.test(phone))
    return res.status(400).json({error:"Invalid phone number."});
  const game = SETTINGS.games.find(g=>g.id===gameId);
  if (!game||!game.active) return res.status(400).json({error:"Game not available."});
  if (SETTINGS.blockedDates.includes(dateKey)) return res.status(400).json({error:"Bookings closed on this date."});
  if (SETTINGS.blockedSlots.some(b=>b.gameId===gameId&&b.dateKey===dateKey&&b.timeSlot===timeSlot))
    return res.status(400).json({error:"This slot is closed."});
  const avail = await getAvailableSlots(gameId, dateKey);
  if (!avail.includes(timeSlot)) return res.status(400).json({error:"Slot no longer available."});
  const b = new Booking({
    id:genId(), gameId, gameName:gameName||game.name, gameRate:game.rate,
    dateKey, date, timeSlot, group, name, phone, pay, lang:"web", status:"confirmed",
  });
  await b.save();
  res.json(b);
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get("/dashboard", (req,res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/",          (req,res) => res.sendFile(path.join(__dirname, "landing.html")));

// ── Connect DB & Start ────────────────────────────────────────────────────────
async function start() {
  if (!MONGODB_URI) {
    console.error("ERROR: MONGODB_URI environment variable is not set!");
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected");
  await loadSettings();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(SETTINGS.arenaName + " (TWILIO) running on port " + PORT));
}

start().catch(console.error);
