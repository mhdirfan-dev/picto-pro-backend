require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const Tesseract = require("tesseract.js");

const app = express();
app.set("trust proxy", 1);
const PORT = 4000;

// ── Crash guard ──────────────────────────────────────────────
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
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))
      cb(null, true);
    else cb(new Error("Only JPG PNG WEBP allowed"));
  },
});

// ── Load Transformers.js model once on startup ────────────────
let generator = null;
async function loadModel() {
  try {
    console.log("  ⏳ Loading AI model...");
    const { pipeline } = await import("@xenova/transformers");
    generator = await pipeline(
      "text2text-generation",
      "Xenova/LaMini-Flan-T5-248M"
    );
    console.log("  ✅ AI model ready");
  } catch (err) {
    console.error("  ⚠ Model load failed:", err.message);
  }
}

// ════════════════════════════════════════════════════════════
// CLEANUP — delete ALL previous files before each new job
// ════════════════════════════════════════════════════════════
function cleanAllDirs() {
  [UPLOAD_DIR, OUTPUT_DIR, FRAMES_DIR, AUDIO_DIR].forEach((dir) => {
    fs.readdirSync(dir).forEach((file) => {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch (_) {}
    });
  });
  console.log("  🗑  Previous job files deleted");
}

// ════════════════════════════════════════════════════════════
// MATH SOLVER — pure symbolic solver, no AI needed
// ════════════════════════════════════════════════════════════

// Detect if input is a math problem
function isMathProblem(text) {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const mathPatterns = [
    /\d+\s*[\+\-\*\/\^]\s*\d+/,          // arithmetic: 3+4, 5*6
    /[a-z]\s*[\^²³]\s*\d*/,               // powers: x^2, x²
    /solve|find x|find y|evaluate/i,
    /\d+x|x\d+|\dx/,                       // coefficients: 2x, x3
    /=\s*\d+/,                             // equations: = 0, = 5
    /[\+\-]\s*\d+\s*=\s*\d+/,            // linear: x + 3 = 7
    /\d+\s*\/\s*\d+/,                     // fractions: 3/4
    /sqrt|√|∫|sin|cos|tan|log|ln/i,       // functions
    /\d+\s*%/,                             // percentage
    /area|perimeter|volume|radius|diameter/i,
    /profit|loss|interest|principal/i,
    /speed|distance|time/i,
  ];
  return mathPatterns.some((p) => p.test(t));
}

// Solve linear equation: ax + b = c → x = (c-b)/a
function solveLinear(text) {
  // Pattern: ax + b = c  or  ax - b = c
  const m = text.match(/([+-]?\s*\d*\.?\d*)\s*x\s*([+-]\s*\d+\.?\d*)?\s*=\s*([+-]?\s*\d+\.?\d*)/i);
  if (!m) return null;
  let a = parseFloat((m[1] || "1").replace(/\s/g, "")) || 1;
  let b = parseFloat((m[2] || "0").replace(/\s/g, "")) || 0;
  let c = parseFloat((m[3] || "0").replace(/\s/g, ""));
  const x = (c - b) / a;
  return {
    type: "linear",
    equation: text.trim(),
    a, b, c,
    answer: x,
    steps: [
      `We are given the linear equation: ${text.trim()}`,
      `A linear equation has the standard form ax + b = c where we need to find x.`,
      `In this equation, the coefficient of x is ${a}, the constant on the left is ${b}, and the right side equals ${c}.`,
      `To isolate x, we first move the constant ${b} to the right side by subtracting it from both sides.`,
      `This gives us: ${a}x = ${c} - (${b}) = ${c - b}.`,
      `Now we divide both sides by the coefficient ${a} to get x alone.`,
      `Dividing both sides by ${a}: x = ${c - b} ÷ ${a}.`,
      `Therefore x = ${x.toFixed(4).replace(/\.?0+$/, "")}.`,
      `Verification: substitute x = ${x.toFixed(2)} back into the original equation.`,
      `Left side = ${a} × ${x.toFixed(2)} + ${b} = ${(a * x + b).toFixed(2)} which equals the right side ${c}. ✓`,
    ],
  };
}

