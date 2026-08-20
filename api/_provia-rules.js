// api/_provia-rules.js
// Central public product rules and verified facts for backend AI/product flows.
import fs from "fs";
import path from "path";
import { MODULES } from "./_modules.js";
import { SITE_ORIGIN } from "./_site.js";

export const PLAN_RULES = Object.freeze({
  gratis: Object.freeze({
    label: "Gratis",
    price: "0 kr",
    // 3/vecka sedan skolfokuseringen 2026-07-28: körkortsteorins 10 kursfrågor/dag var
    // tidigare gratisplanens huvudsakliga innehåll. När den modulen dolts skulle 2 mockprov
    // i veckan blivit för tunt för att någon skulle hinna se vad produkten gör.
    mockExam: Object.freeze({ cap: 3, period: "week" }),
    drivingTest: Object.freeze({ cap: 0, period: "week" }),  // teoriprov kräver Basic
    kkPractice: Object.freeze({ cap: 10, period: "day" }),   // 10 kursfrågor/dag
    perChat: Object.freeze({ cap: 5, period: "week" }),
    hpGen: Object.freeze({ cap: 0, period: "day" }),         // gratis: cache-only, ingen generering
    hpSim: Object.freeze({ cap: 0, period: "month" }),
  }),
  basic: Object.freeze({
    label: "Basic",
    price: "29 kr/månad",
    mockExam: Object.freeze({ cap: 30, period: "month" }),
    drivingTest: Object.freeze({ cap: 30, period: "month" }),
    kkPractice: Object.freeze({ cap: Infinity, period: "day" }),
    perChat: Object.freeze({ cap: 5, period: "day" }),
    hpGen: Object.freeze({ cap: 60, period: "day" }),
    hpSim: Object.freeze({ cap: 4, period: "month" }),
  }),
  premium: Object.freeze({
    label: "Premium",
    price: "79 kr/månad",
    mockExam: Object.freeze({ cap: Infinity, period: "month" }),
    drivingTest: Object.freeze({ cap: Infinity, period: "month" }),
    kkPractice: Object.freeze({ cap: Infinity, period: "day" }),
    perChat: Object.freeze({ cap: Infinity, period: "month" }),
    hpGen: Object.freeze({ cap: Infinity, period: "day" }),
    hpSim: Object.freeze({ cap: Infinity, period: "month" }),
  }),
  admin: Object.freeze({
    label: "Admin",
    price: "internal",
    mockExam: Object.freeze({ cap: Infinity, period: "month" }),
    drivingTest: Object.freeze({ cap: Infinity, period: "month" }),
    kkPractice: Object.freeze({ cap: Infinity, period: "day" }),
    perChat: Object.freeze({ cap: Infinity, period: "month" }),
    hpGen: Object.freeze({ cap: Infinity, period: "day" }),
    hpSim: Object.freeze({ cap: Infinity, period: "month" }),
  }),
  user: Object.freeze({
    label: "Premium",
    price: "79 kr/månad",
    mockExam: Object.freeze({ cap: Infinity, period: "month" }),
    drivingTest: Object.freeze({ cap: Infinity, period: "month" }),
    kkPractice: Object.freeze({ cap: Infinity, period: "day" }),
    perChat: Object.freeze({ cap: Infinity, period: "month" }),
    hpGen: Object.freeze({ cap: Infinity, period: "day" }),
    hpSim: Object.freeze({ cap: Infinity, period: "month" }),
  }),
  teacher: Object.freeze({
    label: "Lärare",
    price: "B2B",
    mockExam: Object.freeze({ cap: Infinity, period: "month" }),
    drivingTest: Object.freeze({ cap: Infinity, period: "month" }),
    kkPractice: Object.freeze({ cap: Infinity, period: "day" }),
    perChat: Object.freeze({ cap: Infinity, period: "month" }),
    hpGen: Object.freeze({ cap: Infinity, period: "day" }),
    hpSim: Object.freeze({ cap: Infinity, period: "month" }),
  }),
});

export function normalizeRole(role) {
  return PLAN_RULES[String(role || "").toLowerCase()] ? String(role).toLowerCase() : "gratis";
}

export function getPlan(role) {
  return PLAN_RULES[normalizeRole(role)];
}

export function getFeatureLimit(role, feature) {
  const plan = getPlan(role);
  return plan?.[feature] || Object.freeze({ cap: Infinity, period: "month" });
}

export function serializeLimit(limit) {
  return {
    cap: limit?.cap === Infinity ? null : limit?.cap,
    unlimited: limit?.cap === Infinity,
    period: limit?.period || "month",
  };
}

export function getEntitlementSnapshot(role) {
  const normalizedRole = normalizeRole(role);
  const plan = getPlan(normalizedRole);
  return {
    role: normalizedRole,
    label: plan.label,
    price: plan.price,
    features: {
      mockExam: serializeLimit(plan.mockExam),
      drivingTest: serializeLimit(plan.drivingTest),
      kkPractice: serializeLimit(plan.kkPractice),
      perChat: serializeLimit(plan.perChat),
    },
  };
}

