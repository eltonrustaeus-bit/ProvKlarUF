export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY env var" });
    return;
  }

  try {
    const { level, course, pastedText, questions, answers } = req.body || {};

    const prompt = [
      "Du är en provrättare för svenska gymnasiet.",
      "Rätta elevens svar mot frågorna och materialet.",
      "Ge poäng per fråga och totalpoäng.",
      "Ge korta förbättringstips kopplade till vad eleven missade.",
      "",
      "Returnera ENDAST JSON i exakt format:",
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
      `Nivå: ${level || "C"}`,
      `Kurs/ämne: ${course || ""}`,
      "",
      "Material:",
      pastedText || "",
      "",
      "Frågor (JSON):",
      JSON.stringify(questions || []),
      "",
      "Elevens svar (JSON):",
      JSON.stringify(answers || []),
    ].join("\n");

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        input: prompt,
        text: { format: { type: "json_object" } }
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      res.status(500).json({ error: "OpenAI error", details: errText });
      return;
    }

    const data = await r.json();
    res.status(200).json({ ok: true, openai: data });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
}
