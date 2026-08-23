// Begreppstaggen måste finnas på varje genererad fråga (api/generate-exam.js).
//
// Användning:  node tests/assessment/concept-tag-required.test.mjs   (exit 0 = pass)
//
// Uppmätt i produktionsdata 2026-08-23: 42 av 72 rättade frågor hade tom
// concept_tag. Orsaken var att generate-exam ALDRIG satte fältet — det fanns
// inte i schemat. Flervalsfrågor rättas dessutom deterministiskt, så ingen
// AI-rättning fyllde i det heller.
//
// Följden: nästan 60% av all rättning gav noll kunskapsdata, och elevens
// kunskapsprofil byggdes på knappt hälften av det underlag som fanns.
//
// Testet läser schemat ur källan i stället för att anropa OpenAI. Ett anrop per
// körning hade gjort sviten långsam, dyr och beroende av nätet — och det som
// kan gå sönder här är att fältet försvinner ur schemat, inte att modellen
// struntar i ett strict schema.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "api", "generate-exam.js"), "utf8");

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

console.log("\n— SCHEMAT —");
/* strict + additionalProperties:false gör required till en garanti: modellen
   MÅSTE skicka fältet. Faller det ur required blir taggen valfri igen, och
   tomma taggar smyger tillbaka utan att något går sönder synligt. */
check("concept_tag står i required",
  /required:\s*\[[^\]]*"concept_tag"/s.test(src));
check("concept_tag är definierad som en sträng",
  /concept_tag:\s*\{\s*type:\s*"string"\s*\}/.test(src));
check("schemat är strict", /strict:\s*true/.test(src));
check("schemat tillåter inga extra fält", /additionalProperties:\s*false/.test(src));

console.log("\n— INSTRUKTIONEN —");
/* Ett schemafält utan instruktion ger ett ifyllt men värdelöst värde. Det som
   gör taggen användbar är att samma begrepp skrivs likadant varje gång — annars
   splittras elevens historik, precis som conceptKey() finns för att laga. */
check("prompten beskriver concept_tag", /concept_tag ska vara/.test(src));
check("den ber om ett begrepp, inte en beskrivning",
  /SJÄLVA BEGREPPET frågan prövar/.test(src));
check("den kräver konsekvent stavning",
  /samma begrepp likadant varje gång/.test(src));
check("den ger konkreta exempel", /'Bytesrätt'|'Konjugatregeln'|'Ohms lag'/.test(src));
/* De värden som faktiskt förekom i produktionsdata och gjorde taggen oanvändbar. */
check("den förbjuder generiska ord", /'Principer', 'Allmän del', 'Övrigt'/.test(src));
check("den förbjuder frågetypen som tagg", /Skriv ALDRIG frågetypen/.test(src));
check("den säger vad man gör när begreppet är oklart",
  /mest specifika ämnesordet/.test(src));
check("engelska prompten har samma krav", /concept_tag must be THE CONCEPT/.test(src));

console.log("\n— RÄTTNINGEN RÄDDAR EN TOM TAGG —");
const grade = readFileSync(join(root, "api", "grade.js"), "utf8");
/* Tre vägar sätter concept_tag: flerval (deterministisk), answer_key_unverified
   och AI-rättningen. Alla tre måste gå via samma uppslag, annars är det bara
   vissa frågetyper som får en tagg. */
check("alla tre rättningsvägarna använder resolveConceptTag",
  (grade.match(/resolveConceptTag\(/g) || []).length >= 3,
  `${(grade.match(/resolveConceptTag\(/g) || []).length} anrop`);
/* nonMcPack går till modellen och ska inte bära fält som bara behövs efteråt. */
check("originalfrågan sparas vid sidan om, inte i modellpaketet",
  /questionById\.set\(id, q\)/.test(grade) && !/nonMcPack\.push\(\{[^}]*subtopic/s.test(grade));
check("uppslaget görs mot originalfrågan i AI-vägen",
  /resolveConceptTag\(questionById\.get/.test(grade));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
