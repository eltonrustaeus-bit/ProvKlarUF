
// /api/generate-exam.js
// Innehåll:
// - Tillåter 3–20 frågor
// - Kräver inloggning (requireAuth) + mockprovskvot (consumeMockExamQuota, atomär RPC)
// - Tar bort essä helt (endast: mc, short)
// - JSON-schema som aldrig tillåter "essay"

const assessment = require("./_assessment");

function cognitiveVerbHint(lang) {
  const v = assessment.COGNITIVE_VERBS;
  return lang === "sv"
    ? `Nivå E ska kräva: ${v.E.slice(0, 5).join(", ")}. ` +
      `Nivå C ska kräva: ${v.C.slice(0, 5).join(", ")}. ` +
      `Nivå A ska kräva: ${v.A.slice(0, 5).join(", ")}. ` +
      "Svårighetsgraden ska ändra VAD eleven måste göra, inte bara ordvalet."
    : `Level E must require: ${v.E.slice(0, 5).join(", ")}. ` +
      `Level C must require: ${v.C.slice(0, 5).join(", ")}. ` +
      `Level A must require: ${v.A.slice(0, 5).join(", ")}. ` +
      "The difficulty level must change WHAT the student has to do, not just the wording.";
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function safeString(x, maxLen = 200000) {
  const s = typeof x === "string" ? x : "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function asEnum(x, allowed, fallback) {
  return allowed.includes(x) ? x : fallback;
}

function toInt(x, fallback) {
  const n = Number.parseInt(String(x), 10);
  return Number.isFinite(n) ? n : fallback;
}

// Two tiers, because the old flat substring test was wrong in both directions.
//
// It used "log", which matched biologi / psykologi / sociologi / teknologi —
// those courses were routed to the math model and got the math rules applied.
// Anchoring everything at a word boundary fixes that but breaks Swedish
// compounds: "andragradsekvationer" would no longer be seen as maths.
//
// So: terms distinctive enough that no ordinary word contains them are matched
// anywhere (which covers compounds), and terms that also occur in everyday
// Swedish are matched at word start only.
const MATH_TERMS_ANYWHERE = [
  "matematik", "algebra", "ekvation", "olikhet", "polynom", "logaritm",
  "derivat", "integral", "geometri", "trigonometri", "cosinus", "tangens",
  "vektor", "sannolikhet", "parabel", "kvadrat", "funktion",
  "komplexa tal", "diskret matematik"
];
const MATH_TERMS_WORD_START = [
  "math", "potens", "exponent", "sinus", "statistik", "bråk", "procent", "linjär"
];

// "funktion" is in the anywhere-list so that andragradsfunktion/exponentialfunktion
// are caught, but Vård och omsorg has real courses built on the same stem. Those
// are not maths and must not be pulled into math mode.
// Global: a course title can carry two of these ("Funktionsförmåga och
// funktionsnedsättning"), and a non-global replace would leave the second one.
const NON_MATH_FUNKTION = /funktions(nedsättning|förmåga|hinder|variation)/gi;

const MATH_RE_ANYWHERE = new RegExp(`(?:${MATH_TERMS_ANYWHERE.join("|")})`, "i");
const MATH_RE_WORD = new RegExp(`\\b(?:${MATH_TERMS_WORD_START.join("|")})`, "i");

function looksLikeMath(course, pastedText) {
  const c = String(course || "");
  const t = String(pastedText || "");
  let s = (c + "\n" + t).toLowerCase();

  // Remove the welfare-sector compounds before testing, so they cannot satisfy
  // the "funktion" term while still letting a real maths term in the same text win.
  s = s.replace(NON_MATH_FUNKTION, " ");

  if (MATH_RE_ANYWHERE.test(s)) return true;
  if (MATH_RE_WORD.test(s)) return true;
  if (/\bln\b/.test(s)) return true;
  if (s.includes("f(x)")) return true;

  if (/[=<>]/.test(s) && /[xyz]/.test(s)) return true;
  if (/\b\d+\s*\/\s*\d+\b/.test(s)) return true; // bråk
  if (/[a-z]\s*\^\s*\d/.test(s)) return true; // x^2
  if (/[√]/.test(s)) return true;
  if (/\bf\(\s*x\s*\)/.test(s)) return true;

  return false;
}

function pickModel({ isMath }) {
  const base = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const math = process.env.OPENAI_MODEL_MATH || base;
  return isMath ? math : base;
}

function buildMockExamSchema(numQuestions) {
  return {
    type: "json_schema",
    name: "mock_exam_schema",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "level", "questions"],
      properties: {
        title: { type: "string" },
        level: { type: "string", enum: ["E", "C", "A"] },
        questions: {
          type: "array",
          minItems: numQuestions,
          maxItems: numQuestions,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id", "type", "points", "question", "options", "correct_index",
              "rubric", "model_answer",
              "topic", "subtopic", "learning_objective", "source_references",
              "cognitive_level", "accepted_answers", "estimated_answer_length",
              "scoring_rubric"
            ],
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["mc", "short"] },
              points: { type: "number" },
              question: { type: "string" },
              options: { type: "array", items: { type: "string" }, maxItems: 6 },
              correct_index: { type: "integer" },
              rubric: { type: "string" },
              model_answer: { type: "string" },
              topic: { type: "string" },
              subtopic: { type: "string" },
              learning_objective: { type: "string" },
              source_references: { type: "array", items: { type: "string" }, maxItems: 5 },
              cognitive_level: { type: "string", enum: ["minnas", "förstå", "tillämpa", "analysera", "värdera"] },
              accepted_answers: { type: "array", items: { type: "string" }, maxItems: 5 },
              estimated_answer_length: { type: "string", enum: ["none", "one_word", "one_sentence", "short_paragraph", "long_paragraph"] },
              // additionalProperties:false on a strict schema means this object must
              // always be present; for "mc" questions the model sends an empty-parts
              // shape and _assessment.js's gate only enforces shape for type==="short".
              scoring_rubric: {
                type: "object",
                additionalProperties: false,
                required: ["parts", "full_score_requirements", "partial_credit_notes"],
                properties: {
                  parts: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["description", "points"],
                      properties: { description: { type: "string" }, points: { type: "number" } }
                    }
                  },
                  full_score_requirements: { type: "string" },
                  partial_credit_notes: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function requireAuth(req) {
  const token = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const r = await fetch(
      process.env.SUPABASE_URL + "/auth/v1/user",
      {
        headers: {
          "Authorization": "Bearer " + token,
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY
        },
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return data?.id ? data : null;
  } catch { return null; }
}

async function loadCentralRules() {
  const m = await import("./_provia-rules.js");
  // This file is CJS and dynamically imports the ESM rules module. After
  // Vercel's ESM→CJS compile the named exports aren't reliably exposed on the
  // namespace, so `m.normalizeRole` can be undefined — fall back to default.
  return (m && typeof m.normalizeRole === "function") ? m : (m.default || m);
}

async function loadUserRole(userId) {
  try {
    const r = await fetch(
      process.env.SUPABASE_URL + "/rest/v1/profiles?select=role&id=eq." + encodeURIComponent(userId),
      {
        headers: {
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!r.ok) return "gratis";
    const data = await r.json();
    return String(data?.[0]?.role || "gratis");
  } catch {
    return "gratis";
  }
}

async function consumeMockExamQuota(userId, limit, rules) {
  if (limit.cap === Infinity) {
    return {
      ok: true,
      count: 0,
      limit: null,
      period: limit.period,
      unlimited: true,
      enforced: true
    };
  }

  const periodKey = rules.currentPeriodKey(limit.period);
  const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/rpc/consume_mock_exam_quota", {
    method: "POST",
    headers: {
      "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_period_key: periodKey,
      p_limit: limit.cap
    }),
    signal: AbortSignal.timeout(5000)
  });

  const raw = await r.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

  if (!r.ok) {
    const err = new Error("Mock quota schema or RPC failed");
    err.status = r.status;
    err.details = data || raw;
    throw err;
  }

  return {
    ok: data?.ok === true,
    count: Number(data?.count || 0),
    limit: data?.limit ?? limit.cap,
    period: data?.period || periodKey,
    unlimited: data?.unlimited === true,
    enforced: true
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const user = await requireAuth(req);
  if (!user) return json(res, 401, { ok: false, error: "Unauthorized" });

  const rules = await loadCentralRules();
  const role = rules.normalizeRole(await loadUserRole(user.id));
  const mockLimit = rules.getFeatureLimit(role, "mockExam");
  const entitlements = rules.getEntitlementSnapshot(role);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY" });

  let parsed;
  try {
    parsed = await readJsonBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) });
  }

  const lang = asEnum(parsed.lang, ["sv", "en"], "sv");
  const level = asEnum(parsed.level, ["E", "C", "A"], "C");
  const qType = asEnum(parsed.qType, ["mix", "mc", "short"], "mix");
  const course = safeString(parsed.course, 200);
  const pastedText = safeString(parsed.pastedText, 3000);

  const numQuestionsRaw = toInt(parsed.numQuestions, 12);
  const numQuestions = Math.min(20, Math.max(3, numQuestionsRaw));

  if (!pastedText.trim()) return json(res, 400, { ok: false, error: "Missing pastedText" });

  let quota;
  try {
    quota = await consumeMockExamQuota(user.id, mockLimit, rules);
  } catch (e) {
    return json(res, 500, {
      ok: false,
      error: "mock_quota_unavailable",
      message: "Mockprovskvoten kunde inte kontrolleras. Kör Supabase-migrationen innan den här versionen deployas.",
      details: e.details || String(e)
    });
  }

  if (!quota.ok) {
    return json(res, 429, {
      ok: false,
      error: "Quota exceeded",
      count: quota.count,
      limit: quota.limit,
      period: quota.period
    });
  }

  const isMath = looksLikeMath(course, pastedText);
  const model = pickModel({ isMath });
  const responseFormat = buildMockExamSchema(numQuestions);

  const systemSvBase =
    "Du skapar ett realistiskt mockprov som en svensk gymnasielärare. " +
    "Du MÅSTE följa JSON-schemat exakt och bara returnera JSON. " +
    "EXAKT antal frågor. " +
    "Regler per fråga: " +
    "1) type får bara vara 'mc' eller 'short' (INTE essä). " +
    "2) Om type=='mc': options ska ha 3–5 alternativ och correct_index ska vara 0..(options.length-1). " +
    "3) Om type=='short': options ska vara [] och correct_index ska vara -1. " +
    "4) rubric ska vara kort och poängfokuserad. " +
    "5) model_answer ska alltid finnas. För mc: förklara varför rätt alternativ är rätt. För short: skriv ett fullpoängssvar. " +
    "6) topic/subtopic/learning_objective ska kort beskriva vad frågan mäter. " +
    "7) source_references ska lista vilken del av det inskickade materialet frågan bygger på (kort citat eller rubrik) — hitta ALDRIG på fakta som inte finns i materialet. " +
    "8) cognitive_level ska vara ett av: minnas, förstå, tillämpa, analysera, värdera — matchat mot nivå (se separat instruktion). " +
    "9) Om type=='short': scoring_rubric.parts ska bryta ner poängen i konkreta delmoment (t.ex. 'Definition: 1p', 'Villkor: 2p') som tillsammans summerar till points. full_score_requirements ska säga EXAKT vad som krävs för full poäng — fråga aldrig i hemlighet efter mer än vad question-texten bad om. accepted_answers ska lista alternativa godtagbara formuleringar. " +
    "10) Om type=='mc': scoring_rubric ska ändå finnas i svaret men med tom parts-array, full_score_requirements='' , partial_credit_notes=''. " +
    "11) estimated_answer_length ska matcha vad points faktiskt kräver — en 1-poängsfråga ska inte kräva 'long_paragraph'. " +
    cognitiveVerbHint("sv") + " ";

  const systemSvMath =
    "MATTE-LÄGE: Matematik är ett färdighetsämne. Provet ska mäta elevens förmåga att LÖSA " +
    "matematiska problem — inte att återge teori. " +
    "Fördelning över hela provet (håll den): 70–80 % beräkning och problemlösning, " +
    "15–25 % resonemang och tillämpning, 5–10 % begrepp och definitioner. " +
    "Prioritera uppgifter där eleven ska: lösa ett problem och visa hela lösningsgången; " +
    "välja lämplig metod och motivera valet; tolka graf, tabell eller figur; " +
    "använda matematik i en verklighetsnära situation; hitta och rätta felet i en given lösning; " +
    "jämföra två lösningsmetoder och avgöra vilken som är mest effektiv. " +
    "Undvik frågor av typen 'Vad är...', 'Definiera...' och 'Vad används ... till?'. " +
    "Sådana får bara användas när de verkligen testar förståelse eller när kursens centrala " +
    "innehåll kräver det, och aldrig mer än den avsatta begreppsandelen. " +
    "Anpassa uppgifterna till kursens ämnesområde — t.ex. algebra, andragradsekvationer, " +
    "funktioner, geometri, trigonometri, derivata, integraler, sannolikhet, statistik, " +
    "logaritmer, exponentialfunktioner, vektorer, komplexa tal eller diskret matematik. " +
    "Svårighetsgrad, uppgiftstyper och bedömning ska följa Skolverkets centrala innehåll och " +
    "kunskapskrav för den aktuella kursen. " +
    "Rubric ska dela upp poäng på metod + slutsvar (t.ex. 'Metod 2p, svar 1p'). " +
    "Model_answer ska innehålla full lösning med tydliga steg och ett markerat slutsvar. " +
    "Flervalsalternativ ska vara plausibla felalternativ (typiska räknefel) och endast ett korrekt.";

  const systemEnBase =
    "You create a realistic mock exam like a high-school teacher. " +
    "You MUST follow the JSON schema exactly and output only JSON. " +
    "EXACT number of questions. " +
    "Per-question rules: " +
    "1) type must be only 'mc' or 'short' (NO essays). " +
    "2) If type=='mc': options must have 3–5 choices and correct_index must be 0..(options.length-1). " +
    "3) If type=='short': options must be [] and correct_index must be -1. " +
    "4) rubric must be short and point-focused. " +
    "5) model_answer must always exist. For mc: explain why the correct option is correct. For short: provide a full-score answer. " +
    "6) topic/subtopic/learning_objective must briefly describe what the question measures. " +
    "7) source_references must list which part of the provided material the question is based on (brief quote or heading) — NEVER invent facts not in the material. " +
    "8) cognitive_level must be one of: minnas, förstå, tillämpa, analysera, värdera — matched to the level (see separate instruction). " +
    "9) If type=='short': scoring_rubric.parts must break down the points into concrete sub-components (e.g. 'Definition: 1p', 'Conditions: 2p') that sum to points. full_score_requirements must state EXACTLY what is required for full marks — never secretly ask for more than what the question text requested. accepted_answers must list alternative acceptable phrasings. " +
    "10) If type=='mc': scoring_rubric must still be present in the response but with an empty parts array, full_score_requirements='', partial_credit_notes=''. " +
    "11) estimated_answer_length must match what the points actually require — a 1-point question should not require 'long_paragraph'. " +
    cognitiveVerbHint("en") + " ";

  const systemEnMath =
    "MATH MODE: Mathematics is a skills subject. The exam must measure the student's ability " +
    "to SOLVE mathematical problems — not to recite theory. " +
    "Distribution across the whole exam (hold it): 70–80 % calculation and problem solving, " +
    "15–25 % reasoning and application, 5–10 % concepts and definitions. " +
    "Prioritize tasks where the student must: solve a problem and show the full working; " +
    "choose a suitable method and justify the choice; interpret a graph, table or figure; " +
    "apply mathematics to a real-world situation; find and correct the error in a given solution; " +
    "compare two solution methods and decide which is most efficient. " +
    "Avoid questions of the form 'What is...', 'Define...' and 'What is ... used for?'. " +
    "Those may only be used when they genuinely test understanding or when the course's core " +
    "content requires it, and never beyond the allotted concept share. " +
    "Adapt tasks to the course's topic area — e.g. algebra, quadratic equations, functions, " +
    "geometry, trigonometry, derivatives, integrals, probability, statistics, logarithms, " +
    "exponential functions, vectors, complex numbers or discrete mathematics. " +
    "Difficulty, task types and assessment must follow the Swedish National Agency for " +
    "Education's core content and knowledge requirements for the course in question. " +
    "Rubric must split points into method + final answer (e.g. 'Method 2p, answer 1p'). " +
    "Model_answer must include a complete step-by-step solution and a clearly marked final answer. " +
    "MC options must be plausible distractors (typical calculation mistakes) with exactly one correct.";

  const systemPrompt =
    lang === "sv"
      ? systemSvBase + (isMath ? (" " + systemSvMath) : "")
      : systemEnBase + (isMath ? (" " + systemEnMath) : "");

  const mixRuleSv =
    qType === "mc"
      ? "Gör ALLA frågor som flervalsfrågor (mc)."
      : qType === "short"
        ? "Gör ALLA frågor som kortsvar (short)."
        : "Gör en blandning av 'mc' och 'short' (ungefär hälften/hälften).";

  const mixRuleEn =
    qType === "mc"
      ? "Make ALL questions multiple choice (mc)."
      : qType === "short"
        ? "Make ALL questions short answer (short)."
        : "Make a mix of 'mc' and 'short' (about half/half).";

  const userSv = [
    `Skapa ett mockprov på nivå ${level}.`,
    course ? `Kurs/ämne: ${course}.` : "",
    `Frågetyp-val: ${qType}.`,
    mixRuleSv,
    `Antal frågor: ${numQuestions}.`,
    "",
    "Material (använd bara detta som underlag):",
    pastedText
  ].filter(Boolean).join("\n");

  const userEn = [
    `Create a mock exam at level ${level}.`,
    course ? `Course/subject: ${course}.` : "",
    `Question type selection: ${qType}.`,
    mixRuleEn,
    `Number of questions: ${numQuestions}.`,
    "",
    "Material (use only this as the source):",
    pastedText
  ].filter(Boolean).join("\n");

  try {
    const payload = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: lang === "sv" ? userSv : userEn }
      ],
      text: { format: responseFormat }
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000)
    });

    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return json(res, 500, { ok: false, error: "Non-JSON from OpenAI", status: r.status });
    }
    if (!r.ok) return json(res, 500, { ok: false, error: "OpenAI error", status: r.status, details: data });

    const outputText =
      (Array.isArray(data.output) &&
        data.output
          .flatMap(o => (Array.isArray(o.content) ? o.content : []))
          .find(c => c.type === "output_text")?.text) ||
      data.output_text ||
      null;

    let exam;
    try {
      exam = JSON.parse(outputText);
    } catch (e) {
      return json(res, 500, { ok: false, error: "Could not parse model JSON", details: String(e), outputText });
    }

    if (!exam || !Array.isArray(exam.questions) || exam.questions.length !== numQuestions) {
      return json(res, 500, { ok: false, error: "Schema mismatch", exam });
    }

    // Server-side guard: inga essay + fixa short-regler
    for (const q of exam.questions) {
      if (q?.type !== "mc" && q?.type !== "short") {
        return json(res, 500, { ok: false, error: "Invalid question type returned", got: q?.type });
      }

      if (q.type === "short") {
        if (!Array.isArray(q.options)) q.options = [];
        q.options = [];
        q.correct_index = -1;
        if (!q.scoring_rubric || !Array.isArray(q.scoring_rubric.parts)) {
          return json(res, 500, { ok: false, error: "Missing scoring_rubric on short question", question: q });
        }
      } else {
        if (!Array.isArray(q.options) || q.options.length < 3) {
          return json(res, 500, { ok: false, error: "MC options invalid", question: q });
        }
        if (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index >= q.options.length) {
          return json(res, 500, { ok: false, error: "MC correct_index invalid", question: q });
        }
      }
    }

    // ── STRUCTURAL GATE (subject-agnostic, deterministic) ─────────────────
    const subjectProfile = assessment.detectSubjectProfile(course, pastedText);
    let gate = assessment.gateExam(exam, { profile: subjectProfile });
    exam.questions = gate.questions;

    // ── VERIFIER PASS (separate role — checks, never fixes) ───────────────
    const verifier = require("./_verifier");
    let verifierOutcome = { checked: 0, approved: 0, rejected: 0, callOk: false };
    if (exam.questions.length > 0) {
      const v1 = await verifier.verifyQuestions(exam.questions, { apiKey, model, subjectProfile, lang });
      verifierOutcome.callOk = v1.callOk;
      if (v1.callOk) {
        const approvedIds = new Set();
        const rejectedIds = [];
        for (const q of exam.questions) {
          const vres = v1.perQuestion.get(String(q.id));
          verifierOutcome.checked++;
          if (vres && verifier.decideApproval(vres)) { approvedIds.add(String(q.id)); verifierOutcome.approved++; }
          else { rejectedIds.push(String(q.id)); verifierOutcome.rejected++; }
        }
        // Tracks whichever verifier result map is currently authoritative for
        // per-question stamping below — round 1 unless a regeneration round
        // actually succeeds and replaces exam.questions with round-2 output.
        let activeVerifierMap = v1.perQuestion;
        // One bounded regeneration attempt for the whole exam if too much was
        // rejected (mirrors the existing >30%-flagged retry threshold below) —
        // never loop, never regenerate per-question (cost + spec §13 says no
        // unbounded regeneration loops).
        if (rejectedIds.length > 0 && rejectedIds.length / exam.questions.length > 0.3) {
          // Round-1 structurally-gated questions, kept aside so that if
          // regeneration fails for any reason we can still fall back to just
          // the subset that DID pass verification — never ship a question the
          // verifier explicitly rejected merely because regeneration failed.
          const originalGatedQuestions = exam.questions;
          // Snapshot round-1's structural gate result so the fallback path
          // (regeneration attempted but round-2 verifier call fails, or
          // regeneration fails outright) can restore it alongside
          // exam.questions/activeVerifierMap — otherwise gate would keep
          // describing round-2's regenerated exam even though round-1
          // questions are what actually ships.
          const round1Gate = gate;
          let regenerationSucceeded = false;
          const r2 = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(45_000)
          });
          const raw2 = await r2.text();
          let data2; try { data2 = JSON.parse(raw2); } catch { data2 = null; }
          if (r2.ok && data2) {
            const out2 = (Array.isArray(data2.output) && data2.output.flatMap(o => Array.isArray(o.content) ? o.content : []).find(c => c.type === "output_text") || {}).text || null;
            let exam2; try { exam2 = out2 ? JSON.parse(out2) : null; } catch { exam2 = null; }
            if (exam2 && Array.isArray(exam2.questions) && exam2.questions.length === numQuestions) {
              gate = assessment.gateExam(exam2, { profile: subjectProfile });
              const regatedQuestions = gate.questions;
              if (regatedQuestions.length > 0) {
                const v2 = await verifier.verifyQuestions(regatedQuestions, { apiKey, model, subjectProfile, lang });
                if (v2.callOk) {
                  const kept = [];
                  const outcome2 = { checked: 0, approved: 0, rejected: 0, callOk: true };
                  for (const q of regatedQuestions) {
                    const vres = v2.perQuestion.get(String(q.id));
                    outcome2.checked++;
                    if (vres && verifier.decideApproval(vres)) { kept.push(q); outcome2.approved++; }
                    else outcome2.rejected++;
                  }
                  if (kept.length > 0) {
                    exam.questions = kept;
                    activeVerifierMap = v2.perQuestion;
                    verifierOutcome = outcome2;
                    regenerationSucceeded = true;
                  }
                }
              }
            }
          }
          if (!regenerationSucceeded) {
            // Regeneration failed outright (network/parse/shape) or produced
            // zero verified-approved questions after re-gating/re-verifying —
            // fall back to the round-1 approved subset instead of shipping the
            // original, unfiltered (still verifier-rejected) batch.
            exam.questions = originalGatedQuestions.filter(q => approvedIds.has(String(q.id)));
            activeVerifierMap = v1.perQuestion;
            gate = round1Gate;
            // verifierOutcome already holds round-1 checked/approved/rejected counts.
          }
        } else {
          exam.questions = exam.questions.filter(q => approvedIds.has(String(q.id)));
        }
        // Stamp per-question validation metadata (spec: every question carries
        // its own validation_status/confidence_score/detected_issues, not just
        // an aggregate). Safe to leave on the object — app.html's renderExam()
        // only reads .question/.options/.type/.points/.id, unknown properties
        // are simply ignored, never rendered.
        for (const q of exam.questions) {
          const vres = activeVerifierMap.get(String(q.id));
          q.validation_status = vres ? "verified" : "gate_only";
          q.confidence_score = vres
            ? Number((
                (Number(vres.factual_accuracy) + Number(vres.ambiguity_score >= 0 ? 1 - vres.ambiguity_score : 0) +
                 Number(vres.difficulty_match) + Number(vres.source_alignment) + Number(vres.scoring_quality) +
                 Number(vres.language_quality)) / 6
              ).toFixed(2))
            : null;
          q.detected_issues = vres && Array.isArray(vres.issues) ? vres.issues : [];
        }
      } else {
        // Verifier call failed outright (network/parse error) — fail open on the
        // structural gate's output rather than blocking delivery entirely (matches
        // the existing best-effort behavior of the old reviewer pass), but say so.
        for (const q of exam.questions) {
          q.validation_status = "gate_only";
          q.confidence_score = null;
          q.detected_issues = [];
        }
      }
    }

    if (exam.questions.length === 0) {
      return json(res, 502, {
        ok: false,
        error: "Alla frågor underkändes av kvalitetskontrollen. Försök igen.",
        gate: { profile: subjectProfile, dropped: gate.dropped },
      });
    }

    // ── OBSERVABILITY (structured, no question/answer content logged) ─────
    console.log(JSON.stringify({
      event: "exam_quality_gate",
      subjectProfile,
      numRequested: numQuestions,
      structurallyDropped: gate.dropped.length,
      structurallyFlagged: gate.flagged.length,
      verifierChecked: verifierOutcome.checked,
      verifierApproved: verifierOutcome.approved,
      verifierRejected: verifierOutcome.rejected,
      verifierCallOk: verifierOutcome.callOk,
      finalQuestionCount: exam.questions.length,
    }));

    // Verifier-internal fields (validation_status/confidence_score/detected_issues)
    // are stamped above for the gating decision and the observability log, but
    // must never reach the browser response body (plan's Global Constraint: no
    // secrets or internal fields — akey_sig, verifier scores, prompt text — may
    // reach the client). Strip them from a shallow-copied exam for the response
    // only; the original exam.questions objects (used above) are left untouched.
    const clientExam = {
      ...exam,
      questions: exam.questions.map((q) => {
        const { validation_status, confidence_score, detected_issues, ...clientQuestion } = q;
        return clientQuestion;
      }),
    };

    return json(res, 200, {
      ok: true,
      exam: clientExam,
      meta: {
        isMath,
        subjectProfile,
        gate: { profile: subjectProfile, dropped: gate.dropped.length, flagged: gate.flagged.length },
        verifier: verifierOutcome,
        model,
        entitlements,
        quota: {
          feature: "mockExam",
          period: quota.period,
          count: quota.count,
          limit: quota.limit,
          unlimited: quota.unlimited,
          enforced: quota.enforced
        }
      }
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e) });
  }
};
