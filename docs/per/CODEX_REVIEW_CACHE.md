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
