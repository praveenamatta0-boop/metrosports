const express = require("express");
const twilio = require("twilio");
const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Arena Config ────────────────────────────────────────────────────────────

const GAMES = [
  { id: "pool",        name: "Pool Table",       rate: "300 rupees per hour",  slots: 4 },
  { id: "cricket",     name: "Cricket Pitch",     rate: "800 rupees per hour",  slots: 2 },
  { id: "volleyball",  name: "Beach Volleyball",  rate: "500 rupees per hour",  slots: 2 },
  { id: "table_tennis",name: "Table Tennis",      rate: "250 rupees per hour",  slots: 3 },
  { id: "badminton",   name: "Badminton",         rate: "400 rupees per hour",  slots: 2 },
];

const FAQS = [
  {
    keys: ["price", "rate", "cost", "how much", "charges", "fee"],
    answer: "Our rates are: Pool Table 300 rupees per hour, Cricket Pitch 800 rupees per hour, Beach Volleyball 500 rupees per hour, Table Tennis 250 rupees per hour, and Badminton 400 rupees per hour. Would you like to make a booking?"
  },
  {
    keys: ["cancel", "refund"],
    answer: "You can cancel your booking up to 2 hours before your slot for a full refund. Shall I help you with a cancellation?"
  },
  {
    keys: ["payment", "pay", "upi", "cash", "card"],
    answer: "We accept Cash, Card, and U.P.I. — whichever is convenient for you!"
  },
  {
    keys: ["park", "parking"],
    answer: "Yes, we have free parking available for up to 50 vehicles."
  },
  {
    keys: ["equipment", "gear", "bat", "racket", "bring"],
    answer: "All basic equipment is provided free of charge. You are also welcome to bring your own gear."
  },
  {
    keys: ["hour", "timing", "open", "close", "when"],
    answer: "We are open every day from 8 AM to 11 PM. You can book up to 7 days in advance."
  },
  {
    keys: ["manager", "owner", "human", "staff", "speak to someone", "transfer"],
    answer: "Of course! Please hold while I connect you to our manager."
    // You can add Twilio <Dial> here later to actually transfer the call
  },
];

// ─── In-memory session store ─────────────────────────────────────────────────
// Each caller's phone number maps to their booking state
const sessions = {};

function getSession(callSid) {
  if (!sessions[callSid]) {
    sessions[callSid] = { step: "greeting" };
  }
  return sessions[callSid];
}

function clearSession(callSid) {
  delete sessions[callSid];
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
  if (t.includes("today"))    return formatDate(today);
  if (t.includes("tomorrow")) { const d = new Date(); d.setDate(d.getDate() + 1); return formatDate(d); }
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
  // 24h format
  const h24 = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (h24) {
    const h = parseInt(h24[1]);
    if (h < 8 || h >= 23) return "OUT_OF_HOURS";
    return `${h > 12 ? h - 12 : h}:${h24[2]} ${h >= 12 ? "PM" : "AM"}`;
  }
  // Plain hour — "at 5", "at 10"
  const plain = t.match(/\bat\s+(\d{1,2})\b/);
  if (plain) {
    let h = parseInt(plain[1]);
    // Assume PM for 1–7 if ambiguous, AM for 8–11
    if (h >= 1 && h <= 7) h += 12;
    if (h < 8 || h >= 23) return "OUT_OF_HOURS";
    return `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? "PM" : "AM"}`;
  }
  return null;
}

function detectNumber(text) {
  // Word numbers
  const words = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
                  eleven:11, twelve:12, fifteen:15, twenty:20, thirty:30 };
  const t = text.toLowerCase();
  for (const [w, n] of Object.entries(words)) {
    if (t.includes(w)) return n;
  }
  const m = text.match(/\b(\d+)\b/);
  return m ? parseInt(m[1]) : null;
}

function detectPayment(text) {
  const t = text.toLowerCase();
  if (t.includes("upi") || t.includes("gpay") || t.includes("phonepe") || t.includes("paytm")) return "UPI";
  if (t.includes("card") || t.includes("credit") || t.includes("debit")) return "Card";
  if (t.includes("cash")) return "Cash";
  return null;
}

