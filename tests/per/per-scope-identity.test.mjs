// Regression net for what P.E.R is allowed to talk about (api/_per-core.js,
// api/_per-identity.js, api/_modules.js).
//
// Usage:  node tests/per/per-scope-identity.test.mjs   (exit 0 = pass)
//
// Three things are checked, and the second one is the reason this file exists:
//
//   1. RUNTIME, current config: with MODULES.korkort false, no prompt may make an
//      affirmative reference to körkortsteorin or högskoleprovet — and the explicit
//      prohibition must be present, not merely the absence of a mention.
//
//   2. SOURCE: every affirmative körkort string in the P.E.R prompt chain must sit on
//      a line guarded by MODULES.korkort. Checking only the rendered prompt would pass
//      just as happily if the module were deleted outright — it proves the strings are
//      absent, never that the flag is what removes them. Several körkort mentions had
//      already drifted outside the flag when this net was written, which is exactly the
//      failure a runtime-only check cannot see.
//
//   3. Founder and UF knowledge attaches on the right questions and stays out of
//      unrelated answers, and the founder block never carries more than name and role.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const core = await import(join(root, "api", "_per-core.js"));
const ident = await import(join(root, "api", "_per-identity.js"));
const { MODULES } = await import(join(root, "api", "_modules.js"));

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

const prompts = {
  study:   core.buildPERSystemPrompt({ userQuestion: "förklara ekvationen" }),
  landing: core.buildPERLandingPrompt("vad är exgen"),
  sales:   core.buildPERSalesPrompt({ userQuestion: "vad kostar premium" }),
  support: core.buildPERSupportPrompt({ userQuestion: "avsluta prenumeration" }),
  coach:   core.buildPERCoachSystemPrompt(),
};

// ── 1. runtime, gällande konfiguration ─────────────────────────────────────
const SCOPE = /körkort|teoriprov|högskoleprov|52\/65|Körkortsboken/i;
// Raderna som förbjuder körkort nämner det med flit. Bara bejakande omnämnanden är fel.
const isProhibition = l => /aldrig|INTE i produkten|ingår inte/i.test(l);

console.log(`\nMODULES.korkort = ${MODULES.korkort}, MODULES.hp = ${MODULES.hp}`);

if (MODULES.korkort === false) {
  for (const [name, p] of Object.entries(prompts)) {
    const bad = p.split("\n").filter(l => SCOPE.test(l) && !isProhibition(l));
    check(`${name}: inget bejakande körkorts-/HP-omnämnande`, bad.length === 0);
    bad.forEach(l => console.error(`          → ${l.trim().slice(0, 110)}`));
  }
  for (const name of ["study", "landing", "sales", "support"]) {
    check(`${name}: förbjuder körkort/högskoleprov uttryckligen`,
      prompts[name].split("\n").some(l => SCOPE.test(l) && isProhibition(l)));
  }
  check("ingen GOTO till korkortet.html i någon prompt",
    !Object.values(prompts).some(p => p.includes("korkortet.html")));
}

// ── 2. källkod: strängarna måste vara flaggstyrda, inte bortplockade ────────
const AFFIRMATIVE = [
  "korkortet.html",
  "Körkortsteorin är",
  "Körkortsteorin: frågor",
  "körkortscoach",
  "körkortsteori, rapport",
];
for (const rel of ["api/_per-core.js", "api/explain.js", "api/_per-memory.js"]) {
  const lines = readFileSync(join(root, rel), "utf8").split("\n");
  const unguarded = [];
  lines.forEach((l, i) => {
    if (l.trimStart().startsWith("//")) return;              // kommentar, inte prompttext
    if (!AFFIRMATIVE.some(a => l.includes(a))) return;
    const window = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
    if (window.includes("MODULES.korkort")) return;          // flaggstyrd — ok
    unguarded.push(`${rel}:${i + 1}  ${l.trim().slice(0, 90)}`);
  });
  check(`${rel}: alla bejakande körkortssträngar är MODULES.korkort-styrda`, unguarded.length === 0);
  unguarded.forEach(u => console.error(`          → ${u}`));
}

