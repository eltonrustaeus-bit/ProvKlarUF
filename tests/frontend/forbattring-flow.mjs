/* Strukturkontrakt för förbättringssidans skärmflöde.
 *
 * Sidan hade fyra zoner uppe samtidigt, i en ordning som motsade sina egna
 * kommentarer: DOM:en gav Prov, Coach, Rapport, Felbank medan kommentarerna
 * numrerade dem 1, 3, 3, 2. Felbanken kallades "kärnan" i sin egen kommentar
 * och låg sist, under en lärarrapport som kräver tre prov. Kursväljaren låg i
 * zon 1 och det den filtrerade i zon 4, omkring 1500px isär.
 *
 * Arbetsfördelning mot grannfilen: forbattring-behaviour.mjs äger vad sidan
 * GÖR (markering, filtrering, överlämning till träningsläget, rapportspärren).
 * Den här filen äger hur den är BYGGD — skärmarna, ingången och routingen.
 *
 * Användning:  node tests/frontend/forbattring-flow.mjs
 */
import { ROOT, serve, openPage, report } from "./_harness.mjs";

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT);
const R = report("forbattring-flow");
const ok = (n, c, d = "") => R.ok(n, c, d);

const browser = await chromium.launch();
let crash = null;
try {

/* VIKTIGT: syncFromAccount() skriver ALLTID över proviaai_history och
   proviaai_mistakes med vad Supabase svarade. Att seeda dem i localStorage
   fungerar därför inte — datan måste komma via user_exams-rutten.

   Första utkastet seedade localStorage och blev grönt, men bara för att sidan
   samtidigt kastade ett ReferenceError som stoppade init-kedjan innan synken
   hann köra. Testet mätte alltså sin egen seed på en trasig sida. Det är samma
   familj som de fällor riggen redan bär ärr av: en grön siffra som kommer ur
   att ingenting hände. */
const NU = Date.now();
const Q = {
  q1: { q: "Derivatan av x²?",       svar: "x",  fb: "Metoden saknas.",  model: "2x" },
  q2: { q: "Lös 2x+3=9",             svar: "4",  fb: "Räknefel.",        model: "x=3" },
  q3: { q: "Vad är en metafor?",     svar: "-",  fb: "Definition fattas.", model: "En bild." },
};
function examRow(i, course, fel, rätt, concept) {
  const alla = [...fel, ...rätt];
  return {
    id: i,
    created_at: new Date(NU - (10 - i) * 8.64e7).toISOString(),
    course, level: "C", qtype: "mix", material: "",
    exam: { questions: alla.map(id => ({ id, question: Q[id] ? Q[id].q : "Rätt " + id, type: "short" })) },
    answers: alla.map(id => ({ id, answer: Q[id] ? Q[id].svar : "rätt" })),
    result: {
      total_points: rätt.length * 2, max_points: alla.length * 2,
      per_question: [
        ...fel.map(id => ({ id, points: 0, max_points: 2, feedback: Q[id].fb, model_answer: Q[id].model, concept_tag: concept || "", error_tags: ["method_missing"] })),
        ...rätt.map(id => ({ id, points: 2, max_points: 2, feedback: "", model_answer: "", concept_tag: "", error_tags: [] })),
      ],
    },
  };
}

// Två prov i Matematik 2c, ett i Svenska 1 — så kursfiltret har något att
// faktiskt filtrera bort och rapportgrinden vid tre prov går att stå på båda
// sidor om.
const ROWS = [
  examRow(1, "Matematik 2c", ["q1"], [], "Derivata"),
  examRow(2, "Matematik 2c", ["q2"], [], "Ekvationer"),
  examRow(3, "Svenska 1",    ["q3"], [], ""),
];

// Rutten registreras SIST för att vinna över den generella **/rest/v1/** —
// sist registrerad rutt vinner, tvärtemot hur listan läses.
async function open(hash = "", { nExams = 3 } = {}) {
  const { ctx, page } = await openPage(browser, `${srv.url}/f%C3%B6rb%C3%A4ttring.html${hash}`, {
    width: 1280, height: 900, reducedMotion: "reduce",
    waitUntil: "domcontentloaded", settle: 1600,
    mocks: { extra: [["**/rest/v1/user_exams**", r => r.fulfill({ json: ROWS.slice(0, nExams) })]] },
  });
  return { ctx, page };
}

const synliga = page => page.evaluate(() =>
  [...document.querySelectorAll(".xf-screen")]
    .filter(s => s.getBoundingClientRect().height > 0).map(s => s.dataset.screen));

// F1: fem skärmar, exakt en synlig.
{
  const { ctx, page } = await open();
  const alla = await page.evaluate(() => [...document.querySelectorAll(".xf-screen")].map(s => s.dataset.screen));
  const v = await synliga(page);
  ok("F1 fem skärmar finns och exakt en syns",
    alla.length === 5 && v.length === 1 && v[0] === "hem", JSON.stringify({ alla, v }));
  await ctx.close();
}

// F2: ingången säger något bara den kan veta om just den här eleven — inte en
// rubrik som är likadan för varenda besökare ("Din progress på ett ställe").
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => ({
    say: document.querySelector('[data-screen="hem"] .xf-say').textContent,
    sub: document.querySelector('[data-screen="hem"] .xf-sub').textContent,
  }));
  ok("F2 ingången bär elevens egna siffror",
    /3/.test(v.say) && /Matematik 2c/.test(v.sub), JSON.stringify(v));
  await ctx.close();
}

