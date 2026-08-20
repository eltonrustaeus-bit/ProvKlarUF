// api/_per-memory.js - P.E.R long-term memory helpers
// Stores a compact learning profile, not raw personal data.

import { MODULES } from "./_modules.js";

const REFRESH_DAYS    = 1;
const MAX_HIST_CHARS  = 3000;
const MEMORY_TTL_DAYS = 90;
const MAX_HELP_LOG    = 20;

// Matches _per-context.js's BLOCKED_CONTEXT_REGEX coverage of prompt-injection phrasing
// (ignore previous instructions, env variable dumps) in addition to PII/secret patterns —
// student chat history is untrusted input and must be filtered the same way pageContext is.
const PRIVATE_OR_SECRET_REGEX = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\d\s().-]{7,}\d)|api[_ -]?key|secret|token|password|supabase_service_role|stripe_secret|openai_api_key|system prompt|developer message|ignore previous|ignore all|env(?:ironment)? variables?)\b/i;

function cleanMemoryText(value, maxLen = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
  return PRIVATE_OR_SECRET_REGEX.test(text) ? "[filtrerat]" : text;
}

function uniqueList(values, maxItems = 8) {
  return [...new Set((values || []).map(v => cleanMemoryText(v, 80)).filter(v => v && v !== "[filtrerat]"))].slice(0, maxItems);
}

function isStale(updatedAt) {
  if (!updatedAt) return false;
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays > MEMORY_TTL_DAYS;
}

// JSON schema for structured memory extraction via OpenAI Structured Outputs
const STRUCTURED_SCHEMA = {
  type: "json_schema",
  name: "memory_extract",
  schema: {
    type: "object",
    properties: {
      weak_topics:      { type: "array", items: { type: "string" }, maxItems: 6 },
      strong_topics:    { type: "array", items: { type: "string" }, maxItems: 4 },
      avg_score:        { type: ["number", "null"] },
      exam_count:       { type: "integer" },
      study_pattern:    { type: "string", enum: ["mornings", "evenings", "sporadic", "regular", "unknown"] },
      last_module:      { type: "string", enum: ["körkortsteorin", "mockprov", "förbättring", "skolarbete", "unknown"] },
      score_trajectory: { type: "array", items: { type: "number" }, maxItems: 5 },
      sessions_total:   { type: "integer" },
    },
    required: ["weak_topics", "strong_topics", "avg_score", "exam_count", "study_pattern", "last_module", "score_trajectory", "sessions_total"],
    additionalProperties: false,
  },
  strict: true,
};

// Returns { summary: string|null, structured: object|null }
export async function loadLongMemory(supabase, userId) {
  try {
    const { data } = await supabase
      .from("per_long_memory")
      .select("summary, structured, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (data?.updated_at && isStale(data.updated_at)) {
      await supabase.from("per_long_memory").delete().eq("user_id", userId);
      return { summary: null, structured: null };
    }

    return {
      summary:    data?.summary ? cleanMemoryText(data.summary, 900) : null,
      structured: data?.structured && typeof data.structured === "object" ? data.structured : null,
    };
  } catch {
    return { summary: null, structured: null };
  }
}