// ── 3. grundare och UF ─────────────────────────────────────────────────────
const trig = [
  ["vem har byggt exgen?",        true,  false],
  ["vem ligger bakom det här",    true,  false],
  ["who built this",              true,  false],
  ["är exgen ett uf-företag?",    false, true ],
  ["hur bokför man i UF",         false, true ],
  ["vad är en uf-mässa",          false, true ],
  ["vad är Ung Företagsamhet?",   false, true ],   // utskrivet namn, inte förkortningen
  ["ungt företagande",            false, true ],
  ["företagsamhet i allmänhet",   false, false],   // ordet ensamt får inte dra in UF-blocket
  ["ung och trött",               false, false],
  ["förklara pytagoras sats",     false, false],
  ["jag surfar på nätet",         false, false],   // "uf" inuti ord får inte matcha
  ["min uppfattning är fel",      false, false],
];
for (const [q, wantId, wantUf] of trig) {
  check(`trigger "${q}" → identitet=${wantId} uf=${wantUf}`,
    ident.IDENTITY_TRIGGER_REGEX.test(q) === wantId && ident.UF_TRIGGER_REGEX.test(q) === wantUf);
}

const idPrompt = core.buildPERSystemPrompt({ userQuestion: "vem byggde exgen?" });
const ufPrompt = core.buildPERSystemPrompt({ userQuestion: "är exgen ett uf-företag?" });

check("grundarnamn finns när frågan gäller grundaren", idPrompt.includes(ident.FOUNDER.name));
check("grundarnamn saknas i orelaterat svar",          !prompts.study.includes(ident.FOUNDER.name));
check("UF-blocket finns när frågan gäller UF",         ufPrompt.includes("UNG FÖRETAGSAMHET"));
check("UF-blocket saknas i orelaterat svar",           !prompts.study.includes("UNG FÖRETAGSAMHET"));

// Grundarblocket bär namn, ålder, skola, program och roll — Eltons eget val 2026-08-20.
// Allt UTANFÖR den listan ska förbli utelämnat: adress, telefon, mejl, betyg, familj.
const founderBlock = ident.buildFounderKnowledge();
check("grundarblocket namnger grundaren",        founderBlock.includes(ident.FOUNDER.name));
check("grundarblocket anger skola och program",  founderBlock.includes(ident.FOUNDER.school) && founderBlock.includes(ident.FOUNDER.program));
check("grundarblocket anger en ålder",           /\b\d{2} år\b/.test(founderBlock));

// Åldern får aldrig hårdkodas — den ska följa födelsedagen, annars blir den tyst fel.
check("åldern räknas ut, inte hårdkodad",
  ident.founderAge(new Date("2027-03-06")) + 1 === ident.founderAge(new Date("2027-03-07")));

// Födelsedatumet används för uträkningen men får aldrig nå prompten.
check("födelsedatumet läcker inte till prompten", !founderBlock.includes(ident.FOUNDER.birthDate));
check("grundarblocket avgränsar mot övriga personuppgifter",
  /lämnar inte ut mer personliga uppgifter|ENDA grundarinformation/i.test(founderBlock));

// UF-fakta för ExGen är obekräftade tills EXGEN_UF fylls i — P.E.R ska då säga att den
// inte vet, inte gissa. Blir isUfCompany true måste den grenen istället lista fakta.
if (ident.EXGEN_UF.isUfCompany !== true) {
  check("obekräftat UF-upplägg → P.E.R instrueras säga att den inte vet",
    /inte vet säkert/i.test(ident.buildUfKnowledge()));
}

// ── 4. motor- och kvalitetsblocken ─────────────────────────────────────────
check("motorblocket finns i studieprompten",   prompts.study.includes("VAD DU SER"));
check("differentieringsblocket finns",        prompts.study.includes("VAD DU GÖR SOM EN GENERELL AI INTE KAN"));

// ── kollektiv data ─────────────────────────────────────────────────────────
// Utan underlag ska INGEN rubrik synas. Syns den ändå börjar modellen resonera
// om siffror den inte fått, vilket är värre än att sakna funktionen.
const coll = await import(join(root, "api", "_per-collective.js"));
check("tomt underlag ger tom sträng",  coll.buildCollectiveBlock([]) === "");
check("null-underlag ger tom sträng",  coll.buildCollectiveBlock(null) === "");
check("ingen kollektivrubrik utan underlag", !prompts.study.includes("KOLLEKTIV DATA"));
check("kollektivblocket kommer med när underlag finns",
  core.buildPERSystemPrompt({ collectiveBlock: "## KOLLEKTIV DATA\n- X: 38% rätt." }).includes("KOLLEKTIV DATA"));

