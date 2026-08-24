// api/_math-curriculum.js — grundskolans matematik som P.E.R. kan resonera om.
//
// config/math-curriculum.json genereras av tools/sync-math-curriculum.mjs ur
// Skolverkets läroplan. Den här filen är enda vägen in i den, och håller isär
// två saker som aldrig får blandas ihop:
//
//   SKOLVERKETS TEXT   centralt innehåll och betygskriterier, ordagrant.
//                      Får citeras som läroplan.
//
//   EXGENS BEDÖMNING   prerequisite-kedjan. Skolverket säger vad som ska läras i
//                      varje stadium, aldrig att procent förutsätter bråk.
//                      Får ALDRIG citeras som läroplan.
//
// Slutmålet i pilotplanen är att gå från "eleven fick 6/10" till "eleven har
// problem med procent, och resultaten tyder på att grunderna i bråk behöver
// stärkas först". Det andra påståendet är bara försvarbart om det är tydligt
// vem som säger vad.

import fs from "fs";
import path from "path";

let _curriculum = null;

export function getMathCurriculum() {
  if (_curriculum) return _curriculum;
  try {
    _curriculum = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "config", "math-curriculum.json"), "utf8")
    );
  } catch {
    // Utan läroplan ska P.E.R. tappa läroplanskopplingen, inte fela.
    _curriculum = { centralContent: [], criteria: [], prerequisites: {}, subject: {} };
  }
  return _curriculum;
}

export const STAGES = Object.freeze(["1-3", "4-6", "7-9"]);

/** Områdena i ett stadium, med Skolverkets egna punkter. */
export function areasForStage(stage) {
  return getMathCurriculum().centralContent.filter(a => a.stage === stage);
}

export function findArea(stage, key) {
  return areasForStage(stage).find(a => a.key === key) || null;
}

/* Årskurs till stadium. Betygskriterier finns bara för år 3, 6 och 9, medan
   eleven kan gå i vilken årskurs som helst. */
export function stageForYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  if (y <= 3) return "1-3";
  if (y <= 6) return "4-6";
  if (y <= 9) return "7-9";
  return null;
}

/**
 * Betygskriteriet för en årskurs och ett betygssteg, ordagrant ur läroplanen.
 * Kriterier sätts vid stadiets slut, så en elev i åk 8 bedöms mot åk 9:s.
 */
export function criterionFor(year, grade = "E") {
  const stage = stageForYear(year);
  /* Ingen giltig årskurs, inget kriterium. Utan den här raden föll varje okänt
     värde igenom till årskurs 9 — en elev med felaktigt ifylld årskurs hade
     bedömts mot grundskolans slutkriterium utan att någon sett det. */
  if (!stage) return null;
  const målår = stage === "1-3" ? "3" : stage === "4-6" ? "6" : "9";
  return getMathCurriculum().criteria.find(
    c => c.year === målår && c.grade === String(grade).toUpperCase()
  ) || null;
}

/**
 * Vad ett område rimligen förutsätter — ExGens bedömning.
 *
 * Returnerar alltid bedömningen märkt som sådan. En konsument som glömmer
 * markeringen ska inte kunna göra det av misstag: fältet heter `source` och
 * innehåller "exgen", aldrig "skolverket".
 *
 * @returns {Array<{ stage, key, area, why, source }>}
 */
export function prerequisitesFor(areaKey, { stage = "7-9" } = {}) {
  const c = getMathCurriculum();
  // Kedjan är definierad för 7-9. Tidigare stadier har inga föregångare i modellen.
  if (stage !== "7-9") return [];
  return (c.prerequisites[areaKey] || []).map(p => ({
    stage: p.stage,
    key: p.key,
    area: findArea(p.stage, p.key)?.area || p.key,
    why: p.why,
    source: "exgen",
  }));
}

/* ── Från begrepp till läroplansområde ─────────────────────────────────────
 *
 * Elevens mastery-nycklar kommer från modellens concept_tag ("Procent",
 * "Konjugatregeln"). Läroplanen talar om områden ("Samband och förändring").
 * Utan en brygga kan P.E.R. veta att eleven är svag på procent utan att kunna
 * koppla det till något i läroplanen — och då inte heller till vad det
 * förutsätter.
 *
 * Bryggan är ordlistor, inte en modell. Ett felaktigt områdesbyte skickar
 * eleven till fel repetition, och det är värre än ingen koppling alls.
 * Träffar inget mönster returneras null, och P.E.R. arbetar utan
 * läroplanskoppling precis som förut.
 */
