import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { BRAND_NAME, SITE_ORIGIN } from "./_site.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PLAN_ROLES = { basic: "basic", premium: "premium" };
const PLAN_NAMES = { basic: "Basic", premium: "Premium" };
const RESEND_FROM = `${BRAND_NAME} <noreply@proviaai.se>`;
const ADMIN_EMAIL = "elton.rustaeus@gmail.com";

// ── Stripe signature ──
function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = sigHeader.split(",");
  const tPart = parts.find(p => p.startsWith("t="));
  const v1Parts = parts.filter(p => p.startsWith("v1="));
  if (!tPart || !v1Parts.length) return false;
  const timestamp = tPart.slice(2);
  const expected = crypto.createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`).digest("hex");
  return v1Parts.some(p => {
    try {
      return crypto.timingSafeEqual(Buffer.from(p.slice(3), "hex"), Buffer.from(expected, "hex"));
    } catch { return false; }
  });
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── Email ──
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
    });
  } catch { /* email failure never blocks webhook */ }
}

function esc(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function wrap(content) {
  return `<!DOCTYPE html><html lang="sv"><body style="margin:0;padding:0;background:#08100d;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08100d;padding:32px 16px"><tr><td align="center">
<table width="100%" style="max-width:520px;background:#0f1a13;border:1px solid rgba(27,255,140,.18);border-radius:8px;overflow:hidden">
<tr><td style="background:#0a130d;padding:20px 28px;border-bottom:1px solid rgba(27,255,140,.12)">
<span style="font-size:18px;font-weight:700;color:#1bff8c">${BRAND_NAME}</span></td></tr>
<tr><td style="padding:28px 28px 32px">${content}</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid rgba(27,255,140,.08)">
<p style="margin:0;font-size:12px;color:#5a7a6a">Frågor? Svara på det här mejlet.</p></td></tr>
</table></td></tr></table></body></html>`;
}

function tpl_paymentConfirmed(email, planName, amountStr) {
  return wrap(`
<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#e8f5ee">Betalning bekräftad ✓</h1>
<p style="margin:0 0 20px;font-size:15px;color:#a8c4b4;line-height:1.6">Ditt <strong style="color:#1bff8c">${esc(planName)}</strong>-konto är nu aktiverat.</p>
<table cellpadding="0" cellspacing="0" style="background:#111a15;border:1px solid rgba(27,255,140,.15);border-radius:6px;padding:16px 18px;margin-bottom:22px;width:100%;box-sizing:border-box">
  <tr><td style="font-size:13px;color:#6b8f7c;padding-bottom:6px">Plan</td><td align="right" style="font-size:13px;font-weight:700;color:#1bff8c">${esc(planName)}</td></tr>
  <tr><td style="font-size:13px;color:#6b8f7c;padding-bottom:6px">Belopp</td><td align="right" style="font-size:13px;color:#e8f5ee">${esc(amountStr)} kr</td></tr>
  <tr><td style="font-size:13px;color:#6b8f7c">Konto</td><td align="right" style="font-size:13px;color:#e8f5ee">${esc(email)}</td></tr>
</table>
<a href="${SITE_ORIGIN}/app.html" style="display:inline-block;background:#1bff8c;color:#08100d;font-size:15px;font-weight:700;padding:13px 26px;border-radius:5px;text-decoration:none">Öppna ${BRAND_NAME} →</a>`);
}

function tpl_renewalConfirmed(email, planName, amountStr) {
  return wrap(`
<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#e8f5ee">Prenumeration förnyad</h1>
<p style="margin:0 0 20px;font-size:15px;color:#a8c4b4;line-height:1.6">Din <strong style="color:#1bff8c">${esc(planName)}</strong>-prenumeration har förnyats automatiskt.</p>
<table cellpadding="0" cellspacing="0" style="background:#111a15;border:1px solid rgba(27,255,140,.15);border-radius:6px;padding:16px 18px;margin-bottom:22px;width:100%;box-sizing:border-box">
  <tr><td style="font-size:13px;color:#6b8f7c;padding-bottom:6px">Plan</td><td align="right" style="font-size:13px;font-weight:700;color:#1bff8c">${esc(planName)}</td></tr>
  <tr><td style="font-size:13px;color:#6b8f7c;padding-bottom:6px">Belopp</td><td align="right" style="font-size:13px;color:#e8f5ee">${esc(amountStr)} kr</td></tr>
  <tr><td style="font-size:13px;color:#6b8f7c">Konto</td><td align="right" style="font-size:13px;color:#e8f5ee">${esc(email)}</td></tr>
