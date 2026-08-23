// Elevens kunskapsläge (api/_mastery-view.js).
//
// Användning:  node tests/per/mastery-view.test.mjs   (exit 0 = pass)
//
// Det här lagret avgör vad P.E.R. VÅGAR PÅSTÅ om vad en elev kan. Två fel är
// möjliga och båda kostar förtroende:
//
//   PÅSTÅ FÖR TIDIGT. En siffra med ett försök bakom sig är tur eller otur.
//   Säger P.E.R. "du har svårt för fullmakter" efter ett enda felsvar har den
//   dömt en elev på ingenting. Tröskeln på tre försök är hela skyddet.
//
//   LÄCKA SKALAN. mastery är en intern 0–100-siffra. Säger P.E.R. "din mastery
//   är 43" har eleven fått ett betyg ingen satt, från en skala ingen förklarat.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mv = await import(join(root, "api", "_mastery-view.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const NU = new Date("2026-08-23T12:00:00Z");
const dagarSen = d => new Date(NU.getTime() - d * 86_400_000).toISOString();
const rad = (score, attempts, label, dagar = 0) =>
  ({ score, attempts, label, last_seen: dagarSen(dagar) });

console.log("\n— LÄSNING —");
check("tom karta ger tom lista", mv.readMastery({}).length === 0);
check("null ger tom lista", mv.readMastery(null).length === 0);
check("en array är inte en mastery-karta", mv.readMastery([1, 2]).length === 0);

/* Klientskrivningen lagrade rena tal. De raderna finns kvar i produktion och
   får inte kastas — men antalet försök är okänt och ska aldrig gissas till
   något som ser belagt ut. */
const gammal = mv.readMastery({ fullmakt: 82 }, { now: NU });
check("gammal form (rent tal) läses", gammal.length === 1 && gammal[0].score === 82);
check("gammal form räknas som obelagd", gammal[0].trusted === false, `attempts=${gammal[0].attempts}`);

const ny = mv.readMastery({ fullmakt: rad(82, 5, "Fullmakt") }, { now: NU });
check("ny form läses", ny[0].score === 82 && ny[0].attempts === 5);
check("etiketten följer med", ny[0].label === "Fullmakt");
check("tre försök räcker för att vara belagd",
  mv.readMastery({ x: rad(50, 3, "X") }, { now: NU })[0].trusted === true);
check("två försök räcker inte",
  mv.readMastery({ x: rad(50, 2, "X") }, { now: NU })[0].trusted === false);
check("skräpvärden hoppas över",
  mv.readMastery({ a: "text", b: null, c: rad(60, 4, "C") }, { now: NU }).length === 1);
check("siffran klipps till skalan",
  mv.readMastery({ a: rad(500, 4, "A"), b: rad(-20, 4, "B") }, { now: NU })
    .every(r => r.score >= 0 && r.score <= 100));

console.log("\n— NÄSTA STEG —");
const next = (m) => mv.decideNextFocus(m, { now: NU });

check("tom profil ger inget steg", next({}) === null);

/* R1: svagt och belagt går före allt. */
const r1 = next({
  svag: rad(20, 6, "Konsumenträtt"),
  stark: rad(90, 8, "Fullmakt"),
  ny: rad(50, 1, "Svek"),
});
check("ett svagt belagt begrepp vinner", r1?.action === "träna_svagt", r1?.label);
check("skälet nämner både siffra och antal försök",
  /20 av 100/.test(r1.reason) && /6 försök/.test(r1.reason), r1.reason);

/* R2: obeprövat före gammalt starkt — att veta något nytt är mer värt än att
   bekräfta något känt. */
const r2 = next({ stark: rad(90, 9, "Fullmakt"), ny: rad(50, 1, "Svek") });
check("ett obeprövat begrepp går före ett starkt", r2?.action === "bekräfta_nivå", r2?.label);

/* R3: starkt men gammalt. */
const r3 = next({ gammal: rad(88, 7, "Avtalsrätt", 40), färsk: rad(85, 7, "Fullmakt", 1) });
check("ett gammalt starkt begrepp ger repetition", r3?.action === "repetera", r3?.label);
check("skälet nämner hur länge sen", /40 dagar/.test(r3.reason), r3.reason);

/* R4: allt belagt, färskt och starkt — höj svårigheten. */
const r4 = next({ a: rad(88, 7, "Avtalsrätt", 1), b: rad(80, 7, "Fullmakt", 2) });
check("allt starkt och färskt höjer svårigheten", r4?.action === "höj_svårighet", r4?.label);

/* Ett svagt begrepp med för få försök får INTE utlösa "träna svagt" — då hade
   ett enda olycksfall dömt eleven. */
const r5 = next({ otur: rad(10, 1, "Svek") });
check("ett enda felsvar utlöser inte 'träna svagt'", r5?.action !== "träna_svagt", r5?.action);

console.log("\n— PROMPTBLOCKET —");
const ctx = (m, o) => mv.buildMasteryContext(m, { now: NU, ...o });

check("tom profil ger inget block", ctx({}) === "");
check("bara obelagda begrepp ger inget block",
  ctx({ a: rad(20, 1, "A"), b: rad(30, 2, "B") }) === "");
check("gammal form ensam ger inget block (obelagd)", ctx({ fullmakt: 82 }) === "");

const block = ctx({
  svag: rad(25, 6, "Konsumenträtt"),
  stark: rad(88, 7, "Fullmakt"),
  mitten: rad(60, 5, "Svek"),
});
check("blocket har en rubrik", block.startsWith("## ELEVENS KUNSKAPSLÄGE"));
check("svaga områden namnges", block.includes("Konsumenträtt"));
check("starka områden namnges", block.includes("Fullmakt"));
check("nästa steg finns med", /Nästa steg enligt elevens data/.test(block));
/* Skalan får aldrig nå eleven. */
check("blocket förbjuder att siffran läses upp", /säg aldrig\s+'din mastery är X'/.test(block));
/* Den generella "nämn inte i onödan"-instruktionen låg tidigare även här. Den
   samlas nu en gång i _learner-context.js och testas där — det som måste stå
   kvar i DET HÄR blocket är skalregeln, som bara gäller dessa siffror. */
check("skalregeln hör hemma i mastery-blocket", /Skalan 0–100 är intern/.test(block));

/* Ett begrepp som eleven frågar om ska lyftas — men bara om det finns. */
const träff = ctx({ fullmakt: rad(40, 5, "Fullmakt") }, { topic: "Fullmakt" });
check("det efterfrågade begreppet lyfts", /Just det här begreppet/.test(träff));
const missTräff = ctx({ fullmakt: rad(40, 5, "Fullmakt") }, { topic: "Derivata" });
check("ett orelaterat ämne lyfter inget begrepp", !/Just det här begreppet/.test(missTräff));
/* Normaliseringen ska gälla även här: "fullmakter" är samma begrepp. */
check("ämnesmatchningen använder samma normalisering",
  /Just det här begreppet/.test(ctx({ fullmakt: rad(40, 5, "Fullmakt") }, { topic: "fullmakter" })));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
