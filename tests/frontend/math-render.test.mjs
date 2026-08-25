import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
/* Matematikrendering i provet och rättningen (js/exam-flow.js).
 *
 * Användning:  node tests/frontend/math-render.test.mjs
 *
 * KaTeX-CDN:t stubbas. Testet mäter VÅR inkoppling — att renderMath anropas på
 * rätt noder vid rätt tillfälle — inte att KaTeX fungerar. Att hämta 280 kB
 * från jsdelivr i en testsvit vore ett nätverksberoende utan motsvarande
 * upptäckt: går CDN:t ner är det inte den här kodens fel, och js/hp-math.js
 * används redan skarpt av Högskoleprovet.
 *
 * Det som bevakas:
 *   - matematik i en fråga renderas
 *   - rättningsvyn renderas (frågan, återkopplingen, elevens EGET svar — som
 *     sedan fotoinlämningen bär LaTeX)
 *   - en fråga utan matematik hämtar aldrig KaTeX (prestandabudgeten)
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "app.html" });
const R = report("math-render");
const browser = await chromium.launch();

const q = (id, question, type = "short") => ({
  id, type, points: 4, question,
  options: type === "mc" ? ["$1$", "$2$", "$3$"] : [],
  correct_index: type === "mc" ? 1 : -1,
  topic: "Ekvationer", cognitive_level: "tillämpa", source_references: ["s.1"],
  model_answer: "$x = 5$",
  scoring_rubric: { parts: [{ description: "Metod", points: 2 }], full_score_requirements: "", partial_credit_notes: "" },
});

const MATTEPROV = { title: "Matteprov", level: "C", questions: [
  q("m1", "Lös ekvationen $3x + 7 = 22$. Visa din lösning."),
  q("m2", "Beräkna $\\frac{3}{4} + \\frac{1}{6}$."),
]};
const TEXTPROV = { title: "Historieprov", level: "C", questions: [
  q("h1", "Beskriv orsakerna till franska revolutionen."),
]};

async function öppna(exam, ämne) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const katexHämtad = [];

  /* Stubbar hela KaTeX-leveransen. renderMathInElement märker noden i stället
     för att rendera, så testet kan se PRECIS vilka noder vi skickar in. */
  await page.route("**/katex@**", async r => {
    const u = r.request().url();
    katexHämtad.push(u);
    if (u.endsWith(".css")) return r.fulfill({ contentType: "text/css", body: "" });
    if (u.includes("auto-render")) {
      return r.fulfill({ contentType: "application/javascript", body:
        `window.renderMathInElement = function (el) {
           el.setAttribute('data-math-rendered', (Number(el.getAttribute('data-math-rendered')) || 0) + 1);
           (window.__mathNodes = window.__mathNodes || []).push(el.className || el.tagName);
         };` });
    }
    return r.fulfill({ contentType: "application/javascript", body: "window.katex = {};" });
  });

  await mockApis(page, {
    profiles: { id: "u1", approved: true, role: "premium" },
    extra: [
      ["**/api/generate-exam", r => r.fulfill({ json: { ok: true, exam: JSON.parse(JSON.stringify(exam)), meta: { quota: { enforced: false } } } })],
      ["**/api/grade", async r => {
        let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch {}
        const qs = b.questions || [];
        return r.fulfill({ json: { ok: true, result: {
          total_points: 2, max_points: 4 * qs.length,
          per_question: qs.map(x => ({
            id: String(x.id), points: 2, max_points: 4,
            feedback: "Du flyttade termen utan att byta tecken: $3x = 15$ blev fel.",
            model_answer: "$x = 5$",
          })),
        } } });
      }],
    ],
  });
  await seed(page, { user: { id: "u1", email: "u1@t.se" } });
  await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#xf .xf-screen.on", { timeout: 8000 });
  await page.click("#xf .xf-screen[data-screen='start'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.fill("#xf .xf-screen[data-screen='subject'] .xf-input", ämne);
  await page.click("#xf .xf-screen[data-screen='subject'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='aim'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.fill("#xf .xf-screen[data-screen='material'] .xf-area",
    "Ekvationer löses genom att isolera x steg för steg. Först flyttas alla termer utan x till högerledet, sedan divideras båda leden med koefficienten framför x. Exempel: 2x + 4 = 10 ger först 2x = 6 och därefter x = 3.");
  await page.waitForTimeout(150);
  await page.click("#xf .xf-screen[data-screen='material'] .xf-btn.primary"); await page.waitForTimeout(200);
  await page.click("#xf .xf-screen[data-screen='contract'] .xf-btn.primary");
  await page.waitForSelector(".xf-exam.on", { timeout: 10000 });
  await page.waitForTimeout(600);
  return { page, katexHämtad, close: () => ctx.close() };
}

