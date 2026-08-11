import fs from "node:fs";
import path from "node:path";
import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
// Beteendekontrakt för index.html.
//
// Skrivet FÖRE ombyggnaden och kört mot den oförändrade sidan. Samma skäl som i
// forbattring-behaviour.mjs och pricing-behaviour.mjs: ett test som aldrig sett
// det gamla beteendet kan inte bevisa att det överlevde. Varje kontroll nedan är
// grön på dagens markup och ska vara grön på den ombyggda, utan att en enda av
// dem skrivs om.
//
// Testet frågar därför aldrig efter en klass som ombyggnaden tänker byta
// (.hero*, .statChip, .benefitsCard, .feat, .mockStrip, .step*, .pCard,
// .pvCard, .showcaseCard). Det frågar efter vad besökaren kan göra och se: att
// löftena står på sidan, att vägen in i produkten finns och leder rätt, att
// priserna stämmer, att varje FAQ-svar går att nå, att headern navigerar, och
// att ingenting blir liggande osynligt.
//
// Fällor, alla bekräftade i projektet tidigare:
//   1. js/site-gate.js POSTar /api/check-role och gör location.replace("/snart.html")
//      om svaret inte är {allow:true}. Den generella **/api/**-mocken räcker inte —
//      check-role måste registreras EFTER den (sist registrerad vinner).
//   2. js/intro-splash.js håller body > * på opacity:0 i minst 3,9 s via JS-timer.
//      animation:none biter inte. sessionStorage pi_splash_shown=1 gör det.
//   3. Sidan animerar in .rev med GSAP + ScrollTrigger från opacity:0.
//      reducedMotion:"reduce" tar sidans egen rm-gren, som visar allt direkt.
//   4. Kontrollen "inget blir liggande osynligt" måste scrolla igenom hela
//      sidan först — reveal sker vid intersektion, inte vid load.
//   5. Kontroll 6 blockerar cdnjs. Den bevisar att shared.js egen
//      IntersectionObserver (shared.js:initScrollReveal) bär avslöjandet, inte
//      GSAP. Mätt: med cdnjs nere syns alla 15 .rev-block ändå.
//
// Fälla 1 och 2 hanteras numera av _harness.mjs, tillsammans med servern och
// startläget i localStorage. Filen skrevs parallellt med riggen och kunde inte
// känna till den; den byggde därför sin egen server på fast port 4623 — samma
// kopiering som riggen finns för att ta bort. Kvar här står bara det som är
// unikt för startsidan: de två avbrutna tredjepartsvärdarna och det anonyma
// startläget.
//
// Användning:  node tests/frontend/index-behaviour.mjs

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT);

const R = report("index-behaviour");
const ok = (n, c, d = "") => R.ok(n, c, d);

