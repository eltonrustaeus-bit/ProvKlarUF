// Regression net for subject routing (api/_assessment.js detectSubjectProfile,
// api/generate-exam.js looksLikeMath — the latter now delegates to the former).
//
// Usage:  node tests/assessment/subject-routing.test.mjs   (exit 0 = pass)
//
// Two directions matter equally:
//   - a real maths course must still reach MATH MODE, including Swedish
//     compounds ("andragradsekvationer") that a word-boundary rule would miss;
//   - a non-maths course must not, even when its material legitimately contains
//     percentages, statistics, equations or the word "funktion".
//
// The course names are real Swedish upper-secondary courses.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const A = require(join(root, "api", "_assessment.js"));
const G = require(join(root, "api", "generate-exam.js"));

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

// ── must be maths ──────────────────────────────────────────────────────────
const MATH_COURSES = [
  ["Matematik 1a", "Räkna med tal i bråkform."],
  ["Matematik 1b", "Procenträkning och förändringsfaktor."],
  ["Matematik 1c", "Geometri och Pythagoras sats."],
  ["Matematik 2a", "Linjära ekvationssystem."],
  ["Matematik 2b", "Lös andragradsekvationen med pq-formeln."],
  ["Matematik 2c", "Bevis och logaritmer."],
  ["Matematik 3b", "Derivatan av polynomfunktioner."],
  ["Matematik 3c", "Deriveringsregler och extrempunkter."],
  ["Matematik 4", "Trigonometriska funktioner och komplexa tal."],
  ["Matematik 5", "Diskret matematik och kombinatorik."],
  ["Matematik – specialisering", "Vektorer i rummet."],
];
for (const [course, material] of MATH_COURSES) {
  check(`maths: ${course}`, G.looksLikeMath(course, material) === true
    && A.detectSubjectProfile(course, material) === "mathematics");
}

// Maths reached through the material alone, with an uninformative course name —
// this is the case the "anywhere" term tier exists for.
const MATH_BY_MATERIAL = [
  ["Prov", "Lös ekvationen x² - 6x + 8 = 0 med pq-formeln."],
  ["Läxa", "Beräkna derivatan och bestäm parabelns extrempunkt."],
  ["Repetition", "Andragradsekvationer och kvadratkomplettering."],
  ["Kapitel 4", "Sannolikhet och kombinatorik, dra utan återläggning."],
  ["Test", "Använd trigonometri: sinus, cosinus och tangens i rätvinkliga trianglar."],
];
for (const [course, material] of MATH_BY_MATERIAL) {
  check(`maths via material: "${course}"`, G.looksLikeMath(course, material) === true);
}

// ── must NOT be maths ──────────────────────────────────────────────────────
// Each material is something a student would realistically paste, containing
// exactly the signal that used to trigger a false positive.
const NOT_MATH = [
  ["Biologi 1", "Cellandningen sker i mitokondrierna."],
  ["Biologi 2", "Genetik och proteinsyntes."],
  ["Psykologi 1", "Kognitiv psykologi och minnets faser."],
  ["Sociologi", "Sociala strukturer och normer."],
  ["Naturkunskap 1a1", "Hållbar utveckling och energikällor."],
  ["Historia 1b", "Tredje ståndet utgjorde omkring 97 procent av befolkningen."],
  ["Historia 2a", "Källkritik: äkthet, tid, beroende och tendens."],
  ["Samhällskunskap 1b", "Valdeltagandet mäts med officiell statistik från SCB."],
  ["Samhällskunskap 2", "Andelen sysselsatta ökade med 3 procent under perioden."],
  ["Religionskunskap 1", "Buddhismens fyra ädla sanningar."],
  ["Engelska 5", "Reported speech shifts the tense back one step."],
  ["Engelska 6", "Second conditional describes a hypothetical present."],
  ["Svenska 1", "Berättarperspektiv och stilfigurer."],
  ["Svenska 3", "Retorikens partesmodell."],
  ["Programmering 1", "Funktioner definieras med def och returnerar med return."],
  ["Programmering 2", "Rekursiva funktioner och basfall."],
  ["Webbutveckling 1", "En funktion i JavaScript deklareras med function."],
  ["Företagsekonomi 1", "Vinst = intäkt minus kostnad per styck."],
  ["Företagsekonomi 2", "Nyckeltal: soliditet och likviditet i procent."],
  ["Entreprenörskap", "Affärsidén beskriver vad företaget erbjuder och till vem."],
  ["Juridik", "Brottsbalken reglerar straffrättens särskilda del."],
  ["Privatjuridik", "Avtalsrätt: anbud och accept."],
  ["Vård och omsorg", "Funktionsförmåga och funktionsnedsättning i vardagen."],
  ["Idrott och hälsa 1", "Träningslära: puls, intensitet och återhämtning."],
  ["Geografi 1", "Befolkningspyramider visar andelen i procent per åldersgrupp."],
  ["Teknologi", "Materialval och hållfasthet i konstruktioner."],
];
for (const [course, material] of NOT_MATH) {
  check(`not maths: ${course}`, G.looksLikeMath(course, material) === false);
}

