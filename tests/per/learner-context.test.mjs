// Sammanslagen elevkontext (api/_learner-context.js).
//
// Användning:  node tests/per/learner-context.test.mjs   (exit 0 = pass)
//
// Fram till 2026-08-23 byggde fyra filer var sitt avsnitt om samma elev, utan
// att veta om varandra. P.E.R. fick upp till tre svar på "vad är eleven svag
// på" — ett uppmätt och två gissade — och ingenting sa vilket som gällde.
//
// Två fel låses här:
//
//   GISSNING SOM SÄGER EMOT MÄTNING. Har eleven 40 av 100 på fullmakter efter
//   sex försök, får en AI-extraktion inte samtidigt påstå att fullmakter sitter.
//   Modellen väljer då själv, och valet syns inte för någon.
//
//   GISSNING SOM SER UT SOM MÄTNING. En härledd uppgift utan markering läses
//   som lika säker som en uppmätt. Det är så P.E.R. börjar berätta för elever
//   vad de är dåliga på utan underlag.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lc = await import(join(root, "api", "_learner-context.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const NU = new Date("2026-08-23T12:00:00Z");
const mrad = (score, attempts, label) =>
  ({ score, attempts, label, last_seen: NU.toISOString() });
const ctx = (sources, opts) => lc.buildLearnerContext(sources, { now: NU, ...opts });

console.log("\n— TOMT —");
check("inga källor ger inget block", ctx({}) === "");
check("tom structured ger inget block", ctx({ structured: {} }) === "");
check("bara obelagd mastery ger inget block", ctx({ mastery: { a: mrad(20, 1, "A") } }) === "");

console.log("\n— MÄTNING VINNER ÖVER GISSNING —");
/* Kärnregeln. Fullmakt är uppmätt med sex försök; AI:ns lista nämner samma
   begrepp. Gissningen ska undertryckas helt, inte stå bredvid. */
const krock = ctx({
  mastery: { fullmakt: mrad(40, 6, "Fullmakt") },
  structured: { mock_weak_concepts: ["Fullmakt"], weak_topics: ["Fullmakt"] },
});
check("blocket byggs", krock.length > 0);
check("det uppmätta begreppet nämns", krock.includes("Fullmakt"));
check("gissningen om samma begrepp undertrycks",
  !krock.includes("Kan behöva träning"), krock.split("\n").find(l => l.includes("Kan behöva")) || "");

/* Ett begrepp som INTE är uppmätt ska däremot komma fram — men märkt. */
const nytt = ctx({
  mastery: { fullmakt: mrad(80, 6, "Fullmakt") },
  structured: { mock_weak_concepts: ["Konsumenträtt"] },
});
check("ett ej uppmätt begrepp kommer fram", nytt.includes("Konsumenträtt"));
check("och märks som ej belagt", /Kan behöva träning \(ej belagt\)/.test(nytt));

console.log("\n— GRADERINGEN SYNS —");
const härlett = ctx({ structured: { weak_topics: ["Derivata"], study_pattern: "evenings" } });
check("härledda rader får en egen rubrik",
  /Härlett ur elevens beteende/.test(härlett));
check("rubriken förbjuder att gissningen påstås",
  /påstå det aldrig som fakta/.test(härlett));

const mätt = ctx({ structured: { exam_count: 7, mock_recent_scores: [40, 55, 70] } });
check("uppmätta rader står utan osäkerhetsmarkering",
  mätt.includes("7 prov") && !/Härlett ur elevens beteende/.test(mätt));
check("trenden räknas ur riktiga poäng", /\+30%/.test(mätt), mätt);

console.log("\n— FÖRETRÄDESREGELN —");
const full = ctx({
  mastery: { a: mrad(30, 5, "A") },
  structured: { weak_topics: ["B"] },
  summary: "Eleven pluggar mest på kvällar.",
});
check("regeln finns med", /SÅ ANVÄNDER DU UPPGIFTERNA OVAN/.test(full));
check("regeln rangordnar de tre nivåerna",
  /uppmätt tyngst, sedan det eleven själv sagt, sist\s+det härledda/.test(full));
/* Senare instruktioner väger tyngre i en systemprompt. Står regeln först kan
   den överskuggas av allt som kommer efter. */
