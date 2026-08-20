# Secrets-audit — ProviaAI / ProvKlarUF

Datum: 2026-07-18
Typ: Read-only säkerhetsgranskning av arbetskatalog + full git-historik (`git log --all -p`, `-S`, `-G`).
Repo: `eltonrustaeus-bit/provia-ai` (remote `origin` = GitHub, branch `main` + 2 andra branches).

Alla hemligheter nedan är maskerade (endast första 4–6 tecken + `...REDACTED`). Inga fullständiga nyckelvärden förekommer i detta dokument.

---

## Executive Summary

Granskningen hittade **1 kritiskt fynd**: en hårdkodad Supabase **service_role**-nyckel (fullständig admin-åtkomst till databasen, kringgår RLS) committad i klartext i `scripts/fix_broken_image_urls.mjs`. Nyckeln ligger kvar i arbetskatalogen på nuvarande `HEAD` och finns pushad till GitHub-remoten sedan commit `91fdb62` (2026-06-09). Den måste roteras omedelbart.

Utöver detta är exponeringen begränsad till det som är **avsett att vara publikt**: Supabase **anon**-nyckeln (`role: anon`) är hårdkodad i 10 klientfiler (index.html, app.html, konto.html, admin.html, larare.html, korkortet.html, förbättring.html, pricing.html, live-demo.html, shared.js) samt i två verktygsskript. Det är normal praxis för Supabase — anon-nyckeln är designad att skickas till webbläsaren och skyddas av RLS-policyer, inte av hemlighållande.

Inga `.env`-filer har någonsin committats (verifierat med `git log --all --full-history -- '*.env*'` → tomt resultat). `.gitignore` täcker `.env`, `.env.local`, `.env*.local` och en generell `.env*`-regel — korrekt konfigurerad, ingen historisk lucka hittad. Inga OpenAI-, Stripe- (`sk-`, `sk_live_`, `whsec_`) eller Resend-nycklar (`re_...`) hittades hårdkodade någonstans i arbetsträd eller historik. `api/`-lagret läser alla hemligheter korrekt via `process.env.*` och läcker aldrig nyckelvärden i svar eller loggar — endast generiska "saknas"-felmeddelanden vid frånvaro av variabel.

**Antal fynd per allvarlighetsgrad:**
- CRITICAL: 1
- HIGH: 0
- MEDIUM: 1 (redundant duplicering av anon-nyckel i 12 filer — inte en läcka i sig, men ökar risk för att nästa hårdkodning av misstag blir en *hemlig* nyckel)
- LOW: 1 (.mcp.json-referens i graphify-dokumentation, ofarlig)

**Är någon hemlighet exponerad live just nu?** Ja — service_role-nyckeln i `scripts/fix_broken_image_urls.mjs` är exponerad i git-historik och nuvarande `HEAD`, pushad till GitHub. Den är praktiskt taget icke-utgående (`exp` motsvarar år 2036).

---

## Findings (grouped by severity)

### CRITICAL

**C-1. Hårdkodad Supabase `service_role`-nyckel i skript, committad till git**
- **Fil:** `scripts/fix_broken_image_urls.mjs`, rad 11
- **Typ:** Supabase service_role JWT (kringgår Row Level Security helt — full läs/skriv-åtkomst till alla tabeller)
- **Maskerat värde:** `eyJhbG...REDACTED` (payload dekodad: `{"iss":"supabase","ref":"mnmotdluigzeehdjbhbu","role":"service_role","iat":1770337084,"exp":2085913084}`)
- **Introducerad:** commit `91fdb62` — "fix: körkortsmodul QA — bildfix, metadata, XSS-patch" (2026-06-09), författare `eltonrustaeus-bit`
- **Nuvarande status:** Filen finns kvar oförändrad på `HEAD` (`640edb5`, 2026-07-17). Pushad till `origin/main` på GitHub.
- **Risk:** CRITICAL. Vem som helst med läsåtkomst till repot (eller repots historik, om det någonsin varit eller blir publikt, eller om åtkomst läcker via en collaborator/fork/CI-logg) kan använda nyckeln för att läsa, ändra eller radera all data i Supabase-projektet `mnmotdluigzeehdjbhbu` — inklusive användarkonton, provresultat, betalstatus, admin-roller — helt utan autentisering.
- **Åtgärd:** Rotera Supabase service_role-nyckeln omedelbart (se rotationslista nedan). Ta bort hårdkodningen ur skriptet och läs från `process.env.SUPABASE_SERVICE_ROLE_KEY` (mönstret som redan används korrekt i `scripts/add_questions_batch2.py`, `scripts/upload_new_questions.py`, `scripts/hp-seed-lexicon.mjs`, `scripts/send-basic-pitch.mjs`, `scripts/sync_supabase_questions.js`). Historiken kan inte "avpubliceras" utan att skriva om git-historik (`git filter-repo`/BFG) — det är sekundärt till rotation, eftersom en gammal nyckel i historiken är ofarlig så snart den är roterad.