// F3: fyra vägar, var och en med sitt tillstånd i undertexten.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() =>
    [...document.querySelectorAll('[data-screen="hem"] .xf-opt')].map(b => ({
      mål: b.dataset.go, small: (b.querySelector("small")?.textContent || "").trim(),
    })));
  ok("F3 fyra vägar med levande tillstånd",
    v.length === 4 && v.every(x => x.small.length > 0) &&
    JSON.stringify(v.map(x => x.mål)) === '["felbank","prov","coach","rapport"]',
    JSON.stringify(v));
  await ctx.close();
}

// F4: varje väg öppnar sin skärm och skriver sitt fragment.
for (const mål of ["felbank", "prov", "coach", "rapport"]) {
  const { ctx, page } = await open();
  await page.click(`[data-screen="hem"] .xf-opt[data-go="${mål}"]`);
  await page.waitForTimeout(500);
  const v = await synliga(page);
  const h = await page.evaluate(() => location.hash);
  ok(`F4 vägen till ${mål} öppnar sin skärm och skriver fragmentet`,
    v.length === 1 && v[0] === mål && h === "#" + mål, JSON.stringify({ v, h }));
  await ctx.close();
}

// F5: djuplänk. app.html och P.E.R länkar hit med fragment, och landar man på
// ingången i stället är länken en lögn.
{
  const { ctx, page } = await open("#felbank");
  const v = await synliga(page);
  ok("F5 djuplänk landar direkt på rätt skärm", v.length === 1 && v[0] === "felbank", JSON.stringify(v));
  await ctx.close();
}

// F6: tillbaka. Både sidans egen knapp och webbläsarens.
{
  const { ctx, page } = await open();
  await page.click('[data-screen="hem"] .xf-opt[data-go="prov"]');
  await page.waitForTimeout(400);
  await page.click('[data-screen="prov"] .xf-back');
  await page.waitForTimeout(400);
  const a = await synliga(page);
  await page.click('[data-screen="hem"] .xf-opt[data-go="coach"]');
  await page.waitForTimeout(400);
  await page.goBack();
  await page.waitForTimeout(400);
  const b = await synliga(page);
  ok("F6 både sidans tillbaka och webbläsarens leder till ingången",
    a[0] === "hem" && b[0] === "hem", JSON.stringify({ a, b }));
  await ctx.close();
}

// F7: utan data byter ingången roll. En väg som inte går att ta ska säga
// varför — en spärrad knapp utan skäl är en återvändsgränd.
{
  const { ctx, page } = await open("", { nExams: 0 });
  const v = await page.evaluate(() => ({
    vägar: [...document.querySelectorAll('[data-screen="hem"] .xf-opt')].map(b => ({
      mål: b.dataset.go, av: b.disabled === true,
      small: (b.querySelector("small")?.textContent || "").trim(),
    })),
    tillAppen: !!document.querySelector('[data-screen="hem"] a[href="app.html"]'),
  }));
  const spärrade = v.vägar.filter(x => x.av);
  ok("F7 utan data är vägarna spärrade, säger varför, och pekar på appen",
    spärrade.length >= 3 && spärrade.every(x => x.small.length > 0) && v.tillAppen,
    JSON.stringify(v));
  await ctx.close();
}

