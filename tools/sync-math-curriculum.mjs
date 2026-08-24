#!/usr/bin/env node
/* tools/sync-math-curriculum.mjs — grundskolans matematik ur Skolverkets
 * läroplan, som struktur i stället för HTML.
 *
 * Skolverkets Syllabus API ger centralt innehåll och betygskriterier som HTML i
 * ett textfält. Det går inte att fråga "vilka områden finns i årskurs 7-9" utan
 * att först bryta isär det. Skriptet gör det en gång och skriver
 * config/math-curriculum.json.
 *
 * VAD SOM ÄR SKOLVERKETS OCH VAD SOM ÄR VÅRT:
 *
 *   areas, points, criteria   Skolverkets text, ordagrant. Ändras aldrig här.
 *   prerequisites             ExGens pedagogiska bedömning. Skolverket säger
 *                             VAD som ska läras i varje stadium, aldrig att
 *                             procent förutsätter bråk. Kedjan är vår, och
 *                             måste märkas som vår varje gång den citeras.
 *
 * Den skillnaden är hela poängen med filen. Ett system som säger "enligt
 * Skolverket behöver du repetera bråk först" påstår något Skolverket inte sagt.
 *
 * Källa: https://api.skolverket.se/syllabus (Skolverkets öppna data, CC BY 4.0)
 *
 * Kör:  node tools/sync-math-curriculum.mjs
 *       node tools/sync-math-curriculum.mjs --check
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "config", "math-curriculum.json");
const SUBJECT = "GRGRMAT01"; // Matematik, grundskolan (LGR22)

async function get(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === 3) throw new Error(`${url}: ${e.message}`);
      await new Promise(res => setTimeout(res, i * 1200));
    }
  }
}

/* Skolverkets text innehåller mjuka bindestreck (U+00AD) för avstavning. De är
   osynliga men bryter varje strängjämförelse och söksträng — "an­vändning" är
   inte "användning". De tas bort här, en gång, i stället för i varje konsument. */
function plainText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/­/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Stabil nyckel för ett område. Används som id i prerequisite-kartan nedan, så
   den måste vara oberoende av stavning och versaler i Skolverkets rubriker. */
