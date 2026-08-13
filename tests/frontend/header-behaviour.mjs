import { ROOT, serve, openPage, report } from "./_harness.mjs";
// Beteendekontrakt för toppmenyn — Del D.
//
// Till skillnad från de andra beteendetesterna i katalogen är det här skrivet
// mot ett KÄNT FEL och är rött när det skrivs. Mätt på pricing.html vid 1280px
// innan en rad ändrades:
//
//   .xg-nav        398x33   Hem · Mockprov · Min utveckling · Priser · Konto
//   .mWrap          44x44   hamburgare, öppnar samma sex destinationer igen
//   .xg-login-btn   91x36   "Mitt konto" → konto.html
//
// Två kompletta navigeringar bredvid varandra, och konto.html tre gånger i
// samma synfält. Det är precis den dubbleringen Del B tog bort på
// förbättringssidan ("Ikonraden som låg här öppnade exakt samma fem sektioner
// som listan nedan").
//
// Testet mäter två saker, båda på varje sida som bär headern:
//   1. Ingen destination nås på mer än ett sätt i den synliga headern.
//   2. Exakt en navigering är synlig åt gången — hamburgaren och den fulla
//      listan får aldrig stå framme samtidigt.
// Plus ett golv: varje produktsida ska gå att nå vid BÅDA bredderna, så att
// "inga dubbletter" inte kan uppnås genom att ta bort för mycket.
//
// Fällor (samma som i de andra riggarna): site-gate.js omdirigerar utan en
// **/api/check-role-mock registrerad EFTER den generella, och intro-splash.js
// håller sidan osynlig i ~4,5 s utan sessionStorage pi_splash_shown.
//
// Användning:  node tests/frontend/header-behaviour.mjs

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT);

const R = report("header-behaviour");
const ok = (n, c, d = "") => R.ok(n, c, d);

// Varje sida som bär huvudet. korkortet.html, provia-hp.html och
// live-demo.html utelämnas: modulerna är avstängda i js/exgen-modules.js och
// sidorna omdirigerar till startsidan. larare.html och admin.html står inte
// själva i navlistan men bär huvudet som alla andra.
const PAGES = ["index.html", "pricing.html", "app.html", "förbättring.html", "konto.html",
  "integritetspolicy.html", "larare.html", "admin.html"];

// Sidor som SKA gå att nå från headerns navigering. Två undantag, båda med
// sin egen kontroll längre ned: konto.html nås via kontoknappen, index.html
// via märket. Att kräva dem här också hade betytt att samma destination måste
// stå på två ställen — precis det testet finns för att förhindra.
const DESTINATIONS = ["app.html", "förbättring.html", "pricing.html"];

// Facit för navlistan. Sätts av den första sidan som mäts och jämförs sedan mot
// varje annan. Det är den kontroll som saknades: "inga dubbletter" hindrar inte
// att en sida SAKNAR en post, och det var precis felet — index utan sitt Hem,
// förbättring utan sitt Min utveckling, admin utan Körkortsteorin.
let NAV_FACIT = null;

