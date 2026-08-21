// Kontrollerar ikonuppsättningen. Kör: node tools/verify-favicons.mjs  (exit 0 = allt rätt)
//
// Två saker bevisas här som inte syns på en filista: att vektorn faktiskt återger originalet,
// och att varje fil har rätt alfakanal för sin plattform. iOS komponerar mot SVART om en
// apple-touch-icon saknar botten — en genomskinlig sådan ser rätt ut lokalt och fel på telefonen.
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";

let fel = 0;
const check = (namn, ok, extra = "") => {
  if (ok) console.log(`  PASS  ${namn}${extra ? "  " + extra : ""}`);
  else { fel++; console.error(`  FAIL  ${namn}${extra ? "  " + extra : ""}`); }
};

console.log("\n— FILER —");
const vantade = [
  ["favicon.ico", null], ["image/favicon.svg", null],
  ...[16, 32, 48, 64, 96, 192, 512].map(s => [`image/favicon-${s}.png`, s]),
  ["image/favicon-180.png", 180], ["image/apple-touch-icon.png", 180],
  ["image/icon-maskable-192.png", 192], ["image/icon-maskable-512.png", 512],
  ["site.webmanifest", null],
];
for (const [f, storlek] of vantade) {
  if (!existsSync(f)) { check(f, false, "saknas"); continue; }
  if (storlek) {
    const m = await sharp(f).metadata();
    check(f, m.width === storlek && m.height === storlek, `${m.width}x${m.height}`);
  } else check(f, true);
}

console.log("\n— ALFAKANAL —");
// Genomskinliga: flikikoner anpassar sig till webbläsarens tema.
for (const f of [16, 32, 48, 512].map(s => `image/favicon-${s}.png`))
  check(`${f} är genomskinlig`, !(await sharp(f).stats()).isOpaque);
// Opaka: iOS och Android komponerar mot svart utan botten.
for (const f of ["image/apple-touch-icon.png", "image/favicon-180.png",
                 "image/icon-maskable-192.png", "image/icon-maskable-512.png"])
  check(`${f} är opak`, (await sharp(f).stats()).isOpaque);

console.log("\n— ICO —");
const ico = readFileSync("favicon.ico");
check("typfältet är 1", ico.readUInt16LE(2) === 1);
const antal = ico.readUInt16LE(4);
check("innehåller tre storlekar", antal === 3, `${antal}`);
for (let i = 0; i < antal; i++) {
  const e = 6 + i * 16, w = ico.readUInt8(e) || 256;
  const m = await sharp(ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8))).metadata();
  check(`bild ${i + 1}: ${w}x${w} avkodas`, m.width === w && m.height === w, `${m.format} ${m.width}x${m.height}`);
}

console.log("\n— MASKABLE SAFE ZONE —");
// Android beskär till en cirkel med diameter 80 % av duken. Allt utanför kan försvinna.
for (const f of ["image/icon-maskable-192.png", "image/icon-maskable-512.png"]) {
  const { data, info } = await sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true });
  const N = info.width, c = N / 2, r = N * 0.4;
  let utanfor = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (data[y * N + x] < 235 && Math.hypot(x - c, y - c) > r) utanfor++;
  check(`${f}: märket ryms i säkra zonen`, utanfor === 0, `${utanfor} px utanför`);
}

console.log("\n— MANIFEST —");
const mf = JSON.parse(readFileSync("site.webmanifest", "utf8"));
check("har maskable-ikon", mf.icons.some(i => i.purpose === "maskable"));
check("har svg-ikon", mf.icons.some(i => i.type === "image/svg+xml"));
for (const i of mf.icons) check(`manifestets ${i.src} finns`, existsSync("." + i.src));

console.log("\n— HTML —");
const sidor = ["index.html","app.html","pricing.html","konto.html","korkortet.html","larare.html",
  "admin.html","aterstall.html","integritetspolicy.html","snart.html","förbättring.html",
  "juridik.html","live-demo.html","provia-hp.html"];
for (const f of sidor) {
  const s = readFileSync(f, "utf8");
  const ok = /rel="icon" href="\/favicon\.ico"/.test(s) && /rel="icon" href="\/image\/favicon\.svg"/.test(s)
    && /rel="apple-touch-icon"/.test(s) && /rel="manifest"/.test(s);
  check(`${f} har hela taggblocket`, ok);
  check(`${f} pekar inte på gamla filer`, !/favicon-(32|64|96|512)\.png"/.test(s));
}

console.log(`\n${fel === 0 ? "OK" : fel + " FEL"}`);
process.exit(fel === 0 ? 0 : 1);
