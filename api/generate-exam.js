// api/generate-exam.js (CommonJS / Vercel Serverless)
// Structured Outputs JSON Schema WITHOUT oneOf
// Includes correct_index for MC so grading becomes deterministic.

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function pickModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
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
              type: { type: "string", enum: ["mc", "short", "essay", "mix"] },
              points: { type: "number" },
              question: { type: "string" },

              // Always present. For non-mc: [].
              options: {
                type: "array",
                items: { type: "string" },
                maxItems: 6
              },

              // Always present.
              // For mc: 0..(options.length-1)
              // For non-mc: -1
              correct_index: { type: "integer" },

              // Always present: short "what gives full points" rubric
              rubric: { type: "string" },

              // Always present: a concise full-score answer (for short/essay), for mc you can repeat the correct option meaning
              model_answer: { type: "string" }
            }
          }
        }
      }
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "Use POST" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY" });

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let parsed;
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch (e) {
      return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) });
    }

    const lang = asEnum(parsed.lang, ["sv", "en"], "sv");
    const level = asEnum(parsed.level, ["E", "C", "A"], "C");
    const qType = asEnum(parsed.qType, ["mix", "mc", "short", "essay"], "mix");
    const course = safeString(parsed.course, 200);
    const pastedText = safeString(parsed.pastedText, 200000);

    const numQuestionsRaw = toInt(parsed.numQuestions, 12);
    const numQuestions = Math.min(12, Math.max(3, numQuestionsRaw)); // 3–12

    if (!pastedText.trim()) return json(res, 400, { ok: false, error: "Missing pastedText" });

    const responseFormat = buildMockExamSchema(numQuestions);
    const model = pickModel();

    const systemSv =
      "Du skapar ett realistiskt mockprov som en svensk gymnasielärare. " +
      "Du MÅSTE följa JSON-schemat exakt, och bara returnera JSON. " +
      "EXAKT antal frågor. " +
      "Regler per fråga: " +
      "1) options ska vara [] om type != 'mc'. " +
      "2) correct_index: om type=='mc' -> ett heltal som pekar på rätt alternativ (0=A,1=B,...). Om inte mc -> -1. " +
      "3) rubric ska vara kort och poängfokuserad. " +
      "4) model_answer ska alltid finnas: för mc kan du skriva vad rätt alternativ betyder; för short/essay skriv ett fullpoängsvar.";

    const systemEn =
      "You create a realistic mock exam like a high-school teacher. " +
      "You MUST follow the JSON schema exactly and output only JSON. " +
      "EXACT number of questions. " +
      "Per-question rules: " +
      "1) options must be [] if type != 'mc'. " +
      "2) correct_index: if type=='mc' -> integer pointing to correct option (0=A,1=B,...). Otherwise -1. " +
      "3) rubric must be short and point-focused. " +
      "4) model_answer must always exist: for mc describe what the correct option means; for short/essay provide a full-score answer.";

    const userSv = [
      `Skapa ett mockprov på nivå ${level}.`,
      course ? `Kurs/ämne: ${course}.` : "",
      `Frågetyp-val: ${qType}.`,
      `Antal frågor: ${numQuestions}.`,
      "",
      "Material (använd bara detta som underlag):",
      pastedText
    ].filter(Boolean).join("\n");

    const userEn = [
      `Create a mock exam at level ${level}.`,
      course ? `Course/subject: ${course}.` : "",
      `Question type selection: ${qType}.`,
      `Number of questions: ${numQuestions}.`,
      "",
      "Material (use only this as the source):",
      pastedText
    ].filter(Boolean).join("\n");

    try {
      const payload = {
        model,
        input: [
          { role: "system", content: lang === "sv" ? systemSv : systemEn },
          { role: "user", content: lang === "sv" ? userSv : userEn }
        ],
        text: { format: responseFormat }
      };

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        return json(res, 500, { ok: false, error: "Non-JSON from OpenAI", status: r.status, raw });
      }
      if (!r.ok) return json(res, 500, { ok: false, error: "OpenAI error", status: r.status, details: data, raw });

      const outputText =
        (Array.isArray(data.output) &&
          data.output.flatMap(o => Array.isArray(o.content) ? o.content : [])
            .find(c => c.type === "output_text")?.text) ||
        data.output_text ||
        null;

      let exam;
      try { exam = JSON.parse(outputText); } catch (e) {
        return json(res, 500, { ok: false, error: "Could not parse model JSON", details: String(e), outputText });
      }

      if (!exam || !Array.isArray(exam.questions) || exam.questions.length !== numQuestions) {
        return json(res, 500, { ok: false, error: "Schema mismatch", exam });
      }

      return json(res, 200, { ok: true, exam });
    } catch (e) {
      return json(res, 500, { ok: false, error: "Server error", details: String(e) });
    }
  });
};
