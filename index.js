// ─────────────────────────────────────────────────────────────────────────────
//  Metro Sports Lounge — Aria Call Assistant v10
//  Exotel IVR + MongoDB + Dashboard + Landing Page
// ─────────────────────────────────────────────────────────────────────────────

const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const cors     = require("cors");
const path     = require("path");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || "";
const JWT_SECRET  = process.env.JWT_SECRET  || "msl-change-me";
const ADMIN_USER  = process.env.ADMIN_USER  || "admin";
const ADMIN_PASS  = process.env.ADMIN_PASS  || "msl@1234";
const ADMIN_HASH  = bcrypt.hashSync(ADMIN_PASS, 10);

// ── MongoDB Schemas ───────────────────────────────────────────────────────────

// Booking
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

// Settings (single document)
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
  blockedSlots: [{
    gameId:   String,
    dateKey:  String,
    timeSlot: String,
  }],
});
const Settings = mongoose.model("Settings", settingsSchema);

// Default settings
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

// Load or create settings on startup
let SETTINGS = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  let s = await Settings.findOne();
  if (!s) {
    s = await Settings.create(DEFAULT_SETTINGS);
    console.log("Created default settings in DB");
  }
  SETTINGS = s.toObject();
  console.log("Settings loaded:", SETTINGS.arenaName);
}

