import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
/* Fota din lösning — bildinlämning vid fritextfrågor (js/exam-flow.js).
 *
 * Användning:  node tests/frontend/solution-photo.test.mjs
 *
 * /api/ocr stubbas. Detta testar UI-lagret och bryggan window.ExGenEngine, inte
 * avläsningen. Hur bra modellen faktiskt läser handskrift mäts i
 * tests/evals/solution-ocr — en siffra som inte hör hemma i en testsvit som ska
 * kunna köras gratis och offline.
 *
 * Det som bevakas här är att eleven behåller kontrollen: transkriptionen skrivs
 * in i rutan men skickas aldrig automatiskt, den skriver aldrig över något
 * eleven redan skrivit, och osäkra ställen når eleven. Utan det sista kan en
 * felläst siffra tyst bli ett betyg.
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "app.html" });
const R = report("solution-photo");
const browser = await chromium.launch();

/* Fråga 2 är type:"short" — fritext, och därmed den enda som ska få kameran.
   1 och 3 är flerval. */
const EXAM = {
  title: "Matteprov", level: "C",
  questions: [
    { id: "m1", type: "mc", points: 2, question: "Vad är $2+2$?", options: ["3", "4", "5", "6"], correct_index: 1, topic: "Aritmetik", cognitive_level: "minnas", source_references: ["s.1"], model_answer: "4", scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" } },
    { id: "m2", type: "short", points: 4, question: "Lös ekvationen $3x + 7 = 22$. Visa din lösning.", options: [], correct_index: -1, topic: "Ekvationer", cognitive_level: "tillämpa", source_references: ["s.4"], model_answer: "x = 5", scoring_rubric: { parts: [{ description: "Uträkning", points: 2 }], full_score_requirements: "", partial_credit_notes: "" } },
    { id: "m3", type: "mc", points: 2, question: "Vad är $10/2$?", options: ["2", "5", "10", "20"], correct_index: 1, topic: "Division", cognitive_level: "minnas", source_references: ["s.6"], model_answer: "5", scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" } },
  ],
};

const LÄST = { ok: true, readable: true, text: "$3x + 7 = 22$\n$3x = 15$\n$x = 8$", confidence: 0.92, uncertain: [] };

/* ocr: vad /api/ocr ska svara. role: elevens roll (styr rollspärren). */
async function öppna({ ocr = LÄST, ocrStatus = 200, role = "premium" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const anrop = [];
  /* currentRole i app.html sätts av checkApprovalAndUnlock(), som läser
     profiles-TABELLEN — inte /api/check-role. Rollspärren på fotoinlämningen
     hänger på den, så profiles måste mockas explicit. Utan raden nedan är
     eleven alltid "gratis" och varje avläsningstest mäter rollspärren. */
  await mockApis(page, {
    role,
    profiles: { id: "u1", approved: true, role },
    extra: [
      ["**/api/generate-exam", r => r.fulfill({ json: { ok: true, exam: JSON.parse(JSON.stringify(EXAM)), meta: { quota: { enforced: false } } } })],
      ["**/api/ocr", async r => {
        let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
        anrop.push(b);
        if (ocrStatus !== 200) return r.fulfill({ status: ocrStatus, json: { ok: false, error: "nope" } });
        return r.fulfill({ json: ocr });
      }],
    ],
  });
  await seed(page, { user: { id: "u1", email: "u1@t.se" }, role });
  await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
  await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.fill("#xf .xf-screen[data-screen='subject'] .xf-input", "Matematik 2b");
  await page.click("#xf .xf-screen[data-screen='subject'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='aim'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.fill("#xf .xf-screen[data-screen='material'] .xf-area",
    "Ekvationer löses genom att isolera x steg för steg. Först flyttas alla termer utan x till högerledet, sedan divideras båda leden med koefficienten framför x. Exempel: 2x + 4 = 10 ger först 2x = 6 och därefter x = 3. Samma metod gäller för alla förstagradsekvationer.");
  await page.waitForTimeout(150);
  await page.click("#xf .xf-screen[data-screen='material'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
  await page.waitForSelector(".xf-exam.on", { timeout: 10000 });
  await page.waitForTimeout(300);
  return { page, anrop, close: () => ctx.close() };
}

/* Går till fråga n (1-indexerad) via dot-raden. */
const till = async (page, n) => {
  await page.locator(".xf-dot").nth(n - 1).click();
  await page.waitForTimeout(350);
};

/* Lägger en fil på input:file utan att öppna en filväljare. */
const lämna = (page) => page.locator(".xf-photo-input").setInputFiles({
  name: "losning.png", mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
});

try {
  /* ── Var knappen får finnas ─────────────────────────────────────────────── */
  {
    const t = await öppna();
    await till(t.page, 2);
    R.ok("K1 kameraknappen finns vid fritextfrågan", await t.page.locator(".xf-photo-btn").isVisible());

    await till(t.page, 1);
    R.ok("K2 flervalsfråga får ingen kameraknapp", await t.page.locator(".xf-photo-btn").count() === 0);
    await till(t.page, 3);
    R.ok("K2 gäller även sista flervalsfrågan", await t.page.locator(".xf-photo-btn").count() === 0);
    await t.close();
  }

  /* ── Transkriptionen når svaret ─────────────────────────────────────────── */
  {
    const t = await öppna();
    await till(t.page, 2);
    await lämna(t.page);
    await t.page.waitForTimeout(900);

    const ta = await t.page.locator(".xf-answer").inputValue();
    R.ok("K3 transkriptionen hamnar i svarsrutan", ta.includes("3x = 15"), JSON.stringify(ta));
    R.ok("K3 elevens felaktiga steg bevaras", ta.includes("x = 8"), JSON.stringify(ta));

    /* Rutan är bara ytan. Det som rättas är S.answers — utan den kopplingen
       ser eleven sin lösning men skickar in ett tomt svar. */
    const draft = await t.page.evaluate(() => {
      const k = Object.keys(localStorage).find(x => x.startsWith("exgen_flow_draft"));
      return k ? localStorage.getItem(k) : null;
    });
    R.ok("K3 svaret sparas i utkastet", !!draft && draft.includes("3x = 15"), String(draft).slice(0, 160));

    R.ok("K3 frågans text skickas med till avläsningen",
      /Lös ekvationen/.test(t.anrop[0]?.questionText || ""), JSON.stringify(t.anrop[0]?.questionText));
    R.ok("K3 anropet är märkt som lösningsavläsning", t.anrop[0]?.mode === "solution", String(t.anrop[0]?.mode));
    await t.close();
  }

  /* ── Eleven behåller kontrollen ─────────────────────────────────────────── */
  {
    const t = await öppna();
    await till(t.page, 2);
    await t.page.locator(".xf-answer").fill("Jag började så här: 3x = 15");
    await t.page.waitForTimeout(200);
    await lämna(t.page);
    await t.page.waitForTimeout(900);

    const ta = await t.page.locator(".xf-answer").inputValue();
    R.ok("K4 elevens egen text skrivs inte över", ta.includes("Jag började så här"), JSON.stringify(ta));
    R.ok("K4 transkriptionen läggs till efter", ta.includes("x = 8"), JSON.stringify(ta));

    await t.page.locator(".xf-answer").fill(ta + "\nrättat av mig");
    await t.page.waitForTimeout(200);
    R.ok("K7 rutan går att redigera efteråt",
      (await t.page.locator(".xf-answer").inputValue()).includes("rättat av mig"));
    await t.close();
  }

  /* ── Osäkerhet når eleven ───────────────────────────────────────────────── */
  {
    const t = await öppna({
      ocr: { ok: true, readable: true, text: "$x = 15$", confidence: 0.42, uncertain: ["rad 1: kan vara 15 eller 45"] },
    });
    await till(t.page, 2);
    await lämna(t.page);
    await t.page.waitForTimeout(900);

    const note = await t.page.locator(".xf-photo-note").innerText();
    R.ok("K6 osäkra ställen visas för eleven", /15 eller 45/.test(note), note);
    R.ok("K6 eleven uppmanas kontrollera", /kontrollera/i.test(note), note);
    R.ok("K6 låg säkerhet markeras",
      (await t.page.locator(".xf-photo-note").getAttribute("class") || "").includes("warn"),
      await t.page.locator(".xf-photo-note").getAttribute("class"));
    await t.close();
  }

  /* ── Felvägarna ─────────────────────────────────────────────────────────── */
  {
    const t = await öppna({ ocr: { ok: true, readable: false, text: "", confidence: 0.1, uncertain: [] } });
    await till(t.page, 2);
    await t.page.locator(".xf-answer").fill("mitt eget svar");
    await t.page.waitForTimeout(200);
    await lämna(t.page);
    await t.page.waitForTimeout(900);

    R.ok("K5 oläslig bild lämnar rutan orörd",
      (await t.page.locator(".xf-answer").inputValue()) === "mitt eget svar",
      await t.page.locator(".xf-answer").inputValue());
    const note = await t.page.locator(".xf-photo-note").innerText();
    R.ok("K5 eleven får veta varför", /kunde inte tyda/i.test(note), note);
    await t.close();
  }
  {
    const t = await öppna({ role: "gratis" });
    await till(t.page, 2);
    await lämna(t.page);
    await t.page.waitForTimeout(900);
    const note = await t.page.locator(".xf-photo-note").innerText();
    R.ok("K8 gratisroll får ett begripligt besked", /Basic/i.test(note), note);
    R.ok("K8 inget tekniskt fel visas", !/error|500|failed/i.test(note), note);
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
