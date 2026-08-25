# P.E.R:s minnessida, Del B — implementationsplan

> **För agentiska arbetare:** OBLIGATORISK UNDERFÄRDIGHET: använd
> superpowers:subagent-driven-development eller superpowers:executing-plans.
> Stegen använder kryssrutor (`- [ ]`).

**Mål:** Face ID och Touch ID som ett andra lås framför `per.html`, verifierat
på servern.

**Arkitektur:** WebAuthn-flödena ligger i `api/_admin-passkey.js` och arbetar
mot ett litet `store`-gränssnitt, inte mot Supabase direkt — därför går hela
flödet, inklusive engångsutmaningen, att köra i test med ett minneslager och en
riktig virtuell autentiserare. Nyckelhanteringen för step-up-token ligger i
`api/_admin-stepup.js` och är ren HMAC. Sex nya `action` i `api/admin.js`.
Inga nya rutter.

**Teknik:** `@simplewebauthn/server@13`, Node `crypto` (HMAC-SHA256,
`timingSafeEqual`), Supabase `service_role`, Playwrights virtuella
autentiserare via CDP.

**Spec:** `docs/superpowers/specs/2026-08-25-per-minnessida-design.md`

## Globala villkor

- **Funktionstaket är 12 av 12.** Inga nya filer i `api/` utan `_`-prefix.
- **En passkey autentiserar en ENHET, inte en behörighet.** `requireAdmin`
  (`profiles.role === 'admin'`) är och förblir det avgörande gatet. Step-up
  ligger ovanpå och ersätter det aldrig.
- **Utmaningen är engångs och raderas FÖRE verifieringen.** Apples passkeys
  rapporterar alltid signaturräknare 0, så räknaren kan inte upptäcka en
  återspelad signatur — raderingen är det enda som gör det.
- **Fail closed.** Saknas `PASSKEY_STEPUP_SECRET` utfärdas ingen token och
  ingen verifieras. Ingen standardhemlighet, någonsin.
- **Elton kan inte låsa ut sig.** Registrering av en ny enhet kräver bara
  adminroll. Se noten om vad det kostar under "Känd svaghet".
- **Signaturjämförelse med `timingSafeEqual`,** aldrig `===`.
- **Svenska i all skärmtext och alla testnamn.**
- **Sviten körs EFTER commit** — `per.html` ändras och
  `sitemap-lastmod.test.mjs` läser git-datum.
- **Varje test sabotageverifieras, och varje sabotage hävdar att det
  applicerades.** Committa före sabotaget, annars raderar `git checkout` ditt
  eget oskrivna arbete — det hände två gånger i Del A.

## Känd svaghet, medvetet vald

Specen kräver att Elton aldrig kan låsa ut sig. Följden är att registrering av
en ny passkey bara kräver adminroll, inte en befintlig passkey. Någon med en
kapad adminsession kan därför registrera sin egen enhet och ta sig förbi
step-up.

Det är ett verkligt avsteg i styrka, och det mildras men elimineras inte av att
sidan listar varje registrerad enhet med tidpunkt — en tyst registrering blir
åtminstone synlig. Alternativet, att kräva en befintlig passkey för att lägga
till nästa, leder till manuell databasåtgärd den dag båda enheterna försvinner,
vilket specen uttryckligen förbjuder.

Skriv in avvägningen i `CLAUDE.md`. Den som senare vill skärpa låset ska hitta
skälet till att det ser ut så här.

## Filstruktur

| Fil | Ansvar |
|---|---|
| `api/_admin-stepup.js` | Ren HMAC: mynta och verifiera step-up-token. Ingen I/O. |
| `api/_admin-passkey.js` | WebAuthn-flödena mot ett `store`-gränssnitt, plus `supabaseStore()`. |
| `api/admin.js` | Sex nya `action`, och step-up-krav på `per-registry`/`per-pulse`. |
| `per.html` | Låsskärm, base64url-kodning, `navigator.credentials`. |
| `supabase/migrations/20260825_admin_passkeys.sql` (+ `_ROLLBACK`) | Två tabeller, RLS av-för-alla. |
| `tests/api/per-stepup.test.mjs` | Token-enheter + källkodskontrakt. |
| `tests/frontend/per-passkey.test.mjs` | Äkta registrering och inloggning med virtuell autentiserare. |

Varken `_admin-stepup.js` eller `_admin-passkey.js` matchar `api/_per-*.js`,
så registret från Del A berörs inte. Det är avsiktligt: registret beskriver vad
P.E.R. är, och låset är en egenskap hos sidan, inte hos honom.

---

### Task 1: Step-up-token

**Filer:**
- Skapa: `api/_admin-stepup.js`
- Skapa: `tests/api/per-stepup.test.mjs`

**Gränssnitt:**
- Producerar:
  - `STEPUP_TTL_S = 1800`
  - `stepUpSecret() -> string` (`process.env.PASSKEY_STEPUP_SECRET || ""`)
  - `mintStepUp(userId, { secret, now = Date.now() }) -> string` — kastar om
    `secret` är tom.
  - `verifyStepUp(token, userId, { secret, now = Date.now() }) -> boolean`

- [ ] **Steg 1: Skriv det fallerande testet**

Skapa `tests/api/per-stepup.test.mjs`:

