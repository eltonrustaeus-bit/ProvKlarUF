// /api/generate-exam.js
// FIXAD FÖR VERCEL (CommonJS) + robust import av ./_limit.js (ESM/CJS)
// - 3–20 frågor
// - Endast mc/short (ingen essay)
// - JSON-schema förhindrar andra typer
// - Returnerar alltid JSON även vid fel (så du slipper "FUNCTION_INVOCATION_FAILED")

let _limitCache = null;

async function getLimitModule() {
  if (_limitCache) return _limitCache;

  // 1) Försök CommonJS require
  try {
    // eslint-disable-next-line global-require
    const mod = require("./_limit.js");
    _limitCache = mod;
    return mod;
  } catch (_) {}

  // 2) Fallback: ESM dynamic import
  const mod = await import("./_limit.js");
  _limitCache = mod?.default ? { ...mod, ...mod.default } : mod;
  return _limitCache;
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

function looksLikeMath(course, pastedText) {
  const c = String(course || "");
  const t = String(pastedText || "");
  const s = (c + "\n" + t).toLowerCase();

  const kw = [
    "matematik",
    "math",
    "algebra",
    "ekvation",
    "funktion",
    "polynom",
    "potens",
    "exponent",
    "log",
    "ln",
    "derivata",
    "integral",
    "geometri",
    "sannolikhet",
    "statistik",
    "bråk",
    "procent",
    "linjär",
    "kvadrat",
    "parabel",
    "f(x)",
  ];
  if (kw.some((k) => s.includes(k))) return true;

  if (/[=<>]/.test(s) && /[xyz]/.test(s)) return true;
  if (/\b\d+\s*\/\s*\d+\b/.test(s)) return true;
  if (/[a-z]\s*\^\s*\d/.test(s)) return true;
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
            required: ["id", "type", "points", "question", "options", "correct_index", "rubric", "model_answer"],
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["mc", "short"] }, // ingen essay/mix i output
              points: { type: "number" },
              question: { type: "string" },
              options: { type: "array", items: { type: "string" }, maxItems: 6 },
              correct_index: { type: "integer" },
              rubric: { type: "string" },
              model_answer: { type: "string" },
            },
          },
        },
      },
    },
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

module.exports = async function handler(req, res) {
  // Säkerställ att alla fel blir JSON (inte "FUNCTION_INVOCATION_FAILED")
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY" });

    // Load limit module (ESM/CJS)
    const lim = await getLimitModule();
    const requireUser = lim?.requireUser;
    const consumeDailyQuota = lim?.consumeDailyQuota;

    if (typeof requireUser !== "function" || typeof consumeDailyQuota !== "function") {
      return json(res, 500, {
        ok: false,
        error: "LIMIT_MODULE_INVALID",
        details: "requireUser/consumeDailyQuota saknas i ./_limit.js",
      });
    }

    // 1) kräver inloggad användare (Supabase Bearer token)
    const u = await requireUser(req);
    if (!u?.ok) {
      return json(res, 401, { ok: false, error: u?.error || "UNAUTHORIZED" });
    }

    // 2) (valfritt) dra 1 försök från dagens quota
    // OBS: Ligger här som du hade det. Om du vill dra först vid lyckad OpenAI, flytta ner efter r.ok.
    const q = await consumeDailyQuota(u.userId);
    if (!q?.ok) {
      return json(res, 429, { ok: false, error: q?.error || "RATE_LIMIT", limit: q?.limit, count: q?.count });
    }

    let parsed;
    try {
      parsed = await readJsonBody(req);
    } catch (e) {
      return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) });
    }

    const lang = asEnum(parsed.lang, ["sv", "en"], "sv");
    const level = asEnum(parsed.level, ["E", "C", "A"], "C");
    const qType = asEnum(parsed.qType, ["mix", "mc", "short"], "mix"); // input-val (styr mixregeln)
    const course = safeString(parsed.course, 200);
    const pastedText = safeString(parsed.pastedText, 200000);

    const numQuestionsRaw = toInt(parsed.numQuestions, 12);
    const numQuestions = Math.min(20, Math.max(3, numQuestionsRaw));

    if (!pastedText.trim()) return json(res, 400, { ok: false, error: "Missing pastedText" });

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
      "5) model_answer ska alltid finnas. För mc: förklara varför rätt alternativ är rätt. För short: skriv ett fullpoängssvar.";

    const systemSvMath =
      "MATTE-LÄGE: Prioritera exakta, beräkningsbaserade frågor. " +
      "Rubric ska dela upp poäng på metod + slutsvar (t.ex. 'Metod 2p, svar 1p'). " +
      "Model_answer ska innehålla full lösning med tydliga steg och ett markerat slutsvar. " +
      "Flervalsalternativ ska vara plausibla felalternativ (typiska misstag) och endast ett korrekt.";

    const systemEnBase =
      "You create a realistic mock exam like a high-school teacher. " +
      "You MUST follow the JSON schema exactly and output only JSON. " +
      "EXACT number of questions. " +
      "Per-question rules: " +
      "1) type must be only 'mc' or 'short' (NO essays). " +
      "2) If type=='mc': options must have 3–5 choices and correct_index must be 0..(options.length-1). " +
      "3) If type=='short': options must be [] and correct_index must be -1. " +
      "4) rubric must be short and point-focused. " +
      "5) model_answer must always exist. For mc: explain why the correct option is correct. For short: provide a full-score answer.";

    const systemEnMath =
      "MATH MODE: Prioritize exact calculation questions. " +
      "Rubric must split points into method + final answer. " +
      "Model_answer must include a complete step-by-step solution and a clearly marked final answer. " +
      "MC options must be plausible distractors (common mistakes) with exactly one correct.";

    const systemPrompt =
      lang === "sv"
        ? systemSvBase + (isMath ? " " + systemSvMath : "")
        : systemEnBase + (isMath ? " " + systemEnMath : "");

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
      pastedText,
    ]
      .filter(Boolean)
      .join("\n");

    const userEn = [
      `Create a mock exam at level ${level}.`,
      course ? `Course/subject: ${course}.` : "",
      `Question type selection: ${qType}.`,
      mixRuleEn,
      `Number of questions: ${numQuestions}.`,
      "",
      "Material (use only this as the source):",
      pastedText,
    ]
      .filter(Boolean)
      .join("\n");

    const payload = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: lang === "sv" ? userSv : userEn },
      ],
      text: { format: responseFormat },
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return json(res, 500, { ok: false, error: "Non-JSON from OpenAI", status: r.status, raw });
    }
    if (!r.ok) return json(res, 500, { ok: false, error: "OpenAI error", status: r.status, details: data });

    const outputText =
      (Array.isArray(data.output) &&
        data.output
          .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
          .find((c) => c.type === "output_text")?.text) ||
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

    // Server-side guard + normalisering
    for (const q of exam.questions) {
      if (q?.type !== "mc" && q?.type !== "short") {
        return json(res, 500, { ok: false, error: "Invalid question type returned", got: q?.type });
      }
      if (q.type === "short") {
        if (!Array.isArray(q.options) || q.options.length !== 0) q.options = [];
        q.correct_index = -1;
      } else {
        if (!Array.isArray(q.options) || q.options.length < 3) {
          return json(res, 500, { ok: false, error: "MC options invalid", question: q });
        }
        if (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index >= q.options.length) {
          return json(res, 500, { ok: false, error: "MC correct_index invalid", question: q });
        }
      }
    }

    return json(res, 200, { ok: true, exam, meta: { isMath, model } });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.stack || e) });
  }
};
