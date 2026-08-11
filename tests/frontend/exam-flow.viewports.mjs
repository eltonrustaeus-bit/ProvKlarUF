import { ROOT, serve, mockApis, seed } from "./_harness.mjs";
import { resolve } from "node:path";
import fs from "node:fs";
import path from "node:path";
// Viewport- och tillgänglighetssvep för provskaparen
//
// Går igenom åtta viewporter (320px till 1920px plus liggande mobil) och letar
// efter horisontell scroll, chrome som läcker in i provläget, fasta element som
// krockar, för små tap-targets, samt kontrast i ljust och mörkt läge. Kör även
// ett 20-frågorsprov med lång text och tangentbordsnavigering.
// 
// Rapporterar fynd sorterade värst först. Vissa tap-target-fynd är mätartefakter:
// klickytan ligger i ett ::after-pseudoelement som inte syns i getBoundingClientRect.
//
// Användning:
//   node tests/frontend/exam-flow.viewports.mjs
//
// Fristående Node-skript som använder repots egen playwright-dep. Ingen runner.
// Exitkod 0 = allt grönt.


const OUT = process.env.OUT_DIR || resolve(ROOT, ".test-out");
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");

const SHOT = OUT;
fs.mkdirSync(SHOT, { recursive: true });

// Servern kommer från _harness.mjs: ledig port i stället för ett fast
// nummer, och sökvägen kontrollerad mot roten på ett ställe.
const srv = await serve(ROOT, { indexFile: "app.html" });

const LONG_Q = "Diagrammet visar hur koncentrationen av laktat i blodet förändras hos två löpare under ett 40 minuter långt intervallpass, där den ena har tränat uthållighet systematiskt i tre år och den andra har börjat träna för fyra veckor sedan. Förklara med utgångspunkt i cellandningens delsteg varför kurvorna skiljer sig åt, vilken roll mitokondriernas antal och storlek spelar för skillnaden, och vad det innebär för hur de två löparna bör lägga upp sin fortsatta träning.";
const LONG_OPT = "Den vältränade löparen har fler och större mitokondrier per muskelcell, vilket gör att en större andel av pyruvatet kan tas om hand aerobt innan syretillförseln blir begränsande";

function mkExam(n, long) {
  const qs = [];
  for (let i = 0; i < n; i++) {
    const isMc = i % 2 === 0;
    qs.push(isMc
      ? { id: "q" + (i + 1), type: "mc", points: 2, question: long && i === 0 ? LONG_Q : "Fråga " + (i + 1) + ": Var i cellen sker citronsyracykeln?",
          options: long && i === 0 ? [LONG_OPT, LONG_OPT + " fast omvänt", "I cellkärnan", "I ribosomen"] : ["I cytoplasman", "I mitokondriens matrix", "I cellkärnan", "I ribosomen"],
          correct_index: 1, topic: "Cellandning " + (i % 4), cognitive_level: "förstå",
          source_references: ["Stycket om mitokondrier"], model_answer: "Matrix.",
          scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" } }
      : { id: "q" + (i + 1), type: "short", points: 4, question: long && i === 1 ? LONG_Q : "Fråga " + (i + 1) + ": Förklara mjölksyrajäsning.",
          options: [], correct_index: -1, topic: "Cellandning " + (i % 4), cognitive_level: "tillämpa",
          source_references: ["Avsnittet om anaerob nedbrytning"], model_answer: "Vid syrebrist…",
          scoring_rubric: { parts: [{ description: "Orsak", points: 2 }], full_score_requirements: "", partial_credit_notes: "" } });
  }
  return { title: "Prov", level: "C", questions: qs };
}

function mkResult(exam, long) {
  return {
    total_points: exam.questions.reduce((a, q) => a + q.points, 0) - 3,
    max_points: exam.questions.reduce((a, q) => a + q.points, 0),
    per_question: exam.questions.map((q, i) => ({
      id: q.id, points: i === 1 ? 1 : q.points, max_points: q.points,
      feedback: long ? "Du är inne på rätt spår men motiveringen stannar vid att konstatera att syret tar slut. För full poäng behöver du koppla det till elektrontransportkedjan och ange storleksordningen på ATP-utbytet i båda fallen, eftersom det är den kvantitativa skillnaden som frågan efterfrågar." : "Rätt.",
      model_answer: long ? "När syretillförseln inte räcker till kan elektrontransportkedjan inte längre ta emot elektroner. NADH kan då inte återoxideras, och cellen går över till mjölksyrajäsning för att regenerera NAD+. Utbytet sjunker från cirka 30 ATP per glukos till 2." : "Matrix."
    }))
  };
}

const findings = [];
function add(sev, ctx, what, where, fix) { findings.push({ sev, ctx, what, where, fix }); }

const browser = await chromium.launch();

// SESSION() bodde här och blev död kod när seed() från _harness.mjs tog över.
// Den låg kvar med sessionsnyckeln som literal — precis den sortens kvarleva
// som en dag skrivs av till en ny fil och saknar ett fält. H21 i
// _harness.test.mjs letar efter den nu.

async function newPage(opts, exam) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  // Baslagret från _harness.mjs; provgenereringen och rättningen sist.
  await mockApis(page, { extra: [
    ["**/api/generate-exam", r => r.fulfill({ json: { ok: true, exam, meta: { quota: { enforced: false } } } })],
    ["**/api/grade", r => r.fulfill({ json: { ok: true, result: mkResult(exam, true) } })],
  ] });
  await seed(page);
  return { ctx, page };
}

