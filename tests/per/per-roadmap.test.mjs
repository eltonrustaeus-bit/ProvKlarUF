// ExGens nästa steg som P.E.R. får pitcha (api/_provia-roadmap.js).
//
// Användning:  node tests/per/per-roadmap.test.mjs   (exit 0 = pass)
//
// Frågan "vad är nästa stora plan för ExGen" ställs av investerare, lärare och
// UF-jury. Utan ett svar hittar modellen på ett, och en påhittad roadmap lovar
// saker ingen tänkt bygga.
//
// DET DYRA FELET ÄR ETT ANNAT. Alléskolan är en riktig kommunal skola med
// riktiga elever. Det finns ingen kontakt, inget avtal och inget samarbete.
// Ett påstående om motsatsen är kontrollerbart falskt, och den som kontrollerar
// det är skolan själv. Testet låser att blocket säger det rakt ut.
//
// Det andra felet: fel utlösning. "Vad är nästa steg i uppgiften" är en
// studiefråga, och att svara på den med en skolpilot vore absurt.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rm = await import(join(root, "api", "_provia-roadmap.js"));
const core = await import(join(root, "api", "_per-core.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

console.log("\n— UTLÖSNING —");
for (const q of [
  "vad är exgens nästa stora plan?", "vad är nästa steg för exgen",
  "vad är er vision", "vart är ni på väg", "vad händer härnäst med exgen",
  "har ni en roadmap", "vad tänker ni göra härnäst", "exgens framtid",
  "er nästa satsning?",
]) check(`"${q}"`, rm.roadmapRelevant(q));

/* Utan kravet att frågan gäller FÖRETAGET fångade mönstret varje studiefråga
   som råkade innehålla "nästa steg". Uppmätt innan kravet lades till. */
for (const q of [
  "vad ska jag göra härnäst", "vad är nästa steg i uppgiften",
  "vad är nästa steg i uträkningen", "vad ska jag plugga på",
  "nästa fråga tack", "vilket steg kommer sen", "vad kostar premium",
]) check(`"${q}" utlöser INTE pitchen`, !rm.roadmapRelevant(q));

console.log("\n— GRÄNSEN SOM MÅSTE HÅLLA —");
const b = rm.buildRoadmapContext();
check("blocket säger att ingen kontakt finns", /INGEN kontakt med Alléskolan/.test(b));
check("och att det inte finns något avtal", /inget avtal och inget samarbete/.test(b));
check("och förbjuder varje antydan om skolans inställning",
  /aldrig att skolan\s*\n?är involverad, tillfrågad, intresserad eller positiv/.test(b));
check("och säger varför det spelar roll", /kontrollerbart falskt/.test(b));
/* Ett block som beskriver piloten som pågående vore samma fel i mjukare form. */
check("piloten beskrivs som ExGens egen ambition", /ExGens egen ambition/.test(b));
check("ingen formulering om pågående samarbete",
  !/(samarbetar|tillsammans med Alléskolan|i samarbete med)/i.test(b));

console.log("\n— STATISTIKEN —");
const a = rm.ALLESKOLAN;
check("siffrorna är frysta", Object.isFrozen(a) && Object.isFrozen(a.nationelltProv));
check("källan är angiven", /Skolverkets utbildningsguide/.test(b));
check("läsåret är angivet", b.includes(a.läsår));
check("meritvärdet finns med", b.includes("202,7") && b.includes("228,5"));
check("andelen som nådde kunskapskraven finns med", /53 %/.test(b));
check("matematikgapet finns med", b.includes("8,7") && b.includes("11,4"));
check("jämförelseämnena finns med", b.includes("11,8") && b.includes("15,1"));
/* Poängen med att ta med svenska och engelska är att visa att matematik
   sticker ut — utan jämförelsen är 8,7 bara ett tal. */
check("blocket förklarar varför matematik valdes",
  /matematikgapet är nästan fyra gånger engelskans/i.test(b));
check("skolan namnges korrekt", b.includes("Alléskolan 7-9") && b.includes("Åtvidaberg"));

/* Siffror i löptext driver isär från siffror i data. Blocket byggs ur
   ALLESKOLAN, så en ändring på ett ställe räcker. */
check("procentsiffran kommer ur datat, inte ur texten",
  b.includes(`${a.kunskapskravenAllaÄmnen.skolan} %`));
check("elevantalet kommer ur datat", b.includes(String(a.elever)));

console.log("\n— VAD EXGEN ERBJUDER —");
check("läroplanskopplingen nämns", /Skolverkets centrala innehåll/.test(b));
check("spårningen bakåt förklaras", /bråk från mellanstadiet/.test(b));
check("adaptiva provet nämns", /viktas mot det eleven bevisligen har svårt för/.test(b));
check("lärarvyn nämns utan att lova elevdata", /inte varje enskilt elevsvar/.test(b));
check("målet är mätbart formulerat", /f[öo]re\/efter-mätning/.test(b));
/* En pitch som lovar resultat ingen mätt är samma sorts osanning som ett
   påhittat samarbete, bara svårare att kontrollera. */
check("inga löften om resultat som inte mätts",
  /inga löften om resultat\s*\n?som ingen mätt än/.test(b));
check("och att osäkerheten stärker pitchen står med",
  /gör pitchen starkare, inte svagare/.test(b));
/* Uppmätt mot riktiga modellen: utan den här regeln sammanfattade den siffrorna
   till "resultaten ligger under rikets medel" — vilket säger ingenting och gör
   pitchen till en åsikt i stället för ett underlag. */
check("blocket kräver att tal skrivs ut", /Skriv ut minst TVÅ konkreta tal/.test(b));
check("och förklarar varför en sammanfattning inte duger",
  /sammanfattning som säger ingenting/.test(b));

console.log("\n— I PROMPTEN —");
check("roadmapfråga tar med blocket, inloggad",
  core.buildPERSystemPrompt({ userQuestion: "vad är exgens nästa stora plan?", role: "gratis" })
    .includes("EXGENS NÄSTA STEG"));
check("studiefråga tar INTE med blocket",
  !core.buildPERSystemPrompt({ userQuestion: "förklara derivata", role: "gratis" })
    .includes("EXGENS NÄSTA STEG"));
check("roadmapfråga tar med blocket i landningsläget",
  core.buildPERLandingPrompt({ userQuestion: "vart är ni på väg?" }).includes("EXGENS NÄSTA STEG"));
check("prisfråga tar INTE med blocket i landningsläget",
  !core.buildPERLandingPrompt({ userQuestion: "vad kostar det?" }).includes("EXGENS NÄSTA STEG"));
/* Blocket är ~1,6 kB och betalas av varje fråga som utlöser det. */
check("blocket är villkorat, inte alltid med",
  core.buildPERSystemPrompt({ userQuestion: "hej", role: "gratis" }).length <
  core.buildPERSystemPrompt({ userQuestion: "vad är exgens nästa stora plan?", role: "gratis" }).length);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
