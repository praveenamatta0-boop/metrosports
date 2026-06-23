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
const BASE_URL   = process.env.BASE_URL   || "https://metrosports.onrender.com";
const JWT_SECRET  = process.env.JWT_SECRET  || "msl-change-me";
const ADMIN_USER  = process.env.ADMIN_USER  || "admin";
const ADMIN_PASS  = process.env.ADMIN_PASS  || "msl@1234";
const ADMIN_HASH  = bcrypt.hashSync(ADMIN_PASS, 10);

// ── Exotel SMS config (set these in Render env vars) ──────────────────────────
const EXOTEL_API_KEY     = process.env.EXOTEL_API_KEY     || "";
const EXOTEL_API_TOKEN   = process.env.EXOTEL_API_TOKEN   || "";
const EXOTEL_SID         = process.env.EXOTEL_SID         || "";
const EXOTEL_SUBDOMAIN   = process.env.EXOTEL_SUBDOMAIN   || "api.exotel.com";
const EXOTEL_SMS_SENDER  = process.env.EXOTEL_SMS_SENDER  || ""; // your approved sender ID / DID
const EXOTEL_DLT_ENTITY  = process.env.EXOTEL_DLT_ENTITY_ID   || "";
const EXOTEL_DLT_TEMPLATE= process.env.EXOTEL_DLT_TEMPLATE_ID || "";

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

// ── Send confirmation SMS via Exotel ──────────────────────────────────────────
// Uses Node's built-in fetch (Node 18+). Fails silently (logs only) so a booking
// is never lost just because SMS failed.
async function sendBookingSMS(booking) {
  // Skip if SMS not configured
  if (!EXOTEL_API_KEY || !EXOTEL_API_TOKEN || !EXOTEL_SID || !EXOTEL_SMS_SENDER) {
    console.log("[SMS] Skipped — Exotel SMS env vars not set");
    return;
  }
  // Need a valid Indian mobile
  const to = (booking.phone || "").replace(/[^0-9]/g, "");
  if (!/^[6-9]\d{9}$/.test(to)) {
    console.log("[SMS] Skipped — invalid phone: " + booking.phone);
    return;
  }

  // Message body — keep this matching your DLT-approved template!
  const body =
    "Metro Sports Lounge: Booking confirmed! ID " + booking.id +
    ". " + booking.gameName + " on " + booking.date + " at " + booking.timeSlot +
    ". See you there!";

  // Build the Exotel SMS API URL
  const url = "https://" + EXOTEL_API_KEY + ":" + EXOTEL_API_TOKEN +
              "@" + EXOTEL_SUBDOMAIN + "/v1/Accounts/" + EXOTEL_SID + "/Sms/send.json";

  // Form params
  const form = new URLSearchParams();
  form.append("From", EXOTEL_SMS_SENDER);
  form.append("To", to);
  form.append("Body", body);
  form.append("sms_type", "transactional");
  if (EXOTEL_DLT_ENTITY)   form.append("DltEntityId", EXOTEL_DLT_ENTITY);
  if (EXOTEL_DLT_TEMPLATE) form.append("DltTemplateId", EXOTEL_DLT_TEMPLATE);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const text = await resp.text();
    if (resp.ok) {
      console.log("[SMS] ✓ Sent to " + to + " for booking " + booking.id);
    } else {
      console.error("[SMS] Failed (" + resp.status + "): " + text.slice(0, 200));
    }
  } catch (e) {
    console.error("[SMS] Error sending:", e.message);
  }
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
  return "<Play>" + xmlEsc(text) + "</Play>";
}

function exoGather(text, lang, numDigits, finishOnKey) {
  numDigits   = numDigits   || 1;
  finishOnKey = finishOnKey || "#";
  var action  = BASE_URL + "/exotel/respond";
  var redirect= BASE_URL + "/exotel/noinput";
  return (
    '<GetDigits timeout="15" numDigits="' + numDigits + '" finishOnKey="' + finishOnKey + '" action="' + action + '" method="POST">' +
    "<Play>" + xmlEsc(text) + "</Play>" +
    "</GetDigits>" +
    "<Redirect>" + redirect + "</Redirect>"
  );
}

