# Provia (ProvKlarUF)

Vercel serverless exam platform for Swedish students. No framework, no build step.

## Stack
- Frontend: Plain HTML/CSS/JS in root
- Backend: `api/*.js` Vercel handlers
- Auth + DB: Supabase | AI: OpenAI (gpt-4o-mini)

## Design Tokens — never change without asking
| Token | Värde |
|-------|-------|
| Bakgrund | `#08100d` |
| Accent | `#1bff8c` |
| Surface | `#111a15` / `#162019` |
| Text (primär) | `#e8f5ee` |
| Text (sekundär) | `#a8c4b4` |
| Border radius | `5px` |
| Font | DM Sans + DM Mono |

## Core Rules
- Commit before every new feature
- Test Supabase RLS after any schema change
- Read file before modifying — never edit blind
- Match CJS/ESM style of file being edited (see .claude/COMMON_MISTAKES.md)
- No speculative features, no over-engineering
- **Kör om sviten EFTER commit när ett test läser git-metadata.**
  `tests/frontend/sitemap-lastmod.test.mjs` jämför `<lastmod>` i `sitemap.xml`
  mot `git log`-datumet för varje HTML-sida. Körs sviten före committen är
  git-datumet fortfarande det gamla, testet blir grönt — och rött först i nästa
  PR, när någon annan ändring råkar köra sviten efteråt. Uppmätt 2026-08-25:
  PR #107 ändrade `app.html`, sviten kördes före commit och rapporterade
  33/33 grönt. Felet dök upp i PR #108 och såg ut att komma därifrån.
  Ett test som bara kan bli grönt före commit bevakar ingenting.

## Concurrent Sessions — always use a worktree
Multiple Claude Code sessions run against this repo at once (e.g. one on
a theme/design branch, another on a feature branch). The bare checkout
at `~/provia-ai` has exactly one git HEAD — if two sessions both `git
checkout` in that same directory, whichever checks out second silently
moves the other's HEAD too. This has already caused one session's
commits to land on a branch named after another session's unrelated
work, force-pushed over it, and required manual recovery.

**Rule: never run `git checkout <branch>` directly in `~/provia-ai`
once a second session is active.** Each concurrent session must work in
its own git worktree instead:
- Start of session: `git worktree add .claude/worktrees/<short-task-name> -b <branch-name>`
- Do all work (edits, commits, pushes) from inside that worktree path
- `~/provia-ai` itself stays on `main`, untouched, for the whole session
- `git worktree list` shows every active worktree if unsure whether one
  already exists for the current task before creating a new one

This costs nothing (worktrees share the same object store/history) and
makes the two sessions fully independent — no shared HEAD, no
possibility of one session's checkout silently relocating another's.

## Output Rules
- Code first, explanation only if non-obvious
- No boilerplate unless asked
- State bug + fix. Stop. No suggestions beyond scope.
- No guessing about bugs — read the code first.

## körkortsteorin — driving_questions table (2026-06-09)
- 352 questions, 16 categories (all normalized)
- Categories: Vägmärken(60), Trafikregler(44), Korsningar(28), Hastighet(36), Parkering(30),
  Möte&Omkörning(19), Mörker&Sikt(15), Väglag&Bromssträcka(16), Vägtunnlar(12),
  Bogsering&Lastsäkring(11), Fordon&Besiktning(8), Körning med Släp(12),
  Nödsituationer(17), Alkohol&Droger(14), Säkerhet&Utrustning(17), Miljö&Ekonomi(13)
- 89 with image_url (all Wikimedia — E8-50/E8-70/E10-30 fixed to C31 format 2026-06-09)
- Fields: id, category, question, option_a-d, correct, explanation, difficulty, image_url, image_description
- TEORI_DIST: category weights for 65-question teoriprov (matches Trafikverket distribution)
- Adaptive learning: wrong-answer questions boosted up to 40% of exam pool

## Graphify First
Before reading any source file, query the graphify graph:
`C:\Users\elton\Desktop\ProvKlarUF\graphify-out\graph.json`
1747 nodes, 2161 edges, 209 communities (updated 2026-07-01, incl. HP). Only fall back to raw file reads if graph lacks detail.

## körkortsteorin — modes (uppdaterad 2026-06-21)
Övning-mode BORTTAGEN. Kvar: **kurser** (default), **teoriprov**, **repetition**, admin (hidden).
- `currentMode = "kurser"` | `#tab-kurser` har `active` class
- Init: `showConfig()` + hero stats uppdateras efter questions laddas (015a86f)
- Quota: gratis=10 kursfrågor/dag (localStorage), Basic=30 teoriprov/mån (server)
- `selCat` aldrig satt av kurser-flow → alltid `activeCourse||selCat` i DB-insert
- Se fullständig state: `C:\Users\elton\.claude-account2\projects\C--Users-elton\memory\project_korkortet.md`

## P.E.R Core Architecture (uppdaterad 2026-05-30)
- `api/_per-core.js` — Delat AI-lager: `callAI()`, `buildPERSystemPrompt()`, `buildPERCoachSystemPrompt()`
- Alla ESM-endpoints importerar från `_per-core.js` (explain, smart-tips, teacher-report)
- grade.js/generate-exam.js är CJS — importerar EJ _per-core men har PER-branding i system prompt
- `shared.js` — `getPageContext()` injicerar sidkontext i P.E.R-anrop; `window.setPerContext(ctx)` låter sidor sätta rik kontext
- `förbättring.html` coach-sektion → PER API-anrop (cached 24h i `proviaai_per_coach_cache`)
- explain.js accepterar nu `pageContext` + `helpLevel` (0=ledtråd, 1=förklara, 2=steg-för-steg, 3=full lösning)

## API Routes (security-sensitive — review carefully)
Alla 12 rutter (filer i `api/` utan `_`-prefix) står här. Det är också exakt
Vercel Hobby-planens tak — en ny rutt kräver att en annan viks in i en befintlig,
vilket är varför `hp.js` och `knowledge.js` dispatchar på `body.op`.

| File | Purpose |
|------|---------|
| `api/_auth.js` | Auth middleware shared by all routes (hjälpare, ingen rutt) |
| `api/_flags.js` | Funktionsflaggornas grind — `enabled` + `allowed_user_ids`. Delas av knowledge/check-role/explain (hjälpare, ingen rutt) |
| `api/_education.js` | Utbildningskatalogen (Skolverket) + `PROFILE_FIELDS`, den stängda listan över vad P.E.R. får veta (hjälpare, ingen rutt) |
| `api/_learner-profile.js` | Läser/skriver `learner_profile_facts` och bygger P.E.R:s elevkontext (hjälpare, ingen rutt) |
| `api/_concept-tags.js` | Kanonisk form för modellens begreppstaggar — nyckeln till `user_profiles.mastery` (hjälpare, ingen rutt) |
| `api/_mastery-view.js` | Läser kunskapsläget och avgör nästa steg. Enda vägen ut ur `mastery` (hjälpare, ingen rutt) |
| `api/_adaptive-exam.js` | Vad elevens kunskapsläge betyder för nästa prov — viktning, aldrig svårighet (hjälpare, ingen rutt) |
| `api/_learner-context.js` | **Enda vägen** för elevuppgifter in i en prompt. Rangordnar uppmätt > sagt > härlett (hjälpare, ingen rutt) |
| `api/_per-sales.js` | Avgör OM P.E.R. får sälja, utifrån var eleven är — inte utifrån frågans ord (hjälpare, ingen rutt) |
| `api/_per-role.js` | Studieplanerare och utmanare — de två roller som kräver belagd mastery (hjälpare, ingen rutt) |
| `api/_math-curriculum.js` | Matematikens läroplan ur Skolverket — grundskolan per stadium, gymnasiet per kurs (GY11 + Gy25) + ExGens prerequisite-kedja (hjälpare, ingen rutt) |
| `api/_solution-ocr.js` | Avläsning av elevens handskrivna matematiklösning — prompt, schema, radvis sanering (hjälpare, ingen rutt) |
| `api/_provia-faq.js` | Hur ExGen fungerar, citerbart av P.E.R. Bifogas villkorat via `faqRelevant()` (hjälpare, ingen rutt) |
| `api/_provia-roadmap.js` | ExGens nästa steg — Alléskolan-pitchen med verifierad statistik (hjälpare, ingen rutt) |
| `api/_per-core.js` | **PER Core Engine** — callAI + personality (ESM, importeras av explain/teacher-report) |
| `api/generate-exam.js` | OpenAI call — rate-limit enforced (CJS) |
| `api/grade.js` | OpenAI call — validates user owns exam (CJS) |
| `api/explain.js` | P.E.R chat + körkortsförklaring + felbankstips — quota enforced (ESM) |
| `api/check-role.js` | Returns user role — never trust client-side role. Bär även delete-exams och Stripe-portalen |
| `api/signup.js` | Creates user row — validate all inputs |
| `api/admin.js` | Admin-only — verify role server-side. `body.action`-dispatch (list-users, set-role, approve, …) |
| `api/ocr.js` | File upload — sanitize paths. Två lägen: material (default) och `mode:"solution"` för handskrivna lösningar |
| `api/teacher-report.js` | P.E.R lärarrapport — auth required (ESM) |
| `api/create-checkout-session.js` | **Betalning.** Skapar Stripe-session — auth krävs, plan får aldrig tas från klienten okontrollerat (ESM) |
| `api/stripe-webhook.js` | **Betalning.** Ingen `_auth` — verifieras med Stripes signatur (`constructEvent`), inte med JWT. Måste vara idempotent (ESM) |
| `api/hp.js` | Högskoleprovet, `body.op`-dispatch (generate/diagnose/realprov) — facit hålls tillbaka före inlämning (ESM) |
| `api/knowledge.js` | Knowledge & Learning Engine, `body.op`-dispatch — återanvänder `_auth.js` (ESM) |

