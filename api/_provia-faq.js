// api/_provia-faq.js — det P.E.R. behöver veta för att kunna svara på en
// besökares eller elevs frågor om ExGen utan att gissa.
//
// PROVIA_KB (api/_provia-rules.js) beskriver VAD ExGen är: sidor, planer,
// priser. Den räcker för "vad kostar Premium" men inte för "hur skapar jag ett
// prov", "vilka ämnen stöds", "vad händer med min text" eller "funkar det på
// mobilen" — frågor en besökare faktiskt ställer innan de skapar konto.
//
// Utan svar på dem gjorde P.E.R. en av två saker: hittade på, eller sköt
// besökaren vidare med "det svarar jag bättre på inne i appen". Det första är
// farligt, det andra säljer sämre än att bara hjälpa.
//
// VARJE PÅSTÅENDE HÄR MÅSTE GÅ ATT VERIFIERA I KODEN. Filen är P.E.R:s
// citerbara fakta — en gissning som hamnar här upprepas för varje besökare.
// Kvoter och priser står INTE här: de byggs av buildPlanFacts() ur PLAN_RULES,
// så att en prisändring aldrig kan ge två olika svar.

import { MODULES } from "./_modules.js";
import { getCatalog } from "./_education.js";

/* Antalet ämnen läses ur den genererade katalogen i stället för att skrivas som
   en siffra. En hårdkodad summa blir tyst fel nästa gång Skolverket ändrar en
   ämnesplan och tools/sync-skolverket.mjs körs om. */
function catalogScale() {
  try {
    // getCatalog() är lazy och cachar — filen läses en gång per kall instans.
    const c = getCatalog();
    if (c?.subjects?.length) {
      const gy = c.subjects.filter(s => s.schoolType === "GY").length;
      const gr = c.subjects.filter(s => s.schoolType === "GR").length;
      return { gy, gr, levels: c.levels.length };
    }
  } catch { /* katalogen saknas i bundeln — beskriv utan siffror */ }
  return null;
}

let _faq = null;

export function buildProviaFaq() {
  const skala = catalogScale();
  const ämnesrad = skala
    ? `ExGen känner till grundskolans ${skala.gr} ämnen och gymnasiets ämnen och kurser (${skala.levels} nivåer/kurser), hämtade från Skolverkets läroplaner. Både GY11-kurserna och Gy25:s ämnesnivåer finns, så både den som började före och efter ämnesbetygsreformen hittar sin kurs.`
    : `ExGen bygger på Skolverkets läroplaner för grundskolan och gymnasiet, och känner både GY11-kurserna och Gy25:s ämnesnivåer.`;

  return `## HUR EXGEN FUNGERAR — FAKTA P.E.R FÅR CITERA

Så här skapar man ett prov:
1. Klistra in sitt eget material — anteckningar, en text ur boken, en genomgång. Eller ladda upp en bild, ExGen läser av texten (OCR).
2. Välj ämne/kurs, nivå (E, C eller A) och frågetyp (blandat, flerval eller kortsvar).
3. ExGen genererar ett prov utifrån just det materialet.
4. Eleven svarar, lämnar in och får rättning direkt: poäng per fråga, motivering och ett modellsvar.

Vad eleven får tillbaka efter ett prov:
- Poäng och motivering på varje enskild fråga, inte bara en totalsumma.
- Modellsvar som visar hur ett svar på högre nivå ser ut.
- Varje fel taggat med vilket begrepp det gällde och vilken typ av fel det var.

Felbanken:
Alla fel samlas per begrepp på sidan Min utveckling. Där syns vad som återkommer, hur det utvecklats över tid och vad som är värt att träna på härnäst. Det är skillnaden mot att bara få ett resultat: eleven ser mönstret, inte bara siffran.

Ämnen och kurser:
${ämnesrad}
Eleven kan också skriva in ett eget kursnamn om något saknas — fältet är fritext, katalogen föreslår bara.

P.E.R:
P.E.R är ExGens inbyggda studiecoach. Den ser vilken sida eleven är på, vilken fråga de tittar på, vad de svarat tidigare och vilka begrepp de har svårt för. Den kan förklara på fyra nivåer: ledtråd, begreppsförklaring, steg för steg, eller full lösning — och börjar på den nivå situationen kräver i stället för att ge bort svaret direkt.

Under ett pågående prov ger P.E.R aldrig svaret på den aktuella frågan. Den hjälper eleven tänka, inte fuska.

För lärare:
Lärare kan skapa en klass, dela en klasskod och se en sammanställning av hur klassen ligger till. Läraren ser mönster på klassnivå, inte varje enskilt elevsvar.

Enheter:
ExGen körs i webbläsaren och fungerar på mobil, surfplatta och dator. Ingen app att installera, inget att ladda ner.

Elevens material och data:
Materialet eleven klistrar in används för att generera och rätta provet. Eleven kan radera sina prov från kontosidan. P.E.R sparar en kort lärprofil — svaga områden, hjälpstil, studiemönster — men aldrig råa frågetexter, kontouppgifter eller personliga detaljer, och den profilen kan rensas när som helst under Mitt konto.

Att komma igång:
Konto skapas med e-post. Gratisplanen kräver ingen kortuppgift och ingen bindningstid.

Att avsluta:
Prenumerationen avslutas när som helst från Mitt konto via Stripes portal. Ingen uppsägningstid.${MODULES.korkort ? "" : `

Vad ExGen INTE gör:
Körkortsteori och högskoleprov ingår inte i produkten. Erbjud det aldrig och påstå aldrig att det finns.`}

Om något inte står här eller i faktarutan ovan: säg att du inte vet säkert och hänvisa vidare. Hitta aldrig på en funktion, en siffra eller ett löfte.`;
}

/* Byggs vid första användningen, inte vid modulinladdning. Texten hämtar
   siffror ur utbildningskatalogen (~500 kB JSON), och att parsa den i varje
   kallstart av varje funktion som råkar importera filen vore ren kostnad för
   de anrop som aldrig når en prompt. */
export function getProviaFaq() {
  if (!_faq) _faq = buildProviaFaq();
  return _faq;
}

/* Frågor OM produkten, till skillnad från frågor om ett skolämne. Triggern
   avgör om FAQ:n bifogas huvudprompten — den är ~3 kB och ska inte betalas för
   av varje elev som ber om hjälp med derivata.
   Samma mönster som IDENTITY_TRIGGER_REGEX i _per-identity.js.

   Orden är valda för att vara otvetydigt produktrelaterade. "prov" och "fråga"
   står med flit INTE här: de är de vanligaste orden i hela produkten och skulle
   dra in blocket i nästan varje svar. */
export const EXGEN_QUESTION_REGEX =
  /\bexgen\b|\bp\.?e\.?r\b.{0,20}\b(är|gör|kan|funkar|fungerar)|hur (?:funkar|fungerar|gör jag|skapar jag|laddar jag|kommer jag igång|börjar jag)|felbank|lärarrapport|klasskod|min utveckling|mitt konto|skapa (?:ett )?(?:konto|prov)|ladda upp|\bocr\b|fota|bild på|vilka ämnen|vilka kurser|stöd(?:jer|er)? ni|funkar det på|mobil|surfplatta|radera (?:mina|mitt)|min data|mina uppgifter|avsluta|säga upp|logga (?:in|ut)|bindningstid|hur många prov|kvot/i;

export function faqRelevant(userQuestion) {
  return EXGEN_QUESTION_REGEX.test(String(userQuestion || ""));
}
