/* Självtest för js/xf-screens.js.
 *
 * Skärmväxlaren är det andra delade lagret i katalogen efter _harness.mjs, och
 * samma skäl gäller: en delad modul som är fel har inte tagit bort ett fel,
 * bara flyttat det till ett ställe.
 *
 * Testerna är skrivna mot beteendet, inte mot implementationen — de frågar
 * aldrig efter en klass eller ett internt namn som inte är en del av
 * kontraktet. Det som mäts är sådant som är lätt att tappa och tyst när det
 * försvinner: aria-hidden på skärmarna som är av, fokus till den nya rubriken,
 * en enda h1, bakåtknappen och djuplänken.
 *
 * Modulen laddas för sig på en godtycklig sida ur repot och får en egen rot.
 * Den behöver alltså ingen sida som redan använder den, och kan därför skrivas
 * innan någon konsument finns.
 *
 * Användning:  node tests/frontend/xf-screens.mjs
 */
import { ROOT, serve, openPage, report } from "./_harness.mjs";

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT);
const R = report("xf-screens");
const ok = (n, c, d = "") => R.ok(n, c, d);

const browser = await chromium.launch();
let crash = null;
try {

// integritetspolicy.html är den minsta sidan som bär huvudet och har ingen egen
// JS som kan störa mätningen. Vilken sida det är spelar ingen roll — kroppen
// byts ut mot en tom rot innan modulen får något att göra.
async function boot(opts = {}) {
  const { ctx, page } = await openPage(browser, `${srv.url}/integritetspolicy.html`, {
    width: 1280, height: 900, reducedMotion: "reduce",
    waitUntil: "domcontentloaded", settle: 300,
  });
  await page.addScriptTag({ url: "/js/xf-screens.js" });
  await page.evaluate((o) => {
    document.body.innerHTML = '<div id="xf"></div>';
    window.flow = window.XfScreens.create(Object.assign({
      root: document.getElementById("xf"),
      screens: ["hem", "a", "b"],
      title: "Testsida",
    }, o));
  }, opts);
  return { ctx, page };
}

// S1: skärmarna byggs, en per namn.
{
  const { ctx, page } = await boot();
  const n = await page.evaluate(() => document.querySelectorAll(".xf-screen").length);
  ok("S1 en skärm byggs per namn", n === 3, String(n));
  await ctx.close();
}

// S2: exakt en skärm är på, och det är den första.
{
  const { ctx, page } = await boot();
  const v = await page.evaluate(() => ({
    on: [...document.querySelectorAll(".xf-screen.on")].map(s => s.dataset.screen),
    current: window.flow.current(),
  }));
  ok("S2 första skärmen är på från start",
    v.on.length === 1 && v.on[0] === "hem" && v.current === "hem", JSON.stringify(v));
  await ctx.close();
}

// S3: skärmar som är AV måste bära aria-hidden. display:none räcker bara för
// den som ser — en skärmläsare som traverserar DOM:en hittar annars alla
// skärmars rubriker samtidigt, och sidan låter som fem sidor på en gång.
{
  const { ctx, page } = await boot();
  await page.evaluate(() => window.flow.show("a"));
  const v = await page.evaluate(() => [...document.querySelectorAll(".xf-screen")]
    .map(s => [s.dataset.screen, s.getAttribute("aria-hidden")]));
  const fel = v.filter(([n, a]) => (n === "a") !== (a === null));
  ok("S3 avstängda skärmar bär aria-hidden, den påslagna gör det inte",
    fel.length === 0, JSON.stringify(v));
  await ctx.close();
}

// S4: fokus flyttar till den nya skärmens rubrik. Utan det står fokus kvar på
// knappen eleven tryckte — en knapp som nu är display:none — och både
// tangentbord och skärmläsare tappar var de är.
{
  const { ctx, page } = await boot();
  await page.evaluate(() => window.flow.show("b"));
  const v = await page.evaluate(() => {
    const a = document.activeElement;
    return { cls: a.className, screen: a.closest(".xf-screen")?.dataset.screen };
  });
  ok("S4 fokus hamnar på den nya skärmens rubrik",
    v.cls === "xf-say" && v.screen === "b", JSON.stringify(v));
  await ctx.close();
}

// S5: body() tömmer och returnerar rätt skärms kropp.
{
  const { ctx, page } = await boot();
  const v = await page.evaluate(() => {
    const b1 = window.flow.body("a");
    b1.appendChild(document.createElement("p"));
    const b2 = window.flow.body("a");
    return { tom: b2.children.length, rätt: b2.closest(".xf-screen").dataset.screen };
  });
  ok("S5 body() tömmer och tillhör rätt skärm", v.tom === 0 && v.rätt === "a", JSON.stringify(v));
  await ctx.close();
}

// S6: say() skriver i den skärm man pekar ut, inte i den som råkar vara på.
// Det är hela skälet till att namnet är ett argument: js/exam-flow.js har en
// dold röstpekare som mount() flyttar, med en dokumenterad ordningsfälla där
// say() före mount() skriver raden i skärmen eleven just lämnade. Den ärvs inte.
{
  const { ctx, page } = await boot();
  const v = await page.evaluate(() => {
    window.flow.say("b", "Rubrik B", "Under B");   // b är INTE på
    return {
      b: document.querySelector('[data-screen="b"] .xf-say').textContent,
      hem: document.querySelector('[data-screen="hem"] .xf-say').textContent,
    };
  });
  ok("S6 say() skriver i utpekad skärm även när en annan är på",
    v.b === "Rubrik B" && v.hem === "", JSON.stringify(v));
  await ctx.close();
}

// S7: okänt skärmnamn byter ingenting och rapporterar det. Ett tyst false hade
// gjort en felstavad destination omöjlig att skilja från en som inte hände.
{
  const { ctx, page } = await boot();
  const v = await page.evaluate(() => ({
    svar: window.flow.show("finns-inte"),
    current: window.flow.current(),
  }));
  ok("S7 okänt skärmnamn ignoreras och rapporteras",
    v.svar === false && v.current === "hem", JSON.stringify(v));
  await ctx.close();
}

// S8: hash:false rör aldrig adressfältet.
{
  const { ctx, page } = await boot({ hash: false });
  await page.evaluate(() => window.flow.show("a"));
  const h = await page.evaluate(() => location.hash);
  ok("S8 utan hash-läge lämnas adressen orörd", h === "", h);
  await ctx.close();
}

// S9: hash:true skriver skärmen i adressen — men inte den första, som är
// sidans grundtillstånd och inte förtjänar ett eget fragment.
{
  const { ctx, page } = await boot({ hash: true });
  await page.evaluate(() => window.flow.show("a"));
  const h1 = await page.evaluate(() => location.hash);
  await page.evaluate(() => window.flow.show("hem"));
  const h2 = await page.evaluate(() => location.hash);
  ok("S9 hash följer skärmen, utom på den första",
    h1 === "#a" && h2 === "", `${h1} / ${h2}`);
  await ctx.close();
}

// S10: bakåtknappen. Ett skärmbyte som inte går att ångra med webbläsarens egen
// knapp är en fälla på telefon, där det ofta är den enda knappen som används.
{
  const { ctx, page } = await boot({ hash: true });
  await page.evaluate(() => window.flow.show("a"));
  await page.goBack();
  await page.waitForTimeout(300);
  const v = await page.evaluate(() => ({ current: window.flow.current(), hash: location.hash }));
  ok("S10 bakåtknappen går tillbaka till föregående skärm",
    v.current === "hem" && v.hash === "", JSON.stringify(v));
  await ctx.close();
}

// S11: djuplänk. app.html och P.E.R länkar hit med ett fragment, och landar man
// på ingången i stället är länken en lögn.
{
  const { ctx, page } = await openPage(browser, `${srv.url}/integritetspolicy.html#b`, {
    width: 1280, height: 900, reducedMotion: "reduce",
    waitUntil: "domcontentloaded", settle: 300,
  });
  await page.addScriptTag({ url: "/js/xf-screens.js" });
  const v = await page.evaluate(() => {
    document.body.innerHTML = '<div id="xf"></div>';
    const f = window.XfScreens.create({
      root: document.getElementById("xf"),
      screens: ["hem", "a", "b"], title: "T", hash: true,
    });
    return f.current();
  });
  ok("S11 djuplänk landar på rätt skärm", v === "b", String(v));
  await ctx.close();
}

// S12: sidan får exakt en h1, och den är dold. Fem skärmar med var sin h1 ger
// ingen dokumentstruktur alls — samma skäl som js/exam-flow.js har sin.
{
  const { ctx, page } = await boot();
  const v = await page.evaluate(() => {
    const h = document.querySelectorAll("h1");
    const s = document.querySelectorAll(".xf-say");
    return { h1: h.length, text: h[0]?.textContent, sayTag: s[0]?.tagName };
  });
  ok("S12 en dold h1, skärmrubrikerna är h2",
    v.h1 === 1 && v.text === "Testsida" && v.sayTag === "H2", JSON.stringify(v));
  await ctx.close();
}

// S13: on()-återanropet får skärmnamnet, en gång per faktiskt byte. Ett anrop
// för ett byte som inte skedde hade fått konsumenten att rita om sig själv
// under fingret på den som just klickade.
{
  const { ctx, page } = await boot();
  const v = await page.evaluate(() => {
    const sedda = [];
    window.flow.on(n => sedda.push(n));
    window.flow.show("a");
    window.flow.show("b");
    window.flow.show("b");   // samma skärm igen
    return sedda;
  });
  ok("S13 on() ropar en gång per faktiskt byte",
    JSON.stringify(v) === '["a","b"]', JSON.stringify(v));
  await ctx.close();
}

} catch (e) { crash = e; }
await browser.close();
await srv.close();
process.exit(R.finish(crash));
