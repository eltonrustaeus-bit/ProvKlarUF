// api/_concept-tags.js — kanonisk form för begreppstaggar.
//
// grade.js låter modellen sätta ett `concept_tag` per fråga. Taggen är fritext,
// och fritext från en modell driver isär. Uppmätt på produktionsdata
// 2026-08-23, 99 taggar från tre elever:
//
//   "Konsumenträtt" · "Konsumenträttigheter" · "Konsumentens rättigheter"
//   "Tro och heder" · "Tro och Heder"
//   "Behörighet och befogenhet" · "Behörighet vs Befogenhet"
//   "Nervsystemets del" · "Nervsystemets delar" · "Nervsystemets funktioner"
//   "multiple_choice" · "math_short_answer" · "okänt" · "Okänt"
//
// Varje variant blev en egen rad i elevens mastery. Följden är att inget
// begrepp samlar tillräckligt många försök för att säga något — eleven har
// svarat fem gånger på konsumenträtt, men systemet ser tre begrepp med två,
// två och ett försök. Adaptiv svårighet på det underlaget adapterar på brus.
//
// Normaliseringen är deterministisk kod, inte en modell. Samma skäl som
// rekommendationsmotorn (docs/per/ARCHITECTURE.md §2): en elev ska kunna få
// veta varför två svar räknades som samma begrepp, och svaret ska bli likadant
// varje gång.

/* Frågetyper och tomma platshållare som läckt in där ett begrepp skulle stå.
   De är inte begrepp och får aldrig bli en rad i elevens kunskapsprofil. */
const NOT_A_CONCEPT = new Set([
  "multiple_choice", "math_short_answer", "short_answer", "essay", "mix",
  "okänt", "okant", "unknown", "n/a", "none", "-", "",
]);

/* Inledningar som beskriver UPPGIFTEN, inte begreppet. "Definition av marginal"
   och "Marginal" är samma begrepp mätt på två sätt. Ordningen spelar roll:
   längre fraser först, annars kapar den kortare mitt i den längre. */
const TASK_PREFIXES = [
  /^definition och exempel (på|av)\s+/i,
  /^förklaring och exempel (på|av)\s+/i,
  /^definition (på|av)\s+/i,
  /^förklaring (på|av)\s+/i,
  /^beräkning (på|av)\s+/i,
  /^exempel (på|av)\s+/i,
  /^typer av\s+/i,
  /^skillnader (i|mellan)\s+/i,
  /^begreppet\s+/i,
];

/* Svenska genitiv- och pluralformer av samma ord. Listan är avsiktligt kort och
   konservativ: en aggressiv stammare slår ihop begrepp som faktiskt skiljer sig
   ("ledare" och "led"), och två hopslagna begrepp är värre än två isärhållna —
   eleven får då feedback om något hen aldrig svarat på. */
const SUFFIXES = ["ernas", "arnas", "ornas", "ens", "ets", "erna", "arna", "orna", "er", "ar", "or", "en", "et", "s"];

/* Stammen måste bli minst 3 tecken. Med golvet på 4 stannade "delar" som
   "delar" medan "del" redan var 3, och "Nervsystemets del" respektive
   "Nervsystemets delar" blev två begrepp.

   Värdet är löst valt och inte finkalibrerat: mätt mot de 99 taggarna från
   produktionsdata ger 1 och 3 identiskt resultat, eftersom inget riktigt
   begrepp stammas ner under tre tecken. Golvet skyddar alltså mot ett fall
   som ännu inte inträffat. Sänk det inte utan att mäta om. */
const MIN_STEM = 3;

function stripSuffix(word) {
  if (word.length <= MIN_STEM) return word;
  for (const s of SUFFIXES) {
    if (word.length - s.length >= MIN_STEM && word.endsWith(s)) return word.slice(0, -s.length);
  }
  return word;
}

