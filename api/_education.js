// api/_education.js — ExGens utbildningskatalog och elevprofilens fältdefinitioner.
//
// Katalogen (config/education-catalog.json) genereras av tools/sync-skolverket.mjs
// ur Skolverkets Syllabus API. Ingenting här hittar på ett ämne, en kurs, en
// nivå eller ett program: kan en kod inte slås upp i katalogen avvisas den.
// Det är hela skillnaden mot den handskrivna kurslistan den ersätter.
//
// GY11 och Gy25 finns båda. En elev som började före ämnesbetygsreformen läser
// kurser ("Matematik 1b", MATMAT01b); en som börjat efter läser nivåer inom ett
// ämne ("Matematik – Nivå 1b", MATE1000B). Båda måste gå att välja, och båda
// måste gå att koppla till gammal provhistorik.

import fs from "fs";
import path from "path";

let _catalog = null;

/* Läses en gång per kall funktionsinstans. Filen ligger i config/ och måste
   följa med i Vercel-bundlen — se includeFiles i vercel.json. Saknas den
   returneras en tom katalog i stället för att kasta: en utebliven kurslista
   ska försämra personaliseringen, inte fälla P.E.R:s svar. */
export function getCatalog() {
  if (_catalog) return _catalog;
  try {
    const file = path.join(process.cwd(), "config", "education-catalog.json");
    _catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    _catalog = { subjects: [], levels: [], programs: [], generatedAt: null };
  }
  _catalog.subjectByCode = new Map(_catalog.subjects.map(s => [s.code, s]));
  _catalog.levelByCode = new Map(_catalog.levels.map(l => [l.code, l]));
  _catalog.programByCode = new Map(_catalog.programs.map(p => [p.code, p]));
  return _catalog;
}

export function findSubject(code) { return getCatalog().subjectByCode.get(String(code || "")) || null; }
export function findLevel(code)   { return getCatalog().levelByCode.get(String(code || "")) || null; }
export function findProgram(code) { return getCatalog().programByCode.get(String(code || "")) || null; }

/* ── Gammal fritextkurs → katalogpost ──────────────────────────────────────
 *
 * user_exams.course och mock_results.course är fritext och har varit det i över
 * ett år: "Matematik 1b", "matematik 1b ", "Historia (grundskola)". All
 * befintlig provhistorik och hela felbanken hänger på de strängarna. Utan en
 * översättning hit hade katalogen bara gällt prov som skapas från och med nu,
 * och P.E.R. hade inte kunnat säga något om vad eleven redan gjort.
 *
 * Matchningen är avsiktligt konservativ — exakt namn efter normalisering, inget
 * fuzzy. En felmatchad kurs får P.E.R. att prata om fel ämne, vilket är värre
 * än att inte matcha alls. */
const GRUNDSKOLA_SUFFIX = /\s*\(grundskola\)\s*$/i;

