import { ROOT, serve, openPage, report } from "./_harness.mjs";
// Beteendekontrakt för förbättring.html.
//
// Skrivet FÖRE ombyggnaden i Del B och kört mot den oförändrade sidan. Ett test
// som aldrig sett det gamla beteendet kan inte bevisa att det överlevde — så
// varje kontroll nedan är grön på dagens dragspelsmarkup och ska vara grön på
// zonmarkupen efteråt, utan att en enda av dem skrivs om.
//
// Därför frågar testet aldrig efter en klass som Del B tänker byta. Det frågar
// efter vad eleven kan göra: markera en fråga, träna exakt de markerade,
// filtrera, få rapporten upplåst vid tre prov, byta språk.
//
// Tre fällor, alla bekräftade i projektet tidigare:
//   1. js/site-gate.js POSTar /api/check-role och gör location.replace("/snart.html")
//      om svaret inte är {allow:true}. Den generella **/api/**-mocken räcker inte —
//      check-role måste registreras EFTER den (sist registrerad vinner).
//   2. js/intro-splash.js håller body > * på opacity:0 i ~4,5 s via JS-timer.
//      animation:none biter inte. sessionStorage pi_splash_shown=1 gör det.
//   3. syncFromAccount() skriver ALLTID över proviaai_history och
//      proviaai_mistakes med vad Supabase svarade. Att seeda localStorage
//      direkt ger en tom sida — mätt, inte gissat. Datan seedas därför via
//      user_exams, vilket också betyder att testet går genom mergeMistakes().
//
// Användning:  node tests/frontend/forbattring-behaviour.mjs

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "förbättring.html" });

const R = report("forbattring-behaviour");
const ok = (n, c, d = "") => R.ok(n, c, d);

const browser = await chromium.launch();
const now = Date.now();
let crash = null;
try {

// mergeMistakes() plockar ut varje per_question där max_points > 0 och
// points < max_points. Frågans id blir misstagets id.
const Q = {
  m1: { q: "Vad sker i mitokondrien?", svar: "Fotosyntes", fb: "Blandar ihop organellerna.", model: "Cellandning." },
  m2: { q: "Beskriv glykolysen.", svar: "Delvis", fb: "Saknar ATP-utbytet.", model: "2 ATP netto." },
  m3: { q: "Derivatan av x^2 sin x?", svar: "2x cos x", fb: "Produktregeln saknas.", model: "2x sin x + x^2 cos x." },
};

function examRow(i, course, wrong, right) {
  const all = [...wrong, ...right];
  const per = [
    ...wrong.map(id => ({ id, points: 0, max_points: 2, feedback: Q[id].fb, model_answer: Q[id].model, concept_tag: "", error_tags: [] })),
    ...right.map(id => ({ id, points: 2, max_points: 2, feedback: "", model_answer: "", concept_tag: "", error_tags: [] })),
  ];
  return {
    id: i,
    created_at: new Date(now - (10 - i) * 8.64e7).toISOString(),
    course, level: "C", qtype: "mix", material: "",
    exam: { questions: all.map(id => ({ id, question: Q[id] ? Q[id].q : "Rätt svarad " + id, type: "short" })) },
    answers: all.map(id => ({ id, answer: Q[id] ? Q[id].svar : "rätt" })),
    result: { total_points: right.length * 2, max_points: all.length * 2, per_question: per },
  };
}

// Två prov i Biologi 1, ett i Matematik 2b — så kursfiltret har något att
// faktiskt filtrera bort, och rapportgrinden vid tre prov går att stå på båda
// sidor om.
const ROWS = [
  examRow(1, "Biologi 1", ["m1"], ["r1"]),
  examRow(2, "Biologi 1", ["m2"], ["r2"]),
  examRow(3, "Matematik 2b", ["m3"], ["r3"]),
];

// Servern, mockarna, sessionen och splash-förbikopplingen kommer från
// _harness.mjs. Kvar här: user_exams-raderna, som måste registreras SIST för
// att vinna över den generella **/rest/v1/** — sist registrerad rutt vinner,
// tvärtemot hur listan läses. Registrerad först åt den generella upp den här
// och synken skrev en tom historik över allt testet trodde att det seedat.
//
// Och ett faktum, inte en fälla: syncFromAccount() skriver ALLTID över
// proviaai_history och proviaai_mistakes med vad Supabase svarade. Att seeda
// dem i localStorage fungerar inte — datan måste komma via user_exams, vilket
// också gör att testet går genom mergeMistakes().
// Sidan är ett skärmflöde sedan Del E: en skärm i taget, med location.hash som
// sanning. En kontroll som mäter felbanken måste alltså öppna felbanken —
// annars mäter den ingången, där #mistakeList inte har någon yta.
async function mk(nExams = 3, screen = "") {
  const rows = ROWS.slice(0, nExams);
  return openPage(browser, `${srv.url}/förbättring.html${screen ? "#" + screen : ""}`, {
    height: 900, settle: 1400,
    mocks: { extra: [["**/rest/v1/user_exams**", r => r.fulfill({ json: rows })]] },
  });
}

const pick = page => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("proviaai_train_pick") || "null"); } catch { return null; }
});

