// api/_verifier.js (CommonJS — shared by generate-exam.js)
//
// Separate role from the generator: the generator proposes questions, this module
// checks them. Never asked to "fix" a question — only to score and flag it. Returns
// structured, multi-dimension results (spec §7) instead of a bare approved/rejected
// boolean, so generate-exam.js and its logs can see WHY something failed.

function buildVerifierSchema() {
  return {
    type: "json_schema",
    name: "exam_verifier_schema",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id", "approved", "factual_accuracy", "ambiguity_score",
              "difficulty_match", "source_alignment", "scoring_quality",
              "language_quality", "issues", "required_changes"
            ],
            properties: {
              id: { type: "string" },
              approved: { type: "boolean" },
              factual_accuracy: { type: "number" },
              ambiguity_score: { type: "number" },
              difficulty_match: { type: "number" },
              source_alignment: { type: "number" },
              scoring_quality: { type: "number" },
              language_quality: { type: "number" },
              issues: { type: "array", items: { type: "string" }, maxItems: 10 },
              required_changes: { type: "array", items: { type: "string" }, maxItems: 10 }
            }
          }
        }
      }
    }
  };
}

const DEFAULT_THRESHOLDS = {
  minFactualAccuracy: 0.75,
  // Tightened from 0.35. Measured on the long-form eval fixtures: 9 of 12
  // defective questions were "more than one option is correct" rather than a
  // wrong answer key — the dominant defect by a wide margin, and precisely what
  // this dimension exists to catch. 0.35 let them through.
  maxAmbiguity: 0.20,
  minDifficultyMatch: 0.6,
  minSourceAlignment: 0.6,
  minScoringQuality: 0.6,
  minLanguageQuality: 0.6,
};

// Pure — no I/O. The model's own "approved" is necessary but not sufficient: a
// generous model can say approved=true while still leaving required_changes, or
// scoring low on one dimension. We AND all of it together.
function decideApproval(r, thresholds) {
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  if (!r || typeof r !== "object") return false;
  if (r.approved !== true) return false;
  if (Array.isArray(r.required_changes) && r.required_changes.length > 0) return false;
  if (!(Number(r.factual_accuracy) >= t.minFactualAccuracy)) return false;
  if (!(Number(r.ambiguity_score) <= t.maxAmbiguity)) return false;
  if (!(Number(r.difficulty_match) >= t.minDifficultyMatch)) return false;
  if (!(Number(r.source_alignment) >= t.minSourceAlignment)) return false;
  if (!(Number(r.scoring_quality) >= t.minScoringQuality)) return false;
  if (!(Number(r.language_quality) >= t.minLanguageQuality)) return false;
  return true;
}

// The verifier is a SECOND OPINION, so it must be allowed to run on a different
// model than the generator. Running both roles on the same weights reproduces the
// same blind spots: api/hp.js:571 records that gpt-4o-mini reliably mislabels
// correct_index on quantitative items while writing a correct explanation — a
// same-model reviewer agrees with that mistake. Falls back to the generator's
// model so behaviour is unchanged until the env var is set.
function verifierModel(generatorModel) {
  return process.env.OPENAI_VERIFIER_MODEL || generatorModel;
}

