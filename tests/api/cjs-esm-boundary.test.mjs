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

const alla = readdirSync(apiDir).filter(f => f.endsWith(".js"));
// Rutterna är filerna UTAN understrecksprefix. Det är de Vercel gör till
// serverlösa funktioner, och därmed de som kan laddas som CJS.
const rutter = alla.filter(f => !f.startsWith("_")).sort();

console.log("\n— HÄRLEDNINGEN SJÄLV —");
/* Slutar filtret matcha blir varje kontroll nedan grön på en tom mängd. */
check("rutter hittas i api/", rutter.length >= 10, `${rutter.length} st`);

console.log("\n— INGEN RUTT FÅR ANVÄNDA import.meta —");
for (const f of rutter) {
  const src = readFileSync(join(apiDir, f), "utf8");
  // Kommentarer räknas inte: det är körbar kod som kraschar.
  const utanKommentarer = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check(`${f} saknar import.meta`, !/import\s*\.\s*meta/.test(utanKommentarer),
    (utanKommentarer.match(/.*import\s*\.\s*meta.*/) || [""])[0].trim().slice(0, 70));
}

console.log("\n— OCH INGEN RUTT FÅR LÄSA SIN EGEN KATALOG —");
/* Samma familj av fel: en rutt som läser api/ vid körning förutsätter att
   källfilerna ligger på disk i den buntade funktionen. De gör de inte, om
   inte includeFiles säger det — och då är man beroende av en rad i
   vercel.json som ingen kommer ihåg. Generera i stället datan till en
   committad modul, som config/math-curriculum.json. */
for (const f of rutter) {
  const src = readFileSync(join(apiDir, f), "utf8");
  const utanKommentarer = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check(`${f} läser inte katalogen vid körning`,
    !/readdirSync|readFileSync/.test(utanKommentarer),
    (utanKommentarer.match(/.*read(dir|File)Sync.*/) || [""])[0].trim().slice(0, 70));
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