function exoSpeechGather(text) {
  var action   = BASE_URL + "/exotel/name";
  var callback = BASE_URL + "/exotel/transcribe";
  return (
    '<Record action="' + action + '" method="POST" maxLength="5" finishOnKey="#" playBeep="true" transcribe="true" transcribeCallback="' + callback + '">' +
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


// ─────────────────────────────────────────────────────────────────────────────
//  EXOTEL IVR — Step-based Passthru approach
//  Each step is a separate Exotel Passthru applet hitting /exotel/step/:step
//  Returns 200 to proceed to next applet, 302 to repeat current Gather
// ─────────────────────────────────────────────────────────────────────────────

// Helper: get or create session from CallSid
function getExoSession(params) {
  const sid = params.CallSid || params.CallFrom || "unknown";
  if (!sessions[sid]) sessions[sid] = { lang:"en" };
  return { sid, s: sessions[sid] };
}

// Helper: redirect back (302) = re-ask same Gather
// Helper: proceed (200) = go to next applet
function proceed(res) { res.status(200).send("ok"); }
function repeatStep(res) { res.status(302).send("repeat"); }

// Helper: build Exotel Gather JSON response with dynamic prompt text
// Includes all fields Exotel's schema validates against to avoid "URL failure case"
function gatherPrompt(text, maxDigits, finishOnKey) {
  return {
    gather_prompt: { text: text },
    max_input_digits: maxDigits || 1,
    finish_on_key: finishOnKey || "",
    input_timeout: 15,
    repeat_menu: 1,
    repeat_gather_prompt: { text: "Sorry, I did not get any input. " + text },
  };
}

function sendPrompt(req, res, label, resp) {
  const params = req.method === "POST" ? req.body : req.query;
  console.log("[PROMPT-" + label + "] sid=" + (params.CallSid||"?") + " response=" + JSON.stringify(resp));
  res.set("Content-Type", "application/json");
  res.set("Exotel-Version", "1.0");
  res.status(200).json(resp);
}

// ─────────────────────────────────────────────────────────────────────────────
//  DYNAMIC GATHER PROMPTS — set these as the "Primary URL" on each Gather
//  applet in Exotel (separate from the Passthru that processes the answer).
//  These read the caller's chosen language from session and return the
//  correct prompt text + Exotel will speak it via TTS in the right language.
// ─────────────────────────────────────────────────────────────────────────────

app.all("/exotel/prompt/lang", (req, res) => {
  sendPrompt(req, res, "LANG", gatherPrompt(script("en").welcome, 1));
});

app.all("/exotel/prompt/game", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { s } = getExoSession(params);
  const lc = script(s.lang || "en");
  sendPrompt(req, res, "GAME", gatherPrompt(lc.game(activeGames()), 1));
});

app.all("/exotel/prompt/date", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { s } = getExoSession(params);
  const lc = script(s.lang || "en");
  res.json(gatherPrompt(lc.date(getDates()), 1));
});

app.all("/exotel/prompt/time", async (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { s } = getExoSession(params);
  const lc = script(s.lang || "en");
  if (!s.gameId || !s.dateKey) return res.json(gatherPrompt(lc.invalid, 2));
  const slots = await getAvailableSlots(s.gameId, s.dateKey);
  res.json(gatherPrompt(lc.time(slots), 2));
});

app.all("/exotel/prompt/group", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { s } = getExoSession(params);
  const lc = script(s.lang || "en");
  res.json(gatherPrompt(lc.group, 1));
});

app.all("/exotel/prompt/phone", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { s } = getExoSession(params);
  const lc = script(s.lang || "en");
  res.json(gatherPrompt(lc.phone(s.name), 10, "#"));
});

app.all("/exotel/prompt/pay", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { s } = getExoSession(params);
  const lc = script(s.lang || "en");
  res.json(gatherPrompt(lc.pay, 1));
});

