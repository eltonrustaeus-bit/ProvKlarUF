async function readJson(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return send(res, 500, { error: "Missing OPENAI_API_KEY" });

  const body = await readJson(req);

  const level = String(body.level || "C").toUpperCase();
  const course = String(body.course || "").trim();
  const pastedText = String(body.pastedText || "").trim();

  const questions = Array.isArray(body.questions) ? body.questions : [];
  const answers = Array.isArray(body.answers) ? body.answers : [];

  if (!questions.length) return send(res, 400, { error: "Missing questions[]" });
  if (!answers.length) return send(res, 400, { error: "Missing answers[]" });

  const safeLevel = ["E", "C", "A"].includes(level) ? level : "C";

  const prompt = [
    "Du är en provrättare för svenska gymnasiet.",
    "Rätta elevens svar mot frågorna och materialet (om material finns).",
    "Skriv på svenska.",
    "",
    "KRAV:",
    "- Returnera ENDAST ett JSON-objekt (ingen extra text).",
    "- Poäng per fråga, maxpoäng per fråga och totalpoäng.",
    "- Feedback kort och konkret.",
    "- 3–8 tips.",
    "",
    "JSON-FORMAT:",
    '{ "level":"E"|"C"|"A", "total_points":number, "max_points":number, "per_question":[{"id":string,"points":number,"max_points":number,"feedback":string}], "tips":[string] }',
    "",
    `MÅLNIVÅ: ${safeLevel}`,
    `KURS/ÄMNE: ${course || "ej angivet"}`,
    "",
    "MATERIAL:",
    pastedText || "(ej angivet)",
    "",
    "FRÅGOR (JSON):",
    JSON.stringify(questions),
    "",
    "SVAR (JSON):",
    JSON.stringify(answers)
  ].join("\n");

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        text: { format: { type: "json_object" } }
      })
    });

    const raw = await r.text();
    if (!r.ok) return send(res, 500, { error: "OpenAI error", details: raw });

    const data = JSON.parse(raw);
    const resultText = data.output_text;
    const result = JSON.parse(resultText);

    return send(res, 200, { ok: true, result });
  } catch (e) {
    return send(res, 500, { error: "Server error", details: String(e) });
  }
};
