// Adaptiv provgenerering (api/_adaptive-exam.js).
//
// Användning:  node tests/assessment/adaptive-exam.test.mjs   (exit 0 = pass)
//
// Loopen var bruten precis där den skulle sluta sig: prov matar
// user_profiles.mastery via grade.js, men generate-exam.js visste ingenting om
// eleven — noll referenser till mastery i hela filen. Varje prov genererades
// som om eleven aldrig gjort ett förut.
//
// Fyra fel är möjliga när ett prov börjar anpassa sig, och de är olika farliga:
//
//   SLUMPEN SÄTTER STUDIEPLANEN. Ett enda felsvar får inte bygga ett prov.
//   Under tre försök är siffran tur eller otur.
//
//   FILTERBUBBLA. Ett prov som BARA prövar svagheter är demoraliserande, mäter
//   inte om det eleven kan sitter kvar, och liknar inte det riktiga provet.
//
//   PÅHITTAT INNEHÅLL. Materialet eleven klistrat in styr alltid. Att uppfinna
//   frågor om ett svagt begrepp som inte finns i materialet är värre än att
//   inte träffa svagheten.
//
//   PROVET SOM DOM. Ett prov som annonserar "det här är dina svagheter" läses
//   inte som ett prov.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ae = await import(join(root, "api", "_adaptive-exam.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const NU = new Date("2026-08-24T12:00:00Z");
const rad = (score, attempts, label) => ({ score, attempts, label, last_seen: NU.toISOString() });
const focus = (m, n = 10) => ae.selectExamFocus(m, { numQuestions: n, now: NU });

console.log("\n— BARA BELAGD KUNSKAP STYR —");
/* Det dyra felet: ett enda felsvar bygger ett helt prov. */
check("ett begrepp med ett försök styr inte provet",
  focus({ otur: rad(5, 1, "Svek") }).weak.length === 0);
check("två försök räcker inte", focus({ x: rad(5, 2, "X") }).weak.length === 0);
check("tre försök räcker", focus({ x: rad(20, 3, "X") }).weak.length === 1);
check("tom profil ger inget fokus", focus({}).weak.length === 0);
check("null kraschar inte", focus(null).weak.length === 0);

console.log("\n— URVALET —");
const f = focus({
  svagast: rad(15, 5, "Fullmakt"),
  svag: rad(38, 4, "Presumption"),
  mitten: rad(60, 5, "Reklamation"),
  stark: rad(88, 6, "Avtalsrätt"),
});
check("svagast först", f.weak[0].label === "Fullmakt", f.weak.map(r => r.label).join(", "));
check("mellanskiktet räknas inte som svagt", !f.weak.some(r => r.label === "Reklamation"));
check("starka begrepp identifieras separat", f.strong[0]?.label === "Avtalsrätt");
check("högst fyra svaga begrepp", (() => {
  const m = {};
  for (let i = 0; i < 9; i++) m["k" + i] = rad(10 + i, 4, "B" + i);
  return focus(m).weak.length <= 4;
})());

console.log("\n— INGEN FILTERBUBBLA —");
/* Andelen är samma storleksordning som körkortsmodulens 40%. Ett prov helt
   byggt på svagheter mäter inte om det eleven kan sitter kvar. */
check("högst 40% av frågorna riktas", focus({ x: rad(10, 5, "X") }, 10).maxFocusQuestions === 4);
check("andelen håller även på ett stort prov", focus({ x: rad(10, 5, "X") }, 20).maxFocusQuestions === 8);
check("MAX_WEAK_SHARE är 0.4", ae.MAX_WEAK_SHARE === 0.4);
/* Ett prov på tre frågor där en är riktad är inte adaptivt, det är slumpmässigt. */
check("för korta prov viktas inte alls", focus({ x: rad(10, 5, "X") }, 4).maxFocusQuestions === 0);
check("gränsen går vid fem frågor", focus({ x: rad(10, 5, "X") }, 5).maxFocusQuestions >= 1);

console.log("\n— INSTRUKTIONEN —");
const i = ae.buildFocusInstruction(focus({
  a: rad(15, 5, "Fullmakt"), b: rad(30, 4, "Presumption"), c: rad(90, 6, "Avtalsrätt"),
}), { lang: "sv" });

check("svaga områden namnges", i.includes("Fullmakt") && i.includes("Presumption"));
check("taket på riktade frågor står med", /upp till 4 fråga/.test(i), i.split("\n").find(l => l.includes("upp till")));
/* Materialet styr alltid. Ett påhittat begrepp är värre än en missad svaghet. */
check("materialet har företräde", /Om — och bara om — det inklistrade materialet täcker dessa/.test(i));
check("påhitt förbjuds uttryckligen", /Hitta ALDRIG på innehåll som saknas i materialet/.test(i));
check("starka begrepp begränsas", /Högst en fråga på dessa/.test(i));
/* Ett prov som säger "det här är dina svagheter" läses som en dom. */
check("provet får inte annonsera att det är anpassat",
  /Nämn inte listan, elevens historik eller att provet är anpassat/.test(i));

check("utan svaga begrepp ges ingen instruktion",
  ae.buildFocusInstruction(focus({ stark: rad(90, 6, "A") }), { lang: "sv" }) === "");
check("utan fokusutrymme ges ingen instruktion",
  ae.buildFocusInstruction(focus({ x: rad(10, 5, "X") }, 3), { lang: "sv" }) === "");
check("engelska ger engelsk instruktion", (() => {
  const en = ae.buildFocusInstruction(focus({ x: rad(10, 5, "X") }), { lang: "en" });
  return /STUDENT'S KNOWN WEAK AREAS/.test(en) && /Never invent content/.test(en);
})());

console.log("\n— KOPPLINGEN I GENERATE-EXAM —");
const gen = readFileSync(join(root, "api", "generate-exam.js"), "utf8");
/* generate-exam är CJS och _adaptive-exam är ESM. En statisk import över den
   gränsen dödar funktionen vid inladdning — samma avbrott som tog ned
   /api/explain den 22 augusti. */
check("modulen importeras dynamiskt", /await import\("\.\/_adaptive-exam\.js"\)/.test(gen));
check("ingen statisk import av modulen", !/^import .*_adaptive-exam/m.test(gen));
check("fokus hämtas för den inloggade eleven", /buildAdaptiveFocus\(user\.id/.test(gen));
check("instruktionen når prompten", /focusInstruction,/.test(gen));
/* Materialet är promptens längsta block. En instruktion efter det drunknar. */
check("instruktionen står före materialet", (() => {
  const iFocus = gen.indexOf("focusInstruction,");
  const iMat = gen.indexOf("Material (använd bara detta som underlag)");
  return iFocus > 0 && iMat > 0 && iFocus < iMat;
})());
/* En profilläsning får aldrig fälla en provgenerering eller äta av budgeten. */
check("profilläsningen har timeout", /AbortSignal\.timeout\(4000\)/.test(gen));
check("fel ger tom instruktion, inte ett kastat fel",
  /} catch \{\s*return "";\s*\}/.test(gen));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
