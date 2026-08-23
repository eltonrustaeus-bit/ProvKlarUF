// api/_learner-profile.js — läser och skriver learner_profile_facts, och gör
// profilen till den lilla text P.E.R. faktiskt får se.
//
// Två regler styr allt i den här filen:
//
// 1. INTE ALLT VARJE GÅNG. Uppdragets §10 är explicit: välj relevant kontext,
//    inte hela profilen. Ett fält som inte kan ändra svaret är ren kostnad —
//    tokens, latency och en större yta personuppgifter i varje AI-anrop.
//
// 2. EN GISSNING ÄR INTE ETT FAKTUM. source skiljer på vad användaren sagt,
//    vad systemet mätt och vad P.E.R. slutit sig till. Bara de två första får
//    påstås. Inferenser får forma svaret men aldrig uttalas som sanning —
//    "du verkar tycka X är svårt" till fel elev raderar förtroendet direkt,
//    och de här användarna är till stor del barn.

import { PROFILE_FIELDS, validateProfileValues, findProgram, findSubject } from "./_education.js";

/* Under den här tröskeln får en inferens inte formuleras som ett påstående.
   Värdet är satt, inte uppmätt — det finns ännu ingen produktionsdata att
   kalibrera mot. Det är avsiktligt högt: hellre att P.E.R. tiger om något den
   nästan vet än att den påstår något om en elev som inte stämmer. */
export const ASSERT_CONFIDENCE = 0.65;

/* Ett prov som ligger längre bort än så ändrar inte vad eleven borde göra idag,
   och skulle bara ta plats i prompten. */
export const EXAM_HORIZON_DAYS = 14;

const MAX_FACTS_PER_USER = 40;

/**
 * Hela profilen för en användare.
 * @returns {Promise<{persona: string|null, onboardedAt: string|null, facts: Record<string, {value: unknown, source: string, confidence: number}>}>}
 */
export async function loadProfile(supabase, userId) {
  const empty = { persona: null, onboardedAt: null, facts: {} };
  if (!userId) return empty;
  try {
    const [profileRes, factsRes] = await Promise.all([
      supabase.from("profiles").select("persona, onboarded_at").eq("id", userId).maybeSingle(),
      supabase.from("learner_profile_facts")
        .select("key, value, source, confidence")
        .eq("user_id", userId)
        .limit(MAX_FACTS_PER_USER),
    ]);

    const facts = {};
    for (const row of factsRes.data || []) {
      // Ett fält som tagits bort ur PROFILE_FIELDS ska sluta gälla direkt, även
      // om raden ligger kvar i databasen tills den städas.
      if (!PROFILE_FIELDS[row.key]) continue;
      facts[row.key] = {
        value: row.value,
        source: row.source,
        confidence: typeof row.confidence === "number" ? row.confidence : 1,
      };
    }

    return {
      persona: profileRes.data?.persona || null,
      onboardedAt: profileRes.data?.onboarded_at || null,
      facts,
    };
  } catch {
    // Profilen är personalisering, inte funktion. Går läsningen fel ska P.E.R.
    // svara opersonligt — inte fela.
    return empty;
  }
}

/**
 * Skriver profilvärden. Validerar mot PROFILE_FIELDS först; ogiltiga fält
 * rapporteras tillbaka i stället för att avvisa hela anropet.
 */
export async function saveFacts(supabase, userId, input, { persona = "elev", source = "user", confidence = 1 } = {}) {
  const { values, rejected } = validateProfileValues(input, { persona });
  const keys = Object.keys(values);
  if (!keys.length) return { saved: [], rejected };

  const now = new Date().toISOString();
  const rows = keys.map(key => ({
    user_id: userId,
    key,
    value: values[key],
    source,
    confidence: source === "user" ? 1 : Math.min(1, Math.max(0, confidence)),
    updated_at: now,
  }));

  const { error } = await supabase
    .from("learner_profile_facts")
    .upsert(rows, { onConflict: "user_id,key" });

  if (error) return { saved: [], rejected: [...rejected, ...keys], error: error.message };
  return { saved: keys, rejected };
}

/**
 * En uppgift användaren själv har sagt får aldrig skrivas över av en gissning.
 * Används av de vägar där P.E.R. härleder något — utan spärren hade en felläst
 * inferens kunnat radera elevens eget svar från onboardingen.
 */
export async function saveInferred(supabase, userId, input, { persona = "elev", confidence = 0.5 } = {}) {
  const existing = await loadProfile(supabase, userId);
  const filtered = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (existing.facts[key]?.source === "user") continue;
    filtered[key] = value;
  }
  return saveFacts(supabase, userId, filtered, { persona, source: "inferred", confidence });
}

export async function forgetFact(supabase, userId, key) {
  if (!PROFILE_FIELDS[key]) return false;
  const { error } = await supabase
    .from("learner_profile_facts")
    .delete()
    .eq("user_id", userId)
    .eq("key", key);
  return !error;
}

export async function forgetAllFacts(supabase, userId) {
  const { error } = await supabase.from("learner_profile_facts").delete().eq("user_id", userId);
  return !error;
}

/* ── "Vad P.E.R. vet om mig" ───────────────────────────────────────────────
 *
 * Etiketten och det läsbara värdet byggs här, inte i frontend. Ett nytt fält
 * ska aldrig kunna dyka upp för en elev som en rå databasnyckel, och
 * användaren måste kunna bedöma om uppgiften stämmer — "MATMAT01b" går inte
 * att svara ja eller nej på, "Matematik 1b" gör det.
 */
const SOURCE_LABELS = {
  user: "Du har sagt det",
  observed: "Uppmätt i appen",
  inferred: "P.E.R. har slutit sig till det",
};

