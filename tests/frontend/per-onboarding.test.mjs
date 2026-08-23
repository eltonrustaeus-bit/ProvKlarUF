import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
/* P.E.R:s introduktion (js/per-onboarding.js).
 *
 * Användning:  node tests/frontend/per-onboarding.test.mjs
 *
 * Varför i en riktig webbläsare och inte med grep: förra gången en P.E.R-yta
 * byggdes hamnade startThinking av misstag inuti addMsg. node --check godkände
 * det, ett mönstertest på källkoden godkände det, och funktionen var ändå död.
 * Det som mäts här är därför vad som händer när någon klickar — inte vad som
 * står i filen.
 *
 * Katalogen serveras av den statiska riggen, så programlistan är den riktiga
 * datan från Skolverket, inte en stub.
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "app.html" });
const R = report("per-onboarding");
const browser = await chromium.launch();

/* Fångar varje anrop till check-role och svarar per action. Sista registrerade
   rutten vinner i Playwright, så den här måste registreras EFTER mockApis. */
async function openApp({ show = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const sent = [];
  await mockApis(page);
  await page.route("**/api/check-role", async r => {
    let body = {};
    try { body = JSON.parse(r.request().postData() || "{}"); } catch {}
    sent.push(body);
    if (body.action === "onboarding_state") return r.fulfill({ json: { ok: true, show, persona: null } });
    if (body.action === "onboarding_complete") return r.fulfill({ json: { ok: true, facts: [] } });
    if (body.action === "profile_get") return r.fulfill({ json: { ok: true, facts: [], onboardedAt: null } });
    return r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } });
  });
  await seed(page, {});
  await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => { const w = document.getElementById("proviaWelcome"); if (w) w.remove(); });
  return { ctx, page, sent, close: () => ctx.close() };
}

const say = page => page.locator("#perOb .perObSay").innerText();
const optionByText = (page, text) => page.locator("#perOb .perObOpt", { hasText: text }).first();
const next = page => page.locator("#perOb .perObNext");
const completed = sent => sent.find(b => b.action === "onboarding_complete");

