import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
// Kontraktstester för P.E.R:s sidmanifest (shared.js).
//
// Bakgrunden: js/exam-flow.js skickade { focus: … } medan getPageContext()
// kopierade åtta andra nycklar. Objektet försvann utan ett ljud och P.E.R
// svarade om fel fråga. Testerna nedan låser fast att (a) focus når fram,
// (b) en okänd nyckel varnar i stället för att försvinna, och (c) den gamla
// setPerContext-vägen fortsätter fungera.
//
// Användning:  node tests/frontend/per-manifest.test.mjs

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/pricing.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(4610, r));

const pass = [], fail = [];
const ok = (n, c, d = "") => (c ? pass : fail).push(n + (d ? " — " + d : ""));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const warns = [];
page.on("console", m => { if (m.type() === "warning") warns.push(m.text()); });
await page.route("**/api/**", r => r.fulfill({ json: { ok: true } }));
// js/site-gate.js (tillagd 2026-08-07) frågar /api/check-role innan sidan
// visas och redirectar till /snart.html om allow inte är true. Registreras
// efter den generiska /api/**-mocken ovan — Playwright matchar sist
// registrerad rutt först, så den här vinner för just check-role.
await page.route("**/api/check-role", r => r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
await page.route("**/auth/v1/**", r => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
await page.route("**/rest/v1/**", r => r.fulfill({ json: [] }));
await page.goto("http://localhost:4610/pricing.html", { waitUntil: "networkidle" });

// ── T1: describe finns på den publika ytan ────────────────────────────────
ok("T1 PER.describe finns", await page.evaluate(() => typeof window.PER?.describe === "function"));

// ── T2: focus når fram som currentQuestion ────────────────────────────────
const t2 = await page.evaluate(() => {
  window.PER.describe({
    page: "prov",
    focus: { kind: "question", number: 7, of: 12, text: "Vad är derivatan?", options: ["A1", "B2"], answer: "B", answered: true },
    targets: [{ id: "q7", label: "Fråga 7", hint: "derivata", go: function () {} }],
    state: { answered: 5, remaining: 7, elapsed: "12:40" }
  });
  return window.__perTestCtx();
});
ok("T2a nummer når fram", t2.currentQuestion?.number === 7, JSON.stringify(t2.currentQuestion));
ok("T2b text når fram", t2.currentQuestion?.text === "Vad är derivatan?");
ok("T2c elevens svar når fram", t2.currentQuestion?.answer === "B");
ok("T2d state blir examState", t2.examState?.answered === 5 && t2.examState?.remaining === 7);
ok("T2e targets når fram utan go", t2.targets?.length === 1 && t2.targets[0].id === "q7" && t2.targets[0].go === undefined, JSON.stringify(t2.targets));

// ── T3: okänd toppnyckel varnar, resten används ───────────────────────────
warns.length = 0;
const t3 = await page.evaluate(() => {
  window.PER.describe({ page: "prov", blaj: 1, focus: { number: 2, text: "x" } });
  return window.__perTestCtx();
});
await page.waitForTimeout(50);
ok("T3a varning loggad", warns.some(w => /okänd manifestnyckel: blaj/.test(w)), warns.join(" | "));
ok("T3b resten användes ändå", t3.currentQuestion?.number === 2);

// ── T4: okänd state-nyckel varnar ─────────────────────────────────────────
warns.length = 0;
await page.evaluate(() => window.PER.describe({ page: "prov", state: { answered: 1, hittepa: 2 } }));
await page.waitForTimeout(50);
ok("T4 varning för state-nyckel", warns.some(w => /okänd manifestnyckel: state\.hittepa/.test(w)), warns.join(" | "));

// ── T5: ogiltigt target-id kastas bort ────────────────────────────────────
const t5 = await page.evaluate(() => {
  window.PER.describe({ page: "prov", targets: [
    { id: "OK_1", label: "Bra" },
    { id: "inte giltigt", label: "Mellanslag" },
    { id: "", label: "Tomt" },
    { label: "Utan id" }
  ] });
  return window.__perTestCtx();
});
ok("T5 bara giltiga id överlever", t5.targets?.length === 1 && t5.targets[0].id === "ok_1", JSON.stringify(t5.targets));

// ── T6: gamla setPerContext-vägen fungerar och fyller focus ───────────────
const t6 = await page.evaluate(() => {
  window.setPerContext({
    page: "förbättring",
    userScore: 0.62,
    weakAreas: ["Biologi › Cellandning"],
    examState: { answered: 3, remaining: 0 },
    currentQuestion: { number: 1, text: "Gammal väg" }
  });
  return window.__perTestCtx();
});
ok("T6a page följer med", t6.page === "förbättring", t6.page);
ok("T6b userScore bevaras", Math.abs((t6.userScore ?? 0) - 0.62) < 1e-9, String(t6.userScore));
ok("T6c weakAreas bevaras", Array.isArray(t6.weakAreas) && t6.weakAreas[0] === "Biologi › Cellandning");
ok("T6d currentQuestion når fram", t6.currentQuestion?.number === 1);

// ── T7: null nollställer ──────────────────────────────────────────────────
const t7 = await page.evaluate(() => { window.PER.describe(null); return window.__perTestCtx(); });
ok("T7 manifestet nollställs", !t7.currentQuestion && !t7.targets);

// ── T8: raden utan fokus ──────────────────────────────────────────────────
const t8 = await page.evaluate(() => {
  window.PER.describe({ page: "prisplan" });
  return document.getElementById("perSees")?.textContent;
});
ok("T8 raden säger bara sidan", t8 === "ser: den här sidan", String(t8));

// ── T9: raden med fokus ───────────────────────────────────────────────────
const t9 = await page.evaluate(() => {
  window.PER.describe({
    page: "prov",
    focus: { kind: "question", number: 7, of: 12, text: "Q", answer: "B", answered: true },
    state: { answered: 5, remaining: 7, elapsed: "12:40" }
  });
  return document.getElementById("perSees")?.textContent;
});
ok("T9 raden visar fråga, svar och tid", t9 === "ser: fråga 7 av 12 · ditt svar B · 12:40 på provet", String(t9));

// ── T10: raden är dold tills man hovrar ───────────────────────────────────
const t10 = await page.evaluate(() => {
  const el = document.getElementById("perSees");
  return { opacity: getComputedStyle(el).opacity, events: getComputedStyle(el).pointerEvents };
});
ok("T10a dold i vila", t10.opacity === "0", t10.opacity);
ok("T10b fångar inte klick", t10.events === "none", t10.events);

// ── T11: körkortsformen — number utan of ligger inte längre om "den här sidan" ──
// korkortet.html skickar { currentQuestion: { number, text, … } } utan `of`.
// Före fixen krävde raden BÅDA number och of, så den här formen visade
// "ser: den här sidan" trots att P.E.R hade frågan.
const t11 = await page.evaluate(() => {
  window.PER.describe({
    page: "körkortsteorin",
    focus: { number: 5, text: "Vad gäller vid ett övergångsställe utan trafiksignal?", category: "Trafikregler" },
    state: { answered: 4, remaining: 60 }
  });
  return document.getElementById("perSees")?.textContent;
});
ok("T11 raden visar frågenumret utan \"av\"", t11 === "ser: fråga 5", String(t11));

// ── T12: hp-formen — bara text, varken number eller of ────────────────────
// js/hp-app.js skickar { currentQuestion: { text, delprov, node, … } } utan
// number/of alls. Raden ska säga något ärligt och kort, aldrig frågetexten
// rakt av (för lång, bubblan är smal) och aldrig "den här sidan" (P.E.R har
// faktiskt frågan).
const t12 = await page.evaluate(() => {
  window.PER.describe({
    page: "högskoleprovet",
    focus: { text: "Vilket ord passar bäst i meningen: Hon kände sig alldeles ___.", delprov: "ORD" }
  });
  return document.getElementById("perSees")?.textContent;
});
ok("T12a raden är ärlig utan siffra", t12 === "ser: en fråga", String(t12));
ok("T12b raden skriver aldrig ut frågetexten", !/Vilket ord passar/.test(t12 || ""), String(t12));

await ctx.close();
await browser.close();
server.close();

console.log(pass.map(p => "  ok  " + p).join("\n"));
if (fail.length) { console.log(fail.map(f => "  FAIL " + f).join("\n")); }
console.log(`\n${pass.length} ok, ${fail.length} fail`);
process.exit(fail.length ? 1 : 0);
