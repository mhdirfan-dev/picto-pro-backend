# PictoPRO — AI Explanation Video Generator
Developed by Mohammed Irfan A | Full Stack AI Developer
Live Demo: https://picto-pro.vercel.app
Frontend Repo: https://github.com/mhdirfan-dev/picto-pro
Backend Repo: https://github.com/mhdirfan-dev/picto-pro-backend

---

## HOW TO RUN THE PROJECT

### Prerequisites — Install these first

1. Node.js v18 or above — https://nodejs.org
2. Python 3.10 or above — https://python.org (check Add to PATH during install)
3. FFmpeg — https://ffmpeg.org/download.html (extract and add bin folder to Windows PATH)

Verify all three are installed:
node --version
python --version
ffmpeg -version

### Install Python libraries
pip install pillow edge-tts

### Install Frontend
cd picto-pro
npm install

### Install Backend
cd picto-pro-backend
npm install

### Create .env file inside picto-pro-backend folder
GROQ_API_KEY=your_groq_api_key_here
Get free key from https://console.groq.com

### Run — open two terminals

Terminal 1 (Frontend):
cd picto-pro
npm start
Opens at http://localhost:3000

Terminal 2 (Backend):
cd picto-pro-backend
node server.js
Runs at http://localhost:4000

Health check:
http://localhost:4000/health

---

## PROJECT STRUCTURE

Desktop/
└── picto pro/
    ├── picto-pro/                  React Frontend
    │   └── src/
    │       └── App.js              Entire frontend in one file
    └── picto-pro-backend/          Node.js Backend
        ├── server.js               Entire backend in one file
        ├── .env                    Environment variables
        ├── uploads/                Temporary image uploads
        ├── outputs/                Final MP4 videos
        ├── frames/                 Temporary PNG frames
        └── audio/                  Temporary MP3 files

---

## SYSTEM ARCHITECTURE

+----------------------------------------------------------+
|                    USER DEVICE                           |
|         Browser — any device, any screen size            |
|                                                          |
|   +--------------------------------------------------+   |
|   |           React Frontend (App.js)                |   |
|   |                                                  |   |
|   |   Image Upload  OR  Text Paste                   |   |
|   |   Subject selector + Level selector              |   |
|   |   Animated progress bar                          |   |
|   |   Video player + Download button                 |   |
|   +--------------------------------------------------+   |
+--------------------------|-------------------------------+
                           | HTTP POST
                           v
+----------------------------------------------------------+
|         Node.js / Express Backend (server.js)            |
|                                                          |
|   Multer    Tesseract    Groq API    Math Solver          |
|   Upload    OCR          LLaMA 3     Symbolic engine      |
|     |         |              |            |               |
|     +----+----+--------------+------------+               |
|          |                                                |
|          v                                                |
|   Script Generator (dedup + length control)              |
|          |                                                |
|          v                                                |
|   edge-tts → MP3 per step                                |
|          |                                                |
|          v                                                |
|   Python Pillow → PNG frame per step                     |
|          |                                                |
|          v                                                |
|   FFmpeg → MP4 clip per step                             |
|          |                                                |
|          v                                                |
|   FFmpeg concat → Final MP4                              |
|          |                                                |
|   Auto cleanup frames and audio                          |
+--------------------------|-------------------------------+
                           | JSON { videoUrl, steps, qType }
                           v
                  Video plays in browser
                  Download button available

---

## DATA FLOW

INPUT
  |
  +-- Image uploaded
  |       |
  |       v
  |   Tesseract.js OCR (local)
  |   Extracts text from image
  |       |
  |       v
  |   Extracted text string
  |
  +-- Text pasted directly
          |
          v
  Question Type Detector
  |
  +-- MATH detected
  |       |
  |       v
  |   Symbolic Math Solver
  |   Linear, Quadratic, Arithmetic,
  |   Percentage, Geometry, SI, SDT
  |       |
  |       v
  |   Exact step by step solution
  |
  +-- THEORY detected
  |       |
  |       v
  |   Groq API (LLaMA 3 8B)
  |   Full topic explanation
  |
  +-- PROBLEM detected
          |
          v
      Groq API (LLaMA 3 8B)
      Step by step solution
          |
          v
  Deduplication Filter
  60 percent word overlap check
  Remove repeated sentences
          |
          v
  Length Normaliser
  Theory: max 35 words per step, max 20 slides
  Problem: max 25 words per step, max 15 slides
          |
          v
  edge-tts Voiceover
  en-US-JennyNeural voice
  One MP3 per step
          |
          v
  Python Pillow Frame Drawing
  1280 x 720 PNG per step
  Step number, badge, subject, progress bar
          |
          v
  FFmpeg Video Assembly
  Frame + Audio = one clip per step
  All clips concatenated = final MP4
          |
          v
  Cleanup temporary files
          |
          v
  Video URL returned to frontend
  Plays in browser + download button

