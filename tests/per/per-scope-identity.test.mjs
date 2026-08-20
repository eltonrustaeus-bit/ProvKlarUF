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

// Grundarblocket får bära namn och roll — inget mer. Skulle någon lägga till ort,
// skola eller ålder i _per-identity.js ska det här testet bli rött.
const founderBlock = ident.buildFounderKnowledge();
// Raden som räknar upp vad som INTE får lämnas ut nämner ålder, ort och skola med flit.
const founderClaims = founderBlock.split("\n")
  .filter(l => !/lämnar inte ut|ENDA grundarinformation|Gissa aldrig|svara att du inte/i.test(l))
  .join("\n");
check("grundarblocket påstår inget om ålder, ort eller skola",
  !/\b(19|20)\d\d\b|\b1[0-9] år\b|Åtvidaberg|gymnasi|\bskola\b|årskurs/i.test(founderClaims));
check("grundarblocket förbjuder personliga uppgifter uttryckligen",
  /lämnar inte ut personliga uppgifter|ENDA grundarinformation/i.test(founderBlock));

// UF-fakta för ExGen är obekräftade tills EXGEN_UF fylls i — P.E.R ska då säga att den
// inte vet, inte gissa. Blir isUfCompany true måste den grenen istället lista fakta.
if (ident.EXGEN_UF.isUfCompany !== true) {
  check("obekräftat UF-upplägg → P.E.R instrueras säga att den inte vet",
    /inte vet säkert/i.test(ident.buildUfKnowledge()));
}

// ── 4. motor- och kvalitetsblocken ─────────────────────────────────────────
check("motorblocket finns i studieprompten",   prompts.study.includes("VAD DU SER"));
check("starkare-svar-blocket finns",           prompts.study.includes("STARKARE SVAR"));
check("regeln mot att fråga om känd kontext",  /Be aldrig eleven upprepa/.test(prompts.study));

console.log(failures ? `\n${failures} FAIL` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
