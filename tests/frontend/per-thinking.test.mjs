// P.E.R:s tänkindikator och klargörande motfråga.
//
// Användning:  node tests/frontend/per-thinking.test.mjs   (exit 0 = pass)
//
// Två saker låses här, båda av samma skäl: de är byggda men lätta att tyst koppla loss.
// Klargörandet fanns redan i shared.js — chips, clarifyReply, hela vägen — men servern
// behövde ett arbetat EXEMPEL för att faktiskt producera markören. Beskrivningen i prosa
// räckte inte: mätt mot riktiga modellen gick träffsäkerheten från 6/8 till 8/8 först när
// exemplen lades in. Försvinner de går funktionen tillbaka till att bara utlösas på nästan
// tomma frågor, utan att något test säger ifrån.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failures = 0;
const check = (n, c) => { if (c) console.log(`  PASS  ${n}`); else { failures++; console.error(`  FAIL  ${n}`); } };

const shared = readFileSync(join(root, "shared.js"), "utf8");
const core   = readFileSync(join(root, "api", "_per-core.js"), "utf8");

console.log("\n— TÄNKINDIKATORN —");
// Att funktionen FINNS räcker inte. Under bygget hamnade den av misstag inuti addMsg, där
// den är osynlig för anropsstället — node --check godkände det, och en ren "finns den?"-koll
// hade gjort det med. Playwright-testerna fångade det; den här kollen gör felet billigare
// att hitta genom att kräva att deklarationen står FÖRE addMsg, inte inuti den.
const iStart = shared.indexOf("function startThinking");
const iAdd = shared.indexOf("function addMsg(text, type)");
check("startThinking finns", iStart > 0);
check("startThinking ligger utanför addMsg, inte nästlad i den", iStart > 0 && iAdd > iStart);
check("indikatorn startas när en fråga skickas", /var stopThinking = startThinking\(/.test(shared));
// Varje utgång måste stoppa intervallet. Missas en fortsätter etiketterna byta bakom svaret.
check("intervallet stoppas i minst fyra utgångar",
  (shared.match(/stopThinking\(\)/g) || []).length >= 4);
check("scanläge bara när eleven står på en provfråga",
  /currentQuestion && ctx\.currentQuestion\.text/.test(shared));
check("faserna skiljer sig mellan provfråga och vanlig fråga",
  /Läser frågan…/.test(shared) && /Tänker…/.test(shared));

console.log("\n— TILLGÄNGLIGHET —");
check("indikatorn annonseras som status", /setAttribute\('role', 'status'\)/.test(shared));
// Tre etiketter som byter av sig skulle annars läsas upp tre gånger.
check("faserna är dolda för skärmläsare", /class="per-think-label"/.test(shared) && /aria-label/.test(shared));
check("rörelsen stannar vid prefers-reduced-motion",
  /prefers-reduced-motion:reduce/.test(shared) && /per-scanning \.per-think-scan\{animation:none/.test(shared));

console.log("\n— KLARGÖRANDE MOTFRÅGA —");
check("promptblocket finns", /## NÄR FRÅGAN ÄR OTYDLIG/.test(core));
check("arbetade exempel finns — prosa ensam gav 6/8, exemplen gav 8/8",
  /SÅ HÄR SER DET UT/.test(core));
check("exempel på ämne utan uppgift", /hur gör man med derivata/.test(core));
check("exempel på entydig fråga som INTE ska ge motfråga",
  /entydig — svara direkt, ingen motfråga/.test(core));
check("regeln att kontext går före att fråga", /FRÅGA ALDRIG när du redan kan veta/.test(core));
// SVARSMÖNSTER står EFTER klargörandeblocket och vann tidigare på placeringen allena.
check("SVARSMÖNSTER lämnar företräde åt klargörandet",
  /Mönstret nedan gäller när du FAKTISKT SVARAR/.test(core));
check("klientsidan renderar fortfarande valknapparna", /per-clarify/.test(shared));
check("valet skickas tillbaka som clarifyReply", /clarifyReply: alt/.test(shared));

console.log("\n— SPÄRR MOT MOTFRÅGA MITT I PROV —");
// Prompten säger redan att kontext går före att fråga, men mätning mot riktiga modellen visade
// att regeln lyds ojämnt: samma fall gav motfråga i en körning och inte i nästa. En garanti
// som håller ibland är ingen garanti, så spärren ligger i kod.
const core2 = await import(join(root, "api", "_per-core.js"));
const provCtx = 'Prioriterad sidkontext:\nAktuell fråga 4 av 10: "Derivera f(x)"';
const lage = (q, c) => {
  const p = core2.buildPERSystemPrompt({ userQuestion: q, helpLevel: 1, context: c || "" });
  return p.includes("FRÅGAN SYFTAR PÅ PROVFRÅGAN") ? "spärrad"
       : p.includes("NÄR FRÅGAN ÄR OTYDLIG") ? "på" : "annat";
};
check('i prov + "varför blir det så" spärras', lage("varför blir det så", provCtx) === "spärrad");
check('i prov + "hur gör man här" spärras',    lage("hur gör man här", provCtx) === "spärrad");
// Motproven: spärren får inte svälja fall där en motfråga är rätt.
check('i prov + annat ämne klargör fortfarande', lage("hjälp med kemi", provCtx) === "på");
check('i prov + lång specifik fråga klargör fortfarande',
  lage("kan du förklara hela kedjeregeln för mig från grunden tack", provCtx) === "på");
check('utan prov klargör som vanligt', lage("varför blir det så", "") === "på");

console.log(`\n${failures === 0 ? "OK" : `${failures} FEL`}`);
process.exit(failures === 0 ? 0 : 1);