app.all("/exotel/prompt/confirm", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { s } = getExoSession(params);
  const lc = script(s.lang || "en");
  res.json(gatherPrompt(lc.confirm(s), 1));
});

// ── STEP: Language selection ──────────────────────────────────────────────────
// Exotel Gather prompt: "Press 1 for English. Press 2 for Hindi. Press 3 for Telugu."
// Max digits: 1
app.all("/exotel/step/lang", (req, res) => {
  const params  = req.method === "POST" ? req.body : req.query;
  const digits  = (params.digits || params.Digits || "").trim().replace(/^"+|"+$/g, "");
  const { sid, s } = getExoSession(params);
  console.log("[LANG] sid=" + sid + " digits=" + digits);

  const map = { "1":"en", "2":"hi", "3":"te" };
  if (!map[digits]) return repeatStep(res);
  s.lang = map[digits];
  sessions[sid] = s;
  proceed(res);
});

// ── STEP: Game selection ──────────────────────────────────────────────────────
// Exotel Gather prompt (use lang from session — configure in Exotel per lang or use English):
// "Press 1 Pool Table. Press 2 Cricket Pitch. Press 3 Beach Volleyball. Press 4 Table Tennis. Press 5 Badminton."
// Max digits: 1
app.all("/exotel/step/game", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const digits = (params.digits || params.Digits || "").trim().replace(/^"+|"+$/g, "");
  const { sid, s } = getExoSession(params);
  console.log("[GAME] sid=" + sid + " digits=" + digits);

  const games = activeGames();
  const idx   = parseInt(digits) - 1;
  if (isNaN(idx) || idx < 0 || idx >= games.length) return repeatStep(res);
  s.gameId   = games[idx].id;
  s.gameName = games[idx].name;
  s.gameRate = games[idx].rate;
  sessions[sid] = s;
  proceed(res);
});

// ── STEP: Date selection ──────────────────────────────────────────────────────
// Exotel Gather prompt: "Press 1 for today. Press 2 for tomorrow..." (up to 7 days)
// Max digits: 1
app.all("/exotel/step/date", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const digits = (params.digits || params.Digits || "").trim().replace(/^"+|"+$/g, "");
  const { sid, s } = getExoSession(params);
  console.log("[DATE] sid=" + sid + " digits=" + digits);

  const dates = getDates();
  const idx   = parseInt(digits) - 1;
  if (isNaN(idx) || idx < 0 || idx >= dates.length) return repeatStep(res);
  if (SETTINGS.blockedDates.includes(dates[idx].key)) return repeatStep(res);
  s.dateKey = dates[idx].key;
  s.date    = dates[idx].label;
  sessions[sid] = s;
  proceed(res);
});

// ── STEP: Time slot selection ─────────────────────────────────────────────────
// Exotel Gather prompt: Dynamic based on available slots
// Since Gather is static in Exotel, we use fixed slot numbering
// Our server checks if chosen slot is actually available
// Max digits: 2 (up to 15 slots)
app.all("/exotel/step/time", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const digits = (params.digits || params.Digits || "").trim().replace(/^"+|"+$/g, "");
  const { sid, s } = getExoSession(params);
  console.log("[TIME] sid=" + sid + " digits=" + digits + " game=" + s.gameId + " date=" + s.dateKey);

  if (!s.gameId || !s.dateKey) return repeatStep(res);

  getAvailableSlots(s.gameId, s.dateKey).then(function(slots) {
    const idx = parseInt(digits) - 1;
    if (isNaN(idx) || idx < 0 || idx >= slots.length) return repeatStep(res);
    s.timeSlot = slots[idx];
    sessions[sid] = s;
    proceed(res);
  }).catch(function() { repeatStep(res); });
});