/* Bindeord som inte bär betydelse i en begreppstagg. "Garanti och öppet köp"
   och "Garanti vs Öppet köp" beskriver samma jämförelse. */
const STOPWORDS = new Set(["och", "vs", "i", "på", "av", "för", "till", "med", "eller", "samt", "mellan"]);

/**
 * Kanonisk nyckel för en begreppstagg. Två taggar som beskriver samma sak ska
 * ge samma nyckel. Används som lagringsnyckel, aldrig som visningstext.
 *
 * @returns {string} tom sträng när taggen inte är ett begrepp
 */
export function conceptKey(raw) {
  let text = String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!text) return "";

  /* Skräpkontrollen görs EFTER prefix-strippningen, inte före. En kontroll på
     råtexten först var redundant: orden i NOT_A_CONCEPT bär aldrig något
     uppgiftsprefix, så den andra kontrollen fångade redan varje fall.
     Sabotageverifieringen visade det — att ta bort den första raden ändrade
     ingenting. */
  text = text.toLocaleLowerCase("sv");
  for (const prefix of TASK_PREFIXES) {
    const stripped = text.replace(prefix, "");
    if (stripped !== text) { text = stripped.trim(); break; }
  }
  if (!text || NOT_A_CONCEPT.has(text)) return "";

  const words = text
    .split(/[^a-zåäö0-9]+/i)
    .filter(w => w && !STOPWORDS.has(w))
    .map(stripSuffix)
    .filter(Boolean);

  /* Ordföljd ska inte skilja två taggar åt: "svaghet och ocker" ≡ "ocker och svaghet".
     KÄND GRÄNS: svenska sammansättningar delas inte. "Konsumenträttigheter" är
     ett ord och "Konsumentens rättigheter" är två, så de får olika nycklar trots
     att de betyder samma sak. En sammansättningsdelare skulle fånga dem, men
     också slå ihop begrepp som bara delar ett förled ("Avtalsbrott" och
     "Avtalsgiltighet"). Två hopslagna begrepp är värre än två isärhållna: eleven
     får då återkoppling om något hen aldrig svarat på. Missen är alltså medveten. */
  return words.sort().join("_");
}

/**
 * Visningstexten för ett begrepp. Den FÖRSTA varianten systemet såg vinner, så
 * att etiketten är stabil över tid — en elev som sett "Konsumenträtt" ska inte
 * plötsligt se "Konsumentens rättigheter" för samma rad i sin profil.
 *
 * @param existingLabel  etiketten som redan finns lagrad, om någon
 */
export function conceptLabel(raw, existingLabel = "") {
  if (existingLabel) return existingLabel;
  const text = String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!text) return "";
  // Versal begynnelsebokstav, resten orört — modellen skriver ofta gement.
  return text.charAt(0).toLocaleUpperCase("sv") + text.slice(1);
}

/**
 * Slår ihop en lista taggar till kanoniska begrepp.
 * @returns {Array<{ key: string, label: string, sources: string[] }>}
 */
export function groupConcepts(tags) {
  const out = new Map();
  for (const tag of Array.isArray(tags) ? tags : []) {
    const key = conceptKey(tag);
    if (!key) continue;
    if (!out.has(key)) out.set(key, { key, label: conceptLabel(tag), sources: [] });
    out.get(key).sources.push(String(tag));
  }
  return [...out.values()];
}

/* Feltyperna grade.js sätter. Till skillnad från begreppen är de en STÄNGD
   lista i promptens schema, så de behöver ingen normalisering — bara en
   spärr mot att en modell hittar på en ny. Står här så att elevmodellen och
   rekommendationsmotorn läser samma lista. */
export const ERROR_CODES = Object.freeze([
  "mc_wrong", "concept_confusion", "definition_missing", "structure_weak",
  "calculation_error", "insufficient_material", "answer_key_unverified",
]);

export function isKnownErrorCode(code) {
  return ERROR_CODES.includes(String(code || ""));
}
