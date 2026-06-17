const express = require("express");
const twilio = require("twilio");
const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const ARENA_NAME = "Nagole Sports Lounge";

const GAMES = [
  { id: "pool",         name: "Pool Table",       rate: 300 },
  { id: "cricket",      name: "Cricket Pitch",    rate: 800 },
  { id: "volleyball",   name: "Beach Volleyball", rate: 500 },
  { id: "table_tennis", name: "Table Tennis",     rate: 250 },
  { id: "badminton",    name: "Badminton",         rate: 400 },
];

// ─── Scripts (all in Roman so Polly.Aditi speaks clearly) ────────────────────

const SCRIPTS = {
  en: {
    langCode: "en-IN",
    voice:    "Polly.Aditi",
    greeting: `Thank you for calling ${ARENA_NAME}. Press 1 for English, 2 for Hindi, 3 for Telugu.`,
    askGame:   "Which game? Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, or Badminton?",
    askDate:   (g) => `${g} — which date? We have slots for the next 7 days.`,
    askTime:   (d) => `What time on ${d}? We're open 8 AM to 11 PM.`,
    askGroup:  "How many people?",
    askName:   "Your name please?",
    askPhone:  (n) => `Thanks ${n ? n.split(" ")[0] + "! " : ""}Your 10 digit phone number?`,
    askPayment:"Cash, Card, or UPI?",
    confirm:   (s) => `Confirming: ${s.game.name}, ${s.date}, ${s.time}, ${s.groupSize} people, ${s.name}, ${s.payment}. Correct?`,
    confirmed: (s) => `Booking confirmed! ID is ${s.bookingId}. See you at ${ARENA_NAME}! Goodbye.`,
    outOfHours:"We're open 8 AM to 11 PM only. Please choose another time.",
    notHeard:  "Sorry, I didn't catch that. Please say it again.",
    fallback:  "Anything else I can help with?",
    faq: {
      price:     "Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, Badminton 400 rupees per hour.",
      cancel:    "Cancel at least 2 hours before your slot for a full refund.",
      payment:   "We accept Cash, Card, and UPI.",
      parking:   "Free parking for up to 50 vehicles.",
      equipment: "All equipment provided free. You can bring your own too.",
      hours:     "Open daily 8 AM to 11 PM. Book up to 7 days ahead.",
      manager:   "Please hold, connecting you to our manager.",
    }
  },

  hi: {
    langCode: "hi-IN",
    voice:    "Polly.Aditi",
    greeting: null, // not used — greeting is always English
    askGame:   "Kaun sa game chahiye? Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, ya Badminton?",
    askDate:   (g) => `${g} — kaunsi date chahiye? Agle 7 din available hain.`,
    askTime:   (d) => `${d} ko kitne baje? Hum 8 AM se 11 PM tak khule hain.`,
    askGroup:  "Kitne log khelenge?",
    askName:   "Aapka naam?",
    askPhone:  (n) => `Shukriya ${n ? n.split(" ")[0] + "! " : ""}Aapka 10 digit number?`,
    askPayment:"Cash, Card, ya UPI?",
    confirm:   (s) => `Confirm kar rahi hoon: ${s.game.name}, ${s.date}, ${s.time}, ${s.groupSize} log, ${s.name}, ${s.payment}. Sahi hai?`,
    confirmed: (s) => `Booking ho gayi! ID hai ${s.bookingId}. ${ARENA_NAME} mein milte hain! Alvida.`,
    outOfHours:"Hum sirf 8 AM se 11 PM tak khule hain. Doosra time chunein.",
    notHeard:  "Samajh nahi aaya. Dobara bolein please.",
    fallback:  "Kuch aur madad chahiye?",
    faq: {
      price:     "Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, Badminton 400 rupaye per hour.",
      cancel:    "2 ghante pehle cancel karo toh full refund milega.",
      payment:   "Cash, Card, aur UPI teeno chalte hain.",
      parking:   "50 gaadiyoin ke liye free parking hai.",
      equipment: "Sab equipment free milta hai.",
      hours:     "Roz 8 AM se 11 PM tak khule hain. 7 din pehle book karo.",
      manager:   "Rukiye, manager se connect karta hoon.",
    }
  },

  te: {
    langCode: "te-IN",
    voice:    "Polly.Aditi",
    greeting: null,
    askGame:   "Mee game enti? Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, leда Badminton?",
    askDate:   (g) => `${g} — epp ravadam? Raabooye 7 rojulu available ga unnaayi.`,
    askTime:   (d) => `${d} na enni gantalakin? Maamu 8 AM nundi 11 PM varaku tericii untaamu.`,
    askGroup:  "Entha mandi aadataaru?",
    askName:   "Mee peru?",
    askPhone:  (n) => `Dhanyavaadaalu ${n ? n.split(" ")[0] + "! " : ""}Mee 10 digit number?`,
    askPayment:"Cash, Card, leда UPI?",
    confirm:   (s) => `Confirm chestanu: ${s.game.name}, ${s.date}, ${s.time}, ${s.groupSize} mandi, ${s.name}, ${s.payment}. Correct ga?`,
    confirmed: (s) => `Booking confirm! ID ${s.bookingId}. ${ARENA_NAME} lo kaladudam! Goodbye.`,
    outOfHours:"Maamu 8 AM nundi 11 PM varaku maatrame tericii untaamu. Vera time choose cheskoundi.",
    notHeard:  "Artham kaaledu. Malli cheppagalaara?",
    fallback:  "Inkaa em sahayam kaavali?",
    faq: {
      price:     "Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, Badminton 400 rupayalu gantakin.",
      cancel:    "2 gantala mundu cancel chesite poorthi refund vastundi.",
      payment:   "Cash, Card, mariyu UPI anni accept chestamu.",
      parking:   "50 vaahanaalakin free parking undi.",
      equipment: "Anni equipment free ga ivvabadatayi.",
      hours:     "Pratirojuu 8 AM nundi 11 PM varaku. 7 rojula mundu book cheskovachu.",
      manager:   "Okka nimisham, manager tho connect chestanu.",
    }
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectGame(text) {
  const t = text.toLowerCase();
  if (t.includes("pool") || t.includes("billiard") || t.includes("snooker")) return GAMES[0];
  if (t.includes("cricket"))                                                   return GAMES[1];
  if (t.includes("volleyball") || t.includes("volley"))                        return GAMES[2];
  if (t.includes("table tennis") || t.includes("ping") || t.includes("tt"))   return GAMES[3];
  if (t.includes("badminton") || t.includes("shuttle"))                        return GAMES[4];
  return null;
}

function detectDate(text) {
  const t = text.toLowerCase();
  const today = new Date();
  if (t.includes("today") || t.includes("aaj") || t.includes("ippudu") || t.includes("ivala")) return formatDate(today);
  if (t.includes("tomorrow") || t.includes("kal") || t.includes("repu")) {
    const d = new Date(); d.setDate(d.getDate() + 1); return formatDate(d);
  }
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  for (let i = 0; i < days.length; i++) {
    if (t.includes(days[i])) {
      const d = new Date();
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return formatDate(d);
    }
  }
  return null;
}

function detectTime(text) {
  const t = text.toLowerCase();
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (m) {
    let h = parseInt(m[1]);
    const min = m[2] || "00";
    const ampm = m[3].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    if (h < 8 || h >= 23) return "OUT_OF_HOURS";
    return `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${min} ${ampm}`;
  }
  const h24 = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (h24) {
    const h = parseInt(h24[1]);
    if (h < 8 || h >= 23) return "OUT_OF_HOURS";
    return `${h > 12 ? h - 12 : h}:${h24[2]} ${h >= 12 ? "PM" : "AM"}`;
  }
  const plain = t.match(/\bat\s+(\d{1,2})\b|\b(\d{1,2})\s*baje\b|\b(\d{1,2})\s*gantala\b/);
  if (plain) {
    let h = parseInt(plain[1] || plain[2] || plain[3]);
    if (h >= 1 && h <= 7) h += 12;
    if (h < 8 || h >= 23) return "OUT_OF_HOURS";
    return `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? "PM" : "AM"}`;
  }
  return null;
}

function detectNumber(text) {
  const words = {
    one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
    eleven:11,twelve:12,fifteen:15,twenty:20,
    ek:1,do:2,teen:3,char:4,paanch:5,chhe:6,saat:7,aath:8,nau:9,das:10,
    okati:1,rendu:2,moodu:3,nalugu:4,aidu:5,aaru:6,edu:7,enimidi:8,tommidi:9,padi:10
  };
  const t = text.toLowerCase();
  for (const [w, n] of Object.entries(words)) { if (t.includes(w)) return n; }
  const match = text.match(/\b(\d+)\b/);
  return match ? parseInt(match[1]) : null;
}

function detectPayment(text) {
  const t = text.toLowerCase();
  if (t.includes("upi") || t.includes("gpay") || t.includes("phonepe") || t.includes("paytm")) return "UPI";
  if (t.includes("card") || t.includes("credit") || t.includes("debit")) return "Card";
  if (t.includes("cash") || t.includes("nakadu")) return "Cash";
  return null;
}

function detectFaq(text) {
  const t = text.toLowerCase();
  if (/price|rate|cost|how much|charges|fee|kitna|dhara|retu/.test(t))     return "price";
  if (/cancel|refund|raddu/.test(t))                                        return "cancel";
  if (/payment|pay|upi|cash|card/.test(t))                                  return "payment";
  if (/park|parking/.test(t))                                               return "parking";
  if (/equipment|gear|bat|racket|bring/.test(t))                            return "equipment";
  if (/hour|timing|open|close|when|samayam|samay/.test(t))                  return "hours";
  if (/manager|owner|human|staff|speak|connect|transfer/.test(t))           return "manager";
  return null;
}

function formatDate(d) {
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

function generateBookingId() {
  return "NSL-" + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ─── Session Store ────────────────────────────────────────────────────────────

const sessions = {};
function getSession(sid) {
  if (!sessions[sid]) sessions[sid] = { step: "lang_select", lang: "en" };
  return sessions[sid];
}
function clearSession(sid) { delete sessions[sid]; }

// ─── Gather helper — always use speechTimeout + longer timeout ────────────────

function makeGather(twiml, lang) {
  return twiml.gather({
    input:         "speech dtmf",   // accept BOTH speech AND keypress
    action:        "/respond",
    method:        "POST",
    speechTimeout: 3,               // wait 3s of silence before processing
    timeout:       10,              // wait up to 10s for caller to start speaking
    language:      SCRIPTS[lang].langCode,
    numDigits:     1,               // for DTMF (1/2/3 language selection)
  });
}

// ─── Conversation Logic ───────────────────────────────────────────────────────

function getNextStep(s) {
  if (!s.game)      return "ask_game";
  if (!s.date)      return "ask_date";
  if (!s.time)      return "ask_time";
  if (!s.groupSize) return "ask_group";
  if (!s.name)      return "ask_name";
  if (!s.phone)     return "ask_phone";
  if (!s.payment)   return "ask_payment";
  if (!s.confirmed) return "confirm";
  return "done";
}

function processInput(speech, digits, state) {
  const text = speech || "";
  const t = text.toLowerCase();
  const s = { ...state };
  const sc = SCRIPTS[s.lang];

  // ── Language selection (first interaction) ──
  if (s.step === "lang_select") {
    let chosen = null;
    if (digits === "1" || t.includes("english") || t.includes("inglish"))          chosen = "en";
    else if (digits === "2" || t.includes("hindi") || t.includes("hind"))          chosen = "hi";
    else if (digits === "3" || t.includes("telugu") || t.includes("tell ugu"))     chosen = "te";

    if (chosen) {
      s.lang = chosen;
      s.step = "ask_game";
      return { reply: SCRIPTS[chosen].askGame, state: s };
    }
    // Didn't understand — ask again
    return { reply: SCRIPTS.en.greeting, state: s };
  }

  // ── FAQ check ──
  const faqKey = detectFaq(t);
  if (faqKey) return { reply: sc.faq[faqKey] + " " + sc.fallback, state: s };

  // ── Extract info from speech ──
  const game = detectGame(t);
  if (game && !s.game) s.game = game;

  const date = detectDate(t);
  if (date && !s.date) s.date = date;

  const time = detectTime(t);
  if (time === "OUT_OF_HOURS") return { reply: sc.outOfHours, state: s };
  if (time && !s.time) s.time = time;

  const num = detectNumber(t);
  if (num && !s.groupSize && s.game) s.groupSize = num;

  const pay = detectPayment(t);
  if (pay && !s.payment) s.payment = pay;

  // Name — only at name step
  if (s.step === "ask_name" && !s.name) {
    const cleaned = text.trim()
      .replace(/^(my name is|i am|i'm|mera naam|naa peru|nenu|name is)\s+/i, "")
      .trim();
    if (cleaned.length > 1 && cleaned.length < 40 && !detectGame(t)) {
      s.name = cleaned;
    }
  }

  // Phone
  if (!s.phone) {
    const ph = text.replace(/[\s\-]/g, "").match(/(\+?91)?([6-9]\d{9})/);
    if (ph) s.phone = ph[2];
  }

  // Confirmation
  if (s.step === "confirm") {
    if (/\b(yes|confirm|correct|right|sure|ok|okay|haan|ha|avunu|sare|aunu)\b/.test(t)) {
      s.confirmed = true;
      s.bookingId = generateBookingId();
      s.step = "done";
      return { reply: sc.confirmed(s), state: s, done: true };
    } else if (/\b(no|wrong|change|nahi|kaadu|ledu|incorrect)\b/.test(t)) {
      return { reply: sc.askGame, state: { step: "ask_game", lang: s.lang } };
    }
    // Didn't catch yes/no — ask again
    return { reply: sc.confirm(s), state: s };
  }

  // ── Advance to next unanswered step ──
  const next = getNextStep(s);
  s.step = next;

  switch (next) {
    case "ask_game":    return { reply: sc.askGame, state: s };
    case "ask_date":    return { reply: sc.askDate(s.game.name), state: s };
    case "ask_time":    return { reply: sc.askTime(s.date), state: s };
    case "ask_group":   return { reply: sc.askGroup, state: s };
    case "ask_name":    return { reply: sc.askName, state: s };
    case "ask_phone":   return { reply: sc.askPhone(s.name), state: s };
    case "ask_payment": return { reply: sc.askPayment, state: s };
    case "confirm":     return { reply: sc.confirm(s), state: s };
    default:            return { reply: sc.fallback, state: s };
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send(`${ARENA_NAME} — Aria Call Assistant running!`));

// New call comes in
app.post("/incoming", (req, res) => {
  const callSid = req.body.CallSid;
  sessions[callSid] = { step: "lang_select", lang: "en" };

  const twiml = new VoiceResponse();
  const gather = makeGather(twiml, "en");
  gather.say({ voice: "Polly.Aditi" }, SCRIPTS.en.greeting);

  // If no input at all, repeat
  twiml.redirect("/incoming");

  res.type("text/xml");
  res.send(twiml.toString());
});

// Every response from caller
app.post("/respond", (req, res) => {
  const callSid    = req.body.CallSid;
  const speech     = req.body.SpeechResult || "";
  const digits     = req.body.Digits || "";
  const confidence = parseFloat(req.body.Confidence || "0");
  const session    = getSession(callSid);

  console.log(`[${callSid}][${session.lang}][step:${session.step}] speech="${speech}" digits="${digits}" confidence=${confidence}`);

  // If confidence too low and no digits, ask again
  if (!digits && speech && confidence < 0.4 && session.step !== "ask_name") {
    const sc = SCRIPTS[session.lang];
    const twiml = new VoiceResponse();
    const gather = makeGather(twiml, session.lang);
    gather.say({ voice: sc.voice }, sc.notHeard);
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  const { reply, state: newState, done } = processInput(speech, digits, session);
  sessions[callSid] = newState;

  const sc = SCRIPTS[newState.lang];
  console.log(`[${callSid}][${newState.lang}] Aria: "${reply}"`);

  const twiml = new VoiceResponse();

  if (done) {
    twiml.say({ voice: sc.voice }, reply);
    twiml.hangup();
    clearSession(callSid);
  } else {
    const gather = makeGather(twiml, newState.lang);
    gather.say({ voice: sc.voice }, reply);
    // Fallback if no input received
    twiml.say({ voice: sc.voice }, sc.notHeard);
    twiml.redirect("/respond");
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`${ARENA_NAME} — Aria on port ${PORT}`));