### HIGH

Inga HIGH-fynd. (Om repot visar sig vara *publikt* på GitHub bör C-1 uppgraderas ytterligare i allvar av intryck, men klassificeringen CRITICAL täcker redan värsta scenariot oavsett synlighet.)

### MEDIUM

**M-1. Anon-nyckel duplicerad hårdkodat i 12 filer istället för central konfiguration**
- **Filer:** `index.html` (rad ~1158, ~1311), `app.html` (~807), `konto.html` (~413), `admin.html` (~264), `larare.html` (~272), `korkortet.html` (~1463), `förbättring.html` (~643), `pricing.html` (~494, ~547), `live-demo.html` (~12), `shared.js` (~1281), `scripts/insert_questions.py` (~6), `scripts/verify_korkortet.mjs` (~108)
- **Typ:** Supabase **anon**-nyckel (`role: anon`) — avsedd att vara klientsynlig, skyddas av RLS-policyer, inte hemlig i sig.
- **Maskerat värde:** `eyJhbG...REDACTED` (payload: `{"role":"anon", ...}`)
- **Risk:** MEDIUM — inte en läcka, men designmässigt en risk: 12 kopior av samma sträng gör det lätt att av misstag klistra in fel nyckel (t.ex. service_role) i en klientfil vid framtida copy-paste, vilket skulle vara en omedelbar CRITICAL-läcka. Ingen enskild källa att rotera från om Supabase-projektet någonsin byter ref.
- **Åtgärd:** Ingen brådskande rotation krävs (anon-nyckeln *ska* vara publik). Rekommenderas: konsolidera till en enda konstant (t.ex. i `shared.js`, importerad/inline-genererad till övriga sidor via byggsteg eller en delad `<script>`-referens) för att minska risken för framtida copy-paste-fel. Verifiera samtidigt att RLS-policyer på alla tabeller som anon kan nå (`driving_questions`, ev. `hp_questions` innan `97e109c`-fixen, etc.) faktiskt begränsar vad anon-rollen får läsa/skriva — se `supabase/migrations/20260701_hp_fixes.sql` som redan stänger en tidigare answer-key-läcka.

### LOW

**L-1. Referens till `.mcp.json` i genererad graphify-dokumentation**
- **Fil:** `graphify-out/obsidian/nonMcPack.md`
- **Typ:** Ej en hemlighet — bara en textträff på strängen "mcp" i en genererad graf-export. `.mcp.json` självt är inte git-trackat (korrekt, står i `.gitignore`).
- **Risk:** LOW / informational. Ingen åtgärd krävs.

---

## Frontend Exposure Analysis

Sajten är en statisk HTML/CSS/JS-sajt utan byggsteg (enligt `AGENTS.md`), så **allt** som refereras i `.html`/`.js`-filer i repo-roten skickas till webbläsaren per definition.

