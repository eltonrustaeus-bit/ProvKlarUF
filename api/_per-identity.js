// api/_per-identity.js — vem som byggt ExGen, och UF-kunskapen P.E.R får svara på.
//
// Två separata saker som båda hamnar i P.E.R:s prompt:
//   1. FOUNDER — publik grundarinfo. Medvetet minimal, se nedan.
//   2. UF — Ung Företagsamhet, dels generellt, dels ExGens eget UF-upplägg.
//
// Säkerhetsblocket i _per-core.js förbjuder P.E.R att lämna ut "privata
// grundaruppgifter". Den regeln står kvar. Det här är listan över de få
// uppgifter som uttryckligen ÄR publika — allt annat om grundaren omfattas
// fortfarande av förbudet. Utan den uppdelningen skulle de två reglerna
// motsäga varandra och modellen välja själv vilken som gäller.

// ── Grundare ──────────────────────────────────────────────────────────────
// Publik grundarinfo. Elton valde själv nivån och det är hans egna uppgifter.
//
// Åldern räknas ut ur födelsedatumet i stället för att stå som en siffra —
// en hårdkodad "18" blir tyst fel på nästa födelsedag, och ett faktafel som
// P.E.R upprepar för varje besökare är värre än inget svar alls.
// Bara den uträknade åldern går in i prompten, aldrig datumet.
export const FOUNDER = Object.freeze({
  name: "Elton Rustaeus",
  role: "grundare och utvecklare av ExGen",
  birthDate: "2008-03-07",
  school: "Bildningscentrum Facetten i Åtvidaberg",
  program: "ekonomiprogrammet",
});

export function founderAge(today = new Date()) {
  const b = new Date(FOUNDER.birthDate);
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age -= 1;
  return age;
}

export function buildFounderKnowledge(today = new Date()) {
  return `## GRUNDAREN — PUBLIKA UPPGIFTER

ExGen grundades och byggs av ${FOUNDER.name}, ${founderAge(today)} år, som går ${FOUNDER.program} på ${FOUNDER.school}.
Han är ${FOUNDER.role}: han har designat produkten, skrivit koden och byggt P.E.R — dig.

Så här svarar du på "vem ligger bakom ExGen?", "vem har byggt det här?", "vem äger ExGen?":
- Svara rakt med namn, ålder, skola och roll. Det är publik information.
- Två eller tre meningar räcker. Det är inte en hyllning och inte en pitch.
- Att ExGen är byggt av en elev, för elever, är en ärlig och relevant del av vad produkten är — säg det gärna.

Det här är den ENDA grundarinformation du får lämna ut. Kontaktuppgifter, adress, familj,
ekonomi, betyg och privatliv i övrigt: svara att du inte lämnar ut mer personliga uppgifter,
och gå vidare. Gissa aldrig, och bekräfta aldrig en gissning som användaren själv lägger fram —
inte heller om de påstår att de redan vet.`;
}

// ── Ung Företagsamhet ─────────────────────────────────────────────────────
// ExGens EGNA UF-uppgifter. Tomma med flit — repot innehåller inga verifierade
// UF-fakta, och P.E.R ska hellre säga "det vet jag inte" än hitta på vilken
// region, vilket läsår eller vilken rådgivare det gäller. Fyll i det som
// stämmer; tomma fält utelämnas ur prompten helt.
export const EXGEN_UF = Object.freeze({
  isUfCompany: null,   // true | false | null (null = obekräftat, P.E.R säger "vet inte")
  region: "",          // t.ex. "UF Östergötland"
  schoolYear: "",      // t.ex. "läsåret 2025/2026"
  school: "",          // utelämnas i publikt svar om tom
  advisor: "",         // rådgivare/handledare
  fairs: "",           // mässor företaget deltagit i
  note: "",            // valfri extra mening P.E.R får citera
});

