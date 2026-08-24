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

/* Frågor om vart ExGen är på väg. Snävt formulerat: "vad ska jag göra härnäst"
   är en studiefråga och hanteras av api/_per-role.js, inte av det här. */
/* Varje mönster kräver att frågan gäller FÖRETAGET — "ni", "er" eller "exgen".
   Utan det kravet fångade "nästa steg" varje studiefråga: "vad är nästa steg i
   uppgiften" är inte en fråga om ExGens roadmap, och att svara med en
   skolpilot där vore absurt. Uppmätt innan kravet lades till. */
export const ROADMAP_TRIGGER_REGEX = new RegExp(
  [
    // "exgens nästa stora plan", "nästa steg för exgen", "er kommande satsning"
    "\\b(?:n[äa]sta|kommande|framtida)\\s+(?:stora?\\s+)?(?:plan\\w*|steg|sats\\w*|milstolpe\\w*)\\b[^?.!]{0,30}\\b(?:exgen|ni|er|din|dina)\\b",
    "\\b(?:exgens?|era?|ni)\\b[^?.!]{0,25}\\b(?:n[äa]sta|kommande|framtida)\\s+(?:stora?\\s+)?(?:plan\\w*|steg|sats\\w*|milstolpe\\w*)",
    // roadmap och vision är otvetydiga i sig
    "\\broadmap\\b",
    "\\b(?:er|eran|exgens)\\s+vision\\b",
    "\\bvad\\s+är\\s+(?:er|eran|exgens)\\s+vision",
    // "vart är ni på väg", "vad händer härnäst med exgen"
    "vart\\s+(?:är|ska)\\s+(?:ni|exgen|du)\\s+p[åa]\\s+v[äa]g",
    "vad\\s+h[äa]nder\\s+(?:h[äa]rn[äa]st|sen|fram[öo]ver)\\s+(?:med|f[öo]r)\\s+exgen",
    "exgens?\\s+framtid",
    "vad\\s+(?:ska|t[äa]nker)\\s+(?:ni|exgen)\\s+g[öo]ra\\s+(?:h[äa]rn[äa]st|sen|nu|fram[öo]ver)",
    // "berätta om exgens planer", "vad har ni för planer framöver"
    "\\b(?:exgens?|era?|eran|ni)\\b[^?.!]{0,20}\\bplan(?:en|er|erna|ering\\w*)?\\b",
    "\\bplan(?:er|erna|ering\\w*)\\b[^?.!]{0,20}\\b(?:exgen|ni|er|eran)\\b",
    // "vad är målet med exgen", "vad vill ni uppnå"
    "\\bm[åa]let?\\s+(?:med|f[öo]r)\\s+exgen",
    "vad\\s+vill\\s+(?:ni|exgen)\\s+(?:uppn[åa]|åstadkomma|f[öo]r[äa]ndra)",
  ].join("|"),
  "i"
);

export function roadmapRelevant(userQuestion) {
  return ROADMAP_TRIGGER_REGEX.test(String(userQuestion || ""));
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
export function buildRoadmapContext() {
  const a = ALLESKOLAN;
  const np = a.nationelltProv;

  return [
    "## EXGENS NÄSTA STEG — FÅR BERÄTTAS OM",
    "",
    "Frågar någon vad ExGen ska göra härnäst — eller om ExGens vision, riktning eller",
    "framtid — är svaret den här skolpiloten. Ge den konkret även när frågan är bred:",
    "en vision utan ett exempel är en floskel.",
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
    `Statistiken kommer från ${a.källa} och gäller läsåret ${a.läsår}. Hitta aldrig på`,
    "en siffra som inte står här, och uppdatera aldrig en siffra ur minnet.",
    "",
    "TONEN",
    "Kort och konkret. Siffrorna bär pitchen — inga superlativ, inga löften om resultat",
    "som ingen mätt än. Att säga att det inte är bevisat ännu gör pitchen starkare, inte svagare.",
    "",
    "SIFFRORNA SKA MED, INTE SAMMANFATTAS",
    "Skriv ut minst TVÅ konkreta tal ur listan ovan — helst matematikjämförelsen och",
    "andelen som når kunskapskraven. \"Resultaten ligger under rikets medel\" är en",
    "sammanfattning som säger ingenting; \"8,7 mot rikets 11,4 på nationella provet i",
    "matematik\" är ett argument. Det är skillnaden mellan en åsikt och ett underlag.",
  ].join("\n");
}