| Nyckeltyp | Client-exponerad? | Förväntat? | Kommentar |
|---|---|---|---|
| Supabase **anon** key (`role:anon`) | Ja, i 10 HTML/JS-filer | **Ja** — detta är den avsedda designen för Supabase. Säkerheten vilar på RLS-policyer, inte på hemlighållande av anon-nyckeln. | Se M-1 för konsolideringsrekommendation. |
| Supabase **service_role** key | Ja — i `scripts/fix_broken_image_urls.mjs`, ett Node-skript som körs lokalt/CI, **inte** laddat av någon `.html`-sida | **Nej, aldrig.** Skriptet körs inte i webbläsaren, så det är tekniskt sett inte "client-shipped" i produktionsbunten — men det ligger i klartext i det publika git-repot, vilket är funktionellt likvärdigt med en läcka. | Se C-1. |
| OpenAI API key | Nej — endast `process.env.OPENAI_API_KEY` i `api/*.js` (server-side Vercel-funktioner) | Korrekt | Inga träffar av `sk-`-mönster i klientfiler eller historik. |
| Stripe secret key / webhook secret | Nej — endast `process.env.STRIPE_SECRET_KEY` / `process.env.STRIPE_WEBHOOK_SECRET` i `api/create-checkout-session.js` och `api/stripe-webhook.js` | Korrekt | Inga `sk_live_`/`whsec_`-mönster hittade. |
| Resend API key | Nej — endast `process.env.RESEND_API_KEY` i `api/admin.js`, `api/stripe-webhook.js`, `scripts/send-basic-pitch.mjs`, `scripts/test-emails.mjs` | Korrekt | Inga `re_...`-mönster hittade. |
| OCR-providernyckel | `api/ocr.js` använder samma `OPENAI_API_KEY` (OpenAI vision) — ingen separat OCR-leverantörsnyckel hittad i repot. | Korrekt | Inget separat fynd. |

Grep-omfattning för denna sektion: samtliga rot-`.html`-filer (`index`, `app`, `konto`, `admin`, `larare`, `korkortet`, `förbättring`, `pricing`, `live-demo`, `provia-hp`, `integritetspolicy`) samt `shared.js`, `korkortet-srs.js`.

---

## .gitignore Assessment

Nuvarande `.gitignore` (repo-rot):
```
node_modules/
*.png
*.bak
.env
.env.local
.env*.local
*.log
.DS_Store
Thumbs.db
browser.js
screenshot.js
.mcp.json
supabase/.temp/
supabase/backups/*.json
.vercel
# Ruflo / claude-flow runtime
.claude/memory.db
.claude-flow/logs/
.claude-flow/sessions/
.claude-flow/data/
.swarm/
ruvector.db
*.rvf.lock
.env*
```

- **Täckning:** Korrekt. `.env`, `.env.local`, `.env*.local` samt en avslutande generell `.env*`-regel täcker praktiskt taget alla env-filvarianter (`.env.production`, `.env.staging`, etc.).
- **Historisk verifiering:** `git log --all --full-history -- '*.env*'` gav **inga träffar** — ingen `.env`-fil har någonsin varit committad i repots historik, så det finns ingen "lucka innan ignore-regeln lades till" att åtgärda.
- **`.mcp.json`** är korrekt ignorerad och aldrig trackad.
- **Observation:** `.gitignore` skyddar inte mot hårdkodning av hemligheter direkt i käll-/skriptfiler (vilket är exakt vad som hände i C-1) — det är ett separat problem som kräver pre-commit-secret-scanning (t.ex. `gitleaks` eller `trufflehog` i en pre-commit-hook eller CI-steg), inte en `.gitignore`-fix.
- **Rekommendation:** Lägg till ett automatiserat secret-scanning-steg (gitleaks/trufflehog) i CI eller som pre-commit-hook för att fånga framtida C-1-liknande incidenter innan de committas.

---

## Exakt lista över nycklar som människan måste rotera manuellt

| # | Nyckel/variabel | Var den används | Varför den måste roteras |
|---|---|---|---|
| 1 | **`SUPABASE_SERVICE_ROLE_KEY`** (Supabase service_role JWT för projekt `mnmotdluigzeehdjbhbu`) | Server-side: `api/_auth.js`, `api/admin.js`, `api/hp.js`, `api/stripe-webhook.js`, `scripts/add_questions_batch2.py`, `scripts/upload_new_questions.py`, `scripts/hp-seed-lexicon.mjs`, `scripts/send-basic-pitch.mjs`, `scripts/sync_supabase_questions.js` (alla via `process.env`, korrekt) — **plus hårdkodat i `scripts/fix_broken_image_urls.mjs` (C-1)** | Hårdkodad i klartext i git-historik + nuvarande HEAD, pushad till GitHub. Full DB-admin-åtkomst, kringgår RLS. Måste roteras i Supabase Dashboard (Project Settings → API → service_role) omedelbart, sedan uppdateras i Vercel env vars och i alla lokala `.env.local`-filer hos utvecklare som kör skripten. |
| 2 | `STRIPE_SECRET_KEY` | `api/create-checkout-session.js` | Ingen läcka hittad, men rotera som standardhygien om samma Supabase-incident indikerar att andra `.env.local`-kopior kan ha synkroniserats/delats osäkert (t.ex. via Slack/mail vid onboarding). Lägre prioritet — enbart förebyggande. |
| 3 | `STRIPE_WEBHOOK_SECRET` | `api/stripe-webhook.js` | Samma förebyggande skäl som #2. Ingen direkt läcka hittad. |
| 4 | `RESEND_API_KEY` | `api/admin.js`, `api/stripe-webhook.js`, `scripts/send-basic-pitch.mjs`, `scripts/test-emails.mjs` | Ingen läcka hittad. Förebyggande rotation valfri — lägst prioritet av samtliga. |
| 5 | `OPENAI_API_KEY` | `api/generate-exam.js`, `api/grade.js`, `api/explain.js`, `api/smart-tips.js`, `api/teacher-report.js`, `api/ocr.js`, `api/hp.js`, `api/check-role.js`, `scripts/hp-quality.mjs` | Ingen läcka hittad. Förebyggande rotation valfri. |

