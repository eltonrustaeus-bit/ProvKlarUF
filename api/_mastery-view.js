// api/_mastery-view.js — elevens kunskapsprofil, läst och tolkad.
//
// user_profiles.mastery är en jsonb-karta som api/grade.js skriver via
// apply_mock_mastery(). Den här filen är den enda vägen ut ur den: den läser,
// sorterar och avgör vad som är värt att säga till eleven.
//
// Varför tolkningen ligger i kod och inte i prompten: en elev ska kunna få veta
// varför P.E.R. föreslog just det steget, och svaret ska bli likadant varje
// gång. Samma princip som rekommendationsmotorn i docs/per/ARCHITECTURE.md §2.

import { conceptKey } from "./_concept-tags.js";

/* Under så här många försök säger siffran inget om eleven. Två svar på samma
   begrepp kan vara tur eller otur; nivån är inte belagd förrän fler kommit in.
   Tröskeln styr bara vad P.E.R. VÅGAR PÅSTÅ — allt lagras oavsett. */
export const MIN_ATTEMPTS_TO_TRUST = 3;

/* Skalan är 0–100 och startar på 50 för ett obeprövat begrepp. Gränserna följer
   src/per/recommendation.mjs (LOW_MASTERY 30, SOLID 60, STRONG 75) så att
   mockproven och juridikmotorn talar om samma nivåer. */
export const WEAK_BELOW = 45;
export const STRONG_AT_OR_ABOVE = 75;

/* Ett begrepp som inte rörts på tre veckor är värt att repetera även om det var
   starkt. Konstanten motsvarar SPACED_REVIEW_DAYS i recommendation.mjs men är
   längre: ett mockprovsbegrepp möts mer sällan än ett i en daglig träningsloop. */
export const STALE_AFTER_DAYS = 21;

function ageInDays(iso, now) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}

/**
 * Normaliserar mastery-kartan till en lista, oavsett om raden är gammal (rent
 * tal) eller ny (objekt med attempts och etikett).
 *
 * @returns {Array<{key,label,score,attempts,ageDays,trusted}>}
 */
export function readMastery(raw, { now = new Date() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    let score, attempts, label, lastSeen;
    if (typeof value === "number") {
      // Gammal form från klientskrivningen. Antalet försök är okänt — det får
      // aldrig gissas till noll och heller inte till något som ser belagt ut.
      score = value; attempts = 0; label = key; lastSeen = null;
    } else if (value && typeof value === "object") {
      score = Number(value.score);
      attempts = Number(value.attempts) || 0;
      label = String(value.label || key);
      lastSeen = value.last_seen || null;
    } else continue;

    if (!Number.isFinite(score)) continue;
    out.push({
      key,
      label,
      score: Math.max(0, Math.min(100, score)),
      attempts,
      ageDays: ageInDays(lastSeen, now),
      trusted: attempts >= MIN_ATTEMPTS_TO_TRUST,
    });
  }
  return out;
}

/**
 * Vad eleven bör göra härnäst, avgjort av kod.
 *
 * Returnerar EN sak, inte en meny. "Du kan träna A, B eller C" flyttar arbetet
 * tillbaka till eleven — samma regel som P.E.R:s egen pedagogik i _per-core.js.
 *
 * @returns {{ action, concept, label, reason }|null}
 */