```js
// Step-up-token för per.html (api/_admin-stepup.js).
//
// Användning:  node tests/api/per-stepup.test.mjs   (exit 0 = pass)
//
// Token är beviset på att någon nyss visat sitt ansikte eller finger för en
// registrerad enhet. Den säger INTE vem de är — det avgör requireAdmin — utan
// bara att step-up skett nyligen, på den här användaren.
//
// Tre fel vore dyra och tysta:
//   1. en token som fungerar för fel användare
//   2. en token som aldrig går ut
//   3. en signaturjämförelse som läcker tid och därmed går att gissa fram

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const S = await import(join(root, "api", "_admin-stepup.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const HEM = "en hemlighet som bara servern har";
const NU = Date.parse("2026-08-25T12:00:00Z");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

console.log("\n— MYNTA OCH VERIFIERA —");
const token = S.mintStepUp(A, { secret: HEM, now: NU });
check("en färsk token godtas", S.verifyStepUp(token, A, { secret: HEM, now: NU }) === true, token);
check("den godtas strax innan den går ut",
  S.verifyStepUp(token, A, { secret: HEM, now: NU + (S.STEPUP_TTL_S - 1) * 1000 }) === true);

console.log("\n— TOKEN FÖR FEL ANVÄNDARE —");
/* Utan den här kontrollen räcker det att komma över någons token för att läsa
   någon annans sida. Användaridentiteten måste ingå i det som signeras. */
check("A:s token duger inte för B", S.verifyStepUp(token, B, { secret: HEM, now: NU }) === false);
check("tom användare godtas inte", S.verifyStepUp(token, "", { secret: HEM, now: NU }) === false);

console.log("\n— UTGÅNGEN TOKEN —");
check("efter TTL nekas den",
  S.verifyStepUp(token, A, { secret: HEM, now: NU + (S.STEPUP_TTL_S + 1) * 1000 }) === false);
check("TTL är 30 minuter", S.STEPUP_TTL_S === 1800, String(S.STEPUP_TTL_S));

console.log("\n— MANIPULERAD TOKEN —");
const [exp, sig] = token.split(".");
check("ändrad signatur nekas", S.verifyStepUp(`${exp}.${sig.slice(0, -2)}AA`, A, { secret: HEM, now: NU }) === false);
/* Flyttar man fram utgångstiden ändras det signerade meddelandet, så
   signaturen slutar stämma. Går det här igenom är utgångstiden dekoration. */
check("framflyttad utgångstid nekas",
  S.verifyStepUp(`${Number(exp) + 99_000_000}.${sig}`, A, { secret: HEM, now: NU }) === false);
check("skräp nekas", S.verifyStepUp("inte en token", A, { secret: HEM, now: NU }) === false);
check("tom token nekas", S.verifyStepUp("", A, { secret: HEM, now: NU }) === false);
check("annan hemlighet nekas", S.verifyStepUp(token, A, { secret: "fel hemlighet", now: NU }) === false);

console.log("\n— TOKEN LÄCKER INTE ANVÄNDAR-ID —");
/* Den ligger i sessionStorage i klartext. Ett uuid därifrån är i sig inte en
   katastrof, men det finns ingen anledning att lägga det där. */
check("uuid:t står inte i token", !token.includes(A));

console.log("\n— UTAN HEMLIGHET SKA INGET FUNGERA —");
/* Fail closed. En standardhemlighet hade gjort låset till en dekoration som
   ser ut att fungera. */
let kastade = false;
try { S.mintStepUp(A, { secret: "", now: NU }); } catch { kastade = true; }
check("mintStepUp kastar utan hemlighet", kastade);
check("verifyStepUp nekar utan hemlighet", S.verifyStepUp(token, A, { secret: "", now: NU }) === false);

console.log("\n— JÄMFÖRELSEN LÄCKER INTE TID —");
const källa = readFileSync(join(root, "api", "_admin-stepup.js"), "utf8");
check("timingSafeEqual används", /timingSafeEqual/.test(källa));
check("signaturen jämförs inte med ===", !/sig\s*===\s*|===\s*förväntad/.test(källa));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
```

- [ ] **Steg 2: Kör och se att det faller**

Kör: `node tests/api/per-stepup.test.mjs`
Förväntat: `ERR_MODULE_NOT_FOUND` för `_admin-stepup.js`.

- [ ] **Steg 3: Skriv modulen**

Skapa `api/_admin-stepup.js`:

```js
// api/_admin-stepup.js — beviset på att någon nyss klarat Face ID eller Touch ID.
//
// Ren HMAC, ingen I/O, inget beroende. Token säger inte VEM någon är — det
// avgör requireAdmin i api/admin.js — utan bara att step-up skett nyligen och
// att den skett för just den användaren.
//
// FORMAT:  `${utgångstid_ms}.${base64url(HMAC-SHA256(hemlighet, "uid.utgång"))}`
//
// Användar-id:t signeras men skrivs inte ut. Verifieringen räknar om
// signaturen med den ANROPANDE användarens id, så en token som myntats för en
// annan användare kan inte stämma.
//
// FAIL CLOSED: utan PASSKEY_STEPUP_SECRET myntas ingen token och ingen
// godtas. En standardhemlighet hade gjort låset till en dekoration som ser ut
// att fungera.

import { createHmac, timingSafeEqual } from "node:crypto";

/** 30 minuter. Längre gör step-up meningslöst, kortare gör sidan olidlig. */
export const STEPUP_TTL_S = 1800;

export function stepUpSecret() {
  return process.env.PASSKEY_STEPUP_SECRET || "";
}

function signera(userId, expMs, secret) {
  return createHmac("sha256", secret).update(`${userId}.${expMs}`).digest("base64url");
}

export function mintStepUp(userId, { secret = stepUpSecret(), now = Date.now() } = {}) {
  if (!secret) throw new Error("PASSKEY_STEPUP_SECRET saknas");
  if (!userId) throw new Error("userId saknas");
  const expMs = now + STEPUP_TTL_S * 1000;
  return `${expMs}.${signera(userId, expMs, secret)}`;
}

export function verifyStepUp(token, userId, { secret = stepUpSecret(), now = Date.now() } = {}) {
  if (!secret || !userId || typeof token !== "string") return false;

  const delar = token.split(".");
  if (delar.length !== 2) return false;

  const expMs = Number(delar[0]);
  if (!Number.isFinite(expMs) || expMs <= now) return false;

  const förväntad = Buffer.from(signera(userId, delar[0], secret), "utf8");
  const given = Buffer.from(delar[1], "utf8");
  // timingSafeEqual kastar på olika längd, så längden måste kollas först —
  // och den kollen läcker bara signaturens längd, som är konstant.
  if (förväntad.length !== given.length) return false;
  return timingSafeEqual(förväntad, given);
}
```

- [ ] **Steg 4: Kör och se att allt går grönt**

Kör: `node tests/api/per-stepup.test.mjs`
Förväntat: `Allt grönt`, exit 0.

- [ ] **Steg 5: Committa, sedan sabotera**

```bash
git add api/_admin-stepup.js tests/api/per-stepup.test.mjs
git commit -m "feat(per): step-up-token för minnessidan"
```

Skriv sabotaget till en fil och kör det — nedbäddade heredocs citerar sig
sönder i skalet:

```bash
cat > /tmp/sab-stepup.py <<'SLUT'
import io
p = "api/_admin-stepup.js"; s = io.open(p, encoding="utf-8").read()
gammal = "return timingSafeEqual(förväntad, given);"
assert gammal in s, "sabotaget hade tigit: mönstret finns inte"
ut = s.replace(gammal, "return förväntad.equals(given);", 1)
assert "timingSafeEqual(förväntad" not in ut, "sabotaget applicerades inte"
io.open(p, "w", encoding="utf-8").write(ut)
SLUT
python3 /tmp/sab-stepup.py
node tests/api/per-stepup.test.mjs   # FAIL: "timingSafeEqual används"
git checkout api/_admin-stepup.js
```

Ett andra sabotage, mot det farligaste felet — att användaren inte signeras:

```bash
cat > /tmp/sab-uid.py <<'SLUT'
import io
p = "api/_admin-stepup.js"; s = io.open(p, encoding="utf-8").read()
gammal = '.update(`${userId}.${expMs}`)'
assert gammal in s, "sabotaget hade tigit: mönstret finns inte"
ut = s.replace(gammal, '.update(`${expMs}`)', 1)
assert gammal not in ut, "sabotaget applicerades inte"
io.open(p, "w", encoding="utf-8").write(ut)
SLUT
python3 /tmp/sab-uid.py
node tests/api/per-stepup.test.mjs   # FAIL: "A:s token duger inte för B"
git checkout api/_admin-stepup.js
```

