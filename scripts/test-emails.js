/**
 * Skickar alla mailmallar till en testadress.
 * Kör med: node scripts/test-emails.js
 * Kräver: RESEND_API_KEY satt i miljön
 */

const TO      = "elton.rustaeus@gmail.com";
const FROM    = "ExGen <noreply@proviaai.se>";
const API_KEY = process.env.RESEND_API_KEY;

if (!API_KEY) {
  console.error("Sätt RESEND_API_KEY i miljön innan du kör skriptet.");
  process.exit(1);
}

async function send(subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: TO, subject, html }),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, id: data.id, error: data.message };
}

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Återanvänder samma wrap() som stripe-webhook.js ──────────────────────────
function wrap(content) {
  return `<!DOCTYPE html><html lang="sv"><body style="margin:0;padding:0;background:#08100d;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08100d;padding:32px 16px"><tr><td align="center">
<table width="100%" style="max-width:520px;background:#0f1a13;border:1px solid rgba(27,255,140,.18);border-radius:8px;overflow:hidden">
<tr><td style="background:#0a130d;padding:20px 28px;border-bottom:1px solid rgba(27,255,140,.12)">
<span style="font-size:18px;font-weight:700;color:#1bff8c">ExGen</span></td></tr>
<tr><td style="padding:28px 28px 32px">${content}</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid rgba(27,255,140,.08)">
<p style="margin:0;font-size:12px;color:#5a7a6a">Frågor? Svara på det här mejlet.</p></td></tr>
</table></td></tr></table></body></html>`;
}

