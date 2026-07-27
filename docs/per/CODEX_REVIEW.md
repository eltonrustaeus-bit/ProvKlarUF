# CODEX_REVIEW — oberoende granskning av P.E.R.-elevloopen

Granskare: Codex CLI 0.145.0-alpha.27, `codex exec --sandbox read-only`, reasoning effort high.
Claude Code har slutansvaret och har bedömt varje fynd — Codex förslag följs inte automatiskt.

---

## Granskning 1 — efter kodbasanalysen (2026-07-27)

Uppdrag: oberoende kartläggning av vad som ska återanvändas, vilka säkerhets-/RLS-risker som
uppstår när elevdata börjar skrivas, prompt injection-ytor, fallgropar i `api/knowledge.js`, och
största regressionsrisker.

| ID | Fynd | Severity | Beslut | Åtgärd |
|---|---|---|---|---|
| CR-PER-001 | **Facitläcka:** `exam_questions.payload` innehåller `correct_answer`/`explanation`, och policyn `exam_questions_select_own` gav eleven direkt PostgREST-läsning av alla frågor i sin egen blueprint | HIGH | **ACCEPTERAD** | Policyn borttagen i migrationen efter verifiering att ingen klientyta läser tabellen. Frågor når eleven bara via `toPublicQuestion()`. Enhetstest `FACITSKYDD` + kontroll i e2e-röken. |
| CR-PER-002 | Service_role bypassar RLS — varje läsning av attempt/mastery/recommendation måste filtrera på `user_id`, och klientskickat `question_id` måste ägarskapskontrolleras (IDOR) | HIGH | **ACCEPTERAD** | Alla läsningar i `learner-model.mjs`/`orchestrator.mjs` har `.eq("user_id", …)`. `runAnswer` slår upp frågan med `exam_blueprints!inner(user_id)` filtrerat på inloggad användare. Verifierat mot live-DB: fel ägare ger `null`, inte data. |
| CR-PER-003 | `apply_hp_mastery`s `for update` låser ingenting när raden inte finns — två samtidiga förstasvar tappar en uppdatering. Samma brist i utkastets `apply_legal_mastery` | HIGH | **ACCEPTERAD** | `apply_legal_mastery` använder `pg_advisory_xact_lock` på (user_id, concept_id), som fungerar även för rader som inte finns. |
| CR-PER-004 | Attempt/felhändelse/mastery/rekommendation saknar idempotensnyckel — retries kan dubbla mastery | HIGH | **ACCEPTERAD** | `student_attempts.idempotency_key` + `unique (user_id, idempotency_key)`. `commitAssessment` upptäcker konflikten och hoppar över mastery. Enhetstestat. |
| CR-PER-005 | FK:n på `source_attempt_id` garanterar inte att felhändelsens `user_id`/`concept_id` matchar attempt-raden | MEDIUM | **DELVIS ACCEPTERAD** | Cross-table CHECK finns inte i Postgres. Löst med trigger `student_error_events_consistency` i stället för enbart en applikationsregel. Codex föreslog ingen mekanism; valet av trigger är vårt. |
| CR-PER-006 | 4000-teckensgränsen var bara en kommentar, inte en constraint | MEDIUM | **ACCEPTERAD** | `check (char_length(student_answer) <= 4000)` i schemat + trunkering i två lager i koden. |
| CR-PER-007 | Kvoten är en icke-atomisk count-then-insert och räknar jobb, inte AI-anrop; nya ops blir okvoterade | HIGH | **ACCEPTERAD OCH UTÖKAD** | Egen dygnskvot för elev-ops. Codex lösning (lås + räkna) räcker inte: raden som räknas skrivs efter AI-anropen, så parallella requests passerar ändå. Ersatt med `per_quota_counters` + atomisk `INSERT … ON CONFLICT … RETURNING`, som dessutom räknar rätt sak (betalda requests, inte sparade svar). |
| CR-PER-008 | `flagsEnabled()` ignorerar `allowed_user_ids` — att slå på en flagga öppnar ytan för alla inloggade | HIGH | **ACCEPTERAD** | `flagsEnabled(keys, userId)` respekterar nu `allowed_user_ids` (tom lista = alla). Gäller även de befintliga ops:arna `blueprint`/`generate`. |
| CR-PER-009 | Elevsvar är angriparyta i bedömningsprompten; även genererad frågetext ska behandlas som otillförlitlig | HIGH | **ACCEPTERAD, MED AVVIKELSE** | `src/per/sanitize.mjs`. Codex föreslog `sanitizeLegalQuestion()`, som byter ut HELA texten mot en platshållare. Rätt för en chattfråga, fel här: en elev som råkar skriva "ignore all" skulle få noll poäng utan bedömning. Vi REDIGERAR i stället bort den matchande frasen och bedömer resten. Regexen är dessutom utökad med svenska fraser — eleverna skriver svenska. |
| CR-PER-010 | RAG-chunks läggs rått i user-meddelandet; ett approved chunk kan ändå innehålla instruktionslik text | MEDIUM | **ACCEPTERAD** | `sanitizeSourceChunks()` + stabila delimiters + uttrycklig regel i systemprompten att både elevsvar och källor är data. |
| CR-PER-011 | Structured Outputs skyddar formen, inte sanningen — returnerade `source_chunk_ids` måste deterministiskt vara en delmängd av de hämtade | MEDIUM | **ACCEPTERAD** | `filterCitations()`. Mätt i evalen: 0 påhittade källhänvisningar i tre körningar. |
| CR-PER-012 | Nya fritext-ops kräver längdgränser, strikt enumvalidering, idempotens och egna flaggor/kvoter — bredda inte den globala gaten | MEDIUM | **ACCEPTERAD** | Egen flagga `per_learner_loop_enabled`, egen kvot, längd- och enumvalidering per fält i varje op. |
| CR-PER-013 | Återanvänd inte `deterministicDecision()` för elevbedömning; importera inte från `api/grade.js` (CJS vs ESM) | LOW | **ACCEPTERAD** | Ingen av dem används. Bedömningslogiken är egen och ligger separat ovanpå de exporterade primitiverna. |
| CR-PER-014 | `legal_shadow_mode` kontrolleras först efter generering och returnerar `question_id` | LOW | **AVVISAD (utanför scope)** | Gäller den befintliga `opGenerate`-vägen, inte elevloopen. Med facitpolicyn borttagen (CR-PER-001) är den läckvägen dessutom stängd. Noteras som separat uppföljning. |
| CR-PER-015 | Den refererade `20260719_fix_hp_mastery_race.sql` finns inte i repot | LOW | **NOTERAD** | Stämmer — kommentaren i 20260720-migrationen pekar på en fil som aldrig committades. HP-modulen rörs inte i detta arbete. Samma race finns kvar i `apply_hp_mastery` och bör fixas separat med samma advisory lock-mönster. |