---

### Task 2: WebAuthn-flödena

**Filer:**
- Skapa: `api/_admin-passkey.js`
- Ändra: `package.json` — `@simplewebauthn/server` som beroende

**Gränssnitt:**
- Konsumerar: `@simplewebauthn/server@13` —
  `generateRegistrationOptions({ rpName, rpID, userName, authenticatorSelection })`,
  `verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID })`
  som ger `{ verified, registrationInfo: { credential: { id, publicKey: Uint8Array, counter, transports } } }`,
  `generateAuthenticationOptions({ rpID, allowCredentials, userVerification })`,
  `verifyAuthenticationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID, credential })`
  som ger `{ verified, authenticationInfo: { newCounter } }`.
- Producerar:
  - `CHALLENGE_TTL_S = 120`
  - `rpConfig() -> { rpID, origin, rpName }`
  - `supabaseStore(supabase) -> Store`
  - `Store` = `{ saveChallenge(userId, kind, challenge, expiresAt), takeChallenge(userId, kind), listCredentials(userId), saveCredential(rad), touchCredential(userId, credentialId, counter), deleteCredential(userId, credentialId) }`
  - `beginRegistration(store, userId, userName) -> optionsJSON`
  - `finishRegistration(store, userId, response, label) -> { verified }`
  - `beginAuthentication(store, userId) -> optionsJSON`
  - `finishAuthentication(store, userId, response) -> { verified }`

`store` är ett gränssnitt och inte en Supabase-klient med flit: hela flödet,
inklusive att utmaningen bara går att använda en gång, körs i test mot ett
minneslager med en riktig virtuell autentiserare. Utan den uppdelningen hade
den delen bara gått att kontrollera genom att läsa koden.

- [ ] **Steg 1: Lägg till beroendet**

```bash
npm install --no-audit --no-fund @simplewebauthn/server@13.3.2
```

Repot hade fram till nu ett enda runtime-beroende. Skälet till det här är att
WebAuthn-verifiering betyder CBOR-avkodning, COSE-nyckeltolkning och
signaturverifiering — kod som går sönder tyst och ser ut att fungera. En egen
implementation som godtar en ogiltig signatur ger inget felmeddelande; den
släpper bara in.

- [ ] **Steg 2: Skriv modulen**

Skapa `api/_admin-passkey.js`:

```js
// api/_admin-passkey.js — Face ID och Touch ID för per.html.
//
// Flödena arbetar mot ett `store`-gränssnitt, inte mot Supabase direkt. Därför
// går hela kedjan — inklusive att en utmaning bara får användas en gång — att
// köra i test mot ett minneslager och en riktig virtuell autentiserare.
//
// EN PASSKEY AUTENTISERAR EN ENHET, INTE EN BEHÖRIGHET.
// requireAdmin i api/admin.js avgör vem som får läsa. Det här lagret avgör
// bara om begäran kommer från en enhet Elton registrerat, vars ägare nyss
// identifierat sig biometriskt. Ordningen är inte utbytbar.
//
// UTMANINGEN RADERAS FÖRE VERIFIERINGEN, och det är inte en detalj: Apples
// passkeys rapporterar alltid signaturräknare 0, så räknaren kan inte upptäcka
// en återspelad signatur. Engångsutmaningen är det enda som gör det.

import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { SITE_ORIGIN, BRAND_NAME } from "./_site.js";

/** Två minuter. Längre ger en angripare mer tid; kortare hinner inte en
    användare som får leta efter sin telefon. */
export const CHALLENGE_TTL_S = 120;

/* Passkeys är bundna till sin rpID. En som registrerats på exgen.se fungerar
   inte på en Vercel-preview och inte på localhost — därför en egen
   miljövariabel, så att previews och tester kan köra mot sin egen origin utan
   att röra produktionens. */
export function rpConfig() {
  const origin = process.env.PASSKEY_ORIGIN || SITE_ORIGIN;
  const rpID = process.env.PASSKEY_RP_ID || new URL(origin).hostname;
  return { rpID, origin, rpName: BRAND_NAME };
}

export function supabaseStore(supabase) {
  return {
    async saveChallenge(userId, kind, challenge, expiresAt) {
      await supabase.from("admin_passkey_challenges").delete().lt("expires_at", new Date().toISOString());
      await supabase.from("admin_passkey_challenges")
        .insert({ user_id: userId, kind, challenge, expires_at: expiresAt });
    },
    async takeChallenge(userId, kind) {
      const { data } = await supabase.from("admin_passkey_challenges")
        .select("id, challenge, expires_at")
        .eq("user_id", userId).eq("kind", kind)
        .order("expires_at", { ascending: false }).limit(1);
      const rad = data?.[0];
      if (!rad) return null;
      // Radera FÖRE verifieringen. Se filhuvudet.
      await supabase.from("admin_passkey_challenges").delete().eq("id", rad.id);
      if (Date.parse(rad.expires_at) <= Date.now()) return null;
      return rad.challenge;
    },
    async listCredentials(userId) {
      const { data } = await supabase.from("admin_passkeys")
        .select("credential_id, public_key, counter, transports, label, created_at, last_used_at")
        .eq("user_id", userId).order("created_at", { ascending: true });
      return data || [];
    },
    async saveCredential(rad) {
      await supabase.from("admin_passkeys").insert(rad);
    },
    async touchCredential(userId, credentialId, counter) {
      await supabase.from("admin_passkeys")
        .update({ counter, last_used_at: new Date().toISOString() })
        .eq("user_id", userId).eq("credential_id", credentialId);
    },
    async deleteCredential(userId, credentialId) {
      await supabase.from("admin_passkeys").delete()
        .eq("user_id", userId).eq("credential_id", credentialId);
    },
  };
}

const utgång = () => new Date(Date.now() + CHALLENGE_TTL_S * 1000).toISOString();

export async function beginRegistration(store, userId, userName) {
  const { rpID, rpName } = rpConfig();
  const befintliga = await store.listCredentials(userId);
  const options = await generateRegistrationOptions({
    rpName, rpID,
    userName: userName || "admin",
    // Hindrar att samma enhet registreras två gånger och lämnar en död rad.
    excludeCredentials: befintliga.map(c => ({ id: c.credential_id })),
    authenticatorSelection: {
      // Face ID och Touch ID sitter i enheten, inte i en nyckelbricka.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      // Biometrin är hela poängen. "preferred" hade tillåtit en enhet som
      // bara bevisar närvaro, och då är låset ett knapptryck.
      userVerification: "required",
    },
  });
  await store.saveChallenge(userId, "register", options.challenge, utgång());
  return options;
}

export async function finishRegistration(store, userId, response, label) {
  const { rpID, origin } = rpConfig();
  const challenge = await store.takeChallenge(userId, "register");
  if (!challenge) return { verified: false, error: "utmaningen saknas eller har gått ut" };

  const res = await verifyRegistrationResponse({
    response, expectedChallenge: challenge,
    expectedOrigin: origin, expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!res.verified) return { verified: false, error: "signaturen godtogs inte" };

  const c = res.registrationInfo.credential;
  await store.saveCredential({
    user_id: userId,
    credential_id: c.id,
    // base64url-text, inte bytea: PostgREST lämnar bytea som \x-hex och den
    // konverteringen är ett extra felläge utan vinst.
    public_key: Buffer.from(c.publicKey).toString("base64url"),
    counter: c.counter,
    transports: c.transports || null,
    label: String(label || "").slice(0, 60) || "Okänd enhet",
  });
  return { verified: true };
}

export async function beginAuthentication(store, userId) {
  const { rpID } = rpConfig();
  const kända = await store.listCredentials(userId);
  if (!kända.length) return { error: "ingen enhet registrerad" };
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: kända.map(c => ({ id: c.credential_id, transports: c.transports || undefined })),
    userVerification: "required",
  });
  await store.saveChallenge(userId, "auth", options.challenge, utgång());
  return options;
}

export async function finishAuthentication(store, userId, response) {
  const { rpID, origin } = rpConfig();
  const challenge = await store.takeChallenge(userId, "auth");
  if (!challenge) return { verified: false, error: "utmaningen saknas eller har gått ut" };

  const kända = await store.listCredentials(userId);
  const rad = kända.find(c => c.credential_id === response?.id);
  if (!rad) return { verified: false, error: "okänd enhet" };

  const res = await verifyAuthenticationResponse({
    response, expectedChallenge: challenge,
    expectedOrigin: origin, expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: rad.credential_id,
      publicKey: Buffer.from(rad.public_key, "base64url"),
      counter: rad.counter,
      transports: rad.transports || undefined,
    },
  });
  if (!res.verified) return { verified: false, error: "signaturen godtogs inte" };

  await store.touchCredential(userId, rad.credential_id, res.authenticationInfo.newCounter);
  return { verified: true };
}
```

