import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolve } from "node:path";
import { ROOT, serve, mockApis, seed } from "./_harness.mjs";
// Visuell regression för P.E.R-systemlagret.
//
// Jämför den här worktreen mot origin/main, sida för sida och vy för vy.
// Brusgolvet mäts FÖRST genom att köra main mot main — utan det vet man inte
// om 43 skiljande pixlar betyder en förändring eller bara att sidan andas.
//
// Tre kända bruskällor neutraliseras i BÅDA körningarna:
//   #perWidget      — panelen öppnas på en timer (se motivering vid QUIET
//                      nedan för varför hela widgeten döljs, inte bara
//                      panelen — och vad det kostar: #perSees fotograferas
//                      aldrig här, täcks i stället av per-manifest.test.mjs)
//   sticky header   — placeras olika i en helsidesskärmdump
//   .joinCta        — glider in vid scroll
//
// Tillfällig worktree, HTTP-servrar och webbläsare städas alltid via
// cleanup() — normal retur, kastat fel (try/finally) eller Ctrl-C
// (SIGINT/SIGTERM). cleanup() är idempotent och kastar aldrig själv.
//
// Användning:  node tests/frontend/per-visual.mjs

const OUT = process.env.OUT_DIR || resolve(ROOT, ".test-out/per-visual");
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const { default: sharp } = await import(ROOT + "/node_modules/sharp/lib/index.js");

// index och konto tillkom i Del B: den ändringen rör exgen-ui.css, som varje
// sida laddar, så "bara förbättringssidan påverkas" är ett påstående som måste
// mätas och inte resoneras fram.
const PAGES = ["app.html", "pricing.html", "förbättring.html", "index.html", "konto.html"];
const VIEWS = [{ name: "desktop", width: 1280, height: 900 }, { name: "mobil", width: 390, height: 844 }];

// Servern kommer från _harness.mjs och binder en ledig port. Två fasta
// nummer (4620/4621) delades med header-behaviour.mjs, och en körning av hela
// katalogen dog mitt i med "Target page, context or browser has been closed".

// Referensträd: origin/main i en tillfällig worktree.
const REF = fs.mkdtempSync(path.join(os.tmpdir(), "per-visual-"));

// Städning måste vara idempotent (kan köras flera gånger utan att kasta) och
// får aldrig ersätta ett ursprungligt fel med ett städfel — varje steg är
// därför sitt eget try/catch. Täcker tre vägar ut: normal retur, ett kastat
// fel (try/finally nedan) och Ctrl-C (SIGINT/SIGTERM-hanterarna).
let worktreeAdded = false;
let srvNew = null;
let srvRef = null;
let browser = null;
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  const warnings = [];
  if (browser) {
    try { await browser.close(); } catch (e) { warnings.push(`browser.close: ${e.message}`); }
  }
  if (srvNew) {
    try { await srvNew.close(); } catch (e) { warnings.push(`srvNew.close: ${e.message}`); }
  }
  if (srvRef) {
    try { await srvRef.close(); } catch (e) { warnings.push(`srvRef.close: ${e.message}`); }
  }
  if (worktreeAdded) {
    try { execSync(`git worktree remove --force "${REF}"`, { cwd: ROOT, stdio: "pipe" }); }
    catch (e) { warnings.push(`worktree remove: ${e.message}`); }
  }
  if (warnings.length) console.error("städning: " + warnings.join(" | "));
}

let exiting = false;
async function onSignal(code) {
  if (exiting) return;
  exiting = true;
  await cleanup();
  process.exit(code);
}
process.on("SIGINT", () => onSignal(130));
process.on("SIGTERM", () => onSignal(143));