function formatDate(d) {
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

function generateBookingId() {
  return "ARENA-" + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ─── Aria Conversation Logic ─────────────────────────────────────────────────

function getNextStep(state) {
  if (!state.game)     return "ask_game";
  if (!state.date)     return "ask_date";
  if (!state.time)     return "ask_time";
  if (!state.groupSize)return "ask_group";
  if (!state.name)     return "ask_name";
  if (!state.phone)    return "ask_phone";
  if (!state.payment)  return "ask_payment";
  if (!state.confirmed)return "confirm";
  return "done";
}

function processInput(speechResult, state) {
  const text = speechResult || "";
  const t = text.toLowerCase();
  const s = { ...state };

  // Check FAQs
  for (const faq of FAQS) {
    if (faq.keys.some(k => t.includes(k))) {
      return { reply: faq.answer + " Is there anything else I can help you with?", state: s, isFaq: true };
    }
  }

  // Extract info from speech
  const game = detectGame(t);
  if (game && !s.game) s.game = game;

  const date = detectDate(t);
  if (date && !s.date) s.date = date;

  const time = detectTime(t);
  if (time === "OUT_OF_HOURS") {
    return { reply: "Sorry, we are only open between 8 AM and 11 PM. Could you please choose a time within those hours?", state: s };
  }
  if (time && !s.time) s.time = time;

  const num = detectNumber(t);
  if (num && !s.groupSize && s.game) s.groupSize = num;

  const pay = detectPayment(t);
  if (pay && !s.payment) s.payment = pay;

  // Name — only when we're waiting for it
  if (s.step === "ask_name" && !s.name) {
    const cleaned = text.trim()
      .replace(/^(my name is|i am|i'm|call me|this is)\s+/i, "")
      .trim();
    if (cleaned.length > 1 && cleaned.length < 40) s.name = cleaned;
  }

  // Phone number
  if (!s.phone) {
    const phoneMatch = t.replace(/\s/g, "").match(/(\+?91)?([6-9]\d{9})/);
    if (phoneMatch) s.phone = phoneMatch[2];
  }

  // Confirmation step
  if (s.step === "confirm") {
    if (/\b(yes|confirm|correct|right|sure|ok|okay|go ahead|proceed)\b/.test(t)) {
      s.confirmed = true;
      s.bookingId = generateBookingId();
      s.step = "done";
      const reply =
        `Your booking is confirmed! Your booking ID is ${s.bookingId.split("").join(" ")}. ` +
        `To summarise: ${s.game.name} on ${s.date} at ${s.time}, for ${s.groupSize} people. ` +
        `Name: ${s.name}. Payment: ${s.payment}. ` +
        `We look forward to seeing you at Arena Sports Hub! Have a great game. Goodbye!`;
      return { reply, state: s, done: true };
    } else if (/\b(no|wrong|change|edit|restart)\b/.test(t)) {
      const fresh = { step: "ask_game" };
      return { reply: "No problem! Let's start over. Which game would you like to book — Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, or Badminton?", state: fresh };
    }
  }

  // Next question
  const next = getNextStep(s);
  s.step = next;

  switch (next) {
    case "ask_game":
      return { reply: "Which game would you like to book? We have Pool Table, Cricket Pitch, Beach Volleyball, Table Tennis, and Badminton available.", state: s };
    case "ask_date":
      return { reply: `${s.game.name} is a great choice! What date would you like to book? We have slots available for the next 7 days.`, state: s };
    case "ask_time":
      return { reply: `What time would you like on ${s.date}? We are open from 8 AM to 11 PM.`, state: s };
    case "ask_group":
      return { reply: "How many people will be playing?", state: s };
    case "ask_name":
      return { reply: "May I have your name please?", state: s };
    case "ask_phone":
      return { reply: `Thank you${s.name ? ", " + s.name.split(" ")[0] : ""}! Could I get your phone number for the booking?`, state: s };
    case "ask_payment":
      return { reply: "How would you like to pay — Cash, Card, or U.P.I.?", state: s };
    case "confirm":
      return {
        reply: `Let me confirm your booking. ${s.game.name} on ${s.date} at ${s.time}, for ${s.groupSize} people. Name: ${s.name}. Phone: ${s.phone}. Payment: ${s.payment}. Is that correct?`,
        state: s
      };
    default:
      return { reply: "Is there anything else I can help you with?", state: s };
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => res.send("Aria Call Assistant is running ✅"));

// Twilio calls this when a call comes in
app.post("/incoming", (req, res) => {
  const callSid = req.body.CallSid;
  const session = getSession(callSid);
  session.step = "greeting";

  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: "speech",
    action: "/respond",
    method: "POST",
    speechTimeout: "auto",
    language: "en-IN",        // Indian English — change to en-US if needed
  });

  gather.say(
    { voice: "Polly.Aditi" }, // Indian English voice — change to alice for US
    "Hello! Thank you for calling Arena Sports Hub. " +
    "I am Aria, your booking assistant. " +
    "I can help you book a slot, answer questions about our games and pricing, or connect you to our team. " +
    "How can I help you today?"
  );

  // If caller says nothing
  twiml.redirect("/incoming");

  res.type("text/xml");
  res.send(twiml.toString());
});

// Twilio calls this after every caller response
app.post("/respond", (req, res) => {
  const callSid   = req.body.CallSid;
  const speech    = req.body.SpeechResult || "";
  const session   = getSession(callSid);

  console.log(`[${callSid}] Caller said: "${speech}"`);

  const { reply, state: newState, done } = processInput(speech, session);
  sessions[callSid] = newState;

  console.log(`[${callSid}] Aria replies: "${reply}"`);

  const twiml = new VoiceResponse();

  if (done) {
    // Booking confirmed — say goodbye and hang up
    twiml.say({ voice: "Polly.Aditi" }, reply);
    twiml.hangup();
    clearSession(callSid);
  } else {
    const gather = twiml.gather({
      input: "speech",
      action: "/respond",
      method: "POST",
      speechTimeout: "auto",
      language: "en-IN",
    });
    gather.say({ voice: "Polly.Aditi" }, reply);

    // No response fallback
    twiml.say({ voice: "Polly.Aditi" }, "I did not catch that. Could you please repeat?");
    twiml.redirect("/respond");
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Aria backend running on port ${PORT}`));
