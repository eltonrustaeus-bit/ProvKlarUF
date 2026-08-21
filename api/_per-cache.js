// api/_per-cache.js — enda modulen som känner till per_answer_cache och per_cache_probe.
//
// Cachen ligger framför exakt två vägar vars prompt bevisligen saknar elevdata: landingMode och
// EXPLAIN MODE. Ett cachat svar från elev A som återanvänds för elev B vore två fel samtidigt:
// fel svar och en läcka. Därför finns ingen väg här in från TEACH MODE — den grenen läser
// longMemory och student_mastery nycklat på user.id (api/explain.js:412), och att sessionens
// historik råkar vara tom bevisar ingenting om prompten.
//
// Allt fail-open. Ett cachefel får göra P.E.R långsam, aldrig trasig — samma princip som
// loadPerHistory() i api/explain.js.

import { cacheAllowedFields } from "./_per-cache-guard.js";
import { normalizeQuestion, payloadHash, fingerprintOf, slotGuardOk } from "./_per-fingerprint.js";
import { buildCacheSkeleton } from "./_per-core.js";
import { getEmbedding } from "../src/retrieval/legal-retrieval.mjs";

const VECTOR_THRESHOLD = 0.95;  // under detta används aldrig en vektorträff
const NEAR_MISS_FLOOR  = 0.88;  // 0.88–0.95 loggas men används inte
const TTL_DAYS         = 30;
const EMBED_TIMEOUT_MS = 5_000;
const MAX_ANSWER_CHARS = 20_000;

/** Flaggan är av som default. Fel vid läsning = av. */
export async function cacheEnabled(supabase) {
  try {
    const { data } = await supabase
      .from("feature_flags").select("enabled")
      .eq("key", "per_answer_cache_enabled").maybeSingle();
    return data?.enabled === true;
  } catch { return false; }
}

async function logProbe(supabase, { lane, decision, similarity = null, cacheId = null, fingerprint = null }) {
  try {
    await supabase.from("per_cache_probe").insert({
      lane, decision, similarity,
      cache_id: cacheId,
      fingerprint_px: fingerprint ? fingerprint.slice(0, 12) : null,
    });
  } catch { /* sonden får aldrig påverka svaret */ }
}

