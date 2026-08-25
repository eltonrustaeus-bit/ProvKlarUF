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
const BASE = "https://api.skolverket.se/syllabus/v1";
const SUBJECT = "GRGRMAT01"; // Matematik, grundskolan (LGR22)

/* Gymnasiets matematik.
 *
 * GY11 (MAT) bär innehållet på KURSEN och betygskriterierna på kursen.
 * Gy25 (MATE) bär innehållet på nivån och kriterierna på ÄMNET — ett ämnesbetyg
 * sätts på ämnet, inte på varje nivå, vilket är hela reformen.
 *
 * Båda behövs. Ämnesbetygsreformen gäller utbildning som startar efter
 * 2025-06-30, men elever som började dessförinnan läser GY11-kurser och all
 * deras provhistorik hänger på de kursnamnen. Kurspickaren i app.html erbjuder
 * fortfarande "Matematik 1a" … "Matematik 5", alltså GY11.
 *
 * MAM (MAMMAT51-53) utelämnas: den läroplanen hör till en skolform ExGen inte
 * riktar sig till, och ingen kurs i pickaren pekar på den. */
const GY11_SUBJECT = "MAT";
const GY25_SUBJECT = "MATE";

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

/* Gymnasiets centrala innehåll använder <p><strong>Område</strong></p><ul>,
   där grundskolan använder <h4>. Samma information, annan uppmärkning — och
   ett par kurser blandar dem. Gy25 använder dessutom <em> där GY11 använder
   <strong>. Alla tre hanteras, annars tappas områden tyst — vilket de gjorde:
   första versionen kunde bara <strong> och gav noll områden för samtliga sex
   Gy25-nivåer. */
function parseCourseContent(html) {
  const text = String(html || "");
  const out = [];
  const rubrikRe = /<(?:h4|p)>\s*(?:<(?:strong|em)>)?([^<]+?)(?:<\/(?:strong|em)>)?\s*<\/(?:h4|p)>\s*<ul>([\s\S]*?)<\/ul>/g;
  for (const [, rubrik, kropp] of text.matchAll(rubrikRe)) {
    const namn = plainText(rubrik);
    // Ingressen ("Undervisningen i kursen ska behandla följande centrala
    // innehåll:") är ingen områdesrubrik.
    if (!namn || /centralt inneh[åa]ll/i.test(namn)) continue;
    const points = [...kropp.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => plainText(m[1])).filter(Boolean);
    if (!points.length) continue;
    out.push({ area: namn, key: areaKey(namn), points });
  }
  return out;
}

