// Registret över vad P.E.R. består av (api/_per-registry.js).
//
// Användning:  node tests/per/per-registry.test.mjs   (exit 0 = pass)
//
// Sidan per.html har ett enda värde: att den stämmer. En handunderhållen
// översikt som ingen minns att uppdatera ger falskt lugn, och falskt lugn är
// sämre än ingen sida — då vet man åtminstone att man inte vet.
//
// Testet går därför rött åt BÅDA hållen: en modul utan post, och en post utan
// modul. Nästa gång någon lägger till en P.E.R.-modul står sviten i vägen tills
// registret beskriver den.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiDir = join(root, "api");
const { PER_REGISTRY } = await import(join(apiDir, "_per-registry.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const apiFiles = readdirSync(apiDir).filter(f => f.endsWith(".js"));

/* _per-registry.js beskriver sig inte själv. */
const moduleFiles = apiFiles
  .filter(f => /^_per-.*\.js$/.test(f) && f !== "_per-registry.js")
  .sort();

/* Flaggnycklarna härleds ur koden, inte ur en lista någon underhåller.
   TVÅ mönster, för att flaggor läses på två sätt i repot:
     1. flagsEnabled(supabase, ["nyckel"], id) — grinden i api/_flags.js
     2. from("feature_flags") … .eq("key", "nyckel") — api/_per-cache.js
        läser sin flagga direkt, utan att gå genom grinden. */
const flagKeys = new Set();
for (const f of apiFiles) {
  const src = readFileSync(join(apiDir, f), "utf8");
  for (const m of src.matchAll(/flagsEnabled\s*\(\s*(?:supabase\s*,\s*)?\[([^\]]*)\]/g)) {
    for (const k of m[1].matchAll(/["']([a-z0-9_]+)["']/g)) flagKeys.add(k[1]);
  }
  for (const m of src.matchAll(/from\(\s*["']feature_flags["']\s*\)[\s\S]{0,400}?\.eq\(\s*["']key["']\s*,\s*["']([a-z0-9_]+)["']/g)) {
    flagKeys.add(m[1]);
  }
}

console.log("\n— HÄRLEDNINGEN SJÄLV —");
/* Om regexarna slutar matcha blir varje kontroll nedan grön på tomma
   mängder, och testet skyddar ingenting utan att säga till. */
check("modulfiler hittas i api/", moduleFiles.length >= 10, `${moduleFiles.length} st`);
check("flaggnycklar hittas i koden", flagKeys.size >= 5, [...flagKeys].join(", "));

console.log("\n— MODUL UTAN POST —");
const beskrivnaFiler = new Set(PER_REGISTRY.moduler.map(m => m.fil));
for (const f of moduleFiles) {
  check(`${f} är beskriven`, beskrivnaFiler.has(f));
}

console.log("\n— POST UTAN MODUL —");
const filerPåDisk = new Set(apiFiles);
for (const m of PER_REGISTRY.moduler) {
  check(`${m.fil} finns på disk`, filerPåDisk.has(m.fil));
}

console.log("\n— FLAGGA UTAN POST —");
const beskrivnaFlaggor = new Set(PER_REGISTRY.flaggor.map(f => f.nyckel));
for (const k of [...flagKeys].sort()) {
  check(`${k} är beskriven`, beskrivnaFlaggor.has(k));
}

console.log("\n— TOM POST —");
/* En post som finns men är tom är värre än en som saknas: den saknade fångas
   av kontrollerna ovan, den tomma ser ut som en beskrivning. */
/* Olika minimilängd för olika fält. `namn` är ett namn — "Kärnan" är sex
   tecken och fullt begripligt. De tre prosafälten ska vara meningar; en
   fyraordersats som "Avgör om det går" beskriver ingenting. */
const MINLÄNGD = { namn: 3, gör: 20, ser: 8, gräns: 20 };
for (const p of [...PER_REGISTRY.moduler, ...PER_REGISTRY.flaggor]) {
  const id = p.fil || p.nyckel;
  for (const [fält, min] of Object.entries(MINLÄNGD)) {
    check(`${id}.${fält} är ifyllt`, typeof p[fält] === "string" && p[fält].trim().length >= min, p[fält]);
  }
}

console.log("\n— GRÄNSERNA ÄR INTE DEKORATION —");
/* api/_per-memory.js bär regeln som är hela skälet till att _per-collective.js
   finns i stället för en tabell med elevfrågor. Ett register som listar modulen
   utan dess gräns beskriver en annan P.E.R. än den som körs. */
const minnet = PER_REGISTRY.moduler.find(m => m.fil === "_per-memory.js");
check("minnets gräns nämner att personuppgifter aldrig sparas",
  /aldrig/i.test(minnet?.gräns || "") && /(namn|personlig|personuppgift)/i.test(minnet?.gräns || ""),
  minnet?.gräns);

const kollektiva = PER_REGISTRY.moduler.find(m => m.fil === "_per-collective.js");
check("kollektiva lagrets gräns nämner k-anonymiteten",
  /k-anonym|fem distinkta|minst fem/i.test(kollektiva?.gräns || ""),
  kollektiva?.gräns);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
