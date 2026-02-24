import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function requireUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return { ok: false, error: "NO_AUTH" };
  }

  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;

  if (error || !user?.id) {
    return { ok: false, error: "NO_USER" };
  }

  return { ok: true, userId: user.id };
}

export async function consumeDailyQuota(userId) {
  const date = todayISO();

  // plan
  const { data: planRow } = await supabase
    .from("user_plans")
    .select("daily_limit")
    .eq("user_id", userId)
    .maybeSingle();

  // default om saknas (extra säkerhet)
  const dailyLimit =
    planRow?.daily_limit === undefined ? 5 : planRow.daily_limit;

  // oändligt
  if (dailyLimit === null) {
    return { ok: true, unlimited: true };
  }

  // säkerställ rad
  await supabase
    .from("daily_usage")
    .upsert({ user_id: userId, date, count: 0 }, { onConflict: "user_id,date" });

  // hämta usage
  const { data: usageRow } = await supabase
    .from("daily_usage")
    .select("count")
    .eq("user_id", userId)
    .eq("date", date)
    .single();

  const count = Number(usageRow?.count || 0);

  if (count >= dailyLimit) {
    return { ok: false, error: "LIMIT_REACHED", limit: dailyLimit, count };
  }

  // öka
  await supabase
    .from("daily_usage")
    .update({ count: count + 1 })
    .eq("user_id", userId)
    .eq("date", date);

  return { ok: true, unlimited: false, limit: dailyLimit, count: count + 1 };
}
