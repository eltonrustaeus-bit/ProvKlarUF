// Bron mellan rättningen och elevloopen (api/_per-attempt.js).
//
// Användning:  node tests/per/per-attempt.test.mjs   (exit 0 = pass)
//
// BAKGRUNDEN ÄR EN ARKITEKTURUPPTÄCKT, inte en bugg.
//
// ExGen hade två parallella kunskapssystem som inte matade varandra:
//   api/grade.js     → apply_mock_mastery() → user_profiles.mastery
//   api/knowledge.js → orchestrator → commitAssessment() → student_attempts
//
// `_per-collective.js` läser student_attempts. Skrivvägen dit går bara genom
// kunskapsmotorn, som är juridikpiloten och begränsad till ett konto. Det
// kollektiva lagret kunde därför ALDRIG få data, hur många elever som än
// pluggade. Uppmätt 2026-08-25: 0 rader i student_attempts och
// student_error_events, medan user_profiles.mastery hade rader.
//
// Den saknade länken är begrepps-id: grade.js har taggar som text,
// student_attempts vill ha en UUID mot `concepts`, och ett försök utan
// concept_id filtreras bort av concept_collective_stats.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const A = await import(join(root, "api", "_per-attempt.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

console.log("\n— POÄNG SOM SAKNAS ÄR INTE POÄNG NOLL —");
/* DET DYRASTE FELET I DEN HÄR FILEN, och det fanns i första versionen.
   Number(null) är 0 och Number("") är 0, och 0 är finit. En fråga som aldrig
   bedömts blev därför ett registrerat NOLLRESULTAT: eleven hade fått fel på
   arbete de aldrig fick bedömt, och mastery hade dragits ner på det.
   Skillnaden mellan "inte mätt" och "mätt och noll" är samma skillnad som
   TOO_FEW i _per-pulse.js och null-aktivitet i _per-brain.js. */
for (const [namn, v] of [["undefined", undefined], ["null", null], ["tom sträng", ""], ["text", "abc"], ["NaN", NaN]]) {
  check(`${namn} ger null, inte 0`, A.normaliseraPoäng(v) === null, String(A.normaliseraPoäng(v)));
}
check("en äkta nolla är fortfarande en nolla", A.normaliseraPoäng(0) === 0);
check("halv poäng bevaras", A.normaliseraPoäng(0.5) === 0.5);
check("full poäng bevaras", A.normaliseraPoäng(1) === 1);
/* En rubric med delpoäng kan i sällsynta fall summera över 1. */
check("över 1 kläms", A.normaliseraPoäng(1.4) === 1);
check("under 0 kläms", A.normaliseraPoäng(-0.3) === 0);

check("en fråga utan poäng blir inget försök alls",
  A.buildAttempt({ userId: "u1", q: { id: "q1" } }) === null);
check("men en fråga med noll poäng blir ett försök",
  A.buildAttempt({ userId: "u1", q: { id: "q1", score: 0 } })?.assessment.score === 0);

console.log("\n— BEGREPPSNYCKELN —");
check("svenska tecken normaliseras", A.conceptSlug("Bråk") === "brak");
check("mellanslag och tecken blir bindestreck", A.conceptSlug("Ekvationer & uttryck") === "ekvationer-uttryck");
check("versaler spelar ingen roll", A.conceptSlug("DERIVATA") === A.conceptSlug("derivata"));
check("tomt ger tomt", A.conceptSlug("") === "" && A.conceptSlug(null) === "");

/* En tagg som "Okänt" eller "multiple_choice" skulle skapa ett skräpbegrepp
   som sedan syns i den kollektiva statistiken som om det vore ett ämne. */
console.log("\n— SKRÄPTAGGAR BLIR INGA BEGREPP —");
for (const t of ["Okänt", "okänt", "multiple_choice", "short_answer", "Principer", "Allmän del", "", "ab"]) {
  check(`"${t}" är inget begrepp`, A.isRealConcept(t) === false);
}
for (const t of ["Bråk", "Derivata", "Konsumenträtt", "Andragradsekvationer"]) {
  check(`"${t}" är ett begrepp`, A.isRealConcept(t) === true);
}

console.log("\n— RADEN SOM SKRIVS —");
const rad = A.buildAttempt({
  userId: "u1", conceptId: "c-1", level: "C", examId: "e9",
  q: { id: "q3", score: 0.5, answer: "x = 8" },
});
check("användaren följer med", rad.userId === "u1");
check("begreppet följer med", rad.conceptId === "c-1");
check("nivån följer med", rad.level === "C");
check("elevens svar följer med", rad.studentAnswer === "x = 8");
check("halv poäng är inte rätt svar", rad.assessment.is_correct === false);
check("full poäng är rätt svar",
  A.buildAttempt({ userId: "u1", q: { id: "q", score: 1 } }).assessment.is_correct === true);

/* Flervalsfrågor rättas deterministiskt mot facit; fritext bedöms av en
   modell. Att ge båda samma confidence hade gjort en modellgissning lika
   tungt vägande som en facitjämförelse. */
check("flerval är deterministiskt och säkert",
  (() => { const r = A.buildAttempt({ userId: "u1", q: { id: "q", score: 1, options: ["a", "b"] } });
    return r.questionType === "multiple_choice" && r.assessment.method === "deterministic" && r.assessment.confidence === 1; })());
check("fritext är modellbedömt och mindre säkert",
  rad.questionType === "short_answer" && rad.assessment.method === "model" && rad.assessment.confidence < 1);

console.log("\n— IDEMPOTENS —");
/* Utan nyckeln dubblar en omrättning underlaget, och den kollektiva
   statistiken blir fel åt det håll ingen märker: fler försök på samma svar
   ser ut som mer övning. */
const a1 = A.buildAttempt({ userId: "u1", q: { id: "q3", score: 1 }, examId: "e9" });
const a2 = A.buildAttempt({ userId: "u1", q: { id: "q3", score: 0 }, examId: "e9" });
check("samma prov och fråga ger samma nyckel", a1.idempotencyKey === a2.idempotencyKey, a1.idempotencyKey);
check("annan fråga ger annan nyckel",
  A.buildAttempt({ userId: "u1", q: { id: "q4", score: 1 }, examId: "e9" }).idempotencyKey !== a1.idempotencyKey);
check("annat prov ger annan nyckel",
  A.buildAttempt({ userId: "u1", q: { id: "q3", score: 1 }, examId: "e8" }).idempotencyKey !== a1.idempotencyKey);

console.log("\n— DET SOM INTE FÅR SKRIVAS —");
check("utan användare blir det inget försök", A.buildAttempt({ q: { id: "q", score: 1 } }) === null);
/* Återkopplingen visas i provet. Att spara den i loggen vore att lagra en
   fritext om elevens arbete utan att någon behöver den där. */
check("återkopplingstexten sparas inte", rad.assessment.feedback_student === null);
check("nästa-steg-tipset sparas inte", rad.assessment.next_step_hint === null);
check("en okänd nivå faller tillbaka på E",
  A.buildAttempt({ userId: "u1", q: { id: "q", score: 1 }, level: "Z" }).level === "E");

console.log("\n— BEGREPPSUPPSLAGET RÖR INGEN DATABAS VID SKRÄP —");
let anrop = 0;
const spionerande = { from: () => { anrop++; return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }; } };
await A.ensureConceptId(spionerande, { subject: "Matematik", tag: "Okänt" });
check("en skräptagg ger inget databasanrop", anrop === 0, `${anrop} anrop`);
check("utan klient returneras null", await A.ensureConceptId(null, { subject: "M", tag: "Bråk" }) === null);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