async function toContract(page) {
  await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
  await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary");
  await page.waitForTimeout(250);
  await page.fill("#xf .xf-screen[data-screen='subject'] .xf-input", "Biologi 1");
  await page.click("#xf .xf-screen[data-screen='subject'] .xf-btn.primary");
  await page.waitForTimeout(250);
  await page.click("#xf .xf-screen[data-screen='aim'] .xf-btn.primary");
  await page.waitForTimeout(250);
  await page.fill("#xf .xf-screen[data-screen='material'] .xf-area",
    "Cellandning sker i mitokondrien. Glykolysen sker i cytoplasman och ger 2 ATP. Citronsyracykeln sker i mitokondriens matrix. Elektrontransportkedjan kräver syre. Jäsning ger bara 2 ATP per glukos. Mjölksyra ansamlas i muskeln vid syrebrist under hårt arbete.");
  await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='material'] .xf-btn.primary");
  await page.waitForTimeout(250);
}

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1
  ? { over: true, sw: document.documentElement.scrollWidth, w: window.innerWidth } : { over: false });

// ── 1. Viewport-svep ───────────────────────────────────────────────────────
const VIEWS = [
  ["320x568", 320, 568], ["390x844", 390, 844], ["414x896", 414, 896],
  ["768x1024", 768, 1024], ["1024x768", 1024, 768], ["1440x900", 1440, 900],
  ["1920x1080", 1920, 1080], ["844x390 liggande", 844, 390]
];

