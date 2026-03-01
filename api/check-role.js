import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase) {
      return res.status(500).json({
        error: "Supabase env missing",
        missing: {
          SUPABASE_URL: !SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: !SUPABASE_SERVICE_ROLE_KEY,
        },
      });
    }

    const { user_id } = req.body || {};
    if (!user_id || typeof user_id !== "string") {
      return res.status(400).json({ error: "user_id is required" });
    }

    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id)
      .maybeSingle();

    // Ingen rad => basic
    if (error || !data?.role) {
      return res.status(200).json({ role: "basic" });
    }

    return res.status(200).json({ role: data.role });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
