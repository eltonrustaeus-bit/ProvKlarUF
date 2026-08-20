import { readFileSync } from "node:fs";
import { ROOT, serve, openPage, report } from "./_harness.mjs";

/* Kan en sökmotor som LYDER robots.txt faktiskt indexera sidorna?
 *
 * Bakgrunden är ett verkligt fel, mätt 2026-08-20. robots.txt sa
 * "Disallow: /api/" utan undantag. js/site-gate.js ligger som första taggen i
 * <head> på varje sida och anropar /api/check-role innan sidan får målas.
 * Grinden är byggd att fail closed — uteblivet svar betyder nej.
 *
 * En crawler som lyder robots.txt vägrar alltså hämta check-role, grinden
 * tolkar tystnaden som avslag, och besökaren skickas till /snart.html som bär
 * noindex. Hela sajten var oindexerbar, och Search Console avvisade begäran om
 * indexering med "problem påträffades vid realtidstestet".
 *
 * Ingen befintlig kontroll kunde fånga det: visitor-preflight mockar API:et
 * och mäter en besökare som INTE lyder robots.txt. Felet bodde i glappet
 * mellan robots.txt och sidans egna anrop, alltså i två filer som ingen
 * kontroll läste tillsammans.
 *
 * Den här filen stänger det glappet. Den läser robots.txt, härleder vad en
 * lydig crawler får hämta, blockerar resten på riktigt, och kräver att sidan
 * ändå renderar.
 *
 * Användning:  node tests/frontend/crawlability.mjs
 */

const r = report("crawlability");
const { chromium: cr } = await import(ROOT + "/node_modules/playwright/index.mjs");

/* Minimal robots.txt-tolkare för gruppen "User-agent: *".
   Googles regel: den mest specifika (längsta) matchande sökvägen vinner, och
   vid lika längd vinner Allow. Det är precis den regeln fixen vilar på. */
function parseRobots(txt) {
  const rules = [];
  let inStar = false;
  for (const raw of txt.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") { inStar = val === "*"; continue; }
    if (!inStar) continue;
    if (key === "allow" || key === "disallow") rules.push({ type: key, path: val });
  }
  return rules;
}

function allowedByRobots(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (!rule.path || !path.startsWith(rule.path)) continue;
    if (!best
      || rule.path.length > best.path.length
      || (rule.path.length === best.path.length && rule.type === "allow")) best = rule;
  }
  return !best || best.type === "allow";
}

const robotsTxt = readFileSync(ROOT + "/robots.txt", "utf8");
const rules = parseRobots(robotsTxt);

/* C0 är kärnan. Faller den är resten meningslös, och muterar man bort
   Allow-raden ur robots.txt faller exakt den här kontrollen först. */
r.ok("C0 robots.txt släpper fram /api/check-role — anropet grinden gör före render",
  allowedByRobots(rules, "/api/check-role"),
  JSON.stringify(rules.map(x => x.type[0] + ":" + x.path)));

r.ok("C0b robots.txt håller resten av /api/ stängt",
  !allowedByRobots(rules, "/api/generate-exam"));

const { url: origin, close: closeServer } = await serve();

/* Sidorna i sitemap.xml — de som faktiskt ska kunna hamna i ett sökresultat. */
const PAGES = ["index.html", "pricing.html", "app.html", "larare.html", "integritetspolicy.html"];

const browser = await cr.launch();
try {
  for (const file of PAGES) {
    const { page, close } = await openPage(browser, `${origin}/${file}`, {
      // Grinden svarar allow:true — men bara om anropet ens släpps fram nedan.
      mocks: { allow: true },
      waitUntil: "domcontentloaded",
      settle: 0,
    });

    // Registreras SIST, alltså först i tur: Playwright kör handlers i omvänd
    // ordning mot registreringen. Blockerar det en lydig crawler inte får
    // hämta, och lämnar resten vidare till mockarna med fallback().
    const refused = [];
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      const sameHost = url.origin === origin;
      if (sameHost && !allowedByRobots(rules, url.pathname)) {
        refused.push(url.pathname);
        return route.abort();
      }
      return route.fallback();
    });

    await page.goto(`${origin}/${file}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const seen = await page.evaluate(() => ({
      path: location.pathname,
      robots: document.querySelector('meta[name="robots"]')?.content || "",
      visible: getComputedStyle(document.body).visibility,
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
    }));

    r.ok(`C1 ${file}: en lydig crawler blir INTE omdirigerad`,
      seen.path.endsWith(file) || (file === "index.html" && seen.path === "/"),
      `hamnade på ${seen.path}${refused.length ? " · nekade " + refused.join(",") : ""}`);

    r.ok(`C2 ${file}: ingen noindex`, !/noindex/.test(seen.robots), seen.robots || "ingen robots-meta");

    r.ok(`C3 ${file}: body är synlig — grinden lyfte`, seen.visible === "visible", seen.visible);

    r.ok(`C4 ${file}: kanonisk adress finns`, seen.canonical.startsWith("https://exgen.se/"), seen.canonical || "SAKNAS");

    await close();
  }
} catch (e) {
  await browser.close();
  await closeServer();
  process.exit(r.finish(e));
}

await browser.close();
await closeServer();
process.exit(r.finish());