</table>
<a href="${SITE_ORIGIN}/konto.html" style="display:inline-block;border:1px solid rgba(27,255,140,.4);color:#1bff8c;font-size:14px;font-weight:600;padding:11px 22px;border-radius:5px;text-decoration:none">Hantera prenumeration</a>`);
}

function tpl_paymentFailed(email, planName) {
  return wrap(`
<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#ff8484">Betalning misslyckades</h1>
<p style="margin:0 0 16px;font-size:15px;color:#a8c4b4;line-height:1.6">Vi kunde inte debitera ditt kort för din <strong style="color:#e8f5ee">${esc(planName)}</strong>-prenumeration.</p>
<p style="margin:0 0 22px;font-size:14px;color:#a8c4b4;line-height:1.6">Uppdatera din betalningsmetod för att behålla tillgången. Stripe försöker igen automatiskt — om det misslyckas upprepade gånger avslutas prenumerationen.</p>
<a href="${SITE_ORIGIN}/konto.html" style="display:inline-block;background:#ff8484;color:#08100d;font-size:15px;font-weight:700;padding:13px 26px;border-radius:5px;text-decoration:none">Uppdatera betalningssätt →</a>`);
}

function tpl_subscriptionCancelled(planName) {
  return wrap(`
<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#e8f5ee">Prenumeration avslutad</h1>
<p style="margin:0 0 16px;font-size:15px;color:#a8c4b4;line-height:1.6">Din <strong style="color:#e8f5ee">${esc(planName)}</strong>-prenumeration är avslutad. Du har nu tillgång till gratisplanen.</p>
<p style="margin:0 0 22px;font-size:14px;color:#a8c4b4;line-height:1.6">Du kan uppgradera igen när som helst.</p>
<a href="${SITE_ORIGIN}/pricing.html" style="display:inline-block;border:1px solid rgba(27,255,140,.4);color:#1bff8c;font-size:14px;font-weight:600;padding:11px 22px;border-radius:5px;text-decoration:none">Se planer</a>`);
}

function tpl_adminNotice(label, email, planName, amountStr) {
  return `<div style="font-family:sans-serif;max-width:480px">
