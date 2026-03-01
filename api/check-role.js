import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "Missing user_id" });

    const uid = String(user_id).trim();
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(uid)) return res.status(400).json({ error: "Invalid user_id (not uuid)" });

    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message || String(error) });

    // Om raden saknas av någon anledning: pending
    if (!data) return res.status(200).json({ role: "pending" });

    const role = String(data.role || "pending");
    return res.status(200).json({ role });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