// ── STEP: Group size ──────────────────────────────────────────────────────────
// Exotel Gather: "Press 1 for 1-2. Press 2 for 3-5. Press 3 for 6-10. Press 4 for 11-20. Press 5 for 20+"
// Max digits: 1
app.all("/exotel/step/group", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const digits = (params.digits || params.Digits || "").trim().replace(/^"+|"+$/g, "");
  const { sid, s } = getExoSession(params);
  console.log("[GROUP] sid=" + sid + " digits=" + digits);

  const idx = parseInt(digits) - 1;
  if (isNaN(idx) || idx < 0 || idx > 4) return repeatStep(res);
  s.group = GRP.en[idx];

  // Auto-capture phone + name from caller ID (CallFrom) — no need to ask
  const callerNum = (params.CallFrom || params.From || "").replace(/[^0-9]/g, "");
  const phMatch   = callerNum.match(/([6-9]\d{9})/);
  s.phone = phMatch ? phMatch[1] : (callerNum.slice(-10) || "0000000000");
  s.name  = "Caller " + (s.phone ? s.phone.slice(-4) : "");
  console.log("[GROUP] auto-captured phone=" + s.phone + " from CallFrom=" + (params.CallFrom||""));

  sessions[sid] = s;
  proceed(res);
});

// ── STEP: Phone number (LEGACY — no longer used in flow) ──────────────────────
// Phone is now auto-captured from caller ID during the group step.
// This route is kept only as a safety fallback if you still have a phone Gather.
app.all("/exotel/step/phone", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const digits = (params.digits || params.Digits || "").trim().replace(/^"+|"+$/g, "");
  const { sid, s } = getExoSession(params);
  console.log("[PHONE] sid=" + sid + " digits=" + digits);

  const raw = digits.replace(/[\s\-]/g, "");
  const ph  = raw.match(/([6-9]\d{9})/) ||
              (params.CallFrom||"").replace(/[^0-9]/g,"").match(/([6-9]\d{9})/);

  // Always proceed — if we already have phone from group step, just continue
  if (ph) s.phone = ph[1];
  if (!s.phone) s.phone = "0000000000";
  if (!s.name)  s.name  = "Caller " + s.phone.slice(-4);
  sessions[sid] = s;
  proceed(res);
});

// ── STEP: Payment ─────────────────────────────────────────────────────────────
// Exotel Gather: "Press 1 for Cash. Press 2 for Card. Press 3 for UPI."
// Max digits: 1
app.all("/exotel/step/pay", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const digits = (params.digits || params.Digits || "").trim().replace(/^"+|"+$/g, "");
  const { sid, s } = getExoSession(params);
  console.log("[PAY] sid=" + sid + " digits=" + digits);

  const map = { "1":"Cash", "2":"Card", "3":"UPI" };
  if (!map[digits]) return repeatStep(res);
  s.pay = map[digits];
  sessions[sid] = s;
  proceed(res);
});

