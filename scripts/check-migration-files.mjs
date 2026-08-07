// scripts/check-migration-files.mjs — offline-kontroller av supabase/migrations.
//
// Kör:  node scripts/check-migration-files.mjs      (exit 0 = OK)
//
// Vad detta INTE gör: det jämför inte mot databasen. `supabase_migrations.schema_migrations`
// ligger utanför det schema PostgREST exponerar, så ingen service_role-nyckel når den — den
// jämförelsen görs för hand via Supabase MCP och resultatet skrivs ner i
// supabase/migrations/README.md. Det här skriptet fångar den delen som ÄR maskinellt
// kontrollerbar, och som är det vanligaste sättet driften uppstår på: en migration som läggs
// till utan sin rollback, eller med ett filnamn som inte går att sortera.
//
// Bakgrund: 2026-08-07 visade en genomgång att repot och den körda databasen inte beskrev
// samma sak i någondera riktningen. Två migrationer hade körts utan att någon fil lades i
// repot, och fyra filer i repot saknades i ledgern trots att deras effekt fanns i schemat.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

// Migrationer från innan parkonventionen infördes. De körs inte om och får inga rollbacks
// i efterhand — en rollback som aldrig testats är farligare än ingen alls, eftersom den ser
// ut att gå att lita på. Listan är stängd: nya namn hör inte hemma här.
const UTAN_ROLLBACK_AV_HISTORISKA_SKAL = new Set([
  "20260603_add_mock_exam_quota",
  "20260620_per_structured_memory",
  "20260627_teacher_dashboard",
  "20260630_hp_schema",
  "20260701_hp_fixes",
]);

const NAMNMONSTER = /^\d{8}_[a-z0-9_]+$/;

let fel = 0;
const klagomal = (rad) => { fel++; console.error(`  FEL   ${rad}`); };

const filer = readdirSync(dir).filter((f) => f.endsWith(".sql"));
const migrationer = filer
  .filter((f) => !f.endsWith("_ROLLBACK.sql"))
  .map((f) => f.replace(/\.sql$/, ""));
const rollbacks = new Set(
  filer.filter((f) => f.endsWith("_ROLLBACK.sql")).map((f) => f.replace(/_ROLLBACK\.sql$/, ""))
);

for (const namn of migrationer) {
  if (!NAMNMONSTER.test(namn)) {
    klagomal(`${namn}.sql — namnet ska vara ÅÅÅÅMMDD_snake_case`);
  }
  if (!rollbacks.has(namn) && !UTAN_ROLLBACK_AV_HISTORISKA_SKAL.has(namn)) {
    klagomal(`${namn}.sql saknar ${namn}_ROLLBACK.sql`);
  }
}

// En rollback utan sin migration är antingen en felstavning eller en halvt borttagen
// migration. Båda gör att nästa person tror att något går att backa som inte finns.
const migrationsSet = new Set(migrationer);
for (const namn of rollbacks) {
  if (!migrationsSet.has(namn)) klagomal(`${namn}_ROLLBACK.sql saknar sin ${namn}.sql`);
}

// Ingen kontroll av att datumprefixen är unika. Det prövades och slog mot
// 20260719_fix_hp_mastery_race och 20260719_stripe_webhook_idempotency, som skrevs samma dag
// och är oberoende av varandra — den ena rör hp_mastery, den andra skapar en egen tabell.
// Att det är oberoende går inte att avgöra ur filnamnen, och att döpa om redan körda
// migrationer för att blidka en kontroll är sämre än att låta bli.

// Namn som står kvar i undantagslistan men vars fil är borta betyder att listan har
// ruttnat. Den ska krympa när gamla migrationer städas, aldrig växa av sig själv.
for (const namn of UTAN_ROLLBACK_AV_HISTORISKA_SKAL) {
  if (!migrationsSet.has(namn)) klagomal(`${namn} står i undantagslistan men filen finns inte längre`);
}

if (fel) {
  console.error(`\n${fel} problem i supabase/migrations.`);
  process.exit(1);
}
console.log(`Alla kontroller klara — ${migrationer.length} migrationer, ${rollbacks.size} rollbacks.`);