const AREA_HINTS = Object.freeze([
  ["samband_och_förändring", /\b(procent|procentuell|andel|förändringsfaktor|proportion|proportionalitet|ränta|rabatt|höjning|sänkning|graf|linjär funktion|funktion|koordinatsystem|hastighet|skala.{0,12}förändring)\b/i],
  ["algebra", /\b(algebra|ekvation|ekvationer|uttryck|variabel|obekant|förenkla|faktorisera|faktorisering|parentes|konjugatregeln|kvadreringsregl|potenslag|olikhet|formel)\b/i],
  ["geometri", /\b(geometri|area|omkrets|volym|vinkel|vinklar|triangel|cirkel|rektangel|pythagoras|skala|likformig|symmetri|kon|cylinder|klot|prisma)\b/i],
  ["sannolikhet_och_statistik", /\b(sannolikhet|statistik|medelvärde|median|typvärde|diagram|stapeldiagram|cirkeldiagram|lådagram|spridning|kombinatorik|utfall)\b/i],
  ["taluppfattning_och_tals_användning", /\b(bråk|bråktal|decimal|decimaltal|negativa tal|potens|potensform|grundpotensform|kvadratrot|rot ur|primtal|delbarhet|räknesätt|prioriteringsregl|överslag|avrundning|reella tal)\b/i],
  ["problemlösning", /\b(problemlösning|problemlösningsstrategi|matematisk modell|modellering|tolka.{0,10}problem)\b/i],
]);

/**
 * Gissar vilket läroplansområde ett begrepp hör till.
 * @returns {{ key, area, stage }|null} null när inget mönster träffar
 */
export function areaForConcept(text, { stage = "7-9" } = {}) {
  const t = String(text || "");
  if (!t.trim()) return null;
  for (const [key, mönster] of AREA_HINTS) {
    if (mönster.test(t)) {
      const a = findArea(stage, key);
      if (a) return { key, area: a.area, stage };
    }
  }
  return null;
}

/**
 * Hela kedjan för ett begrepp eleven har svårt för: vilket område det hör till,
 * och vad det området rimligen förutsätter.
 *
 * Det här är funktionen som gör pilotplanens slutmål möjligt — att gå från
 * "problem med procent" till "grunderna i bråk behöver stärkas först".
 */
export function traceConcept(conceptLabel, { stage = "7-9" } = {}) {
  const area = areaForConcept(conceptLabel, { stage });
  if (!area) return null;
  return { concept: String(conceptLabel), ...area, prerequisites: prerequisitesFor(area.key, { stage }) };
}

/**
 * Läroplansblocket till P.E.R:s prompt. Tom sträng när inget område träffas.
 *
 * Skolverkets text och ExGens bedömning står i separata avsnitt med olika
 * rubriker, och instruktionen säger uttryckligen vad P.E.R. får påstå om vad.
 */
export function buildCurriculumContext(conceptLabel, { stage = "7-9", year = null } = {}) {
  const spår = traceConcept(conceptLabel, { stage });
  if (!spår) return "";

  const omr = findArea(stage, spår.key);
  const rader = [
    "## LÄROPLANEN FÖR DET HÄR OMRÅDET",
    "",
    `Området heter "${spår.area}" i kursplanen för matematik, årskurs ${stage}.`,
  ];

  if (omr?.points?.length) {
    rader.push("", "Centralt innehåll (Skolverkets egen text — får citeras):");
    rader.push(...omr.points.slice(0, 6).map(p => `- ${p}`));
  }

  const krit = year ? criterionFor(year, "E") : null;
  if (krit) {
    rader.push("", `Betygskriterium för E (Skolverkets egen text, årskurs ${krit.year}):`, krit.text.slice(0, 400));
  }

  if (spår.prerequisites.length) {
    rader.push(
      "",
      "Vad området rimligen bygger på — ExGens bedömning, INTE Skolverkets:",
      ...spår.prerequisites.map(p => `- ${p.area} (årskurs ${p.stage}): ${p.why}`),
      "",
      "Säg aldrig att Skolverket eller läroplanen kräver den ordningen. Formulera det",
      "som din egen bedömning: \"det här brukar bygga på…\", inte \"enligt kursplanen\".",
    );
  }

  return rader.join("\n");
}