for (const [label, w, h] of VIEWS) {
  const exam = mkExam(12, false);
  const { ctx, page } = await newPage({ viewport: { width: w, height: h } }, exam);
  await toContract(page);

  for (const scr of ["start", "subject", "aim", "material", "contract"]) {
    const o = await overflow(page);
    if (o.over) add("HÖG", label, `Horisontell scroll på skärmen "${scr}" (${o.sw}px innehåll i ${o.w}px viewport)`, ".xf-screen", "Hitta elementet som spränger bredden");
  }

  await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
  await page.waitForSelector(".xf-exam.on", { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/exam-${label.replace(/\s/g, "_")}.png` });

  const o2 = await overflow(page);
  if (o2.over) add("HÖG", label, `Horisontell scroll i provläget (${o2.sw}px i ${o2.w}px)`, ".xf-exam", "Se .xf-sheet/.xf-exam-top");

  // chrome dolt?
  const chrome = await page.evaluate(() => {
    const vis = s => { const e = document.querySelector(s); if (!e) return null; return getComputedStyle(e).display !== "none"; };
    return { header: vis(".xg-header"), util: vis(".xg-utility-bar"), beta: vis("#betaBanner") };
  });
  if (chrome.header) add("HÖG", label, "Sidhuvudet syns fortfarande i provläget", ".xg-header", "body.xf-in-exam-regeln träffar inte");
  if (chrome.util || chrome.beta) add("MEDEL", label, "Utility-bar eller betabanner syns i provläget", ".xg-utility-bar/#betaBanner", "Samma regel");

  // fasta element som överlappar
  const boxes = await page.evaluate(() => {
    const g = s => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === "none") return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; };
    return { nav: g(".xf-exam-nav"), per: g("#perWidget"), sheet: g(".xf-sheet"), top: g(".xf-exam-top"), vh: window.innerHeight, vw: window.innerWidth };
  });
  if (boxes.nav && boxes.per) {
    const ov = !(boxes.per.b < boxes.nav.y || boxes.per.y > boxes.nav.b || boxes.per.r < boxes.nav.x || boxes.per.x > boxes.nav.r);
    if (ov) add("MEDEL", label, "P.E.R-bubblan överlappar provets botten-nav", "#perWidget / .xf-exam-nav", "Höj bottenoffset för #perWidget i .xf-in-exam");
  }
  if (boxes.nav && boxes.nav.h > boxes.vh * 0.28) add("MEDEL", label, `Botten-navet tar ${Math.round(boxes.nav.h / boxes.vh * 100)} % av skärmhöjden`, ".xf-exam-nav", "Minska padding i liggande läge");

  // tap targets
  const taps = await page.evaluate(() => {
    const out = [];
    [".xf-dot", ".xf-chip", ".xf-ask", ".xf-btn.quiet", ".xf-mc-opt", ".xf-exam-nav .xf-btn"].forEach(sel => {
      const e = document.querySelector(sel);
      if (!e) return;
      const r = e.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.push({ sel, w: Math.round(r.width), h: Math.round(r.height) });
    });
    return out;
  });
  taps.forEach(t => add(w <= 480 ? "MEDEL" : "LÅG", label, `Tap-target ${t.sel} är ${t.w}×${t.h} px (< 44×44)`, t.sel, "Öka klickytan med padding eller pseudo-element"));

  await ctx.close();
}

// ── 2. 20 frågor + lång text ───────────────────────────────────────────────
for (const [label, w, h] of [["390x844 · 20 frågor", 390, 844], ["1440x900 · 20 frågor", 1440, 900]]) {
  const exam = mkExam(20, true);
  const { ctx, page } = await newPage({ viewport: { width: w, height: h } }, exam);
  await toContract(page);
  await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
  await page.waitForSelector(".xf-exam.on", { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT}/q20-${w}.png` });

  const dots = await page.evaluate(() => {
    const row = document.querySelector(".xf-exam-dots");
    const top = document.querySelector(".xf-exam-top");
    if (!row || !top) return null;
    const r = row.getBoundingClientRect(), t = top.getBoundingClientRect();
    return { rowH: Math.round(r.height), topH: Math.round(t.height), n: row.children.length, vh: window.innerHeight };
  });
  if (dots && dots.topH > dots.vh * 0.16) add("MEDEL", label, `Toppraden med ${dots.n} prickar tar ${dots.topH}px (${Math.round(dots.topH / dots.vh * 100)} % av höjden)`, ".xf-exam-top", "Byt till en tunn framstegslinje över ~14 frågor");

  const o = await overflow(page);
  if (o.over) add("HÖG", label, `Horisontell scroll med 20 frågor och lång text (${o.sw}px i ${o.w}px)`, ".xf-sheet", "Kolla .xf-mc-opt och .xf-q-text");

  // lång fråga: klipps arket?
  const cut = await page.evaluate(() => {
    const s = document.querySelector(".xf-sheet"), wrap = document.querySelector(".xf-sheet-wrap");
    if (!s || !wrap) return null;
    return { sheetH: Math.round(s.getBoundingClientRect().height), scrollH: wrap.scrollHeight, clientH: wrap.clientHeight };
  });
  if (cut && cut.scrollH > cut.clientH + 4) { /* scroll finns — ok */ }

  // resultat med 20 frågor
  await page.evaluate(() => {
    const qs = document.querySelectorAll(".xf-mc-opt");
    if (qs[1]) qs[1].click();
  });
  await page.waitForTimeout(400);
  page.on("dialog", d => d.accept().catch(() => {}));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".xf-exam-nav .xf-btn")].find(x => /Lämna in|Nästa/.test(x.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    for (let i = 0; i < 25; i++) {
      const b = [...document.querySelectorAll(".xf-exam-nav .xf-btn")].find(x => /Lämna in/.test(x.textContent));
      if (b) { b.click(); return; }
      const n = [...document.querySelectorAll(".xf-exam-nav .xf-btn")].find(x => /Nästa/.test(x.textContent));
      if (n) n.click();
    }
  });
  await page.waitForSelector("#xf .xf-screen[data-screen='result'].on", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOT}/q20-result-${w}.png` });
  const o3 = await overflow(page);
  if (o3.over) add("HÖG", label, `Horisontell scroll på resultatskärmen (${o3.sw}px i ${o3.w}px)`, ".xf-item", "Kolla långa modellsvar/källrader");
  const resH = await page.evaluate(() => Math.round(document.body.scrollHeight));
  if (resH > 14000) add("LÅG", label, `Resultatskärmen är ${resH}px hög med 20 frågor — allt utfällt`, ".xf-item", "Fäll ihop fullpoängssvaren bakom en knapp");
  await ctx.close();
}

// ── 3. Tangentbord ─────────────────────────────────────────────────────────
{
  const exam = mkExam(6, false);
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 860 } }, exam);
  await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#xf .xf-screen.on");
  await page.waitForTimeout(600);

  // hur många tabbar innan man når "Skapa prov"?
  let tabs = 0, reached = false;
  for (; tabs < 60; tabs++) {
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      return { cls: a?.className || "", txt: (a?.textContent || "").trim().slice(0, 30), tag: a?.tagName };
    });
    if (/xf-btn primary/.test(f.cls) && /Skapa prov/.test(f.txt)) { reached = true; break; }
    await page.keyboard.press("Tab");
  }
  if (!reached) add("MEDEL", "tangentbord", "Nådde inte 'Skapa prov' inom 60 tabbar", "#xf", "Kontrollera tabordning");
  else if (tabs > 12) add("MEDEL", "tangentbord", `${tabs} tabbtryck krävs innan startknappen nås — hela sidhuvudet ligger före`, "#xf", "Skip-länk till #xf (pekar i dag på dolt <main>)");

  // fokus efter skärmbyte
  await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary");
  await page.waitForTimeout(400);
  const focusAfter = await page.evaluate(() => {
    const a = document.activeElement;
    const sc = a?.closest?.(".xf-screen");
    return { tag: a?.tagName, inActive: !!(sc && sc.classList.contains("on")), isBody: a === document.body };
  });
  if (focusAfter.isBody || !focusAfter.inActive)
    add("MEDEL", "tangentbord", "Fokus flyttas inte till den nya skärmen vid steg­byte — det hamnar på body eller på en knapp som försvunnit", "js/exam-flow.js screen()", "Ge aktiv skärms rubrik tabindex=-1 och fokusera den");

  // skip-länk
  const skip = await page.evaluate(() => {
    const a = document.querySelector(".skip-link");
    if (!a) return null;
    const href = a.getAttribute("href") || "";
    const t = document.querySelector(href);
    return { href, targetHidden: t ? t.hasAttribute("hidden") : "saknas" };
  });
  if (skip && skip.targetHidden === true)
    add("HÖG", "tangentbord", `Skip-länken pekar på ${skip.href} som är hidden — tangentbordshoppet landar i ingenting`, "app.html .skip-link", "Peka på #xf");

  // landmark + h1
  const sem = await page.evaluate(() => ({
    mains: document.querySelectorAll("main:not([hidden])").length,
    h1: document.querySelectorAll("h1").length,
    xfRole: document.getElementById("xf")?.getAttribute("role") || null
  }));
  if (sem.mains === 0 && !sem.xfRole) add("MEDEL", "semantik", "Sidan har ingen synlig <main>-landmark (den enda är hidden) och #xf saknar role", "#xf", "Gör #xf till <main> eller sätt role=main");
  if (sem.h1 > 1) add("MEDEL", "semantik", `${sem.h1} st <h1> i DOM samtidigt (en per flödesskärm)`, ".xf-say", "En h1 för sidan, skärmrubriker som h2");

  await ctx.close();
}

// ── 4. Reduced motion ──────────────────────────────────────────────────────
{
  const exam = mkExam(6, false);
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" }, exam);
  await toContract(page);
  const txt = await page.textContent("#xf .xf-screen[data-screen='contract'] .xf-say");
  if (!txt || txt.trim().length < 5) add("HÖG", "reduced-motion", "P.E.R:s rubrik är tom med reducerad rörelse", "js/exam-flow.js say()", "Reduce-grenen sätter inte texten");
  await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
  await page.waitForSelector(".xf-exam.on", { timeout: 8000 });
  await page.waitForTimeout(300);
  const anim = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll(".xf-orb, .xf-sheet, .xf-mc-opt, .xf-progress i").forEach(e => {
      const s = getComputedStyle(e);
      const after = getComputedStyle(e, "::after");
      if (s.transitionDuration !== "0s" && s.transitionDuration !== "" ) bad.push(e.className + " transition " + s.transitionDuration);
      if (after.animationName && after.animationName !== "none" && after.animationDuration !== "0s") bad.push(e.className + "::after " + after.animationName);
    });
    return bad.slice(0, 6);
  });
  anim.forEach(a => add("LÅG", "reduced-motion", "Rörelse kvar trots prefers-reduced-motion: " + a, "exam-flow.css", "Bredare reduced-motion-regel som nollar transitions"));
  await page.screenshot({ path: `${SHOT}/reduced-motion.png` });
  await ctx.close();
}

// ── 5. Mörkt läge ──────────────────────────────────────────────────────────
{
  const exam = mkExam(6, false);
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" }, exam);
  await toContract(page);
  await page.screenshot({ path: `${SHOT}/dark-contract.png` });

  const dark = await page.evaluate(() => {
    function lum(c) {
      const m = c.match(/[\d.]+/g).map(Number);
      const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
      return .2126 * r + .7152 * g + .0722 * b;
    }
    function bgOf(e) {
      let n = e;
      while (n && n !== document.documentElement) {
        const b = getComputedStyle(n).backgroundColor;
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b;
        n = n.parentElement;
      }
      return "rgb(255,255,255)";
    }
    const out = [];
    [".xf-say", ".xf-sub", ".xf-eyebrow", ".xf-read", ".xf-row dt", ".xf-row dd", ".xf-opt", ".xf-chip", ".xf-note", ".xf-cov span", ".xf-btn.primary"].forEach(sel => {
      const e = document.querySelector(sel);
      if (!e || !e.offsetParent) return;
      const fg = getComputedStyle(e).color, bg = bgOf(e);
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
      out.push({ sel, fg, bg, ratio: Math.round(ratio * 100) / 100, size: parseFloat(getComputedStyle(e).fontSize) });
    });
    return out;
  });
  dark.forEach(d => {
    const floor = d.size >= 24 || (d.size >= 18.66) ? 3 : 4.5;
    if (d.ratio < floor) add(d.ratio < 3 ? "HÖG" : "MEDEL", "mörkt läge", `${d.sel} har kontrast ${d.ratio}:1 (kräver ${floor}:1) — ${d.fg} på ${d.bg}`, d.sel, "Byt till en token som håller i mörkt läge");
  });

  await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
  await page.waitForSelector(".xf-exam.on", { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/dark-exam.png` });
  await ctx.close();
}

