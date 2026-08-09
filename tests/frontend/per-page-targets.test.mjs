import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
// Bevisar att målregistret har mer än en konsument: P.E.R kan skicka en
// besökare till rätt PLANKORT på prissidan, inte bara till prissidan — och
// öppna rätt sektion på förbättringssidan.
//
// Användning:  node tests/frontend/per-page-targets.test.mjs

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/pricing.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(4612, r));

const pass = [], fail = [];
const ok = (n, c, d = "") => (c ? pass : fail).push(n + (d ? " — " + d : ""));

const browser = await chromium.launch();

async function mk(url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/check-role", r => r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
  await page.route("**/auth/v1/**", r => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
  await page.route("**/rest/v1/**", r => r.fulfill({ json: [] }));
  // förbättring.html synkar historik från user_exams innan sidan är klar (shared.js
  // laddas med defer, så det första setPerContext-anropet hinner köras innan
  // window.setPerContext ens finns — synken är den som faktiskt vinner racet).
  // Utan en rad här skulle synken skriva över den lokalt seedade historiken med
  // en tom lista, och userScore skulle aldrig hinna sättas — vi testar då inte
  // längre att gamla fält överlever utökningen, bara att de aldrig fanns.
  await page.route("**/rest/v1/user_exams**", r => r.fulfill({ json: [
    { id: 1, created_at: new Date().toISOString(), course: "Biologi 1", level: "C", qtype: "mix", material: "", exam: {}, answers: {}, result: { total_points: 62, max_points: 100 } }
  ] }));
  await page.addInitScript(() => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    localStorage.setItem("sb-mnmotdluigzeehdjbhbu-auth-token", JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_in: 7200, expires_at: exp, token_type: "bearer", user: { id: "u1", email: "u1@t.se" } }));
    localStorage.setItem("proviaai_role", "premium");
    localStorage.setItem("proviaai_cookie_consent", JSON.stringify({ necessary: true }));
    localStorage.setItem("proviaai_history", JSON.stringify([{ percent: 62, course: "Biologi 1", level: "C", ts: Date.now() }]));
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return { ctx, page };
}

// ── T1: prissidan deklarerar tre mål ──────────────────────────────────────
{
  const { ctx, page } = await mk("http://localhost:4612/pricing.html");
  const t1 = await page.evaluate(() => (window.__perTestCtx().targets || []).map(t => t.id));
  ok("T1a tre plan-mål", t1.length === 3, JSON.stringify(t1));
  ok("T1b rätt id", t1.join(",") === "gratis,basic,premium", t1.join(","));

  // korten har id att hoppa till
  const ids = await page.evaluate(() => ["plan-gratis", "plan-basic", "plan-premium"].map(i => !!document.getElementById(i)));
  ok("T1c plankorten har id", ids.every(Boolean), JSON.stringify(ids));

  // P.E.R:s knapp rullar till rätt kort. Panelen måste vara öppen för att
  // knappen ska vara klickbar — #perPanel har display:none tills #perBubble
  // klickas (toggle() i shared.js). app.html:s eget test öppnar panelen
  // indirekt via ".xf-ask"; här finns ingen sådan genväg, så vi klickar
  // bubblan direkt.
  await page.click("#perBubble");
  await page.evaluate(() => {
    const msgs = document.getElementById("perMessages");
    const div = document.createElement("div");
    msgs.appendChild(div);
    window.__perFinalize(div, "Premium kostar 79 kr i månaden.\n[GOTO:#premium]");
  });
  const label = await page.textContent("#perMessages .per-nav-cta >> nth=-1");
  ok("T1d knappen bär planens namn", label === "Premium →", String(label));
  await page.click("#perMessages .per-nav-cta >> nth=-1");
  await page.waitForTimeout(900);
  const flashed = await page.evaluate(() => document.getElementById("plan-premium").classList.contains("planCard--flash"));
  ok("T1e målkortet markeras", flashed === true);
  await ctx.close();
}

// ── T2: förbättringssidan deklarerar sina sektioner ───────────────────────
{
  const { ctx, page } = await mk("http://localhost:4612/förbättring.html");
  const t2 = await page.evaluate(() => (window.__perTestCtx().targets || []).map(t => t.id));
  ok("T2a fem sektionsmål", t2.length === 5, JSON.stringify(t2));
  ok("T2b felbank finns med", t2.indexOf("felbank") !== -1, JSON.stringify(t2));

  // de gamla fälten överlevde utökningen
  const t2b = await page.evaluate(() => window.__perTestCtx());
  ok("T2c userScore bevaras", typeof t2b.userScore === "number", String(t2b.userScore));
  ok("T2d sidan är förbättring", t2b.page === "förbättring", t2b.page);

  // Målet tar eleven till felbanken. Kontrollerade tidigare att #mistakeSection
  // tappade sin .collapsed — men Del B tog bort dragspelen, så det finns inget
  // att fälla ut längre. Zonen ligger alltid framme och målet markerar den i
  // stället, samma .xfZone--flash-mönster som .planCard--flash ovan.
  await page.click("#perBubble");
  await page.evaluate(() => {
    const msgs = document.getElementById("perMessages");
    const div = document.createElement("div");
    msgs.appendChild(div);
    window.__perFinalize(div, "Dina misstag ligger i felbanken.\n[GOTO:#felbank]");
  });
  await page.click("#perMessages .per-nav-cta >> nth=-1");
  await page.waitForTimeout(400);
  const flashed = await page.evaluate(() => !!document.querySelector("#zonFelbank.xfZone--flash"));
  ok("T2e målet markerar felbankszonen", flashed === true);
  await ctx.close();
}

await browser.close();
server.close();

console.log(pass.map(p => "  ok  " + p).join("\n"));
if (fail.length) { console.log(fail.map(f => "  FAIL " + f).join("\n")); }
console.log(`\n${pass.length} ok, ${fail.length} fail`);
process.exit(fail.length ? 1 : 0);