// Markerar en fråga utan att anta HUR markeringen ser ut. Idag är det en
// kryssruta inuti raden; efter Del B är det raden själv. Båda vägarna går
// genom togglePickId, som är beteendet som ska överleva.
// Returnerar false i stället för att kasta. En kontroll som inte kan utföras
// ska bli röd bland de andra, inte döda körningen innan någon hunnit skriva ut
// sitt resultat.
// Allt utom rubriken ligger i hopfällda dragspel idag, så kontroller har noll
// yta och både click() och selectOption() faller på det. Fäll ut sektionen som
// innehåller elementet innan du rör det.
//
// Efter Del B finns ingenting att fälla ut och funktionen blir en no-op —
// därför villkorad på att en växlare finns, inte borttagen när dragspelen går.
// Det är den enda platsen i filen som vet att dragspel någonsin funnits.
async function reveal(page, sel) {
  const toggle = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const sec = el.closest(".section.collapsed");
    return sec ? `[data-toggle="#${sec.id}"]` : null;
  }, sel);
  if (!toggle) return;
  const t = page.locator(toggle);
  if (await t.count()) { await t.first().click(); await page.waitForTimeout(500); }
}

async function mark(page, id) {
  await reveal(page, `[data-id="${id}"]`);
  const chk = page.locator(`.pickChk[data-id="${id}"]`);
  try {
    if (await chk.count()) { await chk.first().check({ force: true, timeout: 4000 }); return true; }
    const row = page.locator(`[data-id="${id}"]`);
    if (!(await row.count())) return false;
    await row.first().click({ force: true, timeout: 4000 });
    return true;
  } catch { return false; }
}

// ── 0: sidan har den data testet tror ────────────────────────────────────
// Utan den här hade fälla 3 gett sex gröna kontroller på en tom sida.
{
  const { ctx, page } = await mk(3, "felbank");
  const st = await page.evaluate(() => ({
    hist: JSON.parse(localStorage.getItem("proviaai_history") || "[]").length,
    mist: JSON.parse(localStorage.getItem("proviaai_mistakes") || "[]").length,
  }));
  ok("0a tre prov synkade", st.hist === 3, JSON.stringify(st));
  ok("0b tre misstag härledda", st.mist === 3, JSON.stringify(st));
  ok("0c felbanken renderar dem", (await page.locator("#mistakeList").innerText()).includes("mitokondrien"));

  // Kolumnen är hela poängen med "samma format som app-sidan". Utan en
  // kontroll här kan den glida tillbaka till sidans gamla bredd utan att något
  // annat test märker det.
  //
  // .xf-measure ersattes av skärmväxlarens .xf-inner. Samma mått, samma token
  // (--xf-measure) — och nu samma element som provskaparen bygger.
  const col = await page.evaluate(() => {
    const e = document.querySelector(".xf-screen.on .xf-inner");
    if (!e) return null;
    return { w: Math.round(e.getBoundingClientRect().width), token: getComputedStyle(document.documentElement).getPropertyValue("--xf-measure").trim() };
  });
  ok("0d innehållet ligger i skärmens .xf-inner", !!col, "ingen .xf-inner");
  ok("0d2 kolumnen är app-sidans 580px", col && col.w === 580, JSON.stringify(col));
  await ctx.close();
}

