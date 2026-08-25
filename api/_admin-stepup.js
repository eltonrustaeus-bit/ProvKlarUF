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

import { createHmac, timingSafeEqual } from "node:crypto";

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
