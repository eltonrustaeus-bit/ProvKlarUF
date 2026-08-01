// Exam-quality eval — measures what a model swap actually buys.
//
// Runs the REAL production prompt (api/generate-exam.js → buildExamPrompts),
// the REAL structural gate (api/_assessment.js → gateExam) and the REAL
// verifier (api/_verifier.js → verifyQuestions) against a fixed set of course
// materials, then scores the result with an independent judge model.
//
// It deliberately does NOT go through the HTTP endpoint: no account, no quota,
// no deploy, so any generator/verifier model combination can be compared in one
// sitting. The trade-off is that auth, quota and persistence are out of scope
// here — those are covered by the live smoke tests.
//
// Usage:
//   node --env-file=.env.local tests/evals/exam-quality/run-eval.mjs
//   GEN_MODEL=gpt-5-mini VERIFIER_MODEL=gpt-5 node --env-file=.env.local \
//     tests/evals/exam-quality/run-eval.mjs
//
// Env:
//   GEN_MODEL        generator under test          (default gpt-4o-mini = today's production)
//   VERIFIER_MODEL   reviewer under test           (default: same as GEN_MODEL = today's production)
//   JUDGE_MODEL      independent scorer            (default gpt-5)
//   RUNS             repetitions per fixture       (default 2)
//   NUM_QUESTIONS    questions per exam            (default 12)
//   FIXTURES         comma-separated fixture ids   (default: all)
//   CONCURRENCY      parallel generations          (default 3)
//   OUT_DIR          where results land            (default tests/evals/exam-quality/results)

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
// FIXTURE_SET=long swaps in the long-form set: same six subjects, same
// expected profiles, but material at the length of real pasted lesson notes.
// Everything else is held constant so the only variable is how much the
// student pasted.
const FIXTURE_SET = process.env.FIXTURE_SET === "long" ? "./fixtures-long.mjs" : "./fixtures.mjs";
const { FIXTURES } = await import(FIXTURE_SET);

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const A = require(join(root, "api", "_assessment.js"));
const V = require(join(root, "api", "_verifier.js"));
const G = require(join(root, "api", "generate-exam.js"));

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("OPENAI_API_KEY missing. Run with: node --env-file=.env.local <this file>");
  process.exit(1);
}

const GEN_MODEL = process.env.GEN_MODEL || "gpt-4o-mini";
const VERIFIER_MODEL = process.env.VERIFIER_MODEL || GEN_MODEL;
const JUDGE_MODEL = process.env.JUDGE_MODEL || "gpt-5";
const RUNS = Number(process.env.RUNS || 2);
const NUM_QUESTIONS = Number(process.env.NUM_QUESTIONS || 12);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const OUT_DIR = process.env.OUT_DIR || join(here, "results");
const JUDGE_CONFIDENCE_FLOOR = 0.8;

const selected = process.env.FIXTURES
  ? FIXTURES.filter(f => process.env.FIXTURES.split(",").map(s => s.trim()).includes(f.id))
  : FIXTURES;
if (!selected.length) { console.error("No fixtures matched FIXTURES filter."); process.exit(1); }

// USD per 1M tokens, from https://developers.openai.com/api/docs/pricing
// (checked 2026-08-01). Unknown models cost 0 and are reported as such rather
// than silently guessed.
const PRICING = {
  "gpt-4o-mini": { in: 0.15, out: 0.60 },
  "gpt-4o": { in: 2.50, out: 10.00 },
  "gpt-4.1": { in: 2.00, out: 8.00 },
  "gpt-4.1-mini": { in: 0.40, out: 1.60 },
  "gpt-4.1-nano": { in: 0.10, out: 0.40 },
  "gpt-5": { in: 1.25, out: 10.00 },
  "gpt-5-mini": { in: 0.25, out: 2.00 },
  "gpt-5-nano": { in: 0.05, out: 0.40 },
  "gpt-5.1": { in: 1.25, out: 10.00 },
  "gpt-5.2": { in: 1.75, out: 14.00 },
  "gpt-5.4": { in: 2.50, out: 15.00 },
  "gpt-5.5": { in: 5.00, out: 30.00 },
  "o3": { in: 2.00, out: 8.00 },
  "o3-mini": { in: 1.10, out: 4.40 },
  "o4-mini": { in: 1.10, out: 4.40 },
};
const priceOf = (model, usage) => {
  const p = PRICING[model];
  if (!p) return { usd: 0, priced: false };
  return { usd: (usage.in / 1e6) * p.in + (usage.out / 1e6) * p.out, priced: true };
};

