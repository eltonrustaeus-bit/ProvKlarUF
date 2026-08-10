import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
// Bevisar att P.E.R får rätt fråga — det som saknades när eleven skrev
// "hjälp mig med frågan" och fick svar om en annan.
//
// Testet läser den faktiska fetch-kroppen till /api/explain. Det är den enda
// nivå som hade fällt focus-buggen: allt ovanför den såg korrekt ut.
//
// Användning:  node tests/frontend/per-exam-context.test.mjs

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "app.html" });

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
const R = report("per-exam-context");
const ok = (n, c, d = "") => R.ok(n, c, d);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
// Mockar och session från _harness.mjs. Provgenereringen och explain-avlyssnaren
// är det den här filen behöver som ingen annan gör och ligger i `extra`, som
// registreras sist och därmed vinner.
await mockApis(page, {
  extra: [
    ["**/api/generate-exam", r => r.fulfill({ json: { ok: true, exam: JSON.parse(JSON.stringify(EXAM)), meta: { quota: { enforced: false } } } })],
    ["**/api/explain", r => {
      try { lastExplain = JSON.parse(r.request().postData() || "{}"); } catch (_) {}
      r.fulfill({ json: { ok: true, answer: "Svar från P.E.R." } });
    }],
  ],
});
await seed(page);

await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
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

// ── T5: påhittat id ritar ingen knapp ─────────────────────────────────────
await page.evaluate(() => {
  const msgs = document.getElementById("perMessages");
  const div = document.createElement("div");
  msgs.appendChild(div);
  window.__perFinalize(div, "Här är svaret.\n[GOTO:#finnsinte]");
});
const t5 = await page.evaluate(() => {
  const last = document.querySelectorAll("#perMessages .per-msg");
  const el = last[last.length - 1];
  return { html: el.innerHTML, cta: el.querySelectorAll(".per-nav-cta").length };
});
ok("T5a ingen knapp för påhittat id", t5.cta === 0, String(t5.cta));
ok("T5b taggen syns inte i texten", !/GOTO/.test(t5.html), t5.html);
ok("T5c svarstexten står kvar", /Här är svaret/.test(t5.html));

// ── T6: giltigt id ger en knapp som navigerar ─────────────────────────────
await page.evaluate(() => {
  const msgs = document.getElementById("perMessages");
  const div = document.createElement("div");
  msgs.appendChild(div);
  window.__perFinalize(div, "Titta på fråga 1 igen.\n[GOTO:#q1]");
});
const t6label = await page.evaluate(() => {
  const ctas = document.querySelectorAll("#perMessages .per-nav-cta");
  return ctas.length ? ctas[ctas.length - 1].textContent : "";
});
ok("T6a knapp med målets etikett", t6label === "Fråga 1 →", t6label);
await page.click("#perMessages .per-nav-cta >> nth=-1");
await page.waitForTimeout(300);
const t6 = await page.evaluate(() => window.__perTestCtx());
ok("T6b klicket flyttade till fråga 1", t6.currentQuestion?.number === 1, String(t6.currentQuestion?.number));

// ── T7: sidnavigation fungerar som förut ──────────────────────────────────
await page.evaluate(() => {
  const msgs = document.getElementById("perMessages");
  const div = document.createElement("div");
  msgs.appendChild(div);
  window.__perFinalize(div, "Se planerna.\n[GOTO:pricing.html]");
});
const t7 = await page.evaluate(() => {
  const ctas = document.querySelectorAll("#perMessages .per-nav-cta");
  const el = ctas[ctas.length - 1];
  return { tag: el.tagName, href: el.getAttribute("href"), text: el.textContent };
});
ok("T7a sidlänk är en <a>", t7.tag === "A", t7.tag);
ok("T7b rätt href", t7.href === "pricing.html", String(t7.href));
ok("T7c känd etikett behålls", t7.text === "Se alla priser →", t7.text);

// ── T7d/e: okänd href ritar ingen knapp (Fynd 2) ───────────────────────────
// href-grenen satte tidigare navBtn.href = href rakt av, oavsett om sidan
// fanns i _perNavLabels — etiketten föll bara tillbaka på 'Gå dit →'. Ett
// svar med [GOTO:javascript:alert(1)] gav då en klickbar
// <a href="javascript:alert(1)">. #id-grenen skyddar sig redan genom att slå
// upp målet innan knappen ritas (T5 ovan); href-grenen ska nu göra detsamma
// mot _perNavLabels — samma beteende som T5 när ingen knapp ritas alls.
await page.evaluate(() => {
  const msgs = document.getElementById("perMessages");
  const div = document.createElement("div");
  msgs.appendChild(div);
  window.__perFinalize(div, "Gör så här.\n[GOTO:javascript:alert(1)]");
});
const t7de = await page.evaluate(() => {
  const msgsEls = document.querySelectorAll("#perMessages .per-msg");
  const el = msgsEls[msgsEls.length - 1];
  return { html: el.innerHTML, cta: el.querySelectorAll(".per-nav-cta").length };
});
ok("T7d ingen knapp för okänd sida", t7de.cta === 0, String(t7de.cta));
ok("T7e svarstexten står kvar", /Gör så här/.test(t7de.html), t7de.html);

