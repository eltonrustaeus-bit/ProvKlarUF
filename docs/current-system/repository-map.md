# ProviaAI/ProvKlarUF — Repository Map (verifierad, 2026-07-18)

> Metod: läst direkt från repo-filer (`package.json`, `vercel.json`, `api/*.js`, `supabase/migrations/*`, `.git`, grep över källkod). CLAUDE.md/PRODUCT.md/DESIGN.md/PROVIA_HP_SPEC.md/AGENTS.md/.claude/ARCHITECTURE_MAP.md/.claude/QUICK_START.md är sekundära källor och citeras bara där de bekräftas eller motsägs av verkligheten. Repo har inget `.github/`-katalog — ingen CI-workflow existerar att läsa.

---

## 1. Övergripande projektstruktur

| Path | Vad det är | Anmärkning |
|---|---|---|
| `index.html`, `app.html`, `korkortet.html`, `förbättring.html`, `pricing.html`, `admin.html`, `konto.html`, `larare.html`, `live-demo.html`, `provia-hp.html`, `integritetspolicy.html` | Statiska HTML-sidor, en per "vy". Serveras direkt av Vercel (ingen SSR/router). | 11 sidor totalt — flera saknas i PRODUCT.md (se avvikelser). |
| `shared.js` | Global frontend-runtime: sidövergångar, "welcome"-animation, `pvModal`/auth-overlay, `getPageContext()`/`window.setPerContext()` för P.E.R-kontext, Supabase-anropshjälpare (`SUPA_URL` hårdkodad, anon-JWT hårdkodad). 76 KB, en enda fil. | Länkas in på i princip alla sidor. |
| `korkortet-srs.js` | Fristående SM-2 spaced-repetition-motor för körkortsmodulen. | |
| `style.css` | Globala design tokens + komponentstilar. | Matchar DESIGN.md-tokens (kontrollerat, se §11). |
| `final_questions.json` (608 KB) | 350+ körkortsfrågor, primär datakälla för `korkortet.html` (klientsidan laddar denna JSON direkt, inte Supabase i första hand). | |
| `api/` | Vercel serverless-funktioner (Node). Se §5. | Exakt 12 routade filer + 8 `_`-prefixade interna moduler. |
| `public/` | `public/hp/*.json` (kalibrerings-/normeringsdata för Provia HP) + `public/signs/E19.svg`. Statiska assets servade av Vercel under `/`. | |
| `js/` | Klientsidans ES-moduler för Provia HP: `hp-app.js`, `hp-graph.js`, `hp-math.js`, `hp-realprov.js`, `hp-sim.js`, `hp-table.js`, samt `intro-splash.js`. | Modulärt (i linje med kravet i PROVIA_HP_SPEC.md §0 att HP INTE ska bli en till 4400-radersmonolit som `korkortet.html`). |
| `image/` | Favicons, logga/hero-bild, samt `image/korkort/*.svg` (vägmärkes-SVG:er för vissa frågor). | |
| `instagram/` | Marknadsförings-reel-material: `reel.html/.mp4/.webm`, post-mallar (`post_01..04_*.html`), `download.html`. Inte del av produktionsappen. | |
| `scripts/` | ~50 ad-hoc Node/Python-script för frågedata: bygge (`build_final_questions.js`), fix/audit av körkortsfrågor, HP-kalibrering (`hp-calibrate.js`, `hp-quality.mjs`, `hp-seed-*.mjs`), Instagram-rendering (`record-reel.js`, `screenshot-instagram.js`), e-posttest (`test-emails.mjs`). Ingen samlad pipeline/CLI — körs enskilt, manuellt. | Inget av detta körs av `npm`-scripts (package.json saknar `scripts`-block helt). |
| `supabase/` | `migrations/` (9 SQL-filer) + `migrations_rollback/` (4 ROLLBACK-filer) + `.temp/` (CLI-cache, inte källkod). Se §6. | |
| `tests/` | En enda fil: `tests/teacher-portal.smoke.mjs` — fristående Node-script (ej testrunner), körs manuellt mot en **deployad** URL. Se §7. | |
| `bot-testing/` | Playwright-baserad "syntetisk AI-persona"-testsvit som kör riktiga signup→app→paywall-flöden mot live/lokal site. Se §7. | |
| `test-results/` | Endast `.last-run.json` — artefakt från en tidigare (troligen Playwright) körning, ingen källkod. | |
| `graphify-notes/`, `graphify-out/` | Genererad kodgraf/dokumentation (tredjeparts-/internverktyget "graphify"): `graph.json` (påstått 1747 noder/2161 kanter i CLAUDE.md), `GRAPH_REPORT.md`, ett helt Obsidian-vault (`obsidian/*.md` — ~250 filer) med per-symbol-noter. **Innehåller flera noter om filer som inte längre finns** (`smart-tips.js`, `train-material.js`, `admin-approve.js`, `notify-new-user.js`, `check-approved.js`) — grafen är alltså inaktuell/inte regenererad sedan konsolideringen till `hp.js`/`admin.js`/`check-role.js`. | Auto-genererat, inte handskriven dokumentation. |
| `.agents/` | En fil: `product-marketing.md` (troligen en agent-persona/prompt för marknadsföringsarbete). | |
| `.claude/` | Claude Code-projektkonfiguration: `settings.json`, `ARCHITECTURE_MAP.md`, `QUICK_START.md`, `COMMON_MISTAKES.md`, `commands/*.md` (cleanup/deploy/grant/users), `skills/*` (hooks-automation, pair-programming, skill-builder, sparc-methodology, stream-chain, swarm-advanced, swarm-orchestration, verification-quality). | `settings.json` innehåller en `claudeFlow`-konfigblock med `"platform": {"os": "windows", "shell": "powershell"}` trots att repot klonades/körs på macOS (darwin) här — troligen kvarleva från en Windows-utvecklingsmaskin (matchar `UserseltonAppDataLocalTemp*`-filerna i repo-roten). |
| `.claude-flow/` | Runtime-state för "claude-flow"-orkestreringsverktyget: `config.yaml`, `daemon-state.json`, `daemon.pid`, `metrics/*.json` (codebase-map, consolidation, performance, security-audit, test-gaps). Detta är verktygstillstånd, inte applikationskod. | |
| Root-nivå rapport-/loggfiler | `agents_log.md`, `audit_report.json`, `bildfix_rapport.md`, `blocked_questions_repair_report.md`, `korkort_quality_audit.md`, `manual_image_review_report.md`, `manual_text_review_report.md`, `road_sign_audit_report.md`, `url_audit_result.json`, `validation_report.md`, `UserseltonAppDataLocalTemp*.txt` | Historiska engångsrapporter från tidigare audits/städinsatser av körkortsfrågedatan. Ligger löst i repo-roten, inte i `docs/`. |
| `google52ca1d3d9412d7b8.html`, `robots.txt`, `sitemap.xml` | Google Search Console-verifiering + SEO-filer. | |

