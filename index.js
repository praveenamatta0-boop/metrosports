const express = require("express");
const twilio = require("twilio");
const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Arena Config ─────────────────────────────────────────────────────────────

const GAMES = [
  { id: "pool",         name: "Pool Table",      nameHi: "पूल टेबल",       nameTe: "పూల్ టేబుల్",      rate: 300, rateStr: "300 rupees per hour" },
  { id: "cricket",      name: "Cricket Pitch",   nameHi: "क्रिकेट पिच",     nameTe: "క్రికెట్ పిచ్",     rate: 800, rateStr: "800 rupees per hour" },
  { id: "volleyball",   name: "Beach Volleyball", nameHi: "वॉलीबॉल",        nameTe: "వాలీబాల్",         rate: 500, rateStr: "500 rupees per hour" },
  { id: "table_tennis", name: "Table Tennis",    nameHi: "टेबल टेनिस",     nameTe: "టేబుల్ టెన్నిస్",   rate: 250, rateStr: "250 rupees per hour" },
  { id: "badminton",    name: "Badminton",        nameHi: "बैडमिंटन",       nameTe: "బ్యాడ్మింటన్",      rate: 400, rateStr: "400 rupees per hour" },
];

// ─── Multilingual Scripts ─────────────────────────────────────────────────────

