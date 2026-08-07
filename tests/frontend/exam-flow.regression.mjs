import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
// Regressionstester för den P.E.R-ledda provskaparen (app.html + js/exam-flow.js)
//
// 26 kontroller av det som gick sönder eller nästan gick sönder när wizarden
// ersattes: dubbletter av fråge-id, hjälpflaggan bakom tvåpoängsräkningen,
// utkast som läckte mellan elever, rättningsfel som låste skärmen, semantik och
// fokus, ingången #train från felbanken, och att ett återupptaget prov går att
// rätta.
// 
// API:erna stubbas — detta testar UI-lagret och bryggan window.ExGenEngine, inte
// OpenAI. För skarpa svar, se tests/live/exam-pipeline.live.mjs.
//
// Användning:
//   node tests/frontend/exam-flow.regression.mjs
//
// Fristående Node-skript som använder repots egen playwright-dep. Ingen runner.
// Exitkod 0 = allt grönt.


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.OUT_DIR || resolve(ROOT, ".test-out");
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");

const SHOT = OUT;
fs.mkdirSync(SHOT, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/app.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(4600, r));

const EXAM = {
  title: "Prov", level: "C",
  questions: [
    { id: "dup", type: "mc", points: 2, question: "Fråga A — var sker citronsyracykeln?", options: ["Cytoplasman", "Matrix", "Kärnan", "Ribosomen"], correct_index: 1, topic: "Cellandning", cognitive_level: "förstå", source_references: ["s.4"], model_answer: "Matrix", scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" } },
    { id: "dup", type: "short", points: 4, question: "Fråga B — förklara jäsning.", options: [], correct_index: -1, topic: "Jäsning", cognitive_level: "tillämpa", source_references: ["s.7"], model_answer: "Vid syrebrist…", scoring_rubric: { parts: [{ description: "Orsak", points: 2 }], full_score_requirements: "", partial_credit_notes: "" } },
    { id: "q3", type: "mc", points: 2, question: "Fråga C — hur många ATP?", options: ["2", "30", "100", "4"], correct_index: 1, topic: "ATP", cognitive_level: "minnas", source_references: ["s.9"], model_answer: "30", scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" } }
  ]
};

let lastGradePayload = null;
const pass = [], fail = [];
const ok = (n, c, d = "") => (c ? pass : fail).push(n + (d ? " — " + d : ""));

const browser = await chromium.launch();

async function mk(opts = {}, gradeOk = true) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 } }, opts));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("PAGEERROR " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.route("**/api/check-role", r => r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
  await page.route("**/api/generate-exam", r => r.fulfill({ json: { ok: true, exam: JSON.parse(JSON.stringify(EXAM)), meta: { quota: { enforced: false } } } }));
  await page.route("**/api/grade", async r => {
    try { lastGradePayload = JSON.parse(r.request().postData() || "{}"); } catch (_) {}
    if (!gradeOk) return r.fulfill({ status: 500, json: { ok: false, error: "server nere" } });
    const qs = lastGradePayload?.questions || [];
    r.fulfill({ json: { ok: true, result: {
      total_points: 5, max_points: 8,
      per_question: qs.map((q, i) => ({ id: String(q.id), points: i === 1 ? 1 : 2, max_points: q.points, feedback: "fb" + i, model_answer: "ma" + i }))
    } } });
  });
  await page.route("**/auth/v1/**", r => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
  await page.route("**/rest/v1/**", r => r.fulfill({ json: [] }));
  return { ctx, page, errs };
}

const session = (uid) => {
  const exp = Math.floor(Date.now() / 1000) + 7200;
  localStorage.setItem("sb-mnmotdluigzeehdjbhbu-auth-token", JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_in: 7200, expires_at: exp, token_type: "bearer", user: { id: uid, email: uid + "@t.se" } }));
  localStorage.setItem("proviaai_role", "premium");
  localStorage.setItem("proviaai_cookie_consent", JSON.stringify({ necessary: true }));
};

