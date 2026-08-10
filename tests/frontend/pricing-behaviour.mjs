import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
// Beteendekontrakt för pricing.html.
//
// Skrivet FÖRE ombyggnaden i Del C steg 2 och kört mot den oförändrade sidan.
// Samma skäl som i forbattring-behaviour.mjs: ett test som aldrig sett det
// gamla beteendet kan inte bevisa att det överlevde. Varje kontroll nedan är
// grön på dagens markup och ska vara grön på den ombyggda, utan att en enda av
// dem skrivs om.
//
// Därför frågar testet aldrig efter en klass som ombyggnaden tänker byta
// (.planBadge, .planCta, .faqA, .compareTable). Det frågar efter vad besökaren
// kan göra och se: att de tre planerna finns och kostar rätt, att P.E.R kan
// skicka en dit, att rösten säger sanning om den egna användningen, att märket
// pekar ut rätt plan, att köpknappen leder vidare, att varje FAQ-svar går att
// nå, och att avstängda moduler inte läcker in i jämförelsen.
//
// Fällor, alla bekräftade i projektet tidigare:
//   1. js/site-gate.js POSTar /api/check-role och gör location.replace("/snart.html")
//      om svaret inte är {allow:true}. Den generella **/api/**-mocken räcker inte —
//      check-role måste registreras EFTER den (sist registrerad vinner).
//   2. js/intro-splash.js håller body > * på opacity:0 i ~4,5 s via JS-timer.
//      animation:none biter inte. sessionStorage pi_splash_shown=1 gör det.
//   3. Sidan animerar in .planCard med GSAP + ScrollTrigger från opacity:0.
//      Kontexten körs därför med reducedMotion:"reduce" — sidans egen
//      rm-gren hoppar över både GSAP, sifferräknaren och muspekaren, och
//      korten står stilla på sina riktiga värden från första bildrutan.
//   4. Rösten (setPricingVoice längst ned i body) läser localStorage vid parse,
//      alltså före shared.js som laddas med defer. Seedning måste ske i
//      addInitScript, inte efter goto.
//
// Användning:  node tests/frontend/pricing-behaviour.mjs

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const PORT = 4619;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/pricing.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const pass = [], fail = [];
const ok = (n, c, d = "") => (c ? pass : fail).push(n + (d ? " — " + d : ""));

