# P.E.R — Live exam/felbank-kontext (2026-07-28)

## Problem

P.E.R (den sitewide chatt-widgeten, `api/explain.js`) ska kunna analysera elevens felbank
och prov och "hitta det vi snackat om" (konversationsminne). Delar av detta finns redan
byggt, men en del av det är kopplat fel:

- `enrichMemoryFromExamData()` (`api/_per-memory.js`) läser redan riktiga `driving_results`,
  `driving_progress`, `mock_results` och `user_exams` (felbanken) — men anropas **bara**
  inifrån `maybeRefreshLongMemory()`, en bakgrundsprocess som (a) inte är klar förrän EFTER
  att svaret redan skickats till eleven, och (b) bara faktiskt skriver en ny cache **max en
  gång per dygn** (`REFRESH_DAYS = 1`).
- Resultatet: tar eleven ett prov och frågar P.E.R om det direkt efter, eller har redan
  chattat en gång idag, ser P.E.R inte det provet förrän tidigast imorgon.
- Konversationsminnet (`per_sessions` + `per_long_memory.summary`) fungerar redan och är
  inte en del av detta problem.

## Lösning

Kör `enrichMemoryFromExamData()` **live, synkront, på varje chattförfrågan** — inte bara
inifrån den dagliga bakgrundsuppdateringen. De färska DB-fakta (svaga kategorier, senaste
provpoäng, felbankens begrepp/feltyper) läggs alltid ovanpå den dagsgamla AI-sammanfattade
cachen (`structuredMemory`), och vinner för just dessa fält.

De "mjuka" AI-härledda fälten (`study_pattern`, `preferred_help_level`, `sessions_total`,
konversationsbaserade `weak_topics`/`strong_topics`) kräver ett AI-anrop för att extraheras
och behöver inte vara sekundfärska — de fortsätter uppdateras av den befintliga dagliga
bakgrundsprocessen, orört.

## Ändring

**Fil:** `api/explain.js`, huvudläget (TEACH MODE), runt rad 379–391.

1. Importera `enrichMemoryFromExamData` från `./_per-memory.js` (redan exporterad, bara inte
   importerad i denna fil idag).
2. Kör den parallellt med det redan existerande `loadLongMemory()`-anropet
   (`Promise.all`, ingen extra sekventiell latens).
3. Bygg ett sammanslaget objekt: `structuredMemory`s fält som bas, men
   `exam_weak_categories`/`exam_recent_scores`/`mock_weak_concepts`/`mock_recent_scores`/
   `felbank_weak_concepts`/`felbank_error_types`/`felbank_courses` skrivs alltid över med de
   LIVE värdena från steg 2 (samma fältnamn som `maybeRefreshLongMemory()` redan skriver till
   cachen — ingen ny datamodell).
4. Skicka det sammanslagna objektet till `buildLearningSignals()` istället för rå
   `structuredMemory`, och använd samma sammanslagna `exam_weak_categories` för
   `mergedWeakAreas` (rad 383).

**Inga schemaändringar, inga nya tabeller, ingen ny endpoint.** Den dagliga
bakgrundsuppdateringen (`maybeRefreshLongMemory`) lämnas orörd — den fyller fortfarande i de
AI-härledda mjuka fälten.

## Kostnad/prestanda

`enrichMemoryFromExamData()` kör 4 lätta Supabase-frågor parallellt (redan skrivna med
`Promise.all` internt, `limit(10-20)` rader). Ingen extra AI-kostnad. Latensen läggs till
parallellt med den redan existerande `loadLongMemory()`-frågan, inte sekventiellt efter.

## Test

Riktigt tillfälligt testkonto (Supabase Admin API, samma mönster som tidigare i sessionen):
skriv en syntetisk `mock_results`-rad (eller `user_exams` med ett felaktigt `per_question`),
chatta med P.E.R direkt efteråt, bekräfta att den nya raden syns i `learningSignals`/svaret
i SAMMA konversation — inte först imorgon. Radera testkontot efteråt.

## Scope-avgränsning

Detta ändrar INTE:
- Den feature-flaggade P.E.R-elevloopen för juridik (`api/knowledge.js`, `juridik.html`,
  Fas 9) — helt separat subsystem, orört.
- Widgetens närvaro på sidor — redan på 9/13 sidor (se `docs/current-system/feature-flow-map.md`),
  ingen ny sida läggs till i detta arbete.
- Konversationsminnet (`per_sessions`/`per_long_memory.summary`) — fungerar redan.
