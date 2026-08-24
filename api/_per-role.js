// api/_per-role.js — vilken pedagogisk roll situationen kräver.
//
// P.E.R. bytte redan beteende: helpLevel 0 är sokratisk, 1–2 är undervisande,
// `quiz` är examinerande, `feynman` är återkopplande, intent 'support' är
// kontohjälp. Det som saknades var de två roller som kräver kunskap om vad
// eleven faktiskt kan — och den kunskapen fanns inte förrän mastery började
// skrivas (#91) och backfillas (#94).
//
//   STUDIEPLANERARE  Eleven frågar vad de ska göra. Vi VET svaret —
//                    decideNextFocus() räknar ut det ur elevens egna prov. Utan
//                    en roll som säger åt P.E.R. att använda det gissar den, och
//                    en gissad studieplan bredvid en uträknad är sämre än ingen.
//
//   UTMANARE         Eleven frågar om något de bevisligen redan kan. Att förklara
//                    grunderna igen är att slösa deras tid; att höja ribban är
//                    det enda svaret som ger dem något.
//
// Rollen är ALDRIG ett läge eleven väljer eller ser. Uppdragets §11 är tydlig
// med det: P.E.R. ska förstå vilket beteende som passar, inte fråga.

import { readMastery, MIN_ATTEMPTS_TO_TRUST, STRONG_AT_OR_ABOVE } from "./_mastery-view.js";
import { conceptKey } from "./_concept-tags.js";

export const PER_ROLE = Object.freeze({
  /** Eleven frågar vad de ska plugga på. Svaret är uträknat, inte gissat. */
  PLANNER: "planner",
  /** Eleven frågar om något de redan bevisat att de kan. */
  CHALLENGER: "challenger",
  /** Inget särskilt — de befintliga lägena (helpLevel, quiz, feynman) styr. */
  DEFAULT: "default",
});

/* "Vad ska jag göra?" i sina vanliga former. Medvetet snäv: en elev som frågar
   "hur gör jag för att lösa den här" ber om hjälp med UPPGIFTEN, inte om en
   studieplan, och ska mötas av den vanliga pedagogiken. */
export const PLANNER_REGEX =
  /\b(vad|vilket|var)\b[^?.!]{0,30}\b(ska|bör|borde|skulle)\b[^?.!]{0,20}\b(jag|man|vi)\b[^?.!]{0,25}\b(göra|plugga|träna|öva|fokusera|börja|repetera|läsa på)\b|vad (?:är|blir) nästa|vad gör jag (?:nu|härnäst)|var (?:ska|bör) jag börja|hjälp mig (?:planera|prioritera)|vad behöver jag (?:träna|öva|jobba)/i;

/* Elever ber sällan rakt ut om svårare frågor, men när de gör det är signalen
   entydig. Rollen utlöses främst av MÄTNING, inte av de här orden. */
export const CHALLENGE_REGEX =
  /\b(svårare|utmana|utmaning|för lätt|för enkelt|kan redan|nästa nivå|högre nivå|mer avancerat)\b/i;

/**
 * Avgör rollen.
 *
 * Ordningen är inte godtycklig. Ett pågående prov slår allt: eleven har en
 * klocka som tickar, och en studieplan mitt i ett prov är fel svar på fel
 * fråga. Efter det går planeraren före utmanaren — frågar eleven vad de ska
 * göra ska de få veta det, även om de råkar vara starka i ämnet.
 *
 * @param opts.topic  vad frågan gäller, när sidan vet det
 * @returns {{ role: string, concept: object|null }}
 */
export function decidePerRole({ userQuestion = "", pageContext = null, mastery = null, topic = "", now = new Date() } = {}) {
  const q = String(userQuestion || "");
  const inExam = pageContext?.examState?.phase === "exam" || Boolean(pageContext?.currentQuestion?.text);
  if (inExam) return { role: PER_ROLE.DEFAULT, concept: null };

  if (PLANNER_REGEX.test(q)) return { role: PER_ROLE.PLANNER, concept: null };

  /* Utmanaren kräver BELÄGG. Att höja ribban för någon som bara råkat ha tur en
     gång är att sätta dem på ett prov de inte klarar och kalla det förtroende. */
  const rows = readMastery(mastery, { now }).filter(r => r.attempts >= MIN_ATTEMPTS_TO_TRUST);
  const nyckel = conceptKey(topic || q);
  const träffad = nyckel ? rows.find(r => r.key === nyckel) : null;

  if (träffad && träffad.score >= STRONG_AT_OR_ABOVE) {
    return { role: PER_ROLE.CHALLENGER, concept: träffad };
  }
  if (CHALLENGE_REGEX.test(q) && rows.some(r => r.score >= STRONG_AT_OR_ABOVE)) {
    return { role: PER_ROLE.CHALLENGER, concept: null };
  }

  return { role: PER_ROLE.DEFAULT, concept: null };
}

/**
 * Rollens instruktion. Tom sträng för DEFAULT — då styr de befintliga lägena,
 * och en tom rad är bättre än en som säger "gör som vanligt".
 */
export function buildRoleInstruction(role, { concept = null } = {}) {
  if (role === PER_ROLE.PLANNER) {
    return [
      "## ELEVEN FRÅGAR VAD DE SKA GÖRA",
      "",
      "Du har ett uträknat svar i kunskapsläget ovan — använd DET. Gissa inte, och",
      "räkna inte upp allt eleven är dålig på.",
      "",
      "Ge EN sak att göra härnäst och säg varför, i en mening. Finns inget uträknat",
      "underlag: säg rakt att du inte har nog med data än, och föreslå ett prov så",
      "att du får det. Ett ärligt \"jag vet inte än\" är bättre än en påhittad plan.",
    ].join("\n");
  }

  if (role === PER_ROLE.CHALLENGER) {
    const namn = concept?.label;
    return [
      "## ELEVEN KAN DET HÄR REDAN",
      "",
      namn
        ? `${namn} sitter enligt elevens egna prov. Att förklara grunderna igen slösar deras tid.`
        : "Eleven har visat att de sitter på grunderna i det här.",
      "",
      "Hoppa över definitionen. Gå direkt på det som är svårare: ett gränsfall, ett",
      "undantag, en tillämpning som kräver att de kombinerar två saker de kan.",
      "Säg inte att du höjer nivån — gör det bara.",
    ].join("\n");
  }

  return "";
}
