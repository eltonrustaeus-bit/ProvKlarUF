#!/usr/bin/env node
/* tools/sync-skolverket.mjs — hämtar ExGens utbildningskatalog från Skolverkets
 * Syllabus API och skriver config/education-catalog.json.
 *
 * Varför en genererad fil i repot i stället för ett API-anrop per request:
 * läroplaner ändras några gånger om året, inte per minut. En fil i version
 * control går att granska i en diff, fungerar när Skolverkets API är nere, och
 * lägger inte 600 ms på varje elevs sidladdning. Kör om vid läroplansändring.
 *
 * Källa: https://api.skolverket.se/syllabus  (Skolverkets öppna data, CC BY 4.0)
 *
 * Kör:  node tools/sync-skolverket.mjs
 *       node tools/sync-skolverket.mjs --check   (bygger, skriver inte, sätter
 *                                                 exitkod 1 om filen är inaktuell)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "config", "education-catalog.json");
const BASE = "https://api.skolverket.se/syllabus/v1";

/* Gy25 slog igenom för utbildning som startar efter 2025-06-30. GY11-kurserna
   ligger kvar i API:t med canceledDate, och MÅSTE ligga kvar hos oss också —
   en elev som började 2024 läser fortfarande GY11-kurser och deras prov,
   felbank och mastery är knutna till de kurskoderna. */
const GY25_CUTOVER = "2025-07-01";

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      await new Promise(res => setTimeout(res, attempt * 1500));
    }
  }
}

/* Ett ämne räknas som aktivt om det inte har upphört. API:t sätter canceledDate
   på det datum regleringen slutar gälla — vi jämför mot dagens datum i stället
   för att bara kolla att fältet finns, eftersom ett kommande upphörandedatum
   inte gör ämnet inaktivt idag. */
function isActive(row, today) {
  return !row.canceledDate || row.canceledDate > today;
}

/* Vilken läroplan en gymnasiepost hör till. Gy25-ämnena är de som börjar gälla
   vid eller efter reformen; allt äldre är GY11. startDate finns på varje post. */
function gyCurriculum(subject) {
  return (subject.startDate || "") >= GY25_CUTOVER ? "GY25" : "GY11";
}

/* "Nivå 1" är obegripligt utan sitt ämne — Gy25 namnger nivåerna relativt
   ämnet, medan GY11 bakade in ämnesnamnet i kursnamnet ("Matematik 1b").
   displayName normaliserar de två så att elevens kursväljare kan visa en enda
   lista utan att hälften av raderna heter samma sak. */
function displayName(subjectName, levelName) {
  const n = String(levelName || "").trim();
  if (!n) return subjectName;
  if (/^Nivå\s/i.test(n)) return `${subjectName} – ${n}`;
  return n;
}

