/**
 * Skickar Basic-pitchmail till alla gratis-användare.
 * 
 * DRY RUN (default) — visar mottagare utan att skicka:
 *   node scripts/send-basic-pitch.mjs
 *
 * SKICKA PÅ RIKTIGT:
 *   node scripts/send-basic-pitch.mjs --send
 *
 * Kräver env-variabler: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 */

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = !process.argv.includes("--send");

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY   = process.env.RESEND_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Saknar SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
if (!DRY_RUN && !RESEND_API_KEY)    { console.error("Saknar RESEND_API_KEY"); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function buildHtml(email) {
  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#08100d;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08100d;padding:40px 16px">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#0f1a13;border:1px solid rgba(27,255,140,.18);border-radius:8px;overflow:hidden">

      <tr><td style="background:#0a130d;padding:24px 32px;border-bottom:1px solid rgba(27,255,140,.12)">
        <span style="font-size:20px;font-weight:800;color:#1B2430;letter-spacing:-0.4px">ExGen</span>
      </td></tr>

      <tr><td style="padding:32px 32px 20px">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#e8f5ee;line-height:1.3">Du pluggar på gratisplanen. Här är vad du missar.</h1>
        <p style="margin:0;font-size:15px;color:#a8c4b4;line-height:1.7">Gratisplanen ger dig 10 kursfrågor per dag och 2 AI-mockprov per vecka. Teoriprov — det som simulerar riktiga körkortsprovet — kräver Basic.</p>
      </td></tr>

      <tr><td style="padding:0 32px 24px">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111a15;border:1px solid rgba(27,255,140,.2);border-radius:6px;overflow:hidden">
          <tr><td style="padding:16px 20px;border-bottom:1px solid rgba(27,255,140,.1)">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1bff8c;text-transform:uppercase;letter-spacing:0.6px">Basic — 29 kr/mån</p>
            <p style="margin:0;font-size:14px;color:#e8f5ee;line-height:1.6">30 teoriprov/mån &nbsp;·&nbsp; 30 AI-mockprov/mån &nbsp;·&nbsp; Obegränsad körkortsträning &nbsp;·&nbsp; P.E.R 5/dag</p>
          </tr>
          <tr><td style="padding:14px 20px">
            <p style="margin:0;font-size:13px;color:#a8c4b4;line-height:1.6">Det är 1 prov per dag i en månad. Forskning visar att spridd repetition är det effektivaste sättet att lära sig — men det kräver att du faktiskt kan öva varje dag.</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 32px 28px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid rgba(27,255,140,.07)">
              <span style="color:#1bff8c;font-size:14px;margin-right:10px">✓</span>
              <span style="color:#e8f5ee;font-size:14px">AI väljer frågor baserat på dina svagheter</span>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid rgba(27,255,140,.07)">
              <span style="color:#1bff8c;font-size:14px;margin-right:10px">✓</span>
              <span style="color:#e8f5ee;font-size:14px">P.E.R förklarar varför du svarade fel</span>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0">
              <span style="color:#1bff8c;font-size:14px;margin-right:10px">✓</span>
              <span style="color:#e8f5ee;font-size:14px">Ingen bindningstid — avsluta när du vill</span>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 32px 36px">
        <a href="https://proviaai.se/pricing.html" style="display:inline-block;background:#1bff8c;color:#08100d;font-size:15px;font-weight:700;padding:14px 28px;border-radius:5px;text-decoration:none">Uppgradera till Basic — 29 kr/mån →</a>
        <p style="margin:12px 0 0;font-size:13px;color:#6b8f7c">Inget kort krävs för att fortsätta på gratis om du ångrar dig.</p>
      </td></tr>

      <tr><td style="padding:18px 32px;border-top:1px solid rgba(27,255,140,.08)">
        <p style="margin:0;font-size:12px;color:#6b8f7c;line-height:1.5">
          Du får det här mailet för att du har ett konto på ExGen med adressen <b style="color:#a8c4b4">${email}</b>.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function main() {
  // Hämta alla gratis-användare (exkludera egna test-konton)
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("role", "gratis");

  if (error) { console.error("Supabase-fel:", error.message); process.exit(1); }
  if (!profiles?.length) { console.log("Inga gratis-användare hittades."); return; }

  // Hämta e-postadresser från auth.users
  const ids = profiles.map(p => p.id);
  const { data: users, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (authErr) { console.error("Auth-fel:", authErr.message); process.exit(1); }

  const targets = users.users
    .filter(u => ids.includes(u.id) && u.email)
    .map(u => u.email);

  console.log(`\n${DRY_RUN ? "🔍 DRY RUN — ingenting skickas" : "📨 SKICKAR RIKTIGA MAIL"}`);
  console.log(`Mottagare (${targets.length}):`);
  targets.forEach(e => console.log(`  · ${e}`));

  if (DRY_RUN) {
    console.log("\nKör med --send för att skicka på riktigt.");
    return;
  }

  console.log("\nSkickar...");
  let ok = 0, fail = 0;
  for (const email of targets) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "ExGen <noreply@proviaai.se>",
        to: email,
        subject: "Du pluggar på gratis. Här är vad du missar.",
        html: buildHtml(email),
      }),
    });
    const d = await r.json();
    if (d.id) { console.log(`✓ ${email}`); ok++; }
    else       { console.log(`✗ ${email} — ${d.message}`); fail++; }
    // 500ms delay mellan mail för att inte trigga rate limit
    await new Promise(res => setTimeout(res, 500));
  }
  console.log(`\nKlart. ${ok} skickade, ${fail} misslyckades.`);
}

main().catch(e => { console.error(e); process.exit(1); });
