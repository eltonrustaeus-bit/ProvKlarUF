// Hur P.E.R. undervisar (api/_per-pedagogy.js).
//
// Användning:  node tests/per/per-pedagogy.test.mjs   (exit 0 = pass)
//
// Bakgrunden: `## UNDERVISNING` i systemprompten var 154 tecken — tunnast av
// fjorton avsnitt, medan `## NÄR FRÅGAN ÄR OTYDLIG` var 1808. Hela
// undervisningsinstruktionen löd "Ställ EN motfråga, ge INTE svaret". Det är en
// bra regel men inte en metod.
//
// DET FARLIGA FELET HÄR ÄR INTE ATT SÄGA FÖR LITE utan att blanda ihop två
// sorters påståenden:
//
//   FÖRMÅGORNA är Skolverkets ord, genererade ur ämnets syfte av
//   tools/sync-math-curriculum.mjs, och får citeras som läroplan.
//
//   POLYAS FYRA STEG är en etablerad metod från 1945, inte svensk läroplan.
//
// Ett falskt auktoritetspåstående till en elev som redan kämpar är värre än
// ingen vägledning — samma skäl som prerequisite-noten i matteplanen finns.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = await import(join(root, "api", "_per-pedagogy.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

/* Förmågorna kommer nu från en GENERERAD MODUL, inte från en filläsning.
   Första versionen läste config/math-curriculum.json i api/_per-core.js med
   dirname(fileURLToPath(import.meta.url)). Vercel transpilerar varje .js i
   api/ till CJS, där import.meta är ett SYNTAXFEL — raden tog ned
   /api/explain, /api/teacher-report OCH /api/check-role samtidigt. */
const planFil = join(root, "config", "math-curriculum.json");
const { PEDAGOGY_ABILITIES: förmågor } = await import(join(root, "api", "_per-abilities.js"));

console.log("\n— FÖRMÅGORNA ÄR GENERERADE, INTE AVSKRIVNA —");
/* Om synken slutar hitta dem blir listan tom, och blocket ska då UTELÄMNAS
   hellre än fyllas med en gissning. Den här kontrollen ser till att vi märker
   det i stället för att tyst tappa avsnittet. */
check("förmågor finns i den genererade planen", förmågor.length >= 4, `${förmågor.length} st`);
check("var och en är Skolverkets formulering",
  förmågor.every(f => /^förmåga att /i.test(f)), JSON.stringify(förmågor.slice(0, 2)));

/* De måste finnas ORDAGRANT i filen — annars har någon skrivit av dem för
   hand någonstans på vägen, och då kan de glida isär från Skolverkets. */
const rå = readFileSync(planFil, "utf8");
for (const f of förmågor) {
  check(`"${f.slice(0, 34)}…" står ordagrant i planen`, rå.includes(f));
}

console.log("\n— POLYA ÄR EN METOD, INTE LÄROPLAN —");
check("fyra steg", P.POLYA.length === 4, P.POLYA.map(p => p.steg).join(" → "));
check("varje steg har en fråga och ett skäl",
  P.POLYA.every(p => p.steg && p.fråga && p.varför));
const matte = P.buildPedagogyBlock({ abilities: förmågor, isMath: true });
/* Utan den här raden kan P.E.R. säga "enligt kursplanen ska du först förstå
   problemet" — ett falskt auktoritetspåstående. */
check("blocket förnekar uttryckligen att Polya är läroplan",
  /arbetsgång, inte läroplan|aldrig att Skolverket kräver/i.test(matte), "");
check("stegen namnges inte för eleven",
  /Nämn dem aldrig vid namn/i.test(matte));

console.log("\n— POLYA BIFOGAS BARA FÖR MATEMATIK —");
/* Fyra steg om problemlösning i ett svar om Vasatiden är brus, och prompten
   betalas per tecken i varje anrop. */
