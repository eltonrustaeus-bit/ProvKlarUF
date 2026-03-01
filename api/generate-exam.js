// /api/generate-exam.js

function json(res, status, obj) {
 res.statusCode = status;
 res.setHeader("Content-Type", "application/json; charset=utf-8");
 res.end(JSON.stringify(obj));
}

function safeString(x, maxLen = 200000) {
 const s = typeof x === "string" ? x : "";
 return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function asEnum(x, allowed, fallback) {
 return allowed.includes(x) ? x : fallback;
}

function toInt(x, fallback) {
 const n = Number.parseInt(String(x), 10);
 return Number.isFinite(n) ? n : fallback;
}

function buildMockExamSchema(n) {
 return {
 type: "json_schema",
 name: "mock_exam",
 strict: true,
 schema: {
 type: "object",
 additionalProperties: false,
 required: ["title", "level", "questions"],
 properties: {
 title: { type: "string" },
 level: { type: "string", enum: ["E", "C", "A"] },
 questions: {
 type: "array",
 minItems: n,
 maxItems: n,
 items: {
 type: "object",
 additionalProperties: false,
 required: [
 "id",
 "type",
 "points",
 "question",
 "options",
 "correct_index",
 "rubric",
 "model_answer"
 ],
 properties: {
 id: { type: "string" },
 type: { type: "string", enum: ["mc", "short"] },
 points: { type: "number" },
 question: { type: "string" },
 options: {
 type: "array",
 items: { type: "string" },
 maxItems: 6
 },
 correct_index: { type: "integer" },
 rubric: { type: "string" },
 model_answer: { type: "string" }
 }
 }
 }
 }
 }
 }
 };
}

async function readJsonBody(req) {
 const chunks = [];
 for await (const c of req) chunks.push(c);
 const raw = Buffer.concat(chunks).toString("utf8");
 if (!raw) return {};
 return JSON.parse(raw);
}

function extractOpenAIOutputText(data) {
 const outputText =
 (Array.isArray(data?.output) &&
 data.output
 .flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
 .find((c) => c?.type === "output_text")?.text) ||
 data?.output_text ||
 null;

 return typeof outputText === "string" ? outputText : null;
}

module.exports = async function handler(req, res) {
 if (req.method !== "POST") {
 res.setHeader("Allow", "POST");
 return json(res, 405, { ok: false });
 }

 let parsed;

 try {
 parsed = await readJsonBody(req);
 } catch (e) {
 return json(res, 400, {
 ok: false,
 error: "bad json"
 });
 }

 const pastedText = safeString(parsed.pastedText);

 if (!pastedText.trim())
 return json(res, 400, {
 ok: false,
 error: "Missing pastedText"
 });

 const level = asEnum(parsed.level, ["E", "C", "A"], "C");

 const qType = asEnum(parsed.qType, ["mix", "mc", "short"], "mix");

 const numQuestions = Math.min(
 20,
 Math.max(
 3,
 toInt(parsed.numQuestions, 10)
 )
 );

 const course = safeString(parsed.course, 200);

 const systemPrompt =
 "Du skapar ett realistiskt mockprov som en svensk gymnasielärare. " +
 "Du MÅSTE följa JSON-schemat exakt och bara returnera giltig JSON (ingen markdown, ingen text före/efter). " +
 "EXAKT antal frågor. " +
 "Regler per fråga: " +
 "1) id måste vara en sträng (t.ex. 'q1', 'q2', ...). " +
 "2) type får bara vara 'mc' eller 'short'. " +
 "3) points ska vara ett rimligt tal per fråga (t.ex. 1–5). " +
 "4) Om type=='mc': options ska ha 3–5 alternativ och correct_index ska vara 0..(options.length-1). " +
 "5) Om type=='short': options måste vara [] och correct_index måste vara -1. " +
 "6) rubric ska vara kort, poängfokuserad och tydlig. " +
 "7) model_answer ska alltid finnas. För mc: förklara varför rätt alternativ är rätt. För short: skriv ett fullpoängssvar.";

 const mixRule =
 qType === "mc"
 ? "Gör ALLA frågor som flervalsfrågor (mc)."
 : qType === "short"
 ? "Gör ALLA frågor som kortsvar (short)."
 : "Gör en blandning av 'mc' och 'short' (ungefär hälften/hälften).";

 const userPrompt =
 `Skapa ett mockprov på nivå ${level}.
 Antal frågor: ${numQuestions}.
 Frågetyp-val: ${qType}. ${mixRule}
 ${course ? `Kurs/ämne: ${course}.` : ""}

 Material (använd bara detta som underlag):
 ${pastedText}`;

 async function runOpenAI() {
 const key = process.env.OPENAI_API_KEY;

 if (!key)
 return {
 ok: false,
 error: "no openai key"
 };

 const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

 const r = await fetch(
 "https://api.openai.com/v1/responses",
 {
 method: "POST",
 headers: {
 Authorization: `Bearer ${key}`,
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 model,
 input: [
 { role: "system", content: systemPrompt },
 { role: "user", content: userPrompt }
 ],
 text: {
 format: buildMockExamSchema(numQuestions)
 }
 })
 }
 );

 const raw = await r.text();

 let data;

 try {
 data = JSON.parse(raw);
 } catch {
 return {
 ok: false,
 error: "openai non json"
 };
 }

 if (!r.ok) {
 return {
 ok: false,
 error: "openai error",
 status: r.status,
 details: data
 };
 }

 const out = extractOpenAIOutputText(data);

 if (!out)
 return {
 ok: false,
 error: "no output"
 };

 return {
 ok: true,
 outputText: out,
 provider: "openai",
 model
 };
 }

 try {
 const first = await runOpenAI();

 if (!first.ok)
 return json(res, 500, first);

 const outputText = first.outputText;

 let exam;

 try {
 exam = JSON.parse(outputText);
 } catch (e) {
 return json(res, 500, {
 ok: false,
 error: "Could not parse model JSON",
 details: String(e),
 outputText
 });
 }

 return json(res, 200, {
 ok: true,
 exam,
 meta: {
 provider: first.provider,
 model: first.model
 }
 });
 }
 catch (e) {
 return json(res, 500, {
 ok: false,
 error: "Server error",
 details: String(e)
 });
 }
};
