import { createClient } from "@supabase/supabase-js";
import { BRAND_NAME, SITE_ORIGIN } from "./_site.js";
import { requireAuth } from "./_auth.js";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/* Plan rows mirror api/_provia-rules.js — the email is the first thing a new
   user reads, so a stale quota here is a promise the product does not keep.
   Körkortsteorin is deliberately absent: the module has been hidden from the
   UI since 2026-07-28, and advertising it would sell something nobody can
   reach. Palette is the current light ExGen brand (exgen-tokens.css), not the
   dark green one the product carried under the ProviaAI name. */
function buildWelcomeHtml(email) {
  /* Number and text sit in separate cells rather than inline spans so a step
     that wraps to a second line stays indented under its own text instead of
     sliding back under the number. */
  const step = (n, text, last) => `
            <tr>
              <td style="padding:13px 0${last ? "" : ";border-bottom:1px solid #EEF1F4"}">
                <table cellpadding="0" cellspacing="0"><tr>
                  <td width="34" valign="top" style="width:34px">
                    <span style="display:inline-block;width:22px;height:22px;background:#00768F;color:#ffffff;border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700">${n}</span>
                  </td>
                  <td valign="top" style="color:#1B2430;font-size:14px;line-height:1.5">${text}</td>
                </tr></table>
              </td>
            </tr>`;

  const plan = (name, price, features, opts = {}) => `
            <tr>
              <td style="padding:13px 15px;background:${opts.highlight ? "#F4FBFD" : "#FFFFFF"};border:1px solid ${opts.highlight ? "rgba(0,183,217,.35)" : "#E4E7EC"};${opts.radius || ""}${opts.joined ? "border-bottom:none;" : ""}">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <span style="font-size:13px;font-weight:700;color:${opts.highlight ? "#00768F" : "#1B2430"}">${name}</span>
                      ${opts.note ? `<span style="font-size:12px;color:#667085;margin-left:8px">${opts.note}</span>` : ""}
                    </td>
                    <td align="right">
                      <span style="font-size:14px;font-weight:700;color:#1B2430">${price}</span>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top:8px;font-size:13px;color:#667085;line-height:1.5">${features}</td>
                  </tr>
                </table>
              </td>
            </tr>`;

  const perMonth = '<span style="font-size:11px;font-weight:400;color:#667085">/mån</span>';

  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:Inter,'DM Sans',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#FFFFFF;border:1px solid #E4E7EC;border-radius:10px;overflow:hidden">

        <!-- Header -->
        <tr><td style="padding:0"><div style="height:3px;background:linear-gradient(90deg,#00B7D9,#76D76A);font-size:0;line-height:0">&nbsp;</div></td></tr>
        <tr><td style="padding:26px 32px 22px;border-bottom:1px solid #EEF1F4">
          <span style="font-size:20px;font-weight:800;color:#1B2430;letter-spacing:-0.4px">${BRAND_NAME}</span>
        </td></tr>

        <!-- Hero -->
        <tr><td style="padding:32px 32px 22px">
          <h1 style="margin:0 0 14px;font-size:24px;font-weight:700;color:#1B2430;line-height:1.25">Ditt konto är redo. Nu kör vi.</h1>
          <p style="margin:0;font-size:15px;color:#667085;line-height:1.65">${BRAND_NAME} bygger provet ur <em>ditt eget</em> material och sparar exakt vilka begrepp du tappar poäng på. Ju mer du tränar, desto bättre träffar nästa prov.</p>
        </td></tr>

        <!-- Steps -->
        <tr><td style="padding:0 32px 26px">
          <table width="100%" cellpadding="0" cellspacing="0">${
            step(1, "Klistra in ditt kursmaterial — få ett prov på nivå E, C eller A") +
            step(2, "Skriv provet — varje fråga rättas med poäng, motivering och modellsvar") +
            step(3, "Se i felbanken vilket begrepp som återkommer — och träna på just det", true)
          }
          </table>
        </td></tr>

        <!-- Primary CTA -->
        <tr><td style="padding:0 32px 34px">
          <a href="${SITE_ORIGIN}/app.html" style="display:inline-block;background:#00768F;color:#ffffff;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none">Starta ditt första prov →</a>
        </td></tr>

        <!-- Pricing section -->
        <tr><td style="padding:26px 32px;background:#F8FAFC;border-top:1px solid #EEF1F4">
          <p style="margin:0 0 16px;font-size:12px;font-weight:700;color:#667085;text-transform:uppercase;letter-spacing:0.8px">Vad ingår i ditt konto?</p>
          <table width="100%" cellpadding="0" cellspacing="0">${
            plan("Gratis", "0 kr", "3 mockprov/vecka &nbsp;·&nbsp; rättning med modellsvar &nbsp;·&nbsp; P.E.R 5/vecka",
                 { note: "— du är här nu", radius: "border-radius:8px 8px 0 0;", joined: true }) +
            plan("Basic", `29 kr${perMonth}`, "30 prov/mån &nbsp;·&nbsp; fota anteckningar &nbsp;·&nbsp; historik och synk &nbsp;·&nbsp; P.E.R 5/dag",
                 { joined: true }) +
            plan("Premium", `79 kr${perMonth}`, "Obegränsat med prov &nbsp;·&nbsp; felbank och AI-coach &nbsp;·&nbsp; lärarrapport &nbsp;·&nbsp; P.E.R obegränsat",
                 { highlight: true, radius: "border-radius:0 0 8px 8px;" })
          }
          </table>
          <div style="margin-top:18px;text-align:center">
            <a href="${SITE_ORIGIN}/pricing.html" style="display:inline-block;border:1px solid rgba(0,183,217,.45);color:#00768F;font-size:14px;font-weight:600;padding:11px 24px;border-radius:8px;text-decoration:none">Se alla planer</a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:18px 32px;border-top:1px solid #EEF1F4">
          <p style="margin:0;font-size:12px;color:#667085;line-height:1.5">Registrerad med <b style="color:#1B2430">${escapeHtml(email)}</b>. Frågor? Svara på det här mejlet.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function sendMail(payload) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function adminNoticeHtml(email, userId, via) {
  return `
    <div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#00768F;margin:0 0 16px">Ny registrering</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#666">Email</td><td><b>${escapeHtml(email)}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Anv\u00e4ndar-ID</td><td style="font-size:12px;font-family:monospace">${escapeHtml(userId)}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Roll</td><td><b>gratis</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Via</td><td><b>${escapeHtml(via)}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Registrerad</td><td>${new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}</td></tr>
      </table>
    </div>
  `;
}

/* OAuth (Google) completion — reached as POST /api/signup with { op: "oauth" }
 * and a Bearer token, not as its own route.
 *
 * It lived in api/oauth-complete.js first, which pushed the project to 13
 * serverless functions and broke deployment: the Hobby plan allows 12, and the
 * build failed at "Deploying outputs" with everything else already compiled.
 * Folding it in here keeps the count at 12 and puts it next to the welcome mail
 * it shares.
 *
 * Supabase creates the user itself on the OAuth path, so the signup branch
 * below never runs and nothing would send the welcome mail or notify the admin.
 * profiles.welcome_sent_at is the idempotency guard: the row already exists by
 * the time we run (the on_auth_user_created trigger inserts it with
 * approved = true), so a null timestamp is what marks a first sign-in. That
 * column is service-role only \u2014 profiles has no UPDATE policy \u2014 so a client
 * cannot clear it to look new again.
 */
async function completeOAuth(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;                       // requireAuth already answered 401

  const email = user.email || "";

  const { data: profile, error: readErr } = await supabase
    .from("profiles")
    .select("welcome_sent_at")
    .eq("id", user.id)
    .maybeSingle();

  if (readErr) return res.status(500).json({ error: "Kunde inte l\u00e4sa profilen." });

  if (!profile) {
    // The trigger should have made this. If it somehow did not, create it the
    // same way rather than failing the sign-in.
    await supabase.from("profiles").insert([{ id: user.id, approved: true, role: "gratis" }]);
  } else if (profile.welcome_sent_at) {
    return res.status(200).json({ isNew: false });
  }

  /* Claim the slot before sending: two tabs returning from Google at once
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
      subject: `V\u00e4lkommen till ${BRAND_NAME}!`,
      html: buildWelcomeHtml(email)
    });
    await sendMail({
      from: `${BRAND_NAME} <noreply@proviaai.se>`,
      to: "elton.rustaeus@gmail.com",
      subject: `Ny anv\u00e4ndare p\u00e5 ${BRAND_NAME} \u2014 ${escapeHtml(email)}`,
      html: adminNoticeHtml(email, user.id, "Google")
    });
  } catch (e) {
    // Email failure never blocks the sign-in.
  }

  return res.status(200).json({ isNew: true });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  if ((req.body || {}).op === "oauth") return completeOAuth(req, res);

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  // Input validation — fail fast at boundary
  const emailStr = String(email).trim().toLowerCase();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (emailStr.length > 254 || !EMAIL_RE.test(emailStr)) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: "Password must be 8–200 characters" });
  }

  // Create user via admin API (auto-confirms email)
  const { data: userData, error } = await supabase.auth.admin.createUser({
    email: emailStr,
    password,
    email_confirm: true
  });

  if (error) return res.status(400).json({ error: error.message });

  // Sign in to get session tokens
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: emailStr, password });
  if (signInError) return res.status(400).json({ error: signInError.message });

  // Send notification to admin (server-side, guaranteed). Same helpers the
  // OAuth branch uses, so the two paths cannot drift apart.
  try {
    await sendMail({
      from: `${BRAND_NAME} <noreply@proviaai.se>`,
      to: "elton.rustaeus@gmail.com",
      subject: `Ny anv\u00e4ndare p\u00e5 ${BRAND_NAME} \u2014 ${escapeHtml(email)}`,
      html: adminNoticeHtml(email, userData.user.id, "E-post")
    });
    // Send welcome email to the new user
    await sendMail({
      from: `${BRAND_NAME} <noreply@proviaai.se>`,
      to: email,
      subject: `V\u00e4lkommen till ${BRAND_NAME}!`,
      html: buildWelcomeHtml(email)
    });
  } catch (e) {
    // Email failure never blocks signup
  }

  /* Mark the welcome as sent so linking a Google identity to this address
     later does not trigger a second one from the OAuth branch. */
  await supabase
    .from("profiles")
    .update({ welcome_sent_at: new Date().toISOString() })
    .eq("id", userData.user.id)
    .is("welcome_sent_at", null);

  return res.status(200).json({ session: signInData.session, user: signInData.user });
}