async function saveSettings() {
  await Settings.findOneAndUpdate({}, SETTINGS, { upsert: true, new: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function activeGames() {
  return SETTINGS.games.filter(g => g.active);
}

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

async function getAvailableSlots(gameId, dateKey) {
  const game = SETTINGS.games.find(g => g.id === gameId);
  if (!game || !game.active) return [];
  if (SETTINGS.blockedDates.includes(dateKey)) return [];

  const todayKey = new Date().toISOString().split("T")[0];
  const nowHour  = new Date().getHours();

  // ONE query for this game+date
  const existing = await Booking.find({ gameId, dateKey, status:"confirmed" }).lean();
  const countMap = {};
  for (const b of existing) {
    countMap[b.timeSlot] = (countMap[b.timeSlot] || 0) + 1;
  }

  return allTimeSlots().filter(slot => {
    const h = slotToHour(slot);
    if (dateKey === todayKey && h <= nowHour) return false;
    if (SETTINGS.blockedSlots.some(b => b.gameId===gameId && b.dateKey===dateKey && b.timeSlot===slot)) return false;
    return (countMap[slot] || 0) < game.courts;
  });
}

async function bookedCount(gameId, dateKey, slot) {
  return await Booking.countDocuments({ gameId, dateKey, timeSlot: slot, status:"confirmed" });
}

function genId() {
  return "MSL-" + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ── Group labels ──────────────────────────────────────────────────────────────
const GRP = {
  en:["1-2 people","3-5 people","6-10 people","11-20 people","20+ people"],
  hi:["1-2 log","3-5 log","6-10 log","11-20 log","20+ log"],
  te:["1-2 mandi","3-5 mandi","6-10 mandi","11-20 mandi","20+ mandi"],
};

// ── Multilingual scripts ──────────────────────────────────────────────────────
function script(lang) {
  const name = SETTINGS.arenaName;
  const S = {
    en: {
      code:"en-IN",
      welcome:  "Welcome to " + name + ". Press 1 for English. Press 2 for Hindi. Press 3 for Telugu.",
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
      blocked:  "No bookings on that date. Please choose another.",
    },
    hi: {
      code:"hi-IN",
      welcome:  null,
      game:     function(g){ return "Game chuniye. "+g.map(function(x,i){return (i+1)+" dabaye "+x.name+".";}).join(" "); },
      date:     function(d){ return "Date chuniye. "+d.map(function(x,i){return (i+1)+" dabaye "+x.label+".";}).join(" "); },
      time:     function(s){ return "Available slots. "+s.map(function(x,i){return (i+1)+" dabaye "+x+".";}).join(" "); },
      noSlots:  "Koi slot nahi. 1 dabaye doosri date. 2 dabaye doosra game.",
      group:    "Kitne log? 1 dabaye 1-2. 2 dabaye 3-5. 3 dabaye 6-10. 4 dabaye 11-20. 5 dabaye 20+.",
      namePr:   "Beep ke baad naam boliye.",
      phone:    function(n){ return "Shukriya "+(n?n.split(" ")[0]+". ":"")+"10 digit number dabaye, hash press kariye."; },
      pay:      "Payment. 1 Cash. 2 Card. 3 UPI.",
      confirm:  function(s){ return "Confirm: "+s.gameName+", "+s.date+", "+s.timeSlot+", "+s.group+", naam "+s.name+", "+s.pay+". 1 confirm. 2 restart."; },
      done:     function(s){ return "Booking ho gayi! ID "+s.id+". "+s.gameName+", "+s.date+", "+s.timeSlot+". "+name+" mein milenge! Alvida."; },
      restart:  "Phir se. ",
      invalid:  "Galat. Dobara. ",
      noHear:   "Sunai nahi diya. ",
      bye:      name+" mein call ke liye shukriya. Alvida.",
      blocked:  "Us date pe booking band. Doosri date chuniye.",
    },
    te: {
      code:"te-IN",
      welcome:  null,
      game:     function(g){ return "Game select cheskoundi. "+g.map(function(x,i){return (i+1)+" press chesthe "+x.name+".";}).join(" "); },
      date:     function(d){ return "Date select cheskoundi. "+d.map(function(x,i){return (i+1)+" press chesthe "+x.label+".";}).join(" "); },
      time:     function(s){ return "Available slots. "+s.map(function(x,i){return (i+1)+" press chesthe "+x+".";}).join(" "); },
      noSlots:  "Slots levu. 1 press chesthe vera date. 2 press chesthe vera game.",
      group:    "Entha mandi? 1 press chesthe 1-2. 2 press chesthe 3-5. 3 press chesthe 6-10. 4 press chesthe 11-20. 5 press chesthe 20+.",
      namePr:   "Beep taruvata peru cheppandi.",
      phone:    function(n){ return "Dhanyavaadaalu "+(n?n.split(" ")[0]+". ":"")+"10 digit number type chesandi, hash press chesandi."; },
      pay:      "Payment. 1 Cash. 2 Card. 3 UPI.",
      confirm:  function(s){ return "Confirm: "+s.gameName+", "+s.date+", "+s.timeSlot+", "+s.group+", peru "+s.name+", "+s.pay+". 1 confirm. 2 restart."; },
      done:     function(s){ return "Booking confirm! ID "+s.id+". "+s.gameName+", "+s.date+", "+s.timeSlot+". "+name+" lo kaladudam! Goodbye."; },
      restart:  "Malli. ",
      invalid:  "Tappu. Malli. ",
      noHear:   "Artham kaaledu. ",
      bye:      name+" ki call chesinduku dhanyavaadaalu. Goodbye.",
      blocked:  "Aa date ki bookings levu. Vera date.",
    },
  };
  return S[lang] || S.en;
}

// ── Session store (in-memory is fine — sessions are short-lived) ──────────────
const sessions = {};
function sess(sid) {
  if (!sessions[sid]) sessions[sid] = { step:"lang", lang:"en" };
  return sessions[sid];
}

// ── Exotel response helper ────────────────────────────────────────────────────
// Exotel uses a simple XML format called ExoML (similar to TwiML)
// Docs: https://developer.exotel.com/exoml/

function exoSay(text) {
  // Exotel Play for TTS
  return "<Play>" + xmlEsc(text) + "</Play>";
}

function exoGather(text, lang, numDigits, finishOnKey) {
  // Exotel uses <GetDigits> for DTMF collection
  numDigits  = numDigits  || 1;
  finishOnKey= finishOnKey|| "#";
  return (
    "<GetDigits timeout=\"15\" numDigits=\"" + numDigits + "\" finishOnKey=\"" + finishOnKey + "\" action=\"/exotel/respond\" method=\"POST\">" +
    "<Play>" + xmlEsc(text) + "</Play>" +
    "</GetDigits>" +
    // Fallback if no input — redirect back
    "<Redirect>/exotel/noinput</Redirect>"
  );
}

function exoSpeechGather(text) {
  // Exotel speech recognition via <Record> then transcribe — simpler approach:
  // Use Record for name, then redirect with recording URL
  return (
    "<Record action=\"/exotel/name\" method=\"POST\" maxLength=\"5\" finishOnKey=\"#\" playBeep=\"true\" transcribe=\"true\" transcribeCallback=\"/exotel/transcribe\">" +
    "<Play>" + xmlEsc(text) + "</Play>" +
    "</Record>"
  );
}

function exoHangup(text) {
  return "<Response>" + exoSay(text) + "<Hangup/></Response>";
}

function xmlEsc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sendExoml(res, body) {
  res.type("text/xml");
  res.send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response>" + body + "</Response>");
}

// ── Exotel IVR Routes ─────────────────────────────────────────────────────────

// Incoming call
app.post("/exotel/incoming", (req, res) => {
  const sid = req.body.CallSid || req.body.CallUUID || req.body.CallGuid || "unknown";
  sessions[sid] = { step:"lang", lang:"en" };
  sendExoml(res, exoGather(script("en").welcome, "en", 1));
});

// Also accept GET (Exotel sometimes sends GET for incoming)
app.get("/exotel/incoming", (req, res) => {
  const sid = req.query.CallSid || req.query.CallUUID || "unknown";
  sessions[sid] = { step:"lang", lang:"en" };
  sendExoml(res, exoGather(script("en").welcome, "en", 1));
});

// No input fallback
app.all("/exotel/noinput", (req, res) => {
  const sid = req.body?.CallSid || req.query?.CallSid || "unknown";
  const s   = sess(sid);
  const lc  = script(s.lang);
  sendExoml(res, exoGather(lc.invalid + script("en").welcome, s.lang, 1));
});

// Main response handler
app.all("/exotel/respond", async (req, res) => {
  const body   = req.method === "POST" ? req.body : req.query;
  const sid    = body.CallSid || body.CallUUID || body.CallGuid || "unknown";
  const digits = (body.digits || body.Digits || "").trim();
  const s      = sess(sid);
  const lc     = script(s.lang);

  console.log("[MSL]["+sid+"]["+s.lang+"]["+s.step+"] digits="+digits);

  function ask(prompt, numDigits) {
    sessions[sid] = s;
    sendExoml(res, exoGather(prompt, s.lang, numDigits || 1));
  }
  function askPhone(prompt) {
    sessions[sid] = s;
    sendExoml(res, exoGather(prompt, s.lang, 10, "#"));
  }
  function askName(prompt) {
    sessions[sid] = s;
    sendExoml(res, exoSpeechGather(prompt));
  }
  function inv(prompt, numDigits) {
    sessions[sid] = s;
    sendExoml(res, exoGather(lc.invalid + prompt, s.lang, numDigits || 1));
  }
  function end(msg) {
    delete sessions[sid];
    sendExoml(res, exoSay(msg) + "<Hangup/>");
  }

  // ── LANG ──
  if (s.step === "lang") {
    if (!["1","2","3"].includes(digits)) return inv(script("en").welcome);
    s.lang = digits==="1"?"en":digits==="2"?"hi":"te";
    s.step = "game";
    return ask(script(s.lang).game(activeGames()));
  }

  // ── GAME ──
  if (s.step === "game") {
    const games = activeGames();
    const idx   = parseInt(digits) - 1;
    if (isNaN(idx)||idx<0||idx>=games.length) return inv(lc.game(games));
    s.gameId = games[idx].id; s.gameName = games[idx].name;
    s.step = "date";
    return ask(lc.date(getDates()));
  }

  // ── DATE ──
  if (s.step === "date") {
    const dates = getDates();
    const idx   = parseInt(digits) - 1;
    if (isNaN(idx)||idx<0||idx>=dates.length) return inv(lc.date(dates));
    if (SETTINGS.blockedDates.includes(dates[idx].key)) {
      return ask(lc.blocked + " " + lc.date(dates));
    }
    s.dateKey = dates[idx].key; s.date = dates[idx].label;
    const slots = await getAvailableSlots(s.gameId, s.dateKey);
    if (!slots.length) { s.step="noSlots"; return ask(lc.noSlots); }
    s.slots = slots; s.step = "time";
    return ask(lc.time(slots));
  }

  // ── NO SLOTS ──
  if (s.step === "noSlots") {
    if (digits==="1") { s.step="date"; return ask(lc.date(getDates())); }
    if (digits==="2") { s.step="game"; return ask(lc.game(activeGames())); }
    return inv(lc.noSlots);
  }

  // ── TIME ──
  if (s.step === "time") {
    const slots = s.slots || [];
    const idx   = parseInt(digits) - 1;
    if (isNaN(idx)||idx<0||idx>=slots.length) return inv(lc.time(slots));
    s.timeSlot = slots[idx]; s.step = "group";
    return ask(lc.group);
  }

  // ── GROUP ──
  if (s.step === "group") {
    const idx = parseInt(digits) - 1;
    if (isNaN(idx)||idx<0||idx>4) return inv(lc.group);
    s.group = GRP[s.lang][idx]; s.step = "name";
    return askName(lc.namePr);
  }

  // ── PHONE ──
  if (s.step === "phone") {
    const raw = digits.replace(/[\s\-]/g,"");
    const ph  = raw.match(/([6-9]\d{9})/);
    if (!ph) return askPhone(lc.noHear + lc.phone(s.name));
    s.phone = ph[1]; s.step = "pay";
    return ask(lc.pay);
  }

  // ── PAYMENT ──
  if (s.step === "pay") {
    const map = {"1":"Cash","2":"Card","3":"UPI"};
    if (!map[digits]) return inv(lc.pay);
    s.pay = map[digits]; s.step = "confirm";
    return ask(lc.confirm(s));
  }

  // ── CONFIRM ──
  if (s.step === "confirm") {
    if (digits === "1") {
      const game = SETTINGS.games.find(g => g.id === s.gameId);
      const b = new Booking({
        id:       genId(),
        gameId:   s.gameId,
        gameName: s.gameName,
        gameRate: game?.rate || 0,
        dateKey:  s.dateKey,
        date:     s.date,
        timeSlot: s.timeSlot,
        group:    s.group,
        name:     s.name,
        phone:    s.phone,
        pay:      s.pay,
        lang:     s.lang,
        status:   "confirmed",
      });
      await b.save();
      s.id = b.id;
      return end(lc.done(s));
    }
    if (digits === "2") {
      sessions[sid] = { step:"game", lang:s.lang };
      return sendExoml(res, exoGather(script(s.lang).restart + script(s.lang).game(activeGames()), s.lang, 1));
    }
    return inv(lc.confirm(s));
  }

  end(lc.bye);
});

// Name from speech transcription callback
app.post("/exotel/transcribe", async (req, res) => {
  const sid        = req.body.CallSid || req.body.CallUUID || "unknown";
  const transcript = (req.body.TranscriptionText || "").trim();
  const s          = sess(sid);
  const lc         = script(s.lang);

  if (transcript && transcript.length > 1) {
    s.name = transcript.replace(/^(my name is|i am|i'm|mera naam|naa peru)\s+/i,"").trim();
    s.step = "phone";
    sessions[sid] = s;
    sendExoml(res, exoGather(lc.phone(s.name), s.lang, 10, "#"));
  } else {
    sendExoml(res, exoSpeechGather(lc.noHear + lc.namePr));
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return res.status(401).json({ error:"Unauthorized" });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error:"Token invalid" }); }
}

// ── Admin API ─────────────────────────────────────────────────────────────────

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER || !bcrypt.compareSync(password, ADMIN_HASH))
    return res.status(401).json({ error:"Wrong credentials" });
  res.json({ token: jwt.sign({ username }, JWT_SECRET, { expiresIn:"12h" }) });
});

app.get("/api/bookings", auth, async (req, res) => {
  const list = await Booking.find().sort({ createdAt:-1 });
  res.json(list);
});

app.patch("/api/bookings/:id/cancel", auth, async (req, res) => {
  const b = await Booking.findOneAndUpdate({ id:req.params.id }, { status:"cancelled" }, { new:true });
  if (!b) return res.status(404).json({ error:"Not found" });
  res.json(b);
});

app.get("/api/stats", auth, async (req, res) => {
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

app.get("/api/availability", auth, async (req, res) => {
  const dates    = getDates();
  const slots    = allTimeSlots();
  const dateKeys = dates.map(d => d.key);

  // ONE query — fetch all confirmed bookings for next 7 days
  const allBookings = await Booking.find({
    dateKey: { $in: dateKeys },
    status:  "confirmed",
  }).lean();

  // Build a lookup map: "gameId|dateKey|timeSlot" -> count
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
        const blocked = SETTINGS.blockedSlots.some(b =>
                          b.gameId===game.id && b.dateKey===date.key && b.timeSlot===slot)
                     || SETTINGS.blockedDates.includes(date.key);
        grid.push({
          gameId: game.id, gameName: game.name, gameMax: game.courts,
          dateKey: date.key, dateLabel: date.label, timeSlot: slot,
          booked, available: game.courts - booked, blocked, active: game.active,
        });
      }
    }
  }
  res.json({ games: SETTINGS.games, dates, timeSlots: slots, grid });
});

app.get("/api/settings", auth, (req, res) => res.json(SETTINGS));

app.put("/api/settings", auth, async (req, res) => {
  const s = req.body;
  if (s.arenaName)              SETTINGS.arenaName  = s.arenaName;
  if (s.openHour  !== undefined) SETTINGS.openHour  = parseInt(s.openHour);
  if (s.closeHour !== undefined) SETTINGS.closeHour = parseInt(s.closeHour);
  await saveSettings();
  res.json(SETTINGS);
});

app.post("/api/settings/games", auth, async (req, res) => {
  const { id, name, rate, courts, active } = req.body;
  if (!id || !name) return res.status(400).json({ error:"id and name required" });
  const ex = SETTINGS.games.find(g => g.id === id);
  if (ex) {
    if (name   !== undefined) ex.name   = name;
    if (rate   !== undefined) ex.rate   = parseInt(rate);
    if (courts !== undefined) ex.courts = parseInt(courts);
    if (active !== undefined) ex.active = Boolean(active);
  } else {
    SETTINGS.games.push({ id, name, rate:parseInt(rate)||0, courts:parseInt(courts)||1, active:active!==false });
  }
  await saveSettings();
  res.json(SETTINGS.games);
});

app.delete("/api/settings/games/:id", auth, async (req, res) => {
  SETTINGS.games = SETTINGS.games.filter(g => g.id !== req.params.id);
  await saveSettings();
  res.json(SETTINGS.games);
});

app.post("/api/settings/block-date", auth, async (req, res) => {
  const { dateKey } = req.body;
  if (!dateKey) return res.status(400).json({ error:"dateKey required" });
  if (!SETTINGS.blockedDates.includes(dateKey)) SETTINGS.blockedDates.push(dateKey);
  await saveSettings();
  res.json(SETTINGS.blockedDates);
});

app.delete("/api/settings/block-date/:dateKey", auth, async (req, res) => {
  SETTINGS.blockedDates = SETTINGS.blockedDates.filter(d => d !== req.params.dateKey);
  await saveSettings();
  res.json(SETTINGS.blockedDates);
});

app.post("/api/settings/block-slot", auth, async (req, res) => {
  const { gameId, dateKey, timeSlot } = req.body;
  if (!gameId||!dateKey||!timeSlot) return res.status(400).json({ error:"gameId, dateKey, timeSlot required" });
  if (!SETTINGS.blockedSlots.some(b => b.gameId===gameId&&b.dateKey===dateKey&&b.timeSlot===timeSlot))
    SETTINGS.blockedSlots.push({ gameId, dateKey, timeSlot });
  await saveSettings();
  res.json(SETTINGS.blockedSlots);
});

app.delete("/api/settings/block-slot", auth, async (req, res) => {
  const { gameId, dateKey, timeSlot } = req.body;
  SETTINGS.blockedSlots = SETTINGS.blockedSlots.filter(b =>
    !(b.gameId===gameId && b.dateKey===dateKey && b.timeSlot===timeSlot));
  await saveSettings();
  res.json(SETTINGS.blockedSlots);
});

// ── Public API (landing page) ─────────────────────────────────────────────────

app.get("/api/public/data", async (req, res) => {
  const dates    = getDates();
  const slots    = allTimeSlots();
  const dateKeys = dates.map(d => d.key);

  // ONE query for all bookings in next 7 days
  const allBookings = await Booking.find({
    dateKey: { $in: dateKeys },
    status:  "confirmed",
  }).lean();

  // Build count map
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
        const blocked = SETTINGS.blockedSlots.some(b =>
                          b.gameId===game.id && b.dateKey===date.key && b.timeSlot===slot)
                     || SETTINGS.blockedDates.includes(date.key);
        grid.push({
          gameId:    game.id,
          dateKey:   date.key,
          timeSlot:  slot,
          available: game.courts - booked,
          blocked,
          active:    game.active,
        });
      }
    }
  }
  res.json({
    settings: {
      arenaName:    SETTINGS.arenaName,
      openHour:     SETTINGS.openHour,
      closeHour:    SETTINGS.closeHour,
      games:        SETTINGS.games,
      blockedDates: SETTINGS.blockedDates,
    },
    availability: { grid, dates, timeSlots: slots },
  });
});

