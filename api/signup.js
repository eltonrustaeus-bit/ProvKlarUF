import { createClient } from "@supabase/supabase-js";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildWelcomeHtml(email) {
  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#08100d;font-family:'DM Sans',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#08100d;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#0f1a13;border:1px solid rgba(27,255,140,.18);border-radius:8px;overflow:hidden">

        <!-- Header -->
        <tr><td style="background:#0a130d;padding:28px 32px;border-bottom:1px solid rgba(27,255,140,.12)">
          <span style="font-size:20px;font-weight:700;color:#1bff8c;letter-spacing:-0.3px">ProviaAI</span>
        </td></tr>

        <!-- Hero -->
        <tr><td style="padding:36px 32px 24px">
          <h1 style="margin:0 0 14px;font-size:24px;font-weight:700;color:#e8f5ee;line-height:1.25">Ditt konto är redo. Nu kör vi.</h1>
          <p style="margin:0;font-size:15px;color:#a8c4b4;line-height:1.65">ProviaAI anpassar träningen efter <em>dina</em> svagheter — inte ett generiskt prov som alla andra gör. Ju mer du tränar, desto smartare blir systemet.</p>
        </td></tr>

        <!-- Steps -->
        <tr><td style="padding:0 32px 28px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:13px 0;border-bottom:1px solid rgba(27,255,140,.08)">
                <span style="display:inline-block;width:22px;height:22px;background:#1bff8c;color:#08100d;border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;margin-right:12px;vertical-align:middle">1</span>
                <span style="color:#e8f5ee;font-size:14px;vertical-align:middle">Kör teoriprov — AI väljer frågor du behöver träna mest på</span>
              </td>
            </tr>
            <tr>
              <td style="padding:13px 0;border-bottom:1px solid rgba(27,255,140,.08)">
                <span style="display:inline-block;width:22px;height:22px;background:#1bff8c;color:#08100d;border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;margin-right:12px;vertical-align:middle">2</span>
                <span style="color:#e8f5ee;font-size:14px;vertical-align:middle">Öva körkortsteorin — vägmärken, trafikregler, alla kategorier</span>
              </td>
            </tr>
            <tr>
              <td style="padding:13px 0">
                <span style="display:inline-block;width:22px;height:22px;background:#1bff8c;color:#08100d;border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;margin-right:12px;vertical-align:middle">3</span>
                <span style="color:#e8f5ee;font-size:14px;vertical-align:middle">Se vad du missar — och lär dig varför svaret är fel</span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Primary CTA -->
        <tr><td style="padding:0 32px 36px">
          <a href="https://proviaai.se/app.html" style="display:inline-block;background:#1bff8c;color:#08100d;font-size:15px;font-weight:700;padding:14px 28px;border-radius:5px;text-decoration:none">Starta ditt första prov →</a>
        </td></tr>

        <!-- Pricing section -->
        <tr><td style="padding:28px 32px;background:#0a130d;border-top:1px solid rgba(27,255,140,.12)">
          <p style="margin:0 0 18px;font-size:13px;font-weight:700;color:#6b8f7c;text-transform:uppercase;letter-spacing:0.8px">Vad ingår i ditt konto?</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <!-- Gratis row -->
            <tr>
              <td style="padding:12px 14px;background:#111a15;border-radius:5px 5px 0 0;border:1px solid rgba(27,255,140,.18);border-bottom:none">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <span style="font-size:13px;font-weight:700;color:#1bff8c">Gratis</span>
                      <span style="font-size:12px;color:#6b8f7c;margin-left:8px">— du är här nu</span>
                    </td>
                    <td align="right">
                      <span style="font-size:14px;font-weight:700;color:#e8f5ee">0 kr</span>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top:8px;font-size:13px;color:#a8c4b4;line-height:1.5">
                      10 kursfrågor/dag &nbsp;·&nbsp; 2 AI-mockprov/vecka &nbsp;·&nbsp; 5 P.E.R/vecka
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Basic row -->
            <tr>
              <td style="padding:12px 14px;background:#111a15;border:1px solid rgba(27,255,140,.12);border-bottom:none">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <span style="font-size:13px;font-weight:700;color:#e8f5ee">Basic</span>
                    </td>
                    <td align="right">
                      <span style="font-size:14px;font-weight:700;color:#e8f5ee">29 kr<span style="font-size:11px;font-weight:400;color:#6b8f7c">/mån</span></span>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top:8px;font-size:13px;color:#a8c4b4;line-height:1.5">
                      30 teoriprov/mån &nbsp;·&nbsp; 30 AI-mockprov/mån &nbsp;·&nbsp; Obegränsad körkortsträning &nbsp;·&nbsp; P.E.R 5/dag
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Premium row -->
            <tr>
              <td style="padding:12px 14px;background:#0e1c12;border-radius:0 0 5px 5px;border:1px solid rgba(27,255,140,.35)">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <span style="font-size:13px;font-weight:700;color:#1bff8c">Premium</span>
                      <span style="display:inline-block;font-size:10px;font-weight:700;color:#08100d;background:#1bff8c;padding:2px 7px;border-radius:20px;margin-left:8px;vertical-align:middle">BÄST VÄRDE</span>
                    </td>
                    <td align="right">
                      <span style="font-size:14px;font-weight:700;color:#e8f5ee">79 kr<span style="font-size:11px;font-weight:400;color:#6b8f7c">/mån</span></span>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top:8px;font-size:13px;color:#a8c4b4;line-height:1.5">
                      Obegränsat allt &nbsp;·&nbsp; Förbättringscoach &nbsp;·&nbsp; P.E.R obegränsat
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <!-- Upgrade CTA -->
          <div style="margin-top:18px;text-align:center">
            <a href="https://proviaai.se/pricing.html" style="display:inline-block;border:1px solid rgba(27,255,140,.4);color:#1bff8c;font-size:14px;font-weight:600;padding:11px 24px;border-radius:5px;text-decoration:none">Se alla planer</a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:18px 32px;border-top:1px solid rgba(27,255,140,.08)">
          <p style="margin:0;font-size:12px;color:#6b8f7c;line-height:1.5">Registrerad med <b style="color:#a8c4b4">${email}</b>. Frågor? Svara på det här mejlet.</p>
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

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

  // Send notification to admin (server-side, guaranteed)
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "ProviaAI <noreply@proviaai.se>",
        to: "elton.rustaeus@gmail.com",
        subject: `Ny användare på ProviaAI — ${escapeHtml(email)}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px">
            <h2 style="color:#1bff8c;margin:0 0 16px">Ny registrering</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:6px 0;color:#666">Email</td><td><b>${escapeHtml(email)}</b></td></tr>
              <tr><td style="padding:6px 0;color:#666">Användar-ID</td><td style="font-size:12px;font-family:monospace">${escapeHtml(userData.user.id)}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Roll</td><td><b>gratis</b></td></tr>
              <tr><td style="padding:6px 0;color:#666">Registrerad</td><td>${new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}</td></tr>
            </table>
          </div>
        `
      })
    });
    // Send welcome email to the new user
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "ProviaAI <noreply@proviaai.se>",
        to: email,
        subject: `Välkommen till ProviaAI!`,
        html: buildWelcomeHtml(email)
      })
    });
  } catch (e) {
    // Email failure never blocks signup
  }

  return res.status(200).json({ session: signInData.session, user: signInData.user });
}
