import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
/* Hjälpstegen i gränssnittet — spår B av docs/superpowers/plans/2026-08-14-per-som-larare.md
 *
 * Fyra nivåer har funnits i api/_per-core.js sedan länge (0 ledtråd, 1 begrepp,
 * 2 metod, 3 fullständig lösning). Klienten skickade aldrig någon, så
 * api/explain.js defaultade till 0 vid varje anrop och de tre översta nivåerna
 * var oåtkomliga för alla elever i produktion. Eleven hade heller ingen väg att
 * be om mer än den lägsta.
 *
 * Vad filen mäter, och varför just det:
 *
 *   helpLevel i KROPPEN, inte i en variabel. En nivå som stannar på klienten är
 *   samma bugg som innan, bara med en knapp ovanpå. Testet läser den faktiska
 *   fetch-kroppen till /api/explain — samma nivå som per-exam-context.test.mjs,
 *   den enda som hade fällt originalet.
 *
 *   Taket ritas ur SVARET, aldrig ur klientens egen gissning om provläget.
 *   Servern äger spärren (api/explain.js helpCapFor). Räknade gränssnittet ut
 *   taket själv skulle de två kunna säga olika saker, och den som eleven ser är
 *   den som inte gäller.
 *
 *   Låsta steg RITAS, inte göms. En elev ska se att hjälpen finns och varför den
 *   är stängd just nu. Ett gömt steg är omöjligt att skilja från ett steg som
 *   inte finns.
 *
 * Användning:  node tests/frontend/per-ladder.test.mjs
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "app.html" });

const EXAM = {
  title: "Prov", level: "C",
  questions: Array.from({ length: 3 }, (_, n) => ({
    id: "q" + (n + 1), type: "mc", points: 2,
    question: "Fråga nummer " + (n + 1) + " om derivata",
    options: ["Alfa", "Beta", "Gamma", "Delta"], correct_index: 1,
    topic: "Derivata", cognitive_level: "förstå", source_references: ["s.1"],
    model_answer: "Beta", scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" }
  }))
};

const R = report("per-ladder");
const ok = (n, c, d = "") => R.ok(n, c, d);

// Svaret servern låtsas ge. Sätts om mellan stegen i testet; helpCap är det
// enda som styr hur stegen ritas, precis som i produktion.
let reply = { answer: "Vad tror du händer när du deriverar?", helpCap: 3 };
let bodies = [];
const last = () => bodies[bodies.length - 1] || null;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await mockApis(page, {
  extra: [
    ["**/api/generate-exam", r => r.fulfill({ json: { ok: true, exam: JSON.parse(JSON.stringify(EXAM)), meta: { quota: { enforced: false } } } })],
    ["**/api/explain", r => {
      try { bodies.push(JSON.parse(r.request().postData() || "{}")); } catch (_) { bodies.push(null); }
      // JSON, inte SSE. Båda grenarna i shared.js ska bära fälten, och
      // JSON-grenen är den som går att styra exakt ur ett test.
      r.fulfill({ json: { ok: true, answer: reply.answer, helpCap: reply.helpCap } });
    }],
  ],
});
await seed(page);

await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
await page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary"); await page.waitForTimeout(200);
await page.fill("#xf .xf-screen[data-screen='subject'] .xf-input", "Matematik 3c");
await page.click("#xf .xf-screen[data-screen='subject'] .xf-btn.primary"); await page.waitForTimeout(200);
await page.click("#xf .xf-screen[data-screen='aim'] .xf-btn.primary"); await page.waitForTimeout(200);
await page.fill("#xf .xf-screen[data-screen='material'] .xf-area", "Derivatan av x^2 är 2x. Kedjeregeln gäller sammansatta funktioner. Produktregeln gäller produkter av funktioner. Kvotregeln gäller kvoter.");
await page.waitForTimeout(150);
await page.click("#xf .xf-screen[data-screen='material'] .xf-btn.primary"); await page.waitForTimeout(200);
await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
await page.waitForSelector(".xf-exam.on", { timeout: 10000 });
await page.waitForTimeout(300);

