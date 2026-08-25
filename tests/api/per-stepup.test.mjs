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
check("timingSafeEqual används", /timingSafeEqual\(/.test(källa));
check("signaturen jämförs inte med .equals()", !/förväntad\.equals\(/.test(källa));

console.log("\n— GATET I admin.js —");
const admin = readFileSync(join(root, "api", "admin.js"), "utf8");
const passkeyKälla = readFileSync(join(root, "api", "_admin-passkey.js"), "utf8");
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
/* Ägarkollen får inte ERSÄTTA rollkollen, bara ligga ovanpå. requireOwner
   anropar requireAdmin först — utan den raden hade en giltig session med rätt
   uid räckt, oavsett roll. Kontrollen mäter kedjan, inte att varje block
   råkar skriva ordet requireAdmin. */
check("requireOwner bygger på requireAdmin, ersätter den inte",
  /async function requireOwner[\s\S]{0,200}await requireAdmin\(req, res\)/.test(admin));
check("varje passkey-anrop går genom ägarkollen",
  ["passkey-status", "passkey-register-begin", "passkey-register-finish",
   "passkey-auth-begin", "passkey-auth-finish", "passkey-delete"]
    .every(a => /requireOwner/.test(block(a))));
/* Ett konfigurationsfel som svarar 403 skickar felsökningen åt fel håll. */
check("saknad hemlighet ger 503, inte 403", /stepup_unconfigured/.test(admin) && /status\(503\)/.test(admin));

console.log("\n— WEBAUTHN-FLÖDET —");
/* "preferred" hade tillåtit en enhet som bara bevisar närvaro, och då är
   låset ett knapptryck i stället för ett ansikte. */
check("biometri krävs vid registrering, inte bara närvaro",
  (passkeyKälla.match(/userVerification:\s*"required"/g) || []).length >= 2);
check("verifieringen kräver userVerification",
  (passkeyKälla.match(/requireUserVerification:\s*true/g) || []).length === 2);
/* Apples passkeys rapporterar alltid räknare 0, så räknaren kan inte upptäcka
   en återspelad signatur. Raderingen av utmaningen är det enda som gör det. */
check("utmaningen raderas i takeChallenge, före verifieringen",
  /takeChallenge[\s\S]{0,700}delete\(\)[\s\S]{0,60}eq\("id", rad\.id\)/.test(passkeyKälla));
check("den publika nyckeln lagras som base64url, inte bytea",
  /toString\("base64url"\)/.test(passkeyKälla));

console.log("\n— BARA ÄGAREN, INTE VARJE ADMIN —");
/* Sidan är inte "för administratörer" utan för EN person. En framtida admin,
   tillagd för något helt annat, ska inte kunna läsa P.E.R:s minne. */
const ÄGARE = "4a2d4593-16d3-4f9f-bc6c-54c856c21553";
const gammalÄgare = process.env.PER_OWNER_USER_ID;
process.env.PER_OWNER_USER_ID = ÄGARE;
check("ägaren känns igen", S.isOwner({ id: ÄGARE }) === true);
check("en annan admin är inte ägare", S.isOwner({ id: B }) === false);
check("utan användare är ingen ägare", S.isOwner(null) === false && S.isOwner({}) === false);
/* FAIL CLOSED. Ett tomt värde får aldrig betyda "alla". */
process.env.PER_OWNER_USER_ID = "";
check("osatt variabel gör INGEN till ägare", S.isOwner({ id: ÄGARE }) === false);
process.env.PER_OWNER_USER_ID = "   ";
check("blanktecken gör INGEN till ägare", S.isOwner({ id: "   " }) === false);
if (gammalÄgare === undefined) delete process.env.PER_OWNER_USER_ID;
else process.env.PER_OWNER_USER_ID = gammalÄgare;

for (const a of ["per-registry", "per-pulse", "passkey-status", "passkey-register-begin",
                 "passkey-register-finish", "passkey-auth-begin", "passkey-auth-finish",
                 "passkey-delete", "recovery-create", "recovery-use"]) {
  check(`${a} går genom requireOwner`, /requireOwner/.test(block(a)), a);
}
/* Ett 403 hade bekräftat att ytan finns och bara var stängd. Svaret till alla
   andra måste vara omöjligt att skilja från en rutt som inte existerar. */
check("främlingar får samma svar som en okänd action",
  /requireOwner[\s\S]{0,600}Unknown action/.test(admin));

console.log("\n— REGISTRERINGEN ÄR STÄNGD —");
check("register-begin kräver rätt att registrera", /requireEnrolmentRight/.test(block("passkey-register-begin")));
check("register-finish kräver det också", /requireEnrolmentRight/.test(block("passkey-register-finish")));
/* Första enheten måste gå att registrera, annars vore sidan omöjlig att öppna. */
check("men första enheten släpps igenom",
  /if \(!enheter\.length\) return true;/.test(admin));
check("därefter krävs en upplåst session",
  /if \(!enheter\.length\) return true;[\s\S]{0,120}requireStepUp/.test(admin));

console.log("\n— ÅTERSTÄLLNINGSKODEN —");
const kod = S.generateRecoveryCode();
const { hash, salt } = S.hashRecoveryCode(kod);
check("koden är lång nog att inte gissas", kod.replace(/-/g, "").length >= 30, `${kod.length} tecken`);
check("koden saknar förväxlingsbara tecken", !/[ILOU]/.test(kod), kod);
check("rätt kod godtas", S.verifyRecoveryCode(kod, hash, salt) === true);
check("fel kod nekas", S.verifyRecoveryCode("ABCD-EFGH-JKMN-PQRS", hash, salt) === false);
check("gemener godtas — koden ska gå att skriva av", S.verifyRecoveryCode(kod.toLowerCase(), hash, salt) === true);
check("tom kod nekas", S.verifyRecoveryCode("", hash, salt) === false);
/* Två koder i rad får aldrig ge samma hash — då vore saltet verkningslöst. */
check("saltet är unikt per kod", S.hashRecoveryCode(kod).hash !== S.hashRecoveryCode(kod).hash);
check("jämförelsen läcker inte tid", /timingSafeEqual\(given, känd\)/.test(källa));
check("koden lagras aldrig i klartext",
  !/code_hash:\s*kod|clear|plain/.test(readFileSync(join(root, "api", "_admin-passkey.js"), "utf8")));
/* Markeras förbrukad INNAN token utfärdas — annars kan ett avbrutet anrop
   lämna kvar en kod som redan gett tillgång. */
check("koden markeras förbrukad före token utfärdas",
  /markRecoveryUsed[\s\S]{0,200}mintStepUp/.test(admin));
check("en förbrukad kod godtas aldrig igen", /rad\.used_at\) return/.test(admin));
check("recovery-create kräver upplåst session", /requireStepUp/.test(block("recovery-create")));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
