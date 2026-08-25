// api/_per-pedagogy.js — HUR P.E.R. undervisar, inte VAD han undervisar om.
//
// VARFÖR FILEN FINNS
// `## UNDERVISNING` i systemprompten var 154 tecken — tunnast av fjorton
// avsnitt, medan `## NÄR FRÅGAN ÄR OTYDLIG` var 1808. Elva gånger mer utrymme
// åt att hantera otydliga frågor än åt att faktiskt undervisa. Hela
// undervisningsinstruktionen löd: "Ställ EN motfråga som tvingar eleven att
// tänka rätt. Ge INTE svaret."
//
// Det är en bra regel. Det är inte en metod.
//
// TVÅ SORTERS PÅSTÅENDEN, ALDRIG IHOPBLANDADE — samma regel som
// _math-curriculum.js bär:
//
//   FÖRMÅGORNA är Skolverkets text ordagrant, hämtade ur ämnets syfte av
//   tools/sync-math-curriculum.mjs. De får citeras som läroplan.
//
//   POLYAS FYRA STEG är en etablerad problemlösningsmetod (George Pólya,
//   "How to Solve It", 1945), inte svensk läroplan. P.E.R. får använda dem
//   som arbetsgång men aldrig påstå att Skolverket kräver dem.
//
// Blandas de ihop får eleven ett falskt auktoritetspåstående, och det är
// precis felet prerequisite-noten i matteplanen finns för att förhindra.



/* Polyas fyra steg. Metoden är från 1945 och allmänt spridd; formuleringarna
   nedan är våra egna sammanfattningar på svenska, inte en översättning som
   utges för att vara hans ord. */
export const POLYA = Object.freeze([
  {
    steg: "Förstå problemet",
    fråga: "Vad är okänt, vad är givet, och vad är villkoret mellan dem?",
    varför: "Den vanligaste orsaken till att en elev fastnar är att de börjat räkna innan de vet vad de letar efter.",
  },
  {
    steg: "Gör en plan",
    fråga: "Har du sett ett liknande problem? Kan du lösa en enklare del först?",
    varför: "Här hör en ledtråd hemma. Att peka på ett besläktat problem eleven redan klarat ger dem vägen utan att ge dem svaret.",
  },
  {
    steg: "Genomför planen",
    fråga: "Stämmer varje steg, och kan du se att det gör det?",
    varför: "Ett räknefel här är billigt att hitta. Samma fel upptäckt i facit lär eleven ingenting om metoden.",
  },
  {
    steg: "Se tillbaka",
    fråga: "Är svaret rimligt? Kunde du ha kommit dit på ett annat sätt?",
    varför: "Steget som oftast hoppas över, och det enda som gör en löst uppgift till en metod eleven kan återanvända.",
  },
]);

/* Förmågorna kommer som DATA, inte som en filläsning.
 *
 * Första versionen läste config/math-curriculum.json i api/_per-core.js med
 * dirname(fileURLToPath(import.meta.url)). Vercel buntar hjälparen in i rutten
 * och transpilerar allt till CJS, där import.meta är ett SYNTAXFEL — och den
 * raden tog ned /api/explain, /api/teacher-report och /api/check-role
 * samtidigt. Den sista är värst: js/site-gate.js är fail-closed.
 *
 * Understrecksprefixet skyddar ingenting. Det säger att filen inte blir en
 * egen serverlös funktion; modulformatet avgörs av filändelsen och
 * package.json, och de gäller varje fil i bunten.
 *
 * Lösningen är samma som för hjärnans graf: generera till en modul som
 * importeras statiskt. tools/sync-math-curriculum.mjs skriver den.
 */

/**
 * Undervisningsblocket.
 *
 * @param opt.abilities  Skolverkets förmågor, ordagrant. Tom lista = avsnittet
 *                       utelämnas hellre än att fyllas med en gissning.
 * @param opt.isMath     Polya bifogas bara för matematik. Fyra steg om
 *                       problemlösning i ett svar om Vasatiden är brus.
 * @param opt.helpLevel  0 = ledtråd … 3 = full lösning.
 */
export function buildPedagogyBlock({ abilities = [], isMath = false, helpLevel = null } = {}) {
  const delar = ["## HUR DU UNDERVISAR"];

  delar.push(`Undervisning är inte att svara. Det är att flytta eleven från där de står till där de kan ta nästa steg själva.

**Börja med vad de redan kan.** Ett svar som börjar i deras eget resonemang håller; ett som börjar i din förklaring måste de först översätta.

**Ett steg i taget.** Två nya idéer i samma svar betyder att den andra inte fastnar.

**Låt eleven göra det sista steget.** Om du kan sluta en mening tidigare och låta dem fylla i — gör det.

**Visa hellre än berätta när det går.** Ett genomräknat exempel på ett LIKNANDE tal lär ut metoden utan att lösa elevens uppgift. Använd andra siffror än de i uppgiften, alltid.`);

  if (helpLevel === 0 || helpLevel === 1) {
    delar.push(`**Just nu bad eleven om ${helpLevel === 0 ? "en ledtråd" : "en förklaring"}, inte om lösningen.** Det vanligaste sättet att svika det är att förklara så utförligt att uppgiften är löst på köpet. Stanna innan sista steget.`);
  }

  if (isMath) {
    delar.push(`## ARBETSGÅNG VID PROBLEMLÖSNING

Fyra steg, i den här ordningen. Nämn dem aldrig vid namn för eleven — använd dem för att veta var de fastnat.

${POLYA.map((p, i) => `${i + 1}. **${p.steg}** — ${p.fråga}\n   ${p.varför}`).join("\n\n")}

Fastnar eleven: fråga dig vilket av de fyra stegen som saknas, och rikta din enda motfråga dit. En elev som inte förstått problemet blir inte hjälpt av en räkneregel.

Det här är en arbetsgång, inte läroplan. Säg aldrig att Skolverket kräver den.`);
  }

  if (abilities.length) {
    delar.push(`## VAD ÄMNET FAKTISKT BEDÖMER

Skolverkets egen text. Citeras ordagrant om du hänvisar till den:

${abilities.map(a => `- ${a}`).join("\n")}

En uppgift tränar sällan alla. Vet du vilken förmåga eleven övar kan du säga vad som saknas i deras lösning i stället för bara att den är fel — "du har räknat rätt men inte visat resonemanget" är användbart, "fel" är det inte.`);
  }

  return delar.join("\n\n");
}