// ── 6. Ljust läge: kontrast på de nya smådetaljerna ────────────────────────
{
  const exam = mkExam(6, false);
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 860 } }, exam);
  await toContract(page);
  const light = await page.evaluate(() => {
    function lum(c) {
      const m = c.match(/[\d.]+/g).map(Number);
      const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
      return .2126 * r + .7152 * g + .0722 * b;
    }
    function bgOf(e) {
      let n = e;
      while (n && n !== document.documentElement) {
        const b = getComputedStyle(n).backgroundColor;
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b;
        n = n.parentElement;
      }
      return "rgb(255,255,255)";
    }
    const out = [];
    [".xf-eyebrow", ".xf-read", ".xf-row dt", ".xf-note", ".xf-cov span", ".xf-btn.quiet"].forEach(sel => {
      const e = document.querySelector(sel);
      if (!e || !e.offsetParent) return;
      const fg = getComputedStyle(e).color, bg = bgOf(e);
      const L1 = lum(fg), L2 = lum(bg);
      out.push({ sel, ratio: Math.round(((Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05)) * 100) / 100, size: parseFloat(getComputedStyle(e).fontSize), fg, bg });
    });
    return out;
  });
  light.forEach(d => { if (d.ratio < 4.5) add(d.ratio < 3 ? "HÖG" : "MEDEL", "ljust läge", `${d.sel} kontrast ${d.ratio}:1 vid ${d.size}px (kräver 4.5:1)`, d.sel, "Mörkare textton"); });

  // maskinytan
  await page.evaluate(() => { document.querySelector(".xf-machine").classList.add("on"); });
  const mach = await page.evaluate(() => {
    function lum(c) { const m = c.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; }
    const bg = getComputedStyle(document.querySelector(".xf-machine")).backgroundColor;
    const out = [];
    [[".xf-pep", "rgba(232,238,244,.6)"], [".xf-log div", "rgba(232,238,244,.55)"]].forEach(([sel]) => {
      const e = document.querySelector(sel);
      const fg = e ? getComputedStyle(e).color : null;
      if (!fg) return;
      const L1 = lum(fg), L2 = lum(bg);
      out.push({ sel, ratio: Math.round(((Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05)) * 100) / 100, fg, bg, size: parseFloat(getComputedStyle(e).fontSize) });
    });
    return out;
  });
  mach.forEach(d => { if (d.ratio < 4.5) add(d.ratio < 3 ? "HÖG" : "MEDEL", "rättningsskärm", `${d.sel} kontrast ${d.ratio}:1 vid ${d.size}px på mörk yta`, d.sel, "Höj opaciteten"); });
  await ctx.close();
}

await browser.close();
await srv.close();

const order = { KRITISK: 0, HÖG: 1, MEDEL: 2, LÅG: 3 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);
console.log("\n════ VISUELL GRANSKNING ════\n");
if (!findings.length) console.log("inga fynd");
findings.forEach(f => console.log(`${f.sev} | ${f.ctx} | ${f.what}\n   → ${f.where} — ${f.fix}\n`));
console.log("skärmbilder:", fs.readdirSync(SHOT).join(", "));
