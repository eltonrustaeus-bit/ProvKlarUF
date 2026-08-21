// api/_per-cache-guard.js — avgör vad som ALDRIG får hamna i svarscachen.
//
// Egen modul, inte PRIVATE_OR_SECRET_REGEX från _per-memory.js. Den regexen är skriven för
// minnessammanfattningar och fångar varken svenskt personnummer eller svenska injektionsfraser
// (Codex CR-CACHE-006). Cachen har dessutom en strängare uppgift: det som passerar här lagras
// i klartext och kan serveras till någon annan.
//
// Ren funktion — ingen I/O, inga beroenden, testbar utan databas och nätverk.

export const MAX_CACHEABLE_CHARS = 500;

const BLOCK_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,                       // e-post
  /\b\d{6}[-+]\d{4}\b|\b(?:19|20)?\d{6}\d{4}\b/,                  // svenskt personnummer
  /\b(api[ _-]?key|secret|token|password|lösenord|bearer)\b/i,     // hemligheter
  /\b(ignore (?:previous|all)|system prompt|developer message)\b/i, // engelsk injektion
  /(strunta i|bortse från|låtsas att|agera som om|visa din systemprompt|glöm (?:dina|alla) (?:regler|instruktioner))/i,
];

// Telefonnummer separat: ett enkelt teckenintervall matchar även datum som "2026-08-21".
// Kravet är minst nio SIFFROR i samma löpa — datumet har åtta.
function looksLikePhone(text) {
  const runs = text.match(/\+?[\d\s().-]{9,}/g) || [];
  return runs.some(run => run.replace(/\D/g, "").length >= 9);
}

/**
 * @param {string} text frågetexten som övervägs för cachning
 * @returns {boolean} true = får lagras och slås upp mot cachen
 */
export function cacheAllowed(text) {
  const s = String(text ?? "");
  if (!s.trim()) return false;
  if (s.length > MAX_CACHEABLE_CHARS) return false;
  if (looksLikePhone(s)) return false;
  return !BLOCK_PATTERNS.some(re => re.test(s));
}
