/* Kontrakt för det renderade sidhuvudet.
 *
 * Innan renderaren fanns huvudet i fyra implementationer med olika innehåll per
 * sida — mätt, inte antaget:
 *
 *   index                saknade sitt eget Hem
 *   förbättring          saknade både Hem och Min utveckling
 *   admin                saknade Körkortsteorin
 *   app, korkortet       egna klassnamn (.ddItem) och egna animationer
 *   larare               ingen navigering alls
 *
 * Dessutom bar style.css varje menyregel dubbelt (.mWrap/.menuWrap,
 * .drop/.dropdown, .ddi/.ddItem), tre öppna-klasser stöddes samtidigt, och sju
 * av åtta sidor hämtade en 1024px-ikon från ungdrive.se för att rita den i
 * 12x12 medan index använde en lokal fil på 2,4 kB.
 *
 * Ingen av skillnaderna var ett beslut. De var vad som hände när samma sak
 * skrevs åtta gånger.
 *
 * Testet mäter RENDERAREN. Att varje sida faktiskt använder den, och att
 * listorna är identiska sida för sida, är header-behaviour.mjs jobb.
 *
 * Användning:  node tests/frontend/header-render.mjs
 */
import fs from "node:fs";
import { join } from "node:path";
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

const FACIT = ["index.html", "app.html", "förbättring.html", "korkortet.html", "pricing.html"];

// H1: renderaren bygger huvudet ur platshållaren.
{
  const { ctx, page } = await open(1280);
  // Platshållaren måste FINNAS och vara fylld. Att bara fråga efter en header
  // och en nav hade blivit grönt mot det gamla handskrivna huvudet — testet
  // hade mätt att sidan har ett huvud, inte att renderaren byggde det.
  const v = await page.evaluate(() => {
    const slot = document.querySelector("[data-xg-header]");
    return {
      slot: !!slot,
      fylld: !!slot && slot.children.length > 0,
      header: !!(slot && slot.querySelector("header.xg-header")),
      nav: !!(slot && slot.querySelector(".xg-nav")),
      utility: !!(slot && slot.querySelector(".xg-utility-bar")),
      handskrivna: document.querySelectorAll("header.xg-header").length,
    };
  });
  ok("H1 huvudet byggs av renderaren i platshållaren, och bara ett finns",
    v.slot && v.fylld && v.header && v.nav && v.utility && v.handskrivna === 1,
    JSON.stringify(v));
  await ctx.close();
}

// H2: listan är komplett och i en bestämd ordning. Inte "de sidor någon råkade
// lägga in".
{
  const { ctx, page } = await open(1280);
  const v = await page.evaluate(() =>
    [...document.querySelectorAll(".xg-nav a")].map(a => decodeURIComponent(a.getAttribute("href"))));
  ok("H2 navlistan är komplett och i rätt ordning",
    JSON.stringify(v) === JSON.stringify(FACIT), JSON.stringify(v));
  await ctx.close();
}

// H3: körkortsraden FINNS i markupen men är dold. exgen-modules.js injicerar
// sin regel före första målningen, och hela poängen med den filen är att en
// flagga ska räcka den dag modulen släpps. Tas raden bort ur listan krävs en
// kodändring i stället för ett true.
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
// skrivbordsdropdown i hörnet, med en skugga på 50 % svart kvar från ett
// mörkt tema.
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
    [...document.querySelectorAll(".xg-menu-item")]
      .filter(e => e.getBoundingClientRect().height > 0)
      .map(e => Math.round(e.getBoundingClientRect().height)));
  ok("H6 varje synlig rad är minst 52px hög", v.length > 0 && v.every(h => h >= 52), JSON.stringify(v));
  await ctx.close();
}

// H7: Escape stänger, och fokus lämnas tillbaka till knappen. Utan det står
// fokus kvar i ett ark som inte längre syns, och nästa Tab börjar i tomma
// luften.
{
  const { ctx, page } = await open(390);
  await page.click(".xg-menu-btn");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
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
    const d = document.querySelector(".xg-menu-dim");
    return {
      menyDisplay: getComputedStyle(m).display,
      dimDisplay: getComputedStyle(d).display,
      h: Math.round(m.getBoundingClientRect().height),
    };
  });
  ok("H8 stängt ark och dimmer upptar ingen yta",
    v.menyDisplay === "none" && v.dimDisplay === "none" && v.h === 0, JSON.stringify(v));
  await ctx.close();
}

