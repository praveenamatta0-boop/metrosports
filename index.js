const express  = require("express");
const twilio   = require("twilio");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const cors     = require("cors");
const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────

const ARENA_NAME  = "Nagole Sports Lounge";
const JWT_SECRET  = process.env.JWT_SECRET  || "nsl-secret-change-in-production";
const ADMIN_USER  = process.env.ADMIN_USER  || "admin";
const ADMIN_PASS  = process.env.ADMIN_PASS  || "nsl@1234";   // change in Render env vars
const ADMIN_HASH  = bcrypt.hashSync(ADMIN_PASS, 10);

// ─── Data ─────────────────────────────────────────────────────────────────────

const GAMES = [
  { id: "pool",         name: "Pool Table",       rate: "300 rupees per hour",  maxSlots: 4 },
  { id: "cricket",      name: "Cricket Pitch",    rate: "800 rupees per hour",  maxSlots: 2 },
  { id: "volleyball",   name: "Beach Volleyball", rate: "500 rupees per hour",  maxSlots: 2 },
  { id: "table_tennis", name: "Table Tennis",     rate: "250 rupees per hour",  maxSlots: 3 },
  { id: "badminton",    name: "Badminton",        rate: "400 rupees per hour",  maxSlots: 2 },
];

const TIME_SLOTS = [
  "8 AM","9 AM","10 AM","11 AM","12 PM",
  "1 PM","2 PM","3 PM","4 PM","5 PM",
  "6 PM","7 PM","8 PM","9 PM","10 PM"
];

const GROUP_SIZES = {
  en: ["1 to 2 people","3 to 5 people","6 to 10 people","11 to 20 people","More than 20"],
  hi: ["1 se 2 log","3 se 5 log","6 se 10 log","11 se 20 log","20 se zyada"],
  te: ["1 to 2 mandi","3 to 5 mandi","6 to 10 mandi","11 to 20 mandi","20 kante ekkuva"],
};

// Booking store — in-memory (persists while server runs)
// For production, replace with a database
const bookings = [];

function getAvailableDates() {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push({
      label: d.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long" }),
      key:   d.toISOString().split("T")[0],
    });
  }
  return dates;
}

function getBookedCount(gameId, dateKey, timeSlot) {
  return bookings.filter(b =>
    b.gameId === gameId &&
    b.dateKey === dateKey &&
    b.timeSlot === timeSlot &&
    b.status === "confirmed"
  ).length;
}

function isSlotAvailable(gameId, dateKey, timeSlot) {
  const game = GAMES.find(g => g.id === gameId);
  if (!game) return false;
  return getBookedCount(gameId, dateKey, timeSlot) < game.maxSlots;
}

function getAvailableSlotsForGame(gameId, dateKey) {
  return TIME_SLOTS.filter(ts => isSlotAvailable(gameId, dateKey, ts));
}

