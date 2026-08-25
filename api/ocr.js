// api/ocr.js (CommonJS / Vercel Serverless)
// Extract text from imageDataUrl using OpenAI (multimodal)

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function pickModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

/* Handskriven matematik är det svåraste ett vision-API gör, och klart svårare
   än den tryckta text materialvägen läser. Egen variabel därför, samma mönster
   som OPENAI_MATH_MODEL i generate-exam.js och hp.js. Vilken modell den ska
   peka på avgörs av evalen i tests/evals/solution-ocr — inte av antagande. */
function pickVisionModel() {
  return process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
}

async function requireAuth(req) {
  const token = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const r = await fetch(
      process.env.SUPABASE_URL + "/auth/v1/user",
      {
        headers: {
          "Authorization": "Bearer " + token,
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY
        },
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return data?.id ? data : null;
  } catch { return null; }
}

/* Läser en elevs handskrivna lösning och returnerar transkriptionen.
 *
 * En oläslig bild är ett normalt utfall, inte ett serverfel: den ger HTTP 200
 * med readable:false. Klienten skiljer på "jag kunde inte tyda bilden" och
 * "något gick sönder", och eleven ska aldrig se ett tekniskt fel för att de
 * fotade i dålig belysning. */
async function handleSolution(res, { imageDataUrl, lang, questionText, apiKey }) {
  const S = require("./_solution-ocr.js");
  const sanitize = await import("../src/per/sanitize.mjs");

  /* Frågetexten är modellgenererad och därmed otillförlitlig när den
     återanvänds i en ny prompt. Saneras före den når systemmeddelandet. */
  let fraga = "";
  if (questionText) {
    fraga = sanitize.redactInstructions(String(questionText), sanitize.MAX_QUESTION_LEN).text;
  }

  const model = pickVisionModel();
  const payload = {
    model,
    input: [
      { role: "system", content: S.buildSolutionSystem(lang, fraga) },
      {
        role: "user",
        content: [
          { type: "input_image", image_url: imageDataUrl },
          { type: "input_text", text: "Transkribera lösningen i bilden." },
        ],
      },
    ],
    text: { format: S.SOLUTION_SCHEMA },
  };

  let data;
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    const rawBody = await r.text();
    try { data = JSON.parse(rawBody); } catch {
      return json(res, 500, { ok: false, error: "Non-JSON from OpenAI", status: r.status });
    }
    if (!r.ok) return json(res, 500, { ok: false, error: "OpenAI error", status: r.status });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e) });
  }

  const parsed = S.parseSolutionResponse(data);
  if (!parsed.readable) {
    return json(res, 200, { ok: true, readable: false, text: "", confidence: parsed.confidence, uncertain: [] });
  }

  /* Transkriptionen flödar vidare in i grade.js prompt. Den saneras radvis så
     att radordningen — som bär resonemanget i en uträkning — överlever. */
  const { text } = await S.redactLines(parsed.text);
  return json(res, 200, {
    ok: true,
    readable: true,
    text,
    confidence: parsed.confidence,
    uncertain: parsed.uncertain,
    model,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "Use POST" });
  }

  const user = await requireAuth(req);
  if (!user) return json(res, 401, { ok: false, error: "Unauthorized" });

  // OCR requires Basic or higher
  try {
    const profRes = await fetch(
      process.env.SUPABASE_URL + "/rest/v1/profiles?select=role&id=eq." + user.id,
      {
        headers: {
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
        signal: AbortSignal.timeout(5000)
      }
    );
    const profData = await profRes.json();
    const role = String(profData?.[0]?.role || "gratis");
    if (!["basic", "premium", "admin", "user"].includes(role)) {
      return json(res, 403, { ok: false, error: "OCR requires Basic or Premium" });
    }
  } catch { return json(res, 500, { ok: false, error: "Role check failed" }); }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY" });

  const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB base64

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    let p;
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      p = raw ? JSON.parse(raw) : {};
    } catch (e) { return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) }); }

    const imageDataUrl = String(p.imageDataUrl || "");
    const lang = (p.lang === "en") ? "en" : "sv";
    if (!imageDataUrl.startsWith("data:image/")) {
      return json(res, 400, { ok: false, error: "Missing/invalid imageDataUrl" });
    }
    if (imageDataUrl.length > MAX_IMAGE_BYTES) {
      return json(res, 413, { ok: false, error: "Image too large (max 10 MB)" });
    }

    /* ── Elevlösning ──────────────────────────────────────────────────────
       Egen gren, eget kontrakt. Utan mode gäller materialvägen nedan exakt
       som förut — app.html skickar inget mode och påverkas därför inte. */
    if (p.mode === "solution") {
      return handleSolution(res, { imageDataUrl, lang, questionText: p.questionText, apiKey });
    }

    const model = pickModel();

    const system =
      lang === "sv"
        ? "Du är OCR. Extrahera all text exakt från bilden. Returnera bara ren text utan extra förklaringar."
        : "You are OCR. Extract all text exactly from the image. Return only plain text with no extra commentary.";

    try {
      const payload = {
        model,
        input: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "input_image", image_url: imageDataUrl },
              { type: "input_text", text: "Extract text." }
            ]
          }
        ]
      };

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000)
      });

      const rawBody = await r.text();
      let data;
      try { data = JSON.parse(rawBody); } catch {
        return json(res, 500, { ok: false, error: "Non-JSON from OpenAI", status: r.status });
      }
      if (!r.ok) return json(res, 500, { ok: false, error: "OpenAI error", status: r.status, details: data });

      const text =
        (Array.isArray(data.output) &&
          data.output.flatMap(o => Array.isArray(o.content) ? o.content : [])
            .find(c => c.type === "output_text")?.text) ||
        data.output_text ||
        "";

      return json(res, 200, { ok: true, text: String(text || "").trim() });
    } catch (e) {
      return json(res, 500, { ok: false, error: "Server error", details: String(e) });
    }
  });
};
