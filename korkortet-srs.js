"use strict";
// SM-2 Spaced Repetition System for ExGen körkortsteorin
// localStorage key: proviaai_srs2

const SRS_KEY = "proviaai_srs2";
const XP_KEY  = "proviaai_xp";
const DAILY_KEY = () => `proviaai_daily_${new Date().toISOString().slice(0,10)}`;

// ── SRS STORE ──
function getSrs() { try { return JSON.parse(localStorage.getItem(SRS_KEY)||"{}") } catch{ return {} } }
function setSrs(s) { localStorage.setItem(SRS_KEY, JSON.stringify(s)) }

// ── SM-2 ALGORITHM ──
// quality: 0=wrong, 1=wrong after hint, 2=barely right, 3=correct, 4=correct easy, 5=instant correct
function srsReview(questionId, quality) {
  const store = getSrs();
  const now = Date.now();
  const card = store[questionId] || { ef: 2.5, interval: 0, reps: 0, dueAt: now };

  if (quality < 3) {
    card.reps = 0;
    card.interval = 1;
  } else {
    if (card.reps === 0)      card.interval = 1;
    else if (card.reps === 1) card.interval = 6;
    else                      card.interval = Math.round(card.interval * card.ef);
    card.reps++;
    card.ef = Math.max(1.3, card.ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  }

  card.dueAt = now + card.interval * 86400000;
  card.lastSeen = now;
  card.lastQuality = quality;
  store[questionId] = card;
  setSrs(store);
}

// Map answer correctness + time to SM-2 quality score
function answerQuality(correct, elapsedMs) {
  if (!correct) return 0;
  if (elapsedMs < 2000)  return 5; // instant recall
  if (elapsedMs < 5000)  return 4; // quick
  if (elapsedMs < 12000) return 3; // correct but slower
  return 2; // very slow but correct — treat as borderline
}

// Questions due for review today
function getDueQuestions(questions) {
  const store = getSrs();
  const now = Date.now();
  return questions.filter(q => {
    const c = store[q.id];
    return c && c.dueAt <= now;
  }).sort((a, b) => (store[a.id].dueAt||0) - (store[b.id].dueAt||0));
}

// Count of due cards
function getDueCount(questions) {
  return getDueQuestions(questions).length;
}

// Cards seen today (for streak/goal tracking)
function getSeenToday() {
  try { return JSON.parse(localStorage.getItem(DAILY_KEY())||"[]") } catch { return [] }
}
function markSeenToday(questionId) {
  const seen = getSeenToday();
  if (!seen.includes(questionId)) { seen.push(questionId); localStorage.setItem(DAILY_KEY(), JSON.stringify(seen)); }
}

// Has the user memorized this question? (answered instantly ≥3 times)
function isMemoized(questionId) {
  const store = getSrs();
  const c = store[questionId];
  return c && c.reps >= 3 && c.ef >= 2.8; // high ease = always answered fast & correctly
}

// ── XP SYSTEM ──
function getXP() { return parseInt(localStorage.getItem(XP_KEY)||"0",10) }
function addXP(amount) {
  const total = getXP() + amount;
  localStorage.setItem(XP_KEY, String(total));
  return total;
}

const XP_LEVELS = [
  { min:0,    label:"Nybörjare",    icon:"🚗" },
  { min:50,   label:"Elev",         icon:"📚" },
  { min:150,  label:"Lärling",      icon:"🔑" },
  { min:300,  label:"Övningskörare",icon:"🛣️" },
  { min:500,  label:"Teoriexpert",  icon:"⭐" },
  { min:750,  label:"Körkortsredo", icon:"🏆" },
  { min:1000, label:"Mästare",      icon:"🎓" },
];

function getLevel(xp) {
  let level = XP_LEVELS[0];
  for (const l of XP_LEVELS) { if (xp >= l.min) level = l; else break; }
  const idx = XP_LEVELS.indexOf(level);
  const next = XP_LEVELS[idx + 1];
  const progress = next ? Math.round((xp - level.min) / (next.min - level.min) * 100) : 100;
  return { ...level, xp, next: next || null, progress };
}

// Daily goal: review 20 questions
const DAILY_GOAL = 20;
function getDailyProgress() {
  const seen = getSeenToday().length;
  return { done: seen, goal: DAILY_GOAL, pct: Math.min(100, Math.round(seen / DAILY_GOAL * 100)) };
}

// ── MEMORIZATION DETECTION ──
// Returns true if user's recent pattern suggests memorization, not understanding
function detectMemorization(questionId, answerTimeMs) {
  const store = getSrs();
  const c = store[questionId];
  if (!c || c.reps < 2) return false;
  return answerTimeMs < 2000 && c.reps >= 3;
}

// Export as globals (plain JS, no bundler)
window.SRS = {
  review: srsReview,
  quality: answerQuality,
  due: getDueQuestions,
  dueCount: getDueCount,
  seenToday: getSeenToday,
  markSeen: markSeenToday,
  isMemoized,
  detectMemorization,
};

window.XP = {
  get: getXP,
  add: addXP,
  level: getLevel,
  dailyProgress: getDailyProgress,
  DAILY_GOAL,
};