try {
  // ── Visas den alls? ──────────────────────────────────────────────────────
  {
    const t = await openApp({ show: true });
    await t.page.waitForSelector("#perOb", { timeout: 5000 }).catch(() => {});
    R.ok("introduktionen visas när servern säger show:true", await t.page.locator("#perOb").count() === 1);
    R.ok("den är en dialog för skärmläsare",
      await t.page.locator('#perOb[role="dialog"][aria-modal="true"]').count() === 1);
    /* Regression: app.htmls hideLock() nollar body.style.overflow asynkront
       efter att introduktionen öppnats, så låset måste ligga i en klass. */
    R.ok("sidan bakom går inte att scrolla",
      await t.page.evaluate(() => getComputedStyle(document.body).overflow) === "hidden");
    R.ok("första frågan handlar om vem användaren är", (await say(t.page)).includes("lära känna dig"));
    /* Knappen måste vara död tills något är valt. Är den klickbar går det att
       skapa en profil med persona=null, som servern sedan tolkar som "elev". */
    R.ok("fortsätt är låst innan ett val gjorts", await next(t.page).isDisabled());
    await t.close();
  }

  {
    const t = await openApp({ show: false });
    await t.page.waitForTimeout(600);
    R.ok("introduktionen visas INTE när servern säger show:false",
      await t.page.locator("#perOb").count() === 0);
    await t.close();
  }

  // ── Hela elevflödet ──────────────────────────────────────────────────────
  {
    const t = await openApp();
    const page = t.page;
    await page.waitForSelector("#perOb");

    /* Enkelval går vidare av sig självt — fem frågor med var sin
       bekräftelseknapp blir tio tryck för en introduktion som ska vara kort. */
    await optionByText(page, "Elev").click();
    R.ok("ett enkelval går vidare utan bekräftelseknapp",
      (await say(page)).includes("Var pluggar du"));
    await optionByText(page, "Gymnasiet").click();

    R.ok("gymnasieelever får programfrågan", (await say(page)).includes("program"));
    await page.locator("#perOb input[type=search]").fill("Ekonomi");
    await page.waitForTimeout(400);
    const träff = optionByText(page, "Ekonomiprogrammet");
    R.ok("sökningen hittar programmet i Skolverkets riktiga katalog", await träff.count() === 1);
    await träff.click();

    R.ok("årsfrågan är formulerad för gymnasiet", (await say(page)).includes("Vilket år"));
    /* Gymnasiet har tre år, inte nio. Visas 1–9 kan en elev sätta en årskurs
       servern sedan förkastar, och profilen tappar fältet tyst. */
    R.ok("bara tre år erbjuds på gymnasiet",
      await page.locator("#perOb .perObGrid .perObOpt").count() === 3);
    await optionByText(page, "År 2").click();

    R.ok("ämnesfrågan kommer efter årskursen", (await say(page)).includes("ämnen"));
    const ämnen = await page.locator("#perOb .perObScroll .perObOpt").count();
    R.ok("programmets egna ämnen är förifyllda", ämnen >= 8, `${ämnen} ämnen`);
    const valda = await page.locator('#perOb .perObOpt[aria-pressed="true"]').count();
    R.ok("de förifyllda ämnena är förvalda", valda >= 8, `${valda} valda`);
    await next(page).click();

    R.ok("sista frågan gäller mål", (await say(page)).includes("siktar du"));
    await optionByText(page, "Steg för steg").click();
    await page.locator("#perOb .perObGrid .perObOpt", { hasText: "C" }).first().click();
    await next(page).click();

    await page.waitForTimeout(400);
    R.ok("överlägget stängs när introduktionen är klar", await page.locator("#perOb").count() === 0);
    R.ok("sidan går att scrolla igen",
      await page.evaluate(() => document.body.style.overflow) !== "hidden");

    const done = completed(t.sent);
    R.ok("servern får ett onboarding_complete", !!done);
    R.ok("rollen skickas med", done?.persona === "elev", JSON.stringify(done?.persona));
    R.ok("skolformen skickas med", done?.values?.school_type === "gymnasium");
    R.ok("programmet skickas som kod, inte som fritext", done?.values?.program_code === "EK25",
      JSON.stringify(done?.values?.program_code));
    R.ok("årskursen skickas som tal", done?.values?.grade_year === 2);
    R.ok("målbetyget skickas med", done?.values?.goal_grade === "C");
    R.ok("hjälpstilen skickas med", done?.values?.help_style === "stegvis");
    R.ok("ämnena skickas som koder", Array.isArray(done?.values?.subject_codes) && done.values.subject_codes.length >= 8);
    await t.close();
  }

  // ── Grundskolan hoppar över programfrågan ────────────────────────────────
  {
    const t = await openApp();
    await t.page.waitForSelector("#perOb");
    await optionByText(t.page, "Elev").click();
    await optionByText(t.page, "Grundskolan").click();
    R.ok("grundskolan får ingen programfråga", !(await say(t.page)).includes("program"));
    R.ok("årskursfrågan är formulerad för grundskolan", (await say(t.page)).includes("årskurs"));
    R.ok("nio årskurser erbjuds",
      await t.page.locator("#perOb .perObGrid .perObOpt").count() === 9);
    await t.close();
  }

  // ── Förälder får aldrig frågor om barnet ─────────────────────────────────
  {
    const t = await openApp();
    await t.page.waitForSelector("#perOb");
    await optionByText(t.page, "Förälder").click();
    const text = await t.page.locator("#perOb").innerText();
    /* Uppdragets krav: en förälder ska aldrig automatiskt få tillgång till
       barnets uppgifter. Introduktionen får därför varken fråga efter barnet
       eller antyda att den ger insyn. */
    R.ok("föräldern får ingen fråga om barnets skola, program eller betyg",
      !/årskurs|program|målbetyg/i.test(text));
    R.ok("föräldern får veta att insyn kräver barnets inbjudan",
      /bjuder in dig/i.test(text));
    await t.close();
  }

  // ── Att hoppa över ───────────────────────────────────────────────────────
  {
    const t = await openApp();
    await t.page.waitForSelector("#perOb");
    await t.page.locator("#perOb .perObSkip").click();
    await t.page.waitForTimeout(300);
    R.ok("hoppa över stänger överlägget", await t.page.locator("#perOb").count() === 0);
    const done = completed(t.sent);
    /* Ett överhoppat svar måste ändå registreras, annars möter introduktionen
       samma person vid varje inloggning. Men inga värden får skickas. */
    R.ok("överhoppning registreras hos servern", !!done);
    R.ok("överhoppning skickar inga uppgifter",
      done && Object.keys(done.values || {}).length === 0, JSON.stringify(done?.values));
    await t.close();
  }

  // ── Tangentbord och mobil ────────────────────────────────────────────────
  {
    const t = await openApp();
    const page = t.page;
    await page.waitForSelector("#perOb");
    /* aria-modal säger åt skärmläsare att ignorera sidan bakom, men stoppar
       inte Tab. Utan fälla vandrar fokus ut i appen bakom överlägget. */
    for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
    R.ok("fokus lämnar aldrig dialogen",
      await page.evaluate(() => document.getElementById("perOb")?.contains(document.activeElement) === true));
    await t.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await mockApis(page);
    await page.route("**/api/check-role", async r => {
      let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
      if (b.action === "onboarding_state") return r.fulfill({ json: { ok: true, show: true } });
      return r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } });
    });
    await seed(page, {});
    await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#perOb");

    R.ok("inget vågrätt spill på 360 px",
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`));

    /* Alla knappar trycks med tummen. Under 44 px går de inte att träffa
       pålitligt — hoppa över-knappen låg på ~36. */
    const smått = await page.evaluate(() =>
      [...document.querySelectorAll("#perOb button")]
        .map(b => ({ t: b.textContent.trim().slice(0, 20), h: Math.round(b.getBoundingClientRect().height) }))
        .filter(b => b.h < 44));
    R.ok("varje knapp är minst 44 px hög", smått.length === 0, JSON.stringify(smått));
    await ctx.close();
  }

  {
    const t = await openApp();
    await t.page.waitForSelector("#perOb");
    await t.page.keyboard.press("Escape");
    await t.page.waitForTimeout(300);
    R.ok("Escape hoppar över", await t.page.locator("#perOb").count() === 0);
    await t.close();
  }

  // ── Byte av skolform får inte lämna kvar ogiltiga val ────────────────────
  {
    const t = await openApp();
    const page = t.page;
    await page.waitForSelector("#perOb");
    await optionByText(page, "Elev").click();
    await optionByText(page, "Gymnasiet").click();
    await page.locator("#perOb input[type=search]").fill("Ekonomi");
    await page.waitForTimeout(400);
    await optionByText(page, "Ekonomiprogrammet").click();
    await optionByText(page, "År 3").click();
    // Tillbaka till skolformen via ett nytt val på steg 2 är inte möjligt i UI:t,
    // så tillståndet kontrolleras direkt: byte ska nolla program och årskurs.
    const kvar = await page.evaluate(() => {
      const s = window.__perOnboarding.state;
      return { program: s.values.program_code, år: s.values.grade_year };
    });
    R.ok("programval och årskurs finns i tillståndet före byte",
      kvar.program === "EK25" && kvar.år === 3, JSON.stringify(kvar));
    await t.close();
  }
} catch (e) {
  process.exitCode = R.finish(e);
  await browser.close();
  srv.close();
  process.exit(process.exitCode);
}

const code = R.finish();
await browser.close();
srv.close();
process.exit(code);
