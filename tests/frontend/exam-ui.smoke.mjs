// Browser smoke test for the exam UI fixes (app.html), run in real chromium.
//
// OBS (2026-08-07): det här testet driver renderExam() i den GAMLA wizarden,
// som sedan den P.E.R-ledda provskaparen infördes ligger bakom `hidden`. Den
// koden körs fortfarande — runGenerate anropar renderExam, som sätter
// currentExam och P.E.R-kontexten — så kontrollerna nedan bevakar verklig
// logik. Men de säger ingenting om vad en ELEV ser; det gör
// tests/frontend/exam-flow.regression.mjs och exam-flow.viewports.mjs.
//
// Verifies the visual invariants unit tests can't:
//   1. No internal metadata (ID:/Typ:) leaks to the student
//   2. qMeta shows "Fråga N av M · X poäng"
//   3. A selected MC option does NOT use the correct-green accent before grading
//   4. After markMcResults(), the correct option gets .correct + a ✓ symbol
//
// Standalone — uses the `playwright` core dep. Skips (exit 0) if chromium
// isn't installed. Usage:  node tests/frontend/exam-ui.smoke.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appUrl = pathToFileURL(join(here, "..", "..", "app.html")).href;

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.log(`  SKIP  chromium not launchable (${String(e.message).split("\n")[0]})`);
  process.exit(0);
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone-ish
  // Don't let the external Supabase CDN / auth calls hang the boot.
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("file://")) return route.continue();
    return route.abort();
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderExam === "function", null, { timeout: 10000 });
  // Kill CSS transitions so colour assertions read the resolved target, not a mid-animation value.
  await page.addStyleTag({ content: "*{transition:none!important;animation:none!important}" });

  const exam = {
    title: "Test", level: "C",
    questions: [
      { id: "q1", type: "mc", question: "Vad är 2+3?", options: ["4", "5", "6"], correct_index: 1, points: 1, model_answer: "5" },
      { id: "q2", type: "short", question: "Förklara begreppet ränta.", options: [], correct_index: -1, points: 3, model_answer: "Ränta är kostnaden för att låna pengar." },
    ],
  };

  const bodyText = await page.evaluate((ex) => {
    window.renderExam(ex);
    return document.getElementById("examBody").innerText;
  }, exam);

  check("no 'ID:' leaked to student", !/\bID:/.test(bodyText));
  check("no 'Typ:'/'Type:' leaked to student", !/\bTyp:|\bType:/.test(bodyText));
  check("shows 'Fråga 1 av 2'", /Fråga 1 av 2/.test(bodyText));
  check("shows points label", /1 poäng/.test(bodyText));

  // Resolve the brand accent to its rendered rgb (token-agnostic — no hardcoded hex).
  const ACCENT = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--a)";
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  });

  // Select the first MC option, then read its computed colours.
  const sel = await page.evaluate(() => {
    const opt = document.querySelector('.mcGroup[data-qid="q1"] .mcOpt');
    opt.click();
    const cs = getComputedStyle(opt);
    const letter = getComputedStyle(opt.querySelector(".mcLetter"));
    return { hasSel: opt.classList.contains("sel"), border: cs.borderTopColor, letterBg: letter.backgroundColor };
  });
  check("selected option gets .sel", sel.hasSel === true);
  check("selected border is NOT correct-green", sel.border !== ACCENT);
  check("selected letter chip is NOT correct-green", sel.letterBg !== ACCENT);

  // After grading, the correct option must be marked green + ✓ and locked.
  const graded = await page.evaluate(() => {
    window.markMcResults();
    const correct = document.querySelector('.mcGroup[data-qid="q1"] .mcOpt.correct');
    return {
      hasCorrect: !!correct,
      border: correct ? getComputedStyle(correct).borderTopColor : "",
      hasCheck: correct ? /✓/.test(correct.textContent) : false,
      locked: correct ? correct.disabled : false,
    };
  });
  check("after grading: correct option marked .correct", graded.hasCorrect === true);
  check("after grading: correct option is green (matches accent)", graded.border === ACCENT);
  check("after grading: correct option shows ✓", graded.hasCheck === true);
  check("after grading: options locked", graded.locked === true);
} finally {
  await browser.close();
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log("\nAll exam-UI smoke checks passed.");
