// Matterättning och matematiknotation (api/grade.js, api/generate-exam.js).
//
// Användning:  node tests/api/math-grading.test.mjs   (exit 0 = pass)
//
// Läser prompterna som strängar i stället för att anropa modellen. Det som
// bevakas är att reglerna FINNS och står i rätt ordning — inte hur modellen
// svarar på dem. Det senare hör hemma i tests/live.
//
// Två saker skiljer matematik från övriga ämnen vid rättning:
//
//   Svaret är en LÖSNINGSGÅNG, inte ett påstående. Rätt metod med ett slarvfel
//   på sista raden är något helt annat än rätt svar utan uträkning, och
//   basprompten kan inte skilja dem åt.
//
//   Sedan fotoinlämningen kan svaret vara en transkription av handskrift. Den
//   bär LaTeX och radbrytningar. Drar rättningen av för notation bestraffas
//   eleven för hur en modell läste deras papper.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const grade = readFileSync(join(root, "api", "grade.js"), "utf8");
const gen = readFileSync(join(root, "api", "generate-exam.js"), "utf8");

console.log("\n— ÄMNET AVGÖRS PÅ ETT STÄLLE —");
/* Ett eget mönster i grade.js hade drivit isär: ett prov kunde genereras som
   matte och rättas som vilket ämne som helst. */
check("grade.js använder den delade ämnesdetektorn",
  /detectSubjectProfile\(course, pastedText\) === "mathematics"/.test(grade));
check("generate-exam.js använder samma detektor",
  /detectSubjectProfile\(course, pastedText\) === "mathematics"/.test(gen));
check("grade.js har inget eget matte-regexmönster",
  !/isMath\w*\s*=\s*\/.*matemat/i.test(grade));

console.log("\n— MATTE-LÄGET KOPPLAS IN —");
check("svenskt matteläge finns", /const systemSvMath\s*=/.test(grade));
check("engelskt matteläge finns", /const systemEnMath\s*=/.test(grade));
/* Utan språkgrenen får ett engelskt prov en svensk instruktion. */
check("svenska prov får det svenska blocket",
  /lang === "sv"\s*\n?\s*\?\s*systemSv \+ \(isMathGrading \? systemSvMath/.test(grade), "");
check("engelska prov får det engelska blocket",
  /systemEn \+ \(isMathGrading \? systemEnMath/.test(grade));
/* Blocket måste ligga SIST. Senare instruktioner väger tyngre i en
   systemprompt, och matteredlerna ska kunna skärpa basreglerna. */
check("matteblocket läggs till efter basprompten",
  grade.indexOf("const systemSvMath") > grade.indexOf("const systemSv ="));
check("icke-matte får inget matteblock",
  /isMathGrading \? systemSvMath : ""/.test(grade));

console.log("\n— LÖSNINGSGÅNGEN BEDÖMS —");
const sv = (grade.match(/const systemSvMath =([\s\S]*?);\n\n/) || [])[1] || "";
check("blocket hittades", sv.length > 200, String(sv.length));
check("M1 lösningsgången bedöms", /L[ÖO]SNINGSG[ÅA]NGEN, inte bara slutsvaret/.test(sv));
/* Det omvända felet är lika illa: rätt svar utan uträkning ska inte ge full
   poäng när rubric kräver metod. */
check("M1 rätt svar utan uträkning ger inte full poäng",
  /r[äa]tt slutsvar utan utr[äa]kning ska INTE ge full po[äa]ng/i.test(sv));
check("M2 följdfel bestraffas en gång", /F[öo]ljdfel bestraffas en g[åa]ng/.test(sv));
check("M3 felet ska pekas ut med citat", /radh[äa]nvisning eller citat/.test(sv));
/* Den viktigaste raden för fotoinlämningen: eleven får inte straffas för hur
   en modell läste deras handstil. */
check("M4 notation får aldrig ge avdrag",
  /ALDRIG av f[öo]r\s*\n?\s*"?\s*stavning, notation/.test(sv) || /dra ALDRIG av/.test(sv), sv.slice(-400));
check("M4 nämner transkription av foto", /transkription av ett foto/.test(sv));
check("M5 kräver LaTeX i återkopplingen", /LaTeX mellan \$ och \$/.test(sv));
check("M6 skiljer felkategorierna åt",
  /calculation_error/.test(sv) && /method_missing/.test(sv) && /missing_steps/.test(sv));

console.log("\n— ENGELSKA BLOCKET SÄGER SAMMA SAK —");
const en = (grade.match(/const systemEnMath =([\s\S]*?);\n\n/) || [])[1] || "";
check("engelska blocket hittades", en.length > 200, String(en.length));
check("EN M1 bedömer working", /Grade the WORKING, not only the final answer/.test(en));
check("EN M2 följdfel en gång", /carried error once/.test(en));
check("EN M4 aldrig avdrag för notation", /never the spelling, notation/.test(en));
check("båda blocken har sex regler",
  (sv.match(/M[1-6]\)/g) || []).length === 6 && (en.match(/M[1-6]\)/g) || []).length === 6,
  `sv:${(sv.match(/M[1-6]\)/g) || []).length} en:${(en.match(/M[1-6]\)/g) || []).length}`);

console.log("\n— GENERATORN SKRIVER LATEX —");
/* Utan notationsregeln skrevs bråk som 3/4 och integraler i löpande text.
   KaTeX renderar $...$; finns inga dollartecken finns inget att rendera, och
   hela renderingskedjan blir verkningslös. */
const genMath = (gen.match(/const systemSvMath =([\s\S]*?);\n\n/) || [])[1] || "";
check("matteläget kräver LaTeX", /NOTATION: skriv all matematik som LaTeX/.test(genMath));
check("notationen gäller även alternativ och model_answer",
  /fr[åa]getext, svarsalternativ, model_answer och rubric/.test(genMath));
/* Hela meningar mellan dollartecken gör KaTeX till en formelparser för prosa. */
check("löpande text undantas", /L[öo]pande text l[äa]mnas som vanlig text/.test(genMath));
/* Escapningen måste ge riktig LaTeX i den KÖRDA strängen, inte i källan. */
const körd = eval(genMath.replace(/\/\*[\s\S]*?\*\//g, ""));
check("körd sträng innehåller giltig LaTeX", körd.includes("$\\frac{3}{4}$"), körd.slice(körd.indexOf("$\\frac"), körd.indexOf("$\\frac") + 40));
check("körd sträng har inga dubbla bakstreck", !körd.includes("\\\\frac"));

console.log(`\nmath-grading: ${failures === 0 ? "allt grönt" : failures + " FAIL"}`);
process.exit(failures === 0 ? 0 : 1);
