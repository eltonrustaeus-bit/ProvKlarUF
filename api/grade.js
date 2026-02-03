// /api/grade.js

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

function pickModel() {
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
      temperature: typeof temperature === "number" ? temperature : 0.1,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "grading_schema",
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

function buildSchema(questionCount) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      total_points: { type: "integer", minimum: 0 },
      max_points: { type: "integer", minimum: 1 },
      per_question: {
        type: "array",
        minItems: questionCount,
        maxItems: questionCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            points: { type: "integer", minimum: 0 },
            max_points: { type: "integer", minimum: 1 },
            feedback: { type: "string", minLength: 1 },
            model_answer: { type: "string", minLength: 1 },
          },
          required: ["id", "points", "max_points", "feedback", "model_answer"],
        },
      },
    },
    required: ["total_points", "max_points", "per_question"],
  };
}

function buildSystemPrompt() {
  return [
    "You are a strict exam grader.",
    "Use ONLY the provided study material and the question text when judging correctness.",
    "Return JSON only, matching the schema (strict).",
    "For each question: give points, feedback, and a full-score model answer.",
    "Be concise but complete.",
  ].join("\n");
}

function buildUserPrompt({ pastedText, level, course, questions, answers, lang }) {
  const courseLine = course ? `Course/subject: ${course}\n` : "";
  const langText = lang === "en" ? "Write feedback and model answers in English." : "Skriv feedback och modellsvar på svenska.";

  return [
    "Grade the student's answers.",
    courseLine,
    `Target level: ${level}`,
    langText,
    "",
    "Study material (only source):",
    pastedText,
    "",
    "Questions:",
    JSON.stringify(questions),
    "",
    "Student answers:",
    JSON.stringify(answers),
    "",
    "Rules:",
    "- Use the question's points as max_points per question (if missing, assume 1).",
    "- total_points is sum of per_question points.",
    "- Always provide a model_answer that would get full points.",
  ].join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Use POST" });

  const raw = req.body && typeof req.body === "object" ? null : await readBody(req);
  const body = req.body && typeof req.body === "object" ? req.body : safeParseJSON(raw);
  if (!body) return json(res, 400, { ok: false, error: "Invalid JSON body" });

  const pastedText = String(body.pastedText || "").trim();
  const level = String(body.level || "C").trim();
  const course = String(body.course || "").trim();
  const lang = String(body.lang || "sv").trim();

  const questions = Array.isArray(body.questions) ? body.questions : null;
  const answers = Array.isArray(body.answers) ? body.answers : null;

  if (!pastedText) return json(res, 400, { ok: false, error: "Missing pastedText" });
  if (!questions || questions.length === 0) return json(res, 400, { ok: false, error: "Missing questions" });
  if (!answers) return json(res, 400, { ok: false, error: "Missing answers" });

  const maxPoints = questions.reduce((s, q) => s + (Number(q.points) > 0 ? Number(q.points) : 1), 0);

  const schema = buildSchema(questions.length);

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: buildUserPrompt({ pastedText, level, course, questions, answers, lang }),
    },
  ];

  try {
    const result = await openaiChatJSON({ messages, schema, temperature: 0.1 });

    // Säkerställ max_points om modellen råkar missa
    if (!Number.isFinite(result.max_points) || result.max_points <= 0) {
      result.max_points = maxPoints;
    }
    // Om total_points saknas/är fel: räkna om
    if (!Number.isFinite(result.total_points)) {
      result.total_points = (result.per_question || []).reduce((s, x) => s + (Number(x.points) || 0), 0);
    }

    return json(res, 200, { ok: true, result });
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
