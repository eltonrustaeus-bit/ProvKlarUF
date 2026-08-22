// Ingen live-sida får hämta en BILD från en främmande domän.
//
// Användning:  node tests/frontend/no-third-party-images.test.mjs   (exit 0 = pass)
//
// Sju av åtta sidor hämtade en gång en 1024px-ikon från ungdrive.se för att rita den i 12x12.
// js/exgen-shell.js löste det med en lokal fil på 2,4 kB, men korkortet.html och live-demo.html
// låg kvar på fjärrbilden. Tre skäl till att det spelar roll:
//
//   1. Varje sidladdning skickar besökarens IP till en domän vi inte äger — på en sajt med
//      integritetspolicy och till stor del minderåriga användare.
//   2. Går den domänen ner går bilden sönder. Det observerades i praktiken: en genomsökning
//      med Playwright visade net::ERR_ABORTED mot just den adressen.
//   3. En bild på 1024 px ritas i 12 px. Hela nedladdningen är bortkastad.
//
// Partnerlänken till ungdrive.se är avsiktlig och rörs inte — det är bara BILDEN som ska
// ligga lokalt.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  PASS  ${name}${extra ? "  " + extra : ""}`);
  else { failures++; console.error(`  FAIL  ${name}${extra ? "  " + extra : ""}`); }
};

// Live-sidor. instagram/ och docs/ är mallar respektive intern dokumentation, inte webbsidor.
const SIDOR = readdirSync(root)
  .filter(f => f.endsWith(".html") && f !== "google52ca1d3d9412d7b8.html");

const IMG_ABSOLUT = /<img[^>]+src=["'](https?:)?\/\/([^"'\/]+)[^"']*["']/gi;

console.log("\n— INGA BILDER FRÅN FRÄMMANDE DOMÄN —");
check("hittar sidor att granska", SIDOR.length > 0, `${SIDOR.length} st`);

for (const f of SIDOR) {
  const kalla = readFileSync(join(root, f), "utf8");
  const varden = [...kalla.matchAll(IMG_ABSOLUT)].map(m => m[2]);
  check(f, varden.length === 0, varden.length ? varden.join(", ") : "");
}

// Motprov: utan det här är alla PASS ovan meningslösa.
console.log("\n— MOTPROV —");
const traffar = s => [...s.matchAll(new RegExp(IMG_ABSOLUT.source, "gi"))].length;
check("regexen fångar en fjärrbild", traffar('<img src="https://annan.se/a.png">') === 1);
check("regexen fångar protokollrelativ adress", traffar('<img src="//annan.se/a.png">') === 1);
check("regexen fångar INTE en lokal absolut sökväg", traffar('<img src="/image/a.png">') === 0);
check("regexen fångar INTE en relativ sökväg", traffar('<img src="image/a.png">') === 0);

console.log(`\n${failures === 0 ? "OK" : `${failures} FEL`}`);
process.exit(failures === 0 ? 0 : 1);
