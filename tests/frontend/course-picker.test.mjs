import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
/* Kurskatalogen i provskaparen (js/exam-flow.js).
 *
 * Användning:  node tests/frontend/course-picker.test.mjs
 *
 * Kursfältet var fritext utan förslag, och den enda listan i produkten låg i
 * app.htmls gamla wizard — som bara visas om motorn aldrig blir redo. Fyra
 * saker låses här:
 *
 *   1. Befintliga elever tappar inte sina kurser. GY11 måste ligga kvar bredvid
 *      Gy25 — den som började 2024 läser fortfarande "Matematik 1b", och hela
 *      hens provhistorik hänger på just den strängen.
 *   2. Sex kursnamn som inte finns i någon läroplan får inte föreslås.
 *   3. Fältet är fortfarande FRITEXT. Katalogen föreslår, den begränsar inte.
 *   4. Provskaparen dör inte om katalogfilen inte svarar.
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "app.html" });
const R = report("course-picker");
const browser = await chromium.launch();

async function openSubjectStep({ breakCatalog = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await mockApis(page);
  await page.route("**/api/check-role", r => r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
  if (breakCatalog) {
    await page.route("**/config/education-catalog.web.json", r => r.fulfill({ status: 500, body: "" }));
  }
  await seed(page, {});
  await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
  /* Två överlägg fångar annars varje klick: välkomstanimationen (tas bort av en
     timer, inte av en animation — fälla 4 i _harness.mjs) och sidladdaren. */
  await page.evaluate(() => {
    for (const id of ["proviaWelcome", "pageLoader"]) document.getElementById(id)?.remove();
  });
  await page.waitForTimeout(700);
  if (await page.locator("#perOb").count()) await page.keyboard.press("Escape");

  await page.locator("#xf button:visible", { hasText: "Skapa prov" }).first().click();
  await page.waitForTimeout(400);
  /* Materialsteget kan kräva text innan ämnessteget nås. Finns en textarea
     fylls den, annars är vi redan framme. */
  const ta = page.locator("#xf textarea");
  if (await ta.count()) {
    await ta.first().fill("Fotosyntes omvandlar ljusenergi till kemisk energi i kloroplasterna. Kalvincykeln binder koldioxid.");
    await page.locator("#xf button:visible", { hasText: /Vidare|Nästa|Fortsätt/ }).first().click();
    await page.waitForTimeout(500);
  }
  await page.waitForSelector("#xf input[list='xfCourseList']", { state: "visible", timeout: 8000 });
  return { ctx, page, close: () => ctx.close() };
}

async function suggest(page, text) {
  const inp = page.locator("#xf input[list='xfCourseList']");
  await inp.fill(text);
  await page.waitForTimeout(300);
  return page.evaluate(() =>
    [...document.querySelectorAll("#xfCourseList option")].map(o => o.value));
}

try {
  {
    const t = await openSubjectStep();
    const page = t.page;

    const gy11 = await suggest(page, "Matematik 1b");
    R.ok("GY11-kursen föreslås för elever som började före reformen",
      gy11.includes("Matematik 1b"), gy11.slice(0, 3).join(" | "));

    const gy25 = await suggest(page, "Matematik – Nivå");
    R.ok("Gy25-nivåerna föreslås", gy25.length > 0, gy25.slice(0, 3).join(" | "));
    R.ok("Gy25-nivåer visas med ämnesnamn, inte bara 'Nivå 1'",
      gy25.length > 0 && gy25.every(v => v.includes("Matematik")), gy25.slice(0, 2).join(" | "));

    const gr = await suggest(page, "Biologi");
    R.ok("grundskolans ämnen föreslås också",
      gr.some(v => v.includes("(grundskola)")), gr.slice(0, 4).join(" | "));
    /* Rangordning: träffar som börjar på det eleven skrev går först. Utan den
       gav "Biologi" fyrtio rader Bevarandebiologi och Djurens biologi innan
       "Biologi 1" syntes — rätt data, fel svar på frågan. */
    R.ok("förslagen börjar med det eleven skrev",
      gr.slice(0, 5).every(v => v.toLowerCase().startsWith("biologi")), gr.slice(0, 5).join(" | "));
    R.ok("grundskoleämnet ligger bland de första träffarna",
      gr.slice(0, 8).some(v => v.includes("(grundskola)")), gr.slice(0, 8).join(" | "));

    /* De sex namnen fanns i den gamla listan men i ingen läroplan. Prompten i
       generate-exam ber modellen följa Skolverkets centrala innehåll för kursen
       i fråga — en påhittad kurs ger ett prov mot ingenting. */
    for (const påhittad of ["Juridik 1", "Historia 2", "Psykologi 2"]) {
      const rows = await suggest(page, påhittad);
      R.ok(`"${påhittad}" föreslås inte`, !rows.includes(påhittad), rows.slice(0, 3).join(" | "));
    }
    R.ok("de riktiga juridikkurserna föreslås i stället",
      (await suggest(page, "Affärsjuridik")).includes("Affärsjuridik"));

    // Fälla: en datalist med 2192 poster är oanvändbar på telefon.
    const brett = await suggest(page, "ma");
    R.ok("listan kapas i stället för att rendera hela katalogen",
      brett.length <= 50, `${brett.length} poster`);
    R.ok("en enda bokstav ger inga förslag alls",
      (await suggest(page, "m")).length === 0);

    await t.close();
  }

  // Fältet är fortfarande fritext.
  {
    const t = await openSubjectStep();
    const page = t.page;
    await page.locator("#xf input[list='xfCourseList']").fill("Kurs vi aldrig hört talas om");
    await page.locator("#xf button:visible", { hasText: /Vidare/ }).first().click();
    await page.waitForTimeout(500);
    R.ok("en kurs utanför katalogen stoppas inte",
      await page.locator("#xf input[list='xfCourseList']").isVisible() === false);
    await t.close();
  }

  // Katalogen svarar inte.
  {
    const t = await openSubjectStep({ breakCatalog: true });
    const page = t.page;
    const rows = await suggest(page, "Matematik");
    R.ok("utan katalog ges inga förslag, men inget kraschar", rows.length === 0);
    await page.locator("#xf input[list='xfCourseList']").fill("Matematik 1b");
    await page.locator("#xf button:visible", { hasText: /Vidare/ }).first().click();
    await page.waitForTimeout(500);
    R.ok("provskaparen fungerar ändå",
      await page.locator("#xf input[list='xfCourseList']").isVisible() === false);
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
