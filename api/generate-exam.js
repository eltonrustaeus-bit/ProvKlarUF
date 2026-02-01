// Vercel Serverless Function: /api/generate-exam
// CommonJS-format för att undvika ESM/Module-strul.

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

  // Strikt JSON-output som appen kan JSON.parse:a direkt.
  const input = [
    "Du är en provkonstruktör för svenska gymnasiet.",
    "Skapa ett realistiskt mockprov baserat på materialet.",
    "Skriv på svenska.",
    "",
    "KRAV:",
    "- Returnera ENDAST ett JSON-objekt (ingen extra text).",
    '- level måste vara exakt "E", "C" eller "A".',
    "- questions ska vara 8–12 frågor beroende på materialets omfattning.",
    "- points ska vara heltal per fråga.",
    "- Frågor ska vara prov-lika och möjliga att svara på utifrån materialet.",
    "",
    "JSON-FORMAT (exakt):",
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
    `NIVÅ: ${["E", "C", "A"].includes(level) ? level : "C"}`,
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
        model: "gpt-4o",
        input,
        text: { format: { type: "json_object" } }
      })
    });

    const raw = await r.text();

    if (!r.ok) {
      return json(res, 500, { error: "OpenAI error", details: raw });
    }

    // Returnera OpenAI-svaret som JSON (inkl. output_text).
    let data = null;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    return json(res, 200, { ok: true, openai: data });
  } catch (e) {
    return json(res, 500, { error: "Server error", details: String(e) });
  }
};
