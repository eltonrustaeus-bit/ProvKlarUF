// api/_per-collective.js — P.E.R:s kollektiva lager.
//
// Det här är svaret på "P.E.R ska lära sig av alla elevers frågor och svar", byggt utan
// att spara någons frågor eller svar. api/_per-memory.js har sedan start regeln att exakt
// frågetext aldrig lagras, och den regeln gäller fortfarande. Underlaget kommer i stället
// från det som redan skrivs vid varje rättning: poäng per begrepp och nivå
// (student_attempts) och en avidentifierad etikett för missuppfattningen
// (student_error_events.error_code).
//
// Vyn concept_collective_stats gör sammanräkningen och släpper bara igenom begrepp med
// minst fem distinkta elever. Se migrationen för spärrarna.
//
// Vad det ger P.E.R som en generell AI inte kan ha: kunskap om HUR andra elever brukar
// gå fel på just det här begreppet. En modell utan produktdata kan förklara ett begrepp;
// den kan inte veta att två tredjedelar av eleverna fastnar på samma delsteg.

const MIN_ATTEMPTS = 20;      // under detta är siffran brus, inte ett mönster
const MAX_CONCEPTS = 3;       // taket håller blocket kort — det ska informera, inte dominera

/** Hämtar kollektiv statistik för de begrepp eleven faktiskt håller på med.
 *  Returnerar [] vid fel av vilket slag som helst: saknad vy, saknad behörighet,
 *  nätverksfel. Kollektiv data är en förstärkning, aldrig ett krav — går den inte att
 *  läsa ska P.E.R svara precis som förut, inte fela. */
export async function loadCollectiveSignals(supabase, { course = null, topics = [] } = {}) {
  if (!supabase) return [];
  const wanted = [course, ...(Array.isArray(topics) ? topics : [])]
    .filter(t => typeof t === "string" && t.trim().length > 1)
    .map(t => t.trim());
  if (!wanted.length) return [];

  try {
    let q = supabase
      .from("concept_collective_stats")
      .select("concept_name, course, topic, attempt_count, student_count, p_correct, mean_score, common_error_codes")
      .gte("attempt_count", MIN_ATTEMPTS)
      .order("p_correct", { ascending: true })   // svårast först — det är där hjälpen behövs
      .limit(MAX_CONCEPTS);

    // or() med kommatecken i värdet bryter PostgREST-syntaxen, så avgränsarna städas bort.
    const safe = wanted.map(t => t.replace(/[,()*]/g, " ").trim()).filter(Boolean);
    if (!safe.length) return [];
    q = q.or(safe.map(t => `course.ilike.%${t}%,topic.ilike.%${t}%,concept_name.ilike.%${t}%`).join(","));

    const { data, error } = await q;
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

/** Formaterar signalerna till ett promptblock. Tom sträng när underlag saknas — då ska
 *  ingen rubrik synas alls, annars börjar modellen prata om data den inte har. */
export function buildCollectiveBlock(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const lines = rows.map(r => {
    const pct = Math.round((Number(r.p_correct) || 0) * 100);
    const errs = Array.isArray(r.common_error_codes) && r.common_error_codes.length
      ? ` Vanligaste felmönstren: ${r.common_error_codes.join(", ")}.`
      : "";
    return `- ${r.concept_name}: ${pct}% rätt över ${r.student_count} elever och ${r.attempt_count} svar.${errs}`;
  });
  return `## KOLLEKTIV DATA (alla ExGen-elever, avidentifierat)
${lines.join("\n")}

Så använder du det:
- Är eleven på väg in i ett felmönster som listas ovan — flagga det INNAN de går i fällan, inte efter.
- Ett lågt tal är normaliserande, inte nedslående: "det här är den del som flest fastnar på" tar bort skammen och gör att eleven vågar fråga vidare.
- Nämn kollektiv data högst en gång per svar, och bara när den ändrar vad eleven bör göra.
- Säg aldrig något om en enskild annan elev. Du har bara sammanräknade tal, aldrig någons svar.`;
}