async function buildCatalog() {
  const today = new Date().toISOString().slice(0, 10);

  const [grRes, gyRes, pgRes] = await Promise.all([
    get(`${BASE}/subjects?schooltype=GR&timespan=LATEST`),
    get(`${BASE}/subjects?schooltype=GY&timespan=LATEST`),
    get(`${BASE}/programs?schooltype=GY&timespan=LATEST`),
  ]);

  const subjects = [];
  const levels = [];

  for (const s of grRes.subjects || []) {
    if (!isActive(s, today)) continue;
    subjects.push({
      code: s.code,
      name: s.name,
      schoolType: "GR",
      curriculum: "LGR22",
      active: true,
      categories: (s.categories || []).map(c => c.code),
    });
  }

  for (const s of gyRes.subjects || []) {
    const curriculum = gyCurriculum(s);
    const active = isActive(s, today);
    /* Utgångna GY11-ämnen behålls (se GY25_CUTOVER ovan). Utgångna Gy25-ämnen
       är däremot rena felaktigheter i vår katalog — de har aldrig hunnit läsas
       av någon som finns i databasen. */
    if (!active && curriculum === "GY25") continue;
    subjects.push({
      code: s.code,
      name: s.name,
      schoolType: "GY",
      curriculum,
      active,
      categories: (s.categories || []).map(c => c.code),
    });
    for (const c of s.courses || []) {
      levels.push({
        code: c.code,
        subjectCode: s.code,
        name: c.name,
        displayName: displayName(s.name, c.name),
        points: Number(c.points || c.point || 0) || null,
        sortOrder: c.sortOrder ?? null,
        curriculum,
        active,
      });
    }
  }

  /* studyPathType, inte startDate, avgör vilken läroplan ett program hör till.
     Gy25-programmen ligger under PROGRAM25 och de gamla under PROGRAM — ett
     filter på enbart "PROGRAM" ger en katalog där varje gymnasieprogram är
     utgånget, vilket är precis det fel som gör att en elev inte kan välja sitt
     eget program. FOURTH_TECHNICAL_YEAR är teknikprogrammets fjärde år och är
     ett eget studievägsval, inte en inriktning. */
  const PROGRAM_TYPES = {
    PROGRAM: { curriculum: "GY11", kind: "program" },
    PROGRAM25: { curriculum: "GY25", kind: "program" },
    FOURTH_TECHNICAL_YEAR: { curriculum: "GY11", kind: "fourth_year" },
    FOURTH_TECHNICAL_YEAR25: { curriculum: "GY25", kind: "fourth_year" },
  };

  const programs = (pgRes.programs || [])
    .filter(p => PROGRAM_TYPES[p.studyPathType])
    .map(p => ({
      code: p.code,
      name: p.name,
      category: p.category || null,
      kind: PROGRAM_TYPES[p.studyPathType].kind,
      curriculum: PROGRAM_TYPES[p.studyPathType].curriculum,
      active: isActive(p, today),
      orientations: (p.orientations || []).map(o => ({ code: o.code, name: o.name })),
    }));

  /* Vilka ämnen ett program faktiskt innehåller. Utan den kopplingen kan
     onboardingen bara fråga "vilka ämnen läser du?" och hoppas att eleven
     minns kurskoderna; med den kan den föreslå rätt ämnen direkt utifrån
     programvalet.
     Bara gymnasiegemensamma och programgemensamma ämnen tas med — de läser
     alla på programmet. specialization/ är 44 valbara ämnen per program och
     säger inget om den enskilda eleven. */
  const detailed = await Promise.all(
    programs.filter(p => p.active).map(async p => {
      const d = await get(`${BASE}/programs/${encodeURIComponent(p.code)}?timespan=LATEST`);
      const pick = group => (d?.program?.[group]?.subjects || []).map(s => s.code).filter(Boolean);
      return [p.code, [...new Set([...pick("foundationSubjects"), ...pick("programmeSpecificSubjects")])]];
    })
  );
  /* Ett programs ämneslista kan peka på koder vi inte har något ämne för
     (t.ex. MOSP, moderna språk, som inte listas som eget GY-ämne). De filtreras
     bort i stället för att döpas på gissning — en kod utan verifierat namn får
     inte nå en elev. Antalet skrivs ut så att en växande lucka syns vid sync. */
  const knownSubjects = new Set(subjects.map(s => s.code));
  const subjectsByProgram = new Map(detailed);
  const dropped = new Set();
  for (const p of programs) {
    const codes = subjectsByProgram.get(p.code);
    if (!codes?.length) continue;
    for (const c of codes) if (!knownSubjects.has(c)) dropped.add(c);
    p.subjectCodes = codes.filter(c => knownSubjects.has(c)).sort();
  }
  if (dropped.size) {
    console.warn(`Varning: ${dropped.size} ämneskod(er) i programmen saknar ämne i katalogen och utelämnas: ${[...dropped].sort().join(", ")}`);
  }

  subjects.sort((a, b) => a.code.localeCompare(b.code, "sv"));
  levels.sort((a, b) => a.code.localeCompare(b.code, "sv"));
  programs.sort((a, b) => a.code.localeCompare(b.code, "sv"));

  return {
    _source: "Skolverkets Syllabus API (https://api.skolverket.se/syllabus) — Skolverkets öppna data, CC BY 4.0",
    _generatedBy: "tools/sync-skolverket.mjs",
    apiVersion: gyRes.apiVersion || null,
    generatedAt: today,
    subjects,
    levels,
    programs,
  };
}

/* generatedAt ändras varje dygn och skulle annars göra --check rödt utan att
   någon läroplan rört sig. Jämförelsen bortser därför från de rent
   administrativa fälten och tittar bara på innehållet. */
function comparable(catalog) {
  const { generatedAt, apiVersion, ...rest } = catalog;
  return JSON.stringify(rest);
}

const check = process.argv.includes("--check");
const catalog = await buildCatalog();

if (check) {
  if (!fs.existsSync(OUT)) {
    console.error("config/education-catalog.json saknas — kör: node tools/sync-skolverket.mjs");
    process.exit(1);
  }
  const current = JSON.parse(fs.readFileSync(OUT, "utf8"));
  if (comparable(current) !== comparable(catalog)) {
    console.error("Katalogen är inaktuell mot Skolverkets API — kör: node tools/sync-skolverket.mjs");
    process.exit(1);
  }
  console.log("Katalogen är aktuell.");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 0) + "\n");
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`Skrev config/education-catalog.json (${kb} kB)`);
}

console.log(
  `ämnen: ${catalog.subjects.length} ` +
  `(GR ${catalog.subjects.filter(s => s.schoolType === "GR").length}, ` +
  `Gy25 ${catalog.subjects.filter(s => s.curriculum === "GY25").length}, ` +
  `GY11 ${catalog.subjects.filter(s => s.curriculum === "GY11").length}) · ` +
  `nivåer/kurser: ${catalog.levels.length} · ` +
  `program: ${catalog.programs.length} (aktiva ${catalog.programs.filter(p => p.active).length})`
);