// ── T8: ett mål som kastar dödar inte sidan ───────────────────────────────
// T6:s go() bytte fråga, och exam-flow.js (renderQuestion) döljer med rätta
// P.E.R-panelen vid varje frågebyte — annars låg förra frågans samtal kvar
// ovanpå den nya. Det betyder att knappen vi ska klicka på nedan är osynlig
// just nu; utan en explicit öppning hänger Playwright-klicket på en timeout.
// Vi öppnar den precis som eleven skulle, via hjälpknappen, i stället för
// att låta produktionskoden hålla panelen öppen åt oss (se task-3-report.md,
// granskningsfynd 1/2 — den kompensationen hörde inte hemma i shared.js).
await page.click(".xf-ask");
await page.waitForTimeout(300);

await page.evaluate(() => {
  window.PER.describe({
    page: "prov",
    targets: [{ id: "trasig", label: "Trasigt mål", go: function () { throw new Error("avsiktligt"); } }]
  });
  const msgs = document.getElementById("perMessages");
  const div = document.createElement("div");
  msgs.appendChild(div);
  window.__perFinalize(div, "Testa detta.\n[GOTO:#trasig]");
});
let pageDied = false;
page.once("pageerror", () => { pageDied = true; });
await page.click("#perMessages .per-nav-cta >> nth=-1");
await page.waitForTimeout(300);
ok("T8a felet fångas, sidan lever", pageDied === false);
ok("T8b sidan svarar fortfarande", await page.evaluate(() => typeof window.PER?.describe === "function"));

// ── T9: closeExam() nollställer manifestet vid inlämning (Fynd 1) ─────────
// Innan fixen tog closeExam() bort xf-in-exam/xf-per-open men rörde aldrig
// manifestet. Eleven som lämnade in ett prov och stod på resultatskärmen och
// frågade "varför fick jag så lågt?" fick svar om provets sista fråga i
// stället för om resultatet, eftersom __perManifest fortfarande pekade dit.
await page.route("**/api/grade", r => r.fulfill({ json: { ok: true, result: {
  total_points: 4, max_points: 6,
  per_question: [
    { id: "q1", points: 2, max_points: 2, feedback: "bra", model_answer: "Beta" },
    { id: "q2", points: 0, max_points: 2, feedback: "fel", model_answer: "Beta" },
    { id: "q3", points: 2, max_points: 2, feedback: "bra", model_answer: "Beta" }
  ]
} } }));

// T8 skrev över manifestet med ett eget testmanifest utan fokus. Navigera till
// en riktig fråga så att publish() sätter ett äkta manifest igen — annars
// bevisar testet ingenting om closeExam().
await page.click(".xf-dot >> nth=1"); await page.waitForTimeout(300);
const beforeSubmit = await page.evaluate(() => window.__perTestCtx());
ok("T9a manifestet pekar på en fråga innan inlämning", beforeSubmit.currentQuestion?.number === 2,
   JSON.stringify(beforeSubmit.currentQuestion));

page.once("dialog", d => d.accept().catch(() => {}));
await page.click(".xf-dot >> nth=2"); await page.waitForTimeout(200);
await page.click(".xf-exam-nav .xf-btn.primary"); // "Lämna in" på sista frågan, 2 obesvarade → confirm()
await page.waitForSelector("#xf .xf-screen[data-screen='result'].on", { timeout: 15000 });
await page.waitForTimeout(200);
const afterSubmit = await page.evaluate(() => window.__perTestCtx());
ok("T9b currentQuestion är borta på resultatskärmen", !afterSubmit.currentQuestion, JSON.stringify(afterSubmit.currentQuestion));
ok("T9c examState är borta på resultatskärmen", !afterSubmit.examState, JSON.stringify(afterSubmit.examState));
ok("T9d targets är borta på resultatskärmen", !afterSubmit.targets, JSON.stringify(afterSubmit.targets));

// ── T10: debouncad publish() återuppväcker inte manifestet (Fynd A) ───────
// T9 bevisar closeExam() för flervalsfrågor — de publicerar synkront vid
// varje klick, debouncen (publishSoon, 500ms) berörs aldrig där. Kortsvar
// publicerar 500ms efter senaste tangenttryck: fyller eleven sista fältet
// och trycker "Lämna in" direkt hinner closeExam() nollställa manifestet
// FÖRE den redan schemalagda timern brinner — och timern kör publish() på
// nytt mot ett S.exam som fortfarande finns kvar, mitt på resultatskärmen.
// Kräver type:"short"; T9:s type:"mc" kan per konstruktion aldrig fånga det.
const EXAM_SHORT = {
  title: "Prov", level: "C",
  questions: Array.from({ length: 3 }, (_, n) => ({
    id: "s" + (n + 1), type: "short", points: 2,
    question: "Kortsvarsfråga " + (n + 1) + " om cellandning",
    topic: "Cellandning", cognitive_level: "förstå", source_references: ["s.1"],
    model_answer: "svar", scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" }
  }))
};