- [ ] **Steg 3: Committa**

```bash
git add api/_admin-passkey.js package.json package-lock.json
git commit -m "feat(per): WebAuthn-flödena mot ett store-gränssnitt"
```

Testet för den här modulen ligger i Task 4, som kör den mot en riktig virtuell
autentiserare. Ett rent enhetstest med påhittade signaturer hade bara mätt att
biblioteket säger nej till skräp — inte att flödet fungerar.

---

### Task 3: Anropen och gatet i admin.js

**Filer:**
- Ändra: `api/admin.js`

**Gränssnitt:**
- Konsumerar: `_admin-stepup.js` och `_admin-passkey.js` från Task 1 och 2.
- Producerar, alla `POST /api/admin`, alla bakom `requireAdmin`:
  - `{ action: "passkey-status" }` → `{ ok, konfigurerad, enheter: [{ credential_id, label, created_at, last_used_at }] }`
  - `{ action: "passkey-register-begin" }` → `{ ok, options }`
  - `{ action: "passkey-register-finish", response, label }` → `{ ok, stepUp }`
  - `{ action: "passkey-auth-begin" }` → `{ ok, options }`
  - `{ action: "passkey-auth-finish", response }` → `{ ok, stepUp }`
  - `{ action: "passkey-delete", credentialId }` → `{ ok }` — kräver step-up
  - `per-registry` och `per-pulse` kräver nu step-up i `body.stepUp`

- [ ] **Steg 1: Importera**

Under de befintliga importerna i `api/admin.js`:

```js
import { mintStepUp, verifyStepUp, stepUpSecret } from "./_admin-stepup.js";
import {
  supabaseStore, beginRegistration, finishRegistration,
  beginAuthentication, finishAuthentication, rpConfig,
} from "./_admin-passkey.js";
```

- [ ] **Steg 2: Lägg till hjälparen**

Direkt efter `requireAdmin`-funktionen i `api/admin.js`:

```js
/* Step-up är ett ANDRA lager. requireAdmin har redan avgjort behörigheten när
   den här körs; det här avgör bara om begäran kommer från en enhet som nyss
   klarat Face ID eller Touch ID.
   Saknas hemligheten svarar vi 503 med ett namngivet fel — inte 403. Ett
   konfigurationsfel som ser ut som ett behörighetsfel skickar felsökningen åt
   fel håll. */
async function requireStepUp(req, res, user) {
  if (!stepUpSecret()) {
    res.status(503).json({ ok: false, error: "stepup_unconfigured" });
    return false;
  }
  if (!verifyStepUp(req.body?.stepUp, user.id)) {
    res.status(403).json({ ok: false, error: "stepup_required" });
    return false;
  }
  return true;
}
```

- [ ] **Steg 3: Sätt gatet på de två läsande anropen**

I `per-registry` och `per-pulse`, byt raden `if (!await requireAdmin(req, res)) return;` mot:

```js
    const user = await requireAdmin(req, res);
    if (!user) return;
    if (!await requireStepUp(req, res, user)) return;
```

- [ ] **Steg 4: Lägg till de sex passkey-anropen**

Före `return res.status(400).json({ ok: false, error: "Unknown action" });`:

```js
  /* ── Face ID / Touch ID ──────────────────────────────────────────────────
     Registrering kräver BARA adminroll, inte en befintlig passkey. Det är ett
     medvetet avsteg i styrka: specen kräver att Elton aldrig kan låsa ut sig,
     och kravet på en befintlig passkey leder till manuell databasåtgärd den
     dag båda enheterna försvinner. Priset är att någon med en kapad
     adminsession kan registrera sin egen enhet. Det mildras av att sidan
     listar varje enhet med tidpunkt — en tyst registrering blir synlig. */

  if (action === "passkey-status") {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const enheter = await supabaseStore(supabase).listCredentials(user.id);
    return res.status(200).json({
      ok: true,
      konfigurerad: !!stepUpSecret(),
      rpID: rpConfig().rpID,
      enheter: enheter.map(e => ({
        credential_id: e.credential_id, label: e.label,
        created_at: e.created_at, last_used_at: e.last_used_at,
      })),
    });
  }

  if (action === "passkey-register-begin") {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const options = await beginRegistration(supabaseStore(supabase), user.id, user.email);
    return res.status(200).json({ ok: true, options });
  }

  if (action === "passkey-register-finish") {
    const user = await requireAdmin(req, res);
    if (!user) return;
    if (!stepUpSecret()) return res.status(503).json({ ok: false, error: "stepup_unconfigured" });
    const r = await finishRegistration(supabaseStore(supabase), user.id, req.body?.response, req.body?.label);
    if (!r.verified) return res.status(400).json({ ok: false, error: r.error });
    // Registreringen krävde userVerification, så biometrin är redan avklarad.
    return res.status(200).json({ ok: true, stepUp: mintStepUp(user.id) });
  }

  if (action === "passkey-auth-begin") {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const options = await beginAuthentication(supabaseStore(supabase), user.id);
    if (options.error) return res.status(400).json({ ok: false, error: options.error });
    return res.status(200).json({ ok: true, options });
  }

  if (action === "passkey-auth-finish") {
    const user = await requireAdmin(req, res);
    if (!user) return;
    if (!stepUpSecret()) return res.status(503).json({ ok: false, error: "stepup_unconfigured" });
    const r = await finishAuthentication(supabaseStore(supabase), user.id, req.body?.response);
    if (!r.verified) return res.status(400).json({ ok: false, error: r.error });
    return res.status(200).json({ ok: true, stepUp: mintStepUp(user.id) });
  }

  if (action === "passkey-delete") {
    const user = await requireAdmin(req, res);
    if (!user) return;
    // Kräver step-up: annars kunde en kapad session tyst radera Eltons enhet.
    if (!await requireStepUp(req, res, user)) return;
    await supabaseStore(supabase).deleteCredential(user.id, String(req.body?.credentialId || ""));
    return res.status(200).json({ ok: true });
  }
```