async function ask(text) {
  await page.click(".xf-ask");
  await page.waitForTimeout(350);
  await page.fill("#perInput", text);
  await page.click("#perSendBtn");
  await page.waitForTimeout(800);
}

function steps() {
  return page.evaluate(() => Array.from(document.querySelectorAll("#perMessages .per-steps .per-step"))
    .map(b => ({ level: b.getAttribute("data-level"), text: b.textContent, låst: b.disabled })));
}

/* Ett saknat element ska rapporteras som ett fel, inte som en 30-sekunders
   timeout mitt i körningen. Hela poängen med en rigg som mäter något som inte
   finns än är att den ska hinna säga vad mer som saknas. */
async function klicka(sel) {
  const loc = page.locator(sel);
  if (await loc.count() === 0) { ok("klick på " + sel, false, "elementet finns inte"); return false; }
  if (!(await loc.first().isEnabled())) { ok("klick på " + sel, false, "elementet är låst"); return false; }
  await page.click(sel);
  await page.waitForTimeout(800);
  return true;
}

// ── L1: nivån går ut på nätverket ─────────────────────────────────────────
reply = { answer: "Vad tror du händer när du deriverar?", helpCap: 1 };
await ask("hur löser jag den här?");
ok("L1a explain anropades", !!last());
ok("L1b helpLevel finns i kroppen och är 0", last()?.helpLevel === 0, JSON.stringify(last()?.helpLevel));
ok("L1c clarifyReply finns och är null", last() !== null && "clarifyReply" in last() && last().clarifyReply === null,
   JSON.stringify(last()?.clarifyReply));

// ── L2/L3: stegen ritas, taket kommer ur svaret ───────────────────────────
const s1 = await steps();
ok("L2a tre steg ritas", s1.length === 3, JSON.stringify(s1));
ok("L2b etiketterna är elevens ord",
   s1.map(s => s.text).join("|") === "Förklara begreppet|Visa metoden|Ge mig svaret", JSON.stringify(s1.map(s => s.text)));
// helpCap:1 = prov pågår och eleven har inte svarat. Ett steg öppet, två låsta.
ok("L3a nivå 1 är öppen vid helpCap 1", s1[0]?.låst === false, JSON.stringify(s1[0]));
ok("L3b nivå 2 är låst vid helpCap 1", s1[1]?.låst === true, JSON.stringify(s1[1]));
ok("L3c nivå 3 är låst vid helpCap 1", s1[2]?.låst === true, JSON.stringify(s1[2]));
// Låst betyder synlig. Göms steget kan eleven inte skilja "stängt nu" från
// "finns inte".
ok("L3d låsta steg är kvar i DOM:en", s1.length === 3);

// ── L4: ett klick höjer nivån och syns i loggen ───────────────────────────
// Taket följer svaret, inte klockan: eleven har nu skrivit något, så servern
// höjer till 2 och nästa rad ska rita om sig efter DET, inte efter förra
// svarets 1.
reply = { answer: "Derivatan mäter förändringstakten.", helpCap: 2 };
await klicka("#perMessages .per-steps .per-step[data-level='1']");
ok("L4a klicket skickade nivå 1", last()?.helpLevel === 1, JSON.stringify(last()?.helpLevel));
ok("L4b frågan står i klartext i loggen", await page.evaluate(() =>
   Array.from(document.querySelectorAll("#perMessages .per-msg.user")).some(m => m.textContent === "Förklara begreppet")));
const s2 = await steps();
ok("L4c redan tagna steg erbjuds inte igen", s2.length === 2 && s2[0]?.level === "2", JSON.stringify(s2));
ok("L4d det nya taket öppnade nivå 2", s2[0]?.låst === false && s2[1]?.låst === true, JSON.stringify(s2));

