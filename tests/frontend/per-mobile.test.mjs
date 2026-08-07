// UI-regression: P.E.R-bubblan (#perWidget) får aldrig täcka provinnehåll på
// mobil, och den fasta botten-navigeringen i provet får aldrig hamna under den.
//
// Invarianten är densamma som när det här testet skrevs; ytan den mäter mot är
// inte det. Fram till 2026-08-07 renderades provet av den fyrstegs-wizarden i
// app.html (.qBox, #floatingGradeBar, .answerTa), och shared.js krympte
// bubblan via klassen `per-minimized` när ett svarsfält fick fokus vid
// innerWidth <= 480. Wizarden ligger nu kvar bakom `hidden` som motor — inga av
// dess element är synliga för en elev — så ett test mot dem bevisar ingenting.
//
// Den P.E.R-ledda provskaparen (js/exam-flow.js) löser samma problem på ett
// annat sätt, efter att bubblan mättes ligga ovanpå sista raden i ett
// svarsalternativ vid 390px: under provet är den flytande bubblan HELT dold
// (`body.xf-in-exam #perWidget { display:none }`) och ingången är i stället
// `.xf-ask` inne i provarket. Öppnas panelen därifrån sätter flödet
// `body.xf-per-open`, som släpper fram widgeten lyft ovanför `.xf-exam-nav`.
//
// Testet bevisar därför tre saker per bredd:
//   1. Bubblan är osynlig medan provet pågår
//   2. Öppnas den via .xf-ask syns den, och överlappar varken arkets innehåll
//      eller botten-navigeringen
//   3. Vid frågebyte går den tillbaka i sitt gömda läge
//
// Fristående — använder repots egen playwright-dep. Hoppas över (exit 0) om
// chromium saknas.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let chromium;
try {
  ({ chromium } = await import(ROOT + "/node_modules/playwright/index.mjs"));
} catch {
  console.log("  SKIP  playwright saknas");
  process.exit(0);
}

const WIDTHS = [320, 375, 390, 430];
let failures = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const fail = (name, err) => { failures++; console.error(`  FAIL  ${name}\n        ${err?.message || err}`); };

