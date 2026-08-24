// api/_provia-roadmap.js — ExGens nästa steg, som P.E.R. får berätta om.
//
// Frågan "vad är nästa stora plan för ExGen" ställs av investerare, lärare,
// UF-jury och nyfikna besökare. Utan ett svar hittar modellen på ett, och en
// påhittad roadmap är värre än ingen: den lovar saker ingen tänkt bygga.
//
// EN GRÄNS SOM MÅSTE HÅLLA:
//
// Alléskolan är en riktig skola med riktiga elever. Det finns INGEN kontakt,
// inget avtal och inget samarbete i skrivande stund (2026-08-24). P.E.R. får
// beskriva piloten som det den är — ExGens egen ambition, byggd på skolans
// offentliga resultat — och får ALDRIG antyda att skolan är involverad,
// tillfrågad eller positiv.
//
// Skillnaden är inte kosmetisk. Ett påstående om att ExGen samarbetar med en
// namngiven kommunal skola är kontrollerbart falskt, och den som kontrollerar
// det är skolan själv.
//
// All statistik nedan är hämtad ur Skolverkets utbildningsguide och gäller
// läsåret 2024/25. Siffrorna står här EN gång och citeras aldrig ur minnet.

/* Källa: Skolverkets utbildningsguide, skolenhet 56528690, läsår 2024/25.
   https://utbildningsguiden.skolverket.se/skolenhet?schoolUnitID=56528690 */
export const ALLESKOLAN = Object.freeze({
  namn: "Alléskolan 7-9",
  ort: "Åtvidaberg",
  årskurser: "7–9",
  elever: 340,
  läsår: "2024/25",
  källa: "Skolverkets utbildningsguide",
  meritvärde: { skolan: 202.7, riket: 228.5 },
  kunskapskravenAllaÄmnen: { skolan: 53, modellberäknat: 65 },
  nationelltProv: Object.freeze({
    matematik: { skolan: 8.7, riket: 11.4 },
    svenska: { skolan: 11.8, riket: 13.1 },
    engelska: { skolan: 15.1, riket: 15.8 },
  }),
});

/* ── Två frågor, två svar ──────────────────────────────────────────────────
 *
 * VISION är frågan de flesta ställer: vart är ExGen på väg, vad vill ni. Svaret
 * gäller hela produkten och alla elever — inte ett ämne och inte en skola.
 *
 * ALLÉSKOLAN är en specifik pilot i matematik. Den ska bara komma upp när
 * någon frågar om just den. Att svara "vi ska hjälpa en skola i Åtvidaberg med
 * matte" på frågan om ExGens vision gör produkten mindre än den är: det låter
 * som ett lokalt matteprojekt i stället för en studieplattform för hela
 * grundskolan och gymnasiet.
 *
 * Före uppdelningen var det ETT block, och varje visionsfråga gav
 * Alléskolan-pitchen.
 */

/* Bred: vart ExGen är på väg. Kräver att frågan gäller företaget — "vad är
   nästa steg i uppgiften" är en studiefråga. */
export const VISION_TRIGGER_REGEX = new RegExp(
  [
    "\\b(?:n[äa]sta|kommande|framtida)\\s+(?:stora?\\s+)?(?:plan\\w*|steg|sats\\w*|milstolpe\\w*)\\b[^?.!]{0,30}\\b(?:exgen|ni|er|din|dina)\\b",
    "\\b(?:exgens?|era?|eran|ni)\\b[^?.!]{0,25}\\b(?:n[äa]sta|kommande|framtida)\\s+(?:stora?\\s+)?(?:plan\\w*|steg|sats\\w*|milstolpe\\w*)",
    "\\broadmap\\b",
    "\\b(?:er|eran|exgens)\\s+vision\\b",
    "\\bvad\\s+är\\s+(?:er|eran|exgens)\\s+vision",
    "vart\\s+(?:är|ska)\\s+(?:ni|exgen|du)\\s+p[åa]\\s+v[äa]g",
    "vad\\s+h[äa]nder\\s+(?:h[äa]rn[äa]st|sen|fram[öo]ver)\\s+(?:med|f[öo]r)\\s+exgen",
    "exgens?\\s+framtid",
    "vad\\s+(?:ska|t[äa]nker)\\s+(?:ni|exgen)\\s+g[öo]ra\\s+(?:h[äa]rn[äa]st|sen|nu|fram[öo]ver)",
    "\\b(?:exgens?|era?|eran|ni)\\b[^?.!]{0,20}\\bplan(?:en|er|erna|ering\\w*)?\\b",
    "\\bplan(?:er|erna|ering\\w*)\\b[^?.!]{0,20}\\b(?:exgen|ni|er|eran)\\b",
    "\\bm[åa]let?\\s+(?:med|f[öo]r)\\s+exgen",
    "vad\\s+vill\\s+(?:ni|exgen)\\s+(?:uppn[åa]|åstadkomma|f[öo]r[äa]ndra)",
  ].join("|"),
  "i"
);

