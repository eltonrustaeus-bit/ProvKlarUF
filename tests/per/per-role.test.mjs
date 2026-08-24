// P.E.R:s pedagogiska roll (api/_per-role.js).
//
// Användning:  node tests/per/per-role.test.mjs   (exit 0 = pass)
//
// Uppdragets §11 var till stor del redan byggd: helpLevel 0 är sokratisk, 1–2
// undervisande, `quiz` examinerande, `feynman` återkopplande, intent 'support'
// kontohjälp. Det som saknades var de två roller som kräver kunskap om vad
// eleven faktiskt kan — och den kunskapen fanns inte förrän mastery började
// skrivas och backfillas.
//
// Tre fel är möjliga:
//
//   GISSAD STUDIEPLAN. decideNextFocus() räknar ut nästa steg ur elevens egna
//   prov. Utan en roll som säger åt P.E.R. att använda det gissar den, och en
//   gissad plan bredvid en uträknad är sämre än ingen.
//
//   UTMANING UTAN BELÄGG. Att höja ribban för någon som råkat ha tur en gång är
//   att sätta dem på ett prov de inte klarar och kalla det förtroende.
//
//   FEL ROLL MITT I ETT PROV. En studieplan när eleven har en klocka som tickar
//   är rätt svar på fel fråga.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pr = await import(join(root, "api", "_per-role.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const NU = new Date("2026-08-24T12:00:00Z");
const rad = (score, attempts, label) => ({ score, attempts, label, last_seen: NU.toISOString() });
const MASTERY = { fullmakt: rad(90, 7, "Fullmakt"), svek: rad(25, 5, "Svek") };
const roll = (o) => pr.decidePerRole({ mastery: MASTERY, now: NU, ...o }).role;

console.log("\n— STUDIEPLANERAREN —");
for (const q of [
  "vad ska jag plugga på?", "vad borde jag träna på nu", "var ska jag börja?",
  "vad är nästa steg", "vad gör jag härnäst", "hjälp mig prioritera",
  "vad behöver jag träna mer på", "vad ska man fokusera på",
]) check(`"${q}"`, roll({ userQuestion: q }) === pr.PER_ROLE.PLANNER);

console.log("\n— MEN INTE PÅ UPPGIFTSFRÅGOR —");
/* Det dyra felet åt andra hållet: en elev som ber om hjälp med en uppgift ska
   inte få en studieplan. Frågorna nedan innehåller samma ord. */
for (const q of [
  "hur gör jag för att lösa den här", "vad ska jag svara på fråga 3",
  "hur ska jag tänka här", "vad betyder det här ordet",
  "vad ska x vara i ekvationen", "vad ska jag skriva i inledningen",
]) check(`"${q}"`, roll({ userQuestion: q }) !== pr.PER_ROLE.PLANNER, roll({ userQuestion: q }));

console.log("\n— UTMANAREN KRÄVER BELÄGG —");
check("starkt och belagt begrepp ger utmaning",
  roll({ userQuestion: "förklara fullmakt", topic: "Fullmakt" }) === pr.PER_ROLE.CHALLENGER);
check("begreppet följer med i beslutet",
  pr.decidePerRole({ userQuestion: "förklara fullmakt", topic: "Fullmakt", mastery: MASTERY, now: NU })
    .concept?.label === "Fullmakt");
check("svagt begrepp ger ingen utmaning",
  roll({ userQuestion: "förklara svek", topic: "Svek" }) === pr.PER_ROLE.DEFAULT);
/* Ett enda lyckat svar är inte belägg. */
check("högt betyg med ett försök ger ingen utmaning",
  pr.decidePerRole({ userQuestion: "förklara x", topic: "X", now: NU,
    mastery: { x: rad(95, 1, "X") } }).role === pr.PER_ROLE.DEFAULT);
check("normaliseringen gäller — böjd form träffar samma begrepp",
  roll({ userQuestion: "förklara fullmakter", topic: "fullmakter" }) === pr.PER_ROLE.CHALLENGER);
check("okänt begrepp ger ingen utmaning",
  roll({ userQuestion: "förklara fotosyntes", topic: "Fotosyntes" }) === pr.PER_ROLE.DEFAULT);
check("'ge mig något svårare' utan någon styrka ger ingen utmaning",
  pr.decidePerRole({ userQuestion: "ge mig något svårare", now: NU,
    mastery: { a: rad(20, 5, "A") } }).role === pr.PER_ROLE.DEFAULT);
check("'ge mig något svårare' med en styrka ger utmaning",
  roll({ userQuestion: "ge mig något svårare" }) === pr.PER_ROLE.CHALLENGER);

console.log("\n— PROVET SLÅR ALLT —");
const iProv = { examState: { phase: "exam" } };
const medFråga = { currentQuestion: { text: "Fråga 4" } };
check("ingen studieplan mitt i ett prov",
  roll({ userQuestion: "vad ska jag plugga på", pageContext: iProv }) === pr.PER_ROLE.DEFAULT);
check("ingen utmaning mitt i ett prov",
  roll({ userQuestion: "förklara fullmakt", topic: "Fullmakt", pageContext: iProv }) === pr.PER_ROLE.DEFAULT);
check("en synlig provfråga räcker",
  roll({ userQuestion: "vad ska jag plugga på", pageContext: medFråga }) === pr.PER_ROLE.DEFAULT);

console.log("\n— ORDNINGEN —");
/* Frågar eleven vad de ska göra ska de få veta det, även om de är starka i
   ämnet de råkar nämna. */
check("planeraren går före utmanaren",
  roll({ userQuestion: "vad ska jag träna på", topic: "Fullmakt" }) === pr.PER_ROLE.PLANNER);

console.log("\n— INSTRUKTIONERNA —");
const plan = pr.buildRoleInstruction(pr.PER_ROLE.PLANNER);
check("planeraren pekas mot det uträknade svaret", /använd DET/.test(plan));
check("planeraren förbjuds gissa", /Gissa inte/.test(plan));
/* En uppräkning av allt eleven är dålig på är inte en plan. */
check("planeraren ger EN sak", /Ge EN sak att göra härnäst/.test(plan));
check("planeraren får säga att den inte vet", /jag vet inte än/.test(plan));

const utm = pr.buildRoleInstruction(pr.PER_ROLE.CHALLENGER, { concept: { label: "Fullmakt" } });
check("utmanaren namnger begreppet", utm.includes("Fullmakt"));
check("utmanaren hoppar över grunderna", /Hoppa över definitionen/.test(utm));
/* Rollen ska aldrig synas för eleven — §11 säger uttryckligen att lägena inte
   ska visas. */
check("utmanaren annonserar inte att nivån höjs", /Säg inte att du höjer nivån/.test(utm));
check("utmanaren fungerar utan namngivet begrepp",
  pr.buildRoleInstruction(pr.PER_ROLE.CHALLENGER).length > 0);
check("default ger ingen instruktion alls",
  pr.buildRoleInstruction(pr.PER_ROLE.DEFAULT) === "");

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