// Solve quadratic: ax² + bx + c = 0
function solveQuadratic(text) {
  const m = text.match(
    /([+-]?\s*\d*\.?\d*)\s*x\s*[²^2]\s*([+-]\s*\d*\.?\d*)\s*x?\s*([+-]\s*\d+\.?\d*)?\s*=\s*0/i
  );
  if (!m) return null;
  let a = parseFloat((m[1] || "1").replace(/\s/g, "")) || 1;
  let b = parseFloat((m[2] || "0").replace(/\s/g, "")) || 0;
  let c = parseFloat((m[3] || "0").replace(/\s/g, "")) || 0;
  const disc = b * b - 4 * a * c;
  const fmt = (n) => parseFloat(n.toFixed(4).replace(/\.?0+$/, ""));

  if (disc > 0) {
    const x1 = (-b + Math.sqrt(disc)) / (2 * a);
    const x2 = (-b - Math.sqrt(disc)) / (2 * a);
    return {
      type: "quadratic",
      steps: [
        `We need to solve the quadratic equation: ${text.trim()}`,
        `A quadratic equation has the standard form ax² + bx + c = 0.`,
        `Here a = ${a}, b = ${b}, and c = ${c}.`,
        `We will use the quadratic formula: x = (-b ± √(b² - 4ac)) / 2a.`,
        `First calculate the discriminant: b² - 4ac = (${b})² - 4(${a})(${c}).`,
        `Discriminant = ${b * b} - ${4 * a * c} = ${disc}.`,
        `Since the discriminant ${disc} is positive, there are two real solutions.`,
        `Square root of discriminant: √${disc} = ${fmt(Math.sqrt(disc))}.`,
        `First solution: x₁ = (-${b} + ${fmt(Math.sqrt(disc))}) / (2 × ${a}) = ${fmt(x1)}.`,
        `Second solution: x₂ = (-${b} - ${fmt(Math.sqrt(disc))}) / (2 × ${a}) = ${fmt(x2)}.`,
        `Therefore the two solutions are x₁ = ${fmt(x1)} and x₂ = ${fmt(x2)}.`,
        `Verification: substitute each value back to confirm both satisfy the original equation.`,
      ],
    };
  } else if (disc === 0) {
    const x = -b / (2 * a);
    return {
      type: "quadratic",
      steps: [
        `We need to solve the quadratic equation: ${text.trim()}`,
        `Standard form ax² + bx + c = 0 with a = ${a}, b = ${b}, c = ${c}.`,
        `Using the quadratic formula: x = (-b ± √(b² - 4ac)) / 2a.`,
        `Calculate the discriminant: b² - 4ac = ${b * b} - ${4 * a * c} = ${disc}.`,
        `The discriminant equals zero, which means there is exactly one real solution.`,
        `This is called a repeated root or perfect square solution.`,
        `x = -b / 2a = -(${b}) / (2 × ${a}) = ${fmt(x)}.`,
        `Therefore x = ${fmt(x)} is the only solution (repeated root).`,
      ],
    };
  } else {
    const realPart = fmt(-b / (2 * a));
    const imagPart = fmt(Math.sqrt(-disc) / (2 * a));
    return {
      type: "quadratic",
      steps: [
        `We need to solve the quadratic equation: ${text.trim()}`,
        `Standard form ax² + bx + c = 0 with a = ${a}, b = ${b}, c = ${c}.`,
        `Using the quadratic formula: x = (-b ± √(b² - 4ac)) / 2a.`,
        `Calculate the discriminant: b² - 4ac = ${b * b} - ${4 * a * c} = ${disc}.`,
        `The discriminant is negative (${disc}), so there are no real number solutions.`,
        `The solutions are complex numbers involving the imaginary unit i = √(-1).`,
        `Real part = -b / 2a = ${realPart}.`,
        `Imaginary part = √(${-disc}) / 2a = ${imagPart}.`,
        `Therefore x₁ = ${realPart} + ${imagPart}i and x₂ = ${realPart} - ${imagPart}i.`,
      ],
    };
  }
}

