// Vercel Serverless Function: /api/grade
// CommonJS-format.

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Use POST" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(res, 500, { error: "Missing OPENAI_API_KEY env var" });

  const body = await readJsonBody(req);

  const level = (body.level || "C").toString().toUpperCase();
  const course = (body.course || "").toString().trim();
  const pastedText = (body.pastedText || "").toString().trim();

  const questions = Array.isArray(body.questions) ? body.questions : [];
  const answers = Array.isArray(body.answers) ? body.answers : [];

  if (!questions.length) return json(res, 400, { error: "Missing questions[]" });
  if (!answers.length) return json(res, 400, { error: "Missing answers[]" });

  // Normalisera så att rättning alltid har id + answer
  const normAnswers = answers.map((a, i) => ({
    id: (a && a.id != null) ? String(a.id) : String(questions[i]?.id ?? (i + 1)),
    answer: (a && a.answer != null) ? String(a.answer) : ""
  }));

  const input = [
    "Du är en provrättare för svenska gymnasiet.",
    "Rätta elevens svar mot frågorna och materialet.",
    "Skriv på svenska.",
    "",
    "KRAV:",
    "- Returnera ENDAST ett JSON-objekt (ingen extra text).",
    "- Ge poäng per fråga och totalpoäng.",
    "- Feedback ska vara kort, konkret och kopplad till vad som saknas.",
    "- tips ska vara 3–8 punkter med förbättringsförslag.",
    "",
    "JSON-FORMAT (exakt):",
    "{",
    '  "level": "E"|"C"|"A",',
    '  "total_points": number,',
    '  "max_points": number,',
    '  "per_question": [',
    '    { "id": string, "points": number, "max_points": number, "feedback": string }',
    "  ],",
    '  "tips": [string]',
    "}",
    "",
    `MÅLNIVÅ: ${["E", "C", "A"].includes(level) ? level : "C"}`,
    `KURS/ÄMNE: ${course || "ej angivet"}`,
    "",
    "MATERIAL:",
    pastedText || "(ej angivet)",
    "",
    "FRÅGOR (JSON):",
    JSON.stringify(questions),
    "",
    "ELEVENS SVAR (JSON):",
    JSON.stringify(normAnswers)
  ].join("\n");

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        input,
        text: { format: { type: "json_object" } }
      })
    });

    const raw = await r.text();

    if (!r.ok) {
      return json(res, 500, { error: "OpenAI error", details: raw });
    }

    let data = null;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    return json(res, 200, { ok: true, openai: data });
  } catch (e) {
    return json(res, 500, { error: "Server error", details: String(e) });
  }
};