// ── Välkomstmail (signup.js) ──────────────────────────────────────────────────
function welcomeHtml(email) {
  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#08100d;font-family:'DM Sans',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#08100d;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#0f1a13;border:1px solid rgba(27,255,140,.18);border-radius:8px;overflow:hidden">
        <tr><td style="background:#0a130d;padding:28px 32px;border-bottom:1px solid rgba(27,255,140,.12)">
          <span style="font-size:20px;font-weight:700;color:#1bff8c;letter-spacing:-0.3px">ExGen</span>
        </td></tr>
        <tr><td style="padding:36px 32px 24px">
          <h1 style="margin:0 0 14px;font-size:24px;font-weight:700;color:#e8f5ee;line-height:1.25">Ditt konto är redo. Nu kör vi.</h1>
          <p style="margin:0;font-size:15px;color:#a8c4b4;line-height:1.65">ExGen anpassar träningen efter <em>dina</em> svagheter — inte ett generiskt prov som alla andra gör. Ju mer du tränar, desto smartare blir systemet.</p>
        </td></tr>
        <tr><td style="padding:0 32px 28px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:13px 0;border-bottom:1px solid rgba(27,255,140,.08)">
              <span style="display:inline-block;width:22px;height:22px;background:#1bff8c;color:#08100d;border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;margin-right:12px;vertical-align:middle">1</span>
              <span style="color:#e8f5ee;font-size:14px;vertical-align:middle">Kör teoriprov — AI väljer frågor du behöver träna mest på</span>
            </td></tr>
            <tr><td style="padding:13px 0;border-bottom:1px solid rgba(27,255,140,.08)">
              <span style="display:inline-block;width:22px;height:22px;background:#1bff8c;color:#08100d;border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;margin-right:12px;vertical-align:middle">2</span>
              <span style="color:#e8f5ee;font-size:14px;vertical-align:middle">Öva körkortsteorin — vägmärken, trafikregler, alla kategorier</span>
            </td></tr>
            <tr><td style="padding:13px 0">
              <span style="display:inline-block;width:22px;height:22px;background:#1bff8c;color:#08100d;border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;margin-right:12px;vertical-align:middle">3</span>
              <span style="color:#e8f5ee;font-size:14px;vertical-align:middle">Se vad du missar — och lär dig varför svaret är fel</span>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 36px">
          <a href="https://proviaai.se/app.html" style="display:inline-block;background:#1bff8c;color:#08100d;font-size:15px;font-weight:700;padding:14px 28px;border-radius:5px;text-decoration:none">Starta ditt första prov →</a>
        </td></tr>
        <tr><td style="padding:28px 32px;background:#0a130d;border-top:1px solid rgba(27,255,140,.12)">
          <p style="margin:0 0 18px;font-size:13px;font-weight:700;color:#6b8f7c;text-transform:uppercase;letter-spacing:0.8px">Vad ingår i ditt konto?</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:12px 14px;background:#111a15;border-radius:5px 5px 0 0;border:1px solid rgba(27,255,140,.18);border-bottom:none">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td><span style="font-size:13px;font-weight:700;color:#1bff8c">Gratis</span><span style="font-size:12px;color:#6b8f7c;margin-left:8px">— du är här nu</span></td>
                  <td align="right"><span style="font-size:14px;font-weight:700;color:#e8f5ee">0 kr</span></td>
                </tr>
                <tr><td colspan="2" style="padding-top:8px;font-size:13px;color:#a8c4b4;line-height:1.5">10 kursfrågor/dag &nbsp;·&nbsp; 2 AI-mockprov/vecka &nbsp;·&nbsp; 5 EX1.0/vecka</td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:12px 14px;background:#111a15;border:1px solid rgba(27,255,140,.12);border-bottom:none">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td><span style="font-size:13px;font-weight:700;color:#e8f5ee">Basic</span></td>
                  <td align="right"><span style="font-size:14px;font-weight:700;color:#e8f5ee">29 kr<span style="font-size:11px;font-weight:400;color:#6b8f7c">/mån</span></span></td>
                </tr>
                <tr><td colspan="2" style="padding-top:8px;font-size:13px;color:#a8c4b4;line-height:1.5">30 teoriprov/mån &nbsp;·&nbsp; 30 AI-mockprov/mån &nbsp;·&nbsp; Obegränsad körkortsträning &nbsp;·&nbsp; EX1.0 5/dag</td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:12px 14px;background:#0e1c12;border-radius:0 0 5px 5px;border:1px solid rgba(27,255,140,.35)">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:13px;font-weight:700;color:#1bff8c">Premium</span>
                    <span style="display:inline-block;font-size:10px;font-weight:700;color:#08100d;background:#1bff8c;padding:2px 7px;border-radius:20px;margin-left:8px;vertical-align:middle">BÄST VÄRDE</span>
                  </td>
                  <td align="right"><span style="font-size:14px;font-weight:700;color:#e8f5ee">79 kr<span style="font-size:11px;font-weight:400;color:#6b8f7c">/mån</span></span></td>
                </tr>
                <tr><td colspan="2" style="padding-top:8px;font-size:13px;color:#a8c4b4;line-height:1.5">Obegränsat allt &nbsp;·&nbsp; Förbättringscoach &nbsp;·&nbsp; EX1.0 obegränsat</td></tr>
              </table>
            </td></tr>
          </table>
          <div style="margin-top:18px;text-align:center">
            <a href="https://proviaai.se/pricing.html" style="display:inline-block;border:1px solid rgba(27,255,140,.4);color:#1bff8c;font-size:14px;font-weight:600;padding:11px 24px;border-radius:5px;text-decoration:none">Se alla planer</a>
          </div>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid rgba(27,255,140,.08)">
          <p style="margin:0;font-size:12px;color:#6b8f7c;line-height:1.5">Registrerad med <b style="color:#a8c4b4">${esc(email)}</b>. Frågor? Svara på det här mejlet.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Betalning bekräftad ───────────────────────────────────────────────────────
function paymentConfirmedHtml() {
  return wrap(`
<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#e8f5ee">Betalning bekräftad ✓</h1>
<p style="margin:0 0 20px;font-size:15px;color:#a8c4b4;line-height:1.6">Ditt <strong style="color:#1bff8c">Premium</strong>-konto är nu aktiverat.</p>
<table cellpadding="0" cellspacing="0" style="background:#111a15;border:1px solid rgba(27,255,140,.15);border-radius:6px;padding:16px 18px;margin-bottom:22px;width:100%;box-sizing:border-box">
  <tr><td style="font-size:13px;color:#6b8f7c;padding-bottom:6px">Plan</td><td align="right" style="font-size:13px;font-weight:700;color:#1bff8c">Premium</td></tr>
  <tr><td style="font-size:13px;color:#6b8f7c;padding-bottom:6px">Belopp</td><td align="right" style="font-size:13px;color:#e8f5ee">79 kr</td></tr>
  <tr><td style="font-size:13px;color:#6b8f7c">Konto</td><td align="right" style="font-size:13px;color:#e8f5ee">${esc(TO)}</td></tr>
</table>
<a href="https://proviaai.se/app.html" style="display:inline-block;background:#1bff8c;color:#08100d;font-size:15px;font-weight:700;padding:13px 26px;border-radius:5px;text-decoration:none">Öppna ExGen →</a>`);
}

// ── Prenumeration förnyad ─────────────────────────────────────────────────────
function renewalHtml() {
  return wrap(`
<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#e8f5ee">Prenumeration förnyad</h1>
<p style="margin:0 0 20px;font-size:15px;color:#a8c4b4;line-height:1.6">Din <strong style="color:#1bff8c">Premium</strong>-prenumeration har förnyats automatiskt.</p>
<table cellpadding="0" cellspacing="0" style="background:#111a15;border:1px solid rgba(27,255,140,.15);border-radius:6px;padding:16px 18px;margin-bottom:22px;width:100%;box-sizing:border-box">
  <tr><td style="font-size:13px;color:#6b8f7c;padding-bottom:6px">Plan</td><td align="right" style="font-size:13px;font-weight:700;color:#1bff8c">Premium</td></tr>
  <tr><td style="font-size:13px;color:#6b8f7c;padding-bottom:6px">Belopp</td><td align="right" style="font-size:13px;color:#e8f5ee">79 kr</td></tr>
  <tr><td style="font-size:13px;color:#6b8f7c">Konto</td><td align="right" style="font-size:13px;color:#e8f5ee">${esc(TO)}</td></tr>
</table>
<a href="https://proviaai.se/konto.html" style="display:inline-block;border:1px solid rgba(27,255,140,.4);color:#1bff8c;font-size:14px;font-weight:600;padding:11px 22px;border-radius:5px;text-decoration:none">Hantera prenumeration</a>`);
}

// ── Betalning misslyckades ────────────────────────────────────────────────────
function paymentFailedHtml() {
  return wrap(`
<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#ff8484">Betalning misslyckades</h1>
<p style="margin:0 0 16px;font-size:15px;color:#a8c4b4;line-height:1.6">Vi kunde inte debitera ditt kort för din <strong style="color:#e8f5ee">Premium</strong>-prenumeration.</p>
<p style="margin:0 0 22px;font-size:14px;color:#a8c4b4;line-height:1.6">Uppdatera din betalningsmetod för att behålla tillgången. Stripe försöker igen automatiskt — om det misslyckas upprepade gånger avslutas prenumerationen.</p>
<a href="https://proviaai.se/konto.html" style="display:inline-block;background:#ff8484;color:#08100d;font-size:15px;font-weight:700;padding:13px 26px;border-radius:5px;text-decoration:none">Uppdatera betalningssätt →</a>`);
}

// ── Prenumeration avslutad ────────────────────────────────────────────────────
function cancelledHtml() {
  return wrap(`
<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#e8f5ee">Prenumeration avslutad</h1>
<p style="margin:0 0 16px;font-size:15px;color:#a8c4b4;line-height:1.6">Din <strong style="color:#e8f5ee">Premium</strong>-prenumeration är avslutad. Du har nu tillgång till gratisplanen.</p>
<p style="margin:0 0 22px;font-size:14px;color:#a8c4b4;line-height:1.6">Du kan uppgradera igen när som helst.</p>
<a href="https://proviaai.se/pricing.html" style="display:inline-block;border:1px solid rgba(27,255,140,.4);color:#1bff8c;font-size:14px;font-weight:600;padding:11px 22px;border-radius:5px;text-decoration:none">Se planer</a>`);
}

// ── Skicka alla ───────────────────────────────────────────────────────────────
const emails = [
  { subject: "[TEST] Välkommen till ExGen!",                html: welcomeHtml(TO) },
  { subject: "[TEST] Betalning bekräftad — Premium",           html: paymentConfirmedHtml() },
  { subject: "[TEST] Prenumeration förnyad — Premium",         html: renewalHtml() },
  { subject: "[TEST] Betalning misslyckades — uppdatera kort", html: paymentFailedHtml() },
  { subject: "[TEST] Prenumeration avslutad",                  html: cancelledHtml() },
];

console.log(`Skickar ${emails.length} testmail till ${TO}...\n`);

for (const { subject, html } of emails) {
  const result = await send(subject, html);
  const icon = result.ok ? "✓" : "✗";
  console.log(`${icon}  ${subject}`);
  if (!result.ok) console.log(`   Fel: ${result.error}`);
}

console.log("\nKlart. Kolla inboxen.");
