/* _harness.mjs — det varje frontend-test i katalogen behövde och byggde själv.
 *
 * VARFÖR DEN FINNS
 *
 * Fjorton testfiler byggde var sin kopia av samma fem saker: statiska servern,
 * ruttmockarna, Supabase-sessionen i localStorage, förbikopplingen av
 * introsplashen, och geometrimatten. Kopiorna gled isär, och tre av dem ljög
 * innan någon märkte det:
 *
 *   per-visual.mjs      fotograferade välkomstöverlägget i stället för appen.
 *                       Varje "app.html 0" i Del A och Del B mättes så.
 *   per-mobile.test.mjs rectsOverlap() jämförde a.left/right/top/bottom ur en
 *                       Playwright-boundingBox, som bara har x/y/width/height.
 *                       Fälten var undefined, jämförelserna false, funktionen
 *                       returnerade ALLTID false. Varje överlappskontroll i
 *                       filen var tom sedan den skrevs.
 *   header-behaviour    en sessionsseed utan refresh_token/expires_in godtas
 *                       inte av shared.js, som öppnar #pvModal över hela sidan.
 *                       Riggen rapporterade "hamburgaren går inte att klicka".
 *
 * Ingen av de tre var ett tankefel. Alla tre var en kopia som saknade ett fält
 * en annan kopia hade. Det är därför den här filen finns: det som kan vara fel
 * på fjorton ställen ska bara kunna vara fel på ett.
 *
 * SEX FÄLLOR SOM ALLA ÄR HANTERADE HÄR, EN GÅNG
 *
 * 1. js/site-gate.js POSTar /api/check-role och gör location.replace("/snart.html")
 *    om svaret inte är {allow:true}. En generell **­/api/**-mock räcker inte:
 *    Playwrights SIST registrerade rutt vinner, tvärtemot hur listan läses, så
 *    check-role måste registreras EFTER den generella.
 * 2. js/intro-splash.js håller body > * på opacity:0 i ~4,5 s via en JS-timer.
 *    animation:none biter inte. sessionStorage pi_splash_shown=1 gör det.
 * 3. shared.js läser sessionen ur localStorage, inte ur ett API-svar. Utan en
 *    komplett session öppnas registreringsrutan över hela sidan och varje
 *    mätning gäller den i stället för sidan.
 * 4. shared.js showWelcomeAnim() lägger #proviaWelcome över sidan och tar bort
 *    den med setTimeout 2400+500 ms — inte med en animation, så *{animation:none}
 *    biter inte heller där.
 * 5. syncFromAccount() skriver ALLTID över proviaai_history och
 *    proviaai_mistakes med vad Supabase svarade. Att seeda dem i localStorage
 *    ger en tom sida — seeda via user_exams i stället.
 * 6. Fasta portnummer krockar. Två filer stod båda på 4621, och en körning av
 *    hela sviten dog mitt i. serve() binder därför port 0 och läser ut den
 *    tilldelade porten.
 *
 * ES-modul, som allt annat under tests/. Ingen kod här får importeras av
 * produktionen.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve, join, extname } from "node:path";
import http from "node:http";
import fs from "node:fs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/* Projektets Supabase-nyckel i localStorage. Står här en gång i stället för
   som en literal i åtta filer. */
export const AUTH_KEY = "sb-mnmotdluigzeehdjbhbu-auth-token";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/* Statisk server över ett träd i repot.
 *
 * Port 0 betyder "tilldela en ledig port", och den faktiska porten läses ur
 * server.address(). Fasta nummer var en tickande krock: fjorton filer delade
 * åtta nummer, två av dem stod båda på 4621, och en körning av hela sviten dog
 * mitt i med "Target page, context or browser has been closed".
 *
 * Sökvägen normaliseras och kontrolleras mot roten så att en begäran inte kan
 * ta sig ut ur trädet. Det är ingen produktionsserver, men en rigg som kan läsa
 * vilken fil som helst på disken är en rigg som kan ljuga om vad den läste.
 *
 * Returnerar { url, port, close } där url saknar avslutande snedstreck. */
