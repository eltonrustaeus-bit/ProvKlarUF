// api/_per-name.js — vad P.E.R heter och vad bokstäverna betyder, på ETT ställe.
//
// Repot bar tre konkurrerande beskrivningar samtidigt: "ExGens Egna AI-Resource" i åtta
// prompter och två sidor, "ExGens AI-motor" i fem, och lösa varianter därutöver. En modell
// som presenterar sig olika beroende på vilken rutt eleven råkar träffa läser som tre
// produkter. Därför ligger namnet här och importeras — inte skrivs av.
//
// Medvetet utan beroenden. Filen importeras av grade.js, teacher-report.js, check-role.js,
// explain.js och _per-core.js; hade den importerat något av dem hade det blivit en cykel.

export const PER_SHORT = "P.E.R";
export const PER_EXPANSION = "Progressive Evidence Reasoning";
export const PER_FULL = `${PER_SHORT} — ExGens ${PER_EXPANSION}-modell`;

// Bokstäverna beskriver hur systemet faktiskt fungerar, inte hur det marknadsförs.
// Varje rad pekar på något som finns i koden:
//   P — hjälpstegen 0–3 i buildPERSystemPrompt (motfråga, koncept, steg-för-steg, full lösning)
//   E — evidenskedjan: student_attempts.assessment/confidence, felbanken, concept_collective_stats
//   R — feynman- och steg-för-steg-lägena, som visar tankegången i stället för bara svaret
// Ändras något av det ska den här texten ändras med, annars beskriver den en annan produkt.
export const PER_MEANING = `**P — Progressive.** Hjälpen trappas. Första svaret är en motfråga som får dig att tänka själv; djupare förklaring, steg-för-steg och fullständig lösning kommer bara när du faktiskt behöver dem.
**E — Evidence.** Varje bedömning vilar på underlag: dina svar, din felbank, rättningarna och avidentifierad data från alla ExGen-elever. Aldrig gissningar.
**R — Reasoning.** Du får tankegången, inte bara facit. Det är resonemanget som gör att nästa fråga också går att lösa.`;

/** Rollraden överst i en systemprompt. `suffix` lägger till rollen för den aktuella rutten,
 *  t.ex. "professionell provrättare". Utan suffix blir det bara modellens namn. */
export function perRole(suffix = "") {
  return suffix ? `${PER_FULL}, ${suffix}` : PER_FULL;
}

/** Kort block som förklarar bokstäverna. Bifogas bara när någon frågar vad P.E.R står för —
 *  det hör inte hemma i varje studiesvar. */
export function buildPerNameBlock() {
  return `## VAD P.E.R BETYDER
${PER_SHORT} står för **${PER_EXPANSION}** — ExGens egen modell för studiestöd.

${PER_MEANING}

Får du frågan "vad står P.E.R för?": svara med de tre orden och en mening om vad var och en innebär i praktiken. Kort. Det är ett svar, inte en presentation.`;
}

// Triggar bara på frågor om namnet självt.
export const PER_NAME_TRIGGER_REGEX =
  /vad (står|betyder|innebär) (p\.?e\.?r|per)\b|p\.?e\.?r (står för|betyder)|förkortning(en)? (p\.?e\.?r|per)\b|what does p\.?e\.?r stand for/i;
