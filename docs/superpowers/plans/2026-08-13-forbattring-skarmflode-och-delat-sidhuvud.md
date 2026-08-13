# Förbättringssidan som skärmflöde + delat sidhuvud — implementationsplan

> **För agentiska arbetare:** OBLIGATORISK UNDERSKILL: använd
> superpowers:subagent-driven-development (rekommenderat) eller
> superpowers:executing-plans för att genomföra planen uppgift för uppgift.
> Stegen använder kryssrutor (`- [ ]`).

**Spec:** `docs/superpowers/specs/2026-08-13-forbattring-skarmflode-och-delat-sidhuvud-design.md`

**Mål:** `förbättring.html` blir ett skärmflöde i app-sidans form, och sidhuvudet
går från fyra implementationer med olika innehåll till en fil som renderar det.

**Arkitektur:** Två nya delade lager — `js/xf-screens.js` (skärmväxlaren) och ett
utbyggt `js/exgen-shell.js` (renderar hela huvudet ur en lista). Förbättringssidan
skrivs om ovanpå det första; åtta sidor migreras till det andra. `js/exam-flow.js`
och alla avstängda moduler lämnas orörda.

**Stack:** Vanlig HTML/CSS/JS, ingen byggkedja. ES5 i `js/*.js` (samma stil som
`shared.js` och `js/exam-flow.js`), ESM i `tests/**`.

## Globala krav

Gäller varje uppgift. Bryts något av det här är uppgiften inte klar.

- **Designtokens ändras aldrig.** Inga nya färger, inga nya radier, inga nya
  skuggor. Allt hämtas ur `exgen-tokens.css`. Skalan för `--exgen-space-*` är
  **1/2/3/4/6/8/12/16** — 5, 7, 9, 10 finns inte, och en hänvisning till en
  token som saknas gör hela CSS-raden ogiltig utan ett ljud.
- **Avstängda moduler rörs inte:** `korkortet.html`, `provia-hp.html`,
  `live-demo.html`. `js/exgen-modules.js` ändras inte.
- **Körkortsraden behålls** i den delade navlistan med `data-module="korkort"`.
- **`js/exam-flow.js` ändras inte.** Inte en rad.
- **`js/exgen-shell.js` måste laddas före `shared.js`** på varje sida. Båda är
  `defer` och körs i dokumentordning när `readyState` är `"interactive"` — och
  `shared.js` anropar då `syncLoginButtons()` **direkt**, inte via
  `DOMContentLoaded`. Renderas huvudet efter det får kontoknappen aldrig sin
  etikett rättad och står kvar på "Logga in" för en inloggad elev.
- **ES5 i `js/*.js`:** `var`, `function`, inga pilfunktioner, ingen `const`.
  Matchar filerna runt omkring.
- **Ingen `innerHTML` med användardata.** Befintlig `esc()` används där text från
  prov eller felbank sätts.
- **`api/`-katalogen rörs inte** i den här planen. Ingen säkerhetsgranskning
  utlöses.
- **Varje uppgift avslutas med en commit.** Meddelandet skrivs på svenska i
  imperativ, `type(scope): rad` och en brödtext som säger *varför*.
- **Testerna körs med** `node tests/frontend/<fil>.mjs` från repots rot.

---

## Filstruktur

| Fil | Ansvar | Uppgift |
|---|---|---|
| `js/xf-screens.js` | **Ny.** Skärmväxlare: bygger N skärmar, visar en, sköter fokus, aria och hash. | 1 |
| `exgen-ui.css` | Får `.xf-screen`/`.xf-inner`-reglerna, som flyttar hit från `exam-flow.css`. | 1 |
| `exam-flow.css` | Blir av med samma regler. Ingen annan ändring. | 1 |
| `tests/frontend/xf-screens.mjs` | **Ny.** Självtest för skärmväxlaren. | 1 |
| `js/exgen-shell.js` | Går från att binda en knapp till att rendera hela huvudet. | 2 |
| `exgen-shell.css` | Får menyknappen, arket, dimmern; tappar inget. | 2 |
| `tests/frontend/header-render.mjs` | **Ny.** Kontrakt för det renderade huvudet. | 2 |
| 8 × `*.html` | Byter sitt headerblock mot `<div data-xg-header></div>`. | 3 |
| `style.css` | Halva menydubbleringen raderas; resten får en kommentar. | 3 |
| `tests/frontend/header-behaviour.mjs` | Byggs ut från 6 till 8 sidor + arkets krav. | 3 |
| `förbättring.html` | Skrivs om till fem skärmar. | 4, 5, 6 |
| `tests/frontend/forbattring-flow.mjs` | **Ny.** Kontrakt för skärmflödet. | 4, 5, 6 |
| `tests/frontend/_harness.test.mjs` | Driftspärren utökas med skärmväxlaren. | 7 |

---

## Uppgift 1: `js/xf-screens.js` — skärmväxlaren

**Filer:**
- Skapa: `js/xf-screens.js`
- Skapa: `tests/frontend/xf-screens.mjs`
- Ändra: `exgen-ui.css` (lägg till `.xf-screen`-block sist, före mediafrågorna)
- Ändra: `exam-flow.css:49-74` (ta bort samma block)

**Gränssnitt (det senare uppgifter bygger på):**

```js
var flow = XfScreens.create({
  root: document.getElementById("xf"),
  screens: ["hem", "felbank", "prov", "coach", "rapport"],
  title: "Min utveckling",
  hash: true
});
flow.show("felbank");           // byter skärm, flyttar fokus, skriver historik
flow.body("felbank");           // returnerar .xf-body, tömd
flow.say("felbank", "Felbank", "34 frågor du tappat poäng på.");
flow.busy("coach", true);       // .busy på orben
flow.current();                 // "felbank"
flow.on(function (name) { … }); // anropas efter varje skärmbyte
```

**Avsiktlig skillnad mot `exam-flow.js`:** där finns en dold "aktuell röst"-pekare
som `mount()` flyttar, med en dokumenterad ordningsfälla — anropar man `say()`
före `mount()` skrivs raden i skärmen eleven just lämnade. Här tar varje anrop
sitt skärmnamn, så fällan kan inte uppstå.

- [ ] **Steg 1: Skriv självtestet först**

Skapa `tests/frontend/xf-screens.mjs`. Det behöver ingen sida ur repot — det
bygger sin egen DOM i webbläsaren.

```js
/* Självtest för js/xf-screens.js.
 *
 * Skärmväxlaren är det andra delade lagret i katalogen efter _harness.mjs, och
 * samma skäl gäller: en delad modul som är fel har inte tagit bort ett fel,
 * bara flyttat det till ett ställe. Testerna nedan är skrivna mot beteendet,
 * inte mot implementationen — de frågar aldrig efter en klass som inte är en
 * del av kontraktet.
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

// Sidan spelar ingen roll — modulen laddas för sig och får en egen rot. Vi tar
// integritetspolicy.html för att den är liten och inte har någon egen JS som
// kan störa mätningen.
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
  ok("S2 första skärmen är på från start", v.on.length === 1 && v.on[0] === "hem" && v.current === "hem",
    JSON.stringify(v));
  await ctx.close();
}

// S3: REGRESSIONEN som gör hela modulen meningsfull. Skärmar som är AV måste
// bära aria-hidden — annars traverserar en skärmläsare alla fem skärmarnas
// rubriker på en gång, och display:none räcker bara för den som ser.
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
    return { tag: a.tagName, cls: a.className, screen: a.closest(".xf-screen")?.dataset.screen };
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
// Det är hela skälet till att namnet är ett argument: exam-flow.js har en dold
// röstpekare och en dokumenterad ordningsfälla, och den ärvs inte hit.
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

// S7: okänt skärmnamn byter ingenting och rapporterar det.
{
  const { ctx, page } = await boot();
  const v = await page.evaluate(() => ({
    svar: window.flow.show("finns-inte"),
    current: window.flow.current(),
  }));
  ok("S7 okänt skärmnamn ignoreras och rapporteras", v.svar === false && v.current === "hem",
    JSON.stringify(v));
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
  ok("S9 hash följer skärmen, utom på den första", h1 === "#a" && h2 === "", `${h1} / ${h2}`);
  await ctx.close();
}

// S10: bakåtknappen. Ett skärmbyte som inte går att ångra med webbläsarens egen
// knapp är en fälla på telefon, där det ofta är den enda knappen som används.
{
  const { ctx, page } = await boot({ hash: true });
  await page.evaluate(() => window.flow.show("a"));
  await page.goBack();
  await page.waitForTimeout(200);
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
// ingen dokumentstruktur alls — samma skäl som exam-flow.js har sin.
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

// S13: on()-återanropet får skärmnamnet, en gång per byte.
{
  const { ctx, page } = await boot();
  const v = await page.evaluate(() => {
    const sedda = [];
    window.flow.on(n => sedda.push(n));
    window.flow.show("a");
    window.flow.show("b");
    window.flow.show("b");   // samma skärm igen — ska inte ropa en gång till
    return sedda;
  });
  ok("S13 on() ropar en gång per faktiskt byte", JSON.stringify(v) === '["a","b"]', JSON.stringify(v));
  await ctx.close();
}

} catch (e) { crash = e; }
await browser.close();
await srv.close();
process.exit(R.finish(crash));
```

- [ ] **Steg 2: Kör testet och se det bli rött**

```bash
node tests/frontend/xf-screens.mjs
```

Förväntat: kraschar eller 0/13, med `window.XfScreens is undefined`. Filen finns inte än.

- [ ] **Steg 3: Skriv `js/xf-screens.js`**

```js
/* js/xf-screens.js — skärmväxlaren, delad.
 *
 * Bygger N skärmar med samma form som provskaparen, visar en åt gången och
 * sköter det som är lätt att glömma: aria-hidden på skärmarna som är av,
 * fokus till den nya skärmens rubrik, en enda h1 på sidan, och — om man ber
 * om det — webbläsarens historik.
 *
 * Formen är identisk med den js/exam-flow.js bygger, så exgen-ui.css:s
 * vokabulär gäller rakt av:
 *
 *   section.xf-screen > div.xf-inner
 *     > div.xf-per > div.xf-orb + div > h2.xf-say + p.xf-sub
 *     > div.xf-body
 *
 * Den här filen är INTE utbruten ur exam-flow.js. Provfl��det lämnas orört —
 * det är den högst riskerade filen på sajten, och en delad modul är inte värd
 * att betala för med provet. Följden är två implementationer av samma idé, och
 * det är avsiktligt och avgränsat: driftspärren i tests/frontend/_harness.test.mjs
 * ser till att det aldrig blir en tredje.
 *
 * En avsiktlig skillnad mot exam-flow.js: där finns en dold "aktuell röst"-
 * pekare som mount() flyttar, med en dokumenterad ordningsfälla — say() före
 * mount() skriver raden i skärmen eleven just lämnade. Här tar varje anrop sitt
 * skärmnamn som argument, så fällan kan inte uppstå.
 */
(function (global) {
  "use strict";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var SR_ONLY =
    "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;" +
    "clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0";

  function create(opts) {
    opts = opts || {};
    var root = opts.root;
    var names = opts.screens || [];
    var useHash = !!opts.hash;
    if (!root || !names.length) throw new Error("xf-screens: root och screens krävs");

    var parts = {};      // namn -> { screen, say, sub, orb, body }
    var current = null;
    var listeners = [];

    /* Sidans enda h1, visuellt dold. Skärmarnas rubriker är h2 — fem h1 i
       samma DOM (en per skärm) ger ingen dokumentstruktur alls. */
    if (opts.title) {
      var h1 = el("h1", null, opts.title);
      h1.style.cssText = SR_ONLY;
      root.appendChild(h1);
    }

    names.forEach(function (name) {
      var sc = el("section", "xf-screen");
      sc.dataset.screen = name;
      sc.setAttribute("aria-hidden", "true");

      var inner = el("div", "xf-inner");
      var per = el("div", "xf-per");
      var orb = el("div", "xf-orb");
      orb.setAttribute("aria-hidden", "true");

      var col = el("div");
      col.style.cssText = "flex:1;min-width:0";
      var say = el("h2", "xf-say");
      /* tabindex -1: fokuserbar programmatiskt vid skärmbyte, utan att hamna i
         tabbordningen. */
      say.tabIndex = -1;
      var sub = el("p", "xf-sub");
      /* aria-live på undertexten, inte på rubriken: rubriken annonseras redan
         av fokusflytten, och två annonseringar av samma byte är brus. */
      sub.setAttribute("aria-live", "polite");
      col.appendChild(say);
      col.appendChild(sub);
      per.appendChild(orb);
      per.appendChild(col);

      var body = el("div", "xf-body");
      inner.appendChild(per);
      inner.appendChild(body);
      sc.appendChild(inner);
      root.appendChild(sc);

      parts[name] = { screen: sc, say: say, sub: sub, orb: orb, body: body };
    });

    function hashFor(name) {
      /* Den första skärmen är sidans grundtillstånd och får inget eget
         fragment — annars bär en delad länk till startläget ett fragment som
         inte betyder något. */
      return name === names[0] ? "" : "#" + name;
    }

    function apply(name) {
      names.forEach(function (n) {
        var on = n === name;
        parts[n].screen.classList.toggle("on", on);
        /* display:none räcker för den som ser. En skärmläsare som traverserar
           DOM:en hittar annars alla skärmars rubriker samtidigt. */
        if (on) parts[n].screen.removeAttribute("aria-hidden");
        else parts[n].screen.setAttribute("aria-hidden", "true");
      });
      current = name;
      /* "instant" är ett giltigt ScrollBehavior-värde men aldrig en egenskap på
         window — en feature-detektering här väljer alltid "auto" och ger en
         mjuk scroll där en omedelbar var meningen. */
      window.scrollTo({ top: 0, behavior: "instant" });
      try { parts[name].say.focus({ preventScroll: true }); }
      catch (_) { parts[name].say.focus(); }
      for (var i = 0; i < listeners.length; i++) listeners[i](name);
    }

    function show(name, silent) {
      if (!parts[name]) return false;
      if (name === current) return true;
      if (useHash && !silent) {
        /* pushState, inte location.hash: hash-tilldelning utlöser hashchange,
           som skulle ropa tillbaka hit och byta skärm en gång till. pushState
           är tyst och ger ändå bakåtknappen ett steg att gå till. */
        history.pushState({ xf: name }, "", location.pathname + location.search + hashFor(name));
      }
      apply(name);
      return true;
    }

    if (useHash) {
      window.addEventListener("popstate", function () {
        var want = decodeURIComponent(location.hash.replace(/^#/, ""));
        show(parts[want] ? want : names[0], true);
      });
    }

    /* Startläge. En djuplänk (förbättring.html#felbank) ska landa på sin skärm
       — annars är länken app.html och P.E.R skickar eleven till en lögn. */
    var start = useHash ? decodeURIComponent(location.hash.replace(/^#/, "")) : "";
    apply(parts[start] ? start : names[0]);

    return {
      show: function (name) { return show(name, false); },
      current: function () { return current; },
      has: function (name) { return !!parts[name]; },
      body: function (name) {
        var p = parts[name];
        if (!p) return null;
        p.body.innerHTML = "";
        return p.body;
      },
      say: function (name, text, sub) {
        var p = parts[name];
        if (!p) return;
        p.say.textContent = text == null ? "" : String(text);
        p.sub.textContent = sub == null ? "" : String(sub);
      },
      busy: function (name, on) {
        var p = parts[name];
        if (p) p.orb.classList.toggle("busy", !!on);
      },
      on: function (fn) { if (typeof fn === "function") listeners.push(fn); }
    };
  }

  global.XfScreens = { create: create };
})(window);
```

