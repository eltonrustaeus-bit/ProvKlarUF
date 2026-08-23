import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./_auth.js";
import { currentPeriodKey, getEntitlementSnapshot, getFeatureLimit, normalizeRole } from "./_provia-rules.js";
import { clearLongMemory } from "./_per-memory.js";
import { flagsEnabled } from "./_flags.js";
import { PERSONAS } from "./_education.js";
import { loadProfile, saveFacts, forgetFact, forgetAllFacts, profileForDisplay } from "./_learner-profile.js";
import { callAI } from "./_per-core.js";
import { SITE_ORIGIN } from "./_site.js";
import { MAINTENANCE, maintenanceAllows } from "./_maintenance.js";

import { perRole } from "./_per-name.js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Lärarpanelen är öppen sedan 2026-07-28. Det som hindrar vem som helst från att skapa en
// klass och samla in elevers provdata är INTE längre en hårdkodad ägar-ID-grind, utan att
// rollen `teacher` bara kan sättas av en admin (api/admin.js, action "set-role"). Det finns
// alltså ingen självbetjäning — en lärare måste tilldelas rollen manuellt. Ta inte bort det
// kravet utan att först ersätta det med något som fyller samma funktion.

// Join codes: no ambiguous chars (0/O/1/I), 6 long
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// crypto.getRandomValues, inte Math.random(): koden är den enda hemligheten som skyddar en
// klass från att någon utomstående går med, och Math.random() är en förutsägbar PRNG.
// Modulo-bias undviks genom att förkasta byte-värden i den ojämna svansen (256 % 32 === 0
// gör att just 32 tecken råkar gå jämnt ut, men avvisningen står kvar så alfabetet kan
// ändras utan att införa en tyst snedfördelning).
function genJoinCode(len = 6) {
  const n = CODE_ALPHABET.length;
  const limit = Math.floor(256 / n) * n;
  let out = "";
  while (out.length < len) {
    const buf = new Uint8Array(len * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit) continue;
      out += CODE_ALPHABET[b % n];
      if (out.length === len) break;
    }
  }
  return out;
}

async function getRole(userId) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return normalizeRole(data?.role);
}

// Mockprov score from a user_exams.result ({ total_points, max_points, per_question[] }).
function examPercent(result) {
  const t = Number(result?.total_points || 0);
  const m = Number(result?.max_points || 0);
  return m > 0 ? Math.round((t / m) * 100) : 0;
}

// Concept tags the student got wrong in one exam (per_question points < max_points).
function examFailConcepts(result) {
  const pq = Array.isArray(result?.per_question) ? result.per_question : [];
  return pq
    .filter((q) => Number(q.points || 0) < Number(q.max_points || 0))
    .map((q) => q.concept_tag)
    .filter((c) => c && c !== "Okänt" && c !== "Unknown");
}

// Top weak concepts across a student's mockprov — the subject topics they keep missing.
function weakConceptsFromExams(exams, limit = 3) {
  const freq = {};
  for (const e of exams) for (const c of e.failConcepts || []) freq[c] = (freq[c] || 0) + 1;
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([concept, n]) => ({ concept, count: n }));
}

// Normalize a user_exams row → compact mockprov record.
function normalizeExam(r) {
  return {
    course: r.course || null,
    percent: examPercent(r.result),
    num_questions: Array.isArray(r.result?.per_question) ? r.result.per_question.length : null,
    failConcepts: examFailConcepts(r.result),
    created_at: r.created_at,
  };
}