// ── 1: alla fyra mål leder till något synligt ────────────────────────────
// Drivs genom P.E.R:s riktiga väg — [GOTO:#id] i ett svar, sedan klick på
// knappen som dyker upp. __perTestCtx().targets bär id och etikett men INTE
// go(); funktionen överlever inte kontextpaketeringen, så ett test som anropar
// den direkt testar något som ingen elev kan göra.
{
  const { ctx, page } = await mk();
  const ids = await page.evaluate(() => (window.__perTestCtx().targets || []).map(t => t.id));
  // Fyra mål sedan Del E, ett per skärm. Av de gamla fem pekade "trana" och
  // "felbank" på samma zon — ett mål som inte kunde skilja sig från ett annat.
  ok("1a fyra mål deklareras", ids.length === 4, JSON.stringify(ids));
  ok("1b rätt id", ["felbank", "prov", "coach", "rapport"].every(i => ids.includes(i)), JSON.stringify(ids));

  await page.click("#perBubble");
  for (const id of ids) {
    const res = await page.evaluate(async (tid) => {
      const msgs = document.getElementById("perMessages");
      const div = document.createElement("div");
      msgs.appendChild(div);
      window.__perFinalize(div, "Här är den.\n[GOTO:#" + tid + "]");
      const cta = msgs.querySelectorAll(".per-nav-cta");
      const btn = cta[cta.length - 1];
      if (!btn) return { err: "ingen knapp" };
      btn.click();
      await new Promise(r => setTimeout(r, 700));
      // Svagaste kravet som ändå utesluter en no-op: ett ankare som hör till
      // målet finns i DOM:en och har en yta. Listan täcker både dagens
      // dragspel och Del B:s zoner, så kontrollen överlever ombyggnaden.
      // Svagaste kravet som ändå utesluter en no-op: målets EGEN skärm är
      // den som syns. Förut räckte "något ankare har yta", eftersom alla
      // zoner låg uppe samtidigt och en no-op inte gick att skilja från en
      // träff. Nu är exakt en skärm synlig, så kravet kan vara skarpt.
      const på = [...document.querySelectorAll(".xf-screen")]
        .filter(s => s.getBoundingClientRect().height > 0)
        .map(s => s.dataset.screen);
      return { shown: på.length, skärm: på[0] || null, ville: tid };
    }, id);
    ok(`1c målet "${id}" öppnar sin egen skärm`, !res.err && res.shown === 1 && res.skärm === id, JSON.stringify(res));
  }
  await ctx.close();
}

// ── 2: markering uppdaterar räknare och lagring ──────────────────────────
{
  const { ctx, page } = await mk(3, "felbank");
  const p0 = await pick(page);
  ok("2a inget markerat från start", !p0 || !p0.ids || p0.ids.length === 0, JSON.stringify(p0));

  await mark(page, "m1");
  await page.waitForTimeout(300);
  const p1 = await pick(page);
  ok("2b markeringen hamnar i LS_TRAIN_PICK", !!p1 && p1.ids.map(String).includes("m1"), JSON.stringify(p1));
  ok("2c räknaren visar ett", /\b1\b/.test((await page.textContent("#selCountPill")) || ""), (await page.textContent("#selCountPill")) || "");

  await mark(page, "m3");
  await page.waitForTimeout(300);
  const p2 = await pick(page);
  ok("2d två markerade", p2.ids.length === 2, JSON.stringify(p2.ids));
  ok("2e räknaren följer med", /\b2\b/.test((await page.textContent("#selCountPill")) || ""));
  await ctx.close();
}

// ── 3: "Träna markerade" tar med exakt de markerade ──────────────────────
{
  const { ctx, page } = await mk(3, "felbank");
  await mark(page, "m2");
  await page.waitForTimeout(300);
  // Urvalet ska ligga i lagringen NÄR knappen trycks — det är överlämningen.
  // Efter navigeringen är nyckeln tom igen, för app.html konsumerar den när
  // träningsprovet byggs. Att kräva att den överlever hade varit att kräva att
  // överlämningen misslyckas.
  const handed = await pick(page);
  ok("3a urvalet är överlämnat vid klick", !!handed && handed.ids.map(String).join(",") === "m2", JSON.stringify(handed));

  await reveal(page, "#trainSelectedBtn");
  await page.click("#trainSelectedBtn");
  await page.waitForTimeout(800);
  ok("3b eleven hamnar i träningsläget", page.url().includes("app.html"), page.url());
  await ctx.close();
}