// Provades smalare: dölja bara #perPanel + #perNudge i stället för hela
// #perWidget, så #perBubble och #perSees faktiskt fotograferas. Brusgolvet
// var 0 på alla sex rader i första körningen — men på en omkörning slog
// pricing.html/mobil upp till 7794 (delta stannade dock på 0, så det syntes
// aldrig som ett falskt FAIL, bara som ett höjt golv). Orsak: pricing.html
// är en isLanding()-sida, och shared.js triggar ett riktigt auto-open
// ~3500ms efter DOMContentLoaded på förstabesök (ny browser-context här,
// varje gång "förstabesök"). #perPanel{display:none} döljer panelen, men
// toggle() byter samtidigt #perBubble.per-open — bubblans bakgrund går från
// den solida märkesfärgen till vit/kantad — och den färgändringen är INTE
// täckt av den smala regeln. Beroende på hur lång tid networkidle+setup tar
// relativt 700ms-väntan hinner den timern ibland trigga innan skottet, ibland
// inte → precis den flakighet brusgolvsmätningen finns för att fånga.
// Städade inte bort det med fler overrides (skulle bara flytta problemet) —
// går tillbaka till att dölja hela #perWidget, vilket var den ursprungliga,
// beprövat stabila regeln.
//
// Konsekvens: #perSees (Task 5) fotograferas fortfarande aldrig av det här
// instrumentet — display:none på förälder-elementet #perWidget gör att hela
// undergrenen aldrig renderas, oavsett vad som ändras i den. Det täcks i
// stället på DOM-/style-nivå av tests/frontend/per-manifest.test.mjs
// (T8 "raden utan fokus", T9 "raden med fokus", T10 "dold tills man hovrar").
const QUIET = `
  #perWidget{display:none!important}
  /* Välkomsthälsningen. shared.js showWelcomeAnim() lägger #proviaWelcome över
     hela sidan och tar bort den med en setTimeout på 2400 ms + 500 ms — inte
     med en animation, så *{animation:none} biter inte, och riggen väntar bara
     700 ms. app.html anropar den varje gång en session återställs, vilket är
     precis vad addInitScript här nedanför seedar.

     Konsekvensen var att app.html-vyerna INTE var av appen. De var av en
     "Välkommen tillbaka U1"-skärm utan header, utan provskapare, utan
     innehåll — och därmed var varje "app.html 0" i tabellen en jämförelse
     mellan två välkomsthälsningar. Upptäckt när en headerändring som rörde
     app.html mätte 0 skiljande pixlar medan index och konto mätte 6529
     respektive 6592.

     Samma familj som de två fällor Del B hittade (inloggningsrutan och
     scroll-reveal): något ligger över sidan och en nolla betyder ingenting. */
  #proviaWelcome{display:none!important}
  header,.xg-header,.xg-utility-bar{position:static!important}
  .joinCta{display:none!important}
  *,*::before,*::after{animation:none!important;transition:none!important}
  /* Scroll-reveal. .reveal börjar på opacity:0 och får .rev-visible av en
     IntersectionObserver först när elementet scrollas in. En helsidesbild
     scrollar inte, så allt under vikningen fotograferas osynligt — mätt på
     förbättringssidan, där två hela zoner låg som vit yta i bilden medan de
     fanns i DOM:en med 580x270 och 580x332 pixlar. Det gör inte bara zonerna
     omätta, det gör "0 skiljande pixlar" svagare för varje sida som använder
     .reveal, eftersom osynligt mot osynligt alltid är noll. */
  .reveal{opacity:1!important;transform:none!important}
`;

async function shot(base, page, view, tag) {
  const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  // Mockarna, sessionen och splash-förbikopplingen kommer från _harness.mjs.
  // Sessionen är inte valfri: utan en komplett session visar shared.js
  // registreringsrutan över hela sidan, och då jämförs en inloggningsruta med
  // en inloggningsruta — vilket alltid ger noll oavsett vad som ändrats under.
  await mockApis(p);
  await seed(p);
  await p.goto(`${base}/${page}`, { waitUntil: "networkidle" });
  await p.addStyleTag({ content: QUIET });
  await p.waitForTimeout(700);
  const file = `${OUT}/${tag}-${page.replace(/\W+/g, "_")}-${view.name}.png`;
  await p.screenshot({ path: file, fullPage: true });
  await ctx.close();
  return file;
}

/* Returnerar -1 när bilderna har olika mått, eftersom en jämförelse pixel för
 * pixel då inte betyder något.
 *
 * ATT LÄSA: -1 i kolumnen "skillnad" betyder oftast en verklig höjdändring,
 * men INTE alltid. Helsidesskärmdumpar fångar sidans höjd vid utlösningen, och
 * den kan skilja en pixel mellan två skott av exakt samma träd — mätt: en
 * körning gav -1 på pricing.html, nästa gav 2930 på samma sida med oförändrad
 * kod, och samma körning gav -1 i BRUSGOLVET för index.html, alltså main mot
 * main. Ett -1 i brusgolvskolumnen är själva beviset: instrumentet höll inte
 * höjden stilla mot sig självt.
 *
 * Innan ett -1 tolkas som en ändring: kör om, eller mät höjden direkt i två
 * träd. En pixel kan förskjuta hela sidan och få varje rad under att skilja
 * sig, vilket ser ut som en total omritning.
 *
 * BRUSGOLVET UNDERSKATTAR IBLAND. Det mäts ur ETT skottpar (ref-a mot ref-b).
 * Är sidans jitter inte deterministiskt kan paret råka bli identiskt och golvet
 * rapporteras som 0, medan "ny" ändå skiljer sig med några pixlar av samma
 * orsak. Mätt: förbättring.html gav två körningar i rad desktop-golv 0 / delta
 * 2, medan MOBILEN på samma sida rapporterade golv 2 — alltså samma
 * storleksordning, bara fångad i den ena vyn.
 *
 * Läsregeln som följer: en skillnad på några få pixlar där varje pixel avviker
 * med 1-2 enheter i EN kanal är antialiasing, inte en ändring. Öppna bilden och
 * titta på var de sitter innan något felsöks — sitter de i ett område som inte
 * ens rör det som ändrats är svaret givet. */
