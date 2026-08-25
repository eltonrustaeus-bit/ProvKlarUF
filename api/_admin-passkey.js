// api/_admin-passkey.js — Face ID och Touch ID för per.html.
//
// Flödena arbetar mot ett `store`-gränssnitt, inte mot Supabase direkt. Därför
// går hela kedjan — inklusive att en utmaning bara får användas en gång — att
// köra i test mot ett minneslager och en riktig virtuell autentiserare.
//
// EN PASSKEY AUTENTISERAR EN ENHET, INTE EN BEHÖRIGHET.
// requireAdmin i api/admin.js avgör vem som får läsa. Det här lagret avgör
// bara om begäran kommer från en enhet Elton registrerat, vars ägare nyss
// identifierat sig biometriskt. Ordningen är inte utbytbar.
//
// UTMANINGEN RADERAS FÖRE VERIFIERINGEN, och det är inte en detalj: Apples
// passkeys rapporterar alltid signaturräknare 0, så räknaren kan inte upptäcka
// en återspelad signatur. Engångsutmaningen är det enda som gör det.

import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { SITE_ORIGIN, BRAND_NAME } from "./_site.js";

/** Två minuter. Längre ger en angripare mer tid; kortare hinner inte en
    användare som får leta efter sin telefon. */
export const CHALLENGE_TTL_S = 120;

/* Passkeys är bundna till sin rpID. En som registrerats på exgen.se fungerar
   inte på en Vercel-preview och inte på localhost — därför egna
   miljövariabler, så att previews och tester kan köra mot sin egen origin utan
   att röra produktionens. */
export function rpConfig() {
  const origin = process.env.PASSKEY_ORIGIN || SITE_ORIGIN;
  const rpID = process.env.PASSKEY_RP_ID || new URL(origin).hostname;
  return { rpID, origin, rpName: BRAND_NAME };
}

export function supabaseStore(supabase) {
  return {
    async saveChallenge(userId, kind, challenge, expiresAt) {
      await supabase.from("admin_passkey_challenges").delete().lt("expires_at", new Date().toISOString());
      await supabase.from("admin_passkey_challenges")
        .insert({ user_id: userId, kind, challenge, expires_at: expiresAt });
    },
    async takeChallenge(userId, kind) {
      const { data } = await supabase.from("admin_passkey_challenges")
        .select("id, challenge, expires_at")
        .eq("user_id", userId).eq("kind", kind)
        .order("expires_at", { ascending: false }).limit(1);
      const rad = data?.[0];
      if (!rad) return null;
      // Radera FÖRE verifieringen. Se filhuvudet.
      await supabase.from("admin_passkey_challenges").delete().eq("id", rad.id);
      if (Date.parse(rad.expires_at) <= Date.now()) return null;
      return rad.challenge;
    },
    async listCredentials(userId) {
      const { data } = await supabase.from("admin_passkeys")
        .select("credential_id, public_key, counter, transports, label, created_at, last_used_at")
        .eq("user_id", userId).order("created_at", { ascending: true });
      return data || [];
    },
    async saveCredential(rad) {
      await supabase.from("admin_passkeys").insert(rad);
    },
    async touchCredential(userId, credentialId, counter) {
      await supabase.from("admin_passkeys")
        .update({ counter, last_used_at: new Date().toISOString() })
        .eq("user_id", userId).eq("credential_id", credentialId);
    },
    async deleteCredential(userId, credentialId) {
      await supabase.from("admin_passkeys").delete()
        .eq("user_id", userId).eq("credential_id", credentialId);
    },
  };
}

const utgång = () => new Date(Date.now() + CHALLENGE_TTL_S * 1000).toISOString();

export async function beginRegistration(store, userId, userName) {
  const { rpID, rpName } = rpConfig();
  const befintliga = await store.listCredentials(userId);
  const options = await generateRegistrationOptions({
    rpName, rpID,
    userName: userName || "admin",
    // Hindrar att samma enhet registreras två gånger och lämnar en död rad.
    excludeCredentials: befintliga.map(c => ({ id: c.credential_id })),
    authenticatorSelection: {
      // Face ID och Touch ID sitter i enheten, inte i en nyckelbricka.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      // Biometrin är hela poängen. "preferred" hade tillåtit en enhet som
      // bara bevisar närvaro, och då är låset ett knapptryck.
      userVerification: "required",
    },
  });
  await store.saveChallenge(userId, "register", options.challenge, utgång());
  return options;
}

export async function finishRegistration(store, userId, response, label) {
  const { rpID, origin } = rpConfig();
  const challenge = await store.takeChallenge(userId, "register");
  if (!challenge) return { verified: false, error: "utmaningen saknas eller har gått ut" };

  let res;
  try {
    res = await verifyRegistrationResponse({
      response, expectedChallenge: challenge,
      expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    // Biblioteket kastar på trasiga svar. Ett kast får aldrig bli en 500 som
    // ser ut som ett serverfel när det egentligen är ett avvisat försök.
    return { verified: false, error: "svaret gick inte att tolka" };
  }
  if (!res.verified) return { verified: false, error: "signaturen godtogs inte" };

  const c = res.registrationInfo.credential;
  await store.saveCredential({
    user_id: userId,
    credential_id: c.id,
    // base64url-text, inte bytea: PostgREST lämnar bytea som \x-hex och den
    // konverteringen är ett extra felläge utan vinst.
    public_key: Buffer.from(c.publicKey).toString("base64url"),
    counter: c.counter,
    transports: c.transports || null,
    label: String(label || "").slice(0, 60) || "Okänd enhet",
  });
  return { verified: true };
}

export async function beginAuthentication(store, userId) {
  const { rpID } = rpConfig();
  const kända = await store.listCredentials(userId);
  if (!kända.length) return { error: "ingen enhet registrerad" };
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: kända.map(c => ({ id: c.credential_id, transports: c.transports || undefined })),
    userVerification: "required",
  });
  await store.saveChallenge(userId, "auth", options.challenge, utgång());
  return options;
}

export async function finishAuthentication(store, userId, response) {
  const { rpID, origin } = rpConfig();
  const challenge = await store.takeChallenge(userId, "auth");
  if (!challenge) return { verified: false, error: "utmaningen saknas eller har gått ut" };

  const kända = await store.listCredentials(userId);
  const rad = kända.find(c => c.credential_id === response?.id);
  if (!rad) return { verified: false, error: "okänd enhet" };

  let res;
  try {
    res = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge,
      expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: rad.credential_id,
        publicKey: Buffer.from(rad.public_key, "base64url"),
        counter: rad.counter,
        transports: rad.transports || undefined,
      },
    });
  } catch (e) {
    return { verified: false, error: "svaret gick inte att tolka" };
  }
  if (!res.verified) return { verified: false, error: "signaturen godtogs inte" };

  await store.touchCredential(userId, rad.credential_id, res.authenticationInfo.newCounter);
  return { verified: true };
}
