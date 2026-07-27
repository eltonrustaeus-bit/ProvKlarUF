# ARCHITECTURE — P.E.R. (Pedagogisk Evidens- och Resonansmotor)

Minsta arkitektur som levererar ett komplett elevflöde, byggd ovanpå den befintliga Knowledge
Engine i stället för vid sidan av den. Inga mikrotjänster, inga nya körmiljöer, ingen ny
AI-abstraktion.

## 1. Flödet

```
Elevaktivitet (juridik.html)
      │
      ▼  POST /api/knowledge  { op: per_diagnose | per_answer | per_coach | per_profile }
api/knowledge.js ......... transport: auth, feature flags, kvot, HTTP-koder. Ingen pedagogik.
      │
      ▼
src/per/orchestrator.mjs .. P.E.R. Orchestrator — allt beslutsfattande
      │
      ├── src/per/learner-model.mjs ..... elevhistorik in, evidens ut (3 tabeller)
      ├── src/retrieval/legal-retrieval.mjs .. RAG (återanvänd, oförändrad)
      ├── src/per/assessment.mjs ........ deterministisk rättning ELLER resonemangsanalys
      │        └── api/_per-core.js callAIRaw() → OpenAI (strict JSON Schema)
      ├── src/generation/legal-generation.mjs .. verifierad frågegenerering (återanvänd)
      ├── src/per/recommendation.mjs .... nästa steg — REN KOD, ingen modell
      └── src/per/usage.mjs ............. token/latency/kostnad → ai_usage_events
      │
      ▼
Återkoppling + källor + uppdaterad elevmodell + evidensbaserat nästa steg
```

## 2. Rutning: när används vad

| Beslut | Avgörs av | Varför |
|---|---|---|
| Vilket koncept ska tränas | Kod (`selectDiagnosticConcept`) | Måste kunna förklaras och testas |
| Finns en färdig fråga | DB-fråga på ägda blueprints | Ingen AI-kostnad för återanvändning |
| Ny fråga behövs | LLM + blind verifiering (befintlig pipeline) | Källgrundning krävs |
| Flervalssvar rätt/fel | Kod (`gradeMultipleChoice`) | En strängjämförelse behöver ingen modell |
| Varför blev flervalssvaret fel | LLM (`error-classifier`) | Kräver språkförståelse |
| Fritextsvar rätt/fel | LLM (`per-assess`) + kod-rubrik | Kräver resonemangsanalys |
| Osäker bedömning | Andra LLM-anrop, starkare modell | Oberoende andrabedömning |
| Vad de två bedömningarna landar i | Kod (`reconcileAssessments`) | Modellen får inte döma sig själv |
| Mastery-uppdatering | SQL-RPC med lås | Atomicitet |
| Nästa pedagogiska steg | Kod (`decideNextStep`, R1–R10) | Måste vara förklarbart och repeterbart |

Modellen används alltså på exakt tre ställen: skapa fråga, förklara fel, bedöma fritext. Allt
annat är kod.

## 3. Datamodell (tillägg)

Befintliga tabeller från `20260720_knowledge_engine_schema.sql` återanvänds oförändrade.
Nytt i `20260727_per_learner_loop.sql`:

| Objekt | Roll |
|---|---|
| `student_attempts` | Ett elevsvar + dess bedömning. Idempotent på `(user_id, idempotency_key)`. |
| `student_recommendations` | Nästa steg + `rationale` + `evidence` (regeln som fattade beslutet). |
| `student_mastery.evidence_quality` | Löpande medel av bedömningarnas säkerhet. |
| `apply_legal_mastery()` | Atomisk Elo-uppdatering, advisory lock. |
| `per_consume_daily_quota()` | Atomisk dygnsräkning per användare och funktion. |
| `student_error_events`-trigger | Felhändelser måste höra ihop med sitt försök. |
| *(borttaget)* `exam_questions_select_own` | Facitläcka — se CODEX_REVIEW.md CR-PER-001. |

`student_error_events` och `student_mastery` fanns redan i schemat men hade ingen skrivväg. Det
är den luckan detta arbete stänger.