const browser = await chromium.launch();
let crash = null;
try {

// Servern, mockarna, sessionen och splash-förbikopplingen kommer från
// _harness.mjs. Sessionen måste vara komplett: en delmängd utan refresh_token
// får shared.js att öppna #pvModal över hela sidan, och riggen rapporterade då
// att hamburgaren inte gick att klicka.
const open = (url, width) =>
  openPage(browser, `${srv.url}/${encodeURI(url)}`, {
    width, height: 800, reducedMotion: "reduce",
    waitUntil: "domcontentloaded", settle: 900,
  });


// Fäller ut hamburgaren om den finns och syns. Frågar aldrig efter en klass
// på själva panelen — bara efter knappen inuti .mWrap/.menuWrap, som är den
// enda vägen dit oavsett om panelen heter .drop eller .dropdown.
// Ett klick som inte går fram är ett fynd, inte en krasch — en hamburgare som
// ligger under ett överlägg är exakt den sortens fel riggen finns för att
// hitta. Kort timeout, och felet returneras i stället för att kastas.
async function openMenu(page) {
  const btn = page.locator(".xg-menu-btn, .mWrap button, .menuWrap button").first();
  if (!(await btn.count())) return "ingen knapp";
  if (!(await btn.isVisible())) return "knappen är dold";
  try { await btn.click({ timeout: 5000 }); } catch (e) { return String(e.message).split("\n")[0]; }
  await page.waitForTimeout(500);
  return "";
}

// Varje synlig länk i headern (inklusive verktygsraden ovanför den), som
// destination. Frågar efter <a href>, inte efter någon klass, så att
// ombyggnaden får flytta och byta namn på vad den vill.
const links = page => page.evaluate(() => {
  const roots = [document.querySelector(".xg-utility-bar"), document.querySelector("header")].filter(Boolean);
  const out = [];
  for (const root of roots) {
    for (const a of root.querySelectorAll("a[href]")) {
      const r = a.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // Märket är undantaget. Att logotypen leder hem är webbkonvention och
      // kostar ingen yta — den ska stå där oavsett. Fyndet testet är byggt för
      // är två SYNLIGA KONTROLLER för samma sak, som "Konto" i listan bredvid
      // kontoknappen. Att räkna logotypen som en av dem hade tvingat fram att
      // "Hem" försvinner ur menyn, vilket är en försämring, inte en städning.
      if (a.closest(".xg-brand")) continue;
      const href = a.getAttribute("href") || "";
      if (/^(#|mailto:|tel:)/.test(href)) continue;
      // Extern länk (UngDrive-märket) är inte en destination i produkten.
      if (/^https?:/i.test(href) && !href.includes(location.host)) continue;
      out.push({ dest: decodeURIComponent(href.split("?")[0].split("#")[0].replace(/^\.?\//, "")), text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) });
    }
  }
  return out;
});

const navVisible = page => page.evaluate(() => {
  const box = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // .xg-menu-btn är renderarens knapp; .mWrap/.menuWrap är de handskrivna
  // huvudena på sidor som ännu inte migrerat. Båda tas tills den sista är
  // flyttad — korkortet.html blir kvar tills modulen släpps.
  return {
    full: box(document.querySelector(".xg-nav")),
    burger: box(document.querySelector(".xg-menu-btn, .mWrap, .menuWrap")),
  };
});

for (const url of PAGES) {
  // ── desktop: en navigering, inga dubbletter ──────────────────────────
  {
    const { ctx, page } = await open(url, 1280);
    const v = await navVisible(page);
    ok(`${url} @1280: exakt en navigering syns`, v.full !== v.burger, JSON.stringify(v));

    const ls = await links(page);
    const seen = {};
    ls.forEach(l => { (seen[l.dest] = seen[l.dest] || []).push(l.text); });
    const dupes = Object.entries(seen).filter(([, t]) => t.length > 1);
    ok(`${url} @1280: ingen destination nås på två sätt`, dupes.length === 0,
      dupes.map(([d, t]) => `${d} via ${t.join(" + ")}`).join("; "));

    const reachable = DESTINATIONS.filter(d => d !== url).every(d => seen[d]);
    ok(`${url} @1280: varje produktsida går att nå`, reachable,
      DESTINATIONS.filter(d => d !== url && !seen[d]).join(", "));

    // De två undantagen ovan är bara giltiga om vägarna verkligen finns.
    const home = await page.evaluate(() => {
      const a = document.querySelector(".xg-brand");
      return a ? (a.getAttribute("href") || "") : null;
    });
    ok(`${url} @1280: märket leder hem`, home === "index.html", String(home));
    const acct = await page.evaluate(() => {
      const a = document.querySelector(".xg-login-btn");
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { href: a.getAttribute("href"), visible: r.width > 0 && r.height > 0 };
    });
    ok(`${url} @1280: kontoknappen syns och leder till kontot`,
      !!acct && acct.visible && acct.href === "konto.html", JSON.stringify(acct));
    await ctx.close();
  }

  // ── mobil: menyn utfälld, samma två krav ─────────────────────────────
  {
    const { ctx, page } = await open(url, 390);
    const v = await navVisible(page);
    ok(`${url} @390: den fulla listan är hopfälld`, !v.full, JSON.stringify(v));
    ok(`${url} @390: hamburgaren finns`, v.burger, JSON.stringify(v));

    const menuErr = await openMenu(page);
    ok(`${url} @390: hamburgaren går att öppna`, menuErr === "", menuErr);
    const ls = await links(page);
    const seen = {};
    ls.forEach(l => { (seen[l.dest] = seen[l.dest] || []).push(l.text); });
    const dupes = Object.entries(seen).filter(([, t]) => t.length > 1);
    ok(`${url} @390: ingen destination nås på två sätt`, dupes.length === 0,
      dupes.map(([d, t]) => `${d} via ${t.join(" + ")}`).join("; "));

    const reachable = DESTINATIONS.filter(d => d !== url).every(d => seen[d]);
    ok(`${url} @390: varje produktsida går att nå`, reachable,
      DESTINATIONS.filter(d => d !== url && !seen[d]).join(", "));

    const acct = await page.evaluate(() => {
      const a = document.querySelector(".xg-login-btn");
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { href: a.getAttribute("href"), visible: r.width > 0 && r.height > 0 };
    });
    ok(`${url} @390: kontoknappen syns även med menyn utfälld`,
      !!acct && acct.visible && acct.href === "konto.html", JSON.stringify(acct));
    await ctx.close();
  }

  // ── samma lista överallt ─────────────────────────────────────────────
  // Den här kontrollen är skälet till att divergensen inte kan komma
  // tillbaka. Den frågar efter hela listan, i ordning, och kräver att den
  // är IDENTISK med första sidans — inklusive de poster som är dolda av
  // exgen-modules.js, eftersom de finns i markupen och ska finnas där.
  {
    const { ctx, page } = await open(url, 1280);
    const lista = await page.evaluate(() =>
      [...document.querySelectorAll(".xg-nav a")]
        .map(a => decodeURIComponent(a.getAttribute("href") || "")).join(","));
    if (!NAV_FACIT) NAV_FACIT = { url, lista };
    ok(`${url} @1280: navlistan är identisk med övriga sidors`,
      lista === NAV_FACIT.lista, `${lista}  ≠  ${NAV_FACIT.lista}  (facit: ${NAV_FACIT.url})`);
    await ctx.close();
  }

  // Arket ska bära samma destinationer som listan — annars är menyn olika
  // beroende på om man står vid 390 eller 1280px, vilket är samma fel en
  // gång till fast i en annan riktning.
  {
    const { ctx, page } = await open(url, 390);
    const menuErr = await openMenu(page);
    const v = await page.evaluate(() => ({
      ark: [...document.querySelectorAll(".xg-menu a[href], .drop a[href], .dropdown a[href]")]
        .map(a => decodeURIComponent(a.getAttribute("href") || "")),
    }));
    const navPoster = NAV_FACIT.lista.split(",");
    const saknas = navPoster.filter(h => !v.ark.includes(h));
    ok(`${url} @390: arket bär varje post ur navlistan`,
      menuErr === "" && saknas.length === 0, saknas.join(", ") || menuErr);
    await ctx.close();
  }
}

} catch (e) { crash = e; }

await browser.close();
await srv.close();
process.exit(R.finish(crash));