const ejMatte = P.buildPedagogyBlock({ abilities: förmågor, isMath: false });
check("matteblocket finns när ämnet är matematik", /ARBETSGÅNG VID PROBLEMLÖSNING/.test(matte));
check("och saknas annars", !/ARBETSGÅNG VID PROBLEMLÖSNING/.test(ejMatte));
check("men undervisningsdelen finns i båda", /## HUR DU UNDERVISAR/.test(ejMatte));
check("matteblocket kostar något", matte.length > ejMatte.length + 400,
  `${matte.length} mot ${ejMatte.length} tecken`);

console.log("\n— HJÄLPNIVÅN 0 OCH 1 FÅR EN EGEN VARNING —");
/* Det vanligaste sättet att svika en begärd ledtråd är att förklara så
   utförligt att uppgiften är löst på köpet. */
const ledtråd = P.buildPedagogyBlock({ abilities: förmågor, helpLevel: 0 });
check("hjälpnivå 0 varnar för att lösa uppgiften", /bad eleven om en ledtråd/i.test(ledtråd));
check("hjälpnivå 1 varnar också", /bad eleven om en förklaring/i.test(P.buildPedagogyBlock({ helpLevel: 1 })));
check("hjälpnivå 3 varnar inte", !/bad eleven om/i.test(P.buildPedagogyBlock({ helpLevel: 3 })));
check("utan hjälpnivå varnar den inte heller", !/bad eleven om/i.test(P.buildPedagogyBlock({})));

console.log("\n— TOMT UNDERLAG UTELÄMNAS, ALDRIG GISSAS —");
/* Samma regel som TOO_FEW i _per-pulse.js och null-aktivitet i _per-brain.js:
   hellre inget avsnitt än ett påhittat. */
const utan = P.buildPedagogyBlock({ abilities: [], isMath: true });
check("förmågeavsnittet utelämnas när listan är tom", !/VAD ÄMNET FAKTISKT BEDÖMER/.test(utan));
check("men resten står kvar", /## HUR DU UNDERVISAR/.test(utan) && /ARBETSGÅNG/.test(utan));
/* Modulen får aldrig glida isär från den genererade läroplanen. Gör den det
   visar P.E.R. förmågor Skolverket inte längre listar. */
const planData = JSON.parse(readFileSync(planFil, "utf8"));
check("modulen matchar läroplanens förmågor",
  JSON.stringify(förmågor) === JSON.stringify(planData.abilities),
  `modul ${förmågor.length}, plan ${(planData.abilities || []).length} — kör: node tools/sync-math-curriculum.mjs`);

/* Den generade modulen måste vara fri från import.meta, annars är hela
   poängen borta. tests/api/cjs-esm-boundary.test.mjs vaktar det för api/,
   men kontrollen hör hemma här också — den här filen är skälet. */
const abilSrc = readFileSync(join(root, "api", "_per-abilities.js"), "utf8");
check("den genererade modulen använder inte import.meta",
  !/import\s*\.\s*meta/.test(abilSrc.replace(/\/\/.*$/gm, "")));
check("och läser ingen fil vid inladdning", !/readFileSync|readdirSync/.test(abilSrc));

console.log("\n— METODEN SÄGER NÅGOT KONKRET —");
/* Ett block som bara säger "undervisa bra" är lika tomt som de 154 tecknen
   det ersätter. Kontrollerna nedan låser de råd som faktiskt styr beteende. */
check("börja i elevens eget resonemang", /vad de redan kan|deras eget resonemang/i.test(ejMatte));
check("ett steg i taget", /[Ee]tt steg i taget/.test(ejMatte));
check("låt eleven ta sista steget", /sista steget/i.test(ejMatte));
/* Det här är det råd som skiljer ett genomräknat exempel från att lösa
   elevens uppgift åt dem. */
check("exempel ska använda ANDRA siffror", /[Aa]ndra siffror/.test(ejMatte));
check("blocket är väsentligt större än de 154 tecken det ersätter",
  ejMatte.length > 800, `${ejMatte.length} tecken`);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
