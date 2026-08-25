// api/_admin-stepup.js — beviset på att någon nyss klarat Face ID eller Touch ID.
//
// Ren HMAC, ingen I/O, inget beroende. Token säger inte VEM någon är — det
// avgör requireAdmin i api/admin.js — utan bara att step-up skett nyligen och
// att den skett för just den användaren.
//
// FORMAT:  `${utgångstid_ms}.${base64url(HMAC-SHA256(hemlighet, "uid.utgång"))}`
//
// Användar-id:t signeras men skrivs inte ut. Verifieringen räknar om
// signaturen med den ANROPANDE användarens id, så en token som myntats för en
// annan användare kan inte stämma.
//
// FAIL CLOSED: utan PASSKEY_STEPUP_SECRET myntas ingen token och ingen
// godtas. En standardhemlighet hade gjort låset till en dekoration som ser ut
// att fungera.

import { createHmac, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";

/** 30 minuter. Längre gör step-up meningslöst, kortare gör sidan olidlig. */
export const STEPUP_TTL_S = 1800;

export function stepUpSecret() {
  return process.env.PASSKEY_STEPUP_SECRET || "";
}

function signera(userId, expMs, secret) {
  return createHmac("sha256", secret).update(`${userId}.${expMs}`).digest("base64url");
}

export function mintStepUp(userId, { secret = stepUpSecret(), now = Date.now() } = {}) {
  if (!secret) throw new Error("PASSKEY_STEPUP_SECRET saknas");
  if (!userId) throw new Error("userId saknas");
  const expMs = now + STEPUP_TTL_S * 1000;
  return `${expMs}.${signera(userId, expMs, secret)}`;
}

export function verifyStepUp(token, userId, { secret = stepUpSecret(), now = Date.now() } = {}) {
  if (!secret || !userId || typeof token !== "string") return false;

  const delar = token.split(".");
  if (delar.length !== 2) return false;

  const expMs = Number(delar[0]);
  if (!Number.isFinite(expMs) || expMs <= now) return false;

  const förväntad = Buffer.from(signera(userId, delar[0], secret), "utf8");
  const given = Buffer.from(delar[1], "utf8");
  // timingSafeEqual kastar på olika längd, så längden måste kollas först —
  // och den kollen läcker bara signaturens längd, som är konstant.
  if (förväntad.length !== given.length) return false;
  return timingSafeEqual(förväntad, given);
}

/* ── ÄGAREN ──────────────────────────────────────────────────────────────────
 *
 * Sidan är inte "för administratörer" utan för EN person. requireAdmin räcker
 * därför inte: en framtida admin, tillagd för något helt annat, hade annars
 * fått läsa P.E.R:s minne.
 *
 * FAIL CLOSED. Är PER_OWNER_USER_ID osatt äger ingen sidan och varje anrop
 * nekas. Ett tomt värde får aldrig betyda "alla".
 */
export function ownerUserId() {
  return (process.env.PER_OWNER_USER_ID || "").trim();
}

export function isOwner(user) {
  const ägare = ownerUserId();
  return !!ägare && !!user?.id && user.id === ägare;
}

/* ── ÅTERSTÄLLNINGSKOD ───────────────────────────────────────────────────────
 *
 * Registrering av en ny enhet kräver en redan upplåst session. Det betyder att
 * två borttappade enheter annars hade krävt att någon gick in i databasen för
 * hand. Koden är den vägen tillbaka.
 *
 * 32 slumpbytes, grupperade i läsbara block. Lagras som scrypt-hash med eget
 * salt — en läsning av tabellen ger ingen väg in, och koden kan aldrig hämtas
 * igen av någon efter att den visats.
 */
const KOD_BYTES = 32;
const SCRYPT_LEN = 64;

export function generateRecoveryCode() {
  // Crockford-liknande alfabet: inga I, L, O eller U, så koden går att läsa
  // upp och skriva av utan att förväxla 0/O eller 1/I.
  const ALFA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = randomBytes(KOD_BYTES);
  let ut = "";
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && i % 4 === 0) ut += "-";
    ut += ALFA[bytes[i] % ALFA.length];
  }
  return ut;
}

export function hashRecoveryCode(code, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(String(code).trim().toUpperCase(), salt, SCRYPT_LEN).toString("hex");
  return { hash, salt };
}

export function verifyRecoveryCode(code, hash, salt) {
  if (!code || !hash || !salt) return false;
  const given = Buffer.from(hashRecoveryCode(code, salt).hash, "hex");
  const känd = Buffer.from(hash, "hex");
  if (given.length !== känd.length) return false;
  return timingSafeEqual(given, känd);
}