const browser = await chromium.launch();
let crash = null;
try {

const DAY = 864e5;
const now = Date.now();
// Måndag 00:00 i samma vecka, svensk konvention — samma räkning som sidan gör.
const wd = (new Date(now).getDay() + 6) % 7;
const weekStart = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime() - wd * DAY;

// Prov "n dagar in i den här veckan", alltid efter weekStart och aldrig i
// framtiden — annars beror testet på vilken veckodag det körs.
const inWeek = n => Array.from({ length: n }, (_, i) => ({ ts: weekStart + 3600e3 + i * 60e3, course: "Biologi 1", pct: 70 }));

/* seed: { role, history, profileRole, session } */
async function mk(seed = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ json: { ok: true } }));
  // Efter den generella — sist registrerad vinner, se fälla 1.
  await page.route("**/api/check-role", r => r.fulfill({ json: { allow: true, ok: true, role: seed.role || "gratis", approved: true } }));
  await page.route("**/auth/v1/**", r => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
  await page.route("**/rest/v1/**", r => r.fulfill({ json: [] }));
  // EFTER den generella. Sist registrerad vinner.
  await page.route("**/rest/v1/profiles**", r => r.fulfill({ json: seed.profileRole ? [{ id: "u1", role: seed.profileRole }] : [] }));

  await page.addInitScript(s => {
    sessionStorage.setItem("pi_splash_shown", "1");
    localStorage.setItem("proviaai_cookie_consent", JSON.stringify({ necessary: true }));
    if (s.role) localStorage.setItem("proviaai_role", s.role); else localStorage.removeItem("proviaai_role");
    localStorage.setItem("proviaai_history", JSON.stringify(s.history || []));
    if (s.session) {
      const exp = Math.floor(Date.now() / 1000) + 7200;
      localStorage.setItem("sb-mnmotdluigzeehdjbhbu-auth-token", JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_in: 7200, expires_at: exp, token_type: "bearer", user: { id: "u1", email: "u1@t.se" } }));
    } else {
      localStorage.removeItem("sb-mnmotdluigzeehdjbhbu-auth-token");
    }
  }, seed);

  await page.goto(`http://localhost:${PORT}/pricing.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  return { ctx, page };
}

const PLANS = [
  { id: "plan-gratis", name: "Gratis", amount: "0" },
  { id: "plan-basic", name: "Basic", amount: "29" },
  { id: "plan-premium", name: "Premium", amount: "79" },
];

// Priset utan att veta vilket element som bär det. Sidan renderar "0 kr för
// alltid" respektive "29 kr / månad"; kontrollen är att beloppet står i
// kortet som ett eget tal, inte att .planAmt finns.
const amountIn = (page, id) => page.evaluate(cid => {
  const el = document.getElementById(cid);
  return el ? (el.innerText || "").replace(/\s+/g, " ") : "";
}, id);

// ── 0: sidan har de tre planerna, synliga, med rätt pris ─────────────────
// Utan den här kan varje kontroll nedanför vara grön på en tom sida.
{
  const { ctx, page } = await mk();
  for (const p of PLANS) {
    const box = await page.locator("#" + p.id).boundingBox();
    ok(`0a ${p.name} finns och har yta`, !!box && box.width > 0 && box.height > 0, JSON.stringify(box));
    const txt = await amountIn(page, p.id);
    ok(`0b ${p.name} kostar ${p.amount}`, new RegExp("(^|[^0-9])" + p.amount + "([^0-9]|$)").test(txt), txt.slice(0, 90));
    ok(`0c ${p.name} bär sitt namn`, txt.includes(p.name), txt.slice(0, 60));
  }
  // Sidan öppnar med P.E.R:s röst, inte med en rubrik. Samma öppning som
  // app.html och förbättring.html — det är vad "samma format" betyder.
  const voice = await page.evaluate(() => {
    const per = document.querySelector(".xf-per");
    if (!per) return null;
    const say = per.querySelector(".xf-say"), orb = per.querySelector(".xf-orb");
    return { say: (say && say.textContent || "").trim(), orb: !!orb, first: per === document.querySelector("main .xf-per") };
  });
  ok("0d sidan öppnar med P.E.R:s röst", !!voice && voice.orb && voice.say.length > 0, JSON.stringify(voice));
  await ctx.close();
}

// ── 1: P.E.R kan skicka besökaren till en enskild plan ───────────────────
// Drivs genom den riktiga vägen: [GOTO:#id] i ett svar, sedan klick på knappen
// som dyker upp. __perTestCtx().targets bär id och etikett men inte go() —
// den funktionen överlever inte kontextpaketeringen, så ett test som anropar
// den direkt testar något ingen besökare kan göra.
{
  const { ctx, page } = await mk();
  const ids = await page.evaluate(() => (window.__perTestCtx().targets || []).map(t => t.id));
  ok("1a tre mål deklareras", ids.length === 3, JSON.stringify(ids));
  ok("1b rätt id", ["gratis", "basic", "premium"].every(i => ids.includes(i)), JSON.stringify(ids));

  await page.click("#perBubble");
  for (const id of ids) {
    const res = await page.evaluate(async tid => {
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 100));
      const msgs = document.getElementById("perMessages");
      const div = document.createElement("div");
      msgs.appendChild(div);
      window.__perFinalize(div, "Här är den.\n[GOTO:#" + tid + "]");
      const cta = msgs.querySelectorAll(".per-nav-cta");
      const btn = cta[cta.length - 1];
      if (!btn) return { err: "ingen knapp" };
      btn.click();
      await new Promise(r => setTimeout(r, 1200));
      const card = document.getElementById("plan-" + tid);
      if (!card) return { err: "inget kort" };
      const r = card.getBoundingClientRect();
      // Svagaste kravet som ändå utesluter en no-op: kortet har yta OCH
      // ligger inom fönstret efter hoppet.
      return { h: Math.round(r.height), top: Math.round(r.top), inView: r.height > 0 && r.top < innerHeight && r.bottom > 0 };
    }, id);
    ok(`1c målet "${id}" tar besökaren till kortet`, !res.err && res.inView, JSON.stringify(res));
  }
  await ctx.close();
}

// ── 2: rösten säger sanning om den egna användningen ─────────────────────
// Prissidans enda uppgift är att svara på "behöver JAG betala?". Svaret beror
// på vad besökaren gjort, och de fem grenarna nedan är hela det svaret.
const voiceOf = page => page.evaluate(() => {
  const m = document.querySelector("main");
  return ((m && m.innerText) || "").replace(/\s+/g, " ").slice(0, 600);
});

{
  const { ctx, page } = await mk();               // utloggad, ingen historik
  const t = await voiceOf(page);
  ok("2a utan data står markupens standardtext kvar", /Börja gratis/i.test(t), t.slice(0, 120));
  await ctx.close();
}
{
  const { ctx, page } = await mk({ history: inWeek(1) });
  const t = await voiceOf(page);
  ok("2b under taket räknas proven den här veckan", /1 prov den här veckan/i.test(t), t.slice(0, 160));
  ok("2c och besked om att det inte finns skäl att betala", /2 kvar/.test(t), t.slice(0, 200));
  await ctx.close();
}
{
  const { ctx, page } = await mk({ history: inWeek(3) });
  const t = await voiceOf(page);
  ok("2d vid taket sägs det rakt ut", /slagit i taket/i.test(t), t.slice(0, 200));
  await ctx.close();
}
{
  const { ctx, page } = await mk({ role: "basic", history: inWeek(4) });
  const t = await voiceOf(page);
  ok("2e Basic får sin egen räkning mot 30", /Du har Basic/i.test(t) && /4 av 30/.test(t), t.slice(0, 200));
  await ctx.close();
}
{
  const { ctx, page } = await mk({ role: "premium", history: inWeek(2) });
  const t = await voiceOf(page);
  ok("2f Premium får besked om att inga tak gäller", /Du har Premium/i.test(t) && /Inga tak/i.test(t), t.slice(0, 200));
  await ctx.close();
}

// ── 3: märket pekar ut den plan besökaren faktiskt har ───────────────────
// Läser kortets egen text i stället för .planBadge, så att märket får byta
// element i ombyggnaden.
const cardText = (page, id) => page.evaluate(cid => {
  const el = document.getElementById(cid);
  return el ? (el.innerText || "").replace(/\s+/g, " ") : "";
}, id);

{
  const { ctx, page } = await mk({ role: "basic", history: inWeek(1) });
  ok("3a Basic märks som din plan", /Basic — din plan/i.test(await cardText(page, "plan-basic")));
  // Rösten har just sagt att Basic räcker. Då får inte kortet bredvid säga
  // "Rekommenderas" — sidan skulle säga emot sig själv i samma synfält.
  ok("3b ingen rekommendation medan Basic räcker", !/Rekommenderas/i.test(await cardText(page, "plan-premium")), await cardText(page, "plan-premium"));
  await ctx.close();
}
{
  const { ctx, page } = await mk({ role: "basic", history: inWeek(26) });
  ok("3c nära taket rekommenderas Premium", /rekommenderas för dig/i.test(await cardText(page, "plan-premium")), await cardText(page, "plan-premium"));
  await ctx.close();
}
{
  const { ctx, page } = await mk({ history: inWeek(3) });
  ok("3d gratisanvändare vid taket rekommenderas Basic", /rekommenderas för dig/i.test(await cardText(page, "plan-basic")), await cardText(page, "plan-basic"));
  await ctx.close();
}
{
  const { ctx, page } = await mk();               // ingen data alls
  ok("3e utan data står markupens Premium-tips kvar", /Rekommenderas/i.test(await cardText(page, "plan-premium")), await cardText(page, "plan-premium"));
  await ctx.close();
}

// ── 4: varje plan har en väg vidare, och den leder någonstans ────────────
{
  const { ctx, page } = await mk();
  // Gratis går rakt in i appen. Kontrollen letar efter en länk till app.html
  // inuti kortet, inte efter .planCta.
  const gratisHref = await page.evaluate(() => {
    const a = document.querySelector("#plan-gratis a[href]");
    return a ? a.getAttribute("href") : null;
  });
  ok("4a Gratis leder in i appen", gratisHref === "app.html", String(gratisHref));

  for (const id of ["basic", "premium"]) {
    const has = await page.evaluate(cid => !!document.getElementById("btn-" + cid), id);
    ok(`4b ${id} har en köpknapp`, has);
  }

  // Utan session ska köpknappen ta besökaren till appen för att skapa konto,
  // inte tyst göra ingenting. startCheckout gör location.href = "app.html".
  await page.evaluate(() => document.getElementById("btn-basic").scrollIntoView({ block: "center" }));
  await page.click("#btn-basic");
  await page.waitForTimeout(1200);
  ok("4c utan konto leder köpknappen till appen", page.url().includes("app.html"), page.url());
  await ctx.close();
}

// ── 5: hantera prenumeration visas bara för betalande ────────────────────
{
  const { ctx, page } = await mk();
  ok("5a dold utan konto", !(await page.locator("#manageSubSection").isVisible()));
  await ctx.close();
}
{
  const { ctx, page } = await mk({ session: true, role: "basic", profileRole: "basic" });
  await page.waitForTimeout(1200);
  ok("5b synlig för betalande", await page.locator("#manageSubSection").isVisible());
  await ctx.close();
}

// ── 6: varje FAQ-svar går att nå ─────────────────────────────────────────
// Frågetexten står kvar i båda formerna; svaret ligger idag bakom ett klick
// och kan efter ombyggnaden ligga öppet. Kontrollen tål båda: syns svaret
// redan är det nått, annars klickas frågan först.
const FAQ = [
  ["Kan jag testa gratis", "kortuppgifter"],
  ["Hur avbokar jag", "prenumerationsportalen"],
  ["om jag nedgraderar", "finns kvar"],
  ["hela klassen eller skolan", "skolpaket"],
];
{
  const { ctx, page } = await mk();
  for (const [q, a] of FAQ) {
    const shown = await page.evaluate(async ([qq, aa]) => {
      const vis = t => Array.from(document.querySelectorAll("main *")).some(el => {
        if (!(el.textContent || "").includes(t)) return false;
        if (Array.from(el.children).some(c => (c.textContent || "").includes(t))) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (vis(aa)) return true;
      const head = Array.from(document.querySelectorAll("main *")).find(el =>
        (el.textContent || "").includes(qq) && !Array.from(el.children).some(c => (c.textContent || "").includes(qq)));
      if (!head) return false;
      head.click();
      await new Promise(r => setTimeout(r, 500));
      return vis(aa);
    }, [q, a]);
    ok(`6a svaret på "${q}…" går att nå`, shown);
  }
  await ctx.close();
}

// ── 7: avstängda moduler läcker inte in i jämförelsen ────────────────────
// exgen-modules.js döljer [data-module="korkort"] innan sidan målas. En
// jämförelsetabell som listar körkortsteorin på en plattform där modulen är
// av är en lögn i den dyraste riktningen — den säljer något som inte finns.
{
  const { ctx, page } = await mk();
  const t = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("main table tbody tr"));
    const vis = rows.filter(r => r.getBoundingClientRect().height > 0);
    return {
      total: rows.length,
      visible: vis.length,
      text: vis.map(r => r.innerText.replace(/\s+/g, " ")).join(" | "),
      cols: (rows[0] ? rows[0].children.length : 0),
    };
  });
  ok("7a jämförelsen har rader", t.visible > 0, JSON.stringify({ total: t.total, visible: t.visible }));
  ok("7b fyra kolumner: funktion + tre planer", t.cols === 4, String(t.cols));
  ok("7c körkortsraderna är dolda", !/Repetitionsläge|Vägmärken|Teoriprov/i.test(t.text), t.text.slice(0, 160));
  ok("7d studieraderna finns kvar", /Lärarrapport/.test(t.text) && /Felbank/.test(t.text), t.text.slice(0, 200));
  await ctx.close();
}

// ── 8: sidfotens år räknas fram, inte skrivs in ──────────────────────────
{
  const { ctx, page } = await mk();
  const y = await page.evaluate(() => (document.querySelector("footer").innerText || ""));
  ok("8a året är i år", y.includes(String(new Date().getFullYear())), y.slice(0, 80));
  await ctx.close();
}

} catch (e) { crash = e; }

await browser.close();
server.close();
if (crash) console.log("  FAIL  riggen kastade — " + String(crash.stack || crash.message).split("\n").slice(0, 3).join(" / "));

console.log(pass.map(p => "  ok  " + p).join("\n"));
if (fail.length) console.log(fail.map(f => "  FAIL " + f).join("\n"));
console.log(`\n${pass.length} ok, ${fail.length} fail`);
process.exit(fail.length || crash ? 1 : 0);