// getEmbedding har ingen egen timeout. Ett hängande embeddinganrop skulle annars göra cachen
// långsammare än det anrop den ska ersätta — alltså sämre än ingen cache alls.
async function embedWithTimeout(text) {
  let timer;
  try {
    return await Promise.race([
      getEmbedding(text),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("embedding timeout")), EMBED_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Slår upp ett cachat svar. Returnerar alltid ett objekt med `key`, så att anroparen kan skicka
 * tillbaka det till storeAnswer() utan att räkna om något.
 *
 * @param {'landing'|'explain'} lane
 * @param {object} fields  landing: { question }. explain: { question, correct, option_a..d }
 * @param {Array}  targets sidmål — ingår i skelettet och därmed i fingeravtrycket, så att ett
 *                         förgiftat target-set får sitt eget namnrum (Codex CR-CACHE-005)
 * @param {Function} embedFn injicerbar embeddingfunktion. Finns för att testet ska kunna bevisa
 *                         att explain-banan aldrig vektorsöker. Utan sömmen blir det testet grönt
 *                         av fel skäl: embeddinganropet faller på saknad API-nyckel innan
 *                         per_cache_match hinner nås, så spärren och nyckelbristen ser likadana
 *                         ut utifrån. Samma mönster som getEmbedding(text, { fetchImpl }).
 */
export async function lookupCached(supabase, { lane, fields, targets = [], embedFn = embedWithTimeout }) {
  const question = String(fields?.question ?? "");
  const key = { lane, allowed: false, fingerprint: null, payloadHash: null, question: "", embedding: null };

  // Grinden körs över SAMTLIGA promptbärande fält, inte bara frågan. Explain-prompten formas
  // även av facit och alla fyra alternativen, och explain-rader skrivs 'approved' direkt — så
  // PII i ett svarsalternativ hade annars nått ett cachat, direkt serverbart svar
  // (Codex CR-FINAL-001).
  if (!cacheAllowedFields(fields)) {
    await logProbe(supabase, { lane, decision: "blocked" });
    return { answer: null, key };
  }

  try {
    key.question    = normalizeQuestion(question);
    key.fingerprint = fingerprintOf(buildCacheSkeleton(lane, { targets }));
    key.payloadHash = payloadHash(lane, fields);
    key.allowed     = true;
  } catch {
    // Okänd bana eller trasigt skelett: kör live, cacha ingenting.
    return { answer: null, key };
  }

  // 1. Exakt — noll kostnad, inget nätverk mot OpenAI.
  try {
    const { data } = await supabase.rpc("per_cache_get_exact", {
      p_lane: lane, p_fingerprint: key.fingerprint, p_payload_hash: key.payloadHash,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.answer) {
      await logProbe(supabase, { lane, decision: "hit_exact", cacheId: row.cache_id, fingerprint: key.fingerprint });
      return { answer: row.answer, key };
    }
  } catch { /* fail-open */ }

  // 2. Explain-banan är hash-only med avsikt: dess indata är klientstyrd (body.question,
  //    body.option_a..d), och utan vektormatchning kan en påhittad fråga bara träffa sig själv.
  if (lane !== "landing") {
    await logProbe(supabase, { lane, decision: "miss", fingerprint: key.fingerprint });
    return { answer: null, key };
  }

  // 3. Vektor — bara på landningsbanan, bara mot godkända rader.
  try {
    key.embedding = await embedFn(key.question);
    const { data } = await supabase.rpc("per_cache_match", {
      p_lane: lane, p_fingerprint: key.fingerprint, p_embedding: key.embedding,
      p_min_similarity: NEAR_MISS_FLOOR, p_limit: 5,
    });

    for (const cand of data || []) {
      // Slot-guarden först: cosinus ensamt räcker inte. "vad kostar Premium" och "vad kostar
      // Basic" ligger båda över tröskeln och har motsatta svar (Codex CR-CACHE-011).
      const guardOk = slotGuardOk(key.question, cand.question_text);
      if (guardOk && cand.similarity >= VECTOR_THRESHOLD) {
        const { data: answer } = await supabase.rpc("per_cache_hit", { p_id: cand.cache_id });
        if (answer) {
          await logProbe(supabase, { lane, decision: "hit_vector", similarity: cand.similarity, cacheId: cand.cache_id, fingerprint: key.fingerprint });
          return { answer, key };
        }
      }
      // Över golvet men under tröskeln, eller nekad av guarden: logga för kalibrering, använd
      // inte. Det är den loggen som gör att 0.95 kan sänkas på mätning i stället för på
      // gissning när trafik väl finns.
      await logProbe(supabase, { lane, decision: "near_miss", similarity: cand.similarity, cacheId: cand.cache_id, fingerprint: key.fingerprint });
      return { answer: null, key };
    }
  } catch { /* fail-open — embedding eller RPC felade */ }

  await logProbe(supabase, { lane, decision: "miss", fingerprint: key.fingerprint });
  return { answer: null, key };
}

/**
 * Lagrar ett live-genererat svar. Anropas EFTER att svaret skickats till användaren.
 *
 * Landningsrader skrivs som 'pending' — landingMode är oautentiserad (api/explain.js:250) och
 * dess rate limit fail-open:ar (api/explain.js:270), så ett promptinjicerat svar hade annars
 * kunnat serveras till riktiga besökare som produktfakta (Codex CR-CACHE-003). Explain-rader
 * skrivs som 'approved': nyckeln är hela payloaden, så en påhittad fråga träffar bara sig själv.
 */
export async function storeAnswer(supabase, { key, answer }) {
  if (!key?.allowed || !answer) return;
  try {
    const expires = new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString();
    // Skrivningen går genom per_cache_store, inte en upsert med ignoreDuplicates. Skälet är
    // Codex CR-FINAL-003: "on conflict do nothing" gjorde att en rad som passerat expires_at
    // ALDRIG kunde ersättas — läsningarna filtrerade bort den, skrivningen vägrade skriva över
    // den, och nyckeln var död för alltid. RPC:n skriver över endast när den befintliga raden
    // är utgången. En levande rad skyddas fortfarande (Codex CR-CACHE-010).
    await supabase.rpc("per_cache_store", {
      p_lane:          key.lane,
      p_payload_hash:  key.payloadHash,
      p_fingerprint:   key.fingerprint,
      p_question_text: key.question,
      p_answer:        String(answer).slice(0, MAX_ANSWER_CHARS),
      p_embedding:     key.embedding,   // null för explain-banan, och för landing om embeddingen felade
      p_status:        key.lane === "explain" ? "approved" : "pending",
      p_expires_at:    expires,
    });
  } catch { /* best-effort, aldrig blockerande */ }
}
