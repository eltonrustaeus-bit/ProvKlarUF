// End-to-end-rök för P.E.R:s elevloop mot RIKTIG databas och RIKTIG AI.
//
// Kör hela kedjan för en angiven användare: diagnostisk fråga → svar → bedömning → felhändelse →
// mastery → rekommendation → coachning → profil. Verifierar efter varje steg att raderna faktiskt
// hamnade i databasen, och att inget facit läckte ut i svaret.
//
//   node --env-file=.env.local scripts/per-e2e-smoke.mjs <user_uuid> [nivå] [frågetyp]
//
// KRÄVER att supabase/migrations/20260727_per_learner_loop.sql är körd.
// Skriver riktiga rader för den angivna användaren (student_attempts, student_mastery,
// student_error_events, student_recommendations, ai_usage_events, ev. exam_questions).
// Använd ett testkonto — inte en riktig elev.
//
// Anropar orkestratorn direkt (inte via HTTP) så att inga feature flags behöver slås på för att
// köra röken. Flaggorna gäller fortfarande i api/knowledge.js, alltså för riktiga elever.

import { createClient } from "@supabase/supabase-js";
import { runDiagnostic, runAnswer, runCoach, getProfile } from "../src/per/orchestrator.mjs";

const userId = process.argv[2];
const level = process.argv[3] || "E";
const questionType = process.argv[4] || "short_answer";

if (!userId) {
  console.error("Användning: node --env-file=.env.local scripts/per-e2e-smoke.mjs <user_uuid> [E|C|A] [short_answer|multiple_choice]");
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.OPENAI_API_KEY) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY och OPENAI_API_KEY krävs.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
let failures = 0;
const step = (n, text) => console.log(`\n[${n}] ${text}`);
const ok = (text) => console.log(`   ✓ ${text}`);
const bad = (text) => { failures++; console.error(`   ✗ ${text}`); };

// ── 0. Förutsättningar ──────────────────────────────────────────────────────
step(0, "Kontrollerar att migrationen är körd");
{
  const { error } = await supabase.from("student_attempts").select("id").limit(1);
  if (error) {
    console.error(`   ✗ student_attempts saknas (${error.message}). Kör supabase/migrations/20260727_per_learner_loop.sql först.`);
    process.exit(1);
  }
  ok("student_attempts finns");
  const { error: rpcError } = await supabase.rpc("per_consume_daily_quota", { p_user_id: userId, p_feature: "per_assessment", p_limit: 1000 });
  if (rpcError) bad(`per_consume_daily_quota saknas: ${rpcError.message}`);
  else ok("per_consume_daily_quota svarar");
}

// ── 1. Diagnostisk fråga ────────────────────────────────────────────────────
step(1, "Hämtar diagnostisk fråga");
const diagnostic = await runDiagnostic({ supabase, userId, level, questionType });
if (!diagnostic.ok) {
  console.error(`   ✗ misslyckades: ${diagnostic.reason}`);
  process.exit(1);
}
ok(`koncept: ${diagnostic.concept.name}${diagnostic.generated ? " (nygenererad fråga)" : " (återanvänd fråga)"}`);
ok(`motivering: ${diagnostic.why_this}`);
console.log(`   Fråga: ${diagnostic.question.question}`);

// FACITSKYDD — det viktigaste enskilda testet i denna fil.
{
  const serialized = JSON.stringify(diagnostic);
  if (/correct_answer|"explanation"/.test(serialized)) bad("FACIT LÄCKTE i diagnose-svaret");
  else ok("inget facit i svaret till klienten");
  if (!diagnostic.sources?.length) bad("inga källor angavs");
  else ok(`${diagnostic.sources.length} källor: ${diagnostic.sources.map((s) => s.section_ref).join(", ")}`);
}

// ── 2. Svara — medvetet ofullständigt, så att en kunskapslucka uppstår ──────
step(2, "Skickar ett medvetet ofullständigt elevsvar");
const answerText = questionType === "multiple_choice"
  ? [diagnostic.question.options?.[0]?.id ?? "A"]
  : "Jag tror att det handlar om att ett avtal blir bindande, men jag är inte helt säker på hur.";
const idempotencyKey = `smoke:${Date.now()}`;
const answer = await runAnswer({ supabase, userId, questionId: diagnostic.question.id, studentAnswer: answerText, idempotencyKey });
if (!answer.ok) {
  console.error(`   ✗ misslyckades: ${answer.reason}`);
  process.exit(1);
}
ok(`bedömning: score=${answer.feedback.score} metod=${answer.telemetry.assessment_method} säkerhet=${answer.telemetry.confidence}`);
console.log(`   Återkoppling: ${answer.feedback.text}`);
if (answer.feedback.knowledge_gap) ok(`kunskapslucka: ${answer.feedback.knowledge_gap.code} — ${answer.feedback.knowledge_gap.description}`);
else console.log("   (ingen kunskapslucka identifierad — svaret bedömdes som korrekt)");
if (answer.sources?.length) ok(`bedömningen citerar ${answer.sources.length} källor`);
if (/correct_answer|systemprompt|system prompt/i.test(JSON.stringify(answer))) bad("misstänkt läckage i answer-svaret");
else ok("inget facit- eller promptläckage i answer-svaret");