<!-- api/smart-tips.js stod i tabellen tills 2026-08-11 men togs bort ur repot
     redan i 8ec11c4, då den veks in i explain.js för att komma under Vercels
     12-funktionstak. Raden levde vidare i flera månader och lästes som sanning.
     Samtidigt saknades fyra rutter helt — create-checkout-session,
     stripe-webhook, hp och knowledge — trots att rubriken säger
     "security-sensitive" och två av dem hanterar betalningar.

     Lägg till en rad samma commit som filen skapas, och ta bort raden samma
     commit som filen försvinner. -->



Any change to `api/` triggers security review checklist:
- [ ] Input validated before use
- [ ] Auth checked via `_auth.js` before data access
- [ ] No secrets in response body
- [ ] No raw SQL string interpolation

## Utbildningsmodell och elevprofil (2026-08-23)
- **Katalogen är genererad, inte skriven.** `config/education-catalog.json` (server)
  och `education-catalog.web.json` (klient) kommer från `tools/sync-skolverket.mjs`
  mot Skolverkets Syllabus API. Redigera aldrig filerna för hand — kör om skriptet.
  `node tools/sync-skolverket.mjs --check` säger om de är inaktuella.
- **GY11 och Gy25 lever parallellt.** Ämnesbetygsreformen gäller utbildning som
  startar efter 2025-06-30, men elever som började dessförinnan läser GY11-kurser
  och all deras provhistorik hänger på de kurskodernas namn. Ta aldrig bort GY11.
- **Gissa aldrig ett kursnamn.** Sex namn i den gamla hårdkodade listan fanns inte i
  någon läroplan. Slå upp namnet i katalogen i stället —
  `tests/education/education-catalog.test.mjs` faller om ett namn inte går att lösa.
- **`profiles.persona` ger ingen behörighet.** persona (elev/lärare/förälder) är vem
  användaren säger sig vara. `profiles.role` är vad de får se. Lärarpanelen kräver
  fortsatt `role='teacher'`, som bara en admin kan sätta.
- **`learner_profile_facts.source` får inte kollapsa.** `user` och `observed` får
  påstås av P.E.R.; `inferred` under 0.65 confidence får forma svaret men aldrig
  uttalas. `saveInferred()` skriver aldrig över ett fält användaren själv fyllt i.
- **`config/**` måste ligga i `includeFiles`** i `vercel.json` för varje funktion som
  läser katalogen, annars saknas filen i produktionsbundeln.

## Kunskapsläge per begrepp (2026-08-23)
- **Servern äger `user_profiles.mastery`.** `api/grade.js` skriver via
  `apply_mock_mastery()`. Klienten har varken update- eller delete-rätt längre —
  `app.html`s `updateMastery()` är borttagen. Lägg aldrig tillbaka en klientskriven
  mastery: eleven kunde sätta sin egen siffra till 100, och P.E.R. använder den
  för att välja svårighetsgrad.
- **`concept_tag` är obligatorisk i `generate-exam.js`s schema.** Faller den ur
  `required` blir taggen valfri igen och tomma taggar smyger tillbaka utan att
  något går sönder synligt. Uppmätt före fixen: 42 av 72 rättade frågor hade tom
  tagg och gav noll kunskapsdata.
- **Läs taggen med `resolveConceptTag()`, aldrig `q.concept_tag` direkt.**
  Flervalsfrågor rättas deterministiskt och får ingen tagg från AI-rättningen;
  äldre frågor saknar fältet helt. Uppslaget faller tillbaka på `subtopic` och
  `topic`, men hoppar över generiska ord (`Principer`, `Allmän del`) och
  platshållaren `Okänt` — en tagg som ser riktig ut men inte är det är värre än
  ingen tagg.
- **`topic` och `subtopic` följer ingen konsekvent hierarki.** Produktionsdata
  innehåller både `{topic:"Konsumenträtt", subtopic:"Bytesrätt"}` och det omvända
  `{topic:"Presumption", subtopic:"KKöpL"}`. Välj aldrig ett av fälten blint.
- **Nyckeln måste normaliseras med `conceptKey()`.** Modellens `concept_tag` är
  fritext och driver isär — 99 taggar från tre elever innehöll
  `Konsumenträtt`/`Konsumenträttigheter` och `multiple_choice` som "begrepp".
  En onormaliserad nyckel splittrar elevens historik så att inget begrepp når
  tröskeln för att säga något.
- **Repetitionsintervallet följer kunskapsnivån** (`reviewIntervalFor()`): 4 dagar
  för svaga begrepp, 12 för mellanskiktet, 30 för det som sitter. En konstant för
  alla var fel åt båda hållen. Repetitionsregeln sorterar på hur långt över SITT
  intervall ett begrepp ligger — sorteras det på antal dagar vinner alltid det
  starkaste, bara för att det har längst intervall.
- **Tre försök krävs innan P.E.R. får påstå något** (`MIN_ATTEMPTS_TO_TRUST`).
  Under det är siffran tur eller otur, och ett påstående om vad en elev är dålig
  på måste vara belagt.
- **Skalan 0–100 är intern — även i gränssnittet.** P.E.R. får aldrig läsa upp
  den, och `förbättring.html` visar nivån i ord (`behöver träning` / `på gång` /
  `sitter`). Ingen har förklarat vad 47 betyder och ingen lärare har satt den, så
  en siffra läses som ett betyg.
- **Rendera aldrig `decideNextFocus().reason`.** Den texten är skriven för
  prompten och innehåller siffran. Använd `nextFocusForDisplay()`, som skriver om
  skälet för eleven. Ett browsertest som mockar serversvaret kan inte fånga den
  läckan — servertestet i `tests/per/mastery-view.test.mjs` gör det.
- **`grade.js` är CJS.** Importera `_concept-tags.js` dynamiskt, aldrig statiskt —
  en statisk import över CJS/ESM-gränsen dödar funktionen vid inladdning
  (`ERR_REQUIRE_ESM`, samma avbrott som tog ned `/api/explain` 2026-08-22).

## Elevkontexten är ETT block (2026-08-23)
- **Lägg aldrig till ett eget elevavsnitt i prompten.** Allt om eleven går genom
  `buildLearnerContext()`. Fram till 2026-08-23 byggde fyra filer var sitt avsnitt
  utan att veta om varandra, och P.E.R. fick tre olika svar på "vad är eleven svag
  på" — ett uppmätt och två gissade, utan rangordning.
