// api/train-material.js (CommonJS / Vercel Serverless)
// Skapar “träningsmaterial” från användarens fel (mistakes) så appen kan generera prov på det du missade.

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function pickModel() {
  // Sätt i Vercel env: OPENAI_MODEL_TRAIN (t.ex. en dyrare modell), annars faller den tillbaka.
  return process.env.OPENAI_MODEL_TRAIN || process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function safeString(x, maxLen = 120000) {
  const s = typeof x === "string" ? x : "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function asEnum(x, allowed, fallback) {
  return allowed.includes(x) ? x : fallback;
}

function buildSchema() {
  return {
    type: "json_schema",
    name: "train_material_schema",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["material_text", "focus_topics"],
      properties: {
        material_text: { type: "string" },
        focus_topics: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["topic", "why", "micro_drills"],
            properties: {
              topic: { type: "string" },
              why: { type: "string" },
              micro_drills: {
                type: "array",
                items: { type: "string" }
              }
            }
          }
        }
      }
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "Use POST" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY" });

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let p;
    try { p = body ? JSON.parse(body) : {}; }
    catch (e) { return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) }); }

    const lang = asEnum(p.lang, ["sv", "en"], "sv");
    const course = safeString(p.course, 200) || "";
    const level = safeString(p.level, 10) || "";
    const mistakes = Array.isArray(p.mistakes) ? p.mistakes : [];

    if (!mistakes.length) return json(res, 400, { ok: false, error: "Missing mistakes" });

    // Ta senaste (max) 40 misstag för att hålla prompten stabil/snabb.
    const last = mistakes.slice(-40).map((m) => ({
      id: String(m?.id ?? ""),
      qType: String(m?.qType ?? ""),
      question: safeString(m?.question ?? "", 1200),
      user_answer: safeString(m?.user_answer ?? "", 1200),
      feedback: safeString(m?.feedback ?? "", 1200),
      model_answer: safeString(m?.model_answer ?? "", 1600),
      points: Number(m?.points ?? 0) || 0,
      max_points: Number(m?.max_points ?? 0) || 0
    }));

    const model = pickModel();
    const responseFormat = buildSchema();

    const systemSv =
      "Du är en elitcoach för provträning. Skapa ett träningsmaterial som är strikt anpassat efter elevens misstag.\n" +
      "Mål:\n" +
      "1) Identifiera vad eleven systematiskt missar (begrepp, metod, resonemang, precision, struktur).\n" +
      "2) Skapa ett KOMPakt men komplett material (rubriker + punktlistor + korta regler/strategier + 2–4 miniexempel).\n" +
      "3) Materialet ska vara optimerat för att en provgenerator ska kunna skapa nya frågor på JUST dessa svagheter.\n" +
      "Regler:\n" +
      "- Bygg endast på informationen i misstagspaketet (fråga, feedback, modellsvar). Om fakta saknas: skriv 'Otillräckliga data' och håll dig generell.\n" +
      "- Skriv tydligt och konkret. Inga fluff-ord.\n" +
      "- Ge 3–6 fokusområden (focus_topics). Varje fokusområde ska ha 3 mikroövningar (micro_drills) som är 'gör så här'-uppgifter.\n" +
      "Returnera endast JSON enligt schema.";

    const systemEn =
      "You are an elite exam-training coach. Create training material strictly tailored to the student's mistakes.\n" +
      "Goals:\n" +
      "1) Identify what the student systematically misses (concepts, method, reasoning, precision, structure).\n" +
      "2) Produce compact but complete material (headings + bullet points + short rules/strategies + 2–4 micro-examples).\n" +
      "3) Optimize it so an exam generator can produce new questions targeting THESE weaknesses.\n" +
      "Rules:\n" +
      "- Use only the mistake bundle (question, feedback, model answer). If facts are missing: write 'Insufficient data' and stay general.\n" +
      "- Be clear and concrete. No fluff.\n" +
      "- Provide 3–6 focus topics. Each topic must include 3 micro drills.\n" +
      "Return only JSON per schema.";

    const userPayload = {
      course,
      level,
      mistakes: last
    };

    try {
      const payload = {
        model,
        input: [
          { role: "system", content: lang === "sv" ? systemSv : systemEn },
          { role: "user", content: JSON.stringify(userPayload) }
        ],
        text: { format: responseFormat }
      };

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        return json(res, 500, { ok: false, error: "Non-JSON from OpenAI", status: r.status, raw });
      }
      if (!r.ok) return json(res, 500, { ok: false, error: "OpenAI error", status: r.status, details: data, raw });

      const outputText =
        (Array.isArray(data.output) &&
          data.output.flatMap(o => Array.isArray(o.content) ? o.content : [])
            .find(c => c.type === "output_text")?.text) ||
        data.output_text ||
        null;

      let out;
      try { out = JSON.parse(outputText); } catch (e) {
        return json(res, 500, { ok: false, error: "Could not parse model JSON", details: String(e), outputText });
      }

      return json(res, 200, {
        ok: true,
        material_text: String(out.material_text || ""),
        focus_topics: Array.isArray(out.focus_topics) ? out.focus_topics : []
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: "Server error", details: String(e) });
    }
  });
};
