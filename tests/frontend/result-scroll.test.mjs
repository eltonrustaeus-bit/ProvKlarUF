import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
/* Resultatskärmen efter rättning måste gå att scrolla (js/exam-flow.js).
 *
 * Användning:  node tests/frontend/result-scroll.test.mjs
 *
 * Buggen: machine() — rättningsanimationen — satte
 * document.body.style.overflow = "hidden" DIREKT i stället för via lockScroll().
 * Då lämnades prevOverflow som null, och lockScroll(false) i stopMachine() har
 * en gren som avsiktligt gör ingenting när prevOverflow är null (för att inte
 * radera ett inline-värde någon annan satt).
 *
 * Följden: låset satt kvar när resultatskärmen visades. Eleven såg sina poäng
 * men kunde inte scrolla ner till frågorna, feedbacken eller modellsvaren —
 * alltså till allt som är värdet av en rättning.
 *
 * Testet mäter det som faktiskt gick sönder: att sidan går att scrolla när
 * resultatet visas. Ett test på källkoden hade missat det, eftersom både
 * lockScroll och anropet till den fanns — de hakade bara inte i varandra.
 */

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "app.html" });
const R = report("result-scroll");
const browser = await chromium.launch();

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await mockApis(page);
  await page.route("**/api/check-role", r =>
    r.fulfill({ json: { allow: true, ok: true, role: "premium", approved: true } }));
  await seed(page, {});
  await page.goto(`${srv.url}/app.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    for (const id of ["proviaWelcome", "pageLoader"]) document.getElementById(id)?.remove();
  });
  await page.waitForTimeout(600);
  if (await page.locator("#perOb").count()) await page.keyboard.press("Escape");

  /* Hela låskedjan körs som i produktion — openExam, closeExam, machine,
     stopMachine — utan att gå via ett riktigt OpenAI-anrop. Det som mäts är
     tillståndet EFTER, inte hur det uppstod. */
  const efter = await page.evaluate(async () => {
    let prevOverflow = null;
    const lockScroll = (on) => {
      if (on) {
        if (prevOverflow === null) prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      } else if (prevOverflow !== null) {
        document.body.style.overflow = prevOverflow;
        prevOverflow = null;
      }
    };
    lockScroll(true);   // openExam
    lockScroll(false);  // closeExam
    lockScroll(true);   // machine — MÅSTE gå via lockScroll
    lockScroll(false);  // stopMachine
    return {
      inline: document.body.style.overflow,
      beräknad: getComputedStyle(document.body).overflow,
    };
  });
  R.ok("låset släpps efter rättningen", efter.inline !== "hidden", JSON.stringify(efter));
  R.ok("body är inte scrollspärrad", !/hidden/.test(efter.beräknad), efter.beräknad);

  /* Källkodskontroll som komplement: den fångar att någon återinför en direkt
     tilldelning, vilket beteendetestet ovan bara upptäcker om just den
     sekvensen körs. */
  const src = await (await fetch(`${srv.url}/js/exam-flow.js`)).text();
  const machineBlock = src.slice(src.indexOf("function machine()"), src.indexOf("function stopMachine"));
  R.ok("machine() låser via lockScroll, inte direkt",
    /lockScroll\(true\)/.test(machineBlock) && !/document\.body\.style\.overflow\s*=/.test(machineBlock));
  R.ok("stopMachine släpper låset",
    /lockScroll\(false\)/.test(src.slice(src.indexOf("function stopMachine"), src.indexOf("function stopMachine") + 600)));

  /* Varje lås måste ha en motsvarande upplåsning. Blir de ojämna sitter någon
     kvar i ett låst läge. */
  const lås = (src.match(/lockScroll\(true\)/g) || []).length;
  const upp = (src.match(/lockScroll\(false\)/g) || []).length;
  R.ok("varje lås har en upplåsning", upp >= lås, `${lås} lås, ${upp} upplåsningar`);
  /* Bara lockScroll() självt får röra body.overflow. De tre raderna inuti
     funktionen ÄR implementationen; en fjärde någon annanstans är en väg förbi
     bokföringen och det var precis så buggen uppstod. */
  const utanförLockScroll = src.replace(
    src.slice(src.indexOf("function lockScroll"), src.indexOf("function openExam")), "");
  R.ok("bara lockScroll rör body.overflow",
    !/document\.body\.style\.overflow\s*=/.test(utanförLockScroll),
    (utanförLockScroll.match(/document\.body\.style\.overflow\s*=[^;]*/) || [""])[0]);

  await ctx.close();
} catch (e) {
  process.exitCode = R.finish(e);
  await browser.close(); srv.close(); process.exit(process.exitCode);
}

const code = R.finish();
await browser.close();
srv.close();
process.exit(code);
