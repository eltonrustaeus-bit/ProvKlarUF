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

    const imageDataUrl = String(p.imageDataUrl || "");
    const lang = (p.lang === "en") ? "en" : "sv";
    if (!imageDataUrl.startsWith("data:image/")) {
      return json(res, 400, { ok: false, error: "Missing/invalid imageDataUrl" });
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
        body: JSON.stringify(payload)
      });

      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        return json(res, 500, { ok: false, error: "Non-JSON from OpenAI", status: r.status, raw });
      }
      if (!r.ok) return json(res, 500, { ok: false, error: "OpenAI error", status: r.status, details: data, raw });

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
