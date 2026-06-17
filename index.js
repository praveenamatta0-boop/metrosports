// ─────────────────────────────────────────────────────────────────────────────
//  Nagole Sports Lounge — Aria Call Assistant + Admin Dashboard
//  Single file: index.js
//  Deploy on Render. Set env vars: ADMIN_PASS, JWT_SECRET
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const twilio  = require("twilio");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const cors    = require("cors");
const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────────
const ARENA      = "Nagole Sports Lounge";
const JWT_SECRET = process.env.JWT_SECRET  || "nsl-change-me";
const ADMIN_USER = process.env.ADMIN_USER  || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS  || "nsl@1234";
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASS, 10);

// ── Static data ───────────────────────────────────────────────────────────────
const GAMES = [
  { id:"pool",         name:"Pool Table",       rate:300, max:4 },
  { id:"cricket",      name:"Cricket Pitch",    rate:800, max:2 },
  { id:"volleyball",   name:"Beach Volleyball", rate:500, max:2 },
  { id:"table_tennis", name:"Table Tennis",     rate:250, max:3 },
  { id:"badminton",    name:"Badminton",        rate:400, max:2 },
];

const TIME_SLOTS = [
  "8 AM","9 AM","10 AM","11 AM","12 PM",
  "1 PM","2 PM","3 PM","4 PM","5 PM",
  "6 PM","7 PM","8 PM","9 PM","10 PM",
];

const GROUP_LABELS = {
  en:["1-2 people","3-5 people","6-10 people","11-20 people","20+ people"],
  hi:["1-2 log","3-5 log","6-10 log","11-20 log","20+ log"],
  te:["1-2 mandi","3-5 mandi","6-10 mandi","11-20 mandi","20+ mandi"],
};

// ── Booking store (in-memory — replace with DB for production) ────────────────
const bookings = [];

function getDates() {
  return Array.from({length:7}, (_,i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      key:   d.toISOString().split("T")[0],
      label: d.toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"}),
    };
  });
}

function bookedCount(gameId, dateKey, slot) {
  return bookings.filter(b=>b.gameId===gameId&&b.dateKey===dateKey&&b.timeSlot===slot&&b.status==="confirmed").length;
}

function availSlots(gameId, dateKey) {
  const game = GAMES.find(g=>g.id===gameId);
  return TIME_SLOTS.filter(ts => bookedCount(gameId,dateKey,ts) < game.max);
}

function genId() { return "NSL-"+Math.random().toString(36).substr(2,6).toUpperCase(); }