// Läsningen får aldrig kasta. Saknas vyn i databasen, saknas rättigheten eller dör
// nätet ska P.E.R svara precis som förut — kollektiv data är en förstärkning, inte ett krav.
check("loadCollectiveSignals utan klient → []",
  (await coll.loadCollectiveSignals(null, { course: "Matematik 1b" })).length === 0);
const throwingClient = { from() { throw new Error("relation does not exist"); } };
check("loadCollectiveSignals sväljer fel → []",
  (await coll.loadCollectiveSignals(throwingClient, { course: "Matematik 1b" })).length === 0);

// Formateringen får inte påstå något om enskilda elever.
const block = coll.buildCollectiveBlock([
  { concept_name: "Andragradsekvationer", student_count: 41, attempt_count: 302, p_correct: 0.38, common_error_codes: ["teckenfel"] },
]);
check("kollektivblocket förbjuder uttalanden om enskild elev",
  /aldrig något om en enskild annan elev/i.test(block));
check("kollektivblocket innehåller ingen elevtext och inga id:n",
  !/user_id|uuid|[0-9a-f]{8}-[0-9a-f]{4}/i.test(block));
check("starkare-svar-blocket finns",           prompts.study.includes("STARKARE SVAR"));
check("regeln mot att fråga om känd kontext",  /Be aldrig eleven upprepa/.test(prompts.study));

// ── 5. namnet: EN källa ────────────────────────────────────────────────────
// Repot bar tidigare tre olika beskrivningar av P.E.R samtidigt. Nu ligger namnet i
// api/_per-name.js och importeras — utom i api/grade.js, som är CommonJS och inte KAN
// importera en ESM-modul. Där står texten literalt, och det enda som hindrar den från att
// glida isär med källan är den här kontrollen. En kommentar hade inte hindrat någonting.
const name = await import(join(root, "api", "_per-name.js"));

check("expansionen är Progressive Evidence Reasoning", name.PER_EXPANSION === "Progressive Evidence Reasoning");
check("P, E och R förklaras alla tre",
  ["Progressive", "Evidence", "Reasoning"].every(w => name.PER_MEANING.includes(w)));

const gradeSrc = readFileSync(join(root, "api", "grade.js"), "utf8");
check("grade.js svenska rollrad matchar _per-name.js",
  gradeSrc.includes(name.perRole("professionell provrättare")));
check("grade.js engelska rollrad bär samma expansion",
  gradeSrc.includes(`ExGen's ${name.PER_EXPANSION} model`));

// Ingen prompt får bära den gamla backronymen. Den fanns i åtta prompter och två sidor.
for (const rel of ["api/_per-core.js", "api/explain.js", "api/grade.js", "api/teacher-report.js", "api/check-role.js"]) {
  check(`${rel}: ingen "AI-Resource" kvar`, !readFileSync(join(root, rel), "utf8").includes("AI-Resource"));
  /* Namnet bor i _per-name.js. En egen utskrivning någon annanstans driver isär
     tyst — repot bar tre konkurrerande beskrivningar samtidigt en gång, och
     docs/per/ARCHITECTURE.md sa "Pedagogisk Evidens- och Resonansmotor" ända
     till 2026-08-24. En modell som presenterar sig olika läser som flera
     produkter. */
  check(`${rel}: ingen konkurrerande utskrivning av P.E.R`,
    !/Pedagogisk Evidens|Resonansmotor|Personal Education/i.test(readFileSync(join(root, rel), "utf8")));
}

// Alla fem promptvarianter ska presentera sig med samma expansion.
for (const [n, p] of Object.entries(prompts)) {
  check(`${n}: presenterar sig som ${name.PER_EXPANSION}`, p.includes(name.PER_EXPANSION));
}

// Bokstavsblocket hör hemma i svaret på "vad står P.E.R för?" — inte i varje studiesvar.
check("namnblocket saknas i vanligt studiesvar", !prompts.study.includes("VAD P.E.R BETYDER"));
check("namnblocket kommer med på namnfrågan",
  core.buildPERSystemPrompt({ userQuestion: "vad står P.E.R för?" }).includes("VAD P.E.R BETYDER"));
for (const [q, want] of [["vad står P.E.R för?", true], ["vad betyder PER?", true], ["per dag", false], ["förklara pytagoras", false]]) {
  check(`namntrigger "${q}" → ${want}`, name.PER_NAME_TRIGGER_REGEX.test(q) === want);
}

console.log(failures ? `\n${failures} FAIL` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
