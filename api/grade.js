// api/grade.js (CommonJS / Vercel Serverless)
// Deterministic grading for MC using correct_index.
// AI grading for non-MC (short/essay/mix), with optional personalized context (history + mistakes).
// Adds: concept_tag + error_tags per question (for mastery tracking).

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
  const m = a.match(/^([A-F])/); // accept "A", "A.", "A)", etc.
  return m ? m[1] : "";
}

function letterToIndex(letter) {
  if (!letter) return -1;
  const code = letter.charCodeAt(0);
  const idx = code - 65; // A->0
  return idx >= 0 && idx <= 5 ? idx : -1;
}

function safeArrayStrings(x, maxItems = 8, maxLen = 40) {
  if (!Array.isArray(x)) return [];
  const out = [];
  for (const v of x) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    out.push(s.slice(0, maxLen));
    if (out.length >= maxItems) break;
  }
  return out;
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
            required: ["id", "points", "max_points", "feedback", "model_answer", "concept_tag", "error_tags"],
            properties: {
              id: { type: "string" },
              points: { type: "number" },
              max_points: { type: "number" },
              feedback: { type: "string" },
              model_answer: { type: "string" },
              concept_tag: { type: "string" },
              error_tags: {
                type: "array",
                items: { type: "string" },
                maxItems: 8
              }
            }
          }
        }
      }
    }
  };
}

// Keep only safe, compact context for personalization (prevents bloat + keeps signal high)
function sanitizeHistory(x) {
  if (!Array.isArray(x)) return [];
  return x
    .slice(-10)
    .map((a) => ({
      ts: Number(a?.ts || 0) || 0,
      course: typeof a?.course === "string" ? a.course.slice(0, 80) : "",
      level: typeof a?.level === "string" ? a.level.slice(0, 10) : "",
      qType: typeof a?.qType === "string" ? a.qType.slice(0, 20) : "",
      percent: Number(a?.percent || 0) || 0
    }));
}

function sanitizeMistakes(x) {
  if (!Array.isArray(x)) return [];
  return x
    .slice(-20)
    .map((m) => ({
      ts: Number(m?.ts || 0) || 0,
      id: typeof m?.id === "string" ? m.id.slice(0, 40) : "",
      qType: typeof m?.qType === "string" ? m.qType.slice(0, 20) : "",
      // Keep short excerpts only (enough for pattern recognition)
      question: typeof m?.question === "string" ? m.question.slice(0, 220) : "",
      feedback: typeof m?.feedback === "string" ? m.feedback.slice(0, 220) : ""
    }));
}