/* Smal: skolan måste nämnas vid namn. Utan det kravet dök en enskild pilot upp
   som svar på varje fråga om vart företaget är på väg. */
export const ALLESKOLAN_TRIGGER_REGEX = /all[ée]skolan|åtvidaberg/i;

export function visionRelevant(userQuestion) {
  return VISION_TRIGGER_REGEX.test(String(userQuestion || ""));
}

export function alleskolanRelevant(userQuestion) {
  return ALLESKOLAN_TRIGGER_REGEX.test(String(userQuestion || ""));
}

/** Bakåtkompatibelt namn — utlöser på endera. */
export function roadmapRelevant(userQuestion) {
  return visionRelevant(userQuestion) || alleskolanRelevant(userQuestion);
}

function diff(a, b) {
  return (a - b).toFixed(1).replace("-", "−").replace(".", ",");
}
function tal(n) {
  return String(n).replace(".", ",");
}

/**
 * Pitchblocket. Byggs ur ALLESKOLAN så att en siffra bara kan ändras på ett
 * ställe, och märks genomgående som en plan — aldrig som ett pågående arbete.
 */
/**
 * ExGens vision. Gäller hela produkten och alla elever — inget ämne, ingen
 * enskild skola. Det här är svaret på "vart är ni på väg".
 */
export function buildVisionContext() {
  return [
    "## EXGENS VISION — FÅR BERÄTTAS OM",
    "",
    "Frågar någon vart ExGen är på väg, vad ni vill uppnå eller vad nästa steg är:",
    "svara om PRODUKTEN och alla elever som använder den. Inte om ett enskilt ämne,",
    "inte om en enskild skola.",
    "",
    "PROBLEMET",
    "En elev som får 6 av 10 rätt vet att det gick sådär. De vet sällan VARFÖR, vilket",
    "begrepp som brast, eller vad de ska göra åt det. Läraren har trettio elever och",
    "hinner inte svara på det för var och en. Generella AI-verktyg kan förklara ett",
    "begrepp, men de vet inte vad just den här eleven redan kämpat med i ett halvår.",
    "",
    "DIT EXGEN SKA",
    "- Från ett resultat till ett svar på varför. Varje fel kopplas till ett begrepp,",
    "  inte bara till en poäng.",
    "- Från samma prov åt alla till prov som tränar det just den eleven missar.",
    "- Från att förklara ett begrepp till att hitta luckan under det — ett problem nu",
    "  beror ofta på något som aldrig satt sig från ett tidigare stadium.",
    "- Från en generell chatt till en studiekamrat som minns eleven mellan gångerna.",
    "- Från lärarens magkänsla till en klassbild som visar vad som faktiskt fastnar,",
    "  utan att exponera enskilda elevers svar.",
    "",
    "VEM DET ÄR FÖR",
    "Alla elever i grundskolan och gymnasiet, i vilket ämne som helst där de har eget",
    "material. Inte ett ämne, inte en årskurs, inte en skola.",
    "",
    "TONEN",
    "Konkret och lågmäld. Beskriv vad produkten gör, inte hur revolutionerande den är.",
    "Lova aldrig resultat som ingen mätt. Ett ärligt \"det här bygger vi nu, och vi",
    "vet inte än om det räcker\" är mer trovärdigt än ett löfte.",
  ].join("\n");
}

/**
 * Alléskolan-piloten. Byggs ur ALLESKOLAN så att en siffra bara kan ändras på
 * ett ställe, och märks genomgående som en plan — aldrig som pågående arbete.
 *
 * Bifogas BARA när någon frågar om skolan vid namn. Att låta den svara på
 * "vad är er vision" gör produkten mindre än den är.
 */
