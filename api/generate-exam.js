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

  if (!pastedText) return send(res, 400, { error: "Missing pastedText" });

  const safeLevel = ["E", "C", "A"].includes(level) ? level : "C";

  const prompt = [
    "Du är en provkonstruktör för svenska gymnasiet.",
    "Skapa ett realistiskt mockprov baserat på materialet.",
    "Skriv på svenska.",
    "",
    "KRAV:",
    "- Returnera ENDAST ett JSON-objekt (ingen extra text).",
    '- "level" måste vara "E" eller "C" eller "A".',
    '- "questions" ska vara 8–12 frågor.',
    '- Varje fråga: id (string), points (heltal), question (string).',
    "",
    "JSON-FORMAT:",
    '{ "title": string, "level": "E"|"C"|"A", "questions": [{ "id": string, "points": number, "question": string }] }',
    "",
    `NIVÅ: ${safeLevel}`,
    `KURS/ÄMNE: ${course || "ej angivet"}`,
    "",
    "MATERIAL:",
    pastedText
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
    const examText = data.output_text;
    const exam = JSON.parse(examText);

    return send(res, 200, { ok: true, exam });
  } catch (e) {
    return send(res, 500, { error: "Server error", details: String(e) });
  }
};