async function toExam(page) {
  await page.goto("http://localhost:4600/app.html", { waitUntil: "networkidle" });
  await page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
  await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.fill("#xf .xf-screen[data-screen='subject'] .xf-input", "Biologi 1");
  await page.click("#xf .xf-screen[data-screen='subject'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='aim'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.fill("#xf .xf-screen[data-screen='material'] .xf-area", "Cellandning sker i mitokondrien. Glykolysen ger 2 ATP. Citronsyracykeln sker i matrix. Elektrontransportkedjan kräver syre. Jäsning ger bara 2 ATP per glukos vid syrebrist i muskeln.");
  await page.waitForTimeout(150);
  await page.click("#xf .xf-screen[data-screen='material'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
  await page.waitForSelector(".xf-exam.on", { timeout: 10000 });
  await page.waitForTimeout(300);
}

// ── T1: dubbletter av fråge-id separeras ───────────────────────────────────
{
  const { ctx, page, errs } = await mk();
  await page.addInitScript(session, "u1");
  await toExam(page);
  const ids = await page.evaluate(() => {
    const dots = document.querySelectorAll(".xf-dot").length;
    return { dots };
  });
  ok("T1a dot-rad har 3 frågor", ids.dots === 3, "fick " + ids.dots);

  // svara olika på de två dubblett-frågorna
  await page.click(".xf-mc-opt >> nth=0"); await page.waitForTimeout(500);   // fråga 1 = A
  await page.fill(".xf-answer", "svar på fråga två");
  await page.waitForTimeout(1100);                                            // debounce
  await page.click(".xf-exam-nav .xf-btn.primary"); await page.waitForTimeout(300);
  await page.click(".xf-mc-opt >> nth=2"); await page.waitForTimeout(900);

  await page.waitForSelector("#xf .xf-screen[data-screen='result'].on", { timeout: 15000 });
  const answers = (lastGradePayload?.answers || []);
  const uniq = new Set(answers.map(a => a.id));
  ok("T1b unika id i grade-payload", uniq.size === answers.length, JSON.stringify(answers.map(a => a.id)));
  ok("T1c svaren hamnade rätt", answers[0]?.answer === "A" && answers[1]?.answer === "svar på fråga två" && answers[2]?.answer === "C",
    JSON.stringify(answers.map(a => a.answer)));
  ok("T1d inga konsolfel", errs.length === 0, errs.join(" | "));
  await page.screenshot({ path: SHOT + "/t1-result.png" });
  await ctx.close();
}

// ── T2: hjälpflaggan sätts inte utan att panelen öppnas ────────────────────
{
  const { ctx, page } = await mk();
  await page.addInitScript(session, "u1");
  await toExam(page);
  const before = await page.evaluate(() => document.body.classList.contains("xf-per-open"));
  await page.click(".xf-ask"); await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    perOpen: document.body.classList.contains("xf-per-open"),
    askUsed: document.querySelector(".xf-ask")?.classList.contains("used"),
    widgetVisible: getComputedStyle(document.querySelector("#perWidget")).display !== "none"
  }));
  ok("T2a per-open sätts vid klick", !before && after.perOpen);
  ok("T2b knappen markeras som använd", after.askUsed === true);
  ok("T2c widgeten syns när panelen öppnats", after.widgetVisible === true);

  // byt fråga -> bubblan ska gömmas igen
  await page.click(".xf-exam-nav .xf-btn.primary"); await page.waitForTimeout(300);
  const afterNav = await page.evaluate(() => ({
    perOpen: document.body.classList.contains("xf-per-open"),
    widgetVisible: getComputedStyle(document.querySelector("#perWidget")).display !== "none"
  }));
  ok("T2d bubblan göms vid frågebyte", !afterNav.perOpen && !afterNav.widgetVisible);
  await ctx.close();
}

// ── T3: utkastet är användarskopat ─────────────────────────────────────────
{
  const { ctx, page } = await mk();
  await page.addInitScript(session, "elev-A");
  await toExam(page);
  await page.fill(".xf-answer", "x").catch(() => {});
  await page.click(".xf-mc-opt >> nth=1"); await page.waitForTimeout(600);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf("exgen_flow_draft") === 0));
  ok("T3a utkastnyckeln bär uid", keys.length === 1 && keys[0] === "exgen_flow_draft_elev-A", JSON.stringify(keys));
  await ctx.close();

  // elev B på samma webbläsare
  const b = await mk();
  await b.page.addInitScript(session, "elev-B");
  await b.page.goto("http://localhost:4600/app.html", { waitUntil: "networkidle" });
  await b.page.evaluate(() => localStorage.setItem("exgen_flow_draft_elev-A", JSON.stringify({ ts: Date.now(), uid: "elev-A", exam: { questions: [{ id: "x", question: "hemlig fråga" }] }, answers: { x: "elev A:s svar" } })));
  await b.page.reload({ waitUntil: "networkidle" });
  await b.page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
  await b.page.waitForTimeout(500);
  const txt = await b.page.textContent("#xf .xf-screen[data-screen='start'] .xf-body");
  ok("T3b elev B erbjuds inte elev A:s prov", !/Fortsätt provet/.test(txt || ""), txt);
  await b.ctx.close();
}

