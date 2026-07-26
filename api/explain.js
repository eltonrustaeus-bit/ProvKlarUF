import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./_auth.js";
import { callAI, callAIStream, buildPERSystemPrompt, buildPERLandingPrompt } from "./_per-core.js";
import { SALES_TRIGGER_REGEX, SUPPORT_TRIGGER_REGEX } from "./_provia-kb.js";
import { buildLearningSignals, loadLongMemory, maybeRefreshLongMemory, updateHelpLevelSignal } from "./_per-memory.js";
import { getFeatureLimit, normalizeRole } from "./_provia-rules.js";
import { buildPERContextPack } from "./_per-context.js";
import { retrieveChunks } from "../src/retrieval/legal-retrieval.mjs";
import perLegalPrompt, { sanitizeLegalQuestion } from "../src/ai/prompts/per-legal/v1.js";

const FRUSTRATION_REGEX = /fattar inte|förstår inte|helt lost|ger upp|hopplöst|omöjligt|förvirrad|inte alls|ingen koll|jag fattar|hjälp mig|wtf|ugh/i;
const FEYNMAN_REGEX     = /förklara för dig|jag förklarar|testa om jag|feynman|förklara det för mig som/i;
const QUIZ_REGEX        = /quizza mig|quiz mig|ställ.*fråga.*mig|testa mig.*fråga|välj.*fråga.*ställ/i;
const SUCCESS_REGEX     = /klarade|godkänt|100 ?%|alla rätt|noll fel|klarat provet|lyckades|fick rätt på alla/i;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function currentPeriodKey(period) {
  const now = new Date();
  if (period === "day") return now.toISOString().slice(0, 10);
  if (period === "month") return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const dayOfYear = Math.floor((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 86400000) + 1;
  return `${now.getUTCFullYear()}-W${String(Math.ceil(dayOfYear / 7)).padStart(2, "0")}`;
}

function sanitize(str, maxLen) {
  return typeof str === "string" ? str.slice(0, maxLen) : "";
}

// ── tips mode (merged from the former api/smart-tips.js) ──
function pickCourseGuide(courseName) {
  const c = String(courseName || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (c.includes("matematik") || c.includes("matte") || /\bma\s*[1-4]/.test(c) || /\bmat\s*[1-4]/.test(c)) {
    return `KURSGUIDE (Matematik):
- Svara strikt med matematiska steg: givna → metod → beräkning → slutsvar.
- Kontrollera alltid: tecken, parenteser, enheter, rimlighet.
- Om uppgiften handlar om funktioner: nollställe (f(x)=0), extrempunkt (topp/botten), symmetrilinje x=-b/(2a).
- Om exponenter/potenser: använd potenslagar och skriv om till samma bas innan du löser.`;
  }
  if (c.includes("naturkunskap") || c.includes("biologi") || c.includes("kemi") || c.includes("fysik")) {
    return `KURSGUIDE (Natur/NO):
- Svara med: begrepp → förklaring → orsak/konsekvens → exempel.
- Lyft centrala ord och definiera dem kort.
- Om beräkning förekommer: visa formel, sätt in värden med enheter, räkna, skriv slutsvar med enhet.
- Håll språket tydligt och sakligt, undvik onödiga sidospår.`;
  }
  if (c.includes("svenska") || c.includes("engelska")) {
    return `KURSGUIDE (Språk):
- Svara med: tes/budskap → stöd (exempel) → avslutande slutsats.
- Fokusera på disposition, tydliga sambandsord och korrekt begreppsanvändning.
- Ge konkreta förbättringar: meningsbyggnad, ordval, tydlighet, källhantering (om relevant).
- Exemplet ska visa korrekt struktur (inte bara innehåll).`;
  }
  if (c.includes("samhäll") || c.includes("historia") || c.includes("religion") || c.includes("geografi")) {
    return `KURSGUIDE (SO):
- Svara med: påstående → förklaring → exempel → koppling (orsak/konsekvens).
- Var noga med centrala begrepp och att skilja fakta från värdering.
- Om resonemang krävs: ta minst två perspektiv och jämför kort.`;
  }
  if (c.includes("ekonomi") || c.includes("entreprenörskap")) {
    return `KURSGUIDE (Ekonomi):
- Svara med: definition → modell/formel (om relevant) → tolkning → slutsats.
- Om företagsekonomi: koppla till intäkter/kostnader, lönsamhet, marginaler, kassaflöde.
- Om nationalekonomi: koppla till utbud/efterfrågan, inflation, ränta, BNP, arbetslöshet.
- Exemplet ska visa hur man motiverar med begrepp, inte bara räkna.`;
  }
  return `KURSGUIDE (Allmänt):
- Svara tydligt i steg: metod → tips → exempel → minnessätt.
- Utgå från vad som efterfrågas i frågan och vad feedbacken pekar på.
- Håll det kort, konkret och lätt att imitera.`;
}

async function handleTipsMode(req, res, body) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });

  const q = sanitize(String(body.question || ""), 2000);
  const fb = sanitize(String(body.feedback || ""), 2000);
  const ma = sanitize(String(body.model_answer || ""), 2000);
  const c = sanitize(String(body.course || ""), 200);
  if (!q.trim()) return res.status(400).json({ ok: false, error: "Missing question" });
  if (!fb.trim()) return res.status(400).json({ ok: false, error: "Missing feedback" });

  const systemPrompt = `Du är P.E.R — ExGens Egna AI-Resource.
Du ska ge korta, konkreta tips för en fråga eleven fått fel på.
Tipsen måste anpassas efter kursen.

${pickCourseGuide(c)}

Skriv exakt detta format:

Metod:
Kort bästa sättet att lösa uppgiften.

Tips:
Vad eleven ska tänka på.

Exempel:
Kort miniuppgift med lösning.

Minnessätt:
Kort trick eller regel.

Max 200 ord.`;
  const userContent = `Kurs:\n${c}\n\nFråga:\n${q}\n\nFeedback:\n${fb}\n\nModellsvar:\n${ma}`;
  try {
    const tips = await callAI(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
      { timeout: 45_000 }
    );
    if (!tips) return res.status(500).json({ ok: false, error: "No response" });
    return res.status(200).json({ ok: true, tips, course_used: c });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

// ── LEGAL MODE — P.E.R/P.E.R juridikläge (Fas 7, uppdragets §27.2) ──
// Feature-flag-gated (per_legal_rag_enabled, false sedan Fas 2-seedningen) OCH kräver att
// legalMode:true faktiskt skickas i body — ingen befintlig frontend-yta gör det än, så denna gren
// är i praktiken tredubbelt inert (ingen UI-trigger + flagga av + retrieveChunks() hittar inga
// review_status='approved' chunks eftersom pilotkorpusen ännu är helt 'pending', se
// 13-fas3-results.md). includePending hårdkodat false här av samma skäl som i api/knowledge.js
// (§18/§24) — aldrig klientstyrt.
async function legalModeEnabled() {
  const { data, error } = await supabase.from("feature_flags").select("enabled").eq("key", "per_legal_rag_enabled").maybeSingle();
  return !error && data?.enabled === true;
}

async function handleLegalMode(req, res, body, user) {
  if (!(await legalModeEnabled())) {
    return res.status(403).json({ error: "Juridikläge är inte aktiverat" });
  }

  const question = sanitizeLegalQuestion(body.userQuestion || body.topic || "");
  if (!question) return res.status(400).json({ error: "Ingen fråga angiven" });

  // Fas 8.3-härdning (Codex LOW-fynd, CR-2026-07-2X-009): legalMode hade inget kvotskydd.
  // Återanvänder samma perChat-kvot (plan/roll-baserad, atomisk RPC) som TEACH MODE redan
  // använder nedan i denna fil — juridikläget är konceptuellt en specialiserad P.E.R-chatt, så
  // det delar naturligt samma kvotpott istället för att uppfinna en egen mekanism. Placerad EFTER
  // frågevalideringen ovan (Codex CR-2026-07-2X-011-fynd) så en tom/ogiltig request inte bränner
  // kvot, men fortfarande FÖRE retrieval/AI-anropen nedan så en nekad kvot faktiskt sparar kostnad.
  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr) return res.status(500).json({ error: "DB error" });
  const role = normalizeRole(prof?.role);
  const legalCfg = getFeatureLimit(role, "perChat");
  if (legalCfg.cap !== Infinity) {
    const key = currentPeriodKey(legalCfg.period);
    const { data: q, error: qErr } = await supabase.rpc("consume_per_chat_quota", {
      p_user_id: user.id,
      p_period_key: key,
      p_limit: legalCfg.cap,
    });
    if (qErr) return res.status(500).json({ error: "Quota check failed" });
    if (!q?.ok) {
      return res.status(429).json({ error: "Quota exceeded", count: q?.count ?? legalCfg.cap, limit: legalCfg.cap });
    }
  }

  let retrieved;
  try {
    retrieved = await retrieveChunks(supabase, question, { matchCount: 4, includePending: false });
  } catch (e) {
    return res.status(502).json({ error: "Kunde inte söka i källmaterialet" });
  }

  // Inga godkända källor hittades — abstain utan att anropa den GENERATIVA modellen (§27.2: får
  // aldrig komplettera saknade fakta från modellminne). Codex-fynd (CR-2026-07-2X-009): ett
  // embeddings-anrop görs ändå inne i retrieveChunks() ovan (krävs för själva sökningen) —
  // försumbar kostnad (samma order som Fas 4:s backfill), men "inget OpenAI-anrop alls" vore fel
  // påstående. Det som garanterat aldrig sker vid abstain är ett genererat, ogrundat svar.
  if (!retrieved.length) {
    return res.status(200).json({
      ok: true,
      status: "insufficient_evidence",
      answer: null,
      reason: "Inget godkänt källmaterial hittades för den här frågan än.",
    });
  }

  const sourceChunks = retrieved.map((r) => ({ section_ref: r.section_ref, content: r.content }));
  try {
    const out = await callAI(
      [
        { role: "system", content: perLegalPrompt.systemPrompt() },
        { role: "user", content: perLegalPrompt.buildUserPrompt({ question, sourceChunks }) },
      ],
      { schema: perLegalPrompt.outputSchema(), timeout: 30_000 }
    );
    const parsed = JSON.parse(out);
    return res.status(200).json({ ok: true, ...parsed });
  } catch (e) {
    return res.status(502).json({ error: "AI-anrop misslyckades" });
  }
}

