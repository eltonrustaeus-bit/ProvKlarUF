// /api/generate-exam.js
// Innehåll:
// - Tillåter 3–20 frågor
// - Inga limits / ingen inloggning krävs (borttagen requireUser + consumeDailyQuota)
// - Tar bort essä helt (endast: mc, short)
// - JSON-schema som aldrig tillåter "essay"
// ÄNDRING: Matte kan routas till DeepSeek (om DEEPSEEK_API_KEY finns). Fallback till OpenAI vid fel.

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
    "matematik", "math", "algebra", "ekvation", "funktion", "polynom",
    "potens", "exponent", "log", "ln", "derivata", "integral",
    "geometri", "sannolikhet", "statistik", "bråk", "procent",
    "linjär", "kvadrat", "parabel", "f(x)"
  ];
  if (kw.some(k => s.includes(k))) return true;

  if (/[=<>]/.test(s) && /[xyz]/.test(s)) return true;
  if (/\b\d+\s*\/\s*\d+\b/.test(s)) return true; // bråk
  if (/[a-z]\s*\^\s*\d/.test(s)) return true; // x^2
  if (/[√]/.test(s)) return true;
  if (/\bf\(\s*x\s*\)/.test(s)) return true;

  return false;
}

// ÄNDRING: välj provider + modell
function pickProviderAndModel({ isMath }) {
  const openaiBase = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const openaiMath = process.env.OPENAI_MODEL_MATH || openaiBase;

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const deepseekMathModel = process.env.DEEPSEEK_MODEL_MATH || "deepseek-reasoner";

  // Matte -> DeepSeek om key finns, annars OpenAI som tidigare
  if (isMath && deepseekKey) {
    return { provider: "deepseek", model: deepseekMathModel };
  }
  return { provider: "openai", model: isMath ? openaiMath : openaiBase };
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
              "id",
              "type",
              "points",
              "question",
              "options",
              "correct_index",
              "rubric",
              "model_answer"
            ],
            properties: {
              id: { type: "string" },
              // Endast dessa typer (ingen essay)
              type: { type: "string", enum: ["mc", "short"] },
              points: { type: "number" },
              question: { type: "string" },
              options: { type: "array", items: { type: "string" }, maxItems: 6 },
              correct_index: { type: "integer" },
              rubric: { type: "string" },
              model_answer: { type: "string" }
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

// ÄNDRING: helper för att plocka ut output_text från OpenAI Responses API
function extractOpenAIOutputText(data) {
  const outputText =
    (Array.isArray(data.output) &&
      data.output
        .flatMap(o => (Array.isArray(o.content) ? o.content : []))
        .find(c => c.type === "output_text")?.text) ||
    data.output_text ||
    null;

  return typeof outputText === "string" ? outputText : null;
}

// ÄNDRING: anropa DeepSeek chat/completions (promptstyrt JSON)
async function callDeepSeek({ apiKey, model, systemPrompt, userPrompt }) {
  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.2,
    // max_tokens är optional. Sätt en rimlig gräns.
    max_tokens: 2600,
    stream: false
  };

  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await r.text();
  let data = null;
  try { data = JSON.parse(raw); } catch {}

  if (!r.ok) {
    return { ok: false, status: r.status, raw, data };
  }

  const content = data?.choices?.[0]?.message?.content;
  return { ok: true, status: 200, raw, data, content: typeof content === "string" ? content : "" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  // ÄNDRING: OpenAI krävs bara om vi behöver fallback eller icke-matte
  // Vi kollar det senare beroende på provider.

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
  const pastedText = safeString(parsed.pastedText, 200000);

  const numQuestionsRaw = toInt(parsed.numQuestions, 12);
  const numQuestions = Math.min(20, Math.max(3, numQuestionsRaw));

  if (!pastedText.trim()) return json(res, 400, { ok: false, error: "Missing pastedText" });

  const isMath = looksLikeMath(course, pastedText);
  const picked = pickProviderAndModel({ isMath });
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
    "5) model_answer ska alltid finnas. För mc: förklara varför rätt alternativ är rätt. För short: skriv ett fullpoängssvar. ";

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
    "5) model_answer must always exist. For mc: explain why the correct option is correct. For short: provide a full-score answer. ";

  const systemEnMath =
    "MATH MODE: Prioritize exact calculation questions. " +
    "Rubric must split points into method + final answer. " +
    "Model_answer must include a complete step-by-step solution and a clearly marked final answer. " +
    "MC options must be plausible distractors (common mistakes) with exactly one correct.";

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

  // ÄNDRING: DeepSeek behöver extra tydlig “ONLY JSON”-guard (eftersom vi inte har json_schema enforcement där)
  const deepSeekJsonGuardSv =
    "\n\nVIKTIGT: Returnera ENDAST giltig JSON (ingen markdown, ingen text före/efter). " +
    "JSON måste följa exakt detta schema (ingen extra nyckel): title, level, questions[]. " +
    "Varje fråga måste ha: id, type('mc'|'short'), points(number), question(string), options(array), correct_index(int), rubric(string), model_answer(string). " +
    "För short: options=[] och correct_index=-1. För mc: options 3–5 och correct_index inom range.\n";

  const deepSeekJsonGuardEn =
    "\n\nIMPORTANT: Output ONLY valid JSON (no markdown, no extra text). " +
    "JSON must match exactly: title, level, questions[]. " +
    "Each question must include: id, type('mc'|'short'), points(number), question(string), options(array), correct_index(int), rubric(string), model_answer(string). " +
    "For short: options=[] and correct_index=-1. For mc: 3–5 options and correct_index in range.\n";

  const userPrompt = (lang === "sv" ? userSv : userEn) + (picked.provider === "deepseek"
    ? (lang === "sv" ? deepSeekJsonGuardSv : deepSeekJsonGuardEn)
    : "");

  // Försök med vald provider först
  async function runWithDeepSeek() {
    const deepKey = process.env.DEEPSEEK_API_KEY;
    if (!deepKey) return { ok: false, status: 500, error: "Missing DEEPSEEK_API_KEY" };

    const ds = await callDeepSeek({
      apiKey: deepKey,
      model: picked.model,
      systemPrompt,
      userPrompt
    });

    if (!ds.ok) {
      return { ok: false, status: ds.status || 500, error: "DeepSeek error", details: ds.data || ds.raw };
    }

    const outputText = (ds.content || "").trim();
    return { ok: true, outputText, metaModel: picked.model, provider: "deepseek" };
  }

  async function runWithOpenAI() {
    if (!openaiKey) return { ok: false, status: 500, error: "Missing OPENAI_API_KEY" };

    const payload = {
      model: picked.provider === "openai" ? picked.model : (process.env.OPENAI_MODEL_MATH || process.env.OPENAI_MODEL || "gpt-4o-mini"),
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      text: { format: responseFormat }
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, status: 500, error: "Non-JSON from OpenAI", details: { status: r.status, raw } };
    }
    if (!r.ok) return { ok: false, status: 500, error: "OpenAI error", details: { status: r.status, data } };

    const outputText = extractOpenAIOutputText(data);
    if (!outputText) return { ok: false, status: 500, error: "Missing output_text from OpenAI", details: data };

    return { ok: true, outputText, metaModel: payload.model, provider: "openai" };
  }

  try {
    let outputText = null;
    let usedProvider = picked.provider;
    let usedModel = picked.model;

    if (picked.provider === "deepseek") {
      const first = await runWithDeepSeek();

      // Om DeepSeek misslyckas att ge parsebar JSON => fallback till OpenAI
      if (first.ok) {
        outputText = first.outputText;
        usedProvider = first.provider;
        usedModel = first.metaModel;
      } else {
        // fallback
        const fb = await runWithOpenAI();
        if (!fb.ok) return json(res, fb.status || 500, { ok: false, error: fb.error, details: fb.details });
        outputText = fb.outputText;
        usedProvider = fb.provider;
        usedModel = fb.metaModel;
      }
    } else {
      const first = await runWithOpenAI();
      if (!first.ok) return json(res, first.status || 500, { ok: false, error: first.error, details: first.details });
      outputText = first.outputText;
      usedProvider = first.provider;
      usedModel = first.metaModel;
    }

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
      } else {
        if (!Array.isArray(q.options) || q.options.length < 3) {
          return json(res, 500, { ok: false, error: "MC options invalid", question: q });
        }
        if (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index >= q.options.length) {
          return json(res, 500, { ok: false, error: "MC correct_index invalid", question: q });
        }
      }
    }

    return json(res, 200, { ok: true, exam, meta: { isMath, provider: usedProvider, model: usedModel } });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e) });
  }
};
