// Gymnasiets matematik som struktur (api/_math-curriculum.js).
//
// Användning:  node tests/curriculum/gymnasium-math.test.mjs   (exit 0 = pass)
//
// Grundskolan indexeras på STADIUM, gymnasiet på KURS. Det är inte en
// inkonsekvens utan hur läroplanerna är byggda: en grundskoleelev läser
// matematik, en gymnasieelev läser Matematik 3c.
//
// Två läroplaner lever parallellt och båda måste fungera. Ämnesbetygsreformen
// (Gy25) gäller utbildning som startar efter 2025-06-30, men elever som började
// dessförinnan läser GY11-kurser och hela deras provhistorik hänger på de
// kursnamnen. Kurspickaren i app.html erbjuder GY11-namnen.
//
// Det dyra felet är detsamma som i grundskolan: att presentera ExGens
// bedömning som Skolverkets. Här löses det genom att INTE ha någon
// prerequisite-kedja för gymnasiet alls — ingen har gjort den bedömningen, och
// en gissad ordning mellan Ma3c och Ma4 vore precis det felet.

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
const gy = cur.gymnasium;

console.log("\n— BÅDA LÄROPLANERNA FINNS —");
check("gymnasieblocket finns", !!gy);
check("GY11 har kurser", (gy?.GY11?.courses || []).length >= 10, String(gy?.GY11?.courses?.length));
check("Gy25 har nivåer", (gy?.GY25?.levels || []).length >= 6, String(gy?.GY25?.levels?.length));

/* Kurspickaren i app.html erbjuder de här namnen. Saknas en kurs i läroplanen
   kan eleven välja den och ändå plugga utan kursplan — vilket var läget för
   HELA gymnasiet innan den här filen fanns. */
const PICKAREN = ["Matematik 1a", "Matematik 1b", "Matematik 1c", "Matematik 2a", "Matematik 2b",
  "Matematik 2c", "Matematik 3b", "Matematik 3c", "Matematik 4", "Matematik 5"];
const saknade = PICKAREN.filter(n => !mc.gymnasiumCourse(n));
check("varje kurs i pickaren har en läroplan", saknade.length === 0, saknade.join(", "));

console.log("\n— UPPSLAGET —");
check("kursnamn slår upp", mc.gymnasiumCourse("Matematik 3c")?.code === "MATMAT03c");
check("kurskod slår upp", mc.gymnasiumCourse("MATMAT04")?.name === "Matematik 4");
/* Eleven skriver fritext i pickaren — versaler och mellanslag varierar. */
check("versaler spelar ingen roll", mc.gymnasiumCourse("matematik 3C")?.code === "MATMAT03c");
check("mellanslag spelar ingen roll", mc.gymnasiumCourse("Matematik3c")?.code === "MATMAT03c");
check("Gy25-nivå slår upp", mc.gymnasiumCourse("Nivå 2b")?.curriculum === "GY25");
check("GY11 märks som GY11", mc.gymnasiumCourse("Matematik 4")?.curriculum === "GY11");
/* Hellre ingen läroplan än fel läroplan. */
check("okänd kurs ger null", mc.gymnasiumCourse("Trolleri 1") === null);
check("tomt namn ger null", mc.gymnasiumCourse("") === null);
check("grundskolekurs ger null här", mc.gymnasiumCourse("Matematik (grundskola)") === null);

console.log("\n— SKOLVERKETS TEXT ÄR INTAKT —");
const ma3c = mc.gymnasiumCourse("Matematik 3c");
check("kursen har områden", ma3c.areas.length > 0, String(ma3c.areas.length));
check("varje område har punkter", ma3c.areas.every(a => a.points.length > 0));
check("Ma3c innehåller derivata",
  JSON.stringify(ma3c.areas).toLowerCase().includes("derivata"));
check("Ma3c innehåller trigonometri",
  ma3c.areas.some(a => /trigonometri/i.test(a.area)), ma3c.areas.map(a => a.area).join(" | "));
/* Mjuka bindestreck (U+00AD) är osynliga men bryter varje strängjämförelse. */
check("mjuka bindestreck är borttagna", !JSON.stringify(gy).includes("­"));
check("ingen HTML läcker igenom", !/<[a-z/][^>]*>/i.test(JSON.stringify(gy)));
/* Ingressen är ingen områdesrubrik. Fångade den skulle varje kurs få ett
   låtsasområde som heter "Undervisningen i kursen ska behandla...". */
check("ingressen blev inte ett område",
  !gy.GY11.courses.some(k => k.areas.some(a => /centralt inneh[åa]ll/i.test(a.area))));