- [ ] **Steg 5: Lägg till källkodskontrakten i steg-up-testet**

Lägg sist i `tests/api/per-stepup.test.mjs`, före utskriften av resultatet:

```js
console.log("\n— GATET I admin.js —");
const admin = readFileSync(join(root, "api", "admin.js"), "utf8");
const block = a => {
  const i = admin.indexOf(`action === "${a}"`);
  return i === -1 ? "" : admin.slice(i, i + 1400);
};
for (const a of ["per-registry", "per-pulse", "passkey-delete"]) {
  check(`${a} kräver step-up`, /requireStepUp/.test(block(a)), a);
}
/* Registrering får INTE kräva step-up — då kan en tappad enhet inte ersättas
   utan databasåtgärd, vilket specen förbjuder. */
check("registrering kräver inte step-up", !/requireStepUp/.test(block("passkey-register-begin")));
check("varje passkey-anrop går genom requireAdmin",
  ["passkey-status", "passkey-register-begin", "passkey-register-finish",
   "passkey-auth-begin", "passkey-auth-finish", "passkey-delete"]
    .every(a => /requireAdmin/.test(block(a))));
/* Ett konfigurationsfel som svarar 403 skickar felsökningen åt fel håll. */
check("saknad hemlighet ger 503, inte 403", /stepup_unconfigured/.test(admin) && /503/.test(admin));
check("biometri krävs, inte bara närvaro",
  /userVerification:\s*"required"/.test(readFileSync(join(root, "api", "_admin-passkey.js"), "utf8")));
check("utmaningen raderas före verifieringen",
  /Radera FÖRE verifieringen|delete\(\)[\s\S]{0,80}eq\("id", rad\.id\)/.test(
    readFileSync(join(root, "api", "_admin-passkey.js"), "utf8")));
```

- [ ] **Steg 6: Kör, kontrollera taket, committa**

```bash
node tests/api/per-stepup.test.mjs        # Allt grönt
ls api/*.js | grep -v '/_' | wc -l        # 12
node --input-type=module -e "try{await import('./api/admin.js')}catch(e){console.log('parse-ok:',e.message.split('\n')[0])}"
git add api/admin.js tests/api/per-stepup.test.mjs
git commit -m "feat(per): step-up krävs för att läsa registret och pulsen"
```

- [ ] **Steg 7: Sabotera gatet**

```bash
cat > /tmp/sab-gate.py <<'SLUT'
import io
p = "api/admin.js"; s = io.open(p, encoding="utf-8").read()
i = s.index('action === "per-pulse"')
j = s.index("requireStepUp", i)
ut = s[:j] + "requireAdmin" + s[j + len("requireStepUp"):]
assert ut != s, "sabotaget applicerades inte"
io.open(p, "w", encoding="utf-8").write(ut)
SLUT
python3 /tmp/sab-gate.py
node tests/api/per-stepup.test.mjs   # FAIL: "per-pulse kräver step-up"
git checkout api/admin.js
```

---

### Task 4: Sidan och den virtuella autentiseraren

**Filer:**
- Ändra: `per.html`
- Skapa: `tests/frontend/per-passkey.test.mjs`

**Gränssnitt:**
- Konsumerar: de sex anropen från Task 3, och `beginRegistration` /
  `finishRegistration` / `beginAuthentication` / `finishAuthentication` från
  Task 2, som testet kör mot ett minneslager.
- Producerar: inget som senare uppgifter läser.

- [ ] **Steg 1: Skriv testet**

Skapa `tests/frontend/per-passkey.test.mjs`:

