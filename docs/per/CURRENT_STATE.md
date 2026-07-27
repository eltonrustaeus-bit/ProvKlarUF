# CURRENT_STATE — ExGen inför P.E.R.-elevloopen

Datum: 2026-07-27. Repo: `eltonrustaeus-bit/provia-ai` (ExGen). Utgångsbranch: `redesign/11-pensionskontrollen-inspired`.
Arbetsbranch: `feat/per-learner-loop`.

**Viktigt om arbetsträdet:** 7 filer var ocommittade vid start (`app.html`, `exgen-shell.css`,
`förbättring.html`, `index.html`, `konto.html`, `korkortet.html`, `pricing.html`) — pågående
designarbete. Ingen av dem har rörts av detta arbete, och de har inte committats.

## 1. Vad som faktiskt redan finns (verifierat i kod + live-DB, inte antaget)

Kodbasen är **inte** ett tomt fält. Fas −1 t.o.m. Fas 10 av "Provia Knowledge Engine" är redan
byggda och dokumenterade i `docs/provia-knowledge-engine/`. Verifierat mot produktionsdatabasen
2026-07-27:

| Yta | Status | Bevis |
|---|---|---|
| Knowledge-schema (13 tabeller) | Finns, RLS på | `supabase/migrations/20260720_knowledge_engine_schema.sql` |
| Pilotkorpus juridik | 4 källor, 4 dokument, **20 chunks — alla `approved`** | live-DB |
| Koncept | **6 st** Privatjuridik (anbud-accept, fullmakt, avtals-ogiltighet, underårigas rättshandlingsförmåga, konsumentköp-fel, reklamation) | live-DB |
| Embeddings + hybridretrieval | Finns (`text-embedding-3-small`, 1536d, RPC `match_knowledge_chunks`, tsv+vec-viktning) | `src/retrieval/legal-retrieval.mjs` |
| Generering + blind verifiering + repair | Finns, deterministiskt beslut | `src/generation/legal-generation.mjs` |
| Genererade frågor | **36 `exam_questions`** med verifieringsstatus | live-DB |
| LLM-lager | `callAI()` mot `/v1/responses` med strict JSON Schema, timeout | `api/_per-core.js:15` |
| Kostnadsloggning | **183 `ai_usage_events`** | live-DB |
| Feature flags | Tabell + server-side gate, `allowed_user_ids` finns men oanvänd | `api/knowledge.js:24` |
| Prompt-versionering | Modulmönster `src/ai/prompts/<namn>/v1.js` | 6 moduler |
| Evals | Gold set + validator för generering | `tests/evals/legal-v1/` |
| Prompt-injection-sanering | `BLOCKED_CONTEXT_REGEX` | `api/_per-context.js:1` |
| Atomisk mastery-RPC (HP) | Finns för HP, låsmönster `for update` | `20260701_hp_fixes.sql:16` |

## 2. Det verkliga gapet

Allt ovan producerar **frågor**. Ingenting av det producerar **lärande**. Konkret:

1. **`student_mastery` och `student_error_events` har noll kodanvändning.** Tabellerna skapades i
   Fas 1 med kommentaren "uppdateras av en framtida `apply_legal_mastery()`-RPC … byggs i Fas 9".
   Fas 9 fanns inte. `student_error_events` = 0 rader, `student_mastery` saknar helt skrivväg.
2. **Ingen attempt-tabell.** `student_error_events.source_attempt_id` pekar på en tabell som aldrig
   skapades — evidenskedjan är bruten från början.
3. **Ingen bedömning av elevsvar i knowledge-motorn.** `api/grade.js` rättar mockprov men är helt
   frikopplad från koncept, källor och mastery. `api/knowledge.js` har bara `op=blueprint` och
   `op=generate` — inga elevriktade operationer alls.
4. **Ingen rekommendationsmotor.** Inget väljer nästa uppgift utifrån evidens.
5. **Ingen elevyta.** Ingen HTML-sida konsumerar `api/knowledge.js`. Motorn har aldrig setts av
   en elev.
6. **Källor visas aldrig.** `source_chunk_ids` sparas men returneras inte till någon UI.
7. **Flaggorna är av.** `knowledge_engine_enabled`, `legal_rag_enabled`, `per_legal_rag_enabled`
   = false. Bara `legal_shadow_mode` = true. Motorn är avsiktligt inert i produktion.

## 3. Risker som redan är hanterade (inte återupptäckta här)

Service_role-nyckelläcka (roterad), `profiles`-privilege-escalation (fixad), HP-answer-key-läcka
(fixad), `apply_hp_mastery`-race (fixad), obegränsade AI-anrop per användare (daglig kvot i
`api/knowledge.js`). Se `docs/provia-knowledge-engine/02-security-findings.md` och `docs/codex_review.md`.

## 4. Risker som är nya i och med elevloopen

| # | Risk | Hantering i detta arbete |
|---|---|---|
| N1 | Elevens fritextsvar går in i en bedömnings-LLM → prompt injection | Sanering + explicit datamarkering, elevsvar aldrig som instruktion |
| N2 | RAG-chunks går in i samma prompt → injection via källmaterial | Chunks är `approved` (mänskligt granskade) + markeras som data |
| N3 | Mastery-skrivning race vid parallella svar | `apply_legal_mastery()` med `for update`, samma mönster som HP |
| N4 | Elevsvar lagras i klartext | Trunkering + own-row RLS + ingen loggning av fulltext i `ai_usage_events` |
| N5 | Cross-user-läsning av attempts/mastery | `for select using (user_id = auth.uid())`, inga skrivpolicyer (service_role-only) |
| N6 | LLM-bedömning styr betyg utan kontroll | Deterministisk rättning först; LLM bara för resonemang; låg confidence → `manual_review`-liknande fallback |
| N7 | Kostnadsexplosion via elevriktad endpoint | Egen dygnskvot per användare för assess-anrop, separat från genereringskvoten |

## 5. Beslut tagna utan att fråga (normala tekniska beslut)

- **Pilotämne: Privatjuridik.** Enda ämnet med godkänd korpus, koncept och verifierade frågor.
- **Ingen ny Vercel-funktion.** Nya ops läggs i befintliga `api/knowledge.js` (funktionstaket, ADR 0001).
- **Ingen ny AI-abstraktion.** `callAI()` återanvänds rakt av (ADR 0002 varnar för detta).
- **Ny elevsida som egen statisk fil** (`juridik.html`) i stället för att bygga in i `app.html` —
  noll risk att kollidera med användarens ocommittade designändringar.
- **Mastery-modell: Elo-liknande, samma skala 0–100 som HP.** Ingen IRT/BKT (uttrycklig avgränsning).