function extractOutputText(data) {
  // Responses API commonly returns: { output: [ { content: [ { type:"output_text", text:"..." } ] } ] }
  const out =
    (Array.isArray(data?.output) &&
      data.output
        .flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
        .find((c) => c?.type === "output_text")?.text) ||
    data?.output_text ||
    null;
  return typeof out === "string" ? out : null;
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
    try {
      p = body ? JSON.parse(body) : {};
    } catch (e) {
      return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) });
    }

    const lang = asEnum(p.lang, ["sv", "en"], "sv");
    const pastedText = safeString(p.pastedText, 200000);
    const questions = Array.isArray(p.questions) ? p.questions : [];
    const answersArr = Array.isArray(p.answers) ? p.answers : [];

    // Optional: personal context passed from client
    const history = sanitizeHistory(p.history);
    const mistakesCtx = sanitizeMistakes(p.mistakes);

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
          pts = chosenIndex === correctIndex ? maxP : 0;
          fb =
            lang === "sv"
              ? pts === maxP
                ? "Rätt."
                : "Fel."
              : pts === maxP
                ? "Correct."
                : "Incorrect.";
        } else {
          pts = 0;
          fb =
            lang === "sv"
              ? "Fel: saknar facit (correct_index) för denna flervalsfråga."
              : "Error: missing answer key (correct_index) for this multiple-choice question.";
        }

        total += pts;

        // concept_tag: prefer provided; otherwise keep empty (non-hallucinating)
        const conceptTag = typeof q.concept_tag === "string" ? q.concept_tag.slice(0, 60) : "";

        per.push({
          id,
          points: pts,
          max_points: maxP,
          feedback: fb,
          model_answer: String(q.model_answer || q.rubric || ""),
          concept_tag: conceptTag,
          error_tags: pts === maxP ? [] : ["mc_wrong"]
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
      return json(res, 200, {
        ok: true,
        result: { total_points: total, max_points: maxTotal, per_question: per }
      });
    }

    // Grade non-mc via OpenAI
    const model = pickModel();
    const responseFormat = buildNonMcGradeSchema();

    const systemSv =
      "Roll: Du är en strikt, professionell provrättare och pedagogisk coach.\n" +
      "Mål: Bedöm varje elevsvar mot frågan, maxpoäng och rubric. Svara ENDAST med JSON enligt schema.\n\n" +
      "Regler (obligatoriskt):\n" +
      "1) Fakta: Använd ENDAST 'material' som faktakälla. Om materialet inte räcker, skriv tydligt 'Otillräckliga data i materialet' i feedback och ge lägre poäng.\n" +
      "2) Poäng: points måste vara heltal eller tal inom [0..max_points]. max_points måste matcha uppgiften.\n" +
      "3) Feedback (kort och precis):\n" +
      "   - Börja med 1 rad: 'Poäng: X/Y.'\n" +
      "   - Sedan 2–5 korta punkter: (a) vad som var korrekt, (b) vad som saknas/fel, (c) exakt vad som krävs för full poäng.\n" +
      "   - Avsluta med 1 konkret nästa-övning (en mening), gärna kopplat till student_context.\n" +
      "4) Personlig anpassning:\n" +
      "   - Använd student_context (history + mistakes) för att nämna 1 återkommande svaghet eller styrka när relevant.\n" +
      "   - Inga antaganden utöver context.\n" +
      "5) Model_answer:\n" +
      "   - Skriv ett fullpoängssvar som är tydligt, strukturerat och direkt baserat på materialet.\n" +
      "   - Om materialet saknar info: skriv ett svar som tydligt markerar vad som inte kan fastställas från materialet.\n" +
      "6) concept_tag (obligatoriskt):\n" +
      "   - Skriv en kort tagg (2–5 ord) som beskriver vilket delområde/koncept frågan testar, t.ex. 'Potenser', 'Andragradsekvation', 'Källkritik', 'Begreppsdefinition'.\n" +
      "   - Använd endast information från fråga/rubric/material. Om oklart: 'Okänt'.\n" +
      "7) error_tags (obligatoriskt):\n" +
      "   - Returnera 0–5 taggar som beskriver VANLIGA fel i elevsvaret, välj från denna lista:\n" +
      "     ['definition_missing','concept_confusion','calculation_error','units_missing','method_missing','reasoning_gap','missing_steps','structure_weak','example_missing','language_unclear','off_topic','insufficient_material']\n" +
      "   - Tagga bara sådant du kan se i elevsvaret. Om inget: [].\n" +
      "8) Språk: Professionellt. Inga fluff-fraser.\n";

    const systemEn =
      "Role: You are a strict, professional exam grader and concise coach.\n" +
      "Goal: Grade each student answer against the question, max points and rubric. Output ONLY JSON per schema.\n\n" +
      "Rules (mandatory):\n" +
      "1) Facts: Use ONLY 'material' as the factual source. If material is insufficient, explicitly say 'Insufficient data in the material' in feedback and award fewer points.\n" +
      "2) Scoring: points must be within [0..max_points]. max_points must match the item.\n" +
      "3) Feedback (short and precise):\n" +
      "   - Start with one line: 'Score: X/Y.'\n" +
      "   - Then 2–5 short bullet points: (a) what is correct, (b) what is missing/incorrect, (c) what is required for full score.\n" +
      "   - End with 1 concrete next practice step (one sentence), optionally tied to student_context.\n" +
      "4) Personalization:\n" +
      "   - Use student_context (history + mistakes) to mention 1 recurring weakness/strength when relevant.\n" +
      "   - Do not invent anything beyond the provided context.\n" +
      "5) Model_answer:\n" +
      "   - Write a full-score answer that is clear, structured, and strictly grounded in the material.\n" +
      "   - If material lacks info: explicitly state what cannot be determined from the material.\n" +
      "6) concept_tag (required):\n" +
      "   - A short tag (2–5 words) describing the concept/topic tested, e.g. 'Exponents', 'Quadratic equation', 'Source criticism'.\n" +
      "   - Use only question/rubric/material. If unclear: 'Unknown'.\n" +
      "7) error_tags (required):\n" +
      "   - Return 0–5 tags describing common issues in the student's answer, choose from:\n" +
      "     ['definition_missing','concept_confusion','calculation_error','units_missing','method_missing','reasoning_gap','missing_steps','structure_weak','example_missing','language_unclear','off_topic','insufficient_material']\n" +
      "   - Only tag what you can see in the student's answer. If none: [].\n" +
      "8) Style: Professional. No fluff.\n";

    const userPayload = {
      material: pastedText,
      student_context: {
        history,
        mistakes: mistakesCtx
      },
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
      try {
        data = JSON.parse(raw);
      } catch {
        return json(res, 500, { ok: false, error: "Non-JSON from OpenAI", status: r.status, raw });
      }
      if (!r.ok) return json(res, 500, { ok: false, error: "OpenAI error", status: r.status, details: data, raw });

      const outputText = extractOutputText(data);
      if (!outputText) {
        return json(res, 500, { ok: false, error: "Missing output_text from OpenAI", status: r.status, details: data, raw });
      }

      let graded;
      try {
        graded = JSON.parse(outputText);
      } catch (e) {
        return json(res, 500, { ok: false, error: "Could not parse model JSON", details: String(e), outputText });
      }

      // Merge results for non-mc
      const byId = new Map();
      for (const x of graded.per_question || []) byId.set(String(x.id), x);

      for (const item of nonMcPack) {
        const got = byId.get(item.id);
        if (!got) continue;

        const pts = Number(got.points || 0);
        const mp = Number(got.max_points || item.max_points || 0);

        total += pts;

        const conceptTag = (typeof got.concept_tag === "string" && got.concept_tag.trim())
          ? got.concept_tag.trim().slice(0, 60)
          : (lang === "sv" ? "Okänt" : "Unknown");

        const errorTags = safeArrayStrings(got.error_tags, 8, 40);

        per.push({
          id: String(got.id),
          points: pts,
          max_points: mp,
          feedback: String(got.feedback || ""),
          model_answer: String(got.model_answer || item.model_answer || item.rubric || ""),
          concept_tag: conceptTag,
          error_tags: errorTags
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