### Regressionsrisker Codex pekade ut, och hur de hanterades

1. *Oavsiktlig produktionsöppning när flaggorna slås på* → egen flagga + `allowed_user_ids`
   respekteras + facitpolicyn borttagen.
2. *Att försvaga den fungerande blind-verifieringskedjan* → `legal-generation.mjs` är oförändrad.
   Elevloopen ligger ovanpå den och anropar bara dess exporterade funktioner.
3. *Kostnad/timeout/datakorruption från sekventiella LLM-anrop* → atomisk kvot, timeouts på varje
   anrop, idempotensnyckel, och fail-safe-vägar där ett misslyckat andrasteg inte river hela svaret.

---

## Egna fynd utanför Codex-granskningen

Två fel hittades av eget arbete och åtgärdades innan granskning 2:

- **`exam_blueprints.question_count` har `check (> 0)`** — `ensureLearnerBlueprint()` satte 0 och
  hade fällt varje blueprint-insert för en ny elev. Upptäckt vid genomläsning av schemat.
- **Kvotens verkliga hål** (se CR-PER-007 ovan) — Codex identifierade rätt problem men fel
  lösning; den korrekta analysen är vår.

Och två fel hittades av **evalkörningen**, inte av granskning eller enhetstest — se
`docs/per/EVALUATION.md`: fältnamnet `grounded` fick modellen att kasta varje felaktigt svar som
"kan inte bedömas", och avsaknaden av poängrubrik gav full poäng till omotiverade svar.

---

## Granskning 2 — efter kärnimplementationen (2026-07-27)

Codex läste migrationen, `src/per/*`, promptmodulerna, `api/knowledge.js`, `juridik.html` och
testerna. Åtta fynd. Två av dem (kvotens atomicitet och `question_count`) hade redan hittats och
åtgärdats av eget arbete innan granskningen returnerade; de kvarstår i tabellen eftersom Codex
fann dem oberoende och bekräftar analysen.