async function loadPerHistory(userId) {
  try {
    const { data } = await supabase
      .from("per_sessions")
      .select("messages")
      .eq("user_id", userId)
      .maybeSingle();
    return Array.isArray(data?.messages) ? data.messages : [];
  } catch { return []; }
}

async function savePerHistory(userId, messages) {
  try {
    await supabase.from("per_sessions").upsert(
      { user_id: userId, messages: messages.slice(-40), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  } catch { /* best-effort */ }
}

export default async function handler(req, res) {
  // GET — return stored PER history for the authenticated user
  if (req.method === "GET") {
    const user = await requireAuth(req, res);
    if (!user) return;
    const messages = await loadPerHistory(user.id);
    return res.json({ ok: true, history: messages });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};

  // ── TIPS MODE — felbank tips (merged from former /api/smart-tips) ──
  if (body.tipsMode === true) return handleTipsMode(req, res, body);

  // ── LANDING MODE — unauthenticated visitors on index/pricing ──
  if (body.landingMode === true) {
    const question = sanitize(String(body.userQuestion || body.topic || ''), 300).trim();
    if (!question) return res.status(400).json({ error: 'No question' });

    // Rate-limit anonymous callers to protect OpenAI spend (no auth on this path)
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const windowKey = new Date().toISOString().slice(0, 13); // hourly bucket (YYYY-MM-DDTHH)
    const LANDING_HOURLY_LIMIT = 15;
    try {
      const { data: rl } = await supabase.rpc('consume_anon_rate', {
        p_bucket: 'landing:' + ip,
        p_window_key: windowKey,
        p_limit: LANDING_HOURLY_LIMIT,
      });
      if (rl && rl.ok === false) {
        return res.status(429).json({ error: 'För många frågor just nu. Skapa ett gratis konto för obegränsad P.E.R.' });
      }
    } catch (_) { /* fail-open: never block a legit visitor on limiter infra hiccup */ }

    const msgs = [
      { role: 'system', content: buildPERLandingPrompt() },
      { role: 'user', content: question },
    ];
    try {
      const answer = await callAI(msgs, { timeout: 20_000 });
      if (!answer) return res.status(502).json({ error: 'No response' });
      return res.json({ answer });
    } catch (err) { return res.status(500).json({ error: err.message || 'AI error' }); }
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  // ── LEGAL MODE (Fas 7) — se handleLegalMode ovan för inertness-garantierna ──
  if (body.legalMode === true) return handleLegalMode(req, res, body, user);

  // ── READINESS SCORE MODE ──
  if (Array.isArray(body.scores)) {
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    const rawScores = body.scores.filter(s => typeof s === 'number' && Number.isFinite(s)).map(s => clamp(s, 0, 1));
    if (rawScores.length < 3) return res.status(400).json({ error: 'Minst 3 prov krävs.', examsProvided: rawScores.length });
    const rawAreas = Array.isArray(body.weakAreas) ? body.weakAreas.slice(0, 10).map(a => String(a).slice(0, 80)) : [];
    const examsCount = typeof body.examsCount === 'number' ? body.examsCount : rawScores.length;
    const recent5 = rawScores.slice(-5);
    const avgRecent = recent5.reduce((a, b) => a + b, 0) / recent5.length;
    const avgAll = rawScores.reduce((a, b) => a + b, 0) / rawScores.length;
    const half = Math.floor(rawScores.length / 2);
    const early = rawScores.slice(0, half).reduce((a, b) => a + b, 0) / (half || 1);
    const late  = rawScores.slice(-half).reduce((a, b) => a + b, 0) / (half || 1);
    const trend = late - early > 0.05 ? 'improving' : early - late > 0.05 ? 'declining' : 'stable';
    const mean = avgAll;
    const stdDev = Math.sqrt(rawScores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rawScores.length);
    const readiness = Math.round(clamp(avgRecent + (trend === 'improving' ? 0.04 : trend === 'declining' ? -0.04 : 0) + (stdDev > 0.15 ? -0.03 : 0), 0, 1) * 100);
    const trendSv = trend === 'improving' ? 'förbättras' : trend === 'declining' ? 'försämras' : 'stabil';
    const prompt = `Du är P.E.R — ExGens Egna AI-Resource och körkortscoach. Bedöm elevens körkortsförberedelse.\n\nDATA:\n- Snitt senaste 5 proven: ${Math.round(avgRecent*100)}%\n- Snitt alla ${examsCount} prov: ${Math.round(avgAll*100)}%\n- Trend: ${trendSv}\n- Beräknad beredskap: ${readiness}%\n- Svaga ämnen: ${rawAreas.length ? rawAreas.join(', ') : 'inga identifierade'}\n- Variation: ${stdDev > 0.15 ? 'hög (ojämnt)' : stdDev > 0.08 ? 'måttlig' : 'låg (konsekvent)'}\n\nKörkortsprovet kräver 52/65 rätt (80%). Max 100 ord. Ge: omdöme (redo/nästan redo/inte redo), viktigaste åtgärd, kort motivation. Svenska.`;
    try {
      const assessment = await callAI([{ role: 'user', content: prompt }], { timeout: 20_000 });
      if (!assessment) return res.status(502).json({ error: 'No response' });
      return res.json({ ok: true, readiness, trend, avgRecent: Math.round(avgRecent*100), avgAll: Math.round(avgAll*100), assessment });
    } catch (err) { return res.status(500).json({ error: err.message || 'AI error' }); }
  }

  // ── TEACH MODE: P.E.R multi-turn chat ──
  if (body.topic || body.userQuestion || (Array.isArray(body.history) && body.history.length > 0)) {
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("role, per_quota_count, per_quota_period")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) return res.status(500).json({ error: "DB error" });

    const role = normalizeRole(prof?.role);

    let quotaRemaining = null;
    const cfg = getFeatureLimit(role, "perChat");
    if (cfg.cap !== Infinity) {
      const key = currentPeriodKey(cfg.period);
      // Atomic check-and-increment — prevents quota bypass via concurrent requests
      const { data: q, error: qErr } = await supabase.rpc("consume_per_chat_quota", {
        p_user_id: user.id,
        p_period_key: key,
        p_limit: cfg.cap,
      });
      if (qErr) return res.status(500).json({ error: "Quota check failed" });
      if (!q?.ok) {
        return res.status(429).json({ error: "Quota exceeded", count: q?.count ?? cfg.cap, limit: cfg.cap });
      }
      quotaRemaining = Math.max(0, cfg.cap - (q.count || 0));
    }

    const topic        = sanitize(body.topic, 150);
    const userQuestion = sanitize(body.userQuestion, 500);
    const context      = sanitize(body.context, 400);
    const rawAreas     = Array.isArray(body.weakAreas) ? body.weakAreas : [];
    const weakAreas    = rawAreas.slice(0, 10).map(a => sanitize(String(a), 80));
    const helpLevel    = (typeof body.helpLevel === 'number' && Number.isFinite(body.helpLevel))
      ? Math.min(3, Math.max(0, Math.floor(body.helpLevel))) : 0;
    const rawHist = Array.isArray(body.history) ? body.history : [];
    const history = rawHist
      .filter(m => m && (m.role === "user" || m.role === "assistant"))
      .map(m => ({ role: m.role, content: sanitize(String(m.content), 500) }))
      .slice(-8);

    // Recent mistakes from frontend localStorage (optional — best-effort)
    const rawMistakes = Array.isArray(body.recentMistakes) ? body.recentMistakes : [];
    const recentMistakes = rawMistakes.slice(0, 10).map(m => ({
      question: sanitize(String(m.question || ''), 200),
      category: sanitize(String(m.category || m.course || ''), 60),
    }));

    const contextPack = buildPERContextPack({
      rawPageContext: body.pageContext,
      topic,
      context,
      weakAreas,
      recentMistakes,
    });
    const pageContext = contextPack.pageContext;

    // Intent, mood, mode detection
    const intent      = SUPPORT_TRIGGER_REGEX.test(userQuestion)
      ? 'support'
      : SALES_TRIGGER_REGEX.test(userQuestion)
        ? 'sales'
        : 'study';
    const mood        = FRUSTRATION_REGEX.test(userQuestion) ? 'frustrated' : 'normal';
    const feynman     = FEYNMAN_REGEX.test(userQuestion) || body.mode === 'feynman';
    const quiz        = QUIZ_REGEX.test(userQuestion) || body.mode === 'quiz';
    const celebrating = SUCCESS_REGEX.test(userQuestion);

    const ctxParts = [];
    if (topic) ctxParts.push(`Aktuellt ämne: ${topic}`);
    if (context) ctxParts.push(context);
    if (contextPack.summary) ctxParts.push(`Prioriterad sidkontext:\n${contextPack.summary}`);

    // Load long-term memory before buildLearningSignals so structuredMemory is in scope
    const { summary: longMemory, structured: structuredMemory } = await loadLongMemory(supabase, user.id);

    // Merge DB exam weak categories into session weak areas for immediate P.E.R awareness
    const dbWeakCats     = structuredMemory?.exam_weak_categories || [];
    const mergedWeakAreas = [...new Set([...contextPack.weakAreas, ...dbWeakCats])].slice(0, 10);

    const learningSignals = buildLearningSignals({
      weakAreas:      mergedWeakAreas,
      recentMistakes: contextPack.recentMistakes,
      pageContext,
      structured:     structuredMemory,
    });

    const sessionContext = structuredMemory ? {
      sessionCount:      structuredMemory.sessions_total ?? 0,
      lastActiveModule:  structuredMemory.last_module !== "unknown" ? structuredMemory.last_module : null,
      examCount:         structuredMemory.exam_count ?? 0,
      scoreImprovement:  (() => {
        const traj = structuredMemory.score_trajectory;
        if (!Array.isArray(traj) || traj.length < 2) return null;
        return Math.round(traj[traj.length - 1] - traj[0]);
      })(),
    } : null;

    const rawNamePart = (user.email || '').split('@')[0].split(/[.\-_+]/)[0];
    const studentName = /^[a-zåäöA-ZÅÄÖ]{2,15}$/.test(rawNamePart)
      ? rawNamePart.charAt(0).toUpperCase() + rawNamePart.slice(1).toLowerCase()
      : null;

    const systemContent = buildPERSystemPrompt({
      context: ctxParts.join('\n'),
      weakAreas: mergedWeakAreas,
      role,
      helpLevel,
      pageContext,
      intent,
      mood,
      feynman,
      quiz,
      celebrating,
      quotaRemaining,
      recentMistakes: contextPack.recentMistakes,
      longMemory,
      studentName,
      sessionContext,
      preferredHelpLevel: structuredMemory?.preferred_help_level ?? null,
    });

    const userMsg = userQuestion
      ? userQuestion
      : context
        ? `Förklara kortfattat: ${context}`
        : `Ge en kort, engagerande introduktion till ämnet ${topic} med ett praktiskt exempel.`;

    const msgs = [
      { role: "system", content: systemContent },
      ...history,
      { role: "user", content: userMsg },
    ];

    // ── STREAMING MODE ──
    const isStream = (req.headers['accept'] || '').includes('text/event-stream');
    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let fullText = '';
      try {
        const stream = await callAIStream(msgs, { timeout: 55_000 });
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const ev = JSON.parse(raw);
              const delta = ev.choices?.[0]?.delta?.content;
              if (delta) { fullText += delta; res.write(`data: ${JSON.stringify({ delta })}\n\n`); }
            } catch (_) {}
          }
        }
      } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message || 'AI error' })}\n\n`);
        return res.end();
      }

      if (!fullText) { res.write(`data: ${JSON.stringify({ error: 'No response' })}\n\n`); return res.end(); }

      const newHistory = [
        ...history,
        { role: 'user', content: userMsg },
        { role: 'assistant', content: fullText },
      ].slice(-20);
      await savePerHistory(user.id, newHistory);
      maybeRefreshLongMemory(supabase, user.id, newHistory, callAI, learningSignals).catch(() => {});
      updateHelpLevelSignal(supabase, user.id, helpLevel).catch(() => {});

      res.write(`data: ${JSON.stringify({ done: true, history: newHistory })}\n\n`);
      return res.end();
    }

    // ── JSON MODE (fallback) ──
    try {
      const answer = await callAI(msgs, { timeout: 30_000 });
      if (!answer) return res.status(502).json({ error: "No response generated" });
      const newHistory = [
        ...history,
        { role: "user", content: userMsg },
        { role: "assistant", content: answer },
      ].slice(-20);
      await savePerHistory(user.id, newHistory);
      maybeRefreshLongMemory(supabase, user.id, newHistory, callAI, learningSignals).catch(() => {});
      updateHelpLevelSignal(supabase, user.id, helpLevel).catch(() => {});
      return res.json({ answer, history: newHistory });
    } catch (err) {
      return res.status(500).json({ error: err.message || "AI error" });
    }
  }

  // ── EXPLAIN MODE: why an answer is correct ──
  const { question, correct, option_a, option_b, option_c, option_d } = body;
  if (!question || !correct) return res.status(400).json({ error: "question and correct required" });

  const opts = { A: option_a, B: option_b, C: option_c, D: option_d };
  const correctText = opts[correct] || correct;
  const prompt = `Du är P.E.R — ExGens Egna AI-Resource. Förklara kortfattat (max 60 ord) varför svaret på följande teorifråga är ${correct}: ${correctText}.

Fråga: ${question}
A: ${option_a || "—"}
B: ${option_b || "—"}
C: ${option_c || "—"}
D: ${option_d || "—"}

Svara på svenska. Fokusera på trafikregeln eller principen som gäller.`;

  try {
    const explanation = await callAI([{ role: "user", content: prompt }], { timeout: 30_000 });
    if (!explanation) return res.status(502).json({ error: "No explanation generated" });
    res.json({ explanation });
  } catch (err) {
    res.status(500).json({ error: err.message || "AI error" });
  }
}
