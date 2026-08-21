// api/_per-fingerprint.js — de rena funktioner svarscachen vilar på.
//
// Ingen I/O, inga projektberoenden. Allt här går att testa utan databas och utan nätverk,
// vilket är hela poängen med att hålla modulen skild från _per-cache.js.
//
// Två nycklar med olika uppgift:
//
//   payload_hash  — VILKEN fråga det är. För explain räcker inte frågetexten: prompten formas
//                   av facit och alla fyra alternativen (api/explain.js:609-622), så samma
//                   frågetext med ändrat facit måste ge en annan nyckel (Codex CR-CACHE-002).
//
//   fingerprint   — VILKEN VERSION av systemet som svarade. Ett tidigare utkast räknade upp
//                   promptens inputs; en sådan lista glider ur synk (PROVIA_KB byggs av
//                   PLAN_RULES, där priserna bor). Nu hashas i stället det renderade
//                   promptskelettet, så priser, MODULES, targets och founderAge() ingår
//                   automatiskt (Codex CR-CACHE-004/005).

import { createHash } from "node:crypto";

export const MAX_QUESTION_CHARS = 500;

const SEP = "\u0000"; // NUL kan inte förekomma i frågetext — fältgränsen går inte att förskjuta
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Kanoniseringskontraktet ur specen, i ordning. Hash-träffen står och faller med det.
 *  1. NFC   2. blanksteg  3. gemener med svenska diakriter bevarade
 *  4. avslutande skiljetecken bort  5-6. inget annat rörs  7. trunkera till 500
 */
export function normalizeQuestion(raw) {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("sv")
    .replace(/[?!.]+$/u, "")
    .trim()
    .slice(0, MAX_QUESTION_CHARS);
}

/** @param {'landing'|'explain'} lane */
export function payloadHash(lane, fields = {}) {
  if (lane === "landing") {
    return sha256(`landing${SEP}${normalizeQuestion(fields.question)}`);
  }
  if (lane === "explain") {
    const parts = [
      normalizeQuestion(fields.question),
      String(fields.correct ?? ""),
      String(fields.option_a ?? ""),
      String(fields.option_b ?? ""),
      String(fields.option_c ?? ""),
      String(fields.option_d ?? ""),
    ];
    return sha256(`explain${SEP}${parts.join(SEP)}`);
  }
  throw new Error(`okänd cache-lane: ${lane}`);
}

export function fingerprintOf(promptSkeleton, model = process.env.OPENAI_MODEL || "gpt-4o-mini") {
  return sha256(`${model}\n${String(promptSkeleton ?? "")}`);
}

// ── Slot-guard ──────────────────────────────────────────────────────────────
// Cosinus ensamt räcker inte (Codex CR-CACHE-011). "vad kostar Premium" och "vad kostar Basic"
// ligger högt över tröskeln och har motsatta svar. Detsamma gäller negation, som embeddings är
// notoriskt svaga på. En vektorträff får bara användas när alla tre slottarna är lika.

const PLAN_WORDS = ["gratis", "basic", "premium"];
const NEGATION_RE = /\b(inte|aldrig|utan|ej|icke)\b/gu;

const numbersIn = (t) => (t.match(/\d+/gu) || []).slice().sort().join(",");
const plansIn   = (t) => PLAN_WORDS.filter(w => new RegExp(`\\b${w}\\b`, "u").test(t)).join(",");
const negParity = (t) => (t.match(NEGATION_RE) || []).length % 2;

export function slotGuardOk(a, b) {
  const x = normalizeQuestion(a);
  const y = normalizeQuestion(b);
  return numbersIn(x) === numbersIn(y)
      && plansIn(x)   === plansIn(y)
      && negParity(x) === negParity(y);
}