console.log("\n— BETYGSKRITERIER —");
check("GY11-kurs har alla fem steg",
  ["E", "D", "C", "B", "A"].every(g => mc.criterionForCourse("Matematik 3c", g)),
  ma3c.criteria.map(k => k.grade).join(" "));
check("kriteriet har text", (mc.criterionForCourse("Matematik 4", "E")?.text || "").length > 50);
check("okänt betygssteg ger null", mc.criterionForCourse("Matematik 4", "Z") === null);
check("okänd kurs ger null", mc.criterionForCourse("Trolleri 1", "E") === null);
/* I Gy25 sätts betyget på ÄMNET, inte på nivån. Kriterierna ligger därför på
   ämnet i API:t och lyfts in — men de är fortfarande ämnets, och blocket måste
   säga det. Att påstå att "Nivå 2b" betygsätts för sig vore att beskriva
   reformen baklänges. */
check("Gy25-nivå ärver ämnets kriterier", (mc.gymnasiumCourse("Nivå 2b")?.criteria || []).length === 5);

console.log("\n— BEGREPP TILL OMRÅDE —");
check("derivata hittar sitt område",
  !!mc.courseAreaForConcept("Matematik 3c", "derivata"),
  mc.courseAreaForConcept("Matematik 3c", "derivata")?.area);
check("trigonometri hittar sitt område",
  /trigonometri/i.test(mc.courseAreaForConcept("Matematik 3c", "trigonometri")?.area || ""));
/* Hellre ingen koppling än en gissad: en felaktig skickar eleven att repetera
   något de redan kan medan luckan står kvar. */
check("okänt begrepp ger null", mc.courseAreaForConcept("Matematik 3c", "fotosyntes") === null);
check("för kort sträng ger null", mc.courseAreaForConcept("Matematik 3c", "x") === null);
check("okänd kurs ger null", mc.courseAreaForConcept("Trolleri 1", "derivata") === null);

console.log("\n— PROMPTBLOCKET —");
const block = mc.buildCourseContext("Matematik 3c", "derivata");
check("blocket byggs", block.length > 100);
check("blocket namnger kursen", block.includes("Matematik 3c"));
check("blocket märker Skolverkets text som citerbar", /Skolverkets egen text/.test(block));
check("blocket innehåller centralt innehåll", /derivata/i.test(block));
check("blocket innehåller betygskriteriet", /Betygskriterium f[öo]r E/.test(block));
/* Den här raden är hela poängen. ExGen har INTE gjort någon
   prerequisite-bedömning för gymnasiet, och får därför inte antyda en ordning. */
check("blocket förbjuder påhittad ordning mellan kurser",
  /Påstå aldrig att läroplanen\s*\n?kräver en viss ordning/.test(block) || /aldrig att läroplanen/.test(block),
  block.slice(-220));
check("blocket har ingen prerequisite-kedja för gymnasiet",
  !/ExGens bedömning/.test(block) && !/brukar bygga på/.test(block));
check("okänd kurs ger tomt block", mc.buildCourseContext("Trolleri 1", "derivata") === "");

const gy25block = mc.buildCourseContext("Nivå 2b", "");
check("Gy25-blocket säger att betyget gäller ämnet",
  /hela ämnet, inte den enskilda nivån/.test(gy25block), gy25block.slice(-200));
check("Gy25-blocket namnger rätt läroplan", /Gy25/.test(gy25block));
check("GY11-blocket namnger rätt läroplan", /GY11/.test(block));

/* Utan begrepp ska blocket ändå ge kursens områden — annars får P.E.R. inget
   alls när eleven ställer en allmän fråga om kursen. */
const utanBegrepp = mc.buildCourseContext("Matematik 4", "");
check("block utan begrepp listar kursens områden", utanBegrepp.split("\n").filter(r => r.startsWith("- ")).length > 0);

console.log("\n— GRUNDSKOLAN ÄR ORÖRD —");
check("stadierna finns kvar", mc.STAGES.every(s => mc.areasForStage(s).length > 0));
check("7-9 har sex områden", mc.areasForStage("7-9").length === 6);
check("prerequisite-kedjan finns kvar för grundskolan",
  mc.prerequisitesFor("algebra", { stage: "7-9" }).length > 0);
check("grundskolans block byggs fortfarande",
  mc.buildCurriculumContext("procent", { stage: "7-9", year: 9 }).length > 50);

console.log(`\ngymnasium-math: ${failures === 0 ? "allt grönt" : failures + " FAIL"}`);
process.exit(failures === 0 ? 0 : 1);
