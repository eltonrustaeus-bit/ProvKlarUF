import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
// Face ID och Touch ID på per.html (Del B).
//
// Användning:  node tests/frontend/per-passkey.test.mjs
//
// Det här testet mockar INTE WebAuthn. Chromium får en virtuell autentiserare
// via CDP som gör riktiga signaturer, och serversidan är de riktiga
// funktionerna ur api/_admin-passkey.js körda mot ett minneslager. Det som
// mäts är alltså hela kedjan: sidans base64url-kodning, bibliotekets
// verifiering, och att en utmaning bara går att använda en gång.
//
// Ett test som mockar navigator.credentials hade bevisat att sidan anropar en
// funktion — inte att låset håller.

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");

const HEM = "testhemlighet";
const UID = "11111111-1111-4111-8111-111111111111";

const srv = await serve(ROOT, { indexFile: "per.html" });
const R = report("per-passkey");
const ok = (n, c, d = "") => R.ok(n, c, d);

/* rpID och origin måste peka på testservern, och de måste sättas INNAN
   _admin-passkey.js importeras — rpConfig() läser dem vid anrop, men
   _site.js läser SITE_ORIGIN vid inladdning. En passkey är bunden till sin
   origin: utan det här hade registreringen skett mot exgen.se och
   inloggningen mot 127.0.0.1, och ingenting hade stämt. */
const url = new URL(srv.url);
process.env.PASSKEY_ORIGIN = srv.url;
process.env.PASSKEY_RP_ID = url.hostname;
process.env.PASSKEY_STEPUP_SECRET = HEM;

const PK = await import(ROOT + "/api/_admin-passkey.js");
const SU = await import(ROOT + "/api/_admin-stepup.js");

/* Minneslager med samma gränssnitt som supabaseStore(). Utmaningen raderas i
   takeChallenge, precis som mot databasen. */
function minnesLager() {
  const utmaningar = [];
  const enheter = [];
  return {
    utmaningar, enheter,
    async saveChallenge(userId, kind, challenge, expiresAt) { utmaningar.push({ userId, kind, challenge, expiresAt }); },
    async takeChallenge(userId, kind) {
      const i = utmaningar.findIndex(u => u.userId === userId && u.kind === kind);
      if (i === -1) return null;
      const [u] = utmaningar.splice(i, 1);
      return Date.parse(u.expiresAt) > Date.now() ? u.challenge : null;
    },
    async listCredentials(userId) { return enheter.filter(e => e.user_id === userId); },
    async saveCredential(rad) { enheter.push({ ...rad, created_at: new Date().toISOString(), last_used_at: null }); },
    async touchCredential(userId, credentialId, counter) {
      const e = enheter.find(x => x.credential_id === credentialId);
      if (e) { e.counter = counter; e.last_used_at = new Date().toISOString(); }
    },
    async deleteCredential(userId, credentialId) {
      const i = enheter.findIndex(x => x.credential_id === credentialId);
      if (i !== -1) enheter.splice(i, 1);
    },
  };
}

const store = minnesLager();

