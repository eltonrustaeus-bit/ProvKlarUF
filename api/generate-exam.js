// Vercel Serverless Function (Node.js)
// Returnerar { ok:true, exam:{ title, level, questions:[{id, type, points, question, options?, correct_index, rubric, model_answer}] } }

function clampInt(n, min, max) {
 n = Number(n);
 if (!Number.isFinite(n)) return min;
 return Math.max(min, Math.min(max, Math.floor(n)));
}

function stableHash(str) {
 const s = String(str || "");
 let h = 2166136261;
 for (let i = 0; i < s.length; i++) {
  h ^= s.charCodeAt(i);
  h = Math.imul(h, 16777619);
 }
 return (h >>> 0);
}

function stableShuffle(arr, seed) {
 const a = arr.slice();
 let x = seed >>> 0;
 for (let i = a.length - 1; i > 0; i--) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  const j = x % (i + 1);
  const tmp = a[i];
  a[i] = a[j];
  a[j] = tmp;
 }
 return a;
}

function normalizeText(s) {
 return String(s || "")
  .replace(/\r/g, "\n")
  .replace(/\s+/g, " ")
  .trim();
}

function pickSentences(text, maxCount = 80) {
 const cleaned = String(text || "")
 .replace(/\r/g, "\n")
 .split("\n")
 .map(s => s.trim())
 .filter(Boolean);

 // Prioritera punktlistor/rubriker
 const bullets = cleaned.filter(l => /^[-•*]/.test(l)).map(l => l.replace(/^[-•*]\s*/, ""));
 const lines = bullets.length ? bullets : cleaned;

 const out = [];
 for (const l of lines) {
  // Split på enkla meningsgränser utan att bli för aggressiv
  const parts = l.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  for (const p of parts) {
   const s = normalizeText(p);
   if (s.length >= 18) out.push(s);
   if (out.length >= maxCount) return out;
  }
 }
 return out;
}

function extractTerms(s, limit = 10) {
 const words = String(s || "")
  .replace(/[^\p{L}\p{N}\s-]/gu, " ")
  .toLowerCase()
  .split(/\s+/)
  .filter(w => w.length >= 5);

 const stop = new Set([
  "dessa","detta","deras","vilket","vilken","vilka","alltså","också","ofta",
  "genom","utan","det","den","att","som","med","för","från","till","inom",
  "över","under","mellan","både","samt","därför","varför","här","där"
 ]);

 const freq = new Map();
 for (const w of words) {
  if (stop.has(w)) continue;
  freq.set(w, (freq.get(w) || 0) + 1);
 }

 return [...freq.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, limit)
  .map(([w]) => w);
}

function makeShortQuestionFromSentence(s, lang, level) {
 const sv = lang === "sv";
 const hasColon = /^\w+\s*:\s*/.test(s);
 const hasRule = /(=|≈|→|=>)/.test(s);
 const terms = extractTerms(s, 6);
 const t1 = terms[0] || "";

 if (hasColon) {
  const [head] = s.split(/:\s*/, 1);
  if (level === "A") {
   return sv
   ? `Definiera "${head}" och förklara hur det hänger ihop med minst ett relaterat begrepp från materialet.`
   : `Define "${head}" and explain how it connects to at least one related concept from the material.`;
  }
  if (level === "C") {
   return sv
   ? `Förklara begreppet "${head}" och ge ett tydligt exempel från materialets sammanhang.`
   : `Explain the concept "${head}" and give a clear example from the material context.`;
  }
  return sv
  ? `Beskriv kort vad "${head}" betyder.`
  : `Briefly describe what "${head}" means.`;
 }

 if (hasRule) {
  if (level === "A") {
   return sv
   ? `Tolka sambandet i påståendet: "${s}". Förklara vad varje del betyder och när det gäller.`
   : `Interpret the relationship in: "${s}". Explain what each part means and when it applies.`;
  }
  if (level === "C") {
   return sv
   ? `Förklara vad som menas med: "${s}" och skriv en kort motivering.`
   : `Explain what is meant by: "${s}" and give a short justification.`;
  }
  return sv
  ? `Förklara med egna ord vad detta betyder: "${s}".`
  : `Explain in your own words what this means: "${s}".`;
 }

 if (level === "A") {
  return sv
  ? `Analysera påståendet: "${s}". Vad är huvudidén, vilka begrepp är centrala och varför?`
  : `Analyze the statement: "${s}". What is the main idea, which concepts are central, and why?`;
 }

 if (level === "C") {
  return sv
  ? `Förklara huvudidén i: "${s}" och använd minst två centrala begrepp (${terms.slice(0, 2).join(", ") || "från materialet"}).`
  : `Explain the main idea in: "${s}" and use at least two key terms (${terms.slice(0, 2).join(", ") || "from the material"}).`;
 }

 return sv
 ? `Sammanfatta och förklara: "${s}"${t1 ? ` (använd begreppet "${t1}")` : ""}.`
 : `Summarize and explain: "${s}"${t1 ? ` (use the term "${t1}")` : ""}.`;
}