---

## 2. Pakethanterare & beroenden

`package.json` (fullständig — se nedan) bekräftar: **inget ramverk**. Plain HTML/CSS/vanilla JS + Vercel serverless-funktioner + Supabase-klient.

```json
{
  "name": "provia-ai",
  "dependencies": { "@supabase/supabase-js": "^2.45.0" },
  "devDependencies": {
    "ffmpeg-static": "^5.3.0",
    "playwright": "^1.60.0",
    "sharp": "^0.34.5"
  }
}
```

- Inget `"scripts"`-block alls i `package.json` → `npm test`/`npm run build` finns inte (verifierat, se §7).
- Inget `next`, `react`, `vue`, `express`, `vite` etc. i beroendeträdet — matchar CLAUDE.md/AGENTS.md:s påstående "No framework, no build step".
- Stripe och Resend har **inga SDK-beroenden** — anropas via rå `fetch()` direkt mot `api.resend.com` (i `signup.js`, `stripe-webhook.js`) och Stripes REST-API (i `create-checkout-session.js`, `stripe-webhook.js`). Detta stämmer med "no dependencies beyond supabase-js" men är värt att notera explicit eftersom AGENTS.md listar "Stripe"/"Resend" som lager utan att klargöra att de är SDK-fria.
- `package-lock.json` (lockfileVersion 3) innehåller bara transitiva deps av `@supabase/supabase-js`, `playwright`, `sharp`, `ffmpeg-static` — inget oväntat.
- Inget `engines`-fält → ingen Node-version pinnad i `package.json`. Ingen `runtime`-nyckel i `vercel.json` heller (se §4) → Vercel använder sin default Node-runtime för projektet.

