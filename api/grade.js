// Vercel Serverless Function (Node.js)
// Tar { lang, pastedText, questions:[...], answers:[{id,answer}] }
// Returnerar { ok:true, result:{ total_points, max_points, per_question:[{id, points, max_points, feedback, model_answer, concept_tag?}] } }

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(material, limit = 10) {
  const words = normalize(material)
    .split(" ")
    .filter(w => w.length >= 5);

  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

function scoreShortAnswer(answer, keywords, maxPoints) {
  const a = normalize(answer);
  if (!a) return { points: 0, hit: 0 };

  let hit = 0;
  for (const k of keywords) {
    if (a.includes(k)) hit++;
  }

  // Enkel poängsättning: andel träffar
  const ratio = Math.min(1, hit / Math.max(3, Math.min(6, keywords.length)));
  const points = Math.round(ratio * maxPoints);

  return { points, hit };
}

function gradeMc(answerLetter, maxPoints, lang) {
  // I generate-exam skapas alltid alternativ A som "rätt-ish"
  const a = String(answerLetter || "").trim().toUpperCase();
  const correct = "A";
  const points = (a === correct) ? maxPoints : 0;
  const sv = lang === "sv";
  const feedback = (points === maxPoints)
    ? (sv ? "Rätt alternativ." : "Correct option.")
    : (sv ? "Fel alternativ. Läs påståendena och jämför med materialet." : "Incorrect. Re-check the statements against the material.");
  return { points, feedback, model: (sv ? "Välj alternativ A (det som matchar texten)." : "Choose option A (the one matching the text).") };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const body = req.body || {};
    const lang = (body.lang === "en") ? "en" : "sv";
    const material = String(body.pastedText || "");
    const questions = Array.isArray(body.questions) ? body.questions : [];
    const answers = Array.isArray(body.answers) ? body.answers : [];

    const aById = new Map(answers.map(a => [String(a.id), String(a.answer || "")]));
    const keywords = extractKeywords(material, 12);

    const per = [];
    let total = 0;
    let max = 0;

    for (const q of questions) {
      const id = String(q.id);
      const maxPoints = Number(q.points || 1);
      max += maxPoints;

      const ans = aById.get(id) || "";

      if (q.type === "mc") {
        const g = gradeMc(ans, maxPoints, lang);
        total += g.points;
        per.push({
          id,
          points: g.points,
          max_points: maxPoints,
          feedback: g.feedback,
          model_answer: g.model,
          concept_tag: "multiple_choice"
        });
      } else {
        const r = scoreShortAnswer(ans, keywords, maxPoints);
        total += r.points;

        const sv = lang === "sv";
        const model = sv
          ? `För full poäng: använd centrala begrepp från materialet, t.ex. ${keywords.slice(0, 5).join(", ")}.`
          : `For full points: use key terms from the material, e.g. ${keywords.slice(0, 5).join(", ")}.`;

        const feedback =
          (r.points === maxPoints)
            ? (sv ? "Täcker centrala begrepp." : "Covers key concepts.")
            : (r.points === 0)
              ? (sv ? "Inget svar eller för lite koppling till materialet." : "No answer or too little connection to the material.")
              : (sv ? "Delvis. Lägg till fler centrala begrepp och tydligare förklaring." : "Partial. Add more key terms and a clearer explanation.");

        per.push({
          id,
          points: r.points,
          max_points: maxPoints,
          feedback,
          model_answer: model,
          concept_tag: "short_answer"
        });
      }
    }

    res.status(200).json({
      ok: true,
      result: {
        total_points: total,
        max_points: max,
        per_question: per
      }
    });
  } catch {
    res.status(500).json({ ok: false, error: "Server error" });
  }
}