- [ ] **Steg 4: Flytta `.xf-screen`-reglerna till `exgen-ui.css`**

Ta bort raderna 49–74 ur `exam-flow.css` (från kommentaren `/* ── Skärm ── */`
till och med `.xf-screen.on > .xf-inner { … }`) och lägg in dem sist i
`exgen-ui.css`, med en rad om varför de flyttade:

```css
/* ── Skärmar ─────────────────────────────────────────────────────────────── */
/* Bodde i exam-flow.css tills js/xf-screens.js gav dem en andra användare.
   Förbättringssidan kan inte ladda exam-flow.css — den drar med sig
   .xf-exam som position:fixed över hela viewporten på en sida utan prov.
   app.html laddar båda filerna, så flytten syns inte där. */

.xf-screen {
  flex: 1;
  display: none;
  flex-direction: column;
  align-items: center;
  padding: clamp(24px, 6vh, 72px) 20px calc(96px + env(safe-area-inset-bottom, 0px));
}

.xf-screen.on { display: flex; }

.xf-inner {
  width: 100%;
  max-width: var(--xf-measure);
  /* auto-marginal i stället för justify-content:center. Båda centrerar när
     innehållet får plats, men centrering klipper toppen när det inte gör det —
     och resultatskärmen med tolv frågor gör det aldrig. */
  margin: auto 0;
}

/* Varje skärm kommer in genom att lyfta sig själv. Kort och en gång — rörelse
   som säger "ny skärm", inte rörelse som underhållning. */
.xf-screen.on > .xf-inner {
  animation: xf-rise var(--exgen-motion-slow) var(--exgen-motion-ease) both;
}
```

Kontrollera att `@keyframes xf-rise` finns i `exgen-ui.css`. Gör den inte det
måste den följa med från `exam-flow.css` — annars slutar animationen fungera på
app.html också.

```bash
grep -n "xf-rise" exgen-ui.css exam-flow.css
```

`exam-flow.css:640` (`prefers-reduced-motion`-blocket) refererar
`.xf-screen.on > .xf-inner` och ska stå kvar där — den regeln gäller app.html
och skadar ingen. Lägg motsvarande rad i `exgen-ui.css`:s eget
reduced-motion-block.

- [ ] **Steg 5: Kör testet igen — grönt**

```bash
node tests/frontend/xf-screens.mjs
```

Förväntat: `13/13`.

- [ ] **Steg 6: Muteringskontroll**

Bevisa att S3 och S10 faktiskt mäter något. Ta tillfälligt bort
`sc.setAttribute("aria-hidden", "true")` ur `apply()` och kör om — S3 ska bli
röd. Ta bort `popstate`-lyssnaren och kör om — S10 ska bli röd. Återställ båda.

- [ ] **Steg 7: app.html är oförändrad**

CSS:en flyttade mellan två filer som app.html laddar båda. Bevisa att det inte
syntes:

```bash
node tests/frontend/per-visual.mjs
```

Förväntat: `app.html` inom brusgolvet i båda vyerna. Blir den det inte är
flytten inte likvärdig — läs skärmdumparna i `.test-out/per-visual/` innan något
annat görs.

- [ ] **Steg 8: Commit**

```bash
git add js/xf-screens.js tests/frontend/xf-screens.mjs exgen-ui.css exam-flow.css
git commit -F- <<'EOF'
feat(xf-screens): skärmväxlaren blir ett eget lager

Förbättringssidan ska bli ett skärmflöde i samma form som provskaparen.
Mekaniken finns redan i js/exam-flow.js — screen(), mount(), buildDom() —
men den filen driver själva provet och bryts inte upp för det här.

Ny modul i stället, med samma DOM-form så exgen-ui.css gäller rakt av,
och med en avsiktlig skillnad: varje anrop tar sitt skärmnamn. exam-flow
har en dold röstpekare som mount() flyttar, och en dokumenterad
ordningsfälla där say() före mount() skriver i skärmen eleven just
lämnade. Den fällan ärvs inte.

.xf-screen-reglerna flyttar från exam-flow.css till exgen-ui.css.
Förbättringssidan kan inte ladda exam-flow.css — den drar med sig
.xf-exam som position:fixed över en sida utan prov. app.html laddar
båda, så flytten syns inte där; per-visual.mjs mätte det.

Självtestet är skrivet mot beteendet: aria-hidden på skärmar som är av,
fokus till den nya rubriken, en enda h1, bakåtknappen, djuplänk.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Uppgift 2: sidhuvudet renderas ur en lista

**Filer:**
- Ändra: `js/exgen-shell.js` (skrivs om helt)
- Ändra: `exgen-shell.css` (menyknapp, ark, dimmer läggs till)
- Skapa: `tests/frontend/header-render.mjs`

Ingen sida migreras i den här uppgiften — bara motorn och dess kontrakt.

**Gränssnitt:**

```html
<div data-xg-header></div>
<script>window.XG_MENU_EXTRA = [ { label: "…", id: "…", pill: "…" } ];</script>
<script src="js/exgen-shell.js" defer></script>
<script src="shared.js" defer></script>
```

Aktuell sida härleds ur `location.pathname` — inte ur ett attribut sidan sätter,
som kan bli fel. `förbättring.html` kommer URL-kodad och måste avkodas.

- [ ] **Steg 1: Skriv kontraktet först**

Skapa `tests/frontend/header-render.mjs`:

```js
/* Kontrakt för det renderade sidhuvudet.
 *
 * Innan den här filen fanns huvudet i fyra implementationer med olika innehåll
 * per sida: index saknade sitt Hem, förbättring saknade både Hem och Min
 * utveckling, admin saknade Körkortsteorin. Tre öppna-klasser stöddes samtidigt
 * i CSS (.drop.on, .dropdown.is-open, .dropdown.open) och style.css bar varje
 * menyregel dubbelt.
 *
 * Testet mäter renderaren, inte sidorna — det är header-behaviour.mjs jobb.
 *
 * Användning:  node tests/frontend/header-render.mjs
 */
import { ROOT, serve, openPage, report } from "./_harness.mjs";

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT);
const R = report("header-render");
const ok = (n, c, d = "") => R.ok(n, c, d);

const browser = await chromium.launch();
let crash = null;
try {

// integritetspolicy.html är den minsta sidan som bär huvudet och har ingen egen
// JS som kan störa mätningen.
const open = (width, hash = "") => openPage(browser, `${srv.url}/integritetspolicy.html${hash}`, {
  width, height: 900, reducedMotion: "reduce", waitUntil: "domcontentloaded", settle: 700,
});

const NAV = ["index.html", "app.html", "förbättring.html", "korkortet.html", "pricing.html"];

// H1: renderaren bygger huvudet ur platshållaren.
{
  const { ctx, page } = await open(1280);
  const v = await page.evaluate(() => ({
    header: !!document.querySelector("header.xg-header"),
    nav: !!document.querySelector(".xg-nav"),
    utility: !!document.querySelector(".xg-utility-bar"),
    kvar: !!document.querySelector("[data-xg-header]:empty"),
  }));
  ok("H1 huvudet renderas och platshållaren fylls",
    v.header && v.nav && v.utility && !v.kvar, JSON.stringify(v));
  await ctx.close();
}

// H2: listan är komplett. Inte "de sidor någon råkade lägga in".
{
  const { ctx, page } = await open(1280);
  const v = await page.evaluate(() =>
    [...document.querySelectorAll(".xg-nav a")].map(a => decodeURIComponent(a.getAttribute("href"))));
  ok("H2 navlistan är komplett och i rätt ordning",
    JSON.stringify(v) === JSON.stringify(["index.html", "app.html", "förbättring.html", "korkortet.html", "pricing.html"]),
    JSON.stringify(v));
  await ctx.close();
}

// H3: körkortsraden FINNS i markupen men är dold. exgen-modules.js injicerar
// sin regel före första målningen, och hela poängen med filen är att en flagga
// ska räcka den dag modulen släpps. Tas raden bort ur listan krävs en
// kodändring i stället.
{
  const { ctx, page } = await open(1280);
  const v = await page.evaluate(() => {
    const a = document.querySelector('.xg-nav a[href="korkortet.html"]');
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { module: a.getAttribute("data-module"), synlig: r.width > 0 && r.height > 0 };
  });
  ok("H3 körkortsraden finns med data-module och är dold medan flaggan är av",
    !!v && v.module === "korkort" && v.synlig === false, JSON.stringify(v));
  await ctx.close();
}

// H4: mobilarket bär SAMMA destinationer som skrivbordsnaven — inklusive den
// sida man står på. Att utelämna den aktuella sidan var precis det som gjorde
// menyn olika beroende på var man stod.
{
  const { ctx, page } = await open(390);
  await page.click(".xg-menu-btn");
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({
    nav: [...document.querySelectorAll(".xg-nav a")].map(a => a.getAttribute("href")),
    ark: [...document.querySelectorAll(".xg-menu a[href]")].map(a => a.getAttribute("href")),
  }));
  const arkNav = v.ark.filter(h => v.nav.includes(h));
  ok("H4 arket bär samma destinationer som naven",
    JSON.stringify(arkNav) === JSON.stringify(v.nav), JSON.stringify(v));
  await ctx.close();
}

// H5: arket är fullbrett på telefon. Den gamla panelen var en 240px
// skrivbordsdropdown i hörnet.
{
  const { ctx, page } = await open(390);
  await page.click(".xg-menu-btn");
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => {
    const r = document.querySelector(".xg-menu").getBoundingClientRect();
    return { w: Math.round(r.width), vw: window.innerWidth, x: Math.round(r.x) };
  });
  ok("H5 arket fyller skärmbredden", v.w >= v.vw - 1 && v.x <= 1, JSON.stringify(v));
  await ctx.close();
}

// H6: raderna går att träffa med en tumme.
{
  const { ctx, page } = await open(390);
  await page.click(".xg-menu-btn");
  await page.waitForTimeout(400);
  const v = await page.evaluate(() =>
    [...document.querySelectorAll(".xg-menu-item")].map(e => Math.round(e.getBoundingClientRect().height)));
  ok("H6 varje rad är minst 52px hög", v.length > 0 && v.every(h => h >= 52), JSON.stringify(v));
  await ctx.close();
}

// H7: Escape stänger, och fokus lämnas tillbaka till knappen. Utan det står
// fokus kvar i ett ark som inte längre syns.
{
  const { ctx, page } = await open(390);
  await page.click(".xg-menu-btn");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({
    öppen: document.querySelector(".xg-menu").classList.contains("on"),
    fokus: document.activeElement.className,
    aria: document.querySelector(".xg-menu-btn").getAttribute("aria-expanded"),
  }));
  ok("H7 Escape stänger arket och lämnar tillbaka fokus",
    !v.öppen && v.fokus.includes("xg-menu-btn") && v.aria === "false", JSON.stringify(v));
  await ctx.close();
}