---

## 3. Build-system

**Inget build-steg finns.** Ingen `build`-script i `package.json`, ingen `buildCommand` i `vercel.json`. `vercel.json` sätter `"outputDirectory": "."` — Vercel serverar rot-katalogens `.html`/`.css`/`.js`-filer som statiska assets rakt av, och deployar `api/*.js` som separata serverless-funktioner. `scripts/*.js`-filerna (frågedatabygge, bildfix, HP-kalibrering) är fristående engångsverktyg som körs manuellt med `node scripts/x.js`, inte en del av någon deploy-pipeline.

---

## 4. Deployment-konfiguration (`vercel.json`)

```json
{
  "outputDirectory": ".",
  "functions": {
    "api/stripe-webhook.js": { "maxDuration": 10 },
    "api/create-checkout-session.js": { "maxDuration": 15 },
    "api/grade.js": { "maxDuration": 60 },
    "api/generate-exam.js": { "maxDuration": 60 },
    "api/teacher-report.js": { "maxDuration": 60 },
    "api/check-role.js": { "maxDuration": 60 },
    "api/ocr.js": { "maxDuration": 60 },
    "api/explain.js": { "maxDuration": 60 },
    "api/hp.js": { "maxDuration": 60 }
  }
}
```

- 9 av 12 routade `api/*.js`-filer har explicit `maxDuration`. `admin.js`, `signup.js` och `delete-exams.js` saknar override → kör på Vercel-plattformens default (troligen Hobby-planens standard, ej 60s).
- Ingen `rewrites`/`redirects`/`headers`-konfiguration i `vercel.json` — routing sker helt genom filnamn (`api/x.js` → `/api/x`).
- Ingen `crons`-nyckel — inga schemalagda jobb konfigurerade via Vercel Cron.

**CI/CD:** Ingen `.github/workflows/`-katalog existerar i repot → **ingen GitHub Actions-pipeline**. Deploy sker via Vercels git-integration (push till `main` → auto-deploy), vilket stämmer med AGENTS.md:s påstående "push to main = auto-deploy" — men detta är inte verifierbart från repot självt (kräver Vercel-projektinställningar utanför git), bara indirekt bekräftat av avsaknaden av annan CI.

---

## 5. Frontend-arkitektur

- Varje `.html`-fil är en fristående sida (ingen SPA-router). Navigering sker med vanliga `<a href>`-länkar; `shared.js` fångar klick på interna länkar och lägger på en CSS-övergångsklass (`pg-leaving`) + 210ms `setTimeout` innan `window.location.href` sätts — en enkel sidövergångseffekt, inte client-side routing.
- `shared.js` är den delade "runtime" alla sidor länkar in: hanterar auth-modal (`pvModal`, `data-pv-auth`), Supabase-anrop direkt mot `SUPA_URL = 'https://mnmotdluigzeehdjbhbu.supabase.co'` (hårdkodad, med hårdkodad publik anon-JWT — detta är avsett beteende, anon-nyckeln är designad för att vara publik), samt `getPageContext()`/`window.setPerContext()` som bygger kontextsträngar skickade till AI-endpoints (P.E.R-systemet).
- State hålls i huvudsak i `localStorage`/`sessionStorage` (t.ex. `provia_welcome_name`) och per-sida in-memory JS, inte i en delad state-store.
- `korkortet.html` är enligt PROVIA_HP_SPEC.md själv flaggad som "~4400-line monolith (flagged anti-pattern)" — bekräftat: filen är 236 KB på disk, klart störst av alla HTML-sidor. Provia HP-sidan (`provia-hp.html`, 253 rader) är däremot medvetet tunn och delegerar till moduler i `js/hp-*.js` — en direkt arkitektonisk reaktion på den kritiken.
- `live-demo.html` (2233 rader, 130 KB) är den näst största filen — en fristående animerad marknadsföringsdemo, inte kopplad till backend-API:erna.