- **Rangordningen är uppmätt > sagt > härlett.** Ett begrepp som finns i
  `user_profiles.mastery` med minst tre försök undertrycker AI:ns gissning om
  samma begrepp (`dropMeasured()`). Bryt aldrig den ordningen.
- **Härledda uppgifter måste märkas.** De ligger under en rubrik som säger att de
  får forma svaret men aldrig påstås. Utan markeringen läses en gissning som en
  mätning.
- **Användningsinstruktionen står EN gång**, sist i blocket. Senare instruktioner
  väger tyngre i en systemprompt. Lägg den inte i delblocken igen — den stod
  tidigare i tre kopior samtidigt.
- **Hjälpstilen bokförs bara i `learner_profile_facts`.** `recordHelpPreference()`
  skriver den härledda signalen som `inferred`; `saveInferred()` skyddar automatiskt
  elevens eget svar från onboardingen.

## Försäljning i P.E.R. (2026-08-23)
- **Säljläget avgörs av kontext, aldrig av ett ord i frågan.** `decideSalesMode()`
  tittar på var eleven är och vad de gör. Det gamla mönstret matchade `gräns`,
  `plan`, `hur många` och `jämföra med` — sju av nio typiska studiefrågor utlöste
  säljprompten, så en elev som frågade om gränsvärden mitt i ett matteprov fick en
  prisjämförelse.
- **`IN_EXAM` och `WORKING` är säljfria zoner.** Under ett pågående prov väntar
  även en rak prisfråga: eleven har en klocka som tickar.
- **Men vägra aldrig svara på en rak prisfråga utanför provet.** Att vika undan
  från "vad kostar Premium" är otjänlighet, inte finkänslighet.
- **Böj inte av med `\b` i svenska mönster.** `\bprenumeration\b` missar
  `prenumerationen`. Lås ordstarten, låt slutet vara öppet (`\w*`).
- **Landningsläget säljer genom att hjälpa.** Besökaren får svar på sin fråga
  först — även ämnesfrågor. Den gamla prompten avvisade dem med "det svarar jag
  bättre på inne i appen", vilket lärde besökaren att produkten inte hjälper.
  Uppmaningen att skapa konto är **valfri**, max en, och får aldrig krävas i varje svar.
- **Varje `[GOTO:x]` i en prompt måste finnas i `_perNavLabels`** (shared.js).
  Klienten validerar målet och ritar ingen knapp för ett okänt namn — besökaren
  blir då kvar utan vägen vidare. Uppmätt 2026-08-24: landningsprompten saknade
  `app.html`, och modellen hittade på `mockprov.html` för att den ville skicka
  någon till provskaparen.
- **P.E.R. får aldrig påstå något om lagringstid eller gallring.** Modellen fyllde
  i "sparas inte längre än nödvändigt" — ett löfte om personuppgiftshantering som
  inte står i FAQ:n och ingen kan infria. FAQ:n förbjuder det uttryckligen och
  hänvisar till integritetspolicyn.
- **`PROVIA_FAQ` får inte upprepa priser eller kvoter.** De byggs ur `PLAN_RULES`
  av `buildPlanFacts()`; står de på två ställen ger nästa prisändring två svar.

## Adaptiva prov (2026-08-24)
- **Viktning, inte svårighet.** Kunskapsläget styr VILKA begrepp provet handlar
  om. Nivån (E/C/A) väljer eleven själv — att i hemlighet sänka den för någon med
  låg mastery vore att ljuga om vad ett C-prov är.
- **Högst 40% riktade frågor** (`MAX_WEAK_SHARE`). Ett prov som bara prövar
  svagheter är demoraliserande, mäter inte om det eleven kan sitter kvar, och
  liknar inte det riktiga provet. Samma storleksordning som körkortsmodulens
  adaptiva urval.
- **Materialet styr alltid.** Instruktionen säger uttryckligen att modellen aldrig
  får hitta på innehåll som saknas i materialet för att träffa ett svagt område.
- **Provet får inte annonsera att det är anpassat.** Ett prov som säger "det här
  är dina svagheter" läses som en dom, inte som ett prov.
- **Bara belagda begrepp styr** (≥3 försök). Ett enda felsvar får inte bygga ett
  helt prov — då sätter slumpen elevens studieplan.
- **`generate-exam.js` är CJS.** Importera `_adaptive-exam.js` dynamiskt. En
  profilläsning har 4 s timeout och returnerar tom sträng vid varje fel — den får
  aldrig fälla en provgenerering eller äta av genereringsbudgeten.

## P.E.R:s pedagogiska roller (2026-08-24)
- **De flesta rollerna finns redan** i `buildPERSystemPrompt`: `helpLevel 0` är
  sokratisk, `1–2` undervisande, `quiz` examinerande, `feynman` återkopplande,
  `intent === 'support'` kontohjälp. Lägg inte till en åttonde variant utan att
  först se om beteendet redan finns.
- **`_per-role.js` täcker bara de två roller som kräver belagd mastery.**
  Studieplaneraren (eleven frågar vad de ska göra) och utmanaren (eleven frågar
  om något de bevisligen kan).
- **Utmanaren kräver ≥3 försök.** Att höja ribban för någon som råkat ha tur en
  gång är att sätta dem på ett prov de inte klarar.
- **Ett pågående prov slår varje roll.** En studieplan när eleven har en klocka
  som tickar är rätt svar på fel fråga.
- **Rollen får aldrig synas för eleven.** §11 är uttrycklig: P.E.R. ska förstå
  vilket beteende som passar, inte annonsera det.

## Matematikens läroplan (2026-08-24)
- **Två sorters påståenden, aldrig ihopblandade.** `centralContent` och
  `criteria` är Skolverkets text ordagrant och får citeras som läroplan.
  `prerequisites` är **ExGens pedagogiska bedömning** — Skolverket säger vad som
  ska läras i varje stadium, aldrig att procent förutsätter bråk.
- **Säg aldrig att läroplanen kräver en viss ordning.** Promptblocket i
  `buildCurriculumContext()` ger P.E.R. formuleringen "det här brukar bygga på…"
  och förbjuder "enligt kursplanen". Ett falskt auktoritetspåstående till en elev
  som redan kämpar är värre än ingen vägledning.
- **Områdesnycklarna behåller å, ä och ö.** De härleds ur Skolverkets rubriker;
  en translitterering bryter kopplingen tyst.
- **`config/math-curriculum.json` är genererad.** Kör
  `node tools/sync-math-curriculum.mjs` — skriptet vägrar skriva filen om något
  prerequisite pekar på ett område som inte finns.
- **Hellre ingen områdeskoppling än en gissad.** `areaForConcept()` returnerar
  null när inget mönster träffar; en felaktig koppling skickar eleven att
  repetera något de redan kan medan luckan står kvar.

## Fotoinlämning av handskrivna lösningar (2026-08-25)
- **Transkriptionen ÄR svaret.** Den skrivs in i `S.answers[id]` i
  `js/exam-flow.js`, och därifrån går rättning, felbank, begreppstaggar och
  mastery oförändrat. Bygg aldrig en parallell pipeline för fotosvar — hela
  poängen är att det inte behövs.
- **Modellen får ALDRIG lösa, rätta eller komplettera.** Står det `x = 8` när
  svaret är 5 ska transkriptionen säga 8. Rättar den tyst bedöms eleven för ett
  arbete de inte utfört, felet når aldrig felbanken, och mastery stiger på en
  kunskap de inte har. Regeln står först OCH sist i prompten och är testfall T3 i
  `tests/api/solution-ocr.test.mjs`.
- **Bilden lagras aldrig.** Skickas en gång, kastas. Eleverna är till stor del
  minderåriga och ett räknepapper bär ofta namn i marginalen. Prompten förbjuder
  dessutom att marginaltext transkriberas.
- **Eleven bekräftar före inlämning.** Transkriptionen är redigerbar och
  granskningsraden listar osäkra ställen. Det är skyddet mot felläsning — inte
  att avläsningen är felfri.