// F8: de borttagna kontrollerna är borta, inte gömda. En select som bara
// skrollade, en statusrad som visade eleven sin egen roll, en banderoll som
// upprepade sidans struktur, och hela i18n-lagret.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => ["showMode", "showModeLabel", "statusDot", "topStatusText",
    "howToBanner", "howToText", "langBtn", "langLabel", "langPill", "toAppBtn"]
    .filter(id => document.getElementById(id)));
  ok("F8 de borttagna kontrollerna finns inte kvar", v.length === 0, v.join(", "));
  await ctx.close();
}

// F9: den egna muspekaren är borta. Att dölja systemets pekare på två sidor av
// femton var inkonsekvent, och på en sida en lärare ska kunna använda är det
// en risk snarare än en effekt.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => ({
    dot: !!document.getElementById("cursorDot"),
    ring: !!document.getElementById("cursorRing"),
    cursor: getComputedStyle(document.body).cursor,
  }));
  ok("F9 den egna muspekaren är borta", !v.dot && !v.ring && v.cursor !== "none", JSON.stringify(v));
  await ctx.close();
}

// F10: en h1, skärmrubrikerna är h2. Fem h1 i samma DOM ger ingen
// dokumentstruktur alls.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => ({
    h1: document.querySelectorAll("h1").length,
    say: document.querySelector(".xf-say")?.tagName,
  }));
  ok("F10 sidan har exakt en h1 och skärmrubrikerna är h2",
    v.h1 === 1 && v.say === "H2", JSON.stringify(v));
  await ctx.close();
}

// F11: kursväljaren ligger i SAMMA skärm som listan den filtrerar. Förut satt
// den i zon 1 och felbanken i zon 4.
{
  const { ctx, page } = await open("#felbank");
  const v = await page.evaluate(() => ({
    sel: document.getElementById("courseFilter")?.closest(".xf-screen")?.dataset.screen,
    lista: document.getElementById("mistakeList")?.closest(".xf-screen")?.dataset.screen,
  }));
  ok("F11 kursväljaren och listan den filtrerar ligger i samma skärm",
    v.sel === "felbank" && v.lista === "felbank", JSON.stringify(v));
  await ctx.close();
}

// F12: grafen ligger hos proven, inte hos coachen. Den handlar om prov.
{
  const { ctx, page } = await open("#prov");
  const v = await page.evaluate(() => ({
    graf: document.getElementById("progressChart")?.closest(".xf-screen")?.dataset.screen,
    prov: document.querySelectorAll("#examList .xf-opt").length,
  }));
  ok("F12 grafen och provlistan ligger i prov-skärmen",
    v.graf === "prov" && v.prov === 3, JSON.stringify(v));
  await ctx.close();
}

// F13: åtgärdsraden hör till listan. Utan rader finns ingenting att markera,
// och "Träna markerade" ovanför ett gratulationsmeddelande erbjuder en handling
// som inte går att utföra.
{
  const { ctx, page } = await open("#felbank", { nExams: 0 });
  const v = await page.evaluate(() => {
    const b = document.getElementById("trainActions");
    return b ? Math.round(b.getBoundingClientRect().height) : 0;
  });
  ok("F13 åtgärdsraden är borta när det inte finns något att markera", v === 0, String(v));
  await ctx.close();
}


// F14: filtret filtrerar på plats. Ett filter som byter skärm hade varit en
// navigering förklädd till en inställning — det var precis vad showMode-selecten
// gjorde innan den togs bort.
{
  const { ctx, page } = await open("#felbank");
  const före = await page.evaluate(() => document.querySelectorAll("#mistakeList .xf-opt").length);
  await page.selectOption("#courseFilter", "Svenska 1");
  await page.waitForTimeout(500);
  const v = await page.evaluate(() => ({
    n: document.querySelectorAll("#mistakeList .xf-opt").length,
    skärm: [...document.querySelectorAll(".xf-screen")]
      .filter(s => s.getBoundingClientRect().height > 0).map(s => s.dataset.screen)[0],
  }));
  ok("F14 filtret filtrerar utan att byta skärm",
    före === 3 && v.n === 1 && v.skärm === "felbank", JSON.stringify({ före, ...v }));
  await ctx.close();
}