const emptyUsage = () => ({ in: 0, out: 0, reasoning: 0 });
const addUsage = (a, b) => { a.in += b.in; a.out += b.out; a.reasoning += b.reasoning; };
function readUsage(data) {
  const u = (data && data.usage) || {};
  return {
    in: Number(u.input_tokens || 0),
    out: Number(u.output_tokens || 0),
    reasoning: Number((u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0),
  };
}
function extractOutputText(data) {
  const out =
    (Array.isArray(data && data.output) &&
      data.output.flatMap(o => (Array.isArray(o && o.content) ? o.content : []))
        .find(c => c && c.type === "output_text") || {}).text ||
    (data && data.output_text) || null;
  return typeof out === "string" ? out : null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// A single flaky connection used to abort the whole run — a 15-minute, paid
// measurement thrown away by one UND_ERR_CONNECT_TIMEOUT. Transient transport
// failures, 429s and 5xx are retried; a 4xx that is not a rate limit is a real
// request problem and returned immediately. Latency is measured on the attempt
// that succeeded, so retries do not inflate the timing numbers.
async function fetchWithRetry(body, timeoutMs, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2000 * i);
    const t0 = Date.now();
    try {
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 429 || r.status >= 500) {
        lastErr = `HTTP ${r.status}`;
        if (i < attempts - 1) continue;
      }
      return { r, latencyMs: Date.now() - t0, retries: i };
    } catch (e) {
      lastErr = String((e && e.cause && e.cause.code) || (e && e.message) || e);
      if (i === attempts - 1) return { r: null, latencyMs: Date.now() - t0, retries: i, transportError: lastErr };
    }
  }
  return { r: null, latencyMs: 0, retries: attempts - 1, transportError: lastErr };
}

async function callResponses({ model, system, user, format, timeoutMs = 180_000 }) {
  const { r, latencyMs, retries, transportError } = await fetchWithRetry(
    JSON.stringify({
      model,
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      text: { format },
    }),
    timeoutMs
  );
  if (!r) {
    return { ok: false, latencyMs, usage: emptyUsage(), retries, error: `transport: ${transportError}` };
  }
  const raw = await r.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* handled below */ }
  if (!r.ok || !data) {
    return { ok: false, latencyMs, usage: emptyUsage(), error: `HTTP ${r.status}: ${raw.slice(0, 300)}` };
  }
  const text = extractOutputText(data);
  if (!text) return { ok: false, latencyMs, usage: readUsage(data), error: "no output_text" };
  let parsed = null;
  let parseError = null;
  try { parsed = JSON.parse(text); } catch (e) { parseError = String(e); }
  // `text` is returned even when it does not parse: the generation path feeds it
  // through the production salvage parser instead of treating it as a failure,
  // which is what api/generate-exam.js does since the deadline work. Without
  // this the eval reported a hard failure where production would have shipped a
  // shortened exam, understating how robust the endpoint actually is.
  return { ok: parsed !== null, latencyMs, usage: readUsage(data), parsed, text, parseError,
           error: parseError ? `unparseable JSON: ${parseError}` : null };
}

