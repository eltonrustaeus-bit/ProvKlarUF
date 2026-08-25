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
check("varje passkey-anrop går genom requireAdmin",
  ["passkey-status", "passkey-register-begin", "passkey-register-finish",
   "passkey-auth-begin", "passkey-auth-finish", "passkey-delete"]
    .every(a => /requireAdmin/.test(block(a))));
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

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
