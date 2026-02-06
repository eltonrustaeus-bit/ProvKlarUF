export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false });

    const { userIdToApprove } = req.body || {};
    if (!userIdToApprove) return res.status(400).json({ ok: false, error: "Missing userIdToApprove" });

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const authHeader = req.headers.authorization || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return res.status(401).json({ ok: false, error: "Missing bearer token" });

    // 1) Hämta vem som anropar (via Supabase Auth REST)
    const meResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: serviceKey }
    });
    const me = await meResp.json();
    if (!me?.id) return res.status(401).json({ ok: false, error: "Bad token" });

    // 2) Kolla att anroparen är admin (via service role -> kan läsa allt)
    const profResp = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      }
    });
    const profArr = await profResp.json();
    const role = profArr?.[0]?.role;
    if (role !== "admin") return res.status(403).json({ ok: false, error: "Not admin" });

    // 3) Godkänn target user
    const upResp = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userIdToApprove}`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ approved: true })
    });
    const up = await upResp.json();
    if (!upResp.ok) return res.status(400).json({ ok: false, error: "Update failed", details: up });

    return res.status(200).json({ ok: true, updated: up });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Server error", details: String(e) });
  }
}
