// api/_per-pulse.js — rena funktioner som gör rader till summor.
//
// Ingen databas, inget nätverk, inga projektberoenden. Frågorna bor i
// api/admin.js; det här är bara matematiken, och den går därför att testa
// utan att något behöver mockas.
//
// VARFÖR TOO_FEW FINNS
// Produktionen har ett fåtal konton. Flera mätvärden saknar underlag från dag
// ett, och en nolla som ser ut som ett mätvärde är då sämre än ingen siffra
// alls — den skulle få läsaren att tro att cachen aldrig träffar när sanningen
// är att den aldrig fått chansen.

export const TOO_FEW = "för få elever än";

/** Under så här många sonderingar är en träffkvot brus, inte en mätning. */
export const MIN_PROBES = 20;

/** Samma 90 dygn som MEMORY_TTL_DAYS i api/_per-memory.js. */
export const MEMORY_TTL_DAYS = 90;

const TRÄFFAR = ["hit_exact", "hit_vector"];
const BESLUT = ["hit_exact", "hit_vector", "near_miss", "miss", "blocked"];

export function summariseMemories(rows = [], now = Date.now()) {
  let färska = 0;
  for (const r of rows) {
    const t = Date.parse(r?.updated_at ?? "");
    // Ett oläsbart datum räknas som gammalt: hellre rapportera gallringsbart
    // än att påstå att ett minne är färskt utan att veta.
    const ålderDagar = Number.isFinite(t) ? (now - t) / 86_400_000 : Infinity;
    if (ålderDagar <= MEMORY_TTL_DAYS) färska++;
  }
  return { totalt: rows.length, färska, gamla: rows.length - färska };
}

export function summariseProbes(rows = []) {
  const per = Object.fromEntries(BESLUT.map(d => [d, 0]));
  for (const r of rows) if (Object.hasOwn(per, r?.decision)) per[r.decision]++;
  const totalt = rows.length;
  const träffar = TRÄFFAR.reduce((s, d) => s + per[d], 0);
  const träffkvot = totalt < MIN_PROBES ? TOO_FEW : Math.round((träffar / totalt) * 100);
  return { totalt, per, träffkvot };
}

export function summariseCache(rows = [], now = Date.now()) {
  const ut = { pending: 0, approved: 0, rejected: 0, utgångna: 0 };
  for (const r of rows) {
    if (Object.hasOwn(ut, r?.status) && r.status !== "utgångna") ut[r.status]++;
    const t = Date.parse(r?.expires_at ?? "");
    if (Number.isFinite(t) && t <= now) ut.utgångna++;
  }
  return ut;
}

export function summariseQuota(rows = []) {
  const per = new Map();
  for (const r of rows) {
    const f = String(r?.feature ?? "").trim();
    if (!f) continue;
    per.set(f, (per.get(f) || 0) + (Number(r?.used) || 0));
  }
  return [...per.entries()]
    .map(([funktion, använt]) => ({ funktion, använt }))
    .sort((a, b) => b.använt - a.använt);
}

export function summariseConcepts(rows = []) {
  // Vyn concept_collective_stats bär k-anonymiteten själv: minst fem distinkta
  // elever per begreppsrad, minst tre per felkod. En tom svarsmängd betyder
  // att tröskeln inte nåtts — inte att alla kan allt.
  if (!rows.length) return TOO_FEW;
  return rows
    .map(r => ({
      namn: String(r?.concept_name ?? "okänt begrepp"),
      medelpoäng: Number(r?.mean_score ?? 0),
      elever: Number(r?.student_count ?? 0),
      felkoder: Array.isArray(r?.common_error_codes) ? r.common_error_codes : [],
    }))
    .sort((a, b) => a.medelpoäng - b.medelpoäng);
}
