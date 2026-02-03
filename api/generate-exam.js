// /api/generate-exam.js
// CommonJS (ingen "type":"module" behövs)

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function safeParseJSON(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function clampInt(x, min, max, fallback) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function pickModel() {
  // Du kan ändra via Vercel env: OPENAI_MODEL
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

async function openaiChatJSON({ messages, schema, temperature }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: pickModel(),
      temperature: typeof temperature === "number" ? temperature : 0.2,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "mock_exam_schema",
          strict: true,
          schema,
        },
      },
    }),
  });

  const txt = await resp.text();
  let data = safeParseJSON(txt);
  if (!resp.ok) {
    const msg = data?.error?.message || txt || "OpenAI error";
    const e = new Error(msg);
    e.status = resp.status;
    e.raw = txt;
    throw e;
  }

  const content = data?.choices?.[0]?.message?.content;
  const obj = safeParseJSON(content);
  if (!obj) {
    const e = new Error("Model did not return valid JSON content");
    e.status = 500;
    e.raw = txt;
    throw e;
  }
  return obj;
}

function buildSchema(numQuestions, qType) {
  const baseQuestion = {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["mc", "short", "essay"] },
      points: { type: "integer", minimum: 1, maximum: 10 },
      question: { type: "string", minLength: 5 },
      // MC:
      options: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 4,
        maxItems: 4,
      },
      correct: { type: "string", enum: ["A", "B", "C", "D"] },
    },
    required: ["id", "type", "points", "question"],
  };

  // För icke-MC får options/correct vara frånvarande.
  // Strict schema: vi löser det med oneOf per fråga.
  const mcQ = {
    ...baseQuestion,
    required: ["id", "type", "points", "question", "options", "correct"],
    properties: {
      ...baseQuestion.properties,
      type: { type: "string", enum: ["mc"] },
    },
  };
  const shortQ = {
    ...baseQuestion,
    required: ["id", "type", "points", "question"],
    properties: {
      ...baseQuestion.properties,
      type: { type: "string", enum: ["short"] },
      options: undefined,
      correct: undefined,
    },
  };
  const essayQ = {
    ...baseQuestion,
    required: ["id", "type", "points", "question"],
    properties: {
      ...baseQuestion.properties,
      type: { type: "string", enum: ["essay"] },
      options: undefined,
      correct: undefined,
    },
  };

  let itemSchema;
  if (qType === "mc") itemSchema = mcQ;
  else if (qType === "short") itemSchema = shortQ;
  else if (qType === "essay") itemSchema = essayQ;
  else {
    itemSchema = { oneOf: [mcQ, shortQ, essayQ] };
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      level: { type: "string", enum: ["E", "C", "A"] },
      questions: {
        type: "array",
        minItems: numQuestions,
        maxItems: numQuestions,
        items: itemSchema,
      },
    },
    required: ["title", "level", "questions"],
  };
}

function buildSystemPrompt() {
  return [
    "You are an exam generator for Swedish high-school style tests.",
    "Output MUST match the provided JSON schema exactly (strict).",
    "Generate questions only from the provided study material.",
    "No extra keys. No markdown. No explanations outside JSON.",
  ].join("\n");
}

function buildUserPrompt({ pastedText, level, course, qType, numQuestions, lang }) {
  const typeText =
    qType === "mc"
      ? "ONLY multiple-choice questions."
      : qType === "short"
      ? "ONLY short-answer questions."
      : qType === "essay"
      ? "ONLY essay/long-answer questions."
      : "Use a mix of types (mc, short, essay).";

  const langText =
    lang === "en"
      ? "Write questions in English."
      : "Write questions in Swedish.";

  const courseLine = course ? `Course/subject: ${course}\n` : "";

  return [
    `Create a mock exam.`,
    courseLine,
    `Target level: ${level}`,
    `Number of questions: EXACTLY ${numQuestions}`,
    `Question type rule: ${typeText}`,
    langText,
    "",
    "Study material (only source):",
    pastedText,
    "",
    "Rules:",
    `- Return exactly ${numQuestions} questions.`,
    `- Each question must have realistic points (1–10).`,
    `- If type is mc: provide exactly 4 options and correct letter A–D.`,
  ].join("\n");
}

function validateExam(exam, numQuestions, qType) {
  const qs = Array.isArray(exam?.questions) ? exam.questions : [];
  if (qs.length !== numQuestions) return `Wrong question count: ${qs.length} != ${numQuestions}`;

  if (qType === "mc") {
    for (const q of qs) {
      if (q.type !== "mc") return "Non-mc question returned while mc requested";
      if (!Array.isArray(q.options) || q.options.length !== 4) return "MC question missing 4 options";
      if (!["A", "B", "C", "D"].includes(q.correct)) return "MC question missing correct A-D";
    }
  }
  if (qType === "short") {
    for (const q of qs) if (q.type !== "short") return "Non-short returned while short requested";
  }
  if (qType === "essay") {
    for (const q of qs) if (q.type !== "essay") return "Non-essay returned while essay requested";
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Use POST" });

  const raw = req.body && typeof req.body === "object" ? null : await readBody(req);
  const body = req.body && typeof req.body === "object" ? req.body : safeParseJSON(raw);

  if (!body) return json(res, 400, { ok: false, error: "Invalid JSON body" });

  const pastedText = String(body.pastedText || "").trim();
  const level = String(body.level || "C").trim();
  const course = String(body.course || "").trim();
  const qType = String(body.qType || "mix").trim();
  const lang = String(body.lang || "sv").trim();

  const numQuestions = clampInt(body.numQuestions, 3, 12, 12);

  if (!pastedText) return json(res, 400, { ok: false, error: "Missing pastedText" });
  if (!["E", "C", "A"].includes(level)) return json(res, 400, { ok: false, error: "Invalid level" });
  if (!["mix", "mc", "short", "essay"].includes(qType)) return json(res, 400, { ok: false, error: "Invalid qType" });

  const schema = buildSchema(numQuestions, qType);

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: buildUserPrompt({ pastedText, level, course, qType, numQuestions, lang }),
    },
  ];

  try {
    // Retry 2 gånger om den missar count/type (även om schema är strict)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const exam = await openaiChatJSON({ messages, schema, temperature: 0.2 });
      const err = validateExam(exam, numQuestions, qType);
      if (!err) return json(res, 200, { ok: true, exam });

      if (attempt < 3) {
        messages.push({
          role: "user",
          content: `Your last output was invalid: ${err}. Regenerate and follow the schema and rules exactly.`,
        });
      } else {
        return json(res, 500, { ok: false, error: "Model output invalid", details: err, exam });
      }
    }
  } catch (e) {
    return json(res, 500, {
      ok: false,
      error: "OpenAI error",
      status: e.status || 500,
      details: String(e.message || e),
      raw: e.raw ? String(e.raw).slice(0, 2000) : undefined,
    });
  }
};
