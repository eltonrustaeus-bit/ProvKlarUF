import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
// P.E.R:s minnessida (per.html).
//
// Användning:  node tests/frontend/per-sida.test.mjs
//
// Sidan har en enda läsare och ett enda syfte: att stämma. Testerna nedan
// mäter tre saker som alla kan gå sönder tyst:
//   1. att registret faktiskt ritas ut, inte bara hämtas
//   2. att gränsen — det svåraste fältet att läsa sig till ur koden — syns
//   3. att "för få elever än" skrivs som text och inte som en nolla
//
// Riggen kommer från _harness.mjs. Läs kommentaren där innan du lägger till
// egna mockar — sidan bakom js/site-gate.js kräver att check-role registreras
// EFTER den generella **/api/**-rutten, och egna svar går genom `extra`, som
// registreras sist av alla.

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "per.html" });

const R = report("per-sida");
const ok = (n, c, d = "") => R.ok(n, c, d);

const adminRoute = route => {
  const body = JSON.parse(route.request().postData() || "{}");
  if (body.action === "per-registry") {
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, registry: {
        moduler: [{ fil: "_per-memory.js", namn: "Långtidsminnet", gör: "Sammanfattar elevens studiemönster.", ser: "Provhistorik.", gräns: "Sparar aldrig namn eller personliga detaljer." }],
        flaggor: [{ nyckel: "per_answer_cache_enabled", namn: "Svarscachens grind", gör: "Slår på återanvändningen.", ser: "Inget eget.", gräns: "Av som default." }],
      } }),
    });
  }
  if (body.action === "per-pulse") {
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, pulse: {
        minnen: { totalt: 4, färska: 3, gamla: 1 },
        cacheBeslut: { totalt: 2, per: { hit_exact: 0, hit_vector: 0, near_miss: 0, miss: 2, blocked: 0 }, träffkvot: "för få elever än" },
        cacheRader: { pending: 1, approved: 0, rejected: 0, utgångna: 0 },
        kvoter: [{ funktion: "per_chat", använt: 8 }],
        begrepp: "för få elever än",
        hämtad: "2026-08-25T12:00:00.000Z",
      } }),
    });
  }
  return route.fulfill({ status: 400, contentType: "application/json", body: '{"ok":false}' });
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await mockApis(page, {
  role: "admin",
  profiles: { id: "u1", approved: true, role: "admin" },
  extra: [["**/api/admin", adminRoute]],
});
await seed(page, { role: "admin", user: { id: "u1" } });

await page.goto(`${srv.url}/per.html`, { waitUntil: "networkidle" });
await page.waitForSelector("#registret .post", { timeout: 8000 }).catch(() => {});

const text = await page.evaluate(() => document.body.innerText);

ok("T1 modulens namn ritas ut", text.includes("Långtidsminnet"), text.slice(0, 200));
ok("T2 gränsen ritas ut", text.includes("Sparar aldrig namn"));
ok("T3 flaggan ritas ut", text.includes("Svarscachens grind"));
ok("T4 minnessiffrorna ritas ut", /\b4\b/.test(text) && /färska/i.test(text));
/* Skiftlägesokänsligt med flit. innerText ger den RENDERADE texten, och
   .statLabel bär text-transform:uppercase — "per_chat" når skärmen som
   "PER_CHAT". En skiftlägeskänslig jämförelse här mäter CSS, inte data. */
ok("T5 kvoten ritas ut", /per_chat/i.test(text) && /\b8\b/.test(text));

/* Det viktigaste testet i filen. Skrivs tunt underlag ut som "0 %" läser
   sidan som en mätning, och läsaren drar slutsatsen att cachen aldrig
   träffar — när sanningen är att den aldrig fått chansen. */
ok("T6 tunt underlag skrivs som text, inte som noll",
  text.includes("för få elever än") && !/0\s*%/.test(text), text.slice(0, 400));

ok("T7 sidan bär noindex",
  await page.evaluate(() => !!document.querySelector('meta[name="robots"][content*="noindex"]')));

/* Sidan får inte gå att hitta. robots.txt är inte ett skydd — den är en
   begäran som bara hyfsade sökmotorer följer — men en sida som ligger i
   sitemapen är aktivt inbjuden, och det är motsatsen till privat. */
const { readFileSync } = await import("node:fs");
const robots = readFileSync(ROOT + "/robots.txt", "utf8");
const sitemap = readFileSync(ROOT + "/sitemap.xml", "utf8");
ok("T8 robots.txt utesluter sidan", /^Disallow:\s*\/per\.html\s*$/m.test(robots));
ok("T9 sidan står inte i sitemapen", !sitemap.includes("per.html"));

await ctx.close();
await browser.close();
await srv.close();

process.exit(R.finish());
