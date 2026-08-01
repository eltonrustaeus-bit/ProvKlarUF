# Exam-quality eval

Measures what a generator/verifier model swap actually buys for the school and
upper-secondary side of ExGen, so a model decision rests on numbers instead of
on how the output reads.

Runs the **real** production pieces — `buildExamPrompts()` from
`api/generate-exam.js`, `gateExam()` from `api/_assessment.js`, and
`verifyQuestions()` from `api/_verifier.js` — against six fixed course
materials, one per subject profile. It does not go through the HTTP endpoint,
so no account, quota or deploy is needed and any model combination can be
compared in one sitting. Auth, quota and persistence are therefore out of scope
here; the live smoke tests cover those.

## Running

Free, offline, no API key — always run this first:

```bash
node tests/evals/exam-quality/check-detection.mjs
```

Paid, hits the OpenAI API:

```bash
# today's production: gpt-4o-mini generating AND reviewing
node --env-file=.env.local tests/evals/exam-quality/run-eval.mjs

# a candidate: cheap generator, independent stronger reviewer
GEN_MODEL=gpt-4o-mini VERIFIER_MODEL=gpt-5-mini \
  node --env-file=.env.local tests/evals/exam-quality/run-eval.mjs

# one subject only, more repetitions
FIXTURES=matematik-2b RUNS=5 GEN_MODEL=gpt-5 \
  node --env-file=.env.local tests/evals/exam-quality/run-eval.mjs
```

| Env | Default | Meaning |
|---|---|---|
| `GEN_MODEL` | `gpt-4o-mini` | generator under test |
| `VERIFIER_MODEL` | same as `GEN_MODEL` | reviewer under test (the default reproduces production, where both roles share one model) |
| `JUDGE_MODEL` | `gpt-5` | independent scorer — should always be at least as strong as anything under test |
| `RUNS` | `2` | repetitions per fixture |
| `NUM_QUESTIONS` | `12` | questions per exam |
| `FIXTURES` | all | comma-separated fixture ids |
| `CONCURRENCY` | `3` | parallel generations |

Results and a separate disagreements file land in `results/` (git-ignored).

## What it measures

**Key-error rate — the headline.** An independent judge re-solves every
multiple-choice item from the material and options only. It never sees
`correct_index`, `model_answer` or `source_references`, so agreement is not a
rubber stamp. This is the failure mode `api/hp.js:571` already documents for the
quantitative HP delprov: the explanation is right and the answer key points at
the wrong option. A student who answers correctly is marked wrong.

Only disagreements where the judge reports confidence ≥ 0.8 count as key errors.
Lower-confidence disagreements are counted separately, because on an interpretive
social-studies item the judge can be the one who is wrong. **Every disagreement
is written to `*__disagreements.json` — read them before drawing conclusions.**
The judge is evidence, not an oracle.

**Delivery rate.** `generate-exam.js` filters out every question the verifier
rejects and never regenerates to replace them, so an exam is shipped short. A
student who asked for 12 questions can receive 5. A stronger generator should
show up here as a higher delivered/requested ratio, not just a lower error rate.

**Gate drops and soft flags**, counted per issue code, so it is visible whether
a rule is doing work or never firing.

**Latency p50/p95.** `generate-exam.js` aborts at 45 s. Reasoning models are
slower, and a timeout gives the student nothing at all — worse than a flawed
question. The runner prints a warning when p95 crosses that line.

**Token use and cost**, from the price table in `run-eval.mjs` (checked against
<https://developers.openai.com/api/docs/pricing> on 2026-08-01). Reasoning
tokens are reported separately, since they bill as output and are the reason a
reasoning model costs more than a naive input/output estimate suggests.
The verifier's own token use is **not** captured — `verifyQuestions()` does not
return it — so the printed cost is the generator's only. Do not read it as the
total.

## First finding: subject routing was wrong before any model was swapped

Found by `check-detection.mjs` on its first run — 7 of 15 cases misrouted, at no
API cost. **Fixed**; the report is green and the cases are now permanent
regression tests in `tests/assessment/subject-routing.test.mjs` (45 real Swedish
course names). Kept here because it is the reason the eval exists.

A course was routed to the maths system prompt (`MATTE-LÄGE`: "70–80 %
beräkning och problemlösning") and to the maths gate overlay on evidence this
weak:

| Case | What triggers it |
|---|---|
| Historia 1b, "97 procent av befolkningen" | the single word `procent` |
| Samhällskunskap, "officiell statistik från SCB" | the single word `statistik` |
| Programmering 1, "Funktioner definieras med def" | the term `funktion` |
| Företagsekonomi, "Vinst = intäkt minus kostnad per styck." | an `=` anywhere in the text plus any word containing x, y or z — here `styck` |

The last one is the broadest: `looksLikeMath()` tests `/[=<>]/` and `/[xyz]/`
against the whole document independently, so the two characters can sit
paragraphs apart. The rule was meant to catch `2x + 3 = 7`.

`detectSubjectProfile()` has a second, separate problem: it picks the winner
with a strict `>`, so on a 1–1–1 tie the first key in `SUBJECT_KEYWORDS` wins —
and `mathematics` is declared first. A history text with one stray `procent`
beats `historia`.

Both detectors read the course title and the pasted material with equal weight,
so one word out of two thousand decides. The 2026-07-28 work fixed false
positives coming from *course titles* (`log` matching biologi/psykologi); it did
not address the material.

A fourth defect surfaced while fixing the first three: the coefficient pattern
`\d[a-z]` matched the level letter in every Swedish course code, so "Historia
**1b**" scored a maths-notation hit on the title itself. And `"lag "` in the law
keyword list was substring-matched, so "aktiebo**lag** " routed an
entrepreneurship text to the law profile.

**How it was fixed.** `looksLikeMath()` no longer has its own copy of the
detector — it delegates to `detectSubjectProfile()`, so the generator's MATH
MODE and the gate's overlay read the same number and cannot disagree. Inside
`_assessment.js`:

- the course title is weighted 3×, the pasted material 1× — the student chose
  the title to say what the exam is about;
- maths terms are split by strength: `ekvation`, `sannolikhet`, `derivat` and
  the like count double and stand alone, while `procent`, `statistik` and
  `funktion` need corroboration;
- notation must be local — `\d[a-z]` requires an adjacent operator, and the old
  "any `=` plus any x/y/z in the document" rule is gone;
- a specialist profile with no course-title signal needs more than one keyword,
  and a genuine tie returns `generic` instead of letting object key order pick
  (which used to hand every 1–1 tie to mathematics);
- keywords written with a trailing space match on a word boundary.

**Consequence for this eval:** a misrouted fixture would be measured against the
wrong prompt and the wrong overlay, so its numbers would not be comparable.
`run-eval.mjs` refuses to finish clean while any fixture is misrouted, and
`check-detection.mjs` is the free pre-flight for that.
