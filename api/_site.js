// Single source of truth for the product's public brand name and origin.
// exgen.se is registered, added to Vercel and DNS-verified since
// 2026-08-19, so SITE_ORIGIN points there. proviaai.se is kept as a
// permanent redirect to exgen.se, so old links in already-sent emails
// and Stripe receipts keep working.
//
// NOTE: this is the *web* origin only. The Resend sender address
// (noreply@proviaai.se) is a separate DNS-verified domain and is NOT
// derived from this value — changing it before exgen.se is verified in
// Resend would silently break every outgoing email.
export const BRAND_NAME = "ExGen";
// No trailing slash — every call site does `${SITE_ORIGIN}/path`, so a
// trailing slash here would silently double up and break Stripe/Resend
// redirect and email links. Stripped defensively in case SITE_ORIGIN is
// ever set via env with one.
export const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://exgen.se").replace(/\/+$/, "");

/* Avsändaradressen för allt utgående mejl, på ETT ställe.
 *
 * Låg tidigare hårdkodad i fyra kopior över signup.js, stripe-webhook.js och
 * admin.js — alltså fyra ställen att missa den dagen den ska bytas.
 *
 * VARFÖR DEN INTE ÄR exgen.se ÄN: det här är inte en textsträng utan en
 * DNS-verifierad avsändardomän hos Resend. Adressen kan bytas först när
 * exgen.se är tillagd i Resend och dess SPF- och DKIM-poster ligger i Loopias
 * DNS. Byter man före det slutar VARJE utgående mejl att gå fram —
 * välkomstmejl, betalningsbekräftelser, adminnotiser — och Resend svarar med
 * ett fel som ingen ser förrän en kund hör av sig.
 *
 * När domänen är verifierad: sätt RESEND_FROM i Vercel till
 * "ExGen <noreply@exgen.se>". Ingen kodändring, ingen deploy.
 */
export const MAIL_FROM = process.env.RESEND_FROM || `${BRAND_NAME} <noreply@proviaai.se>`;
