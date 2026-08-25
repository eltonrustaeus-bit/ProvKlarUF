// CJS/ESM-gränsen i api/ (alla rutter).
//
// Användning:  node tests/api/cjs-esm-boundary.test.mjs   (exit 0 = pass)
//
// DET HÄR TESTET FINNS FÖR ATT JAG TOG NED ADMINPANELEN.
//
// 2026-08-25 la jag `dirname(fileURLToPath(import.meta.url))` i api/admin.js
// för att läsa api/-katalogen vid körning. Vercel laddade filen som CJS —
// den heter .js och package.json saknar "type": "module" — och `import.meta`
// är ett SYNTAXFEL i CJS. Modulen kunde inte laddas alls:
//
//   /var/task/api/admin.js:815
//   SyntaxError: Cannot use 'import.meta' outside a module
//
// Följden var att HELA /api/admin svarade 500, även på GET som skulle gett
// 405. Adminpanelen var nere tills ändringen reverterades.
//
// VARFÖR INGET BEFINTLIGT TEST FÅNGADE DET
// Varje test i repot kör i Node som ESM, där import.meta.url fungerar
// utmärkt. Jag kontrollerade till och med att admin.js parsar — den gjorde
// det, SOM ESM. Skillnaden mellan testmiljön och Vercels körning var precis
// den gräns CLAUDE.md varnar för på fyra ställen.
//
// Kontrollen nedan läser källkoden som text, vilket är det enda sättet att se
// skillnaden utan att faktiskt köra i CJS.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiDir = join(root, "api");

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const alla = readdirSync(apiDir).filter(f => f.endsWith(".js")).sort();

/* VARJE .js I api/, INTE BARA RUTTERNA.
 *
 * Första versionen av den här filen undantog understrecksprefixade filer med
 * motiveringen att de "bara importeras av ESM-rutter". Det var fel, och felet
 * kostade en andra produktionsstörning samma dag.
 *
 * Vercel BUNTAR hjälparen in i rutten och transpilerar hela bunten till CJS.
 * Understrecket säger något om ROUTING — att filen inte blir en egen
 * serverlös funktion — och ingenting om MODULFORMAT. Formatet avgörs av
 * filändelsen och package.json, och de gäller varje fil i bunten.
 *
 * Uppmätt 2026-08-25: `import.meta.url` i `api/_per-core.js` gav
 * `SyntaxError: Cannot use 'import.meta' outside a module` och tog ned
 * `/api/explain`, `/api/teacher-report` OCH `/api/check-role`. Den sista är
 * värst: `js/site-gate.js` är fail-closed, så varje besökare riskerade att
 * skickas till /snart.html.
 *
 * `src/**.mjs` är undantagna — de laddas alltid dynamiskt över gränsen och
 * behåller sin ESM-natur. Det är `.js` i `api/` som transpileras. */
const rutter = alla;

console.log("\n— HÄRLEDNINGEN SJÄLV —");
/* Slutar filtret matcha blir varje kontroll nedan grön på en tom mängd. */
check("api-filer hittas", rutter.length >= 20, `${rutter.length} st`);

console.log("\n— INGEN FIL I api/ FÅR ANVÄNDA import.meta —");
for (const f of rutter) {
  const src = readFileSync(join(apiDir, f), "utf8");
  // Kommentarer räknas inte: det är körbar kod som kraschar.
  /* Strippa också STRÄNGAR. api/_per-registry.js beskriver regeln i klartext
     och nämner därför "import.meta" i en textsträng — en träff som inte är
     kod. Ett test som fäller sin egen dokumentation blir raderat. */
  const utanKommentarer = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  check(`${f} saknar import.meta`, !/import\s*\.\s*meta/.test(utanKommentarer),
    (utanKommentarer.match(/.*import\s*\.\s*meta.*/) || [""])[0].trim().slice(0, 70));
}

console.log("\n— INGEN FIL I api/ FÅR LÄSA SIN EGEN KATALOG —");
/* SKILLNADEN MOT config/ ÄR VIKTIG.
 *
 * `_education.js` och `_math-curriculum.js` läser `config/**` med readFileSync
 * och har fungerat i produktion i månader — det går för att `config/**` ligger
 * i `includeFiles` i vercel.json, en rad som finns och testas.
 *
 * Det farliga är att läsa `api/` SJÄLV. Då förutsätter man att källfilerna
 * ligger på disk i den buntade funktionen, vilket de inte gör utan en
 * includeFiles-rad som ingen kommer ihåg. Det var felet i api/admin.js som tog
 * ned adminpanelen; lösningen blev att GENERERA data i stället
 * (tools/build-per-graph.mjs → api/_per-graph-data.js).
 *
 * Regeln följer alltså felet: förbjud katalogläsning av api/, inte all
 * filläsning. En regel som fäller kod som fungerat i månader blir raderad. */
for (const f of rutter) {
  const src = readFileSync(join(apiDir, f), "utf8");
  const utanKommentarer = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const läserApi = /readdirSync\s*\(/.test(utanKommentarer)
    || /read(?:dir|File)Sync\s*\([^)]*\b(?:__dirname|import\s*\.\s*meta)/.test(utanKommentarer);
  check(`${f} läser inte api/-katalogen vid körning`, !läserApi,
    (utanKommentarer.match(/.*read(?:dir|File)Sync.*/) || [""])[0].trim().slice(0, 70));
}

console.log("\n— package.json SÄGER FORTFARANDE INTE type: module —");
/* Den dagen någon sätter "type": "module" blir varje CJS-rutt (grade.js,
   generate-exam.js, ocr.js) oladdbar i stället. Kontrollen finns för att
   ändringen ska vara ett medvetet beslut, inte en överraskning. */
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
check("package.json saknar type: module", pkg.type !== "module",
  `type = ${JSON.stringify(pkg.type)}`);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