## 4. Elevmodellen

```
mastery_score    0–100, Elo (K=24 första 10 försöken, sedan 12) — samma skala som HP-modulen
confidence       min(1, attempts/8) × evidence_quality
evidence_quality löpande medel av bedömningarnas egen confidence
```

Två elever med samma `mastery_score` kan alltså ha helt olika `confidence`: den som svarat på tre
flervalsfrågor (deterministisk rättning, confidence 1.0) har starkare belagd kunskap än den som
fått tre osäkra fritextbedömningar. Rekommendationsmotorn använder båda.

Medvetet uteslutet: IRT, BKT, kunskapsgraf, glömskekurvor. Ingen av dem går att förklara för en
elev, och ingen av dem har underlag i en pilot med 6 koncept.

## 5. Säkerhetsmodell

1. **Ingen klientläsning av frågor.** `exam_questions` har ingen select-policy längre. Frågor når
   eleven bara via `toPublicQuestion()`, som inte tar med `correct_answer`/`explanation`.
2. **Ägarskap före allt annat.** `runAnswer` läser frågan med `exam_blueprints!inner(user_id)`
   filtrerat på inloggad användare — ett gissat `question_id` ger 404, inte data.
3. **Service_role skyddar ingenting av sig självt.** Varje läsning av elevdata har `.eq("user_id", …)`.
4. **Skrivning bara server-side.** Elevtabellerna har select-policy för egen rad och inga
   insert/update/delete-policyer.
5. **Elevsvar och källor är data.** Injektionsfraser redigeras bort (`sanitize.mjs`), texten märks
   med delimiters, och prompten förbjuder att följa instruktioner inuti dem.
6. **Citat verifieras deterministiskt.** `filterCitations()` släpper bara igenom chunk-id som
   faktiskt hämtades — en modell kan inte hitta på en källhänvisning.
7. **Bara godkänt material.** Retrieval och källvisning filtrerar på `review_status='approved'`.
8. **Bara verifierade frågor.** `verification_status` måste vara `passed`/`repaired`.

## 6. Pilotstyrning

`per_learner_loop_enabled` (av som default) **plus** `knowledge_engine_enabled` och
`legal_rag_enabled` krävs för varje elev-op. `allowed_user_ids` respekteras nu av
`flagsEnabled()` — tom lista betyder alla, ifylld lista betyder exakt de kontona.

`rollout_percentage` används fortfarande inte. En procentuell utrullning kräver en stabil
hashning av user_id som ingen yta behöver än; en halvfärdig mekanism vore sämre än ingen.

Kill switch: sätt någon av flaggorna till `false` — allt blir inert omedelbart, ingen deploy.

## 7. Kostnad och latency

Per elevsvar, uppmätt i evalkörning 2026-07-27 (25 fall):

| Väg | AI-anrop | Median |
|---|---|---|
| Flerval, rätt | 0 | ~0 ms |
| Flerval, fel | 1 (billig modell) | ~3 s |
| Fritext, säker bedömning | 1 (billig modell) | ~3–4 s |
| Fritext, osäker bedömning | 2 (billig + stark) | ~8–10 s |

`ai_usage_events` loggar uppmätta tokens (inte uppskattade) per steg. `estimated_cost` lämnas
NULL tills `config/model-pricing.json` fyllts i med verifierade priser — en påhittad kostnad ser
ut som mätdata och är värre än ingen kostnad.

Dygnskvot: 40 bedömningar/användare/dygn, atomiskt räknade.

## 8. Vad som medvetet INTE byggdes

- Ny AI-abstraktion ovanpå `callAI()` (ADR 0002 varnar för det).
- Egen mikrotjänst eller ny Vercel-funktion (funktionstaket, ADR 0001).
- LLM-baserad rekommendationsmotor (måste vara förklarbar).
- Semantisk cache av elevsvar (privat data får inte delas).
- Ändringar i `korkortet.html`, `api/hp.js` eller `driving_*`/`hp_*` (icke-förhandlingsbar gräns).