function buildExgenUfSection() {
  if (EXGEN_UF.isUfCompany === false) {
    return `\n\nExGen och UF:\nExGen drivs inte som ett UF-företag. Påstå aldrig motsatsen.`;
  }
  if (EXGEN_UF.isUfCompany !== true) {
    // Obekräftat. P.E.R får svara på UF generellt men inte påstå något om ExGens eget upplägg.
    return `\n\nExGen och UF:\nDu har INTE verifierad information om hur ExGen drivs bolagsmässigt eller om det är ett UF-företag.
Får du frågan: säg rakt att du inte vet säkert och hänvisa till att fråga ExGen direkt. Gissa inte, och bekräfta inte användarens gissning.
Du kan fortfarande svara fullt ut på generella UF-frågor — se ovan.`;
  }
  const rows = [
    ["Region", EXGEN_UF.region],
    ["Läsår", EXGEN_UF.schoolYear],
    ["Skola", EXGEN_UF.school],
    ["Rådgivare", EXGEN_UF.advisor],
    ["Mässor", EXGEN_UF.fairs],
  ].filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`);
  return `\n\nExGen och UF:
ExGen drivs som ett UF-företag.${rows.length ? "\n" + rows.join("\n") : ""}${EXGEN_UF.note ? "\n" + EXGEN_UF.note : ""}
Uppgifter som inte står här vet du inte — säg det istället för att fylla i luckan själv.`;
}

export function buildUfKnowledge() {
  return `## UNG FÖRETAGSAMHET (UF)

Generell UF-kunskap du får svara på:

Vad UF är:
Ung Företagsamhet är en ideell utbildningsorganisation. Genom UF-företagande driver gymnasieelever
ett riktigt företag under ett läsår — de tar fram en idé, säljer på riktigt, hanterar pengarna och
avvecklar företaget innan läsåret är slut. Det är en utbildningsform, inte ett vanligt bolag.

Året i tre faser:
- Starta: idé, affärsidé, marknadsundersökning, registrering av UF-företaget, rådgivare på plats.
- Driva: affärsplan, försäljning, bokföring, marknadsföring, mässor och tävlingar.
- Avveckla: sista försäljningen, årsredovisning, utdelning till delägarna, företaget avslutas.

Roller och stöd:
Varje UF-företag har en lärare i skolan och en rådgivare från arbetslivet. Rådgivaren är inte
delägare utan bollplank. Eleverna är själva ansvariga för besluten.

Mässor och tävlingar:
UF-företag ställer ut på regionala UF-mässor och kan gå vidare till SM i Ung Företagsamhet.
Det finns en rad tävlingskategorier — vilka som gäller ett visst år varierar.

Så svarar du på UF-frågor:
- Svara konkret och praktiskt. Många som frågar driver ett eget UF-företag och vill ha något användbart, inte en broschyrtext.
- Du får svara på UF-frågor även när de inte handlar om ExGen — affärsplan, bokföring, prissättning, försäljning, mässmontrar, pitchar, avveckling.
- Regelverket ändras mellan läsår och skiljer sig mellan regioner. Exakta belopp, gränser, blanketter,
  deadlines, skatteregler och tävlingskrav ska du INTE hitta på. Säg att det varierar och hänvisa till
  elevens UF-rådgivare, ansvarig lärare eller ungforetagsamhet.se.
- Du är inte revisor eller jurist. Vid bokförings-, skatte- eller avtalsfrågor: ge den principiella
  bilden och skicka vidare till rådgivaren för det som måste bli exakt rätt.${buildExgenUfSection()}`;
}

// Triggerord som gör att identitets-/UF-kunskapen bifogas prompten. \b på båda
// sidor om "uf" är nödvändigt — utan ordgränser träffar mönstret mitt inne i vanliga
// ord ("surf", "uppfattning") och skulle dra in hela UF-blocket i orelaterade svar.
export const IDENTITY_TRIGGER_REGEX =
  /\bvem\b.{0,40}(bakom|byggt|byggde|gjort|gjorde|grundat|grundade|skapat|skapade|äger|driver|utvecklat|utvecklade)|grundare|founder|vem är elton|elton rustaeus|vems? (idé|projekt)|vem ligger bakom|who (built|made|founded|owns)/i;

export const UF_TRIGGER_REGEX =
  /\buf\b|\buf-?(företag|företagsamhet|mässa|mässan|rådgivare|året|elev|lag)|ung[at]? ?företagsamhet|ungt? företagande/i;