// ── STEP: Confirm & Save booking ──────────────────────────────────────────────
// This Passthru is called after final confirmation Gather.
// "Press 1 to confirm. Press 2 to cancel."
// Single-applet design: saves the booking here directly.
//   200 (proceed)  → wire to Confirmed Greeting → Hangup
//   302 (repeat)   → wire to Cancelled Greeting → Hangup
app.all("/exotel/step/confirm", async (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const digits = (params.digits || params.Digits || "").trim().replace(/^"+|"+$/g, "");
  const { sid, s } = getExoSession(params);
  console.log("[CONFIRM] sid=" + sid + " digits=" + digits + " session=" + JSON.stringify(s));

  // Caller pressed 2 → cancel
  if (digits === "2") {
    console.log("[CONFIRM] Caller cancelled");
    return repeatStep(res); // 302 → Cancelled Greeting
  }

  // NOTE: Some Exotel Gather→Passthru wirings don't pass the pressed digit
  // reliably (digits arrives empty). Since the caller has already gone through
  // every step and all booking data is present in the session, we treat
  // reaching this point (with anything except an explicit "2") as confirmation.
  // Only an explicit "2" cancels.
  console.log("[CONFIRM] Proceeding to save (digits=" + (digits || "empty") + ")");

  // Validate required fields before saving
  if (!s.gameId || !s.dateKey || !s.timeSlot || !s.group || !s.pay) {
    console.log("[CONFIRM] Missing fields: " + JSON.stringify({
      game:s.gameId, date:s.dateKey, time:s.timeSlot, group:s.group, pay:s.pay
    }));
    return repeatStep(res); // 302 → Cancelled/error Greeting
  }

  // Ensure phone exists (auto-captured earlier; fallback if somehow missing)
  if (!s.phone) {
    const callerNum = (params.CallFrom || params.From || "").replace(/[^0-9]/g, "");
    const phMatch = callerNum.match(/([6-9]\d{9})/);
    s.phone = phMatch ? phMatch[1] : (callerNum.slice(-10) || "0000000000");
  }
  if (!s.name) s.name = "Caller " + s.phone.slice(-4);

  try {
    const b = new Booking({
      id:       genId(),
      gameId:   s.gameId,
      gameName: s.gameName,
      gameRate: s.gameRate || 0,
      dateKey:  s.dateKey,
      date:     s.date,
      timeSlot: s.timeSlot,
      group:    s.group,
      name:     s.name,
      phone:    s.phone,
      pay:      s.pay,
      lang:     s.lang || "en",
      status:   "confirmed",
    });
    await b.save();
    s.bookingId = b.id;
    sessions[sid] = s;
    console.log("[CONFIRM] ✓ Booking saved: " + b.id);
    sendBookingSMS(b); // fire-and-forget confirmation SMS
    proceed(res); // 200 → Confirmed Greeting
  } catch (e) {
    console.error("[CONFIRM] Save error:", e.message);
    return repeatStep(res); // 302 → error/cancelled Greeting
  }
});

// ── STEP: route-confirm (LEGACY — no longer needed) ───────────────────────────
// Kept as a harmless passthrough in case your flow still references it.
// It just proceeds based on whether a booking was already saved.
app.all("/exotel/step/route-confirm", async (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { sid, s } = getExoSession(params);
  if (s && s.bookingId) {
    console.log("[ROUTE-CONFIRM] booking exists (" + s.bookingId + ") → confirmed");
    return proceed(res);
  }
  console.log("[ROUTE-CONFIRM] no booking → cancelled");
  return repeatStep(res);
});

// ── STEP: Get available slots info (for Exotel Greeting prompt) ───────────────
// Call this from Exotel Greeting applet's dynamic URL to get slot count message
app.all("/exotel/slots", async (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { sid, s } = getExoSession(params);

  if (!s.gameId || !s.dateKey) {
    res.json({ message: "No slots information available." });
    return;
  }

  const slots = await getAvailableSlots(s.gameId, s.dateKey);
  res.json({
    count:   slots.length,
    slots:   slots,
    message: slots.length > 0
      ? slots.length + " slots available. " + slots.map((sl, i) => "Press " + (i+1) + " for " + sl + ".").join(" ")
      : "No slots available for this date.",
  });
});

// ── GREETING: Booking confirmation message (dynamic text for Exotel Greeting applet) ──
// Point your "Confirmed" Greeting applet's "Read text like a robot" URL field to this.
// MUST return plain text with Content-Type: text/plain
app.all("/exotel/greeting/confirmed", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { sid, s } = getExoSession(params);

  res.set("Content-Type", "text/plain");

  if (!s || !s.bookingId) {
    return res.send("Thank you for calling Metro Sports Lounge. Goodbye.");
  }

  const text =
    "Booking confirmed! Your booking ID is " + s.bookingId.split("").join(" ") + ". " +
    s.gameName + " on " + s.date + " at " + s.timeSlot + ", for " + s.group + ". " +
    "Payment by " + s.pay + ". " +
    "See you at Metro Sports Lounge! Goodbye.";

  console.log("[GREETING-CONFIRMED] sid=" + sid + " text=" + text);
  res.send(text);
});