function normalizeCourseName(text) {
  return String(text || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("sv");
}

let _courseIndex = null;

function courseIndex() {
  if (_courseIndex) return _courseIndex;
  const cat = getCatalog();
  _courseIndex = new Map();
  /* Inget kursnamn finns i båda läroplanerna: GY11 bakar in ämnet i kursnamnet
     ("Matematik 1b") medan Gy25 numrerar nivåer inom ämnet och därför får
     displayName "Matematik – Nivå 1b". Uppmätt över hela katalogen, och låst av
     "inget kursnamn tillhör två läroplaner" i tests/education/.
     Skulle en framtida läroplansändring skapa en krock ska det testet falla så
     att valet görs medvetet — inte tystas av att indexet råkar fyllas i en viss
     ordning. */
  for (const level of cat.levels) {
    for (const name of [level.name, level.displayName]) {
      const key = normalizeCourseName(name);
      if (key && !_courseIndex.has(key)) _courseIndex.set(key, level);
    }
  }
  return _courseIndex;
}

/**
 * Slår upp en fritextkurs i katalogen.
 * @returns {{ levelCode: string|null, subjectCode: string, name: string, curriculum: string }|null}
 */
export function resolveCourse(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // "Matematik (grundskola)" — grundskolan har ämnen, inte kurser.
  if (GRUNDSKOLA_SUFFIX.test(raw)) {
    const wanted = normalizeCourseName(raw.replace(GRUNDSKOLA_SUFFIX, ""));
    const subject = getCatalog().subjects.find(
      s => s.schoolType === "GR" && normalizeCourseName(s.name) === wanted
    );
    return subject
      ? { levelCode: null, subjectCode: subject.code, name: subject.name, curriculum: "LGR22" }
      : null;
  }

  const level = courseIndex().get(normalizeCourseName(raw));
  if (level) {
    return {
      levelCode: level.code,
      subjectCode: level.subjectCode,
      name: level.displayName,
      curriculum: level.curriculum,
    };
  }

  // Rena ämnesnamn utan nivå ("Juridik") duger som ämneskoppling.
  const wanted = normalizeCourseName(raw);
  const subject = getCatalog().subjects.find(
    s => s.schoolType === "GY" && s.active && normalizeCourseName(s.name) === wanted
  );
  return subject
    ? { levelCode: null, subjectCode: subject.code, name: subject.name, curriculum: subject.curriculum }
    : null;
}

/* ── Elevprofilens fält ────────────────────────────────────────────────────
 *
 * En rad per uppgift P.E.R. får veta. Listan är stängd med flit: en nyckel som
 * inte står här kan inte skrivas, inte visas och inte hamna i en prompt. Det är
 * dataminimering i kod i stället för i en instruktion som en modell kan tolka
 * fritt.
 *
 * label används i "Vad P.E.R. vet om mig" — därför står den här och inte i
 * frontend, så att ett nytt fält aldrig kan visas som en rå nyckel för en elev.
 * format() gör värdet läsbart; ett kursnummer säger ingenting för den som ska
 * bedöma om uppgiften stämmer.
 */
const GRADES = ["E", "D", "C", "B", "A"];
const HELP_STYLES = {
  stegvis: "Steg för steg",
  ledtrad_forst: "Ledtråd först, svar sen",
  kort: "Korta svar",
  utforlig: "Utförliga förklaringar",
};

function cleanFreeText(value, maxLen) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLen);
  return text || null;
}

function codeList(value, max, lookup) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const raw of value.slice(0, max * 3)) {
    if (out.length >= max) break;
    const code = String(raw || "").trim();
    if (code && lookup(code) && !out.includes(code)) out.push(code);
  }
  return out.length ? out : null;
}

function subjectNames(codes) {
  return codes.map(c => findSubject(c)?.name || c).join(", ");
}