// H8: stängt ark får inte ligga och fånga klick. Ett osynligt överlägg över
// sidan är precis den sortens fel som inte syns förrän någon inte kan trycka
// på en knapp.
{
  const { ctx, page } = await open(390);
  const v = await page.evaluate(() => {
    const m = document.querySelector(".xg-menu");
    const cs = getComputedStyle(m);
    const r = m.getBoundingClientRect();
    return { display: cs.display, visibility: cs.visibility, h: Math.round(r.height) };
  });
  ok("H8 stängt ark upptar ingen yta", v.display === "none" || v.h === 0, JSON.stringify(v));
  await ctx.close();
}

// H9: sidlokala poster hamnar i arket utan att blandas med navigeringen.
{
  const { ctx, page } = await open(390);
  await page.evaluate(() => {
    document.querySelector("[data-xg-header]")?.remove();
    const d = document.createElement("div");
    d.setAttribute("data-xg-header", "");
    document.body.prepend(d);
    window.XG_MENU_EXTRA = [{ label: "Rensa all data", id: "testExtra", pill: "!" }];
    window.XgShell.render();
  });
  await page.click(".xg-menu-btn");
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => {
    const e = document.getElementById("testExtra");
    return { finns: !!e, iArket: !!e?.closest(".xg-menu"), iNaven: !!e?.closest(".xg-nav") };
  });
  ok("H9 sidlokala poster hamnar i arket, inte i navigeringen",
    v.finns && v.iArket && !v.iNaven, JSON.stringify(v));
  await ctx.close();
}

// H10: skriptordningen. shared.js anropar syncLoginButtons() DIREKT vid
// defer-körning (readyState är "interactive", inte "loading"), så ett huvud som
// renderas efteråt får aldrig sin etikett rättad. Kontrolleras i källan, inte i
// DOM:en — felet syns bara för en inloggad besökare och skulle annars smyga in.
{
  const fs = await import("node:fs");
  const files = ["index.html", "pricing.html", "app.html", "konto.html",
    "förbättring.html", "integritetspolicy.html", "larare.html", "admin.html"];
  const fel = files.filter(f => {
    const src = fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    const shell = src.indexOf("js/exgen-shell.js");
    const shared = src.indexOf("shared.js");
    if (shell < 0) return false;               // sidan är inte migrerad än
    return shared >= 0 && shell > shared;
  });
  ok("H10 exgen-shell.js laddas före shared.js på varje migrerad sida",
    fel.length === 0, fel.join(", "));
}

} catch (e) { crash = e; }
await browser.close();
await srv.close();
process.exit(R.finish(crash));
```

- [ ] **Steg 2: Kör och se rött**

```bash
node tests/frontend/header-render.mjs
```

Förväntat: H1–H9 röda (`integritetspolicy.html` har fortfarande sitt gamla
handskrivna huvud), H10 grön (ingen sida är migrerad än, så villkoret är tomt).

- [ ] **Steg 3: Skriv om `js/exgen-shell.js`**

```js
/* exgen-shell.js — sidhuvudet: markup OCH beteende.
 *
 * Filen band tidigare bara mobilknappen. Skälet till att den nu renderar hela
 * huvudet är mätt: navigeringen fanns i fyra implementationer med olika
 * innehåll per sida.
 *
 *   index                saknade sitt eget Hem
 *   förbättring          saknade både Hem och Min utveckling
 *   admin                saknade Körkortsteorin
 *   app, korkortet       egna klassnamn (.ddItem) och egna animationer
 *   larare               ingen navigering alls
 *
 * Dessutom bar style.css varje menyregel dubbelt (.mWrap/.menuWrap,
 * .drop/.dropdown, .ddi/.ddItem) och tre öppna-klasser stöddes samtidigt.
 * Ingen av skillnaderna var ett beslut — de var vad som hände när samma sak
 * skrevs åtta gånger.
 *
 * En sida deklarerar bara att den vill ha huvudet:
 *
 *     <div data-xg-header></div>
 *
 * Sidlokala poster (app-sidans skrollankare, förbättringssidans "Rensa all
 * data") sätts före skriptet:
 *
 *     <script>window.XG_MENU_EXTRA = [{ label: "…", id: "…", pill: "…" }];</script>
 *
 * ORDNINGSKRAV: den här filen måste laddas FÖRE shared.js. Båda är defer och
 * körs i dokumentordning när readyState är "interactive" — och shared.js
 * anropar då syncLoginButtons() direkt, inte via DOMContentLoaded. Renderas
 * huvudet efteråt står kontoknappen kvar på "Logga in" för en inloggad elev.
 * tests/frontend/header-render.mjs (H10) läser skriptordningen i källan.
 *
 * korkortet.html, provia-hp.html och live-demo.html migreras INTE hit. Deras
 * moduler är avstängda i js/exgen-modules.js och sidorna omdirigerar till
 * startsidan. Körkortsraden står ändå kvar i listan nedan med sitt data-module,
 * så att en enda flagga räcker den dag modulen släpps.
 */
(function (global) {
  "use strict";

  /* Ikonerna är path-data, inte hela SVG:er, så att storlek och stroke sätts på
     ett ställe. Samma ikoner som de handskrivna menyerna bar. */
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>',
    pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    car: '<path d="M5 11 8.5 5h7L19 11"/><rect x="2" y="11" width="20" height="8" rx="2"/><circle cx="7.5" cy="19" r="2"/><circle cx="16.5" cy="19" r="2"/>',
    card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
  };

  /* Sajtens navigering. En lista, en gång. */
  var NAV = [
    { href: "index.html",       label: "Hem",            icon: "home" },
    { href: "app.html",         label: "Mockprov",       icon: "doc",   pill: "AI" },
    { href: "förbättring.html", label: "Min utveckling", icon: "pulse", pill: "Coach" },
    { href: "korkortet.html",   label: "Körkortsteorin", icon: "car",   pill: "Nytt", module: "korkort" },
    { href: "pricing.html",     label: "Priser",         icon: "card",  pill: "29/79" }
  ];

  function svg(name) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || "") + "</svg>";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  /* Vilken sida vi står på. Härleds ur adressen, inte ur ett attribut sidan
     sätter — ett attribut kan bli fel vid en kopiering och märker det aldrig.
     Avkodning behövs: förbättring.html kommer som f%C3%B6rb%C3%A4ttring.html. */
  function currentPage() {
    var p = decodeURIComponent(location.pathname).split("/").pop();
    return p || "index.html";
  }

  function markup() {
    var here = currentPage();

    var navHtml = NAV.map(function (item) {
      var on = item.href === here;
      return '<a class="xg-nav-link' + (on ? " active" : "") + '"' +
        (item.module ? ' data-module="' + item.module + '"' : "") +
        ' href="' + esc(item.href) + '"' + (on ? ' aria-current="page"' : "") + ">" +
        esc(item.label) + "</a>";
    }).join("");

    var itemHtml = NAV.map(function (item) {
      var on = item.href === here;
      return '<a class="xg-menu-item' + (on ? " active" : "") + '"' +
        (item.module ? ' data-module="' + item.module + '"' : "") +
        ' href="' + esc(item.href) + '"' + (on ? ' aria-current="page"' : "") + ">" +
        '<span class="xg-menu-ico">' + svg(item.icon) + "</span>" +
        "<span>" + esc(item.label) + "</span>" +
        (item.pill ? '<span class="xg-menu-pill">' + esc(item.pill) + "</span>" : "") +
        "</a>";
    }).join("");

    /* Sidlokala poster. En knapp, aldrig en länk — det som är sidlokalt är en
       handling på sidan, inte en destination. Blandas de med navigeringen blir
       arket olika per sida igen, vilket är felet filen finns för att laga. */
    var extra = (global.XG_MENU_EXTRA || []).map(function (item) {
      return '<button class="xg-menu-item" type="button"' +
        (item.id ? ' id="' + esc(item.id) + '"' : "") +
        (item.scroll ? ' data-scroll="' + esc(item.scroll) + '"' : "") + ">" +
        "<span>" + esc(item.label) + "</span>" +
        (item.pill ? '<span class="xg-menu-pill">' + esc(item.pill) + "</span>" : "") +
        "</button>";
    }).join("");

    return '' +
      '<div class="xg-utility-bar">' +
        '<div class="xg-utility-wrap">' +
          '<a class="xg-utility-badge" href="https://ungdrive.se" target="_blank" rel="noopener" aria-label="Backed by UngDrive">' +
            '<img src="/image/ungdrive-icon.png" width="12" height="12" alt="">' +
            "<span>Backed by UngDrive</span>" +
          "</a>" +
          '<div class="xg-utility-right"><a href="integritetspolicy.html">Integritetspolicy</a></div>' +
        "</div>" +
      "</div>" +
      '<header class="xg-header">' +
        '<div class="xg-header-wrap">' +
          '<a class="xg-brand" href="index.html">' +
            '<img src="image/exgen-logo.png" alt="ExGen" width="20" height="20" style="height:20px;width:auto">' +
            '<div class="xg-brand-tag">Studieplattform för skolan</div>' +
          "</a>" +
          '<div class="xg-header-right">' +
            '<nav class="xg-nav" aria-label="Huvudnavigation">' + navHtml + "</nav>" +
            '<a class="xg-login-btn" href="konto.html" data-pv-auth="login">Logga in</a>' +
            '<button class="xg-menu-btn" type="button" aria-label="Meny" aria-expanded="false" aria-controls="xgMenu">' +
              '<span class="xg-menu-bars" aria-hidden="true"><span></span><span></span><span></span></span>' +
            "</button>" +
          "</div>" +
        "</div>" +
      "</header>" +
      '<div class="xg-menu-dim" hidden></div>' +
      '<nav class="xg-menu" id="xgMenu" aria-label="Meny" hidden>' +
        itemHtml +
        '<div class="xg-menu-sep"></div>' +
        '<a class="xg-menu-item" href="konto.html" data-pv-auth="login">' +
          '<span class="xg-menu-ico">' + svg("user") + "</span><span>Mitt konto</span></a>" +
        '<button class="xg-menu-item" type="button" id="xgLogout">' +
          '<span class="xg-menu-ico">' + svg("lock") + "</span><span>Logga ut</span>" +
          '<span class="xg-menu-pill">Lås</span></button>' +
        (extra ? '<div class="xg-menu-sep"></div>' + extra : "") +
      "</nav>";
  }

  function bind() {
    var btn = document.querySelector(".xg-menu-btn");
    var menu = document.querySelector(".xg-menu");
    var dim = document.querySelector(".xg-menu-dim");
    if (!btn || !menu || !dim) return;

    function open() {
      menu.hidden = false; dim.hidden = false;
      requestAnimationFrame(function () {
        menu.classList.add("on"); dim.classList.add("on");
      });
      btn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      var first = menu.querySelector("a, button");
      if (first) first.focus();
    }

    function close(restoreFocus) {
      if (!menu.classList.contains("on")) return;
      menu.classList.remove("on"); dim.classList.remove("on");
      btn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      /* hidden sätts först när övergången är klar. Sätts den direkt hoppar
         arket bort i stället för att glida, och ett stängt ark som ligger kvar
         utan hidden fångar klick över hela sidan. */
      window.setTimeout(function () {
        if (!menu.classList.contains("on")) { menu.hidden = true; dim.hidden = true; }
      }, 200);
      /* Fokus tillbaka till knappen. Utan det står fokus kvar i ett ark som
         inte längre syns, och nästa Tab börjar någonstans i tomma luften. */
      if (restoreFocus !== false) btn.focus();
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.classList.contains("on") ? close() : open();
    });
    dim.addEventListener("click", function () { close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    /* Ett klick på en länk navigerar ändå — att lämna arket öppet bakom sig var
       en skillnad utan avsikt i de gamla implementationerna. */
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) window.setTimeout(function () { close(false); }, 80);
    });

    /* Fokusfälla. Ett öppet ark som täcker sidan får inte gå att tabba ur — då
       hamnar fokus i innehåll som ligger under ett överlägg. */
    menu.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = menu.querySelectorAll("a[href], button:not([disabled])");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function render() {
    var slot = document.querySelector("[data-xg-header]");
    if (!slot) return;
    slot.innerHTML = markup();
    bind();
  }

  global.XgShell = { render: render, NAV: NAV };
  render();
})(window);
```

- [ ] **Steg 4: Lägg till CSS i `exgen-shell.css`**

Lägg sist i filen. Använd bara befintliga tokens.

```css
/* ── Menyknappen ── ersätter .mBtn/.menuBtn i style.css. Reglerna där stannar
   tills korkortet.html migreras, se kommentaren i den filen. */