```js
import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
// Face ID och Touch ID på per.html (Del B).
//
// Användning:  node tests/frontend/per-passkey.test.mjs
//
// Det här testet mockar INTE WebAuthn. Chromium får en virtuell autentiserare
// via CDP som gör riktiga signaturer, och serversidan är de riktiga
// funktionerna ur api/_admin-passkey.js körda mot ett minneslager. Det som
// mätas är alltså hela kedjan: sidans base64url-kodning, bibliotekets
// verifiering, och att en utmaning bara går att använda en gång.
//
// Ett test som mockar navigator.credentials hade bevisat att sidan anropar en
// funktion — inte att låset håller.

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const PK = await import(ROOT + "/api/_admin-passkey.js");
const SU = await import(ROOT + "/api/_admin-stepup.js");

const HEM = "testhemlighet";
const UID = "11111111-1111-4111-8111-111111111111";

const srv = await serve(ROOT, { indexFile: "per.html" });
const R = report("per-passkey");
const ok = (n, c, d = "") => R.ok(n, c, d);

/* rpID och origin måste peka på testservern. En passkey är bunden till sin
   origin — utan det här hade registreringen skett mot exgen.se och
   inloggningen mot localhost, och ingenting hade stämt. */
const url = new URL(srv.url);
process.env.PASSKEY_ORIGIN = srv.url;
process.env.PASSKEY_RP_ID = url.hostname;
process.env.PASSKEY_STEPUP_SECRET = HEM;

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
let stepUpUtfärdad = null;
const anropsLogg = [];

const adminRoute = async route => {
  const b = JSON.parse(route.request().postData() || "{}");
  anropsLogg.push(b.action);
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
    stepUpUtfärdad = SU.mintStepUp(UID, { secret: HEM });
    return svar(200, { ok: true, stepUp: stepUpUtfärdad });
  }
  if (b.action === "passkey-auth-begin") {
    const o = await PK.beginAuthentication(store, UID);
    if (o.error) return svar(400, { ok: false, error: o.error });
    return svar(200, { ok: true, options: o });
  }
  if (b.action === "passkey-auth-finish") {
    const r = await PK.finishAuthentication(store, UID, b.response);
    if (!r.verified) return svar(400, { ok: false, error: r.error });
    stepUpUtfärdad = SU.mintStepUp(UID, { secret: HEM });
    return svar(200, { ok: true, stepUp: stepUpUtfärdad });
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

/* Virtuell autentiserare via CDP. hasUV + isUserVerified gör att den beter sig
   som Face ID: den bekräftar användaren, inte bara närvaro. */
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});

await mockApis(page, { role: "admin", profiles: { id: "u1", approved: true, role: "admin" }, extra: [["**/api/admin", adminRoute]] });
await seed(page, { role: "admin", user: { id: "u1" } });
await page.goto(`${srv.url}/per.html`, { waitUntil: "networkidle" });

await page.waitForSelector("#lasSkarm", { timeout: 8000 }).catch(() => {});
const textFöre = await page.evaluate(() => document.body.innerText);

console.log("");
ok("T1 låsskärmen visas innan step-up", /registrera|lås|face id|touch id/i.test(textFöre), textFöre.slice(0, 160));
ok("T2 inga registerdata före step-up", !textFöre.includes("Långtidsminnet"));

/* Registrering: sidan anropar navigator.credentials.create(), den virtuella
   autentiseraren signerar, servern verifierar på riktigt. */
await page.click("#registreraBtn");
await page.waitForSelector("#registret .post", { timeout: 15000 }).catch(() => {});
const textEfter = await page.evaluate(() => document.body.innerText);

ok("T3 registreringen lyckades", store.enheter.length === 1, JSON.stringify(store.enheter.map(e => e.label)));
ok("T4 den publika nyckeln sparades som base64url",
  typeof store.enheter[0]?.public_key === "string" && /^[A-Za-z0-9_-]+$/.test(store.enheter[0].public_key));
ok("T5 registret ritas ut efter step-up", textEfter.includes("Långtidsminnet"), textEfter.slice(0, 200));
ok("T6 pulsen ritas ut", /för få elever än/.test(textEfter));

/* Utmaningen ska vara förbrukad. Ligger den kvar går samma signatur att
   spela upp igen, och Apples räknare på 0 skulle inte märka det. */
ok("T7 utmaningen är förbrukad efter registrering", store.utmaningar.length === 0, JSON.stringify(store.utmaningar));

console.log("");
/* Inloggning på en redan registrerad enhet: ladda om och lås upp. */
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#lasUppBtn", { timeout: 8000 }).catch(() => {});
ok("T8 en registrerad enhet erbjuder upplåsning, inte registrering",
  await page.evaluate(() => !!document.getElementById("lasUppBtn")));

await page.click("#lasUppBtn");
await page.waitForSelector("#registret .post", { timeout: 15000 }).catch(() => {});
ok("T9 upplåsning med Face ID ger tillgång",
  (await page.evaluate(() => document.body.innerText)).includes("Långtidsminnet"));
ok("T10 räknaren uppdaterades", store.enheter[0].last_used_at !== null);
ok("T11 utmaningen är förbrukad efter inloggning", store.utmaningar.length === 0);

console.log("");
/* Serversidan direkt: en återspelad utmaning måste nekas. */
const igen = await PK.finishAuthentication(store, UID, { id: store.enheter[0].credential_id });
ok("T12 en förbrukad utmaning nekas", igen.verified === false, igen.error);

/* Och en okänd användare kommer inte åt någon enhet. */
const främmande = await PK.beginAuthentication(store, "99999999-9999-4999-8999-999999999999");
ok("T13 en användare utan enhet får inget att logga in med", !!främmande.error, JSON.stringify(främmande));

await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
await ctx.close();
await browser.close();
await srv.close();

process.exit(R.finish());
```

- [ ] **Steg 2: Kör och se att det faller**

Kör: `node tests/frontend/per-passkey.test.mjs`
Förväntat: T1, T3, T5 och framåt faller — `per.html` har ingen låsskärm än.

- [ ] **Steg 3: Bygg låsskärmen i per.html**

Lägg in i `<main><div class="wrap">`, direkt efter `pageHero` och före
`<section class="sekt">`:

```html
  <div id="lasSkarm" class="post" style="margin-bottom:32px">
    <p class="postNamn">Sidan är låst</p>
    <p class="postFalt" id="lasText">Kontrollerar…</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn" id="lasUppBtn" style="display:none">Lås upp med Face ID / Touch ID</button>
      <button class="btn" id="registreraBtn" style="display:none">Registrera den här enheten</button>
    </div>
  </div>

  <div id="enheter" class="rutnat" style="margin-bottom:32px"></div>
```

Lägg till i `<style>`:

```css
  .enhetRad{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .taBort{padding:4px 10px;border-radius:var(--r2);border:1px solid var(--l2);background:transparent;color:var(--t3);font-family:var(--mono);font-size:10.5px;cursor:pointer}
  .taBort:hover{color:var(--t);border-color:var(--l)}
```

- [ ] **Steg 4: Skriv klientkoden i per.html**

Ersätt `ladda()` och dess anrop längst ner i `<script>` med:

