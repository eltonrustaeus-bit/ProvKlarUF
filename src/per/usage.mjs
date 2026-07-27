// src/per/usage.mjs — kostnads-, token- och latencyloggning för P.E.R:s elevloop.
//
// Skillnad mot logUsage() i src/generation/legal-generation.mjs (som loggar 0 tokens överallt):
// här läses OpenAI-svarets faktiska usage-objekt via callAIRaw() i api/_per-core.js. Tokens är
// alltså UPPMÄTTA, inte uppskattade.
//
// estimated_cost lämnas NULL tills config/model-pricing.json är ifylld och verified=true.
// docs/provia-knowledge-engine/05-cost-baseline.md är uttrycklig: priser får inte hämtas ur en
// AI-modells minne. Ett påhittat pris är värre än inget pris — det ser ut som mätdata.
//
// SÄKERHET: ai_usage_events får ALDRIG innehålla elevsvar eller frågetext. Den här modulen tar
// inte emot sådana fält, så det kan inte hända av misstag.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let pricingCache;
function pricing() {
  if (pricingCache !== undefined) return pricingCache;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    pricingCache = JSON.parse(readFileSync(join(here, "..", "..", "config", "model-pricing.json"), "utf8"));
  } catch {
    pricingCache = null;
  }
  return pricingCache;
}

/** Exporterad för test — nollställer cachen mellan fall. */
export function resetPricingCache() {
  pricingCache = undefined;
}

/**
 * @returns {number|null} uppskattad kostnad i USD, eller null när prislistan inte är verifierad.
 */
export function estimateCost({ model, inputTokens = 0, cachedInputTokens = 0, outputTokens = 0 }) {
  const p = pricing();
  if (!p || p.verified !== true) return null;
  const rates = p.models?.[model];
  if (!rates) return null;
  const { usd_per_1m_input: inRate, usd_per_1m_cached_input: cachedRate, usd_per_1m_output: outRate } = rates;
  if (inRate === null || inRate === undefined || outRate === null || outRate === undefined) return null;
  const uncached = Math.max(0, inputTokens - cachedInputTokens);
  const cachedCost = ((cachedRate ?? inRate) * cachedInputTokens) / 1_000_000;
  return (inRate * uncached) / 1_000_000 + cachedCost + (outRate * outputTokens) / 1_000_000;
}

/** Normaliserar OpenAI:s usage-objekt (fältnamnen skiljer sig mellan API-ytor). */
export function normalizeUsage(usage) {
  if (!usage) return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
  };
}

/**
 * Loggar ett AI-anrop. Får aldrig kasta — kostnadsloggning ska inte kunna sänka elevflödet
 * (samma fail-open-princip som resten av kodbasen).
 */
export async function logUsage(supabase, {
  jobId, userId, feature, pipelineStep, subject, course, model, usage,
  latencyMs = 0, retrievedChunks, retryCount = 0, verificationPassed, promptVersion, pipelineVersion,
  subscriptionTier,
}) {
  if (!supabase) return;
  try {
    const t = normalizeUsage(usage);
    await supabase.from("ai_usage_events").insert({
      job_id: jobId ?? null,
      user_id: userId ?? null,
      subscription_tier: subscriptionTier ?? null,
      feature,
      pipeline_step: pipelineStep,
      subject: subject ?? null,
      course: course ?? null,
      provider: "openai",
      model,
      prompt_version: promptVersion ?? null,
      pipeline_version: pipelineVersion ?? null,
      input_tokens: t.inputTokens,
      cached_input_tokens: t.cachedInputTokens,
      output_tokens: t.outputTokens,
      retrieved_chunks: retrievedChunks ?? null,
      latency_ms: Math.max(0, Math.round(latencyMs)),
      retry_count: retryCount,
      verification_passed: verificationPassed ?? null,
      estimated_cost: estimateCost({ model, ...t }),
    });
  } catch {
    /* aldrig blockera elevflödet på loggning */
  }
}
