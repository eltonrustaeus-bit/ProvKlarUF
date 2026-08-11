/* Självtest för _harness.mjs.
 *
 * En delad rigg är värdelös om den delade koden är fel — då har felet bara
 * flyttat från fjorton ställen till ett. Den här filen finns för att den
 * historiska buggen inte ska kunna återuppstå tyst.
 *
 * Kärnfallet är H2: rectsOverlap matad med en riktig Playwright-boundingBox,
 * alltså {x, y, width, height}. Den gamla implementationen läste left/right/
 * top/bottom, fick undefined, och returnerade false för ALLA indata. Det testet
 * hade varit rött mot den och är grönt mot den här.
 *
 * Kräver ingen webbläsare utom i H10-H12, som mäter serverdelen.
 *
 * Användning:  node tests/frontend/_harness.test.mjs
 */

import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, AUTH_KEY, serve, rectsOverlap, sessionValue, report } from "./_harness.mjs";

const R = report("_harness");
const { ok } = R;
const okf = (l, c, d) => R.ok(l, c, d);

/* ── Geometri ───────────────────────────────────────────────────────────── */

// H1: uppenbart överlapp, i den form Playwright faktiskt lämnar.
okf("H1 två rutor som överlappar rapporteras som överlappande",
  rectsOverlap({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 }) === true);

// H2: REGRESSIONEN. Exakt fallet ur per-mobile.test.mjs — panelen över
// svarsalternativen vid 390x844, med de tal som mättes för hand.
// Den gamla funktionen returnerade false här, och det var hela buggen.
{
  const panel = { x: 34, y: 326, width: 340, height: 370 };
  const optC = { x: 20, y: 380, width: 350, height: 56 };
  okf("H2 panelen över alternativ C fångas (den historiska buggen)",
    rectsOverlap(panel, optC) === true, JSON.stringify({ panel, optC }));
}

// H3: rutor som bara nuddar kant mot kant överlappar inte.
okf("H3 kant mot kant är inget överlapp",
  rectsOverlap({ x: 0, y: 0, width: 50, height: 50 }, { x: 50, y: 0, width: 50, height: 50 }) === false);

// H4: åtskilda i y men överlappande i x.
okf("H4 åtskilda i höjdled är inget överlapp",
  rectsOverlap({ x: 0, y: 0, width: 100, height: 10 }, { x: 0, y: 200, width: 100, height: 10 }) === false);

// H5: en ruta helt inuti en annan.
okf("H5 inneslutning är överlapp",
  rectsOverlap({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 5, height: 5 }) === true);

// H6: nollyta. Ett dolt element har width 0 och kan inte skymma något.
okf("H6 nollbred ruta överlappar ingenting",
  rectsOverlap({ x: 0, y: 0, width: 0, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }) === false);

// H7: null betyder "elementet finns inte" och är inte ett fel.
okf("H7 null ger false utan att kasta", rectsOverlap(null, { x: 0, y: 0, width: 1, height: 1 }) === false);

// H8: DOMRect-formen accepteras också, så en anropare som skickar
// getBoundingClientRect() inte får tyst fel svar.
okf("H8 DOMRect-formen (left/top/right/bottom) förstås",
  rectsOverlap({ left: 0, top: 0, right: 100, bottom: 100 }, { left: 50, top: 50, right: 150, bottom: 150 }) === true);

// H9: en rect utan mått är en MÄTNING SOM INTE GICK ATT GÖRA. Den ska kasta,
// inte returnera false — annars ser den ut som "inget överlapp", vilket är
// exakt hur den gamla buggen kunde leva så länge.
{
  let threw = false;
  try { rectsOverlap({ foo: 1 }, { x: 0, y: 0, width: 1, height: 1 }); } catch (_) { threw = true; }
  okf("H9 rect utan mått kastar i stället för att låtsas mäta", threw);
}

/* ── Sessionen ──────────────────────────────────────────────────────────── */

