// Single source of truth for the product's public brand name and origin.
// The exgen.se migration is done: exgen.se serves the app and proviaai.se
// 308-redirects to it. Keeping the old domain here only bought every Stripe
// redirect and email link an extra hop, so the default now names exgen.se
// directly. proviaai.se stays alive as a redirect for old links.
export const BRAND_NAME = "ExGen";
// No trailing slash — every call site does `${SITE_ORIGIN}/path`, so a
// trailing slash here would silently double up and break Stripe/Resend
// redirect and email links. Stripped defensively in case SITE_ORIGIN is
// ever set via env with one.
export const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://exgen.se").replace(/\/+$/, "");

// Domain the transactional mail is sent from. Deliberately separate from
// SITE_ORIGIN: the site can move to a new domain as soon as DNS points at
// Vercel, but the mail domain can only follow once Resend has verified DKIM
// and SPF for it — sending from an unverified domain makes Resend reject
// every message, so a premature flip silently kills welcome mails, payment
// receipts and admin sends. Flip the fallback below (or set MAIL_DOMAIN in
// Vercel) only once exgen.se shows "Verified" in the Resend dashboard.
export const MAIL_DOMAIN = (process.env.MAIL_DOMAIN || "proviaai.se").replace(/^@+/, "").trim();
// Every Resend call uses this — don't rebuild the from-string at call sites.
export const MAIL_FROM = `${BRAND_NAME} <noreply@${MAIL_DOMAIN}>`;