---

## TECH STACK

Layer          | Technology              | Purpose                        | Cost
Frontend       | React 18                | Single page UI                 | Free
Backend        | Node.js + Express       | API server                     | Free
File Upload    | Multer                  | Handle image uploads           | Free
OCR            | Tesseract.js            | Extract text from images       | Free local
AI Script      | Groq API LLaMA 3 8B     | Generate explanation scripts   | Free 14400/day
Math Solver    | Custom symbolic engine  | Solve equations exactly        | Free local
Voiceover      | edge-tts Python         | Neural text to speech          | Free local
Frame Drawing  | Python Pillow           | Draw 1280x720 slides           | Free local
Video Assembly | FFmpeg                  | Combine frames and audio       | Free local
Hosting FE     | Vercel                  | Frontend deployment            | Free forever
Hosting BE     | Render.com              | Backend deployment             | Free tier
Keep Alive     | cron-job.org            | Ping every 10 min              | Free

---

## MATH SOLVER CAPABILITY

Supported with exact symbolic solution:
- Linear equations: 3x + 7 = 22
- Quadratic equations: 2x2 + 5x - 3 = 0
- Two real roots, one repeated root, complex roots
- Arithmetic: (45 + 15) x 3 - 20
- Percentage: 18% of 350
- Simple interest: P=1000 R=5% T=2 years
- Speed Distance Time: Speed=60 Time=3 find distance
- Circle: radius=7 find area and circumference
- Rectangle: length=10 width=4 find area and perimeter
- Triangle: base=8 height=5 find area

Not yet supported (uses Groq AI fallback):
- Calculus and differentiation
- Integration
- Matrices and determinants
- Trigonometric equations
- Logarithmic equations
- Statistics and probability
- Physics formulas
- Chemistry equations

---

## SECURITY

What this project does NOT have by design:
- No API keys exposed in frontend code
- No user accounts or passwords
- No database storing user data
- No cookies or session tracking
- No third party analytics
- No payment processing
- No personal data collected

What is protected:
- File uploads validated by file type and size only
- Uploaded files deleted automatically after OCR
- All temporary frames and audio deleted after video
- CORS set to allow all origins for demo purposes
- Rate limiter recommended before production use

Add rate limiter:
npm install express-rate-limit

Add this to server.js after cors line:
const rateLimit = require("express-rate-limit");
app.use(rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: "Too many requests." } }));

---

## CURRENT LIMITATIONS

Area          | Limitation
Math          | Complex calculus, matrices, trig not in symbolic solver
AI model      | Groq free tier 14400 requests per day
Input types   | Image and text only, no PDF or DOCX yet
Language      | English only
Avatar        | No animated character yet
Concurrent    | Single job at a time, no queue system
Video length  | Best for 6 to 15 steps
Internet      | edge-tts and Groq need internet connection

---

## FUTURE ROADMAP

Phase 5 — Document Input
PDF upload and parsing
DOCX file support
Study note PDF download
YouTube script export with timestamps
Instagram vertical reel format (60 seconds)

Phase 6 — Language Support
40+ language voiceovers via edge-tts
RTL language support Arabic and Urdu
Regional math notation

Phase 7 — Avatar Engine
Anime style teacher character with lip sync
Real face avatar from user photo upload
Gesture and pointer animation system

Phase 8 — Creator Studio
Digital marketing content pack
Auto generate carousel posts
YouTube thumbnail generator
Brand kit and watermark system
Scheduled posting to social platforms

Phase 9 — AI Classroom
MCQ quiz generation after each explanation
Student progress tracking
Course builder with chapters
Certificate generation
LMS integration

---

## DEPLOYMENT

Local only:
npm start (frontend) + node server.js (backend)

Online free deployment:
Frontend on Vercel — https://vercel.com
Backend on Render.com — https://render.com
Keep backend awake — https://cron-job.org ping every 10 minutes

Environment variables on Render:
GROQ_API_KEY = your key from https://console.groq.com

---

## DEVELOPER

Mohammed Irfan A
Full Stack AI Developer
Project: PictoPRO
Stack: React, Node.js, Groq API, Tesseract.js, Python, FFmpeg
Type: AI application, no paid APIs, no cloud dependency beyond free tiers
GitHub: https://github.com/mhdirfan-dev