function generateId() {
  return "NSL-" + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ─── Multilingual Scripts ─────────────────────────────────────────────────────

const LANG = {
  en: {
    langCode: "en-IN", voice: "Polly.Aditi",
    greeting:   `Welcome to ${ARENA_NAME}. Press 1 for English. Press 2 for Hindi. Press 3 for Telugu.`,
    askGame:    "Select your game. Press 1 for Pool Table. Press 2 for Cricket Pitch. Press 3 for Beach Volleyball. Press 4 for Table Tennis. Press 5 for Badminton.",
    askDate:    (dates) => "Select date. " + dates.map((d,i) => `Press ${i+1} for ${d.label}.`).join(" "),
    askTimeMenu:(slots)  => "Available slots. " + slots.map((s,i) => `Press ${i+1} for ${s}.`).join(" "),
    noSlots:    "Sorry, no slots are available for that date and game. Press 1 to choose another date. Press 2 to choose another game.",
    askGroup:   "How many people? Press 1 for 1 to 2. Press 2 for 3 to 5. Press 3 for 6 to 10. Press 4 for 11 to 20. Press 5 for more than 20.",
    askName:    "Please say your name after the beep.",
    askPhone:   "Please say or type your 10 digit mobile number.",
    askPayment: "Payment method. Press 1 for Cash. Press 2 for Card. Press 3 for UPI.",
    askConfirm: (s) => `Confirming: ${s.game.name}, ${s.date}, ${s.timeSlot}, ${s.groupSize}, name ${s.name}, payment ${s.payment}. Press 1 to confirm. Press 2 to restart.`,
    confirmed:  (s) => `Booking confirmed! Your ID is ${s.bookingId}. ${s.game.name} on ${s.date} at ${s.timeSlot}. See you at ${ARENA_NAME}! Goodbye.`,
    restarted:  "Let's start over. " ,
    invalid:    "Invalid option. Please try again. ",
    notHeard:   "I did not catch that. Please try again. ",
    goodbye:    `Thank you for calling ${ARENA_NAME}. Goodbye.`,
  },
  hi: {
    langCode: "hi-IN", voice: "Polly.Aditi",
    greeting:   null,
    askGame:    "Game chuniye. 1 dabaye Pool Table. 2 dabaye Cricket Pitch. 3 dabaye Beach Volleyball. 4 dabaye Table Tennis. 5 dabaye Badminton.",
    askDate:    (dates) => "Date chuniye. " + dates.map((d,i) => `${i+1} dabaye ${d.label}.`).join(" "),
    askTimeMenu:(slots)  => "Available slots. " + slots.map((s,i) => `${i+1} dabaye ${s}.`).join(" "),
    noSlots:    "Maaf kijiye, is date aur game ke liye koi slot available nahi hai. 1 dabaye doosri date ke liye. 2 dabaye doosra game ke liye.",
    askGroup:   "Kitne log? 1 dabaye 1 se 2. 2 dabaye 3 se 5. 3 dabaye 6 se 10. 4 dabaye 11 se 20. 5 dabaye 20 se zyada.",
    askName:    "Beep ke baad apna naam boliye.",
    askPhone:   "Apna 10 digit mobile number boliye ya type kariye.",
    askPayment: "Payment. 1 dabaye Cash. 2 dabaye Card. 3 dabaye UPI.",
    askConfirm: (s) => `Confirm karein: ${s.game.name}, ${s.date}, ${s.timeSlot}, ${s.groupSize}, naam ${s.name}, payment ${s.payment}. 1 dabaye confirm. 2 dabaye restart.`,
    confirmed:  (s) => `Booking ho gayi! ID hai ${s.bookingId}. ${s.game.name}, ${s.date}, ${s.timeSlot}. ${ARENA_NAME} mein milte hain! Alvida.`,
    restarted:  "Phir se shuru karte hain. ",
    invalid:    "Galat option. Dobara try karein. ",
    notHeard:   "Samajh nahi aaya. Dobara try karein. ",
    goodbye:    `${ARENA_NAME} mein call karne ke liye shukriya. Alvida.`,
  },
  te: {
    langCode: "te-IN", voice: "Polly.Aditi",
    greeting:   null,
    askGame:    "Game select cheskoundi. 1 press chesthe Pool Table. 2 press chesthe Cricket Pitch. 3 press chesthe Beach Volleyball. 4 press chesthe Table Tennis. 5 press chesthe Badminton.",
    askDate:    (dates) => "Date select cheskoundi. " + dates.map((d,i) => `${i+1} press chesthe ${d.label}.`).join(" "),
    askTimeMenu:(slots)  => "Available slots. " + slots.map((s,i) => `${i+1} press chesthe ${s}.`).join(" "),
    noSlots:    "Maafi cheskoundi, aa date mariyu game ki slots levu. 1 press chesthe vera date. 2 press chesthe vera game.",
    askGroup:   "Entha mandi? 1 press chesthe 1 to 2. 2 press chesthe 3 to 5. 3 press chesthe 6 to 10. 4 press chesthe 11 to 20. 5 press chesthe 20 kante ekkuva.",
    askName:    "Beep taruvata mee peru cheppandi.",
    askPhone:   "Mee 10 digit mobile number cheppandi leда type chesandi.",
    askPayment: "Payment. 1 press chesthe Cash. 2 press chesthe Card. 3 press chesthe UPI.",
    askConfirm: (s) => `Confirm cheskoundi: ${s.game.name}, ${s.date}, ${s.timeSlot}, ${s.groupSize}, peru ${s.name}, payment ${s.payment}. 1 press chesthe confirm. 2 press chesthe restart.`,
    confirmed:  (s) => `Booking confirm ayyindi! ID ${s.bookingId}. ${s.game.name}, ${s.date}, ${s.timeSlot}. ${ARENA_NAME} lo kaladudam! Goodbye.`,
    restarted:  "Malli modalupetudaam. ",
    invalid:    "Tappu option. Malli try cheskoundi. ",
    notHeard:   "Artham kaaledu. Malli try cheskoundi. ",
    goodbye:    `${ARENA_NAME} ki call chesinduku dhanyavaadaalu. Goodbye.`,
  }
};

// ─── Session Store ────────────────────────────────────────────────────────────

const sessions = {};
function getSession(sid) {
  if (!sessions[sid]) sessions[sid] = { step:"lang_select", lang:"en" };
  return sessions[sid];
}
function clearSession(sid) { delete sessions[sid]; }

// ─── TwiML Helpers ────────────────────────────────────────────────────────────

function dtmfGather(twiml, lang, numDigits=1) {
  return twiml.gather({
    input:"dtmf speech", action:"/respond", method:"POST",
    timeout:15, numDigits:numDigits, speechTimeout:3,
    language: LANG[lang].langCode,
  });
}

function speechGather(twiml, lang) {
  return twiml.gather({
    input:"speech dtmf", action:"/respond", method:"POST",
    speechTimeout:4, timeout:12, numDigits:10,
    language: LANG[lang].langCode,
  });
}

function sendTwiml(res, twiml) {
  res.type("text/xml");
  res.send(twiml.toString());
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send(`${ARENA_NAME} — Aria v5 running!`));

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER || !bcrypt.compareSync(password, ADMIN_HASH)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

// Get all bookings
app.get("/api/bookings", authMiddleware, (req, res) => {
  res.json(bookings.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// Cancel a booking
app.patch("/api/bookings/:id/cancel", authMiddleware, (req, res) => {
  const b = bookings.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: "Not found" });
  b.status = "cancelled";
  res.json(b);
});

// Availability grid
app.get("/api/availability", authMiddleware, (req, res) => {
  const dates = getAvailableDates();
  const grid  = [];
  for (const game of GAMES) {
    for (const date of dates) {
      for (const slot of TIME_SLOTS) {
        const booked = getBookedCount(game.id, date.key, slot);
        grid.push({
          gameId:    game.id,
          gameName:  game.name,
          maxSlots:  game.maxSlots,
          dateKey:   date.key,
          dateLabel: date.label,
          timeSlot:  slot,
          booked,
          available: game.maxSlots - booked,
        });
      }
    }
  }
  res.json({ games: GAMES, dates, timeSlots: TIME_SLOTS, grid });
});

// Stats
app.get("/api/stats", authMiddleware, (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  res.json({
    total:     bookings.length,
    confirmed: bookings.filter(b => b.status === "confirmed").length,
    cancelled: bookings.filter(b => b.status === "cancelled").length,
    today:     bookings.filter(b => b.dateKey === today && b.status === "confirmed").length,
    revenue:   bookings.filter(b => b.status === "confirmed").reduce((s,b) => s + (b.game?.rateNum || 0), 0),
  });
});

// ─── Twilio IVR Routes ────────────────────────────────────────────────────────

app.post("/incoming", (req, res) => {
  const sid = req.body.CallSid;
  sessions[sid] = { step:"lang_select", lang:"en" };
  const twiml = new VoiceResponse();
  const g = dtmfGather(twiml, "en");
  g.say({ voice:"Polly.Aditi" }, LANG.en.greeting);
  twiml.redirect("/incoming");
  sendTwiml(res, twiml);
});

app.post("/respond", (req, res) => {
  const sid    = req.body.CallSid;
  const digits = (req.body.Digits || "").trim();
  const speech = (req.body.SpeechResult || "").trim();
  const s      = getSession(sid);
  const twiml  = new VoiceResponse();
  const lc     = LANG[s.lang];
  const v      = lc.voice;
  const input  = digits || speech;

  console.log(`[${sid}][${s.lang}][${s.step}] digits="${digits}" speech="${speech}"`);

  function ask(prompt, useSpeech=false) {
    const g = useSpeech ? speechGather(twiml, s.lang) : dtmfGather(twiml, s.lang);
    g.say({ voice: v }, prompt);
    twiml.say({ voice: v }, lc.notHeard + prompt);
    sessions[sid] = s;
    sendTwiml(res, twiml);
  }

  function invalid(prompt) {
    const g = dtmfGather(twiml, s.lang);
    g.say({ voice: v }, lc.invalid + prompt);
    sessions[sid] = s;
    sendTwiml(res, twiml);
  }

  function restart() {
    sessions[sid] = { step:"lang_select", lang: s.lang };
    const g = dtmfGather(twiml, s.lang);
    g.say({ voice: v }, lc.restarted + lc.askGame);
    sessions[sid].step = "ask_game";
    sendTwiml(res, twiml);
  }

  // ── Language Select ──
  if (s.step === "lang_select") {
    const map = { "1":"en","2":"hi","3":"te" };
    // speech detect
    const t = speech.toLowerCase();
    let chosen = map[digits];
    if (!chosen) {
      if (t.includes("english"))                           chosen = "en";
      else if (t.includes("hindi") || t.includes("hind")) chosen = "hi";
      else if (t.includes("telugu"))                       chosen = "te";
    }
    if (!chosen) return invalid(LANG.en.greeting);
    s.lang = chosen; s.step = "ask_game";
    return ask(LANG[chosen].askGame);
  }

  // ── Game Select ──
  if (s.step === "ask_game") {
    const idx = parseInt(input) - 1;
    if (isNaN(idx) || idx < 0 || idx > 4) return invalid(lc.askGame);
    s.game = GAMES[idx];
    s.step = "ask_date";
    return ask(lc.askDate(getAvailableDates()));
  }

  // ── Date Select ──
  if (s.step === "ask_date") {
    const dates = getAvailableDates();
    const idx   = parseInt(input) - 1;
    if (isNaN(idx) || idx < 0 || idx >= dates.length) return invalid(lc.askDate(dates));
    s.selectedDate = dates[idx];
    s.date    = dates[idx].label;
    s.dateKey = dates[idx].key;

    // Show only available slots
    const avail = getAvailableSlotsForGame(s.game.id, s.dateKey);
    if (avail.length === 0) {
      s.step = "no_slots";
      sessions[sid] = s;
      const g = dtmfGather(twiml, s.lang);
      g.say({ voice: v }, lc.noSlots);
      return sendTwiml(res, twiml);
    }
    s.availableSlots = avail;
    s.step = "ask_time";
    return ask(lc.askTimeMenu(avail));
  }

  // ── No Slots fallback ──
  if (s.step === "no_slots") {
    if (digits === "1") { s.step = "ask_date"; return ask(lc.askDate(getAvailableDates())); }
    if (digits === "2") { s.step = "ask_game"; return ask(lc.askGame); }
    return invalid(lc.noSlots);
  }

  // ── Time Select (from available slots only) ──
  if (s.step === "ask_time") {
    const slots = s.availableSlots || TIME_SLOTS;
    const idx   = parseInt(input) - 1;
    if (isNaN(idx) || idx < 0 || idx >= slots.length) return invalid(lc.askTimeMenu(slots));
    s.timeSlot = slots[idx];
    s.step     = "ask_group";
    return ask(lc.askGroup);
  }

  // ── Group Size ──
  if (s.step === "ask_group") {
    const idx = parseInt(input) - 1;
    if (isNaN(idx) || idx < 0 || idx > 4) return invalid(lc.askGroup);
    s.groupSize = GROUP_SIZES[s.lang][idx];
    s.step = "ask_name";
    return ask(lc.askName, true);
  }

  // ── Name (speech) ──
  if (s.step === "ask_name") {
    const name = speech.trim().replace(/^(my name is|i am|i'm|mera naam|naa peru)\s+/i,"").trim();
    if (!name || name.length < 2) return ask(lc.notHeard + lc.askName, true);
    s.name = name;
    s.step = "ask_phone";
    return ask(lc.askPhone, true);
  }

  // ── Phone (speech or dtmf) ──
  if (s.step === "ask_phone") {
    const raw = (speech + digits).replace(/[\s\-]/g,"");
    const ph  = raw.match(/(\+?91)?([6-9]\d{9})/);
    if (!ph) return ask(lc.notHeard + lc.askPhone, true);
    s.phone = ph[2];
    s.step  = "ask_payment";
    return ask(lc.askPayment);
  }

  // ── Payment ──
  if (s.step === "ask_payment") {
    const map = {"1":"Cash","2":"Card","3":"UPI"};
    if (!map[input]) return invalid(lc.askPayment);
    s.payment = map[input];
    s.step    = "ask_confirm";
    return ask(lc.askConfirm(s));
  }

  // ── Confirm ──
  if (s.step === "ask_confirm") {
    if (input === "1") {
      // Save booking
      const booking = {
        id:        generateId(),
        gameId:    s.game.id,
        game:      { name: s.game.name, rate: s.game.rate, rateNum: s.game.rate ? parseInt(s.game.rate) : 0 },
        date:      s.date,
        dateKey:   s.dateKey,
        timeSlot:  s.timeSlot,
        groupSize: s.groupSize,
        name:      s.name,
        phone:     s.phone,
        payment:   s.payment,
        lang:      s.lang,
        status:    "confirmed",
        createdAt: new Date().toISOString(),
      };
      bookings.push(booking);
      s.bookingId = booking.id;
      clearSession(sid);
      twiml.say({ voice: v }, lc.confirmed(s));
      twiml.hangup();
      return sendTwiml(res, twiml);
    }
    if (input === "2") return restart();
    return invalid(lc.askConfirm(s));
  }

  // Fallback
  clearSession(sid);
  twiml.say({ voice: v }, lc.goodbye);
  twiml.hangup();
  sendTwiml(res, twiml);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`${ARENA_NAME} — Aria on port ${PORT}`));
