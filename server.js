require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const https = require("https");
const Tesseract = require("tesseract.js");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 4000;

process.on("uncaughtException", (err) => {
  console.error("Uncaught error (server kept running):", err.message);
});

// ── Directories ──────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "outputs");
const FRAMES_DIR = path.join(__dirname, "frames");
const AUDIO_DIR  = path.join(__dirname, "audio");

[UPLOAD_DIR, OUTPUT_DIR, FRAMES_DIR, AUDIO_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d);
});

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use("/outputs", express.static(OUTPUT_DIR));

// ── Multer ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const u = Date.now() + "-" + Math.round(Math.random() * 1e6);
    cb(null, u + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (["image/jpeg","image/png","image/webp"].includes(file.mimetype))
      cb(null, true);
    else cb(new Error("Only JPG PNG WEBP allowed"));
  },
});

// ════════════════════════════════════════════════════════════
// GROQ API — replaces local AI model, zero RAM usage
// ════════════════════════════════════════════════════════════
async function callGroq(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "llama3-8b-8192",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 800,
    });

    const options = {
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content || "";
          resolve(text);
        } catch (e) {
          reject(new Error("Groq parse error: " + e.message));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ════════════════════════════════════════════════════════════
// CLEANUP
// ════════════════════════════════════════════════════════════
function cleanAllDirs() {
  [UPLOAD_DIR, OUTPUT_DIR, FRAMES_DIR, AUDIO_DIR].forEach((dir) => {
    fs.readdirSync(dir).forEach((file) => {
      try { fs.unlinkSync(path.join(dir, file)); } catch (_) {}
    });
  });
  console.log("  🗑  Previous job files deleted");
}

// ════════════════════════════════════════════════════════════
// MATH SOLVER
// ════════════════════════════════════════════════════════════
function isMathProblem(text) {
  const t = text.toLowerCase();
  const mathPatterns = [
    /\d+\s*[\+\-\*\/\^]\s*\d+/,
    /[a-z]\s*[\^²³]\s*\d*/,
    /solve|find x|find y|evaluate/i,
    /\d+x|x\d+|\dx/,
    /=\s*\d+/,
    /[\+\-]\s*\d+\s*=\s*\d+/,
    /\d+\s*\/\s*\d+/,
    /sqrt|√|∫|sin|cos|tan|log|ln/i,
    /\d+\s*%/,
    /area|perimeter|volume|radius|diameter/i,
    /profit|loss|interest|principal/i,
    /speed|distance|time/i,
  ];
  return mathPatterns.some((p) => p.test(t));
}

function solveLinear(text) {
  const m = text.match(/([+-]?\s*\d*\.?\d*)\s*x\s*([+-]\s*\d+\.?\d*)?\s*=\s*([+-]?\s*\d+\.?\d*)/i);
  if (!m) return null;
  let a = parseFloat((m[1]||"1").replace(/\s/g,""))||1;
  let b = parseFloat((m[2]||"0").replace(/\s/g,""))||0;
  let c = parseFloat((m[3]||"0").replace(/\s/g,""));
  const x = (c-b)/a;
  return { type:"linear", steps:[
    `We are given the linear equation: ${text.trim()}`,
    `A linear equation has the standard form ax + b = c.`,
    `Here the coefficient of x is ${a}, constant on left is ${b}, right side is ${c}.`,
    `Move constant ${b} to the right: ${a}x = ${c} - (${b}) = ${c-b}.`,
    `Divide both sides by ${a}: x = ${c-b} ÷ ${a}.`,
    `Therefore x = ${x.toFixed(4).replace(/\.?0+$/, "")}.`,
    `Verification: ${a} × ${x.toFixed(2)} + ${b} = ${(a*x+b).toFixed(2)} = ${c} ✓`,
  ]};
}

function solveQuadratic(text) {
  const m = text.match(/([+-]?\s*\d*\.?\d*)\s*x\s*[²^2]\s*([+-]\s*\d*\.?\d*)\s*x?\s*([+-]\s*\d+\.?\d*)?\s*=\s*0/i);
  if (!m) return null;
  let a = parseFloat((m[1]||"1").replace(/\s/g,""))||1;
  let b = parseFloat((m[2]||"0").replace(/\s/g,""))||0;
  let c = parseFloat((m[3]||"0").replace(/\s/g,""))||0;
  const disc = b*b - 4*a*c;
  const fmt = (n) => parseFloat(n.toFixed(4).replace(/\.?0+$/,""));
  if (disc > 0) {
    const x1 = (-b+Math.sqrt(disc))/(2*a);
    const x2 = (-b-Math.sqrt(disc))/(2*a);
    return { type:"quadratic", steps:[
      `We need to solve the quadratic equation: ${text.trim()}`,
      `Standard form ax² + bx + c = 0 with a=${a}, b=${b}, c=${c}.`,
      `Using the quadratic formula: x = (-b ± √(b²-4ac)) / 2a.`,
      `Calculate discriminant: b²-4ac = ${b*b} - ${4*a*c} = ${disc}.`,
      `Discriminant is positive so there are two real solutions.`,
      `√${disc} = ${fmt(Math.sqrt(disc))}.`,
      `x₁ = (-${b} + ${fmt(Math.sqrt(disc))}) / ${2*a} = ${fmt(x1)}.`,
      `x₂ = (-${b} - ${fmt(Math.sqrt(disc))}) / ${2*a} = ${fmt(x2)}.`,
      `The two solutions are x₁ = ${fmt(x1)} and x₂ = ${fmt(x2)}.`,
    ]};
  } else if (disc === 0) {
    const x = -b/(2*a);
    return { type:"quadratic", steps:[
      `Quadratic equation: ${text.trim()} with a=${a}, b=${b}, c=${c}.`,
      `Discriminant = ${b*b} - ${4*a*c} = 0.`,
      `Zero discriminant means exactly one repeated root.`,
      `x = -b/2a = ${fmt(x)}.`,
    ]};
  } else {
    const rp = fmt(-b/(2*a));
    const ip = fmt(Math.sqrt(-disc)/(2*a));
    return { type:"quadratic", steps:[
      `Quadratic equation: ${text.trim()} with a=${a}, b=${b}, c=${c}.`,
      `Discriminant = ${disc} which is negative.`,
      `No real solutions — the roots are complex numbers.`,
      `x₁ = ${rp} + ${ip}i and x₂ = ${rp} - ${ip}i.`,
    ]};
  }
}

function solveArithmetic(text) {
  const clean = text.replace(/[^0-9+\-*/().%\s^]/g,"").trim();
  if (!clean || clean.length < 3) return null;
  try {
    const safe = clean.replace(/\^/g,"**").replace(/(\d+)%/g,"($1/100)");
    const result = Function(`"use strict"; return (${safe})`)();
    if (typeof result !== "number" || !isFinite(result)) return null;
    return { type:"arithmetic", steps:[
      `We need to evaluate: ${text.trim()}`,
      `Follow BODMAS: Brackets, Orders, Division, Multiplication, Addition, Subtraction.`,
      `Solve brackets first, then powers, then multiply/divide left to right.`,
      `Finally add and subtract from left to right.`,
      `Result: ${clean} = ${result}.`,
      `The final answer is ${result}.`,
    ]};
  } catch(_){ return null; }
}

function solvePercentage(text) {
  const t = text.toLowerCase();
  const m = t.match(/(\d+\.?\d*)\s*%\s*of\s*(\d+\.?\d*)/);
  if (!m) return null;
  const pct = parseFloat(m[1]), num = parseFloat(m[2]);
  const ans = (pct/100)*num;
  return { type:"percentage", steps:[
    `We need to find ${pct}% of ${num}.`,
    `Percent means per hundred, so ${pct}% = ${pct}/100 = ${pct/100}.`,
    `Formula: (Percentage/100) × Number.`,
    `= (${pct}/100) × ${num} = ${pct/100} × ${num}.`,
    `= ${ans}.`,
    `Therefore ${pct}% of ${num} = ${ans}.`,
  ]};
}

function solveSimpleInterest(text) {
  const t = text.toLowerCase();
  if (!t.includes("simple interest") && !t.includes("s.i")) return null;
  const p = text.match(/principal[^\d]*(\d+\.?\d*)/i);
  const r = text.match(/rate[^\d]*(\d+\.?\d*)/i);
  const tm = text.match(/time[^\d]*(\d+\.?\d*)/i)||text.match(/(\d+\.?\d*)\s*year/i);
  if (!p||!r||!tm) return null;
  const P=parseFloat(p[1]),R=parseFloat(r[1]),T=parseFloat(tm[1]);
  const SI=(P*R*T)/100, A=P+SI;
  return { type:"simple_interest", steps:[
    `Simple interest problem: P=${P}, R=${R}%, T=${T} years.`,
    `Formula: SI = (P × R × T) / 100.`,
    `SI = (${P} × ${R} × ${T}) / 100 = ${P*R*T} / 100.`,
    `SI = ${SI}.`,
    `Total Amount = P + SI = ${P} + ${SI} = ${A}.`,
  ]};
}

function solveSDT(text) {
  const t = text.toLowerCase();
  if (!t.includes("speed")&&!t.includes("distance")&&!t.includes("time")) return null;
  const d=text.match(/distance[^\d]*(\d+\.?\d*)/i);
  const s=text.match(/speed[^\d]*(\d+\.?\d*)/i);
  const tm=text.match(/time[^\d]*(\d+\.?\d*)/i);
  if (d&&s&&!tm) {
    const dist=parseFloat(d[1]),spd=parseFloat(s[1]),time=dist/spd;
    return { type:"sdt", steps:[
      `Find Time: Distance=${dist}, Speed=${spd}.`,
      `Formula: Time = Distance / Speed.`,
      `Time = ${dist} / ${spd} = ${parseFloat(time.toFixed(4))}.`,
    ]};
  }
  if (s&&tm&&!d) {
    const spd=parseFloat(s[1]),time=parseFloat(tm[1]);
    return { type:"sdt", steps:[
      `Find Distance: Speed=${spd}, Time=${time}.`,
      `Distance = Speed × Time = ${spd} × ${time} = ${spd*time}.`,
    ]};
  }
  if (d&&tm&&!s) {
    const dist=parseFloat(d[1]),time=parseFloat(tm[1]);
    return { type:"sdt", steps:[
      `Find Speed: Distance=${dist}, Time=${time}.`,
      `Speed = Distance / Time = ${dist} / ${time} = ${parseFloat((dist/time).toFixed(4))}.`,
    ]};
  }
  return null;
}

function solveGeometry(text) {
  const t = text.toLowerCase();
  const n = (s) => parseFloat(s);
  if ((t.includes("area")||t.includes("circumference"))&&t.includes("circle")) {
    const r=text.match(/radius[^\d]*(\d+\.?\d*)/i)||text.match(/r\s*=\s*(\d+\.?\d*)/i);
    if (r) {
      const R=n(r[1]),area=Math.PI*R*R,circ=2*Math.PI*R;
      return { type:"geometry", steps:[
        `Circle with radius r = ${R}.`,
        `Area = π × r² = π × ${R*R} = ${parseFloat(area.toFixed(4))} square units.`,
        `Circumference = 2 × π × r = 2 × π × ${R} = ${parseFloat(circ.toFixed(4))} units.`,
        `π ≈ 3.14159265.`,
      ]};
    }
  }
  if (t.includes("rectangle")||(t.includes("length")&&t.includes("width"))) {
    const l=text.match(/length[^\d]*(\d+\.?\d*)/i);
    const w=text.match(/width[^\d]*(\d+\.?\d*)/i)||text.match(/breadth[^\d]*(\d+\.?\d*)/i);
    if (l&&w) {
      const L=n(l[1]),W=n(w[1]);
      return { type:"geometry", steps:[
        `Rectangle: length=${L}, width=${W}.`,
        `Area = length × width = ${L} × ${W} = ${L*W} square units.`,
        `Perimeter = 2×(length+width) = 2×(${L}+${W}) = ${2*(L+W)} units.`,
        `Diagonal = √(${L*L}+${W*W}) = ${parseFloat(Math.sqrt(L*L+W*W).toFixed(4))} units.`,
      ]};
    }
  }
  if (t.includes("triangle")&&(t.includes("base")||t.includes("height"))) {
    const b=text.match(/base[^\d]*(\d+\.?\d*)/i);
    const h=text.match(/height[^\d]*(\d+\.?\d*)/i);
    if (b&&h) {
      const B=n(b[1]),H=n(h[1]);
      return { type:"geometry", steps:[
        `Triangle: base=${B}, height=${H}.`,
        `Area = ½ × base × height = ½ × ${B} × ${H} = ${0.5*B*H} square units.`,
      ]};
    }
  }
  return null;
}

function solveMath(text) {
  return solvePercentage(text)||solveSimpleInterest(text)||solveSDT(text)||
         solveGeometry(text)||solveQuadratic(text)||solveLinear(text)||
         solveArithmetic(text)||null;
}

// ════════════════════════════════════════════════════════════
// QUESTION TYPE DETECTOR
// ════════════════════════════════════════════════════════════
function detectQuestionType(text) {
  if (isMathProblem(text)) return "math";
  const t = text.toLowerCase();
  const theoryWords = [
    "what is","what are","explain","describe","define","discuss",
    "write about","how does","how do","why does","why do",
    "what causes","history of","types of","difference between",
    "importance of","role of","function of","structure of",
    "process of","theory","concept","principle","law of",
    "characteristics","advantages","disadvantages",
  ];
  return theoryWords.some((w) => t.includes(w)) ? "theory" : "problem";
}

// ════════════════════════════════════════════════════════════
// SCRIPT GENERATOR — uses Groq API (zero RAM)
// ════════════════════════════════════════════════════════════
async function generateScript(inputText, subject, level) {
  const qType = detectQuestionType(inputText);
  console.log(`  Question type: ${qType.toUpperCase()}`);

  // Math: symbolic solver first
  if (qType === "math") {
    const solved = solveMath(inputText);
    if (solved) {
      console.log(`  Solved symbolically: ${solved.type}`);
      return { steps: solved.steps, qType };
    }
    console.log("  Symbolic solver failed, calling Groq...");
  }

  // Groq API for theory and unsolved math
  let rawSteps = [];

  if (process.env.GROQ_API_KEY) {
    try {
      let prompt = "";
      if (qType === "theory") {
        prompt =
          `You are an expert ${subject} teacher for ${level} students. ` +
          `Write a complete explanation of this topic. ` +
          `Cover definition, key concepts, how it works, real examples, and importance. ` +
          `Write exactly one sentence per point. Do not stop early. ` +
          `No bullet points. No numbers. Separate sentences with a newline. ` +
          `Topic: ${inputText.slice(0,500)}`;
      } else {
        prompt =
          `You are an expert ${subject} teacher for ${level} students. ` +
          `Solve this problem completely step by step. ` +
          `State what is given, show every calculation, state the final answer. ` +
          `One sentence per step. No bullet points. No numbers. ` +
          `Problem: ${inputText.slice(0,500)}`;
      }

      const raw = await callGroq(prompt);
      rawSteps = raw
        .split(/\n/)
        .map((s) => s.replace(/^[\d\.\-\*]+\s*/, "").trim())
        .filter((s) => s.length > 12);

      console.log(`  Groq returned ${rawSteps.length} steps`);
    } catch (err) {
      console.warn("  Groq failed:", err.message);
    }
  } else {
    console.warn("  No GROQ_API_KEY found, using fallback");
  }

  if (rawSteps.length < 3) {
    rawSteps = fallbackScript(inputText, subject, level, qType);
  }

  // Deduplication
  const cleaned = [];
  for (const step of rawSteps) {
    const isDup = cleaned.some((ex) => {
      const wA = new Set(ex.toLowerCase().split(" "));
      const wB = step.toLowerCase().split(" ");
      return wB.filter((w) => wA.has(w)).length / wB.length > 0.6;
    });
    if (!isDup) cleaned.push(step);
  }

  const maxSlides = qType === "theory" ? 20 : 15;
  const wordLimit = qType === "theory" ? 35 : 25;

  const finalSteps = cleaned.slice(0, maxSlides).map((s) => {
    const words = s.split(" ");
    if (words.length > wordLimit) return words.slice(0,wordLimit).join(" ")+".";
    return s.endsWith(".")||s.endsWith("!")||s.endsWith("?") ? s : s+".";
  });

  console.log(`  Final slides: ${finalSteps.length}`);
  return { steps: finalSteps, qType };
}

function fallbackScript(inputText, subject, level, qType) {
  const ctx = inputText.split(/[.!?\n]/)[0].trim().slice(0,100);
  if (qType==="math"||qType==="problem") {
    return [
      `This is a ${subject} problem requiring careful step by step analysis.`,
      `First read the problem and write down all given values.`,
      `Identify what the question is asking you to find.`,
      `Choose the correct formula or method for this type of problem.`,
      `Substitute the known values into the formula.`,
      `Perform each calculation carefully showing all working.`,
      `Check units are consistent throughout the solution.`,
      `Write the final answer clearly with correct units.`,
      `Verify by substituting the answer back into the original.`,
    ];
  }
  return [
    `Today we explore the topic of ${ctx} in ${subject}.`,
    `This is a fundamental concept every ${level} student needs to understand.`,
    `We begin by defining what this term means in ${subject}.`,
    `The key principles behind this concept build a strong foundation.`,
    `There are several important characteristics that define how this works.`,
    `Real life applications of this concept are found everywhere around us.`,
    `Scientists studied this through careful experimentation and observation.`,
    `Understanding this topic connects to many other areas of ${subject}.`,
    `In summary this concept is essential for deeper study of ${subject}.`,
  ];
}

// ════════════════════════════════════════════════════════════
// VOICEOVER
// ════════════════════════════════════════════════════════════
function generateVoiceovers(steps, jobId) {
  return new Promise(async (resolve) => {
    const paths = [];
    for (let i = 0; i < steps.length; i++) {
      const outPath = path.join(AUDIO_DIR, `${jobId}_step${i}.mp3`);
      const safeText = steps[i].replace(/"/g,"'").replace(/[^\w\s.,!?'-]/g,"");
      const cmd = `edge-tts --text "${safeText}" --voice en-US-JennyNeural --write-media "${outPath}"`;
      await new Promise((res) => {
        exec(cmd, (err) => {
          if (err) {
            exec(`ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 4 "${outPath}" -y`, ()=>res());
          } else res();
        });
      });
      paths.push(outPath);
    }
    resolve(paths);
  });
}

