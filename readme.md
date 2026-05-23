# PictoPRO — AI Explanation Video Generator

> Developed by **Mohammed Irfan A** — Full Stack AI Developer

PictoPRO is a fully local, free, AI-powered educational platform that converts
any question, math problem, image of a textbook, or topic into a complete
step-by-step explanation video with voiceover and visual slides.

No API keys. No internet dependency. No usage limits. Runs 100% on your machine.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Data Flow](#data-flow)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Installation Guide](#installation-guide)
6. [Running the Project](#running-the-project)
7. [How Each Feature Works](#how-each-feature-works)
8. [Math Solver Capability](#math-solver-capability)
9. [Security](#security)
10. [Current Limitations](#current-limitations)
11. [Future Roadmap](#future-roadmap)
12. [Deployment Guide](#deployment-guide)

---

## System Architecture
┌─────────────────────────────────────────────────────────────┐
│                     USER DEVICE                             │
│           (Browser — any device, any screen size)           │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              React Frontend (App.js)                │   │
│   │                                                     │   │
│   │   ┌──────────────┐      ┌──────────────────────┐   │   │
│   │   │ Image Upload │  OR  │ Text / Problem Paste  │   │   │
│   │   └──────────────┘      └──────────────────────┘   │   │
│   │              Subject + Level selectors              │   │
│   │              Animated progress tracker              │   │
│   │              Video player + Download                │   │
│   └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
│ HTTP POST (FormData / JSON)
▼
┌─────────────────────────────────────────────────────────────┐
│              Node.js / Express Backend (server.js)          │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Multer  │  │Tesseract │  │Transform-│  │  Math    │   │
│  │  Upload  │→ │   OCR    │→ │  ers.js  │  │  Solver  │   │
│  │  Handler │  │(local)   │  │ LaMini   │  │(symbolic)│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                    │              │         │
│                              ┌─────▼──────────────▼────┐   │
│                              │   Script Generator       │   │
│                              │ (dedup + length control) │   │
│                              └──────────────┬───────────┘   │
│                                             │               │
│              ┌──────────────────────────────▼────────────┐  │
│              │           Pipeline (sequential)            │  │
│              │                                            │  │
│              │  1. edge-tts → MP3 audio per step         │  │
│              │  2. Python Pillow → PNG frame per step     │  │
│              │  3. FFmpeg → MP4 clip per step             │  │
│              │  4. FFmpeg concat → Final video            │  │
│              └──────────────────────────────┬─────────────  │
│                                             │               │
│                              Auto cleanup (frames + audio)  │
└──────────────────────────────┬──────────────────────────────┘
│ JSON { videoUrl, steps, qType }
▼
Video plays in browser
Download button available

---

## Data Flow
INPUT
│
├── Image uploaded
│       │
│       ▼
│   Tesseract.js OCR
│   (reads text from image locally)
│       │
│       ▼
│   Extracted text string
│
└── Text pasted directly
│
▼
┌───────────────────────────┐
│   Question Type Detector  │
│                           │
│   math?   → Math Solver   │
│   theory? → AI model      │
│   problem?→ AI model      │
└───────────┬───────────────┘
│
▼
┌───────────────────────────┐
│   Script Generator        │
│                           │
│   - Symbolic solve (math) │
│   - AI generate (theory)  │
│   - Deduplication filter  │
│   - 25-35 word limit/step │
│   - Max 20 slides         │
└───────────┬───────────────┘
│
▼
┌───────────────────────────┐
│   Voiceover Generator     │
│   edge-tts (local)        │
│   en-US-JennyNeural voice │
│   One MP3 per step        │
└───────────┬───────────────┘
│
▼
┌───────────────────────────┐
│   Frame Generator         │
│   Python Pillow           │
│   1280 x 720 PNG          │
│   Step number + badge     │
│   Progress bar            │
│   Word-wrapped text       │
└───────────┬───────────────┘
│
▼
┌───────────────────────────┐
│   Video Assembly          │
│   FFmpeg                  │
│   Frame + Audio → Clip    │
│   All clips → Final MP4   │
└───────────┬───────────────┘
│
▼
┌───────────────────────────┐
│   Cleanup                 │
│   Delete frames + audio   │
│   Keep only final MP4     │
└───────────┬───────────────┘
│
▼
Video URL returned
to React frontend
Plays in browser

---

## Tech Stack

| Layer | Technology | Purpose | Cost |
|---|---|---|---|
| Frontend | React 18 | Single page UI | Free |
| Backend | Node.js + Express | API server | Free |
| File Upload | Multer | Handle image uploads | Free |
| OCR | Tesseract.js | Extract text from images | Free, local |
| AI Script | Transformers.js + LaMini-Flan-T5-248M | Generate explanation scripts | Free, local |
| Math Solver | Custom symbolic engine | Solve equations exactly | Free, local |
| Voiceover | edge-tts (Python) | Neural text to speech | Free, local |
| Frame Drawing | Python Pillow | Draw 1280x720 slides | Free, local |
| Video Assembly | FFmpeg | Combine frames and audio | Free, local |
| Env Config | dotenv | Environment variables | Free |
| Cross Origin | cors | Frontend-backend communication | Free |

---

## Project Structure
Desktop/
└── picto pro/
│
├── picto-pro/                  ← React Frontend
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   └── App.js              ← ENTIRE frontend in one file
│   ├── package.json
│   └── README.md               ← This file
│
└── picto-pro-backend/          ← Node.js Backend
├── server.js               ← ENTIRE backend in one file
├── package.json
├── .env                    ← Environment variables
├── uploads/                ← Temporary image uploads
├── outputs/                ← Final MP4 videos
├── frames/                 ← Temporary PNG frames
└── audio/                  ← Temporary MP3 files

---

## Installation Guide

### Prerequisites — install these first

**1. Node.js (v18 or above)**
Download from https://nodejs.org and install.
Verify:
```bash
node --version
npm --version
```

**2. Python 3.10 or above**
Download from https://python.org and install.
Check "Add to PATH" during installation.
Verify:
```bash
python --version
```

**3. FFmpeg**
Download from https://ffmpeg.org/download.html
Extract the zip. Copy the `bin` folder path.
Add it to Windows PATH:
- Search "Environment Variables" in Windows
- Click "Path" → Edit → New → paste the bin folder path
- Click OK and restart VS Code

Verify:
```bash
ffmpeg -version
```

**4. Python libraries**
```bash
pip install pillow edge-tts
```

---

### Frontend setup

```bash
cd picto-pro
npm install
```

---

### Backend setup

```bash
cd picto-pro-backend
npm install express cors multer dotenv axios tesseract.js @xenova/transformers sharp fluent-ffmpeg
```

---

## Running the Project

You need **two terminals** open at the same time.

### Terminal 1 — Start the Backend

```bash
cd picto-pro-backend
node server.js
```

Expected output on first run:
✅  Picto PRO Backend — Phase 4 Final
🌐  http://localhost:4000
🧮  Built-in math solver active
🗑   Auto file cleanup active
⏳ Loading AI model (first run downloads ~248MB)...
✅ AI model ready

Note: The first run downloads the AI model (~248MB). This happens once only.
After that it loads from cache in a few seconds.

### Terminal 2 — Start the Frontend

```bash
cd picto-pro
npm start
```

Opens automatically at:
http://localhost:3000

---

## How Each Feature Works

### Image Upload
- User uploads JPG, PNG, or WEBP image
- Multer saves it temporarily to `/uploads`
- Tesseract.js reads the image and extracts all text (OCR)
- Extracted text is passed to the script generator
- Image file is deleted after OCR completes

### Text Input
- User pastes any question, math problem, or topic
- Text is sent directly to the script generator
- No file saving needed

### Question Type Detection
The system automatically detects:
- **MATH** — contains equations, numbers with operators, keywords like solve/calculate/find x
- **THEORY** — contains keywords like explain/describe/what is/how does
- **PROBLEM** — everything else that is not math or theory

### Math Solver (Symbolic — exact answers)
Handles these types without AI:
- Linear equations: 3x + 5 = 20
- Quadratic equations: 2x² + 5x - 3 = 0
- Arithmetic: 45 × 12 + 300 / 5
- Percentages: 15% of 240
- Simple interest: Principal=5000, Rate=8%, Time=3 years
- Speed/Distance/Time problems
- Circle area and circumference
- Rectangle area and perimeter
- Triangle area

### AI Script Generator
Used for theory questions and unsolved problems.
Model: Xenova/LaMini-Flan-T5-248M (248MB, runs locally)
- Generates 6 to 20 sentences depending on topic complexity
- Deduplication filter removes repeated ideas (60% word overlap threshold)
- Word limit per sentence: 35 words (theory) or 25 words (problem)

### Voiceover
- edge-tts calls Microsoft Edge Neural TTS locally
- Voice: en-US-JennyNeural
- One MP3 audio file generated per step
- If TTS fails, silent audio fallback created via FFmpeg

### Frame Generator
- Python Pillow draws each slide at 1280×720 pixels
- Shows: step number, subject, question type badge, explanation text, progress bar
- Arial font with word wrapping
- Dark themed with colour-coded accents per step

### Video Assembly
- FFmpeg combines each frame PNG with its MP3 audio into a clip
- All clips concatenated into one final MP4
- Temporary frames and audio deleted after video is built
- Final MP4 served at /outputs/ route

---

## Math Solver Capability

### Supported (exact symbolic solution)

| Type | Example |
|---|---|
| Linear equation | 3x + 7 = 22 |
| Quadratic equation | x² - 5x + 6 = 0 |
| Two real roots | 2x² + 3x - 5 = 0 |
| One repeated root | x² - 6x + 9 = 0 |
| Complex roots | x² + x + 1 = 0 |
| Arithmetic | (45 + 15) × 3 - 20 |
| Percentage | 18% of 350 |
| Simple interest | P=1000 R=5% T=2 years |
| Speed/Distance/Time | Speed=60 Time=3 find distance |
| Circle geometry | radius=7 find area |
| Rectangle geometry | length=10 width=4 find area |
| Triangle area | base=8 height=5 |

### Not yet supported (uses AI fallback)

| Type | Status |
|---|---|
| Calculus / differentiation | Phase 5 |
| Integration | Phase 5 |
| Matrices and determinants | Phase 5 |
| Trigonometric equations | Phase 5 |
| Logarithmic equations | Phase 5 |
| Statistics and probability | Phase 5 |
| Physics formulas | Phase 6 |
| Chemistry equations | Phase 6 |

---

## Security

### What this project does NOT have (by design)

- No API keys stored anywhere in the project
- No user accounts or passwords
- No database storing user data
- No cookies or session tracking
- No third-party analytics or tracking scripts
- No payment processing
- No personal data collected from users

### What to be aware of

**1. File uploads**
Multer is configured to accept only JPG, PNG, and WEBP files.
Maximum file size is 10MB.
All uploaded files are deleted automatically after processing.
Risk level: Low.

**2. Code execution**
The backend runs Python scripts for frame drawing.
Only internally generated Python code is executed, never user input.
User text is sanitised before being inserted into Python strings.
Risk level: Low.

**3. Local network**
The backend runs on localhost:4000.
If you expose it via Cloudflare Tunnel or ngrok, anyone with the URL can send requests.
There is no authentication on the API endpoints.

**Recommendation for public deployment:**
Add this rate limiter to prevent abuse. In your backend terminal:
```bash
npm install express-rate-limit
```

Then add this to server.js after the cors line:
```js
const rateLimit = require("express-rate-limit");
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                    // max 10 requests per IP per 15 minutes
  message: { error: "Too many requests. Please wait 15 minutes." }
}));
```

**4. Output videos**
Generated videos are stored in the /outputs folder.
They are served publicly via the /outputs static route.
Anyone who knows the exact filename can download it.
Since filenames are timestamp-based (job_1234567890.mp4) they are hard to guess.
Files from previous jobs are deleted when a new job starts.
Risk level: Very low.

---

## Current Limitations

| Area | Limitation |
|---|---|
| Math | Complex calculus, matrices, trig equations use AI fallback not exact solver |
| AI model | 248MB model — good for theory, basic for complex multi-step proofs |
| Input types | Image and text only — no PDF, DOCX, handwriting yet |
| Language | English only |
| Avatar | No animated character — text slides only |
| Concurrent users | Single job at a time — no queue system yet |
| Video length | Best for 6 to 15 steps — very long derivations may be incomplete |
| Internet required | edge-tts needs internet connection for voiceover generation |

---

## Future Roadmap

### Phase 5 — Document Input
- PDF upload and parsing
- DOCX file support
- Study note PDF download
- YouTube script export with timestamps
- Instagram vertical reel format

### Phase 6 — Language Support
- 40+ language voiceovers via edge-tts
- RTL language support (Arabic, Urdu)
- Regional math notation

### Phase 7 — Avatar Engine
- Anime-style teacher character with lip sync
- Real face avatar from user photo upload
- Gesture and pointer animation

### Phase 8 — Creator Studio
- Digital marketing content pack
- Auto-generate carousel posts
- YouTube thumbnail generator
- Brand kit and watermark system

### Phase 9 — AI Classroom
- MCQ quiz generation after each explanation
- Student progress tracking
- Course builder with chapters
- Certificate generation

---

## Deployment Guide

### Option A — Local only (current)
Both terminals running on your PC.
Access at http://localhost:3000

### Option B — Share online free (recommended)

**Step 1: Host frontend on Vercel**
```bash
npm install -g vercel
cd picto-pro
vercel
```
Get URL like: https://picto-pro.vercel.app

**Step 2: Expose backend via Cloudflare Tunnel**
Download cloudflared.exe from:
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Run:
```bash
node server.js
cloudflared.exe tunnel --url http://localhost:4000
```
Get permanent URL like: https://picto-pro-xyz.trycloudflare.com

**Step 3: Update App.js**
Replace all http://localhost:4000 with your Cloudflare URL.
Redeploy: vercel --prod

---

## Developer

**Mohammed Irfan A**
Full Stack AI Developer

Project: PictoPRO
Stack: React · Node.js · Transformers.js · Tesseract.js · Python · FFmpeg
Type: Fully local AI application — no API keys, no cloud dependency, no cost