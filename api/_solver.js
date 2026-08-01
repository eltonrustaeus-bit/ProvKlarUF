// api/_solver.js (CommonJS — used by generate-exam.js)
//
// The independent solve pass. A THIRD role, distinct from both the generator
// and the verifier:
//
//   generator — proposes a question and an answer key
//   verifier  — judges the question ("is this well made? is it ambiguous?")
//   solver    — ignores all of that and simply ANSWERS the question, then we
//               check whether it landed on the same option as the answer key
//
// Why this exists. Measured on tests/evals/exam-quality: the verifier passed
// questions that a solver caught every time. Across two long-form runs the
// solver found 8 disagreements the verifier had approved, of which 4 were
// outright defects — including "x(20 - x) = 24" for a rectangle of perimeter 20
// (half is 10, so it must be x(10 - x)) and f(5) = 5 for f(x) = x² - 8x + 15
// (it is 0). Judging a question and answering it are different tasks, and only
// the second catches arithmetic.
//
// api/hp.js:315 already does exactly this for the quantitative HP delprov and
// records that it works even when the solver runs on the same model as the
// generator — the failure mode is inattention, not ignorance. So this does not
// need an expensive model.
//
// Runs in PARALLEL with the verifier in generate-exam.js. Both take the same
// gated questions and neither depends on the other, so wall time is the max of
// the two rather than their sum — which is what makes a third call fit inside
// the 60 s function budget.

// Sentinel indices the solver may return instead of an option index:
//   -1  no single option is correct (several are right, or none are)
//   -2  cannot be judged from the stem, options and material provided
const NO_SINGLE_ANSWER = -1;
const CANNOT_JUDGE = -2;

// Above this, a disagreement is treated as a real mismatch rather than solver
// uncertainty. Chosen so that a hesitant solver cannot delete a sound question.
const DEFAULT_MISMATCH_CONFIDENCE = 0.7;

// The solver sees the material so that questions grounded in the pasted text
// remain answerable, but a whole 200 000-character paste would dominate the
// latency budget. Questions are built from the material as a whole, so the cap
// is generous; anything beyond it is handled by the CANNOT_JUDGE escape rather
// than by guessing.
const MATERIAL_CHAR_CAP = 12000;

function solverModel(generatorModel) {
  return process.env.OPENAI_SOLVER_MODEL || generatorModel;
}

function buildSolverSchema(n) {
  return {
    type: "json_schema",
    name: "exam_solver_schema",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          minItems: n,
          maxItems: n,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "index", "confidence", "reason"],
            properties: {
              id: { type: "string" },
              index: { type: "integer", minimum: -2 },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  };
}

function buildSolverPrompt(lang, subjectProfile) {
  const base = lang === "sv"
    ? "Du är en ämnesexpert som LÖSER provfrågor. Du får kursmaterialet och ett antal flervalsfrågor. " +
      "Du får INTE se något facit — lös varje fråga helt själv. " +
      "Returnera det 0-baserade indexet för det alternativ du kommer fram till. " +
      "Räkna igenom varje beräkning noga och spåra igenom eventuell kod rad för rad innan du svarar. " +
      "Returnera -1 om INGET enskilt alternativ är entydigt korrekt — alltså om flera alternativ är lika rätt, eller om inget av dem är rätt. " +
      "Returnera -2 om frågan inte går att avgöra utifrån materialet och alternativen du fått, till exempel om den bygger på en del av materialet du inte ser. " +
      "confidence: 1.0 när svaret är entydigt bestämbart, lägre när du är osäker. " +
      "reason: en mening om hur du kom fram till svaret."
    : "You are a subject expert who SOLVES exam questions. You get the course material and a number of multiple-choice questions. " +
      "You do NOT get to see any answer key — solve each question entirely yourself. " +
      "Return the 0-based index of the option you arrive at. " +
      "Work through every calculation carefully and trace through any code line by line before answering. " +
      "Return -1 if NO single option is unambiguously correct — that is, if several are equally right, or none of them is. " +
      "Return -2 if the question cannot be decided from the material and options you were given, for instance if it relies on part of the material you cannot see. " +
      "confidence: 1.0 when the answer is unambiguously determinable, lower when unsure. " +
      "reason: one sentence on how you arrived at the answer.";

  const hints = {
    mathematics: {
      sv: " Lös uppgiften från grunden innan du tittar på alternativen, och matcha sedan ditt resultat mot dem.",
      en: " Solve the task from scratch before looking at the options, then match your result against them.",
    },
    programming: {
      sv: " Spåra igenom koden rad för rad och räkna index från noll.",
      en: " Trace through the code line by line and count indices from zero.",
    },
    natural_sciences: {
      sv: " Kontrollera enheter och storleksordningar i ditt svar.",
      en: " Check units and orders of magnitude in your answer.",
    },
  };
  const hint = hints[subjectProfile];
  return base + (hint ? (lang === "sv" ? hint.sv : hint.en) : "");
}