// ── Independent judge ───────────────────────────────────────────────────────
// Re-solves each MC item from the material + stem + options ONLY. It never sees
// correct_index, model_answer or source_references, so agreement is genuinely
// independent rather than a rubber stamp. Confidence is reported so that a
// disagreement on an interpretive item can be separated from a hard one — only
// disagreements at or above JUDGE_CONFIDENCE_FLOOR are counted as key errors,
// and every disagreement is written out for a human to read.
function judgeSchema(n) {
  return {
    type: "json_schema", name: "exam_judge", strict: true,
    schema: {
      type: "object", additionalProperties: false, required: ["results"],
      properties: {
        results: {
          type: "array", minItems: n, maxItems: n,
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "index", "confidence", "reason"],
            properties: {
              id: { type: "string" },
              index: { type: "integer", minimum: -1 },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  };
}

const JUDGE_SYSTEM =
  "Du är en oberoende ämnesexpert. Du får kursmaterialet och ett antal flervalsfrågor. " +
  "Du får INTE se något facit. Lös varje fråga själv utifrån materialet och din egen ämneskunskap. " +
  "Returnera det 0-baserade indexet för det alternativ du anser vara korrekt. " +
  "Räkna igenom beräkningar noga och spåra igenom eventuell kod rad för rad. " +
  "confidence: 1.0 när svaret är entydigt bestämbart, lägre när frågan är tolkningsbar. " +
  "Returnera index -1 om ingen av alternativen är korrekt, eller om fler än ett är lika korrekt. " +
  "reason: en mening om varför.";

async function judgeQuestions(questions, material) {
  const mcs = questions.filter(q => q.type === "mc" && Array.isArray(q.options) && q.options.length >= 2);
  if (!mcs.length) return { ok: true, verdicts: new Map(), usage: emptyUsage(), latencyMs: 0, judged: 0 };
  const payload = mcs.map(q => ({ id: String(q.id), question: q.question, options: q.options }));
  const res = await callResponses({
    model: JUDGE_MODEL,
    system: JUDGE_SYSTEM,
    user: `Material:\n${material}\n\nFrågor:\n${JSON.stringify(payload)}`,
    format: judgeSchema(mcs.length),
  });
  if (!res.ok) return { ok: false, verdicts: new Map(), usage: res.usage, latencyMs: res.latencyMs, judged: 0, error: res.error };
  const verdicts = new Map();
  for (const r of (res.parsed.results || [])) verdicts.set(String(r.id), r);
  return { ok: true, verdicts, usage: res.usage, latencyMs: res.latencyMs, judged: mcs.length };
}

// ── One generation → gate → verify → judge cycle ────────────────────────────
async function runOnce(fixture, runIndex) {
  const rec = {
    fixture: fixture.id, run: runIndex, course: fixture.course,
    profile: null, profileAsExpected: null, isMath: null, isMathAsExpected: null,
    requested: NUM_QUESTIONS, generated: 0, afterGate: 0, delivered: 0, truncated: false,
    structurallyDropped: [], flagged: [],
    verifierCallOk: false, verifierApproved: 0, verifierRejected: 0,
    judgeCallOk: false, judged: 0, judgeAgreed: 0, keyErrors: 0, ambiguous: 0, lowConfidenceDisagreements: 0,
    disagreements: [],
    latency: { generateMs: 0, verifyMs: 0, judgeMs: 0 },
    usage: { generator: emptyUsage(), verifier: emptyUsage(), judge: emptyUsage() },
    errors: [],
  };

  const profile = A.detectSubjectProfile(fixture.course, fixture.material);
  const isMath = G.looksLikeMath(fixture.course, fixture.material);
  rec.profile = profile;
  rec.profileAsExpected = profile === fixture.expectProfile;
  rec.isMath = isMath;
  rec.isMathAsExpected = isMath === fixture.expectMath;

  const { systemPrompt, userPrompt } = G.buildExamPrompts({
    lang: "sv", level: fixture.level, course: fixture.course, qType: "mc",
    numQuestions: NUM_QUESTIONS, pastedText: fixture.material, isMath,
  });

  const gen = await callResponses({
    model: GEN_MODEL, system: systemPrompt, user: userPrompt,
    format: G.buildMockExamSchema(NUM_QUESTIONS),
  });
  rec.latency.generateMs = gen.latencyMs;
  rec.usage.generator = gen.usage;
  if (!gen.text) { rec.errors.push(`generate: ${gen.error || "no output"}`); return rec; }

  // Same parser production uses, so a ragged response is measured the way a
  // student would actually experience it: a shorter exam, not an error.
  const salvage = G.salvageExamJson(gen.text);
  const exam = salvage.exam;
  rec.truncated = salvage.truncated;
  if (!exam) { rec.errors.push(`generate: nothing salvageable (${gen.error || "truncated"})`); return rec; }
  if (salvage.truncated) rec.errors.push("räddat partiellt svar (produktionen hade levererat förkortat prov)");
  rec.generated = Array.isArray(exam.questions) ? exam.questions.length : 0;

  const gate = A.gateExam(exam, { profile, secret: "eval-secret" });
  rec.afterGate = gate.questions.length;
  rec.structurallyDropped = gate.dropped;
  rec.flagged = gate.flagged;

  // Verifier under test. verifyQuestions() reads OPENAI_VERIFIER_MODEL, which is
  // exactly the production knob this eval exists to evaluate.
  const prevVerifierEnv = process.env.OPENAI_VERIFIER_MODEL;
  process.env.OPENAI_VERIFIER_MODEL = VERIFIER_MODEL;
  const tVerify = Date.now();
  const v = await V.verifyQuestions(gate.questions, { apiKey: API_KEY, model: GEN_MODEL, subjectProfile: profile, lang: "sv" });
  rec.latency.verifyMs = Date.now() - tVerify;
  if (prevVerifierEnv === undefined) delete process.env.OPENAI_VERIFIER_MODEL;
  else process.env.OPENAI_VERIFIER_MODEL = prevVerifierEnv;

  rec.verifierCallOk = v.callOk;
  const approved = [];
  if (v.callOk) {
    for (const q of gate.questions) {
      const r = v.perQuestion.get(String(q.id));
      if (r && V.decideApproval(r)) { approved.push(q); rec.verifierApproved++; }
      else rec.verifierRejected++;
    }
  } else {
    rec.errors.push("verifier call failed (fail-open: all gated questions ship)");
    approved.push(...gate.questions);
  }
  rec.delivered = approved.length;

  // Judge the questions that would actually reach a student.
  const j = await judgeQuestions(approved, fixture.material);
  rec.latency.judgeMs = j.latencyMs;
  rec.usage.judge = j.usage;
  rec.judgeCallOk = j.ok;
  rec.judged = j.judged;
  if (!j.ok) { rec.errors.push(`judge: ${j.error}`); return rec; }

  for (const q of approved) {
    if (q.type !== "mc") continue;
    const verdict = j.verdicts.get(String(q.id));
    if (!verdict) continue;
    if (verdict.index === q.correct_index) { rec.judgeAgreed++; continue; }
    const entry = {
      fixture: fixture.id, run: runIndex, id: String(q.id),
      question: q.question, options: q.options,
      examKey: q.correct_index, judgeKey: verdict.index,
      confidence: verdict.confidence, judgeReason: verdict.reason,
      modelAnswer: q.model_answer,
    };
    rec.disagreements.push(entry);
    // Three distinct outcomes, and conflating them undercounted defects badly.
    //
    // index === -1 means the judge is saying "no single option is correct" —
    // either none of them works, or several are equally right. It reports LOW
    // confidence there because it cannot pick one, not because it doubts the
    // question is broken. Gating that behind JUDGE_CONFIDENCE_FLOOR hid the
    // dominant defect: on the long-form fixtures 9 of 12 disagreements were
    // this shape and none of them counted. An ambiguous question is a defect
    // whatever the judge's confidence, so it is counted on its own.
    if (verdict.index === -1) rec.ambiguous++;
    else if (Number(verdict.confidence) >= JUDGE_CONFIDENCE_FLOOR) rec.keyErrors++;
    else rec.lowConfidenceDisagreements++;
  }

  // The verifier's own usage isn't returned by verifyQuestions(); attribute it
  // from the token counts we can see. Left at zero rather than estimated, and
  // called out in the summary so the cost figure is never silently wrong.
  return rec;
}

async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

const pct = (n, d) => (d > 0 ? (100 * n / d) : 0);
const fmtPct = (n, d) => `${pct(n, d).toFixed(1)}%`;
function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

async function main() {
  const jobs = [];
  for (const f of selected) for (let r = 1; r <= RUNS; r++) jobs.push({ f, r });

  console.log(`Exam-quality eval`);
  console.log(`  generator : ${GEN_MODEL}${PRICING[GEN_MODEL] ? "" : "  (unpriced — cost will read 0)"}`);
  console.log(`  verifier  : ${VERIFIER_MODEL}${VERIFIER_MODEL === GEN_MODEL ? "  (same as generator — today's production)" : ""}`);
  console.log(`  judge     : ${JUDGE_MODEL}`);
  console.log(`  fixtures  : ${selected.map(f => f.id).join(", ")}`);
  console.log(`  runs      : ${RUNS} x ${selected.length} = ${jobs.length} exams of ${NUM_QUESTIONS} questions\n`);

  const t0 = Date.now();
  const records = await pool(jobs, CONCURRENCY, async ({ f, r }) => {
    // One fixture blowing up must not discard the whole paid run.
    let rec;
    try {
      rec = await runOnce(f, r);
    } catch (e) {
      console.log(`  ${f.id.padEnd(18)} run ${r}  KRASCHADE: ${String(e)}`);
      return {
        fixture: f.id, run: r, course: f.course, profile: null,
        profileAsExpected: true, isMathAsExpected: true,
        requested: NUM_QUESTIONS, generated: 0, afterGate: 0, delivered: 0,
        structurallyDropped: [], flagged: [],
        verifierCallOk: false, verifierApproved: 0, verifierRejected: 0,
        judgeCallOk: false, judged: 0, judgeAgreed: 0, keyErrors: 0, ambiguous: 0,
        lowConfidenceDisagreements: 0, disagreements: [],
        latency: { generateMs: 0, verifyMs: 0, judgeMs: 0 },
        usage: { generator: emptyUsage(), verifier: emptyUsage(), judge: emptyUsage() },
        errors: [`crashed: ${String(e)}`],
      };
    }
    const defects = rec.keyErrors + rec.ambiguous;
    const keyRate = rec.judged ? fmtPct(defects, rec.judged) : "n/a";
    console.log(
      `  ${rec.fixture.padEnd(18)} run ${r}  ` +
      `levererat ${String(rec.delivered).padStart(2)}/${rec.requested}  ` +
      `granskare avslog ${String(rec.verifierRejected).padStart(2)}  ` +
      `defekta ${String(defects).padStart(2)}/${String(rec.judged).padStart(2)} (${keyRate})` +
      (rec.errors.length ? `  [${rec.errors.join("; ")}]` : "")
    );
    return rec;
  });
  const wallMs = Date.now() - t0;

  // ── Aggregate ────────────────────────────────────────────────────────────
  const sum = (fn) => records.reduce((n, r) => n + fn(r), 0);
  const totals = {
    exams: records.length,
    requested: sum(r => r.requested),
    generated: sum(r => r.generated),
    afterGate: sum(r => r.afterGate),
    delivered: sum(r => r.delivered),
    verifierRejected: sum(r => r.verifierRejected),
    judged: sum(r => r.judged),
    keyErrors: sum(r => r.keyErrors),
    ambiguous: sum(r => r.ambiguous),
    lowConfidenceDisagreements: sum(r => r.lowConfidenceDisagreements),
  };
  const genUsage = emptyUsage(); const judgeUsage = emptyUsage();
  for (const r of records) { addUsage(genUsage, r.usage.generator); addUsage(judgeUsage, r.usage.judge); }
  const genCost = priceOf(GEN_MODEL, genUsage);

  const flagCounts = {};
  const dropCounts = {};
  for (const r of records) {
    for (const f of r.flagged) for (const i of f.issues) flagCounts[i] = (flagCounts[i] || 0) + 1;
    for (const d of r.structurallyDropped) for (const i of d.issues) dropCounts[i] = (dropCounts[i] || 0) + 1;
  }

  const perFixture = selected.map(f => {
    const rs = records.filter(r => r.fixture === f.id);
    const judged = rs.reduce((n, r) => n + r.judged, 0);
    const keyErrors = rs.reduce((n, r) => n + r.keyErrors, 0);
    const ambiguous = rs.reduce((n, r) => n + r.ambiguous, 0);
    return {
      id: f.id,
      profile: rs[0] ? rs[0].profile : null,
      profileAsExpected: rs.every(r => r.profileAsExpected),
      isMathAsExpected: rs.every(r => r.isMathAsExpected),
      delivered: rs.reduce((n, r) => n + r.delivered, 0),
      requested: rs.reduce((n, r) => n + r.requested, 0),
      verifierRejected: rs.reduce((n, r) => n + r.verifierRejected, 0),
      judged, keyErrors, ambiguous,
      defects: keyErrors + ambiguous,
      defectRate: pct(keyErrors + ambiguous, judged),
    };
  });

  const genLatencies = records.map(r => r.latency.generateMs);
  const disagreements = records.flatMap(r => r.disagreements);

  console.log(`\n── Resultat ──────────────────────────────────────────────`);
  console.log(`  Levererat / begärt        ${totals.delivered}/${totals.requested}  (${fmtPct(totals.delivered, totals.requested)})`);
  console.log(`  Struktur-grinden kastade  ${totals.generated - totals.afterGate}`);
  console.log(`  Granskaren avslog         ${totals.verifierRejected}`);
  const defects = totals.keyErrors + totals.ambiguous;
  console.log(`  DEFEKTA FRÅGOR            ${defects}/${totals.judged}  (${fmtPct(defects, totals.judged)})   <-- huvudmåttet`);
  console.log(`    varav fel facit         ${totals.keyErrors}  (domaren valde ett annat alternativ, hög konfidens)`);
  console.log(`    varav flertydiga        ${totals.ambiguous}  (inget ENTYDIGT rätt alternativ — flera stämmer, eller inget)`);
  console.log(`  Oense, låg konfidens      ${totals.lowConfidenceDisagreements}  (granska för hand, ej räknat som defekt)`);
  console.log(`  Genereringslatens         p50 ${percentile(genLatencies, 0.5)} ms   p95 ${percentile(genLatencies, 0.95)} ms`);
  if (percentile(genLatencies, 0.95) > 45_000) {
    console.log(`  ** VARNING: p95 över produktionens 45 s timeout i generate-exam.js **`);
  }
  console.log(`  Generatortokens           in ${genUsage.in}  ut ${genUsage.out}  (varav resonemang ${genUsage.reasoning})`);
  console.log(`  Generatorkostnad          ${genCost.priced ? `$${genCost.usd.toFixed(4)} för ${totals.exams} prov  =  $${(genCost.usd / totals.exams).toFixed(4)}/prov` : "okänt pris för modellen"}`);
  console.log(`  Domarens tokens           in ${judgeUsage.in}  ut ${judgeUsage.out}  (mätkostnad, ej produktionskostnad)`);
  console.log(`  Not: verifierarens tokenförbrukning mäts inte här — verifyQuestions() returnerar den inte.`);

  console.log(`\n  Per ämne:`);
  for (const p of perFixture) {
    const warn = p.profileAsExpected && p.isMathAsExpected ? "" : "  ** FEL PROFIL/MATTE-DETEKTERING **";
    console.log(
      `    ${p.id.padEnd(18)} ${String(p.profile).padEnd(17)} ` +
      `levererat ${p.delivered}/${p.requested}  avslag ${String(p.verifierRejected).padStart(2)}  ` +
      `defekta ${p.defects}/${p.judged} (${p.defectRate.toFixed(1)}%)  [fel facit ${p.keyErrors}, flertydiga ${p.ambiguous}]${warn}`
    );
  }

  if (Object.keys(dropCounts).length) {
    console.log(`\n  Kastade av struktur-grinden:`);
    for (const [k, v] of Object.entries(dropCounts).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}  ${k}`);
  }
  if (Object.keys(flagCounts).length) {
    console.log(`\n  Flaggade (ej kastade):`);
    for (const [k, v] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}  ${k}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tag = `${GEN_MODEL}__verify-${VERIFIER_MODEL}`;
  const resultPath = join(OUT_DIR, `${stamp}__${tag}.json`);
  writeFileSync(resultPath, JSON.stringify({
    config: { GEN_MODEL, VERIFIER_MODEL, JUDGE_MODEL, RUNS, NUM_QUESTIONS, fixtures: selected.map(f => f.id), judgeConfidenceFloor: JUDGE_CONFIDENCE_FLOOR },
    wallMs, totals, perFixture, dropCounts, flagCounts,
    usage: { generator: genUsage, judge: judgeUsage },
    cost: { generatorUsd: genCost.priced ? genCost.usd : null },
    latency: { generateP50Ms: percentile(genLatencies, 0.5), generateP95Ms: percentile(genLatencies, 0.95) },
    records,
  }, null, 2));

  const disagreePath = join(OUT_DIR, `${stamp}__${tag}__disagreements.json`);
  writeFileSync(disagreePath, JSON.stringify(disagreements, null, 2));

  console.log(`\n  Resultat : ${resultPath}`);
  console.log(`  Oenighet : ${disagreePath}  (${disagreements.length} fall — läs dem innan du drar slutsatser)`);
  console.log(`  Väggtid  : ${(wallMs / 1000).toFixed(1)} s\n`);

  const misrouted = perFixture.filter(p => !p.profileAsExpected || !p.isMathAsExpected);
  if (misrouted.length) {
    console.error(`FEL: ${misrouted.length} fixture(s) routades till fel ämnesprofil — mätningen gäller då fel regeluppsättning.`);
    console.error("Kör tests/evals/exam-quality/check-detection.mjs för diagnos (gratis, offline).");
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
