// P.E.R:s självgranskning (api/_per-review.js).
//
// Användning:  node tests/per/per-review.test.mjs   (exit 0 = pass)
//
// Granskaren finns för att P.E.R. inte hade någon kontroll alls på sina egna
// svar. api/_verifier.js granskar genererade PROVFRÅGOR, men chattsvaret —
// den yta eleven faktiskt läser mest — gick ogranskat rakt igenom.
//
// TVÅ SAKER ÄR LÄTTA ATT FÅ FEL HÄR, och båda testas nedan:
//
//   1. Urvalet. Ett granskningsanrop kostar pengar och sekunder. Kör den på
//      allt blir P.E.R. dubbelt så dyr och märkbart långsammare; kör den på
//      för lite är den dekoration. needsReview() är ren just för att den
//      avvägningen ska gå att mäta utan modell.
//
//   2. Fail open. Ett trasigt granskningssvar får ALDRIG visa en rättelse för
//      eleven. Tvärtemot en säkerhetsgrind, där osäkerhet betyder nej: här
//      betyder osäkerhet "lämna svaret som det var".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const R = await import(join(root, "api", "_per-review.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const långt = "x".repeat(700);

console.log("\n— URVALET SLÄPPER IGENOM DET SOM KOSTAR —");
check("matematik granskas", R.needsReview("hur löser jag ekvationen", "Du börjar med att…", { isMath: true }));
check("ämnesdetektorn väger tyngst",
  R.needsReview("vad tycker du", "ett kort svar", { isMath: true }),
  "isMath ska räcka ensam");
check("räkneord i frågan granskas", R.needsReview("förklara derivata", "Derivatan av x² är 2x."));
check("rättning granskas", R.needsReview("varför fick jag bara 2 poäng", "Din lösning saknade metoden."));
/* Ett självsäkert fel om vad som GÄLLER är farligast: eleven har ingen
   anledning att tvivla på ett påstående om läroplanen. */
check("påstående om läroplanen granskas",
  R.needsReview("måste jag kunna det här", "Enligt kursplanen krävs att du " + "y".repeat(260)));

console.log("\n— OCH HOPPAR ÖVER DET SOM INTE GÖR DET —");
check("en hälsning granskas inte", !R.needsReview("hej", "Hej! Vad vill du jobba med?"));
check("tack granskas inte", !R.needsReview("tack", "Varsågod."));
/* En motfråga innehåller per definition inget svar att ha fel om. */
/* Motfrågan måste innehålla något som ANNARS hade utlöst granskning, annars
   är kontrollen grön av fel skäl. Första versionen använde "hjälp med kemi",
   som inte matchade något mönster ändå — spärren var otestad, och ett sabotage
   som tog bort den gav inget fel. */
check("en motfråga granskas inte, ens när den nämner matematik",
  !R.needsReview("hjälp", "Vill du ha räknereglerna för derivata, eller hjälp med en ekvation du fastnat på? [CLARIFY:räknereglerna|en ekvation]"));
check("men samma text UTAN motfrågemarkören granskas",
  R.needsReview("hjälp", "Räknereglerna för derivata: du deriverar varje term för sig och konstanten faller bort."),
  "annars mäter kontrollen ovan ingenting");
check("tomt svar granskas inte", !R.needsReview("något", ""));
check("kort påstående utan tyngd granskas inte",
  !R.needsReview("vad heter du", "Jag heter P.E.R."));

console.log("\n— DEN VANLIGASTE ÖVERTRÄDELSEN —");
/* Att lösa uppgiften när eleven bad om en ledtråd tar ifrån dem själva
   övningen. Ett långt svar på hjälpnivå 0 är i sig misstänkt. */
check("lång text på hjälpnivå 0 granskas", R.needsReview("ledtråd tack", långt, { helpLevel: 0 }));
check("kort ledtråd granskas inte på den grunden",
  !R.needsReview("ledtråd tack", "Vad händer om du delar båda led med 3?", { helpLevel: 0 }));