// Build rich learning signals — prefers real exam DB data over AI-inferred topics
export function buildLearningSignals({ weakAreas = [], recentMistakes = [], pageContext = null, structured = null } = {}) {
  const signals = [];

  if (structured) {
    // Real exam data takes precedence over AI-inferred topics
    const examWeakCats = structured.exam_weak_categories || [];
    if (examWeakCats.length)
      signals.push(`Svaga kategorier (faktiska provresultat): ${examWeakCats.slice(0, 5).join(", ")}`);
    else if (structured.weak_topics?.length)
      signals.push(`Svaga ämnen (konversationshistorik): ${structured.weak_topics.slice(0, 5).join(", ")}`);

    if (structured.strong_topics?.length)
      signals.push(`Starka ämnen: ${structured.strong_topics.slice(0, 3).join(", ")}`);

    if (structured.felbank_weak_concepts?.length)
      signals.push(`Felbank — svaga begrepp (faktiska felsvar): ${structured.felbank_weak_concepts.slice(0, 5).join(", ")}`);
    if (structured.felbank_error_types?.length)
      signals.push(`Felbank — vanliga feltyper: ${structured.felbank_error_types.join(", ")}`);

    if (structured.mock_weak_concepts?.length)
      signals.push(`Svaga mockprov-begrepp: ${structured.mock_weak_concepts.slice(0, 5).join(", ")}`);

    if (Array.isArray(structured.mock_recent_scores) && structured.mock_recent_scores.length >= 2) {
      const ms    = structured.mock_recent_scores;
      const mdelta = Math.round(ms[ms.length - 1] - ms[0]);
      signals.push(`Mockprov-poäng (senaste ${ms.length}): ${ms.join("%, ")}% (trend: ${mdelta >= 0 ? "+" : ""}${mdelta}%)`);
    }

    if (Array.isArray(structured.exam_recent_scores) && structured.exam_recent_scores.length >= 2) {
      const scores = structured.exam_recent_scores;
      const delta  = Math.round(scores[scores.length - 1] - scores[0]);
      signals.push(`Senaste ${scores.length} provpoäng: ${scores.join("%, ")}% (trend: ${delta >= 0 ? "+" : ""}${delta}%)`);
    } else if (Array.isArray(structured.score_trajectory) && structured.score_trajectory.length >= 2) {
      const first = structured.score_trajectory[0];
      const last  = structured.score_trajectory[structured.score_trajectory.length - 1];
      const delta = Math.round(last - first);
      signals.push(`Poängtrend: ${delta >= 0 ? "+" : ""}${delta}% (senaste ${structured.score_trajectory.length} proven)`);
    }

    if (structured.exam_count > 0)                                              signals.push(`Antal prov totalt: ${structured.exam_count}`);
    if (structured.last_module && structured.last_module !== "unknown")         signals.push(`Senaste modul: ${structured.last_module}`);
    if (structured.sessions_total > 0)                                          signals.push(`Totalt sessioner: ${structured.sessions_total}`);
  }

  // Frontend-sent weak areas — only add when not already covered by DB data
  const weak = uniqueList(weakAreas);
  if (weak.length && !(structured?.exam_weak_categories?.length)) signals.push(`Svaga områden (session): ${weak.join(", ")}`);

  const mistakeCats = uniqueList((recentMistakes || []).map(m => m?.category || m?.course));
  if (mistakeCats.length) signals.push(`Återkommande felkategorier: ${mistakeCats.join(", ")}`);

  if (pageContext?.page)                          signals.push(`Aktiv sida: ${cleanMemoryText(pageContext.page, 50)}`);
  if (pageContext?.course)                        signals.push(`Kurs/ämne: ${cleanMemoryText(pageContext.course, 80)}`);
  if (pageContext?.currentQuestion?.category)     signals.push(`Frågekategori: ${cleanMemoryText(pageContext.currentQuestion.category, 80)}`);
  if (typeof pageContext?.userScore === "number") signals.push(`Senaste snittnivå: ${Math.round(Math.max(0, Math.min(1, pageContext.userScore)) * 100)}%`);

  return signals.slice(0, 10).join("\n");
}

