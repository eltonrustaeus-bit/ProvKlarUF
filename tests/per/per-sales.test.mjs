// När P.E.R. får sälja (api/_per-sales.js) och vad den kan om ExGen
// (api/_provia-faq.js).
//
// Användning:  node tests/per/per-sales.test.mjs   (exit 0 = pass)
//
// Bakgrunden är ett mätt produktionsfel. Säljläget avgjordes av ett ord i
// elevens fråga, och mönstret innehöll "gräns", "plan", "hur många" och
// "jämföra med" — ord som finns i vartenda gymnasieämne. Sju av nio typiska
// studiefrågor utlöste säljprompten, så en elev som frågade om gränsvärden mitt
// i ett matteprov fick en prisjämförelse.
//
// Två fel låses här, och de är olika allvarliga:
//
//   SÄLJA I ARBETSLÄGE är det dyra felet. Det avbryter någon mitt i en uppgift
//   med något de inte bett om, och i ett prov med en klocka som tickar.
//
//   INTE SVARA PÅ EN RAK PRISFRÅGA är också ett fel. Att vika undan från
//   "vad kostar Premium" är inte finkänslighet, det är otjänlighet.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const s = await import(join(root, "api", "_per-sales.js"));
const faq = await import(join(root, "api", "_provia-faq.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};
const mode = (q, ctx, loggedIn = true) =>
  s.decideSalesMode({ loggedIn, pageContext: ctx, userQuestion: q }).mode;

console.log("\n— STUDIEFRÅGOR UTLÖSER INGEN FÖRSÄLJNING —");
/* Exakt de frågor som föll i den uppmätta buggen. De får aldrig börja
   utlösa försäljning igen, oavsett hur mönstret utvecklas. */
for (const q of [
  "vad är gränsvärdet när x går mot 0",
  "hur räknar man ut gränsen för konvergens",
  "vilken plan har cellen för mitos",
  "förklara hur man gör en plan för uppsatsen",
  "hur många rätt behöver jag på provet",
  "kan du jämföra med den förra uppgiften",
  "jag hinner inte klart provet",
  "är metod A bättre än B",
]) check(`"${q}"`, !s.MONEY_REGEX.test(q));

console.log("\n— RAKA PRISFRÅGOR BESVARAS —");
for (const q of ["vad kostar premium", "hur mycket är basic", "jag vill uppgradera",
                 "vad är priset", "finns det bindningstid", "hur funkar prenumerationen"]) {
  check(`"${q}"`, s.MONEY_REGEX.test(q));
}

console.log("\n— LÄGENA —");
const iProv = { page: "prov", examState: { phase: "exam" }, currentQuestion: { text: "Derivera f(x)=x^2" } };
const påSidan = { page: "prov", examState: { phase: "result" } };
const felbank = { page: "förbättring" };
const start = { page: "startsida" };

check("utloggad besökare är i landningsläge", mode("vad är exgen", null, false) === s.SALES_MODE.LANDING);
check("mitt i ett prov är säljfritt", mode("vad är derivata", iProv) === s.SALES_MODE.IN_EXAM);
/* Även en rak prisfråga får vänta under ett pågående prov. Eleven har en
   klocka som tickar; att svara om abonnemang då är att hjälpa dem misslyckas. */
check("en prisfråga MITT I ett prov väntar", mode("vad kostar premium", iProv) === s.SALES_MODE.IN_EXAM);
check("en synlig provfråga räcker för säljfritt läge",
  mode("hjälp", { page: "prov", currentQuestion: { text: "Fråga 3" } }) === s.SALES_MODE.IN_EXAM);
check("efter inlämning är det arbetsläge, inte provläge", mode("hur gick det", påSidan) === s.SALES_MODE.WORKING);
check("felbanken är arbetsläge", mode("vad ska jag träna på", felbank) === s.SALES_MODE.WORKING);
check("en prisfråga på felbanken besvaras", mode("vad kostar premium", felbank) === s.SALES_MODE.ASKED);
check("en produktfråga på startsidan besvaras", mode("varför exgen och inte chatgpt", start) === s.SALES_MODE.ASKED);
check("en vanlig fråga på startsidan säljer inte", mode("hur mår du", start) === s.SALES_MODE.WORKING);

console.log("\n— SPÄRRARNA —");
const g = (m, role) => s.buildSalesGuardrail(m, { role });
check("provläget förbjuder försäljning", /INGEN FÖRSÄLJNING NU/.test(g(s.SALES_MODE.IN_EXAM)));
check("provläget säger vad man gör vid en rak prisfråga", /tar det efteråt/.test(g(s.SALES_MODE.IN_EXAM)));
check("arbetsläget förbjuder försäljning", /INGEN FÖRSÄLJNING NU/.test(g(s.SALES_MODE.WORKING)));
check("arbetsläget tillåter svar när eleven själv frågar", /bara om eleven\s*\n?\s*själv frågar/.test(g(s.SALES_MODE.WORKING)));
check("landningsläget har ingen spärr här", g(s.SALES_MODE.LANDING) === "");

const frågat = g(s.SALES_MODE.ASKED, "gratis");
check("frågeläget svarar med riktiga siffror", /rakt på frågan först, med riktiga siffror/.test(frågat));
/* Regeln som skiljer en bra säljare från en påträngande: att säga att kunden
   inte behöver betala. */
check("frågeläget tillåter att rekommendera Gratis", /du behöver inte betala än/.test(frågat));
check("frågeläget tar max en uppmaning", /Max en uppmaning/.test(frågat));
/* Mönstret kan träffa fel — "pris" är också ett nationalekonomiskt begrepp och
   "plan" finns i varje ämne. Spärren måste vara ofarlig när den gör det, i
   stället för att pressa in ExGens priser i ett svar om marginalnytta. */
check("frågeläget backar när ordet betydde något annat",
  /strunta i resten av det här blocket/.test(frågat));
check("och säger uttryckligen att planerna inte ska nämnas då",
  /Nämn inte ExGens planer då/.test(frågat));
check("premium får ingen pitch", /redan Premium/.test(g(s.SALES_MODE.ASKED, "premium")));
check("basic får inte Basic föreslaget igen", /Nämn inte Basic/.test(g(s.SALES_MODE.ASKED, "basic")));

console.log("\n— VAD P.E.R VET OM EXGEN —");
const t = faq.getProviaFaq();
for (const [ämne, mönster] of [
  ["hur man skapar ett prov", /Klistra in sitt eget material/],
  ["OCR och bilder", /ladda upp en bild/i],
  ["nivåerna E, C och A", /E, C eller A/],
  ["vad rättningen ger", /modellsvar/i],
  ["felbanken", /Felbanken/],
  ["ämnen ur Skolverket", /Skolverkets läroplaner/],
  ["att GY11 och Gy25 båda finns", /GY11.*Gy25|Gy25.*GY11/s],
  ["P.E.R:s fyra hjälpnivåer", /ledtråd.*full lösning/s],
  ["att P.E.R inte ger svar under prov", /aldrig svaret på den aktuella frågan/],
  ["lärarens klassvy", /klasskod/i],
  ["mobil", /mobil/i],
  ["radering av data", /radera sina prov/],
  ["att avsluta", /avslutas när som helst/],
  ["att gratis inte kräver kort", /ingen kortuppgift/i],
]) check(`FAQ täcker ${ämne}`, mönster.test(t));

check("FAQ förbjuder att hitta på", /Hitta aldrig på en funktion, en siffra eller ett löfte/.test(t));
/* Priser och kvoter byggs ur PLAN_RULES. Står de även här kan de bli två
   olika svar vid nästa prisändring. */
check("FAQ upprepar inga priser", !/\d+\s*kr/.test(t), (t.match(/\d+\s*kr/) || [""])[0]);

console.log("\n— FAQ BIFOGAS BARA NÄR DEN BEHÖVS —");
for (const q of ["hur skapar jag ett prov", "vad är felbanken", "funkar det på mobil",
                 "vilka ämnen stöds", "kan jag radera mina prov", "hur avslutar jag"]) {
  check(`"${q}" tar med FAQ`, faq.faqRelevant(q));
}
/* ~3 kB som varje elev annars betalar för i varje fråga. */
for (const q of ["vad är derivata", "förklara fotosyntesen", "hjälp mig med den här frågan",
                 "varför blir svaret negativt", "hur räknar jag ut arean"]) {
  check(`"${q}" tar INTE med FAQ`, !faq.faqRelevant(q));
}

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
