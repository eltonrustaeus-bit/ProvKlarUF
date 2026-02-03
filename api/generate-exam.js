// /api/generate-exam.js
// Vercel Serverless Function (CommonJS)
// Fix: remove JSON Schema "oneOf" (not permitted with strict Structured Outputs)
//
// Docs: Responses API supports json_schema with strict subset. :contentReference[oaicite:0]{index=0}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function pickModel() {
  // Use a model that supports Structured Outputs via json_schema.
  // If your project uses a different model, change it here.
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
  // IMPORTANT: No "oneOf" anywhere. Use a single object shape for each question.
  // options is always present (empty array if not MC). rubric always present ("" if not used).
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
            required: ["id", "type", "points", "question", "options", "rubric"],
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["mc", "short", "essay", "mix"] },
              points: { type: "number" },
              question: { type: "string" },

              // Always present. If type !== "mc" => [].
              options: {
                type: "array",
                items: { type: "string" },
                maxItems: 6
              },

              // Always present: short point rubric (what gives full points).
              rubric: { type: "string" }
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
  if (!apiKey) {
    return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY in environment variables" });
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let parsed;
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch (e) {
      return json(res, 400, { ok: false, error: "Invalid JSON body", details: String(e) });
    }

    const lang = asEnum(parsed.lang, ["sv", "en"], "sv");
    const level = asEnum(parsed.level, ["E", "C", "A"], "C");
    const qType = asEnum(parsed.qType, ["mix", "mc", "short", "essay"], "mix");
    const course = safeString(parsed.course, 200);
    const pastedText = safeString(parsed.pastedText, 200000);

    const numQuestionsRaw = toInt(parsed.numQuestions, 12);
    const numQuestions = Math.min(12, Math.max(3, numQuestionsRaw)); // 3–12

    if (!pastedText.trim()) {
      return json(res, 400, { ok: false, error: "Missing pastedText" });
    }

    const responseFormat = buildMockExamSchema(numQuestions);

    const systemSv =
      "Du skapar ett realistiskt mockprov som en svensk gymnasielärare. Du måste följa JSON-schema exakt. " +
      "VIKTIGT: 'questions' måste ha EXAKT angivet antal frågor. " +
      "Varje fråga måste ha: id, type, points, question, options, rubric. " +
      "Om type != 'mc' ska options vara [] (tom array). Rubric ska alltid finnas och vara kort (vad som ger full poäng). " +
      "Ingen extra text utanför JSON.";

    const systemEn =
      "You create a realistic mock exam like a high-school teacher. You must follow the JSON schema exactly. " +
      "IMPORTANT: 'questions' must have EXACTLY the requested number of questions. " +
      "Each question must have: id, type, points, question, options, rubric. " +
      "If type != 'mc', options must be [] (empty array). Rubric must always be present and be short (what earns full points). " +
      "No extra text outside JSON.";

    const userSv = [
      `Skapa ett mockprov på nivå ${level}.`,
      course ? `Kurs/ämne: ${course}.` : "",
      `Frågetyp-val: ${qType}.`,
      `Antal frågor: ${numQuestions}.`,
      "",
      "Material (endast detta ska användas som fakta/underlag):",
      pastedText
    ]
      .filter(Boolean)
      .join("\n");

    const userEn = [
      `Create a mock exam at level ${level}.`,
      course ? `Course/subject: ${course}.` : "",
      `Question type selection: ${qType}.`,
      `Number of questions: ${numQuestions}.`,
      "",
      "Material (use only this as the factual source):",
      pastedText
    ]
      .filter(Boolean)
      .join("\n");

    const instructions = lang === "sv" ? systemSv : systemEn;
    const prompt = lang === "sv" ? userSv : userEn;

    const model = pickModel();

    try {
      // Responses API: use text.format with json_schema for Structured Outputs. :contentReference[oaicite:1]{index=1}
      const payload = {
        model,
        input: [
          { role: "system", content: instructions },
          { role: "user", content: prompt }
        ],
        text: {
          format: responseFormat
        }
      };

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const raw = await r.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return json(res, 500, { ok: false, error: "Non-JSON response from OpenAI", status: r.status, raw });
      }

      if (!r.ok) {
        return json(res, 500, {
          ok: false,
          error: "OpenAI error",
          status: r.status,
          details: data,
          raw
        });
      }

      // Structured Outputs returns the JSON in output_text as a string, or already-parsed depending on SDK.
      // Here we extract the first output_text we can find.
      const outputText =
        (Array.isArray(data.output) &&
          data.output
            .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
            .find((c) => c.type === "output_text")?.text) ||
        data.output_text ||
        null;

      let exam = null;
      if (outputText && typeof outputText === "string") {
        try {
          exam = JSON.parse(outputText);
        } catch (e) {
          return json(res, 500, { ok: false, error: "Could not parse model JSON", details: String(e), outputText });
        }
      } else if (data.output_parsed) {
        exam = data.output_parsed;
      } else {
        // Fallback: attempt to use response JSON directly if it already matches.
        exam = data;
      }

      // Minimal sanity check
      if (!exam || !Array.isArray(exam.questions) || exam.questions.length !== numQuestions) {
        return json(res, 500, {
          ok: false,
          error: "Schema mismatch after parse",
          expectedQuestions: numQuestions,
          got: exam?.questions?.length ?? null,
          exam
        });
      }

      return json(res, 200, { ok: true, exam });
    } catch (e) {
      return json(res, 500, { ok: false, error: "Server error", details: String(e) });
    }
  });
};