// H9: sidlokala poster hamnar i arket, under en avdelare, aldrig blandade med
// navigeringen. Blandas de blir arket olika per sida igen — felet renderaren
// finns för att laga.
{
  const { ctx, page } = await open(390);
  await page.evaluate(() => {
    document.querySelector("[data-xg-header]").remove();
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
    return {
      finns: !!e,
      iArket: !!(e && e.closest(".xg-menu")),
      iNaven: !!(e && e.closest(".xg-nav")),
      ärKnapp: e && e.tagName === "BUTTON",
    };
  });
  ok("H9 sidlokala poster hamnar i arket som knappar, inte i navigeringen",
    v.finns && v.iArket && !v.iNaven && v.ärKnapp, JSON.stringify(v));
  await ctx.close();
}

// H13: arket får inte täcka knappen som stänger det. Första utkastet satt på
// top:0 och lade sig över både hamburgaren och märket — då blir ett eget ✕
// inuti arket nödvändigt, alltså en till kontroll för något knappen redan gör.
// Mätt med elementFromPoint, inte med koordinater: det är det webbläsaren
// faktiskt skulle träffa vid ett tryck.
{
  const { ctx, page } = await open(390);
  await page.click(".xg-menu-btn");
  await page.waitForTimeout(400);
  const v = await page.evaluate(() => {
    const btn = document.querySelector(".xg-menu-btn");
    const r = btn.getBoundingClientRect();
    const träff = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const märke = document.querySelector(".xg-brand");
    const mr = märke.getBoundingClientRect();
    const märkeTräff = document.elementFromPoint(mr.x + 8, mr.y + mr.height / 2);
    return {
      knapp: !!(träff && träff.closest(".xg-menu-btn")),
      märke: !!(märkeTräff && märkeTräff.closest(".xg-brand")),
      arkTop: Math.round(document.querySelector(".xg-menu").getBoundingClientRect().y),
      headerBottom: Math.round(document.querySelector(".xg-header-wrap").getBoundingClientRect().bottom),
    };
  });
  ok("H13 arket ligger under headern och lämnar knappen och märket klickbara",
    v.knapp && v.märke && v.arkTop >= v.headerBottom - 1, JSON.stringify(v));
  await ctx.close();
}

// H10: skriptordningen. shared.js anropar syncLoginButtons() DIREKT vid
// defer-körning — readyState är "interactive", inte "loading", så else-grenen
// tas — och ett huvud som renderas efteråt får aldrig sin etikett rättad.
// Kontrolleras i källan, inte i DOM:en: felet syns bara för en inloggad
// besökare och skulle annars smyga in vid nästa sidmigrering.
{
  const SIDOR = ["index.html", "pricing.html", "app.html", "konto.html",
    "förbättring.html", "integritetspolicy.html", "larare.html", "admin.html"];
  const fel = SIDOR.filter(f => {
    const p = join(ROOT, f);
    if (!fs.existsSync(p)) return false;
    const src = fs.readFileSync(p, "utf8");
    // Bara migrerade sidor. En omigrerad sida har sin .xg-login-btn skriven
    // rakt i markupen, så shared.js hittar den oavsett ordning — kravet
    // uppstår först när knappen kommer från renderaren.
    if (!/data-xg-header/.test(src)) return false;
    const shell = src.indexOf("js/exgen-shell.js");
    if (shell < 0) return true;                // renderad header utan renderare
    const shared = src.indexOf("shared.js");
    return shared >= 0 && shell > shared;
  });
  ok("H10 exgen-shell.js laddas före shared.js på varje migrerad sida",
    fel.length === 0, fel.join(", "));
}

// H11: kontoknappen finns och pekar rätt. shared.js byter dess etikett till
// "Mitt konto" när en session finns — riggen seedar en, så etiketten ska ha
// hunnit bytas. Det är H10:s ordningskrav mätt på utsidan.
{
  const { ctx, page } = await open(1280);
  const v = await page.evaluate(() => {
    const a = document.querySelector(".xg-login-btn");
    return a ? { href: a.getAttribute("href"), text: a.textContent.trim() } : null;
  });
  ok("H11 kontoknappen fick sin etikett rättad av shared.js",
    !!v && v.href === "konto.html" && v.text === "Mitt konto", JSON.stringify(v));
  await ctx.close();
}

// H12: ingen extern förfrågan för märkesikonen. Sju av åtta sidor hämtade en
// 1024px-bild från ungdrive.se för att rita den i 12x12 — på en sajt med en
// integritetspolicy, och för varje besökare.
{
  const { ctx, page } = await open(1280);
  const v = await page.evaluate(() => {
    const img = document.querySelector(".xg-utility-badge img");
    return img ? img.getAttribute("src") : null;
  });
  ok("H12 märkesikonen hämtas lokalt, inte från ungdrive.se",
    !!v && !/^https?:/i.test(v), String(v));
  await ctx.close();
}

} catch (e) { crash = e; }
await browser.close();
await srv.close();
process.exit(R.finish(crash));
