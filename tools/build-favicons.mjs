// Bygger ExGens hela ikonuppsättning ur EN geometrikälla.
//
// Märket är vektoriserat, inte nedskalat ur PNG:en. Skälet är de små storlekarna: en 16 px-ikon
// nedskalad från 1254 px blir mjuk, medan en vektor renderas med skarpa kanter i varje storlek.
// Geometrin är uppmätt ur originalet — kantlutning, streckbredd, glapp och gradientens ändpunkter
// — och avvikelsen är verifierad till ~2,5 % av tools/verify-favicons.mjs, inte antagen.
//
// Kör:  node tools/build-favicons.mjs

import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";

// Uppmätt ur originalbilden (bbox 732x625 px).
const M = { W: 1171.2, H: 1000, sw: 248.5, g: 98, k: 0.955 };
const GRAD = ["#04a09e", "#87ca7f"];   // vänster- respektive högerände av gradienten
const OUT = "image";

/**
 * @param {number} pad   marginal som andel av märkets storlek
 * @param {string} bg    bottenfärg, eller null för genomskinlig
 * @param {number} scale krymper märket inom duken (maskable safe zone)
 * @param {number} gMul  multiplikator på glappet — optisk kompensation i små storlekar
 */
function mark({ pad = 0.03, bg = null, scale = 1, gMul = 1 } = {}) {
  const { W, H, sw, k } = M, g = M.g * gMul;
  const half = H / 2, ax = k * half;
  const chevron = [[0,0],[sw,0],[ax+sw,half],[sw,H],[0,H],[ax,half]];
  const y1 = (W - sw - g) / (2*k), y2 = (W - 2*sw - g) / (2*k);
  const upper = [[W-sw,0],[W,0],[W-k*y1,y1],[W-sw-k*y2,y2]];
  const lower = upper.map(([x,y]) => [x, H - y]);

  // Kvadratisk duk — märket är bredare än högt och centreras i båda led.
  const side = Math.max(W, H) * (1 + pad * 2);
  const ox = (side - W) / 2, oy = (side - H) / 2, c = side / 2;
  const pts = p => p.map(([x,y]) =>
    `${(c + (x + ox - c) * scale).toFixed(2)},${(c + (y + oy - c) * scale).toFixed(2)}`).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side.toFixed(2)} ${side.toFixed(2)}" role="img" aria-label="ExGen">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${GRAD[0]}"/><stop offset="1" stop-color="${GRAD[1]}"/></linearGradient></defs>
${bg ? `<rect width="${side.toFixed(2)}" height="${side.toFixed(2)}" fill="${bg}"/>\n` : ""}<g fill="url(#g)"><polygon points="${pts(chevron)}"/><polygon points="${pts(upper)}"/><polygon points="${pts(lower)}"/></g>
</svg>`;
}

// librsvg rastrerar via density: px = viewBox-enheter * density / 72. Densityn räknas ut per SVG
// så att mastern alltid blir 1024 px, oavsett dukens enhetsstorlek.
const sideOf = svg => parseFloat(svg.match(/viewBox="0 0 ([\d.]+)/)[1]);
async function png(svg, size) {
  const density = Math.ceil(72 * 1024 / sideOf(svg));
  const master = await sharp(Buffer.from(svg), { density }).resize(1024, 1024).png().toBuffer();
  return sharp(master).resize(size, size, { kernel: "lanczos3" })
    .png({ compressionLevel: 9, effort: 10 }).toBuffer();
}

// ICO: ICONDIR + en ICONDIRENTRY per bild + PNG-nyttolaster. PNG i ICO stöds från Vista och är
// mindre än den gamla BMP-formen.
function ico(bilder) {
  const dir = Buffer.alloc(6 + 16 * bilder.length);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(bilder.length, 4);
  let offset = dir.length;
  bilder.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, e);
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1);
    dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(data.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([dir, ...bilder.map(b => b.data)]);
}

mkdirSync(OUT, { recursive: true });

// ── Flikikoner: genomskinliga, liten marginal. Utrymmet är dyrt i en flik. ──
const normal = mark({ pad: 0.03 });
// Vid 16-32 px är glappet drygt en pixel och suddas ut av kantutjämningen — då blir märket ett
// generiskt X och tappar det som gör det igenkännbart. Optisk kompensation: bredare glapp.
const liten = mark({ pad: 0.03, gMul: 1.5 });

writeFileSync(`${OUT}/favicon.svg`, normal);
for (const s of [16, 32]) writeFileSync(`${OUT}/favicon-${s}.png`, await png(liten, s));
for (const s of [48, 64, 96, 192, 512]) writeFileSync(`${OUT}/favicon-${s}.png`, await png(normal, s));

writeFileSync("favicon.ico", ico(await Promise.all(
  [16, 32, 48].map(async s => ({ size: s, data: await png(s <= 32 ? liten : normal, s) })))));

// ── iOS: komponerar mot svart om alpha saknas och beskär inte. Vit botten, rejäl marginal
//    eftersom systemet lägger på egna rundade hörn. ──
const apple = mark({ pad: 0.16, bg: "#ffffff" });
writeFileSync(`${OUT}/apple-touch-icon.png`, await png(apple, 180));
writeFileSync(`${OUT}/favicon-180.png`, await png(apple, 180));

// ── Maskable: Android beskär till cirkel eller squircle. Märket måste rymmas i 80 % säker zon. ──
const maskable = mark({ pad: 0.16, bg: "#ffffff", scale: 0.62 });
for (const s of [192, 512]) writeFileSync(`${OUT}/icon-maskable-${s}.png`, await png(maskable, s));

console.log("ikoner byggda i", OUT + "/ och favicon.ico");
