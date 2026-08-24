import { ROOT, serve, mockApis, report, seed, AUTH_KEY } from "./_harness.mjs";
/* En utgången inloggning ska inte låsa ute besökaren (shared.js).
 *
 * Användning:  node tests/frontend/stale-session.test.mjs
 *
 * Buggen som testet låser: getToken() läste access_token ur localStorage utan
 * att titta på expires_at. Den som varit inloggad någon gång hade en död token
 * kvar, isLandingMode blev false eftersom "en token finns", anropet gick som
 * autentiserat, servern svarade 401 — och widgeten skrev "Logga in för att
 * chatta med P.E.R."
 *
 * En förstagångsbesökare med tomt localStorage fick alltså sina tre
 * gratisfrågor, medan den som redan provat produkten blev utelåst. Det var
 * också därför felet inte syntes vid test: en ren webbläsarkontext har inget
 * localStorage att bli inaktuellt.
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "index.html" });
const R = report("stale-session");
const browser = await chromium.launch();

/* ttl går till harnessets sessionValue() och blir både expires_in och
   expires_at. Negativ ttl ger alltså en session som redan gått ut — hela
   formen, med refresh_token och user, precis som en riktig död session ser ut.
   Nyckeln kommer från AUTH_KEY; skriv den aldrig av (H21).

   status: vad /api/explain ska svara. 200 som default; 401 för att pröva
   skyddsnätet när en token är återkallad server-side. */
async function öppna({ ttl, status = 200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const anrop = [];
  await mockApis(page);
  await page.route("**/api/explain", async r => {
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
    anrop.push({ landingMode: b.landingMode === true, auth: r.request().headers()["authorization"] || null });
    if (status === 401) return r.fulfill({ status: 401, json: { error: "invalid token" } });
    return r.fulfill({ json: { answer: "Ett svar." } });
  });
  await seed(page, { signedIn: true, user: { ttl } });
  await page.goto(`${srv.url}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => { for (const id of ["proviaWelcome", "pageLoader"]) document.getElementById(id)?.remove(); });
  await page.waitForTimeout(700);
  await page.locator("#perBubble, #perStripBtn").first().click();
  await page.waitForTimeout(500);
  return { page, anrop, close: () => ctx.close() };
}

const fråga = async (page, text) => {
  await page.locator("#perInput").fill(text);
  await page.locator("#perSendBtn").click();
  await page.waitForTimeout(900);
};

try {
  /* 1. Utgången session — exakt det tillstånd användaren rapporterade. */
  {
    const t = await öppna({ ttl: -86400 });
    R.ok("gratisraden visas trots gammal session", await t.page.locator("#perLandingBar").isVisible());
    await fråga(t.page, "vad är exgen?");
    R.ok("en fråga skickades", t.anrop.length === 1, `${t.anrop.length} anrop`);
    R.ok("anropet är märkt som landningsläge", t.anrop[0]?.landingMode === true);
    R.ok("ingen död token skickas med", !t.anrop[0]?.auth, String(t.anrop[0]?.auth));
    const msgs = await t.page.locator("#perMessages").innerText();
    R.ok("inloggningsväggen visas inte", !msgs.includes("Logga in för att chatta"), msgs.slice(-140).trim());
    R.ok("besökaren får sitt svar", msgs.includes("Ett svar."), msgs.slice(-140).trim());
    await t.close();
  }

  /* 2. En session som går ut om en timme är fortfarande giltig. Fixen får inte
        logga ut den som faktiskt är inloggad. */
  {
    const t = await öppna({ ttl: 3600 });
    await fråga(t.page, "hjälp mig med matte");
    R.ok("giltig session går den autentiserade vägen", t.anrop[0]?.landingMode === false);
    R.ok("giltig session skickar Authorization", !!t.anrop[0]?.auth);
    await t.close();
  }

  /* 3. Marginalen: en token som går ut om tio sekunder hinner bli ogiltig innan
        anropet landar hos servern. Den ska räknas som död redan här. */
  {
    const t = await öppna({ ttl: 10 });
    await fråga(t.page, "hej");
    R.ok("token inom marginalen räknas som utgången", t.anrop[0]?.landingMode === true);
    await t.close();
  }

  /* 4. Skyddsnätet. En token kan vara återkallad server-side utan att klienten
        kan se det — expires_at ligger i framtiden men servern svarar 401 ändå.
        Då ska besökaren få veta att inloggningen dött, inte mötas av en vägg,
        och den döda sessionen ska städas bort. */
  {
    const t = await öppna({ ttl: 3600, status: 401 });
    await fråga(t.page, "hej");
    const msgs = await t.page.locator("#perMessages").innerText();
    R.ok("401 visar inte inloggningsväggen", !msgs.includes("Logga in för att chatta"), msgs.slice(-140).trim());
    R.ok("401 säger att gratisfrågor finns kvar", /gratisfrågor kvar/i.test(msgs), msgs.slice(-140).trim());
    R.ok("den döda sessionen städas bort",
      await t.page.evaluate(k => localStorage.getItem(k) === null, AUTH_KEY));
    R.ok("gratisraden visas efter städningen", await t.page.locator("#perLandingBar").isVisible());
    await t.close();
  }
} catch (e) {
  process.exitCode = R.finish(e);
  await browser.close(); srv.close(); process.exit(process.exitCode);
}

const code = R.finish();
await browser.close();
srv.close();
process.exit(code);