const adminRoute = async route => {
  const b = JSON.parse(route.request().postData() || "{}");
  const svar = (status, json) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });

  if (b.action === "passkey-status") {
    return svar(200, { ok: true, konfigurerad: true, rpID: url.hostname,
      enheter: (await store.listCredentials(UID)).map(e => ({ credential_id: e.credential_id, label: e.label, created_at: e.created_at, last_used_at: e.last_used_at })) });
  }
  if (b.action === "passkey-register-begin") {
    return svar(200, { ok: true, options: await PK.beginRegistration(store, UID, "elton@test.se") });
  }
  if (b.action === "passkey-register-finish") {
    const r = await PK.finishRegistration(store, UID, b.response, b.label);
    if (!r.verified) return svar(400, { ok: false, error: r.error });
    return svar(200, { ok: true, stepUp: SU.mintStepUp(UID, { secret: HEM }) });
  }
  if (b.action === "passkey-auth-begin") {
    const o = await PK.beginAuthentication(store, UID);
    if (o.error) return svar(400, { ok: false, error: o.error });
    return svar(200, { ok: true, options: o });
  }
  if (b.action === "passkey-auth-finish") {
    const r = await PK.finishAuthentication(store, UID, b.response);
    if (!r.verified) return svar(400, { ok: false, error: r.error });
    return svar(200, { ok: true, stepUp: SU.mintStepUp(UID, { secret: HEM }) });
  }
  if (b.action === "per-brain") {
    if (!SU.verifyStepUp(b.stepUp, UID, { secret: HEM })) return svar(403, { ok: false, error: "stepup_required" });
    return svar(200, { ok: true, brain: {
      noder: [
        { id: "per-core", etikett: "per-core", typ: "modul", aktivitet: 0.9, senasteTimmen: 42 },
        { id: "per-name", etikett: "per-name", typ: "modul", aktivitet: null, senasteTimmen: null },
        { id: "mastery-view", etikett: "mastery-view", typ: "hjälpare", aktivitet: null, senasteTimmen: null },
        { id: "flagga:per_answer_cache_enabled", etikett: "per_answer_cache_enabled", typ: "flagga", aktivitet: null, senasteTimmen: null },
        { id: "explain", etikett: "explain.js", typ: "rutt", aktivitet: null, senasteTimmen: null },
        { id: "tabell:per_long_memory", etikett: "per_long_memory", typ: "tabell", aktivitet: null, senasteTimmen: null },
      ],
      kanter: [
        { från: "explain", till: "per-core" },
        { från: "explain", till: "per-name" },
        { från: "per-core", till: "mastery-view" },
        { från: "explain", till: "flagga:per_answer_cache_enabled" },
        { från: "per-core", till: "tabell:per_long_memory" },
      ],
    }, hämtad: "2026-08-25T12:00:00.000Z" });
  }
  /* De läsande anropen kräver step-up — samma kontroll som i api/admin.js. */
  if (b.action === "per-registry" || b.action === "per-pulse") {
    if (!SU.verifyStepUp(b.stepUp, UID, { secret: HEM })) return svar(403, { ok: false, error: "stepup_required" });
    if (b.action === "per-registry") {
      return svar(200, { ok: true, registry: {
        moduler: [{ fil: "_per-memory.js", namn: "Långtidsminnet", gör: "Sammanfattar studiemönster.", ser: "Provhistorik.", gräns: "Sparar aldrig namn." }],
        flaggor: [],
      } });
    }
    return svar(200, { ok: true, pulse: {
      minnen: { totalt: 4, färska: 3, gamla: 1 },
      cacheBeslut: { totalt: 2, per: { hit_exact: 0, hit_vector: 0, near_miss: 0, miss: 2, blocked: 0 }, träffkvot: "för få elever än" },
      cacheRader: { pending: 1, approved: 0, rejected: 0, utgångna: 0 },
      kvoter: [{ funktion: "per_chat", använt: 8 }],
      begrepp: "för få elever än",
      hämtad: "2026-08-25T12:00:00.000Z",
    } });
  }
  return svar(400, { ok: false });
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

/* Virtuell autentiserare via CDP. hasUserVerification + isUserVerified gör att
   den beter sig som Face ID: den bekräftar användaren, inte bara närvaro.
   Utan det avvisas svaret av requireUserVerification, vilket är rätt. */
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2", transport: "internal",
    hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  },
});

await mockApis(page, { role: "admin", profiles: { id: "u1", approved: true, role: "admin" }, extra: [["**/api/admin", adminRoute]] });
await seed(page, { role: "admin", user: { id: "u1" } });
await page.goto(`${srv.url}/per.html`, { waitUntil: "networkidle" });

await page.waitForSelector("#registreraBtn", { timeout: 8000 }).catch(() => {});
/* Settle innan mätningen. ladda() gör flera anrop i följd, och utan pausen
   mäts sidan mitt i kedjan — då kan T2 bli grön för att renderingen inte hunnit
   ske än, inte för att den vägrade ske. En sabotageverifiering visade precis
   det: sidan ritade ut data utan step-up och T2 grönade ändå. */
await page.waitForTimeout(600);
const textFöre = await page.evaluate(() => document.body.innerText);
const låstFöre = await page.evaluate(() => ({
  lås: document.getElementById("lasSkarm")?.style.display !== "none",
  poster: document.querySelectorAll("#registret .post").length,
}));

console.log("");
ok("T1 låsskärmen visas innan step-up", låstFöre.lås && /låst|registrera/i.test(textFöre), JSON.stringify(låstFöre));
ok("T2 inga registerdata före step-up",
  låstFöre.poster === 0 && !textFöre.includes("Långtidsminnet"), JSON.stringify(låstFöre));

/* Registrering: sidan anropar navigator.credentials.create(), den virtuella
   autentiseraren signerar, servern verifierar på riktigt. */
