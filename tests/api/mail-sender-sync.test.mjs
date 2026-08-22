// Avsändaradressen får finnas på ETT ställe.
//
// Användning:  node tests/api/mail-sender-sync.test.mjs   (exit 0 = pass)
//
// api/_site.js är sanningen: MAIL_FROM läses ur RESEND_FROM så att adressen kan bytas i
// Vercel utan kodändring och utan deploy. Den kopplingen finns för att den EN gång låg
// hårdkodad i fyra kopior över signup.js, stripe-webhook.js och admin.js.
//
// scripts/test-emails.js kan inte importera _site.js — skriptet körs som CommonJS och
// _site.js är ESM. En statisk import över den gränsen är exakt det som tog ned /api/explain
// i produktion. Kopian är alltså nödvändig, och därför måste den bevakas: det här testet
// finns för att en kopia som ingen jämför tyst glider isär.
//
// Skriptet självt gick förlorat en gång, när PR #77 stängdes som "överflödig" utan att någon
// märkte att den bar ett verktyg ingen annan PR hade.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failures = 0;
const check = (n, c) => { if (c) console.log(`  PASS  ${n}`); else { failures++; console.error(`  FAIL  ${n}`); } };

const site   = readFileSync(join(root, "api", "_site.js"), "utf8");
const script = readFileSync(join(root, "scripts", "test-emails.js"), "utf8");

console.log("\n— AVSÄNDAREN —");
// Samma miljövariabel i båda. Skriptet läste tidigare MAIL_DOMAIN, ett äldre utkast.
check("_site.js läser RESEND_FROM", /process\.env\.RESEND_FROM/.test(site));
check("skriptet läser RESEND_FROM", /process\.env\.RESEND_FROM/.test(script));
check("skriptet läser inte den gamla MAIL_DOMAIN",
  !/process\.env\.MAIL_DOMAIN/.test(script));

// Reservadressen måste vara identisk, annars går testmejlen från en annan avsändare än de
// riktiga — och testet skulle då bevisa fel sak om leveransen.
const fallback = (s) => (s.match(/noreply@([a-z0-9.-]+)/i) || [])[1];
check("samma reservdomän i båda", fallback(site) === fallback(script),
  );
console.log(`        _site.js: ${fallback(site)}   skriptet: ${fallback(script)}`);

console.log("\n— SKRIPTET —");
check("skriptet är CommonJS, inte ESM", !/^import\s/m.test(script));
check("skriptet importerar inte _site.js statiskt", !/require\(.*_site|from ["'].*_site/.test(script));
check("kräver RESEND_API_KEY innan det skickar", /RESEND_API_KEY/.test(script));
check("använder SITE_ORIGIN för länkar", /process\.env\.SITE_ORIGIN/.test(script));

console.log(`\n${failures === 0 ? "OK" : `${failures} FEL`}`);
process.exit(failures === 0 ? 0 : 1);
