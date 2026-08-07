import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
// SKARPT test av provpipelinen mot OpenAI — kostar tokens
//
// Kör api/generate-exam.js och api/grade.js i process med riktiga nycklar.
// Endast Supabase-anropen fejkas (auth, roll, kvot); allt mot api.openai.com går
// på riktigt, genom samma prompter, samma JSON-schema, samma strukturgrind och
// samma verifierare som i produktion.
// 
// Skriver INGENTING till databasen och deployar ingenting.
// 
// Kräver .env.local i repo-roten med ett giltigt OPENAI_API_KEY:
//   vercel env pull .env.local --environment=production
// Radera filen efteråt — den innehåller riktiga nycklar.
// 
// Mätt beteende att känna till: antalet frågor är inte tillförlitligt. Med
// gpt-4o-mini gav 6 begärda 3 frågor (verifieraren underkände tre) och 12 gav 9
// (genereringen hann inte inom 60-sekundersbudgeten och räddades styckvis).
//
// Användning:
//   node tests/live/exam-pipeline.live.mjs [antal frågor]
//
// Fristående Node-skript som använder repots egen playwright-dep. Ingen runner.
// Exitkod 0 = allt grönt.


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.OUT_DIR || resolve(ROOT, ".test-out");

const require = createRequire(ROOT + "/package.json");

// ── env ────────────────────────────────────────────────────────────────────
if (!fs.existsSync(ROOT + "/.env.local")) {
  console.error("Saknar .env.local i repo-roten. Hämta den med:\n" +
    "  vercel env pull .env.local --environment=production\n" +
    "Radera filen efteråt — den innehåller riktiga nycklar.");
  process.exit(2);
}
for (const line of fs.readFileSync(ROOT + "/.env.local", "utf8").split("\n")) {
  if (!line.trim()) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, "");
}
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length < 20) {
  console.error("OPENAI_API_KEY saknas eller är maskerad — avbryter.");
  process.exit(1);
}
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://mnmotdluigzeehdjbhbu.supabase.co";

// ── fejka bara Supabase ────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let supabaseCalls = 0, openaiCalls = 0;

globalThis.fetch = async function (url, opts) {
  const u = String(url);
  if (u.includes("supabase.co") || u.includes("/rest/v1/") || u.includes("/auth/v1/")) {
    supabaseCalls++;
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.includes("/auth/v1/user")) return j({ id: "e2e-user", email: "e2e@test.local" });
    if (u.includes("/rest/v1/profiles")) return j([{ role: "premium" }]);
    if (u.includes("consume_mock_exam_quota")) return j({ ok: true, count: 1, limit: null, unlimited: true, period: "2026-08" });
    return j([]);
  }
  if (u.includes("api.openai.com")) openaiCalls++;
  return realFetch(url, opts);
};

// ── fejkade req/res ────────────────────────────────────────────────────────
function mkReq(body) {
  const r = Readable.from([Buffer.from(JSON.stringify(body), "utf8")]);
  r.method = "POST";
  r.headers = { authorization: "Bearer e2e-token", "content-type": "application/json" };
  return r;
}

function mkRes() {
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const res = {
    statusCode: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    end(payload) {
      let data = null;
      try { data = JSON.parse(payload); } catch (_) { data = payload; }
      resolve({ status: this.statusCode, data });
    },
    done
  };
  return res;
}

async function call(handlerPath, body) {
  const handler = require(handlerPath);
  const req = mkReq(body);
  const res = mkRes();
  const t0 = Date.now();
  await handler(req, res);
  const out = await res.done;
  out.ms = Date.now() - t0;
  return out;
}

