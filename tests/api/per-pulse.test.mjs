// Pulsens aggregering (api/_per-pulse.js).
//
// Användning:  node tests/api/per-pulse.test.mjs   (exit 0 = pass)
//
// Funktionerna är rena med flit: de tar rader och ger summor. Ingen databas,
// inget nätverk, ingen mockning. Det som är svårt att få rätt här är inte
// matematiken utan vad som händer när underlaget är för tunt.
//
// PRODUKTIONEN HAR ETT FÅTAL KONTON. Flera mätvärden kommer att sakna underlag
// från dag ett. En nolla som ser ut som ett mätvärde är då sämre än ingen
// siffra alls: den skulle få läsaren att tro att cachen aldrig träffar, när
// sanningen är att den aldrig fått chansen.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = await import(join(root, "api", "_per-pulse.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const NU = Date.parse("2026-08-25T12:00:00Z");
const dagarSedan = d => new Date(NU - d * 86_400_000).toISOString();

console.log("\n— LÅNGTIDSMINNEN —");
const minnen = P.summariseMemories([
  { updated_at: dagarSedan(1) },
  { updated_at: dagarSedan(40) },
  { updated_at: dagarSedan(91) },
  { updated_at: dagarSedan(200) },
], NU);
check("totalen räknar alla rader", minnen.totalt === 4, JSON.stringify(minnen));
check("färska är de inom 90 dygn", minnen.färska === 2);
check("gamla är de som passerat TTL", minnen.gamla === 2);
/* Gränsen är 90 dygn. Ett minne på dagen 90 är ännu inte gallringsbart —
   off-by-one här skulle få sidan att rapportera gallring som inte skett. */
check("exakt 90 dygn räknas som färskt", P.summariseMemories([{ updated_at: dagarSedan(90) }], NU).färska === 1);
check("tom lista ger nollor, inte krasch", P.summariseMemories([], NU).totalt === 0);
/* Ett oläsbart datum får aldrig räknas som färskt. Att påstå att ett minne är
   inom TTL utan att veta är att rapportera gallring som inte skett. */
check("oläsbart datum räknas som gammalt", P.summariseMemories([{ updated_at: "inte ett datum" }], NU).gamla === 1);

console.log("\n— CACHENS BESLUT —");
const probes = P.summariseProbes([
  ...Array(12).fill({ decision: "hit_exact" }),
  ...Array(4).fill({ decision: "hit_vector" }),
  ...Array(3).fill({ decision: "near_miss" }),
  ...Array(9).fill({ decision: "miss" }),
  ...Array(2).fill({ decision: "blocked" }),
]);
check("varje beslut räknas", probes.per.hit_exact === 12 && probes.per.miss === 9, JSON.stringify(probes.per));
check("totalen stämmer", probes.totalt === 30);
/* (12+4)/30 = 53,3 % — avrundat till heltal. */
check("träffkvoten räknar båda träffsorterna", probes.träffkvot === 53, String(probes.träffkvot));
check("blocked räknas men är ingen träff", probes.per.blocked === 2);
/* Ett okänt beslutsvärde får inte tyst blåsa upp totalen och därmed sänka
   träffkvoten utan att någon ser var raderna tog vägen. */
check("okänt beslut ändrar inte de kända räknarna",
  P.summariseProbes([{ decision: "hittepå" }]).per.miss === 0);

console.log("\n— FÖR TUNT UNDERLAG SÄGS RAKT UT —");
/* Under MIN_PROBES är en träffkvot brus, inte ett mätvärde. Att visa "0 %"
   på fyra sonderingar vore att påstå något som inte är mätt. */
