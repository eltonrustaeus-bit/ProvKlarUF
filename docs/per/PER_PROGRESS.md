# PER_PROGRESS

Löpande logg för P.E.R.-elevloopen. Branch: `feat/per-learner-loop` (från
`redesign/11-pensionskontrollen-inspired`).

## Status: implementation klar, väntar på att migrationen körs

Allt är byggt, enhetstestat och evaluerat. Den enda kvarvarande åtgärden kräver dig:
**`supabase/migrations/20260727_per_learner_loop.sql` måste köras i Supabase SQL Editor.**
Denna session har ingen väg att exekvera DDL — det finns ingen SQL-RPC i projektet, ingen
`psql`/`supabase`-CLI installerad, och tidigare faser kördes via en Supabase-MCP som inte är
ansluten här. Tills migrationen är körd fungerar de rena kodvägarna (enhetstester, eval), men
inte det databasberoende flödet.

## Analyserat

- Hela kodbasen mot verkligheten, inte mot antaganden: `api/`, `src/`, `supabase/migrations/`,
  `docs/provia-knowledge-engine/` (fas −1 t.o.m. fas 10), samt **live-produktionsdatabasen**
  (tabellinnehåll, feature flags, RLS-policyer, korpusens granskningsstatus).
- Slutsats: knowledge engine finns och fungerar (20 godkända chunks, 6 koncept, 36 verifierade
  frågor, 183 loggade AI-anrop). Det som saknades var **elevloopen** — `student_mastery` och
  `student_error_events` hade noll kodanvändning. Se `CURRENT_STATE.md`.
- Codex gjorde tre oberoende granskningar (analys, implementation, slutleverans). 31 fynd totalt,
  varav 6 HIGH i implementationen och 3 HIGH i slutgranskningen — alla åtgärdade. Se `CODEX_REVIEW.md`.

## Byggt

| Fil | Vad |
|---|---|
| `supabase/migrations/20260727_per_learner_loop.sql` (+ `_ROLLBACK`) | `student_attempts`, `student_recommendations`, `per_quota_counters`, `apply_legal_mastery()`, `per_consume_daily_quota()`, konsistenstrigger, unika index, borttagen facitpolicy, ny feature flag |
| `src/per/orchestrator.mjs` | P.E.R. Orchestrator — uppgiftskontrakt, rutning, ägarskapskontroll, publik projektion |
| `src/per/assessment.mjs` | Deterministisk rättning + LLM-resonemangsanalys + oberoende andrabedömning + deterministisk jämkning |
| `src/per/learner-model.mjs` | Evidenskedjan försök → felhändelse → mastery, med idempotens och återupptagning |
| `src/per/recommendation.mjs` | Regelmotor R1–R10 + konceptval. Ingen LLM |
| `src/per/sanitize.mjs` | Redigering av injektionsfraser, längdgränser, deterministisk citatkontroll |
| `src/per/usage.mjs` | Uppmätta tokens, latency, kostnad (null tills prislistan verifierats) |
| `src/ai/prompts/per-assess/v1.js` | Bedömningsprompt med poängrubrik och datamärkning |
| `src/ai/prompts/per-coach/v1.js` | Stegvis hjälp, ledtråd → förklaring → steg för steg |
| `src/ai/prompts/error-classifier/v1.js` | Felkodsklassificering mot fast enum (planerad i fas 1, byggd nu) |
| `api/knowledge.js` | Fyra elev-ops i befintlig router; `flagsEnabled` respekterar `allowed_user_ids` |
| `api/_per-core.js` | Ny export `callAIRaw` (tokens/latency). `callAI` delegerar, oförändrat beteende |
| `juridik.html` | Elevyta: ämnesval, uppgift, svar, återkoppling med källor, kunskapsprofil, nästa steg |
| `config/model-pricing.json` | Tom prislista med krav på manuell verifiering |
| `tests/per/*`, `tests/evals/per-v1/*`, `scripts/per-e2e-smoke.mjs` | Enhetstester, evaldataset (25 fall), e2e-rök mot riktig DB |

**Inte rörda:** `korkortet.html`, `korkortet-srs.js`, `api/hp.js`, `driving_*`/`hp_*`, och de sju
filer som låg ocommittade vid start (pågående designarbete).

## Migrationer

| Fil | Status | Destruktivt? |
|---|---|---|
| `20260727_per_learner_loop.sql` | **Ej körd** — kräver manuell körning | Nej. Enda borttagningen är RLS-policyn `exam_questions_select_own` (facitläcka, oanvänd av klienter) |
| `20260727_per_learner_loop_ROLLBACK.sql` | Finns | Ja — raderar insamlad elevevidens. För att bara stänga av loopen räcker feature-flaggan |

## Tester körda

Full regression, 13 sviter, alla gröna (inklusive de befintliga för schema, retrieval, generering,
verifierare, frontend och HP-oberoende ytor).

Eval, `tests/evals/per-v1/` (25 fall, riktiga modellanrop):

| Körning | Exakt utfall | Riktning | Citatbrott | Säkerhetsbrott | p50 | p95 |
|---|---|---|---|---|---|---|
| #1 | 0.48 | 0.64 | 0 | 1 | 4.5 s | 23.3 s |
| #2 | 0.88 | 0.96 | 0 | 0 | 4.0 s | 10.6 s |
| #3 | 0.92 | 1.00 | 0 | 0 | 4.5 s | 10.7 s |
| #4 | 0.92 | 1.00 | 0 | 0 | 3.9 s | 10.8 s |
| **#5 (slutlig)** | **0.88** | **1.00** | **0** | **0** | **3.8 s** | **8.4 s** |

Utfallsträffsäkerheten varierar 0.88–0.92 mellan körningar med identisk kod (modellen är inte
deterministisk). Riktning, källgrundning och säkerhet är stabila på 1.00 / 0 / 0.

Evalen hittade två fel som varken granskning eller enhetstest fångade — se `EVALUATION.md`.

## Kända problem

1. **Migrationen är inte körd.** Blockerar allt databasberoende: e2e-röken, UI:t, demon.
2. **Två till tre evalfall missar** (PER-ASSESS-005, -020, ibland -003). Alla åt det stränga
   hållet. Medvetet inte bortkalibrerade — 25 fall är för litet för att finjustera mot.
3. **Samtidighet är inte lasttestad.** Skydden mot dubbelräknad mastery och parallella svar vilar
   på DB-constraints, advisory locks och en RPC som gör mastery + markering i samma transaktion.
   Det är verifierat genom granskning och SQL-semantik, inte genom ett konkurrenstest mot en körd
   databas.
4. **Kostnad i kronor saknas.** Tokens mäts; priser måste slås upp manuellt och skrivas in i
   `config/model-pricing.json`.
5. **`apply_hp_mastery` har kvar samma race** som `apply_legal_mastery` fick fixad. HP-modulen är
   utanför detta arbetes gräns. Egen uppföljning.
6. **`legal_shadow_mode` kontrolleras efter generering** i den befintliga `opGenerate` (Codex
   CR-PER-014). Utanför scope; läckvägen den byggde på är dock stängd nu.
7. **Ingen lärarvy** över klassens kunskapsluckor. Data finns, ytan saknas.

## Nästa konkreta steg

1. Kör migrationen (SQL Editor).
2. Kör `node --env-file=.env.local scripts/per-e2e-smoke.mjs <testkonto-uuid>`.
3. Slå på flaggorna för pilotkontot med `allowed_user_ids` ifylld, och gå igenom `DEMO_GUIDE.md`.