await page.click("#registreraBtn");
await page.waitForSelector("#registret .post", { timeout: 15000 }).catch(() => {});
const textEfter = await page.evaluate(() => document.body.innerText);

ok("T3 registreringen lyckades", store.enheter.length === 1, JSON.stringify(store.enheter.map(e => e.label)));
ok("T4 den publika nyckeln sparades som base64url",
  typeof store.enheter[0]?.public_key === "string" && /^[A-Za-z0-9_-]+$/.test(store.enheter[0].public_key));
ok("T5 registret ritas ut efter step-up", textEfter.includes("Långtidsminnet"), textEfter.slice(0, 250));
ok("T6 pulsen ritas ut", /för få elever än/.test(textEfter));

/* Utmaningen ska vara förbrukad. Ligger den kvar går samma signatur att
   spela upp igen, och Apples räknare på 0 skulle inte märka det. */
ok("T7 utmaningen är förbrukad efter registrering", store.utmaningar.length === 0, JSON.stringify(store.utmaningar));

console.log("");
/* Inloggning på en redan registrerad enhet.
   Token måste rensas först: den ligger i sessionStorage och överlever en
   omladdning: sidan hade annars låsts upp direkt utan att fråga efter Face ID,
   och T8–T11 hade mätt den redan upplåsta sidan i stället för upplåsningen.
   Att den överlever är avsiktligt — den dör när fliken stängs. */