app.post("/api/public/booking", async (req, res) => {
  const { name, phone, gameId, gameName, group, dateKey, date, timeSlot, pay } = req.body;
  if (!name||!phone||!gameId||!group||!dateKey||!timeSlot||!pay)
    return res.status(400).json({ error:"All fields are required." });
  if (!/^[6-9]\d{9}$/.test(phone))
    return res.status(400).json({ error:"Invalid phone number." });
  const game = SETTINGS.games.find(g => g.id === gameId);
  if (!game || !game.active) return res.status(400).json({ error:"Game not available." });
  if (SETTINGS.blockedDates.includes(dateKey)) return res.status(400).json({ error:"Bookings closed on this date." });
  if (SETTINGS.blockedSlots.some(b => b.gameId===gameId&&b.dateKey===dateKey&&b.timeSlot===timeSlot))
    return res.status(400).json({ error:"This slot is closed." });
  const avail = await getAvailableSlots(gameId, dateKey);
  if (!avail.includes(timeSlot)) return res.status(400).json({ error:"Slot no longer available." });
  const b = new Booking({
    id:genId(), gameId, gameName:gameName||game.name, gameRate:game.rate,
    dateKey, date, timeSlot, group, name, phone, pay, lang:"web", status:"confirmed",
  });
  await b.save();
  res.json(b);
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/",          (req, res) => res.sendFile(path.join(__dirname, "landing.html")));

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
  app.listen(PORT, () => console.log(SETTINGS.arenaName + " running on port " + PORT));
}

start().catch(console.error);
