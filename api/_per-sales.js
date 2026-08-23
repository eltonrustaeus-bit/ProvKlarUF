// api/_per-sales.js — när P.E.R. får sälja, och hur mycket.
//
// FÖRE: säljläget avgjordes av ETT ord i elevens fråga.
//
//     intent = SALES_TRIGGER_REGEX.test(userQuestion) ? 'sales' : 'study'
//
// Mönstret innehåller "gräns", "plan", "hur många" och "jämföra med" — ord som
// hör hemma i vartenda gymnasieämne. Uppmätt på nio typiska studiefrågor
// utlöste SJU av dem säljprompten:
//
//     "vad är gränsvärdet när x går mot 0"        → säljpitch
//     "vilken plan har cellen för mitos"          → säljpitch
//     "hur många rätt behöver jag på provet"      → säljpitch
//     "kan du jämföra med den förra uppgiften"    → säljpitch
//
// En elev mitt i ett matteprov fick alltså en prisjämförelse i stället för
// hjälp med gränsvärden. Det är inte dålig försäljning — det är en trasig
// produkt.
//
// EFTER: säljläget avgörs av VAR eleven är och VAD de gör, inte bara av vilka
// ord de råkat använda. Ordmönstret finns kvar men får bara rösta, aldrig
// bestämma ensamt.

/* Fyra lägen. Skillnaden är inte hur hårt P.E.R. säljer utan OM den gör det
   alls — de två sista är helt säljfria zoner. */
export const SALES_MODE = Object.freeze({
  /** Utloggad besökare som inte sett produkten. Får övertygas. */
  LANDING: "landing",
  /** Inloggad som frågar rakt om pris, plan eller uppgradering. Svara på frågan. */
  ASKED: "asked",
  /** Inloggad som använder produkten. Sälj aldrig oombedd. */
  WORKING: "working",
  /** Mitt i ett prov. Ingenting utom uppgiften finns. */
  IN_EXAM: "in_exam",
});

/* Ord som BARA betyder pengar. Listan är avsiktligt kort och otvetydig — varje
   ord som också förekommer i ett skolämne hör inte hemma här.
   Uteslutna med flit, och varför:
     "gräns", "limit"     gränsvärde, gränssnitt, artgräns
     "plan"               affärsplan, planritning, cellens plan, lektionsplan
     "hur många"          varje räkneuppgift som finns
     "jämföra med"        varje jämförande uppgift i varje ämne
     "hinna"              "jag hinner inte klart provet" är en studiefråga
     "bättre än"          "är metod A bättre än B" är en studiefråga */
/* Ordslutet är öppet, inte \b. Svenskan böjer med suffix — "prenumerationen",
   "abonnemanget", "kostnaden", "faktureringen" — och en avslutande ordgräns
   direkt efter stammen missar varenda bestämd form. Ordstarten är däremot
   låst med \b, så "premium" inte träffar mitt inne i ett annat ord. */
export const MONEY_REGEX =
  /\b(uppgrader\w*|premium|basic|prenumeration\w*|abonnemang\w*|betalning\w*|betala\w*|faktur\w*|kostar|kostnad\w*|pris\w*|gratisversion\w*|kr\/mån|månadsavgift\w*|bindningstid\w*)/i;

/* Frågor om produkten som helhet — "varför ExGen", "vad ingår", jämförelser mot
   andra AI-verktyg. De förtjänar ett ärligt svar, inte en pitch, men de är
   säljnära nog att P.E.R. ska få rekommendera en plan om det passar. */
export const PRODUCT_QUESTION_REGEX =
  /varför (?:ska jag |skulle jag |välja )?exgen|vad (?:är|ingår i|får jag (?:med|för)) exgen|vad kan exgen|lönar det sig|värt (?:det|pengarna)|\b(?:chatgpt|chat gpt|gemini|copilot|claude|openai)\b|generell(?:a)? ai|annan ai|vad gör exgen/i;

/* Sidor där eleven ARBETAR. En fråga här är en studiefråga tills motsatsen är
   uttalad, oavsett vilka ord den innehåller. */
const WORKING_PAGES = new Set(["prov", "körkortsteorin", "förbättring"]);

/**
 * Avgör säljläget.
 *
 * @param opts.loggedIn     false för landningsläget
 * @param opts.pageContext  saneret sidkontext (api/_per-context.js)
 * @param opts.userQuestion elevens fråga
 * @returns {{ mode: string, moneyQuestion: boolean, productQuestion: boolean }}
 */