export function currentPeriodKey(period, now = new Date()) {
  if (period === "day") return now.toISOString().slice(0, 10);
  if (period === "month") {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  return `${now.getUTCFullYear()}-W${String(Math.ceil(dayOfYear / 7)).padStart(2, "0")}`;
}

export function formatLimit(limit) {
  if (!limit || limit.cap === Infinity) return "Obegränsat";
  const period = limit.period === "day" ? "dag" : limit.period === "month" ? "månad" : "vecka";
  return `${limit.cap}/${period}`;
}

let cachedQuestionCount = null;

export function getDrivingQuestionCount() {
  if (cachedQuestionCount !== null) return cachedQuestionCount;
  try {
    const file = path.join(process.cwd(), "final_questions.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const metaCount = Number(parsed?.metadata?.total_questions);
    const arrayCount = Array.isArray(parsed?.questions) ? parsed.questions.length : 0;
    cachedQuestionCount = Number.isFinite(metaCount) && metaCount > 0 ? metaCount : arrayCount;
  } catch {
    cachedQuestionCount = 350;
  }
  return cachedQuestionCount;
}

export function buildPlanFacts() {
  // Körkortsdelarna utelämnas när modulen är av — annars citerar P.E.R planer som innehåller
  // något eleven inte kan nå (js/exgen-modules.js + api/_modules.js).
  if (!MODULES.korkort) {
    return [
      `Gratis: 0 kr, prov på eget material ${formatLimit(PLAN_RULES.gratis.mockExam)}, P.E.R ${formatLimit(PLAN_RULES.gratis.perChat)}.`,
      `Basic: 29 kr/månad, prov ${formatLimit(PLAN_RULES.basic.mockExam)}, OCR (fota anteckningar), historik, P.E.R ${formatLimit(PLAN_RULES.basic.perChat)}.`,
      "Premium: 79 kr/månad, obegränsade prov, felbank, AI-coach, lärarrapport och obegränsad P.E.R.",
    ].join("\n");
  }
  return [
    `Gratis: 0 kr, mockprov ${formatLimit(PLAN_RULES.gratis.mockExam)}, körkortsteorin ${formatLimit(PLAN_RULES.gratis.kkPractice)} kursfrågor (ingen teoriprov), P.E.R ${formatLimit(PLAN_RULES.gratis.perChat)}.`,
    `Basic: 29 kr/månad, mockprov ${formatLimit(PLAN_RULES.basic.mockExam)}, körkortstest ${formatLimit(PLAN_RULES.basic.drivingTest)} teoriprov + obegränsade kursfrågor, P.E.R ${formatLimit(PLAN_RULES.basic.perChat)}.`,
    "Premium: 79 kr/månad, obegränsade mockprov, obegränsade körkortstest, obegränsad P.E.R och premiumfunktioner.",
  ].join("\n");
}

export function buildPublicProviaKnowledge() {
  const questionCount = getDrivingQuestionCount();

  // Detta block är den fakta P.E.R uttryckligen får citera. Beskriver det körkortsteorin när
  // modulen är avstängd kommer P.E.R påstå att elever kan träna körkort — även om varje länk
  // dit är borttagen. Sedan skolfokuseringen 2026-07-28 utelämnas därför hela körkortsdelen
  // när MODULES.korkort är false (js/exgen-modules.js + api/_modules.js).
  const korkortIntro = MODULES.korkort
    ? " ExGen stödjer både skolarbete/skolämnen och körkortsteori."
    : "";
  const korkortTail = MODULES.korkort
    ? ` Körkortsteorin är en egen del med ${questionCount} verifierade frågor.`
    : "";
  const korkortPage = MODULES.korkort
    ? `\n- Körkortsteorin: ${questionCount} frågor, kategorier, adaptivt lärande, SRS/repetition och simulerat teoriprov (teoriprov kräver Basic eller Premium).`
    : "";
  const korkortSection = MODULES.korkort
    ? "\n\nKörkortsprovet:\nSimulerat teoriprov har 65 frågor på 50 minuter. 52 rätt av 65 är godkänd nivå (80%)."
    : "";
  const scopeNote = MODULES.korkort
    ? ""
    : "\n\nOmfattning:\nExGen är en studieplattform för grundskolan och gymnasiet. Körkortsteori och högskoleprov ingår INTE i produkten just nu — erbjud det aldrig, och påstå aldrig att det finns.";

  return `## EXGEN - FAKTA P.E.R FÅR CITERA

Vad är ExGen?
ExGen (${SITE_ORIGIN.replace(/^https?:\/\//, "")}) är en studieplattform för grundskolan och gymnasiet.${korkortIntro} Elever kan använda eget material eller OCR för att skapa AI-genererade prov, få rättning, feedback, modellsvar, förbättringssida med AI-coach, felbank, lärarrapport och P.E.R.${korkortTail}

Sidor:
- Startsida: översikt, demo och launcher.
- Mockprov/skolarbete: eget skolmaterial eller OCR -> AI genererar prov -> rättning med feedback och modellsvar.${korkortPage}
- Min utveckling: historik, felbank, P.E.R-tips, lärarrapport, träningsläge och personlig studieplan.
- Mitt konto: plan, uppgradering, Stripe-portal, avsluta abonnemang och logga ut.
- Priser: jämför Gratis, Basic och Premium.

Planer:
${buildPlanFacts()}
Ingen bindningstid. Ingen kortuppgift krävs för Gratis.${korkortSection}${scopeNote}

Viktigt:
Hitta aldrig på priser, kvoter, funktioner eller internt innehåll. Om fakta saknas i verifierad kontext, säg att du inte vet säkert.`;
}