export const PROFILE_FIELDS = Object.freeze({
  school_type: {
    label: "Skolform",
    personas: ["elev"],
    parse: v => (["grundskola", "gymnasium"].includes(v) ? v : null),
    format: v => (v === "grundskola" ? "Grundskolan" : "Gymnasiet"),
  },
  grade_year: {
    label: "Årskurs",
    personas: ["elev"],
    /* 1–9 för grundskolan, 1–4 för gymnasiet (fyra på grund av
       teknikprogrammets fjärde år). Intervallet kontrolleras mot school_type i
       validateProfileValues() — här räcker det yttre spannet. */
    parse: v => (Number.isInteger(v) && v >= 1 && v <= 9 ? v : null),
    format: (v, facts) =>
      facts?.school_type === "gymnasium" ? `År ${v} på gymnasiet` : `Årskurs ${v}`,
  },
  program_code: {
    label: "Gymnasieprogram",
    personas: ["elev"],
    parse: v => (findProgram(v)?.active ? String(v) : null),
    format: v => findProgram(v)?.name || v,
  },
  orientation: {
    label: "Inriktning",
    personas: ["elev"],
    parse: v => cleanFreeText(v, 80),
    format: v => v,
  },
  school_name: {
    label: "Skola",
    personas: ["elev", "larare"],
    parse: v => cleanFreeText(v, 80),
    format: v => v,
  },
  subject_codes: {
    label: "Ämnen",
    personas: ["elev", "larare"],
    parse: v => codeList(v, 12, findSubject),
    format: v => subjectNames(v),
  },
  level_codes: {
    label: "Kurser och nivåer",
    personas: ["elev"],
    parse: v => codeList(v, 12, findLevel),
    format: v => v.map(c => findLevel(c)?.displayName || c).join(", "),
  },
  goal_grade: {
    label: "Målbetyg",
    personas: ["elev"],
    parse: v => (GRADES.includes(String(v).toUpperCase()) ? String(v).toUpperCase() : null),
    format: v => v,
  },
  focus_note: {
    label: "Vill ha hjälp med",
    personas: ["elev", "larare", "foralder"],
    parse: v => cleanFreeText(v, 200),
    format: v => v,
  },
  exam_date: {
    label: "Nästa prov",
    personas: ["elev"],
    /* Ett datum, inte en tidsstämpel. Om provet är om tre dagar ska P.E.R.
       rekommendera repetition i stället för nytt stoff — den enda uppgiften i
       hela profilen som ensam kan ändra vad nästa steg borde vara. */
    parse: v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v)) ? String(v) : null),
    format: v => v,
  },
  help_style: {
    label: "Föredrar",
    personas: ["elev"],
    parse: v => (HELP_STYLES[v] ? v : null),
    format: v => HELP_STYLES[v] || v,
  },
  teaches_grades: {
    label: "Undervisar i årskurser",
    personas: ["larare"],
    parse: v => cleanFreeText(v, 80),
    format: v => v,
  },
});

export const PROFILE_KEYS = Object.freeze(Object.keys(PROFILE_FIELDS));
export const PERSONAS = Object.freeze(["elev", "larare", "foralder"]);

/**
 * Validerar en uppsättning profilvärden mot fältdefinitionerna ovan.
 * Okända nycklar och ogiltiga värden slängs tyst i stället för att avvisa hela
 * anropet — en klient som skickar ett fält vi tagit bort ska inte kunna hindra
 * eleven från att spara resten av sin profil.
 *
 * @returns {{ values: Record<string, unknown>, rejected: string[] }}
 */
export function validateProfileValues(input, { persona = "elev" } = {}) {
  const values = {};
  const rejected = [];
  if (!input || typeof input !== "object") return { values, rejected };

  for (const [key, raw] of Object.entries(input)) {
    const field = PROFILE_FIELDS[key];
    if (!field || !field.personas.includes(persona)) { rejected.push(key); continue; }
    const parsed = field.parse(raw);
    if (parsed === null || parsed === undefined) { rejected.push(key); continue; }
    values[key] = parsed;
  }

  /* Årskursen måste stämma med skolformen. Kontrollen ligger här och inte i
     parse() eftersom den behöver se två fält samtidigt — en fyra i grundskolan
     är rimlig, en åtta på gymnasiet är det inte. */
  if (values.grade_year !== undefined) {
    const schoolType = values.school_type;
    const max = schoolType === "gymnasium" ? 4 : schoolType === "grundskola" ? 9 : 9;
    if (values.grade_year > max) { delete values.grade_year; rejected.push("grade_year"); }
  }

  /* Ett program utan gymnasium är motsägelsefullt, och P.E.R. skulle presentera
     motsägelsen som fakta. Programmet vinner: det är det mer specifika valet. */
  if (values.program_code && values.school_type === "grundskola") {
    delete values.school_type;
    rejected.push("school_type");
  }

  return { values, rejected };
}

/** Föreslagna ämnen för ett program — så onboardingen slipper fråga efter kurskoder. */
export function subjectsForProgram(code) {
  const program = findProgram(code);
  if (!program?.subjectCodes?.length) return [];
  return program.subjectCodes.map(c => findSubject(c)).filter(Boolean);
}
