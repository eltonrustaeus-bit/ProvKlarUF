import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
/* Nästa steg i Min utveckling (förbättring.html + api/_mastery-view.js).
 *
 * Användning:  node tests/frontend/next-focus.test.mjs
 *
 * decideNextFocus() räknade redan ut vad eleven borde göra härnäst, men
 * resultatet gick bara in i P.E.R:s prompt — det syntes ingenstans om man inte
 * frågade. Hela kedjan prov → mastery → rekommendation var alltså osynlig för
 * den den handlade om.
 *
 * Två fel låses här:
 *
 *   SKALAN LÄCKER. mastery är en intern 0–100-siffra som ingen förklarat och
 *   ingen lärare satt. Når den ett gränssnitt läses den som ett betyg.
 *   decideNextFocus().reason innehåller den ("ligger på 28 av 100") och är
 *   skriven för en prompt — den texten får aldrig renderas.
 *
 *   TOMT KORT. En rekommendation utan skäl är en order, och ett "nästa steg"
 *   utan data är brus på ett konto som just skapats.
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "förbättring.html" });
const R = report("next-focus");
const browser = await chromium.launch();

const FOCUS_SVAR = {
  ok: true,
  focus: {
    action: "träna_svagt",
    title: "Träna på",
    label: "Presumption i KKöpL",
    reason: "Det här har återkommit i dina prov — 6 försök hittills.",
  },
  concepts: [
    { key: "a", label: "Presumption i KKöpL", level: "behöver träning", attempts: 6 },
    { key: "b", label: "Garanti vs Öppet köp", level: "på gång", attempts: 4 },
    { key: "c", label: "Avtalsrätt", level: "sitter", attempts: 7 },
  ],
};

async function open({ svar = FOCUS_SVAR } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await mockApis(page, { restRows: [{ id: "1", course: "Privatjuridik", percent: 70, result: { per_question: [] } }] });
  await page.route("**/api/check-role", async r => {
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
    if (b.action === "next_focus") return r.fulfill({ json: svar });
    return r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } });
  });
  await seed(page, {});
  await page.goto(`${srv.url}/förbättring.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => { for (const id of ["proviaWelcome", "pageLoader"]) document.getElementById(id)?.remove(); });
  await page.waitForTimeout(900);
  return { ctx, page, close: () => ctx.close() };
}

try {
  {
    const t = await open();
    const kort = t.page.locator(".xfNextFocus");
    R.ok("kortet visas", await kort.count() === 1);
    const text = await kort.innerText();
    R.ok("rekommendationen står som rubrik", /Träna på Presumption i KKöpL/.test(text), text.slice(0, 80));
    R.ok("skälet står med", /återkommit i dina prov/.test(text));
    R.ok("det märks att det är P.E.R", /P\.E\.R rekommenderar/i.test(text));

    /* Kärnregeln: den interna skalan får aldrig renderas. */
    R.ok("ingen 0–100-siffra syns", !/\b\d{1,3}\s*(av|\/)\s*100\b/.test(text), text);
    R.ok("ordet mastery syns inte", !/mastery/i.test(text));

    const chips = await t.page.locator(".xfNextFocus .xfChip").allInnerTexts();
    R.ok("begreppen listas", chips.length === 3, chips.join(" | "));
    R.ok("nivån står i ord", chips.every(c => /behöver träning|på gång|sitter/.test(c)), chips.join(" | "));
    R.ok("ingen siffra i chipsen", !chips.some(c => /\d/.test(c)), chips.join(" | "));

    /* Kortet ska ligga före de fyra vägarna — det är sidans viktigaste rad. */
    R.ok("kortet står före valen", await t.page.evaluate(() => {
      const k = document.querySelector(".xfNextFocus");
      const o = document.querySelector(".xf-opts");
      return !!k && !!o && (k.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }));
    await t.close();
  }

  // Inget att rekommendera → inget kort. Ett tomt kort är brus.
  {
    const t = await open({ svar: { ok: true, focus: null, concepts: [] } });
    R.ok("inget kort när servern inte har något att peka på",
      await t.page.locator(".xfNextFocus").count() === 0);
    R.ok("resten av sidan fungerar ändå", await t.page.locator(".xf-opts").count() >= 1);
    await t.close();
  }

  // Servern felar → sidan ska inte gå sönder.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await mockApis(page);
    await page.route("**/api/check-role", async r => {
      let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
      if (b.action === "next_focus") return r.fulfill({ status: 500, json: { error: "nej" } });
      return r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } });
    });
    await seed(page, {});
    await page.goto(`${srv.url}/förbättring.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    R.ok("sidan överlever ett trasigt anrop", await page.locator(".xf-opts").count() >= 1);
    R.ok("inget halvritat kort", await page.locator(".xfNextFocus").count() === 0);
    await ctx.close();
  }

  // Mobil: kortet är det första eleven ser.
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await mockApis(page);
    await page.route("**/api/check-role", async r => {
      let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
      if (b.action === "next_focus") return r.fulfill({ json: FOCUS_SVAR });
      return r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } });
    });
    await seed(page, {});
    await page.goto(`${srv.url}/förbättring.html`, { waitUntil: "networkidle" });
    await page.evaluate(() => { for (const id of ["proviaWelcome", "pageLoader"]) document.getElementById(id)?.remove(); });
    await page.waitForTimeout(900);
    R.ok("kortet finns på 360 px", await page.locator(".xfNextFocus").count() === 1);
    R.ok("inget vågrätt spill",
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`));
    await ctx.close();
  }
} catch (e) {
  process.exitCode = R.finish(e);
  await browser.close(); srv.close(); process.exit(process.exitCode);
}

const code = R.finish();
await browser.close();
srv.close();
process.exit(code);
