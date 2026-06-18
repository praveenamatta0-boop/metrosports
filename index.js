// ─────────────────────────────────────────────────────────────────────────────
//  Nagole Sports Lounge — Aria Call Assistant v9
//  DTMF-only IVR (name=speech only), next-hour slot filtering,
//  settings API (add/edit games, block dates/slots), dashboard served
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const twilio  = require("twilio");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const cors    = require("cors");
const path    = require("path");
const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Config
const JWT_SECRET = process.env.JWT_SECRET || "nsl-change-me";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "nsl@1234";
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASS, 10);

// Mutable settings
let SETTINGS = {
  arenaName: "Nagole Sports Lounge",
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

const bookings = [];

// Helpers
function activeGames() { return SETTINGS.games.filter(g => g.active); }

function allTimeSlots() {
  const slots = [];
  for (let h = SETTINGS.openHour; h < SETTINGS.closeHour; h++) {
    slots.push(h < 12 ? h + " AM" : h === 12 ? "12 PM" : (h-12) + " PM");
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

function getAvailableSlots(gameId, dateKey) {
  const game = SETTINGS.games.find(g => g.id === gameId);
  if (!game || !game.active) return [];
  if (SETTINGS.blockedDates.includes(dateKey)) return [];
  const todayKey = new Date().toISOString().split("T")[0];
  const nowHour  = new Date().getHours();
  return allTimeSlots().filter(slot => {
    const h = slotToHour(slot);
    if (dateKey === todayKey && h <= nowHour) return false;
    if (SETTINGS.blockedSlots.some(b => b.gameId===gameId && b.dateKey===dateKey && b.timeSlot===slot)) return false;
    const booked = bookings.filter(b => b.gameId===gameId && b.dateKey===dateKey && b.timeSlot===slot && b.status==="confirmed").length;
    return booked < game.courts;
  });
}

function bookedCount(gameId, dateKey, slot) {
  return bookings.filter(b => b.gameId===gameId && b.dateKey===dateKey && b.timeSlot===slot && b.status==="confirmed").length;
}

function genId() { return "NSL-" + Math.random().toString(36).substr(2,6).toUpperCase(); }

// Group labels per language
const GRP = {
  en:["1-2 people","3-5 people","6-10 people","11-20 people","20+ people"],
  hi:["1-2 log","3-5 log","6-10 log","11-20 log","20+ log"],
  te:["1-2 mandi","3-5 mandi","6-10 mandi","11-20 mandi","20+ mandi"],
};

// Scripts
function script(lang) {
  const name = SETTINGS.arenaName;
  const scripts = {
    en: {
      code:"en-IN", voice:"Polly.Aditi",
      welcome:  "Welcome to " + name + ". Press 1 for English. Press 2 for Hindi. Press 3 for Telugu.",
      game:     function(g){ return "Select game. " + g.map(function(x,i){ return "Press "+(i+1)+" for "+x.name+"."; }).join(" "); },
      date:     function(d){ return "Select date. " + d.map(function(x,i){ return "Press "+(i+1)+" for "+x.label+"."; }).join(" "); },
      time:     function(s){ return "Available slots. " + s.map(function(x,i){ return "Press "+(i+1)+" for "+x+"."; }).join(" "); },
      noSlots:  "No slots available. Press 1 for another date. Press 2 for another game.",
      group:    "How many people? Press 1 for 1 to 2. Press 2 for 3 to 5. Press 3 for 6 to 10. Press 4 for 11 to 20. Press 5 for more than 20.",
      namePr:   "Please say your name after the beep.",
      phone:    function(n){ return "Thanks " + (n?n.split(" ")[0]+". ":"") + "Press your 10 digit mobile number followed by hash key."; },
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
      game:     function(g){ return "Game chuniye. " + g.map(function(x,i){ return (i+1)+" dabaye "+x.name+"."; }).join(" "); },
      date:     function(d){ return "Date chuniye. " + d.map(function(x,i){ return (i+1)+" dabaye "+x.label+"."; }).join(" "); },
      time:     function(s){ return "Available slots. " + s.map(function(x,i){ return (i+1)+" dabaye "+x+"."; }).join(" "); },
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
      game:     function(g){ return "Game select cheskoundi. " + g.map(function(x,i){ return (i+1)+" press chesthe "+x.name+"."; }).join(" "); },
      date:     function(d){ return "Date select cheskoundi. " + d.map(function(x,i){ return (i+1)+" press chesthe "+x.label+"."; }).join(" "); },
      time:     function(s){ return "Available slots. " + s.map(function(x,i){ return (i+1)+" press chesthe "+x+"."; }).join(" "); },
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
  return scripts[lang] || scripts.en;
}

// Sessions
const sessions = {};
function sess(sid) {
  if (!sessions[sid]) sessions[sid] = { step:"lang", lang:"en" };
  return sessions[sid];
}

// Gathers
function dtmfGather(twiml, lang, numDigits) {
  return twiml.gather({ input:"dtmf", action:"/respond", method:"POST", timeout:15, numDigits:numDigits||1, language:script(lang).code });
}
function phoneGather(twiml, lang) {
  return twiml.gather({ input:"dtmf", action:"/respond", method:"POST", timeout:20, numDigits:10, finishOnKey:"#", language:script(lang).code });
}
function nameGather(twiml, lang) {
  return twiml.gather({ input:"speech", action:"/respond", method:"POST", speechTimeout:3, timeout:12, language:script(lang).code });
}
function sendXml(res, twiml) { res.type("text/xml"); res.send(twiml.toString()); }

// IVR
app.post("/incoming", (req,res) => {
  const sid = req.body.CallSid;
  sessions[sid] = { step:"lang", lang:"en" };
  const twiml = new VoiceResponse();
  const g = dtmfGather(twiml, "en");
  g.say({ voice:"Polly.Aditi" }, script("en").welcome);
  twiml.redirect("/incoming");
  sendXml(res, twiml);
});

app.post("/respond", (req,res) => {
  const sid    = req.body.CallSid;
  const digits = (req.body.Digits||"").trim();
  const speech = (req.body.SpeechResult||"").trim();
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

  if (s.step === "lang") {
    if (!["1","2","3"].includes(digits)) return inv(script("en").welcome);
    s.lang = digits==="1"?"en":digits==="2"?"hi":"te";
    s.step = "game";
    return askDtmf(script(s.lang).game(activeGames()));
  }

  if (s.step === "game") {
    const games = activeGames();
    const idx   = parseInt(digits)-1;
    if (isNaN(idx)||idx<0||idx>=games.length) return inv(lc.game(games));
    s.gameId = games[idx].id; s.gameName = games[idx].name;
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
    const slots = getAvailableSlots(s.gameId, s.dateKey);
    if (!slots.length) { s.step="noSlots"; return askDtmf(lc.noSlots); }
    s.slots = slots; s.step = "time";
    return askDtmf(lc.time(slots));
  }

  if (s.step === "noSlots") {
    if (digits==="1") { s.step="date"; return askDtmf(lc.date(getDates())); }
    if (digits==="2") { s.step="game"; return askDtmf(lc.game(activeGames())); }
    return inv(lc.noSlots);
  }

  if (s.step === "time") {
    const slots = s.slots||[];
    const idx   = parseInt(digits)-1;
    if (isNaN(idx)||idx<0||idx>=slots.length) return inv(lc.time(slots));
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
    s.name = name; s.step = "phone";
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
      const b = { id:genId(), gameId:s.gameId, gameName:s.gameName,
        gameRate:SETTINGS.games.find(g=>g.id===s.gameId)?.rate||0,
        dateKey:s.dateKey, date:s.date, timeSlot:s.timeSlot,
        group:s.group, name:s.name, phone:s.phone, pay:s.pay,
        lang:s.lang, status:"confirmed", createdAt:new Date().toISOString() };
      bookings.push(b); s.id = b.id;
      return end(lc.done(s));
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

// Auth
function auth(req,res,next) {
  const h = req.headers.authorization;
  if (!h||!h.startsWith("Bearer ")) return res.status(401).json({error:"Unauthorized"});
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({error:"Token invalid"}); }
}

// API
app.post("/api/login", (req,res) => {
  const {username,password} = req.body;
  if (username!==ADMIN_USER||!bcrypt.compareSync(password,ADMIN_HASH))
    return res.status(401).json({error:"Wrong credentials"});
  res.json({ token:jwt.sign({username},JWT_SECRET,{expiresIn:"12h"}) });
});

app.get("/api/bookings", auth, (req,res) => {
  res.json([...bookings].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
});

app.patch("/api/bookings/:id/cancel", auth, (req,res) => {
  const b = bookings.find(x=>x.id===req.params.id);
  if (!b) return res.status(404).json({error:"Not found"});
  b.status = "cancelled"; res.json(b);
});

app.get("/api/stats", auth, (req,res) => {
  const today = new Date().toISOString().split("T")[0];
  res.json({
    total:     bookings.length,
    confirmed: bookings.filter(b=>b.status==="confirmed").length,
    cancelled: bookings.filter(b=>b.status==="cancelled").length,
    today:     bookings.filter(b=>b.dateKey===today&&b.status==="confirmed").length,
    revenue:   bookings.filter(b=>b.status==="confirmed").reduce((s,b)=>s+b.gameRate,0),
  });
});

app.get("/api/availability", auth, (req,res) => {
  const dates = getDates();
  const slots = allTimeSlots();
  const grid  = [];
  for (const game of SETTINGS.games)
    for (const date of dates)
      for (const slot of slots) {
        const booked = bookedCount(game.id,date.key,slot);
        const blocked = SETTINGS.blockedSlots.some(b=>b.gameId===game.id&&b.dateKey===date.key&&b.timeSlot===slot)
                     || SETTINGS.blockedDates.includes(date.key);
        grid.push({ gameId:game.id, gameName:game.name, gameMax:game.courts,
          dateKey:date.key, dateLabel:date.label, timeSlot:slot,
          booked, available:game.courts-booked, blocked, active:game.active });
      }
  res.json({ games:SETTINGS.games, dates, timeSlots:slots, grid });
});

app.get("/api/settings", auth, (req,res) => res.json(SETTINGS));

app.put("/api/settings", auth, (req,res) => {
  const s = req.body;
  if (s.arenaName)              SETTINGS.arenaName  = s.arenaName;
  if (s.openHour  !== undefined) SETTINGS.openHour  = parseInt(s.openHour);
  if (s.closeHour !== undefined) SETTINGS.closeHour = parseInt(s.closeHour);
  res.json(SETTINGS);
});

app.post("/api/settings/games", auth, (req,res) => {
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
  res.json(SETTINGS.games);
});

app.delete("/api/settings/games/:id", auth, (req,res) => {
  SETTINGS.games = SETTINGS.games.filter(g=>g.id!==req.params.id);
  res.json(SETTINGS.games);
});

app.post("/api/settings/block-date", auth, (req,res) => {
  const { dateKey } = req.body;
  if (!dateKey) return res.status(400).json({error:"dateKey required"});
  if (!SETTINGS.blockedDates.includes(dateKey)) SETTINGS.blockedDates.push(dateKey);
  res.json(SETTINGS.blockedDates);
});

app.delete("/api/settings/block-date/:dateKey", auth, (req,res) => {
  SETTINGS.blockedDates = SETTINGS.blockedDates.filter(d=>d!==req.params.dateKey);
  res.json(SETTINGS.blockedDates);
});

app.post("/api/settings/block-slot", auth, (req,res) => {
  const { gameId, dateKey, timeSlot } = req.body;
  if (!gameId||!dateKey||!timeSlot) return res.status(400).json({error:"gameId, dateKey, timeSlot required"});
  if (!SETTINGS.blockedSlots.some(b=>b.gameId===gameId&&b.dateKey===dateKey&&b.timeSlot===timeSlot))
    SETTINGS.blockedSlots.push({ gameId, dateKey, timeSlot });
  res.json(SETTINGS.blockedSlots);
});

app.delete("/api/settings/block-slot", auth, (req,res) => {
  const { gameId, dateKey, timeSlot } = req.body;
  SETTINGS.blockedSlots = SETTINGS.blockedSlots.filter(b=>
    !(b.gameId===gameId&&b.dateKey===dateKey&&b.timeSlot===timeSlot));
  res.json(SETTINGS.blockedSlots);
});

// ── Public API (no auth — for landing page) ───────────────────────────────────

// Public data: settings + availability grid (no sensitive booking info)
app.get("/api/public/data", (req,res) => {
  const dates = getDates();
  const slots = allTimeSlots();
  const grid  = [];
  for (const game of SETTINGS.games) {
    for (const date of dates) {
      for (const slot of slots) {
        const booked  = bookedCount(game.id, date.key, slot);
        const blocked = SETTINGS.blockedSlots.some(b => b.gameId===game.id && b.dateKey===date.key && b.timeSlot===slot)
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

// Public booking submission
app.post("/api/public/booking", (req,res) => {
  const { name, phone, gameId, gameName, group, dateKey, date, timeSlot, pay } = req.body;

  // Validate
  if (!name || !phone || !gameId || !group || !dateKey || !timeSlot || !pay)
    return res.status(400).json({ error:"All fields are required." });
  if (!/^[6-9]\d{9}$/.test(phone))
    return res.status(400).json({ error:"Invalid phone number." });

  const game = SETTINGS.games.find(g => g.id === gameId);
  if (!game || !game.active)
    return res.status(400).json({ error:"Game not available." });

  // Check date not blocked
  if (SETTINGS.blockedDates.includes(dateKey))
    return res.status(400).json({ error:"Bookings are closed on this date." });

  // Check slot not blocked
  if (SETTINGS.blockedSlots.some(b => b.gameId===gameId && b.dateKey===dateKey && b.timeSlot===timeSlot))
    return res.status(400).json({ error:"This slot is closed for bookings." });

  // Check availability
  const available = getAvailableSlots(gameId, dateKey);
  if (!available.includes(timeSlot))
    return res.status(400).json({ error:"This slot is no longer available. Please choose another." });

  const b = {
    id:        genId(),
    gameId,
    gameName:  gameName || game.name,
    gameRate:  game.rate,
    dateKey,
    date,
    timeSlot,
    group,
    name,
    phone,
    pay,
    lang:      "web",
    status:    "confirmed",
    createdAt: new Date().toISOString(),
  };
  bookings.push(b);
  res.json(b);
});

// Dashboard + Landing page
app.get("/dashboard", (req,res) => res.sendFile(path.join(__dirname,"dashboard.html")));
app.get("/", (req,res) => res.sendFile(path.join(__dirname,"landing.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(SETTINGS.arenaName+" on port "+PORT));
