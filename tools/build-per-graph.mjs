// tools/build-per-graph.mjs — genererar api/_per-graph-data.js ur api/.
//
// VARFÖR GRAFEN GENERERAS I STÄLLET FÖR ATT LÄSAS VID KÖRNING
//
// Första versionen läste api/-katalogen i api/admin.js med
// dirname(fileURLToPath(import.meta.url)). Vercel laddade filen som CJS —
// den heter .js och package.json saknar "type": "module" — och import.meta är
// ett SYNTAXFEL i CJS. Hela /api/admin svarade 500, även på GET.
// Adminpanelen var nere tills ändringen reverterades 2026-08-25.
//
// Genererad data har tre fördelar utöver att den inte kraschar:
//   1. Ingen filläsning i en serverlös funktion, alltså inget beroende av
//      includeFiles i vercel.json som ingen kommer ihåg.
//   2. Samma mönster som config/math-curriculum.json och
//      config/education-catalog.json — repot har redan vanan.
//   3. Grafen går att läsa i en diff. Ändras arkitekturen syns det i PR:en.
//
// FILEN LIGGER I api/, INTE I config/. vercel.json sätter
// outputDirectory ".", så config/*.json är publikt hämtbart — mätt mot
// produktion svarar /config/education-catalog.json med 200 medan
// /api/_site.js ger 404 tack vare understrecksprefixet.
//
// Användning:
//   node tools/build-per-graph.mjs           skriver filen
//   node tools/build-per-graph.mjs --check   säger bara om den är inaktuell

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "api");
const MÅL = join(apiDir, "_per-graph-data.js");

const { buildGraph } = await import(join(apiDir, "_per-brain.js"));

const filer = {};
for (const f of readdirSync(apiDir).filter(f => f.endsWith(".js"))) {
  // Den genererade filen beskriver inte sig själv.
  if (f === "_per-graph-data.js") continue;
  filer[f] = readFileSync(join(apiDir, f), "utf8");
}

const graf = buildGraph(filer);

if (!graf.noder.length || !graf.kanter.length) {
  console.error("VÄGRAR SKRIVA: grafen blev tom.");
  console.error("Det betyder att härledningen slutat matcha, inte att P.E.R. saknar moduler.");
  console.error(`noder=${graf.noder.length} kanter=${graf.kanter.length}`);
  process.exit(1);
}

const innehåll = `// api/_per-graph-data.js — GENERERAD. Redigera aldrig för hand.
//
// Kör \`node tools/build-per-graph.mjs\` för att skriva om den, och
// \`node tools/build-per-graph.mjs --check\` för att se om den är inaktuell.
// tests/per/per-brain.test.mjs faller om filen glidit isär från api/.
//
// Genererad ur källkoden, inte skriven: en nod finns bara om filen finns, och
// en kant bara om importen finns.
//
// Läses av api/admin.js. Filen får INTE läsa katalogen vid körning — se
// kommentaren i tools/build-per-graph.mjs om varför adminpanelen låg nere.

export const PER_GRAPH = ${JSON.stringify(graf, null, 2)};
`;

if (process.argv.includes("--check")) {
  let nuvarande = "";
  try { nuvarande = readFileSync(MÅL, "utf8"); } catch { /* saknas */ }
  if (nuvarande === innehåll) {
    console.log(`aktuell — ${graf.noder.length} noder, ${graf.kanter.length} kanter`);
    process.exit(0);
  }
  console.error("INAKTUELL. Kör: node tools/build-per-graph.mjs");
  process.exit(1);
}

writeFileSync(MÅL, innehåll, "utf8");
console.log(`skrev ${MÅL}`);
console.log(`${graf.noder.length} noder, ${graf.kanter.length} kanter`);
