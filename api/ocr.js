// /api/ocr.js
// Input: { imageDataUrl: "data:image/png;base64,...", lang: "sv" | "en" }
// Output: { ok:true, text:"...", warnings:[...] }

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function safeParseJSON(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pickModel() {
  // Vision-capable model (ändra vid behov via env)
  return process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
}

async function openaiChatJSON({ messages, schema, temperature }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: pickModel(),
      temperature: typeof temperature === "number" ? temperature : 0,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: "ocr_schema", strict: true, schema },
      },
    }),
  });

  const txt = await resp.text();
  const data = safeParseJSON(txt);

  if (!resp.ok) {
    const msg = data?.error?.message || txt || "OpenAI error";
    const e = new Error(msg);
    e.status = resp.status;
    e.raw = txt;
    throw e;
  }

  const content = data?.choices?.[0]?.message?.content;
  const obj = safeParseJSON(content);
  if (!obj) {
    const e = new Error("Model did not return valid JSON content");
    e.status = 500;
    e.raw = txt;
    throw e;
  }
  return obj;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Use POST" });

  const raw = req.body && typeof req.body === "object" ? null : await readBody(req);
  const body = req.body && typeof req.body === "object" ? req.body : safeParseJSON(raw);
  if (!body) return json(res, 400, { ok: false, error: "Invalid JSON body" });

  const imageDataUrl = String(body.imageDataUrl || "").trim();
  const lang = String(body.lang || "sv").trim();

  if (!imageDataUrl.startsWith("data:image/")) {
    return json(res, 400, { ok: false, error: "imageDataUrl must be a data:image/* URL" });
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["text", "warnings"],
  };

  const langRule =
    lang === "en"
      ? "Return the extracted text exactly as it appears (English if present)."
      : "Return the extracted text exactly as it appears (Swedish if present).";

  const messages = [
    {
      role: "system",
      content:
        "You are an OCR extractor. Output MUST be JSON matching the schema. No extra keys. No markdown.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: `Extract all readable text from this image.\n${langRule}\nIf unreadable/blurred, put a warning.` },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];

  try {
    const out = await openaiChatJSON({ messages, schema, temperature: 0 });
    const text = String(out.text || "");
    const warnings = Array.isArray(out.warnings) ? out.warnings : [];
    return json(res, 200, { ok: true, text, warnings });
  } catch (e) {
    return json(res, 500, {
      ok: false,
      error: "OpenAI error",
      status: e.status || 500,
      details: String(e.message || e),
      raw: e.raw ? String(e.raw).slice(0, 2000) : undefined,
    });
  }
};
