
// /api/generate-exam.js
// Innehåll:
// - Tillåter 3–20 frågor
// - Kräver inloggning (requireAuth) + mockprovskvot (consumeMockExamQuota, atomär RPC)
// - Tar bort essä helt (endast: mc, short)
// - JSON-schema som aldrig tillåter "essay"

const assessment = require("./_assessment");

function cognitiveVerbHint(lang) {
  const v = assessment.COGNITIVE_VERBS;
  return lang === "sv"
    ? `Nivå E ska kräva: ${v.E.slice(0, 5).join(", ")}. ` +
      `Nivå C ska kräva: ${v.C.slice(0, 5).join(", ")}. ` +
      `Nivå A ska kräva: ${v.A.slice(0, 5).join(", ")}. ` +
      "Svårighetsgraden ska ändra VAD eleven måste göra, inte bara ordvalet."
    : `Level E must require: ${v.E.slice(0, 5).join(", ")}. ` +
      `Level C must require: ${v.C.slice(0, 5).join(", ")}. ` +
      `Level A must require: ${v.A.slice(0, 5).join(", ")}. ` +
      "The difficulty level must change WHAT the student has to do, not just the wording.";
}

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

// Maths detection lives in _assessment.js and is shared with the gate. It used
// to be duplicated here, and the two copies could disagree: this file decided
// MATH MODE while _assessment.js decided which overlay to gate with. The old
// rule also fired on a single word — "97 procent av befolkningen" put a
// Historia 1b exam into MATH MODE ("70–80 % beräkning och problemlösning"),
// and a lone "=" anywhere plus any word containing x, y or z did the same to
// Företagsekonomi. One detector, one answer.
function looksLikeMath(course, pastedText) {
  return assessment.detectSubjectProfile(course, pastedText) === "mathematics";
}

function pickModel({ isMath }) {
  const base = process.env.OPENAI_MODEL || "gpt-4o-mini";
  // OPENAI_MATH_MODEL is the canonical name (matches api/hp.js). OPENAI_MODEL_MATH
  // kept as a fallback in case it was ever set in an env this repo can't see.
  const math = process.env.OPENAI_MATH_MODEL || process.env.OPENAI_MODEL_MATH || base;
  return isMath ? math : base;
}

function buildMockExamSchema(numQuestions) {
  return {
    type: "json_schema",
    name: "mock_exam_schema",
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
          minItems: numQuestions,
          maxItems: numQuestions,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id", "type", "points", "question", "options", "correct_index",
              "rubric", "model_answer",
              "topic", "subtopic", "learning_objective", "source_references",
              "cognitive_level", "accepted_answers", "estimated_answer_length",
              "scoring_rubric"
            ],
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["mc", "short"] },
              points: { type: "number" },
              question: { type: "string" },
              options: { type: "array", items: { type: "string" }, maxItems: 6 },
              correct_index: { type: "integer" },
              rubric: { type: "string" },
              model_answer: { type: "string" },
              topic: { type: "string" },
              subtopic: { type: "string" },
              learning_objective: { type: "string" },
              source_references: { type: "array", items: { type: "string" }, maxItems: 5 },
              cognitive_level: { type: "string", enum: ["minnas", "förstå", "tillämpa", "analysera", "värdera"] },
              accepted_answers: { type: "array", items: { type: "string" }, maxItems: 5 },
              estimated_answer_length: { type: "string", enum: ["none", "one_word", "one_sentence", "short_paragraph", "long_paragraph"] },
              // additionalProperties:false on a strict schema means this object must
              // always be present; for "mc" questions the model sends an empty-parts
              // shape and _assessment.js's gate only enforces shape for type==="short".
              scoring_rubric: {
                type: "object",
                additionalProperties: false,
                required: ["parts", "full_score_requirements", "partial_credit_notes"],
                properties: {
                  parts: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["description", "points"],
                      properties: { description: { type: "string" }, points: { type: "number" } }
                    }
                  },
                  full_score_requirements: { type: "string" },
                  partial_credit_notes: { type: "string" }
                }
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
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
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

async function loadCentralRules() {
  const m = await import("./_provia-rules.js");
  // This file is CJS and dynamically imports the ESM rules module. After
  // Vercel's ESM→CJS compile the named exports aren't reliably exposed on the
  // namespace, so `m.normalizeRole` can be undefined — fall back to default.
  return (m && typeof m.normalizeRole === "function") ? m : (m.default || m);
}

async function loadUserRole(userId) {
  try {
    const r = await fetch(
      process.env.SUPABASE_URL + "/rest/v1/profiles?select=role&id=eq." + encodeURIComponent(userId),
      {
        headers: {
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!r.ok) return "gratis";
    const data = await r.json();
    return String(data?.[0]?.role || "gratis");
  } catch {
    return "gratis";
  }
}

async function consumeMockExamQuota(userId, limit, rules) {
  if (limit.cap === Infinity) {
    return {
      ok: true,
      count: 0,
      limit: null,
      period: limit.period,
      unlimited: true,
      enforced: true
    };
  }

  const periodKey = rules.currentPeriodKey(limit.period);
  const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/rpc/consume_mock_exam_quota", {
    method: "POST",
    headers: {
      "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_period_key: periodKey,
      p_limit: limit.cap
    }),
    signal: AbortSignal.timeout(5000)
  });

  const raw = await r.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

  if (!r.ok) {
    const err = new Error("Mock quota schema or RPC failed");
    err.status = r.status;
    err.details = data || raw;
    throw err;
  }

  return {
    ok: data?.ok === true,
    count: Number(data?.count || 0),
    limit: data?.limit ?? limit.cap,
    period: data?.period || periodKey,
    unlimited: data?.unlimited === true,
    enforced: true
  };
}

