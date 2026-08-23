// api/_flags.js — en enda definition av vad "flaggan är på" betyder.
//
// Grinden låg tidigare som en privat funktion i api/knowledge.js. När
// check-role.js och explain.js också behövde den fanns två vägar framåt:
// kopiera logiken, eller flytta hit. En kopia av en säkerhetsgrind driver
// isär — den ena får en rättning, den andra inte — och det är just den här
// grinden som avgör om en oprövad funktion når riktiga elever.
//
// Regeln, oförändrad från knowledge.js: enabled måste vara true, OCH
// allowed_user_ids måste antingen vara tom (gäller alla) eller innehålla
// användaren. Ett fel vid läsningen betyder AV, aldrig på.

/**
 * @param supabase  service_role-klient
 * @param keys      alla flaggor som måste vara på samtidigt
 * @param userId    null = anonym; en ifylld allowed_user_ids stänger då grinden
 */
export async function flagsEnabled(supabase, keys, userId = null) {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("key, enabled, allowed_user_ids")
    .in("key", keys);
  if (error || !data) return false;
  return keys.every((k) => {
    const row = data.find((r) => r.key === k);
    if (!row || row.enabled !== true) return false;
    const allowed = row.allowed_user_ids ?? [];
    if (allowed.length === 0) return true;
    return userId ? allowed.includes(userId) : false;
  });
}