export async function serve(root = ROOT, { indexFile = "index.html" } = {}) {
  const base = resolve(root);
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(req.url.split("?")[0]); }
    catch (_) { res.writeHead(400); res.end("bad path"); return; }
    if (p === "/") p = "/" + indexFile;
    const file = resolve(join(base, p));
    if (file !== base && !file.startsWith(base + "/")) { res.writeHead(403); res.end("nej"); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((ok, no) => { server.once("error", no); server.listen(0, ok); });
  const port = server.address().port;
  return {
    port,
    url: `http://localhost:${port}`,
    close: () => new Promise(ok => server.close(ok)),
  };
}

/* Geometri.
 *
 * Playwrights boundingBox() returnerar {x, y, width, height}. Den här
 * funktionen fanns tidigare i per-mobile.test.mjs och läste left/right/top/bottom
 * — fyra fält som inte finns. `undefined < tal` är false, så den returnerade
 * alltid false, och varje överlappskontroll i filen bevisade ingenting.
 *
 * Tar emot både {x,y,width,height} och {left,top,right,bottom} så att en
 * anropare som skickar en DOMRect inte får tyst fel svar. Saknas måtten
 * kastar den hellre än returnerar false: en mätning som inte gick att göra
 * ska aldrig se ut som en mätning som gick bra. */
function norm(r, name) {
  if (!r || typeof r !== "object") return null;
  const x = typeof r.x === "number" ? r.x : r.left;
  const y = typeof r.y === "number" ? r.y : r.top;
  const w = typeof r.width === "number" ? r.width
    : (typeof r.right === "number" && typeof x === "number" ? r.right - x : undefined);
  const h = typeof r.height === "number" ? r.height
    : (typeof r.bottom === "number" && typeof y === "number" ? r.bottom - y : undefined);
  if ([x, y, w, h].some(v => typeof v !== "number" || Number.isNaN(v))) {
    throw new TypeError(`rect saknar mått (${name}): ${JSON.stringify(r)}`);
  }
  return { x, y, w, h };
}

export function rectsOverlap(a, b) {
  const A = norm(a, "a"), B = norm(b, "b");
  if (!A || !B) return false;                 // null = elementet finns inte
  if (A.w <= 0 || A.h <= 0 || B.w <= 0 || B.h <= 0) return false;
  return A.x < B.x + B.w && A.x + A.w > B.x &&
         A.y < B.y + B.h && A.y + A.h > B.y;
}

/* Sessionen som shared.js godtar.
 *
 * Hela formen, inte en delmängd. Utan refresh_token och expires_in öppnar
 * shared.js #pvModal — ett fast överlägg på z-index 13000 — och varje mätning
 * gäller inloggningsrutan i stället för sidan. Den buggen kostade en halv
 * felsökning innan orsaken var hittad, och orsaken var att en fil skrivits av
 * ur en annan utan alla fält. */
export function sessionValue({ id = "u1", email = "u1@t.se", ttl = 7200 } = {}) {
  return JSON.stringify({
    access_token: "a.b.c",
    refresh_token: "r",
    expires_in: ttl,
    expires_at: Math.floor(Date.now() / 1000) + ttl,
    token_type: "bearer",
    user: { id, email },
  });
}

/* Startläget i webbläsaren, injicerat före sidans egna skript.
 *
 * signedIn:false tar bort nyckeln i stället för att låta bli att sätta den —
 * en kontext kan återanvändas, och "inte satt" är inte samma sak som "borta".
 *
 * storage/session är råa nyckel/värde-par för det ett enskilt test behöver
 * utöver grunden. Värden som inte är strängar JSON-kodas, så en anropare
 * slipper JSON.stringify på varje rad. */
export async function seed(page, {
  signedIn = true, role = "premium", lang = "sv",
  user = {}, storage = {}, session = {}, splash = false,
} = {}) {
  const payload = {
    authKey: AUTH_KEY,
    signedIn, role, lang, splash,
    token: signedIn ? sessionValue(user) : null,
    storage: Object.fromEntries(Object.entries(storage).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])),
    session: Object.fromEntries(Object.entries(session).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])),
  };
  await page.addInitScript(s => {
    // Fälla 2: splashen hålls tillbaka som standard. Ett test som VILL se den
    // sätter splash:true.
    if (!s.splash) sessionStorage.setItem("pi_splash_shown", "1");
    localStorage.setItem("proviaai_cookie_consent", JSON.stringify({ necessary: true }));
    localStorage.setItem("proviaai_lang", s.lang);
    if (s.role) localStorage.setItem("proviaai_role", s.role); else localStorage.removeItem("proviaai_role");
    if (s.token) localStorage.setItem(s.authKey, s.token); else localStorage.removeItem(s.authKey);
    for (const [k, v] of Object.entries(s.storage)) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(s.session)) sessionStorage.setItem(k, v);
  }, payload);
}

