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
//   #perWidget      — panelen öppnas på en timer
//   sticky header   — placeras olika i en helsidesskärmdump
//   .joinCta        — glider in vid scroll
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
execSync(`git worktree add --detach "${REF}" origin/main`, { cwd: ROOT, stdio: "pipe" });

const srvNew = await serve(ROOT, 4620);
const srvRef = await serve(REF, 4621);

const QUIET = `
  #perWidget{display:none!important}
  header,.xg-header,.xg-utility-bar{position:static!important}
  .joinCta{display:none!important}
  *,*::before,*::after{animation:none!important;transition:none!important}
`;

const browser = await chromium.launch();

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

const rows = [];
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

await browser.close();
srvNew.close(); srvRef.close();
execSync(`git worktree remove --force "${REF}"`, { cwd: ROOT, stdio: "pipe" });

let bad = 0;
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
