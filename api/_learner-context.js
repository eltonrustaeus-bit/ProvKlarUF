// api/_learner-context.js — allt P.E.R. vet om eleven, i ETT block.
//
// FÖRE: fem separata avsnitt om samma person nådde prompten vid varje fråga —
// "Elevhistorik", "## ELEVPROFIL (långtidsminne)", "## FAKTISK PROV- OCH
// FELBANKSDATA", "## OM ELEVEN" och "## ELEVENS KUNSKAPSLÄGE". De byggdes av
// fyra olika filer som inte visste om varandra, och gav upp till tre svar på
// samma fråga:
//
//   "Vad är eleven svag på?"
//     structured.weak_topics            AI:s gissning ur chatthistoriken
//     structured.mock_weak_concepts     AI:s extraktion ur provresultat
//     user_profiles.mastery             uppmätt per begrepp, med antal försök
//
//   "Hur vill eleven ha hjälp?"
//     structured.preferred_help_level   härlett ur klickmönster
//     learner_profile_facts.help_style  eleven har svarat på frågan
//
// Två av tre svar var gissningar, och ingenting rangordnade dem. En modell som
// får motstridiga påståenden om samma elev väljer själv vilket som gäller.
//
// EFTER: en rangordning, tillämpad i kod.
//
//   1. UPPMÄTT     mastery, provresultat ur databasen
//   2. SAGT        det eleven själv fyllt i
//   3. HÄRLETT     AI-extraktion och beteendemönster
//
// En lägre nivå får aldrig upprepa något en högre redan sagt. Det är inte bara
// snyggare — det är billigare (färre tokens per fråga) och ärligare, eftersom
// en gissning som står bredvid en mätning läses som lika säker.

import { buildMasteryContext, readMastery, MIN_ATTEMPTS_TO_TRUST } from "./_mastery-view.js";
import { conceptKey } from "./_concept-tags.js";
import { buildProfileContext } from "./_learner-profile.js";

/* Hjälpnivå 0–3 (se api/_per-help.js) till samma ord som elevens egna val i
   onboardingen. Utan översättningen skulle P.E.R. få "preferred_help_level: 2"
   bredvid "Föredrar: Steg för steg" och behöva gissa att de hör ihop. */
const HELP_LEVEL_AS_STYLE = { 0: "ledtrad_forst", 1: "kort", 2: "stegvis", 3: "stegvis" };

export function helpLevelToStyle(level) {
  return HELP_LEVEL_AS_STYLE[Number(level)] ?? null;
}

/**
 * Begrepp som redan är UPPMÄTTA. AI:ns gissningar om samma begrepp
 * undertrycks — mätningen vet antal försök, gissningen vet ingenting.
 */
function measuredConcepts(masteryRaw, { now }) {
  const set = new Set();
  for (const row of readMastery(masteryRaw, { now })) {
    if (row.attempts >= MIN_ATTEMPTS_TO_TRUST) set.add(row.key);
  }
  return set;
}

/**
 * Filtrerar en lista AI-härledda ämnen mot det som redan är uppmätt.
 * Returnerar bara det mätningen INTE täcker.
 */