// Subject-specific review instructions. The base prompt already covers every
// subject (factual errors, multiple valid answers, fabricated terms, absurd
// distractors, points/difficulty mismatch); these add what a reviewer of THAT
// subject would check that a generic reviewer would not. Costs ~40 tokens per
// call. A profile with no entry simply gets the base prompt.
const SUBJECT_HINTS = {
  law: {
    sv: "Ämnesspecifikt för juridik: kontrollera att brottsrubriceringar, lagrum och straffskalor är verkliga och korrekt återgivna, att uppsåt/oaktsamhet inte blandas ihop, och att föråldrad terminologi inte används som huvudterm.",
    en: "Law-specific: verify crime categories, statutory references, and sentencing ranges are real and correctly stated, that intent/negligence aren't conflated, and that obsolete terminology isn't used as the primary term.",
  },
  mathematics: {
    sv: "Ämnesspecifikt för matematik: räkna igenom varje uppgift själv INNAN du bedömer den. Kontrollera att correct_index pekar på det alternativ som din egen uträkning ger, och att slutsvaret i model_answer stämmer med samma alternativ — en korrekt förklaring kombinerad med fel index är det vanligaste felet och ska ge approved=false. Kontrollera även att enheter och avrundning är konsekventa.",
    en: "Maths-specific: solve every task yourself BEFORE judging it. Verify that correct_index points at the option your own computation yields, and that the final answer in model_answer matches that same option — a correct explanation combined with a wrong index is the most common failure and must give approved=false. Also check that units and rounding are consistent.",
  },
  natural_sciences: {
    sv: "Ämnesspecifikt för naturvetenskap: kontrollera att enheter, storheter och storleksordningar är korrekta och konsekventa, att formler återges rätt, att kemiska formler och reaktionsformler är balanserade, och att begrepp från fysik, kemi och biologi inte blandas ihop. Räkna igenom uppgifter som kräver beräkning.",
    en: "Science-specific: verify that units, quantities and orders of magnitude are correct and consistent, that formulas are stated correctly, that chemical formulas and reaction equations are balanced, and that physics, chemistry and biology concepts aren't conflated. Work through any task requiring calculation.",
  },
  social_sciences: {
    sv: "Ämnesspecifikt för samhällsorienterande ämnen: kontrollera att årtal, personer, händelseförlopp, institutioner och siffror är verkliga och korrekt återgivna. Var särskilt uppmärksam på påhittade källor, citat och statistik. Tolknings- och värderingsfrågor har ofta flera rimliga svar — en sådan fråga ska vara kortsvar, inte flerval, och ska annars ge approved=false.",
    en: "Social-studies-specific: verify that dates, people, sequences of events, institutions and figures are real and correctly stated. Watch especially for fabricated sources, quotations and statistics. Interpretive or evaluative questions often have several reasonable answers — such a question must be short-answer, not multiple choice, and otherwise gives approved=false.",
  },
  languages: {
    sv: "Ämnesspecifikt för språk: kontrollera att målspråket är grammatiskt korrekt, att stavning och diakritiska tecken stämmer, och att inget distraktoralternativ råkar vara en lika godtagbar översättning, böjning eller synonym som facit. Idiomatiska uttryck har ofta fler än ett korrekt svar — då är frågan flertydig.",
    en: "Language-specific: verify that the target language is grammatically correct, that spelling and diacritics are right, and that no distractor happens to be an equally acceptable translation, inflection or synonym as the answer key. Idiomatic expressions often have more than one correct answer — that makes the question ambiguous.",
  },
  programming: {
    sv: "Ämnesspecifikt för programmering: kontrollera att kod i frågan och i alternativen är syntaktiskt giltig i det angivna språket, och att den påstådda utdatan är vad koden faktiskt producerar — spåra igenom den rad för rad. Var uppmärksam på nollindexering, off-by-one och att språkversionens beteende stämmer.",
    en: "Programming-specific: verify that code in the question and in the options is syntactically valid in the stated language, and that the claimed output is what the code actually produces — trace through it line by line. Watch for zero-indexing, off-by-one errors, and language-version-specific behaviour.",
  },
};

function buildVerifierPrompt(lang, subjectProfile) {
  const base = lang === "sv"
    ? "Du är en oberoende ämnesgranskare — INTE samma roll som skapade frågorna. " +
      "Du litar inte blint på frågans facit. Bedöm varje fråga på egna meriter mot ämneskunskap du känner till. " +
      "Sätt approved=false om NÅGOT av följande gäller: faktafel, mer än ett rimligt svar, en hittad-på term/kategori/paragraf, " +
      "distraktorer som är orimliga eller avslöjar rätt svar genom formulering, poäng som inte matchar frågans omfattning, " +
      "eller en svårighetsgrad som inte matchar cognitive_level. " +
      "required_changes ska vara tomt endast om frågan kan visas för en elev precis som den är."
    : "You are an independent subject-matter reviewer — NOT the same role that authored the questions. " +
      "Do not blindly trust the answer key. Judge each question on its own merits against your subject knowledge. " +
      "Set approved=false if ANY of the following apply: factual errors, more than one reasonable answer, a fabricated " +
      "term/category/citation, distractors that are absurd or give away the answer through phrasing, points that don't " +
      "match the question's scope, or a difficulty that doesn't match cognitive_level. " +
      "required_changes must be empty only if the question can be shown to a student exactly as-is.";
  const hint = SUBJECT_HINTS[subjectProfile];
  const profileHint = hint ? " " + (lang === "sv" ? hint.sv : hint.en) : "";
  return base + profileHint;
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

async function verifyQuestions(questions, opts) {
  const { apiKey, model, subjectProfile, lang } = opts || {};
  const items = (questions || []).map(q => ({
    id: String(q.id),
    type: q.type,
    question: q.question,
    options: q.options,
    correct_index: q.correct_index,
    points: q.points,
    cognitive_level: q.cognitive_level,
    scoring_rubric: q.scoring_rubric,
    source_references: q.source_references,
  }));

  const reviewModel = verifierModel(model);

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: reviewModel,
        input: [
          { role: "system", content: buildVerifierPrompt(lang, subjectProfile) },
          { role: "user", content: JSON.stringify(items) }
        ],
        text: { format: buildVerifierSchema() }
      }),
      signal: AbortSignal.timeout(30_000)
    });
    const failed = { perQuestion: new Map(), callOk: false, model: reviewModel };
    if (!r.ok) return failed;
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch { return failed; }
    const outputText = extractOutputText(data);
    if (!outputText) return failed;
    let parsed;
    try { parsed = JSON.parse(outputText); } catch { return failed; }
    const perQuestion = new Map();
    for (const res of (parsed.results || [])) perQuestion.set(String(res.id), res);
    return { perQuestion, callOk: true, model: reviewModel };
  } catch {
    return { perQuestion: new Map(), callOk: false, model: reviewModel };
  }
}

module.exports = {
  buildVerifierSchema,
  decideApproval,
  buildVerifierPrompt,
  verifierModel,
  verifyQuestions,
  SUBJECT_HINTS,
  DEFAULT_THRESHOLDS,
};
