async function mustHaveImproveAccess(){
  // Om db saknas kan vi inte verifiera. Lås sidan.
  if(!db) return { ok:false, reason:"no_db" };

  const { data, error } = await db.auth.getUser();
  if(error || !data?.user?.id) return { ok:false, reason:"not_logged_in" };

  const uid = data.user.id;

  try{
    const r = await fetch("/api/check-role", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ user_id: uid })
    });

    // Om API:t inte svarar 2xx: behandla som basic (ingen access)
    if(!r.ok){
      return { ok:false, reason:"no_access", role:"basic" };
    }

    const out = await r.json().catch(() => ({}));
    const role = String(out?.role || "basic");
    const allowed = (role === "premium" || role === "admin");

    return allowed ? { ok:true, role } : { ok:false, reason:"no_access", role };
  } catch {
    // Network/timeout: behandla som basic (ingen access)
    return { ok:false, reason:"no_access", role:"basic" };
  }
}
