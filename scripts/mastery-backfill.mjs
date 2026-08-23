#!/usr/bin/env node
/* scripts/mastery-backfill.mjs — bygger kunskapsprofilen ur prov som redan gjorts.
 *
 * api/grade.js började skriva user_profiles.mastery via apply_mock_mastery()
 * först 2026-08-23 (#91). Proven före det rättades, taggades med concept_tag och
 * error_tags — och kastade evidensen i en platt lista. Data finns alltså, den
 * har bara aldrig blivit kunskap.
 *
 * Skriptet läser user_exams.result.per_question i KRONOLOGISK ordning och kör
 * varje fråga genom samma RPC som rättningen använder. Ordningen är inte en
 * detalj: vikten i apply_mock_mastery sjunker med antalet försök, så samma svar
 * i fel ordning ger fel siffra.
 *
 * Kör:
 *   node scripts/mastery-backfill.mjs --dry-run     visar vad som skulle hända
 *   node scripts/mastery-backfill.mjs               skriver
 *   node scripts/mastery-backfill.mjs --user <uuid> bara en användare
 *
 * Städning av gamla nycklar (--clean-legacy) är AVSTÄNGD som default. De gamla
 * raderna är rena tal utan antal försök, skrivna av den klientkod som togs bort
 * i #91. De räknas som obelagda och kan inte påverka vad P.E.R. påstår, så de är
 * ofarliga att låta ligga — men de skräpar i "Vad P.E.R. vet om mig".
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { conceptKey, conceptLabel } from "../api/_concept-tags.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env.prod"]) {
  try {
    for (const line of readFileSync(join(root, f), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* fil valfri */ }
}

const dryRun = process.argv.includes("--dry-run");
const cleanLegacy = process.argv.includes("--clean-legacy");
const onlyUser = (() => {
  const i = process.argv.indexOf("--user");
  return i > -1 ? process.argv[i + 1] : null;
})();

for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) { console.error(`Saknar ${key} (.env.local). Avbryter.`); process.exit(1); }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Samma tabell som api/grade.js. En andra kopia hade kunnat driva isär.
const LEVEL_DIFFICULTY = { E: 0.3, C: 0.55, A: 0.8 };

let q = supabase
  .from("user_exams")
  .select("id, user_id, course, level, result, created_at")
  .order("created_at", { ascending: true });
if (onlyUser) q = q.eq("user_id", onlyUser);

const { data: exams, error } = await q;
if (error) { console.error("Kunde inte läsa user_exams:", error.message); process.exit(1); }

console.log(`${exams.length} prov att gå igenom${onlyUser ? ` (användare ${onlyUser})` : ""}.\n`);

/* Ett prov i taget, i tidsordning. Inom ETT prov slås frågor om samma begrepp
   ihop till ett medelvärde — precis som applyMockMastery i api/grade.js gör.
   Två frågor om fullmakt i samma prov är ett tillfälle att mäta fullmakt. */
const perUser = new Map();
let skippade = 0, tomma = 0;

for (const exam of exams) {
  const per = exam.result?.per_question;
  if (!Array.isArray(per) || !per.length) { skippade++; continue; }

  const difficulty = LEVEL_DIFFICULTY[String(exam.level || "").toUpperCase()] ?? 0.55;
  const grupper = new Map();

  for (const item of per) {
    const key = conceptKey(item?.concept_tag);
    if (!key) { tomma++; continue; }
    const maxP = Number(item?.max_points) || 0;
    const ratio = maxP > 0 ? Math.min(1, Math.max(0, Number(item?.points || 0) / maxP)) : 0;
    const e = grupper.get(key) || { label: conceptLabel(item.concept_tag), sum: 0, n: 0 };
    e.sum += ratio; e.n += 1;
    grupper.set(key, e);
  }
  if (!grupper.size) continue;

  if (!perUser.has(exam.user_id)) perUser.set(exam.user_id, []);
  for (const [key, e] of grupper) {
    perUser.get(exam.user_id).push({
      key, label: e.label, ratio: e.sum / e.n, difficulty,
      datum: String(exam.created_at).slice(0, 10), course: exam.course,
    });
  }
}