function areaKey(name) {
  return plainText(name)
    .toLocaleLowerCase("sv")
    .replace(/[^a-zåäö0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseCentralContent(blocks) {
  const out = [];
  for (const block of blocks || []) {
    const stadium = String(block.year || "").trim();
    const html = String(block.text || "");
    const sections = [...html.matchAll(/<h4>(.*?)<\/h4>([\s\S]*?)(?=<h4>|$)/g)];
    for (const [, rubrik, kropp] of sections) {
      const namn = plainText(rubrik);
      if (!namn) continue;
      const points = [...kropp.matchAll(/<li>([\s\S]*?)<\/li>/g)]
        .map(m => plainText(m[1]))
        .filter(Boolean);
      if (!points.length) continue;
      out.push({ stage: stadium, area: namn, key: areaKey(namn), points });
    }
  }
  return out;
}

function parseCriteria(list) {
  return (list || [])
    .filter(k => k.gradeStep && k.year)
    .map(k => ({ year: String(k.year), grade: String(k.gradeStep), text: plainText(k.text) }))
    .filter(k => k.text);
}

/* ── ExGens prerequisite-karta ─────────────────────────────────────────────
 *
 * INTE SKOLVERKETS. Det här är en pedagogisk bedömning om vad som rimligen
 * måste sitta innan ett område i årskurs 7-9 går att lära sig, uttryckt som
 * områden i tidigare stadier.
 *
 * Den är avsiktligt grov — område till område, inte färdighet till färdighet.
 * En finkornig graf skulle se mer imponerande ut men bygga på gissningar vi
 * inte kan belägga, och en felaktig prerequisite skickar en elev bakåt till
 * något de redan kan.
 *
 * Kedjan läses: för att klara X i 7-9 behöver du rimligen Y från 4-6.
 *
 * Nycklarna behåller å, ä och ö. De härleds ur Skolverkets egna rubriker av
 * areaKey(), och en translitterering här hade brutit kopplingen tyst — vilket
 * den också gjorde i första versionen, tills valideringen längre ner fångade
 * det. Samma sex områden går igen i alla tre stadier, vilket är det som gör
 * kedjan mellan stadier möjlig alls.
 */
const PREREQUISITES = Object.freeze({
  "algebra": [
    { stage: "4-6", key: "taluppfattning_och_tals_användning",
      why: "Att räkna med bokstäver kräver att räkning med tal sitter — särskilt prioriteringsregler och negativa tal." },
  ],
  "samband_och_förändring": [
    { stage: "4-6", key: "taluppfattning_och_tals_användning",
      why: "Procent, andelar och förändringsfaktor bygger direkt på bråk och decimaltal." },
    { stage: "7-9", key: "algebra",
      why: "Att uttrycka ett samband kräver att man kan hantera en formel." },
  ],
  "geometri": [
    { stage: "4-6", key: "geometri",
      why: "Area, omkrets och skala i 7-9 förutsätter grundformerna och enhetsomvandling från 4-6." },
    { stage: "4-6", key: "taluppfattning_och_tals_användning",
      why: "Geometriska beräkningar är i praktiken multiplikation och division med decimaltal." },
  ],
  "sannolikhet_och_statistik": [
    { stage: "4-6", key: "taluppfattning_och_tals_användning",
      why: "Sannolikhet uttrycks som bråk, decimaltal eller procent — alla tre måste sitta." },
  ],
  "problemlösning": [
    { stage: "7-9", key: "algebra",
      why: "Problemlösning i 7-9 kräver oftast att situationen först översätts till ett uttryck." },
  ],
  "taluppfattning_och_tals_användning": [
    { stage: "4-6", key: "taluppfattning_och_tals_användning",
      why: "Potenser och reella tal bygger på att de fyra räknesätten och bråkform sitter." },
  ],
});

const check = process.argv.includes("--check");

const data = await get(`https://api.skolverket.se/syllabus/v1/subjects/${SUBJECT}?timespan=LATEST`);
const subject = data.subject || data;

const central = parseCentralContent(subject.centralContents);
const criteria = parseCriteria(subject.knowledgeRequirements);

/* Varje prerequisite måste peka på ett område som faktiskt finns. En kedja som
   pekar i tomma intet skickar eleven ingenstans. */
const finns = new Set(central.map(c => `${c.stage}::${c.key}`));
const trasiga = [];
for (const [omrade, krav] of Object.entries(PREREQUISITES)) {
  if (!central.some(c => c.stage === "7-9" && c.key === omrade)) trasiga.push(`7-9::${omrade} (området finns inte)`);
  for (const k of krav) if (!finns.has(`${k.stage}::${k.key}`)) trasiga.push(`${k.stage}::${k.key} (saknas)`);
}
if (trasiga.length) {
  console.error("Prerequisite pekar på områden som inte finns:\n  " + trasiga.join("\n  "));
  process.exit(1);
}

const catalog = {
  _source: "Skolverkets Syllabus API (https://api.skolverket.se/syllabus) — CC BY 4.0",
  _prerequisitesNote: "prerequisites är ExGens pedagogiska bedömning, INTE Skolverkets. Citera dem aldrig som läroplanstext.",
  _generatedBy: "tools/sync-math-curriculum.mjs",
  subject: { code: subject.code, name: subject.name },
  generatedAt: new Date().toISOString().slice(0, 10),
  centralContent: central,
  criteria,
  prerequisites: PREREQUISITES,
};

function comparable(c) {
  const { generatedAt, ...rest } = c;
  return JSON.stringify(rest);
}

if (check) {
  if (!fs.existsSync(OUT)) { console.error("config/math-curriculum.json saknas — kör skriptet."); process.exit(1); }
  if (comparable(JSON.parse(fs.readFileSync(OUT, "utf8"))) !== comparable(catalog)) {
    console.error("Läroplanen har ändrats — kör: node tools/sync-math-curriculum.mjs"); process.exit(1);
  }
  console.log("Aktuell.");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 0) + "\n");
  console.log(`Skrev config/math-curriculum.json (${(fs.statSync(OUT).size / 1024).toFixed(0)} kB)`);
}

const per79 = central.filter(c => c.stage === "7-9");
console.log(`stadier: ${[...new Set(central.map(c => c.stage))].join(", ")} · ` +
  `områden i 7-9: ${per79.length} · punkter i 7-9: ${per79.reduce((n, c) => n + c.points.length, 0)} · ` +
  `betygskriterier: ${criteria.length}`);
