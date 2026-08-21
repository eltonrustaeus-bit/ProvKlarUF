# CODEX_REVIEW — svarscachen (delsystem A)

Granskare: Codex CLI 0.146.0-alpha.3.1, `codex exec --sandbox read-only`, reasoning effort high.
Granskat: `docs/superpowers/specs/2026-08-21-per-svarscache-design.md` mot faktisk kod.
Datum: 2026-08-21.

Claude Code har slutansvaret och har bedömt varje fynd. Codex förslag följs inte automatiskt —
tre av dem är avvisade eller ändrade nedan.

---

## Fynd och beslut

| ID | Fynd | Severity | Beslut | Åtgärd |
|---|---|---|---|---|
| CR-CACHE-001 | **Identitetsbanan är inte opersonlig.** Specens regel "cacha när `history` är tom" bygger på fel sak: `api/explain.js:411` anropar `loadLongMemory(supabase, user.id)` och `enrichMemoryFromExamData(supabase, user.id)` — nycklade på användaren, inte sessionen. Tom historik ger alltså ändå `longMemory`, `studentName`, `learningSignals` och plan/kvot i prompten. | HIGH | **ACCEPTERAD** | Identitetsbanan **struken helt** ur v1. Verifierat i koden före beslut. Förlusten är liten: `buildPERLandingPrompt` innehåller redan `identityBlocks(userQuestion)` (`_per-core.js:474`), så grundar-/UF-frågor från besökare täcks av landningsbanan — som är genuint opersonlig. |
| CR-CACHE-002 | **Explain-nyckeln är för svag.** Prompten formas av `question`, `correct`, `option_a..d` (`api/explain.js:609-622`), men specen hashade bara frågetexten. Samma fråga med ändrat facit ger fel förklaring. | HIGH | **ACCEPTERAD** | `lane='explain'` hashar en kanonisk payload av alla sex fälten, inte frågetexten. |
| CR-CACHE-003 | **Landningscachen kan förgiftas.** `landingMode` är oautentiserad (`api/explain.js:249`) och rate-limitern fail-open:ar (`api/explain.js:270`). En angripare kan via promptinjektion få ett svar cachat som sedan serveras till riktiga besökare. Värsta utfallet är inte elevdataläcka utan falska produkt-/prisfakta på marknadsytan. | HIGH | **ACCEPTERAD, MED AVVIKELSE** | Codex ville stryka vektorsökning för landing. Det tar bort just det Elton bad om ("liknande fråga"). Löst i stället med **status-grind**: skrivningar landar som `pending`, och **endast `approved` rader serveras någonsin**. Vektormatchning behålls — men bara mot godkända rader. Angriparen kan skriva; ingen besökare kan träffa det som skrivits. |
| CR-CACHE-004 | **Fingeravtrycket räknar inte upp allt.** `buildPERLandingPrompt` läser `PROVIA_KB`, `MODULES.korkort`, `MODULES.demo`, `targets` och `identityBlocks`. `PROVIA_KB` byggs i sin tur från `PLAN_RULES` (`_provia-rules.js:159`) — där priserna bor. En uppräkning av inputs missar prisändringar. | HIGH | **ACCEPTERAD OCH UTÖKAD** | Codex föreslog en längre lista. En lista måste underhållas och kommer att glida. I stället: **fingeravtrycket är sha256 av den faktiskt renderade prompten** med frågan blankad. Då ingår `PROVIA_KB`, priser, `MODULES`, `targets` och `founderAge()` automatiskt, för alltid, utan att någon behöver komma ihåg dem. |
| CR-CACHE-005 | **`targets` är sanerade men klientstyrda.** Etikett och hint kommer från klienten (`_per-context.js:65-79`). Utanför cachenyckeln kan de förgifta `[GOTO:]`-svar. | MEDIUM | **ACCEPTERAD — löst av CR-CACHE-004** | Den renderade prompten innehåller target-listan, så olika target-set får olika fingeravtryck och därmed skilda cache-namnrum. Ett förgiftat set kan inte träffa det legitima. Ingen separat mekanism behövs. |
| CR-CACHE-006 | **`PRIVATE_OR_SECRET_REGEX` duger inte som cachepolicy.** Den fångar e-post, telefon, nycklar och engelska injektionsfraser (`_per-memory.js:13`) — inte personnummer, adress, skola eller svenska injektionsfraser. | HIGH | **ACCEPTERAD, MED AVVIKELSE** | Egen modul `api/_per-cache-guard.js` med utökade mönster (svenskt personnummer, svenska injektionsfraser, skol-/adressord). Codex ville dessutom lagra bara hash + kort preview. **Avvisat i den delen:** svaret måste lagras helt — det är hela poängen — och frågetexten behövs för att kunna kalibrera tröskeln. Skyddet ligger i att inget cachas som inte klarar grinden, inte i att lagra mindre av det som klarat den. |
| CR-CACHE-007 | **RLS-beskrivningen är ofullständig.** "Enable RLS + noll policyer" räcker inte för sekvenser och PG17-vyer. Projektet vet redan detta (`20260820_per_collective_stats.sql:15-18`). | HIGH | **ACCEPTERAD** | Explicit `revoke all on table ... from public, anon, authenticated` + `grant` till `service_role`. Sekvensproblemet **elimineras** i stället för att hanteras: `per_cache_probe` får `uuid` primärnyckel i stället för `bigserial`, så ingen sekvens finns att ge rättigheter på. |
| CR-CACHE-008 | **Cachefunktionerna saknar grant-modell.** Befintliga RPC:er revokar från `public`/`anon`/`authenticated` och grantar bara `service_role` (`20260727_per_learner_loop.sql:353-356`). | HIGH | **ACCEPTERAD** | Alla RPC:er: `security definer`, `set search_path = public`, explicit revoke/grant enligt husmönstret. |
| CR-CACHE-009 | **`hits++` är ett race** om det görs som läs-ändra-skriv i applikationen. | MEDIUM | **ACCEPTERAD** | Träffbokföringen blir en sats: `update ... set hits = hits + 1, last_hit_at = now() ... returning answer`. Tar dessutom bort en tur-och-retur. |
| CR-CACHE-010 | **Samtidig `storeAnswer()` kan skriva över svar.** Två parallella missar ger olika svar; sista skrivaren vinner. | MEDIUM | **ACCEPTERAD** | `insert ... on conflict do nothing`. `answer` skrivs aldrig över. |
| CR-CACHE-011 | **Tröskeln 0.95 saknar lexikal spärr.** Att bara logga näramissar hindrar inte att `Premium`/`Basic`, siffror eller negation ger fel träff över tröskeln. | HIGH | **ACCEPTERAD** | Slot-guard före varje vektorträff: samma siffror, samma plannamn, samma negationsparitet. Skiljer något — miss, oavsett cosinus. Bättre än enbart loggning: den skyddar innan mätdata finns. |
| CR-CACHE-012 | **Normaliseringen är för löst definierad.** NFC, diakriter, trunkering, HTML-entiteter, `A-B` vs `AB`. | MEDIUM | **ACCEPTERAD** | Kanoniseringen skrivs som ett exakt kontrakt i specen och låses i test. |
| CR-CACHE-013 | **`consume_anon_rate` saknar forward-migration i repot** — bara nämnd i `supabase/migrations/README.md`. Rättigheter och atomicitet ospårade. Det är det enda som bromsar anonyma cacheskrivningar. | HIGH | **NOTERAD, LÖST AV DESIGN** | Verifierat: `grep` över `supabase/migrations/` ger bara README-träffen. Ett verkligt spårningshål, men **utanför detta bygge** — att laga det här vore scope creep. Beroendet försvinner ändå: eftersom landningsskrivningar landar som `pending` och aldrig serveras oapprovade, är rate-limitern inte längre en säkerhetsgräns för cachen. Loggas som separat uppföljning. |
| CR-CACHE-014 | **Sonden räcker inte för incidentrespons.** Utan `cache_id` går det inte att hitta vilken rad som orsakade skada. | MEDIUM | **ACCEPTERAD** | Sonden loggar `cache_id` och fingeravtryckets prefix. Fortfarande textlös och utan `user_id`. |
| CR-CACHE-015 | **YAGNI:** identitetsbana, landing-vektor och kalibrering är för mycket för uppmätt trafik. | LOW | **DELVIS ACCEPTERAD** | Identitetsbanan struken (CR-001). Landing-vektorn **behålls** — den är kärnan i det Elton bad om, och med status-grinden bär den inte längre den risk Codex invände mot. Att stryka den vore att leverera något annat än det som efterfrågades. |

