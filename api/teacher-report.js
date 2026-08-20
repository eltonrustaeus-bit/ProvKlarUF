import { requireAuth } from "./_auth.js";
import { callAI } from "./_per-core.js";

import { perRole } from "./_per-name.js";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function safe(val, max) {
  return String(val || "").slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: "OPENAI_API_KEY not configured" });
  }

  try {
    const body = req.body || {};
    const course = safe(body.course, 100).trim();
    const exams_count = Number(body.exams_count || 0);
    const history = Array.isArray(body.history) ? body.history : [];
    const mistakes = Array.isArray(body.mistakes) ? body.mistakes : [];

    const n = Number.isFinite(exams_count) && exams_count > 0 ? exams_count : history.length;

    if (history.length < 3 || n < 3) {
      return res.status(400).json({
        ok: false,
        error: "Minst 3 prov krävs för att skapa en tillförlitlig rapport."
      });
    }

    const safeCourse = course || "Alla kurser";

    const last10 = history.slice(-10).map(x => ({
      ts: x.ts ?? null,
      course: safe(x.course, 60),
      level: safe(x.level, 40),
      qType: safe(x.qType, 40),
      total_points: Number(x.total_points || 0),
      max_points: Number(x.max_points || 0),
      percent: Number(x.percent || 0)
    }));

    const last50Mistakes = mistakes.slice(-50).map(m => ({
      ts: m.ts ?? null,
      course: safe(m.course, 60),
      question: safe(m.question, 200),
      feedback: safe(m.feedback, 200),
      model_answer: safe(m.model_answer, 200),
      points: Number(m.points || 0),
      max_points: Number(m.max_points || 0)
    }));

    const systemPrompt = `Du är ${perRole("professionell lärare")}.
Skriv en kort, tydlig och professionell lärarrapport baserad på elevens provhistorik.

KRAV:
- Rapporten måste baseras på minst 3 prov.
- Första raden måste tydligt ange: "Baserad på X prov".
- Rapporten ska vara saklig, kort och professionell.
- Strukturera i tydliga rubriker.

FORMAT (exakt rubriker):
Baserad på X prov
Kurs:
Översikt:
Styrkor:
Svagheter:
Rekommenderad träning (nästa 1–2 veckor):
Utveckling:

Begränsa till max 220 ord.`;

    const userPrompt = `Antal prov (måste nämnas i första raden): ${n}
Kursfilter: ${safeCourse}

Provhistorik (senaste upp till 10):
${JSON.stringify(last10, null, 2)}

Felbank / tappade poäng (senaste upp till 50):
${JSON.stringify(last50Mistakes, null, 2)}

Skriv rapporten enligt formatet och kraven.`;

    const text = await callAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      { model: MODEL, timeout: 45_000 }
    );

    if (!text) {
      return res.status(500).json({ ok: false, error: "Empty report" });
    }

    return res.status(200).json({ ok: true, report: text, exams_count: n, course: safeCourse });

  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