```js
/* WebAuthn talar ArrayBuffer, JSON talar base64url. De här två gör
   översättningen. Skrivna för hand med flit: alternativet är ett andra
   CDN-beroende för trettio rader kod, och PublicKeyCredential.toJSON() finns
   inte i alla webbläsare Elton kan råka använda. */
const b64urlTillBuf = s => {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
};
const bufTillB64url = b => {
  const u = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/* Step-up-token lever i sessionStorage, inte localStorage: den ska dö när
   fliken stängs. Servern verifierar den ändå — det här är bekvämlighet, inte
   skydd. */
const STEPUP_NYCKEL = 'exgen_per_stepup';
const hamtaStepUp = () => sessionStorage.getItem(STEPUP_NYCKEL) || '';
const sparaStepUp = t => sessionStorage.setItem(STEPUP_NYCKEL, t);

async function anropa(action, extra) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify(Object.assign({ action, stepUp: hamtaStepUp() }, extra || {})),
  });
  const json = await res.json().catch(() => null);
  return json ? Object.assign({ _status: res.status }, json) : null;
}

async function registrera() {
  const r = await anropa('passkey-register-begin');
  if (!r || !r.ok) return visaFel(r);
  const o = r.options;
  const cred = await navigator.credentials.create({ publicKey: Object.assign({}, o, {
    challenge: b64urlTillBuf(o.challenge),
    user: Object.assign({}, o.user, { id: b64urlTillBuf(o.user.id) }),
    excludeCredentials: (o.excludeCredentials || []).map(c => Object.assign({}, c, { id: b64urlTillBuf(c.id) })),
  }) });
  const svar = {
    id: cred.id, rawId: bufTillB64url(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufTillB64url(cred.response.clientDataJSON),
      attestationObject: bufTillB64url(cred.response.attestationObject),
      transports: cred.response.getTransports ? cred.response.getTransports() : [],
    },
  };
  const f = await anropa('passkey-register-finish', { response: svar, label: enhetsNamn() });
  if (!f || !f.ok) return visaFel(f);
  sparaStepUp(f.stepUp);
  await ladda();
}

async function lasUpp() {
  const r = await anropa('passkey-auth-begin');
  if (!r || !r.ok) return visaFel(r);
  const o = r.options;
  const cred = await navigator.credentials.get({ publicKey: Object.assign({}, o, {
    challenge: b64urlTillBuf(o.challenge),
    allowCredentials: (o.allowCredentials || []).map(c => Object.assign({}, c, { id: b64urlTillBuf(c.id) })),
  }) });
  const svar = {
    id: cred.id, rawId: bufTillB64url(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufTillB64url(cred.response.clientDataJSON),
      authenticatorData: bufTillB64url(cred.response.authenticatorData),
      signature: bufTillB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? bufTillB64url(cred.response.userHandle) : undefined,
    },
  };
  const f = await anropa('passkey-auth-finish', { response: svar });
  if (!f || !f.ok) return visaFel(f);
  sparaStepUp(f.stepUp);
  await ladda();
}

function enhetsNamn() {
  const p = navigator.platform || '';
  return (/iPhone|iPad/.test(p) ? 'iPhone/iPad' : /Mac/.test(p) ? 'Mac' : 'Enhet') +
    ' · ' + new Date().toLocaleDateString('sv-SE');
}

function visaFel(r) {
  const t = document.getElementById('lasText');
  if (r && r.error === 'stepup_unconfigured') {
    t.textContent = 'PASSKEY_STEPUP_SECRET är inte satt i Vercel. Låset kan inte utfärda något bevis förrän den finns — det är avsiktligt, inte ett fel att kringgå.';
    return;
  }
  t.textContent = 'Det gick inte: ' + ((r && r.error) || 'inget svar från servern') + '.';
}

function ritaEnheter(enheter) {
  document.getElementById('enheter').innerHTML = (enheter || []).map(e => `<div class="post">
    <div class="enhetRad">
      <div>
        <p class="postNamn">${esc(e.label)}</p>
        <p class="postFil">registrerad ${new Date(e.created_at).toLocaleString('sv-SE')}${e.last_used_at ? ' · senast använd ' + new Date(e.last_used_at).toLocaleString('sv-SE') : ' · aldrig använd'}</p>
      </div>
      <button class="taBort" data-id="${esc(e.credential_id)}">Ta bort</button>
    </div>
  </div>`).join('');
  document.querySelectorAll('.taBort').forEach(b => b.addEventListener('click', async () => {
    await anropa('passkey-delete', { credentialId: b.dataset.id });
    await ladda();
  }));
}

async function ladda() {
  const status = document.getElementById('status');
  const lasText = document.getElementById('lasText');
  const lasSkarm = document.getElementById('lasSkarm');
  const lasUppBtn = document.getElementById('lasUppBtn');
  const registreraBtn = document.getElementById('registreraBtn');

  const st = await anropa('passkey-status');
  if (!st || !st.ok) {
    status.textContent = 'Ingen åtkomst. Sidan kräver ett adminkonto — gatet ligger på servern, inte här.';
    lasText.textContent = 'Du är inte inloggad som admin.';
    return;
  }
  ritaEnheter(st.enheter);

  if (!st.konfigurerad) { visaFel({ error: 'stepup_unconfigured' }); return; }

  const har = (st.enheter || []).length > 0;
  lasUppBtn.style.display = har ? '' : 'none';
  registreraBtn.style.display = '';
  lasText.textContent = har
    ? 'Registret och pulsen visas när du bekräftat med Face ID eller Touch ID.'
    : 'Ingen enhet är registrerad än. Registrera den här enheten för att låsa upp sidan.';

  const reg = await anropa('per-registry');
  if (!reg || !reg.ok) return;

  /* Först här är sidan upplåst. Data har inte legat i en dold div — servern
     vägrade svara tills step-up var på plats. */
  lasSkarm.style.display = 'none';
  status.textContent = 'Registret beskrivs i api/_per-registry.js och bevakas av tests/per/per-registry.test.mjs, som faller om en modul saknar post eller en post saknar modul.';
  document.getElementById('registret').innerHTML =
    [...reg.registry.moduler, ...reg.registry.flaggor].map(ritaPost).join('');

  const p = await anropa('per-pulse');
  if (!p || !p.ok) return;
  ritaPuls(p.pulse);
}

document.getElementById('lasUppBtn').addEventListener('click', lasUpp);
document.getElementById('registreraBtn').addEventListener('click', registrera);
ladda();
```

Bryt ut den befintliga pulsritningen ur gamla `ladda()` till `ritaPuls(d)` med
oförändrad kropp — den koden är redan testad av
`tests/frontend/per-sida.test.mjs` och ska inte ändras, bara flyttas.

- [ ] **Steg 5: Kör båda sidtesterna**

```bash
node tests/frontend/per-passkey.test.mjs   # 13 ok, 0 fail
node tests/frontend/per-sida.test.mjs      # ska fortfarande vara grön
```

`per-sida.test.mjs` mockar `/api/admin` utan `passkey-status` och får därför
`{ok:false}` på det anropet — uppdatera dess mock så att den svarar
`{ ok: true, konfigurerad: true, enheter: [] }` och skickar en giltig
`stepUp`-token, annars mäter den låsskärmen i stället för sidan. Det är samma
fälla som _harness.mjs-kommentaren beskriver: en rigg som mäter fel yta ger
gröna kontroller som inte betyder något.

- [ ] **Steg 6: Committa, sedan sabotera**

```bash
git add per.html tests/frontend/per-passkey.test.mjs tests/frontend/per-sida.test.mjs
git commit -m "feat(per): Face ID och Touch ID framför registret och pulsen"

cat > /tmp/sab-klient.py <<'SLUT'
import io
p = "per.html"; s = io.open(p, encoding="utf-8").read()
gammal = "lasSkarm.style.display = 'none';"
assert gammal in s, "sabotaget hade tigit: mönstret finns inte"
ut = s.replace("const reg = await anropa('per-registry');", "const reg = { ok: true, registry: { moduler: [{ fil: 'x', namn: 'Långtidsminnet', 'gör': 'a', ser: 'b', 'gräns': 'c' }], flaggor: [] } };", 1)
assert ut != s, "sabotaget applicerades inte"
io.open(p, "w", encoding="utf-8").write(ut)
SLUT
python3 /tmp/sab-klient.py
node tests/frontend/per-passkey.test.mjs   # FAIL på T2: data syns före step-up
git checkout per.html
```

---

### Task 5: Migrationen

**Filer:**
- Skapa: `supabase/migrations/20260825_admin_passkeys.sql`
- Skapa: `supabase/migrations/20260825_admin_passkeys_ROLLBACK.sql`

- [ ] **Steg 1: Skriv migrationen**