await page.evaluate(() => sessionStorage.removeItem("exgen_per_stepup"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#lasUppBtn", { timeout: 8000 }).catch(() => {});
ok("T8 en registrerad enhet erbjuder upplåsning",
  await page.evaluate(() => {
    const b = document.getElementById("lasUppBtn");
    return !!b && b.style.display !== "none";
  }));

await page.click("#lasUppBtn");
await page.waitForSelector("#registret .post", { timeout: 15000 }).catch(() => {});
ok("T9 upplåsning med Face ID ger tillgång",
  (await page.evaluate(() => document.body.innerText)).includes("Långtidsminnet"));
ok("T10 enheten märktes som använd", store.enheter[0].last_used_at !== null);
ok("T11 utmaningen är förbrukad efter inloggning", store.utmaningar.length === 0);

console.log("");
/* Serversidan direkt: en återspelad utmaning måste nekas. */
const igen = await PK.finishAuthentication(store, UID, { id: store.enheter[0].credential_id });
ok("T12 en förbrukad utmaning nekas", igen.verified === false, igen.error);

/* Och en användare utan registrerad enhet får inget att logga in med. */
const främmande = await PK.beginAuthentication(store, "99999999-9999-4999-8999-999999999999");
ok("T13 en användare utan enhet får inget att logga in med", !!främmande.error, JSON.stringify(främmande));

console.log("");
/* T14–T16: vad en främling ser. Servern svarar likadant på "du är inte
   ägaren" som på en action som inte finns, och sidan speglar det svaret.
   Ett felmeddelande, eller ens en låsskärm, hade bekräftat att sidan finns. */
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const sida2 = await ctx2.newPage();
await mockApis(sida2, {
  role: "admin", profiles: { id: "u9", approved: true, role: "admin" },
  // Exakt det svar api/admin.js ger den som inte är ägaren.
  extra: [["**/api/admin", r => r.fulfill({ status: 400, contentType: "application/json", body: '{"ok":false,"error":"Unknown action"}' })]],
});
await seed(sida2, { role: "admin", user: { id: "u9" } });
await sida2.goto(`${srv.url}/per.html`, { waitUntil: "networkidle" });
await sida2.waitForTimeout(600);
/* synlig() måste skilja "finns inte" från "finns men är dold".
   `el?.offsetParent !== null` ger TRUE för ett saknat element — undefined är
   inte null — så ett borttaget element lästes som synligt. T15 blev röd av
   det, på en sida som blivit säkrare. */
const främlingen = await sida2.evaluate(() => {
  const synlig = id => {
    const el = document.getElementById(id);
    return !!el && el.offsetParent !== null;
  };
  return {
    text: document.body.innerText,
    synligt404: synlig("intetSkarm"),
    hero: synlig("hero"),
    lås: synlig("lasSkarm"),
    poster: document.querySelectorAll("#registret .post").length,
    // Byggs markupen alls för en främling? Tom = nej.
    privatTom: (document.getElementById("privat")?.innerHTML || "").trim() === "",
  };
});
ok("T14 en främling ser 404", främlingen.synligt404 && /404|finns inte/i.test(främlingen.text), JSON.stringify(främlingen));
ok("T15 ingen låsskärm avslöjar att sidan finns",
  !främlingen.hero && !främlingen.lås && främlingen.privatTom, JSON.stringify(främlingen));
ok("T16 inga data alls hos en främling",
  främlingen.poster === 0 && !främlingen.text.includes("Långtidsminnet") && !/P\.E\.R/i.test(främlingen.text),
  främlingen.text.slice(0, 200));
/* Sidfoten sa "ExGen — privat sida, ej för obehöriga" även i 404-läget och
   bekräftade därmed precis det den skulle dölja: att sidan finns och är
   privat. Hittades genom att LÄSA testutskriften, inte genom att den blev röd
   — T16:s villkor råkade inte täcka ordet "privat". */
ok("T17 inget i 404-vyn avslöjar att sidan är privat",
  !/privat|obehöriga|minne/i.test(främlingen.text), främlingen.text.slice(0, 260));
await ctx2.close();

console.log("");
/* ── HJÄRNAN ──────────────────────────────────────────────────────────────
   Det viktigaste testet här är T21. En requestAnimationFrame som snurrar i
   evighet på en sida Elton lämnar öppen är en varm telefon och ingen
   information — och det är osynligt i varje annan kontroll. */
const hjärnan = await page.evaluate(async () => {
  const canvas = document.getElementById("hjarna");
  const synlig = id => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
  return {
    finns: !!canvas,
    sektionSynlig: synlig("sektHjarnan"),
    bredd: canvas ? canvas.width : 0,
    text: document.getElementById("hjarnaSub")?.textContent || "",
  };
});
ok("T18 hjärnan ritas ut", hjärnan.finns && hjärnan.sektionSynlig && hjärnan.bredd > 0, JSON.stringify(hjärnan));
ok("T19 antalet noder och kanter står utskrivet",
  /6 noder, 5 kanter, 1 tabell /.test(hjärnan.text), hjärnan.text);

/* En omätt nod ska ritas som kontur, inte som fylld — och klicket ska säga
   "ingen mätpunkt", aldrig visa en nolla som ser ut som en mätning. */
const klick = await page.evaluate(() => {
  const canvas = document.getElementById("hjarna");
  const r = canvas.getBoundingClientRect();
  // Klicka mitt i canvasen träffar sällan; anropa hanteraren med varje nods läge
  // går inte utifrån, så vi läser i stället legenden och infopanelens beteende.
  return {
    legend: document.getElementById("hjarnaLegend")?.textContent || "",
    infoDold: document.getElementById("nodInfo")?.style.display === "none",
    yta: r.width > 0 && r.height > 0,
  };
});
ok("T20 legenden förklarar vad dämpad betyder",
  /ingen mätpunkt/i.test(klick.legend) && klick.yta, JSON.stringify(klick));

/* T21–T23: rörelsekontraktet.
 *
 * Kartan ska ALLTID röra sig — Elton bad om det uttryckligen. Den tidigare
 * versionen stannade när grafen lagt sig, och det fanns ett skäl: en
 * requestAnimationFrame som snurrar i evighet på en öppen flik är en varm
 * telefon och ingen information.
 *
 * Kontraktet är därför bytt, inte borttaget: loopen kör när fliken är SYNLIG
 * och pausar via Page Visibility när den inte är det. Testet nedan mäter båda
 * halvorna. Att bara mäta den första hade gett tillbaka det gamla problemet
 * med en grön bock på.
 */
const rörelse = await page.evaluate(() => new Promise(res => {
  let n = 0;
  const rAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => { n++; return rAF(cb); };
  setTimeout(() => {
    const synlig = n;
    // Låtsas att fliken göms. Playwright kan inte dölja den på riktigt, så
    // hidden överskuggas och samma händelse skickas som webbläsaren skickar.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    const vidPaus = n;
    setTimeout(() => {
      const dold = n - vidPaus;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
      setTimeout(() => res({ synlig, dold, efterÅter: n - vidPaus - dold }), 800);
    }, 800);
  }, 1200);
}));
ok("T21 kartan rör sig hela tiden när fliken syns", rörelse.synlig > 20, JSON.stringify(rörelse));
ok("T22 den pausar när fliken göms", rörelse.dold <= 1, JSON.stringify(rörelse));
ok("T23 den startar igen när fliken syns", rörelse.efterÅter > 5, JSON.stringify(rörelse));

await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
await ctx.close();
await browser.close();
await srv.close();

process.exit(R.finish());
