// api/_per-attempt.js — bron mellan rättningen och elevloopen.
//
// VARFÖR DEN BEHÖVS
//
// ExGen hade två parallella kunskapssystem som inte matade varandra:
//
//   api/grade.js  → apply_mock_mastery() → user_profiles.mastery
//   api/knowledge.js → orchestrator → commitAssessment() → student_attempts
//
// Det första kör vid varje rättat prov. Det andra går genom kunskapsmotorn,
// som är juridikpiloten och begränsad till ett konto. `_per-collective.js`
// läser `student_attempts` — alltså från det system som i praktiken aldrig
// kör. Kollektiva lagret kunde därför ALDRIG få data, oavsett hur många elever
// som pluggade. Uppmätt 2026-08-25: 0 rader i student_attempts, 0 i
// student_error_events, medan mastery hade rader.
//
// DEN SAKNADE LÄNKEN ÄR BEGREPPS-ID.
// grade.js arbetar med `concept_tag`, en normaliserad textsträng.
// student_attempts.concept_id är en UUID-referens till `concepts`. Ett försök
// utan concept_id filtreras bort av concept_collective_stats, så en skrivning
// utan uppslag hade gett rader som inte bidrar med något.
//
// RIKTNINGEN FRAMÅT: student_attempts är sanningen. Per försök med begrepp,
// nivå, poäng och felkod är finare upplösning än en mastery-siffra, och
// mastery går att räkna FRAM ur den. Den här modulen är första steget dit.

/** Samma normalisering som _concept-tags.js, men på slug-form för `concepts`. */
export function conceptSlug(tag) {
  return String(tag || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // å→a, ä→a, ö→o
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* Taggar som ser ut som begrepp men inte är det. Samma lista som
   resolveConceptTag() hoppar över — en tagg som "Okänt" eller "multiple_choice"
   skulle skapa ett skräpbegrepp som sedan syns i den kollektiva statistiken. */
const EJ_BEGREPP = new Set([
  "okant", "okänt", "allman-del", "principer", "multiple-choice", "short-answer",
  "ovrigt", "annat", "diverse", "",
]);

export function isRealConcept(tag) {
  const slug = conceptSlug(tag);
  return !!slug && slug.length >= 3 && !EJ_BEGREPP.has(slug);
}

/**
 * Slår upp eller skapar begreppet och ger dess id.
 *
 * `concepts.review_status` blir 'pending' som default, vilket är rätt: ett
 * begrepp som uppstått ur en elevs prov är inte kurerat. Det duger ändå som
 * etikett att gruppera på.
 *
 * Returnerar null vid varje fel eller på en tagg som inte är ett begrepp.
 * Hellre ett försök utan begreppskoppling än ett skräpbegrepp i statistiken.
 */
export async function ensureConceptId(supabase, { subject, tag, course = null, topic = null }) {
  if (!supabase || !isRealConcept(tag)) return null;
  const slug = conceptSlug(tag);
  const ämne = String(subject || "okänt").slice(0, 80);

  try {
    const { data: fanns } = await supabase
      .from("concepts").select("id")
      .eq("subject", ämne).eq("slug", slug).maybeSingle();
    if (fanns?.id) return fanns.id;

    const { data: ny } = await supabase
      .from("concepts")
      .insert({ subject: ämne, slug, name: String(tag).slice(0, 120), course, topic })
      .select("id").maybeSingle();
    if (ny?.id) return ny.id;

    /* Kapplöpning: två rättningar samtidigt kan båda missa i select och båda
       försöka skapa. Unik-villkoret (subject, slug) fäller den andra, och då
       finns raden — läs om i stället för att ge upp. */
    const { data: igen } = await supabase
      .from("concepts").select("id")
      .eq("subject", ämne).eq("slug", slug).maybeSingle();
    return igen?.id ?? null;
  } catch {
    return null;
  }
}

/* Poängen kommer som andel rätt (0–1) från rättningen. student_attempts vill
   ha samma skala, så ingen omräkning — men den måste klämmas: en rubric som
   ger delpoäng kan i sällsynta fall summera över 1. */
export function normaliseraPoäng(p) {
  /* null, undefined och tom sträng måste avvisas FÖRE Number().
     Number(null) är 0 och Number("") är 0, och 0 är finit — så en fråga som
     aldrig bedömts hade blivit ett registrerat NOLLRESULTAT. Det hade skrivit
     in att eleven fått fel på arbete de aldrig fick bedömt, och dragit ner
     mastery på det. Uppmätt i första versionen av den här funktionen. */
  if (p === null || p === undefined || p === "") return null;
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/**
 * Bygger raden som skrivs. REN funktion — hela formen går att testa utan
 * databas, och det är formen som avgör om den kollektiva statistiken kan
 * gruppera på något.
 *
 * @param q          den rättade frågan
 * @param conceptId  ur ensureConceptId(), får vara null
 */
export function buildAttempt({ userId, q = {}, conceptId = null, level = "E", examId = null } = {}) {
  if (!userId) return null;

  const poäng = normaliseraPoäng(q.score ?? q.points ?? null);
  if (poäng === null) return null;

  const typ = q.options || q.option_a || q.type === "multiple_choice"
    ? "multiple_choice" : "short_answer";

  return {
    userId,
    // Idempotens: samma prov och fråga får bara ge ett försök, hur många gånger
    // rättningen än körs om. Utan den skulle en omrättning dubbla underlaget
    // och göra kollektiva statistiken fel åt det håll ingen märker.
    idempotencyKey: `${examId || "utan-prov"}::${q.id ?? q.question_id ?? q.number ?? "?"}`,
    questionId: null,        // provfrågor bor inte i knowledge_chunks
    conceptId,
    questionType: typ,
    level: ["E", "C", "A"].includes(level) ? level : "E",
    studentAnswer: q.student_answer ?? q.answer ?? null,
    assessment: {
      is_correct: poäng >= 0.999,
      score: poäng,
      // Rättningen är en modellbedömning, inte en facitjämförelse. 0.7 speglar
      // det: säker nog att räkna på, inte säker nog att påstå något enskilt om.
      confidence: typ === "multiple_choice" ? 1 : 0.7,
      method: typ === "multiple_choice" ? "deterministic" : "model",
      dimensions: q.dimensions ?? null,
      error_code: q.error_code ?? null,
      error_severity: q.error_severity ?? null,
      misconception: q.misconception ?? null,
      strengths: q.strengths ?? null,
      missing_points: q.missing_points ?? null,
      feedback_student: null,   // återkopplingen visas i provet, inte i loggen
      next_step_hint: null,
      grounded: false,
      disagreement: false,
    },
  };
}