// ── Multilingual scripts (all Roman so Polly.Aditi speaks clearly) ────────────
const L = {
  en:{
    code:"en-IN", voice:"Polly.Aditi",
    welcome:  `Welcome to ${ARENA}. Press 1 or say English. Press 2 or say Hindi. Press 3 or say Telugu.`,
    game:     "Which game? Press 1 Pool Table. Press 2 Cricket Pitch. Press 3 Beach Volleyball. Press 4 Table Tennis. Press 5 Badminton.",
    date:     d=>"Which date? "+d.map((x,i)=>`Press ${i+1} for ${x.label}.`).join(" "),
    time:     s=>"Available times. "+s.map((x,i)=>`Press ${i+1} or say ${x}.`).join(" "),
    noSlots:  "No slots for that date. Press 1 for another date. Press 2 for another game.",
    group:    "How many people? Press 1 for 1 to 2. Press 2 for 3 to 5. Press 3 for 6 to 10. Press 4 for 11 to 20. Press 5 for more than 20.",
    name:     "Please say your name.",
    phone:    "Please say or press your 10 digit mobile number.",
    pay:      "Payment? Press 1 or say Cash. Press 2 or say Card. Press 3 or say UPI.",
    confirm:  s=>`Confirm: ${s.game.name}, ${s.date}, ${s.timeSlot}, ${s.group}, name ${s.name}, ${s.pay}. Press 1 to confirm or press 2 to restart.`,
    done:     s=>`Booking confirmed! ID is ${s.id}. ${s.game.name} on ${s.date} at ${s.timeSlot}. See you at ${ARENA}! Goodbye.`,
    restart:  "Let's start again. ",
    invalid:  "Invalid. Try again. ",
    noHear:   "Didn't catch that. ",
    bye:      `Thank you for calling ${ARENA}. Goodbye.`,
  },
  hi:{
    code:"hi-IN", voice:"Polly.Aditi",
    welcome:  null,
    game:     "Game chuniye. 1 Pool Table. 2 Cricket Pitch. 3 Beach Volleyball. 4 Table Tennis. 5 Badminton.",
    date:     d=>"Date chuniye. "+d.map((x,i)=>`${i+1} dabaye ${x.label} ke liye.`).join(" "),
    time:     s=>"Available times. "+s.map((x,i)=>`${i+1} dabaye ya boliye ${x}.`).join(" "),
    noSlots:  "Us date pe koi slot nahi. 1 dabaye doosri date. 2 dabaye doosra game.",
    group:    "Kitne log? 1 dabaye 1-2. 2 dabaye 3-5. 3 dabaye 6-10. 4 dabaye 11-20. 5 dabaye 20+.",
    name:     "Apna naam boliye.",
    phone:    "Apna 10 digit number boliye ya type kariye.",
    pay:      "Payment? 1 ya Cash boliye. 2 ya Card boliye. 3 ya UPI boliye.",
    confirm:  s=>`Confirm karein: ${s.game.name}, ${s.date}, ${s.timeSlot}, ${s.group}, naam ${s.name}, ${s.pay}. 1 dabaye confirm, 2 dabaye restart.`,
    done:     s=>`Booking ho gayi! ID hai ${s.id}. ${s.game.name}, ${s.date}, ${s.timeSlot}. ${ARENA} mein milenge! Alvida.`,
    restart:  "Phir se shuru. ",
    invalid:  "Galat. Dobara try. ",
    noHear:   "Sunai nahi diya. ",
    bye:      `${ARENA} mein call ke liye shukriya. Alvida.`,
  },
  te:{
    code:"te-IN", voice:"Polly.Aditi",
    welcome:  null,
    game:     "Game select cheskoundi. 1 Pool Table. 2 Cricket Pitch. 3 Beach Volleyball. 4 Table Tennis. 5 Badminton.",
    date:     d=>"Date select cheskoundi. "+d.map((x,i)=>`${i+1} press chesthe ${x.label}.`).join(" "),
    time:     s=>"Available times. "+s.map((x,i)=>`${i+1} press chesthe leда ${x} cheppandi.`).join(" "),
    noSlots:  "Aa date ki slots levu. 1 press chesthe vera date. 2 press chesthe vera game.",
    group:    "Entha mandi? 1 press chesthe 1-2. 2 press chesthe 3-5. 3 press chesthe 6-10. 4 press chesthe 11-20. 5 press chesthe 20+.",
    name:     "Mee peru cheppandi.",
    phone:    "Mee 10 digit number cheppandi leда type chesandi.",
    pay:      "Payment? 1 leда Cash cheppandi. 2 leда Card cheppandi. 3 leда UPI cheppandi.",
    confirm:  s=>`Confirm cheskoundi: ${s.game.name}, ${s.date}, ${s.timeSlot}, ${s.group}, peru ${s.name}, ${s.pay}. 1 press chesthe confirm, 2 press chesthe restart.`,
    done:     s=>`Booking confirm! ID ${s.id}. ${s.game.name}, ${s.date}, ${s.timeSlot}. ${ARENA} lo kaladudam! Goodbye.`,
    restart:  "Malli modalupetudaam. ",
    invalid:  "Tappu. Malli try cheskoundi. ",
    noHear:   "Artham kaaledu. ",
    bye:      `${ARENA} ki call chesinduku dhanyavaadaalu. Goodbye.`,
  },
};

// ── Session store ─────────────────────────────────────────────────────────────
const sessions = {};
function sess(sid) {
  if (!sessions[sid]) sessions[sid] = { step:"lang", lang:"en" };
  return sessions[sid];
}