const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page2 = await ctx2.newPage();
await mockApis(page2, {
  extra: [
    ["**/api/generate-exam", r => r.fulfill({ json: { ok: true, exam: JSON.parse(JSON.stringify(EXAM_SHORT)), meta: { quota: { enforced: false } } } })],
    ["**/api/explain", r => r.fulfill({ json: { ok: true, answer: "Svar." } })],
    ["**/api/grade", r => r.fulfill({ json: { ok: true, result: {
      total_points: 6, max_points: 6,
      per_question: [
        { id: "s1", points: 2, max_points: 2, feedback: "bra", model_answer: "svar" },
        { id: "s2", points: 2, max_points: 2, feedback: "bra", model_answer: "svar" },
        { id: "s3", points: 2, max_points: 2, feedback: "bra", model_answer: "svar" }
      ]
    } } })],
  ],
});
await seed(page2);

await page2.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
await page2.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
await page2.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary"); await page2.waitForTimeout(200);
await page2.fill("#xf .xf-screen[data-screen='subject'] .xf-input", "Biologi 1");
await page2.click("#xf .xf-screen[data-screen='subject'] .xf-btn.primary"); await page2.waitForTimeout(200);
await page2.click("#xf .xf-screen[data-screen='aim'] .xf-btn.primary"); await page2.waitForTimeout(200);
await page2.fill("#xf .xf-screen[data-screen='material'] .xf-area", "Cellandning sker i mitokondrien. Glykolysen ger 2 ATP. Citronsyracykeln sker i matrix. Elektrontransportkedjan kräver syre.");
await page2.waitForTimeout(150);
await page2.click("#xf .xf-screen[data-screen='material'] .xf-btn.primary"); await page2.waitForTimeout(200);
await page2.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
await page2.waitForSelector(".xf-exam.on", { timeout: 10000 });
await page2.waitForTimeout(300);

// Fråga 1 och 2 fylls i och hinner publicera/lugna sig innan vi går vidare —
// bara sista fältet ska stå i debounce-fönstret när "Lämna in" trycks.
await page2.fill(".xf-answer", "syre");
await page2.waitForTimeout(700);
await page2.click(".xf-dot >> nth=1"); await page2.waitForTimeout(200);
await page2.fill(".xf-answer", "vatten");
await page2.waitForTimeout(700);

// Fråga 3 — sista fältet fylls och "Lämna in" trycks OMEDELBART, inom de
// 500 ms publishSoon debouncar med. Alla tre frågor är besvarade → inget
// confirm()-block att vänta på.
await page2.click(".xf-dot >> nth=2"); await page2.waitForTimeout(200);
await page2.fill(".xf-answer", "syre");
await page2.click(".xf-exam-nav .xf-btn.primary");
await page2.waitForSelector("#xf .xf-screen[data-screen='result'].on", { timeout: 15000 });
// MACHINE_MIN_MS (1400 ms) har redan passerat innan resultatskärmen visas —
// gott om marginal för att den 500 ms-debouncade timern, om den INTE
// nollställdes av closeExam(), redan hunnit brinna och återupplivat manifestet.
await page2.waitForTimeout(200);

const t10ctx = await page2.evaluate(() => window.__perTestCtx());
const t10sees = await page2.evaluate(() => { var el = document.getElementById("perSees"); return el ? el.textContent : ""; });
ok("T10a currentQuestion är borta på resultatskärmen (kortsvar, direkt inlämning)", !t10ctx.currentQuestion, JSON.stringify(t10ctx.currentQuestion));
ok("T10b examState är borta på resultatskärmen (kortsvar, direkt inlämning)", !t10ctx.examState, JSON.stringify(t10ctx.examState));
ok("T10c perSees ljuger inte uppåt efter att debounce-fönstret passerat", t10sees === "ser: den här sidan", t10sees);

// ── T11: closeExam() rensar draftTimer, inte bara publishTimer (Fynd 1) ───
// Samma inlämning som T10 ovan råkar också vara det exakta fönstret för den
// här buggen: fråga 3 fylls i och "Lämna in" trycks OMEDELBART, så
// saveDraftSoon() hinner schemalägga en 800ms-timer precis innan closeExam()
// körs. lsDel(draftKey()) tar bort utkastet så fort den mockade rättningen
// svarar (nästan direkt) — men maskinytan håller resultatskärmen borta i
// minst MACHINE_MIN_MS (1400ms, redan passerat här). Rensades inte
// draftTimer i closeExam() hann den brinna i det fönstret och skriva
// tillbaka utkastet (S.exam nollställs först vid "Nytt ämne") — eleven
// erbjuds då "Fortsätt provet du började" för ett prov som redan är rättat.
const t11draft = await page2.evaluate(() => localStorage.getItem("exgen_flow_draft_u1"));
ok("T11 utkastet återuppstår inte efter inlämning", t11draft === null, String(t11draft));

await ctx2.close();

await ctx.close();
await browser.close();
await srv.close();

process.exit(R.finish());