// ── L5: taket öppnas när svaret säger det ─────────────────────────────────
reply = { answer: "Så här ställer du upp den.", helpCap: 3 };
await klicka("#perMessages .per-steps .per-step[data-level='2']");
const s3 = await steps();
ok("L5a nivå 3 är öppen vid helpCap 3", s3.length === 1 && s3[0]?.level === "3" && s3[0]?.låst === false, JSON.stringify(s3));

// ── L6: högsta nivån erbjuder inget mer ───────────────────────────────────
await klicka("#perMessages .per-steps .per-step[data-level='3']");
ok("L6a nivå 3 skickades", last()?.helpLevel === 3, JSON.stringify(last()?.helpLevel));
ok("L6b ingen stege ovanför nivå 3", (await steps()).length === 0);

// ── L7: nivån nollställs när eleven byter fråga ───────────────────────────
// Det här är hela skälet till att nivån hålls per fråga. Utan nollställningen
// bär fråga 2 med sig fråga 1:s "ge mig svaret", och eleven får facit på en
// fråga hen aldrig bett om hjälp med.
await page.click(".xf-dot >> nth=1");
await page.waitForTimeout(400);
reply = { answer: "Vad ser du i uttrycket?", helpCap: 2 };
await ask("och den här då?");
ok("L7a ny fråga börjar om på nivå 0", last()?.helpLevel === 0, JSON.stringify(last()?.helpLevel));
const s4 = await steps();
ok("L7b stegen ritas om från nivå 1", s4.length === 3 && s4[0]?.level === "1", JSON.stringify(s4));
ok("L7c taket följer det nya svaret", s4[2]?.låst === true && s4[1]?.låst === false, JSON.stringify(s4));

// ── L8: den klargörande frågan ────────────────────────────────────────────
reply = {
  answer: "Menar du hur du ställer upp uträkningen, eller hur du tolkar vad frågan ber om?\n[CLARIFY:Uträkningen|Vad frågan ber om]",
  helpCap: 2,
};
await ask("hur gör man här?");
const c1 = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("#perMessages .per-clarify"));
  const msgs = document.querySelectorAll("#perMessages .per-msg.teacher");
  const senaste = msgs[msgs.length - 1];
  return { n: btns.length, etiketter: btns.map(b => b.textContent), text: senaste ? senaste.textContent : "" };
});
ok("L8a två alternativ ritas", c1.n === 2, JSON.stringify(c1.etiketter));
ok("L8b etiketterna kommer ur markören",
   c1.etiketter.join("|") === "Uträkningen|Vad frågan ber om", JSON.stringify(c1.etiketter));
ok("L8c markören syns aldrig för eleven", !/CLARIFY/.test(c1.text), c1.text);
ok("L8d frågetexten står kvar", /Menar du hur du ställer upp/.test(c1.text), c1.text);
// En stege ovanpå en obesvarad motfråga ber eleven eskalera något P.E.R inte
// svarat på än.
ok("L8e ingen stege medan klargörandet väntar", (await steps()).length === 0);

// ── L9: klicket skickar samma fråga igen, nu med svaret på motfrågan ──────
reply = { answer: "Då ställer vi upp den så här.", helpCap: 2 };
await klicka("#perMessages .per-clarify >> nth=0");
ok("L9a clarifyReply bär det valda alternativet", last()?.clarifyReply === "Uträkningen", JSON.stringify(last()?.clarifyReply));
ok("L9b samma elevfråga skickas om", last()?.userQuestion === "hur gör man här?", JSON.stringify(last()?.userQuestion));
ok("L9c nivån höjs inte av ett klargörande", last()?.helpLevel === 0, JSON.stringify(last()?.helpLevel));
ok("L9d stegen är tillbaka när svaret kommit", (await steps()).length === 3);

await ctx.close();
await browser.close();
await srv.close();

process.exit(R.finish());