---

## Sammanfattning

Sex HIGH-fynd. Två av dem rev designbeslut som redan var tagna:

- **Identitetsbanan** var byggd på ett antagande som koden motsäger. Struken.
- **Fingeravtrycket** var en uppräkning av inputs. Ersatt med en hash av den renderade
  prompten, vilket löser CR-004 och CR-005 med samma mekanism och inte kan glida ur synk.

Tre förslag följdes inte rakt av: landningsvektorn behölls bakom en status-grind i stället för
att strykas, cachen lagrar hela svaret i stället för en preview, och den saknade
rate-limit-migrationen lämnas som separat uppföljning i stället för att dras in i scope.

---

## Slutgranskning av hela grenen (2026-08-22)

Granskare: Codex CLI, `codex exec --sandbox read-only`, reasoning effort high.
Underlag: hela grendiffen (14 commits, 11 filer) mot specen och den första granskningen.

Uppdraget var uttryckligen att leta efter fel som **ingen enskild task-granskning kunde se**.
Tre av fynden var av just den sorten.

| ID | Fynd | Severity | Beslut | Åtgärd |
|---|---|---|---|---|
| CR-FINAL-001 | Cachegrinden kördes bara på `fields.question`. Explain-prompten formas även av facit och alla fyra alternativen, och explain-rader skrivs `approved` direkt — så PII i ett svarsalternativ nådde ett cachat, direkt serverbart svar. | HIGH | **ACCEPTERAD** | Ny `cacheAllowedFields()` körs över samtliga promptbärande fält. Kontrollen går genom `lookupCached`, inte bara mot grindfunktionen — annars hade testet varit grönt även med ett lager som skickade enbart frågan, vilket var hela fyndet. |
| CR-FINAL-002 | Grinden saknade de skol- och adressmönster specen utlovade. "Jag går på X skola" var cachebart, för en användarbas som till stor del är minderårig. | HIGH | **ACCEPTERAD, MED AVVIKELSE** | Mönstren är medvetet smala: de kräver en självidentifierande konstruktion (`jag går på`, `min skola är`) eller ett adressformat. Codex föreslog att blockera skola/adress brett; det hade tagit vanliga studiefrågor med sig — "vad läser man på ekonomiprogrammet" är ingen personuppgift. Motprov finns i testet. |
| CR-FINAL-003 | **Tyst och permanent.** `unique (lane, fingerprint, payload_hash)` plus `on conflict do nothing` gjorde att en rad som passerat `expires_at` aldrig kunde ersättas: läsningarna filtrerade bort den, skrivningen vägrade skriva över den. Nyckeln var död för alltid och cachen slutade tyst fungera för den frågan. | MEDIUM (bedömd HIGH av oss) | **ACCEPTERAD** | Ny RPC `per_cache_store()` med `on conflict do update ... where expires_at <= now()`. Skriver över endast utgångna rader; en levande rad skyddas fortfarande, vilket var hela skälet till `do nothing` (CR-CACHE-010). Verifierat mot produktion i båda riktningarna. |
| CR-FINAL-004 | Skelettet appendar identitetsblocken sist i stället för att rendera dem genom `buildPERLandingPrompt`:s egen anropspunkt. Flyttas blocket i den riktiga prompten ändras inte skelettet. | MEDIUM | **NOTERAD, EJ ÅTGÄRDAD** | Drift-scenariot kräver att någon flyttar blocket **utan** att ändra dess innehåll — ändras innehållet slår fingeravtrycket om ändå. Att lägga en `forceIdentityBlocks`-parameter i `buildPERLandingPrompt` rör en prompt som marknadssidan använder, för en risk som är smalare än ändringen. Dokumenterad i koden i stället. |
| CR-FINAL-005 | `res.json()` körs före `storeAnswer()` på båda banorna. | LOW | **DELVIS ACCEPTERAD** | Skrivningen är `await`:ad, så handlern avslutas inte innan den skett — Codex bekräftar att konsekvensen vore en missad rad, inte fel data. `waitUntil()` infördes inte. Däremot kontrollerar catch-blocken nu `res.headersSent`: ett andra `res.*` efter skickat svar hade gett `ERR_HTTP_HEADERS_SENT` och maskerat det verkliga felet. |
| CR-FINAL-006 | Testet "bara approved rader kan läsas" räknade förekomster i hela migrationen och förblev grönt om filtret togs bort ur EN funktion. | MEDIUM | **ACCEPTERAD** | Varje läs-RPC granskas nu för sig, med både `status = 'approved'` och `expires_at > now()`. Verifierat rödgående genom att ta bort filtret ur enbart `per_cache_match`. |
| CR-FINAL-007 | RPC-anrop och SQL-signaturer stämmer. Inget fynd. | — | — | — |
| CR-FINAL-008 | Ingen cacheinkoppling i `tipsMode`, `legalMode`, readiness eller TEACH MODE. Inget fynd. | — | — | Testet som skär ut TEACH MODE-grenen behålls. |
| CR-FINAL-009 | Ursprungsmigrationen skapar `idx_per_answer_cache_lookup`, härdningsmigrationen droppar det. Codex föreslog att squasha paret. | LOW | **AVVISAD** | Ursprungsmigrationen är redan applicerad mot produktion. Att redigera en applicerad migration skapar drift mellan fil och databas — och det här repot har en egen arbetsgren för just migrationsdrift. Två ärliga migrationer är billigare än en tyst avvikelse. |