// Prompt construction, extracted from the handler so it can be exercised
// without an HTTP request, an account or a quota — tests/evals/exam-quality
// runs the REAL production prompts against different models. Pure: no I/O,
// no env reads, output depends only on the arguments.
// ── Request time budget ─────────────────────────────────────────────────────
// vercel.json pins this function to maxDuration 60, which is also the hard
// ceiling on the Hobby plan — it cannot be raised without moving to Pro. The
// old code budgeted 45 s for generation, 30 s for the verifier, then possibly
// another 45 s + 30 s for a regeneration round: 150 s of timeouts inside a 60 s
// function. Anything past 60 s is killed by the platform, so the AbortSignals
// could never fire and the student got a platform 504 instead of an exam.
//
// Measured (12 questions, gpt-4o-mini, serial): 25, 27, 29, 30, 32, 33, 38, 47,
// 67, 70, 70, 82 seconds. The spread is OpenAI-side variance, not payload size —
// throughput ranged 35-111 tokens/s on near-identical outputs, and splitting
// into two parallel half-exams measured 0.97x, i.e. no gain.
//
// So the budget is enforced here instead: one deadline for the whole request,
// every downstream call bounded by what is actually left, and generation
// streamed so that hitting the deadline yields the questions completed so far
// rather than nothing.
// ── FÖRSÖKT OCH FÖRKASTAT: strömma frågorna till eleven (2026-08-07) ────────
//
// Idén var att granska i satser MEDAN genereringen pågår, så att granskningens
// väggtid försvinner in i genereringens väntan och eleven får fråga ett efter
// tio sekunder i stället för efter femtio. Den byggdes, mättes och togs bort.
//
// Vad som stämde: OpenAI-strömmen trickar fint. Första delta efter 1,0 s och
// hela frågor klara vid 4,3 · 8,6 · 11,4 · 15,3 s och framåt, mätt på tolv
// frågor mot Biologi 1.
//
// Vad som sänkte den: ett samtidigt anrop till api.openai.com köas bakom den
// öppna strömmen på samma anslutning. Det första granskningsanropet mättes till
// 30,1 s respektive 51,3 s i stället för 1,0 s, och släpptes först när strömmen
// tog slut — anrop två och tre därefter tog 1,1 och 1,4 s. Att förvärma poolen
// med två extra anslutningar före strömmen ändrade ingenting.
//
// Följden blev sämre än utgångsläget på varje mått: 43 % levererade frågor mot
// 78 %, och 62,3 s total tid mot ett tak på 60. Även den avskalade varianten,
// där bara förloppet strömmades och kvalitetskedjan låg kvar orörd efteråt,
// gav 53 % och en första fråga efter 48 s — eftersom en fråga inte får visas
// innan granskaren och lösaren har sagt sitt.
//
// Väntetiden domineras alltså av generering (~40 s) plus granskning (~10 s),
// båda seriella av nödvändighet. Vill någon ta upp tråden igen måste
// anslutningsköandet lösas först, sannolikt med en egen undici-dispatcher per
// anrop, och beteendet verifieras på Vercel och inte bara lokalt. De riktiga
// vägarna runt 60-sekundersgränsen är fortfarande högre maxDuration eller
// generering i förväg till en frågebank.
const FUNCTION_BUDGET_MS = 60_000;      // must match vercel.json maxDuration
const RESPONSE_RESERVE_MS = 3_000;      // serialising and returning the response
// Reserved for the verifier and the solver, which run concurrently. Measured
// together on the long-form fixtures: 10.8-20.3 s, against 6-19 s for the
// verifier alone — the solver adds only a few seconds because it runs in
// parallel, but the ceiling moved, so the reserve has to move with it. A
// generation that gets squeezed by this degrades into a shortened exam via the
// salvage path, which is much better than the function being killed outright.
const VERIFIER_RESERVE_MS = 21_000;
const MIN_VERIFIER_MS = 8_000;          // below this, skip verification entirely
const MIN_GENERATION_MS = 15_000;       // below this, do not start a generation

function makeBudget(startedAt) {
  const deadline = startedAt + FUNCTION_BUDGET_MS - RESPONSE_RESERVE_MS;
  return {
    startedAt,
    deadline,
    remaining: () => deadline - Date.now(),
    elapsed: () => Date.now() - startedAt,
  };
}