// ── material ───────────────────────────────────────────────────────────────
const MATERIAL = `Cellandning

Cellandningen bryter ner glukos till koldioxid och vatten och frigör energi som lagras i ATP.
Processen sker i tre steg.

Glykolysen sker i cytoplasman. En glukosmolekyl (6 kol) delas i två pyruvatmolekyler (3 kol var).
Nettoutbytet är 2 ATP och 2 NADH. Glykolysen kräver inte syre.

Citronsyracykeln sker i mitokondriens matrix. Pyruvat omvandlas först till acetyl-CoA.
Cykeln frigör koldioxid och bildar NADH och FADH2.

Elektrontransportkedjan sitter i mitokondriens inre membran. NADH och FADH2 lämnar sina
elektroner, och energin används för att pumpa vätejoner ut ur matrix. När vätejonerna
strömmar tillbaka genom ATP-syntas bildas ATP. Syre är den sista elektronmottagaren och
blir vatten. Utan syre stannar hela kedjan.

Total aerob cellandning ger cirka 30 ATP per glukos.

Jäsning

Vid syrebrist kan elektrontransportkedjan inte arbeta. Cellen går då över till jäsning för
att regenerera NAD+ så att glykolysen kan fortsätta. Mjölksyrajäsning sker i muskelceller
och bildar mjölksyra. Utbytet är bara 2 ATP per glukos.`;

const argN = Number(process.argv[2] || 6);

console.log("── SKARP GENERERING ──────────────────────────────────────────");
console.log(`modell: ${process.env.OPENAI_MODEL || "gpt-4o-mini"} · ${argN} frågor · Biologi 1 · nivå C\n`);

const gen = await call(ROOT + "/api/generate-exam.js", {
  lang: "sv", level: "C", course: "Biologi 1", qType: "mix",
  numQuestions: argN, pastedText: MATERIAL
});

console.log("HTTP", gen.status, "·", (gen.ms / 1000).toFixed(1) + "s");
if (!gen.data?.ok) {
  console.log("MISSLYCKADES:", JSON.stringify(gen.data).slice(0, 600));
  process.exit(1);
}

const exam = gen.data.exam;
const meta = gen.data.meta;
console.log("frågor:", exam.questions.length, "av", argN, "begärda");
console.log("ämnesprofil:", meta.subjectProfile, "· trunkerad:", meta.truncated, "· verifierare hoppad:", meta.verifierSkipped);
console.log("grind: släppte", meta.gate.dropped === 0 ? "alla" : meta.gate.dropped + " bortsorterade", "· flaggade", meta.gate.flagged);
console.log("verifierare: kollade", meta.verifier.checked, "godkände", meta.verifier.approved, "underkände", meta.verifier.rejected);
console.log();

exam.questions.forEach((q, i) => {
  console.log(`${i + 1}. [${q.type}·${q.points}p·${q.cognitive_level}] ${String(q.question).replace(/\s+/g, " ").slice(0, 110)}`);
  if (q.type === "mc") console.log(`   alt: ${q.options.length} · rätt: ${String.fromCharCode(65 + q.correct_index)}`);
  console.log(`   ämne: ${q.topic || "—"} · källa: ${(q.source_references || []).join(" | ").slice(0, 80) || "SAKNAS"}`);
});

// ── kontroller på det genererade provet ────────────────────────────────────
const problems = [];
const ids = exam.questions.map(q => String(q.id));
if (new Set(ids).size !== ids.length) problems.push("DUBBLETT-ID i verkligt svar: " + JSON.stringify(ids));
exam.questions.forEach((q, i) => {
  if (!String(q.question || "").trim()) problems.push(`fråga ${i + 1}: tom frågetext`);
  if (!(Number(q.points) > 0)) problems.push(`fråga ${i + 1}: points=${q.points}`);
  if (q.type === "mc") {
    if (!Array.isArray(q.options) || q.options.length < 3) problems.push(`fråga ${i + 1}: ${q.options?.length} alternativ`);
    if (!(q.correct_index >= 0 && q.correct_index < (q.options || []).length)) problems.push(`fråga ${i + 1}: correct_index utanför`);
    const norm = (q.options || []).map(o => String(o).trim().toLowerCase());
    if (new Set(norm).size !== norm.length) problems.push(`fråga ${i + 1}: dubbla alternativ`);
  }
  if (!(q.source_references || []).length) problems.push(`fråga ${i + 1}: saknar source_references (källraden blir tom i UI:t)`);
  if (!String(q.topic || "").trim()) problems.push(`fråga ${i + 1}: saknar topic (täckningskartan tappar den)`);
  if (!String(q.model_answer || "").trim()) problems.push(`fråga ${i + 1}: saknar model_answer`);
});