export function dropMeasured(topics, measured) {
  if (!Array.isArray(topics)) return [];
  const out = [];
  for (const t of topics) {
    const key = conceptKey(t);
    // Utan nyckel är taggen skräp (frågetyp, "okänt") och ska aldrig vidare.
    if (!key || measured.has(key)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/* Rader som bygger på riktiga databasvärden. De är uppmätta, inte härledda, och
   har därför ingen motsvarighet högre upp som kan undertrycka dem. */
function measuredLines(structured) {
  const lines = [];
  if (!structured) return lines;

  const kat = structured.exam_weak_categories;
  if (Array.isArray(kat) && kat.length) {
    lines.push(`Svaga kategorier i körkortsteorin: ${kat.slice(0, 5).join(", ")}`);
  }

  /* Trenden räknas ur riktiga provpoäng. score_trajectory (AI-extraherad ur
     chatten) används bara när inga riktiga poäng finns, och märks då som osäker
     längre ner i stället för att stå här. */
  for (const [namn, serie] of [["Mockprov", structured.mock_recent_scores], ["Teoriprov", structured.exam_recent_scores]]) {
    if (!Array.isArray(serie) || serie.length < 2) continue;
    const delta = Math.round(serie[serie.length - 1] - serie[0]);
    lines.push(`${namn} senaste ${serie.length}: ${serie.join("%, ")}% (${delta >= 0 ? "+" : ""}${delta}%)`);
  }

  const räknat = [];
  if (structured.exam_count > 0) räknat.push(`${structured.exam_count} prov`);
  if (structured.sessions_total > 0) räknat.push(`${structured.sessions_total} sessioner`);
  if (structured.last_module && structured.last_module !== "unknown") räknat.push(`senast i ${structured.last_module}`);
  if (räknat.length) lines.push(räknat.join(" · "));

  return lines;
}

/* Härledda rader. Allt här är en gissning och märks som en. */
function inferredLines(structured, measured) {
  const lines = [];
  if (!structured) return lines;

  const svaga = dropMeasured(
    [...(structured.mock_weak_concepts || []), ...(structured.felbank_weak_concepts || []), ...(structured.weak_topics || [])],
    measured
  ).slice(0, 5);
  if (svaga.length) lines.push(`Kan behöva träning (ej belagt): ${svaga.join(", ")}`);

  const starka = dropMeasured(structured.strong_topics, measured).slice(0, 3);
  if (starka.length) lines.push(`Verkar sitta: ${starka.join(", ")}`);

  const feltyper = structured.felbank_error_types;
  if (Array.isArray(feltyper) && feltyper.length) {
    lines.push(`Återkommande feltyper: ${feltyper.slice(0, 4).join(", ")}`);
  }

  if (structured.study_pattern && structured.study_pattern !== "unknown") {
    lines.push(`Studiemönster: ${structured.study_pattern}`);
  }
  return lines;
}

/* Hjälpstil i klartext, för den härledda listan. Samma ord som elevens egna val
   i onboardingen, så att P.E.R. inte behöver gissa att de hör ihop. */
const STYLE_TEXT = {
  stegvis: "steg för steg",
  ledtrad_forst: "ledtråd först, svar sen",
  kort: "korta svar",
  utforlig: "utförliga förklaringar",
};

/**
 * Bygger hela elevkontexten.
 *
 * @param sources.profile     loadProfile() — det eleven själv sagt
 * @param sources.mastery     user_profiles.mastery — uppmätt per begrepp
 * @param sources.structured  per_long_memory.structured — AI-extraherat
 * @param sources.summary     per_long_memory.summary — AI-skriven fritext
 * @param options.topic       vad frågan gäller, om sidan vet det
 * @param options.profileEnabled  om elevprofilen är utrullad för användaren
 * @returns {string} tom sträng när ingenting är värt att skicka
 */
export function buildLearnerContext({
  profile = null, mastery = null, structured = null, summary = null,
} = {}, { topic = "", now = new Date(), profileEnabled = false } = {}) {
  /* Hjälpnivån renderades tidigare som ett eget promptavsnitt
     ("## ELEVPROFIL — FÖRKLARINGSDJUP") samtidigt som elevprofilen kunde säga
     "Föredrar: Steg för steg" om samma sak. Samma rangordning gäller här som
     överallt annars: har eleven svarat på frågan vinner svaret, och den härledda
     signalen utelämnas helt i stället för att stå bredvid. */
  const sagdStil = profileEnabled ? profile?.facts?.help_style : null;
  const härleddStil = sagdStil ? null : helpLevelToStyle(structured?.preferred_help_level);
  const measured = measuredConcepts(mastery, { now });

  const blocks = [];

  // 1. UPPMÄTT — kunskapsläget per begrepp, med sitt eget nästa-steg.
  const masteryBlock = buildMasteryContext(mastery, { now, topic });
  if (masteryBlock) blocks.push(masteryBlock);

  // 2. SAGT — det eleven fyllt i själv. Ligger bakom sin egen utrullningsflagga.
  const profileBlock = profileEnabled ? buildProfileContext(profile, { topic, now }) : "";
  if (profileBlock) blocks.push(profileBlock);

  // 3. Resten, i ett block med tydlig gradering inuti.
  const mätt = measuredLines(structured);
  const härlett = inferredLines(structured, measured);
  if (härleddStil && STYLE_TEXT[härleddStil]) {
    härlett.push(`Brukar be om ${STYLE_TEXT[härleddStil]} — börja där om frågan inte antyder annat.`);
  }
  const fritext = summary ? String(summary).trim() : "";

  if (mätt.length || härlett.length || fritext) {
    const rader = ["## ELEVENS HISTORIK", ""];
    if (mätt.length) rader.push(...mätt.map(r => `- ${r}`));
    if (härlett.length) {
      rader.push("", "Härlett ur elevens beteende — låt det påverka HUR du svarar, men påstå det aldrig som fakta:");
      rader.push(...härlett.map(r => `- ${r}`));
    }
    if (fritext) {
      rader.push("", "Sammanfattning från tidigare samtal (kan vara inaktuell):", fritext);
    }
    blocks.push(rader.join("\n"));
  }

  if (!blocks.length) return "";

  /* Företrädesregeln står SIST. Senare instruktioner väger tyngre än tidigare i
     en systemprompt, och den här måste vinna över allt ovanför den. */
  blocks.push(
    [
      "## SÅ ANVÄNDER DU UPPGIFTERNA OVAN",
      "",
      "Låt dem forma svaret — nivå, längd och exempel. Nämn en uppgift bara när det",
      "gör svaret bättre, och då i en bisats, aldrig som en lista.",
      "Motsäger de varandra väger uppmätt tyngst, sedan det eleven själv sagt, sist",
      "det härledda. Säg aldrig emot en mätning med en gissning.",
    ].join("\n")
  );

  return blocks.join("\n\n");
}