// Turns a truncated structured-output stream into the largest valid exam it
// contains. Walks the raw text tracking string/escape state so a brace inside a
// question's text cannot be mistaken for structure, remembers every point where
// an element of the questions array closed, cuts at the last one, and then
// closes whatever containers are still open.
//
// Exported and pure so it can be tested without touching the network.
function salvageExamJson(text) {
  const raw = String(text || "");
  try {
    const exam = JSON.parse(raw);
    return { exam, truncated: false };
  } catch { /* fall through to salvage */ }

  const stack = [];
  let inString = false, escaped = false;
  let questionsDepth = -1;
  let lastCompleteQuestionEnd = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      // The array opened immediately after the "questions" key is the one whose
      // elements we can salvage.
      if (ch === "[" && questionsDepth === -1 && /"questions"\s*:\s*$/.test(raw.slice(Math.max(0, i - 40), i))) {
        questionsDepth = stack.length;
      }
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      if (ch === "}" && questionsDepth !== -1 && stack.length === questionsDepth) {
        lastCompleteQuestionEnd = i + 1;
      }
    }
  }

  if (lastCompleteQuestionEnd < 0) return { exam: null, truncated: true };

  // Recompute the open containers as of the cut point, then close them.
  const head = raw.slice(0, lastCompleteQuestionEnd);
  const open = [];
  inString = false; escaped = false;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") open.push(ch);
    else if (ch === "}" || ch === "]") open.pop();
  }
  const closers = open.reverse().map(c => (c === "{" ? "}" : "]")).join("");

  try {
    const exam = JSON.parse(head + closers);
    if (!exam || !Array.isArray(exam.questions) || exam.questions.length === 0) {
      return { exam: null, truncated: true };
    }
    return { exam, truncated: true };
  } catch {
    return { exam: null, truncated: true };
  }
}

// Streams a generation and stops at `budgetMs`, keeping whatever has arrived.
// Returns the accumulated text plus whether the stream was cut short; parsing
// and salvage are left to salvageExamJson so this stays a transport concern.
async function streamGeneration({ apiKey, payload, budgetMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, budgetMs));
  const t0 = Date.now();
  let text = "";
  let cutShort = false;
  let usage = null;

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      clearTimeout(timer);
      return { ok: false, status: r.status, details: body.slice(0, 500), latencyMs: Date.now() - t0 };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of r.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data: ")) continue;
          const payloadLine = line.slice(6);
          if (payloadLine === "[DONE]") continue;
          let ev;
          try { ev = JSON.parse(payloadLine); } catch { continue; }
          if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
          else if (ev.type === "response.completed" && ev.response && ev.response.usage) usage = ev.response.usage;
        }
      }
    } catch (e) {
      // Abort mid-stream is the expected deadline path, not an error: whatever
      // arrived before the cut is still usable.
      if (e && (e.name === "AbortError" || controller.signal.aborted)) cutShort = true;
      else throw e;
    }
  } catch (e) {
    clearTimeout(timer);
    if (e && (e.name === "AbortError" || controller.signal.aborted)) {
      return { ok: true, text, cutShort: true, usage, latencyMs: Date.now() - t0 };
    }
    return { ok: false, status: 0, details: String(e), latencyMs: Date.now() - t0 };
  }

  clearTimeout(timer);
  return { ok: true, text, cutShort, usage, latencyMs: Date.now() - t0 };
}

