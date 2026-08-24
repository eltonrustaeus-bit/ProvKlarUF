// api/_adaptive-exam.js — vad elevens kunskapsläge ska betyda för nästa prov.
//
// Loopen var bruten precis där den skulle sluta sig. Prov matar
// user_profiles.mastery via api/grade.js, men generate-exam.js visste
// ingenting om eleven — noll referenser till mastery i hela filen. Varje prov
// genererades som om eleven aldrig gjort ett förut.
//
// Körkortsmodulen har haft adaptivt urval länge (felsvarade frågor viktas upp
// till 40% av frågepoolen). Mockproven, som är produktens kärna, hade det inte.
//
// TVÅ SAKER SOM MÅSTE HÅLLAS ISÄR:
//
//   VIKTNING  vilka begrepp provet handlar om. Elevens svaga begrepp ska
//             komma oftare — men aldrig så ofta att provet slutar likna ett
//             riktigt prov, och aldrig på bekostnad av materialet eleven
//             faktiskt klistrat in.
//
//   SVÅRIGHET hur hårt provet prövar. Den styrs redan av nivåvalet (E/C/A) som
//             ELEVEN gör. Att i hemlighet sänka den för att någon har låg
//             mastery vore att ljuga om vad ett C-prov är. Kunskapsläget får
//             därför påverka VAD som frågas, inte vilken nivå svaret bedöms mot.

import { readMastery, MIN_ATTEMPTS_TO_TRUST, WEAK_BELOW, STRONG_AT_OR_ABOVE } from "./_mastery-view.js";

/* Hur stor del av provet som får styras av elevens svagheter.
   Samma storleksordning som körkortsmodulens 40%, och av samma skäl: ett prov
   som BARA prövar det eleven är dålig på är demoraliserande, mäter inte om
   kunskapen sitter kvar i det de redan kan, och liknar inte det riktiga prov
   de tränar inför. */
export const MAX_WEAK_SHARE = 0.4;

/* Under så här många frågor blir viktningen meningslös — ett prov på tre
   frågor där en är "riktad" är inte adaptivt, det är slumpmässigt. */
export const MIN_QUESTIONS_FOR_FOCUS = 5;

/* Fler än så blir en lista modellen inte kan väga, och provet spretar. */
const MAX_FOCUS_CONCEPTS = 4;

/**
 * Väljer vilka begrepp nästa prov ska vikta mot.
 *
 * Bara BELAGDA begrepp (≥ MIN_ATTEMPTS_TO_TRUST försök) får styra. Ett begrepp
 * med ett enda felsvar bakom sig är tur eller otur, och att bygga ett helt prov
 * runt det vore att låta slumpen sätta elevens studieplan.
 *
 * @returns {{ weak: Array, strong: Array, maxFocusQuestions: number }}
 */
export function selectExamFocus(masteryRaw, { numQuestions = 10, now = new Date() } = {}) {
  const rows = readMastery(masteryRaw, { now }).filter(r => r.attempts >= MIN_ATTEMPTS_TO_TRUST);

  const weak = rows
    .filter(r => r.score < WEAK_BELOW)
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_FOCUS_CONCEPTS);

  /* Starka begrepp tas med av ett annat skäl än de svaga: de ska INTE dominera
     provet. Att tala om vilka de är låter modellen hålla dem närvarande utan
     att fylla provet med dem. */
  const strong = rows
    .filter(r => r.score >= STRONG_AT_OR_ABOVE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const maxFocusQuestions = numQuestions >= MIN_QUESTIONS_FOR_FOCUS
    ? Math.max(1, Math.floor(numQuestions * MAX_WEAK_SHARE))
    : 0;

  return { weak, strong, maxFocusQuestions };
}

/**
 * Instruktionen som läggs till provprompten. Tom sträng när det inte finns
 * belagd kunskap nog att styra på — då genereras provet precis som förut.
 *
 * @param lang  "sv" eller "en", följer resten av prompten
 */
export function buildFocusInstruction(focus, { lang = "sv" } = {}) {
  if (!focus?.weak?.length || !focus.maxFocusQuestions) return "";

  const weakNames = focus.weak.map(r => r.label);
  const strongNames = (focus.strong || []).map(r => r.label);

  if (lang === "en") {
    return [
      "",
      "STUDENT'S KNOWN WEAK AREAS:",
      `The student has repeatedly struggled with: ${weakNames.join(", ")}.`,
      `If — and only if — the pasted material covers these, let up to ${focus.maxFocusQuestions} question(s) target them.`,
      "Never invent content that is not in the material to hit a weak area.",
      strongNames.length ? `Already solid: ${strongNames.join(", ")}. Include at most one question on these.` : "",
      "Do not mention this list, the student's history, or that the exam is adapted. The exam must read as an ordinary exam.",
    ].filter(Boolean).join("\n");
  }

  return [
    "",
    "ELEVENS KÄNDA SVAGA OMRÅDEN:",
    `Eleven har återkommande svårt för: ${weakNames.join(", ")}.`,
    `Om — och bara om — det inklistrade materialet täcker dessa: låt upp till ${focus.maxFocusQuestions} fråga/frågor rikta sig mot dem.`,
    "Hitta ALDRIG på innehåll som saknas i materialet för att träffa ett svagt område. Materialet styr alltid.",
    strongNames.length ? `Sitter redan: ${strongNames.join(", ")}. Högst en fråga på dessa.` : "",
    /* Ett prov som annonserar att det är riktat mot elevens svagheter läses som
       en dom, inte som ett prov. Eleven ska möta ett vanligt prov. */
    "Nämn inte listan, elevens historik eller att provet är anpassat. Provet ska läsas som ett vanligt prov.",
  ].filter(Boolean).join("\n");
}