// Arithmetic evaluator
function solveArithmetic(text) {
  const clean = text.replace(/[^0-9+\-*/().%\s^]/g, "").trim();
  if (!clean || clean.length < 3) return null;
  try {
    const safe = clean
      .replace(/\^/g, "**")
      .replace(/(\d+)%/g, "($1/100)");
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${safe})`)();
    if (typeof result !== "number" || !isFinite(result)) return null;
    return {
      type: "arithmetic",
      steps: [
        `We need to evaluate the expression: ${text.trim()}`,
        `First, identify the operations involved following BODMAS/PEDMAS order.`,
        `BODMAS stands for: Brackets, Orders (powers), Division, Multiplication, Addition, Subtraction.`,
        `Solve expressions inside brackets first, then powers, then multiplication and division left to right.`,
        `Finally perform addition and subtraction from left to right.`,
        `Evaluating the full expression: ${clean} = ${result}.`,
        `Therefore the final answer is ${result}.`,
      ],
    };
  } catch (_) {
    return null;
  }
}

// Percentage problems
function solvePercentage(text) {
  const t = text.toLowerCase();
  const m1 = t.match(/(\d+\.?\d*)\s*%\s*of\s*(\d+\.?\d*)/);
  if (m1) {
    const pct = parseFloat(m1[1]);
    const num = parseFloat(m1[2]);
    const ans = (pct / 100) * num;
    return {
      type: "percentage",
      steps: [
        `We need to find ${pct}% of ${num}.`,
        `The word "percent" means "per hundred", so ${pct}% means ${pct} out of every 100.`,
        `To find a percentage of a number, we use the formula: (Percentage / 100) × Number.`,
        `Substituting the values: (${pct} / 100) × ${num}.`,
        `First divide: ${pct} ÷ 100 = ${pct / 100}.`,
        `Then multiply: ${pct / 100} × ${num} = ${ans}.`,
        `Therefore ${pct}% of ${num} = ${ans}.`,
      ],
    };
  }
  return null;
}

// Master math dispatcher
// ── Simple interest solver ────────────────────────────────────
function solveSimpleInterest(text) {
  const t = text.toLowerCase();
  if (!t.includes("simple interest") && !t.includes("s.i")) return null;
  const p = text.match(/principal[^\d]*(\d+\.?\d*)/i);
  const r = text.match(/rate[^\d]*(\d+\.?\d*)/i);
  const time = text.match(/time[^\d]*(\d+\.?\d*)/i) || text.match(/(\d+\.?\d*)\s*year/i);
  if (!p || !r || !time) return null;
  const P = parseFloat(p[1]);
  const R = parseFloat(r[1]);
  const T = parseFloat(time[1]);
  const SI = (P * R * T) / 100;
  const A  = P + SI;
  return {
    type:"simple_interest",
    steps:[
      `We are given a simple interest problem with Principal P = ${P}, Rate R = ${R}%, Time T = ${T} years.`,
      `The formula for Simple Interest is: SI = (P × R × T) / 100.`,
      `Substituting the values: SI = (${P} × ${R} × ${T}) / 100.`,
      `Calculating the numerator: ${P} × ${R} × ${T} = ${P*R*T}.`,
      `Dividing by 100: SI = ${P*R*T} / 100 = ${SI}.`,
      `Therefore the Simple Interest is ${SI}.`,
      `The total Amount after ${T} years = P + SI = ${P} + ${SI} = ${A}.`,
      `Always remember: Simple Interest grows linearly, the same amount every year.`,
    ],
  };
}

// ── Speed Distance Time solver ────────────────────────────────
function solveSDT(text) {
  const t = text.toLowerCase();
  if (!t.includes("speed") && !t.includes("distance") && !t.includes("time")) return null;
  const d = text.match(/distance[^\d]*(\d+\.?\d*)/i);
  const s = text.match(/speed[^\d]*(\d+\.?\d*)/i);
  const tm = text.match(/time[^\d]*(\d+\.?\d*)/i);
  if (d && s && !tm) {
    const dist = parseFloat(d[1]), spd = parseFloat(s[1]);
    const time = dist / spd;
    return { type:"sdt", steps:[
      `We need to find Time given Distance = ${dist} and Speed = ${spd}.`,
      `The fundamental relationship is: Distance = Speed × Time.`,
      `Rearranging for Time: Time = Distance / Speed.`,
      `Substituting values: Time = ${dist} / ${spd}.`,
      `Therefore Time = ${parseFloat(time.toFixed(4))} hours (or equivalent unit).`,
      `Always check: Speed × Time = ${spd} × ${time.toFixed(2)} = ${dist} ✓`,
    ]};
  }
  if (s && tm && !d) {
    const spd = parseFloat(s[1]), time = parseFloat(tm[1]);
    const dist = spd * time;
    return { type:"sdt", steps:[
      `We need to find Distance given Speed = ${spd} and Time = ${time}.`,
      `Using the formula: Distance = Speed × Time.`,
      `Substituting: Distance = ${spd} × ${time}.`,
      `Therefore Distance = ${dist}.`,
    ]};
  }
  if (d && tm && !s) {
    const dist = parseFloat(d[1]), time = parseFloat(tm[1]);
    const spd = dist / time;
    return { type:"sdt", steps:[
      `We need to find Speed given Distance = ${dist} and Time = ${time}.`,
      `Using the formula: Speed = Distance / Time.`,
      `Substituting: Speed = ${dist} / ${time}.`,
      `Therefore Speed = ${parseFloat(spd.toFixed(4))}.`,
    ]};
  }
  return null;
}

// ── Area and Perimeter solver ─────────────────────────────────
function solveGeometry(text) {
  const t = text.toLowerCase();
  const num = (str) => parseFloat(str);
  // Circle area
  if ((t.includes("area") || t.includes("circumference")) && t.includes("circle")) {
    const r = text.match(/radius[^\d]*(\d+\.?\d*)/i) || text.match(/r\s*=\s*(\d+\.?\d*)/i);
    if (r) {
      const R = num(r[1]);
      const area = Math.PI * R * R;
      const circ = 2 * Math.PI * R;
      return { type:"geometry", steps:[
        `We have a circle with radius r = ${R}.`,
        `The formula for area of a circle is: A = π × r².`,
        `Substituting: A = π × ${R}² = π × ${R*R}.`,
        `Area = ${parseFloat(area.toFixed(4))} square units.`,
        `The formula for circumference is: C = 2 × π × r.`,
        `Circumference = 2 × π × ${R} = ${parseFloat(circ.toFixed(4))} units.`,
        `Remember: π (pi) ≈ 3.14159265.`,
      ]};
    }
  }
  // Rectangle
  if (t.includes("rectangle") || t.includes("area") && t.includes("length") && t.includes("width")) {
    const l = text.match(/length[^\d]*(\d+\.?\d*)/i);
    const w = text.match(/width[^\d]*(\d+\.?\d*)/i) || text.match(/breadth[^\d]*(\d+\.?\d*)/i);
    if (l && w) {
      const L = num(l[1]), W = num(w[1]);
      return { type:"geometry", steps:[
        `We have a rectangle with length = ${L} and width = ${W}.`,
        `Area of rectangle = length × width = ${L} × ${W} = ${L*W} square units.`,
        `Perimeter of rectangle = 2 × (length + width) = 2 × (${L} + ${W}) = ${2*(L+W)} units.`,
        `The diagonal = √(length² + width²) = √(${L*L} + ${W*W}) = ${parseFloat(Math.sqrt(L*L+W*W).toFixed(4))} units.`,
      ]};
    }
  }
  // Triangle area
  if (t.includes("triangle") && (t.includes("area") || t.includes("base") || t.includes("height"))) {
    const b = text.match(/base[^\d]*(\d+\.?\d*)/i);
    const h = text.match(/height[^\d]*(\d+\.?\d*)/i);
    if (b && h) {
      const B = num(b[1]), H = num(h[1]);
      return { type:"geometry", steps:[
        `We have a triangle with base = ${B} and height = ${H}.`,
        `The formula for area of a triangle is: A = ½ × base × height.`,
        `Substituting values: A = ½ × ${B} × ${H}.`,
        `A = 0.5 × ${B*H} = ${0.5*B*H} square units.`,
        `This formula works for all triangles — right, acute, and obtuse.`,
      ]};
    }
  }
  return null;
}

// ── Master math dispatcher (expanded) ────────────────────────
function solveMath(text) {
  return (
    solvePercentage(text)    ||
    solveSimpleInterest(text)||
    solveSDT(text)           ||
    solveGeometry(text)      ||
    solveQuadratic(text)     ||
    solveLinear(text)        ||
    solveArithmetic(text)    ||
    null
  );
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
  const hasThoery = theoryWords.some((w) => t.includes(w));
  return hasThoery ? "theory" : "problem";
}

// ════════════════════════════════════════════════════════════
// SCRIPT GENERATOR
// ════════════════════════════════════════════════════════════
async function generateScript(inputText, subject, level) {
  const qType = detectQuestionType(inputText);
  console.log(`  Question type: ${qType.toUpperCase()}`);

  // ── Math: use symbolic solver first ─────────────────────
  if (qType === "math") {
    const solved = solveMath(inputText);
    if (solved) {
      console.log(`  Math solved symbolically: ${solved.type}`);
      return { steps: solved.steps, qType };
    }
    console.log("  Math solver could not parse, falling back to AI...");
  }

  // ── AI generation for theory + unsolved math ─────────────
  let rawSteps = [];

  if (generator) {
    try {
      let prompt = "";

      if (qType === "theory") {
        prompt =
          `You are an expert ${subject} teacher for ${level} students. ` +
          `Write a complete explanation of this topic. ` +
          `Cover: definition, key concepts, how it works, real examples, importance. ` +
          `Write one clear sentence per point. Cover fully, do not stop early. ` +
          `No bullet points, no numbers. Separate with period and newline. ` +
          `Topic: ${inputText.slice(0, 500)}`;
      } else {
        prompt =
          `You are an expert ${subject} teacher for ${level} students. ` +
          `Solve this problem completely step by step. ` +
          `First state what is given. Then show every calculation step. ` +
          `Then state the final answer clearly. ` +
          `One sentence per step. No bullet points. No numbers. ` +
          `Problem: ${inputText.slice(0, 500)}`;
      }

      const result = await generator(prompt, {
        max_new_tokens: qType === "theory" ? 600 : 400,
        num_beams: 3,
        no_repeat_ngram_size: 4,
        early_stopping: true,
      });

      const raw = result[0]?.generated_text || "";
      rawSteps = raw
        .split(/(?<=[.!?])\s+|\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 12);
    } catch (err) {
      console.warn("Model inference failed:", err.message);
    }
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
    if (words.length > wordLimit) return words.slice(0, wordLimit).join(" ") + ".";
    return s.endsWith(".") || s.endsWith("!") || s.endsWith("?") ? s : s + ".";
  });

  console.log(`  Slides generated: ${finalSteps.length}`);
  return { steps: finalSteps, qType };
}

// ── Fallback script ───────────────────────────────────────────
function fallbackScript(inputText, subject, level, qType) {
  const ctx = inputText.split(/[.!?\n]/)[0].trim().slice(0, 100);
  if (qType === "math" || qType === "problem") {
    return [
      `This is a ${subject} problem. Let us carefully analyse what is being asked.`,
      `Read the problem fully and identify all values and quantities that are given.`,
      `Write down what the question is asking you to find or calculate.`,
      `Choose the correct formula or theorem that applies to this type of problem.`,
      `Substitute the known values into the formula one step at a time.`,
      `Perform each calculation carefully, showing all working clearly.`,
      `Check your units are consistent throughout the entire solution.`,
      `Write the final answer clearly with the correct unit or label.`,
      `Verify by substituting your answer back into the original equation.`,
    ];
  }
  return [
    `Today we explore the topic of ${ctx} in ${subject}.`,
    `This is a fundamental concept every ${level} student needs to understand clearly.`,
    `We begin by defining exactly what this term or concept means in ${subject}.`,
    `Understanding the key principles behind this topic helps build a strong foundation.`,
    `There are several important characteristics that define how this works in practice.`,
    `Scientists have studied this concept through careful experimentation and observation.`,
    `In real life this concept has many important applications we encounter every day.`,
    `Let us now look at a specific example that makes this concept easier to understand.`,
    `This topic connects closely to other important areas within ${subject}.`,
    `In summary mastering this concept is essential for deeper study of ${subject}.`,
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
      const safeText = steps[i].replace(/"/g, "'").replace(/[^\w\s.,!?'-]/g, "");
      const cmd = `edge-tts --text "${safeText}" --voice en-US-JennyNeural --write-media "${outPath}"`;
      await new Promise((res) => {
        exec(cmd, (err) => {
          if (err) {
            exec(
              `ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 4 "${outPath}" -y`,
              () => res()
            );
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
async function generateFrames(steps, subject, jobId, qType = "theory") {
  const paths = [];

  const accents  = ["#6c63ff","#a09cf7","#4ecdc4","#e96479","#6c63ff","#a09cf7","#4ecdc4","#e96479"];
  const bgColors = ["#1a1a2e","#16213e","#0f3460","#1a1230","#1a1a2e","#16213e","#0f3460","#1a1230"];

  // Badge colour per type
  const badgeColor = qType === "math" ? "#e96479" : qType === "problem" ? "#f5a623" : "#4ecdc4";
  const badgeLabel = qType === "math" ? "MATH" : qType === "problem" ? "PROBLEM" : "THEORY";

  for (let i = 0; i < steps.length; i++) {
    const framePath = path.join(FRAMES_DIR, `${jobId}_frame${i}.png`);
    const safeText  = steps[i].replace(/'/g, " ").replace(/\\/g, " ").replace(/"/g, " ");
    const safeSubj  = subject.replace(/'/g, " ");
    const accent    = accents[i % accents.length];
    const bgColor   = bgColors[i % bgColors.length];

    const pyScript = `
import textwrap, sys
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable,'-m','pip','install','pillow','--quiet'])
    from PIL import Image, ImageDraw, ImageFont

