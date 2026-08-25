/* Mäter hur väl avläsningen läser en handskriven matematiklösning.
 *
 * Användning:
 *   node tests/evals/solution-ocr/make-images.mjs          # en gång
 *   OPENAI_API_KEY=… node tests/evals/solution-ocr/run.mjs
 *   OPENAI_API_KEY=… OPENAI_VISION_MODEL=… node …/run.mjs  # jämför modeller
 *
 * Ligger MEDVETET utanför testsviten: den kostar API-anrop och kräver nyckel.
 * En svit som ska kunna köras gratis och offline får inte innehålla den.
 *
 * Två tal rapporteras, och det andra är det viktiga:
 *
 *   teckenfel (CER)      hur nära transkriptionen ligger facit
 *   bevarade fel         hur ofta modellen LÄT BLI att rätta elevens misstag
 *
 * En modell med låg CER som tyst rättar elevens fel är oanvändbar här. Då
 * bedöms eleven för ett arbete de inte utfört, felet når aldrig felbanken, och
 * mastery stiger på en kunskap de inte har. Bevarade fel ska vara 100%.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const require = createRequire(import.meta.url);
const S = require(join(ROOT, "api", "_solution-ocr.js"));

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("OPENAI_API_KEY saknas."); process.exit(1); }
const MODEL = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

const { cases } = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));

/* Levenshtein på tecken. Normaliserar bort det som inte är innehåll:
   LaTeX-avgränsare, blanksteg och tecken modellen rimligen kan skriva på två
   sätt (· eller *, ± eller +-). Ett teckenfel ska betyda ett LÄSFEL, inte ett
   notationsval. */
function normalisera(s) {
  return String(s || "")
    .replace(/\$/g, "")
    .replace(/\\cdot|\\times/g, "·").replace(/\*/g, "·")
    .replace(/\\pm/g, "±").replace(/\+-/g, "±")
    .replace(/\\sqrt/g, "√")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1/$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim().toLowerCase();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

async function läs(bildBas64, fråga) {
  const payload = {
    model: MODEL,
    input: [
      { role: "system", content: S.buildSolutionSystem("sv", fråga) },
      { role: "user", content: [
        { type: "input_image", image_url: "data:image/png;base64," + bildBas64 },
        { type: "input_text", text: "Transkribera lösningen i bilden." },
      ] },
    ],
    text: { format: S.SOLUTION_SCHEMA },
  };
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await r.text();
  if (!r.ok) throw new Error("OpenAI " + r.status + ": " + raw.slice(0, 200));
  return S.parseSolutionResponse(JSON.parse(raw));
}

console.log(`\nmodell: ${MODEL}\nfall:   ${cases.length}\n`);
console.log("fall".padEnd(22) + "CER".padStart(8) + "  regelbrott");
console.log("-".repeat(56));

let cerSumma = 0, tecken = 0, brott = 0, medFel = 0, körda = 0;

for (const c of cases) {
  const bild = join(HERE, "images", c.id + ".png");
  if (!existsSync(bild)) {
    console.log(c.id.padEnd(22) + "  saknas — kör make-images.mjs först");
    continue;
  }
  let ut;
  try { ut = await läs(readFileSync(bild).toString("base64"), c.question); }
  catch (e) { console.log(c.id.padEnd(22) + "  FEL: " + e.message.slice(0, 40)); continue; }

  körda++;
  const fick = normalisera(ut.text);
  const vill = normalisera(c.expected);
  const d = levenshtein(fick, vill);
  cerSumma += d; tecken += vill.length;
  const cer = vill.length ? d / vill.length : 0;

  /* Regelbrott: modellen skrev något den uttryckligen inte fick skriva.
     Det är allvarligare än ett teckenfel och räknas separat. */
  const brutna = (c.mustNotContain || []).filter(f => fick.includes(normalisera(f)));
  if (c.deliberateError) medFel++;
  if (brutna.length) brott++;

  console.log(
    c.id.padEnd(22) +
    (cer * 100).toFixed(1).padStart(7) + "%" +
    (brutna.length ? "  BROTT: " + brutna.join(", ") : "")
  );
  if (cer > 0.15) console.log("   fick: " + JSON.stringify(fick.slice(0, 90)));
}

console.log("-".repeat(56));
if (!körda) { console.log("inga fall kördes."); process.exit(1); }
const bevarade = medFel ? ((medFel - brott) / medFel) * 100 : 100;
console.log(`teckenfel (CER):  ${((cerSumma / (tecken || 1)) * 100).toFixed(1)}%   (lägre är bättre)`);
console.log(`bevarade fel:     ${bevarade.toFixed(0)}%   (MÅSTE vara 100%)`);
console.log(`regelbrott:       ${brott} av ${cases.length}`);
console.log("\nSyntetiska bilder. Modellvalet låses först mot riktiga foton — se README.md.");
