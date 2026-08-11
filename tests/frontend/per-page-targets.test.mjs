import { ROOT, serve, openPage, report } from "./_harness.mjs";
// Bevisar att målregistret har mer än en konsument: P.E.R kan skicka en
// besökare till rätt PLANKORT på prissidan, inte bara till prissidan — och
// öppna rätt sektion på förbättringssidan.
//
// Användning:  node tests/frontend/per-page-targets.test.mjs

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "pricing.html" });

const R = report("per-page-targets");
const ok = (n, c, d = "") => R.ok(n, c, d);

const browser = await chromium.launch();

// Servern, ruttmockarna, sessionen och splash-förbikopplingen kommer från
// _harness.mjs. Det som står kvar här är det enda den här filen behöver som
// ingen annan gör: user_exams-raden nedan.
async function mk(path) {
  return openPage(browser, srv.url + path, {
    settle: 600,
    mocks: {
      // förbättring.html synkar historik från user_exams innan sidan är klar
      // (shared.js laddas med defer, så det första setPerContext-anropet hinner
      // köras innan window.setPerContext ens finns — synken vinner racet).
      // Utan en rad här skulle synken skriva över den seedade historiken med en
      // tom lista och userScore aldrig hinna sättas; då testar vi inte längre
      // att gamla fält överlever utökningen, bara att de aldrig fanns.
      // Registreras via `extra` och hamnar därmed SIST — den generella
      // **/rest/v1/** hade annars ätit upp den.
      extra: [["**/rest/v1/user_exams**", r => r.fulfill({ json: [
        { id: 1, created_at: new Date().toISOString(), course: "Biologi 1", level: "C", qtype: "mix", material: "", exam: {}, answers: {}, result: { total_points: 62, max_points: 100 } }
      ] })]],
    },
    state: {
      storage: { proviaai_history: [{ percent: 62, course: "Biologi 1", level: "C", ts: Date.now() }] },
    },
  });
}

// ── T1: prissidan deklarerar tre mål ──────────────────────────────────────
{
  const { ctx, page } = await mk("/pricing.html");
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
  const { ctx, page } = await mk("/förbättring.html");
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
await srv.close();
process.exit(R.finish());