export function decideSalesMode({ loggedIn = true, pageContext = null, userQuestion = "" } = {}) {
  const q = String(userQuestion || "");
  const moneyQuestion = MONEY_REGEX.test(q);
  const productQuestion = PRODUCT_QUESTION_REGEX.test(q);

  if (!loggedIn) return { mode: SALES_MODE.LANDING, moneyQuestion, productQuestion };

  /* Ett pågående prov slår allt. Även en rak prisfråga får vänta — eleven har
     en klocka som tickar, och att svara om abonnemang mitt i ett prov är att
     hjälpa dem misslyckas. */
  const phase = pageContext?.examState?.phase;
  const hasQuestion = Boolean(pageContext?.currentQuestion?.text);
  if (phase === "exam" || hasQuestion) {
    return { mode: SALES_MODE.IN_EXAM, moneyQuestion, productQuestion };
  }

  /* En rak fråga om pengar ska besvaras var eleven än står. Att vägra svara på
     "vad kostar Premium" är inte finkänsligt, det är otjänligt. */
  if (moneyQuestion) return { mode: SALES_MODE.ASKED, moneyQuestion, productQuestion };

  if (WORKING_PAGES.has(String(pageContext?.page || ""))) {
    return { mode: SALES_MODE.WORKING, moneyQuestion, productQuestion };
  }

  /* Produktfrågor utanför arbetsytorna (startsida, prissida, konto) får ett
     ärligt svar med en rekommendation. */
  if (productQuestion) return { mode: SALES_MODE.ASKED, moneyQuestion, productQuestion };

  return { mode: SALES_MODE.WORKING, moneyQuestion, productQuestion };
}

/**
 * Instruktionen som styr hur mycket P.E.R. får sälja. Tom sträng när läget inte
 * behöver någon regel utöver den vanliga pedagogiken.
 */
export function buildSalesGuardrail(mode, { role = "gratis" } = {}) {
  if (mode === SALES_MODE.IN_EXAM) {
    return [
      "## INGEN FÖRSÄLJNING NU",
      "",
      "Eleven sitter mitt i ett prov. Nämn inte planer, priser, uppgraderingar eller",
      "konto — inte ens om frågan råkar innehålla ord som liknar det. Frågar de rakt ut",
      "om pris: säg att du tar det efteråt, och hjälp dem vidare med uppgiften.",
    ].join("\n");
  }

  if (mode === SALES_MODE.WORKING) {
    return [
      "## INGEN FÖRSÄLJNING NU",
      "",
      "Eleven använder produkten. De har redan valt ExGen — att sälja in den igen är",
      "att avbryta någon mitt i arbetet. Nämn plan eller uppgradering bara om eleven",
      "själv frågar, eller om de stöter i en gräns just nu och behöver veta varför.",
    ].join("\n");
  }

  if (mode === SALES_MODE.ASKED) {
    const planNote = role === "premium"
      ? "Eleven har redan Premium. Bekräfta att de har allt och gå vidare — ingen pitch."
      : role === "basic"
      ? "Eleven har Basic. Nämn inte Basic som ett alternativ — de har det redan."
      : "Eleven är på Gratis.";
    return [
      "## ELEVEN HAR FRÅGAT OM PLAN ELLER PRIS",
      "",
      /* Ordet "pris" är både ett pengaord och ett nationalekonomiskt begrepp, och
         "plan" finns i varje ämne. Mönstret kan därför träffa fel, och gör det
         hellre än att missa en riktig prisfråga. Raden nedan gör spärren ofarlig
         när den träffar fel: den säger åt P.E.R. att strunta i hela blocket i
         stället för att pressa in ExGens priser i ett svar om marginalnytta. */
      "Handlar frågan i själva verket om något annat — pris som ekonomiskt begrepp,",
      "en plan i ett skolarbete, en gräns i matematiken — så svara på DEN frågan och",
      "strunta i resten av det här blocket. Nämn inte ExGens planer då.",
      "",
      planNote,
      "",
      "Svara rakt på frågan först, med riktiga siffror. Rekommendera en plan bara om",
      "du kan säga varför just den passar dem. Är Gratis nog för det de gör — säg det.",
      "Ett ärligt \"du behöver inte betala än\" är mer värt än en såld månad.",
      "Max en uppmaning, och bara om den följer naturligt av svaret.",
    ].join("\n");
  }

  return "";
}