function buildExamPrompts({ lang, level, course, qType, numQuestions, pastedText, isMath }) {
  const systemSvBase =
    "Du skapar ett realistiskt mockprov som en svensk gymnasielärare. " +
    "Du MÅSTE följa JSON-schemat exakt och bara returnera JSON. " +
    "EXAKT antal frågor. " +
    "Regler per fråga: " +
    "1) type får bara vara 'mc' eller 'short' (INTE essä). " +
    "2) Om type=='mc': options ska ha 3–5 alternativ och correct_index ska vara 0..(options.length-1). " +
    "3) Om type=='short': options ska vara [] och correct_index ska vara -1. " +
    "4) rubric ska vara kort och poängfokuserad. " +
    "5) model_answer ska alltid finnas. För mc: förklara varför rätt alternativ är rätt. För short: skriv ett fullpoängssvar. " +
    "6) topic/subtopic/learning_objective ska kort beskriva vad frågan mäter. " +
    "7) source_references ska lista vilken del av det inskickade materialet frågan bygger på (kort citat eller rubrik) — hitta ALDRIG på fakta som inte finns i materialet. " +
    "8) cognitive_level ska vara ett av: minnas, förstå, tillämpa, analysera, värdera — matchat mot nivå (se separat instruktion). " +
    "9) Om type=='short': scoring_rubric.parts ska bryta ner poängen i konkreta delmoment (t.ex. 'Definition: 1p', 'Villkor: 2p') som tillsammans summerar till points. full_score_requirements ska säga EXAKT vad som krävs för full poäng — fråga aldrig i hemlighet efter mer än vad question-texten bad om. accepted_answers ska lista alternativa godtagbara formuleringar. " +
    "10) Om type=='mc': scoring_rubric ska ändå finnas i svaret men med tom parts-array, full_score_requirements='' , partial_credit_notes=''. " +
    "11) estimated_answer_length ska matcha vad points faktiskt kräver — en 1-poängsfråga ska inte kräva 'long_paragraph'. " +
    "12) ENTYDIGHET (viktigast av allt för flervalsfrågor): exakt ETT alternativ ska vara korrekt. " +
    "Varje övrigt alternativ MÅSTE vara definitivt FELAKTIGT — inte bara sämre, mindre lämpligt, ofullständigt eller mindre vanligt. " +
    "Innan du skriver klart en fråga: gå igenom vart och ett av de felaktiga alternativen och kontrollera att det finns ett konkret skäl att förkasta det. " +
    "Om du inte kan formulera det skälet är alternativet inte en distraktor utan ett andra rätt svar — gör om frågan. " +
    "13) Ställ ALDRIG en fråga där materialet stöder flera alternativ samtidigt. Vanliga fällor att undvika: " +
    "(a) 'Vilken metod kan användas för att...' när materialet beskriver flera fungerande metoder — fråga i stället efter resultatet, eller lås frågan till en specifik metod. " +
    "(b) 'Vilken faktor/vilket begrepp tillhör kategorin X?' när materialet räknar upp flera i samma kategori. " +
    "(c) Ordningsfrågor som 'den första/andra faktorn' när ordningen inte är definierad. " +
    "(d) Villkorsfrågor där flera värden uppfyller villkoret — ange villkoret så att exakt ett alternativ passar. " +
    "(e) Alternativ som är logiska följder av varandra, t.ex. 'x > 10' och 'x != 10' när x är större än 10. " +
    "Fråga hellre efter ett beräknat värde, ett exakt begrepp eller en konkret konsekvens än efter 'vilket av dessa stämmer'. " +
    "14) RÄKNA IGENOM varje beräkning innan du sätter correct_index, och kontrollera att slutsvaret i model_answer pekar på exakt det alternativet. " +
    "En korrekt förklaring med fel markerat alternativ är det allvarligaste felet ett prov kan innehålla. " +
    cognitiveVerbHint("sv") + " ";

  const systemSvMath =
    "MATTE-LÄGE: Matematik är ett färdighetsämne. Provet ska mäta elevens förmåga att LÖSA " +
    "matematiska problem — inte att återge teori. " +
    "Fördelning över hela provet (håll den): 70–80 % beräkning och problemlösning, " +
    "15–25 % resonemang och tillämpning, 5–10 % begrepp och definitioner. " +
    "Prioritera uppgifter där eleven ska: lösa ett problem och visa hela lösningsgången; " +
    "välja lämplig metod och motivera valet; tolka graf, tabell eller figur; " +
    "använda matematik i en verklighetsnära situation; hitta och rätta felet i en given lösning; " +
    "jämföra två lösningsmetoder och avgöra vilken som är mest effektiv. " +
    "Undvik frågor av typen 'Vad är...', 'Definiera...' och 'Vad används ... till?'. " +
    "Sådana får bara användas när de verkligen testar förståelse eller när kursens centrala " +
    "innehåll kräver det, och aldrig mer än den avsatta begreppsandelen. " +
    "Anpassa uppgifterna till kursens ämnesområde — t.ex. algebra, andragradsekvationer, " +
    "funktioner, geometri, trigonometri, derivata, integraler, sannolikhet, statistik, " +
    "logaritmer, exponentialfunktioner, vektorer, komplexa tal eller diskret matematik. " +
    "Svårighetsgrad, uppgiftstyper och bedömning ska följa Skolverkets centrala innehåll och " +
    "kunskapskrav för den aktuella kursen. " +
    "Rubric ska dela upp poäng på metod + slutsvar (t.ex. 'Metod 2p, svar 1p'). " +
    "Model_answer ska innehålla full lösning med tydliga steg och ett markerat slutsvar. " +
    "Flervalsalternativ ska vara plausibla felalternativ (typiska räknefel) och endast ett korrekt.";

  const systemEnBase =
    "You create a realistic mock exam like a high-school teacher. " +
    "You MUST follow the JSON schema exactly and output only JSON. " +
    "EXACT number of questions. " +
    "Per-question rules: " +
    "1) type must be only 'mc' or 'short' (NO essays). " +
    "2) If type=='mc': options must have 3–5 choices and correct_index must be 0..(options.length-1). " +
    "3) If type=='short': options must be [] and correct_index must be -1. " +
    "4) rubric must be short and point-focused. " +
    "5) model_answer must always exist. For mc: explain why the correct option is correct. For short: provide a full-score answer. " +
    "6) topic/subtopic/learning_objective must briefly describe what the question measures. " +
    "7) source_references must list which part of the provided material the question is based on (brief quote or heading) — NEVER invent facts not in the material. " +
    "8) cognitive_level must be one of: minnas, förstå, tillämpa, analysera, värdera — matched to the level (see separate instruction). " +
    "9) If type=='short': scoring_rubric.parts must break down the points into concrete sub-components (e.g. 'Definition: 1p', 'Conditions: 2p') that sum to points. full_score_requirements must state EXACTLY what is required for full marks — never secretly ask for more than what the question text requested. accepted_answers must list alternative acceptable phrasings. " +
    "10) If type=='mc': scoring_rubric must still be present in the response but with an empty parts array, full_score_requirements='', partial_credit_notes=''. " +
    "11) estimated_answer_length must match what the points actually require — a 1-point question should not require 'long_paragraph'. " +
    "12) UNAMBIGUITY (the single most important rule for multiple choice): exactly ONE option must be correct. " +
    "Every other option MUST be definitively WRONG — not merely worse, less suitable, incomplete or less common. " +
    "Before finishing a question, go through each incorrect option and check that there is a concrete reason to reject it. " +
    "If you cannot state that reason, the option is not a distractor but a second correct answer — rewrite the question. " +
    "13) NEVER ask a question the material supports several answers to. Common traps to avoid: " +
    "(a) 'Which method can be used to...' when the material describes several working methods — ask for the result instead, or pin the question to one method. " +
    "(b) 'Which factor/concept belongs to category X?' when the material lists several in that category. " +
    "(c) Ordering questions such as 'the first/second factor' when no order is defined. " +
    "(d) Condition questions where several values satisfy the condition — state the condition so exactly one option fits. " +
    "(e) Options that logically follow from one another, e.g. 'x > 10' and 'x != 10' when x is greater than 10. " +
    "Prefer asking for a computed value, an exact term or a concrete consequence over 'which of these is true'. " +
    "14) WORK THROUGH every calculation before setting correct_index, and verify that the final answer in model_answer points at exactly that option. " +
    "A correct explanation with the wrong option marked is the most serious error an exam can contain. " +
    cognitiveVerbHint("en") + " ";

  const systemEnMath =
    "MATH MODE: Mathematics is a skills subject. The exam must measure the student's ability " +
    "to SOLVE mathematical problems — not to recite theory. " +
    "Distribution across the whole exam (hold it): 70–80 % calculation and problem solving, " +
    "15–25 % reasoning and application, 5–10 % concepts and definitions. " +
    "Prioritize tasks where the student must: solve a problem and show the full working; " +
    "choose a suitable method and justify the choice; interpret a graph, table or figure; " +
    "apply mathematics to a real-world situation; find and correct the error in a given solution; " +
    "compare two solution methods and decide which is most efficient. " +
    "Avoid questions of the form 'What is...', 'Define...' and 'What is ... used for?'. " +
    "Those may only be used when they genuinely test understanding or when the course's core " +
    "content requires it, and never beyond the allotted concept share. " +
    "Adapt tasks to the course's topic area — e.g. algebra, quadratic equations, functions, " +
    "geometry, trigonometry, derivatives, integrals, probability, statistics, logarithms, " +
    "exponential functions, vectors, complex numbers or discrete mathematics. " +
    "Difficulty, task types and assessment must follow the Swedish National Agency for " +
    "Education's core content and knowledge requirements for the course in question. " +
    "Rubric must split points into method + final answer (e.g. 'Method 2p, answer 1p'). " +
    "Model_answer must include a complete step-by-step solution and a clearly marked final answer. " +
    "MC options must be plausible distractors (typical calculation mistakes) with exactly one correct.";

  const systemPrompt =
    lang === "sv"
      ? systemSvBase + (isMath ? (" " + systemSvMath) : "")
      : systemEnBase + (isMath ? (" " + systemEnMath) : "");

  const mixRuleSv =
    qType === "mc"
      ? "Gör ALLA frågor som flervalsfrågor (mc)."
      : qType === "short"
        ? "Gör ALLA frågor som kortsvar (short)."
        : "Gör en blandning av 'mc' och 'short' (ungefär hälften/hälften).";

  const mixRuleEn =
    qType === "mc"
      ? "Make ALL questions multiple choice (mc)."
      : qType === "short"
        ? "Make ALL questions short answer (short)."
        : "Make a mix of 'mc' and 'short' (about half/half).";

  const userSv = [
    `Skapa ett mockprov på nivå ${level}.`,
    course ? `Kurs/ämne: ${course}.` : "",
    `Frågetyp-val: ${qType}.`,
    mixRuleSv,
    `Antal frågor: ${numQuestions}.`,
    "",
    "Material (använd bara detta som underlag):",
    pastedText
  ].filter(Boolean).join("\n");

  const userEn = [
    `Create a mock exam at level ${level}.`,
    course ? `Course/subject: ${course}.` : "",
    `Question type selection: ${qType}.`,
    mixRuleEn,
    `Number of questions: ${numQuestions}.`,
    "",
    "Material (use only this as the source):",
    pastedText
  ].filter(Boolean).join("\n");

  return { systemPrompt, userPrompt: lang === "sv" ? userSv : userEn };
}

