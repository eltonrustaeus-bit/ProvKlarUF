
// api/grade.js (CommonJS / Vercel Serverless)
// Deterministic grading for MC using correct_index.
// AI grading for non-MC (short/essay/mix), with optional personalized context (history + mistakes).
// Adds: concept_tag + error_tags per question (for mastery tracking).
//
// CHANGES vs your version:
// 1) Keeps per_question output order identical to the original question order (stable UI + stable mistake mapping).
// 2) Clamps points to [0..max_points] defensively (prevents bad model outputs from breaking totals).
// 3) Ensures every question id is present in per_question (even if model omitted one) with safe fallback.
//
// No frontend changes required.

const assessment = require("./_assessment");

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

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function normalizeChoice(ans) {
  const a = String(ans || "").trim().toUpperCase();
  if (!a) return "";
  const m = a.match(/^([A-F])/);
  return m ? m[1] : "";
}

function letterToIndex(letter) {
  if (!letter) return -1;
  const code = letter.charCodeAt(0);
  const idx = code - 65;
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

function sanitizeHistory(x) {
  if (!Array.isArray(x)) return [];
  return x.slice(-3).map((a) => ({
    ts: Number(a?.ts || 0) || 0,
    course: typeof a?.course === "string" ? a.course.slice(0, 80) : "",
    level: typeof a?.level === "string" ? a.level.slice(0, 10) : "",
    qType: typeof a?.qType === "string" ? a.qType.slice(0, 20) : "",
    percent: Number(a?.percent || 0) || 0
  }));
}

function sanitizeMistakes(x) {
  if (!Array.isArray(x)) return [];
  return x.slice(-10).map((m) => ({
    ts: Number(m?.ts || 0) || 0,
    id: typeof m?.id === "string" ? m.id.slice(0, 40) : "",
    qType: typeof m?.qType === "string" ? m.qType.slice(0, 20) : "",
    question: typeof m?.question === "string" ? m.question.slice(0, 220) : "",
    feedback: typeof m?.feedback === "string" ? m.feedback.slice(0, 220) : ""
  }));
}

function extractOutputText(data) {
  const out =
    (Array.isArray(data?.output) &&
      data.output
        .flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
        .find((c) => c?.type === "output_text")?.text) ||
    data?.output_text ||
    null;
  return typeof out === "string" ? out : null;
}

function buildMockPayload(userId, course, per, total, maxTotal) {
  const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
  const conceptTags = [...new Set(
    per.map(q => q.concept_tag).filter(c => c && c !== "Okänt" && c !== "Unknown")
  )].slice(0, 20);
  const errorTags = [...new Set(
    per.flatMap(q => q.error_tags || []).filter(Boolean)
  )].slice(0, 20);
  return { user_id: userId, course: (course || "").slice(0, 100), percent: pct, num_questions: per.length, concept_tags: conceptTags, error_tags: errorTags };
}

// Returns a promise — callers MUST await before sending the response.
// On Vercel the lambda freezes once res is sent, so an un-awaited POST here
// gets killed mid-flight (this is why mock_results stayed empty). Never throws.
async function saveMockResult(payload) {
  try {
    await fetch(process.env.SUPABASE_URL + "/rest/v1/mock_results", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
  } catch { /* best-effort analytics write — never block grading */ }
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "Use POST" });
  }

  const user = await requireAuth(req);
  if (!user) return json(res, 401, { ok: false, error: "Unauthorized" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY" });

  const chunks = [];
  let responded = false;
  const sendOnce = (status, obj) => { if (responded) return; responded = true; json(res, status, obj); };
  // A Node readable stream stays paused (never flows, "end" never fires) until
  // something attaches a "data" listener, calls resume(), or pipes it — without
  // this line the handler hung forever on every request until Vercel's platform
  // timeout killed it (matches the working pattern in api/ocr.js/stripe-webhook.js).
  req.on("data", (c) => chunks.push(c));
  // Without this, a stalled/aborted request stream would leave the handler hanging
  // with no response — one of the ways grading could "load forever".
  req.on("error", (e) => sendOnce(400, { ok: false, error: "Request stream error", details: String(e) }));
  req.on("aborted", () => sendOnce(400, { ok: false, error: "Request aborted" }));
  req.on("end", async () => {
    if (responded) return; // stream already errored/aborted — don't double-respond
    responded = true;
    let p;
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      p = raw ? JSON.parse(raw) : {};
    } catch (e) {
      return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) });
    }

    const lang = asEnum(p.lang, ["sv", "en"], "sv");
    const pastedText = safeString(p.pastedText, 40000);
    const questions = Array.isArray(p.questions) ? p.questions : [];
    const answersArr = Array.isArray(p.answers) ? p.answers : [];

    const history = sanitizeHistory(p.history);
    const mistakesCtx = sanitizeMistakes(p.mistakes);
    const course = safeString(p.course, 80) || history[history.length - 1]?.course || "";

    if (!questions.length) return json(res, 400, { ok: false, error: "Missing questions" });

    const answerMap = new Map();
    for (const a of answersArr) {
      const id = String(a?.id ?? "");
      if (id) answerMap.set(id, String(a?.answer ?? ""));
    }

    // Keep a stable, question-order list and fill it as we grade
    const perById = new Map();
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

        // Reject a tampered answer key: the browser holds correct_index, so a
        // manipulated payload could otherwise buy full marks. Signed at generation.
        const keyOk = assessment.verifyAnswerKey(q, q.akey_sig);
        if (!keyOk) {
          total += 0;
          perById.set(id, {
            id, points: 0, max_points: maxP,
            feedback: lang === "sv"
              ? "Fel: frågans facit kunde inte verifieras och rättades inte."
              : "Error: the answer key could not be verified and was not graded.",
            model_answer: String(q.model_answer || q.rubric || ""),
            concept_tag: typeof q.concept_tag === "string" ? q.concept_tag.slice(0, 60) : "",
            error_tags: ["answer_key_unverified"]
          });
          continue;
        }

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
        } else if (correctIndex >= 0) {
          // Facit finns, eleven svarade inte. Den här grenen delade tidigare
          // text med fallet nedan, så en elev som hoppade över en flervalsfråga
          // fick beskedet att provets facit saknades — systemet skyllde sitt
          // eget fel för något eleven själv valde att lämna blankt.
          pts = 0;
          fb =
            lang === "sv"
              ? "Obesvarad. Rätt svar var " + String.fromCharCode(65 + correctIndex) + "."
              : "Not answered. The correct answer was " + String.fromCharCode(65 + correctIndex) + ".";
        } else {
          pts = 0;
          fb =
            lang === "sv"
              ? "Fel: saknar facit (correct_index) för denna flervalsfråga."
              : "Error: missing answer key (correct_index) for this multiple-choice question.";
        }

        total += pts;

        const conceptTag = typeof q.concept_tag === "string" ? q.concept_tag.slice(0, 60) : "";

        perById.set(id, {
          id,
          points: pts,
          max_points: maxP,
          feedback: fb,
          model_answer: String(q.model_answer || q.rubric || ""),
          concept_tag: conceptTag,
          error_tags: pts === maxP ? [] : ["mc_wrong"]
        });
      } else {
        const hasStructuredRubric = q.scoring_rubric && Array.isArray(q.scoring_rubric.parts) && q.scoring_rubric.parts.length > 0;
        nonMcPack.push({
          id,
          type,
          max_points: maxP,
          question: String(q.question || ""),
          rubric: String(q.rubric || ""),
          scoring_rubric: hasStructuredRubric ? q.scoring_rubric : null,
          model_answer: String(q.model_answer || ""),
          user_answer: String(userAns || "")
        });
      }
    }

    if (nonMcPack.length === 0) {
      // Output in original question order
      const per = questions.map((q) => perById.get(String(q.id ?? ""))).filter(Boolean);
      await saveMockResult(buildMockPayload(user.id, course, per, total, maxTotal));
      return json(res, 200, {
        ok: true,
        result: { total_points: total, max_points: maxTotal, per_question: per }
      });
    }

    if (!pastedText.trim()) return json(res, 400, { ok: false, error: "Missing pastedText for open questions" });

    const model = pickModel();
    const responseFormat = buildNonMcGradeSchema();

    const systemSv =
      // Måste matcha perRole("professionell provrättare") i api/_per-name.js. Kan inte
      // importeras: den här filen är CommonJS. per-name-consistency-testet låser ihop dem.
      "Roll: Du är P.E.R — ExGens Progressive Evidence Reasoning-modell, professionell provrättare.\n" +
      "Mål: Bedöm varje elevsvar mot frågan, maxpoäng och rubric. Svara ENDAST med JSON enligt schema.\n\n" +
      "Regler (obligatoriskt):\n" +
      "1) Fakta: Använd ENDAST 'material' som faktakälla. Om materialet inte räcker, skriv tydligt 'Otillräckliga data i materialet' i feedback och ge lägre poäng.\n" +
      "2) Poäng: points måste vara tal inom [0..max_points]. max_points måste matcha uppgiften. " +
      "Om items[].scoring_rubric finns: bedöm VARJE del i scoring_rubric.parts för sig och summera — nämn i feedback vilka delar som gavs poäng. " +
      "Kräv ALDRIG mer än vad scoring_rubric.full_score_requirements uttryckligen listar för full poäng.\n" +
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
      "6) concept_tag:\n" +
      "   - Kort tagg (2–5 ord). Om oklart: 'Okänt'.\n" +
      "7) error_tags:\n" +
      "   - 0–5 taggar, välj från:\n" +
      "     ['definition_missing','concept_confusion','calculation_error','units_missing','method_missing','reasoning_gap','missing_steps','structure_weak','example_missing','language_unclear','off_topic','insufficient_material']\n" +
      "   - Tagga bara sådant du kan se i elevsvaret. Om inget: [].\n" +
      "8) Språk: Professionellt. Inga fluff-fraser.\n";

    const systemEn =
      "Role: You are P.E.R — ExGen's Progressive Evidence Reasoning model, a professional exam grader.\n" +
      "Goal: Grade each student answer against the question, max points and rubric. Output ONLY JSON per schema.\n\n" +
      "Rules (mandatory):\n" +
      "1) Facts: Use ONLY 'material' as the factual source. If material is insufficient, explicitly say 'Insufficient data in the material' in feedback and award fewer points.\n" +
      "2) Scoring: points must be within [0..max_points]. max_points must match the item. " +
      "If items[].scoring_rubric exists: assess each part in scoring_rubric.parts separately and sum — mention in feedback which parts received points. " +
      "Never require more than what scoring_rubric.full_score_requirements explicitly lists for full score.\n" +
      "3) Feedback:\n" +
      "   - Start with: 'Score: X/Y.'\n" +
      "   - 2–5 bullets: correct parts, missing/incorrect, what is required for full score.\n" +
      "   - End with 1 next practice step.\n" +
      "4) Personalization: Use student_context (history + mistakes) when relevant; do not invent.\n" +
      "5) Model_answer: Full-score answer grounded in material; if insufficient, state what cannot be determined.\n" +
      "6) concept_tag: 2–5 words; if unclear: 'Unknown'.\n" +
      "7) error_tags: 0–5 tags from the provided list; only what you can see. If none: [].\n" +
      "8) Style: Professional. No fluff.\n";

    const userPayload = {
      material: pastedText.slice(0, 12000),
      student_context: { history, mistakes: mistakesCtx },
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

      const byId = new Map();
      for (const x of graded.per_question || []) byId.set(String(x.id), x);

      // Merge non-mc into perById with defensive clamps and required fallbacks
      for (const item of nonMcPack) {
        const got = byId.get(item.id);

        // If model omitted an id, fill a safe fallback (keeps downstream stable)
        if (!got) {
          perById.set(item.id, {
            id: item.id,
            points: 0,
            max_points: item.max_points,
            feedback: lang === "sv" ? "Poäng: 0/" + item.max_points + ". Otillräckliga data (modellresultat saknas)." : "Score: 0/" + item.max_points + ". Insufficient data (missing model result).",
            model_answer: String(item.model_answer || item.rubric || ""),
            concept_tag: lang === "sv" ? "Okänt" : "Unknown",
            error_tags: ["insufficient_material"]
          });
          continue;
        }

        const mp = Number(got.max_points || item.max_points || 0);
        const pts = clamp(got.points || 0, 0, mp);

        total += pts;

        const conceptTag =
          (typeof got.concept_tag === "string" && got.concept_tag.trim())
            ? got.concept_tag.trim().slice(0, 60)
            : (lang === "sv" ? "Okänt" : "Unknown");

        const errorTags = safeArrayStrings(got.error_tags, 8, 40);

        perById.set(String(got.id), {
          id: String(got.id),
          points: pts,
          max_points: mp,
          feedback: String(got.feedback || ""),
          model_answer: String(got.model_answer || item.model_answer || item.rubric || ""),
          concept_tag: conceptTag,
          error_tags: errorTags
        });
      }

      // Output in original question order
      const per = questions
        .map((q) => perById.get(String(q.id ?? "")) || null)
        .filter(Boolean);

      await saveMockResult(buildMockPayload(user.id, course, per, total, maxTotal));
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
