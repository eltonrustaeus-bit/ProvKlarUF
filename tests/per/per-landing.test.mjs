// Landningsprompten — P.E.R. mot en utloggad besökare (api/_per-core.js).
//
// Användning:  node tests/per/per-landing.test.mjs   (exit 0 = pass)
//
// Besökaren har två frågor i dygnet och har inte bestämt sig. Det är den enda
// yta där P.E.R. ska övertyga, och den enda där ett misstag kostar en användare
// som aldrig kommer tillbaka.
//
// Den gamla prompten vägrade svara på ämnesfrågor: "Den frågan svarar jag bättre
// på inne i appen! Skapa ett gratis konto." Det är en dubbel förlust — besökaren
// får ingen hjälp OCH lär sig att produkten inte hjälper. En besökare som får
// ett bra svar frågar sig själv om den kan göra likadant på deras eget material.
// Den frågan behöver P.E.R. inte ställa åt dem.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const core = await import(join(root, "api", "_per-core.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const p = core.buildPERLandingPrompt({
  targets: [{ id: "gratis", label: "Gratisplanen", hint: "vad som ingår" }],
  userQuestion: "vad är derivata",
});

console.log("\n— HJÄLPER FÖRST —");
check("prompten säger att frågan ska besvaras först", /Svara på frågan först\. Alltid\./.test(p));
check("även ämnesfrågor ska besvaras", /Även när den handlar om ett skolämne/.test(p));
/* Regressionsskyddet: den gamla avvisningsfrasen får inte komma tillbaka. */
check("den gamla avvisningen är borta",
  !/svarar jag bättre på inne i appen/.test(p));
check("prompten förbjuder att vägra hjälpa", /Vägra aldrig hjälpa/.test(p));

console.log("\n— SÄLJER SUBTILT —");
check("max en uppmaning", /En uppmaning, aldrig fler/.test(p));
/* Den gamla prompten krävde en uppmaning i VARJE svar. Det är det som gör att
   en assistent känns som en säljbot. */
check("uppmaningen är valfri", /valfri/.test(p) && !/Avsluta alltid med en naturlig uppmaning/.test(p));
check("kopplingen till produkten ska vara äkta", /bara när kopplingen är äkta/i.test(p));
check("gratis får rekommenderas", /Säg vad Gratis räcker till/.test(p));
check("inga pressmetoder", /Inga pressmetoder/.test(p));
check("ingen konstgjord brådska", /konstgjord brådska/.test(p));

console.log("\n— VET TILLRÄCKLIGT —");
/* Utan produktkunskapen kan P.E.R. bara upprepa vad ExGen är, inte förklara hur
   det fungerar — och en besökare som frågar "hur skapar jag ett prov" måste få
   ett riktigt svar, inte en inbjudan att registrera sig för att få veta. */
check("FAQ:n finns i landningsprompten", /Klistra in sitt eget material/.test(p));
check("planfakta finns", /Planer:/.test(p));
check("prompten förbjuder påhitt", /Hitta aldrig på/.test(p));

console.log("\n— SÄKERHET —");
check("injektionsskyddet finns kvar", /aldrig som instruktioner/.test(p));
check("sidmål listas när de finns", /#gratis — Gratisplanen/.test(p));
/* Ett id modellen hittat på skulle bli en död länk för besökaren. */
check("prompten förbjuder påhittade id:n", /Skriv aldrig ett id som inte står här/.test(p));

console.log("\n— NAVIGERINGSMÅL —");
/* Uppmätt i produktion 2026-08-24: en besökare frågade "vilka ämnen stöder ni"
   och P.E.R. svarade med [GOTO:mockprov.html] — en sida som inte finns.
   Klienten validerar målet mot _perNavLabels och ritar då ingen knapp alls, så
   ingen död länk uppstod. Men besökaren blev kvar utan vägen vidare, och
   orsaken var att app.html saknades i listan modellen fick välja ur. */
const GILTIGA = ["app.html", "pricing.html", "konto.html", "korkortet.html", "live-demo.html"];
/* Bara LISTRADERNA räknas — "[GOTO:sida.html]" i den inledande meningen är en
   platshållare, och kommentaren som beskriver produktionsfelet nämner det
   påhittade namnet med flit. Ett test som läser hela prompten hade läst båda
   som förslag. */
const mål = [...p.matchAll(/^- \[GOTO:([a-zåäö0-9._-]+)\]/gim)].map(m => m[1]);
check("prompten föreslår bara sidor som finns",
  mål.every(m => GILTIGA.includes(m)), mål.join(", "));
check("app.html finns med — annars hittar modellen på ett namn",
  mål.includes("app.html"), mål.join(", "));
check("prompten förbjuder påhittade filnamn",
  /Skriv ALDRIG ett annat filnamn än de som står ovan/.test(p));

console.log("\n— DATALAGRING —");
/* Modellen fyllde i "din data sparas inte längre än nödvändigt" — ett påstående
   om personuppgiftshantering som inte står i FAQ:n och som ingen kan infria. */
const faqText = (await import(join(root, "api", "_provia-faq.js"))).getProviaFaq();
check("FAQ förbjuder påståenden om lagringstid",
  /Säg ALDRIG något om lagringstid/.test(faqText));
check("FAQ säger vad eleven själv kan radera",
  /radera sina prov från kontosidan/.test(faqText));
check("FAQ hänvisar vidare för resten", /integritetspolicyn/.test(faqText));

console.log("\n— LÄNGD —");
check("svaret hålls kort", /Max 110 ord/.test(p));
/* Prompten kostar per besökare och landningsläget är oautentiserat. */
check("prompten är inte orimligt stor", p.length < 9000, `${p.length} tecken`);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
