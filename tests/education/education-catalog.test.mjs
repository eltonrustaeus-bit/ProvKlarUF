// Regressionsnät för utbildningskatalogen (api/_education.js, config/education-catalog.json).
//
// Användning:  node tests/education/education-catalog.test.mjs   (exit 0 = pass)
//
// Katalogen ersätter en handskriven lista med 82 kursnamn. Två fel är möjliga
// här och ingen annanstans:
//
//   1. FEL KURS TILL RÄTT ELEV. Katalogen innehåller både GY11 och Gy25, och de
//      namnger samma sak olika ("Matematik 1b" mot "Nivå 1b"). Blandas de ihop
//      får eleven ett prov mot fel läroplan.
//
//   2. TYST BORTFALL AV HISTORIK. user_exams.course är fritext sedan över ett
//      år. Slutar resolveCourse() känna igen de strängarna tappar P.E.R.
//      kopplingen till allt eleven redan gjort, utan att något går sönder
//      synligt.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ed = await import(join(root, "api", "_education.js"));

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

const cat = ed.getCatalog();

console.log("\n— KATALOGEN —");

check("katalogen är laddad", cat.subjects.length > 0 && cat.levels.length > 0);
check("grundskolan finns", cat.subjects.filter(s => s.schoolType === "GR").length >= 20);
check("Gy25 finns", cat.subjects.some(s => s.curriculum === "GY25" && s.active));
check("GY11 finns kvar parallellt", cat.subjects.some(s => s.curriculum === "GY11"));
check("aktiva gymnasieprogram finns",
  cat.programs.filter(p => p.active && p.kind === "program").length >= 18);
check("varje aktivt program har ämnen kopplade",
  cat.programs.filter(p => p.active).every(p => Array.isArray(p.subjectCodes)));

/* Regressionen som gjorde att katalogen fick noll aktiva program: Gy25-programmen
   ligger under studyPathType PROGRAM25, inte PROGRAM. Ett filter som bara tar
   PROGRAM ger en katalog där varje gymnasieprogram är utgånget. */
check("ekonomiprogrammet finns som aktivt Gy25-program",
  cat.programs.some(p => p.code === "EK25" && p.active && p.curriculum === "GY25"));
check("inget aktivt program tillhör GY11 utom riksrekryterande undantag",
  cat.programs.filter(p => p.active && p.kind === "program" && p.curriculum === "GY11")
     .every(p => p.category === "NATIONAL_RECRUITMENT_FOR_LOCAL_SPECIALIZATION"));

check("ämneskoder i program pekar alltid på ett ämne som finns",
  cat.programs.every(p => (p.subjectCodes || []).every(c => ed.findSubject(c))));
check("nivåkoder pekar alltid på ett ämne som finns",
  cat.levels.every(l => ed.findSubject(l.subjectCode)));

console.log("\n— GY11 MOT GY25 —");

const mat11 = ed.resolveCourse("Matematik 1b");
check("'Matematik 1b' löser till GY11", mat11?.curriculum === "GY11");
check("'Matematik 1b' ger rätt kurskod", mat11?.levelCode === "MATMAT01b");
check("Gy25 har ett eget matematikämne",
  cat.subjects.some(s => s.name === "Matematik" && s.curriculum === "GY25" && s.active));
/* resolveCourse() slår upp fritext på normaliserat namn och tar första
   träffen. Det är korrekt bara så länge inget namn tillhör två läroplaner —
   annars avgörs elevens läroplan av katalogens sorteringsordning. */
check("inget kursnamn tillhör två läroplaner", (() => {
  const norm = s => String(s || "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("sv");
  const byName = new Map();
  for (const l of cat.levels) {
    for (const n of [l.name, l.displayName]) {
      const k = norm(n);
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, new Set());
      byName.get(k).add(l.curriculum);
    }
  }
  return [...byName.values()].every(set => set.size === 1);
})());

check("Gy25-nivåer visas med ämnesnamn, inte bara 'Nivå 1'",
  cat.levels.filter(l => l.curriculum === "GY25")
     .every(l => l.displayName.includes(" – ") || !/^Nivå /i.test(l.name)));

console.log("\n— GAMMAL FRITEXT —");

check("versaler och extra blanksteg spelar ingen roll",
  ed.resolveCourse("  MATEMATIK 1B ")?.levelCode === "MATMAT01b");
check("grundskoleämne med suffix löser till GR",
  ed.resolveCourse("Matematik (grundskola)")?.curriculum === "LGR22");