const SCRIPTS = {
  en: {
    langCode: "en-IN",
    voice: "Polly.Aditi",
    greeting:
      "Hello! Thank you for calling Arena Sports Hub. I am Aria, your booking assistant. " +
      "I can speak in English, Hindi, or Telugu. " +
      "Just say your preferred language or continue in English. How can I help you today?",
    askGame:
      "Which game would you like to book? We have Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, and Badminton.",
    askDate:   (game) => `${game} is a great choice! What date would you like to book? We have slots for the next 7 days.`,
    askTime:   (date) => `What time would you like on ${date}? We are open from 8 AM to 11 PM.`,
    askGroup:  "How many people will be playing?",
    askName:   "May I have your name please?",
    askPhone:  (name) => `Thank you${name ? ", " + name.split(" ")[0] : ""}! Could I get your 10-digit phone number?`,
    askPayment:"How would you like to pay — Cash, Card, or U.P.I.?",
    confirm:   (s) => `Let me confirm: ${s.game.name}, on ${s.date} at ${s.time}, for ${s.groupSize} people. Name: ${s.name}. Payment: ${s.payment}. Is that correct?`,
    confirmed: (s) => `Booking confirmed! Your ID is ${s.bookingId}. ${s.game.name} on ${s.date} at ${s.time} for ${s.groupSize} people. See you at Arena Sports Hub! Goodbye!`,
    outOfHours:"Sorry, we are open between 8 AM and 11 PM only. Please choose a time within those hours.",
    notHeard:  "I did not catch that. Could you please repeat?",
    fallback:  "Is there anything else I can help you with?",
    faq: {
      price:    `Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, and Badminton 400 — all in rupees per hour. Would you like to book?`,
      cancel:   "You can cancel up to 2 hours before your slot for a full refund. Shall I help?",
      payment:  "We accept Cash, Card, and U.P.I.",
      parking:  "Yes, free parking for up to 50 vehicles.",
      equipment:"All equipment is provided free. You may bring your own gear too.",
      hours:    "We are open every day from 8 AM to 11 PM. Bookings up to 7 days in advance.",
      manager:  "Please hold while I connect you to our manager.",
    }
  },

  hi: {
    langCode: "hi-IN",
    voice: "Polly.Aditi",   // Aditi supports Hindi
    greeting:
      "नमस्ते! Arena Sports Hub में आपका स्वागत है। मैं Aria हूँ, आपकी बुकिंग असिस्टेंट। " +
      "मैं हिंदी, English, या Telugu में बात कर सकती हूँ। आज मैं आपकी कैसे मदद कर सकती हूँ?",
    askGame:
      "आप कौन सा गेम बुक करना चाहते हैं? हमारे पास Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, और Badminton उपलब्ध हैं।",
    askDate:   (game) => `${game} बढ़िया चुनाव है! आप किस तारीख को बुक करना चाहते हैं? अगले 7 दिनों तक बुकिंग उपलब्ध है।`,
    askTime:   (date) => `${date} को आप कितने बजे खेलना चाहते हैं? हम सुबह 8 बजे से रात 11 बजे तक खुले हैं।`,
    askGroup:  "कितने लोग खेलेंगे?",
    askName:   "क्या आप अपना नाम बता सकते हैं?",
    askPhone:  (name) => `धन्यवाद${name ? ", " + name.split(" ")[0] : ""}! कृपया अपना 10 अंकों का मोबाइल नंबर बताएं।`,
    askPayment:"आप किस तरह से भुगतान करेंगे — Cash, Card, या UPI?",
    confirm:   (s) => `मैं आपकी बुकिंग confirm करती हूँ: ${s.game.nameHi}, ${s.date} को ${s.time} बजे, ${s.groupSize} लोगों के लिए। नाम: ${s.name}। भुगतान: ${s.payment}। क्या यह सही है?`,
    confirmed: (s) => `बुकिंग confirmed हो गई! आपका Booking ID है ${s.bookingId}। Arena Sports Hub में आपका स्वागत है! अलविदा!`,
    outOfHours:"माफ़ कीजिए, हम सुबह 8 बजे से रात 11 बजे तक ही खुले हैं। कृपया उस समय के बीच कोई slot चुनें।",
    notHeard:  "मैं समझ नहीं पाई। क्या आप दोबारा बता सकते हैं?",
    fallback:  "क्या मैं और कुछ मदद कर सकती हूँ?",
    faq: {
      price:    "Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, और Badminton 400 रुपये प्रति घंटा। क्या आप बुकिंग करना चाहेंगे?",
      cancel:   "Booking से 2 घंटे पहले cancel करने पर पूरा refund मिलेगा।",
      payment:  "हम Cash, Card, और UPI तीनों accept करते हैं।",
      parking:  "हाँ, 50 गाड़ियों के लिए free parking उपलब्ध है।",
      equipment:"सभी equipment free में उपलब्ध है। आप अपना gear भी ला सकते हैं।",
      hours:    "हम हर दिन सुबह 8 बजे से रात 11 बजे तक खुले हैं। 7 दिन पहले तक बुकिंग की जा सकती है।",
      manager:  "कृपया रुकिए, मैं आपको हमारे manager से connect करती हूँ।",
    }
  },

  te: {
    langCode: "te-IN",
    voice: "Polly.Aditi",   // Aditi does transliterated Telugu; for native TTS use Google/Azure
    greeting:
      "నమస్కారం! Arena Sports Hub కి స్వాగతం. నేను Aria, మీ booking assistant. " +
      "నేను Telugu, Hindi, లేదా English లో మాట్లాడగలను. మీకు ఎలా సహాయం చేయాలి?",
    askGame:
      "మీరు ఏ game book చేయాలనుకుంటున్నారు? మాకు Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, మరియు Badminton అందుబాటులో ఉన్నాయి.",
    askDate:   (game) => `${game} చాలా మంచి ఎంపిక! మీరు ఏ తేదీన book చేయాలనుకుంటున్నారు? రాబోయే 7 రోజులకు slots అందుబాటులో ఉన్నాయి.`,
    askTime:   (date) => `${date} న మీకు ఏ సమయం అనుకూలంగా ఉంటుంది? మేము ఉదయం 8 గంటల నుండి రాత్రి 11 గంటల వరకు తెరిచి ఉంటాం.`,
    askGroup:  "ఎంత మంది ఆడతారు?",
    askName:   "మీ పేరు చెప్పగలరా?",
    askPhone:  (name) => `ధన్యవాదాలు${name ? ", " + name.split(" ")[0] : ""}! మీ 10 అంకెల mobile number చెప్పగలరా?`,
    askPayment:"మీరు ఎలా చెల్లించాలనుకుంటున్నారు — Cash, Card, లేదా UPI?",
    confirm:   (s) => `నేను confirm చేస్తాను: ${s.game.nameTe}, ${s.date} న ${s.time} కి, ${s.groupSize} మంది కోసం. పేరు: ${s.name}. చెల్లింపు: ${s.payment}. సరైనదా?`,
    confirmed: (s) => `Booking confirm అయింది! మీ Booking ID ${s.bookingId}. Arena Sports Hub లో మిమ్మల్ని కలవడానికి ఎదురుచూస్తున్నాం! వీడ్కోలు!`,
    outOfHours:"క్షమించండి, మేము ఉదయం 8 నుండి రాత్రి 11 గంటల వరకు మాత్రమే తెరిచి ఉంటాం. ఆ సమయంలో ఒక slot ఎంచుకోండి.",
    notHeard:  "నాకు అర్థం కాలేదు. దయచేసి మళ్ళీ చెప్పగలరా?",
    fallback:  "నేను మరింత సహాయం చేయగలనా?",
    faq: {
      price:    "Pool Table 300, Cricket Pitch 800, Beach Volleyball 500, Table Tennis 250, మరియు Badminton 400 రూపాయలు గంటకు. Book చేయాలా?",
      cancel:   "Booking కి 2 గంటల ముందు cancel చేస్తే పూర్తి refund వస్తుంది.",
      payment:  "మేము Cash, Card, మరియు UPI అంగీకరిస్తాం.",
      parking:  "అవును, 50 వాహనాలకు free parking అందుబాటులో ఉంది.",
      equipment:"అన్ని equipment ఉచితంగా అందిస్తాం. మీ gear కూడా తీసుకురావచ్చు.",
      hours:    "మేము ప్రతిరోజూ ఉదయం 8 నుండి రాత్రి 11 వరకు తెరిచి ఉంటాం. 7 రోజుల ముందుగా book చేయవచ్చు.",
      manager:  "దయచేసి ఒక్క నిమిషం ఉండండి, నేను మీకు మా manager తో connect చేస్తాను.",
    }
  }
};