function rectsOverlap(a, b) {
  return a && b && a.width > 0 && b.width > 0 &&
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Provet måste laddas över http, inte file://, eftersom js/site-gate.js och
// motorn båda talar med /api.
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/app.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
const PORT = 5310;
await new Promise((r) => server.listen(PORT, r));

const EXAM = {
  title: "Prov", level: "C",
  questions: [
    { id: "q1", type: "mc", points: 2, question: "Var i cellen sker citronsyracykeln?",
      options: ["I cytoplasman", "I mitokondriens matrix", "I cellkärnan", "I ribosomen"],
      correct_index: 1, topic: "Cellandning", cognitive_level: "förstå",
      source_references: ["s.4"], model_answer: "Matrix.",
      scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" } },
    { id: "q2", type: "short", points: 4,
      question: "En idrottare springer ett långlopp. Förklara varför musklerna övergår till mjölksyrajäsning och vad det innebär för ATP-utbytet.",
      options: [], correct_index: -1, topic: "Jäsning", cognitive_level: "tillämpa",
      source_references: ["s.7"], model_answer: "Vid syrebrist…",
      scoring_rubric: { parts: [{ description: "Orsak", points: 2 }], full_score_requirements: "", partial_credit_notes: "" } }
  ]
};

async function toExam(page) {
  await page.goto(`http://localhost:${PORT}/app.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#xf .xf-screen.on", { timeout: 10000 });
  await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary");
  await page.waitForTimeout(200);
  await page.fill("#xf .xf-screen[data-screen='subject'] .xf-input", "Biologi 1");
  await page.click("#xf .xf-screen[data-screen='subject'] .xf-btn.primary");
  await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='aim'] .xf-btn.primary");
  await page.waitForTimeout(200);
  await page.fill("#xf .xf-screen[data-screen='material'] .xf-area",
    "Cellandning sker i mitokondrien. Glykolysen ger 2 ATP. Citronsyracykeln sker i matrix. Elektrontransportkedjan kräver syre. Jäsning ger bara 2 ATP per glukos vid syrebrist i muskeln.");
  await page.waitForTimeout(150);
  await page.click("#xf .xf-screen[data-screen='material'] .xf-btn.primary");
  await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
  await page.waitForSelector(".xf-exam.on", { timeout: 12000 });
  await page.waitForTimeout(400);
}

async function run() {
  const browser = await chromium.launch();

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 700 } });
    const page = await ctx.newPage();

    await page.route("**/api/check-role", (r) => r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
    await page.route("**/api/generate-exam", (r) => r.fulfill({ json: { ok: true, exam: JSON.parse(JSON.stringify(EXAM)), meta: { quota: { enforced: false } } } }));
    await page.route("**/auth/v1/**", (r) => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
    await page.route("**/rest/v1/**", (r) => r.fulfill({ json: [] }));
    await page.addInitScript(() => {
      const exp = Math.floor(Date.now() / 1000) + 7200;
      localStorage.setItem("sb-mnmotdluigzeehdjbhbu-auth-token", JSON.stringify({
        access_token: "a.b.c", refresh_token: "r", expires_in: 7200, expires_at: exp,
        token_type: "bearer", user: { id: "u1", email: "t@t.se" }
      }));
      localStorage.setItem("proviaai_role", "premium");
      localStorage.setItem("proviaai_cookie_consent", JSON.stringify({ necessary: true }));
    });

    try {
      await toExam(page);

      // 1. Dold medan provet pågår
      const hidden = await page.evaluate(() => getComputedStyle(document.querySelector("#perWidget")).display === "none");
      if (!hidden) throw new Error("#perWidget är synlig under provet");
      ok(`bubblan är dold under provet vid ${width}px`);

      // 2. Öppnad via .xf-ask: syns, men överlappar inget
      await page.click(".xf-ask");
      await page.waitForTimeout(350);

      const widgetBox = await page.locator("#perWidget").boundingBox();
      if (!widgetBox || widgetBox.width < 1) throw new Error("#perWidget syns inte efter .xf-ask");

      const nav = await page.locator(".xf-exam-nav").boundingBox();
      if (rectsOverlap(widgetBox, nav)) throw new Error(`bubblan täcker .xf-exam-nav vid ${width}px`);

      // Arkets faktiska innehåll — alternativen och svarsfältet är det eleven
      // måste kunna läsa och träffa.
      const targets = await page.locator(".xf-mc-opt, .xf-answer, .xf-q-text").all();
      if (!targets.length) throw new Error("hittade inget provinnehåll att mäta mot");
      for (const t of targets) {
        const box = await t.boundingBox();
        if (!box || box.height <= 0) continue;
        if (rectsOverlap(widgetBox, box)) throw new Error(`bubblan täcker provinnehåll vid ${width}px`);
      }
      ok(`öppnad bubbla överlappar varken ark eller nav vid ${width}px`);

      // 3. Frågebyte gömmer den igen
      await page.click(".xf-exam-nav .xf-btn.primary");
      await page.waitForTimeout(350);
      const hiddenAgain = await page.evaluate(() => getComputedStyle(document.querySelector("#perWidget")).display === "none");
      if (!hiddenAgain) throw new Error("bubblan låg kvar synlig efter frågebyte");
      ok(`bubblan göms igen vid frågebyte vid ${width}px`);
    } catch (e) {
      fail(`P.E.R-bubblan vid ${width}px`, e);
    }

    await ctx.close();
  }

  await browser.close();
  server.close();
}

run().then(() => {
  console.log(`\n${failures === 0 ? "Alla" : failures + " misslyckade"} kontroller klara.`);
  if (failures > 0) process.exit(1);
});
