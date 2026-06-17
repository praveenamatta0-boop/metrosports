const express = require("express");
const twilio = require("twilio");
const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Arena Config ─────────────────────────────────────────────────────────────

const GAMES = [
  { id: "pool",         name: "Pool Table",       nameHi: "Pool Table",        nameTe: "Pool Table",         rate: 300 },
  { id: "cricket",      name: "Cricket Pitch",    nameHi: "Cricket Pitch",     nameTe: "Cricket Pitch",      rate: 800 },
  { id: "volleyball",   name: "Beach Volleyball", nameHi: "Beach Volleyball",  nameTe: "Beach Volleyball",   rate: 500 },
  { id: "table_tennis", name: "Table Tennis",     nameHi: "Table Tennis",      nameTe: "Table Tennis",       rate: 250 },
  { id: "badminton",    name: "Badminton",        nameHi: "Badminton",         nameTe: "Badminton",          rate: 400 },
];

// ─── Multilingual Scripts ─────────────────────────────────────────────────────
// IMPORTANT: All text kept in Latin/Roman script so Polly voices can speak them.
// Telugu & Hindi responses are written phonetically in English so the voice reads naturally.

const SCRIPTS = {
  en: {
    langCode: "en-IN",
    voice:    "Polly.Aditi",
    greeting:
      "Hello! Thank you for calling Arena Sports Hub. I am Aria, your booking assistant. " +
      "I can speak in English, Hindi, or Telugu. Just say your preferred language. How can I help you today?",
    askGame:   "Which game would you like to book? We have Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, and Badminton.",
    askDate:   (g) => `${g} is a great choice! What date would you like? We have slots for the next 7 days.`,
    askTime:   (d) => `What time would you like on ${d}? We are open from 8 AM to 11 PM.`,
    askGroup:  "How many people will be playing?",
    askName:   "May I have your name please?",
    askPhone:  (n) => `Thank you${n ? ", " + n.split(" ")[0] : ""}! Could I get your 10 digit phone number?`,
    askPayment:"How would you like to pay? Cash, Card, or U P I?",
    confirm:   (s) => `Let me confirm: ${s.game.name}, on ${s.date} at ${s.time}, for ${s.groupSize} people. Name ${s.name}. Payment ${s.payment}. Is that correct?`,
    confirmed: (s) => `Booking confirmed! Your booking ID is ${s.bookingId}. ${s.game.name} on ${s.date} at ${s.time} for ${s.groupSize} people. See you at Arena Sports Hub! Goodbye!`,
    outOfHours:"Sorry, we are open between 8 AM and 11 PM only. Please choose a time within those hours.",
    notHeard:  "I did not catch that. Could you please repeat?",
    fallback:  "Is there anything else I can help you with?",
    faq: {
      price:     "Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, and Badminton 400 rupees per hour. Would you like to book?",
      cancel:    "You can cancel up to 2 hours before your slot for a full refund.",
      payment:   "We accept Cash, Card, and U P I.",
      parking:   "Yes, free parking for up to 50 vehicles.",
      equipment: "All equipment is provided free. You may bring your own gear too.",
      hours:     "We are open every day from 8 AM to 11 PM. Bookings available up to 7 days in advance.",
      manager:   "Please hold while I connect you to our manager.",
    }
  },

  hi: {
    langCode: "hi-IN",
    voice:    "Polly.Aditi",  // Aditi speaks Hindi natively
    greeting:
      "Namaste! Arena Sports Hub mein aapka swagat hai. Main Aria hoon, aapki booking assistant. " +
      "Main Hindi, English, ya Telugu mein baat kar sakti hoon. Aaj main aapki kaise madad kar sakti hoon?",
    askGame:   "Aap kaun sa game book karna chahte hain? Hamare paas Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, aur Badminton available hain.",
    askDate:   (g) => `${g} bahut accha choice hai! Aap kis date ko book karna chahte hain? Agle 7 din ke liye slots available hain.`,
    askTime:   (d) => `${d} ko aap kitne baje khelna chahte hain? Hum subah 8 baje se raat 11 baje tak khule hain.`,
    askGroup:  "Kitne log khelenge?",
    askName:   "Kya aap apna naam bata sakte hain?",
    askPhone:  (n) => `Shukriya${n ? ", " + n.split(" ")[0] : ""}! Kripya apna 10 digit mobile number batayein.`,
    askPayment:"Aap kis tarah se payment karenge? Cash, Card, ya U P I?",
    confirm:   (s) => `Main confirm karti hoon: ${s.game.name}, ${s.date} ko ${s.time} baje, ${s.groupSize} logon ke liye. Naam ${s.name}. Payment ${s.payment}. Kya yeh sahi hai?`,
    confirmed: (s) => `Booking confirmed ho gayi! Aapka Booking ID hai ${s.bookingId}. Arena Sports Hub mein aapka intezaar rahega! Alvida!`,
    outOfHours:"Maaf kijiye, hum sirf subah 8 baje se raat 11 baje tak khule hain. Kripya us time ke beech koi slot chunein.",
    notHeard:  "Main samajh nahi paayi. Kya aap dobara bata sakte hain?",
    fallback:  "Kya main aur kuch madad kar sakti hoon?",
    faq: {
      price:     "Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, aur Badminton 400 rupaye per hour. Kya aap booking karna chahenge?",
      cancel:    "Booking se 2 ghante pehle cancel karne par poora refund milega.",
      payment:   "Hum Cash, Card, aur U P I teeno accept karte hain.",
      parking:   "Haan, 50 gaadiyoin ke liye free parking available hai.",
      equipment: "Sabhi equipment free mein available hai. Aap apna gear bhi la sakte hain.",
      hours:     "Hum har din subah 8 baje se raat 11 baje tak khule hain. 7 din pehle tak booking ki ja sakti hai.",
      manager:   "Kripya rukiye, main aapko hamare manager se connect karti hoon.",
    }
  },

  te: {
    langCode: "te-IN",
    voice:    "Polly.Aditi",  // Polly.Aditi reads Roman phonetic Telugu well
    // All Telugu written phonetically in Roman so Aditi can speak it clearly
    greeting:
      "Namaskaram! Arena Sports Hub ki swaagatam. Nenu Aria, meeru booking assistant. " +
      "Nenu Telugu, Hindi, leда English lo matlaadagalanu. Meeru ela sahayapadali?",
    askGame:   "Meeru emi game book cheskovaalaanukunnaaru? Maakaa Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, mariyu Badminton undayi.",
    askDate:   (g) => `${g} chaalaa manchii entika! Meeru epp book cheskovaalaanukunnaaru? Raabooye 7 rojulakin slots undayi.`,
    askTime:   (d) => `${d} na meeru enni gantalakin ravaalaanukunnaaru? Maamu udayam 8 nundi raatri 11 gantala varaku tericii undaamu.`,
    askGroup:  "Entha mandi aadataaru?",
    askName:   "Meeru peru cheppagalaara?",
    askPhone:  (n) => `Dhanyavaadaalu${n ? ", " + n.split(" ")[0] : ""}! Meeru 10 digits mobile number cheppagalaara?`,
    askPayment:"Meeru ela pay cheskovaalaanukunnaaru? Cash, Card, leда U P I?",
    confirm:   (s) => `Nenu confirm chestanu: ${s.game.name}, ${s.date} na ${s.time} ki, ${s.groupSize} mandiki. Peru ${s.name}. Payment ${s.payment}. Idi correct ga?`,
    confirmed: (s) => `Booking confirm ayyindi! Meeru Booking ID ${s.bookingId}. Arena Sports Hub lo meeru kosam eduruchustaamu! Goodbye!`,
    outOfHours:"Maafi cheskoundi, maamu udayam 8 nundi raatri 11 gantala varaku maatrame tericii untaamu. Aa samayamlo slot choose cheskoundi.",
    notHeard:  "Naaku artham kaaledu. Dayachesi malli cheppagalaara?",
    fallback:  "Nenu inkaa em sahayam cheseyagalanu?",
    faq: {
      price:     "Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, mariyu Badminton 400 rupayalu gantakin. Book cheskovaalaanukunnaara?",
      cancel:    "Booking ki 2 gantala mundu cancel chesite poorthi refund vastundi.",
      payment:   "Maamu Cash, Card, mariyu U P I anni accept chestamu.",
      parking:   "Avunu, 50 vaahanaalakin free parking undii.",
      equipment: "Anni equipment free ga ivvabadatayi. Meeru sontham gear kuda teesukoravachu.",
      hours:     "Maamu pratiroju udayam 8 nundi raatri 11 varaku tericii untaamu. 7 rojula mundu book cheskovachu.",
      manager:   "Dayachesi okka nimisham undandi, nenu meeru manager tho connect chestanu.",
    }
  }
};