console.log("\n— GRANSKAREN RÄTTAR ALDRIG —");
const prompt = R.buildReviewPrompt({ fråga: "vad är 2+2", svar: "5", helpLevel: 2 });
check("prompten säger uttryckligen att den inte rättar", /RÄTTAR ALDRIG/i.test(prompt));
check("den ber om ordagranna citat", /citerar det ordagrant|ordagrant/i.test(prompt));
check("elevens fråga når fram", prompt.includes("vad är 2+2"));
check("svaret som granskas når fram", /## SVARET SOM SKA GRANSKAS[\s\S]*5/.test(prompt));
check("hjälpnivån når fram", /Begärd hjälpnivå: 2/.test(prompt));
check("läroplanen bifogas när den finns",
  R.buildReviewPrompt({ fråga: "x", svar: "y", läroplan: "PROCENT OCH BRÅK" }).includes("PROCENT OCH BRÅK"));
check("och utelämnas när den saknas", !/## LÄROPLANEN/.test(prompt));

console.log("\n— DE FEM KATEGORIERNA STÅR I PROMPTEN —");
for (const typ of ["faktafel", "löste_uppgiften", "röjde_hemlighet", "räknefel", "obelagt_om_eleven"]) {
  check(`${typ} beskrivs`, prompt.includes(typ));
}
/* De tre hemligheter repot skyddar på andra ställen måste namnges här också,
   annars vet granskaren inte vad den letar efter. */
check("mastery-skalan nämns som hemlighet", /0[–-]100/.test(prompt));
check("lagringstid nämns som hemlighet", /sparas/i.test(prompt));
check("Alléskolan nämns som hemlighet", /Alléskolan/.test(prompt));

console.log("\n— BARA ALLVARLIGT NÅR ELEVEN —");
const allvarlig = R.parseReview({
  allvar: "allvarlig", rättelse: "Det ska vara 4, inte 5.",
  fynd: [{ typ: "räknefel", citat: "5", varför: "2+2 är 4" }],
});
check("allvarligt med rättelse visas", allvarlig.visas === true, JSON.stringify(allvarlig));
check("rättelsen följer med", allvarlig.rättelse === "Det ska vara 4, inte 5.");
check("fyndet följer med", allvarlig.fynd[0].typ === "räknefel");

check("mindre visas inte", R.parseReview({ allvar: "mindre", rättelse: "lite långt", fynd: [] }).visas === false);
check("ingen visas inte", R.parseReview({ allvar: "ingen", rättelse: null, fynd: [] }).visas === false);
/* En varning utan besked om vad som gäller i stället lämnar eleven sämre
   ställd än ingen varning alls. */
check("allvarligt UTAN rättelse visas inte",
  R.parseReview({ allvar: "allvarlig", rättelse: null, fynd: [] }).visas === false);
check("allvarligt med tom rättelse visas inte",
  R.parseReview({ allvar: "allvarlig", rättelse: "   ", fynd: [] }).visas === false);

console.log("\n— FAIL OPEN —");
/* Tvärtemot en säkerhetsgrind. Ett trasigt granskningssvar får inte visa en
   rättelse som inget täcker; det värsta en utebliven granskning gör är att
   lämna svaret som det var. */
for (const [namn, indata] of [
  ["null", null], ["odefinierat", undefined], ["trasig JSON", "{ inte json"],
  ["tomt objekt", {}], ["okänt allvar", { allvar: "katastrof", rättelse: "x", fynd: [] }],
  ["fynd som inte är lista", { allvar: "allvarlig", rättelse: "x", fynd: "nej" }],
]) {
  const r = R.parseReview(indata);
  check(`${namn} ger ingen rättelse`, r.visas === false && r.allvar === "ingen", JSON.stringify(r));
}
/* Men ett giltigt svar med trasiga FYND ska fortfarande kunna visa rättelsen —
   fynden är underlag för loggen, rättelsen är det eleven behöver. */
const halvtrasig = R.parseReview({ allvar: "allvarlig", rättelse: "Rätt svar är 4.", fynd: [null, { typ: 1 }] });
check("giltig rättelse överlever trasiga fynd", halvtrasig.visas === true && halvtrasig.fynd.length === 0,
  JSON.stringify(halvtrasig));

console.log("\n— LÄNGDER KAPAS —");
const lång = R.parseReview({
  allvar: "allvarlig", rättelse: "r".repeat(2000),
  fynd: [{ typ: "faktafel", citat: "c".repeat(2000), varför: "v".repeat(2000) }],
});
check("rättelsen kapas", lång.rättelse.length <= 600, String(lång.rättelse.length));
check("citatet kapas", lång.fynd[0].citat.length <= 300);
check("högst fyra fynd", R.parseReview({
  allvar: "mindre", rättelse: null,
  fynd: Array(9).fill({ typ: "faktafel", citat: "x", varför: "y" }),
}).fynd.length <= 4);

console.log("\n— SCHEMAT —");
check("schemat är strict", R.REVIEW_SCHEMA.strict === true);
check("allvar är en sluten lista",
  JSON.stringify(R.REVIEW_SCHEMA.schema.properties.allvar.enum) === JSON.stringify(R.ALLVAR));
check("rättelse får vara null", R.REVIEW_SCHEMA.schema.properties.rättelse.type.includes("null"));
check("VISA_FRÅN är den högsta nivån", R.VISA_FRÅN === R.ALLVAR[R.ALLVAR.length - 1]);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