---

## 6. Serverless-funktioner (`api/`)

Totalt **12 routade endpoints** (filer utan `_`-prefix) + **8 interna hjälpmoduler** (`_`-prefix — enligt kommentar i `_hp-facit.js`: "leading underscore under /api means not routed and not static-served", dvs. Vercel-konventionen exkluderar dem från routing).

12 är exakt Vercel Hobby-planens gräns för antal serverless-funktioner — bekräftat av en kommentar i koden själv (`api/hp.js` rad ~20-22): *"Consolidates generate / diagnose / realprov into ONE serverless function (Hobby plan has a 12-function cap)."* Detta förklarar varför flera funktioner som nämns i dokumentationen (`smart-tips.js`, `train-material.js`, `check-approved.js`, `admin-approve.js`, `notify-new-user.js`) inte längre existerar som egna filer — de har konsoliderats in i andra endpoints (troligen `explain.js`/`check-role.js`/`admin.js`/`signup.js`) för att hålla sig under gränsen.

| Fil | Format (verifierat) | Purpose (en rad) | `maxDuration` i vercel.json |
|---|---|---|---|
| `api/_auth.js` | ESM | Delad auth-middleware — verifierar Supabase JWT via service-role-klient. | — (ej routad) |
| `api/_hp-facit.js` | ESM | Facit/rätta-svar-nycklar för riktiga tidigare Högskoleprov (endast svarsbokstäver, ingen frågetext). | — |
| `api/_hp-norm.js` | ESM | Råpoäng → skalpoäng-konvertering (0.0–2.0) för HP, approximativ standardkurva. | — |
| `api/_per-context.js` | ESM | Sanering/filtrering av användarkontext innan den skickas till AI (bl.a. prompt-injection-skydd, regex mot "ignore previous"/"api key" etc). | — |
| `api/_per-core.js` | ESM | P.E.R-motorn: `callAI()`, `buildPERSystemPrompt()`, `buildPERCoachSystemPrompt()` — delad av flera endpoints. | — |
| `api/_per-memory.js` | ESM | Långtidsminne för P.E.R — komprimerad inlärningsprofil per användare (inte rådata). | — |
| `api/_provia-kb.js` | ESM | Bygger publik produktkunskap (FAQ-typ) från `_provia-rules.js`, injiceras i AI-prompter. | — |
| `api/_provia-rules.js` | ESM | Central källa för planer/kvoter/priser/fakta som backend + AI-flöden refererar till. | — |
| `api/admin.js` | ESM | Adminoperationer (`list-users`, `set-role`, m.fl.) — kräver admin-roll. | default |
| `api/check-role.js` | ESM | Returnerar användarroll + `entitlements`/`per_memory_clear`-actions från JWT. | 60s |
| `api/create-checkout-session.js` | ESM | Skapar Stripe Checkout-session (basic/premium-planer via `STRIPE_BASIC_PRICE_ID`/`STRIPE_PREMIUM_PRICE_ID`). | 15s |
| `api/delete-exams.js` | ESM | Raderar en användares sparade prov. | default |
| `api/explain.js` | ESM | P.E.R-förklaringschatt (helpLevel 0–3: ledtråd → full lösning). | 60s |
| `api/generate-exam.js` | **CJS** | Genererar mockprov från inklistrat material via OpenAI `/v1/responses`, kvot-styrt via atomär RPC. | 60s |
| `api/grade.js` | **CJS** | Rättar prov: MC deterministiskt (`correct_index`), icke-MC via samlat AI-anrop. | 60s |
| `api/hp.js` | ESM | Enda routern för hela Provia HP-modulen (generera/diagnostisera/realprov-rättning), konsoliderad pga funktionstaket ovan. 1038 rader, störst i `api/`. | 60s |
| `api/ocr.js` | **CJS** | Extraherar text från uppladdad bild via OpenAI multimodal vision. | 60s |
| `api/signup.js` | ESM | Skapar/kompletterar användarprofil + skickar välkomst-/adminmail via Resend REST-API. | default |
| `api/stripe-webhook.js` | **ESM** *(se avvikelse i §11)* | Hanterar Stripe-webhooks (prenumerationsändringar), verifierar signatur manuellt (`crypto`), uppdaterar roll + skickar mail. | 10s |
| `api/teacher-report.js` | ESM | Genererar lärarrapport (P.E.R-baserad) för lärarpanelen. | 60s |