// ── GREETING: Cancellation message ────────────────────────────────────────────
app.all("/exotel/greeting/cancelled", (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { sid, s } = getExoSession(params);
  delete sessions[sid];

  res.set("Content-Type", "text/plain");
  res.send("Your booking has been cancelled. Thank you for calling Metro Sports Lounge. Goodbye.");
});

// ── GREETING: Generic error / restart message ─────────────────────────────────
app.all("/exotel/greeting/error", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send("Sorry, something went wrong with your booking. Please call again. Goodbye.");
});

// ── STATUS endpoint — returns current session state ───────────────────────────
// Useful for debugging and for Exotel Greeting to read booking confirmation
app.get("/exotel/session/:sid", (req, res) => {
  const s = sessions[req.params.sid];
  if (!s) return res.json({ error: "Session not found" });
  res.json(s);
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
  sendBookingSMS(b); // fire-and-forget confirmation SMS
  res.json(b);
});

// ── Pages ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
//  VOICEBOT TOOLS — endpoints the Exotel AI Voicebot agent calls during a call
//  These let the conversational AI check real availability and save bookings.
//  No auth (called by Exotel's agent), but validates all input.
// ─────────────────────────────────────────────────────────────────────────────

// TOOL: check_availability
// The agent calls this with { game, date } and gets back available time slots.
// "game" can be a name ("cricket") or id ("cricket"); "date" can be "today",
// "tomorrow", a weekday name, or YYYY-MM-DD.
app.all("/voicebot/check-availability", async (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const gameInput = (params.game || "").toLowerCase().trim();
  const dateInput = (params.date || "").toLowerCase().trim();

  // Resolve game
  const game = SETTINGS.games.find(g =>
    g.active && (g.id === gameInput || g.name.toLowerCase().includes(gameInput) || gameInput.includes(g.id))
  );
  if (!game) {
    return res.json({ success:false, message:"I couldn't find that game. We have pool table, cricket pitch, beach volleyball, table tennis, and badminton." });
  }

  // Resolve date
  const dateKey = resolveDate(dateInput);
  if (!dateKey) {
    return res.json({ success:false, message:"Please tell me a date within the next 7 days, like today, tomorrow, or a weekday." });
  }

  // Date label
  const dateObj = getDates().find(d => d.key === dateKey);
  const dateLabel = dateObj ? dateObj.label : dateKey;

  if (SETTINGS.blockedDates.includes(dateKey)) {
    return res.json({ success:false, message:"Sorry, we're not taking bookings on " + dateLabel + ". Could you pick another date?" });
  }

  const slots = await getAvailableSlots(game.id, dateKey);
  if (!slots.length) {
    return res.json({ success:false, gameId:game.id, gameName:game.name, dateKey, dateLabel,
      message:"Sorry, there are no open slots for " + game.name + " on " + dateLabel + ". Want to try another date or game?" });
  }

  res.json({
    success:    true,
    gameId:     game.id,
    gameName:   game.name,
    rate:       game.rate,
    dateKey,
    dateLabel,
    availableSlots: slots,
    message:    game.name + " on " + dateLabel + " has these times available: " + slots.join(", ") + ".",
  });
});

