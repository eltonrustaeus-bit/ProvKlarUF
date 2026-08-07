# supabase/migrations

Katalogen ska beskriva den databas som faktiskt körs. Den gjorde inte det den 2026-08-07, och
den här filen är resultatet av genomgången samt receptet för att kontrollera det igen.

## Två register, inte ett

| Register | Vad det är | Hur du läser det |
|---|---|---|
| Filerna här | vad vi *tror* har körts | `ls supabase/migrations` |
| `supabase_migrations.schema_migrations` | vad Supabase *har registrerat* | SQL mot produktionsdatabasen |
| Schemat självt | vad som faktiskt gäller | `information_schema`, `pg_proc`, `pg_constraint` |

De tre kan glida isär oberoende av varandra, och gjorde det. Ledgern förs bara när en
migration körs via Supabase CLI eller MCP:ns `apply_migration`. Körs SQL:en direkt i
Supabase SQL Editor tar ändringen effekt utan att någonsin synas i ledgern.

**Skriv aldrig om en constraint eller funktion utifrån filen i repot.** Läs den ur databasen
först. Den 2026-08-07 höll `generation_jobs_job_type_check` i produktion tre värden medan
migrationsfilen i `main` bara kände till ett — en omskrivning utifrån filen hade tyst tagit
bort `per_assessment` och `per_coach`.

## Läget efter genomgången 2026-08-07

**Ingen migration i repot är oapplicerad.** Fyra filer saknades i ledgern trots att de körts;
det verifierades mot schemat i stället för mot ledgern:

| Fil | Bevis på att den är körd |
|---|---|
| `20260603_add_mock_exam_quota` | `profiles.mock_quota_count` + `mock_quota_period` finns, `consume_mock_exam_quota()` finns |
| `20260701_hp_fixes` | registrerad som `hp_fixes_20260701` — bara ett annat namn |
| `20260705_hp_v2` | registrerad som `hp_v2_lexicon_validation_trgm` — bara ett annat namn |
| `20260724_knowledge_engine_corpus_correction` | 20 av 20 chunks har `review_status='approved'`, och båda de innehållskorrigerade är `lagtext_verbatim` med `verbatim_confirmed: true` |

**Två migrationer var körda utan fil i repot.** Båda är tillagda nu:

- `20260727_per_learner_loop.sql` — körd 2026-07-28, filen fanns bara på grenen
  `feat/per-learner-loop` (PR #12, fortfarande öppen). Filen är hämtad ordagrant därifrån, inte
  omskriven. **Koden som använder tabellerna är alltså fortfarande omergad** — `student_attempts`
  och `student_recommendations` ligger i produktion och tar emot ingenting. Schemat är en
  övermängd av koden, vilket är den ofarliga riktningen, men PR #12 bör mergas eller stängas.
- `20260801_add_welcome_sent_at_to_profiles.sql` — körd 2026-08-01, hade ingen fil någonstans.
  Rekonstruerad ur `information_schema.columns`, inte gissad, och skriven med `if not exists`
  så den är en no-op mot den databas som redan har kolumnen.

**Nio migrationer från maj–juni finns i ledgern men har ingen fil**, och får ingen i efterhand:

```
add_stripe_columns_to_profiles          create_per_sessions
add_korkortet_quota_and_stripe_columns  create_per_long_memory
create_driving_progress                 add_image_workflow_columns
create_mock_results                     atomic_quota_and_anon_rate_limit
revoke_quota_rpc_from_public
```

De skrevs innan konventionen fanns. Att rekonstruera DDL ur ett schema flera månader senare ger
en fil som *ser* auktoritativ ut utan att vara verifierad mot vad som faktiskt kördes, och det
är sämre än att inte ha någon fil. **För dessa är databasen källan.** Ett fullständigt
schemautdrag hör hemma i en `pg_dump`-baserad baslinje om en sådan någonsin behövs, inte i
handskrivna migrationer.

## Konvention

- Filnamn: `ÅÅÅÅMMDD_snake_case.sql`
- Varje migration har en `_ROLLBACK.sql` bredvid sig. Undantagen är fem migrationer från innan
  konventionen infördes; de står uppräknade i `scripts/check-migration-files.mjs` och listan
  ska aldrig växa.
- Historiska migrationer skrivs inte om. En rättelse blir en ny fil.
- Kör migrationer via Supabase MCP `apply_migration` eller CLI, **inte** via SQL Editor — annars
  hamnar de inte i ledgern och nästa genomgång får leta i schemat i stället.

## Kontrollera drift

Filkontrollerna är maskinella och ingår i testsviten:

```bash
node scripts/check-migration-files.mjs
```

Jämförelsen mot ledgern går inte att skripta: `supabase_migrations` ligger utanför det schema
PostgREST exponerar, så ingen service_role-nyckel når den. Den görs för hand via Supabase MCP:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

Jämför namnen mot filerna här. Slår något ut, avgör vilket register som har fel genom att titta
på **schemat**, inte på det andra registret.
