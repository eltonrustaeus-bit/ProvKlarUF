/* Genererar syntetiska "handskrivna" lösningar som PNG.
 *
 * Användning:  node tests/evals/solution-ocr/make-images.mjs
 *
 * VARNING OM VAD DEN HÄR SIFFRAN ÄR VÄRD.
 * Genererade bilder mäter INTE handskrift. En modell läser ett rent typsnitt
 * långt bättre än kladd i blyerts på rutat papper, så resultatet härifrån är
 * systematiskt för optimistiskt. Bilderna finns för att mätningen ska kunna
 * byggas och köras innan riktiga foton finns — inte för att avgöra vilken
 * modell OPENAI_VISION_MODEL ska peka på.
 *
 * Det beslutet kräver riktiga foton. Se README.md i samma katalog.
 *
 * Handstilstypsnitten är macOS-lokala med generiska fallbacks. Saknas de blir
 * bilderna maskinskrivna, vilket gör siffran ännu mer optimistisk — skriptet
 * säger till när det händer.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const OUT = join(HERE, "images");
mkdirSync(OUT, { recursive: true });

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const { cases } = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));

/* Rutat papper plus en handstilsliknande stil. Lätt rotation och varierande
   radhöjd så att raderna inte ligger perfekt — en perfekt uppställd bild är
   inte ens en approximation av ett elevpapper. */
function html(c) {
  const rader = c.lines.map((line, i) => {
    const struck = Array.isArray(c.strike) && c.strike.includes(i);
    const lut = (Math.random() * 2 - 1).toFixed(2);
    const vänster = Math.round(Math.random() * 14);
    return `<div class="rad${struck ? " struken" : ""}" style="transform:rotate(${lut}deg);margin-left:${vänster}px">${escape(line)}</div>`;
  }).join("");
  const marginal = c.margin ? `<div class="marginal">${escape(c.margin)}</div>` : "";
  return `<style>
    :root { color-scheme: light; }
    body {
      margin: 0; width: 900px; min-height: 620px; background: #fdfdf8;
      background-image:
        linear-gradient(#dfe6ef 1px, transparent 1px),
        linear-gradient(90deg, #dfe6ef 1px, transparent 1px);
      background-size: 28px 28px;
      font-family: "Bradley Hand", "Chalkboard", "Segoe Print", "Comic Sans MS", cursive;
      color: #21324a; padding: 54px 60px;
    }
    .rad { font-size: 40px; line-height: 1.85; white-space: pre; }
    .struken { text-decoration: line-through; text-decoration-thickness: 3px; }
    .marginal { position: absolute; top: 18px; right: 34px; font-size: 24px; color: #4a5a72; }
  </style>${marginal}${rader}`;
}

const escape = s => String(s).replace(/[&<>]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 2 });

/* Kontrollera att ett handstilstypsnitt faktiskt finns — annars är siffran
   ännu mindre värd och det ska sägas rakt ut, inte döljas. */
await page.setContent('<span id="p" style="font-family:cursive;font-size:40px">x</span><span id="q" style="font-family:\'Bradley Hand\',\'Chalkboard\',cursive;font-size:40px">x</span>');
const harHandstil = await page.evaluate(() => {
  const w = el => el.getBoundingClientRect().width;
  return w(document.getElementById("q")) !== w(document.getElementById("p"));
});

for (const c of cases) {
  await page.setContent(html(c));
  await page.waitForTimeout(60);
  const fil = join(OUT, c.id + ".png");
  await page.screenshot({ path: fil, fullPage: true });
  console.log("  skrev", c.id + ".png");
}

await browser.close();
console.log(`\n${cases.length} bilder i ${OUT}`);
if (!harHandstil) {
  console.log("VARNING: inget handstilstypsnitt hittades — bilderna är maskinskrivna.");
  console.log("Siffran blir då ännu mer optimistisk än den redan är.");
}
console.log("Kom ihåg: syntetiska bilder avgör INTE modellvalet. Se README.md.");