function parseGradeSteps(list) {
  return (list || [])
    .filter(k => k.gradeStep)
    .map(k => ({ grade: String(k.gradeStep), text: plainText(k.text) }))
    .filter(k => k.text);
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

const data = await get(`${BASE}/subjects/${SUBJECT}?timespan=LATEST`);
const subject = data.subject || data;

/* FÖRMÅGORNA — vad ämnet faktiskt BEDÖMER.
 *
 * Ligger i ämnets syfte, inte i det centrala innehållet: innehållet säger vad
 * som ska läras, förmågorna vad eleven ska kunna GÖRA med det. P.E.R. kunde
 * säga vad som skulle läras men aldrig vilken förmåga en uppgift tränar.
 *
 * Extraheras ur den avslutande uppräkningen ("Undervisningen … ska ge eleverna
 * förutsättningar att utveckla / förmåga att …"), inte skrivna av för hand.
 * En förmågelista i repot som glidit från Skolverkets driver isär tyst. */
function parseAbilities(purpose) {
  const rader = String(purpose || "")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map(r => r.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return rader
    .filter(r => /^förmåga att /i.test(r))
    .map(r => r.replace(/[,.]?\s*(och)?\s*$/, "").trim())
    .filter((r, i, a) => r.length > 15 && a.indexOf(r) === i);
}

const abilities = parseAbilities(subject.purpose);
if (!abilities.length) {
  console.error("VÄGRAR SKRIVA: inga förmågor hittades i ämnets syfte.");
  console.error("Det betyder att uppräkningen ändrat form hos Skolverket, inte att ämnet saknar förmågor.");
  process.exit(1);
}

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

/* ── Gymnasiet ─────────────────────────────────────────────────────────── */

async function hämtaGy11() {
  const subj = (await get(`${BASE}/subjects/${GY11_SUBJECT}`)).subject;
  const kurser = [];
  for (const k of subj.courses || []) {
    const c = (await get(`${BASE}/courses/${k.code}`)).course;
    const areas = parseCourseContent(c.centralContent && c.centralContent.text);
    if (!areas.length) { console.error(`  VARNING: ${k.code} gav noll områden`); continue; }
    kurser.push({
      code: c.code,
      name: plainText(c.name),
      points: Number(c.points) || null,
      areas,
      criteria: parseGradeSteps(c.knowledgeRequirements),
    });
  }
  return { subject: { code: subj.code, name: plainText(subj.name) }, courses: kurser };
}

async function hämtaGy25() {
  const subj = (await get(`${BASE}/subjects/${GY25_SUBJECT}`)).subject;
  const nivåer = [];
  for (const n of subj.courses || []) {
    const areas = parseCourseContent(n.centralContent && n.centralContent.text);
    if (!areas.length) { console.error(`  VARNING: ${n.code} gav noll områden`); continue; }
    nivåer.push({ code: n.code, name: plainText(n.name), points: Number(n.points) || null, areas });
  }
  /* Kriterierna ligger på ÄMNET, inte på nivån. Ett ämnesbetyg sätts på ämnet
     — det är hela reformen, och att kopiera ut dem per nivå skulle påstå att
     varje nivå betygsätts för sig. */
  return {
    subject: { code: subj.code, name: plainText(subj.name) },
    levels: nivåer,
    criteria: parseGradeSteps(subj.knowledgeRequirements),
  };
}

const [gy11, gy25] = await Promise.all([hämtaGy11(), hämtaGy25()]);

/* Ett tomt gymnasieblock är värre än inget: konsumenten skulle tro att kursen
   saknar läroplan i stället för att synken gick sönder. */
if (!gy11.courses.length || !gy25.levels.length) {
  console.error("Gymnasiet gav inga kurser/nivåer — avbryter hellre än att skriva en tom fil.");
  process.exit(1);
}

const catalog = {
  _source: "Skolverkets Syllabus API (https://api.skolverket.se/syllabus) — CC BY 4.0",
  _prerequisitesNote: "prerequisites är ExGens pedagogiska bedömning, INTE Skolverkets. Citera dem aldrig som läroplanstext.",
  _generatedBy: "tools/sync-math-curriculum.mjs",
  subject: { code: subject.code, name: subject.name },
  generatedAt: new Date().toISOString().slice(0, 10),
  centralContent: central,
  /* Vad ämnet BEDÖMER, ur ämnets syfte. Innehållet säger vad som ska läras,
     förmågorna vad eleven ska kunna GÖRA med det. */
  abilities,
  criteria,
  prerequisites: PREREQUISITES,
  gymnasium: { GY11: gy11, GY25: gy25 },
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
  /* FÖRMÅGORNA OCKSÅ SOM ESM-MODUL.
 *
 * config/math-curriculum.json läses av api/_math-curriculum.js med
 * readFileSync och process.cwd() — det fungerar för att config/** ligger i
 * includeFiles. Men api/_per-core.js behöver förmågorna vid INLADDNING, och
 * en filläsning där hade krävt import.meta för sökvägen. Den raden tog ned
 * tre rutter 2026-08-25.
 *
 * En genererad modul importeras statiskt och finns alltid i bunten.
 * Samma mönster som api/_per-graph-data.js. */
{
  const modul = `// api/_per-abilities.js — GENERERAD. Redigera aldrig för hand.
//
// Kör \`node tools/sync-math-curriculum.mjs\` för att skriva om den.
// Skolverkets förmågor ur ämnets syfte, ordagrant.
//
// VARFÖR EN MODUL OCH INTE EN FILLÄSNING: api/_per-core.js behöver dem vid
// inladdning, och en filläsning där hade krävt import.meta för sökvägen.
// Vercel transpilerar varje .js i api/ till CJS, där import.meta är ett
// syntaxfel — den raden tog ned /api/explain, /api/teacher-report och
// /api/check-role samtidigt. Se tests/api/cjs-esm-boundary.test.mjs.

export const PEDAGOGY_ABILITIES = ${JSON.stringify(abilities, null, 2)};
`;
  fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "api", "_per-abilities.js"), modul, "utf8");
  console.log(`Skrev api/_per-abilities.js (${abilities.length} förmågor)`);
}

console.log(`Skrev config/math-curriculum.json (${(fs.statSync(OUT).size / 1024).toFixed(0)} kB)`);
}

console.log(`gymnasiet: GY11 ${gy11.courses.length} kurser · Gy25 ${gy25.levels.length} nivåer, ` +
  `${gy25.criteria.length} kriterier på ämnesnivå`);

const per79 = central.filter(c => c.stage === "7-9");
console.log(`stadier: ${[...new Set(central.map(c => c.stage))].join(", ")} · ` +
  `områden i 7-9: ${per79.length} · punkter i 7-9: ${per79.reduce((n, c) => n + c.points.length, 0)} · ` +
  `betygskriterier: ${criteria.length}`);