const browser = await chromium.launch();
let crash = null;
try {

/* opts: { width, height, killCdn } */
async function mk(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width || 1280, height: opts.height || 900 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message)));

  await mockApis(page, {
    role: "gratis",
    // `extra` registreras sist och vinner därför över baslagret.
    // Tredjepartsbilden hämtas från ungdrive.se i markupen; stoppas så att
    // networkidle inte hänger på ett externt värdnamn.
    extra: [
      ["**ungdrive.se/**", r => r.abort()],
      ...(opts.killCdn ? [["**cdnjs.cloudflare.com/**", r => r.abort()]] : []),
    ],
  });
  // Startsidan möter en UTLOGGAD besökare. signedIn:false tar bort
  // sessionsnyckeln i stället för att låta bli att sätta den, och role:null
  // tar bort rollen — "inte satt" är inte samma sak som "borta" i en kontext
  // som kan återanvändas.
  await seed(page, { signedIn: false, role: null });

  await page.goto(`${srv.url}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}

const textOf = page => page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));

// ── 0: sidan är startsidan, inte grinden och inte en tom skärm ───────────
// Utan den här kan varje kontroll nedanför vara grön på fel sida. Del A och
// Del B fastnade båda på precis det: en rigg som mätte en inloggningsruta.
{
  const { ctx, page } = await mk();
  const url = page.url();
  ok("0a ingen omdirigering till grinden", !/snart\.html/.test(url), url);

  const shape = await page.evaluate(() => ({
    vis: getComputedStyle(document.body).visibility,
    h1: (document.querySelector("h1")?.textContent || "").trim(),
    docH: document.documentElement.scrollHeight,
    main: !!document.getElementById("main-content"),
  }));
  ok("0b body är synlig", shape.vis === "visible", shape.vis);
  ok("0c sidan har en h1 med text", shape.h1.length > 10, shape.h1);
  ok("0d sidan är längre än en skärm", shape.docH > 1500, String(shape.docH));
  ok("0e #main-content finns för hoppa-till-länken", shape.main);

  const skip = await page.evaluate(() => {
    const a = document.querySelector(".skip-link, a[href='#main-content']");
    return a ? a.getAttribute("href") : null;
  });
  ok("0f hoppa-till-innehåll pekar på main", skip === "#main-content", String(skip));
  await ctx.close();
}

// ── 1: löftena står på sidan ──────────────────────────────────────────────
// Formuleringarna får skrivas om; det som mäts är att varje kärnpåstående
// fortfarande går att hitta i besökarens text. Regexen är avsiktligt breda så
// att en omskrivning inte fäller dem — men var och en fångar ett eget löfte,
// så att en sida som tappar felbanken inte kan vara grön.
{
  const { ctx, page } = await mk();
  const t = await textOf(page);
  const CLAIMS = [
    ["eget material", /eget material|ditt material|ert material|ditt (kurs|studie)?material|klistra in/i],
    ["rättning med förklaring", /förklar/i],
    ["modellsvar", /modellsvar/i],
    ["felbank eller misstag som samlas", /felbank|misstag|svarat fel|svarar fel/i],
    ["nivå E, C eller A", /niv[åa].{0,20}\bA\b|E,? C (och|eller) A|E·C·A/i],
    ["gratis att börja", /gratis/i],
  ];
  for (const [name, re] of CLAIMS) ok(`1 löftet finns: ${name}`, re.test(t), t.slice(0, 0));
  await ctx.close();
}

// ── 2: vägen in i produkten ───────────────────────────────────────────────
// Startsidans enda uppgift. Kontrollen är inte "knappen heter X" utan att det
// finns minst en synlig, klickbar väg till provskaparen ovanför vecket.
{
  const { ctx, page } = await mk();
  const entry = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("a[href], button").forEach(el => {
      const r = el.getBoundingClientRect();
      const href = el.getAttribute("href") || "";
      if (!/app\.html/.test(href)) return;
      const cs = getComputedStyle(el);
      out.push({
        text: (el.textContent || "").trim().slice(0, 40),
        top: Math.round(r.top + scrollY),
        visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none",
      });
    });
    return { links: out, fold: innerHeight };
  });
  ok("2a minst en väg till provskaparen finns", entry.links.length > 0, JSON.stringify(entry.links));
  ok("2b minst en av dem är synlig", entry.links.some(l => l.visible), JSON.stringify(entry.links));
  ok("2c minst en ligger ovanför vecket", entry.links.some(l => l.visible && l.top < entry.fold),
    `fold=${entry.fold} ${JSON.stringify(entry.links.map(l => l.top))}`);
  await ctx.close();
}

// ── 3: priserna ───────────────────────────────────────────────────────────
// Tre belopp och en väg till prissidan. Beloppen är produktfakta, inte design —
// de får inte tappas bort i en ombyggnad.
{
  const { ctx, page } = await mk();
  const t = await textOf(page);
  for (const amt of ["0", "29", "79"]) {
    ok(`3a priset ${amt} kr står på sidan`, new RegExp("(^|[^0-9])" + amt + "\\s*kr", "i").test(t));
  }
  const toPricing = await page.evaluate(() =>
    [...document.querySelectorAll("a[href*='pricing.html']")].some(a => {
      const r = a.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }));
  ok("3b en synlig väg till prissidan finns", toPricing);
  await ctx.close();
}

// ── 4: varje FAQ-svar går att nå ──────────────────────────────────────────
// Drivs genom den riktiga vägen: klick på frågan, sedan läs att svaret har
// yta. Att svaret finns i DOM räcker inte — det gjorde det redan när det var
// hopfällt.
{
  const { ctx, page } = await mk();
  const n = await page.evaluate(() => document.querySelectorAll("main .faqQ, main [aria-controls][aria-expanded]").length);
  ok("4a sidan har vanliga frågor", n >= 4, String(n));

  const opened = await page.evaluate(async () => {
    const qs = [...document.querySelectorAll("main .faqQ, main [aria-controls][aria-expanded]")];
    const res = [];
    for (const q of qs) {
      q.scrollIntoView({ block: "center" });
      q.click();
      await new Promise(r => setTimeout(r, 380));
      const ans = document.getElementById(q.getAttribute("aria-controls"));
      const r = ans ? ans.getBoundingClientRect() : null;
      res.push({
        q: (q.textContent || "").trim().slice(0, 34),
        h: r ? Math.round(r.height) : 0,
        chars: ans ? (ans.textContent || "").trim().length : 0,
      });
    }
    return res;
  });
  for (const r of opened) {
    ok(`4b svaret öppnas: "${r.q}"`, r.h > 10 && r.chars > 20, JSON.stringify(r));
  }
  await ctx.close();
}

// ── 5: headern navigerar ──────────────────────────────────────────────────
{
  const { ctx, page } = await mk();
  const nav = await page.evaluate(() => {
    const brand = document.querySelector("header a[href]");
    const links = [...document.querySelectorAll("header a[href]")].map(a => a.getAttribute("href"));
    return { brand: brand ? brand.getAttribute("href") : null, links };
  });
  ok("5a märket leder hem", /index\.html|^\/$/.test(String(nav.brand)), String(nav.brand));
  for (const target of ["app.html", "pricing.html", "konto.html"]) {
    ok(`5b headern når ${target}`, nav.links.some(h => h && h.includes(target)), JSON.stringify(nav.links));
  }
  await ctx.close();
}

// ── 6: sidan bär sig själv när GSAP-CDN:et är nere ────────────────────────
// .rev startar på opacity:0. Om avslöjandet bara låg i GSAP skulle en trasig
// cdnjs lämna sidan tom under hjälten. shared.js initScrollReveal ska bära det.
{
  const { ctx, page } = await mk({ killCdn: true });
  const res = await page.evaluate(async () => {
    // Scrolla igenom hela sidan så att varje intersektion hinner ske.
    const step = innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 90));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 700));
    const hidden = [...document.querySelectorAll("main *")].filter(el => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false; // avsiktligt dolt
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && parseFloat(cs.opacity) < 0.05;
    }).map(el => el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0]);
    return { gsap: typeof window.gsap, hidden: hidden.slice(0, 8), n: hidden.length };
  });
  ok("6a GSAP är verkligen borta i den här körningen", res.gsap === "undefined", res.gsap);
  ok("6b inget innehåll blir liggande osynligt utan GSAP", res.n === 0, JSON.stringify(res.hidden));
  await ctx.close();
}

// ── 7: samma sak med GSAP på plats ────────────────────────────────────────
{
  const { ctx, page } = await mk();
  const res = await page.evaluate(async () => {
    const step = innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 90));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 700));
    const hidden = [...document.querySelectorAll("main *")].filter(el => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && parseFloat(cs.opacity) < 0.05;
    }).map(el => el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0]);
    return { n: hidden.length, hidden: hidden.slice(0, 8) };
  });
  ok("7a inget innehåll blir liggande osynligt", res.n === 0, JSON.stringify(res.hidden));
  await ctx.close();
}

// ── 8: inga interna länkar pekar i tomma luften ───────────────────────────
{
  const { ctx, page } = await mk();
  const hrefs = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href")))]
      .filter(h => h && !/^(#|https?:|mailto:|tel:)/.test(h)));
  for (const h of hrefs) {
    const f = path.join(ROOT, decodeURIComponent(h.split("?")[0].split("#")[0]).replace(/^\//, ""));
    ok(`8 länken finns: ${h}`, fs.existsSync(f), f);
  }
  await ctx.close();
}

// ── 9: P.E.R finns och går att öppna ──────────────────────────────────────
{
  const { ctx, page } = await mk();
  const before = await page.evaluate(() => !!document.getElementById("perBubble"));
  ok("9a P.E.R-bubblan finns", before);
  if (before) {
    const opened = await page.evaluate(async () => {
      document.getElementById("perBubble").click();
      await new Promise(r => setTimeout(r, 500));
      const p = document.getElementById("perPanel");
      if (!p) return { err: "ingen panel" };
      const r = p.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width) };
    });
    ok("9b panelen öppnas med yta", !opened.err && opened.h > 40 && opened.w > 40, JSON.stringify(opened));
  }
  await ctx.close();
}

// ── 10: sidan kastar inga fel ─────────────────────────────────────────────
{
  const { ctx, page, errors } = await mk();
  await page.evaluate(async () => {
    const step = innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 60));
    }
  });
  ok("10 inga oväntade JS-fel", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ── 11: mobilen får samma sida ────────────────────────────────────────────
// Inte en pixelkontroll. Den fångar den klass av fel där en sektion blir
// nollhög eller sticker ut i sidled på telefon.
{
  const { ctx, page } = await mk({ width: 390, height: 844 });
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    docH: document.documentElement.scrollHeight,
    h1: (document.querySelector("h1")?.textContent || "").trim().length,
  }));
  ok("11a ingen vågrät scroll på 390px", m.overflow <= 1, String(m.overflow));
  ok("11b sidan har innehåll på mobil", m.docH > 1500 && m.h1 > 10, JSON.stringify(m));
  await ctx.close();
}

} catch (e) {
  crash = e;
} finally {
  await browser.close();
  await srv.close();
}

process.exit(R.finish(crash));
