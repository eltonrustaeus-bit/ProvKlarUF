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
    const { level, course, pastedText } = req.body || {};

    const prompt = [
      "Du är en provkonstruktör för svenska gymnasiet.",
      "Skapa ett realistiskt mockprov baserat på materialet.",
      "Returnera ENDAST JSON i exakt format:",
      "{",
      '  "title": string,',
      '  "level": "E"|"C"|"A",',
      '  "questions": [',
      "    {",
      '      "id": string,',
      '      "points": number,',
      '      "question": string',
      "    }",
      "  ]",
      "}",
      "",
      `Nivå: ${level || "C"}`,
      `Kurs/ämne: ${course || ""}`,
      "Material:",
      pastedText || ""
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
        // Be modellen svara som ren JSON-text
        text: { format: { type: "json_object" } }
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      res.status(500).json({ error: "OpenAI error", details: errText });
      return;
    }

    const data = await r.json();

    // Responses API returnerar output på olika sätt; säkrast är att skicka hela svaret till frontend
    res.status(200).json({ ok: true, openai: data });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
}
