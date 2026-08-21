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

const SEP = String.fromCharCode(0); // fältseparator mellan hash-fälten
// C0-styrtecken (kodpunkt 0–31) samt DEL (kodpunkt 127) saneras bort ur varje fältvärde innan
// de sätts ihop. JSON tillåter en bokstavlig sådan kodpunkt i en strängescape från klienten, så
// utan sanering kunde ett fältvärde som råkar innehålla SEP-tecknet imitera fältgränsen och
// låta t.ex. option_a/option_b glida i varandra. Det är detta saneringen faktiskt garanterar —
// inte att styrtecken "inte kan förekomma" i indata, bara att de aldrig når hash-strängen.
// Sidoeffekt: två fältvärden som skiljer sig endast i inbäddade styrtecken hashar identiskt.
const CONTROL_CODES = [...Array(32).keys()].concat(127);
const CONTROL_RE = new RegExp(`[${CONTROL_CODES.map((c) => String.fromCharCode(c)).join("")}]`, "gu");
const stripControl = (s) => s.replace(CONTROL_RE, "");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Kanoniseringskontraktet ur specen, i ordning. Hash-träffen står och faller med det.
 *  1. NFC   2. blanksteg  3. gemener med svenska diakriter bevarade
 *  4. avslutande frågetecken (?), utropstecken (!) och punkt (.) bort — komma, semikolon,
 *     kolon och annan avslutande interpunktion lämnas orörd, det är ett fast kontraktsvärde
 *     ur specen  5-6. inget annat rörs  7. trunkera till 500
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
    return sha256(`landing${SEP}${stripControl(normalizeQuestion(fields.question))}`);
  }
  if (lane === "explain") {
    const parts = [
      stripControl(normalizeQuestion(fields.question)),
      stripControl(String(fields.correct ?? "")),
      stripControl(String(fields.option_a ?? "")),
      stripControl(String(fields.option_b ?? "")),
      stripControl(String(fields.option_c ?? "")),
      stripControl(String(fields.option_d ?? "")),
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
const NEGATION_RE = /\b(inte|aldrig|utan|ej|icke|ingen|inget|inga)\b/gu;

// Utskrivna tal, sammansatta som ett ord på svenska ("tjugonio", "sjuttionio"). Hela
// sammansättningar (tiotal+ental) läggs i ordboken som egna nycklar så att t.ex. "tjugonio"
// (29) inte råkar tolkas som "tjugo" (20) plus ett bortglömt "nio" (9), och så att den skiljer
// sig från "sjuttionio" (79). \b används inte för att hitta orden — å/ä/ö räknas inte som \w i
// JS reguljära uttryck, så \b mellan t.ex. "n" och "å" i "trettionio" skulle aldrig matcha och
// tappa gränsen för ord som börjar eller slutar på en diakrit (t.ex. "åtta", "två"). Gränsen
// sätts i stället med lookaround mot bokstav/siffra.
const NUM_UNITS = ["noll", "ett", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio"];
const NUM_TEENS = ["tio", "elva", "tolv", "tretton", "fjorton", "femton", "sexton", "sjutton", "arton", "nitton"];
const NUM_TENS  = ["tjugo", "trettio", "fyrtio", "femtio", "sextio", "sjuttio", "åttio", "nittio"];

const NUM_WORDS = new Map();
NUM_UNITS.forEach((w, i) => NUM_WORDS.set(w, i));
NUM_TEENS.forEach((w, i) => NUM_WORDS.set(w, i + 10));
NUM_TENS.forEach((w, i) => NUM_WORDS.set(w, (i + 2) * 10));
NUM_WORDS.set("hundra", 100);
NUM_WORDS.set("tusen", 1000);
NUM_TENS.forEach((tensWord, i) => {
  const base = (i + 2) * 10;
  NUM_UNITS.slice(1).forEach((unitWord, j) => {
    NUM_WORDS.set(tensWord + unitWord, base + j + 1); // t.ex. tjugo+nio = 29, sjuttio+nio = 79
  });
});

// Hundra- och tusensammansättningar (enkel enheter + hundra/tusen).
NUM_UNITS.slice(1).forEach((unitWord, i) => {
  NUM_WORDS.set(unitWord + "hundra", (i + 1) * 100); // t.ex. etthundra = 100, tvåhundra = 200
  NUM_WORDS.set(unitWord + "tusen", (i + 1) * 1000); // t.ex. ettusen = 1000, tvåtusen = 2000
});

const NUM_WORD_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...NUM_WORDS.keys()].sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}\\p{N}])`,
  "gu",
);

const numbersIn = (t) => {
  const digits = (t.match(/\d+/gu) || []).map(Number);
  const words  = (t.match(NUM_WORD_RE) || []).map((w) => NUM_WORDS.get(w));
  return [...digits, ...words].sort((a, b) => a - b).join(",");
};

// Sammansatta planord ("premiumkontot", "basicabonnemang") skrivs ihop utan mellanslag på
// svenska — \b mellan två bokstavstecken matchar aldrig, så en \b-avgränsad regex missar dem
// helt. En vanlig delsträngsträff används i stället. Att den även träffar t.ex. "premiumaktig"
// är ofarligt: den enda kostnaden av en falsk skillnad här är en cache-miss, aldrig ett fel svar.
const plansIn   = (t) => PLAN_WORDS.filter((w) => t.includes(w)).join(",");
const negParity = (t) => (t.match(NEGATION_RE) || []).length % 2;

export function slotGuardOk(a, b) {
  const x = normalizeQuestion(a);
  const y = normalizeQuestion(b);
  return numbersIn(x) === numbersIn(y)
      && plansIn(x)   === plansIn(y)
      && negParity(x) === negParity(y);
}