<h2 style="color:#1bff8c;margin:0 0 16px">${esc(label)} — ${BRAND_NAME}</h2>
<table style="width:100%;border-collapse:collapse">
<tr><td style="padding:6px 0;color:#666">Email</td><td><b>${esc(email)}</b></td></tr>
<tr><td style="padding:6px 0;color:#666">Plan</td><td><b>${esc(planName)}</b></td></tr>
<tr><td style="padding:6px 0;color:#666">Belopp</td><td><b>${esc(amountStr)} kr</b></td></tr>
<tr><td style="padding:6px 0;color:#666">Tid</td><td>${new Date().toLocaleString("sv-SE",{timeZone:"Europe/Stockholm"})}</td></tr>
</table></div>`;
}

// ── Supabase helpers ──
async function getUserEmail(userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    return data?.user?.email || null;
  } catch { return null; }
}

async function getUserIdByCustomer(customerId) {
  try {
    const { data } = await supabase.from("profiles")
      .select("id").eq("stripe_customer_id", customerId).maybeSingle();
    return data?.id || null;
  } catch { return null; }
}

async function getRoleByCustomer(customerId) {
  try {
    const { data } = await supabase.from("profiles")
      .select("role").eq("stripe_customer_id", customerId).maybeSingle();
    return data?.role || null;
  } catch { return null; }
}

// ── Handler ──
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const rawBody = await readRawBody(req);
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret || !verifyStripeSignature(rawBody, sig, webhookSecret)) {
    return res.status(400).json({ error: "Invalid Stripe signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  // ── checkout.session.completed — new purchase ──
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.supabase_user_id;
    const plan = session.metadata?.plan;
    const customerId = session.customer;
    const userEmail = session.customer_details?.email || session.customer_email || null;
    const amountKr = session.amount_total != null ? String(Math.round(session.amount_total / 100)) : "—";

    if (!userId || !plan || !PLAN_ROLES[plan]) {
      console.error("stripe-webhook: missing metadata", { userId, plan });
      return res.status(200).json({ received: true });
    }

    if (session.mode === "subscription") {
      const subscriptionId = session.subscription;
      const { error } = await supabase.from("profiles").upsert(
        { id: userId, role: PLAN_ROLES[plan], stripe_customer_id: customerId, stripe_subscription_id: subscriptionId },
        { onConflict: "id" }
      );
      if (error) console.error("stripe-webhook: subscription upsert failed", error);

    } else if (session.mode === "payment" && session.payment_status === "paid") {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from("profiles").upsert(
        { id: userId, role: PLAN_ROLES[plan], stripe_customer_id: customerId, swish_expires_at: expiresAt },
        { onConflict: "id" }
      );
      if (error) console.error("stripe-webhook: swish upsert failed", error);
    }

    // Send emails
    const email = userEmail || await getUserEmail(userId);
    const planName = PLAN_NAMES[plan] || plan;
    if (email) {
      await sendEmail(email, `Betalning bekräftad — ${planName}`, tpl_paymentConfirmed(email, planName, amountKr));
    }
    await sendEmail(ADMIN_EMAIL, `Ny betalning — ${planName} (${email || userId})`, tpl_adminNotice("Ny betalning", email || userId, planName, amountKr));
  }

  // ── customer.subscription.updated — plan change from portal ──
  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object;
    if (sub.status !== "active") return res.status(200).json({ received: true });
    const userId = sub.metadata?.supabase_user_id || await getUserIdByCustomer(sub.customer);
    const plan = sub.metadata?.plan;
    if (userId && plan && PLAN_ROLES[plan]) {
      await supabase.from("profiles").update({ role: PLAN_ROLES[plan] }).eq("id", userId);
    }
  }

  // ── invoice.payment_succeeded — monthly renewal ──
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object;
    // Skip first payment — checkout.session.completed already covers it
    if (invoice.billing_reason !== "subscription_cycle") return res.status(200).json({ received: true });

    const email = invoice.customer_email;
    const role = await getRoleByCustomer(invoice.customer);
    const planName = PLAN_NAMES[role] || "din plan";
    const amountKr = invoice.amount_paid != null ? String(Math.round(invoice.amount_paid / 100)) : "—";

    if (email) {
      await sendEmail(email, `Prenumeration förnyad — ${planName}`, tpl_renewalConfirmed(email, planName, amountKr));
    }
    await sendEmail(ADMIN_EMAIL, `Förnyelse — ${planName} (${email || invoice.customer})`, tpl_adminNotice("Förnyelse", email || invoice.customer, planName, amountKr));
  }

  // ── invoice.payment_failed — card declined or expired ──
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    const email = invoice.customer_email;
    const role = await getRoleByCustomer(invoice.customer);
    const planName = PLAN_NAMES[role] || "din plan";

    if (email) {
      await sendEmail(email, "Betalning misslyckades — uppdatera ditt kort", tpl_paymentFailed(email, planName));
    }
    await sendEmail(ADMIN_EMAIL, `Betalning misslyckades — ${email || invoice.customer}`, tpl_adminNotice("Betalning misslyckades", email || invoice.customer, planName, "—"));
  }

  // ── customer.subscription.deleted — cancelled or lapsed ──
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const userId = sub.metadata?.supabase_user_id || await getUserIdByCustomer(sub.customer);
    if (userId) {
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      const prevPlan = prof?.role || "basic";
      await supabase.from("profiles")
        .update({ role: "gratis", stripe_subscription_id: null })
        .eq("id", userId);
      const email = await getUserEmail(userId);
      if (email) {
        await sendEmail(email, "Prenumeration avslutad", tpl_subscriptionCancelled(PLAN_NAMES[prevPlan] || prevPlan));
      }
    }
  }

  return res.status(200).json({ received: true });
}