const tunt = P.summariseProbes([{ decision: "miss" }, { decision: "miss" }]);
check("under 20 sonderingar ges TOO_FEW i stället för siffra", tunt.träffkvot === P.TOO_FEW, String(tunt.träffkvot));
check("men råa antal visas ändå", tunt.totalt === 2 && tunt.per.miss === 2);
check("noll sonderingar ger också TOO_FEW", P.summariseProbes([]).träffkvot === P.TOO_FEW);
check("TOO_FEW är svensk text, inte en nolla", P.TOO_FEW === "för få elever än");
/* Precis på tröskeln ska siffran komma — annars vet ingen var gränsen går. */
check("exakt MIN_PROBES ger en siffra",
  typeof P.summariseProbes(Array(P.MIN_PROBES).fill({ decision: "miss" })).träffkvot === "number");

console.log("\n— CACHERADER —");
const cache = P.summariseCache([
  { status: "approved", expires_at: dagarSedan(-5) },
  { status: "approved", expires_at: dagarSedan(2) },
  { status: "pending",  expires_at: dagarSedan(-1) },
  { status: "rejected", expires_at: dagarSedan(-1) },
], NU);
check("status räknas var för sig", cache.approved === 2 && cache.pending === 1 && cache.rejected === 1, JSON.stringify(cache));
check("utgångna räknas på expires_at, inte på status", cache.utgångna === 1);

console.log("\n— KVOTER —");
const kvot = P.summariseQuota([
  { feature: "per_chat", used: 3 },
  { feature: "per_chat", used: 5 },
  { feature: "explain",  used: 2 },
]);
check("samma funktion summeras", kvot.find(r => r.funktion === "per_chat")?.använt === 8, JSON.stringify(kvot));
check("sorteras fallande", kvot[0].funktion === "per_chat");
check("tom lista ger tom lista", P.summariseQuota([]).length === 0);

console.log("\n— SVÅRASTE BEGREPPEN —");
const begrepp = P.summariseConcepts([
  { concept_name: "Derivata", mean_score: 0.42, student_count: 7, common_error_codes: ["kedjeregel"] },
  { concept_name: "Bråk",     mean_score: 0.71, student_count: 9, common_error_codes: [] },
]);
check("namnet följer med", begrepp[0].namn === "Derivata", JSON.stringify(begrepp));
check("svårast först", begrepp[0].medelpoäng < begrepp[1].medelpoäng);
check("felkoderna följer med", begrepp[0].felkoder.length === 1);
/* Vyn concept_collective_stats bär redan k-anonymitet: minst fem distinkta
   elever per begreppsrad. En tom svarsmängd betyder alltså att tröskeln inte
   nåtts — inte att alla kan allt. */
check("tom vy ger TOO_FEW, inte tom lista", P.summariseConcepts([]) === P.TOO_FEW);

console.log("\n— INGET user_id LÄMNAR SERVERN —");
/* Aggregaten är hela integritetslöftet. Frågorna i admin.js får aldrig
   selecta en kolumn som pekar ut en elev — då spelar det ingen roll att
   funktionerna ovan summerar. */
const admin = readFileSync(join(root, "api", "admin.js"), "utf8");
const i = admin.indexOf('action === "per-pulse"');
const perBlock = i === -1 ? "" : admin.slice(i, i + 3000);
check("per-pulse-blocket finns i admin.js", perBlock.length > 0);
check("ingen select av user_id i per-pulse", perBlock.length > 0 && !/select\([^)]*user_id/.test(perBlock), "kolla select-strängarna");
check("per-registry finns i admin.js", admin.includes('action === "per-registry"'));
/* Kollen gäller kedjan, inte ordet. Sedan 2026-08-25 går anropen genom
   requireOwner, som kräver requireAdmin OCH att user.id är ägarens. En kontroll
   som letar efter "requireAdmin" i blocket mäter formen och blir röd av en
   omskrivning som gjorde grinden hårdare — vilket den blev här. */
check("båda anropen går genom ägarkollen",
  (perBlock.match(/requireOwner/g) || []).length >= 1 &&
  /action === "per-registry"[\s\S]{0,200}requireOwner/.test(admin));
check("ägarkollen ersätter inte rollkollen",
  /async function requireOwner[\s\S]{0,200}await requireAdmin\(req, res\)/.test(admin));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
