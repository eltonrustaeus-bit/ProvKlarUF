// Ikondeklarationerna i sidhuvudet.
//
// Användning:  node tests/frontend/favicon-declarations.test.mjs   (exit 0 = pass)
//
// Bakgrunden: Google visade Loopias favicon för exgen.se långt efter flytten.
// Uppmätt 2026-08-23 — Googles ikontjänst returnerade byte-identisk fil för
// exgen.se och loopia.se, medan en obefintlig domän fick en annan.
//
// Sajten serverade rätt ikon hela tiden. Men HTML:en deklarerade den SÄMSTA
// varianten: `sizes="32x32"` på en ICO som i själva verket bär 16, 32 och 48,
// och de färdiga 192- och 512-ikonerna fanns bara i webbmanifestet. Google
// läser `<link rel="icon">` för sökresultatens favicon, inte manifestet — så
// det bästa Google kunde hitta var en ikon som utgav sig för att vara 32 px,
// under Googles egen rekommendation på över 48 px.
//
// Testet låser att varje sida deklarerar en högupplöst kvadratisk ikon, och att
// ICO:ns storleksattribut inte ljuger om filens innehåll.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

/* Storlekarna läses ur ICO:ns katalog, inte ur ett antagande. Varje post är
   16 byte; byte 0 och 1 är bredd och höjd, där 0 betyder 256. */
function icoSizes(buf) {
  const n = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    out.push(`${buf[o] || 256}x${buf[o + 1] || 256}`);
  }
  return out;
}

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

console.log("\n— FILERNA —");

const ico = readFileSync(join(root, "favicon.ico"));
const sizes = icoSizes(ico);
check("favicon.ico bär 16, 32 och 48", ["16x16", "32x32", "48x48"].every(s => sizes.includes(s)), sizes.join(", "));

const png192 = pngSize(readFileSync(join(root, "image", "favicon-192.png")));
check("favicon-192.png är kvadratisk", png192.w === png192.h, `${png192.w}x${png192.h}`);
/* Google rekommenderar en favicon större än 48x48 för att den ska se bra ut på
   olika ytor. 192 ger marginal utan att bli en egen nedladdning av betydelse. */
check("favicon-192.png ligger över Googles 48px-rekommendation", png192.w > 48, `${png192.w}px`);

console.log("\n— DEKLARATIONERNA —");

const pages = readdirSync(root)
  .filter(f => f.endsWith(".html"))
  // Googles verifieringsfil är en enda textrad och ska inte ha sidhuvud.
  .filter(f => !/^google[0-9a-f]+\.html$/.test(f));

check("det finns sidor att kontrollera", pages.length >= 10, `${pages.length} sidor`);

for (const page of pages) {
  const html = readFileSync(join(root, page), "utf8");
  const links = html.match(/<link[^>]*rel="icon"[^>]*>/g) || [];

  check(`${page} deklarerar en högupplöst PNG-ikon`,
    links.some(l => l.includes("favicon-192.png") && l.includes('sizes="192x192"')));

  /* Ett storleksattribut som under-deklarerar filen är sämre än inget: det får
     Google att välja bort ikonen på just den grund attributet ljuger om. */
  const icoLink = links.find(l => l.includes("favicon.ico"));
  check(`${page} ljuger inte om ICO:ns storlekar`,
    !!icoLink && !/sizes="32x32"/.test(icoLink),
    icoLink ? (icoLink.match(/sizes="[^"]*"/) || ["utan sizes"])[0] : "ingen ICO-tagg");
}

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