// ════════════════════════════════════════════════════════════
// FRAMES — Python Pillow
// ════════════════════════════════════════════════════════════
async function generateFrames(steps, subject, jobId, qType="theory") {
  const paths = [];
  const accents  = ["#6c63ff","#a09cf7","#4ecdc4","#e96479","#6c63ff","#a09cf7","#4ecdc4","#e96479"];
  const bgColors = ["#1a1a2e","#16213e","#0f3460","#1a1230","#1a1a2e","#16213e","#0f3460","#1a1230"];
  const badgeColor = qType==="math"?"#e96479":qType==="problem"?"#f5a623":"#4ecdc4";
  const badgeLabel = qType==="math"?"MATH":qType==="problem"?"PROBLEM":"THEORY";

  for (let i = 0; i < steps.length; i++) {
    const framePath = path.join(FRAMES_DIR, `${jobId}_frame${i}.png`);
    const safeText  = steps[i].replace(/'/g," ").replace(/\\/g," ").replace(/"/g," ");
    const safeSubj  = subject.replace(/'/g," ");
    const accent    = accents[i%accents.length];
    const bgColor   = bgColors[i%bgColors.length];

    const pyScript = `
import textwrap, sys
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable,'-m','pip','install','pillow','--quiet'])
    from PIL import Image, ImageDraw, ImageFont

W,H=1280,720
bg='${bgColor}'
accent='${accent}'
badge_c='${badgeColor}'
badge_l='${badgeLabel}'
text='${safeText}'
subject='${safeSubj}'
step=${i+1}
total=${steps.length}
out=r'${framePath.replace(/\\/g,"\\\\")}'

img=Image.new('RGB',(W,H),bg)
draw=ImageDraw.Draw(img)

def hex_to_rgb(h):
    h=h.lstrip('#')
    return tuple(int(h[i:i+2],16) for i in (0,2,4))

img_rgba=img.convert('RGBA')
overlay=Image.new('RGBA',(W,H),(0,0,0,0))
od=ImageDraw.Draw(overlay)
od.rectangle([0,0,W,8],fill=(*hex_to_rgb(accent),255))
od.rounded_rectangle([60,46,270,92],radius=22,fill=(*hex_to_rgb(accent),40))
od.rounded_rectangle([W//2-60,46,W//2+60,92],radius=22,fill=(*hex_to_rgb(badge_c),50))
img_rgba=Image.alpha_composite(img_rgba,overlay)
img=img_rgba.convert('RGB')
draw=ImageDraw.Draw(img)

try:
     font_big=ImageFont.truetype("arial.ttf",54)
     font_med=ImageFont.truetype("arial.ttf",26)
     font_sm=ImageFont.truetype("arial.ttf",20)
except:
    font_big=ImageFont.load_default()
    font_med=ImageFont.load_default()
    font_sm=ImageFont.load_default()

draw.text((165,69),f'STEP {step} OF {total}',font=font_med,fill=accent,anchor='mm')
draw.text((W//2,69),badge_l,font=font_med,fill=badge_c,anchor='mm')
draw.text((W-60,69),subject.upper(),font=font_sm,fill='#ffffff55',anchor='rm')

lines=textwrap.wrap(text,width=38)
total_h=len(lines)*72
start_y=(H//2)-(total_h//2)+10
for idx,line in enumerate(lines):
    draw.text((W//2,start_y+idx*72),line,font=font_big,fill='white',anchor='mm')

bar_x2=60+int(1160*step/total)
draw.rounded_rectangle([60,666,1220,672],radius=3,fill='#ffffff15')
draw.rounded_rectangle([60,666,bar_x2,672],radius=3,fill=accent)
draw.text((62,700),'PictoPRO',font=font_sm,fill='#ffffff33')

img.save(out)
print('frame ok')
`.trim();

    await new Promise((resolve, reject) => {
      const tmpPy = path.join(FRAMES_DIR, `${jobId}_draw${i}.py`);
      fs.writeFileSync(tmpPy, pyScript, "utf8");
      exec(`python3 "${tmpPy}"`, (err, stdout, stderr) => {
        fs.existsSync(tmpPy) && fs.unlinkSync(tmpPy);
        if (err) {
          exec(`python "${tmpPy.replace("draw"+i,"draw"+i)}" || ffmpeg -y -f lavfi -i color=c=0x1a1a2e:size=1280x720:rate=1 -frames:v 1 "${framePath}"`,
            (e2) => { resolve(); });
        } else resolve();
      });
    });
    paths.push(framePath);
  }
  return paths;
}

// ════════════════════════════════════════════════════════════
// VIDEO ASSEMBLY
// ════════════════════════════════════════════════════════════
function combineToVideo(framePaths, audioPaths, jobId) {
  return new Promise(async (resolve, reject) => {
    const clipPaths = [];
    for (let i = 0; i < framePaths.length; i++) {
      const clipPath = path.join(OUTPUT_DIR, `${jobId}_clip${i}.mp4`);
      await new Promise((res, rej) => {
        const cmd = [
          `ffmpeg -y`,
          `-loop 1 -i "${framePaths[i]}"`,
          `-i "${audioPaths[i]}"`,
          `-c:v libx264 -tune stillimage`,
          `-c:a aac -b:a 128k`,
          `-shortest -pix_fmt yuv420p`,
          `"${clipPath}"`,
        ].join(" ");
        exec(cmd, (err) => { if(err) rej(new Error("Clip: "+err.message)); else res(); });
      });
      clipPaths.push(clipPath);
    }

    const listPath  = path.join(OUTPUT_DIR, `${jobId}_list.txt`);
    const finalPath = path.join(OUTPUT_DIR, `${jobId}_final.mp4`);

    fs.writeFileSync(listPath,
      clipPaths.map((p) => `file '${p.replace(/\\/g,"/")}'`).join("\n")
    );

    exec(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${finalPath}"`, (err) => {
      clipPaths.forEach((p) => { try{fs.unlinkSync(p);}catch(_){} });
      try{fs.unlinkSync(listPath);}catch(_){}
      if(err) reject(new Error("Concat: "+err.message));
      else resolve(finalPath);
    });
  });
}

// ════════════════════════════════════════════════════════════
// HEALTH
// ════════════════════════════════════════════════════════════
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    groqReady: !!process.env.GROQ_API_KEY,
    message: "Picto PRO — Groq AI, zero RAM usage",
  });
});