// ── science keeps its own profile even when the material contains formulas ──
const SCIENCE = [
  ["Fysik 1a", "Newtons andra lag: kraften är massa gånger acceleration. Enheten är newton."],
  ["Kemi 1", "Reaktionsformler ska balanseras. En molekyl vatten skrivs H2O."],
  ["Biologi 1", "Glykolysen ger 2 ATP per glukosmolekyl i cytoplasman."],
];
for (const [course, material] of SCIENCE) {
  check(`science profile: ${course}`, A.detectSubjectProfile(course, material) === "natural_sciences");
}

// ── the specific defects this replaced ─────────────────────────────────────
check("a lone '=' plus a distant x/y/z no longer means maths",
  G.looksLikeMath("Företagsekonomi 1", "Vinst = intäkt minus kostnad per styck.") === false);

check("a course code's level letter is not maths notation (Historia 1b)",
  G.looksLikeMath("Historia 1b", "Franska revolutionen inleddes 1789.") === false);

check("a 1-1 keyword tie no longer defaults to mathematics", (() => {
  // "franska" (languages) and "procent" (maths) both fire once, no course signal.
  const p = A.detectSubjectProfile("Prov", "Franska revolutionen och 97 procent av befolkningen.");
  return p !== "mathematics";
})());

check("one stray specialist keyword in prose stays generic",
  A.detectSubjectProfile("Entreprenörskap", "Ett aktiebolag är en egen juridisk person.") === "generic");

check("the course title outweighs one keyword in the material",
  A.detectSubjectProfile("Historia 1b", "Skatten togs ut av 97 procent av befolkningen.") === "social_sciences");

// ── the 2026-07-28 findings must stay fixed ────────────────────────────────
check("'log' still does not pull biologi/psykologi into maths",
  ["Biologi 1", "Psykologi 1", "Sociologi", "Teknologi"].every(c => G.looksLikeMath(c, "Kursinnehåll.") === false));

check("Swedish compounds still reach maths (andragradsekvationer)",
  G.looksLikeMath("Prov", "Andragradsekvationer löses med pq-formeln.") === true);

check("'Funktionsförmåga och funktionsnedsättning' is not maths",
  G.looksLikeMath("Funktionsförmåga och funktionsnedsättning", "Bedömning av funktionsförmåga.") === false);

check("a real maths term still wins inside a care-course text",
  G.looksLikeMath("Vård och omsorg", "Funktionsnedsättning. Beräkna dosen med en linjär ekvation.") === true);

// ── the two detectors can no longer disagree ───────────────────────────────
const ALL = [...MATH_COURSES, ...MATH_BY_MATERIAL, ...NOT_MATH, ...SCIENCE];
check("looksLikeMath agrees with detectSubjectProfile on every case above",
  ALL.every(([c, m]) => G.looksLikeMath(c, m) === (A.detectSubjectProfile(c, m) === "mathematics")));

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log(`\nAll subject-routing checks passed (${ALL.length} course cases).`);
