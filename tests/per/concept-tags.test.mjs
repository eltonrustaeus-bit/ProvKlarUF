// Kanonisk form för begreppstaggar (api/_concept-tags.js).
//
// Användning:  node tests/per/concept-tags.test.mjs   (exit 0 = pass)
//
// Taggen sätts av en modell och är fritext. Två fel är möjliga, och de är inte
// lika allvarliga:
//
//   MISSAD SAMMANSLAGNING  splittrar elevens historik. "Konsumenträtt" och
//   "Konsumenträttigheter" blir två rader med två försök var i stället för en
//   med fyra, och inget begrepp når tröskeln för att säga något.
//
//   FELAKTIG SAMMANSLAGNING  är värre. Slås två olika begrepp ihop får eleven
//   återkoppling om något hen aldrig svarat på, och mastery-siffran mäter en
//   blandning av två kunskaper. Testet låser därför BÅDA riktningarna, och de
//   negativa fallen är fler än de positiva med avsikt.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { conceptKey, conceptLabel, groupConcepts, ERROR_CODES, isKnownErrorCode, resolveConceptTag } =
  await import(join(root, "api", "_concept-tags.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};
const same = (a, b) => conceptKey(a) === conceptKey(b);

console.log("\n— SKA SLÅS IHOP —");
/* Varje par är uppmätt i produktionsdata 2026-08-23. */
for (const [a, b] of [
  ["Tro och heder", "Tro och Heder"],
  ["Behörighet och befogenhet", "Behörighet vs Befogenhet"],
  ["Garanti och öppet köp", "Garanti vs Öppet köp"],
  ["Presumption i KKöpL", "Presumption KKöpL"],
  ["Nervsystemets del", "Nervsystemets delar"],
  ["Nervsystemets funktion", "Nervsystemets funktioner"],
  ["Leder", "Typer av leder"],
  ["Definition av marginal", "Marginal"],
  ["Definition och exempel på flaskhals", "Flaskhals"],
  ["Beräkning av nollpunktsomsättning", "Nollpunktsomsättning"],
  ["Svaghet och Ocker", "Ocker och svaghet"],
  ["  fullmakt  ", "Fullmakt"],
]) check(`"${a}" ≡ "${b}"`, same(a, b), conceptKey(a));

console.log("\n— SKA HÅLLAS ISÄR —");
/* Det dyra felet. Varje par delar ord men är olika kunskap. */
for (const [a, b] of [
  ["Avtalsbrott", "Avtals giltighet"],
  ["Skelettets funktioner", "Skelettets uppbyggnad"],
  ["Skelettets sammansättning", "Skelettets funktioner"],
  ["Myelin funktion", "Myelin och nervimpulser"],
  ["Fullmakt", "Formalavtal"],
  ["Logaritmlagar", "Logaritmekvationer"],
  ["Särintäkt", "Särkostnad vs Samkostnad"],
  ["Ekvationer", "Exponentialekvationer"],
  ["Neuron typ", "Neuronens delar"],
  ["Konsumenträtt", "Konsumenträttigheter"],
]) check(`"${a}" ≠ "${b}"`, !same(a, b), `${conceptKey(a)} / ${conceptKey(b)}`);

console.log("\n— INTE ETT BEGREPP —");
/* Frågetyper och platshållare läckte in som begrepp i produktionsdata. De får
   aldrig bli en rad i en elevs kunskapsprofil. */
for (const skräp of ["multiple_choice", "math_short_answer", "short_answer", "essay",
                     "Okänt", "okänt", "unknown", "", "   ", null, undefined]) {
  check(`${JSON.stringify(skräp)} ger ingen nyckel`, conceptKey(skräp) === "");
}

console.log("\n— ETIKETTEN —");
check("etiketten får versal begynnelsebokstav", conceptLabel("fullmakt") === "Fullmakt");
/* Etiketten är stabil: eleven ska inte se raden byta namn mellan besök. */
check("en redan lagrad etikett vinner över en ny variant",
  conceptLabel("Konsumentens rättigheter", "Konsumenträtt") === "Konsumenträtt");
check("etiketten behåller versaler inuti", conceptLabel("KKöpL-presumtion") === "KKöpL-presumtion");

console.log("\n— GRUPPERING —");
const g = groupConcepts([
  "Tro och heder", "Tro och Heder", "multiple_choice", "Fullmakt", "okänt", "Typer av leder", "Leder",
]);
check("skräp faller bort", !g.some(c => c.label.includes("multiple")));
check("varianter blir en grupp", g.length === 3, g.map(c => c.label).join(" | "));
check("gruppen minns sina källor", g.find(c => c.label === "Tro och heder")?.sources.length === 2);
/* Leta på källan, inte på nyckelns exakta form — nyckeln är en intern
   stamning ("led"), och ett test som låser den formen går sönder varje gång
   stammaren justeras utan att något verkligt beteende ändrats. */
check("etiketten är den först sedda varianten",
  g.find(c => c.sources.includes("Leder"))?.label === "Typer av leder");
check("tom lista ger tom grupp", groupConcepts([]).length === 0 && groupConcepts(null).length === 0);

console.log("\n— FELKODER —");
check("feltyperna från produktionsdata är kända",
  ["mc_wrong", "concept_confusion", "definition_missing", "structure_weak", "insufficient_material"]
    .every(isKnownErrorCode));
check("en påhittad feltyp avvisas", !isKnownErrorCode("gjord_upp_av_modellen"));
check("felkodslistan är fryst", Object.isFrozen(ERROR_CODES));

console.log("\n— STABILITET —");
check("samma indata ger samma nyckel varje gång",
  conceptKey("Behörighet vs Befogenhet") === conceptKey("Behörighet vs Befogenhet"));
check("nyckeln innehåller bara tecken som är säkra att lagra",
  ["Fel i varan", "KKöpL", "Ångerrätt", "35 % av x"].every(t => /^[a-zåäö0-9_]*$/.test(conceptKey(t))));

console.log("\n— BEGREPPSTAGG UR EN FRÅGA —");
/* Uppmätt i produktionsdata: 42 av 72 rättade frågor hade tom concept_tag och
   gav noll kunskapsdata. Flervalsfrågor rättas deterministiskt (ingen AI sätter
   taggen) och generate-exam satte inte fältet före 2026-08-23. Frågorna bär
   ändå begreppet i subtopic/topic — men de två följer INGEN konsekvent
   hierarki, så fältet kan inte väljas blint. */
const rt = (q, g) => resolveConceptTag(q, g);

check("concept_tag vinner när den finns",
  rt({ topic: "X", subtopic: "Y", concept_tag: "Fotosyntes" }) === "Fotosyntes");
check("rättningens egen tagg vinner över frågans",
  rt({ concept_tag: "Gammal" }, { concept_tag: "Derivata" }) === "Derivata");
check("subtopic används när concept_tag saknas",
  rt({ topic: "Konsumenträtt", subtopic: "Bytesrätt" }) === "Bytesrätt");

/* Hierarkin är omvänd i produktionsdata: {topic:"Presumption", subtopic:"KKöpL"}.
   Regeln kan inte veta vilken som är begreppet — den tar den mest specifika
   som DUGER, och normaliseringen gör resten. */
check("omvänd hierarki ger ändå en användbar tagg",
  rt({ topic: "Presumption", subtopic: "KKöpL" }) === "KKöpL");

/* Det dyra fallet: ett generiskt subtopic ser ut som en riktig tagg men säger
   ingenting om vad eleven kan. "Principer" som begrepp är sämre än inget. */
for (const [generisk, väntat] of [
  ["Principer", "Garanti och öppet köp"],
  ["Allmän del", "Garanti och öppet köp"],
  ["Övrigt", "Garanti och öppet köp"],
  ["Sammanfattning", "Garanti och öppet köp"],
  ["teori", "Garanti och öppet köp"],
]) {
  check(`generiskt subtopic "${generisk}" hoppas över`,
    rt({ topic: "Garanti och öppet köp", subtopic: generisk }) === väntat);
}

check("frågetyp som subtopic hoppas över",
  rt({ topic: "Ekvationer", subtopic: "multiple_choice" }) === "Ekvationer");
/* Modellen svarar "Okänt" när den inte kan peka ut ett begrepp. Den strängen är
   en platshållare och blev tidigare en rad i elevens kunskapsprofil. */
check("platshållaren Okänt hoppas över till förmån för frågan",
  rt({ topic: "Ekvationer" }, { concept_tag: "Okänt" }) === "Ekvationer");
check("allt tomt ger tom tagg", rt({ topic: "", subtopic: "" }) === "");
check("allt generiskt ger tom tagg", rt({ topic: "Övrigt", subtopic: "Principer" }) === "");
check("saknad fråga kraschar inte", rt(undefined, undefined) === "" && rt(null, null) === "");

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