console.log(`Frågor utan användbar begreppstagg: ${tomma}`);
console.log(`Prov utan rättning: ${skippade}\n`);

for (const [userId, poster] of perUser) {
  console.log(`── ${userId}`);
  console.log(`   ${poster.length} mätpunkter över ${new Set(poster.map(p => p.datum)).size} dagar`);

  const räknare = new Map();
  for (const p of poster) räknare.set(p.key, (räknare.get(p.key) || 0) + 1);
  const belagda = [...räknare.entries()].filter(([, n]) => n >= 3);
  console.log(`   ${räknare.size} begrepp, varav ${belagda.length} når tre försök och blir belagda`);
  if (belagda.length) {
    console.log(`   belagda: ${belagda.map(([k, n]) => `${k} (${n})`).join(", ")}`);
  }

  /* Vad normaliseringen är värd, mätt på just den här användarens data.
     Utan den blir varje stavningsvariant ett eget begrepp med för få försök —
     och ett begrepp under tröskeln kan P.E.R. inte säga något om alls. */
  const råa = new Map();
  for (const p of poster) råa.set(p.label, (råa.get(p.label) || 0) + 1);
  const belagdaUtan = [...råa.values()].filter(n => n >= 3).length;
  if (belagdaUtan !== belagda.length) {
    console.log(`   utan normalisering: ${råa.size} begrepp, varav ${belagdaUtan} belagda`);
  }

  if (dryRun) { console.log(); continue; }

  /* Skriptet är INTE idempotent av sig självt: apply_mock_mastery räknar upp
     attempts vid varje anrop, så en andra körning skulle dubbla varje försök och
     göra siffrorna fel åt båda hållen. Skyddet är en enkel närvarokontroll —
     har användaren redan någon nyckel i ny form (objekt med attempts) har
     backfillen eller den skarpa rättningen redan varit här. */
  const { data: befintlig } = await supabase
    .from("user_profiles").select("mastery").eq("id", userId).maybeSingle();
  const harNyForm = Object.values(befintlig?.mastery || {})
    .some(v => v && typeof v === "object" && "attempts" in v);
  if (harNyForm && !process.argv.includes("--force")) {
    console.log("   HOPPAS ÖVER — har redan mastery i ny form. Kör med --force för att skriva ändå.\n");
    continue;
  }

  let skrivna = 0, fel = 0;
  for (const p of poster) {
    const { error: rpcErr } = await supabase.rpc("apply_mock_mastery", {
      p_user_id: userId, p_concept: p.key, p_label: p.label,
      p_ratio: p.ratio, p_difficulty: p.difficulty,
    });
    if (rpcErr) { fel++; if (fel <= 3) console.error(`   FEL ${p.key}: ${rpcErr.message}`); }
    else skrivna++;
  }
  console.log(`   skrev ${skrivna} mätpunkter${fel ? `, ${fel} fel` : ""}`);

  if (cleanLegacy) {
    /* Gamla rader är rena tal utan antal försök, skrivna av klientkoden som
       togs bort i #91. De är obelagda och kan inte påverka vad P.E.R. påstår —
       men de skräpar i "Vad P.E.R. vet om mig". */
    const { data: up } = await supabase
      .from("user_profiles").select("mastery").eq("id", userId).maybeSingle();
    const m = up?.mastery || {};
    const kvar = {};
    let borttagna = 0;
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === "number") { borttagna++; continue; }
      kvar[k] = v;
    }
    if (borttagna) {
      const { error: delErr } = await supabase
        .from("user_profiles").update({ mastery: kvar }).eq("id", userId);
      console.log(delErr ? `   kunde inte städa: ${delErr.message}` : `   städade bort ${borttagna} gamla nycklar`);
    }
  }
  console.log();
}

console.log(dryRun ? "Torrkörning — ingenting skrevs." : "Klart.");