// ── T4: rättningsfel lämnar tillbaka till provet, inte död skärm ───────────
{
  const { ctx, page } = await mk({}, false);
  await page.addInitScript(session, "u1");
  await toExam(page);
  await page.click(".xf-mc-opt >> nth=1"); await page.waitForTimeout(500);
  await page.fill(".xf-answer", "svar");
  await page.click(".xf-exam-nav .xf-btn.primary"); await page.waitForTimeout(300);
  page.on("dialog", d => d.accept().catch(() => {}));
  await page.click(".xf-mc-opt >> nth=1");
  await page.waitForTimeout(3500);
  const st = await page.evaluate(() => ({
    exam: document.querySelector(".xf-exam").classList.contains("on"),
    machine: document.querySelector(".xf-machine").classList.contains("on"),
    overflow: document.body.style.overflow,
    nudge: document.querySelector(".xf-nudge").classList.contains("on"),
    answerKept: !!document.querySelector(".xf-mc-opt.sel") || !!document.querySelector(".xf-answer")?.value
  }));
  ok("T4a tillbaka i provet", st.exam === true);
  ok("T4b maskinytan stängd", st.machine === false);
  ok("T4c eleven fick besked", st.nudge === true);
  ok("T4d svaren kvar", st.answerKept === true);
  await page.screenshot({ path: SHOT + "/t4-grade-fail.png" });
  await ctx.close();
}

// ── T5: fokus och semantik ─────────────────────────────────────────────────
{
  const { ctx, page } = await mk();
  await page.addInitScript(session, "u1");
  await page.goto("http://localhost:4600/app.html", { waitUntil: "networkidle" });
  await page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
  await page.waitForTimeout(400);
  const sem = await page.evaluate(() => ({
    h1: [...document.querySelectorAll("h1")].filter(h => !h.closest("[hidden]")).length,
    xfRole: document.getElementById("xf")?.getAttribute("role"),
    skip: document.querySelector(".skip-link")?.getAttribute("href"),
    hidden: document.querySelectorAll("#xf .xf-screen[aria-hidden='true']").length
  }));
  ok("T5a en h1", sem.h1 === 1, "fick " + sem.h1);
  ok("T5b #xf har role=main", sem.xfRole === "main", String(sem.xfRole));
  ok("T5c skip-länk pekar på #xf", sem.skip === "#xf", String(sem.skip));
  ok("T5d dolda skärmar är aria-hidden", sem.hidden === 5, "fick " + sem.hidden);

  await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary");
  await page.waitForTimeout(60);
  const focNow = await page.evaluate(() => ({ cls: document.activeElement?.className || "" }));
  ok("T5e fokus flyttas direkt till nya skärmens rubrik", /xf-say/.test(focNow.cls), JSON.stringify(focNow));
  // Ämnesskärmen flyttar sedan fokus till fältet med flit — kontrollera att det
  // aldrig lämnar den aktiva skärmen.
  await page.waitForTimeout(500);
  const focLater = await page.evaluate(() => ({ cls: document.activeElement?.className || "", inActive: !!document.activeElement?.closest?.(".xf-screen.on") }));
  ok("T5f fokus stannar i aktiv skärm", focLater.inActive === true, JSON.stringify(focLater));
  await ctx.close();
}

