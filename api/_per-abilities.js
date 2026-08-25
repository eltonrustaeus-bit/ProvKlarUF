// api/_per-abilities.js — GENERERAD. Redigera aldrig för hand.
//
// Kör `node tools/sync-math-curriculum.mjs` för att skriva om den.
// Skolverkets förmågor ur ämnets syfte, ordagrant.
//
// VARFÖR EN MODUL OCH INTE EN FILLÄSNING: api/_per-core.js behöver dem vid
// inladdning, och en filläsning där hade krävt import.meta för sökvägen.
// Vercel transpilerar varje .js i api/ till CJS, där import.meta är ett
// syntaxfel — den raden tog ned /api/explain, /api/teacher-report och
// /api/check-role samtidigt. Se tests/api/cjs-esm-boundary.test.mjs.

export const PEDAGOGY_ABILITIES = [
  "förmåga att använda och beskriva matematiska begrepp och samband mellan begrepp",
  "förmåga att välja och använda lämpliga matematiska metoder för att göra beräkningar och lösa rutinuppgifter",
  "förmåga att formulera och lösa problem med hjälp av matematik och värdera valda strategier",
  "förmåga att föra och följa matematiska resonemang",
  "förmåga att använda matematikens uttrycksformer för att samtala om och redogöra för frågeställningar, beräkningar och slutsatser"
];