- **Saneringen sker RADVIS.** `redactInstructions()` normaliserar `\s+` till
  mellanslag och plattar annars en uträkning till en rad. Radordningen bär
  resonemanget.
- **`ocr.js` är CJS, `sanitize.mjs` är ESM** — importen måste vara dynamisk.
  `src/per/**` ligger i `includeFiles` för `ocr.js` i `vercel.json`.
- **`OPENAI_VISION_MODEL` är förberedd men inte satt.** Evalen i
  `tests/evals/solution-ocr/` mäter teckenfel och — viktigare — hur ofta modellen
  låter bli att rätta elevens fel. Bilderna är syntetiska och därför
  systematiskt för optimistiska; modellvalet låses först mot riktiga foton.

## Matematikdjupet (2026-08-25)
- **Grundskolan indexeras på STADIUM, gymnasiet på KURS.** Det är inte en
  inkonsekvens utan hur läroplanerna är byggda: en grundskoleelev läser
  matematik, en gymnasieelev läser Matematik 3c.
- **GY11 (`MAT`) bär innehåll och kriterier på KURSEN. Gy25 (`MATE`) bär
  innehållet på nivån och kriterierna på ÄMNET** — ett ämnesbetyg sätts på ämnet,
  vilket är hela reformen. `buildCourseContext()` säger uttryckligen att Gy25:s
  kriterium gäller ämnet, inte den enskilda nivån.
- **Gymnasiet har INGEN prerequisite-kedja.** ExGen har inte gjort den
  bedömningen, och en gissad ordning mellan Ma3c och Ma4 vore precis det fel som
  grundskolans prerequisite-not finns för att förhindra. Blocket förbjuder
  uttryckligen påståenden om ordning mellan kurser.
- **Parsern måste klara `<h4>`, `<p><strong>` och `<p><em>`.** Grundskolan
  använder det första, GY11 det andra, Gy25 det tredje. Första versionen kunde
  bara `<strong>` och gav noll områden för samtliga sex Gy25-nivåer — synken
  vägrade skriva filen, vilket var rätt.
- **Notation och rendering hänger ihop.** `generate-exam.js` MATTE-LÄGE kräver
  LaTeX mellan `$...$`; `js/hp-math.js` renderar det i provet, rättningen och
  P.E.R:s svar. Tas notationsregeln bort finns inget att rendera och hela kedjan
  blir verkningslös. KaTeX hämtas först när en text faktiskt innehåller
  matematik — en ren textfråga får aldrig kosta 280 kB.
- **Rendera P.E.R:s svar först när strömningen är klar.** `$\frac{3` är inte
  giltig LaTeX. Kopieringen använder LaTeX-KÄLLAN, inte den renderade texten.
- **Matterättningen bedömer lösningsgången.** Rätt metod med ett räknefel ger
  delpoäng; rätt slutsvar utan uträkning ger inte full poäng när rubric kräver
  metod. Följdfel bestraffas en gång. Och: dra ALDRIG av för notation eller
  otydlig symbol — svaret kan vara en transkription av elevens handstil, och då
  bestraffas eleven för hur en modell läste deras papper.
- **Ämnet avgörs av `assessment.detectSubjectProfile()`, på ett ställe.** Ett eget
  mönster i `grade.js` hade drivit isär: ett prov kunde genereras som matte och
  rättas som vilket ämne som helst.

## P.E.R:s minnessida (2026-08-25)
- **Registret bor i `api/_per-registry.js`, aldrig i `config/`.** `vercel.json`
  har `outputDirectory: "."`, så hela repotroten serveras statiskt — mätt
  2026-08-25 svarar `/config/education-catalog.json` med 200 medan
  `/api/_site.js` ger 404 tack vare understrecksprefixet. En registerfil i
  `config/` hade legat öppen för vem som helst.
- **`tests/per/per-registry.test.mjs` går rött åt BÅDA hållen.** En
  `api/_per-*.js` utan post, och en post som pekar på en fil som inte finns.
  Flaggnycklarna härleds ur koden i två mönster: `flagsEnabled([...])` och
  `from("feature_flags") … .eq("key", …)` — `_per-cache.js` och `explain.js`
  läser sina flaggor direkt, utan att gå genom grinden. Slutar båda regexarna
  matcha blir varje kontroll grön på tomma mängder, och därför kontrollerar
  testet först att härledningen hittade något alls.
- **`legal_rag_enabled` och `per_legal_rag_enabled` är OLIKA flaggor.** Den
  första grindar kunskapsmotorns rättskällor i `api/knowledge.js`, den andra
  juridikläget i `api/explain.js`. Namnen skiljer sig med ett prefix och
  gäller olika grenar — läs `PER_REGISTRY.flaggor` innan du rör någon av dem.
- **Tomt underlag skrivs som `TOO_FEW`, aldrig som `0`.** Produktionen har ett
  fåtal konton. En nolla som ser ut som ett mätvärde får läsaren att tro att
  cachen aldrig träffar, när sanningen är att den aldrig fått chansen. En
  träffkvot under 20 sonderingar (`MIN_PROBES`) är brus, inte en mätning.
- **Pulsen är aggregat, aldrig enskilda elever.** Ingen `select` i
  `per-pulse`-blocket hämtar `user_id`, och `tests/api/per-pulse.test.mjs`
  läser select-strängarna och faller om någon börjar. Eleverna är till stor del
  minderåriga; en uppslagsfunktion över deras minnen vore en övervakningspanel
  som personuppgiftsavtalet inte täcker.
- **`concept_collective_stats` bär k-anonymiteten själv** — fem distinkta
  elever per begrepp, tre per felkod. Sidan läser vyn som den är och lägger
  varken till eller tar bort en tröskel.
- **Sidan är rollgatad, inte låst med Face ID än.** `requireAdmin` är gaten.
  WebAuthn-lagret är Del B i
  `docs/superpowers/specs/2026-08-25-per-minnessida-design.md`, och en passkey
  autentiserar en ENHET — den är aldrig ett ersättningsgate för rollkollen.
- **`per.html` ska inte in i `sitemap.xml`.** Faller
  `sitemap-lastmod.test.mjs` på den betyder det att någon lagt in den där; ta
  bort raden i stället för att ändra testet. `robots.txt` och `noindex` är
  begäranden, inte skydd — skyddet är serverns rollkoll.
- **En worktree saknar `node_modules`.** Playwright-testerna kraschar med
  `ERR_MODULE_NOT_FOUND` tills du länkar in den:
  `ln -s /Users/elton1/provia-ai/node_modules node_modules`. Länken pekar på huvudrepots
  katalog, som **alla** worktrees delar — ett nytt beroende måste därför
  installeras i `~/provia-ai`, inte bara i den worktree som lade till det.
  Uppmätt 2026-08-25: `@simplewebauthn/server` installerades i Del B:s
  worktree, den togs bort vid merge, och nästa worktree fick
  `ERR_MODULE_NOT_FOUND` på ett test som var grönt en timme tidigare.
- **`per.html` nås via en knapp i adminpanelen.** Sidan är olistad — inte i
  sitemapen, `Disallow` i robots.txt, ingen länk från sajtens navigering — men
  `admin.html` är själv rollgatad och robots-utesluten, så en länk därifrån
  syns bara för den som redan tagit sig in. Olistad betyder svår att hitta för
  andra, inte omöjlig att hitta för Elton.

## Hjärnans utseende och rörelse (2026-08-25)
- **Tempot mäter HELHETEN, ljusstyrkan mäter en modul.** `systemTempo()`
  summerar hela grafens senaste timme mot dess dygnsmedel; kartan rör sig
  fortare en kväll när många pluggar än en söndagsmorgon när ingen gör det.
  Båda måtten har samma referenspunkt — dubbelt mot dygnsmedlet är full
  utslag — eftersom två mått mot olika referenser är omöjliga att jämföra.
- **`TEMPO_BAS = 0.35`, aldrig noll.** Med tom mättabell rör sig kartan ändå.
  En stillastående karta läser som trasig, inte som lugn, och tom mättabell är
  precis läget vid lansering.
- **Tempot står utskrivet i underrubriken.** En rörelse ingen kan tolka är
  dekoration; en siffra gör den till information.
