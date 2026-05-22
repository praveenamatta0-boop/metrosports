# Aria Call Assistant — Backend

Voice call assistant for Arena Sports Hub, built with Node.js + Twilio + Express.

---

## Setup Guide

### Step 1 — Install dependencies locally
```bash
npm install
npm run dev   # starts with nodemon for hot reload
```

### Step 2 — Deploy to Render

1. Push this folder to a GitHub repository
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects the `render.yaml` — click **Deploy**
5. Copy your Render URL, e.g. `https://aria-call-assistant.onrender.com`

### Step 3 — Set up Twilio

1. Sign up at https://twilio.com
2. Go to **Phone Numbers** → Buy a Number
   - Search for an Indian virtual number (+91) or any number you prefer
3. Click your number → **Configure**
4. Under **Voice & Fax → A Call Comes In**, set:
   - **Webhook**: `https://your-render-url.onrender.com/incoming`
   - **Method**: HTTP POST
5. Save.

### Step 4 — Test it

Call your Twilio number. Aria will answer and guide callers through booking.

---

## Project Structure

```
aria-backend/
├── index.js        # Main server — all conversation logic lives here
├── package.json
├── render.yaml     # Render deployment config
└── README.md
```

---

## Customising Aria

### Change the voice
In `index.js`, find `voice: "Polly.Aditi"` — this is an Indian English female voice.
Other options:
- `"Polly.Raveena"` — another Indian English voice
- `"alice"` — Twilio's default US English
- `"Polly.Joanna"` — US English female (Amazon Polly)

### Change the language
Find `language: "en-IN"` and change to:
- `"en-US"` for American English
- `"hi-IN"` for Hindi speech recognition

### Add more games
In `index.js`, edit the `GAMES` array at the top.

### Add more FAQ answers
Edit the `FAQS` array — add keys (words to detect) and an answer.

### Transfer calls to a real number
In the FAQS array, find the manager/escalation entry and replace the reply with a Twilio `<Dial>` response:
```js
const twiml = new VoiceResponse();
twiml.dial("+91XXXXXXXXXX");  // your manager's number
```

---

## Switching to Exotel (India)

If you later switch to Exotel:
1. The logic in `index.js` stays identical
2. Only change the routes — Exotel sends `POST` with `Body` instead of `SpeechResult`
3. Exotel uses their own TTS format instead of TwiML
See: https://developer.exotel.com/api/

---

## Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Health check |
| `/incoming` | POST | Twilio calls this when a new call arrives |
| `/respond` | POST | Twilio calls this after every caller response |
