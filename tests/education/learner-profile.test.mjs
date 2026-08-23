// Regressionsnät för elevprofilen (api/_learner-profile.js).
//
// Användning:  node tests/education/learner-profile.test.mjs   (exit 0 = pass)
//
// Profilen är det enda stället där personuppgifter om minderåriga går in i en
// AI-prompt. Tre saker låses här:
//
//   1. En INFERENS med låg säkerhet får aldrig hamna bland de påståenden
//      P.E.R. tillåts uttala. Kollapsar den skillnaden börjar P.E.R. berätta
//      för elever vad de är dåliga på, baserat på en gissning.
//   2. Ett fält som inte kan ändra svaret ska INTE med. Provdatum två månader
//      bort är kostnad utan effekt.
//   3. Användarens egna uppgifter får aldrig skrivas över av en gissning.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lp = await import(join(root, "api", "_learner-profile.js"));

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

const fakta = (obj) => ({
  persona: "elev",
  onboardedAt: "2026-08-01T00:00:00Z",
  /* {v, source, confidence} och inte en array — en array som kortform gjorde
     det omöjligt att uttrycka ett fält vars VÄRDE är en lista, vilket
     subject_codes och level_codes är. */
  facts: Object.fromEntries(Object.entries(obj).map(([k, spec]) => [
    k,
    spec && typeof spec === "object" && !Array.isArray(spec) && "v" in spec
      ? { value: spec.v, source: spec.source ?? "user", confidence: spec.confidence ?? 1 }
      : { value: spec, source: "user", confidence: 1 },
  ])),
});

const IDAG = new Date("2026-08-23T12:00:00Z");
const ctx = (obj, opts) => lp.buildProfileContext(fakta(obj), { today: IDAG, ...opts });

console.log("\n— TOM PROFIL —");
check("ingen profil ger inget block", lp.buildProfileContext(null, { today: IDAG }) === "");
check("tom faktalista ger inget block", ctx({}) === "");

console.log("\n— VEM ELEVEN ÄR —");
const grund = ctx({ school_type: "gymnasium", grade_year: 2, program_code: "NA25", goal_grade: "A" });
check("blocket har en rubrik", grund.startsWith("## OM ELEVEN"));
check("skolform och årskurs slås ihop till en rad", /Gymnasiet, år 2 på gymnasiet/i.test(grund) || /Gymnasiet, år 2/i.test(grund));
check("programmet skrivs med namn, inte kod",
  grund.includes("Naturvetenskapsprogrammet") && !grund.includes("NA25"));
check("målbetyget är med", grund.includes("Målbetyg: A"));
check("blocket förbjuder att uppgifterna nämns i onödan", /Nämn INTE uppgifterna bara för att visa/.test(grund));

console.log("\n— SÄKERT MOT OSÄKERT —");
const säker = ctx({ help_style: { v: "kort", source: "inferred", confidence: 0.9 } });
const osäker = ctx({ help_style: { v: "kort", source: "inferred", confidence: 0.3 } });
check("hög säkerhet hamnar bland påståendena",
  säker.includes("Korta svar") && !säker.includes("Osäkra iakttagelser"));
check("låg säkerhet hamnar i det osäkra blocket",
  osäker.includes("Osäkra iakttagelser") && osäker.includes("Korta svar"));
check("det osäkra blocket förbjuder att gissningen påstås",
  /påstå dem aldrig som fakta/i.test(osäker));
check("användarens eget svar är alltid ett påstående",
  !ctx({ help_style: { v: "kort", source: "user" } }).includes("Osäkra iakttagelser"));
check("uppmätt beteende är alltid ett påstående",
  !ctx({ help_style: { v: "kort", source: "observed", confidence: 0.2 } }).includes("Osäkra iakttagelser"));

console.log("\n— BARA DET SOM KAN ÄNDRA SVARET —");
check("prov om 3 dagar tas med", ctx({ exam_date: "2026-08-26" }).includes("Har prov om 3 dagar"));
check("prov idag formuleras som idag", ctx({ exam_date: "2026-08-23" }).includes("Har prov idag"));
check("prov om 1 dag böjs rätt", ctx({ exam_date: "2026-08-24" }).includes("om 1 dag"));
check("prov om 60 dagar utelämnas helt", ctx({ exam_date: "2026-10-22" }) === "");
check("prov som redan varit utelämnas", ctx({ exam_date: "2026-08-01" }) === "");
check("ämneslistan tas med när frågan inte säger ämnet",
  ctx({ subject_codes: ["MATE"] }).includes("Läser:"));