// ════════════════════════════════════════════════════════════
// ROUTE 1 — Text input
// ════════════════════════════════════════════════════════════
app.post("/api/generate/text", async (req, res) => {
  try {
    const { text, subject, level } = req.body;
    if (!text||text.trim().length<3)
      return res.status(400).json({ error: "Input too short." });

    cleanAllDirs();
    const jobId = "job_"+Date.now();
    console.log(`\n[${jobId}] Text input`);

    const { steps, qType } = await generateScript(text, subject, level);
    const audioPaths = await generateVoiceovers(steps, jobId);
    const framePaths = await generateFrames(steps, subject, jobId, qType);
    const videoPath  = await combineToVideo(framePaths, audioPaths, jobId);

    [...framePaths, ...audioPaths].forEach((p) => { try{fs.unlinkSync(p);}catch(_){} });

    console.log(`[${jobId}] Done ✓`);
    res.json({
      jobId, steps, qType,
      videoUrl: `${req.protocol}://${req.get("host")}/outputs/${path.basename(videoPath)}`,
    });
  } catch(err) {
    console.error("Text route error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// ROUTE 2 — Image input
// ════════════════════════════════════════════════════════════
app.post("/api/generate/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image received." });

    const { subject="General", level="High school" } = req.body;
    const jobId = "job_"+Date.now();
    console.log(`\n[${jobId}] Image input: ${req.file.filename}`);

    const ocrResult = await Tesseract.recognize(req.file.path, "eng");
    const extractedText = ocrResult.data.text.trim()||"No text found in image.";
    console.log(`[${jobId}] OCR: ${extractedText.length} chars`);

    cleanAllDirs();

    const { steps, qType } = await generateScript(extractedText, subject, level);
    const audioPaths = await generateVoiceovers(steps, jobId);
    const framePaths = await generateFrames(steps, subject, jobId, qType);
    const videoPath  = await combineToVideo(framePaths, audioPaths, jobId);

    [...framePaths, ...audioPaths].forEach((p) => { try{fs.unlinkSync(p);}catch(_){} });

    console.log(`[${jobId}] Done ✓`);
    res.json({
      jobId, extractedText, steps, qType,
      videoUrl: `${req.protocol}://${req.get("host")}/outputs/${path.basename(videoPath)}`,
    });
  } catch(err) {
    console.error("Image route error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message||"Unknown error" });
});

app.listen(PORT, async () => {
  console.log("");
  console.log("  ✅  Picto PRO Backend");
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  🤖  Groq AI: ${process.env.GROQ_API_KEY ? "✅ ready" : "⚠ no key"}`);
  console.log(`  🧮  Math solver: ✅ active`);
  console.log("");
});