check("regeln står sist, inte först", full.lastIndexOf("SÅ ANVÄNDER DU") > full.indexOf("## ELEVENS"));
/* Den generella användningsinstruktionen stod tidigare i tre block samtidigt.
   Den ska nu finnas EXAKT en gång i hela kontexten. */
check("användningsinstruktionen står exakt en gång",
  (full.match(/bara när det\s+gör svaret bättre/g) || []).length === 1);
check("fritexten märks som möjligen inaktuell", /kan vara inaktuell/.test(full));

console.log("\n— ELEVPROFILEN ÄR FLAGGSTYRD —");
const profil = { persona: "elev", onboardedAt: "2026-08-01T00:00:00Z",
  facts: { goal_grade: { value: "A", source: "user", confidence: 1 } } };
check("profilen utelämnas när flaggan är av",
  !ctx({ profile: profil, structured: { exam_count: 3 } }, { profileEnabled: false }).includes("Målbetyg"));
check("profilen tas med när flaggan är på",
  ctx({ profile: profil }, { profileEnabled: true }).includes("Målbetyg"));
/* Kunskapsläget kommer från elevens egna prov och är INTE flaggstyrt. */
check("kunskapsläget visas även med flaggan av",
  ctx({ mastery: { a: mrad(30, 5, "Avtalsrätt") } }, { profileEnabled: false }).includes("Avtalsrätt"));

console.log("\n— FILTRERINGEN —");
const measured = new Set(["fullmakt"]);
check("uppmätt begrepp filtreras bort",
  lc.dropMeasured(["Fullmakt", "Svek"], measured).join() === "Svek");
check("normaliseringen gäller även här",
  lc.dropMeasured(["fullmakter"], measured).length === 0);
check("skräptaggar filtreras bort",
  lc.dropMeasured(["multiple_choice", "Okänt"], new Set()).length === 0);
check("dubbletter i listan tas bort",
  lc.dropMeasured(["Svek", "Svek"], new Set()).length === 1);
check("icke-array ger tom lista", lc.dropMeasured(null, new Set()).length === 0);

console.log("\n— HJÄLPSTILEN STÅR EN GÅNG —");
/* Renderades tidigare som ett eget promptavsnitt ("FÖRKLARINGSDJUP") samtidigt
   som elevprofilen kunde säga samma sak. Har eleven svarat på frågan ska den
   härledda signalen utelämnas helt, inte stå bredvid. */
const sagt = { persona: "elev", onboardedAt: "2026-08-01T00:00:00Z",
  facts: { help_style: { value: "kort", source: "user", confidence: 1 } } };

const bara_härlett = ctx({ structured: { preferred_help_level: 2 } });
check("härledd hjälpstil kommer fram när eleven inte sagt något",
  /Brukar be om steg för steg/.test(bara_härlett), bara_härlett);
check("och står bland de härledda, inte bland fakta",
  bara_härlett.indexOf("Brukar be om") > bara_härlett.indexOf("Härlett ur elevens beteende"));

const både = ctx({ profile: sagt, structured: { preferred_help_level: 2 } }, { profileEnabled: true });
check("elevens eget svar visas", /Korta svar/.test(både));
check("den härledda signalen utelämnas då helt", !/Brukar be om/.test(både), både);

/* Med flaggan av bärs inget eget svar, så den härledda signalen ska fram. */
check("med profilflaggan av kommer den härledda fram",
  /Brukar be om/.test(ctx({ profile: sagt, structured: { preferred_help_level: 2 } }, { profileEnabled: false })));

console.log("\n— HJÄLPNIVÅ TILL STIL —");
check("nivå 2 blir steg för steg", lc.helpLevelToStyle(2) === "stegvis");
check("nivå 0 blir ledtråd först", lc.helpLevelToStyle(0) === "ledtrad_forst");
check("okänd nivå ger ingen stil", lc.helpLevelToStyle(9) === null);
/* Stilarna måste finnas i PROFILE_FIELDS, annars slängs de tyst vid skrivning. */
const { PROFILE_FIELDS } = await import(join(root, "api", "_education.js"));
check("varje härledd stil är ett giltigt profilvärde",
  [0, 1, 2, 3].map(n => lc.helpLevelToStyle(n))
    .every(s => PROFILE_FIELDS.help_style.parse(s) === s));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
