const express = require("express");
const twilio = require("twilio");
const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const ARENA_NAME = "Nagole Sports Lounge";

// ─── Data ─────────────────────────────────────────────────────────────────────

const GAMES = [
  { id: "pool",         name: "Pool Table",       rate: "300 rupees per hour" },
  { id: "cricket",      name: "Cricket Pitch",    rate: "800 rupees per hour" },
  { id: "volleyball",   name: "Beach Volleyball", rate: "500 rupees per hour" },
  { id: "table_tennis", name: "Table Tennis",     rate: "250 rupees per hour" },
  { id: "badminton",    name: "Badminton",        rate: "400 rupees per hour" },
];

// Next 7 days
function getAvailableDates() {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }));
  }
  return dates;
}

// Hour slots 8 AM – 10 PM (last slot starts at 10 PM, ends 11 PM)
const TIME_SLOTS = [
  "8 AM", "9 AM", "10 AM", "11 AM",
  "12 PM", "1 PM", "2 PM", "3 PM",
  "4 PM", "5 PM", "6 PM", "7 PM",
  "8 PM", "9 PM", "10 PM"
];

const PAYMENT_METHODS = ["Cash", "Card", "UPI"];

// ─── Multilingual Prompts ─────────────────────────────────────────────────────

const LANG = {
  en: {
    langCode: "en-IN",
    voice: "Polly.Aditi",
    greeting:    `Welcome to ${ARENA_NAME}. Press 1 for English. Press 2 for Hindi. Press 3 for Telugu.`,
    askGame:     "Select your game. Press 1 for Pool Table. Press 2 for Cricket Pitch. Press 3 for Beach Volleyball. Press 4 for Table Tennis. Press 5 for Badminton.",
    askDate:     (dates) => "Select date. " + dates.map((d, i) => `Press ${i + 1} for ${d}.`).join(" "),
    askTimeA:    "Select time. Press 1 for 8 AM. Press 2 for 9 AM. Press 3 for 10 AM. Press 4 for 11 AM. Press 5 for 12 PM. Press 6 for 1 PM. Press 7 for 2 PM. Press 8 for more options.",
    askTimeB:    "Press 1 for 3 PM. Press 2 for 4 PM. Press 3 for 5 PM. Press 4 for 6 PM. Press 5 for 7 PM. Press 6 for 8 PM. Press 7 for 9 PM. Press 8 for 10 PM.",
    askGroup:    "How many people? Press 1 for 1 to 2. Press 2 for 3 to 5. Press 3 for 6 to 10. Press 4 for 11 to 20. Press 5 for more than 20.",
    askPayment:  "Payment method. Press 1 for Cash. Press 2 for Card. Press 3 for UPI.",
    askConfirm:  (s) => `Confirming your booking. ${s.game.name}. ${s.date}. ${s.time}. ${s.groupSize} people. Payment by ${s.payment}. Press 1 to confirm. Press 2 to cancel.`,
    askName:     "Please say your name after the beep.",
    askPhone:    "Please say your 10 digit mobile number after the beep.",
    confirmed:   (s) => `Booking confirmed! Your ID is ${s.bookingId}. ${s.game.name} on ${s.date} at ${s.time}. See you at ${ARENA_NAME}. Goodbye!`,
    cancelled:   "Booking cancelled. Thank you for calling. Goodbye.",
    invalid:     "Invalid option. Please try again.",
    notHeard:    "I did not get your response. Please try again.",
    repeat:      "Press 9 to hear options again.",
  },
  hi: {
    langCode: "hi-IN",
    voice: "Polly.Aditi",
    greeting:    null,
    askGame:     "Game chuniye. 1 dabaye Pool Table ke liye. 2 dabaye Cricket Pitch ke liye. 3 dabaye Beach Volleyball ke liye. 4 dabaye Table Tennis ke liye. 5 dabaye Badminton ke liye.",
    askDate:     (dates) => "Date chuniye. " + dates.map((d, i) => `${i + 1} dabaye ${d} ke liye.`).join(" "),
    askTimeA:    "Samay chuniye. 1 dabaye 8 AM. 2 dabaye 9 AM. 3 dabaye 10 AM. 4 dabaye 11 AM. 5 dabaye 12 PM. 6 dabaye 1 PM. 7 dabaye 2 PM. 8 dabaye aur options ke liye.",
    askTimeB:    "1 dabaye 3 PM. 2 dabaye 4 PM. 3 dabaye 5 PM. 4 dabaye 6 PM. 5 dabaye 7 PM. 6 dabaye 8 PM. 7 dabaye 9 PM. 8 dabaye 10 PM.",
    askGroup:    "Kitne log? 1 dabaye 1 se 2 log. 2 dabaye 3 se 5 log. 3 dabaye 6 se 10 log. 4 dabaye 11 se 20 log. 5 dabaye 20 se zyada.",
    askPayment:  "Payment method. 1 dabaye Cash. 2 dabaye Card. 3 dabaye UPI.",
    askConfirm:  (s) => `Booking confirm karein. ${s.game.name}. ${s.date}. ${s.time}. ${s.groupSize} log. ${s.payment} se payment. 1 dabaye confirm ke liye. 2 dabaye cancel ke liye.`,
    askName:     "Beep ke baad apna naam boliye.",
    askPhone:    "Beep ke baad apna 10 digit mobile number boliye.",
    confirmed:   (s) => `Booking ho gayi! ID hai ${s.bookingId}. ${s.game.name}, ${s.date}, ${s.time}. ${ARENA_NAME} mein milte hain. Alvida!`,
    cancelled:   "Booking cancel ho gayi. Dhanyavaad. Alvida.",
    invalid:     "Galat option. Dobara try karein.",
    notHeard:    "Response nahi mila. Dobara try karein.",
    repeat:      "9 dabaye options sunne ke liye.",
  },
  te: {
    langCode: "te-IN",
    voice: "Polly.Aditi",
    greeting:    null,
    askGame:     "Game select cheskoundi. 1 press chesthe Pool Table. 2 press chesthe Cricket Pitch. 3 press chesthe Beach Volleyball. 4 press chesthe Table Tennis. 5 press chesthe Badminton.",
    askDate:     (dates) => "Date select cheskoundi. " + dates.map((d, i) => `${i + 1} press chesthe ${d}.`).join(" "),
    askTimeA:    "Samayam select cheskoundi. 1 press chesthe 8 AM. 2 press chesthe 9 AM. 3 press chesthe 10 AM. 4 press chesthe 11 AM. 5 press chesthe 12 PM. 6 press chesthe 1 PM. 7 press chesthe 2 PM. 8 press chesthe inkaa options kosam.",
    askTimeB:    "1 press chesthe 3 PM. 2 press chesthe 4 PM. 3 press chesthe 5 PM. 4 press chesthe 6 PM. 5 press chesthe 7 PM. 6 press chesthe 8 PM. 7 press chesthe 9 PM. 8 press chesthe 10 PM.",
    askGroup:    "Entha mandi? 1 press chesthe 1 to 2. 2 press chesthe 3 to 5. 3 press chesthe 6 to 10. 4 press chesthe 11 to 20. 5 press chesthe 20 kante ekkuva.",
    askPayment:  "Payment method. 1 press chesthe Cash. 2 press chesthe Card. 3 press chesthe UPI.",
    askConfirm:  (s) => `Booking confirm cheskoundi. ${s.game.name}. ${s.date}. ${s.time}. ${s.groupSize} mandi. ${s.payment} dwara payment. 1 press chesthe confirm. 2 press chesthe cancel.`,
    askName:     "Beep taruvata mee peru cheppandi.",
    askPhone:    "Beep taruvata mee 10 digit mobile number cheppandi.",
    confirmed:   (s) => `Booking confirm ayyindi! ID ${s.bookingId}. ${s.game.name}, ${s.date}, ${s.time}. ${ARENA_NAME} lo kaladudam. Goodbye!`,
    cancelled:   "Booking cancel chesaam. Dhanyavaadaalu. Goodbye.",
    invalid:     "Tappu option. Malli try cheskoundi.",
    notHeard:    "Response raaledhu. Malli try cheskoundi.",
    repeat:      "9 press chesthe options malli vinandi.",
  }
};