// Fetch real exam signals from Supabase — driving_progress.cat_prog + driving_results + mock_results
export async function enrichMemoryFromExamData(supabase, userId) {
  try {
    const [resultsRes, progressRes, mockRes, examRes] = await Promise.all([
      supabase
        .from("driving_results")
        .select("category, percent, passed, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("driving_progress")
        .select("cat_prog")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("mock_results")
        .select("course, percent, concept_tags, error_tags")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("user_exams")
        .select("course, result")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const rows         = resultsRes.data || [];
    const recentScores = rows.slice(0, 5).map(r => Math.round(r.percent || 0));

    // Primary: cat_prog gives per-category mastery — sort by lowest best% score
    let weakCategories = [];
    const catProg = progressRes.data?.cat_prog;
    if (catProg && typeof catProg === "object") {
      weakCategories = Object.entries(catProg)
        .filter(([, v]) => typeof v?.best === "number" && v.best < 75)
        .sort(([, a], [, b]) => (a.best || 0) - (b.best || 0))
        .slice(0, 8)
        .map(([cat]) => cleanMemoryText(cat, 60));
    }

    // Fallback: failed driving_results rows (skip generic "Alla kategorier")
    if (!weakCategories.length && rows.length) {
      const failMap = {};
      for (const r of rows) {
        if (!r.passed && r.category && !String(r.category).toLowerCase().includes("alla")) {
          failMap[r.category] = (failMap[r.category] || 0) + 1;
        }
      }
      weakCategories = Object.entries(failMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([cat]) => cleanMemoryText(cat, 60));
    }

    // Mockprov signals — concept_tags from low-scoring exams
    const mockRows         = mockRes.data || [];
    const mockRecentScores = mockRows.slice(0, 5).map(r => r.percent);
    const mockWeakConcepts = [...new Set(
      mockRows
        .filter(r => r.percent < 70)
        .flatMap(r => (r.concept_tags || []).filter(Boolean))
        .map(t => cleanMemoryText(t, 60))
    )].slice(0, 8);

    // Felbank signals — per_question failures from user_exams (app.html mockprov)
    const examRows = examRes.data || [];
    const failedItems = examRows.flatMap(r =>
      (r.result?.per_question || [])
        .filter(q => Number(q.points || 0) < Number(q.max_points || 0))
        .map(q => ({ concept_tag: q.concept_tag, error_tags: q.error_tags, course: r.course }))
    );
    const felBankWeakConcepts = [...new Set(
      failedItems
        .map(q => q.concept_tag)
        .filter(c => c && c !== "Okänt" && c !== "Unknown")
        .map(t => cleanMemoryText(t, 60))
    )].slice(0, 8);
    const felBankErrorTypes = [...new Set(
      failedItems.flatMap(q => q.error_tags || []).filter(Boolean)
    )].slice(0, 8);
    const felBankCourses = [...new Set(
      failedItems.map(q => q.course).filter(Boolean).map(c => cleanMemoryText(c, 80))
    )].slice(0, 5);

    return { recentScores, weakCategories, mockRecentScores, mockWeakConcepts, felBankWeakConcepts, felBankErrorTypes, felBankCourses };
  } catch {
    return { recentScores: [], weakCategories: [], mockRecentScores: [], mockWeakConcepts: [], felBankWeakConcepts: [], felBankErrorTypes: [], felBankCourses: [] };
  }
}

// Track helpLevel signal — lightweight ring buffer upsert, never blocks request
export async function updateHelpLevelSignal(supabase, userId, helpLevel) {
  if (typeof helpLevel !== "number" || !Number.isFinite(helpLevel)) return;
  const level = Math.min(3, Math.max(0, Math.floor(helpLevel)));
  try {
    const { data } = await supabase
      .from("per_long_memory")
      .select("structured")
      .eq("user_id", userId)
      .maybeSingle();

    const existing = data?.structured || {};
    const log      = Array.isArray(existing.help_level_log) ? existing.help_level_log : [];
    const newLog   = [...log, { level, ts: new Date().toISOString() }].slice(-MAX_HELP_LOG);

    // Mode of last 10 entries = preferred level
    const recent = newLog.slice(-10).map(e => e.level);
    const freq   = {};
    for (const l of recent) freq[l] = (freq[l] || 0) + 1;
    const preferred = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);

    await supabase
      .from("per_long_memory")
      .upsert(
        {
          user_id:    userId,
          structured: {
            ...existing,
            help_level_log:       newLog,
            preferred_help_level: Number.isFinite(preferred) ? preferred : null,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
  } catch { /* best-effort */ }
}

export async function clearLongMemory(supabase, userId) {
  try {
    await supabase.from("per_long_memory").delete().eq("user_id", userId);
    await supabase.from("per_sessions").delete().eq("user_id", userId);
    return true;
  } catch {
    return false;
  }
}

export async function maybeRefreshLongMemory(supabase, userId, recentMessages, callAIFn, learningSignals = "") {
  try {
    // Fetch real exam data first — needed for both the guard and the prompts
    const examData    = await enrichMemoryFromExamData(supabase, userId);
    const hasExamData = examData.recentScores.length > 0 || examData.weakCategories.length > 0
      || examData.mockRecentScores.length > 0 || examData.mockWeakConcepts.length > 0
      || examData.felBankWeakConcepts.length > 0;
    const hasMessages = Array.isArray(recentMessages) && recentMessages.length > 0;
    if (!hasMessages && !hasExamData) return;

    const { data } = await supabase
      .from("per_long_memory")
      .select("updated_at, structured")
      .eq("user_id", userId)
      .maybeSingle();

    const lastUpdate = data?.updated_at ? new Date(data.updated_at) : null;
    const daysSince  = lastUpdate ? (Date.now() - lastUpdate.getTime()) / 86_400_000 : 999;
    if (daysSince < REFRESH_DAYS) return;

    const histText   = (Array.isArray(recentMessages) ? recentMessages : [])
      .slice(-30)
      .map(m => `${m.role === "user" ? "Elev" : "P.E.R"}: ${cleanMemoryText(m.content, 160)}`)
      .join("\n")
      .slice(0, MAX_HIST_CHARS);
    const signalText = cleanMemoryText(learningSignals, 700);

    const teoriprovSection = (examData.recentScores.length > 0 || examData.weakCategories.length > 0)
      ? `\nKörkortsteorin (faktiska DB-resultat):\n- Svaga kategorier: ${examData.weakCategories.join(", ") || "inga"}\n- Senaste teoriprov-poäng: ${examData.recentScores.map(s => s + "%").join(", ") || "inga"}\n`
      : "";
    const mockSection = (examData.mockRecentScores.length > 0 || examData.mockWeakConcepts.length > 0)
      ? `\nMockprov (faktiska DB-resultat):\n- Svaga begrepp: ${examData.mockWeakConcepts.join(", ") || "inga"}\n- Senaste mockprov-poäng: ${examData.mockRecentScores.map(s => s + "%").join(", ") || "inga"}\n`
      : "";
    const felBankSection = (examData.felBankWeakConcepts.length > 0 || examData.felBankErrorTypes.length > 0)
      ? `\nFelbank (faktiska felsvar, senaste 10 prov):\n- Svaga begrepp: ${examData.felBankWeakConcepts.join(", ") || "inga"}\n- Vanliga feltyper: ${examData.felBankErrorTypes.join(", ") || "inga"}\n- Kurser med flest misstag: ${examData.felBankCourses.join(", ") || "inga"}\n`
      : "";
    const examSection = teoriprovSection + mockSection + felBankSection;

    const summaryPrompt = `Analysera P.E.R-konversationshistoriken och lärsignalerna nedan. Extrahera en elevprofil på svenska (max 130 ord).
Skriv som strukturerade rader, inte löptext. Ta med bara sådant som syns i underlaget.

Dataminimering:
- Spara aldrig namn, e-post, telefon, kontouppgifter, hemligheter, exakta frågetexter eller personliga detaljer.
- Spara bara lärmönster, svaga/starka områden, hjälpstil och nästa coachningssteg.
- Om något saknar evidens: skriv "okänt".

- Styrkor:
- Svagheter / återkommande problem:
- Föredragen hjälpstil:
- Produktbehov i ExGen (${MODULES.korkort ? 'körkort, ' : ''}mockprov, felbank, rapport, konto, pricing):
- Nästa bästa coachning:
${examSection}
Lärsignaler:
${signalText || "Inga extra lärsignaler."}

Historik:
${histText || "Ingen chathistorik tillgänglig."}

Svara på svenska, max 130 ord. Hitta inte på data.`;

    const summary = await callAIFn([{ role: "user", content: summaryPrompt }], { timeout: 20_000 });
    if (!summary) return;

    const structuredPrompt = `Analysera konversationshistoriken och extrahera ett strukturerat lärmönster.
Basera dig BARA på vad som faktiskt syns i historiken. Hitta inte på data.
Svaga/starka ämnen: ämnesnamn på svenska (t.ex. "Korsningar", "Matematik", "Vägmärken").
score_trajectory: lista med procenttal 0-100 i kronologisk ordning (om inga prov nämns: tom lista).
last_module: vilken ExGen-del eleven använde senast.
sessions_total: antal distinkta sessioner som syns.
exam_count: antal prov som nämns.
${examSection}
Historik:
${histText || "Ingen chathistorik tillgänglig."}`;

    let aiStructured = null;
    try {
      const rawStructured = await callAIFn(
        [{ role: "user", content: structuredPrompt }],
        { schema: STRUCTURED_SCHEMA, timeout: 15_000 }
      );
      if (rawStructured) {
        const parsed = typeof rawStructured === "string" ? JSON.parse(rawStructured) : rawStructured;
        aiStructured = {
          weak_topics:      (parsed.weak_topics || []).map(t => cleanMemoryText(t, 60)).slice(0, 6),
          strong_topics:    (parsed.strong_topics || []).map(t => cleanMemoryText(t, 60)).slice(0, 4),
          avg_score:        typeof parsed.avg_score === "number" ? Math.min(100, Math.max(0, parsed.avg_score)) : null,
          exam_count:       typeof parsed.exam_count === "number" ? Math.max(0, parsed.exam_count) : 0,
          study_pattern:    parsed.study_pattern || "unknown",
          last_module:      parsed.last_module || "unknown",
          score_trajectory: Array.isArray(parsed.score_trajectory)
            ? parsed.score_trajectory.slice(0, 5).map(n => Math.min(100, Math.max(0, Number(n) || 0)))
            : [],
          sessions_total:   typeof parsed.sessions_total === "number" ? Math.max(0, parsed.sessions_total) : 0,
        };
      }
    } catch { /* structured extraction is best-effort */ }

    // Preserve signal-tracked fields (help_level_log, preferred_help_level)
    // — these are written by updateHelpLevelSignal, not by AI extraction
    const existingStructured = data?.structured || {};
    const mergedStructured   = aiStructured
      ? {
          ...aiStructured,
          exam_weak_categories: examData.weakCategories,
          exam_recent_scores:   examData.recentScores,
          mock_weak_concepts:      examData.mockWeakConcepts,
          mock_recent_scores:      examData.mockRecentScores,
          felbank_weak_concepts:   examData.felBankWeakConcepts,
          felbank_error_types:     examData.felBankErrorTypes,
          felbank_courses:         examData.felBankCourses,
          help_level_log:       existingStructured.help_level_log || [],
          preferred_help_level: existingStructured.preferred_help_level ?? null,
        }
      : undefined;

    await supabase.from("per_long_memory").upsert(
      {
        user_id:    userId,
        summary:    cleanMemoryText(summary, 900),
        structured: mergedStructured,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  } catch {
    // Best-effort; never block the main P.E.R request.
  }
}

/* ── Elevens stil ───────────────────────────────────────────────────────────
 *
 * Härleder TON och LÄNGD ur elevens egna meddelanden. Ordval och meningsrytm
 * härleds med flit INTE: beslutet i specen är att P.E.R ska låta som någon som
 * känner eleven, inte som eleven. En lärare som härmar tappar den auktoritet
 * som gör att man litar på rättningen.
 *
 * Returnerar null när underlaget är för tunt. Det är avsiktligt: ingen signal
 * är bättre än en gissad, eftersom en felläst stil får P.E.R att låta som att
 * han pratar med någon annan. Fälten kan var för sig vara null av samma skäl.
 *
 * Ren funktion, inget nätverk. Kontrakt: tests/per/per-pedagogy.test.mjs V5-V6.
 */
const STIL_MIN_MEDDELANDEN = 3;
const BER_OM_MER   = /utförlig|mer detalj|förklara mer|längre förklaring|utveckla|mer ingående/i;
const BER_OM_KORT  = /kortare|kort svar|fatta dig kort|kortfattat|snabbt svar/i;
const SLANG        = /\b(va|vadå|asså|alltså typ|näe|nä|fan|typ|liksom|ba|iaf|nåt|nån)\b/i;

export function deriveStyleSignals(messages) {
  const egna = (Array.isArray(messages) ? messages : [])
    /* Bara elevens egna rader. Räknades assistentens med mätte signalen P.E.R:s
       stil i stället för elevens, och profilen hade drivit iväg av sig själv. */
    .filter(m => m && m.role === "user" && typeof m.content === "string")
    .map(m => m.content.trim())
    .filter(Boolean);

  if (egna.length < STIL_MIN_MEDDELANDEN) return null;

  // ── Längd ──
  let length = null;
  if (egna.some(t => BER_OM_MER.test(t)))       length = "utförlig";
  else if (egna.some(t => BER_OM_KORT.test(t))) length = "kort";
  else {
    // Median, inte medel: ett enda långt inklistrat stycke ska inte kunna
    // förvandla en kortskrivare till en långskrivare.
    const längder = egna.map(t => t.length).sort((a, b) => a - b);
    const median  = längder[Math.floor(längder.length / 2)];
    if (median <= 25) length = "kort";
    else if (median >= 120) length = "utförlig";
  }

  // ── Ton ──
  // Sätts bara vid tydlig majoritet. Ett gissat "informell" på en elev som
  // skriver formellt är värre än ingen signal alls.
  const informella = egna.filter(t => {
    const inledsGement = /^[a-zåäö]/.test(t);
    const saknarSlut   = !/[.!?]$/.test(t);
    return SLANG.test(t) || (inledsGement && saknarSlut);
  }).length;
  const tone = informella / egna.length >= 0.6 ? "informell" : null;

  return { length, tone };
}