check("rent ämnesnamn löser till ämne utan nivå", (() => {
  const r = ed.resolveCourse("Juridik");
  return r && r.levelCode === null && ed.findSubject(r.subjectCode)?.name === "Juridik";
})());
check("påhittad kurs löser inte alls", ed.resolveCourse("Trollkonst 3") === null);
check("tom sträng löser inte alls", ed.resolveCourse("   ") === null);

/* Den gamla listan i app.html innehöll sex namn som inte finns i någon
   läroplan. De ska INTE börja lösa sig — hittar resolveCourse() plötsligt en
   träff för "Juridik 1" betyder det att matchningen blivit luddig, och en
   luddig matchning sätter eleven i fel kurs. */
const PAHITTADE = ["Historia 2", "Fysik 1", "Psykologi 2", "Juridik 1", "Juridik 2", "Juridik 3"];
for (const namn of PAHITTADE) {
  check(`"${namn}" finns inte i någon läroplan och matchas inte`, ed.resolveCourse(namn) === null);
}

const html = readFileSync(join(root, "app.html"), "utf8");
const listMatch = html.match(/const STANDARD_COURSES=(\[[^;]*\]);/);
check("STANDARD_COURSES går att läsa ur app.html", !!listMatch);
if (listMatch) {
  const legacy = JSON.parse(listMatch[1]);
  const olosta = legacy.filter(c => !ed.resolveCourse(c));
  check(`all gammal provhistorik utom de påhittade kurserna kan kopplas (olösta: ${olosta.join(", ") || "inga"})`,
    olosta.length === PAHITTADE.length && olosta.every(c => PAHITTADE.includes(c)));
}

console.log("\n— PROFILFÄLT —");

check("varje fält har etikett, personas, parse och format",
  Object.values(ed.PROFILE_FIELDS).every(f =>
    typeof f.label === "string" && f.label &&
    Array.isArray(f.personas) && f.personas.length &&
    typeof f.parse === "function" && typeof f.format === "function"));

const v = (input, opts) => ed.validateProfileValues(input, opts);

check("okänd nyckel avvisas", (() => {
  const r = v({ hemlig_kolumn: "x" });
  return !("hemlig_kolumn" in r.values) && r.rejected.includes("hemlig_kolumn");
})());
check("fält som inte hör till personan avvisas",
  v({ goal_grade: "A" }, { persona: "foralder" }).rejected.includes("goal_grade"));
check("giltigt målbetyg accepteras och normaliseras", v({ goal_grade: "c" }).values.goal_grade === "C");
check("ogiltigt målbetyg avvisas", v({ goal_grade: "F" }).rejected.includes("goal_grade"));
check("program som inte finns avvisas", v({ program_code: "XX99" }).rejected.includes("program_code"));
check("aktivt program accepteras", v({ program_code: "EK25" }).values.program_code === "EK25");
check("utgånget GY11-program accepteras inte som val", v({ program_code: "EK" }).rejected.includes("program_code"));

check("årskurs 8 på gymnasiet avvisas",
  v({ school_type: "gymnasium", grade_year: 8 }).rejected.includes("grade_year"));
check("årskurs 8 i grundskolan accepteras",
  v({ school_type: "grundskola", grade_year: 8 }).values.grade_year === 8);
check("år 3 på gymnasiet accepteras",
  v({ school_type: "gymnasium", grade_year: 3 }).values.grade_year === 3);
check("gymnasieprogram plus grundskola är motsägelsefullt och skolformen faller", (() => {
  const r = v({ school_type: "grundskola", program_code: "NA25" });
  return r.values.program_code === "NA25" && r.values.school_type === undefined;
})());

check("ämneskoder som inte finns filtreras bort",
  v({ subject_codes: ["MATE", "PAHITTAT"] }).values.subject_codes.join() === "MATE");
check("provdatum i fel format avvisas", v({ exam_date: "24 maj" }).rejected.includes("exam_date"));
check("provdatum i rätt format accepteras", v({ exam_date: "2026-09-15" }).values.exam_date === "2026-09-15");
check("fritext trimmas och kapas",
  v({ focus_note: "  " + "a".repeat(400) + "  " }).values.focus_note.length === 200);

check("ekonomiprogrammets ämnen går att slå upp", ed.subjectsForProgram("EK25").length >= 8);
check("okänt program ger tom ämneslista", ed.subjectsForProgram("XX99").length === 0);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