W, H     = 1280, 720
bg       = '${bgColor}'
accent   = '${accent}'
badge_c  = '${badgeColor}'
badge_l  = '${badgeLabel}'
text     = '${safeText}'
subject  = '${safeSubj}'
step     = ${i + 1}
total    = ${steps.length}
out      = r'${framePath.replace(/\\/g, "\\\\")}'

img  = Image.new('RGB', (W, H), bg)
draw = ImageDraw.Draw(img)

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2],16) for i in (0,2,4))

def with_alpha(h, a):
    r,g,b = hex_to_rgb(h)
    return (r,g,b,a)

img_rgba = img.convert('RGBA')
overlay  = Image.new('RGBA', (W, H), (0,0,0,0))
od       = ImageDraw.Draw(overlay)

# Top accent bar
od.rectangle([0,0,W,8], fill=(*hex_to_rgb(accent),255))

# Step pill
od.rounded_rectangle([60,46,270,92], radius=22, fill=(*hex_to_rgb(accent),40))

# Badge pill top center
od.rounded_rectangle([W//2-60,46,W//2+60,92], radius=22, fill=(*hex_to_rgb(badge_c),50))

img_rgba = Image.alpha_composite(img_rgba, overlay)
img = img_rgba.convert('RGB')
draw = ImageDraw.Draw(img)

try:
    font_big = ImageFont.truetype("arial.ttf", 44)
    font_med = ImageFont.truetype("arial.ttf", 20)
    font_sm  = ImageFont.truetype("arial.ttf", 15)
except:
    font_big = ImageFont.load_default()
    font_med = font_big
    font_sm  = font_big

# Step label
draw.text((165,69), f'STEP {step} OF {total}', font=font_med, fill=accent, anchor='mm')

# Badge label
draw.text((W//2, 69), badge_l, font=font_med, fill=badge_c, anchor='mm')

# Subject top right
draw.text((W-60,69), subject.upper(), font=font_sm, fill='#ffffff55', anchor='rm')

# Main explanation text — word wrap
lines = textwrap.wrap(text, width=46)
total_h = len(lines) * 64
start_y = (H // 2) - (total_h // 2) + 10
for idx, line in enumerate(lines):
    draw.text((W//2, start_y + idx*64), line, font=font_big, fill='white', anchor='mm')

# Progress bar
bar_x2 = 60 + int(1160 * step / total)
draw.rounded_rectangle([60,666,1220,672], radius=3, fill='#ffffff15')
draw.rounded_rectangle([60,666,bar_x2,672], radius=3, fill=accent)

# Watermark
draw.text((62,700), 'PictoPRO', font=font_sm, fill='#ffffff33')

img.save(out)
print('frame ok')
`.trim();

    await new Promise((resolve, reject) => {
      const tmpPy = path.join(FRAMES_DIR, `${jobId}_draw${i}.py`);
      fs.writeFileSync(tmpPy, pyScript, "utf8");
      exec(`python "${tmpPy}"`, (err, stdout, stderr) => {
        fs.existsSync(tmpPy) && fs.unlinkSync(tmpPy);
        if (err) {
          console.warn(`Frame ${i} error: ${stderr}`);
          exec(
            `ffmpeg -y -f lavfi -i color=c=0x1a1a2e:size=1280x720:rate=1 -frames:v 1 "${framePath}"`,
            (e2) => { if (e2) reject(e2); else resolve(); }
          );
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
          `-shortest`,
          `-pix_fmt yuv420p`,
          `"${clipPath}"`,
        ].join(" ");
        exec(cmd, (err) => {
          if (err) rej(new Error("Clip error: " + err.message));
          else res();
        });
      });
      clipPaths.push(clipPath);
    }

    const listPath  = path.join(OUTPUT_DIR, `${jobId}_list.txt`);
    const finalPath = path.join(OUTPUT_DIR, `${jobId}_final.mp4`);

    fs.writeFileSync(
      listPath,
      clipPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n")
    );

    exec(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${finalPath}"`,
      (err) => {
        clipPaths.forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} });
        try { fs.unlinkSync(listPath); } catch (_) {}
        if (err) reject(new Error("Concat error: " + err.message));
        else resolve(finalPath);
      }
    );
  });
}