const renderade = page => page.evaluate(() => window.__mathNodes || []);

try {
  /* ── Provet ─────────────────────────────────────────────────────────────── */
  {
    const t = await öppna(MATTEPROV, "Matematik 2b");
    await t.page.waitForTimeout(900);

    R.ok("KaTeX hämtas när frågan innehåller matematik", t.katexHämtad.length > 0,
      String(t.katexHämtad.length) + " filer");
    const noder = await renderade(t.page);
    R.ok("frågetexten skickas till renderingen", noder.some(n => String(n).includes("xf-q-text")), JSON.stringify(noder));
    R.ok("frågenoden är märkt som renderad",
      await t.page.locator(".xf-q-text").getAttribute("data-math-rendered") !== null);
    await t.close();
  }

  /* ── Rättningsvyn ───────────────────────────────────────────────────────── */
  {
    const t = await öppna(MATTEPROV, "Matematik 2b");
    /* Svara med LaTeX — precis vad fotoinlämningens transkription skriver. */
    await t.page.locator(".xf-answer").fill("$3x + 7 = 22$\n$3x = 15$\n$x = 8$");
    await t.page.waitForTimeout(200);
    await t.page.evaluate(() => { window.__mathNodes = []; });

    /* Inlämningen bekräftas med en dialog. Samma mönster som
       exam-flow.regression.mjs T7 använder: klicka Nästa tills Lämna in dyker
       upp, i sidans egen kontext så att varje klick träffar en färsk nod. */
    t.page.on("dialog", d => d.accept().catch(() => {}));
    await t.page.evaluate(() => {
      for (let i = 0; i < 10; i++) {
        const b = Array.from(document.querySelectorAll(".xf-exam-nav .xf-btn")).find(x => /Lämna in/.test(x.textContent));
        if (b) { b.click(); return; }
        const n = Array.from(document.querySelectorAll(".xf-exam-nav .xf-btn")).find(x => /Nästa/.test(x.textContent));
        if (n) n.click();
      }
    });
    await t.page.waitForSelector("#xf .xf-screen[data-screen='result'].on", { timeout: 15000 });
    await t.page.waitForTimeout(900);

    const noder = await renderade(t.page);
    R.ok("rättningsposterna skickas till renderingen",
      noder.some(n => String(n).includes("xf-item")), JSON.stringify(noder).slice(0, 200));
    const märkta = await t.page.locator(".xf-item[data-math-rendered]").count();
    R.ok("varje rättningspost är renderad", märkta > 0, String(märkta) + " poster");
    /* Elevens eget svar bär LaTeX sedan fotoinlämningen. Renderas hela posten
       täcks frågan, återkopplingen, fullpoängssvaret och elevsvaret på en gång. */
    const text = await t.page.locator(".xf-item").first().innerText();
    R.ok("återkopplingen finns i posten", /byta tecken/.test(text), text.slice(0, 120));
    await t.close();
  }

  /* ── Prestandabudgeten ──────────────────────────────────────────────────── */
  {
    /* En ren textfråga får aldrig kosta 280 kB. js/hp-math.js har en
       förhandskontroll just för det, och den måste hålla även här. */
    const t = await öppna(TEXTPROV, "Historia 1b");
    await t.page.waitForTimeout(900);
    R.ok("KaTeX hämtas INTE för en fråga utan matematik",
      t.katexHämtad.length === 0, t.katexHämtad.join(", "));
    R.ok("frågan visas ändå",
      /franska revolutionen/i.test(await t.page.locator(".xf-q-text").innerText()));
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