// ─── Language Detection ───────────────────────────────────────────────────────

function detectLanguage(text) {
  const t = text.toLowerCase();
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  if (t.includes("telugu") || t.includes("telugu lo") || t.includes("telugu mein") || t.includes("telugulo")) return "te";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (t.includes("hindi") || t.includes("hindi mein") || t.includes("hindilo")) return "hi";
  if (t.includes("english") || t.includes("inglish")) return "en";
  return null;
}

// ─── NLP Helpers ─────────────────────────────────────────────────────────────

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
  if (t.includes("tomorrow") || t.includes("kal") || t.includes("repu") || t.includes("rapu")) {
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
  const plain = t.match(/\bat\s+(\d{1,2})\b|\b(\d{1,2})\s*baje\b|\b(\d{1,2})\s*gantala\b|\b(\d{1,2})\s*గంట/);
  if (plain) {
    let h = parseInt(plain[1] || plain[2] || plain[3] || plain[4]);
    if (h >= 1 && h <= 7) h += 12;
    if (h < 8 || h >= 23) return "OUT_OF_HOURS";
    return `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? "PM" : "AM"}`;
  }
  return null;
}

function detectNumber(text) {
  const words = {
    one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
    eleven:11, twelve:12, fifteen:15, twenty:20,
    ek:1, do:2, teen:3, char:4, paanch:5, chhe:6, saat:7, aath:8, nau:9, das:10,
    okati:1, rendu:2, moodu:3, nalugu:4, aidu:5, aaru:6, edu:7, enimidi:8, tommidi:9, padi:10
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
  if (t.includes("cash") || t.includes("nakit") || t.includes("nakadu")) return "Cash";
  return null;
}

function formatDate(d) {
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

function generateBookingId() {
  return "ARENA-" + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ─── Session Store ────────────────────────────────────────────────────────────

const sessions = {};
function getSession(sid) {
  if (!sessions[sid]) sessions[sid] = { step: "greeting", lang: "en" };
  return sessions[sid];
}
function clearSession(sid) { delete sessions[sid]; }

// ─── FAQ Detection ────────────────────────────────────────────────────────────

function detectFaq(text) {
  const t = text.toLowerCase();
  if (/price|rate|cost|how much|charges|fee|kitna|dhara|retu/.test(t))       return "price";
  if (/cancel|refund|raddu|radduchey/.test(t))                               return "cancel";
  if (/payment|pay|upi|cash|card|chellimpu/.test(t))                         return "payment";
  if (/park|parking/.test(t))                                                return "parking";
  if (/equipment|gear|bat|racket|bring|sadhanalu/.test(t))                   return "equipment";
  if (/hour|timing|open|close|when|samayam|samay|vellu/.test(t))             return "hours";
  if (/manager|owner|human|staff|speak|connect|transfer/.test(t))            return "manager";
  return null;
}

// ─── Conversation Logic ───────────────────────────────────────────────────────

function getNextStep(s) {
  if (!s.game)       return "ask_game";
  if (!s.date)       return "ask_date";
  if (!s.time)       return "ask_time";
  if (!s.groupSize)  return "ask_group";
  if (!s.name)       return "ask_name";
  if (!s.phone)      return "ask_phone";
  if (!s.payment)    return "ask_payment";
  if (!s.confirmed)  return "confirm";
  return "done";
}

function processInput(speech, state) {
  const text = speech || "";
  const s = { ...state };
  const sc = SCRIPTS[s.lang] || SCRIPTS.en;

  // Language switch
  const detectedLang = detectLanguage(text);
  if (detectedLang && detectedLang !== s.lang) {
    s.lang = detectedLang;
    return { reply: SCRIPTS[s.lang].greeting, state: s };
  }

  // FAQ
  const faqKey = detectFaq(text);
  if (faqKey) return { reply: sc.faq[faqKey] + " " + sc.fallback, state: s };

  // Extract info
  const game = detectGame(text);
  if (game && !s.game) s.game = game;

  const date = detectDate(text);
  if (date && !s.date) s.date = date;

  const time = detectTime(text);
  if (time === "OUT_OF_HOURS") return { reply: sc.outOfHours, state: s };
  if (time && !s.time) s.time = time;

  const num = detectNumber(text);
  if (num && !s.groupSize && s.game) s.groupSize = num;

  const pay = detectPayment(text);
  if (pay && !s.payment) s.payment = pay;

  if (s.step === "ask_name" && !s.name) {
    const cleaned = text.trim()
      .replace(/^(my name is|i am|i'm|mera naam|naa peru|nenu)\s+/i, "")
      .trim();
    if (cleaned.length > 1 && cleaned.length < 40 && !detectGame(text)) s.name = cleaned;
  }

  if (!s.phone) {
    const ph = text.replace(/\s/g, "").match(/(\+?91)?([6-9]\d{9})/);
    if (ph) s.phone = ph[2];
  }

  // Confirmation
  if (s.step === "confirm") {
    if (/\b(yes|confirm|correct|right|sure|ok|okay|haan|ha|avunu|sare|correct)\b/.test(text.toLowerCase())) {
      s.confirmed = true;
      s.bookingId = generateBookingId();
      s.step = "done";
      return { reply: sc.confirmed(s), state: s, done: true };
    } else if (/\b(no|wrong|change|nahi|kaadu|ledu)\b/.test(text.toLowerCase())) {
      const fresh = { step: "ask_game", lang: s.lang };
      return { reply: sc.askGame, state: fresh };
    }
  }

  // Next step
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

app.get("/", (req, res) => res.send("Aria Multilingual Call Assistant running! EN / HI / TE"));

app.post("/incoming", (req, res) => {
  const callSid = req.body.CallSid;
  const session = getSession(callSid);
  session.step = "greeting";
  session.lang = "en";

  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: "speech",
    action: "/respond",
    method: "POST",
    speechTimeout: "auto",
    language: "en-IN",
  });
  gather.say({ voice: "Polly.Aditi" }, SCRIPTS.en.greeting);
  twiml.redirect("/incoming");

  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/respond", (req, res) => {
  const callSid = req.body.CallSid;
  const speech  = req.body.SpeechResult || "";
  const session = getSession(callSid);

  console.log(`[${callSid}][${session.lang}] Caller: "${speech}"`);

  const { reply, state: newState, done } = processInput(speech, session);
  sessions[callSid] = newState;

  const sc = SCRIPTS[newState.lang] || SCRIPTS.en;
  console.log(`[${callSid}][${newState.lang}] Aria: "${reply}"`);

  const twiml = new VoiceResponse();

  if (done) {
    twiml.say({ voice: sc.voice }, reply);
    twiml.hangup();
    clearSession(callSid);
  } else {
    const gather = twiml.gather({
      input: "speech",
      action: "/respond",
      method: "POST",
      speechTimeout: "auto",
      language: sc.langCode,
    });
    gather.say({ voice: sc.voice }, reply);
    twiml.say({ voice: sc.voice }, sc.notHeard);
    twiml.redirect("/respond");
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Aria running on port ${PORT} — EN / HI / TE`));
