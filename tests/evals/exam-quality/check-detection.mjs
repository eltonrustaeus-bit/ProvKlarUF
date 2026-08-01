// Offline subject-routing report. No API key, no network, no cost.
//
// Before any model comparison is worth paying for, the exam has to reach the
// right prompt and the right gate overlay. This reports, per fixture and per
// adversarial case, what detectSubjectProfile() and looksLikeMath() decide —
// and what triggered the decision.
//
// Usage:  node tests/evals/exam-quality/check-detection.mjs
//
// Exits 1 when any case is misrouted, so it can gate a run of run-eval.mjs:
//   node tests/evals/exam-quality/check-detection.mjs && \
//     node --env-file=.env.local tests/evals/exam-quality/run-eval.mjs

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FIXTURES } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const A = require(join(root, "api", "_assessment.js"));
const G = require(join(root, "api", "generate-exam.js"));

// Short adversarial cases: realistic one-or-two-sentence excerpts of non-maths
// course material that a student would plausibly paste. Each states the routing
// it must get. These are the cheapest possible regression net for the detector.
const CASES = [
  { name: "historia med procentsiffra", course: "Historia 1b",
    material: "Tredje ståndet utgjorde omkring 97 procent av befolkningen.",
    expectMath: false, expectProfile: "social_sciences" },
  { name: "samhällskunskap med statistik", course: "Samhällskunskap 1b",
    material: "Valdeltagandet mäts med officiell statistik från SCB.",
    expectMath: false, expectProfile: "social_sciences" },
  { name: "programmering med 'funktion'", course: "Programmering 1",
    material: "Funktioner definieras med def och returnerar med return.",
    expectMath: false, expectProfile: "programming" },
  { name: "företagsekonomi med likhetstecken", course: "Företagsekonomi 1",
    material: "Vinst = intäkt minus kostnad per styck.",
    expectMath: false, expectProfile: "generic" },
  { name: "religionskunskap, ren prosa", course: "Religionskunskap 1",
    material: "Buddhismens fyra ädla sanningar beskriver lidandets orsak.",
    expectMath: false, expectProfile: "social_sciences" },
  { name: "biologi med cellandning", course: "Biologi 1",
    material: "Cellandningen sker i mitokondrierna och kräver syre.",
    expectMath: false, expectProfile: "natural_sciences" },
  // Positive controls — these MUST stay maths, or a fix has gone too far.
  { name: "matte via kurstitel", course: "Matematik 3c",
    material: "Beräkna derivatan av funktionen.",
    expectMath: true, expectProfile: "mathematics" },
  { name: "matte via svensk sammansättning", course: "Matematik 2b",
    material: "Lös andragradsekvationen med pq-formeln.",
    expectMath: true, expectProfile: "mathematics" },
  { name: "matte utan kurstitel, tydligt material", course: "Prov",
    material: "Lös ekvationen x² - 6x + 8 = 0 med pq-formeln och kontrollera med kvadratkomplettering.",
    expectMath: true, expectProfile: "mathematics" },
];

// Mirrors the term lists in api/generate-exam.js purely for reporting WHY a
// case matched. Kept here (not exported from production) so the report can
// never change production behaviour; if these drift, the verdict columns still
// come from the real functions.
const ANYWHERE = ["matematik", "algebra", "ekvation", "olikhet", "polynom", "logaritm",
  "derivat", "integral", "geometri", "trigonometri", "cosinus", "tangens",
  "vektor", "sannolikhet", "parabel", "kvadrat", "funktion", "komplexa tal", "diskret matematik"];
const WORD_START = ["math", "potens", "exponent", "sinus", "statistik", "bråk", "procent", "linjär"];

function whyMath(course, material) {
  const s = `${course}\n${material}`.toLowerCase();
  const reasons = [];
  for (const t of ANYWHERE) if (s.includes(t)) reasons.push(`term:${t}`);
  for (const t of WORD_START) if (new RegExp(`\\b${t}`, "i").test(s)) reasons.push(`ordstart:${t}`);
  if (/\bln\b/.test(s)) reasons.push("ln");
  if (s.includes("f(x)")) reasons.push("f(x)");
  if (/[=<>]/.test(s) && /[xyz]/.test(s)) {
    const xyz = (s.match(/[^\s]*[xyz][^\s]*/g) || []).slice(0, 3).join(",");
    reasons.push(`tecken:[=<>]+[xyz] (xyz sitter i: ${xyz})`);
  }
  if (/\b\d+\s*\/\s*\d+\b/.test(s)) reasons.push("bråkform a/b");
  if (/[a-z]\s*\^\s*\d/.test(s)) reasons.push("potens x^n");
  if (/[√]/.test(s)) reasons.push("rottecken");
  return reasons;
}

let failures = 0;
function report(name, course, material, expectProfile, expectMath) {
  const profile = A.detectSubjectProfile(course, material);
  const isMath = G.looksLikeMath(course, material);
  const profileOk = profile === expectProfile;
  const mathOk = isMath === expectMath;
  const ok = profileOk && mathOk;
  if (!ok) failures++;
  const mark = ok ? "OK  " : "FEL ";
  console.log(`${mark} ${name.padEnd(38)} profil=${profile.padEnd(17)} matte=${String(isMath).padEnd(5)}`);
  if (!profileOk) console.log(`       väntad profil: ${expectProfile}`);
  if (!mathOk) {
    console.log(`       väntat matte=${expectMath}; utlöst av: ${whyMath(course, material).join(" | ") || "(ingen regel — oväntat)"}`);
  }
  return ok;
}

console.log("Ämnesroutning — fixtures\n");
for (const f of FIXTURES) report(f.id, f.course, f.material, f.expectProfile, f.expectMath);

console.log("\nÄmnesroutning — motexempel\n");
for (const c of CASES) report(c.name, c.course, c.material, c.expectProfile, c.expectMath);

console.log("");
if (failures) {
  console.error(`${failures} fall routas fel.`);
  console.error("En felroutad kurs får fel systemprompt (t.ex. MATTE-LÄGE på ett historieprov)");
  console.error("och fel ämnesöverlägg i grinden. Mätningar av modellkvalitet på sådana fall är");
  console.error("inte jämförbara — laga routningen först.");
  process.exit(1);
}
console.log("All routning korrekt.");