// ════════════════════════════════════════════════════════════
// HEALTH
// ════════════════════════════════════════════════════════════
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    modelReady: generator !== null,
    message: "Picto PRO — fully local, no API keys, math solver built in",
  });
});

// ════════════════════════════════════════════════════════════
// ROUTE 1 — Text input
// ════════════════════════════════════════════════════════════
app.post("/api/generate/text", async (req, res) => {
  try {
    const { text, subject, level } = req.body;
    if (!text || text.trim().length < 3)
      return res.status(400).json({ error: "Input text too short." });

    // Delete all previous job files first
    cleanAllDirs();

    const jobId = "job_" + Date.now();
    console.log(`\n[${jobId}] Text input`);

    const { steps, qType } = await generateScript(text, subject, level);
    const audioPaths  = await generateVoiceovers(steps, jobId);
    const framePaths  = await generateFrames(steps, subject, jobId, qType);
    const videoPath   = await combineToVideo(framePaths, audioPaths, jobId);

    // Clean frames and audio — keep only final video
    [...framePaths, ...audioPaths].forEach((p) => {
      try { fs.unlinkSync(p); } catch (_) {}
    });

    console.log(`[${jobId}] Done ✓`);
    res.json({
      jobId,
      steps,
      qType,
      videoUrl: `${req.protocol}://${req.get("host")}/outputs/${path.basename(videoPath)}`,
    });
  } catch (err) {
    console.error("Text route error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// ROUTE 2 — Image input
// ════════════════════════════════════════════════════════════
app.post("/api/generate/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "No image received." });

    const { subject = "General", level = "High school" } = req.body;

    // Delete all previous job files first
    const jobId = "job_" + Date.now();
    console.log(`\n[${jobId}] Image input: ${req.file.filename}`);

    // Run OCR first, THEN clean old files
    const ocrResult     = await Tesseract.recognize(req.file.path, "eng");
    const extractedText = ocrResult.data.text.trim() || "No text found in image.";
    console.log(`[${jobId}] OCR: ${extractedText.length} chars`);

    // Now safe to clean — OCR already read the image
    cleanAllDirs();

    const { steps, qType } = await generateScript(extractedText, subject, level);
    const audioPaths  = await generateVoiceovers(steps, jobId);
    const framePaths  = await generateFrames(steps, subject, jobId, qType);
    const videoPath   = await combineToVideo(framePaths, audioPaths, jobId);

    [...framePaths, ...audioPaths].forEach((p) => {
      try { fs.unlinkSync(p); } catch (_) {}
    });

    console.log(`[${jobId}] Done ✓`);
    res.json({
      jobId,
      extractedText,
      steps,
      qType,
      videoUrl: `${req.protocol}://${req.get("host")}/outputs/${path.basename(videoPath)}`,
    });
  } catch (err) {
    console.error("Image route error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message || "Unknown error" });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log("");
  console.log("  ✅  Picto PRO Backend — Phase 4 Final");
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  🧮  Built-in math solver active`);
  console.log(`  🗑   Auto file cleanup active`);
  console.log("");
  await loadModel();
});