export function profileForDisplay(profile) {
  const facts = profile?.facts || {};
  const plain = Object.fromEntries(Object.entries(facts).map(([k, f]) => [k, f.value]));

  return Object.keys(PROFILE_FIELDS)
    .filter(key => facts[key] !== undefined)
    .map(key => {
      const field = PROFILE_FIELDS[key];
      const fact = facts[key];
      let display;
      try {
        display = String(field.format(fact.value, plain));
      } catch {
        display = "";
      }
      return {
        key,
        label: field.label,
        display,
        raw: fact.value,
        source: fact.source,
        sourceLabel: SOURCE_LABELS[fact.source] || fact.source,
        /* Osäkra slutsatser markeras i gränssnittet. Användaren ska kunna se
           skillnad på det hen själv har sagt och det P.E.R. gissat, annars är
           "ändra felaktig information" omöjligt att göra välgrundat. */
        uncertain: fact.source === "inferred" && fact.confidence < ASSERT_CONFIDENCE,
      };
    })
    .filter(row => row.display);
}

/* ── Kontext till prompten ─────────────────────────────────────────────────
 *
 * Det här är den enda vägen profiluppgifter når en modell. Blocket hålls kort
 * med flit: det ska ändra HUR P.E.R. svarar, inte fylla kontextfönstret.
 */
function daysUntil(dateStr, today) {
  const d = Date.parse(dateStr + "T00:00:00Z");
  if (Number.isNaN(d)) return null;
  const t = Date.parse(today.toISOString().slice(0, 10) + "T00:00:00Z");
  return Math.round((d - t) / 86_400_000);
}

/**
 * Bygger P.E.R:s elevkontext.
 *
 * @param profile   resultatet från loadProfile()
 * @param options.topic  vad frågan handlar om, om sidan vet det — styr om
 *                       ämnesraderna tas med eller utelämnas
 * @returns {string} tom sträng när det inte finns något värt att skicka
 */
export function buildProfileContext(profile, { topic = "", today = new Date() } = {}) {
  const facts = profile?.facts || {};
  if (!Object.keys(facts).length) return "";

  const plain = Object.fromEntries(Object.entries(facts).map(([k, f]) => [k, f.value]));
  const säkra = [];
  const osäkra = [];

  const add = (key, text) => {
    if (!text) return;
    const fact = facts[key];
    if (!fact) return;
    if (fact.source === "inferred" && fact.confidence < ASSERT_CONFIDENCE) osäkra.push(text);
    else säkra.push(text);
  };

  // ── Alltid: vem eleven är. Några få ord, men de ändrar varje svar.
  if (facts.school_type) {
    const år = facts.grade_year ? `, ${PROFILE_FIELDS.grade_year.format(plain.grade_year, plain).toLowerCase()}` : "";
    add("school_type", `${PROFILE_FIELDS.school_type.format(plain.school_type)}${år}`);
  } else if (facts.grade_year) {
    add("grade_year", PROFILE_FIELDS.grade_year.format(plain.grade_year, plain));
  }

  if (facts.program_code) {
    const program = findProgram(plain.program_code);
    const inriktning = facts.orientation ? `, inriktning ${plain.orientation}` : "";
    add("program_code", program ? `Går ${program.name}${inriktning}` : null);
  }

  if (facts.goal_grade) add("goal_grade", `Målbetyg: ${plain.goal_grade}`);
  if (facts.help_style) add("help_style", `Föredrar: ${PROFILE_FIELDS.help_style.format(plain.help_style)}`);
  if (facts.focus_note) add("focus_note", `Vill ha hjälp med: ${plain.focus_note}`);

  /* Ämneslistan tas bara med när frågan inte redan säger vilket ämne det
     gäller. Sitter eleven i ett matteprov tillför "läser Matematik, Historia,
     Engelska" ingenting — sidkontexten har redan sagt det, bättre. */
  const ämnenRelevanta = !String(topic || "").trim();
  if (ämnenRelevanta && facts.subject_codes) {
    const namn = (Array.isArray(plain.subject_codes) ? plain.subject_codes : [])
      .map(c => findSubject(c)?.name).filter(Boolean);
    if (namn.length) add("subject_codes", `Läser: ${namn.slice(0, 8).join(", ")}`);
  }

  /* Provdatum, men bara när det är nära nog att ändra vad eleven borde göra.
     Ett prov om två månader ska inte få P.E.R. att prata om repetition. */
  if (facts.exam_date) {
    const dagar = daysUntil(plain.exam_date, today);
    if (dagar !== null && dagar >= 0 && dagar <= EXAM_HORIZON_DAYS) {
      add("exam_date", dagar === 0
        ? "Har prov idag."
        : `Har prov om ${dagar} ${dagar === 1 ? "dag" : "dagar"}.`);
    }
  }

  if (!säkra.length && !osäkra.length) return "";

  /* Den generella användningsinstruktionen stod tidigare här OCH i
     mastery-blocket OCH i historikblocket. Den samlas nu en gång i
     api/_learner-context.js, som är det enda som sätter ihop dem. */
  const rader = ["## OM ELEVEN", ""];

  if (säkra.length) rader.push(...säkra.map(r => `- ${r}`));

  /* Osäkra slutsatser står i ett eget block med en egen regel. Låg confidence
     får styra tonfall och svårighetsgrad, men aldrig sägas högt — det som
     presenteras som ett faktum om eleven måste vara något eleven själv sagt
     eller något appen faktiskt mätt. */
  if (osäkra.length) {
    rader.push("", "Osäkra iakttagelser — låt dem påverka HUR du svarar, men påstå dem aldrig som fakta:");
    rader.push(...osäkra.map(r => `- ${r}`));
  }

  return rader.join("\n");
}