const GROUP_LABELS = {
  en: ["1 to 2 people", "3 to 5 people", "6 to 10 people", "11 to 20 people", "More than 20"],
  hi: ["1 se 2 log",    "3 se 5 log",    "6 se 10 log",    "11 se 20 log",    "20 se zyada"],
  te: ["1 to 2 mandi",  "3 to 5 mandi",  "6 to 10 mandi",  "11 to 20 mandi",  "20 kante ekkuva"],
};

// ─── Session Store ────────────────────────────────────────────────────────────

const sessions = {};
function getSession(sid) {
  if (!sessions[sid]) sessions[sid] = { step: "lang_select", lang: "en" };
  return sessions[sid];
}
function clearSession(sid) { delete sessions[sid]; }

// ─── DTMF Gather helper ───────────────────────────────────────────────────────

function gather(twiml, lang, numDigits = 1) {
  return twiml.gather({
    input:     "dtmf",
    action:    "/respond",
    method:    "POST",
    timeout:   15,
    numDigits: numDigits,
    language:  LANG[lang].langCode,
  });
}

// Speech gather — only for name & phone
function speechGather(twiml, lang) {
  return twiml.gather({
    input:         "speech",
    action:        "/respond",
    method:        "POST",
    speechTimeout: 3,
    timeout:       10,
    language:      LANG[lang].langCode,
  });
}