// ─── Language Detection ───────────────────────────────────────────────────────

function detectLanguage(text) {
  const t = text.toLowerCase();
  // Telugu script or keywords
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  if (t.includes("telugu") || t.includes("తెలుగు") || t.includes("mee peru") || t.includes("namaskaaram")) return "te";
  // Hindi script or keywords
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (t.includes("hindi") || t.includes("हिंदी") || t.includes("namaste") || t.includes("baat karo") || t.includes("hindi mein")) return "hi";
  // English
  if (t.includes("english")) return "en";
  return null;
}

// ─── NLP Helpers ─────────────────────────────────────────────────────────────

function detectGame(text) {
  const t = text.toLowerCase();
  if (t.includes("pool") || t.includes("billiard") || t.includes("snooker") || t.includes("पूल") || t.includes("పూల్")) return GAMES[0];
  if (t.includes("cricket") || t.includes("क्रिकेट") || t.includes("క్రికెట్"))                                          return GAMES[1];
  if (t.includes("volleyball") || t.includes("volley") || t.includes("वॉली") || t.includes("వాలీ"))                      return GAMES[2];
  if (t.includes("table tennis") || t.includes("ping") || t.includes("टेबल") || t.includes("టేబుల్"))                    return GAMES[3];
  if (t.includes("badminton") || t.includes("shuttle") || t.includes("बैडमिंटन") || t.includes("బ్యాడ్"))               return GAMES[4];
  return null;
}

function detectDate(text) {
  const t = text.toLowerCase();
  const today = new Date();
  if (t.includes("today") || t.includes("aaj") || t.includes("ఇవాళ") || t.includes("నేడు")) return formatDate(today);
  if (t.includes("tomorrow") || t.includes("kal") || t.includes("రేపు") || t.includes("कल")) {
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
  const plain = t.match(/\bat\s+(\d{1,2})\b|\b(\d{1,2})\s*baje\b|\b(\d{1,2})\s*గంట/);
  if (plain) {
    let h = parseInt(plain[1] || plain[2] || plain[3]);
    if (h >= 1 && h <= 7) h += 12;
    if (h < 8 || h >= 23) return "OUT_OF_HOURS";
    return `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? "PM" : "AM"}`;
  }
  return null;
}

function detectNumber(text) {
  const words = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
                  eleven:11,twelve:12,fifteen:15,twenty:20,
                  ek:1,do:2,teen:3,char:4,paanch:5,chhe:6,saat:7,aath:8,nau:9,das:10,
                  okati:1,rendu:2,moodu:3,nalugu:4,aidu:5 };
  const t = text.toLowerCase();
  for (const [w,n] of Object.entries(words)) { if (t.includes(w)) return n; }
  const m = text.match(/\b(\d+)\b/);
  return m ? parseInt(m[1]) : null;
}

function detectPayment(text) {
  const t = text.toLowerCase();
  if (t.includes("upi") || t.includes("gpay") || t.includes("phonepe") || t.includes("paytm")) return "UPI";
  if (t.includes("card") || t.includes("credit") || t.includes("debit")) return "Card";
  if (t.includes("cash") || t.includes("nakit") || t.includes("నగదు")) return "Cash";
  return null;
}

