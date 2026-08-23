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
| `api/_per-core.js` | **PER Core Engine** — callAI + personality (ESM, importeras av explain/teacher-report) |
| `api/generate-exam.js` | OpenAI call — rate-limit enforced (CJS) |
| `api/grade.js` | OpenAI call — validates user owns exam (CJS) |
| `api/explain.js` | P.E.R chat + körkortsförklaring + felbankstips — quota enforced (ESM) |
| `api/check-role.js` | Returns user role — never trust client-side role. Bär även delete-exams och Stripe-portalen |
| `api/signup.js` | Creates user row — validate all inputs |
| `api/admin.js` | Admin-only — verify role server-side. `body.action`-dispatch (list-users, set-role, approve, …) |
| `api/ocr.js` | File upload — sanitize paths |
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