{
  const s = JSON.parse(sessionValue());
  // Fälten är inte kosmetiska: utan refresh_token och expires_in godtar
  // shared.js inte sessionen och öppnar #pvModal över hela sidan.
  const krav = ["access_token", "refresh_token", "expires_in", "expires_at", "token_type", "user"];
  const saknas = krav.filter(k => !(k in s));
  okf("H10 sessionen har alla fält shared.js kräver", saknas.length === 0, saknas.join(", "));
  okf("H11 expires_at ligger i framtiden", s.expires_at > Math.floor(Date.now() / 1000), String(s.expires_at));
  okf("H12 nyckeln är projektets", AUTH_KEY.startsWith("sb-") && AUTH_KEY.endsWith("-auth-token"), AUTH_KEY);
}

/* ── Servern ────────────────────────────────────────────────────────────── */

{
  const a = await serve();
  const b = await serve();
  // Två servrar samtidigt utan att välja nummer. Fasta portar gjorde att två
  // filer båda stod på 4621 och en körning av hela sviten dog mitt i.
  okf("H13 två servrar får olika portar utan att någon väljer nummer",
    a.port !== b.port && a.port > 0 && b.port > 0, `${a.port} / ${b.port}`);

  const html = await fetch(`${a.url}/pricing.html`);
  okf("H14 serverar en fil ur repot", html.status === 200 && (await html.text()).includes("<!doctype html"),
    String(html.status));

  const miss = await fetch(`${a.url}/finns-inte-har.html`);
  okf("H15 saknad fil ger 404", miss.status === 404, String(miss.status));

  // En rigg som kan läsa vilken fil som helst på disken är en rigg som kan
  // ljuga om vad den läste.
  const esc = await fetch(`${a.url}/../../../../etc/passwd`);
  okf("H16 vägen ut ur trädet är stängd", esc.status === 403 || esc.status === 404, String(esc.status));

  const dir = await fetch(`${a.url}/tests`);
  okf("H17 en katalog serveras inte", dir.status === 404, String(dir.status));

  const css = await fetch(`${a.url}/exgen-ui.css`);
  okf("H18 rätt content-type på css", (css.headers.get("content-type") || "").startsWith("text/css"),
    css.headers.get("content-type") || "");

  await a.close(); await b.close();
}

/* ── Spärren mot att driften börjar om ─────────────────────────────────── */
//
// Riggen löser ingenting varaktigt om nästa fil bygger sin egen kopia igen.
// Det hände redan en gång: index-behaviour.mjs skrevs parallellt med riggen,
// kunde inte känna till den, och kom in med sin egen server på fast port 4623
// och sin egen sessionsseed. Två kopior inom samma vecka.
//
// Kontrollen nedan läser katalogen och letar efter de tre mönster som var
// upphovet till alla tre lögnerna. Den är avsiktligt formulerad som "finns
// någon annanstans än i riggen", inte som en stilregel — en fil som verkligen
// behöver något eget får skriva det, men då syns det här och någon får ta
// ställning i stället för att det glider in tyst.
{
  const dir = dirname(fileURLToPath(import.meta.url));
  const egna = { server: [], token: [], geometri: [] };
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".mjs") || f === "_harness.mjs" || f === "_harness.test.mjs") continue;
    const src = fs.readFileSync(join(dir, f), "utf8");
    // Kommentarer räknas inte — flera filer FÖRKLARAR varför de inte längre
    // gör det här, och en förklaring ska inte utlösa kontrollen.
    const kod = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/http\.createServer/.test(kod)) egna.server.push(f);
    if (/sb-mnmotdluigzeehdjbhbu-auth-token/.test(kod)) egna.token.push(f);
    if (/function\s+rectsOverlap|const\s+rectsOverlap\s*=/.test(kod)) egna.geometri.push(f);
  }
  okf("H20 ingen fil bygger en egen statisk server", egna.server.length === 0, egna.server.join(", "));
  okf("H21 ingen fil seedar sessionsnyckeln själv", egna.token.length === 0, egna.token.join(", "));
  okf("H22 ingen fil har en egen rectsOverlap", egna.geometri.length === 0, egna.geometri.join(", "));
}

/* ── Roten ──────────────────────────────────────────────────────────────── */

okf("H19 ROOT pekar på repots rot", fs.existsSync(ROOT + "/pricing.html") && fs.existsSync(ROOT + "/shared.js"), ROOT);

process.exit(R.finish());