// F15: coachen hämtar vid inträde. Analysen satt förut bakom en knapp med
// texten "Hämta P.E.R-analys" — på en skärm eleven öppnat just för att få den.
{
  const { ctx, page } = await open();
  await page.route("**/api/explain", r => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ answer: "Träna derivata i tre pass." }),
  }));
  await page.click('[data-screen="hem"] .xf-opt[data-go="coach"]');
  await page.waitForTimeout(1500);
  const v = await page.evaluate(() => ({
    text: (document.getElementById("coachText") || {}).textContent,
    knapp: !!document.getElementById("perCoachBtn"),
  }));
  ok("F15 coachen hämtar vid inträde, utan en extra knapp",
    v.text === "Träna derivata i tre pass." && !v.knapp, JSON.stringify(v));
  await ctx.close();
}

// F16: ett misslyckat anrop säger det och går att göra om. Ett streck går inte
// att skilja från "inte hämtat än".
{
  const { ctx, page } = await open();
  let anrop = 0;
  await page.route("**/api/explain", r => {
    anrop++;
    if (anrop === 1) return r.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "Andra försöket gick." }) });
  });
  await page.click('[data-screen="hem"] .xf-opt[data-go="coach"]');
  await page.waitForTimeout(1500);
  const fel = await page.evaluate(() => ({
    text: (document.getElementById("coachText") || {}).textContent,
    retry: !!document.getElementById("perCoachRetry"),
  }));
  await page.click("#perCoachRetry");
  await page.waitForTimeout(1200);
  const efter = await page.evaluate(() => ({
    text: (document.getElementById("coachText") || {}).textContent,
    retry: !!document.getElementById("perCoachRetry"),
  }));
  ok("F16 ett misslyckat anrop säger det och går att göra om",
    fel.retry && fel.text !== "—" && fel.text.length > 3 &&
    efter.text === "Andra försöket gick." && !efter.retry,
    JSON.stringify({ fel, efter }));
  await ctx.close();
}

// F17: nyckeltalen står som etikett och värde. De låg förut i samma zon som
// coach-texten och resultatgrafen — tre sorters avläsning i en hög.
{
  const { ctx, page } = await open("#coach");
  await page.waitForTimeout(800);
  const v = await page.evaluate(() =>
    [...document.querySelectorAll('[data-screen="coach"] .xf-row')].map(r => ({
      dt: (r.querySelector("dt") || {}).textContent,
      dd: (r.querySelector("dd") || {}).textContent,
    })));
  ok("F17 tre nyckeltal som etikett och värde, alla ifyllda",
    v.length === 3 && v.every(x => x.dt && x.dd && x.dd !== "—"), JSON.stringify(v));
  await ctx.close();
}

// F18: rapporten säger varför den inte går än, i stället för att bara spärra
// knappen.
{
  const { ctx, page } = await open("#rapport", { nExams: 2 });
  const v = await page.evaluate(() => ({
    sub: document.querySelector('[data-screen="rapport"] .xf-sub').textContent,
    status: (document.getElementById("reportStatus") || {}).textContent,
    av: (document.getElementById("genReportBtn") || {}).disabled,
  }));
  ok("F18 rapporten säger varför den inte går än",
    /3|tre/.test(v.sub) && /3/.test(v.status) && v.av === true, JSON.stringify(v));
  await ctx.close();
}

// F19: rapporten följer kursen eleven tittar på. Nyckeln lästes ur
// #courseFilter, som numera bor i felbank-skärmen — den finns i DOM:en hela
// tiden eftersom alla fem skärmar ritas, men beroendet är osynligt och värt
// en kontroll.
{
  const { ctx, page } = await open("#felbank");
  await page.selectOption("#courseFilter", "Svenska 1");
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => window.__reportScopeForTest && window.__reportScopeForTest());
  ok("F19 rapportens omfattning följer kursvalet", v === "Svenska 1", String(v));
  await ctx.close();
}

} catch (e) { crash = e; }
await browser.close();
await srv.close();
process.exit(R.finish(crash));
