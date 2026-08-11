// scripts/check-local-assets.mjs — varje lokal bild som sidorna refererar måste finnas I REPOT.
//
// Bakgrunden är en riktig produktionsbugg, 2026-08-11: `image/ungdrive-icon.png` lades till,
// refererades från index.html och js/intro-splash.js, och committades aldrig. `.gitignore` rad 2
// är `*.png`, så `git add -A` hoppade tyst över den. Redan spårade PNG:er plockas upp när de
// ändras — det är därför den nedskalade `exgen-logo.png` gick igenom i samma commit — men en NY
// PNG gör det inte. Resultatet var 404 i produktion och ett trasigt bildikon i verktygsraden och
// sidfoten på varje sida.
//
// Filsystemet kan inte svara på frågan: filen låg på disk hela tiden. Kontrollen frågar därför
// git om innehållet i HEAD, inte om arbetskatalogen.
//
//   node scripts/check-local-assets.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Filer som kan referera en bild. CSS via url(), HTML via src/href, JS via strängar.
const SOURCE_EXT = new Set([".html", ".css", ".js", ".mjs"]);
const ASSET_EXT = /\.(png|jpe?g|webp|gif|svg|ico|avif)$/i;

// Produktytan: sidorna i roten, deras CSS, och klientskripten i js/. Det är det som en besökare
// kan begära och som därför kan 404:a för någon.
//
// Medvetet utanför:
//   scripts/   — bygg- och datafiler. scripts/add_images_and_fixes.js och
//                new_questions_batch3.js bär Wikimedia-FILNAMN som data (Sweden_road_sign_A8.svg)
//                och inte som referenser; 32 falska träffar om de tas med.
//   src/, api/ — kör på servern och serverar inga bilder.
//   instagram/ — engångsmaterial för marknadsföring, utanför produkten. Fyra av dess bilder
//                (post_01_stats.png m.fl.) saknas redan och har gjort det före den här filen.
//                Att låta dem fälla kontrollen vore att leverera en vakt som är röd på dag ett,
//                och en vakt ingen kan få grön är en vakt ingen läser.
const SCAN = [
  { dir: ROOT, recurse: false },        // *.html och *.css i roten
  { dir: path.join(ROOT, "js"), recurse: true },
];

function sourceFiles() {
  const out = [];
  for (const { dir, recurse } of SCAN) {
    if (!fs.existsSync(dir)) continue;
    const walk = d => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (recurse) walk(p); }
        else if (SOURCE_EXT.has(path.extname(e.name))) out.push(p);
      }
    };
    walk(dir);
  }
  return out;
}

// Spårade sökvägar i HEAD. `git ls-files` skulle också lista det som är stagat men inte
// committat, vilket gör kontrollen grön strax innan den borde vara röd.
const tracked = new Set(
  execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean)
);

// src="…", href="…", url(…) och nakna strängar i JS. Bara det som pekar på en bildändelse.
const REF = /(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)|["'](\/?(?:image|images|img|public|assets)\/[^"']+)["']/gi;

const missing = [];
let refs = 0;

for (const file of sourceFiles()) {
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(REF)) {
    const raw = (m[1] || m[2] || m[3] || "").trim();
    if (!raw || !ASSET_EXT.test(raw)) continue;
    if (/^(https?:|data:|\/\/|#|mailto:)/i.test(raw)) continue;   // externt eller inbäddat
    refs++;

    const clean = decodeURIComponent(raw.split("?")[0].split("#")[0]);
    // Rotrelativt löses mot reporoten; annars mot filens egen katalog. Sidorna ligger i roten,
    // så båda landar i praktiken på samma ställe — men CSS i en undermapp gör det inte.
    const abs = clean.startsWith("/")
      ? path.join(ROOT, clean.slice(1))
      : path.resolve(path.dirname(file), clean);
    const rel = path.relative(ROOT, abs);

    if (rel.startsWith("..")) continue;              // pekar utanför repot, inte vår sak
    if (tracked.has(rel)) continue;

    missing.push({
      ref: raw,
      from: path.relative(ROOT, file),
      onDisk: fs.existsSync(abs),
    });
  }
}

if (missing.length) {
  console.error(`Bilder som refereras men INTE finns i HEAD (${missing.length}):\n`);
  for (const m of missing) {
    // "finns på disk" är det farliga fallet: allt ser rätt ut lokalt och 404:ar i produktion.
    const note = m.onDisk
      ? "finns på disk men är inte committad — sannolikt bortfiltrerad av .gitignore, använd `git add -f`"
      : "finns inte alls";
    console.error(`  ✗ ${m.ref}\n      refererad från ${m.from}\n      ${note}`);
  }
  console.error(`\n${refs} referenser kontrollerade, ${missing.length} saknas.`);
  process.exit(1);
}

console.log(`Alla kontroller klara — ${refs} bildreferenser, samtliga spårade i HEAD.`);