function respond(res, twiml) {
  res.type("text/xml");
  res.send(twiml.toString());
}

// ─── Route: Incoming call ────────────────────────────────────────────────────

app.get("/", (req, res) => res.send(`${ARENA_NAME} — Aria DTMF Assistant running!`));

app.post("/incoming", (req, res) => {
  const callSid = req.body.CallSid;
  sessions[callSid] = { step: "lang_select", lang: "en" };

  const twiml = new VoiceResponse();
  const g = gather(twiml, "en");
  g.say({ voice: "Polly.Aditi" }, LANG.en.greeting);
  twiml.redirect("/incoming");
  respond(res, twiml);
});

// ─── Route: Handle all responses ─────────────────────────────────────────────

app.post("/respond", (req, res) => {
  const callSid = req.body.CallSid;
  const digits  = (req.body.Digits || "").trim();
  const speech  = (req.body.SpeechResult || "").trim();
  const session = getSession(callSid);
  const twiml   = new VoiceResponse();

  const s   = session;
  const lc  = LANG[s.lang];
  const v   = lc.voice;

  console.log(`[${callSid}][${s.lang}][${s.step}] digits="${digits}" speech="${speech}"`);

  // ── Helper: say + re-ask same step ──
  function invalid() {
    const g = gather(twiml, s.lang);
    g.say({ voice: v }, lc.invalid + " " + currentPrompt());
    respond(res, twiml);
  }

  function currentPrompt() {
    const dates = getAvailableDates();
    switch (s.step) {
      case "lang_select": return LANG.en.greeting;
      case "ask_game":    return lc.askGame;
      case "ask_date":    return lc.askDate(dates);
      case "ask_time_a":  return lc.askTimeA;
      case "ask_time_b":  return lc.askTimeB;
      case "ask_group":   return lc.askGroup;
      case "ask_payment": return lc.askPayment;
      case "ask_name":    return lc.askName;
      case "ask_phone":   return lc.askPhone;
      case "ask_confirm": return lc.askConfirm(s);
      default: return "";
    }
  }

  // ── Step machine ──

  if (s.step === "lang_select") {
    if (digits === "1") { s.lang = "en"; }
    else if (digits === "2") { s.lang = "hi"; }
    else if (digits === "3") { s.lang = "te"; }
    else return invalid();

    s.step = "ask_game";
    sessions[callSid] = s;
    const g = gather(twiml, s.lang);
    g.say({ voice: LANG[s.lang].voice }, LANG[s.lang].askGame);
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_game") {
    const idx = parseInt(digits) - 1;
    if (isNaN(idx) || idx < 0 || idx > 4) return invalid();
    s.game = GAMES[idx];
    s.step = "ask_date";
    sessions[callSid] = s;
    const dates = getAvailableDates();
    const g = gather(twiml, s.lang);
    g.say({ voice: v }, lc.askDate(dates));
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_date") {
    const dates = getAvailableDates();
    const idx = parseInt(digits) - 1;
    if (isNaN(idx) || idx < 0 || idx >= dates.length) return invalid();
    s.date = dates[idx];
    s.step = "ask_time_a";
    sessions[callSid] = s;
    const g = gather(twiml, s.lang);
    g.say({ voice: v }, lc.askTimeA);
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_time_a") {
    if (digits === "8") {
      s.step = "ask_time_b";
      sessions[callSid] = s;
      const g = gather(twiml, s.lang);
      g.say({ voice: v }, lc.askTimeB);
      twiml.redirect("/respond");
      return respond(res, twiml);
    }
    const timeMap = { "1":"8 AM","2":"9 AM","3":"10 AM","4":"11 AM","5":"12 PM","6":"1 PM","7":"2 PM" };
    if (!timeMap[digits]) return invalid();
    s.time = timeMap[digits];
    s.step = "ask_group";
    sessions[callSid] = s;
    const g = gather(twiml, s.lang);
    g.say({ voice: v }, lc.askGroup);
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_time_b") {
    const timeMap = { "1":"3 PM","2":"4 PM","3":"5 PM","4":"6 PM","5":"7 PM","6":"8 PM","7":"9 PM","8":"10 PM" };
    if (!timeMap[digits]) return invalid();
    s.time = timeMap[digits];
    s.step = "ask_group";
    sessions[callSid] = s;
    const g = gather(twiml, s.lang);
    g.say({ voice: v }, lc.askGroup);
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_group") {
    const groups = GROUP_LABELS[s.lang];
    const idx = parseInt(digits) - 1;
    if (isNaN(idx) || idx < 0 || idx > 4) return invalid();
    s.groupSize = groups[idx];
    s.step = "ask_name";
    sessions[callSid] = s;
    // Name uses speech
    const g = speechGather(twiml, s.lang);
    g.say({ voice: v }, lc.askName);
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_name") {
    const name = speech.trim().replace(/^(my name is|i am|i'm|mera naam|naa peru)\s+/i, "").trim();
    if (!name || name.length < 2) {
      const g = speechGather(twiml, s.lang);
      g.say({ voice: v }, lc.notHeard + " " + lc.askName);
      return respond(res, twiml);
    }
    s.name = name;
    s.step = "ask_phone";
    sessions[callSid] = s;
    const g = speechGather(twiml, s.lang);
    g.say({ voice: v }, lc.askPhone);
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_phone") {
    // Accept phone from speech OR digits
    const raw = (speech + digits).replace(/[\s\-]/g, "");
    const ph  = raw.match(/(\+?91)?([6-9]\d{9})/);
    if (!ph) {
      const g = speechGather(twiml, s.lang);
      g.say({ voice: v }, lc.notHeard + " " + lc.askPhone);
      return respond(res, twiml);
    }
    s.phone = ph[2];
    s.step  = "ask_payment";
    sessions[callSid] = s;
    const g = gather(twiml, s.lang);
    g.say({ voice: v }, lc.askPayment);
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_payment") {
    const payMap = { "1": "Cash", "2": "Card", "3": "UPI" };
    if (!payMap[digits]) return invalid();
    s.payment = payMap[digits];
    s.step    = "ask_confirm";
    sessions[callSid] = s;
    const g = gather(twiml, s.lang);
    g.say({ voice: v }, lc.askConfirm(s));
    twiml.redirect("/respond");
    return respond(res, twiml);
  }

  if (s.step === "ask_confirm") {
    if (digits === "1") {
      // Confirmed
      s.bookingId = "NSL-" + Math.random().toString(36).substr(2, 6).toUpperCase();
      clearSession(callSid);
      twiml.say({ voice: v }, lc.confirmed(s));
      twiml.hangup();
      return respond(res, twiml);
    } else if (digits === "2") {
      // Cancelled
      clearSession(callSid);
      twiml.say({ voice: v }, lc.cancelled);
      twiml.hangup();
      return respond(res, twiml);
    } else {
      return invalid();
    }
  }

  // Fallback
  clearSession(callSid);
  twiml.say({ voice: "Polly.Aditi" }, "Thank you for calling Nagole Sports Lounge. Goodbye.");
  twiml.hangup();
  respond(res, twiml);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`${ARENA_NAME} — Aria DTMF on port ${PORT}`));