/* KANALTOLERANS — varför den finns, och varför den är 8.
 *
 * Fram till 2026-08-25 räknades varje pixel med NÅGON skillnad alls, hur
 * osynlig den än var. Följden var att filen flaggade i tre hela svitkörningar
 * i rad och var grön varje gång den kördes ensam. Jag avfärdade den tre gånger
 * som "känt flakig" — det är inte en diagnos, det är en vana.
 *
 * Mätt i stället för gissat: hela bruset var TVÅ pixlar som skilde sig med
 * EXAKT 1 enhet i en kanal, på förbättring.html i mobilvy. Antialiasing.
 * Subpixelrendering är inte deterministisk mellan två skott av samma träd.
 *
 * Brusgolvet kunde inte fånga det, eftersom det mäts ur ETT skottpar: paret
 * råkade ibland bli identiskt (golv 0) medan "ny" fick de två pixlarna, och
 * villkoret delta > golv gjorde 2 > 0 till en röd rad.
 *
 * 8 är valt med marginal åt båda hållen: bruset är 1, och en verklig visuell
 * ändring mäts i tusentals pixlar med stora utslag (6529 och 6592 vid
 * headerändringen som dokumenteras ovan). Mellan 1 och 6529 finns gott om
 * plats, så tröskeln behöver inte vara knapp för att vara säker.
 *
 * HÖJDTOLERANS: en helsidesbild fångar sidans höjd vid utlösningen, och den
 * kan skilja en pixel mellan två skott av exakt samma träd — se noten om -1
 * ovan. Skiljer höjden 2 pixlar eller mindre beskärs båda till den lägsta i
 * stället för att hela jämförelsen kastas. Mer än så är en verklig
 * höjdändring och ger fortfarande -1.
 */
const KANAL_TOLERANS = 8;
const HÖJD_TOLERANS = 2;

async function diff(a, b) {
  const [ia, ib] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (ia.info.width !== ib.info.width) return -1;
  if (Math.abs(ia.info.height - ib.info.height) > HÖJD_TOLERANS) return -1;

  // Jämför bara den gemensamma delen när höjden skiljer inom toleransen.
  const rader = Math.min(ia.info.height, ib.info.height);
  const bytesPerRad = ia.info.width * 4;
  const slut = rader * bytesPerRad;

  let n = 0;
  for (let i = 0; i < slut; i += 4) {
    const d = Math.max(
      Math.abs(ia.data[i] - ib.data[i]),
      Math.abs(ia.data[i + 1] - ib.data[i + 1]),
      Math.abs(ia.data[i + 2] - ib.data[i + 2]),
    );
    if (d > KANAL_TOLERANS) n++;
  }
  return n;
}

let bad = 0;
const rows = [];
try {
  execSync(`git worktree add --detach "${REF}" origin/main`, { cwd: ROOT, stdio: "pipe" });
  worktreeAdded = true;

  srvNew = await serve(ROOT);
  srvRef = await serve(REF);
  browser = await chromium.launch();

  for (const page of PAGES) {
    for (const view of VIEWS) {
      const refA = await shot(srvRef.url, page, view, "ref-a");
      const refB = await shot(srvRef.url, page, view, "ref-b");
      const noise = await diff(refA, refB);
      const now = await shot(srvNew.url, page, view, "ny");
      const delta = await diff(refA, now);
      rows.push({ page, view: view.name, noise, delta });
    }
  }
} finally {
  // Om koden ovan kastar ska cleanup() ändå städa allt (worktree, servrar,
  // browser) — men om SJÄLVA städningen skulle kasta får den aldrig ersätta
  // ett riktigt fel från try-blocket ovan, därför fångas den separat här.
  try { await cleanup(); } catch (_) {}
}

console.log("sida                  vy        brusgolv   skillnad");
for (const r of rows) {
  const over = r.delta === -1 || r.delta > r.noise;
  if (over) bad++;
  console.log(
    `${r.page.padEnd(21)} ${r.view.padEnd(9)} ${String(r.noise).padStart(8)} ${String(r.delta).padStart(10)}` +
    (over ? "   ← ÖVER BRUSGOLVET" : "")
  );
}
console.log(`\nskärmdumpar: ${OUT}`);
console.log(bad ? `${bad} vy(er) över brusgolvet — granska bilderna` : "alla vyer inom brusgolvet");
process.exit(bad ? 1 : 0);