.xg-menu-btn {
  width: 44px; height: 44px; padding: 0; flex-shrink: 0;
  display: grid; place-items: center;
  border: var(--exgen-border-width, 1px) solid var(--exgen-border, #E4E7EC);
  border-radius: var(--exgen-radius-sm, 8px);
  background: transparent; color: var(--exgen-text-secondary, #667085);
  cursor: pointer; touch-action: manipulation;
  transition: border-color var(--exgen-motion-fast, 150ms) var(--exgen-motion-ease, ease),
              background var(--exgen-motion-fast, 150ms) var(--exgen-motion-ease, ease);
}
.xg-menu-btn:hover { border-color: var(--exgen-text-secondary, #667085); color: var(--exgen-text, #1B2430); }
.xg-menu-btn:focus-visible { outline: var(--exgen-focus-ring, 2px solid #00B7D9); outline-offset: var(--exgen-focus-offset, 2px); }
.xg-menu-btn[aria-expanded="true"] { border-color: var(--a, #00768F); color: var(--a, #00768F); }
.xg-menu-bars { display: grid; gap: 3.5px; width: 16px; }
.xg-menu-bars span { display: block; height: 1.5px; background: currentColor; border-radius: 1px; }
/* Komplementet till .xg-nav-regeln ovan: exakt en av de två syns vid varje
   bredd, aldrig båda och aldrig ingen. */
@media (min-width: 861px) { .xg-menu-btn, .xg-menu, .xg-menu-dim { display: none !important; } }

.xg-header-right { display: flex; align-items: center; gap: 6px; }

/* ── Mobilarket ── Den gamla panelen var en skrivbordsdropdown på telefon:
   position:absolute, right:0, min-width:240px, och en skugga på 50 % svart
   som var kvar från ett mörkt tema. Det här är byggt för handen i stället. */
.xg-menu {
  position: fixed; left: 0; right: 0; top: 0; z-index: 5000;
  max-height: 100dvh; overflow-y: auto; -webkit-overflow-scrolling: touch;
  background: var(--exgen-bg, #FFFFFF);
  border-bottom: var(--exgen-border-width, 1px) solid var(--exgen-border, #E4E7EC);
  /* --exgen-shadow-md är den största skuggan som finns i skalan (sm/md).
     Det räcker och är rätt register: poängen var att bli av med den gamla
     panelens 0 16px 48px rgba(0,0,0,.5), en rest från ett mörkt tema. */
  box-shadow: var(--exgen-shadow-md, 0 4px 16px rgba(14,27,42,.08));
  padding: var(--exgen-space-2, 8px) var(--exgen-space-3, 12px)
           calc(var(--exgen-space-4, 16px) + env(safe-area-inset-bottom, 0px));
  transform: translateY(-8px); opacity: 0;
  transition: transform var(--exgen-motion-fast, 150ms) var(--exgen-motion-ease, ease),
              opacity var(--exgen-motion-fast, 150ms) var(--exgen-motion-ease, ease);
}
.xg-menu.on { transform: none; opacity: 1; }
.xg-menu[hidden] { display: none; }

.xg-menu-dim {
  position: fixed; inset: 0; z-index: 4900;
  background: rgba(14, 27, 42, .32);
  opacity: 0; transition: opacity var(--exgen-motion-fast, 150ms) var(--exgen-motion-ease, ease);
}
.xg-menu-dim.on { opacity: 1; }
.xg-menu-dim[hidden] { display: none; }

.xg-menu-item {
  width: 100%; min-height: 52px;
  display: flex; align-items: center; gap: var(--exgen-space-3, 12px);
  padding: 0 var(--exgen-space-3, 12px);
  border: 0; border-radius: var(--exgen-radius-sm, 8px);
  background: transparent; text-align: left; cursor: pointer;
  font: 500 15px var(--exgen-font, sans-serif);
  color: var(--exgen-text, #1B2430); text-decoration: none;
  transition: background var(--exgen-motion-fast, 150ms) var(--exgen-motion-ease, ease);
}
.xg-menu-item:hover { background: var(--exgen-bg-secondary, #F8FAFC); }
.xg-menu-item:focus-visible { outline: var(--exgen-focus-ring, 2px solid #00B7D9); outline-offset: -2px; }
.xg-menu-item > span:nth-child(2) { flex: 1; }
.xg-menu-item.active { font-weight: 600; }
.xg-menu-item.active .xg-menu-ico { color: var(--a, #00768F); }
.xg-menu-ico { display: grid; place-items: center; width: 24px; flex-shrink: 0; color: var(--exgen-text-secondary, #667085); }
.xg-menu-pill {
  font: 500 10px var(--exgen-font-mono, monospace);
  color: var(--exgen-text-secondary, #667085); letter-spacing: var(--exgen-tracking-wide, .06em);
  border: var(--exgen-border-width, 1px) solid var(--exgen-border, #E4E7EC);
  /* radius-skalan är sm/md/lg/pill — det finns ingen xs. */
  border-radius: var(--exgen-radius-sm, 8px); padding: 2px 7px; flex-shrink: 0;
}
.xg-menu-sep { height: 1px; background: var(--exgen-border, #E4E7EC); margin: var(--exgen-space-2, 8px) var(--exgen-space-3, 12px); }

@media (prefers-reduced-motion: reduce) {
  .xg-menu, .xg-menu-dim { transition: none; }
}
```

`var(--a)` i reglerna ovan är avsiktlig och ska inte "rättas" till en
`--exgen-`-token. Den bor i `style.css:17` (`#00768F`), laddas av varje sida, och
är samma val `.xg-login-btn` redan gör med sin motivering på plats:
`--exgen-teal` klarar inte AA för vit text, `--a` är verifierad på 5,27:1.

Kontrollera att varje `--exgen-`-token som används finns:

```bash
node -e "
const css=require('fs').readFileSync('exgen-shell.css','utf8');
const tok=require('fs').readFileSync('exgen-tokens.css','utf8');
const namn=[...css.matchAll(/var\(\s*(--exgen-[a-z0-9-]+)/gi)].map(m=>m[1]);
const fel=[...new Set(namn)].filter(n=>!tok.includes(n+':'));
console.log(fel.length?'SAKNAS: '+fel.join(', '):'alla tokens finns');
"
```

Förväntat: `alla tokens finns`. Varje träff är en CSS-rad som tyst blir ogiltig.

- [ ] **Steg 5: Migrera `integritetspolicy.html` som första sida**

Testet mäter mot den sidan, så den måste vara migrerad för att testet ska kunna
bli grönt. Ersätt blocket från `<div class="xg-utility-bar">` till och med
`</header>` med:

```html
<div data-xg-header></div>
```

och lägg `<script src="js/exgen-shell.js" defer></script>` **före** eventuell
`shared.js`-rad i `<head>`.

- [ ] **Steg 6: Kör testet — grönt**

```bash
node tests/frontend/header-render.mjs
```

Förväntat: `10/10`.

- [ ] **Steg 7: Muteringskontroll**

Ta tillfälligt bort `data-module: "korkort"` ur `NAV` — H3 ska bli röd. Ta bort
`btn.focus()` ur `close()` — H7 ska bli röd. Byt `.xg-menu`s `left/right: 0` mot
`right: 0; width: 240px` — H5 ska bli röd. Återställ alla tre.

- [ ] **Steg 8: Commit**

```bash
git add js/exgen-shell.js exgen-shell.css tests/frontend/header-render.mjs integritetspolicy.html
git commit -F- <<'EOF'
feat(shell): sidhuvudet renderas ur en lista i stället för åtta kopior

Mätt före ändringen: navigeringen fanns i fyra implementationer med
olika innehåll per sida. index saknade sitt eget Hem, förbättring
saknade både Hem och Min utveckling, admin saknade Körkortsteorin.
style.css bar varje menyregel dubbelt och tre öppna-klasser stöddes
samtidigt (.drop.on, .dropdown.is-open, .dropdown.open). Ingen av
skillnaderna var ett beslut.

En sida deklarerar nu bara <div data-xg-header></div>. Sidlokala poster
går in via window.XG_MENU_EXTRA och hamnar under en avdelare, aldrig
blandade med navigeringen — det var så arket blev olika per sida.

Mobilpanelen var en skrivbordsdropdown på telefon: absolut positionerad
i hörnet, min-width 240px, och en skugga på 50 % svart kvar från ett
mörkt tema. Den är nu ett fullbrett ark med 52px rader, dimmer,
safe-area nedtill, Escape, fokusfälla och fokus tillbaka till knappen.

Ordningskravet är dokumenterat och testat: exgen-shell.js måste laddas
före shared.js. Båda är defer och körs när readyState är "interactive",
och shared.js anropar då syncLoginButtons() direkt — inte via
DOMContentLoaded. Renderas huvudet efteråt står kontoknappen kvar på
"Logga in" för en inloggad elev.

Körkortsraden står kvar i listan med sitt data-module trots att
korkortet.html inte migreras. exgen-modules.js döljer den före första
målningen, och poängen med den filen är att en flagga ska räcka den dag
modulen släpps.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Uppgift 3: migrera de sju återstående sidorna

**Filer:**
- Ändra: `index.html`, `pricing.html`, `app.html`, `konto.html`,
  `förbättring.html`, `larare.html`, `admin.html`
- Ändra: `style.css` (halva menydubbleringen raderas)
- Ändra: `tests/frontend/header-behaviour.mjs` (6 → 8 sidor)

`integritetspolicy.html` migrerades i uppgift 2.

- [ ] **Steg 1: Bygg ut `header-behaviour.mjs` först**

Två ändringar i den befintliga filen.

Byt `PAGES` (rad ~40) mot:

```js
// korkortet.html, provia-hp.html och live-demo.html utelämnas: modulerna är
// avstängda i js/exgen-modules.js och sidorna omdirigerar till startsidan.
// larare.html och admin.html bär huvudet men står inte i navlistan.
const PAGES = ["index.html", "pricing.html", "app.html", "förbättring.html",
  "konto.html", "integritetspolicy.html", "larare.html", "admin.html"];
```

Byt `navVisible` (rad ~101) mot den nya klassen, och behåll de gamla så länge
`korkortet.html` inte är migrerad — filen kan komma att köras mot den senare:

```js
const navVisible = page => page.evaluate(() => {
  const box = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return {
    full: box(document.querySelector(".xg-nav")),
    burger: box(document.querySelector(".xg-menu-btn, .mWrap, .menuWrap")),
  };
});
```

Byt `openMenu` (rad ~64) på samma sätt:

```js
  const btn = page.locator(".xg-menu-btn, .mWrap button, .menuWrap button").first();
```

Lägg till en ny kontroll efter mobilblocket, i samma `for`-slinga: navlistan ska
vara **identisk** på varje sida. Det är den kontroll som gör att divergensen inte
kan komma tillbaka — "inga dubbletter" hindrar inte att en sida saknar en post.

```js
  // ── samma lista överallt ─────────────────────────────────────────────
  // Det är den här kontrollen som gör att divergensen inte kan komma
  // tillbaka. "Inga dubbletter" hindrar inte att en sida saknar en post,
  // och det var precis felet: index utan sitt Hem, förbättring utan sitt
  // Min utveckling, admin utan Körkortsteorin.
  {
    const { ctx, page } = await open(url, 1280);
    const lista = await page.evaluate(() =>
      [...document.querySelectorAll(".xg-nav a")].map(a => decodeURIComponent(a.getAttribute("href"))).join(","));
    if (!NAV_FACIT) NAV_FACIT = { url, lista };
    ok(`${url} @1280: navlistan är identisk med övriga sidors`,
      lista === NAV_FACIT.lista, `${lista}  ≠  ${NAV_FACIT.lista} (${NAV_FACIT.url})`);
    await ctx.close();
  }
```

Deklarera `let NAV_FACIT = null;` bredvid `DESTINATIONS`.

- [ ] **Steg 2: Kör och se rött**

```bash
node tests/frontend/header-behaviour.mjs
```

Förväntat: rött. `larare.html` och `admin.html` har ingen `.xg-nav` alls;
`index.html` och `förbättring.html` har listor som skiljer sig från
`integritetspolicy.html`:s renderade.

- [ ] **Steg 3: Migrera de sex enkla sidorna**

`index.html`, `pricing.html`, `app.html`, `konto.html`, `förbättring.html`,
`larare.html`. För var och en:

1. Hitta blocket som börjar med `<div class="xg-utility-bar">` (på `larare.html`:
   `<nav class="topNav">`) och slutar med `</header>` (`</nav>` på larare).
2. Ersätt hela blocket med `<div data-xg-header></div>`.
3. Lägg `<script src="js/exgen-shell.js" defer></script>` i `<head>`, **före**
   `shared.js`. Har sidan redan raden — flytta den så den ligger före.
4. Ta bort sidans egen menykod om den har någon.

Per sida:

| Sida | Extra |
|---|---|
| `index.html` | Inget utöver stegen. |
| `pricing.html` | Inget utöver stegen. |
| `app.html` | Ta bort `openMenuAnimated()`/`closeMenuAnimated()` (rad 1114–1115) och deras anrop (1269, 1601–1602, 1607, 1613, 1614, 1626). Skrollankarna 01–04 flyttar till `XG_MENU_EXTRA` med `scroll`-fältet. Bind dem i sidans egen JS mot `.xg-menu [data-scroll]`. Behåll `#langBtn`-anropen tills uppgift 4 tar bort i18n på förbättringssidan — app-sidans språkväxlare är en egen fråga och rörs inte här. |
| `konto.html` | `#logoutBtn` byter id till `#xgLogout` (renderaren äger knappen nu), eller bind mot `#xgLogout` i stället. |
| `förbättring.html` | `#resetBtn` flyttar till `XG_MENU_EXTRA`. `#logoutBtn` → `#xgLogout`. `#langBtn` lämnas kvar tills uppgift 4. |
| `larare.html` | `.topNav` ersätts. Den befintliga `<a class="btn ghost" href="/app.html">← Appen</a>` försvinner — Mockprov står i navlistan. |

- [ ] **Steg 4: Migrera `admin.html`**

Sidan laddar i dag bara `style.css`. Lägg till i `<head>`, i den ordningen:

```html
<link rel="stylesheet" href="exgen-tokens.css" />
<link rel="stylesheet" href="exgen-shell.css" />
```

Sedan samma tre steg som ovan.

- [ ] **Steg 5: Kör testet — grönt**

```bash
node tests/frontend/header-behaviour.mjs
node tests/frontend/header-render.mjs
```

Förväntat: båda gröna. `header-render.mjs` H10 (skriptordningen) blir nu
meningsfull — den kontrollerar åtta migrerade sidor i stället för noll.

- [ ] **Steg 6: Töm halva menydubbleringen i `style.css`**

Ta bort `.mWrap`, `.mBtn`, `.bars`, `.drop`, `.ddi`, `.ddi-ico`, `.dpill` och
`.mPageTitle` ur varje delad selektor på raderna 295–354 och 505. Behåll
`.menuWrap`-halvan och skriv om kommentaren:

```css
/* ── MENY — bara korkortet.html ──
   Huvudet renderas numera av js/exgen-shell.js med klasser i xg-namnrymden,
   och åtta sidor är migrerade. Reglerna nedan står kvar av exakt ett skäl:
   korkortet.html är inte migrerad, eftersom modulen "korkort" är avstängd i
   js/exgen-modules.js och sidan omdirigerar till startsidan.

   Det här är alltså inte dubblering som glömts bort — det är den sista
   användaren av en gammal vokabulär, och den ska bort samma dag
   korkortsmodulen antingen släpps och migreras, eller tas bort. */
.menuWrap { position: relative; z-index: 4000; }
.menuBtn { … }
```

Bekräfta att inget annat använder de borttagna klasserna:

```bash
grep -rn "mWrap\|\"mBtn\|class=\"bars\|class=\"drop\|class=\"ddi\|dpill\|mPageTitle" *.html js/*.js
```

Förväntat: inga träffar.

- [ ] **Steg 7: Visuell kontroll**

```bash
node tests/frontend/per-visual.mjs
```

Huvudet har bytts på varje sida, så skillnader **förväntas**. Läs bilderna i
`.test-out/per-visual/` och bekräfta att varje skillnad sitter i huvudet och
ingen annanstans. Ett delta som sträcker sig ned i sidans innehåll betyder att
en borttagen `style.css`-regel användes av något annat än menyn.

- [ ] **Steg 8: Commit**

```bash
git add -A
git commit -F- <<'EOF'
refactor(shell): åtta sidor byter sitt handskrivna huvud mot renderaren

index, pricing, app, konto, förbättring, integritetspolicy, larare och
admin bär nu samma huvud ur js/exgen-shell.js. larare.html hade en egen
.topNav utan navigering alls; admin.html laddade bara style.css och fick
exgen-tokens.css + exgen-shell.css.

header-behaviour.mjs går från sex till åtta sidor och får en kontroll
som saknades: navlistan ska vara IDENTISK på varje sida. "Inga
dubbletter" hindrar inte att en sida saknar en post, och det var precis
felet — index utan sitt Hem, förbättring utan sitt Min utveckling, admin
utan Körkortsteorin.

Halva menydubbleringen i style.css raderas (.mWrap/.mBtn/.bars/.drop/
.ddi/.dpill) tillsammans med .mPageTitle, som var stylad och användes på
noll sidor. .menuWrap-halvan står kvar med en kommentar om varför:
korkortet.html är inte migrerad, eftersom modulen är avstängd.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Uppgift 4: förbättringssidan — skalet, ingången och routingen

**Filer:**
- Ändra: `förbättring.html`
- Skapa: `tests/frontend/forbattring-flow.mjs`

Efter den här uppgiften finns fem skärmar och ingången fungerar. `felbank`,
`prov`, `coach` och `rapport` är monterade men tomma — de fylls i uppgift 5 och 6.

**Gränssnitt som uppgift 5 och 6 bygger på:**

```js
var flow;              // XfScreens-instansen
function data()        // → { h: historik[], m: felbank[], last: obj|null }
function renderHem()   // ritar om ingångens vägar
```

- [ ] **Steg 1: Skriv testets första del**

Skapa `tests/frontend/forbattring-flow.mjs`:

```js
/* Beteendekontrakt för förbättringssidans skärmflöde.
 *
 * Sidan hade fyra zoner uppe samtidigt, i en ordning som motsade sina egna
 * kommentarer: DOM:en gav Prov, Coach, Rapport, Felbank medan kommentarerna
 * numrerade dem 1, 3, 3, 2. Felbanken kallades "kärnan" i sin egen kommentar
 * och låg sist, under en lärarrapport som kräver tre prov. Kursväljaren låg i
 * zon 1 och det den filtrerade i zon 4.
 *
 * Användning:  node tests/frontend/forbattring-flow.mjs
 */
import { ROOT, serve, openPage, report } from "./_harness.mjs";

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT);
const R = report("forbattring-flow");
const ok = (n, c, d = "") => R.ok(n, c, d);

const browser = await chromium.launch();
let crash = null;
try {

/* Sidan bygger allt ur localStorage. Utan seedad data mäter man tomma
   tillståndet och tror att det är sidan. */
const HISTORIK = [
  { ts: 1750000000000, course: "Matematik 2c", level: "C", percent: 62 },
  { ts: 1750100000000, course: "Matematik 2c", level: "C", percent: 71 },
  { ts: 1750200000000, course: "Svenska 1",    level: "B", percent: 80 },
];
const FELBANK = [
  { ts: 1750000000000, course: "Matematik 2c", id: "1", question: "Derivatan av x²?", points: 0, max_points: 3, concept_tag: "Derivata", error_tags: ["method_missing"], feedback: "f", model_answer: "2x", user_answer: "x" },
  { ts: 1750100000000, course: "Matematik 2c", id: "2", question: "Lös 2x+3=9",       points: 1, max_points: 3, concept_tag: "Ekvationer", error_tags: [], feedback: "f", model_answer: "x=3", user_answer: "4" },
  { ts: 1750200000000, course: "Svenska 1",    id: "3", question: "Vad är en metafor?", points: 0, max_points: 2, concept_tag: "", error_tags: [], feedback: "f", model_answer: "m", user_answer: "-" },
];

/* seed() i _harness.mjs tar redan `storage` och JSON-kodar värden som inte är
   strängar, så sidans localStorage är fylld innan dess egna skript läser den.
   Ingen ny riggfunktion behövs. */
async function open(hash = "", { tom = false, h = HISTORIK, m = FELBANK } = {}) {
  const { ctx, page } = await openPage(browser, `${srv.url}/f%C3%B6rb%C3%A4ttring.html${hash}`, {
    width: 1280, height: 900, reducedMotion: "reduce",
    waitUntil: "domcontentloaded", settle: 200,
    state: tom ? {} : { storage: { proviaai_history: h, proviaai_mistakes: m } },
  });
  await page.waitForTimeout(900);
  return { ctx, page };
}

const synliga = page => page.evaluate(() =>
  [...document.querySelectorAll(".xf-screen")]
    .filter(s => s.getBoundingClientRect().height > 0).map(s => s.dataset.screen));

// F1: fem skärmar, exakt en synlig.
{
  const { ctx, page } = await open();
  const alla = await page.evaluate(() => [...document.querySelectorAll(".xf-screen")].map(s => s.dataset.screen));
  const v = await synliga(page);
  ok("F1 fem skärmar finns och exakt en syns",
    alla.length === 5 && v.length === 1 && v[0] === "hem", JSON.stringify({ alla, v }));
  await ctx.close();
}

// F2: ingången säger något bara den kan veta om just den här eleven — inte en
// rubrik som är likadan för varenda besökare.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => ({
    say: document.querySelector('[data-screen="hem"] .xf-say').textContent,
    sub: document.querySelector('[data-screen="hem"] .xf-sub').textContent,
  }));
  ok("F2 ingången bär elevens egna siffror",
    /3/.test(v.say) && /Matematik 2c/.test(v.sub), JSON.stringify(v));
  await ctx.close();
}

// F3: fyra vägar, var och en med sitt tillstånd i undertexten.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() =>
    [...document.querySelectorAll('[data-screen="hem"] .xf-opt')].map(b => ({
      mål: b.dataset.go, small: (b.querySelector("small")?.textContent || "").trim(),
    })));
  ok("F3 fyra vägar med levande tillstånd",
    v.length === 4 && v.every(x => x.small.length > 0) &&
    JSON.stringify(v.map(x => x.mål)) === '["felbank","prov","coach","rapport"]',
    JSON.stringify(v));
  await ctx.close();
}

// F4: varje väg öppnar sin skärm och skriver sitt fragment.
{
  for (const mål of ["felbank", "prov", "coach", "rapport"]) {
    const { ctx, page } = await open();
    await page.click(`[data-screen="hem"] .xf-opt[data-go="${mål}"]`);
    await page.waitForTimeout(400);
    const v = await synliga(page);
    const h = await page.evaluate(() => location.hash);
    ok(`F4 vägen till ${mål} öppnar sin skärm och skriver fragmentet`,
      v.length === 1 && v[0] === mål && h === "#" + mål, JSON.stringify({ v, h }));
    await ctx.close();
  }
}

// F5: djuplänk. app.html och P.E.R länkar hit med fragment.
{
  const { ctx, page } = await open("#felbank");
  const v = await synliga(page);
  ok("F5 djuplänk landar direkt på rätt skärm", v.length === 1 && v[0] === "felbank", JSON.stringify(v));
  await ctx.close();
}

// F6: tillbaka. Både sidans egen knapp och webbläsarens.
{
  const { ctx, page } = await open();
  await page.click('[data-screen="hem"] .xf-opt[data-go="prov"]');
  await page.waitForTimeout(300);
  await page.click('[data-screen="prov"] .xf-back');
  await page.waitForTimeout(300);
  const a = await synliga(page);
  await page.click('[data-screen="hem"] .xf-opt[data-go="coach"]');
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForTimeout(300);
  const b = await synliga(page);
  ok("F6 både sidans tillbaka och webbläsarens leder till ingången",
    a[0] === "hem" && b[0] === "hem", JSON.stringify({ a, b }));
  await ctx.close();
}

// F7: utan data byter ingången roll. Vägar som kräver prov ska säga varför de
// inte går, inte bara sitta där och inte göra något.
{
  const { ctx, page } = await open("", { tom: true });
  const v = await page.evaluate(() =>
    [...document.querySelectorAll('[data-screen="hem"] .xf-opt')].map(b => ({
      mål: b.dataset.go, av: b.disabled === true || b.getAttribute("aria-disabled") === "true",
      small: (b.querySelector("small")?.textContent || "").trim(),
    })));
  const spärrade = v.filter(x => x.av);
  ok("F7 utan data är vägarna spärrade och säger varför",
    spärrade.length >= 3 && spärrade.every(x => x.small.length > 0), JSON.stringify(v));
  await ctx.close();
}

// F8: de borttagna kontrollerna är borta — inte gömda. En select som bara
// skrollade, en statusrad som visade eleven sin egen roll, en banderoll som
// upprepade sidans struktur, och hela i18n-lagret.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => ["showMode", "statusDot", "topStatusText",
    "howToBanner", "howToText", "langBtn", "langPill"].filter(id => document.getElementById(id)));
  ok("F8 de borttagna kontrollerna finns inte kvar", v.length === 0, v.join(", "));
  await ctx.close();
}

// F9: den egna muspekaren är borta. Att dölja systemets pekare på två sidor av
// femton var inkonsekvent, och på en sida en lärare ska kunna använda är det
// en risk.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => ({
    dot: !!document.getElementById("cursorDot"),
    cursor: getComputedStyle(document.body).cursor,
  }));
  ok("F9 den egna muspekaren är borta", !v.dot && v.cursor !== "none", JSON.stringify(v));
  await ctx.close();
}

// F10: en h1, skärmrubrikerna är h2.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => ({
    h1: document.querySelectorAll("h1").length,
    say: document.querySelector(".xf-say")?.tagName,
  }));
  ok("F10 sidan har exakt en h1", v.h1 === 1 && v.say === "H2", JSON.stringify(v));
  await ctx.close();
}

} catch (e) { crash = e; }
await browser.close();
await srv.close();
process.exit(R.finish(crash));
```

`_harness.mjs` behöver **ingen** ändring. `openPage` skickar redan vidare `state`
till `seed()`, som tar `storage` och JSON-kodar värden som inte är strängar via
`addInitScript` — alltså före sidans egna skript hinner läsa localStorage. Skriv
inte en ny seedfunktion; det är precis så de fjorton kopiorna uppstod.

- [ ] **Steg 2: Kör och se rött**

```bash
node tests/frontend/forbattring-flow.mjs
```

Förväntat: `0/13` eller nära. Sidan har inga `.xf-screen` alls än.

- [ ] **Steg 3: Byt ut markupen i `förbättring.html`**

Ersätt hela `<main class="wrap">…</main>` (rad 331–478) med:

```html
  <main class="wrap" id="main-content">
    <div id="xf"></div>
  </main>
```

Ta bort ur `<body>`: `<div id="cursorDot">`, `<div id="cursorRing">`.

Lägg till före den befintliga `<script src="shared.js" defer>`:

```html
  <script>window.XG_MENU_EXTRA = [{ label: "Rensa all data", id: "resetBtn", pill: "!" }];</script>
  <script src="js/exgen-shell.js" defer></script>
  <script src="js/xf-screens.js" defer></script>
```

- [ ] **Steg 4: Rensa CSS-blocket**

Ta bort ur sidans `<style>`: hela `CUSTOM CURSOR`-blocket (rad 258–266), `.howTo`
(136–143), `.hero`/`.heroEye`/`.heroTitle`/`.heroSub`/`.heroMeta`/`.heroStatusWrap`/
`.sDot` (116–134), `.section` (148–153), `select` (155–164), `@media(max-width:560px){}`
(167), `.xfZone`-blocket (72–114) utom `.xfMiss*`-reglerna som uppgift 5 behöver.

Lägg till:

```css
/* Tillbakaknappen. Samma form som provskaparens: låg, tyst, och alltid först
   på skärmen — det är den enda vägen ut ur en skärm som inte är ingången. */
.xf-back{display:inline-flex;align-items:center;gap:6px;margin-bottom:var(--exgen-space-4);
  background:none;border:0;padding:0;cursor:pointer;
  font-family:var(--exgen-font-mono);font-size:11px;letter-spacing:var(--exgen-tracking-wide);
  text-transform:uppercase;color:var(--xf-ink-2);transition:color .18s}
.xf-back:hover{color:var(--xf-accent)}
.xf-back:focus-visible{outline:var(--exgen-focus-ring);outline-offset:2px}
```

- [ ] **Steg 5: Skriv skalet i sidans JS**

Ersätt `goZone()`, `PER_TARGETS`, `setTopStatus()`, `setVoice()` och `renderAll()`
med följande. Behåll allt annat tills uppgift 5 och 6 flyttar in det.

```js
    /* ── SKÄRMARNA ──
       Sidan var fyra zoner uppe samtidigt, i en ordning som motsade sina egna
       kommentarer. Nu en skärm i taget, och ingången säger vad som faktiskt
       gäller för just den här eleven innan den erbjuder något. */
    var flow = XfScreens.create({
      root: document.getElementById('xf'),
      screens: ['hem', 'felbank', 'prov', 'coach', 'rapport'],
      title: 'Min utveckling',
      hash: true
    });

    function data(){
      return { h: lsArr(LS_HISTORY), m: lsArr(LS_MISTAKES), last: lsObj(LS_LAST) };
    }

    /* Tillbakaknappen sätts av varje skärm som inte är ingången. */
    function backBtn(body){
      var b=document.createElement('button');
      b.type='button';b.className='xf-back';b.textContent='← Tillbaka';
      b.addEventListener('click',function(){flow.show('hem');});
      body.appendChild(b);
      return b;
    }

    /* ── INGÅNGEN ──
       Vägarna bär sitt eget tillstånd i undertexten. En väg som inte går att
       ta säger varför — en spärrad knapp utan skäl är en återvändsgränd. */
    function renderHem(){
      var d=data(), h=d.h, m=d.m;
      var recent=h.slice(-5);
      var avg=recent.length?Math.round(recent.reduce(function(a,x){return a+(Number(x.percent)||0);},0)/recent.length):0;

      if(!h.length){
        flow.say('hem','Här samlas det du missar.',
          'Rätta ett prov i appen så börjar jag hålla räkningen åt dig.');
      } else {
        var tally={};
        m.forEach(function(x){var c=String(x.course||'').trim();if(c)tally[c]=(tally[c]||0)+1;});
        var top=Object.keys(tally).sort(function(a,b){return tally[b]-tally[a];})[0];
        flow.say('hem','Du har '+m.length+' sparade fel.',
          (top&&tally[top]>1)
            ? tally[top]+' av dem i '+top+'. Du ligger på '+avg+' % över dina senaste prov.'
            : 'Du ligger på '+avg+' % över dina senaste '+recent.length+' prov.');
      }

      var body=flow.body('hem');
      var opts=document.createElement('div');
      opts.className='xf-opts';
      body.appendChild(opts);

      var mostC=mostMistakeCourse(m);
      var lastP=h.length?Number(h[h.length-1].percent||0):0;
      var coachCache=getCoachCache();

      var vägar=[
        { go:'felbank', label:'Träna det du missat',
          small: m.length ? (m.length+' fel'+(mostC.course?' · flest i '+mostC.course:'')) : 'Inga sparade fel just nu',
          av: !m.length },
        { go:'prov', label:'Se dina prov',
          small: h.length ? (h.length+' prov · senaste '+lastP+' %') : 'Inga prov ännu',
          av: !h.length },
        { go:'coach', label:'Fråga P.E.R vad du ska göra',
          small: isCoachCacheFresh(coachCache) ? 'analys från senaste dygnet' : 'ny analys av din historik',
          av: !h.length },
        { go:'rapport', label:'Rapport till läraren',
          small: h.length>=3 ? (h.length+' prov · redo') : ('kräver 3 prov, du har '+h.length),
          av: h.length<3 }
      ];

      vägar.forEach(function(v){
        var b=document.createElement('button');
        b.type='button';
        b.className='xf-opt';
        b.dataset.go=v.go;
        b.disabled=!!v.av;
        b.appendChild(document.createTextNode(v.label));
        var s=document.createElement('small');
        s.textContent=v.small;
        b.appendChild(s);
        if(!v.av) b.addEventListener('click',function(){flow.show(v.go);});
        opts.appendChild(b);
      });

      if(!h.length){
        var a=document.createElement('a');
        a.className='xf-btn primary';
        a.href='app.html';
        a.textContent='Gör ett prov i appen';
        var act=document.createElement('div');
        act.className='xf-act';
        act.appendChild(a);
        body.appendChild(act);
      }
    }

    /* P.E.R:s mål inuti sidan. De skrollade tidigare till en zon; nu navigerar
       de på riktigt. Deklareras separat från datainläsningen: skärmarna finns
       från början och ska gå att nå även för en elev utan prov. */
    var PER_TARGETS=[
      { id:'felbank', label:'Felbank',       hint:'frågor du tappat poäng på, med modellsvar', go:function(){flow.show('felbank');} },
      { id:'prov',    label:'Prov',          hint:'alla rättade prov och resultatgrafen',      go:function(){flow.show('prov');} },
      { id:'coach',   label:'Coach',         hint:'personlig studieplan från misstagen',       go:function(){flow.show('coach');} },
      { id:'rapport', label:'Lärarrapport',  hint:'sammanfattning att visa läraren',           go:function(){flow.show('rapport');} }
    ];

    function renderAll(){
      renderHem();
      renderFelbank();   /* uppgift 5 */
      renderProv();      /* uppgift 5 */
      renderCoach();     /* uppgift 6 */
      renderRapport();   /* uppgift 6 */
      pushPerContext();
    }

    /* Skärmen som just öppnades ritas om — annars visar coach-skärmen data från
       innan senaste synk. */
    flow.on(function(){ renderAll(); });
```

Skriv tomma stubbar för `renderFelbank`, `renderProv`, `renderCoach`,
`renderRapport` och `pushPerContext` så sidan går att köra i den här uppgiften.

- [ ] **Steg 6: Riv ut i18n och den döda koden**

Ta bort ur `<script>`:

- `let LANG=…` och hela `const T={sv:{…},en:{…}}` (rad 539–607)
- `applyLang()` (793–810) och `$('langBtn').addEventListener(…)` (811)
- `buildCoachText` (753–776), `deriveMethods` (735–744), `deriveTips` (745–752),
  `countMistakeDays` (710)
- `.mCard`-animationsslingan i `renderMistakes` (1054–1062)
- `/* ── BIND TOGGLES ── */` (1317–1318)
- Hela GSAP/muspekar-blocket (1343–1371)
- `showLoginOverlay`/`hideLoginOverlay` behålls; `setTopStatus` tas bort och
  varje anrop ersätts enligt uppgift 5 och 6.

Varje kvarvarande `T[LANG].x` och `LANG==='sv'?a:b` ersätts med den svenska
strängen rakt av.

- [ ] **Steg 7: Kör testet**

```bash
node tests/frontend/forbattring-flow.mjs
```

Förväntat: F1–F10 gröna. Skärmarna `felbank`/`prov`/`coach`/`rapport` är tomma
utom sin tillbakaknapp — det är uppgift 5 och 6.

- [ ] **Steg 8: Commit**

```bash
git add förbättring.html tests/frontend/forbattring-flow.mjs
git commit -F- <<'EOF'
feat(förbättring): fyra zoner blir fem skärmar med en ingång

Sidan hade allt uppe samtidigt, i en ordning som motsade sina egna
kommentarer: DOM:en gav Prov, Coach, Rapport, Felbank medan
kommentarerna numrerade dem 1, 3, 3, 2. Felbanken kallades "kärnan" i
sin egen kommentar och låg sist, under en lärarrapport som kräver tre
prov.

Ingången säger nu vad som gäller för just den eleven och erbjuder fyra
vägar, var och en med sitt tillstånd i undertexten. En väg som inte går
att ta säger varför — utan data byter ingången roll och pekar på appen.

Routingen ligger i location.hash, så djuplänkar från app.html och P.E.R
landar rätt och bakåtknappen fungerar. PER_TARGETS skrollade tidigare
till en zon; nu navigerar de.

Borttaget: showMode-selecten som bara skrollade, statusraden som visade
eleven sin egen roll, banderollen som upprepade sidans struktur, hela
i18n-lagret, den egna muspekaren, och den döda coach-motorn
(buildCoachText + deriveMethods + deriveTips + countMistakeDays,
definierade och aldrig anropade) plus en animationsslinga som letade en
klass som bara finns i live-demo.html.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Uppgift 5: felbank- och prov-skärmarna

**Filer:** `förbättring.html`, `tests/frontend/forbattring-flow.mjs`

- [ ] **Steg 1: Lägg till testerna**

Lägg efter F10 i `forbattring-flow.mjs`:

```js
// F11: kursväljaren ligger i SAMMA skärm som listan den filtrerar. Förut satt
// den i zon 1 och felbanken i zon 4, ~1500px isär.
{
  const { ctx, page } = await open("#felbank");
  const v = await page.evaluate(() => {
    const sel = document.getElementById("courseFilter");
    const lista = document.getElementById("mistakeList");
    return {
      selSkärm: sel?.closest(".xf-screen")?.dataset.screen,
      listSkärm: lista?.closest(".xf-screen")?.dataset.screen,
    };
  });
  ok("F11 kursväljaren och listan den filtrerar ligger i samma skärm",
    v.selSkärm === "felbank" && v.listSkärm === "felbank", JSON.stringify(v));
  await ctx.close();
}

// F12: felbanken listar felen.
{
  const { ctx, page } = await open("#felbank");
  const n = await page.evaluate(() => document.querySelectorAll("#mistakeList .xf-opt").length);
  ok("F12 felbanken listar de seedade felen", n === 3, String(n));
  await ctx.close();
}

// F13: kursfiltret filtrerar på plats, utan att lämna skärmen.
{
  const { ctx, page } = await open("#felbank");
  await page.selectOption("#courseFilter", "Svenska 1");
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({
    n: document.querySelectorAll("#mistakeList .xf-opt").length,
    skärm: [...document.querySelectorAll(".xf-screen")].filter(s => s.getBoundingClientRect().height > 0)[0]?.dataset.screen,
  }));
  ok("F13 filtret filtrerar utan att byta skärm", v.n === 1 && v.skärm === "felbank", JSON.stringify(v));
  await ctx.close();
}

// F14: raden ÄR markeringen, och åtgärdsraden räknar.
{
  const { ctx, page } = await open("#felbank");
  await page.click("#mistakeList .xf-opt >> nth=0");
  await page.waitForTimeout(300);
  const v = await page.evaluate(() => ({
    vald: document.querySelectorAll("#mistakeList .xf-opt.sel").length,
    pill: document.getElementById("selCountPill")?.textContent.trim(),
  }));
  ok("F14 ett klick markerar raden och räknaren följer med",
    v.vald === 1 && /^1 /.test(v.pill), JSON.stringify(v));
  await ctx.close();
}

// F15: åtgärdsraden hör till listan. Utan rader finns ingenting att markera,
// och "Träna markerade" ovanför ett gratulationsmeddelande erbjuder en handling
// som inte går att utföra.
{
  const { ctx, page } = await open("#felbank", { tom: true });
  const v = await page.evaluate(() => {
    const b = document.getElementById("trainActions");
    return b ? b.getBoundingClientRect().height : 0;
  });
  ok("F15 åtgärdsraden är borta när det inte finns något att markera", v === 0, String(v));
  await ctx.close();
}

// F16: grafen ligger hos proven, inte hos coachen. Den handlar om prov.
{
  const { ctx, page } = await open("#prov");
  const v = await page.evaluate(() => ({
    skärm: document.getElementById("progressChart")?.closest(".xf-screen")?.dataset.screen,
    prov: document.querySelectorAll("#examList .xf-opt").length,
  }));
  ok("F16 grafen och provlistan ligger i prov-skärmen",
    v.skärm === "prov" && v.prov === 3, JSON.stringify(v));
  await ctx.close();
}

// F17: klick på ett prov sätter kursfiltret och tar eleven till felbanken.
{
  const { ctx, page } = await open("#prov");
  await page.click("#examList .xf-opt >> nth=0");
  await page.waitForTimeout(500);
  const v = await page.evaluate(() => ({
    skärm: [...document.querySelectorAll(".xf-screen")].filter(s => s.getBoundingClientRect().height > 0)[0]?.dataset.screen,
    kurs: document.getElementById("courseFilter")?.value,
  }));
  ok("F17 ett prov leder till sina fel med kursen redan vald",
    v.skärm === "felbank" && v.kurs === "Svenska 1", JSON.stringify(v));
  await ctx.close();
}
```

- [ ] **Steg 2: Kör och se rött**

```bash
node tests/frontend/forbattring-flow.mjs
```

Förväntat: F1–F10 gröna, F11–F17 röda.

- [ ] **Steg 3: Skriv `renderFelbank()`**

Ersätt stubben. Funktionen bygger skärmens kropp och anropar den befintliga
`renderMistakes()`, som flyttas in men i övrigt behålls — den fungerar och har
sina begreppschips, sin markering och sina detaljer på plats.

```js
    function renderFelbank(){
      var d=data();
      flow.say('felbank','Felbank', d.m.length
        ? d.m.length+' frågor du tappat poäng på. Markera dem du vill träna.'
        : 'Inga sparade fel just nu.');

      var body=flow.body('felbank');
      backBtn(body);

      /* Filtret ligger i samma skärm som listan det filtrerar. Förut satt det i
         zon 1 och felbanken i zon 4. */
      var filt=document.createElement('div');
      filt.className='xf-act xfFilters';
      filt.innerHTML='<label class="xfField">'+
        '<span class="xf-eyebrow" id="courseFilterLabel">Kurs</span>'+
        '<select class="xf-input" id="courseFilter" aria-labelledby="courseFilterLabel"></select>'+
        '</label>';
      body.appendChild(filt);

      var bar=document.createElement('div');
      bar.className='xf-act xf-act--stick xfTrainBar';
      bar.id='trainActions';
      bar.innerHTML='<span class="xf-chip" id="selCountPill">0 valda</span>'+
        '<button class="xf-btn ghost xfTrainClear" id="clearSelectionBtn" type="button">Rensa val</button>'+
        '<button class="xf-btn" id="trainSelectedBtn" type="button">Träna markerade</button>';
      body.appendChild(bar);

      var st=document.createElement('div');st.className='statusText';st.id='mistakeStatus';
      st.setAttribute('aria-live','polite');
      body.appendChild(st);
      var list=document.createElement('div');list.id='mistakeList';
      body.appendChild(list);

      buildCourseOpts(d.h,d.m);
      var kurs=String($('courseFilter').value||'').trim();
      renderMistakes(d.m,kurs);
      updateSelPill();

      $('courseFilter').addEventListener('change',function(){
        CONCEPT_FILTER='';
        renderMistakes(lsArr(LS_MISTAKES),String($('courseFilter').value||'').trim());
        updateSelPill();
      });
      $('clearSelectionBtn').addEventListener('click',function(){
        clearPick();
        renderMistakes(lsArr(LS_MISTAKES),String($('courseFilter').value||'').trim());
      });
      $('trainSelectedBtn').addEventListener('click',function(){
        var p=getPick();
        if(!p.ids||!p.ids.length)lsSet(LS_TRAIN_PICK,{ids:[],course:String($('courseFilter').value||'')});
        window.location.href='app.html#train';
      });
    }
```

Ändra i `renderMistakes()`: byt varje `T[LANG].x` mot den svenska strängen, byt
`t.showingAll(n,scope)` mot `n+' misstag'+(scope?' · '+scope:'')`, och byt
`setTopStatus(t.removedOne,'ok')` mot att `mistakeStatus` sätts direkt.
`renderAll()`-anropen inuti funktionen byts mot `renderMistakes(...)` + `renderHem()`
— att rita om alla fem skärmarna för att en rad markerades är onödigt och
flyttar dessutom fokus.

- [ ] **Steg 4: Skriv `renderProv()`**

```js
    function renderProv(){
      var d=data();
      flow.say('prov','Dina prov', d.h.length
        ? d.h.length+' rättade prov. Klicka ett för att se vad du tappade poäng på.'
        : 'Inga prov ännu.');

      var body=flow.body('prov');
      backBtn(body);

      var act=document.createElement('div');
      act.className='xf-act';
      act.innerHTML='<button class="xf-btn ghost" id="syncBtn" type="button">↻ Synka</button>';
      body.appendChild(act);

      var st=document.createElement('div');st.className='statusText';st.id='examListStatus';
      st.setAttribute('aria-live','polite');
      body.appendChild(st);

      var chart=document.createElement('div');
      chart.className='xf-card chartWrap';chart.id='chartWrap';chart.style.display='none';
      chart.innerHTML='<div class="xf-eyebrow">Resultatutveckling</div><canvas id="progressChart"></canvas>';
      body.appendChild(chart);

      var wrap=document.createElement('div');wrap.className='xf-opts';wrap.id='examList';
      body.appendChild(wrap);

      renderExamList(d.h,'');
      renderChart(d.h);

      $('syncBtn').addEventListener('click',async function(){ await syncFromAccount(); });
    }
```

Ändra i `renderExamList()`: klicket sätter kursfiltret och byter skärm.
Kursfiltret bor i felbank-skärmen, som ritas om av `flow.on()` — så värdet måste
sparas innan bytet:

```js
        b.addEventListener('click',function(){
          /* Kursväljaren bor i felbank-skärmen, som ritas om vid bytet. Värdet
             måste därför sparas i valet, inte skrivas i en select som är på väg
             att ersättas. buildCourseOpts läser tillbaka det. */
          var p=getPick();
          p.course=String(x.course||'').trim();
          setPick(p);
          COURSE_OPTS_INIT=false;
          CONCEPT_FILTER='';
          flow.show('felbank');
        });
```

- [ ] **Steg 5: Kör testet**

```bash
node tests/frontend/forbattring-flow.mjs
```

Förväntat: `17/17`.

- [ ] **Steg 6: Muteringskontroll**

Flytta tillfälligt `#courseFilter` till prov-skärmen — F11 ska bli röd. Ta bort
`bar.style.display`-logiken i `renderMistakes` — F15 ska bli röd. Återställ.

- [ ] **Steg 7: Commit**

```bash
git add förbättring.html tests/frontend/forbattring-flow.mjs
git commit -F- <<'EOF'
feat(förbättring): felbanken och proven får var sin skärm

Kursväljaren låg i zon 1 och felbanken den filtrerade i zon 4, omkring
1500px isär. Nu ligger de i samma skärm, och begreppschipsen sitter
direkt ovanför samma lista.

Resultatgrafen flyttar från Coach-zonen till prov-skärmen. Den handlar
om prov.

Ett klick på ett prov sätter kursen i valet, inte i en select som är på
väg att ersättas av skärmbytet, och tar eleven till felbanken med kursen
redan vald.

renderMistakes behåller sin markering, sina begreppschips och sina
detaljer — den fungerade. Den ritar nu bara om sin egen lista i stället
för att anropa renderAll(), som hade ritat om fem skärmar och flyttat
fokus för att en rad markerades.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Uppgift 6: coach- och rapport-skärmarna + P.E.R-kontexten

**Filer:** `förbättring.html`, `tests/frontend/forbattring-flow.mjs`

- [ ] **Steg 1: Lägg till testerna**

```js
// F18: coachen hämtar vid inträde. Förut satt analysen bakom en knapp som
// hette "Hämta P.E.R-analys" på en skärm eleven öppnat just för att få den.
{
  const { ctx, page } = await open();
  await page.route("**/api/explain", r => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ answer: "Träna derivata i tre pass." }),
  }));
  await page.click('[data-screen="hem"] .xf-opt[data-go="coach"]');
  await page.waitForTimeout(1200);
  const v = await page.evaluate(() => ({
    text: document.getElementById("coachText")?.textContent.trim(),
    knapp: !!document.getElementById("perCoachBtn"),
  }));
  ok("F18 coachen hämtar vid inträde, utan en extra knapp",
    v.text === "Träna derivata i tre pass." && !v.knapp, JSON.stringify(v));
  await ctx.close();
}

// F19: ett misslyckat anrop säger det, i stället för att lämna ett streck.
{
  const { ctx, page } = await open();
  await page.route("**/api/explain", r => r.fulfill({ status: 500, body: "{}" }));
  await page.click('[data-screen="hem"] .xf-opt[data-go="coach"]');
  await page.waitForTimeout(1200);
  const v = await page.evaluate(() => ({
    text: document.getElementById("coachText")?.textContent.trim() || "",
    retry: !!document.getElementById("perCoachRetry"),
  }));
  ok("F19 ett misslyckat anrop säger det och går att göra om",
    v.text.length > 3 && v.text !== "—" && v.retry, JSON.stringify(v));
  await ctx.close();
}

// F20: nyckeltalen står som etikett/värde, inte som en textklump.
{
  const { ctx, page } = await open("#coach");
  await page.waitForTimeout(600);
  const v = await page.evaluate(() =>
    [...document.querySelectorAll('[data-screen="coach"] .xf-row')].map(r => ({
      dt: r.querySelector("dt")?.textContent.trim(), dd: r.querySelector("dd")?.textContent.trim(),
    })));
  ok("F20 tre nyckeltal som etikett och värde",
    v.length === 3 && v.every(x => x.dt && x.dd && x.dd !== "—"), JSON.stringify(v));
  await ctx.close();
}

// F21: rapporten kräver tre prov, och skärmen säger det i stället för att bara
// spärra knappen.
{
  const { ctx, page } = await open("#rapport", { h: HISTORIK.slice(0, 2) });
  const v = await page.evaluate(() => ({
    status: document.getElementById("reportStatus")?.textContent.trim(),
    av: document.getElementById("genReportBtn")?.disabled,
  }));
  ok("F21 rapporten säger varför den inte går än", /3/.test(v.status) && v.av === true, JSON.stringify(v));
  await ctx.close();
}

// F22: P.E.R-målen navigerar. Förut skrollade de till en zon — och två av de
// fem pekade på samma zon.
{
  const { ctx, page } = await open();
  const v = await page.evaluate(() => {
    const m = window.__perManifestForTest || null;
    return m ? m.targets.map(t => t.id) : null;
  });
  ok("F22 P.E.R har fyra mål, ett per skärm",
    JSON.stringify(v) === '["felbank","prov","coach","rapport"]', JSON.stringify(v));
  await ctx.close();
}
```

F22 kräver att sidan exponerar manifestet för mätning. Lägg i `pushPerContext()`:

```js
      /* Exponeras bara för riggen. setPerContext sväljer manifestet och det
         finns ingen väg tillbaka ut — utan den här raden går målen inte att
         mäta annat än genom att klicka dem via widgetens egen meny. */
      window.__perManifestForTest={targets:PER_TARGETS};
```

- [ ] **Steg 2: Kör och se rött**

```bash
node tests/frontend/forbattring-flow.mjs
```

Förväntat: F1–F17 gröna, F18–F22 röda.

- [ ] **Steg 3: Skriv `renderCoach()`**

```js
    function renderCoach(){
      var d=data(),h=d.h,m=d.m;
      flow.say('coach','P.E.R läser din historik.','Rekommendationen bygger på dina senaste prov och din felbank.');

      var body=flow.body('coach');
      backBtn(body);

      var card=document.createElement('div');
      card.className='xf-card';
      card.innerHTML='<div class="xf-eyebrow">P.E.R · Rekommendation</div>'+
        '<div class="coachText" id="coachText"></div>';
      body.appendChild(card);

      var stats=document.createElement('dl');
      stats.className='xf-card xfStats';
      stats.innerHTML=
        '<div class="xf-row"><dt>Senaste</dt><dd id="lastText">—</dd></div>'+
        '<div class="xf-row"><dt>Trend</dt><dd id="trendText">—</dd></div>'+
        '<div class="xf-row"><dt>Fokus</dt><dd id="focusText">—</dd></div>';
      body.appendChild(stats);

      /* Nyckeltalen. Fanns förut men låg under coach-texten i samma zon som
         grafen — tre olika sorters avläsning i en hög. */
      var lastA=(d.last&&d.last.attempt)?d.last.attempt:h[h.length-1];
      if(lastA){
        $('lastText').textContent=Number(lastA.percent||0)+' % · '+(lastA.level||'—')+
          ' · '+((lastA.course||'').trim()||'Ingen kurs');
      }
      var tr=computeTrend(h);
      $('trendText').textContent=tr?((tr.delta>=0?'+':'')+Math.round(tr.delta)+' p.p.'):'—';
      var mc=mostMistakeCourse(m);
      if(mc.course){
        var topC=conceptCounts(m.filter(function(x){return String(x.course||'').trim()===mc.course;}))[0];
        $('focusText').textContent=topC?(mc.course+' › '+topC[0]+' ('+topC[1]+')'):(mc.course+' ('+mc.n+')');
      } else $('focusText').textContent='Markera 5 misstag';

      loadCoach(h,m);
    }

    /* Analysen hämtas när skärmen öppnas. Förut satt den bakom en knapp med
       texten "Hämta P.E.R-analys" — på en skärm eleven öppnat just för att få
       den. Cachen på ett dygn behålls: det är samma historik. */
    async function loadCoach(h,m){
      var box=$('coachText');
      if(!box)return;
      if(!h.length){box.textContent='Ingen provdata än. Gör ett prov i appen och tryck Rätta prov.';return;}
      var cache=getCoachCache();
      if(isCoachCacheFresh(cache)){box.textContent=cache.text;return;}
      box.textContent='P.E.R läser…';
      flow.busy('coach',true);
      try{
        var text=await fetchPERCoach(h,m);
        if(text){box.textContent=text;setCoachCache({ts:Date.now(),text:text});}
        else coachError(box);
      }catch(_){ coachError(box); }
      finally{ flow.busy('coach',false); }
    }

    function coachError(box){
      box.textContent='Kunde inte hämta analysen just nu.';
      var b=document.createElement('button');
      b.type='button';b.id='perCoachRetry';b.className='xf-btn ghost';b.textContent='Försök igen';
      b.addEventListener('click',function(){b.remove();loadCoach(lsArr(LS_HISTORY),lsArr(LS_MISTAKES));});
      box.parentNode.appendChild(b);
    }
```

- [ ] **Steg 4: Skriv `renderRapport()`**

```js
    function renderRapport(){
      var d=data(),n=d.h.length;
      flow.say('rapport','Rapport till läraren', n>=3
        ? 'En sammanfattning av '+n+' prov som du kan kopiera och visa.'
        : 'Kräver minst tre rättade prov. Du har '+n+'.');

      var body=flow.body('rapport');
      backBtn(body);

      var st=document.createElement('div');
      st.className='statusText';st.id='reportStatus';st.setAttribute('aria-live','polite');
      body.appendChild(st);

      var act=document.createElement('div');
      act.className='xf-act xfReportAct';
      act.innerHTML='<button class="xf-btn" id="genReportBtn" type="button">Skapa rapport</button>'+
        '<button class="xf-btn ghost" id="copyReportBtn" type="button" disabled>Kopiera</button>'+
        '<span class="xf-chip" id="reportPill" style="display:none">—</span>';
      body.appendChild(act);

      var wrap=document.createElement('div');
      wrap.className='xfReportWrap';
      wrap.innerHTML=
        '<div class="loadOv" id="reportLoadingOverlay"><div class="spinner"></div>'+
        '<div class="loadSteps">'+
        '<div class="loadStep" id="loadStep1">Analyserar historik…</div>'+
        '<div class="loadStep" id="loadStep2">Identifierar mönster…</div>'+
        '<div class="loadStep" id="loadStep3">Skriver rapport…</div></div></div>'+
        '<div class="xf-card reportBox" id="reportBox">—</div>';
      body.appendChild(wrap);

      renderReportState(d.h);
      $('genReportBtn').addEventListener('click',function(){generateReport();});
      $('copyReportBtn').addEventListener('click',function(){copyReport();});
    }
```

Ändra i `renderReportState`, `generateReport` och `copyReport`: byt varje
`T[LANG].x` mot den svenska strängen. `reportCacheKey()` läste
`$('courseFilter').value` — den elementen bor nu i felbank-skärmen och kan vara
oritad. Läs kursen ur valet i stället:

```js
    function reportCacheKey(){
      var p=getPick();
      return String(p&&p.course||'').trim()||'__all__';
    }
```

- [ ] **Steg 5: Skriv `pushPerContext()`**

```js
    function pushPerContext(){
      if(!window.setPerContext)return;
      var d=data(),h=d.h,m=d.m;
      var areaCounts=m.slice(-30).reduce(function(acc,x){
        var c=String(x.course||'').trim(),cn=conceptOf(x);
        var key=[c,cn].filter(Boolean).join(' › ');
        if(key)acc[key]=(acc[key]||0)+1;
        return acc;
      },{});
      var weakAreas=Object.keys(areaCounts)
        .sort(function(a,b){return areaCounts[b]-areaCounts[a];}).slice(0,5);
      window.setPerContext({
        page:'förbättring',
        userScore: avgPct(h.slice(-5))/100,
        weakAreas: weakAreas,
        examState:{ answered:h.length, remaining:0 },
        targets: PER_TARGETS
      });
      /* Exponeras bara för riggen. setPerContext sväljer manifestet och det
         finns ingen väg tillbaka ut. */
      window.__perManifestForTest={targets:PER_TARGETS};
    }
```

- [ ] **Steg 6: Kör hela testet**

```bash
node tests/frontend/forbattring-flow.mjs
```

Förväntat: `22/22`.

- [ ] **Steg 7: Kontrollera att inget i18n-spår är kvar**

```bash
grep -n "T\[LANG\]\|LANG===\|applyLang\|proviaai_lang" förbättring.html
```

Förväntat: inga träffar.

- [ ] **Steg 8: Commit**

```bash
git add förbättring.html tests/frontend/forbattring-flow.mjs
git commit -F- <<'EOF'
feat(förbättring): coachen och rapporten får var sin skärm

Coachen hämtar nu vid inträde. Analysen satt förut bakom en knapp med
texten "Hämta P.E.R-analys" — på en skärm eleven öppnat just för att få
den. Dygnscachen behålls, det är samma historik. Ett misslyckat anrop
säger det och går att göra om, i stället för att lämna ett streck.

De tre nyckeltalen står som etikett och värde i sin egen lista i stället
för att ligga i samma zon som coach-texten och resultatgrafen — tre
sorters avläsning i en hög.

reportCacheKey() läste kursen ur #courseFilter, som numera bor i
felbank-skärmen och kan vara oritad när rapporten öppnas. Den läser
valet i stället, som överlever ett skärmbyte.

PER_TARGETS går från fem mål till fyra, ett per skärm. Två av de gamla
fem pekade på samma zon.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Uppgift 7: driftspärren och hela sviten

**Filer:** `tests/frontend/_harness.test.mjs`

- [ ] **Steg 1: Utöka driftspärren**

`_harness.test.mjs` har tre kontroller (H20–H22) som letar efter kopior av
riggens kod. Lägg till en fjärde i samma block, för skärmväxlaren.

I `_harness.test.mjs`, i blocket `── Spärren mot att driften börjar om ──`, lägg
till en fil-läsande kontroll som täcker `js/`:

```js
/* Skärmväxlaren är det andra delade lagret. Samma resonemang som ovan: två
   implementationer av samma idé är ett medvetet, avgränsat beslut
   (js/exam-flow.js rörs inte), men en tredje ska inte kunna glida in tyst.
   Kontrollen läser js/ och letar efter en egen skärmväxlare — en funktion som
   togglar .xf-screen-klassen — utanför de två filer som får ha en. */
{
  const jsDir = join(dirname(fileURLToPath(import.meta.url)), "../../js");
  const tillåtna = new Set(["xf-screens.js", "exam-flow.js"]);
  const egna = [];
  for (const f of fs.readdirSync(jsDir)) {
    if (!f.endsWith(".js") || tillåtna.has(f)) continue;
    const kod = fs.readFileSync(join(jsDir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/classList\s*\.\s*toggle\s*\(\s*["']on["']/.test(kod) && /xf-screen/.test(kod)) egna.push(f);
  }
  okf("H23 ingen fil bygger en egen skärmväxlare", egna.length === 0, egna.join(", "));
}
```

Lägg också till en kontroll som täcker sidorna: ingen `*.html` får bygga sitt
eget sidhuvud efter migreringen.

```js
/* Sidhuvudet renderas av js/exgen-shell.js. En sida som skriver sitt eget
   header-block igen är exakt hur de åtta divergerade versionerna uppstod.
   korkortet.html är undantagen tills modulen släpps — se kommentaren i
   style.css. */
{
  const rot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const undantag = new Set(["korkortet.html", "provia-hp.html", "live-demo.html",
    "snart.html", "aterstall.html", "juridik.html", "google52ca1d3d9412d7b8.html"]);
  const egna = [];
  for (const f of fs.readdirSync(rot)) {
    if (!f.endsWith(".html") || undantag.has(f)) continue;
    const src = fs.readFileSync(join(rot, f), "utf8");
    if (/<header[^>]*class="[^"]*xg-header/.test(src)) egna.push(f);
  }
  okf("H24 ingen sida skriver sitt eget sidhuvud", egna.length === 0, egna.join(", "));
}
```

- [ ] **Steg 2: Kör driftspärren**

```bash
node tests/frontend/_harness.test.mjs
```

Förväntat: `24/24`.

- [ ] **Steg 3: Muteringskontroll**

Kopiera tillfälligt tre rader ur `xf-screens.js` `apply()` in i
`js/exgen-shell.js` — H23 ska bli röd. Klistra tillbaka ett `<header
class="xg-header">` i `index.html` — H24 ska bli röd. Återställ båda.

- [ ] **Steg 4: Kör hela sviten**

```bash
node tests/frontend/run-all.mjs
```

Förväntat: alla filer gröna. `_harness.test.mjs` körs först — är den röd betyder
ingen annan rad i utskriften någonting.

- [ ] **Steg 5: Visuell slutkontroll**

```bash
node tests/frontend/per-visual.mjs
```

`förbättring.html` kommer visa stora skillnader i båda vyerna — det är avsikten,
sidan är omskriven. Övriga sidor ska visa skillnader **bara i huvudet**. Läs
bilderna i `.test-out/per-visual/` och bekräfta det innan något mergas.

- [ ] **Steg 6: Commit**

```bash
git add tests/frontend/_harness.test.mjs
git commit -F- <<'EOF'
test(harness): driftspärren täcker skärmväxlaren och sidhuvudet

Riggen fick sin spärr efter att fjorton filer byggt var sin kopia av
server, mockar och geometri, och tre av kopiorna ljög. Samma mönster
gäller de två nya lagren.

H23 läser js/ och letar efter en egen skärmväxlare utanför
xf-screens.js och exam-flow.js. Att de två finns samtidigt är ett
medvetet och avgränsat beslut — provflödet rörs inte — men en tredje ska
inte kunna glida in tyst.

H24 läser sidorna och letar efter ett handskrivet <header
class="xg-header">. Det är precis så de åtta divergerade versionerna
uppstod. korkortet.html och de andra avstängda modulerna är undantagna.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Egengranskning

Kontrollerat mot specen efter att planen skrevs:

**Täckning.** Specens fem skärmar → uppgift 4 (hem + routing), 5 (felbank, prov),
6 (coach, rapport). `js/xf-screens.js` → uppgift 1. Renderat sidhuvud med
sidlokalt fack → uppgift 2. Åtta sidor + halva `style.css` → uppgift 3.
Mobilarket → uppgift 2. Testerna specen listar → uppgifterna 1–3 och 7.

**Ordningsberoenden.** Uppgift 2 migrerar `integritetspolicy.html` i förväg,
eftersom `header-render.mjs` mäter mot en migrerad sida — annars kunde uppgiften
inte bli grön. Uppgift 4 lämnar `#langBtn` kvar tills i18n rivs i samma uppgift;
`app.html`s språkväxlare är en annan sak och rörs inte.

**Namn som måste stämma över uppgiftsgränser.** `flow`, `data()`, `renderHem()`,
`backBtn(body)`, `PER_TARGETS`, `renderFelbank/renderProv/renderCoach/renderRapport/
pushPerContext` — alla deklarerade i uppgift 4 och konsumerade i 5 och 6.
`XfScreens.create` med `show/current/has/body/say/busy/on` — deklarerad i uppgift 1
och konsumerad i 4, 5, 6. `XgShell.render` och `XG_MENU_EXTRA` — deklarerade i
uppgift 2 och konsumerade i 3.

**Två fällor som är värda att läsa en gång till innan man börjar.**

1. `#courseFilter` bor i felbank-skärmen och är **oritad** när prov- eller
   rapport-skärmen är på. Varje läsning av den elementen utanför felbank-skärmen
   är en bugg. Uppgift 5 (`renderExamList`) och uppgift 6 (`reportCacheKey`)
   hanterar det genom att gå via `getPick()`, som överlever ett skärmbyte.
2. `flow.on()` anropar `renderAll()`, som ritar om alla fem skärmarna. Det gör
   att en åtgärd inne i felbanken inte får anropa `renderAll()` — då ritas
   skärmen om under fingret och fokus flyttar. Uppgift 5 ritar bara om sin egen
   lista.
