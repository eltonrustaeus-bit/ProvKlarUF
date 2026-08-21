// Skyddsnät mot ett fel som tar ned en hel API-rutt i produktion utan att synas någon annanstans.
//
// Användning:  node tests/api/no-static-mjs-import.test.mjs   (exit 0 = pass)
//
// package.json saknar "type": "module". Vercel kompilerar därför api/*.js till CommonJS medan
// filerna under src/ förblir äkta ESM (.mjs). En STATISK import över den gränsen blir ett
// require() av ESM, och funktionen dör vid inladdning:
//
//   ERR_REQUIRE_ESM: require() of ES Module src/per/orchestrator.mjs
//                    from api/knowledge.js not supported
//
// Tre saker gör felet särskilt svårt att upptäcka utan det här testet:
//
//   1. Det syns inte lokalt. `node api/nagot.js` kör filen som ESM, där importen fungerar.
//   2. Det syns inte i Vercels felstatistik. Funktionen dör före första kodraden, så inget
//      loggas som ett applikationsfel — bara FUNCTION_INVOCATION_FAILED i svaret.
//   3. Bygget lyckas. Felet uppstår först vid anrop.
//
// /api/explain låg nere i 35 minuter av precis detta, och /api/knowledge hade legat nere längre
// än så utan att någon märkt det — vilket i sin tur förklarade varför elevloopens kvoträknare
// aldrig fick en rad.
//
// Rätt mönster är dynamisk import(), som fungerar från både CommonJS och ESM.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

// Matchar `import ... from "....mjs"` och `import "....mjs"` — men inte `await import(...)`.
const STATISK_MJS = /^\s*import\s+(?:[^;]*?\s+from\s+)?["'][^"']*\.mjs["']/m;

console.log("\n— INGEN STATISK .mjs-IMPORT I api/ —");

const filer = readdirSync(join(root, "api")).filter(f => f.endsWith(".js"));
check("hittar api-filer att granska", filer.length > 0);

for (const f of filer) {
  const kalla = readFileSync(join(root, "api", f), "utf8");
  const rader = kalla.split("\n");
  const traffar = rader
    .map((rad, i) => ({ rad, nr: i + 1 }))
    .filter(({ rad }) => STATISK_MJS.test(rad));
  check(`api/${f}`, traffar.length === 0);
  for (const t of traffar) console.error(`        rad ${t.nr}: ${t.rad.trim()}`);
}

// Motprovet: regexen måste faktiskt matcha en statisk import, annars är alla PASS ovan
// meningslösa och testet skulle förbli grönt även om felet återinfördes.
console.log("\n— MOTPROV —");
check("regexen fångar en statisk .mjs-import",
  STATISK_MJS.test('import { x } from "../src/a.mjs";'));
check("regexen fångar import utan bindning",
  STATISK_MJS.test('import "../src/a.mjs";'));
check("regexen fångar INTE dynamisk import",
  !STATISK_MJS.test('const m = await import("../src/a.mjs");'));
check("regexen fångar INTE en .js-import",
  !STATISK_MJS.test('import { x } from "./_auth.js";'));

console.log(`\n${failures === 0 ? "OK" : `${failures} FEL`}`);
process.exit(failures === 0 ? 0 : 1);
