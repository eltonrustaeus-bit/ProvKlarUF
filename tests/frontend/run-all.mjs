/* Kör hela frontend-katalogen, en fil i taget, och sammanfattar.
 *
 * Fanns inte tidigare, och det var inte en förbiseelse utan en konsekvens:
 * filerna delade åtta fasta portnummer mellan sig, två av dem stod båda på
 * 4621, och ett försök att köra allt i följd dog mitt i med "Target page,
 * context or browser has been closed". Sviten gick bara att köra en fil åt
 * gången, för hand, och då blev den i praktiken aldrig körd hel.
 *
 * _harness.mjs binder numera port 0 och läser ut den tilldelade porten, så
 * kollisionen kan inte uppstå. Den här filen är kvittot på det.
 *
 * Serialiserat med flit. Varje fil startar en egen Chromium, och att köra
 * fjorton parallellt är ett minnesproblem, inte en tidsvinst.
 *
 * Användning:
 *   node tests/frontend/run-all.mjs
 *   node tests/frontend/run-all.mjs per-      # bara filer vars namn matchar
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || "";

/* _harness.mjs är ett bibliotek och ska inte köras. _harness.test.mjs är dess
   självtest och ska köras först av alla — är den röd betyder ingen annan rad
   i utskriften någonting. */
const files = readdirSync(HERE)
  .filter(f => f.endsWith(".mjs") && f !== "run-all.mjs" && f !== "_harness.mjs")
  .filter(f => !filter || f.includes(filter))
  .sort((a, b) => (a === "_harness.test.mjs" ? -1 : b === "_harness.test.mjs" ? 1 : a.localeCompare(b, "sv")));

if (!files.length) { console.log(`inga filer matchar "${filter}"`); process.exit(1); }

const run = file => new Promise(done => {
  const child = spawn(process.execPath, [join(HERE, file)], { cwd: join(HERE, "../.."), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", d => { out += d; });
  child.stderr.on("data", d => { out += d; });
  child.on("close", code => done({ file, code, out }));
});

const started = Date.now();
const results = [];
for (const file of files) {
  const r = await run(file);
  results.push(r);
  const last = r.out.trim().split("\n").filter(Boolean).pop() || "";
  console.log(`${r.code === 0 ? "  ok  " : "  FAIL"} ${file.padEnd(28)} ${last.slice(0, 70)}`);
  // Hela utskriften bara när något gick fel — en grön körning ska gå att läsa
  // på en skärm, en röd ska gå att felsöka utan att köras om.
  if (r.code !== 0) console.log(r.out.split("\n").map(l => "       │ " + l).join("\n"));
}

const failed = results.filter(r => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} filer gröna på ${Math.round((Date.now() - started) / 1000)}s`);
if (failed.length) console.log("röda: " + failed.map(f => f.file).join(", "));
process.exit(failed.length ? 1 : 0);