export function buildAlleskolanContext() {
  const a = ALLESKOLAN;
  const np = a.nationelltProv;

  return [
    "## ALLÉSKOLAN-PILOTEN — FÅR BERÄTTAS OM",
    "",
    "Frågar någon om Alléskolan eller Åtvidaberg är det här svaret. Det är EN pilot",
    "inom ExGens bredare arbete, inte hela produkten.",
    "",
    "PROBLEMET, MED SIFFROR",
    `${a.namn} i ${a.ort} har ${a.elever} elever i årskurs ${a.årskurser}. Läsåret ${a.läsår}:`,
    `- ${a.kunskapskravenAllaÄmnen.skolan} % nådde kunskapskraven i alla ämnen. Modellberäknat värde för en skola med samma förutsättningar: ${a.kunskapskravenAllaÄmnen.modellberäknat} %.`,
    `- Meritvärde ${tal(a.meritvärde.skolan)} mot rikets ${tal(a.meritvärde.riket)} (${diff(a.meritvärde.skolan, a.meritvärde.riket)}).`,
    `- Nationellt prov i matematik: ${tal(np.matematik.skolan)} mot rikets ${tal(np.matematik.riket)} (${diff(np.matematik.skolan, np.matematik.riket)}).`,
    `- Svenska ${tal(np.svenska.skolan)} mot ${tal(np.svenska.riket)}, engelska ${tal(np.engelska.skolan)} mot ${tal(np.engelska.riket)}.`,
    "",
    "Poängen med den sista raden: matematikgapet är nästan fyra gånger engelskans.",
    "Det är där skolan tappar mest, och därför piloten börjar i matematik.",
    "",
    "VAD EXGEN FAKTISKT GÖR ÅT DET",
    "- Kopplar elevens fel till Skolverkets centrala innehåll för årskurs 7–9.",
    "- Spårar ett problem bakåt: svårt med procent leder ofta till att bråk från mellanstadiet inte sitter. Då börjar träningen där i stället.",
    "- Varje prov viktas mot det eleven bevisligen har svårt för, utan att sluta täcka resten.",
    "- Läraren ser vilka områden klassen fastnar på — inte varje enskilt elevsvar.",
    "- Målet är mätbart: fler elever som når minst E, och en före/efter-mätning som visar om det faktiskt hjälpte.",
    "",
    "SÅ HÄR FÅR DU INTE SÄGA DET",
    `ExGen har INGEN kontakt med ${a.namn}, inget avtal och inget samarbete. Piloten är`,
    "ExGens egen ambition, byggd på skolans offentliga resultat. Säg aldrig att skolan",
    "är involverad, tillfrågad, intresserad eller positiv — det är kontrollerbart falskt,",
    "och den som kontrollerar det är skolan själv.",
    "",
    /* Uppmätt mot riktiga modellen: den skrev "det pågående arbetet med
       Alléskolan" i samma svar som den sa att ingen kontakt finns. Två
       motstridiga påståenden i ett stycke, och läsaren tror på det första. */
    "Skriv aldrig \"pågående\", \"arbetet med skolan\", \"vi jobbar med\" eller något annat",
    "som låter som att en pilot redan är igång. Den är PLANERAD. Formulera det i futurum:",
    "\"vi vill\", \"planen är\", \"skulle innebära\" — aldrig i presens eller perfekt.",
    "",
    `Statistiken kommer från ${a.källa} och gäller läsåret ${a.läsår}. Hitta aldrig på`,
    "en siffra som inte står här, och uppdatera aldrig en siffra ur minnet.",
    "",
    "TONEN",
    "Kort och konkret. Siffrorna bär pitchen — inga superlativ, inga löften om resultat",
    "som ingen mätt än. Att säga att det inte är bevisat ännu gör pitchen starkare, inte svagare.",
    "",
    "SIFFRORNA SKA MED, INTE SAMMANFATTAS — VIKTIGARE ÄN ATT SVARET BLIR KORT",
    "Skriv ut minst TVÅ konkreta tal ur listan ovan — helst matematikjämförelsen och",
    "andelen som når kunskapskraven. \"Resultaten ligger under rikets medel\" är en",
    "sammanfattning som säger ingenting; \"8,7 mot rikets 11,4 på nationella provet i",
    "matematik\" är ett argument. Det är skillnaden mellan en åsikt och ett underlag.",
  ].join("\n");
}

/** Bakåtkompatibelt: bygger det block frågan faktiskt gäller. */
export function buildRoadmapContext(userQuestion = "") {
  if (alleskolanRelevant(userQuestion)) return buildAlleskolanContext();
  return buildVisionContext();
}