**Runtime:** Ingen explicit `runtime`/Node-version anges i `vercel.json` eller `package.json` (`engines`) — funktionerna kör alltså på Vercels plattforms-default. Alla är vanliga serverless Node-funktioner (`req, res`-signatur), **inte** Edge Functions — ingen fil använder Edge-signaturen (`export const config = { runtime: 'edge' }` förekommer inte i något api-filhuvud som granskats).

---

## 7. Test-setup

**Ingen testrunner är konfigurerad.** `npm test` verifierades köras och gav:
```
npm error Missing script: "test"
```
`package.json` saknar helt ett `scripts`-block.

- `tests/teacher-portal.smoke.mjs` — ett fristående Node-script (använder `node:assert/strict`, inte Jest/Vitest/Mocha). Körs manuellt: `BASE_URL=... node tests/teacher-portal.smoke.mjs`. Default-URL i filen är en **deployad** preview-host (`https://provia-ai-uf.vercel.app`), inte localhost. Testar (1) att teacher-API avvisar oautentiserade anrop (401) och (2) att `larare.html` laddar rent och gömmer dashboarden för anonyma besökare (kräver Chromium/Playwright, hoppas annars över utan fail).
- `bot-testing/` — en mer omfattande Playwright-driven "syntetisk AI-persona"-svit (`run-bots.mjs`, `personas.json`, `lib/browser.mjs`, `lib/persona-agent.mjs`, `lib/report.mjs`, `cleanup.mjs`). Kör hela användarresor (signup → app → paywall → feedback) mot live eller lokal site, genererar Markdown-rapport + skärmdumpar. README:n är ovanligt tydlig om begränsningar: inte marknadsvalidering, ska aldrig presenteras som riktiga användare, stannar alltid vid Stripe-paywall (fullföljer aldrig köp). Kräver riktiga env-vars (`OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) och skickar riktiga mail via plus-adressering.
- Ingen av dessa körs automatiskt av CI (ingen CI existerar, se §4) eller av ett `npm`-kommando — helt manuell körning.
- `test-results/.last-run.json` är en kvarlämnad artefakt (troligen från en Playwright-körning), inte källkod.

---

## 8. Supabase-integration

- **Klientsidan**: `shared.js` (och sannolikt varje `.html`-fil, alla 9 sidor som grep:ades innehåller `createClient`/`supabase-js`) instansierar en Supabase-klient med hårdkodad projekt-URL (`mnmotdluigzeehdjbhbu.supabase.co`) och en hårdkodad **publik anon-JWT** inline i JS. Detta är standardmönstret för Supabase (anon-nyckeln är avsedd att vara klientsynlig och skyddas av RLS), inte en läcka av hemlighet.
- **Serversidan**: `api/_auth.js`, `api/stripe-webhook.js` m.fl. instansierar en separat klient med `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (miljövariabel, server-only) för admin-nivå-åtkomst förbi RLS.
- **Migrationer** (`supabase/migrations/`, 9 filer + 2 extra ROLLBACK-varianter blandade in i samma katalog):
  1. `20260603_add_mock_exam_quota.sql`
  2. `20260620_per_structured_memory.sql`
  3. `20260627_teacher_dashboard.sql`
  4. `20260630_hp_schema.sql`
  5. `20260701_hp_fixes.sql`
  6. `20260702_hp_normering.sql` (+ `20260702_hp_normering_ROLLBACK.sql` liggande i samma `migrations/`-katalog, inte i `migrations_rollback/`)
  7. `20260703_hp_questions_data.sql` (+ `20260703_hp_questions_data_ROLLBACK.sql`, samma mönster)
  8. `20260705_hp_v2.sql` (+ `20260705_hp_v2_ROLLBACK.sql`, samma mönster)

  Separat `supabase/migrations_rollback/`-katalog innehåller ytterligare 4 ROLLBACK-filer för äldre migrationer (`20260627_teacher_dashboard`, `20260630_hp_schema`, `20260701_hp_fixes`, samt en `atomic_quota_and_anon_rate_limit_ROLLBACK.sql` som **saknar en motsvarande forward-migration med matchande namn** i `migrations/` — tyder på att den ursprungliga migrationen döptes om eller att rollback-filen är kvarleva från en squash/refaktorering).

  **Bedömning: sekventiell och tätt buntad i tid** (2026-06-03 → 2026-07-05, all utveckling är recent), men **inkonsekvent struktur** — ROLLBACK-filer för de tre senaste migrationerna ligger blandade i huvudkatalogen istället för i `migrations_rollback/` som de äldre. Inget tyder på saknade/glappande sekvensnummer i sig (datum-prefix, inte löpnummer), men namngivningskonventionen för rollbacks är inte konsekvent tillämpad.
- `supabase/.temp/` innehåller bara CLI-cache (`linked-project.json`, `project-ref`, versionsfiler) — bekräftar att projektet är kopplat till ett Supabase-projekt via CLI, ingen källkod.

---

## 9. Miljövariabler (namn, inga värden)

Grep av `process.env.` över `api/`, `scripts/`, `tests/`, `bot-testing/`, `js/`, `supabase/`:

| Variabel | Refereras i |
|---|---|
| `OPENAI_API_KEY` | flera `api/*.js` |
| `OPENAI_MODEL` | `api/generate-exam.js`, `api/ocr.js`, flera fler |
| `OPENAI_MODEL_MATH` | `api/generate-exam.js` |
| `OPENAI_MATH_MODEL` | `api/hp.js` — **annat namn, se avvikelse §11** |
| `SUPABASE_URL` | `api/_auth.js`, `api/stripe-webhook.js`, flera fler |
| `SUPABASE_SERVICE_ROLE_KEY` | samma filer som ovan |
| `RESEND_API_KEY` | `api/signup.js`, `api/stripe-webhook.js` |
| `STRIPE_SECRET_KEY` | `api/create-checkout-session.js` |
| `STRIPE_WEBHOOK_SECRET` | `api/stripe-webhook.js` |
| `STRIPE_BASIC_PRICE_ID` | `api/create-checkout-session.js` |
| `STRIPE_PREMIUM_PRICE_ID` | `api/create-checkout-session.js` |
| `HP_PUBLIC` | `api/hp.js` (launch-flagga: privat beta tills satt till `'true'`) |
| `BASE_URL` | `tests/teacher-portal.smoke.mjs`, `bot-testing/` |
| `BOT_EMAIL_BASE` | `bot-testing/` |

`SUPABASE_WEBHOOK_SECRET`, som nämns som "optional" i både CLAUDE.md och AGENTS.md/.claude/QUICK_START.md, förekommer **inte** i någon `process.env.`-referens i källkoden som grep:ades — antingen oanvänd/borttagen variabel eller refererad på ett sätt grep inte fångade.

---

## 10. Git-struktur

- **Branches**: `main` (aktiv, clean working tree vid granskning), `origin/claude/playwright-mcp-nknevx` (2 commits ovanpå main: Playwright MCP-serverkonfig + en meny-justering — ej mergad), `origin/codex/enhance-landing-page-for-premium-feel` (namnet antyder ej-mergat landningssidesarbete). Inga submoduler (`.gitmodules` saknas).
- **Senaste 30 commits**: nästan uteslutande fokuserade på **Provia HP** (`feat(hp)`/`fix(hp)`) — normering, verbal validator, KVA/NOG/DTK/XYZ-motorer, säkerhetshärdning mot prompt injection, adaptiv sampling — samt ett par `bot-testing`-relaterade fixar och onboarding-copy i `app.html`. Detta bekräftar att HP-modulen är den aktiva utvecklingsfronten just nu, i linje med commit-loggens datum och `supabase/migrations`-tidsstämplarna.

---

## 11. Avvikelser mot befintlig dokumentation

1. **`api/smart-tips.js`, `api/train-material.js`, `api/check-approved.js`, `api/admin-approve.js`, `api/notify-new-user.js` existerar inte.** De är utförligt dokumenterade i `CLAUDE.md` (API Routes-tabellen listar `smart-tips.js`), `AGENTS.md` (fil-struktur + modulformat-tabell), och `.claude/ARCHITECTURE_MAP.md` (data flow-diagrammet: `förbättring.html → POST /api/train-material`, `POST /api/check-approved`). Faktisk `api/`-katalog har bara 12 routade filer (se §6), och `api/hp.js` innehåller själv förklaringen: Vercel Hobby-planens 12-funktionstak tvingade konsolidering. Sannolikt har dessa endpoints slagits samman in i `explain.js`/`check-role.js`/`admin.js`/`signup.js`, men det är inte verifierbart utan djupare kodläsning av respektive fils interna `action`/`op`-grenar.

2. **`api/hp.js` existerar inte i någon av `CLAUDE.md`/`AGENTS.md`/`.claude/ARCHITECTURE_MAP.md`:s fil-strukturlistor eller API-tabeller**, trots att det är den enskilt största filen i `api/` (1038 rader) och den mest aktiva utvecklingsytan enligt git-loggen. `CLAUDE.md` nämner Provia HP bara i lösryckta ändringslogg-rader längst ner, inte i huvudstrukturen.

3. **CJS/ESM-tabellen i `AGENTS.md` och `.claude/ARCHITECTURE_MAP.md` är felaktig för två filer** — ironiskt nog det exakta område dokumenten själva flaggar som "CRITICAL — never mix, check before editing":
   - `api/ocr.js` är faktiskt **CommonJS** (`module.exports`, filens egen kommentar säger "CommonJS / Vercel Serverless"), men `.claude/ARCHITECTURE_MAP.md` listar den explicit under ESM-gruppen, och `AGENTS.md`:s tabell (som bara namnger `generate-exam.js`/`grade.js`/`stripe-webhook.js` som CJS och "everything else" som ESM) implicerar samma sak.
   - `api/stripe-webhook.js` är faktiskt **ESM** (`import { createClient } from "@supabase/supabase-js"`), men både `CLAUDE.md` och `AGENTS.md` listar den explicit som CommonJS.

4. **Två olika miljövariabelnamn för samma syfte**: `api/generate-exam.js` läser `OPENAI_MODEL_MATH`, medan `api/hp.js` läser `OPENAI_MATH_MODEL` (omvänd ordning på orden). Ingendera dokumentation (`AGENTS.md`, `.claude/QUICK_START.md`) nämner `OPENAI_MATH_MODEL` alls — bara `OPENAI_MODEL_MATH`. Om bara en av de två variablerna sätts i Vercel faller den andra tyst tillbaka till default-modellen. Detta är en verklig kod-inkonsekvens, inte bara ett dokumentationsglapp.

5. **`STRIPE_BASIC_PRICE_ID` och `STRIPE_PREMIUM_PRICE_ID` saknas i "Required Environment Variables"-listorna** i både `AGENTS.md` och `.claude/QUICK_START.md`, trots att `api/create-checkout-session.js` kräver dem för att Stripe-checkout ska fungera alls.

6. **`PRODUCT.md`:s sidlista är ofullständig.** Den listar bara `index.html`, `app.html`, `korkortet.html`, `pricing.html`, `förbättring.html`, `admin.html` — men repot har dessutom `konto.html`, `larare.html`, `live-demo.html`, `provia-hp.html` och `integritetspolicy.html`, varav `provia-hp.html` representerar en hel tredje produktgren ("Provia HP" vid sidan om "Provia Study" och "Provia Drive" enligt `PROVIA_HP_SPEC.md` §1) som inte nämns i `PRODUCT.md` alls.

7. **`PROVIA_HP_SPEC.md` är daterad "Design pass (no production code)"** och beskriver den planerade arkitekturen som flera separata routes: `routes api/hp-*.js` (plural). Verkligheten (bekräftat av git-historik och filinnehåll) är att detta redan är byggt och i produktion sedan flera veckor — som **en enda konsoliderad fil** `api/hp.js`, inte flera `hp-*.js`-filer, av den Hobby-plan-tekniska anledning som beskrivs i punkt 2 ovan. Specen är alltså inaktuell relativt implementationen den beskriver.

8. **`graphify-out/`-kodgrafen (som `CLAUDE.md` instruerar agenter att fråga FÖRST, före rå filläsning: "Graphify First") är inaktuell.** Den innehåller Obsidian-noter för filer som inte längre finns (`smart-tips.js.md`, `train-material.js.md`, `admin-approve.js.md`, `notify-new-user.js.md`, `check-approved.js` refereras i `_COMMUNITY_*`-filer) men saknar täckning av `api/hp.js` och `js/hp-*.js` i sin nuvarande form (grafen uppges i `CLAUDE.md` vara uppdaterad "2026-07-01, incl. HP", men de döda filreferenserna tyder på att den byggdes innan konsolideringen till `hp.js` slutfördes, eller att den aldrig regenererats efter borttagningen av de gamla filerna).

9. **`.claude/settings.json`:s `claudeFlow.platform`-block anger `"os": "windows"`, `"shell": "powershell"`**, vilket inte matchar miljön granskningen kördes i (darwin/zsh). Detta är troligen en kvarleva från en tidigare Windows-arbetsmaskin (styrks av `UserseltonAppDataLocalTemp*.txt`-filerna i repo-roten, ett Windows-sökvägsmönster) och är inte i sig en avvikelse mot produktdokumentationen, men värt att känna till om `.claude/`-tooling förväntas bete sig plattformsspecifikt.

10. **Ingen `.github/workflows/`-katalog finns**, vilket varken bekräftas eller motsägs explicit av CLAUDE.md/AGENTS.md (de nämner bara "push to main = auto-deploy" utan att specificera CI-mekanism) — men värt att notera för fullständighetens skull: det finns inget automatiserat testkörnings- eller lint-steg någonstans i pipelinen. `npm test` existerar inte (§7).

11. **Design tokens stämmer.** `style.css`/`DESIGN.md`/`CLAUDE.md`/`AGENTS.md` är konsekventa sinsemellan för accentfärg (`#1bff8c`), bakgrund (`#08100d`) och typsnitt (DM Sans/DM Mono) — ingen avvikelse hittad här (kontrollerat men inte djupdykt rad-för-rad i `style.css`).