export function decideNextFocus(mastery, { now = new Date() } = {}) {
  const rows = Array.isArray(mastery) ? mastery : readMastery(mastery, { now });
  if (!rows.length) return null;

  const belagda = rows.filter(r => r.trusted);

  // R1. Ett svagt och belagt begrepp går före allt annat.
  const svaga = belagda.filter(r => r.score < WEAK_BELOW).sort((a, b) => a.score - b.score);
  if (svaga.length) {
    return {
      action: "träna_svagt",
      concept: svaga[0].key,
      label: svaga[0].label,
      reason: `${svaga[0].label} ligger på ${Math.round(svaga[0].score)} av 100 efter ${svaga[0].attempts} försök.`,
    };
  }

  /* R2. Ett obeprövat begrepp före ett gammalt starkt. Att veta något om ett
     begrepp är mer värt än att bekräfta något redan känt en gång till. */
  const obeprövade = rows.filter(r => !r.trusted && r.score < STRONG_AT_OR_ABOVE)
    .sort((a, b) => a.attempts - b.attempts || a.score - b.score);
  if (obeprövade.length) {
    return {
      action: "bekräfta_nivå",
      concept: obeprövade[0].key,
      label: obeprövade[0].label,
      reason: `${obeprövade[0].label} har bara ${obeprövade[0].attempts} försök — nivån är inte belagd än.`,
    };
  }

  // R3. Starkt men gammalt: repetition före nytt stoff.
  const gamla = belagda
    .filter(r => r.ageDays !== null && r.ageDays > STALE_AFTER_DAYS)
    .sort((a, b) => b.ageDays - a.ageDays);
  if (gamla.length) {
    return {
      action: "repetera",
      concept: gamla[0].key,
      label: gamla[0].label,
      reason: `${gamla[0].label} har inte tränats på ${Math.round(gamla[0].ageDays)} dagar.`,
    };
  }

  // R4. Allt är belagt och färskt — höj svårigheten.
  const starkast = belagda.sort((a, b) => b.score - a.score)[0];
  if (starkast && starkast.score >= STRONG_AT_OR_ABOVE) {
    return {
      action: "höj_svårighet",
      concept: starkast.key,
      label: starkast.label,
      reason: `${starkast.label} ligger på ${Math.round(starkast.score)} — dags för svårare frågor.`,
    };
  }

  return null;
}

/**
 * Kunskapsprofilen som prompt-block. Tom sträng när det inte finns något
 * belagt nog att säga.
 *
 * Blocket är kort med flit: det ska ändra HUR P.E.R. svarar, inte fylla
 * kontextfönstret. Bara belagda begrepp namnges — ett påstående om en siffra
 * med två försök bakom sig är en gissning, och gissningar om vad en elev är
 * dålig på kostar mer förtroende än de ger.
 */
export function buildMasteryContext(raw, { now = new Date(), topic = "" } = {}) {
  const rows = readMastery(raw, { now });
  const belagda = rows.filter(r => r.trusted);
  if (!belagda.length) return "";

  const svaga = belagda.filter(r => r.score < WEAK_BELOW).sort((a, b) => a.score - b.score).slice(0, 4);
  const starka = belagda.filter(r => r.score >= STRONG_AT_OR_ABOVE).sort((a, b) => b.score - a.score).slice(0, 3);
  const next = decideNextFocus(rows, { now });

  const rader = ["## ELEVENS KUNSKAPSLÄGE", ""];
  if (svaga.length) rader.push(`Behöver träning: ${svaga.map(r => r.label).join(", ")}`);
  if (starka.length) rader.push(`Sitter: ${starka.map(r => r.label).join(", ")}`);

  /* Ämnesraden filtreras inte bort när topic är satt — tvärtom är det då den är
     mest värd. Men om eleven frågar om ett begrepp som INTE finns i profilen
     ska P.E.R. inte dra in orelaterade svagheter. */
  const träffad = topic ? belagda.find(r => r.key === conceptKey(topic)) : null;
  if (träffad) {
    rader.push(`Just det här begreppet: ${Math.round(träffad.score)} av 100 efter ${träffad.attempts} försök.`);
  }

  if (next) rader.push("", `Nästa steg enligt elevens data: ${next.reason}`);

  /* Bara den regel som är UNIK för det här blocket står kvar. Den generella
     "använd det för att forma svaret, räkna inte upp det"-instruktionen stod
     tidigare i tre block samtidigt och samlas nu en gång i
     api/_learner-context.js. Skalregeln hör hemma här: den gäller siffrorna på
     just den här raden och ingen annanstans. */
  rader.push(
    "",
    "Skalan 0–100 är intern. Räkna aldrig upp siffrorna för eleven och säg aldrig",
    "'din mastery är X'."
  );
  return rader.join("\n");
}