module.exports = async function handler(req, res) {
  const budget = makeBudget(Date.now());

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const user = await requireAuth(req);
  if (!user) return json(res, 401, { ok: false, error: "Unauthorized" });

  const rules = await loadCentralRules();
  const role = rules.normalizeRole(await loadUserRole(user.id));
  const mockLimit = rules.getFeatureLimit(role, "mockExam");
  const entitlements = rules.getEntitlementSnapshot(role);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: "Missing OPENAI_API_KEY" });

  let parsed;
  try {
    parsed = await readJsonBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, error: "Invalid JSON", details: String(e) });
  }

  const lang = asEnum(parsed.lang, ["sv", "en"], "sv");
  const level = asEnum(parsed.level, ["E", "C", "A"], "C");
  const qType = asEnum(parsed.qType, ["mix", "mc", "short"], "mix");
  const course = safeString(parsed.course, 200);
  const pastedText = safeString(parsed.pastedText, 3000);

  const numQuestionsRaw = toInt(parsed.numQuestions, 12);
  const numQuestions = Math.min(20, Math.max(3, numQuestionsRaw));

  if (!pastedText.trim()) return json(res, 400, { ok: false, error: "Missing pastedText" });

  let quota;
  try {
    quota = await consumeMockExamQuota(user.id, mockLimit, rules);
  } catch (e) {
    return json(res, 500, {
      ok: false,
      error: "mock_quota_unavailable",
      message: "Mockprovskvoten kunde inte kontrolleras. Kör Supabase-migrationen innan den här versionen deployas.",
      details: e.details || String(e)
    });
  }

  if (!quota.ok) {
    return json(res, 429, {
      ok: false,
      error: "Quota exceeded",
      count: quota.count,
      limit: quota.limit,
      period: quota.period
    });
  }

  const isMath = looksLikeMath(course, pastedText);
  const model = pickModel({ isMath });
  const responseFormat = buildMockExamSchema(numQuestions);

  const { systemPrompt, userPrompt } = buildExamPrompts({
    lang, level, course, qType, numQuestions, pastedText, isMath
  });

  try {
    const payload = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      text: { format: responseFormat }
    };

    // Leave room for the verifier only while there is enough left to be worth
    // it; otherwise let generation use the whole remaining budget.
    const canVerify = budget.remaining() - MIN_GENERATION_MS > MIN_VERIFIER_MS;
    const generationBudget = budget.remaining() - (canVerify ? VERIFIER_RESERVE_MS : 0);

    const gen = await streamGeneration({ apiKey, payload, budgetMs: generationBudget });
    if (!gen.ok) {
      return json(res, 502, { ok: false, error: "OpenAI error", status: gen.status, details: gen.details });
    }

    const salvage = salvageExamJson(gen.text);
    let exam = salvage.exam;
    const truncated = salvage.truncated;

    if (!exam) {
      // Nothing usable arrived before the deadline. Say so plainly instead of a
      // generic 500 — the student can retry with fewer questions and succeed.
      return json(res, 504, {
        ok: false,
        error: "Provet hann inte genereras",
        message: "Generatorn hann inte färdigt inom tidsgränsen. Försök igen, gärna med färre frågor.",
        elapsedMs: budget.elapsed(),
        requested: numQuestions,
      });
    }

    if (!Array.isArray(exam.questions) || exam.questions.length === 0) {
      return json(res, 500, { ok: false, error: "Schema mismatch", exam });
    }
    // A complete response must still match the requested count exactly; a
    // salvaged one is short by construction and that is the point.
    if (!truncated && exam.questions.length !== numQuestions) {
      return json(res, 500, { ok: false, error: "Schema mismatch", exam });
    }

    // Server-side guard: inga essay + fixa short-regler.
    // On a complete response a malformed question is a contract violation and
    // still fails loudly. On a salvaged one the tail is expected to be ragged,
    // so bad questions are dropped rather than discarding the whole exam.
    const guardFail = (reason, detail) => truncated
      ? null
      : json(res, 500, { ok: false, error: reason, ...detail });
    const keptQuestions = [];
    for (const q of exam.questions) {
      if (q?.type !== "mc" && q?.type !== "short") {
        const bail = guardFail("Invalid question type returned", { got: q?.type });
        if (bail) return bail;
        continue;
      }

      if (q.type === "short") {
        if (!Array.isArray(q.options)) q.options = [];
        q.options = [];
        q.correct_index = -1;
        if (!q.scoring_rubric || !Array.isArray(q.scoring_rubric.parts)) {
          const bail = guardFail("Missing scoring_rubric on short question", { question: q });
          if (bail) return bail;
          continue;
        }
      } else {
        if (!Array.isArray(q.options) || q.options.length < 3) {
          const bail = guardFail("MC options invalid", { question: q });
          if (bail) return bail;
          continue;
        }
        if (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index >= q.options.length) {
          const bail = guardFail("MC correct_index invalid", { question: q });
          if (bail) return bail;
          continue;
        }
      }
      keptQuestions.push(q);
    }
    exam.questions = keptQuestions;
    if (exam.questions.length === 0) {
      return json(res, 504, {
        ok: false,
        error: "Provet hann inte genereras",
        message: "Generatorn hann inte färdigt inom tidsgränsen. Försök igen, gärna med färre frågor.",
        elapsedMs: budget.elapsed(),
        requested: numQuestions,
      });
    }

    // ── STRUCTURAL GATE (subject-agnostic, deterministic) ─────────────────
    const subjectProfile = assessment.detectSubjectProfile(course, pastedText);
    let gate = assessment.gateExam(exam, { profile: subjectProfile });
    exam.questions = gate.questions;

    // ── VERIFIER PASS (separate role — checks, never fixes) ───────────────
    const verifier = require("./_verifier");
    const solver = require("./_solver");
    let verifierOutcome = { checked: 0, approved: 0, rejected: 0, callOk: false };
    let solverOutcome = { checked: 0, rejected: 0, callOk: false, model: null, reasons: {} };
    // Verification is skipped when there is no longer time for it. Shipping
    // gate-only questions is the same fail-open posture the verifier already
    // had on a network error, and it is strictly better than letting the
    // platform kill the function and return nothing.
    let verifierSkipped = false;
    if (exam.questions.length > 0 && budget.remaining() < MIN_VERIFIER_MS) {
      verifierSkipped = true;
      for (const q of exam.questions) {
        q.validation_status = "gate_only";
        q.confidence_score = null;
        q.detected_issues = [];
      }
    } else if (exam.questions.length > 0) {
      // The verifier judges the question; the solver answers it. They are
      // independent of one another and both read the same gated questions, so
      // running them concurrently makes wall time the max of the two rather
      // than their sum — which is what lets a third call fit inside the 60 s
      // function budget at all.
      const [v1, s1] = await Promise.all([
        verifier.verifyQuestions(exam.questions, { apiKey, model, subjectProfile, lang }),
        solver.solveQuestions(exam.questions, {
          apiKey, model, subjectProfile, lang, pastedText,
          material: pastedText,
          timeoutMs: Math.max(1000, budget.remaining() - RESPONSE_RESERVE_MS),
        }),
      ]);
      solverOutcome.callOk = s1.callOk;
      solverOutcome.model = s1.model;
      verifierOutcome.callOk = v1.callOk;
      if (v1.callOk) {
        const approvedIds = new Set();
        const rejectedIds = [];
        for (const q of exam.questions) {
          const vres = v1.perQuestion.get(String(q.id));
          verifierOutcome.checked++;
          const verifierOk = !!(vres && verifier.decideApproval(vres));
          // A question ships only if BOTH roles clear it. The solver fails open
          // as a whole (callOk:false means it is not consulted at all), but when
          // it did run, a question it could not answer the same way as the key
          // is not one to put in front of a student.
          let solverOk = true;
          if (s1.callOk && q.type === "mc") {
            const decision = solver.decideKeep(s1.perQuestion.get(String(q.id)), q);
            solverOk = decision.keep;
            solverOutcome.checked++;
            if (!decision.keep) {
              solverOutcome.rejected++;
              solverOutcome.reasons[decision.reason] = (solverOutcome.reasons[decision.reason] || 0) + 1;
              q.detected_issues = [...(q.detected_issues || []), decision.reason];
            }
          }
          if (verifierOk && solverOk) { approvedIds.add(String(q.id)); verifierOutcome.approved++; }
          else { rejectedIds.push(String(q.id)); verifierOutcome.rejected++; }
        }
        // Tracks whichever verifier result map is currently authoritative for
        // per-question stamping below — round 1 unless a regeneration round
        // actually succeeds and replaces exam.questions with round-2 output.
        let activeVerifierMap = v1.perQuestion;
        // One bounded regeneration attempt for the whole exam if too much was
        // rejected (mirrors the existing >30%-flagged retry threshold below) —
        // never loop, never regenerate per-question (cost + spec §13 says no
        // unbounded regeneration loops).
        //
        // The regeneration round needs a full generation AND a second
        // verification. Starting it without that much budget left was the one
        // path that guaranteed a platform timeout: a 45 s call begun at t=50 s
        // inside a 60 s function could not finish, and the student got a 504
        // instead of the round-1 questions that were already verified and ready
        // to ship.
        const canRegenerate = budget.remaining() > MIN_GENERATION_MS + MIN_VERIFIER_MS;
        if (rejectedIds.length > 0 && rejectedIds.length / exam.questions.length > 0.3 && canRegenerate) {
          // Round-1 structurally-gated questions, kept aside so that if
          // regeneration fails for any reason we can still fall back to just
          // the subset that DID pass verification — never ship a question the
          // verifier explicitly rejected merely because regeneration failed.
          const originalGatedQuestions = exam.questions;
          // Snapshot round-1's structural gate result so the fallback path
          // (regeneration attempted but round-2 verifier call fails, or
          // regeneration fails outright) can restore it alongside
          // exam.questions/activeVerifierMap — otherwise gate would keep
          // describing round-2's regenerated exam even though round-1
          // questions are what actually ships.
          const round1Gate = gate;
          let regenerationSucceeded = false;
          const r2 = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(Math.max(0, budget.remaining() - MIN_VERIFIER_MS))
          });
          const raw2 = await r2.text();
          let data2; try { data2 = JSON.parse(raw2); } catch { data2 = null; }
          if (r2.ok && data2) {
            const out2 = (Array.isArray(data2.output) && data2.output.flatMap(o => Array.isArray(o.content) ? o.content : []).find(c => c.type === "output_text") || {}).text || null;
            let exam2; try { exam2 = out2 ? JSON.parse(out2) : null; } catch { exam2 = null; }
            if (exam2 && Array.isArray(exam2.questions) && exam2.questions.length === numQuestions) {
              gate = assessment.gateExam(exam2, { profile: subjectProfile });
              const regatedQuestions = gate.questions;
              if (regatedQuestions.length > 0) {
                const v2 = await verifier.verifyQuestions(regatedQuestions, { apiKey, model, subjectProfile, lang });
                if (v2.callOk) {
                  const kept = [];
                  const outcome2 = { checked: 0, approved: 0, rejected: 0, callOk: true };
                  for (const q of regatedQuestions) {
                    const vres = v2.perQuestion.get(String(q.id));
                    outcome2.checked++;
                    if (vres && verifier.decideApproval(vres)) { kept.push(q); outcome2.approved++; }
                    else outcome2.rejected++;
                  }
                  if (kept.length > 0) {
                    exam.questions = kept;
                    activeVerifierMap = v2.perQuestion;
                    verifierOutcome = outcome2;
                    regenerationSucceeded = true;
                  }
                }
              }
            }
          }
          if (!regenerationSucceeded) {
            // Regeneration failed outright (network/parse/shape) or produced
            // zero verified-approved questions after re-gating/re-verifying —
            // fall back to the round-1 approved subset instead of shipping the
            // original, unfiltered (still verifier-rejected) batch.
            exam.questions = originalGatedQuestions.filter(q => approvedIds.has(String(q.id)));
            activeVerifierMap = v1.perQuestion;
            gate = round1Gate;
            // verifierOutcome already holds round-1 checked/approved/rejected counts.
          }
        } else {
          exam.questions = exam.questions.filter(q => approvedIds.has(String(q.id)));
        }
        // Stamp per-question validation metadata (spec: every question carries
        // its own validation_status/confidence_score/detected_issues, not just
        // an aggregate). Safe to leave on the object — app.html's renderExam()
        // only reads .question/.options/.type/.points/.id, unknown properties
        // are simply ignored, never rendered.
        for (const q of exam.questions) {
          const vres = activeVerifierMap.get(String(q.id));
          q.validation_status = vres ? "verified" : "gate_only";
          q.confidence_score = vres
            ? Number((
                (Number(vres.factual_accuracy) + Number(vres.ambiguity_score >= 0 ? 1 - vres.ambiguity_score : 0) +
                 Number(vres.difficulty_match) + Number(vres.source_alignment) + Number(vres.scoring_quality) +
                 Number(vres.language_quality)) / 6
              ).toFixed(2))
            : null;
          q.detected_issues = vres && Array.isArray(vres.issues) ? vres.issues : [];
        }
      } else {
        // Verifier call failed outright (network/parse error) — fail open on the
        // structural gate's output rather than blocking delivery entirely (matches
        // the existing best-effort behavior of the old reviewer pass), but say so.
        for (const q of exam.questions) {
          q.validation_status = "gate_only";
          q.confidence_score = null;
          q.detected_issues = [];
        }
      }
    }

    if (exam.questions.length === 0) {
      return json(res, 502, {
        ok: false,
        error: "Alla frågor underkändes av kvalitetskontrollen. Försök igen.",
        gate: { profile: subjectProfile, dropped: gate.dropped },
      });
    }

    // ── OBSERVABILITY (structured, no question/answer content logged) ─────
    console.log(JSON.stringify({
      event: "exam_quality_gate",
      subjectProfile,
      numRequested: numQuestions,
      truncated,
      verifierSkipped,
      elapsedMs: budget.elapsed(),
      generationMs: gen.latencyMs,
      generatorModel: model,
      verifierModel: verifier.verifierModel(model),
      solverModel: solverOutcome.model,
      solverCallOk: solverOutcome.callOk,
      solverChecked: solverOutcome.checked,
      solverRejected: solverOutcome.rejected,
      solverReasons: solverOutcome.reasons,
      structurallyDropped: gate.dropped.length,
      structurallyFlagged: gate.flagged.length,
      verifierChecked: verifierOutcome.checked,
      verifierApproved: verifierOutcome.approved,
      verifierRejected: verifierOutcome.rejected,
      verifierCallOk: verifierOutcome.callOk,
      finalQuestionCount: exam.questions.length,
    }));

    // Verifier-internal fields (validation_status/confidence_score/detected_issues)
    // are stamped above for the gating decision and the observability log, but
    // must never reach the browser response body (plan's Global Constraint: no
    // secrets or internal fields — akey_sig, verifier scores, prompt text — may
    // reach the client). Strip them from a shallow-copied exam for the response
    // only; the original exam.questions objects (used above) are left untouched.
    const clientExam = {
      ...exam,
      questions: exam.questions.map((q) => {
        const { validation_status, confidence_score, detected_issues, ...clientQuestion } = q;
        return clientQuestion;
      }),
    };

    return json(res, 200, {
      ok: true,
      exam: clientExam,
      meta: {
        isMath,
        subjectProfile,
        truncated,
        verifierSkipped,
        requested: numQuestions,
        elapsedMs: budget.elapsed(),
        gate: { profile: subjectProfile, dropped: gate.dropped.length, flagged: gate.flagged.length },
        verifier: verifierOutcome,
        solver: solverOutcome,
        model,
        entitlements,
        quota: {
          feature: "mockExam",
          period: quota.period,
          count: quota.count,
          limit: quota.limit,
          unlimited: quota.unlimited,
          enforced: quota.enforced
        }
      }
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e) });
  }
};

// Named exports hang off the handler function (Vercel resolves module.exports
// itself as the handler). Exposed so tests/evals can drive the real prompt and
// schema without an HTTP request.
module.exports.buildExamPrompts = buildExamPrompts;
module.exports.buildMockExamSchema = buildMockExamSchema;
module.exports.looksLikeMath = looksLikeMath;
module.exports.salvageExamJson = salvageExamJson;   // pure — unit-tested
module.exports.makeBudget = makeBudget;             // pure — unit-tested
module.exports.streamGeneration = streamGeneration; // transport — exercised by the eval