| ID | Fynd | Severity | Beslut | Åtgärd |
|---|---|---|---|---|
| CR-PER-016 | **Facitutvinning:** `runAnswer` kontrollerade ägarskap men inte om frågan redan besvarats. Unikheten satt bara på en klientvald `idempotency_key`, så eleven kunde skicka nya nycklar och prova varje svarsalternativ tills `is_correct` blev true — och pumpa mastery på köpet | HIGH | **ACCEPTERAD** | Unikt index `(user_id, question_id)` på `student_attempts` + kontroll i `runAnswer` FÖRE bedömningen. Andra försöket returnerar den sparade bedömningen med `already_answered: true`. Verifieras i e2e-röken (steg 4). |
| CR-PER-017 | Vid klassificeringsfel efter ett FELsvar skickades frågans lagrade `explanation` ordagrant som återkoppling — alltså facit | HIGH | **ACCEPTERAD** | Fallbacken är nu ett neutralt besked som hänvisar till coachningen (`assessment.mjs`). Facit lämnar aldrig servern efter ett felsvar. |
| CR-PER-018 | Kvoten är inte atomiskt konsumerande — låset släpps innan raden som räknas skrivs, så parallella anrop passerar alla. `per_diagnose`/`per_coach` skapar dessutom ingen attempt och blev därmed praktiskt taget okvoterade | HIGH | **ACCEPTERAD** (redan åtgärdad, oberoende funnen) | `per_quota_counters` + atomisk `INSERT … ON CONFLICT DO UPDATE … RETURNING`. Räknar betalda requests per feature, inte sparade svar — därmed täcks diagnose och coach. |
| CR-PER-019 | Ett partiellt skrivfel gjorde idempotensnyckeln permanent förbrukad utan färdig elevmodell; varje retry hoppade över resten | HIGH | **ACCEPTERAD** | `student_attempts.mastery_applied` + återupptagningsgren i `commitAssessment`. Felhändelseskrivningen gjord idempotent med unikt index på `source_attempt_id`. Enhetstestat (`ÅTERUPPTAGNING…`). |
| CR-PER-020 | Retries bedömdes på nytt innan dubbletten upptäcktes — kostade nya AI-anrop och kunde ge annan feedback än den lagrade | MEDIUM | **ACCEPTERAD** | Kontrollen flyttad före `assessAnswer()`. Ett omskick returnerar den lagrade bedömningen, rekonstruerad av `storedAssessment()`. |
| CR-PER-021 | Rekommendationer varken atomiska eller felkontrollerade: två samtidiga svar kunde ge två öppna rekommendationer, och insert-fel ignorerades tyst | MEDIUM | **ACCEPTERAD** | Unikt partiellt index `(user_id, concept_id) where status='open'` + hantering av 23505 (läser upp den öppna raden) + felloggning i stället för tyst ignorering. |
| CR-PER-022 | Den nya flagglogiken bröt begränsat shadow mode: `flagsEnabled` anropades utan `userId` i shadow-kontrollen, så konton i listan fick det fullständiga svaret | MEDIUM | **ACCEPTERAD** | `flagsEnabled(["legal_shadow_mode"], user.id)`. Regression jag själv införde i CR-PER-008-fixen — bra fångat. |
| CR-PER-023 | `ensureLearnerBlueprint` satte `question_count: 0` mot en `check (> 0)` — första frågan för varje ny elev hade gett 502 | HIGH | **ACCEPTERAD** (redan åtgärdad, oberoende funnen) | `question_count: 1`. |
| CR-PER-024 | Nätverksfel i UI:t gav ohanterad rejection och låste knappen tills omladdning; UI:t skapade dessutom ny idempotensnyckel per klick | LOW | **ACCEPTERAD** | `try/finally` kring anropen, felhantering runt `fetch`, och nyckeln sätts en gång per uppgift i `state.attemptKey`. |

Codex bekräftade samtidigt att ingen cross-user-IDOR finns i ägarskapsjoinen, att borttagningen av
`exam_questions_select_own` stänger den direkta PostgREST-läckan, att ingen XSS finns i
`juridik.html`, och att `callAI`-delegeringen inte är en regression.

## Granskning 3 — före slutleverans (2026-07-27)

