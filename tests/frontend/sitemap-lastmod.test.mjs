// sitemap.xml måste vara sant, inte bara giltigt.
//
// Användning:  node tests/frontend/sitemap-lastmod.test.mjs   (exit 0 = pass)
//
// lastmod är en signal till Google om att en sida är värd att hämta om. Signalen är bara värd
// något så länge den stämmer: står det ett gammalt datum på en sida som ändrats sedan dess
// får crawlern skälet att låta bli. Låg 2026-08-19 kvar medan sidorna ändrats flera gånger.
//
// Testet jämför mot git, inte mot dagens datum — en sida som verkligen inte ändrats ska
// behålla sitt gamla datum. Ett svepande "sätt allt till idag" vore lika osant åt andra hållet.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failures = 0;
const check = (n, c, extra = "") => {
  if (c) console.log(`  PASS  ${n}${extra ? "  " + extra : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${extra ? "  " + extra : ""}`); }
};

const xml = readFileSync(join(root, "sitemap.xml"), "utf8");
const KARTA = {
  "https://exgen.se/": "index.html",
  "https://exgen.se/pricing.html": "pricing.html",
  "https://exgen.se/app.html": "app.html",
  "https://exgen.se/larare.html": "larare.html",
  "https://exgen.se/integritetspolicy.html": "integritetspolicy.html",
};

const gitDatum = (fil) => execFileSync("git",
  ["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d", "--", fil],
  { cwd: root, encoding: "utf8" }).trim();

console.log("\n— SITEMAP —");
const poster = [...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)];
check("alla fem sidor finns", poster.length === 5, `${poster.length}`);

for (const [, loc, lastmod] of poster) {
  const fil = KARTA[loc];
  check(`${loc} finns i kartan`, !!fil);
  if (!fil) continue;
  check(`${loc} har giltigt datumformat`, /^\d{4}-\d{2}-\d{2}$/.test(lastmod), lastmod);
  const sant = gitDatum(fil);
  // Får inte vara ÄLDRE än sista ändringen. Nyare är också fel — då ljuger den åt andra hållet.
  check(`${loc} matchar git`, lastmod === sant, `sitemap=${lastmod} git=${sant}`);
}

console.log(`\n${failures === 0 ? "OK" : `${failures} FEL`}`);
process.exit(failures === 0 ? 0 : 1);
