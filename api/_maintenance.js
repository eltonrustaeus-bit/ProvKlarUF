// api/_maintenance.js — enda källan för om sajten är stängd för allmänheten.
//
// När MAINTENANCE.enabled är true svarar /api/check-role på action
// "maintenance_gate" med allow:true bara för roller i ALLOWED_ROLES. Alla andra
// — utloggade, gratis, basic, premium — skickas till /snart.html av
// js/site-gate.js innan sidan hinner målas.
//
// ── ÖPPNA SAJTEN IGEN ────────────────────────────────────────────────────────
// Sätt enabled till false och deploya. Det är hela ingreppet; ingen annan fil
// behöver röras och ingen data påverkas.
//
// ── SLÄPPA IN FLER ───────────────────────────────────────────────────────────
// Lägg till rollen i ALLOWED_ROLES. Till exempel "premium" om de som redan
// betalar ska kunna fortsätta använda produkten under ombyggnaden.
//
// Kontroll sker på servern mot profiles.role, inte mot något klienten kan
// hitta på. Men var ärlig om vad det här är: en grind för besökare, inte ett
// säkerhetsskydd. Sidornas HTML och JS är fortfarande publika filer, och den
// som redan har ett konto kan nå API:erna direkt. Lägg aldrig något bakom den
// här flaggan som inte tål att ses.
export const MAINTENANCE = Object.freeze({
  // Av sedan 2026-08-19. Grinden byggdes 2026-08-01 för ombyggnaden av
  // provskaparen, förbättringssidan, startsidan och inloggningen. Den är
  // klar, och en stängd sajt kan inte indexeras av Google — Googlebot är
  // en utloggad besökare och skickades till /snart.html, som bär noindex.
  // Sätt tillbaka till true för att stänga igen; inget annat behöver röras.
  enabled: false,
  // premium finns med för att de som redan har betalat inte ska mötas av en
  // stängd dörr under ombyggnaden. Ta bort den om sajten ska vara helt privat.
  allowedRoles: Object.freeze(["admin", "premium"]),
});

export function maintenanceAllows(role) {
  if (!MAINTENANCE.enabled) return true;
  return MAINTENANCE.allowedRoles.includes(String(role || ""));
}
