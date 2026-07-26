// Single source of truth for the product's public brand name and origin.
// SITE_ORIGIN stays on the current live domain until exgen.se is
// registered, added to Vercel, and DNS-verified — flip this one value
// (or set SITE_ORIGIN env var) when that's done, instead of hunting
// hardcoded URLs across api/*.js again.
export const BRAND_NAME = "ExGen";
// No trailing slash — every call site does `${SITE_ORIGIN}/path`, so a
// trailing slash here would silently double up and break Stripe/Resend
// redirect and email links. Stripped defensively in case SITE_ORIGIN is
// ever set via env with one.
export const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://proviaai.se").replace(/\/+$/, "");
