import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.OUT_DIR || resolve(ROOT, ".test-out/per-visual");
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const { default: sharp } = await import(ROOT + "/node_modules/sharp/lib/index.js");

const PAGES = ["app.html", "pricing.html", "förbättring.html"];
const VIEWS = [{ name: "desktop", width: 1280, height: 900 }, { name: "mobil", width: 390, height: 844 }];

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
function serve(root, port) {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => s.listen(port, () => r(s)));
}

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
    try { srvNew.close(); } catch (e) { warnings.push(`srvNew.close: ${e.message}`); }
  }
  if (srvRef) {
    try { srvRef.close(); } catch (e) { warnings.push(`srvRef.close: ${e.message}`); }
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
  header,.xg-header,.xg-utility-bar{position:static!important}
  .joinCta{display:none!important}
  *,*::before,*::after{animation:none!important;transition:none!important}
`;

async function shot(port, page, view, tag) {
  const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.route("**/api/**", r => r.fulfill({ json: { ok: true } }));
  await p.route("**/api/check-role", r => r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
  await p.route("**/auth/v1/**", r => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
  await p.route("**/rest/v1/**", r => r.fulfill({ json: [] }));
  await p.addInitScript(() => {
    localStorage.setItem("proviaai_cookie_consent", JSON.stringify({ necessary: true }));
    // js/intro-splash.js checks this flag and returns immediately if set,
    // skipping its ~4.5s branded reveal that otherwise holds body>* at
    // opacity:0 for the entire screenshot window. Without this, every shot
    // of a page that loads intro-splash.js captures the splash overlay
    // instead of real page content — comparing splash-to-splash always
    // yields a 0 diff regardless of what changed underneath.
    sessionStorage.setItem("pi_splash_shown", "1");
  });
  await p.goto(`http://localhost:${port}/${page}`, { waitUntil: "networkidle" });
  await p.addStyleTag({ content: QUIET });
  await p.waitForTimeout(700);
  const file = `${OUT}/${tag}-${page.replace(/\W+/g, "_")}-${view.name}.png`;
  await p.screenshot({ path: file, fullPage: true });
  await ctx.close();
  return file;
}

async function diff(a, b) {
  const [ia, ib] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (ia.info.width !== ib.info.width || ia.info.height !== ib.info.height) return -1;
  let n = 0;
  for (let i = 0; i < ia.data.length; i += 4) {
    if (ia.data[i] !== ib.data[i] || ia.data[i + 1] !== ib.data[i + 1] || ia.data[i + 2] !== ib.data[i + 2]) n++;
  }
  return n;
}

let bad = 0;
const rows = [];
try {
  execSync(`git worktree add --detach "${REF}" origin/main`, { cwd: ROOT, stdio: "pipe" });
  worktreeAdded = true;

  srvNew = await serve(ROOT, 4620);
  srvRef = await serve(REF, 4621);
  browser = await chromium.launch();

  for (const page of PAGES) {
    for (const view of VIEWS) {
      const refA = await shot(4621, page, view, "ref-a");
      const refB = await shot(4621, page, view, "ref-b");
      const noise = await diff(refA, refB);
      const now = await shot(4620, page, view, "ny");
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