// ── TwiML helpers ─────────────────────────────────────────────────────────────
// Every gather accepts BOTH dtmf and speech so caller can use either
function gather(twiml, lang, numDigits=1) {
  return twiml.gather({
    input:         "dtmf speech",
    action:        "/respond",
    method:        "POST",
    timeout:       12,
    numDigits:     numDigits,
    speechTimeout: 3,
    language:      L[lang].code,
  });
}

// For phone number — accept up to 10 digit keypress OR speech
function phoneGather(twiml, lang) {
  return twiml.gather({
    input:         "dtmf speech",
    action:        "/respond",
    method:        "POST",
    timeout:       15,
    numDigits:     10,
    speechTimeout: 4,
    language:      L[lang].code,
    finishOnKey:   "#",   // caller can press # to finish early
  });
}

// For free-speech fields (name, time)
function speechGather(twiml, lang) {
  return twiml.gather({
    input:         "speech dtmf",
    action:        "/respond",
    method:        "POST",
    speechTimeout: 3,
    timeout:       12,
    numDigits:     1,
    language:      L[lang].code,
  });
}

function send(res, twiml) {
  res.type("text/xml");
  res.send(twiml.toString());
}

// ── Time parsing from speech ──────────────────────────────────────────────────
function parseTime(text) {
  const t = text.toLowerCase();
  // "5 pm", "5pm", "17:00"
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (m) {
    let h = parseInt(m[1]);
    const ampm = m[3];
    if (ampm==="pm" && h!==12) h+=12;
    if (ampm==="am" && h===12) h=0;
    const label = h<12?`${h} AM`:h===12?"12 PM":`${h-12} PM`;
    return TIME_SLOTS.includes(label) ? label : null;
  }
  // plain "5 o'clock", "at 5"
  const p = t.match(/(?:at\s+)?(\d{1,2})\s*(?:o'clock|baje|gantala)?/);
  if (p) {
    let h = parseInt(p[1]);
    if (h>=1&&h<=7) h+=12;
    const label = h<12?`${h} AM`:h===12?"12 PM":`${h-12} PM`;
    return TIME_SLOTS.includes(label) ? label : null;
  }
  return null;
}

// ── Language detection from speech ───────────────────────────────────────────
function detectLang(text) {
  const t = text.toLowerCase();
  if (t.includes("english") || t.includes("inglish")) return "en";
  if (t.includes("hindi")   || t.includes("hind"))    return "hi";
  if (t.includes("telugu"))                            return "te";
  return null;
}

// ── Payment detection from speech ─────────────────────────────────────────────
function detectPay(text) {
  const t = text.toLowerCase();
  if (t.includes("upi")||t.includes("gpay")||t.includes("phonepe")||t.includes("paytm")) return "UPI";
  if (t.includes("card")||t.includes("credit")||t.includes("debit"))                      return "Card";
  if (t.includes("cash")||t.includes("nakadu"))                                           return "Cash";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  IVR Routes
// ─────────────────────────────────────────────────────────────────────────────

app.post("/incoming", (req,res) => {
  const sid = req.body.CallSid;
  sessions[sid] = { step:"lang", lang:"en" };
  const twiml = new VoiceResponse();
  const g = gather(twiml, "en");
  g.say({ voice:"Polly.Aditi" }, L.en.welcome);
  twiml.redirect("/incoming");
  send(res, twiml);
});

app.post("/respond", (req,res) => {
  const sid    = req.body.CallSid;
  const digits = (req.body.Digits||"").trim();
  const speech = (req.body.SpeechResult||"").trim();
  const s      = sess(sid);
  const lc     = L[s.lang];
  const v      = lc.voice;
  const twiml  = new VoiceResponse();

  // prefer digits, fall back to speech
  const pressed = digits || "";
  const said    = speech || "";
  const input   = pressed || said;

  console.log(`[${sid}][${s.lang}][${s.step}] pressed="${pressed}" said="${said}"`);

  // ── helpers ──
  function ask(prompt, gType="dtmf") {
    const g = gType==="phone"   ? phoneGather(twiml, s.lang)
            : gType==="speech"  ? speechGather(twiml, s.lang)
            : gather(twiml, s.lang);
    g.say({ voice:v }, prompt);
    sessions[sid] = s;
    send(res, twiml);
  }

  function retry(prompt, gType="dtmf") {
    const g = gType==="phone"   ? phoneGather(twiml, s.lang)
            : gType==="speech"  ? speechGather(twiml, s.lang)
            : gather(twiml, s.lang);
    g.say({ voice:v }, lc.invalid + prompt);
    sessions[sid] = s;
    send(res, twiml);
  }

  function end(msg) {
    twiml.say({ voice:v }, msg);
    twiml.hangup();
    delete sessions[sid];
    send(res, twiml);
  }

  // ── LANG SELECT ──────────────────────────────────────────────────────────
  if (s.step === "lang") {
    const map = {"1":"en","2":"hi","3":"te"};
    const chosen = map[pressed] || detectLang(said);
    if (!chosen) return retry(L.en.welcome);
    s.lang = chosen; s.step = "game";
    return ask(L[chosen].game);
  }

  // ── GAME ─────────────────────────────────────────────────────────────────
  if (s.step === "game") {
    const idx = parseInt(input) - 1;
    if (isNaN(idx)||idx<0||idx>4) return retry(lc.game);
    s.game = GAMES[idx]; s.step = "date";
    return ask(lc.date(getDates()));
  }

  // ── DATE ─────────────────────────────────────────────────────────────────
  if (s.step === "date") {
    const dates = getDates();
    const idx   = parseInt(input) - 1;
    if (isNaN(idx)||idx<0||idx>=dates.length) return retry(lc.date(dates));
    s.dateKey   = dates[idx].key;
    s.date      = dates[idx].label;
    const slots = availSlots(s.game.id, s.dateKey);
    if (slots.length === 0) { s.step = "noSlots"; return ask(lc.noSlots); }
    s.slots = slots; s.step = "time";
    return ask(lc.time(slots), "speech");  // TIME = speech or keypress
  }

  // ── NO SLOTS ─────────────────────────────────────────────────────────────
  if (s.step === "noSlots") {
    if (input==="1") { s.step="date"; return ask(lc.date(getDates())); }
    if (input==="2") { s.step="game"; return ask(lc.game); }
    return retry(lc.noSlots);
  }

  // ── TIME — speech OR keypress ─────────────────────────────────────────────
  if (s.step === "time") {
    const slots = s.slots || TIME_SLOTS;
    let chosen  = null;

    // Try keypress first
    const ki = parseInt(pressed) - 1;
    if (!isNaN(ki) && ki>=0 && ki<slots.length) chosen = slots[ki];

    // Then try speech
    if (!chosen && said) {
      const parsed = parseTime(said);
      if (parsed && slots.includes(parsed)) chosen = parsed;
      // also allow saying "1", "2" etc
      const si = parseInt(said) - 1;
      if (!chosen && !isNaN(si) && si>=0 && si<slots.length) chosen = slots[si];
    }

    if (!chosen) return retry(lc.time(slots), "speech");
    s.timeSlot = chosen; s.step = "group";
    return ask(lc.group);
  }

  // ── GROUP ─────────────────────────────────────────────────────────────────
  if (s.step === "group") {
    const idx = parseInt(input) - 1;
    if (isNaN(idx)||idx<0||idx>4) return retry(lc.group);
    s.group = GROUP_LABELS[s.lang][idx]; s.step = "name";
    return ask(lc.name, "speech");
  }

  // ── NAME — speech only ────────────────────────────────────────────────────
  if (s.step === "name") {
    const name = said.replace(/^(my name is|i am|i'm|mera naam|naa peru)\s+/i,"").trim();
    if (!name || name.length < 2) return ask(lc.noHear + lc.name, "speech");
    s.name = name; s.step = "phone";
    return ask(lc.phone, "phone");
  }

  // ── PHONE — keypress (up to 10 digits) OR speech ─────────────────────────
  if (s.step === "phone") {
    const raw = (pressed + said).replace(/[\s\-\(\)]/g,"");
    const ph  = raw.match(/(\+?91)?([6-9]\d{9})/);
    if (!ph) return ask(lc.noHear + lc.phone, "phone");
    s.phone = ph[2]; s.step = "pay";
    return ask(lc.pay);
  }

  // ── PAYMENT — keypress OR speech ─────────────────────────────────────────
  if (s.step === "pay") {
    const map = {"1":"Cash","2":"Card","3":"UPI"};
    const chosen = map[pressed] || detectPay(said);
    if (!chosen) return retry(lc.pay);
    s.pay = chosen; s.step = "confirm";
    return ask(lc.confirm(s));
  }

  // ── CONFIRM ───────────────────────────────────────────────────────────────
  if (s.step === "confirm") {
    const yes = pressed==="1" || /\b(yes|confirm|correct|ok|haan|avunu|sare)\b/.test(said.toLowerCase());
    const no  = pressed==="2" || /\b(no|wrong|restart|nahi|kaadu)\b/.test(said.toLowerCase());

    if (yes) {
      const b = {
        id:        genId(),
        gameId:    s.game.id,
        gameName:  s.game.name,
        gameRate:  s.game.rate,
        dateKey:   s.dateKey,
        date:      s.date,
        timeSlot:  s.timeSlot,
        group:     s.group,
        name:      s.name,
        phone:     s.phone,
        pay:       s.pay,
        lang:      s.lang,
        status:    "confirmed",
        createdAt: new Date().toISOString(),
      };
      bookings.push(b);
      s.id = b.id;
      return end(lc.done(s));
    }
    if (no) {
      sessions[sid] = { step:"game", lang:s.lang };
      const twiml2 = new VoiceResponse();
      const g = gather(twiml2, s.lang);
      g.say({ voice:v }, L[s.lang].restart + L[s.lang].game);
      return send(res, twiml2);
    }
    return retry(lc.confirm(s));
  }

  // Fallback
  end(lc.bye);
});

// ─────────────────────────────────────────────────────────────────────────────
//  REST API (for dashboard)
// ─────────────────────────────────────────────────────────────────────────────

function auth(req,res,next) {
  const h = req.headers.authorization;
  if (!h||!h.startsWith("Bearer ")) return res.status(401).json({error:"Unauthorized"});
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({error:"Token invalid"}); }
}

app.post("/api/login", (req,res) => {
  const {username,password} = req.body;
  if (username!==ADMIN_USER || !bcrypt.compareSync(password,ADMIN_HASH))
    return res.status(401).json({error:"Wrong credentials"});
  res.json({ token: jwt.sign({username}, JWT_SECRET, {expiresIn:"12h"}) });
});

app.get("/api/bookings", auth, (req,res) => {
  res.json([...bookings].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
});

app.patch("/api/bookings/:id/cancel", auth, (req,res) => {
  const b = bookings.find(x=>x.id===req.params.id);
  if (!b) return res.status(404).json({error:"Not found"});
  b.status = "cancelled";
  res.json(b);
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
  const grid  = [];
  for (const game of GAMES)
    for (const date of dates)
      for (const slot of TIME_SLOTS) {
        const booked = bookedCount(game.id, date.key, slot);
        grid.push({ gameId:game.id, gameName:game.name, gameMax:game.max,
                    dateKey:date.key, dateLabel:date.label, timeSlot:slot,
                    booked, available:game.max-booked });
      }
  res.json({ games:GAMES, dates, timeSlots:TIME_SLOTS, grid });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Dashboard (served as HTML at /dashboard)
// ─────────────────────────────────────────────────────────────────────────────


app.get('/dashboard', (req,res) => {
  res.sendFile(__dirname + '/dashboard.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(ARENA + ' — Aria on port ' + PORT + '\nDashboard: http://localhost:' + PORT + '/dashboard'));