function makeMcBundleFromSentence(s, lang, level) {
 const sv = lang === "sv";
 const terms = extractTerms(s, 8);
 const key = terms.slice(0, 3).join(", ");
 const base = s.length > 120 ? (s.slice(0, 118) + "…") : s;

 const correct = sv
 ? `Stämmer med materialet: "${base}"`
 : `Matches the material: "${base}"`;

 let wrong1 = sv
 ? `Blandar ihop begrepp (${key || "centrala begrepp"}) och drar en fel slutsats.`
 : `Confuses concepts (${key || "key concepts"}) and draws an incorrect conclusion.`;

 let wrong2 = sv
 ? `Överdriver påståendet och gör det mer generellt än materialet stödjer.`
 : `Overstates the claim and makes it more general than the material supports.`;

 let wrong3 = sv
 ? `Motsäger materialets huvudpoäng i detta avsnitt.`
 : `Contradicts the material’s main point in this section.`;

 if (level === "A") {
  wrong1 = sv
  ? `Byter orsak–verkan eller villkor i resonemanget (typiskt A-fel).`
  : `Swaps cause–effect or conditions in the reasoning (common advanced mistake).`;
 }

 const optionsRaw = [
  { text: correct, isCorrect: true },
  { text: wrong1, isCorrect: false },
  { text: wrong2, isCorrect: false },
  { text: wrong3, isCorrect: false }
 ];

 const seed = stableHash(s + "|" + lang + "|" + level);
 const shuffled = stableShuffle(optionsRaw, seed);
 const options = shuffled.map(o => o.text);
 const correct_index = shuffled.findIndex(o => o.isCorrect);

 const question = sv
 ? `Vilket påstående stämmer bäst med materialet?`
 : `Which statement best matches the material?`;

 const rubric = sv
 ? (level === "A"
  ? "Välj korrekt alternativ. Visa att du kan skilja korrekt tolkning från subtila fel (begrepp/orsak–verkan/överdrift)."
  : level === "C"
  ? "Välj korrekt alternativ. Undvik begreppsförväxling och överdrift."
  : "Välj korrekt alternativ.")
 : (level === "A"
  ? "Select the correct option. Distinguish accurate interpretation from subtle errors (concepts/cause–effect/overstatement)."
  : level === "C"
  ? "Select the correct option. Avoid concept confusion and overstatement."
  : "Select the correct option.");

 const model_answer = sv
 ? "Rätt alternativ är det som återger materialets innebörd utan att lägga till eller motsäga något."
 : "The correct option is the one that reflects the material without adding unsupported claims or contradicting it.";

 return { question, options, correct_index, rubric, model_answer };
}

export default async function handler(req, res) {
 try {
  if (req.method !== "POST") {
   res.status(405).json({ ok: false, error: "Method not allowed" });
   return;
  }

  const body = req.body || {};
  const lang = (body.lang === "en") ? "en" : "sv";
  const level = String(body.level || "C").toUpperCase();
  const qType = String(body.qType || "mix");
  const num = clampInt(body.numQuestions ?? 12, 3, 20);
  const pastedText = String(body.pastedText || "").trim();
  const course = String(body.course || "").trim();

  if (!pastedText) {
   res.status(400).json({ ok: false, error: (lang === "sv") ? "Material saknas." : "Missing material." });
   return;
  }

  const sents = pickSentences(pastedText, 120);
  if (!sents.length) {
   res.status(400).json({ ok: false, error: (lang === "sv") ? "Kunde inte tolka material." : "Could not parse material." });
   return;
  }

  const questions = [];
  for (let i = 0; i < num; i++) {
   const s = sents[i % sents.length];
   const id = String(i + 1);

   const type =
   (qType === "mc") ? "mc" :
   (qType === "short") ? "short" :
   (i % 3 === 0 ? "mc" : "short");

   const points =
   (type === "mc")
   ? ((level === "A") ? 2 : (level === "C") ? 1 : 1)
   : ((level === "A") ? 4 : (level === "C") ? 3 : 2);

   if (type === "mc") {
    const bundle = makeMcBundleFromSentence(s, lang, level);
    questions.push({
     id,
     type: "mc",
     points,
     question: bundle.question + ((lang === "sv") ? ` (Bas: "${s.slice(0, 80)}…")` : ` (Base: "${s.slice(0, 80)}…")`),
     options: bundle.options,
     correct_index: bundle.correct_index,
     rubric: bundle.rubric,
     model_answer: bundle.model_answer
    });
   } else {
    const qText = makeShortQuestionFromSentence(s, lang, level);
    const terms = extractTerms(s, 6);
    const sv = lang === "sv";

    const rubric =
    sv
    ? (level === "A"
     ? "Full poäng: korrekt förklaring + tydlig koppling till begrepp i materialet + strukturerat svar med motivering."
     : level === "C"
     ? "Full poäng: korrekt förklaring + minst två centrala begrepp + tydlig motivering/exempel."
     : "Full poäng: korrekt och begriplig förklaring med koppling till materialet.")
    : (level === "A"
     ? "Full score: correct explanation + clear link to material concepts + structured answer with justification."
     : level === "C"
     ? "Full score: correct explanation + at least two key terms + clear justification/example."
     : "Full score: correct, clear explanation connected to the material.");

    const model_answer =
    sv
    ? `Ett fullpoängssvar återger huvudidén korrekt och använder centrala begrepp (${terms.slice(0, 4).join(", ") || "från materialet"}) på rätt sätt.`
    : `A full-score answer states the main idea accurately and uses key terms (${terms.slice(0, 4).join(", ") || "from the material"}) correctly.`;

    questions.push({
     id,
     type: "short",
     points,
     question: qText,
     options: [],
     correct_index: -1,
     rubric,
     model_answer
    });
   }
  }

  const exam = {
   title: (lang === "sv")
   ? (course ? `Mockprov – ${course}` : "Mockprov")
   : (course ? `Mock exam – ${course}` : "Mock exam"),
   level,
   questions
  };

  res.status(200).json({ ok: true, exam });
 } catch (e) {
  res.status(500).json({ ok: false, error: "Server error" });
 }
}