function extractOutputText(data) {
  const out =
    (Array.isArray(data && data.output) &&
      data.output
        .flatMap((o) => (Array.isArray(o && o.content) ? o.content : []))
        .find((c) => c && c.type === "output_text") || {}).text ||
    (data && data.output_text) ||
    null;
  return typeof out === "string" ? out : null;
}

// Pure. Decides what to do with one question given the solver's verdict.
// Returns { keep, reason } — `reason` is a stable code for the gate log.
//
// Deliberately asymmetric: an ambiguous question is dropped whatever the
// solver's confidence, because low confidence there means "I cannot pick one",
// not "I might be wrong that it is broken" — that distinction is exactly what
// the eval's metric got wrong before it was corrected. A plain disagreement,
// by contrast, needs confidence behind it, so a hesitant solver cannot delete a
// question that is actually fine.
function decideKeep(verdict, question, opts) {
  const minConfidence = (opts && opts.minMismatchConfidence) || DEFAULT_MISMATCH_CONFIDENCE;
  if (!verdict || typeof verdict !== "object") return { keep: true, reason: "solver_no_verdict" };

  const idx = Number(verdict.index);
  const confidence = Number(verdict.confidence);

  if (idx === CANNOT_JUDGE) return { keep: true, reason: "solver_cannot_judge" };
  if (idx === NO_SINGLE_ANSWER) return { keep: false, reason: "solver_no_single_answer" };
  if (!Number.isInteger(idx) || idx < 0) return { keep: true, reason: "solver_invalid_index" };

  if (idx === question.correct_index) return { keep: true, reason: "solver_agrees" };
  if (Number.isFinite(confidence) && confidence >= minConfidence) {
    return { keep: false, reason: "solver_disagrees_on_key" };
  }
  return { keep: true, reason: "solver_disagrees_low_confidence" };
}

// Solves the multiple-choice questions in `questions`. Short-answer items are
// not solvable this way and are simply not sent; the caller keeps them.
//
// Fail-open: any transport, parse or shape problem returns callOk:false and the
// caller ships what the gate and verifier already approved. A missing safety
// check must never become a missing exam.
async function solveQuestions(questions, opts) {
  const { apiKey, model, subjectProfile, lang, material, timeoutMs } = opts || {};
  const mcs = (questions || []).filter(
    q => q && q.type === "mc" && Array.isArray(q.options) && q.options.length >= 2
  );
  const empty = { perQuestion: new Map(), callOk: false, solved: 0, model: solverModel(model) };
  if (!mcs.length) return { ...empty, callOk: true };

  // Stem and options only. correct_index, model_answer, rubric and
  // source_references are deliberately withheld: if the solver could see the
  // key it would not be an independent solve, it would be a rubber stamp.
  const items = mcs.map(q => ({ id: String(q.id), question: q.question, options: q.options }));
  const trimmedMaterial = String(material || "").slice(0, MATERIAL_CHAR_CAP);

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: solverModel(model),
        input: [
          { role: "system", content: buildSolverPrompt(lang, subjectProfile) },
          { role: "user", content: `Material:\n${trimmedMaterial}\n\nFrågor:\n${JSON.stringify(items)}` },
        ],
        text: { format: buildSolverSchema(mcs.length) },
      }),
      signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 25_000)),
    });
    if (!r.ok) return empty;
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch { return empty; }
    const outputText = extractOutputText(data);
    if (!outputText) return empty;
    let parsed;
    try { parsed = JSON.parse(outputText); } catch { return empty; }
    const perQuestion = new Map();
    for (const res of (parsed.results || [])) perQuestion.set(String(res.id), res);
    return { perQuestion, callOk: true, solved: mcs.length, model: solverModel(model) };
  } catch {
    return empty;
  }
}

module.exports = {
  solveQuestions,
  decideKeep,
  solverModel,
  buildSolverPrompt,
  buildSolverSchema,
  NO_SINGLE_ANSWER,
  CANNOT_JUDGE,
  DEFAULT_MISMATCH_CONFIDENCE,
  MATERIAL_CHAR_CAP,
};