**Obligatorisk åtgärd:** Endast rad 1 (`SUPABASE_SERVICE_ROLE_KEY`) kräver *omedelbar* rotation baserat på faktiska fynd. Rader 2–5 listas som förebyggande best practice eftersom de delar samma `.env.local`-fil på utvecklarens maskin som den läckta nyckeln — om den filen någonsin kopierats osäkert tillsammans med skriptkörningen är det värt att rotera alla fyra samtidigt av försiktighetsskäl, men inget konkret fynd i denna granskning pekar på att de är exponerade.

**Efter rotation av `SUPABASE_SERVICE_ROLE_KEY`:**
1. Uppdatera värdet i Vercel → Project Settings → Environment Variables (alla miljöer: Production/Preview/Development).
2. Uppdatera lokala `.env.local`-filer.
3. Ta bort hårdkodningen i `scripts/fix_broken_image_urls.mjs` rad 11 och ersätt med `process.env.SUPABASE_SERVICE_ROLE_KEY` (skriptet är redan strukturerat för `--apply`-flagga, så mönstret från `scripts/hp-seed-lexicon.mjs` går att kopiera rakt av).
4. Överväg att skriva om git-historiken för att ta bort den gamla nyckeln helt (`git filter-repo --path scripts/fix_broken_image_urls.mjs --invert-paths` är destruktivt och bör göras separat, medvetet, med force-push-koordinering — inte en del av denna audit).

---

## Residual Risks

- **Historisk exponering kvarstår oavsett rotation.** Så snart den gamla service_role-nyckeln roteras blir strängen i git-historiken ofarlig (ogiltig), men den finns kvar synlig i `git log` för alla med repo-åtkomst tills historiken eventuellt skrivs om. Det är accepterat restrisk om rotation sker snabbt.
- **Repo-synlighet ej verifierad i denna audit.** Om `eltonrustaeus-bit/provia-ai` är ett *publikt* GitHub-repo (inte kontrollerat här, kräver `gh repo view` med rätt autentisering) har nyckeln varit exponerad för hela internet sedan 2026-06-09, inklusive för automatiserade secret-scanners (GitHub egen secret-scanning, om aktiverad, borde redan ha flaggat detta — värt att kontrollera Security-fliken på GitHub-repot).
- **Ingen secret-scanning i CI.** Utan gitleaks/trufflehog eller motsvarande pre-commit-hook kan samma misstag (hårdkodad nyckel i ett engångsskript) hända igen. Rekommenderas som uppföljning, ej implementerat i denna audit (read-only per uppdrag).
- **RLS-policyer ej fullständigt granskade.** Denna audit fokuserade på *var nycklar exponeras*, inte på att verifiera varje enskild RLS-policys korrekthet. `supabase/migrations/20260701_hp_fixes.sql` visar att minst en tidigare answer-key-läcka (via en för generös `authenticated`-policy) redan identifierats och åtgärdats av teamet tidigare — en fullständig RLS-genomgång av alla tabeller rekommenderas som separat uppföljning, särskilt av `driving_questions` som nås via anon-nyckeln.
- **`agents_log.md`, `audit_report.json`, `url_audit_result.json` och andra rapport-/loggfiler i repo-roten** granskades inte rad-för-rad i denna audit utöver mönstersökningarna ovan — de innehåller sannolikt ingen hemlig data (verktygsoutput/QA-rapporter), men flaggas här för fullständighetens skull om en djupare genomgång önskas.
