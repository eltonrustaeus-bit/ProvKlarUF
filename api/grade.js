// Vercel Serverless Function (Node.js)
// Tar { lang, pastedText, questions:[...], answers:[{id,answer}] }
// Returnerar { ok:true, result:{ total_points, max_points, per_question:[{id, points, max_points, feedback, model_answer, concept_tag?}] } }

function normalize(s) {
 return String(s || "")
 .toLowerCase()
 .replace(/[^\p{L}\p{N}\s-]/gu, " ")
 .replace(/\s+/g, " ")
 .trim();
}

function extractKeywords(material, limit = 12) {
 const words = normalize(material)
 .split(" ")
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

function clampInt(n, min, max) {
 n = Number(n);
 if (!Number.isFinite(n)) return min;
 return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseMcAnswerToIndex(ans) {
 const raw = String(ans || "").trim();
 if (!raw) return -1;

 const asNum = Number(raw);
 if (Number.isInteger(asNum) && asNum >= 0 && asNum <= 5) return asNum;

 const up = raw.toUpperCase();
 const m = up.match(/^([A-F])/);
 if (!m) return -1;
 const code = m[1].charCodeAt(0);
 const idx = code - 65;
 return (idx >= 0 && idx <= 5) ? idx : -1;
}

function scoreShortAnswer(answer, keywords, maxPoints) {
 const a = normalize(answer);
 if (!a) return { points: 0, hit: 0, len: 0 };

 let hit = 0;
 for (const k of keywords) {
 if (a.includes(k)) hit++;
 }

 const len = a.length;

 // Bas: andel träffar + minimilängd
 const denom = Math.max(3, Math.min(7, keywords.length));
 const ratio = Math.min(1, hit / denom);

 // Längdkomponent: korta svar tappar (men kan fortfarande få poäng)
 const lenFactor = (len >= 220) ? 1 : (len >= 120) ? 0.9 : (len >= 60) ? 0.75 : 0.55;

 const rawPts = ratio * maxPoints * lenFactor;
 const points = clampInt(Math.round(rawPts), 0, maxPoints);

 return { points, hit, len };
}

function buildShortFeedback(lang, points, maxPoints, hit, keywords, level, hasAnswer) {
 const sv = lang === "sv";
 const top = keywords.slice(0, 6);

 if (!hasAnswer) {
 return sv
 ? `Poäng: 0/${maxPoints}.\n- Inget svar eller tomt svar.\n- För full poäng: förklara med egna ord och använd centrala begrepp från materialet (t.ex. ${top.join(", ")}).`
 : `Score: 0/${maxPoints}.\n- No answer or empty answer.\n- For full score: explain in your own words and use key terms from the material (e.g. ${top.join(", ")}).`;
 }

 if (points === maxPoints) {
 return sv
 ? `Poäng: ${points}/${maxPoints}.\n- Täcker huvudidén och använder centrala begrepp.\n- Strukturen är tydlig.\n- Nästa steg: testa att skriva samma svar ännu mer precist med 1–2 nyckelbegrepp extra.`
 : `Score: ${points}/${maxPoints}.\n- Covers the main idea and uses key terms.\n- Clear structure.\n- Next step: rewrite it even more precisely with 1–2 additional key terms.`;
 }

 if (points === 0) {
 return sv
 ? `Poäng: 0/${maxPoints}.\n- Svaret saknar koppling till materialets centrala begrepp.\n- För full poäng: definiera/förklara huvudidén och använd minst 2–3 nyckelbegrepp (t.ex. ${top.slice(0, 3).join(", ")}).\n- Nästa steg: skriv 4–6 meningar som bygger upp en tydlig förklaring.`
 : `Score: 0/${maxPoints}.\n- The answer lacks connection to the material’s key terms.\n- For full score: explain the main idea and use at least 2–3 key terms (e.g. ${top.slice(0, 3).join(", ")}).\n- Next step: write 4–6 sentences that build a clear explanation.`;
 }

 const need = (level === "A") ? 3 : (level === "C") ? 2 : 1;
 const needText = sv
 ? (level === "A"
 ? "För A-nivå krävs tydlig motivering, korrekta begrepp och en genomtänkt struktur."
 : level === "C"
 ? "För C-nivå krävs tydlig förklaring och flera centrala begrepp."
 : "För E-nivå krävs en korrekt och begriplig grundförklaring.")
 : (level === "A"
 ? "For A-level you need clear justification, correct concepts, and a well-structured answer."
 : level === "C"
 ? "For C-level you need a clear explanation and multiple key terms."
 : "For E-level you need a correct basic explanation.");

 return sv
 ? `Poäng: ${points}/${maxPoints}.\n- Delvis korrekt, men täcker inte tillräckligt mycket av kärnan.\n- Nyckelbegrepp träffade: ${hit}.\n- För full poäng: använd minst ${need + 1} centrala begrepp (t.ex. ${top.join(", ")}) och skriv en kort motivering.\n- ${needText}`
 : `Score: ${points}/${maxPoints}.\n- Partly correct, but does not cover enough of the core idea.\n- Key terms matched: ${hit}.\n- For full score: use at least ${need + 1} key terms (e.g. ${top.join(", ")}) and add a short justification.\n- ${needText}`;
}

function gradeMc(answerValue, question, maxPoints, lang) {
 const sv = lang === "sv";
 const correctIndex = Number.isInteger(question.correct_index) ? question.correct_index : -1;
 const chosenIndex = parseMcAnswerToIndex(answerValue);

 if (correctIndex < 0 || !Array.isArray(question.options) || question.options.length < 2) {
 return {
 points: 0,
 feedback: sv
 ? "Poäng: 0/" + maxPoints + ".\n- Fel: saknar facit (correct_index) eller alternativ för denna flervalsfråga."
 : "Score: 0/" + maxPoints + ".\n- Error: missing answer key (correct_index) or options for this MC question.",
 model: String(question.model_answer || "—")
 };
 }

 const pts = (chosenIndex === correctIndex) ? maxPoints : 0;

 const correctLetter = String.fromCharCode(65 + correctIndex);
 const chosenLetter = (chosenIndex >= 0) ? String.fromCharCode(65 + chosenIndex) : "";

 const fb = (pts === maxPoints)
 ? (sv
 ? `Poäng: ${pts}/${maxPoints}.\n- Rätt.\n- Du valde ${chosenLetter}.`
 : `Score: ${pts}/${maxPoints}.\n- Correct.\n- You chose ${chosenLetter}.`)
 : (sv
 ? `Poäng: 0/${maxPoints}.\n- Fel.\n- Du valde ${chosenLetter || "inget giltigt alternativ"}, rätt svar är ${correctLetter}.\n- Jämför alternativen med materialets formuleringar och undvik att lägga till sådant som inte stöds.`
 : `Score: 0/${maxPoints}.\n- Incorrect.\n- You chose ${chosenLetter || "no valid option"}, correct answer is ${correctLetter}.\n- Compare each option to the material and avoid adding unsupported claims.`);

 return { points: pts, feedback: fb, model: String(question.model_answer || "—") };
}

function looksLikeMath(material, questions) {
 const qText = Array.isArray(questions)
 ? questions.map(q => String(q?.question || "")).join("\n")
 : "";
 const s = (String(material || "") + "\n" + qText).toLowerCase();
 const kw = [
 "matematik", "math", "algebra", "ekvation", "funktion", "polynom",
 "potens", "exponent", "log", "ln", "derivata", "integral",
 "geometri", "sannolikhet", "statistik", "bråk", "procent",
 "linjär", "kvadrat", "parabel", "f(x)"
 ];
 if (kw.some(k => s.includes(k))) return true;
 if (/[=<>]/.test(s) && /[xyz]/.test(s)) return true;
 if (/\b\d+\s*\/\s*\d+\b/.test(s)) return true;
 if (/[a-z]\s*\^\s*\d/.test(s)) return true;
 if (/\bf\(\s*x\s*\)/.test(s)) return true;
 return false;
}

function extractNumbersFromText(text, limit = 10) {
 const s = String(text || "");
 const m = s.match(/-?\d+(?:[.,]\d+)?/g) || [];
 const out = [];
 for (const raw of m) {
 const v = Number(String(raw).replace(",", "."));
 if (!Number.isFinite(v)) continue;
 out.push(v);
 if (out.length >= limit) break;
 }
 return out;
}

function parseSingleNumber(text) {
 const nums = extractNumbersFromText(text, 3);
 if (!nums.length) return null;
 return nums[0];
}

function nearlyEqual(a, b, eps) {
 const x = Number(a);
 const y = Number(b);
 if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
 const e = Number.isFinite(eps) ? eps : 1e-6;
 return Math.abs(x - y) <= e;
}

function scoreMathShortAnswer(answer, question, maxPoints, lang) {
 const sv = lang === "sv";
 const aRaw = String(answer || "").trim();
 const aNum = parseSingleNumber(aRaw);

 const modelText = String(question.model_answer || "");
 const expected = parseSingleNumber(modelText);

 if (!aRaw) {
 return {
 points: 0,
 feedback: sv
 ? `Poäng: 0/${maxPoints}.\n- Inget svar.\n- För full poäng: redovisa beräkning och ange ett slutsvar.`
 : `Score: 0/${maxPoints}.\n- No answer.\n- For full score: show your calculation and state a final answer.`,
 model: modelText
 };
 }

 if (expected === null || !Number.isFinite(expected)) {
 return {
 points: 0,
 feedback: sv
 ? `Poäng: 0/${maxPoints}.\n- Otillräckliga data (facit saknar tydligt talvärde).\n- För full poäng: ange ett numeriskt slutsvar och visa metod.`
 : `Score: 0/${maxPoints}.\n- Insufficient data (answer key lacks a clear numeric value).\n- For full score: provide a numeric final answer and show method.`,
 model: modelText
 };
 }

 if (aNum === null || !Number.isFinite(aNum)) {
 return {
 points: 0,
 feedback: sv
 ? `Poäng: 0/${maxPoints}.\n- Svaret saknar tydligt numeriskt slutsvar.\n- För full poäng: skriv ett tal som slutsvar (t.ex. x = 3) och visa beräkning.`
 : `Score: 0/${maxPoints}.\n- The answer lacks a clear numeric final answer.\n- For full score: provide a numeric final answer (e.g. x = 3) and show your calculation.`,
 model: modelText
 };
 }

 const eps = 1e-6;
 const ok = nearlyEqual(aNum, expected, eps);

 if (ok) {
 return {
 points: maxPoints,
 feedback: sv
 ? `Poäng: ${maxPoints}/${maxPoints}.\n- Rätt slutsvar: ${aNum}.\n- Nästa steg: kontrollera alltid med insättning eller rimlighetskontroll.`
 : `Score: ${maxPoints}/${maxPoints}.\n- Correct final answer: ${aNum}.\n- Next step: always verify by substitution or a quick reasonableness check.`,
 model: modelText
 };
 }

 return {
 points: 0,
 feedback: sv
 ? `Poäng: 0/${maxPoints}.\n- Fel slutsvar: ${aNum}.\n- Rätt svar (facit): ${expected}.\n- För full poäng: visa metod (omforma/beräkna stegvis) och avsluta med ett tydligt slutsvar.`
 : `Score: 0/${maxPoints}.\n- Incorrect final answer: ${aNum}.\n- Correct answer (key): ${expected}.\n- For full score: show method (step-by-step) and end with a clear final answer.`,
 model: modelText
 };
}

export default async function handler(req, res) {
 try {
 if (req.method !== "POST") {
 res.status(405).json({ ok: false, error: "Method not allowed" });
 return;
 }

 const body = req.body || {};
 const lang = (body.lang === "en") ? "en" : "sv";
 const material = String(body.pastedText || "");
 const questions = Array.isArray(body.questions) ? body.questions : [];
 const answers = Array.isArray(body.answers) ? body.answers : [];

 const aById = new Map(answers.map(a => [String(a.id), String(a.answer || "")]));
 const keywords = extractKeywords(material, 14);
 const isMath = looksLikeMath(material, questions);

 const per = [];
 let total = 0;
 let max = 0;

 for (const q of questions) {
 const id = String(q.id);
 const maxPoints = Number(q.points || 1);
 max += maxPoints;

 const ans = aById.get(id) || "";

 if (q.type === "mc") {
 const g = gradeMc(ans, q, maxPoints, lang);
 total += g.points;
 per.push({
 id,
 points: g.points,
 max_points: maxPoints,
 feedback: g.feedback,
 model_answer: g.model,
 concept_tag: "multiple_choice"
 });
 } else {
 const level = String(q.level || body.level || "C").toUpperCase();

 if (isMath) {
 const g = scoreMathShortAnswer(ans, q, maxPoints, lang);
 total += g.points;

 per.push({
 id,
 points: g.points,
 max_points: maxPoints,
 feedback: g.feedback,
 model_answer: g.model,
 concept_tag: "math_short_answer"
 });
 } else {
 const hasAnswer = !!normalize(ans);
 const r = scoreShortAnswer(ans, keywords, maxPoints);
 total += r.points;

 const model = String(q.model_answer || (
 (lang === "sv")
 ? `För full poäng: återge huvudidén korrekt och använd centrala begrepp från materialet (t.ex. ${keywords.slice(0, 6).join(", ")}).`
 : `For full points: state the main idea accurately and use key terms from the material (e.g. ${keywords.slice(0, 6).join(", ")}).`
 ));

 const feedback = buildShortFeedback(lang, r.points, maxPoints, r.hit, keywords, level, hasAnswer);

 per.push({
 id,
 points: r.points,
 max_points: maxPoints,
 feedback,
 model_answer: model,
 concept_tag: "short_answer"
 });
 }
 }
 }

 res.status(200).json({
 ok: true,
 result: {
 total_points: total,
 max_points: max,
 per_question: per
 }
 });
 } catch {
 res.status(500).json({ ok: false, error: "Server error" });
 }
}
