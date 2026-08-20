import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { BRAND_NAME, SITE_ORIGIN, MAIL_FROM } from "./_site.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PLAN_ROLES = { basic: "basic", premium: "premium" };
const PLAN_NAMES = { basic: "Basic", premium: "Premium" };
const RESEND_FROM = MAIL_FROM;
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
// Bounded on purpose. The function has 10 s in total (vercel.json) and an event can send
// two of these back to back; without a ceiling a slow Resend response eats the budget and
// the invocation is killed after the role upgrade but before the claim is marked complete.
const EMAIL_TIMEOUT_MS = 3_000;

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
  } catch { /* email failure never blocks webhook */ }
}

function esc(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* Betalningsmejlens utseende.
 *
 * Låg fram till 2026-08-20 kvar i ProviaAIs mörkgröna palett — #08100d som
 * botten, #1bff8c som accent — medan resten av produkten bytt namn och färg
 * långt tidigare. Välkomstmejlet gjordes om 2026-08-01; de här fem missades,
 * vilket är obekvämt eftersom det är just de här en BETALANDE kund får.
 *
 * Paletten nedan är densamma som buildWelcomeHtml() i api/signup.js och som
 * exgen-tokens.css: ljus botten, mörk text, teal som handlingsfärg. Ändras
 * den här ska den ändras på båda ställena, annars ser ett kvitto ut som att
 * det kommer från ett annat företag än välkomstmejlet.
 *
 * Skrivet som tabeller med inline-stil för att mejlklienter inte kan
 * förlitas på för flexbox, grid eller <style>-block. */
const MAIL = {
  ground: "#F8FAFC", card: "#FFFFFF", line: "#E4E7EC", hair: "#EEF1F4",
  ink: "#1B2430", ink2: "#667085",
  accent: "#00768F", teal: "#00B7D9", mint: "#76D76A",
  danger: "#B91C1C",
};

function wrap(content) {
  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${MAIL.ground};font-family:Inter,'DM Sans',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${MAIL.ground};padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:${MAIL.card};border:1px solid ${MAIL.line};border-radius:10px;overflow:hidden">
        <tr><td style="padding:0"><div style="height:3px;background:linear-gradient(90deg,${MAIL.teal},${MAIL.mint});font-size:0;line-height:0">&nbsp;</div></td></tr>
        <tr><td style="padding:26px 32px 22px;border-bottom:1px solid ${MAIL.hair}">
          <span style="font-size:20px;font-weight:800;color:${MAIL.ink};letter-spacing:-0.4px">${BRAND_NAME}</span>
        </td></tr>
        <tr><td style="padding:32px">${content}</td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid ${MAIL.hair}">
          <p style="margin:0;font-size:12px;color:${MAIL.ink2};line-height:1.5">Frågor? Svara på det här mejlet.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* Kvittorutan. Belopp och konto ska gå att läsa utan att tänka, så etiketten
   står till vänster och värdet högerställt — samma uppställning som ett
   pappersvitto. */
function receipt(rows) {
  const cells = rows.map(([label, value, strong], i) => `
    <tr>
      <td style="font-size:13px;color:${MAIL.ink2};padding:${i ? "8px" : "0"} 0 0">${esc(label)}</td>
      <td align="right" style="font-size:13px;color:${MAIL.ink};font-weight:${strong ? "700" : "400"};padding:${i ? "8px" : "0"} 0 0">${esc(value)}</td>
    </tr>`).join("");
  return `<table cellpadding="0" cellspacing="0" width="100%" style="background:${MAIL.ground};border:1px solid ${MAIL.line};border-radius:8px;padding:16px 18px;margin:0 0 24px;box-sizing:border-box">${cells}</table>`;
}

function btn(href, label) {
  return `<a href="${href}" style="display:inline-block;background:${MAIL.accent};color:#ffffff;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none">${label}</a>`;
}

function btnGhost(href, label) {
  return `<a href="${href}" style="display:inline-block;border:1px solid rgba(0,183,217,.45);color:${MAIL.accent};font-size:14px;font-weight:600;padding:11px 24px;border-radius:8px;text-decoration:none">${label}</a>`;
}

function h1(text, color) {
  return `<h1 style="margin:0 0 14px;font-size:24px;font-weight:700;color:${color || MAIL.ink};line-height:1.25">${text}</h1>`;
}

function p(text) {
  return `<p style="margin:0 0 20px;font-size:15px;color:${MAIL.ink2};line-height:1.65">${text}</p>`;
}

function tpl_paymentConfirmed(email, planName, amountStr) {
  return wrap(
    h1("Betalning bekräftad") +
    p(`Ditt <strong style="color:${MAIL.ink}">${esc(planName)}</strong>-konto är aktiverat. Du kan börja direkt.`) +
    receipt([["Plan", planName, true], ["Belopp", `${amountStr} kr`], ["Konto", email]]) +
    btn(`${SITE_ORIGIN}/app.html`, `Öppna ${BRAND_NAME} →`)
  );
}

function tpl_renewalConfirmed(email, planName, amountStr) {
  return wrap(
    h1("Prenumerationen är förnyad") +
    p(`Din <strong style="color:${MAIL.ink}">${esc(planName)}</strong>-prenumeration förnyades automatiskt. Ingenting behöver göras.`) +
    receipt([["Plan", planName, true], ["Belopp", `${amountStr} kr`], ["Konto", email]]) +
    btnGhost(`${SITE_ORIGIN}/konto.html`, "Hantera prenumeration")
  );
}

function tpl_paymentFailed(email, planName) {
  return wrap(
    h1("Betalningen gick inte igenom", MAIL.danger) +
    p(`Vi kunde inte debitera kortet för din <strong style="color:${MAIL.ink}">${esc(planName)}</strong>-prenumeration.`) +
    p("Uppdatera betalningssättet så behåller du tillgången. Stripe försöker igen automatiskt några gånger — lyckas ingen av dem avslutas prenumerationen.") +
    btn(`${SITE_ORIGIN}/konto.html`, "Uppdatera betalningssätt →")
  );
}

function tpl_subscriptionCancelled(planName) {
  return wrap(
    h1("Prenumerationen är avslutad") +
    p(`Din <strong style="color:${MAIL.ink}">${esc(planName)}</strong>-prenumeration är avslutad. Kontot ligger kvar på gratisplanen — historiken och felbanken är orörda.`) +
    p("Du kan uppgradera igen när du vill.") +
    btnGhost(`${SITE_ORIGIN}/pricing.html`, "Se planer")
  );
}

/* Internt mejl till admin. Behöver inte se ut som ett kvitto, men ska vara
   läsbart i en notis på en telefon — därför samma typskala, ingen ram. */
function tpl_adminNotice(label, email, planName, amountStr) {
  const row = (k, v) => `<tr><td style="padding:6px 0;font-size:13px;color:${MAIL.ink2}">${esc(k)}</td><td style="padding:6px 0;font-size:13px;color:${MAIL.ink};font-weight:600">${esc(v)}</td></tr>`;
  return `<div style="font-family:Inter,'DM Sans',Arial,sans-serif;max-width:480px;color:${MAIL.ink}">
<h2 style="margin:0 0 16px;font-size:17px;font-weight:700;color:${MAIL.ink}">${esc(label)} — ${BRAND_NAME}</h2>
<table style="width:100%;border-collapse:collapse">
${row("E-post", email)}${row("Plan", planName)}${row("Belopp", amountStr + " kr")}${row("Tid", new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }))}
</table></div>`;
}

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

// ── Idempotency (see supabase/migrations/20260719_stripe_webhook_idempotency.sql) ──
// Claims event.id before processing, marks it completed afterwards, and releases the
// claim if processing throws so a genuine Stripe retry can reclaim and reprocess.
// A COMPLETED row means "fully handled" — a later redelivery short-circuits to a no-op 200.
//
// A claim that is neither completed nor released belongs to an invocation that died
// without raising a catchable error: the 10 s maxDuration in vercel.json, or the platform
// killing the process. Treating that as "handled" would leave a paying customer
// un-upgraded forever, since every subsequent redelivery would be waved through. So a
// stale incomplete claim is retaken instead.
//
// The window is long enough that a slow-but-alive invocation is never overtaken by a
// Stripe retry of the same event (Stripe's first retries arrive within minutes, and it
// keeps retrying for three days, so a genuinely dead claim is still reprocessed).
export const STALE_CLAIM_MS = 15 * 60 * 1000;

export async function claimEvent(eventId, supabaseClient = supabase, now = Date.now()) {
  const { error } = await supabaseClient
    .from("stripe_webhook_events")
    .insert({ event_id: eventId });
  if (!error) return true;
  if (error.code !== "23505") throw error;

  // The row exists. Whether this is a duplicate or a corpse depends on completed_at.
  const { data, error: readError } = await supabaseClient
    .from("stripe_webhook_events")
    .select("claimed_at, completed_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (readError) throw readError;
  if (!data || data.completed_at) return false;

  const staleBefore = new Date(now - STALE_CLAIM_MS).toISOString();
  if (!(data.claimed_at < staleBefore)) return false; // still in flight elsewhere

  // Retake it. The filters repeat the staleness test so that two Stripe retries racing
  // on the same dead claim cannot both win — whichever UPDATE lands first moves
  // claimed_at forward and the other one matches no rows.
  const { data: retaken, error: retakeError } = await supabaseClient
    .from("stripe_webhook_events")
    .update({ claimed_at: new Date(now).toISOString() })
    .eq("event_id", eventId)
    .is("completed_at", null)
    .lt("claimed_at", staleBefore)
    .select("event_id");
  if (retakeError) throw retakeError;
  return Array.isArray(retaken) && retaken.length > 0;
}

export async function completeEvent(eventId, supabaseClient = supabase, now = Date.now()) {
  const { error } = await supabaseClient
    .from("stripe_webhook_events")
    .update({ completed_at: new Date(now).toISOString() })
    .eq("event_id", eventId);
  // Best-effort: the work is already done and the customer is already upgraded. An
  // unmarked claim goes stale and may be reprocessed once, which costs a duplicate
  // email — the failure this whole table exists to make rare, not impossible.
  if (error) console.error("stripe-webhook: could not mark event complete", eventId, error);
}

async function releaseEvent(eventId) {
  try {
    await supabase.from("stripe_webhook_events").delete().eq("event_id", eventId);
  } catch { /* best-effort — a stuck claim just costs one retry window, not correctness */ }
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
  if (!event.id) return res.status(400).json({ error: "Missing event id" });

  let claimed;
  try {
    claimed = await claimEvent(event.id);
  } catch (err) {
    console.error("stripe-webhook: claim failed", err);
    return res.status(500).json({ error: "Could not record event" }); // let Stripe retry
  }
  if (!claimed) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
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
      } else {
        if (session.mode === "subscription") {
          const subscriptionId = session.subscription;
          const { error } = await supabase.from("profiles").upsert(
            { id: userId, role: PLAN_ROLES[plan], stripe_customer_id: customerId, stripe_subscription_id: subscriptionId },
            { onConflict: "id" }
          );
          if (error) throw new Error("subscription upsert failed: " + error.message);
        } else if (session.mode === "payment" && session.payment_status === "paid") {
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          const { error } = await supabase.from("profiles").upsert(
            { id: userId, role: PLAN_ROLES[plan], stripe_customer_id: customerId, swish_expires_at: expiresAt },
            { onConflict: "id" }
          );
          if (error) throw new Error("swish upsert failed: " + error.message);
        }

        const email = userEmail || await getUserEmail(userId);
        const planName = PLAN_NAMES[plan] || plan;
        if (email) {
          await sendEmail(email, `Betalning bekräftad — ${planName}`, tpl_paymentConfirmed(email, planName, amountKr));
        }
        await sendEmail(ADMIN_EMAIL, `Ny betalning — ${planName} (${email || userId})`, tpl_adminNotice("Ny betalning", email || userId, planName, amountKr));
      }
    }

    // ── customer.subscription.updated — plan change from portal ──
    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      if (sub.status === "active") {
        const userId = sub.metadata?.supabase_user_id || await getUserIdByCustomer(sub.customer);
        const plan = sub.metadata?.plan;
        if (userId && plan && PLAN_ROLES[plan]) {
          const { error } = await supabase.from("profiles").update({ role: PLAN_ROLES[plan] }).eq("id", userId);
          if (error) throw new Error("subscription update failed: " + error.message);
        }
      }
    }

    // ── invoice.payment_succeeded — monthly renewal ──
    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object;
      // Skip first payment — checkout.session.completed already covers it
      if (invoice.billing_reason === "subscription_cycle") {
        const email = invoice.customer_email;
        const role = await getRoleByCustomer(invoice.customer);
        const planName = PLAN_NAMES[role] || "din plan";
        const amountKr = invoice.amount_paid != null ? String(Math.round(invoice.amount_paid / 100)) : "—";

        if (email) {
          await sendEmail(email, `Prenumeration förnyad — ${planName}`, tpl_renewalConfirmed(email, planName, amountKr));
        }
        await sendEmail(ADMIN_EMAIL, `Förnyelse — ${planName} (${email || invoice.customer})`, tpl_adminNotice("Förnyelse", email || invoice.customer, planName, amountKr));
      }
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
        const { error } = await supabase.from("profiles")
          .update({ role: "gratis", stripe_subscription_id: null })
          .eq("id", userId);
        if (error) throw new Error("cancellation update failed: " + error.message);
        const email = await getUserEmail(userId);
        if (email) {
          await sendEmail(email, "Prenumeration avslutad", tpl_subscriptionCancelled(PLAN_NAMES[prevPlan] || prevPlan));
        }
      }
    }
  } catch (err) {
    console.error("stripe-webhook: processing failed, releasing claim for retry", event.id, event.type, err);
    await releaseEvent(event.id);
    return res.status(500).json({ error: "Processing failed" }); // Stripe will retry
  }

  await completeEvent(event.id);
  return res.status(200).json({ received: true });
}