// ── 4: "Rensa val" nollar både markering och räknare ─────────────────────
{
  const { ctx, page } = await mk(3, "felbank");
  await mark(page, "m1");
  await page.waitForTimeout(300);
  await reveal(page, "#clearSelectionBtn");
  await page.click("#clearSelectionBtn");
  await page.waitForTimeout(500);
  const p = await pick(page);
  ok("4a lagringen är tom", !p || p.ids.length === 0, JSON.stringify(p));
  ok("4b räknaren visar noll", /\b0\b/.test((await page.textContent("#selCountPill")) || ""));
  await ctx.close();
}

// ── 5: kursfiltret filtrerar prov och felbank samtidigt ──────────────────
{
  const { ctx, page } = await mk(3, "felbank");
  await reveal(page, "#courseFilter");
  await page.selectOption("#courseFilter", "Matematik 2b");
  await page.waitForTimeout(700);
  const mAll = await page.innerText("body");
  ok("5a mattefrågan syns", mAll.includes("Derivatan"));
  ok("5b biologifrågorna är bortfiltrerade", !mAll.includes("mitokondrien"));

  await page.selectOption("#courseFilter", "Biologi 1");
  await page.waitForTimeout(700);
  const bAll = await page.innerText("body");
  ok("5c biologifrågan syns igen", bAll.includes("mitokondrien"));
  ok("5d mattefrågan är borta", !bAll.includes("Derivatan"));

  await ctx.close();
}

// ── 5e: provlistan är vägen in till felbanken ────────────────────────────
// Egen sida sedan Del E: provlistan bor i prov-skärmen och kursväljaren i
// felbank-skärmen, så kontrollen måste börja på den ena och sluta på den
// andra. Hela raden är kontrollen; tidigare låg en liten knapp inuti ett kort.
{
  const { ctx, page } = await mk(3, "prov");
  const rows = page.locator("#examList .xf-opt");
  if (await rows.count()) {
    const label = (await rows.first().innerText()).split("\n")[0].trim();
    await rows.first().click({ force: true });
    await page.waitForTimeout(800);
    const v = await page.evaluate(() => ({
      skärm: [...document.querySelectorAll(".xf-screen")]
        .filter(s => s.getBoundingClientRect().height > 0).map(s => s.dataset.screen)[0],
      kurs: document.getElementById("courseFilter")?.value,
    }));
    ok("5e klick på provrad öppnar felbanken med kursen vald",
      v.skärm === "felbank" && v.kurs === label, `rad "${label}" → ${JSON.stringify(v)}`);
  } else {
    ok("5e klick på provrad öppnar felbanken med kursen vald", false, "inga provrader renderade");
  }
  await ctx.close();
}

// ── 6: rapportgrinden går vid tre prov ───────────────────────────────────
{
  const { ctx, page } = await mk(2, "rapport");
  ok("6a avstängd vid två prov", await page.isDisabled("#genReportBtn"));
  await ctx.close();
}
{
  const { ctx, page } = await mk(3, "rapport");
  ok("6b påslagen vid tre prov", await page.isEnabled("#genReportBtn"));
  await ctx.close();
}

// ── 7 är borta ───────────────────────────────────────────────────────────
// Kontrollen mätte att språkväxlingen bytte minst 28 etiketter. Hela i18n-
// lagret på sidan är rivet i Del E — beslutet var att ta bort språkväxlaren
// helt, eftersom den fanns på två sidor av femton och de övriga aldrig
// översattes. Det finns ingenting kvar att mäta, så kontrollen tas bort i
// stället för att sänkas till noll och stå kvar som ett tomt löfte.

} catch (e) { crash = e; }

await browser.close();
await srv.close();
process.exit(R.finish(crash));
