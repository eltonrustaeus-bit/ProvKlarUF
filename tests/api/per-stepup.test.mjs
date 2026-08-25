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

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