Codex verifierade fixarna från granskning 2 och letade nya fel. Slutsats vid körningens start:
*"inte leveransklar ännu, inga CRITICAL men tre HIGH"*. Samtliga är åtgärdade nedan.

| ID | Fynd | Severity | Beslut | Åtgärd |
|---|---|---|---|---|
| CR-PER-025 | **Mastery kunde fortfarande dubbelräknas.** `applyMastery()` och markeringen `mastery_applied` var två separata anrop — kraschar processen däremellan står flaggan kvar på false och nästa retry räknar samma svar igen. Loggning löser inte exakt-en-gång-semantik | HIGH | **ACCEPTERAD** | `apply_legal_mastery()` tar nu `p_attempt_id`, låser försöksraden, avbryter om den redan är bokförd, och sätter `mastery_applied` i SAMMA transaktion som Elo-uppdateringen. Garantin ligger i databasen, inte i applikationen. Den gamla 5-argumentsvarianten droppas explicit så ingen tyst överlagring utan garantin blir kvar. |
| CR-PER-026 | **`23505` feltolkades.** `recordAttempt()` antog att varje unikhetskonflikt gällde idempotensnyckeln. Det nya `(user_id, question_id)`-indexet ger samma felkod — två parallella svar passerar den tidiga kontrollen, båda bedöms, förloraren hittar ingen rad med sin nyckel och kastar 502. Dessutom fortsatte `commitAssessment()` med anroparens assessment i stället för den sparade | HIGH | **ACCEPTERAD** | Uppslag på både idempotensnyckel och `question_id` vid konflikt. `commitAssessment` använder `assessmentFromRow()` när raden redan fanns, och returnerar den som `assessment` — eleven ser alltid den bedömning som faktiskt är sparad. |
| CR-PER-027 | **Facitläckan var bara stängd i fallback-grenen.** Vid lyckad klassificering får modellen fortfarande exakt rätt svar, och inget förbjöd den att skriva ut det i återkopplingen | HIGH | **ACCEPTERAD** | Två lager: prompten förbjuder uttryckligen att röja alternativet, och `leaksAnswerKey()` kontrollerar deterministiskt både ordagrann alternativtext och facitliknande formuleringar ("rätt svar är B") innan texten når eleven. Faller tillbaka på neutralt besked vid träff. Fem enhetstester. |
| CR-PER-028 | Migrationen är inte säker att köra om: `create table if not exists` lägger inte till kolumner som tillkommit senare | MEDIUM | **ACCEPTERAD** | Explicita `alter table … add column if not exists` för `mastery_applied` och `idempotency_key`. |
| CR-PER-029 | Kvoten konsumeras före ägarskaps- och dubblettkontrollen och återbetalas inte — 404 och redan besvarade svar åt upp platser utan att kosta ett enda AI-anrop | LOW | **ACCEPTERAD** | `per_refund_daily_quota()` + återbetalning på alla vägar som inte hann kosta något. |
| CR-PER-030 | Konsistenstriggern tillät `concept_id = null` på felhändelsen när försöket hade ett koncept | LOW | **ACCEPTERAD** | `is distinct from` — en felhändelse utan koncept kan inte skrivas när kopplingen är känd. |
| CR-PER-031 | `insufficient_evidence`-grenen kontrollerade inte felet från flagguppdateringen | MEDIUM | **ACCEPTERAD** | Felet kontrolleras och loggas. |
| CR-PER-015 | HP-race-migrationen saknas fortfarande i repot | LOW | **NOTERAD, UTANFÖR SCOPE** | HP-modulen rörs inte. `apply_hp_mastery` bör få samma advisory lock-mönster i en egen uppföljning. |

Codex bekräftade som korrekt fixat: `question_count: 1`, rekommendationsindexets 23505-väg,
`legal_shadow_mode(user.id)`, den neutrala klassificeringsfallbacken, UI:ts `try/finally` och den
stabila idempotensnyckeln, samt att kvotens SQL är atomisk och att räknaren inte driver iväg.

**Kvarstående begränsning Codex noterade och som fortfarande gäller:** enhetstesterna täcker inte
äkta samtidighet mot en riktig databas. Race-skydden vilar på DB-constraints och lås som är
verifierade genom kodgranskning och SQL-semantik, inte genom ett konkurrenstest. Det kräver en
körd migration och ett lasttest — se `PER_PROGRESS.md`, kända problem.