// ── T6: träningsläget #train ───────────────────────────────────────────────
{
  const { ctx, page, errs } = await mk();
  await page.addInitScript(session, "u1");
  await page.addInitScript(() => {
    localStorage.setItem("proviaai_mistakes", JSON.stringify([
      { ts: Date.now(), course: "Biologi 1", level: "C", qType: "short", id: "m1", question: "Vad sker i matrix?", user_answer: "vet ej", feedback: "saknar citronsyracykeln", model_answer: "Citronsyracykeln", points: 0, max_points: 3 },
      { ts: Date.now(), course: "Biologi 1", level: "C", qType: "mc", id: "m2", question: "Hur många ATP ger jäsning?", user_answer: "30", feedback: "fel", model_answer: "2", points: 0, max_points: 2 }
    ]));
  });
  // loadExamsFromAccountToLocal() skriver över felbanken från servern vid varje
  // laddning, så den måste sättas efter att den körts — annars testar vi tomt.
  await page.goto("http://localhost:4600/app.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    localStorage.setItem("proviaai_mistakes", JSON.stringify([
      { ts: Date.now(), course: "Biologi 1", level: "C", qType: "short", id: "m1", question: "Vad sker i matrix?", user_answer: "vet ej", feedback: "saknar citronsyracykeln", model_answer: "Citronsyracykeln", points: 0, max_points: 3 },
      { ts: Date.now(), course: "Biologi 1", level: "C", qType: "mc", id: "m2", question: "Hur många ATP ger jäsning?", user_answer: "30", feedback: "fel", model_answer: "2", points: 0, max_points: 2 }
    ]));
  });
  await page.goto("http://localhost:4600/app.html#train", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => {
    const on = document.querySelector("#xf .xf-screen.on");
    return {
      screen: on?.dataset?.screen,
      body: (on?.querySelector(".xf-body")?.textContent || "").slice(0, 200),
      engineMaterial: (document.getElementById("pastedText")?.value || "").length
    };
  });
  ok("T6a #train landar på provkontraktet", st.screen === "contract", "hamnade på " + st.screen);
  ok("T6b motorns materialfält är fyllt", st.engineMaterial > 50, st.engineMaterial + " tecken");
  ok("T6c inga konsolfel", errs.length === 0, errs.join(" | "));
  await page.screenshot({ path: SHOT + "/t6-train.png" });
  await ctx.close();
}

// ── T7: återupptaget prov kan rättas ───────────────────────────────────────
{
  const { ctx, page } = await mk();
  await page.addInitScript(session, "u1");
  await toExam(page);
  await page.click(".xf-mc-opt >> nth=1");
  await page.waitForTimeout(3200);   // klockan måste hinna passera 00:02
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
  await page.waitForTimeout(500);
  const hasResume = await page.evaluate(() => !!Array.from(document.querySelectorAll(".xf-btn")).find(b => /Fortsätt provet/.test(b.textContent)));
  ok("T7a återupptagning erbjuds efter omladdning", hasResume);
  if (hasResume) {
    await page.evaluate(() => Array.from(document.querySelectorAll(".xf-btn")).find(b => /Fortsätt provet/.test(b.textContent)).click());
    await page.waitForSelector(".xf-exam.on", { timeout: 8000 });
    await page.waitForTimeout(300);
    const clock = await page.textContent(".xf-exam-top span:last-child");
    ok("T7b klockan fortsätter, nollställs inte", clock !== "00:00", "klocka: " + clock);
    page.on("dialog", d => d.accept().catch(() => {}));
    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) {
        const b = Array.from(document.querySelectorAll(".xf-exam-nav .xf-btn")).find(x => /Lämna in/.test(x.textContent));
        if (b) { b.click(); return; }
        const n = Array.from(document.querySelectorAll(".xf-exam-nav .xf-btn")).find(x => /Nästa/.test(x.textContent));
        if (n) n.click();
      }
    });
    const gotResult = await page.waitForSelector("#xf .xf-screen[data-screen='result'].on", { timeout: 15000 }).then(() => true).catch(() => false);
    ok("T7c återupptaget prov går att rätta", gotResult);
    await page.screenshot({ path: SHOT + "/t7-resume.png" });
  }
  await ctx.close();
}

await browser.close();
server.close();

console.log("\n════ REGRESSION ════");
pass.forEach(p => console.log("  ok   " + p));
fail.forEach(f => console.log("  FEL  " + f));
console.log(`\n${pass.length} godkända, ${fail.length} fel`);
process.exit(fail.length ? 1 : 0);
