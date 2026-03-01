import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: "Missing user_id" });

  const { data, error } = await supabase
    .from("profiles")
    .select("approved")
    .eq("id", user_id)
    .maybeSingle();

  if (error || !data) return res.status(200).json({ approved: false });
  return res.status(200).json({ approved: !!data.approved });
}