- **Både amplitud OCH frekvens skalar med tempot.** Bara amplitud gav 1,14x
  mätt skillnad mellan bas och full fart — synligt i en graf, men inte det
  som efterfrågades.
- **Mät rörelse över ETT KORT fönster.** Första mätningen använde en sekund
  och saturerade: 12177 mot 12295 ändrade pixlar, alltså ett mått som inte
  kunde skilja långsamt från snabbt. Över 120 ms är antalet ändrade pixlar
  ungefär proportionellt mot farten — 5730 mot 8439. Instrumentet var fel,
  inte funktionen, och att sänka tröskeln hade dolt det.

- **Rörelsen är kontinuerlig men inte ovillkorlig.** Kartan rör sig så länge
  fliken är SYNLIG och pausar via Page Visibility när den inte är det. Det
  gamla stoppvillkoret ("stanna när grafen lagt sig") är bytt, inte borttaget:
  en `requestAnimationFrame` som snurrar i evighet på en bortglömd flik är en
  varm telefon och ingen information. `per-passkey.test.mjs` T21–T23 mäter
  BÅDA halvorna — bara den första hade gett tillbaka det gamla problemet med
  en grön bock på. Sabotageverifierat: utan pausen 48 bildrutor med fliken
  gömd i stället för 0.
- **`prefers-reduced-motion` stänger av drift, partiklar och pulsringar.** Den
  som satt den i sitt system har bett om det, och en dekorativ animation är
  inte värd att strunta i det.
- **Databastabeller är en egen nodtyp**, härledd ur `.from("x")` följt av en
  PostgREST-metod. Kravet på metoden är inte överdrivet: `.from()` finns också
  i `Buffer.from` och `Array.from`, och ett naivt mönster hade en dag ritat en
  tabell som heter `base64url`. Testet låser båda fallen. Grafen växte från 37
  noder och 49 kanter till 55 och 77.
- **Bara tabeller som P.E.R:s egna filer rör kommer med.** En tabell som bara
  nämns av en fil utanför kartan ritas inte — annars växer grafen med saker
  P.E.R. inte har med att göra.
- **Etiketter ritas selektivt** — navet, det som lyser, och det man valt. Alla
  55 namn samtidigt är en vägg av text, inte en karta.
- **Konturen för omätta noder är inte en stilfråga.** `aktivitet === null`
  betyder ingen mätpunkt; en fylld nod med svag färg hade lästs som "mätt och
  tyst".
- **Partiklarnas fart följer aktiviteten** i kantens ändpunkter. Samma regel
  som ljusstyrkan: rörelsen ska betyda något, annars är kartan en
  skärmsläckare.

## CJS/ESM: import.meta tog ned adminpanelen (2026-08-25)
- **Ingen fil i `api/` utan `_`-prefix får använda `import.meta`.** De blir
  serverlösa funktioner, filerna heter `.js` och `package.json` saknar
  `"type": "module"` — Vercel laddar dem som CJS, där `import.meta` är ett
  **syntaxfel**. Modulen kan då inte laddas alls, och hela rutten svarar 500,
  även på metoder som skulle gett 405.
- **Uppmätt:** `dirname(fileURLToPath(import.meta.url))` i `api/admin.js` gav
  `SyntaxError: Cannot use 'import.meta' outside a module` på rad 815 och tog
  ned adminpanelen i produktion. Reverterad efter några minuter.
- **Varför inget befintligt test fångade det:** varje test i repot kör i Node
  som ESM, där `import.meta.url` fungerar utmärkt. Även kontrollen "parsar
  admin.js?" var grön — den parsade, SOM ESM.
  `tests/api/cjs-esm-boundary.test.mjs` läser källkoden som text i stället,
  vilket är det enda sättet att se skillnaden utan att köra i CJS.
- **Samma test förbjuder `readdirSync`/`readFileSync` i rutter.** En rutt som
  läser sin egen katalog förutsätter att källfilerna ligger på disk i den
  buntade funktionen. Det gör de inte utan `includeFiles` — och då hänger
  funktionen på en rad i `vercel.json` som ingen kommer ihåg.
- **Generera i stället.** `tools/build-per-graph.mjs` skriver
  `api/_per-graph-data.js`, samma mönster som `config/math-curriculum.json`.
  Kör den när `api/` ändrats; `--check` säger om filen är inaktuell och
  `tests/per/per-brain.test.mjs` faller om den glidit isär från källan.
- **Filen ligger i `api/`, inte i `config/`** — `config/*.json` serveras
  statiskt och är publikt hämtbart.
- **Omsorgen låg på fel ställe.** Jag skrev en genomtänkt kommentar om
  `includeFiles` och en guard mot en tom karta, medan det verkliga felet låg
  tre rader ovanför och gjorde hela rutten oladdbar.

## Vänta på villkoret, inte på klockan (2026-08-25)
- **Och mät flera gånger när måttet är brusigt.** T25 räknade bildrutor i
  stället för millisekunder — rätt fix mot belastning — men EN mätning per
  tempo varierade ändå: kvoterna 1,43 · 1,41 · 1,397 mot en tröskel på 1,4.
  Den föll alltså ungefär varannan körning. Median av tre ger 1,42 både
  opåverkat och under last, med 1,7 % respektive 0,6 % spridning inom
  serierna.
- **Att sänka tröskeln hade dolt spridningen i stället för att minska den.**
  Tre gånger under det här arbetet var en justerad siffra ett steg bort från
  grönt: när tempot bara gav 1,14x, när mätfönstret saturerade, och här.
  Varje gång satt felet i funktionen eller i instrumentet.
- **En fast `waitForTimeout` före en interaktion är en flakkälla.**
  `stale-session.test.mjs` klickade upp P.E.R.-panelen och väntade 500 ms innan
  den skrev i `#perInput`. Lokalt räckte det; i en full svitkörning på 777 s,
  där flera Chromium konkurrerar, hann öppningsanimationen inte klart och
  riggen kastade med "element is not visible" — mitt i, efter nio godkända
  kontroller.
- **Symtomet är förrädiskt:** filen var grön ensam OCH grön under konstlad
  last med sex parallella Chromium. Ett tidsberoende syns bara ibland, och
  "kan inte reproducera" är därför inget bevis på att det inte finns.
- **Fixen är `waitFor({ state: "visible" })`**, inte en längre paus. En längre
  paus flyttar bara gränsen; villkoret tar bort den.
- Samma familj som T25 i `per-passkey.test.mjs`, som mätte rörelse över ett
  fast tidsfönster och blev belastningskänslig. Räknar nu bildrutor.
- **Samma mönster fanns i `anon-per.test.mjs`** och föll i nästa körning. När
  riggen kastar rapporteras ÄVEN kontroller som mäter helt andra saker som
  röda — tre orelaterade kontroller blev röda av en paus som var 200 ms kort.
- **`tests/frontend/rigg-vantar-pa-villkor.test.mjs` hindrar återfall**, men
  bara för `#perInput` i P.E.R.-panelen. Två bredare formuleringar provades
  först och fällde tio respektive sju GRÖNA filer — mest navigeringsklick i
  provflödet som aldrig fallit. **En regel som fäller fungerande kod blir
  ignorerad eller raderad, och skyddar då ingenting.** Faller något annat på
  samma sätt: utvidga regeln DÅ, med det fallet som grund.

## Hur P.E.R. undervisar (2026-08-25)
- **`## UNDERVISNING` var 154 tecken** — tunnast av fjorton avsnitt, medan
  `## NÄR FRÅGAN ÄR OTYDLIG` var 1808. Hela instruktionen löd "ställ EN
  motfråga, ge INTE svaret". En bra regel, men ingen metod. Uppmätt genom att
  bygga prompten och mäta varje avsnitt, inte genom att läsa koden.
- **TVÅ SORTERS PÅSTÅENDEN, ALDRIG IHOPBLANDADE** — samma regel som
  `_math-curriculum.js` bär. **Förmågorna** är Skolverkets ord ordagrant, ur
  ämnets syfte, och får citeras som läroplan. **Polyas fyra steg** är en metod
  från 1945 och får ALDRIG framställas som något Skolverket kräver. Blocket
  säger det uttryckligen, och testet låser raden.
