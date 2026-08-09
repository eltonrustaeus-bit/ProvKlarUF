// src/generation/job-steps.mjs — steg-claim för asynkron provgenerering.
//
// Vad detta löser. api/knowledge.js claimar ETT jobb EN gång: `.eq("status", "queued")` byter
// status till 'generating', och sista raden i samma anrop sätter slutstatus och completed_at.
// Ett andra anrop mot samma job_id får 409. Det räcker för juridiksidan, där ett jobb är en fråga,
// men skolsidans pipeline har fem steg och måste kunna claima samma jobb om och om igen.
//
// Modellen här: STATUS ÄR DET STEG SOM SKA KÖRAS, inte det som är klart.
//
//   queued/generating  generera frågorna från lärarens material
//   validating         deterministisk gate (api/_assessment.js) — ingen API-kostnad
//   verifying          verifierare + oberoende lösare parallellt
//   repairing          gör om de frågor som underkändes (hoppas över om inga gjorde det)
//   assembling         skriv det färdiga provet till result_json
//   completed          klart
//
// Följden är att en worker som kraschar mitt i ett steg lämnar statusen orörd. När leaset går ut
// tar nästa worker samma jobb och kör om exakt samma steg. Inget steg behöver städa efter sig —
// det skriver bara över sin egen del av result_json. Priset är att varje steg måste vara
// idempotent, vilket är billigt att hålla när stegen är rena funktioner av materialet.
//
// Alla statusvärden finns redan i generation_jobs statuscheck sedan Fas 2; migrationen
// 20260807_async_school_generation.sql lägger bara till lease-kolumnerna och SQL-funktionerna.

export const SCHOOL_JOB_TYPE = "school_exam_generation";

// Leaset måste överleva det längsta steget. Generering mäter ~40 s på långa material och
// funktionstaket är 60 s, så 90 s ger marginal utan att ett verkligt kraschat jobb blir stående
// mer än en och en halv minut innan någon annan får ta det.
export const LEASE_SECONDS = 90;

// Per steg, inte per jobb — complete_generation_step() nollställer räknaren vid varje lyckat steg.
// Tre försök täcker transienta 5xx och timeouts från OpenAI; ett steg som misslyckas fyra gånger
// är trasigt på riktigt och ska sluta bränna krediter.
export const MAX_STEP_ATTEMPTS = 3;

export const TERMINAL_STATUSES = ["completed", "partially_completed", "failed", "cancelled"];

// 'generating' är med som synonym till 'queued' eftersom juridikflödet i api/knowledge.js redan
// sätter den statusen när det claimar. Ett jobb som ligger kvar där ska köra generatorn, inte
// betraktas som halvfärdigt på ett sätt bara den koden förstår.
const STEP_BY_STATUS = {
  queued: "generate",
  generating: "generate",
  validating: "validate",
  verifying: "verify",
  repairing: "repair",
  assembling: "assemble",
};

/** Vilket steg workern ska köra givet jobbets status. null = inget att göra. */
export function stepFor(status) {
  return STEP_BY_STATUS[status] ?? null;
}

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Vilken status jobbet ska flyttas till när det nuvarande steget lyckats.
 *
 * Två grenar är villkorade, inte raka:
 *  - efter 'verifying' hoppas 'repairing' över helt när ingen fråga underkändes, så ett rent prov
 *    inte betalar för ett extra funktionsanrop
 *  - 'assembling' avgör slututfallet på antalet frågor som faktiskt överlevde. Noll frågor är ett
 *    misslyckat jobb, inte ett tomt prov — det var precis det utfallet som tidigare nådde eleven
 *    som en 502 när matteoverlayen råkade radera varje fråga.
 */
export function nextStatus(status, counts = {}) {
  const rejected = Number(counts.rejectedCount) || 0;
  const delivered = Number(counts.deliveredCount) || 0;
  const requested = Number(counts.requestedCount) || 0;

  switch (status) {
    case "queued":
    case "generating":
      return "validating";
    case "validating":
      return "verifying";
    case "verifying":
      return rejected > 0 ? "repairing" : "assembling";
    case "repairing":
      return "assembling";
    case "assembling":
      if (delivered <= 0) return "failed";
      return requested > 0 && delivered < requested ? "partially_completed" : "completed";
    default:
      return null;
  }
}

/** true när steget har misslyckats så många gånger att jobbet ska ges upp. */
export function exhaustedAttempts(job) {
  return (Number(job?.step_attempts) || 0) >= MAX_STEP_ATTEMPTS;
}

/**
 * Unik identitet för den här workerinstansen. Skrivs till lease_owner och är det enda som skiljer
 * "jag äger fortfarande jobbet" från "mitt lease gick ut och någon annan har tagit över" när
 * steget väl är klart och ska committas.
 */
export function newWorkerId() {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── RPC-omslag ────────────────────────────────────────────────────────────────
// Tunna med flit: hela samtidighetslogiken ligger i SQL (FOR UPDATE SKIP LOCKED respektive
// WHERE lease_owner = ...), eftersom den bara är korrekt om den är atomisk i databasen. Att
// försöka bygga om den i JS skulle återinföra exakt det SELECT-sedan-UPDATE-race som Fas 6.2
// tog bort ur api/knowledge.js.

/** Tar nästa lediga jobb av given typ. Returnerar jobbraden, eller null om kön är tom. */
export async function claimJob(supabase, { jobType = SCHOOL_JOB_TYPE, workerId, leaseSeconds = LEASE_SECONDS } = {}) {
  const { data, error } = await supabase.rpc("claim_generation_job", {
    p_job_type: jobType,
    p_worker: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`claim_generation_job misslyckades: ${error.message}`);
  return data ?? null;
}

/**
 * Committar ett lyckat steg. Returnerar false när leaset hunnit gå ut och jobbet ägs av någon
 * annan — anroparen ska då KASTA sitt resultat. Att skriva ändå vore att lägga ett gammalt svar
 * ovanpå ett nyare.
 */
export async function completeStep(supabase, { jobId, workerId, status, step = null, progressCurrent = null, result = null }) {
  const { data, error } = await supabase.rpc("complete_generation_step", {
    p_job_id: jobId,
    p_worker: workerId,
    p_next_status: status,
    p_next_step: step,
    p_progress_current: progressCurrent,
    p_result: result,
  });
  if (error) throw new Error(`complete_generation_step misslyckades: ${error.message}`);
  return data === true;
}

/**
 * Rapporterar ett misslyckat steg. terminal=false släpper leaset utan att röra statusen, så nästa
 * claim kör om samma steg; terminal=true sätter 'failed' och avslutar jobbet.
 *
 * `message` måste vara sanerad text — eleven kan läsa sin egen jobbrad via RLS-policyn, så råa
 * DB- eller OpenAI-fel hör inte hemma i den (samma regel som api/knowledge.js:203).
 */
export async function failStep(supabase, { jobId, workerId, errorCode, message, terminal = false }) {
  const { data, error } = await supabase.rpc("fail_generation_step", {
    p_job_id: jobId,
    p_worker: workerId,
    p_error_code: errorCode,
    p_message: message,
    p_terminal: terminal,
  });
  if (error) throw new Error(`fail_generation_step misslyckades: ${error.message}`);
  return data === true;
}
