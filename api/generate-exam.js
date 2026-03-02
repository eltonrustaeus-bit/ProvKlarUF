// Vercel Serverless Function (Node.js)
// Returnerar { ok:true, exam:{ title, level, questions:[{id, type, points, question, options?}] } }

function clampInt(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function pickSentences(text, maxCount = 80) {
  const cleaned = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  // Prioritera punktlistor/rubriker
  const bullets = cleaned.filter(l => /^[-•*]/.test(l)).map(l => l.replace(/^[-•*]\s*/, ""));
  const lines = bullets.length ? bullets : cleaned;

  const out = [];
  for (const l of lines) {
    // Split på enkla meningsgränser utan att bli för aggressiv
    const parts = l.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
    for (const p of parts) {
      if (p.length >= 18) out.push(p);
      if (out.length >= maxCount) return out;
    }
  }
  return out;
}

function makeShortQuestionFromSentence(s, lang) {
  // Enkel, deterministisk frågegenerator (ingen AI)
  // Bygger frågor runt definition/förklaring/exempel.
  const sv = lang === "sv";
  if (/^\w+\s*:\s*/.test(s)) {
    const [head, rest] = s.split(/:\s*/, 2);
    return sv
      ? `Förklara begreppet "${head}".`
      : `Explain the concept "${head}".`;
  }
  if (/(=|≈|→)/.test(s)) {
    return sv
      ? `Förklara vad som menas med: ${s}`
      : `Explain what this means: ${s}`;
  }
  return sv
    ? `Sammanfatta och förklara: "${s}"`
    : `Summarize and explain: "${s}"`;
}

function makeMcOptionsFromSentence(s, lang) {
  // Skapar 4 alternativ: 1 "rätt-ish" (baserad på meningens nyckelord) + 3 distraktorer
  const sv = lang === "sv";
  const words = s
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(w => w.length >= 5)
    .slice(0, 10);

  const key = words.slice(0, 3).join(" ");
  const a = sv ? `Stämmer med texten: ${key || "huvudpoängen"}` : `Matches the text: ${key || "main point"}`;
  const b = sv ? `Handlar främst om något annat (inte detta avsnitt)` : `Mainly about something else (not this section)`;
  const c = sv ? `Överdriver eller generaliserar felaktigt` : `Overstates or generalizes incorrectly`;
  const d = sv ? `Motsäger textens huvudidé` : `Contradicts the text's main idea`;

  return [a, b, c, d];
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const body = req.body || {};
    const lang = (body.lang === "en") ? "en" : "sv";
    const level = String(body.level || "C").toUpperCase();
    const qType = String(body.qType || "mix");
    const num = clampInt(body.numQuestions ?? 12, 3, 20);
    const pastedText = String(body.pastedText || "").trim();

    if (!pastedText) {
      res.status(400).json({ ok: false, error: (lang === "sv") ? "Material saknas." : "Missing material." });
      return;
    }

    const sents = pickSentences(pastedText, 120);
    if (!sents.length) {
      res.status(400).json({ ok: false, error: (lang === "sv") ? "Kunde inte tolka material." : "Could not parse material." });
      return;
    }

    const questions = [];
    for (let i = 0; i < num; i++) {
      const s = sents[i % sents.length];
      const id = String(i + 1);

      const type =
        (qType === "mc") ? "mc" :
        (qType === "short") ? "short" :
        (i % 3 === 0 ? "mc" : "short");

      const points =
        (level === "A") ? 3 :
        (level === "C") ? 2 : 1;

      if (type === "mc") {
        questions.push({
          id,
          type: "mc",
          points,
          question: (lang === "sv")
            ? `Vilket påstående stämmer bäst med materialet? (Bas: "${s.slice(0, 80)}…")`
            : `Which statement best matches the material? (Base: "${s.slice(0, 80)}…")`,
          options: makeMcOptionsFromSentence(s, lang)
        });
      } else {
        questions.push({
          id,
          type: "short",
          points,
          question: makeShortQuestionFromSentence(s, lang)
        });
      }
    }

    const exam = {
      title: (lang === "sv") ? "Mockprov" : "Mock exam",
      level,
      questions
    };

    res.status(200).json({ ok: true, exam });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
}
