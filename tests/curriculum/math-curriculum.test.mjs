// Grundskolans matematik som struktur (api/_math-curriculum.js).
//
// Användning:  node tests/curriculum/math-curriculum.test.mjs   (exit 0 = pass)
//
// Filen bär två sorters påståenden som aldrig får blandas ihop:
//
//   SKOLVERKETS TEXT   centralt innehåll och betygskriterier, ordagrant.
//   EXGENS BEDÖMNING   prerequisite-kedjan. Skolverket säger vad som ska läras
//                      i varje stadium — aldrig att procent förutsätter bråk.
//
// Det dyra felet är att presentera det andra som det första. "Enligt
// kursplanen behöver du repetera bråk först" är ett påstående om vad en
// myndighet sagt, och det har Skolverket inte sagt. Till en elev som redan
// kämpar är ett falskt auktoritetspåstående värre än ingen vägledning.
//
// Det andra felet är en FELAKTIG koppling: skickas eleven till fel område
// repeterar de något de redan kan medan luckan står kvar.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mc = await import(join(root, "api", "_math-curriculum.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const cur = mc.getMathCurriculum();

console.log("\n— LÄROPLANEN ÄR LADDAD —");
check("centralt innehåll finns", cur.centralContent.length > 0);
check("alla tre stadier finns",
  mc.STAGES.every(s => mc.areasForStage(s).length > 0),
  mc.STAGES.map(s => `${s}:${mc.areasForStage(s).length}`).join(" "));
check("årskurs 7-9 har sex områden", mc.areasForStage("7-9").length === 6);
check("varje område har punkter ur läroplanen",
  mc.areasForStage("7-9").every(a => a.points.length > 0));
/* Mjuka bindestreck (U+00AD) finns i Skolverkets text för avstavning. De är
   osynliga men bryter varje strängjämförelse. */
check("mjuka bindestreck är borttagna",
  !JSON.stringify(cur.centralContent).includes("­"));
check("ingen HTML läcker igenom",
  !cur.centralContent.some(a => a.points.some(p => /<[a-z/]/i.test(p))));

console.log("\n— BETYGSKRITERIER —");
check("kriterier finns", cur.criteria.length > 0, `${cur.criteria.length} st`);
check("E-kriteriet för årskurs 9 går att hämta", !!mc.criterionFor(9, "E"));
/* Kriterier sätts vid stadiets slut — en elev i åk 8 bedöms mot åk 9:s. */
check("åk 8 bedöms mot årskurs 9", mc.criterionFor(8, "E")?.year === "9");
check("åk 5 bedöms mot årskurs 6", mc.criterionFor(5, "E")?.year === "6");
check("okänd årskurs ger inget kriterium", mc.criterionFor(99, "E") === null);
check("kriterietexten är Skolverkets, inte tom", (mc.criterionFor(9, "E")?.text || "").length > 50);

console.log("\n— BEGREPP TILL OMRÅDE —");
for (const [begrepp, väntat] of [
  ["Procent", "Samband och förändring"],
  ["Förändringsfaktor", "Samband och förändring"],
  ["Konjugatregeln", "Algebra"],
  ["Ekvationer", "Algebra"],
  ["Pythagoras sats", "Geometri"],
  ["Omkrets", "Geometri"],
  ["Medelvärde", "Sannolikhet och statistik"],
  ["Bråk", "Taluppfattning och tals användning"],
  ["Grundpotensform", "Taluppfattning och tals användning"],
]) check(`"${begrepp}" → ${väntat}`, mc.areaForConcept(begrepp)?.area === väntat,
  mc.areaForConcept(begrepp)?.area || "ingen träff");

/* En felaktig koppling skickar eleven till fel repetition. Hellre ingen
   koppling än en gissad. */
for (const utanför of ["Fotosyntes", "Andra världskriget", "Konsumenträtt", "", "   "]) {
  check(`"${utanför}" ger ingen koppling`, mc.areaForConcept(utanför) === null);
}

console.log("\n— KEDJAN BAKÅT —");
/* Pilotplanens slutmål: från "problem med procent" till "grunderna i bråk
   behöver stärkas först". */
const procent = mc.traceConcept("Procent");
check("procent spåras till sitt område", procent?.area === "Samband och förändring");
check("procent leder bakåt till tidigare stadium",
  procent.prerequisites.some(p => p.stage === "4-6"),
  procent.prerequisites.map(p => `${p.area} (${p.stage})`).join(", "));
check("varje led har ett skäl", procent.prerequisites.every(p => p.why && p.why.length > 20));

/* KÄRNREGELN. Kedjan är ExGens bedömning och får aldrig märkas som Skolverkets. */
check("varje prerequisite är märkt som ExGens",
  procent.prerequisites.every(p => p.source === "exgen"));
check("ingen prerequisite påstår sig vara Skolverkets",
  !JSON.stringify(cur.prerequisites).toLowerCase().includes("skolverket"));
check("filen bär en varning om vad kedjan är",
  /INTE Skolverkets/i.test(cur._prerequisitesNote || ""));

check("okänt begrepp ger ingen kedja", mc.traceConcept("Fotosyntes") === null);
check("tidigare stadier har ingen kedja bakåt",
  mc.prerequisitesFor("algebra", { stage: "4-6" }).length === 0);
/* Ett led som pekar på ett område som inte finns skickar eleven ingenstans.
   Genereringsskriptet vägrar skriva filen då, men kontrollen står även här. */
check("varje led pekar på ett område som finns",
  Object.values(cur.prerequisites).flat()
    .every(p => mc.findArea(p.stage, p.key) !== null));

console.log("\n— PROMPTBLOCKET —");
const block = mc.buildCurriculumContext("Procent", { year: 8 });
check("blocket byggs", block.length > 0);
check("området namnges", block.includes("Samband och förändring"));
check("Skolverkets text märks som citerbar", /Skolverkets egen text — får citeras/.test(block));
check("betygskriteriet kommer med när årskursen är känd", /Betygskriterium för E/.test(block));
/* Den viktigaste raden i hela filen. */
check("kedjan märks som ExGens bedömning", /ExGens bedömning, INTE Skolverkets/.test(block));
check("P.E.R. förbjuds hänvisa till kursplanen för kedjan",
  /Säg aldrig att Skolverket eller läroplanen kräver den ordningen/.test(block));
check("och får en formulering att använda i stället",
  /det här brukar bygga på/.test(block));
check("okänt begrepp ger inget block", mc.buildCurriculumContext("Fotosyntes") === "");
check("utan årskurs utelämnas kriteriet",
  !/Betygskriterium/.test(mc.buildCurriculumContext("Procent")));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
