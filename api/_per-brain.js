// api/_per-brain.js — kartan över P.E.R., härledd ur koden.
//
// Noder och kanter hittas inte på. De läses ur källfilerna, av samma skäl som
// registret i _per-registry.js bevakas av ett test: en karta som visar en
// struktur som inte finns är sämre än ingen karta.
//
// Modulen är REN. Den tar filnamn och filinnehåll och ger en graf — ingen
// filläsning, ingen databas, inget nätverk. Därför går hela härledningen att
// testa utan att något mockas, och den kan köras både på servern och i ett
// test mot vilken uppsättning filer som helst.
//
// AKTIVITETEN kommer separat, ur per_module_activity, och vävs ihop av
// api/admin.js. Det är med flit: strukturen är sann i dag, mätningen är sann
// den senaste timmen, och att blanda dem i samma funktion hade gjort båda
// svårare att lita på.

/** Vad en modulfil heter utan prefix och ändelse: "_per-core.js" → "per-core". */
export function nodeId(fil) {
  return String(fil).replace(/^_/, "").replace(/\.js$/, "");
}

/* TRE importformer, för att repot använder tre.
 *
 *   from "./_x.js"      vanlig ESM
 *   import "./_x.js"    sidoeffekt, utan from
 *   import("./_x.js")   dynamisk — och det är INTE en detalj: grade.js och
 *                       generate-exam.js är CJS och MÅSTE importera dynamiskt,
 *                       eftersom en statisk import över CJS/ESM-gränsen dödar
 *                       funktionen vid inladdning (ERR_REQUIRE_ESM). Med bara
 *                       det första mönstret hade kartan tigit om två av sex
 *                       rutter — de två som rör provgenerering och rättning. */
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+)["']\.\/(_[a-z0-9-]+\.js)["']/g;

/* Flaggnycklarna härleds i TVÅ mönster, samma som per-registry-testet:
   flagsEnabled([...]) går genom grinden i _flags.js, men _per-cache.js och
   explain.js läser sina flaggor direkt ur feature_flags. Ett mönster hade
   missat tre av sju flaggor. */
const FLAG_ARRAY_RE = /flagsEnabled\s*\(\s*(?:supabase\s*,\s*)?\[([^\]]*)\]/g;
const FLAG_STR_RE = /["']([a-z0-9_]+)["']/g;
/* Databastabeller. Kravet på en efterföljande PostgREST-metod är inte
   överdrivet: `.from("…")` finns också i Buffer.from och Array.from, och ett
   naivt mönster hade en dag ritat en tabell som heter "base64url".
   Mätt 2026-08-25: båda mönstren ger 26 tabeller i dag — kravet skyddar mot
   morgondagen, inte mot i dag. */
const TABELL_RE = /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)[\s\S]{0,200}?\.(?:select|insert|upsert|update|delete)\(/g;

const FLAG_DIRECT_RE = /from\(\s*["']feature_flags["']\s*\)[\s\S]{0,400}?\.eq\(\s*["']key["']\s*,\s*["']([a-z0-9_]+)["']/g;

/**
 * @param filer  { "namn.js": "innehåll", ... } — alla filer i api/
 * @returns { noder: Node[], kanter: {från,till}[] }
 *          Node = { id, etikett, typ: "modul"|"flagga"|"rutt", fil? }
 */
export function buildGraph(filer = {}) {
  const namn = Object.keys(filer).filter(f => f.endsWith(".js")).sort();

  /* Kartan är inte "filer som heter _per-*".
   *
   * grade.js och generate-exam.js når P.E.R. genom _concept-tags.js och
   * _adaptive-exam.js — hjälpare utan _per-prefix. Med bara prefixregeln hade
   * kartan visat P.E.R. som frånkopplad från rättning och provgenerering, och
   * det är falskt: mastery skrivs i grade.js och läses av _per-role.js.
   *
   * Regeln är därför transitiv stängning från _per-*: en hjälpare kommer med
   * om något redan på kartan importerar den. Ingen handskriven lista, så den
   * kan inte rötna — men de kommer med som typen "hjälpare", inte "modul",
   * eftersom registret i _per-registry.js beskriver just _per-* och de två
   * ytorna inte ska säga olika saker om vad P.E.R. BESTÅR av. */
  const kärnFiler = namn.filter(f => /^_per-.*\.js$/.test(f));
  const hjälpFiler = new Set();
  const påKartan = new Set(kärnFiler);
  for (let varv = 0; varv < 6; varv++) {
    let växte = false;
    for (const fil of [...påKartan]) {
      for (const m of String(filer[fil] || "").matchAll(IMPORT_RE)) {
        const mål = m[1];
        if (!namn.includes(mål) || påKartan.has(mål)) continue;
        påKartan.add(mål); hjälpFiler.add(mål); växte = true;
      }
    }
    if (!växte) break;
  }
  const modulFiler = [...påKartan].sort();
  // Rutterna är filer utan understrecksprefix. Bara de som faktiskt rör
  // P.E.R. tas med — admin.js hör hit sedan minnessidan, grade.js inte.
  const ruttFiler = namn.filter(f => !f.startsWith("_"));

  const noder = new Map();
  const läggTill = n => { if (!noder.has(n.id)) noder.set(n.id, n); };

  for (const fil of modulFiler) {
    läggTill({
      id: nodeId(fil), etikett: nodeId(fil), fil,
      typ: hjälpFiler.has(fil) ? "hjälpare" : "modul",
    });
  }

  const kanter = [];
  const seddKant = new Set();
  const läggKant = (från, till) => {
    const nyckel = `${från}→${till}`;
    if (från === till || seddKant.has(nyckel)) return;
    seddKant.add(nyckel);
    kanter.push({ från, till });
  };

  // Kanter mellan moduler.
  for (const fil of modulFiler) {
    const från = nodeId(fil);
    for (const m of String(filer[fil]).matchAll(IMPORT_RE)) {
      const till = nodeId(m[1]);
      // Bara kanter till noder som finns. En modul som importerar _site.js
      // ska inte skapa en nod som kartan sedan inte kan förklara.
      if (noder.has(till)) läggKant(från, till);
    }
  }

  // Rutter tas med bara om de faktiskt använder en P.E.R.-modul.
  for (const fil of ruttFiler) {
    const innehåll = String(filer[fil]);
    const mål = [];
    for (const m of innehåll.matchAll(IMPORT_RE)) {
      const till = nodeId(m[1]);
      if (noder.has(till)) mål.push(till);
    }
    if (!mål.length) continue;
    const id = nodeId(fil);
    läggTill({ id, etikett: fil, typ: "rutt", fil });
    for (const till of mål) läggKant(id, till);
  }

  // Flaggor: en nod per nyckel, med kant från varje fil som läser den.
  for (const fil of namn) {
    const innehåll = String(filer[fil]);
    const nycklar = new Set();
    for (const m of innehåll.matchAll(FLAG_ARRAY_RE)) {
      for (const k of m[1].matchAll(FLAG_STR_RE)) nycklar.add(k[1]);
    }
    for (const m of innehåll.matchAll(FLAG_DIRECT_RE)) nycklar.add(m[1]);

    for (const nyckel of nycklar) {
      läggTill({ id: `flagga:${nyckel}`, etikett: nyckel, typ: "flagga" });
      const från = nodeId(fil);
      // Kanten ritas bara från en nod som finns på kartan.
      if (noder.has(från)) läggKant(från, `flagga:${nyckel}`);
    }
  }

  /* Tabeller: en nod per tabell, med kant från varje fil som läser eller
     skriver den. Det är den största enskilda källan till struktur kartan
     saknade — P.E.R. rör 26 tabeller, och innan det här syntes ingen av dem. */
  for (const fil of namn) {
    const från = nodeId(fil);
    if (!noder.has(från)) continue;          // bara filer som redan är på kartan
    const tabeller = new Set();
    for (const m of String(filer[fil]).matchAll(TABELL_RE)) tabeller.add(m[1]);
    for (const t of tabeller) {
      läggTill({ id: `tabell:${t}`, etikett: t, typ: "tabell" });
      läggKant(från, `tabell:${t}`);
    }
  }

  return { noder: [...noder.values()], kanter };
}

/* Ljusstyrkan visar AVVIKELSE, inte volym.
 *
 * En modul som alltid används ska inte lysa starkast bara för att den alltid
 * används — då blir kartan en lista över det vanligaste, vilket registret
 * redan säger. Det intressanta är när något är ovanligt aktivt just nu.
 *
 * 0 betyder "som vanligt eller tystare", 1 betyder "dubbelt mot sitt eget
 * dygnsmedel eller mer". Saknas mätpunkt returneras null — aldrig 0, eftersom
 * 0 betyder "mätt och tyst" och null betyder "inte mätt". Samma skillnad som
 * TOO_FEW i _per-pulse.js.
 */
export function activityLevel(senasteTimmen, dygnsmedel) {
  if (!Number.isFinite(senasteTimmen) || !Number.isFinite(dygnsmedel)) return null;
  if (dygnsmedel <= 0) return senasteTimmen > 0 ? 1 : 0;
  const kvot = senasteTimmen / dygnsmedel;
  return Math.max(0, Math.min(1, (kvot - 1) / 1));
}

/* SYSTEMETS TEMPO — hur mycket hela P.E.R. används just nu.
 *
 * Skiljer sig från nodernas ljusstyrka: den mäter EN moduls avvikelse mot sig
 * själv, det här mäter helheten. Kartan rör sig fortare en kväll när många
 * elever pluggar än en söndagsmorgon när ingen gör det.
 *
 * BASEN ÄR INTE NOLL. Med tom mätdata rör sig kartan ändå — TEMPO_BAS — för
 * att en stillastående karta läser som trasig, inte som lugn. Men basen är
 * tydligt långsammare än full fart, så skillnaden går att se.
 *
 * Skalan går från bas vid ingen aktivitet till 1 vid dubbelt mot dygnsmedlet,
 * samma referenspunkt som activityLevel(). Två mått som mäter olika saker mot
 * olika referenser hade varit omöjliga att jämföra.
 */
export const TEMPO_BAS = 0.35;

export function systemTempo(noder = []) {
  let senaste = 0, medel = 0, mätta = 0;
  for (const n of noder) {
    if (!Number.isFinite(n?.senasteTimmen) || !Number.isFinite(n?.dygnsmedel)) continue;
    senaste += n.senasteTimmen;
    medel += n.dygnsmedel;
    mätta++;
  }
  // Ingen mätpunkt alls: basen, aldrig noll och aldrig påhittad fart.
  if (!mätta || medel <= 0) return senaste > 0 ? 1 : TEMPO_BAS;
  const kvot = senaste / medel;                    // 1 = som vanligt
  const över = Math.max(0, Math.min(1, kvot / 2)); // 2x dygnsmedel = full fart
  return TEMPO_BAS + (1 - TEMPO_BAS) * över;
}

/**
 * Väver ihop grafen med mätdatan.
 * @param graf   ur buildGraph()
 * @param rader  [{ module, hour, count }] senaste dygnet
 * @param nu     ms
 */
export function attachActivity(graf, rader = [], nu = Date.now()) {
  const timmeNu = Math.floor(nu / 3_600_000) * 3_600_000;
  const perModul = new Map();

  for (const r of rader) {
    const t = Date.parse(r?.hour ?? "");
    if (!Number.isFinite(t)) continue;
    const m = String(r?.module ?? "");
    if (!m) continue;
    if (!perModul.has(m)) perModul.set(m, { senaste: 0, summa: 0, timmar: 0 });
    const p = perModul.get(m);
    const n = Number(r?.count) || 0;
    p.summa += n;
    p.timmar += 1;
    if (t >= timmeNu) p.senaste += n;
  }

  const noder = graf.noder.map(n => {
    const p = perModul.get(n.id);
    if (!p) return { ...n, aktivitet: null, senasteTimmen: null, dygnsmedel: null };
    const medel = p.timmar ? p.summa / p.timmar : 0;
    return {
      ...n,
      aktivitet: activityLevel(p.senaste, medel),
      senasteTimmen: p.senaste,
      dygnsmedel: medel,
    };
  });

  return { ...graf, noder, tempo: systemTempo(noder) };
}