// ── 3. Elevmodellen ska ha rört sig ─────────────────────────────────────────
step(3, "Kontrollerar att elevmodellen uppdaterades");
{
  const { data: attempt } = await supabase.from("student_attempts").select("id, score, assessment_method").eq("user_id", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (!attempt) bad("inget student_attempts skrevs"); else ok(`student_attempts skrivet (${attempt.id})`);

  if (answer.mastery) ok(`student_mastery: ${Math.round(answer.mastery.mastery_score)}/100 efter ${answer.mastery.attempts} försök (säkerhet ${answer.mastery.confidence.toFixed(2)})`);
  else if (answer.mastery_skipped) ok(`mastery medvetet ej uppdaterad: ${answer.mastery_skipped}`);
  else bad("varken mastery eller skäl att hoppa över den");

  if (answer.feedback.knowledge_gap) {
    const { data: events } = await supabase.from("student_error_events").select("id, error_code").eq("user_id", userId).eq("source_attempt_id", attempt?.id);
    if (events?.length) ok(`student_error_events skrivet: ${events[0].error_code}`);
    else bad("kunskapslucka rapporterades men ingen felhändelse skrevs");
  }
}

// ── 4. Idempotens ───────────────────────────────────────────────────────────
step(4, "Skickar EXAKT samma svar igen (idempotenskontroll)");
{
  const repeat = await runAnswer({ supabase, userId, questionId: diagnostic.question.id, studentAnswer: answerText, idempotencyKey });
  if (repeat.duplicate) ok("andra inskicket kändes igen som dubblett — mastery räknades inte om");
  else bad("dubbelskickat svar bokfördes två gånger");

  const { count } = await supabase.from("student_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("idempotency_key", idempotencyKey);
  if (count === 1) ok("exakt en rad i student_attempts");
  else bad(`förväntade 1 rad, hittade ${count}`);

  // Viktigare än dubbelklicksskyddet: en NY nyckel på samma fråga får inte heller ge ett nytt
  // försök. Annars kan eleven prova varje svarsalternativ tills is_correct blir true.
  const retryOtherAnswer = questionType === "multiple_choice"
    ? [diagnostic.question.options?.[1]?.id ?? "B"]
    : "Ett helt annat svar.";
  const second = await runAnswer({ supabase, userId, questionId: diagnostic.question.id, studentAnswer: retryOtherAnswer, idempotencyKey: `smoke:${Date.now()}:andra` });
  if (second.already_answered) ok("nytt försök på samma fråga blockerat — facit kan inte gissas fram");
  else bad("samma fråga kunde besvaras igen med en ny nyckel");

  const { count: totalForQuestion } = await supabase.from("student_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("question_id", diagnostic.question.id);
  if (totalForQuestion === 1) ok("exakt ett försök per fråga i databasen");
  else bad(`förväntade 1 försök på frågan, hittade ${totalForQuestion}`);
}

// ── 5. Rekommendation ───────────────────────────────────────────────────────
step(5, "Kontrollerar det rekommenderade nästa steget");
{
  ok(`åtgärd: ${answer.next_step.action} (nivå ${answer.next_step.target_level})`);
  console.log(`   Motivering: ${answer.next_step.rationale}`);
  if (!answer.next_step.recommendation_id) bad("ingen rekommendation sparades");
  else {
    const { data: rec } = await supabase.from("student_recommendations").select("action, rationale, evidence, status").eq("id", answer.next_step.recommendation_id).single();
    if (rec?.evidence?.rule) ok(`evidens sparad, regel: ${rec.evidence.rule}`);
    else bad("rekommendationen saknar spårbar evidens");
  }
}

// ── 6. Coachning ────────────────────────────────────────────────────────────
step(6, "Hämtar stegvis hjälp (ledtrådsnivå)");
{
  const coach = await runCoach({ supabase, userId, conceptId: diagnostic.concept.id, helpLevel: 0, questionId: diagnostic.question.id });
  if (!coach.ok) bad(`coach misslyckades: ${coach.reason}`);
  else {
    console.log(`   ${coach.message}`);
    if (coach.guiding_question) console.log(`   Motfråga: ${coach.guiding_question}`);
    if (coach.grounded && !coach.sources?.length) bad("källgrundad hjälp utan angivna källor");
    else ok(`hjälp levererad (källgrundad: ${coach.grounded})`);
  }
}

// ── 7. Profil ───────────────────────────────────────────────────────────────
step(7, "Läser elevens kunskapsprofil");
{
  const profile = await getProfile(supabase, userId);
  ok(`${profile.summary.concepts_practiced}/${profile.summary.concepts_total} områden påbörjade, snitt ${profile.summary.average_mastery}/100, ${profile.summary.total_attempts} försök`);
  for (const c of profile.concepts) {
    console.log(`   ${c.attempts ? String(Math.round(c.mastery_score)).padStart(3) : "  –"}  ${c.name}${c.common_errors.length ? "  [" + c.common_errors.join(", ") + "]" : ""}`);
  }
}

// ── 8. Kostnadsspår ─────────────────────────────────────────────────────────
step(8, "Kontrollerar kostnads- och latencyloggning");
{
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: usage } = await supabase.from("ai_usage_events").select("pipeline_step, model, input_tokens, output_tokens, latency_ms").eq("user_id", userId).eq("feature", "per_learner_loop").gte("created_at", since);
  if (!usage?.length) bad("inga ai_usage_events loggades");
  else {
    const tokens = usage.reduce((sum, u) => sum + u.input_tokens + u.output_tokens, 0);
    ok(`${usage.length} AI-anrop loggade, ${tokens} tokens totalt`);
    for (const u of usage) console.log(`   ${u.pipeline_step.padEnd(15)} ${u.model.padEnd(14)} in=${u.input_tokens} ut=${u.output_tokens} ${u.latency_ms}ms`);
    if (tokens === 0) bad("tokens loggades som 0 — usage-objektet lästes inte");
  }
}

console.log(`\n${failures === 0 ? "KLART — hela flödet fungerade." : failures + " kontroller misslyckades."}`);
process.exit(failures === 0 ? 0 : 1);