check("ämneslistan utelämnas när ämnet redan är känt",
  ctx({ subject_codes: ["MATE"] }, { topic: "derivata" }) === "");
/* Regressionen testet hittade: value är jsonb och kan innehålla vad som helst.
   En lista som råkat bli en sträng fällde hela P.E.R.-anropet. */
check("ett listfält med fel typ i databasen fäller inte anropet",
  ctx({ subject_codes: "MATE" }) === "");

console.log("\n— VAD ANVÄNDAREN FÅR SE —");
const visning = lp.profileForDisplay(fakta({
  program_code: "EK25",
  level_codes: ["MATMAT01b"],
  help_style: { v: "kort", source: "inferred", confidence: 0.3 },
}));
const rad = key => visning.find(r => r.key === key);
check("programmet visas med namn", rad("program_code")?.display === "Ekonomiprogrammet");
check("kurskoden översätts till kursnamn", rad("level_codes")?.display === "Matematik 1b");
check("varje rad har en etikett på svenska", visning.every(r => r.label && !/^[a-z_]+$/.test(r.label)));
check("källan visas i klartext", rad("program_code")?.sourceLabel === "Du har sagt det");
check("osäker gissning markeras som osäker", rad("help_style")?.uncertain === true);
check("säker uppgift markeras inte som osäker", rad("program_code")?.uncertain === false);
check("okända nycklar i databasen visas inte", (() => {
  const p = { persona: "elev", onboardedAt: null, facts: { borttaget_falt: { value: "x", source: "user", confidence: 1 } } };
  return lp.profileForDisplay(p).length === 0;
})());

console.log("\n— SKRIVNING —");

function stubSupabase(rows = []) {
  const store = new Map(rows.map(r => [r.key, r]));
  const calls = { upserts: [], deletes: [] };
  return {
    calls,
    store,
    from(table) {
      const api = {
        select: () => api,
        eq: () => api,
        limit: () => Promise.resolve({ data: [...store.values()] }),
        maybeSingle: () => Promise.resolve({ data: { persona: "elev", onboarded_at: null } }),
        upsert: (r) => { calls.upserts.push(...r); for (const x of r) store.set(x.key, x); return Promise.resolve({ error: null }); },
        delete: () => ({ eq: () => ({ eq: (_c, k) => { calls.deletes.push(k); store.delete(k); return Promise.resolve({ error: null }); } }) }),
      };
      if (table === "profiles") api.limit = () => Promise.resolve({ data: [] });
      return api;
    },
  };
}

{
  const db = stubSupabase();
  const res = await lp.saveFacts(db, "u1", { goal_grade: "b", hittepa: 1 }, { persona: "elev" });
  check("giltigt fält sparas", res.saved.includes("goal_grade"));
  check("ogiltigt fält avvisas utan att stoppa resten", res.rejected.includes("hittepa"));
  check("användarsvar sparas med source=user och full säkerhet",
    db.calls.upserts[0].source === "user" && db.calls.upserts[0].confidence === 1);
  check("värdet normaliseras innan det sparas", db.calls.upserts[0].value === "B");
}

{
  const db = stubSupabase([{ key: "help_style", value: "utforlig", source: "user", confidence: 1 }]);
  const res = await lp.saveInferred(db, "u1", { help_style: "kort", goal_grade: "C" }, { confidence: 0.4 });
  check("en gissning skriver INTE över det användaren själv sagt", !res.saved.includes("help_style"));
  check("en gissning får sätta ett fält användaren inte rört", res.saved.includes("goal_grade"));
  check("gissningen sparas med source=inferred och sin säkerhet", (() => {
    const rad = db.calls.upserts.find(u => u.key === "goal_grade");
    return rad?.source === "inferred" && rad.confidence === 0.4;
  })());
}

{
  const db = stubSupabase([{ key: "goal_grade", value: "A", source: "user", confidence: 1 }]);
  check("en känd nyckel går att glömma", await lp.forgetFact(db, "u1", "goal_grade") === true);
  check("en okänd nyckel går inte att glömma", await lp.forgetFact(db, "u1", "drop_table") === false);
}

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
