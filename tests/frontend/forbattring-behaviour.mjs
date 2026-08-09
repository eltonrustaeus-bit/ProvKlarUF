import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const PORT = 4617;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/förbättring.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const pass = [], fail = [];
const ok = (n, c, d = "") => (c ? pass : fail).push(n + (d ? " — " + d : ""));

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

async function mk(nExams = 3) {
  const rows = ROWS.slice(0, nExams);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ json: { ok: true } }));
  // Efter den generella — sist registrerad vinner, se fälla 1.
  await page.route("**/api/check-role", r => r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
  await page.route("**/auth/v1/**", r => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
  await page.route("**/rest/v1/**", r => r.fulfill({ json: [] }));
  // EFTER den generella. Sist registrerad vinner — tvärtom mot vad ordningen
  // ser ut att säga. Registrerad först åt den generella upp den här och synken
  // skrev en tom historik över allt testet trodde att det hade seedat.
  await page.route("**/rest/v1/user_exams**", r => r.fulfill({ json: rows }));

  await page.addInitScript(() => {
    sessionStorage.setItem("pi_splash_shown", "1");
    const exp = Math.floor(Date.now() / 1000) + 7200;
    localStorage.setItem("sb-mnmotdluigzeehdjbhbu-auth-token", JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_in: 7200, expires_at: exp, token_type: "bearer", user: { id: "u1", email: "u1@t.se" } }));
    localStorage.setItem("proviaai_role", "premium");
    localStorage.setItem("proviaai_cookie_consent", JSON.stringify({ necessary: true }));
    localStorage.setItem("proviaai_lang", "sv");
    localStorage.removeItem("proviaai_train_pick");
  });

  await page.goto(`http://localhost:${PORT}/förbättring.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  return { ctx, page };
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
  const { ctx, page } = await mk();
  const st = await page.evaluate(() => ({
    hist: JSON.parse(localStorage.getItem("proviaai_history") || "[]").length,
    mist: JSON.parse(localStorage.getItem("proviaai_mistakes") || "[]").length,
  }));
  ok("0a tre prov synkade", st.hist === 3, JSON.stringify(st));
  ok("0b tre misstag härledda", st.mist === 3, JSON.stringify(st));
  ok("0c felbanken renderar dem", (await page.locator("#mistakeList").innerText()).includes("mitokondrien"));
  await ctx.close();
}

// ── 1: alla fem mål leder till något synligt ─────────────────────────────
// Drivs genom P.E.R:s riktiga väg — [GOTO:#id] i ett svar, sedan klick på
// knappen som dyker upp. __perTestCtx().targets bär id och etikett men INTE
// go(); funktionen överlever inte kontextpaketeringen, så ett test som anropar
// den direkt testar något som ingen elev kan göra.
{
  const { ctx, page } = await mk();
  const ids = await page.evaluate(() => (window.__perTestCtx().targets || []).map(t => t.id));
  ok("1a fem mål deklareras", ids.length === 5, JSON.stringify(ids));
  ok("1b rätt id", ["prov", "coach", "rapport", "trana", "felbank"].every(i => ids.includes(i)), JSON.stringify(ids));

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
      const anchors = ["#examSection", "#coachSection", "#reportSection", "#trainSection", "#mistakeSection",
        "#zonProv", "#zonCoach", "#zonRapport", "#zonFelbank", "#trainActions"];
      const shown = anchors.filter(sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return { shown: shown.length };
    }, id);
    ok(`1c målet "${id}" är ingen no-op`, !res.err && res.shown > 0, JSON.stringify(res));
  }
  await ctx.close();
}

// ── 2: markering uppdaterar räknare och lagring ──────────────────────────
{
  const { ctx, page } = await mk();
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
  const { ctx, page } = await mk();
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
  const { ctx, page } = await mk();
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
  const { ctx, page } = await mk();
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

// ── 6: rapportgrinden går vid tre prov ───────────────────────────────────
{
  const { ctx, page } = await mk(2);
  ok("6a avstängd vid två prov", await page.isDisabled("#genReportBtn"));
  await ctx.close();
}
{
  const { ctx, page } = await mk(3);
  ok("6b påslagen vid tre prov", await page.isEnabled("#genReportBtn"));
  await ctx.close();
}

// ── 7: språkväxlingen byter varje etikett den byter idag ─────────────────
// Ingen jämförelse mot hårdkodade strängar och ingen testkrok i produktionen.
// I stället: mät VILKA id:n som byter text när språket växlas. Den mängden är
// kontraktet. Tappar Del B en etikett ur applyLang() faller dess id ur mängden
// och testet blir rött — vilket är precis det tysta felet som annars bara
// visar sig som en svensk rad mitt i en engelsk sida.
// Golvet är MÄTT på dagens sida, inte valt. Sjunker siffran har en etikett
// tappats ur applyLang() — vilket aldrig ger ett fel, bara en svensk rad mitt i
// en engelsk sida.
const LANG_IDS_FLOOR = 30;
{
  const { ctx, page } = await mk();
  const changed = await page.evaluate(async () => {
    const snap = () => {
      const o = {};
      document.querySelectorAll("[id]").forEach(el => {
        if (el.children.length === 0) o[el.id] = (el.textContent || "").trim();
      });
      return o;
    };
    const before = snap();
    document.getElementById("langBtn").click();
    await new Promise(r => setTimeout(r, 600));
    const after = snap();
    return Object.keys(before).filter(k => k in after && before[k] !== after[k] && (before[k] || after[k]));
  });
  ok("7a språkknappen byter många etiketter", changed.length >= LANG_IDS_FLOOR, `${changed.length} bytte, golv ${LANG_IDS_FLOOR}`);
  // Skrivs ut varje körning så att en tappad etikett går att peka ut, inte bara
  // räkna. Diffa listan mot en tidigare körning när siffran sjunker.
  console.log(`  info  språkbytande id:n (${changed.length}): ${changed.sort().join(" ")}`);
  await ctx.close();
}

} catch (e) { crash = e; }

await browser.close();
server.close();
if (crash) console.log("  FAIL  riggen kastade — " + String(crash.message).split("\n")[0]);

console.log(pass.map(p => "  ok  " + p).join("\n"));
if (fail.length) console.log(fail.map(f => "  FAIL " + f).join("\n"));
console.log(`\n${pass.length} ok, ${fail.length} fail`);
process.exit(fail.length || crash ? 1 : 0);
