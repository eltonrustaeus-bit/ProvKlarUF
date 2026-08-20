/**
 * Skickar varje mailmall till en testadress, så att de går att se i en riktig
 * inkorg innan de når en kund.
 *
 * Kör med:  RESEND_API_KEY=... node scripts/test-emails.js
 *
 * ── VARFÖR FILEN LÄSER KÄLLAN I STÄLLET FÖR ATT BÄRA EGNA MALLAR ────────────
 * Fram till 2026-08-20 hade det här skriptet en EGEN kopia av varje mall, med
 * en kommentar som påstod att den "återanvänder samma wrap() som
 * stripe-webhook.js". Det gjorde den inte. Kopiorna gled isär: produktionen
 * bytte till ExGens ljusa palett medan skriptet fortsatte visa ProviaAIs
 * mörkgröna, och länkarna pekade på en domän som numera bara omdirigerar.
 *
 * Ett förhandsverktyg som visar något annat än det som skickas är sämre än
 * inget förhandsverktyg — man tittar på fel mejl och tror att man kollat.
 *
 * Därför plockar filen ut mallarna ur produktionskoden vid körning. De
 * importeras inte, eftersom api/stripe-webhook.js och api/signup.js drar in
 * Stripe- och Supabase-klienter som kräver nycklar bara för att laddas. I
 * stället läses just mall-avsnitten och körs isolerat.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TO = process.env.TEST_EMAIL_TO || "elton.rustaeus@gmail.com";
const BRAND_NAME = "ExGen";
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://exgen.se").replace(/\/+$/, "");
// Samma default som api/_site.js. Byts när exgen.se är verifierad i Resend.
const FROM = process.env.RESEND_FROM || `${BRAND_NAME} <noreply@proviaai.se>`;
const API_KEY = process.env.RESEND_API_KEY;

/* Klipper ut ett avsnitt ur en källfil och kör det. Startmarkören måste vara
   ENTYDIG — ett klipp som utgår från en markör som förekommer två gånger tar
   med halva filen utan att kasta, och resultatet ser helt eller nästan helt
   ut. Samma fälla som kostade tid i förbättringssidans ombyggnad. */
function extract(file, startMark, endMark, exportNames) {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  const first = src.indexOf(startMark);
  if (first === -1) throw new Error(`hittade inte "${startMark}" i ${file}`);
  if (src.indexOf(startMark, first + 1) !== -1) throw new Error(`"${startMark}" är inte entydig i ${file}`);
  const end = src.indexOf(endMark, first);
  if (end === -1) throw new Error(`hittade inte "${endMark}" i ${file}`);
  const block = src.slice(first, end);
  const fn = new Function("BRAND_NAME", "SITE_ORIGIN", `${block}\nreturn { ${exportNames.join(", ")} };`);
  return fn(BRAND_NAME, SITE_ORIGIN);
}

const pay = extract(
  "api/stripe-webhook.js",
  "function esc(str) {",
  "async function getUserEmail(",
  ["tpl_paymentConfirmed", "tpl_renewalConfirmed", "tpl_paymentFailed", "tpl_subscriptionCancelled", "tpl_adminNotice"],
);

/* Startar vid escapeHtml, inte vid buildWelcomeHtml — mallen anropar den, och
   ett klipp som utelämnar den ger ett ReferenceError först vid rendering. */
const signup = extract(
  "api/signup.js",
  "function escapeHtml(str) {",
  "const supabase = createClient(",
  ["buildWelcomeHtml"],
);

const emails = [
  ["Välkommen till ExGen", signup.buildWelcomeHtml(TO)],
  ["Betalning bekräftad — Premium", pay.tpl_paymentConfirmed(TO, "Premium", "79")],
  ["Prenumerationen är förnyad — Basic", pay.tpl_renewalConfirmed(TO, "Basic", "29")],
  ["Betalningen gick inte igenom", pay.tpl_paymentFailed(TO, "Premium")],
  ["Prenumerationen är avslutad", pay.tpl_subscriptionCancelled("Premium")],
  ["[Admin] Ny betalning", pay.tpl_adminNotice("Ny betalning", TO, "Premium", "79")],
];

/* --dry skriver mallarna till disk i stället för att skicka dem. Ett
   förhandsverktyg som ALLTID skickar riktig e-post är ett verktyg man drar sig
   för att köra. */
if (process.argv.includes("--dry")) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const out = resolve(ROOT, ".test-out/emails");
  mkdirSync(out, { recursive: true });
  emails.forEach(([subject, html], i) => {
    const name = `${i + 1}-${subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.html`;
    writeFileSync(resolve(out, name), html);
    console.log("  " + name);
  });
  console.log(`\n${emails.length} mallar skrivna till .test-out/emails/ — inget skickat.`);
  process.exit(0);
}

if (!API_KEY) {
  console.error("Sätt RESEND_API_KEY i miljön, eller kör med --dry för att bara skriva filer.");
  process.exit(1);
}

async function send(subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: TO, subject, html }),
  });
  const body = await r.text();
  console.log(`${r.ok ? "ok  " : "FEL "} ${subject}${r.ok ? "" : " — " + body}`);
  return r.ok;
}

console.log(`Skickar ${emails.length} mallar till ${TO}\nAvsändare: ${FROM}\n`);
let failed = 0;
for (const [subject, html] of emails) {
  if (!(await send(subject, html))) failed++;
  await new Promise(ok => setTimeout(ok, 600)); // Resend har en takthastighetsgräns
}
process.exit(failed ? 1 : 0);