```sql
-- admin_passkeys — Face ID och Touch ID framför per.html.
--
-- Två tabeller, båda helt oåtkomliga för klienter. Servern läser dem med
-- service_role; ingen policy finns eftersom ingen roll ska kunna nå dem alls.
--
-- VARFÖR public_key ÄR text OCH INTE bytea
-- PostgREST lämnar bytea som en \x-prefixad hexsträng, och konverteringen fram
-- och tillbaka är ett extra felläge utan vinst. Nyckeln lagras därför som
-- base64url-text, precis som den ser ut i WebAuthn-svaret.
--
-- VARFÖR UTMANINGARNA HAR EN EGEN TABELL
-- En utmaning måste kunna användas exakt en gång. Apples passkeys rapporterar
-- alltid signaturräknare 0, så räknaren kan inte upptäcka en återspelad
-- signatur — raderingen av utmaningsraden är det enda som gör det.
--
-- Icke-destruktiv: bara CREATE TABLE IF NOT EXISTS och GRANT/REVOKE.
-- Rollback: 20260825_admin_passkeys_ROLLBACK.sql

create table if not exists public.admin_passkeys (
  credential_id text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  public_key    text not null,
  counter       bigint not null default 0 check (counter >= 0),
  transports    text[],
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists idx_admin_passkeys_user on public.admin_passkeys (user_id);

create table if not exists public.admin_passkey_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  challenge  text not null,
  kind       text not null check (kind in ('register','auth')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_passkey_challenges_lookup
  on public.admin_passkey_challenges (user_id, kind, expires_at desc);

-- Husmönstret från 20260727_per_learner_loop.sql: RLS på, allt återkallat,
-- grants bara till service_role. "RLS på + noll policyer" ensamt räcker inte.
alter table public.admin_passkeys            enable row level security;
alter table public.admin_passkey_challenges  enable row level security;

revoke all on table public.admin_passkeys           from public, anon, authenticated;
revoke all on table public.admin_passkey_challenges from public, anon, authenticated;

grant select, insert, update, delete on table public.admin_passkeys           to service_role;
grant select, insert, delete         on table public.admin_passkey_challenges to service_role;

comment on table public.admin_passkeys is
  'WebAuthn-enheter för adminens step-up till per.html. Ingen klientåtkomst.';
comment on table public.admin_passkey_challenges is
  'Engångsutmaningar, TTL 120 s. Raderas vid användning — det är det enda som '
  'upptäcker en återspelad signatur, eftersom Apples passkeys alltid rapporterar räknare 0.';
```

Och `_ROLLBACK.sql`:

```sql
-- Rollback för 20260825_admin_passkeys.sql.
-- Destruktiv: varje registrerad enhet försvinner och måste registreras om.
drop table if exists public.admin_passkey_challenges;
drop table if exists public.admin_passkeys;
```

- [ ] **Steg 2: Committa**

```bash
git add supabase/migrations/20260825_admin_passkeys.sql supabase/migrations/20260825_admin_passkeys_ROLLBACK.sql
git commit -m "feat(per): tabeller för adminens passkeys"
```

- [ ] **Steg 3: Applicera INTE utan att fråga**

Migrationen ska köras via Supabase MCP:s `apply_migration`, inte i SQL-editorn
— annars förs den aldrig in i `supabase_migrations.schema_migrations`, och
katalogen slutar beskriva den databas som faktiskt körs. Se
`supabase/migrations/README.md`.

Det är produktionsdatabasen. Fråga Elton innan du kör.

---

### Task 6: Dokumentation, miljövariabler och hel svit

**Filer:**
- Ändra: `CLAUDE.md`

- [ ] **Steg 1: Skriv avsnittet**

Lägg till i `CLAUDE.md`, direkt efter `## P.E.R:s minnessida (2026-08-25)`:

```markdown
## Låset på minnessidan (2026-08-25)
- **En passkey autentiserar en ENHET, inte en behörighet.** `requireAdmin`
  (`profiles.role === 'admin'`) är och förblir det avgörande gatet. Step-up
  ligger ovanpå. Byt aldrig ordningen: en passkey ensam hindrar ingen från att
  anropa API:t direkt.
- **Utmaningen raderas FÖRE verifieringen.** Apples passkeys rapporterar alltid
  signaturräknare 0, så räknaren kan inte upptäcka en återspelad signatur.
  Engångsutmaningen är det enda som gör det. Flytta aldrig raderingen efteråt.
- **Registrering kräver bara adminroll — medvetet.** Specen kräver att Elton
  aldrig kan låsa ut sig, och kravet på en befintlig passkey leder till manuell
  databasåtgärd den dag båda enheterna försvinner. Priset är att någon med en
  kapad adminsession kan registrera sin egen enhet och ta sig förbi step-up.
  Sidan listar därför varje enhet med tidpunkt: en tyst registrering blir
  åtminstone synlig. Skärper någon det här, gör det utan att återinföra
  utelåsningen.
- **Två miljövariabler i Vercel, båda obligatoriska:**
  `PASSKEY_STEPUP_SECRET` (en lång slumpsträng) och `PASSKEY_RP_ID`
  (`exgen.se`). Saknas hemligheten utfärdas ingen token och sidan säger vilket
  namn som saknas — den svarar 503, inte 403, eftersom ett konfigurationsfel
  som ser ut som ett behörighetsfel skickar felsökningen åt fel håll.
- **Passkeys är bundna till sin origin.** En registrerad på `exgen.se` fungerar
  inte på en Vercel-preview och inte på localhost. Testerna sätter
  `PASSKEY_ORIGIN`/`PASSKEY_RP_ID` mot sin egen server.
- **`tests/frontend/per-passkey.test.mjs` mockar inte WebAuthn.** Chromium får
  en virtuell autentiserare via CDP och serversidan är de riktiga funktionerna
  körda mot ett minneslager. Därför tar `_admin-passkey.js` ett `store`, inte
  en Supabase-klient — utan den uppdelningen hade engångsutmaningen bara gått
  att kontrollera genom att läsa koden.
- **`public_key` är `text` med base64url, inte `bytea`.** PostgREST lämnar
  bytea som `\x`-hex och konverteringen är ett extra felläge utan vinst.
```

- [ ] **Steg 2: Committa och kör hela sviten EFTER commit**

```bash
git add CLAUDE.md
git commit -m "docs: låset på minnessidan"

node tests/frontend/run-all.mjs
for f in tests/per/*.test.mjs tests/api/*.test.mjs; do node "$f" > /dev/null || echo "RÖD $f"; done
```

Förväntat: samtliga filer gröna. `per-visual.mjs` flaggar olika vyer mellan
körningar — jämför mot orörd `origin/main` innan du kallar det ett fel.

- [ ] **Steg 3: Öppna PR och lista vad Elton måste göra själv**

PR-beskrivningen måste säga rakt ut att funktionen inte fungerar i produktion
förrän tre saker gjorts, och att inget av dem kan göras härifrån:

1. `PASSKEY_STEPUP_SECRET` sätts i Vercel (`openssl rand -base64 48`).
2. `PASSKEY_RP_ID` sätts till `exgen.se`.
3. Migrationen appliceras mot produktionsdatabasen.