function formatDate(d) {
  return d.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long" });
}

function generateBookingId() {
  return "ARENA-" + Math.random().toString(36).substr(2,6).toUpperCase();
}

// ─── Session Store ────────────────────────────────────────────────────────────

const sessions = {};

function getSession(callSid) {
  if (!sessions[callSid]) sessions[callSid] = { step:"greeting", lang:"en" };
  return sessions[callSid];
}

function clearSession(callSid) { delete sessions[callSid]; }

// ─── FAQ Detection ────────────────────────────────────────────────────────────

function detectFaq(text) {
  const t = text.toLowerCase();
  if (/price|rate|cost|how much|charges|fee|kitna|किराया|ధర|రేటు/.test(t))          return "price";
  if (/cancel|refund|రద్దు|रद्द/.test(t))                                           return "cancel";
  if (/payment|pay|upi|cash|card|payment|చెల్లింపు|भुगतान/.test(t))                 return "payment";
  if (/park|parking|పార్కింగ్|पार्किंग/.test(t))                                    return "parking";
  if (/equipment|gear|bat|racket|bring|సాధనాలు|उपकरण/.test(t))                      return "equipment";
  if (/hour|timing|open|close|when|time|సమయం|समय|baje/.test(t))                     return "hours";
  if (/manager|owner|human|staff|speak|connect|మేనేజర్|मैनेजर/.test(t))             return "manager";
  return null;
}

// ─── Core Conversation Logic ──────────────────────────────────────────────────

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

function processInput(speechResult, state) {
  const text = speechResult || "";
  const s = { ...state };
  const sc = SCRIPTS[s.lang] || SCRIPTS.en;

  // Language switch detection
  const detectedLang = detectLanguage(text);
  if (detectedLang && detectedLang !== s.lang) {
    s.lang = detectedLang;
    const newSc = SCRIPTS[s.lang];
    return { reply: newSc.greeting, state: s };
  }

  // FAQ check
  const faqKey = detectFaq(text);
  if (faqKey) {
    return { reply: sc.faq[faqKey] + " " + sc.fallback, state: s };
  }

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
    const cleaned = text.trim().replace(/^(my name is|i am|i'm|mera naam|నా పేరు|मेरा नाम)\s+/i,"").trim();
    if (cleaned.length > 1 && cleaned.length < 40 && !detectGame(text)) s.name = cleaned;
  }

  if (!s.phone) {
    const ph = text.replace(/\s/g,"").match(/(\+?91)?([6-9]\d{9})/);
    if (ph) s.phone = ph[2];
  }

  // Confirmation
  if (s.step === "confirm") {
    if (/\b(yes|confirm|correct|right|sure|ok|okay|haan|ha|అవును|సరే|हाँ)\b/.test(text.toLowerCase())) {
      s.confirmed = true;
      s.bookingId = generateBookingId();
      s.step = "done";
      return { reply: sc.confirmed(s), state: s, done: true };
    } else if (/\b(no|wrong|change|nahi|కాదు|నో|नहीं)\b/.test(text.toLowerCase())) {
      const fresh = { step:"ask_game", lang: s.lang };
      return { reply: sc.askGame, state: fresh };
    }
  }

  // Next step
  const next = getNextStep(s);
  s.step = next;

  switch (next) {
    case "ask_game":    return { reply: sc.askGame, state: s };
    case "ask_date":    return { reply: sc.askDate(s.game[s.lang === "hi" ? "nameHi" : s.lang === "te" ? "nameTe" : "name"]), state: s };
    case "ask_time":    return { reply: sc.askTime(s.date), state: s };
    case "ask_group":   return { reply: sc.askGroup, state: s };
    case "ask_name":    return { reply: sc.askName, state: s };
    case "ask_phone":   return { reply: sc.askPhone(s.name), state: s };
    case "ask_payment": return { reply: sc.askPayment, state: s };
    case "confirm":     return { reply: sc.confirm(s), state: s };
    default:            return { reply: sc.fallback, state: s };
  }
}

// ─── Twilio Routes ────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Aria Multilingual Call Assistant ✅ (EN / HI / TE)"));

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
    language: "en-IN",         // Start in English; switches based on caller's response
  });

  gather.say(
    { voice: "Polly.Aditi" },
    SCRIPTS.en.greeting
  );

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
      language: sc.langCode,   // Switch Twilio's STT language dynamically
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
