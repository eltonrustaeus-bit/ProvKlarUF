// Riggarna får inte vänta på klockan före en interaktion.
//
// Användning:  node tests/frontend/rigg-vantar-pa-villkor.test.mjs
//
// VARFÖR FILEN FINNS
//
// Två testfiler klickade upp P.E.R.-panelen och väntade 500 ms fast tid innan
// de skrev i `#perInput`. Lokalt räckte det. I fulla svitkörningar — 777 s och
// 783 s, med flera Chromium som konkurrerar — hann öppningsanimationen inte
// klart, och riggen kastade med "element is not visible".
//
// Följden var värre än en röd rad: när riggen kastar rapporteras även
// kontroller som mäter helt andra saker som röda. I anon-per.test.mjs blev tre
// orelaterade kontroller röda av en paus som var 200 ms för kort.
//
// SYMTOMET ÄR FÖRRÄDISKT. Båda filerna var gröna ensamma OCH gröna under
// konstlad last med sex parallella Chromium. Ett tidsberoende syns bara
// ibland, så "kan inte reproducera" är inget bevis på att det inte finns.
//
// Den här filen läser de andra testernas källkod och faller om mönstret
// återinförs. Den kör ingen webbläsare och tar millisekunder.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HÄR = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const filer = readdirSync(HÄR)
  .filter(f => f.endsWith(".mjs") && f !== "run-all.mjs" && f !== "_harness.mjs" && !f.startsWith("rigg-"))
  .sort();

console.log("\n— HÄRLEDNINGEN SJÄLV —");
/* Slutar filtret matcha blir varje kontroll nedan grön på en tom mängd. */
check("testfiler hittas", filer.length >= 20, `${filer.length} st`);

console.log("\n— P.E.R-PANELEN MÅSTE VÄNTAS IN —");
/* REGELN FÖLJER BEVISEN, inte en ambition.
 *
 * Två försök att formulera en bred regel — "ingen fast paus före någon
 * interaktion", sedan "före textinmatning" — flaggade tio respektive sju
 * GRÖNA filer. Mestadels navigeringsklick i provflödet som aldrig fallit. En
 * regel som fäller fungerande kod blir ignorerad eller raderad, och skyddar
 * då ingenting.
 *
 * Det som faktiskt föll, två gånger, är smalare och konkret: `#perInput` i
 * P.E.R.-panelen. Fältet animeras in, `.fill()` kräver att det är synligt OCH
 * redigerbart, och en fast paus på 500 ms räckte lokalt men inte i en full
 * svitkörning.
 *
 * Faller något annat på samma sätt: utvidga regeln DÅ, med det fallet som
 * grund. En regel utan ett fall bakom sig är en gissning. */
for (const f of filer) {
  const src = readFileSync(join(HÄR, f), "utf8");
  if (!/#perInput/.test(src)) continue;
  if (!/perBubble|perStripBtn/.test(src)) continue;   // öppnar inte panelen själv

  check(`${f} väntar in att #perInput är synlig innan den skriver`,
    /#perInput["']\s*\)?\s*\.waitFor\(\s*\{\s*state:\s*["']visible["']|waitForSelector\(\s*["']#perInput/.test(src),
    "en fast paus räcker inte i en full svitkörning");
}

console.log("\n— DE TVÅ SOM FÖLL SKA HA FIXEN KVAR —");
/* Utan de här kontrollerna kan någon ta bort waitFor och lägga tillbaka en
   längre paus, vilket ser ut som en fix men bara flyttar gränsen. */
for (const f of ["stale-session.test.mjs", "anon-per.test.mjs"]) {
  const src = readFileSync(join(HÄR, f), "utf8");
  check(`${f} väntar in att #perInput är synlig`,
    /#perInput["']\s*\)\s*\.waitFor\(\s*\{\s*state:\s*["']visible["']/.test(src));
}

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