- **Förmågorna GENERERAS av `tools/sync-math-curriculum.mjs`**, inte skrivs av.
  De ligger i `subject.purpose`, inte i det centrala innehållet: innehållet
  säger vad som ska läras, förmågorna vad eleven ska kunna GÖRA med det.
  Synken vägrar skriva filen om uppräkningen inte hittas — en tom lista betyder
  att Skolverket ändrat form, inte att ämnet saknar förmågor.
- **Polya bifogas bara vid matematik.** Fyra steg om problemlösning i ett svar
  om Vasatiden är brus, och prompten betalas per tecken i varje anrop.
- **Stegen namnges aldrig för eleven.** De finns för att P.E.R. ska veta VAR
  eleven fastnat och rikta sin enda motfråga dit. En elev som inte förstått
  problemet blir inte hjälpt av en räkneregel.
- **Genomräknade exempel måste använda ANDRA siffror än uppgiften.** Det är
  raden som skiljer "visa metoden" från "lös elevens uppgift åt dem".
- **Hjälpnivå 0 och 1 får en egen varning** i blocket. Det vanligaste sättet
  att svika en begärd ledtråd är att förklara så utförligt att uppgiften är
  löst på köpet.
- **`import.meta` är säkert i `_per-core.js`** — filen är ESM och importeras
  bara av ESM-rutter. Regeln i `cjs-esm-boundary.test.mjs` gäller `api/*.js`
  UTAN understrecksprefix, som Vercel gör till funktioner och laddar som CJS.

## Previews mot rätt Vercel-projekt (2026-08-25)
- **`vercel deploy` från en worktree skapar ett NYTT projekt**, döpt efter
  katalogen, i stället för en preview av `provia-ai`. Worktreen saknar
  `.vercel/project.json` — den ligger bara i `~/provia-ai`.
- Uppmätt 2026-08-25: tre skräpprojekt skapades på en kväll
  (`per-granskare`, `per-visual2`, `per-hjarna2`) innan någon märkte det.
  Borttagna med `printf 'y\n' | vercel project rm <namn>` — `--yes` finns inte
  i CLI 56.
- **Gör så här i stället:** kopiera `.vercel/` in i worktreen först, eller kör
  `vercel deploy` från `~/provia-ai` med `--prebuilt` mot rätt gren. Det som
  betyder något är att `.vercel/project.json` pekar på
  `prj_ZCmoY24WF0r5ZAGm7uy5VXEC4ILJ`.
- **Previewen är fortfarande värd besväret.** Sviten kör som ESM; Vercel kör
  rutterna som CJS. Det var den skillnaden som tog ned adminpanelen, och en
  preview är enda stället den syns före produktion.

## Två kunskapssystem som inte matade varandra (2026-08-25)
- **`grade.js` skrev `user_profiles.mastery`. `_per-collective.js` läser
  `student_attempts`.** Skrivvägen dit gick BARA genom `knowledge.js` →
  orchestrator → `commitAssessment()`, alltså juridikpiloten, och
  `per_learner_loop_enabled` är begränsad till ett konto. Kollektiva lagret
  kunde därför ALDRIG få data, hur många elever som än pluggade. Uppmätt
  2026-08-25: 0 rader i `student_attempts` och `student_error_events`, medan
  mastery hade rader.
