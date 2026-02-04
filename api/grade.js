// api/grade.js (CommonJS / Vercel Serverless)
// Deterministic grading for MC using correct_index.
// AI grading only for non-MC (short/essay/mix).

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

function normalizeChoice(ans) {
  const a = String(ans || "").trim().toUpperCase();
  if (!a) return "";
  // accept "A", "A.", "A)", etc.
  const m = a.match(/^([A-F])/);
  return m ? m[1] : "";
}

function letterToIndex(letter) {
  if (!letter) return -1;
  const code = letter.charCodeAt(0);
  const idx = code - 65; // A->0
  return (idx >= 0 && idx <= 5) ? idx : -1;
}

function buildNonMcGradeSchema() {
  return {
    type: "json_schema",
    name: "grade_non_mc_schema",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["total_points", "max_points", "per_question"],
      properties: {
        total_points: { type: "number" },
        max_points: { type: "number" },
        per_question: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "points", "max_points", "feedback", "model_answer"],
            properties: {
              id: { type: "string" },
              points: { type: "number" },
              max_points: { type: "number" },
              feedback: { type: "string" },
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
    let p;
    try { p = body ? JSON.parse(body) : {}; }
    catch (e) { return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) }); }

    const lang = asEnum(p.lang, ["sv", "en"], "sv");
    const pastedText = safeString(p.pastedText, 200000);
    const questions = Array.isArray(p.questions) ? p.questions : [];
    const answersArr = Array.isArray(p.answers) ? p.answers : [];

    if (!pastedText.trim()) return json(res, 400, { ok: false, error: "Missing pastedText" });
    if (!questions.length) return json(res, 400, { ok: false, error: "Missing questions" });

    const answerMap = new Map();
    for (const a of answersArr) {
      const id = String(a?.id ?? "");
      if (id) answerMap.set(id, String(a?.answer ?? ""));
    }

    // Split MC vs Non-MC
    const per = [];
    let total = 0;
    let maxTotal = 0;

    const nonMcPack = [];

    for (const q of questions) {
      const id = String(q.id ?? "");
      const type = String(q.type ?? "");
      const maxP = Number(q.points ?? 0) || 0;
      maxTotal += maxP;

      const userAns = answerMap.get(id) ?? "";

      if (type === "mc") {
        const correctIndex = Number.isInteger(q.correct_index) ? q.correct_index : -999;
        const chosenLetter = normalizeChoice(userAns);
        const chosenIndex = letterToIndex(chosenLetter);

        let pts = 0;
        let fb = "";

        if (correctIndex >= 0 && chosenIndex >= 0) {
          pts = (chosenIndex === correctIndex) ? maxP : 0;
          fb = (lang === "sv")
            ? (pts === maxP ? "Rätt." : "Fel.")
            : (pts === maxP ? "Correct." : "Incorrect.");
        } else {
          // If schema is missing correct_index, we cannot deterministically grade.
          // Keep 0 and explain.
          pts = 0;
          fb = (lang === "sv")
            ? "Fel: saknar facit (correct_index) för denna flervalsfråga."
            : "Error: missing answer key (correct_index) for this multiple-choice question.";
        }

        total += pts;
        per.push({
          id,
          points: pts,
          max_points: maxP,
          feedback: fb,
          model_answer: String(q.model_answer || q.rubric || "")
        });
      } else {
        nonMcPack.push({
          id,
          type,
          max_points: maxP,
          question: String(q.question || ""),
          rubric: String(q.rubric || ""),
          model_answer: String(q.model_answer || ""),
          user_answer: String(userAns || "")
        });
      }
    }

    // If no non-mc -> return only MC result
    if (nonMcPack.length === 0) {
      return json(res, 200, { ok: true, result: { total_points: total, max_points: maxTotal, per_question: per } });
    }

    // Grade non-mc via OpenAI
    const model = pickModel();
    const responseFormat = buildNonMcGradeSchema();

    const systemSv =
      "Du är en strikt provrättare. Bedöm varje elevsvar enligt frågan, maxpoäng och rubric. " +
      "Ge points (0..max_points), kort feedback och ett fullpoängs model_answer. " +
      "Använd ENDAST materialet som fakta. Om materialet inte räcker: säg det i feedback och dra av poäng. " +
      "Returnera bara JSON enligt schema.";

    const systemEn =
      "You are a strict exam grader. Grade each student answer by question, max points and rubric. " +
      "Give points (0..max_points), short feedback, and a full-score model_answer. " +
      "Use ONLY the provided material as factual source. If material is insufficient: say so in feedback and deduct points. " +
      "Return only JSON per schema.";

    const userPayload = {
      material: pastedText,
      items: nonMcPack
    };

    try {
      const payload = {
        model,
        input: [
          { role: "system", content: lang === "sv" ? systemSv : systemEn },
          { role: "user", content: JSON.stringify(userPayload) }
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

      let graded;
      try { graded = JSON.parse(outputText); } catch (e) {
        return json(res, 500, { ok: false, error: "Could not parse model JSON", details: String(e), outputText });
      }

      // Merge results
      const byId = new Map();
      for (const x of graded.per_question || []) byId.set(String(x.id), x);

      for (const item of nonMcPack) {
        const got = byId.get(item.id);
        if (!got) continue;
        total += Number(got.points || 0);
        per.push({
          id: String(got.id),
          points: Number(got.points || 0),
          max_points: Number(got.max_points || item.max_points || 0),
          feedback: String(got.feedback || ""),
          model_answer: String(got.model_answer || item.model_answer || item.rubric || "")
        });
      }

      return json(res, 200, {
        ok: true,
        result: {
          total_points: total,
          max_points: maxTotal,
          per_question: per
        }
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: "Server error", details: String(e) });
    }
  });
};