// TOOL: save_booking
// The agent calls this once it has all details + caller confirmation.
app.all("/voicebot/save-booking", async (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const gameInput = (params.game || "").toLowerCase().trim();
  const dateInput = (params.date || "").toLowerCase().trim();
  const timeSlot  = (params.timeSlot || params.time || "").trim();
  const groupRaw  = (params.groupSize || params.group || "").toString().trim();
  const pay       = (params.payment || params.pay || "").trim();
  const name      = (params.name || "Caller").trim();
  const phoneRaw  = (params.phone || params.callerNumber || "").toString();

  // Resolve game
  const game = SETTINGS.games.find(g =>
    g.active && (g.id === gameInput || g.name.toLowerCase().includes(gameInput) || gameInput.includes(g.id))
  );
  if (!game) return res.json({ success:false, message:"That game isn't available." });

  // Resolve date
  const dateKey = resolveDate(dateInput);
  if (!dateKey) return res.json({ success:false, message:"That date isn't valid." });
  const dateObj = getDates().find(d => d.key === dateKey);
  const dateLabel = dateObj ? dateObj.label : dateKey;

  // Verify slot still available
  const slots = await getAvailableSlots(game.id, dateKey);
  // normalize time match (e.g. "5 PM" / "5pm" / "17:00")
  const matchedSlot = slots.find(s => s.toLowerCase().replace(/\s/g,"") === timeSlot.toLowerCase().replace(/\s/g,""));
  if (!matchedSlot) {
    return res.json({ success:false,
      message:"Sorry, " + timeSlot + " is no longer available. Available times are: " + (slots.join(", ") || "none right now") + "." });
  }

  // Normalize group size into a label
  const group = normalizeGroup(groupRaw);

  // Normalize payment
  let payment = "Cash";
  const pl = pay.toLowerCase();
  if (pl.includes("upi") || pl.includes("gpay") || pl.includes("phonepe")) payment = "UPI";
  else if (pl.includes("card")) payment = "Card";
  else if (pl.includes("cash")) payment = "Cash";

  // Phone
  const phone = extractIndianPhoneVB(phoneRaw) || "0000000000";

  // Save
  const b = new Booking({
    id:        genId(),
    gameId:    game.id,
    gameName:  game.name,
    gameRate:  game.rate,
    dateKey,
    date:      dateLabel,
    timeSlot:  matchedSlot,
    group,
    name,
    phone,
    pay:       payment,
    lang:      params.lang || "voice",
    status:    "confirmed",
  });
  await b.save();
  console.log("[VOICEBOT] Booking saved: " + b.id);
  sendBookingSMS(b); // fire-and-forget confirmation SMS

  res.json({
    success:   true,
    bookingId: b.id,
    spokenId:  b.id.split("").join(" "),  // for the agent to read slowly
    gameName:  game.name,
    dateLabel,
    timeSlot:  matchedSlot,
    group,
    payment,
    message:   "Booking confirmed! Booking ID " + b.id + " for " + game.name + " on " + dateLabel + " at " + matchedSlot + ".",
  });
});

// Helper: resolve flexible date input to a date key (YYYY-MM-DD) within 7 days
function resolveDate(input) {
  const t = (input || "").toLowerCase().trim();
  const dates = getDates();
  if (!t) return null;
  if (t.includes("today") || t.includes("aaj") || t.includes("ivala") || t.includes("ee roju")) return dates[0].key;
  if (t.includes("tomorrow") || t.includes("kal") || t.includes("repu") || t.includes("repu")) return dates[1].key;
  // YYYY-MM-DD direct
  const iso = t.match(/\d{4}-\d{2}-\d{2}/);
  if (iso && dates.some(d => d.key === iso[0])) return iso[0];
  // Weekday name
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  for (let i = 0; i < days.length; i++) {
    if (t.includes(days[i])) {
      const match = dates.find(d => new Date(d.key).getDay() === i);
      if (match) return match.key;
    }
  }
  // "day after tomorrow"
  if (t.includes("day after")) return dates[2] ? dates[2].key : null;
  return null;
}

// Helper: normalize a group size (number or phrase) to a label
function normalizeGroup(raw) {
  const n = parseInt(raw);
  if (!isNaN(n)) {
    if (n <= 2)  return "1-2 people";
    if (n <= 5)  return "3-5 people";
    if (n <= 10) return "6-10 people";
    if (n <= 20) return "11-20 people";
    return "20+ people";
  }
  return raw || "Not specified";
}

// Helper: extract Indian phone for voicebot
function extractIndianPhoneVB(raw) {
  if (!raw) return null;
  const digitsOnly = String(raw).replace(/[^0-9]/g, "");
  const match = digitsOnly.match(/([6-9]\d{9})$/);
  return match ? match[1] : null;
}

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
  app.listen(PORT, () => console.log(SETTINGS.arenaName + " — VOICEBOT TRIAL — running on port " + PORT));
}

start().catch(console.error);
