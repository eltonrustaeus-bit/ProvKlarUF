// Kartan över P.E.R. (api/_per-brain.js).
//
// Användning:  node tests/per/per-brain.test.mjs   (exit 0 = pass)
//
// Kartans enda värde är att den stämmer. En graf som visar en struktur som
// inte finns är sämre än ingen graf — den ser ut som kunskap.
//
// Två sorters kontroller här:
//   1. Härledningen mot HITTEPÅ-filer, där svaret är känt exakt.
//   2. Härledningen mot repots RIKTIGA api/-katalog, som fångar den dag någon
//      lägger till en modul och kartan tystnar om den.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiDir = join(root, "api");
const B = await import(join(apiDir, "_per-brain.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

console.log("\n— HÄRLEDNINGEN MOT KÄNT SVAR —");
const påhittat = {
  "_per-alfa.js": 'import { x } from "./_per-beta.js";\nimport { y } from "./_site.js";',
  "_per-beta.js": "export const y = 1;",
  "_site.js": "export const z = 1;",
  "rutt.js": 'import { x } from "./_per-alfa.js";\nawait flagsEnabled(["min_flagga"], id);',
  "orutt.js": 'import { q } from "./_site.js";',
};
const g = B.buildGraph(påhittat);
const id = x => g.noder.find(n => n.id === x);

check("modulerna blir noder", !!id("per-alfa") && !!id("per-beta"));
check("en import blir en kant", g.kanter.some(k => k.från === "per-alfa" && k.till === "per-beta"));
/* Transitiv stängning: _site.js kommer med som HJÄLPARE eftersom _per-alfa.js
   importerar den. Kontrollen hette tidigare "ger ingen nod" och kodade den
   gamla prefixregeln — den regeln visade P.E.R. som frånkopplad från rättning
   och provgenerering, vilket var falskt. */
check("en importerad hjälpare kommer med, men som hjälpare", id("site")?.typ === "hjälpare",
  JSON.stringify(g.noder.map(n => `${n.id}:${n.typ}`)));
check("kärnmodulerna kallas fortfarande modul", id("per-alfa")?.typ === "modul");
check("rutten som använder en modul kommer med", id("rutt")?.typ === "rutt");
/* Och en rutt som rör en hjälpare kommer också med — det är hela poängen med
   stängningen. Vill man utesluta något ska det uteslutas för att det inte hör
   till P.E.R., inte för att det saknar ett prefix. */
check("rutten som rör en hjälpare kommer med", id("orutt")?.typ === "rutt");
check("flaggan blir en egen nod", id("flagga:min_flagga")?.typ === "flagga");
check("kanten går från rutten till flaggan",
  g.kanter.some(k => k.från === "rutt" && k.till === "flagga:min_flagga"));
check("ingen kant pekar på en nod som saknas",
  g.kanter.every(k => id(k.från) && id(k.till)),
  JSON.stringify(g.kanter));

console.log("\n— INGA DUBBLETTER, INGA SLINGOR —");
const dubbel = B.buildGraph({
  // Tre importformer i samma fil — alla tre ska ge SAMMA kant, en gång.
  "_per-a.js": 'import { x } from "./_per-b.js";\nimport "./_per-b.js";\nconst y = await import("./_per-b.js");',
  "_per-b.js": 'import "./_per-b.js";',
});
check("samma kant räknas en gång", dubbel.kanter.filter(k => k.från === "per-a" && k.till === "per-b").length === 1);
check("en fil som importerar sig själv ger ingen slinga", !dubbel.kanter.some(k => k.från === k.till));

console.log("\n— MOT REPOTS RIKTIGA api/ —");
const filer = {};
for (const f of readdirSync(apiDir).filter(f => f.endsWith(".js"))) {
  filer[f] = readFileSync(join(apiDir, f), "utf8");
}
const riktig = B.buildGraph(filer);
const moduler = riktig.noder.filter(n => n.typ === "modul");
const flaggor = riktig.noder.filter(n => n.typ === "flagga");
const rutter = riktig.noder.filter(n => n.typ === "rutt");

/* Om regexarna slutar matcha blir varje kontroll nedan grön på tomma mängder,
   och kartan blir tom utan att något säger till. Samma spärr som i
   per-registry.test.mjs. */
check("moduler hittas", moduler.length >= 10, `${moduler.length} st`);
check("flaggor hittas", flaggor.length >= 5, flaggor.map(f => f.etikett).join(", "));
check("rutter hittas", rutter.length >= 3, rutter.map(r => r.etikett).join(", "));
check("kanter hittas", riktig.kanter.length >= 15, `${riktig.kanter.length} st`);

/* Hjälparna. grade.js och generate-exam.js når P.E.R. genom _concept-tags.js
   och _adaptive-exam.js — filer utan _per-prefix. Med bara prefixregeln visade
   kartan P.E.R. som frånkopplad från rättning och provgenerering, vilket är
   falskt: mastery skrivs i grade.js och läses av _per-role.js. */
const hjälpare = riktig.noder.filter(n => n.typ === "hjälpare");
check("hjälpare kommer med via transitiv stängning", hjälpare.length >= 3,
  hjälpare.map(h => h.id).join(", "));
check("de två CJS-rutterna når kartan",
  ["grade", "generate-exam"].every(r => rutter.some(n => n.id === r)),
  rutter.map(r => r.id).join(", "));
/* Registret beskriver _per-*. Kartan visar mer, men får inte kalla det samma
   sak — annars säger de två ytorna olika saker om vad P.E.R. BESTÅR av. */
check("hjälpare kallas inte modul", hjälpare.every(h => !/^per-/.test(h.id)),
  hjälpare.map(h => h.id).join(", "));
check("varje modul-nod är en _per-fil", moduler.every(m => /^_per-/.test(m.fil)));

/* Varje api/_per-*.js måste finnas på kartan. Faller den här dagen någon lägger
   till en modul är det precis vad testet är till för. */
const påDisk = readdirSync(apiDir).filter(f => /^_per-.*\.js$/.test(f));
for (const f of påDisk) {
  check(`${f} finns på kartan`, moduler.some(m => m.fil === f));
}

check("ingen kant pekar på en nod som saknas i den riktiga grafen",
  riktig.kanter.every(k => riktig.noder.some(n => n.id === k.från) && riktig.noder.some(n => n.id === k.till)));

/* explain.js är navet. Inte för att någon placerat den där, utan för att den
   importerar flest P.E.R.-moduler. Ändras det har arkitekturen ändrats. */
const grader = new Map();
for (const k of riktig.kanter) grader.set(k.från, (grader.get(k.från) || 0) + 1);
const nav = [...grader.entries()].sort((a, b) => b[1] - a[1])[0];
check("explain är kartans nav", nav?.[0] === "explain", `${nav?.[0]} med ${nav?.[1]} kanter`);

console.log("\n— LJUSSTYRKAN VISAR AVVIKELSE, INTE VOLYM —");
/* En modul som alltid används ska inte lysa starkast bara för att den alltid
   används — då blir kartan en lista över det vanligaste, vilket registret
   redan säger. */
check("som vanligt lyser inte", B.activityLevel(10, 10) === 0);
check("hälften så mycket lyser inte", B.activityLevel(5, 10) === 0);
check("dubbelt lyser fullt", B.activityLevel(20, 10) === 1);
check("mer än dubbelt lyser inte mer än fullt", B.activityLevel(100, 10) === 1);
check("en och en halv gång lyser halvt", B.activityLevel(15, 10) === 0.5);
/* null och 0 är olika saker: 0 är mätt och tyst, null är inte mätt alls.
   Samma skillnad som TOO_FEW i _per-pulse.js. */
check("saknad mätpunkt ger null, inte 0", B.activityLevel(undefined, 10) === null);
check("en helt ny modul som just användes lyser", B.activityLevel(3, 0) === 1);
check("en helt ny modul som inte använts lyser inte", B.activityLevel(0, 0) === 0);

console.log("\n— MÄTDATAN VÄVS IHOP MED GRAFEN —");
const NU = Date.parse("2026-08-25T15:30:00Z");
const timme = h => new Date(Date.parse("2026-08-25T15:00:00Z") - h * 3_600_000).toISOString();
const vävd = B.attachActivity(riktig, [
  { module: "per-core", hour: timme(0), count: 20 },
  { module: "per-core", hour: timme(1), count: 10 },
  { module: "per-core", hour: timme(2), count: 10 },
], NU);
const kärnan = vävd.noder.find(n => n.id === "per-core");
check("aktiviteten når fram", typeof kärnan?.aktivitet === "number", JSON.stringify(kärnan));
check("senaste timmen räknas", kärnan?.senasteTimmen === 20);
/* Snittet är (20+10+10)/3 ≈ 13,3. 20/13,3 ≈ 1,5 → halvt ljus. */
check("ljuset är avvikelse mot eget snitt", Math.abs(kärnan.aktivitet - 0.5) < 0.06, String(kärnan.aktivitet));

const utanMätpunkt = vävd.noder.find(n => n.id === "per-name");
check("en modul utan mätdata får null, inte 0", utanMätpunkt?.aktivitet === null, JSON.stringify(utanMätpunkt));
check("grafen behåller alla noder", vävd.noder.length === riktig.noder.length);
check("en okänd modul i mätdatan skapar ingen nod",
  !B.attachActivity(riktig, [{ module: "finns-inte", hour: timme(0), count: 5 }], NU)
    .noder.some(n => n.id === "finns-inte"));
check("trasigt datum kraschar inte",
  B.attachActivity(riktig, [{ module: "per-core", hour: "inte ett datum", count: 5 }], NU).noder.length > 0);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