/* Ruttmockarna.
 *
 * Registreringsordningen är inte kosmetisk. Playwright låter den SIST
 * registrerade rutten vinna, tvärtemot hur listan läses uppifrån och ned. Den
 * generella **­/api/** måste därför komma FÖRE check-role, och **­/rest/v1/**
 * före en tabellspecifik rutt. En felvänd ordning gav vid ett tillfälle sex
 * gröna kontroller på en helt tom sida.
 *
 * `extra` är en lista [glob, handler] som registreras SIST och därför vinner
 * över allt ovanför — det är där ett test lägger sina egna svar. */
export async function mockApis(page, {
  role = "premium", approved = true, allow = true,
  restRows = [], profiles = null, extra = [],
} = {}) {
  await page.route("**/api/**", r => r.fulfill({ json: { ok: true } }));
  // EFTER den generella. Fälla 1.
  await page.route("**/api/check-role", r => r.fulfill({ json: { allow, ok: true, role, approved } }));
  await page.route("**/auth/v1/**", r => r.fulfill({ json: { id: "u1", email: "t@t.se" } }));
  await page.route("**/rest/v1/**", r => r.fulfill({ json: restRows }));
  if (profiles) {
    // EFTER den generella rest-rutten, annars äter den upp den här.
    await page.route("**/rest/v1/profiles**", r => r.fulfill({ json: profiles }));
  }
  for (const [glob, handler] of extra) await page.route(glob, handler);
}

/* En sida med allt ovanstående på plats, i rätt ordning: rutterna och seeden
   registreras FÖRE goto, annars hinner sidans egna skript läsa ett tomt
   localStorage och fråga en omockad server. */
export async function openPage(browser, url, {
  width = 1280, height = 900, reducedMotion, mocks = {}, state = {},
  waitUntil = "networkidle", settle = 700,
} = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(reducedMotion ? { reducedMotion } : {}) });
  const page = await ctx.newPage();
  await mockApis(page, mocks);
  await seed(page, state);
  await page.goto(url, { waitUntil });
  // Fälla 4: välkomstöverlägget ligger kvar i ~2,9 s och tas bort av en timer,
  // inte av en animation. Det fotograferades i stället för appen i månader.
  await page.evaluate(() => { const w = document.getElementById("proviaWelcome"); if (w) w.remove(); });
  if (settle) await page.waitForTimeout(settle);
  return { ctx, page, close: () => ctx.close() };
}

/* Resultaträkning. Varje fil hade sin egen variant av samma tre rader, med
   olika ordval i utskriften. Den här skriver alltid ut på samma form, så att
   en körning av hela katalogen går att läsa som en enda logg. */
export function report(name) {
  const pass = [], fail = [];
  return {
    ok(label, cond, detail = "") {
      (cond ? pass : fail).push(label + (detail ? " — " + detail : ""));
      return !!cond;
    },
    get passed() { return pass.length; },
    get failed() { return fail.length; },
    /* Skriver ut och returnerar exit-koden. Anroparen bestämmer när processen
       ska dö — en fil som har städning kvar ska hinna göra den först. */
    finish(crash = null) {
      if (crash) console.log("  FAIL  riggen kastade — " + String(crash.stack || crash.message).split("\n").slice(0, 3).join(" / "));
      if (pass.length) console.log(pass.map(p => "  ok  " + p).join("\n"));
      if (fail.length) console.log(fail.map(f => "  FAIL " + f).join("\n"));
      console.log(`\n${name}: ${pass.length} ok, ${fail.length} fail`);
      return fail.length || crash ? 1 : 0;
    },
  };
}