// Aggregate per-student MOCKPROV progress for a class (school subjects, not körkort).
// Source: user_exams (the populated mockprov table; mock_results is not reliably written).
// Bulk queries — no N+1.
async function getStudentSummaries(classId) {
  const { data: members } = await supabase
    .from("class_members")
    .select("student_id, joined_at")
    .eq("class_id", classId);
  const ids = (members || []).map((m) => m.student_id);
  if (!ids.length) return [];

  const [examsRes, userResults] = await Promise.all([
    supabase
      .from("user_exams")
      .select("user_id, course, result, created_at")
      .in("user_id", ids)
      .order("created_at", { ascending: false }),
    // Resolve emails per member id — scales with class size, not platform size.
    // (Avoids listUsers({perPage:1000}), which silently dropped emails past 1000 users.)
    Promise.all(ids.map((id) => supabase.auth.admin.getUserById(id))),
  ]);

  const byId = {};
  for (const r of examsRes.data || []) (byId[r.user_id] ||= []).push(normalizeExam(r));

  const emailById = {};
  for (const u of userResults) {
    const usr = u?.data?.user;
    if (usr) emailById[usr.id] = usr.email;
  }

  return ids.map((id) => {
    const exams = byId[id] || []; // already newest-first
    const percents = exams.map((e) => e.percent);
    const avg = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null;
    const last = exams[0] || null;
    const courses = [...new Set(exams.map((e) => e.course).filter(Boolean))];
    // Last up to 8 mockprov, oldest→newest, for an inline trend sparkline
    const trend = exams.slice(0, 8).map((e) => e.percent).reverse();
    return {
      student_id: id,
      email: emailById[id] || "—",
      tests_taken: exams.length,
      avg_percent: avg,
      last_percent: last ? last.percent : null,
      last_course: last?.course || null,
      last_at: last?.created_at || null,
      courses_count: courses.length,
      weak_concepts: weakConceptsFromExams(exams),
      trend,
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const action = req.body?.action;

  /* Underhållsgrinden svaras före requireAuth. Med flaggan av måste en utloggad
     besökare få allow:true direkt — annars skulle varje sidladdning på en
     normal dag kräva en Supabase-session bara för att få se startsidan. Med
     flaggan på ger uteblivet token 401, och js/site-gate.js hämtar då sessionen
     och frågar om igen. */
  if (action === "maintenance_gate") {
    if (!MAINTENANCE.enabled) return res.status(200).json({ allow: true });

    /* Tillfällig förbikoppling med kod, så att Elton kommer in från vilken
       enhet som helst under ombyggnaden utan att logga in.

       Koden jämförs HÄR, mot process.env.ACCESS_CODE, och står medvetet inte i
       någon fil — det här repot är publikt på GitHub, så en kod i js/ eller i
       _maintenance.js hade varit läsbar för vem som helst. Klienten sparar bara
       det den fick inskrivet och skickar med det varje gång; den kan inte
       öppna grinden på egen hand genom att sätta en flagga i localStorage.

       Det gör den ändå inte till ett säkerhetsskydd. Grinden är till för
       besökare: sidornas HTML och JS är publika filer, och den som redan har
       ett konto når API:erna direkt. Lägg aldrig något bakom den här koden som
       inte tål att ses. Ta bort hela grenen när sajten öppnas för alla. */
    const gateCode = String(req.body?.code || "").trim();
    const expected = String(process.env.ACCESS_CODE || "").trim();
    if (gateCode && expected && gateCode === expected) {
      return res.status(200).json({ allow: true, via: "code" });
    }

    const gateUser = await requireAuth(req, res);
    if (!gateUser) return;                       // requireAuth svarade redan 401

    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", gateUser.id)
      .maybeSingle();

    // Fail closed: kan rollen inte läsas är svaret nej, inte "släpp in".
    if (error) return res.status(200).json({ allow: false });
    return res.status(200).json({ allow: maintenanceAllows(data?.role) });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  if (action === "entitlements") {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (error) return res.status(500).json({ error: "Role lookup failed" });
      const role = normalizeRole(data?.role);
      return res.status(200).json({ ok: true, entitlements: getEntitlementSnapshot(role) });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (action === "per_memory_clear") {
    const ok = await clearLongMemory(supabase, user.id);
    return ok
      ? res.status(200).json({ ok: true })
      : res.status(500).json({ ok: false, error: "Memory clear failed" });
  }

  /* ── Elevprofilen ────────────────────────────────────────────────────────
   *
   * Läsning och radering är ALLTID öppna, även när funktionsflaggan är av.
   * Att se och ta bort vad som lagras om en själv är inte en funktion som
   * rullas ut stegvis — det är förutsättningen för att få lagra något alls,
   * och användarna är till stor del minderåriga. Skrivning är däremot grindad
   * som allt annat oprövat.
   */
  if (action === "profile_get") {
    try {
      const profile = await loadProfile(supabase, user.id);
      return res.status(200).json({
        ok: true,
        persona: profile.persona,
        onboardedAt: profile.onboardedAt,
        facts: profileForDisplay(profile),
      });
    } catch {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (action === "profile_forget") {
    try {
      if (req.body?.all === true) {
        const ok = await forgetAllFacts(supabase, user.id);
        return ok
          ? res.status(200).json({ ok: true, forgot: "all" })
          : res.status(500).json({ error: "Forget failed" });
      }
      const key = String(req.body?.key || "");
      const ok = await forgetFact(supabase, user.id, key);
      return ok
        ? res.status(200).json({ ok: true, forgot: key })
        : res.status(400).json({ error: "Okänd uppgift" });
    } catch {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (action === "profile_set" || action === "onboarding_complete") {
    if (!(await flagsEnabled(supabase, ["per_learner_profile_enabled"], user.id))) {
      return res.status(403).json({ error: "Funktionen är inte påslagen" });
    }
    try {
      const profile = await loadProfile(supabase, user.id);

      /* persona sätts bara vid onboarding och bara till ett känt värde.
         Att välja "Lärare" här ger INGEN behörighet — lärarpanelen kräver
         fortfarande profiles.role = 'teacher', vilket bara en admin kan sätta
         (api/admin.js, action "set-role"). Slås de två ihop kan vem som helst
         klicka sig till andra elevers provdata. */
      let persona = profile.persona;
      if (action === "onboarding_complete") {
        const önskad = String(req.body?.persona || "");
        if (önskad && !PERSONAS.includes(önskad)) {
          return res.status(400).json({ error: "Okänd roll" });
        }
        persona = önskad || persona || "elev";
        const { error } = await supabase
          .from("profiles")
          .update({ persona, onboarded_at: new Date().toISOString() })
          .eq("id", user.id);
        if (error) return res.status(500).json({ error: "Kunde inte spara" });
      }

      const result = await saveFacts(supabase, user.id, req.body?.values, {
        persona: persona || "elev",
        source: "user",
      });
      if (result.error) return res.status(500).json({ error: "Kunde inte spara" });

      const uppdaterad = await loadProfile(supabase, user.id);
      return res.status(200).json({
        ok: true,
        persona: uppdaterad.persona,
        onboardedAt: uppdaterad.onboardedAt,
        saved: result.saved,
        rejected: result.rejected,
        facts: profileForDisplay(uppdaterad),
      });
    } catch {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  /* Om introduktionen ska visas. Klienten frågar en gång vid inloggning och
     får ett rakt ja eller nej — beslutet fattas server-side eftersom det
     hänger på både flaggan och om användaren redan svarat. */
  if (action === "onboarding_state") {
    try {
      const [profile, flaggaPå] = await Promise.all([
        loadProfile(supabase, user.id),
        flagsEnabled(supabase, ["per_learner_profile_enabled"], user.id),
      ]);
      return res.status(200).json({
        ok: true,
        show: Boolean(flaggaPå) && !profile.onboardedAt,
        persona: profile.persona,
      });
    } catch {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Save korkortet progress
  if (action === "kk_save") {
    const { srs_data, xp, wrong_ids, cat_prog, bookmarks } = req.body;
    try {
      const { error } = await supabase.from("driving_progress").upsert(
        { user_id: user.id, srs_data: srs_data ?? {}, xp: xp ?? 0, wrong_ids: wrong_ids ?? [], cat_prog: cat_prog ?? {}, bookmarks: bookmarks ?? [], updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (error) return res.status(500).json({ error: "Save failed" });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Load korkortet progress
  if (action === "kk_load") {
    try {
      const { data, error } = await supabase.from("driving_progress").select("srs_data,xp,wrong_ids,cat_prog,bookmarks,updated_at").eq("user_id", user.id).maybeSingle();
      if (error) return res.status(500).json({ error: "Load failed" });
      return res.status(200).json({ data: data || null });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Server-side korkortet teoriprov quota check + bump
  if (action === "bump_kk") {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (error) return res.status(500).json({ error: "DB error" });

      const role = normalizeRole(data?.role);
      const cfg = getFeatureLimit(role, "drivingTest");

      if (cfg.cap === Infinity) return res.status(200).json({ ok: true, count: 0, limit: Infinity });

      // cap=0 means teoriprov is not available on this plan (e.g. gratis)
      if (cfg.cap === 0) return res.status(429).json({ error: "Teoriprov kräver Basic eller Premium.", count: 0, limit: 0 });

      const periodKey = currentPeriodKey(cfg.period);

      // Atomic check-and-increment — prevents quota bypass via concurrent requests
      const { data: q, error: qErr } = await supabase.rpc("consume_kk_test_quota", {
        p_user_id: user.id,
        p_period_key: periodKey,
        p_limit: cfg.cap,
      });
      if (qErr) return res.status(500).json({ error: "DB error" });
      if (!q?.ok) return res.status(429).json({ error: "Quota exceeded", count: q?.count ?? cfg.cap, limit: cfg.cap });

      return res.status(200).json({ ok: true, count: q.count, limit: cfg.cap });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Open Stripe Customer Portal
  if (action === "portal") {
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .maybeSingle();

      if (!prof?.stripe_customer_id) {
        return res.status(400).json({ error: "no_subscription", message: "Inget Stripe-konto kopplat till din profil." });
      }

      const stripeKey = (process.env.STRIPE_SECRET_KEY || "").replace(/^﻿/, "").trim();
      const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: `customer=${encodeURIComponent(prof.stripe_customer_id)}&return_url=${encodeURIComponent(`${SITE_ORIGIN}/app.html`)}&configuration=bpc_1TdEAsCrGHQN9aRpV0vCLM03`,
      });
      const portalSession = await portalRes.json();
      if (!portalRes.ok) return res.status(500).json({ error: "portal_failed", details: portalSession });
      return res.status(200).json({ url: portalSession.url });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Cancel Stripe subscription
  if (action === "cancel_sub") {
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("stripe_subscription_id, role")
        .eq("id", user.id)
        .maybeSingle();

      if (!prof?.stripe_subscription_id) {
        return res.status(400).json({ error: "No active subscription found" });
      }

      const stripeKey = (process.env.STRIPE_SECRET_KEY || "").replace(/^﻿/, "").trim();
      const r = await fetch(`https://api.stripe.com/v1/subscriptions/${prof.stripe_subscription_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      const result = await r.json();
      if (!r.ok) return res.status(500).json({ error: "Stripe cancellation failed", details: result });

      await supabase.from("profiles").update({ role: "gratis", stripe_subscription_id: null }).eq("id", user.id);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Delete all mockprov history for the signed-in user (formerly its own api/delete-exams.js —
  // folded in here to stay within Vercel Hobby's 12-function cap, see docs/provia-knowledge-engine/
  // 16-fas6-7-results.md). Behavior unchanged: same table, same user-scoped delete, same auth.
  if (action === "delete_exams") {
    try {
      const { error } = await supabase.from("user_exams").delete().eq("user_id", user.id);
      if (error) return res.status(500).json({ error: "Delete failed" });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // ── Teacher dashboard (B2B) ──
  // Åtkomsten vilar på två oberoende kontroller, båda serversidan: rollen måste vara
  // teacher/admin (och rollen sätts bara av en admin), OCH varje enskild action verifierar
  // ägarskap av just den klass den rör. Ingen av dem får tas bort utan den andra.
  if (action && action.startsWith("teacher_")) {
    const role = await getRole(user.id);
    if (role !== "teacher" && role !== "admin") {
      return res.status(403).json({ error: "Lärarbehörighet krävs." });
    }

    // Create a class with a unique join code
    if (action === "teacher_create_class") {
      const name = String(req.body?.name || "").trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: "Klassnamn krävs." });
      try {
        let cls = null;
        for (let attempt = 0; attempt < 5 && !cls; attempt++) {
          const code = genJoinCode();
          const { data, error } = await supabase
            .from("classes")
            .insert({ teacher_id: user.id, name, join_code: code })
            .select("id, name, join_code, created_at")
            .maybeSingle();
          if (!error) { cls = data; break; }
          if (error.code !== "23505") return res.status(500).json({ error: "Kunde inte skapa klass." });
        }
        if (!cls) return res.status(500).json({ error: "Kunde inte generera unik kod." });
        return res.status(200).json({ ok: true, class: { ...cls, member_count: 0 } });
      } catch (e) {
        return res.status(500).json({ error: "Internal server error" });
      }
    }

    // List teacher's classes with member counts
    if (action === "teacher_classes") {
      try {
        const { data: classes, error } = await supabase
          .from("classes")
          .select("id, name, join_code, created_at")
          .eq("teacher_id", user.id)
          .order("created_at", { ascending: true });
        if (error) return res.status(500).json({ error: "Kunde inte hämta klasser." });

        const ids = (classes || []).map((c) => c.id);
        const counts = {};
        if (ids.length) {
          const { data: members } = await supabase
            .from("class_members")
            .select("class_id")
            .in("class_id", ids);
          for (const m of members || []) counts[m.class_id] = (counts[m.class_id] || 0) + 1;
        }
        return res.status(200).json({
          ok: true,
          classes: (classes || []).map((c) => ({ ...c, member_count: counts[c.id] || 0 })),
        });
      } catch (e) {
        return res.status(500).json({ error: "Internal server error" });
      }
    }

    // Aggregated student progress for one class (teacher must own it)
    if (action === "teacher_students") {
      const classId = String(req.body?.classId || "");
      if (!UUID_RE.test(classId)) return res.status(400).json({ error: "Ogiltigt klass-id." });
      try {
        const { data: cls } = await supabase
          .from("classes")
          .select("id, name, teacher_id")
          .eq("id", classId)
          .maybeSingle();
        if (!cls || cls.teacher_id !== user.id) {
          return res.status(403).json({ error: "Åtkomst nekad." });
        }
        const students = await getStudentSummaries(classId);
        return res.status(200).json({ ok: true, class: { id: cls.id, name: cls.name }, students });
      } catch (e) {
        return res.status(500).json({ error: "Internal server error" });
      }
    }

    // Per-student drilldown: full history + per-category mastery + percent trend.
    // Re-verifies BOTH class ownership AND that the student is a member (deny-by-default).
    if (action === "teacher_student_detail") {
      const classId = String(req.body?.classId || "");
      const studentId = String(req.body?.studentId || "");
      if (!UUID_RE.test(classId) || !UUID_RE.test(studentId)) {
        return res.status(400).json({ error: "Ogiltigt id." });
      }
      try {
        const { data: cls } = await supabase
          .from("classes")
          .select("id, name, teacher_id")
          .eq("id", classId)
          .maybeSingle();
        if (!cls || cls.teacher_id !== user.id) return res.status(403).json({ error: "Åtkomst nekad." });

        const { data: mem } = await supabase
          .from("class_members")
          .select("student_id")
          .eq("class_id", classId)
          .eq("student_id", studentId)
          .maybeSingle();
        if (!mem) return res.status(404).json({ error: "Eleven finns inte i klassen." });

        const [resultsRes, userRes] = await Promise.all([
          supabase
            .from("user_exams")
            .select("course, result, created_at")
            .eq("user_id", studentId)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase.auth.admin.getUserById(studentId),
        ]);

        const exams = (resultsRes.data || []).map(normalizeExam);
        const email = userRes.data?.user?.email || "—";

        // Per-course (subject) aggregation — weakest first
        const courseMap = {};
        for (const e of exams) {
          const c = e.course || "Okänd kurs";
          (courseMap[c] ||= []).push(e.percent);
        }
        const courses = Object.entries(courseMap)
          .map(([course, ps]) => ({
            course,
            avg: Math.round(ps.reduce((a, b) => a + b, 0) / ps.length),
            best: Math.max(...ps),
            attempts: ps.length,
          }))
          .sort((a, b) => a.avg - b.avg);

        const tests = exams
          .map((e) => ({ at: e.created_at, course: e.course, percent: e.percent, total: e.num_questions }))
          .reverse(); // oldest → newest

        return res.status(200).json({
          ok: true,
          class: { id: cls.id, name: cls.name },
          student: {
            student_id: studentId,
            email,
            tests_taken: tests.length,
            courses,
            weak_concepts: weakConceptsFromExams(exams, 8),
            tests,
          },
        });
      } catch (e) {
        return res.status(500).json({ error: "Internal server error" });
      }
    }

    // P.E.R class insight: AI summary for the TEACHER. Student data is anonymized
    // (labels Elev 1..N, no email/PII) before it ever reaches OpenAI.
    if (action === "teacher_class_insight") {
      const classId = String(req.body?.classId || "");
      if (!UUID_RE.test(classId)) return res.status(400).json({ error: "Ogiltigt klass-id." });
      if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "AI ej konfigurerad." });
      try {
        const { data: cls } = await supabase
          .from("classes")
          .select("id, name, teacher_id")
          .eq("id", classId)
          .maybeSingle();
        if (!cls || cls.teacher_id !== user.id) return res.status(403).json({ error: "Åtkomst nekad." });

        const students = await getStudentSummaries(classId);
        const withData = students.filter((s) => s.tests_taken > 0);
        if (withData.length < 1) {
          return res.status(400).json({ error: "För lite data — eleverna behöver göra minst ett prov." });
        }

        // Anonymize — never send email/PII to the model
        const anon = withData.map((s, i) => ({
          elev: `Elev ${i + 1}`,
          prov: s.tests_taken,
          kurser: s.courses_count,
          snitt: s.avg_percent,
          senaste: s.last_percent,
          svaga_begrepp: s.weak_concepts.map((w) => w.concept),
        }));
        const classAvg = Math.round(
          withData.reduce((a, s) => a + (s.avg_percent || 0), 0) / withData.length
        );
        const weakCount = {};
        for (const s of withData) for (const w of s.weak_concepts) weakCount[w.concept] = (weakCount[w.concept] || 0) + 1;
        const topWeak = Object.entries(weakCount)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([c, n]) => `${c} (${n} ${n === 1 ? "elev" : "elever"})`);

        const systemPrompt = `Du är ${perRole("erfaren lärarcoach")} för gymnasie- och grundskola. Skriv en kort, konkret klassrapport till LÄRAREN (inte eleven) om klassens läge i skolarbetet — baserat på mockprov eleverna gjort på sina egna ämnen och material (inte körkort).
KRAV:
- Saklig, professionell, max 200 ord.
- Använd elevernas anonyma etiketter (Elev 1, Elev 2 …) — aldrig namn.
- Peka ut konkret vilka elever som behöver stöd och i vilka ämnen/begrepp.
FORMAT (exakt rubriker):
Klassläge:
Elever som behöver stöd:
Svagaste begrepp/områden i klassen:
Rekommenderad träning (nästa 1–2 veckor):`;
        const userPrompt = `Klass: ${cls.name}
Antal elever med provdata: ${withData.length}
Klassens snitt (mockprov): ${classAvg}%
Svagaste begrepp (flest svaga elever): ${topWeak.join(", ") || "—"}

Elevdata (anonymiserad, mockprov på egna ämnen):
${JSON.stringify(anon, null, 2)}

Skriv rapporten enligt formatet.`;

        const insight = await callAI(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          { timeout: 45_000 }
        );
        if (!insight) return res.status(500).json({ error: "Tom rapport." });
        return res.status(200).json({
          ok: true,
          insight,
          class_avg: classAvg,
          students_with_data: withData.length,
          top_weak: topWeak,
        });
      } catch (e) {
        return res.status(500).json({ error: "Kunde inte skapa insikt." });
      }
    }

    // Delete a class (teacher must own it)
    if (action === "teacher_delete_class") {
      const classId = String(req.body?.classId || "");
      if (!UUID_RE.test(classId)) return res.status(400).json({ error: "Ogiltigt klass-id." });
      try {
        const { error } = await supabase
          .from("classes")
          .delete()
          .eq("id", classId)
          .eq("teacher_id", user.id);
        if (error) return res.status(500).json({ error: "Kunde inte radera klass." });
        return res.status(200).json({ ok: true });
      } catch (e) {
        return res.status(500).json({ error: "Internal server error" });
      }
    }

    return res.status(400).json({ error: "Okänd åtgärd." });
  }

  // ── Student: join / leave / list classes (any authenticated user) ──
  if (action === "student_classes") {
    try {
      const { data: rows } = await supabase
        .from("class_members")
        .select("class_id, classes(id, name)")
        .eq("student_id", user.id);
      const classes = (rows || [])
        .map((r) => r.classes)
        .filter(Boolean)
        .map((c) => ({ id: c.id, name: c.name }));
      return res.status(200).json({ ok: true, classes });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (action === "student_join") {
    const code = String(req.body?.code || "").trim().toUpperCase().slice(0, 12);
    if (!code) return res.status(400).json({ error: "Klasskod krävs." });

    // Koden är det enda som skyddar en klass från att någon utomstående går med. Utan tak
    // går 6-teckenskoder att gissa sig till i stor skala. Räknas per KONTO, inte per IP:
    // en skolklass sitter typiskt bakom samma NAT, så en IP-baserad gräns hade slagit mot
    // hela klassen samtidigt som en angripare bara byter nät. Samma atomiska RPC som
    // landningslägets skydd i api/explain.js.
    const joinWindow = new Date().toISOString().slice(0, 13); // timme: YYYY-MM-DDTHH
    try {
      const { data: rl } = await supabase.rpc("consume_anon_rate", {
        p_bucket: "join:" + user.id,
        p_window_key: joinWindow,
        p_limit: 10,
      });
      if (rl && rl.ok === false) {
        return res.status(429).json({ error: "För många försök. Vänta en stund och försök igen." });
      }
    } catch (_) { /* fail-open: en hicka i räknaren ska inte blockera en elev med rätt kod */ }

    try {
      const { data: cls } = await supabase
        .from("classes")
        .select("id, name")
        .eq("join_code", code)
        .maybeSingle();
      if (!cls) return res.status(404).json({ error: "Ingen klass med den koden." });
      const { error } = await supabase
        .from("class_members")
        .upsert({ class_id: cls.id, student_id: user.id }, { onConflict: "class_id,student_id" });
      if (error) return res.status(500).json({ error: "Kunde inte gå med." });
      return res.status(200).json({ ok: true, class: { id: cls.id, name: cls.name } });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (action === "student_leave") {
    const classId = String(req.body?.classId || "");
    if (!UUID_RE.test(classId)) return res.status(400).json({ error: "Ogiltigt klass-id." });
    try {
      const { error } = await supabase
        .from("class_members")
        .delete()
        .eq("class_id", classId)
        .eq("student_id", user.id);
      if (error) return res.status(500).json({ error: "Kunde inte lämna klass." });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role, swish_expires_at, stripe_subscription_id")
      .eq("id", user.id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: "Role lookup failed" });

    if (!data) return res.status(200).json({ role: "gratis" });

    let role = String(data.role || "gratis");

    // Lazy expiry: downgrade if Swish payment expired and no active subscription
    if (data.swish_expires_at && !data.stripe_subscription_id && role !== "gratis") {
      if (new Date(data.swish_expires_at) < new Date()) {
        await supabase
          .from("profiles")
          .update({ role: "gratis", swish_expires_at: null })
          .eq("id", user.id);
        role = "gratis";
      }
    }

    return res.status(200).json({ role });
  } catch (e) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
