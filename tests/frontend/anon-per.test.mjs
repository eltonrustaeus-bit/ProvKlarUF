import { ROOT, serve, mockApis, report } from "./_harness.mjs";
/* P.E.R. för utloggade besökare (shared.js).
 *
 * Användning:  node tests/frontend/anon-per.test.mjs
 *
 * En besökare som inte skapat konto ska kunna fråga P.E.R. några gånger innan
 * de bestämmer sig. Det är produktens enda chans att visa vad den gör innan
 * någon registrerar sig — och en gräns som säger fel siffra i etiketten mot vad
 * spärren faktiskt tillåter läser besökaren som en bugg.
 *
 * Antalet stod tidigare som talet 2 på FYRA ställen: gränsen, kvarräknaren,
 * etiketten och spärrtexten. En höjning krävde fyra korrekta redigeringar.
 * Testet låser att de fyra alltid säger samma sak.
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "index.html" });
const R = report("anon-per");
const browser = await chromium.launch();

/* Utloggad: ingen session seedas. Anropen mockas så testet varken kostar
   OpenAI-pengar eller beror på nätet. */
async function öppna() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const anrop = [];
  await mockApis(page);
  await page.route("**/api/explain", async r => {
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
    anrop.push({ landingMode: b.landingMode === true, auth: r.request().headers()["authorization"] || null });
    return r.fulfill({ json: { answer: "Ett svar." } });
  });
  await page.evaluate?.(() => {});
  await page.addInitScript(() => { try { sessionStorage.setItem("pi_splash_shown", "1"); } catch {} });
  await page.goto(`${srv.url}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => { for (const id of ["proviaWelcome", "pageLoader"]) document.getElementById(id)?.remove(); });
  await page.waitForTimeout(700);
  await page.locator("#perBubble, #perStripBtn").first().click();
  /* Vänta på VILLKORET, inte på klockan.
     500 ms räckte lokalt men inte i en full svitkörning, där flera Chromium
     konkurrerar och panelens öppningsanimation blir långsammare. Filen föll då
     med "element is not visible" på #perInput — riggen kastade mitt i, och tre
     kontroller som mätte helt andra saker rapporterades som röda.
     Samma fix som i stale-session.test.mjs. En längre paus flyttar bara
     gränsen; villkoret tar bort den. */
  await page.locator("#perInput").waitFor({ state: "visible", timeout: 10_000 });
  return { ctx, page, anrop, close: () => ctx.close() };
}

const fråga = async (page, text) => {
  await page.locator("#perInput").fill(text);
  await page.locator("#perSendBtn").click();
  await page.waitForTimeout(700);
};
const kvarText = page => page.locator("#perLandingLeft").innerText();

try {
  const t = await öppna();
  const { page } = t;

  R.ok("panelen öppnas utan inloggning", await page.locator("#perPanel").isVisible());
  R.ok("inmatningen går att använda", await page.locator("#perInput").isVisible());
  R.ok("gratisraden visas", await page.locator("#perLandingBar").isVisible());

  /* Konstanten är källan. Etiketten måste säga samma sak som spärren gör. */
  /* Konstanten läses ur shared.js, inte ur DOM — filen laddas som en extern
     resurs och finns aldrig i sidans HTML. Första versionen av testet letade i
     documentElement.innerHTML och fick null. */
  const källa = await (await fetch(`${srv.url}/shared.js`)).text();
  const gräns = Number((källa.match(/LANDING_FREE_QUESTIONS\s*=\s*(\d+)/) || [])[1]);
  R.ok("antalet gratisfrågor är tre", gräns === 3, String(gräns));
  R.ok("etiketten säger samma siffra som gränsen",
    (await kvarText(page)).includes(`av ${gräns}`), (await kvarText(page)).trim());

  for (let i = 1; i <= gräns; i++) {
    await fråga(page, "fråga " + i);
    const kvar = gräns - i;
    R.ok(`efter fråga ${i} står ${kvar} kvar`,
      kvar > 0 ? (await kvarText(page)).includes(`${kvar} av ${gräns}`)
               : (await kvarText(page)).includes("Gränsen nådd"),
      (await kvarText(page)).trim());
  }

  R.ok(`${gräns} anrop skickades`, t.anrop.length === gräns, `${t.anrop.length} anrop`);
  /* Utan landingMode går anropet in på den autentiserade vägen och får 401. */
  R.ok("varje anrop är märkt som landningsläge", t.anrop.every(a => a.landingMode));
  R.ok("inget anrop skickar en Authorization-header", t.anrop.every(a => !a.auth));

  // Fråga över gränsen: inget anrop, och ett svar som förklarar varför.
  await fråga(page, "en till");
  R.ok("ingen fråga skickas över gränsen", t.anrop.length === gräns, `${t.anrop.length} anrop`);
  const msgs = await page.locator("#perMessages").innerText();
  R.ok("spärrtexten nämner rätt antal", msgs.includes(`${gräns} gratisfrågor`), msgs.slice(-120));
  R.ok("spärren erbjuder ett konto som väg vidare", /gratis konto/i.test(msgs));

  await t.close();
} catch (e) {
  process.exitCode = R.finish(e);
  await browser.close(); srv.close(); process.exit(process.exitCode);
}

const code = R.finish();
await browser.close();
srv.close();
process.exit(code);
