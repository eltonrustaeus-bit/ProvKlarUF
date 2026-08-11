import { ROOT, serve, openPage, report } from "./_harness.mjs";
// Vad en UTLOGGAD besökare möter, sida för sida, med underhållsgrinden öppen.
//
// Sajten har stått bakom grinden i veckor. Under den tiden har all mätning
// gjorts på inloggade sessioner, för att riggarna behövde en session för att
// komma förbi den. Ingen har mätt vad någon utan konto faktiskt ser — och det
// är den enda besökaren startsidan finns för.
//
// Kontrollen simulerar att MAINTENANCE.enabled är false (grinden svarar
// allow:true) och seedar INGEN session. Det är exakt läget dagen sajten öppnas
// igen.
//
// Vad som fäller:
//   * omdirigering bort från sidan man bad om
//   * body osynlig när nätet tystnat — någon overlay som aldrig lyfter
//   * JS-fel
//   * 404 på något sidan själv begär från egen domän
//   * ingen h1
//   * vågrät scroll på 390px
//
// Vad som bara RAPPORTERAS, inte fäller: att en sida öppnar registreringsrutan
// direkt. app.html, förbättring.html och konto.html gör det med flit för den
// som saknar konto. Att låta det fälla vore att kräva att produkten ger bort
// sig själv.
//
// Användning:  node tests/frontend/visitor-preflight.mjs

const r = report("visitor-preflight");
const { chromium: cr } = await import(ROOT + "/node_modules/playwright/index.mjs");

// Varje sida en besökare kan begära. juridik.html är med sedan #12 — den är
// olänkad och noindex, men publikt nåbar, och därför en yta som kan gå sönder.
// Sidor som ska svara med sig själva.
const PAGES = [
  "index.html", "pricing.html", "app.html", "förbättring.html", "konto.html",
  "integritetspolicy.html", "larare.html", "juridik.html", "snart.html",
];

// Sidor vars modul är avstängd i js/exgen-modules.js. De SKA skicka besökaren
// till startsidan — det är hela poängen med att modulen är av. Att kräva att de
// renderar vore att testa motsatsen till vad koden lovar. Blir en av dem
// nåbar utan att flaggan slagits på är det däremot en läcka, och då faller den
// här kontrollen i stället.
const OFF_MODULE_PAGES = ["korkortet.html", "live-demo.html", "provia-hp.html"];

const srv = await serve(ROOT);
const browser = await cr.launch();
let crash = null;
const notes = [];

try {
  for (const page of [...PAGES, ...OFF_MODULE_PAGES]) {
    const shouldRedirect = OFF_MODULE_PAGES.includes(page);
    const url = `${srv.url}/${encodeURIComponent(page)}`;
    const errors = [], notFound = [];

    const { page: p, close } = await openPage(browser, url, {
      width: 1280, height: 900,
      // Grinden öppen, ingen session. allow:true motsvarar enabled:false i
      // api/_maintenance.js — servern släpper igenom alla.
      mocks: { allow: true, role: "gratis" },
      state: { signedIn: false, role: null },
      // Sidan får ladda klart; overlays som lyfter på timer hinner lyfta.
      settle: 1200,
    });

    p.on("pageerror", e => errors.push(String(e.message)));
    p.on("response", res => {
      if (res.status() === 404 && res.url().startsWith(srv.url)) {
        notFound.push(res.url().slice(srv.url.length));
      }
    });
    // Lyssnarna sätts efter openPage, så sidan laddas om en gång med dem på.
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForTimeout(2500);

    const landed = decodeURIComponent(p.url().slice(srv.url.length + 1));
    if (shouldRedirect) {
      r.ok(`${page}: avstängd modul skickar till startsidan`,
        landed === "index.html" || landed === "", landed);
    } else {
      r.ok(`${page}: ingen omdirigering`, landed === page || landed === "", landed);
    }

    const shape = await p.evaluate(() => ({
      vis: getComputedStyle(document.body).visibility,
      opacityHidden: [...document.body.children].every(el => parseFloat(getComputedStyle(el).opacity) < 0.05),
      h1: (document.querySelector("h1")?.textContent || "").trim().length,
      // Rutan öppnas av shared.js efter att sessionen visat sig saknas, alltså
      // en bit efter load. [hidden] räcker inte som mått — den öppna rutan
      // saknar attributet men kan ändå ligga på display:none. Mät ytan och den
      // beräknade stilen, som i det manuella genomgången av resan.
      modal: (() => {
        const el = document.getElementById("pvModal");
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" &&
               el.getBoundingClientRect().height > 50;
      })(),
    }));
    if (!shouldRedirect) {
      r.ok(`${page}: body synlig`, shape.vis === "visible" && !shape.opacityHidden, JSON.stringify(shape));
      r.ok(`${page}: har en h1`, shape.h1 > 0, `${shape.h1} tecken`);
      r.ok(`${page}: inga JS-fel`, errors.length === 0, errors.slice(0, 2).join(" | "));
      r.ok(`${page}: inga 404 från egen domän`, notFound.length === 0, [...new Set(notFound)].slice(0, 4).join(", "));
      if (shape.modal) notes.push(`${page} öppnar registreringsrutan direkt för den utan konto`);
    }

    await close();

    // Samma sida på telefon: bara det som bara syns där.
    const { page: m, close: closeM } = await openPage(browser, url, {
      width: 390, height: 844,
      mocks: { allow: true, role: "gratis" },
      state: { signedIn: false, role: null },
      settle: 900,
    });
    const ov = await m.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (!shouldRedirect) r.ok(`${page}: ingen vågrät scroll @390`, ov <= 1, `${ov}px`);
    await closeM();
  }
} catch (e) {
  crash = e;
} finally {
  await browser.close();
  await srv.close();
}

if (notes.length) {
  console.log("\natt känna till (fäller inte):");
  for (const n of notes) console.log("  · " + n);
}
process.exit(r.finish(crash));