- **`src/per/learner-model.mjs` anropades inte av någon rutt.** Koden var
  mergad (PR #12, 2026-08-11), testad och komplett. Migrations-README:n sa
  fortfarande att PR #12 var öppen — den var inaktuell.
- **Den saknade länken är begrepps-id.** `grade.js` har `concept_tag` som
  text; `student_attempts.concept_id` är en UUID mot `concepts`. Ett försök
  utan `concept_id` filtreras bort av `concept_collective_stats`, så en
  skrivning utan uppslag hade gett rader som inte bidrar med något.
  `api/_per-attempt.js` gör uppslaget och skapar begreppet vid behov.
- **`Number(null)` ÄR 0, och 0 är finit.** Första versionen av
  `normaliseraPoäng()` lät en fråga utan poäng bli ett registrerat
  NOLLRESULTAT — eleven hade fått fel på arbete som aldrig bedömts, och
  mastery hade dragits ner på det. Avvisa null, undefined och tom sträng FÖRE
  `Number()`.
- **Idempotensnyckeln byggs av inlämningen, inte av ett prov-id.**
  Rättningsanropet bär inget prov-id. Nyckeln är en hash av elev, kurs, frågor
  OCH svar: att rätta om identiskt arbete är samma försök, att svara
  annorlunda är ett nytt. Utan svaren i hashen hade en elev som övar om samma
  prov aldrig fått sin repetition mätt.
- **`grade.js` har ingen Supabase-klient** — resten av filen pratar REST med
  `fetch`. `recordAttempt()` vill ha en klient, så en memoiserad skapas via
  dynamisk import. Statisk import hade dödat funktionen: filen är CJS.
- **Skrivningen är additiv och sväljer varje fel.** Rättningen är en het
  kodväg; ett fel där drabbar varje elev som lämnar in ett prov. Den ändrar
  aldrig vad eleven ser och körs efter att poängen räknats.
- **Riktningen framåt: `student_attempts` är sanningen.** Per försök med
  begrepp, nivå, poäng och felkod är finare upplösning än en mastery-siffra,
  och mastery går att räkna FRAM ur den. `user_profiles.mastery` bör bli en
  härledd vy, inte en egen källa.

## P.E.R. granskar sina egna svar (2026-08-25)
- **Mät rörelse över ett fast ANTAL BILDRUTOR, inte över tid.** Ett fast
  tidsfönster är belastningskänsligt: i en full svitkörning konkurrerar flera
  Chromium om CPU:n och de två mätningarna krymper olika mycket. T25 föll i
  svit men var grön ensam — samma mönster som gjorde `per-visual` opålitlig.
  Verifierat under fyra parallella Chromium: 5631 mot 7946 px, mot 5623 mot
  8028 opåverkat.
- **Pipa ALDRIG en svitkörning genom `tail` i bakgrunden.** Faller en fil är
  detaljen borta och det går inte att se vilken kontroll som brast. Det hände
  här, och diagnosen fick byggas på hypotes i stället för på bevis.
- **Granskaren RÄTTAR ALDRIG, den flaggar.** Samma rollåtskillnad som
  `api/_verifier.js`, som granskar genererade provfrågor. En modell som ombeds
  "fixa" sitt eget svar skriver om det till något som låter bättre och tappar
  både felet och spåret av att felet fanns.
- **Chattsvaret var helt ogranskat innan.** `_verifier.js` och `_solver.js`
  fanns sedan tidigare men bara för `generate-exam.js` — den yta eleven läser
  mest gick rakt igenom.
- **`needsReview()` är en REN funktion**, för att avvägningen ska gå att mäta
  utan modell. Ett granskningsanrop dubblar kostnaden per svar; körs den på
  allt blir P.E.R. dyr och långsam, körs den på för lite är den dekoration.
- **Granskningen stoppar inte strömningen.** Den körs när svaret skrivits klart
  och visas som ett eget block UNDER svaret. Att hålla tillbaka texten hade
  fördubblat väntetiden; att tyst skriva om den hade dolt att något var fel.
  En elev som ser att P.E.R. kontrollerar sig själv har mer skäl att lita på
  honom, inte mindre.
- **FAIL OPEN — tvärtemot en säkerhetsgrind.** Ett trasigt granskningssvar får
  aldrig visa en rättelse som inget täcker. Det värsta en utebliven granskning
  gör är att lämna svaret som det var.
- **Men ett SCHEMABROTT släcker hela svaret.** `fynd` som inte är en lista
  betyder att modellen inte följde kontraktet, och då går varken `allvar` eller
  `rättelse` att lita på. En lista med trasiga POSTER är något annat: kontraktet
  hölls, underlaget är tunt, och rättelsen står kvar.
- **"allvarlig" utan rättelse visas inte.** En varning utan besked om vad som
  gäller i stället lämnar eleven sämre ställd än ingen varning alls.
- **`isMath` kommer från `curriculumContext`, inte från ett ord i frågan.**
  Blocket byggs bara av `_math-curriculum.js` och bara när ämnet redan avgjorts.
  Första försöket läste en variabel `course` som inte finns i scope i
  `explain.js` — den hade blivit `undefined` och tyst gjort flaggan värdelös.
- **Ett test kan vara grönt av fel skäl.** Kontrollen "en motfråga granskas
  inte" använde först "hjälp med kemi", som inte matchade något mönster ändå.
  `[CLARIFY:]`-spärren var otestad, och ett sabotage som tog bort den gav
  INGET fel. Exemplet måste innehålla något som annars hade utlöst granskning.

## P.E.R:s hjärna (2026-08-25)
- **Kartan bygger på TRANSITIV STÄNGNING, inte `_per-`-prefixet.** `grade.js`
  och `generate-exam.js` når P.E.R. genom `_concept-tags.js` och
  `_adaptive-exam.js`, som saknar prefixet. Med prefixregeln visade kartan
  P.E.R. som frånkopplad från rättning och provgenerering — falskt, eftersom
  mastery skrivs i `grade.js` och läses av `_per-role.js`. De filerna kommer
  med som typen `hjälpare`, inte `modul`: registret beskriver just `_per-*`,
  och de två ytorna får inte säga olika saker om vad P.E.R. BESTÅR av.
- **`IMPORT_RE` måste täcka den dynamiska formen.** `grade.js` och
  `generate-exam.js` är CJS och MÅSTE importera dynamiskt. Med bara
  `from "…"` tigde kartan om två av sju rutter.
- **Markörerna i `MODUL_MARKÖRER` är lästa ur blockens källkod, aldrig skrivna
  ur minnet.** Första försöket gissade tio markörer och NIO matchade
  ingenting — kartan hade visat tre moduler som aktiva och resten som döda, och
  sett helt trovärdig ut. `per-brain.test.mjs` kräver nu att varje markör finns
  ordagrant i den modul den märker.
- **`modulesInPrompt()` läser den färdiga prompten**, i stället för att
  upprepa villkoren. Att instrumentera varje blockfästning vore ingrepp i en
  het kodväg där ett misstag drabbar varje elevsvar; att kopiera villkoren ger
  två ställen som glider isär.
- **`bumpModules()` AWAITAS.** På Vercel kan ett oawaitat löfte dödas när
  svaret skickas, så "fire and forget" hade betytt tappade skrivningar. Fel
  sväljs — mätningen får aldrig fälla ett svar till en elev.
- **`vercel.json` ger `api/admin.js` `includeFiles: "api/**"`.** Utan den finns
  inte källfilerna på disk i den buntade funktionen och kartan blir tom. En
  guard svarar 500 med orsaken i stället för att servera en tom karta som ser
  ut som "P.E.R. har inga moduler".
- **Simuleringen måste stanna.** En `requestAnimationFrame` som snurrar i
  evighet på en sida som lämnas öppen är en varm telefon och ingen information.
  Sabotageverifierat: utan stoppvillkoret 151 bildrutor och sedan 301, med det
  1 och stopp.
- **Startpositionerna är deterministiska, inte slumpade.** En karta som ser
  annorlunda ut vid varje omladdning tappar det enda en karta är bra på — att
  man minns var saker låg.
- **`aktivitet === null` betyder INGEN MÄTPUNKT, inte noll aktivitet.** Ritas
  som kontur, inte som fylld nod. Sju av tolv block fästs i `explain.js` och
  går att mäta; övriga moduler har ingen mätpunkt alls och ska sägas rakt ut.
  Samma regel som `TOO_FEW` i `_per-pulse.js`.
- **Ljusstyrkan är avvikelse mot modulens eget dygnsmedel, inte volym.** En
  modul som alltid används ska inte lysa starkast bara för att den alltid
  används — då blir kartan en lista över det vanligaste, vilket registret redan
  säger.
- **Committa FÖRE sabotage.** `git checkout` på en fil som aldrig committats
  gör ingenting, och nästa sabotage läggs ovanpå det förra. Det hände tre
  gånger under det här arbetet.

## per-visual: bruset var antialiasing (2026-08-25)
- **`diff()` har en kanaltolerans på 8.** Före det räknades varje pixel med
  NÅGON skillnad alls. Uppmätt orsak till flakigheten: hela bruset var TVÅ
  pixlar som skilde sig med EXAKT 1 enhet i en kanal, på förbättring.html i
  mobilvy. Subpixelrendering är inte deterministisk mellan två skott av samma
  träd.
- **Brusgolvet kunde inte fånga det**, eftersom det mäts ur ETT skottpar:
  paret råkade ibland bli identiskt (golv 0) medan "ny" fick de två pixlarna,
  och `delta > golv` gjorde `2 > 0` till en röd rad. Filen flaggade i tre hela
  svitkörningar i rad och var grön varje gång den kördes ensam.
- **Tröskeln 8 gör inte testet blint.** Sabotageverifierat: `.wrap` padding
  22px → 23px ger 52 858 respektive 3 774 skiljande pixlar. Bruset är 1, en
  verklig ändring mäts i tusental — mellanrummet är stort nog att tröskeln inte
  behöver vara knapp. Mobilvyerna visar korrekt 0 för just det sabotaget:
  mediafrågan i `style.css:754` sätter egen padding under 754px.
- **Höjdtolerans 2 px.** En helsidesbild fångar sidans höjd vid utlösningen och
  den kan skilja en pixel mellan två skott av samma träd. Skiljer den 2 px
  eller mindre beskärs båda till den lägsta; mer än så är en verklig
  höjdändring och ger fortfarande -1.
- **"Känt flakigt" är ingen diagnos.** Den här filen avfärdades tre gånger
  innan någon mätte vad bruset bestod av. Ett test som kräver en mänsklig
  bedömning varje körning är på väg att bli ett test ingen litar på.

## Sidans källkod avslöjade det sidan skulle dölja (2026-08-25)
- **`display:none` döljer för ögat, inte för `view-source`.** `per.html`
  levererade hela den privata markupen till alla och gömde den med CSS. Mätt
  mot produktion: `curl https://exgen.se/per.html` returnerade "privat sida, ej
  för obehöriga" och varje id på sidan.
- **Den privata markupen byggs nu av JS**, först efter att servern bekräftat
  ägaren. En främlings DOM är tom, inte dold — `#privat` innehåller ingenting.
- **Ett test som läser `innerText` kan aldrig fånga det.** T14–T17 mätte det
  renderade och var gröna hela tiden.
- **`el?.offsetParent !== null` är TRUE för ett element som inte finns.**
  `undefined !== null`. Ett borttaget element lästes som synligt och gjorde T15
  röd på en sida som blivit säkrare. Använd `!!el && el.offsetParent !== null`.
- **`robots.txt` nämner inte sidan.** Raden `Disallow: /per.html` stod där som
  ett tänkt skydd men är motsatsen: robots.txt är en publik fil avsedd att
  läsas av alla, så en Disallow-rad ANNONSERAR adressen. Sidan bär `noindex`
  och renderar en 404-vy för alla utom ägaren. `per-sida.test.mjs` T8 kräver nu
  att raden INTE finns.

## Minnessidan är låst till EN person (2026-08-25, ersätter delar av nästa avsnitt)
- **`PER_OWNER_USER_ID` avgör, inte rollen.** `requireOwner()` kräver
  `requireAdmin` **och** att `user.id` matchar variabeln. En framtida admin,
  tillagd för något helt annat, får ingenting. Fail closed: osatt variabel gör
  ingen till ägare.
- **Främlingar får `400 Unknown action`, aldrig 403.** Ett 403 hade bekräftat
  att ytan finns och bara var stängd. Följden att leva med: när
  `PER_OWNER_USER_ID` är osatt ser felet ut som en okänd action. Det är därför
  det står här.
- **`per.html` renderar en ren 404 tills servern känt igen ägaren.** Ingen
  låsskärm, ingen sidfot, ingenting som avslöjar att sidan finns. Sidfoten sa
  "privat sida, ej för obehöriga" även i 404-läget — hittat genom att LÄSA
  testutskriften, inte genom att ett test blev rött.
- **Registreringen är stängd.** `requireEnrolmentRight()` släpper igenom bara
  när noll enheter finns; därefter krävs en upplåst session. Det tar bort
  svagheten som beskrivs i nästa avsnitt.
- **`admin_recovery_codes` är därför inte valfri.** Två borttappade enheter
  hade annars krävt en databasåtgärd för hand. Koden är 32 slumpbytes i ett
  alfabet utan I, L, O och U, lagras som scrypt-hash med eget salt, och visas
  EN gång. Den markeras förbrukad **innan** token utfärdas — ett avbrutet
  anrop får inte lämna kvar en kod som redan gett tillgång.
- **Skapa alltid en ny kod efter att en använts.** `recovery-use` bränner den,
  och utan en ny finns ingen reserv nästa gång.

## Låset på minnessidan (2026-08-25)
- **En passkey autentiserar en ENHET, inte en behörighet.** `requireAdmin`
  (`profiles.role === 'admin'`) är och förblir det avgörande gatet. Step-up
  ligger ovanpå. Byt aldrig ordningen: en passkey ensam hindrar ingen från att
  anropa API:t direkt.
- **Utmaningen raderas FÖRE verifieringen**, i `takeChallenge()`. Apples
  passkeys rapporterar alltid signaturräknare 0, så räknaren kan inte upptäcka
  en återspelad signatur. Engångsutmaningen är det enda som gör det. Flytta
  aldrig raderingen efteråt.
- **Registrering kräver bara adminroll — medvetet.** Specen kräver att Elton
  aldrig kan låsa ut sig, och kravet på en befintlig passkey leder till manuell
  databasåtgärd den dag båda enheterna försvinner. Priset är att någon med en
  kapad adminsession kan registrera sin egen enhet och ta sig förbi step-up.
  Sidan listar därför varje enhet med tidpunkt: en tyst registrering blir
  åtminstone synlig. Skärper någon det här, gör det utan att återinföra
  utelåsningen.
- **Tre saker måste finnas i produktion, annars fungerar låset inte:**
  `PASSKEY_STEPUP_SECRET` (lång slumpsträng) och `PASSKEY_RP_ID` (`exgen.se`)
  i Vercel, samt migrationen `20260825_admin_passkeys.sql`. Saknas hemligheten
  utfärdas ingen token, och servern svarar **503 med `stepup_unconfigured`** —
  inte 403. Ett konfigurationsfel som ser ut som ett behörighetsfel skickar
  felsökningen åt fel håll.
- **Passkeys är bundna till sin origin.** En registrerad på `exgen.se` fungerar
  inte på en Vercel-preview och inte på localhost. Testerna sätter
  `PASSKEY_ORIGIN` och `PASSKEY_RP_ID` mot sin egen server, och de måste sättas
  INNAN `_admin-passkey.js` importeras.
- **`tests/frontend/per-passkey.test.mjs` mockar inte WebAuthn.** Chromium får
  en virtuell autentiserare via CDP och serversidan är de riktiga funktionerna
  körda mot ett minneslager. Därför tar `_admin-passkey.js` ett `store`, inte
  en Supabase-klient — utan den uppdelningen hade engångsutmaningen bara gått
  att kontrollera genom att läsa koden.
- **Step-up-token överlever en omladdning** (`sessionStorage`, TTL 30 min) men
  dör när fliken stängs. Ett test som vill mäta upplåsningen måste rensa
  `exgen_per_stepup` först, annars mäter det en redan upplåst sida.
- **`public_key` är `text` med base64url, inte `bytea`.** PostgREST lämnar
  bytea som `\x`-hex och konverteringen är ett extra felläge utan vinst.
- **Det är `revoke`-raden som är kontrollen, inte `grant`-raden.** Supabases
  default privileges på `public` ger `service_role` allt redan vid
  `create table`, så den smalare `grant select, insert, delete` snävar inte in
  någonting. Verifierat mot schemat 2026-08-25: `anon` och `authenticated` har
  noll rättigheter på båda tabellerna, RLS är på och det finns noll policyer.
  Ta aldrig bort `revoke` i tron att `grant` räcker.
- **Ett sabotage som kraschar testet bevisar för lite.** `report()` skriver ut
  först vid `finish()`, så en krasch döljer varje kontrolls utfall. Sabotera så
  att flödet går igenom men data läcker — då syns vilken kontroll som faktiskt
  vaktar saken.

## Vision och Alléskolan är två olika svar (2026-08-24)
- **`buildVisionContext()` gäller hela produkten och alla elever.** Den nämner
  varken Alléskolan eller matematik — testet låser båda. Att svara "vi ska hjälpa
  en skola i Åtvidaberg med matte" på frågan om ExGens vision gör produkten mindre
  än den är.
- **`buildAlleskolanContext()` bifogas BARA när skolan nämns vid namn**
  (`ALLESKOLAN_TRIGGER_REGEX`). Före uppdelningen fanns ett block, och varje
  visionsfråga gav pilotpitchen.
- **Pitchen måste stå i futurum.** Uppmätt: modellen skrev "det pågående arbetet
  med Alléskolan" i samma svar som den sa att ingen kontakt finns. Blocket
  förbjuder nu "pågående", "arbetet med" och presens.
- **Namnet bor i `api/_per-name.js`** — `Progressive Evidence Reasoning`. Skriv
  aldrig av det. `docs/per/ARCHITECTURE.md` sa "Pedagogisk Evidens- och
  Resonansmotor" ända till 2026-08-24; `per-scope-identity` låser det nu.
- **P.E.R. kan hitta på ett `[GOTO:]`-mål trots förbudet i prompten.** Uppmätt i
  ungefär hälften av körningarna på pilotfrågan. Klienten validerar mot
  `_perNavLabels` och ritar ingen knapp för ett okänt namn — det är skyddet,
  prompten är optimeringen.

## Alléskolan-pitchen (2026-08-24)
- **Det finns INGEN kontakt, inget avtal och inget samarbete** med Alléskolan.
  P.E.R. får beskriva piloten som ExGens egen ambition byggd på skolans
  offentliga resultat — aldrig antyda att skolan är involverad, tillfrågad eller
  positiv. Ett sådant påstående är kontrollerbart falskt, och den som
  kontrollerar det är skolan själv.
- **All statistik står i `ALLESKOLAN`, en gång.** Källa: Skolverkets
  utbildningsguide, läsår 2024/25. Blocket byggs ur objektet så att en siffra
  bara kan ändras på ett ställe. Citera aldrig en siffra ur minnet.
- **Blocket ligger SIST i systemprompten.** Säkerhetsavsnittet förbjuder att
  "opublicerade planer" avslöjas, och det står sent — pitchen måste komma efter,
  och säkerhetsraden har därför ett uttryckligt undantag för avsnitt som säger
  att något får berättas.
- **Triggern kräver att frågan gäller företaget.** Utan kravet fångade "nästa
  steg" varje studiefråga; "vad är nästa steg i uppgiften" är inte en fråga om
  roadmapen.
- **Siffror ska skrivas ut, inte sammanfattas.** Uppmätt mot riktiga modellen:
  utan den regeln blev "8,7 mot rikets 11,4" till "under rikets medel", vilket
  gör pitchen till en åsikt i stället för ett underlag.

## Active ECC Rules
These global rules apply automatically (no install needed — already in `~/.claude/rules/ecc/`):
- `web/coding-style.md` — semantic HTML, CSS custom properties, no `innerHTML` raw
- `web/security.md` — XSS, no `unsafe-inline`, sanitize user HTML
- `web/design-quality.md` — no generic templates; enforce dark luxury style
- `common/security.md` — secrets via env only, validate at boundaries
- `common/agents.md` — auto-launch planner for new features, code-reviewer after edits

## Reference Docs (load on demand, not auto-loaded)
- Architecture + data flow → `.claude/ARCHITECTURE_MAP.md`
- Local dev + env vars → `.claude/QUICK_START.md`
- Common pitfalls → `.claude/COMMON_MISTAKES.md`
