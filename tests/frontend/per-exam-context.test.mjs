import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
// Bevisar att P.E.R får rätt fråga — det som saknades när eleven skrev
// "hjälp mig med frågan" och fick svar om en annan.
//
// Testet läser den faktiska fetch-kroppen till /api/explain. Det är den enda
// nivå som hade fällt focus-buggen: allt ovanför den såg korrekt ut.
//
// Användning:  node tests/frontend/per-exam-context.test.mjs

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/app.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(4611, r));

const EXAM = {
  title: "Prov", level: "C",
  questions: Array.from({ length: 3 }, (_, n) => ({
    id: "q" + (n + 1), type: "mc", points: 2,
    question: "Fråga nummer " + (n + 1) + " om cellandning",
    options: ["Alfa", "Beta", "Gamma", "Delta"], correct_index: 1,
    topic: "Cellandning", cognitive_level: "förstå", source_references: ["s.1"],
    model_answer: "Beta", scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" }
  }))
};

let lastExplain = null;
const pass = [], fail = [];
const ok = (n, c, d = "") => (c ? pass : fail).push(n + (d ? " — " + d : ""));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.route("**/api/check-role", r => r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
await page.route("**/api/generate-exam", r => r.fulfill({ json: { ok: true, exam: JSON.parse(JSON.stringify(EXAM)), meta: { quota: { enforced: false } } } }));
await page.route("**/api/explain", r => {
  try { lastExplain = JSON.parse(r.request().postData() || "{}"); } catch (_) {}
  r.fulfill({ json: { ok: true, answer: "Svar från P.E.R." } });
});
await page.route("**/auth/v1/**", r => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
await page.route("**/rest/v1/**", r => r.fulfill({ json: [] }));

await page.addInitScript(() => {
  const exp = Math.floor(Date.now() / 1000) + 7200;
  localStorage.setItem("sb-mnmotdluigzeehdjbhbu-auth-token", JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_in: 7200, expires_at: exp, token_type: "bearer", user: { id: "u1", email: "u1@t.se" } }));
  localStorage.setItem("proviaai_role", "premium");
  localStorage.setItem("proviaai_cookie_consent", JSON.stringify({ necessary: true }));
});

await page.goto("http://localhost:4611/app.html", { waitUntil: "networkidle" });
await page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary"); await page.waitForTimeout(200);
await page.fill("#xf .xf-screen[data-screen='subject'] .xf-input", "Biologi 1");
await page.click("#xf .xf-screen[data-screen='subject'] .xf-btn.primary"); await page.waitForTimeout(200);
await page.click("#xf .xf-screen[data-screen='aim'] .xf-btn.primary"); await page.waitForTimeout(200);
await page.fill("#xf .xf-screen[data-screen='material'] .xf-area", "Cellandning sker i mitokondrien. Glykolysen ger 2 ATP. Citronsyracykeln sker i matrix. Elektrontransportkedjan kräver syre.");
await page.waitForTimeout(150);
await page.click("#xf .xf-screen[data-screen='material'] .xf-btn.primary"); await page.waitForTimeout(200);
await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
await page.waitForSelector(".xf-exam.on", { timeout: 10000 });
await page.waitForTimeout(300);

// ── T1: manifestet finns direkt, utan att hjälpknappen tryckts ────────────
const t1 = await page.evaluate(() => window.__perTestCtx());
ok("T1a fokus satt utan knapptryck", t1.currentQuestion?.number === 1, JSON.stringify(t1.currentQuestion));
ok("T1b targets finns för alla frågor", t1.targets?.length === 3 && t1.targets[2].id === "q3", JSON.stringify(t1.targets));

// ── T2: fokus följer frågebyte utan hjälpknapp ────────────────────────────
await page.click(".xf-mc-opt >> nth=1");   // svar B på fråga 1, går vidare själv
await page.waitForTimeout(700);
const t2 = await page.evaluate(() => window.__perTestCtx());
ok("T2 fokus flyttade till fråga 2", t2.currentQuestion?.number === 2, JSON.stringify(t2.currentQuestion?.number));

// ── T3: elevens eget svar följer med ──────────────────────────────────────
await page.click(".xf-dot >> nth=0"); await page.waitForTimeout(300);
const t3 = await page.evaluate(() => window.__perTestCtx());
ok("T3a tillbaka på fråga 1", t3.currentQuestion?.number === 1);
ok("T3b svaret B följer med", t3.currentQuestion?.answer === "B", String(t3.currentQuestion?.answer));
ok("T3c answered är sant", t3.currentQuestion?.answered === true);

// ── T4: det som verkligen går ut på nätverket ─────────────────────────────
await page.click(".xf-dot >> nth=2"); await page.waitForTimeout(300);
await page.click(".xf-ask"); await page.waitForTimeout(400);
await page.fill("#perInput", "hjälp mig med frågan");
await page.click("#perSendBtn");
await page.waitForTimeout(900);
ok("T4a explain anropades", !!lastExplain);
ok("T4b rätt frågenummer i kroppen", lastExplain?.pageContext?.currentQuestion?.number === 3,
   JSON.stringify(lastExplain?.pageContext?.currentQuestion));
ok("T4c frågetexten i kroppen", /Fråga nummer 3/.test(lastExplain?.pageContext?.currentQuestion?.text || ""));
ok("T4d targets i kroppen utan go", Array.isArray(lastExplain?.pageContext?.targets)
   && lastExplain.pageContext.targets.length === 3
   && lastExplain.pageContext.targets.every(t => t.go === undefined),
   JSON.stringify(lastExplain?.pageContext?.targets));
ok("T4e provstatus i kroppen", typeof lastExplain?.pageContext?.examState?.answered === "number",
   JSON.stringify(lastExplain?.pageContext?.examState));

await ctx.close();
await browser.close();
server.close();

console.log(pass.map(p => "  ok  " + p).join("\n"));
if (fail.length) { console.log(fail.map(f => "  FAIL " + f).join("\n")); }
console.log(`\n${pass.length} ok, ${fail.length} fail`);
process.exit(fail.length ? 1 : 0);
