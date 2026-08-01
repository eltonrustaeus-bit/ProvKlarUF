import { createClient } from "@supabase/supabase-js";
import { BRAND_NAME } from "./_site.js";
import { requireAuth } from "./_auth.js";
import { buildWelcomeHtml, escapeHtml } from "./signup.js";

/* Called once by shared.js right after a visitor comes back from Google.
 *
 * Email/password signups get their welcome mail from api/signup.js, which is
 * never reached on the OAuth path — Supabase creates the user itself. Without
 * this endpoint a Google signup would silently get no welcome mail and no
 * admin notification, which is exactly the split that api/signup.js was made
 * the single path to remove.
 *
 * profiles.welcome_sent_at is the idempotency guard: the row itself already
 * exists by the time we run (the on_auth_user_created trigger inserts it with
 * approved = true), so a null timestamp is what marks a first sign-in. That
 * column is service-role only — profiles has no UPDATE policy — so a client
 * cannot clear it to make itself look new again.
 */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendMail(payload) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;                       // requireAuth already answered 401

  const email = user.email || "";

  // The row is created by the trigger. If it is somehow missing, create it the
  // same way the trigger would rather than failing the sign-in.
  const { data: profile, error: readErr } = await supabase
    .from("profiles")
    .select("welcome_sent_at")
    .eq("id", user.id)
    .maybeSingle();

  if (readErr) return res.status(500).json({ error: "Kunde inte läsa profilen." });

  if (!profile) {
    await supabase.from("profiles").insert([{ id: user.id, approved: true, role: "gratis" }]);
  } else if (profile.welcome_sent_at) {
    return res.status(200).json({ isNew: false });   // already welcomed
  }

  /* Claim the slot before sending. Two tabs returning from Google at once
     would otherwise both read null and both send. */
  const { data: claimed } = await supabase
    .from("profiles")
    .update({ welcome_sent_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("welcome_sent_at", null)
    .select("id");

  if (!claimed || !claimed.length) return res.status(200).json({ isNew: false });

  try {
    await sendMail({
      from: `${BRAND_NAME} <noreply@proviaai.se>`,
      to: email,
      subject: `Välkommen till ${BRAND_NAME}!`,
      html: buildWelcomeHtml(email)
    });
    await sendMail({
      from: `${BRAND_NAME} <noreply@proviaai.se>`,
      to: "elton.rustaeus@gmail.com",
      subject: `Ny användare på ${BRAND_NAME} — ${escapeHtml(email)}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px">
          <h2 style="color:#00768F;margin:0 0 16px">Ny registrering</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#666">Email</td><td><b>${escapeHtml(email)}</b></td></tr>
            <tr><td style="padding:6px 0;color:#666">Användar-ID</td><td style="font-size:12px;font-family:monospace">${escapeHtml(user.id)}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Roll</td><td><b>gratis</b></td></tr>
            <tr><td style="padding:6px 0;color:#666">Via</td><td><b>Google</b></td></tr>
            <tr><td style="padding:6px 0;color:#666">Registrerad</td><td>${new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}</td></tr>
          </table>
        </div>
      `
    });
  } catch (e) {
    // Email failure never blocks the sign-in, same rule as api/signup.js.
  }

  return res.status(200).json({ isNew: true });
}