// ── skarp rättning ─────────────────────────────────────────────────────────
console.log("\n── SKARP RÄTTNING ────────────────────────────────────────────");
// Blandade svar: ett rätt, ett halvbra, ett tomt, resten gissningar.
const answers = exam.questions.map((q, i) => {
  const id = String(q.id);
  if (i === 0) {
    return { id, answer: q.type === "mc" ? String.fromCharCode(65 + q.correct_index) : String(q.model_answer).slice(0, 400) };
  }
  if (i === 1) {
    return { id, answer: q.type === "mc" ? String.fromCharCode(65 + ((q.correct_index + 1) % q.options.length))
      : "Musklerna får för lite syre så cellen går över till jäsning." };
  }
  if (i === 2) return { id, answer: "" };
  return { id, answer: q.type === "mc" ? "A" : "Glukos bryts ner och det bildas ATP i mitokondrien." };
});

const gr = await call(ROOT + "/api/grade.js", {
  lang: "sv", pastedText: MATERIAL, course: "Biologi 1",
  questions: exam.questions, answers
});

console.log("HTTP", gr.status, "·", (gr.ms / 1000).toFixed(1) + "s");
if (!gr.data?.ok) {
  console.log("MISSLYCKADES:", JSON.stringify(gr.data).slice(0, 600));
  problems.push("rättningen misslyckades");
} else {
  const r = gr.data.result;
  console.log("summa:", r.total_points + "/" + r.max_points);
  r.per_question.forEach((it, i) => {
    console.log(`${i + 1}. ${it.points}/${it.max_points} — ${String(it.feedback || "").replace(/\s+/g, " ").slice(0, 100)}`);
  });

  // kontroller på rättningen
  if (r.per_question.length !== exam.questions.length)
    problems.push(`rättningen gav ${r.per_question.length} poster för ${exam.questions.length} frågor`);
  const rIds = r.per_question.map(x => String(x.id));
  if (rIds.join("|") !== ids.join("|"))
    problems.push("rättningens ordning matchar inte provets: " + JSON.stringify(rIds));
  r.per_question.forEach((it, i) => {
    if (!(Number(it.max_points) > 0)) problems.push(`rättning ${i + 1}: max_points=${it.max_points}`);
    if (Number(it.points) < 0 || Number(it.points) > Number(it.max_points))
      problems.push(`rättning ${i + 1}: ${it.points}/${it.max_points} utanför intervallet`);
    if (!String(it.feedback || "").trim()) problems.push(`rättning ${i + 1}: tom feedback`);
    if (!String(it.model_answer || "").trim()) problems.push(`rättning ${i + 1}: tomt modellsvar`);
  });
  const sum = r.per_question.reduce((a, x) => a + Number(x.points || 0), 0);
  if (sum !== Number(r.total_points)) problems.push(`total_points ${r.total_points} != summan ${sum}`);
  const maxSum = r.per_question.reduce((a, x) => a + Number(x.max_points || 0), 0);
  if (maxSum !== Number(r.max_points)) problems.push(`max_points ${r.max_points} != summan ${maxSum}`);
  if (r.per_question[2] && Number(r.per_question[2].points) !== 0)
    problems.push(`tomt svar gav ${r.per_question[2].points} poäng`);

  fs.writeFileSync(OUT + "/live-exam.json",
    JSON.stringify({ exam, result: r, answers, material: MATERIAL }, null, 2));
}

console.log("\n── ANROP ─────────────────────────────────────────────────────");
console.log("OpenAI:", openaiCalls, "· Supabase (fejkade):", supabaseCalls);

console.log("\n── PROBLEM ───────────────────────────────────────────────────");
if (!problems.length) console.log("inga");
else problems.forEach(p => console.log("  • " + p));
process.exit(problems.length ? 1 : 0);
