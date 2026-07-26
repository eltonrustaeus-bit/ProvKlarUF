import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./_auth.js";

function buildPitchHtml(email) {
  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#08100d;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08100d;padding:40px 16px">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#0f1a13;border:1px solid rgba(27,255,140,.18);border-radius:8px;overflow:hidden">
      <tr><td style="background:#0a130d;padding:24px 32px;border-bottom:1px solid rgba(27,255,140,.12)">
        <span style="font-size:20px;font-weight:700;color:#1bff8c">ProviaAI</span>
      </td></tr>
      <tr><td style="padding:32px 32px 20px">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#e8f5ee;line-height:1.3">Du pluggar på gratisplanen. Här är vad du missar.</h1>
        <p style="margin:0;font-size:15px;color:#a8c4b4;line-height:1.7">Gratisplanen ger dig 10 kursfrågor per dag och 2 AI-mockprov per vecka. Teoriprov — det som simulerar riktiga körkortsprovet — kräver Basic.</p>
      </td></tr>
      <tr><td style="padding:0 32px 24px">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111a15;border:1px solid rgba(27,255,140,.2);border-radius:6px;overflow:hidden">
          <tr><td style="padding:16px 20px;border-bottom:1px solid rgba(27,255,140,.1)">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1bff8c;text-transform:uppercase;letter-spacing:0.6px">Basic — 29 kr/mån</p>
            <p style="margin:0;font-size:14px;color:#e8f5ee;line-height:1.6">30 teoriprov/mån &nbsp;·&nbsp; 30 AI-mockprov/mån &nbsp;·&nbsp; Obegränsad körkortsträning &nbsp;·&nbsp; P.E.R 5/dag</p>
          </td></tr>
          <tr><td style="padding:14px 20px">
            <p style="margin:0;font-size:13px;color:#a8c4b4;line-height:1.6">Det är 1 prov per dag i en månad. Forskning visar att spridd repetition är det effektivaste sättet att lära sig — men det kräver att du faktiskt kan öva varje dag.</p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 32px 28px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:10px 0;border-bottom:1px solid rgba(27,255,140,.07)">
            <span style="color:#1bff8c;font-size:14px;margin-right:10px">✓</span>
            <span style="color:#e8f5ee;font-size:14px">AI väljer frågor baserat på dina svagheter</span>
          </td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid rgba(27,255,140,.07)">
            <span style="color:#1bff8c;font-size:14px;margin-right:10px">✓</span>
            <span style="color:#e8f5ee;font-size:14px">P.E.R förklarar varför du svarade fel</span>
          </td></tr>
          <tr><td style="padding:10px 0">
            <span style="color:#1bff8c;font-size:14px;margin-right:10px">✓</span>
            <span style="color:#e8f5ee;font-size:14px">Ingen bindningstid — avsluta när du vill</span>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 32px 36px">
        <a href="https://proviaai.se/pricing.html" style="display:inline-block;background:#1bff8c;color:#08100d;font-size:15px;font-weight:700;padding:14px 28px;border-radius:5px;text-decoration:none">Uppgradera till Basic — 29 kr/mån →</a>
        <p style="margin:12px 0 0;font-size:13px;color:#6b8f7c">Inget kort krävs för att fortsätta på gratis om du ångrar dig.</p>
      </td></tr>
      <tr><td style="padding:18px 32px;border-top:1px solid rgba(27,255,140,.08)">
        <p style="margin:0;font-size:12px;color:#6b8f7c;line-height:1.5">Du får det här mailet för att du har ett konto på ProviaAI med adressen <b style="color:#a8c4b4">${email}</b>.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const VALID_ROLES = ["gratis", "basic", "premium", "admin", "teacher"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function buildScenarioDescription(q) {
  const cat = q.category || "";
  const question = q.question || "";
  const correct = {
    A: q.option_a,
    B: q.option_b,
    C: q.option_c,
    D: q.option_d,
  }[String(q.correct || "").toUpperCase()] || "";
  const desc = `${String(question).replace(/\?/g, "").trim()}. Context: ${cat} situation. The correct answer is: ${correct}`.trim();

  return desc.substring(0, 400);
}

function buildImagePrompt(q) {
  return `Create a realistic educational driving theory scenario image for a Swedish driving test app. The image should show: ${buildScenarioDescription(q)}. Use a driver perspective from inside or just behind the vehicle. Swedish road environment, daylight, clear visibility, pedagogical composition. Do not include readable license plates, brand logos, incorrect traffic signs, distorted vehicles, or text overlays. High quality, clean, realistic, 16:9 format.`;
}

async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (prof?.role !== "admin") {
    res.status(403).json({ ok: false, error: "Not admin" });
    return null;
  }
  return user;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const { action, targetId, role } = req.body || {};

  /* ── LIST USERS ── */
  if (action === "list-users") {
    if (!await requireAdmin(req, res)) return;

    const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (authErr) return res.status(500).json({ ok: false, error: authErr.message });

    const { data: profiles } = await supabase.from("profiles").select("id, role, approved");
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    const users = (authData?.users || []).map(u => ({
      id: u.id,
      email: u.email || "—",
      created_at: u.created_at,
      role: profileMap.get(u.id)?.role || "gratis",
      approved: profileMap.get(u.id)?.approved || false,
    }));
    users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({ ok: true, users });
  }

  /* ── SET ROLE ── */
  if (action === "set-role") {
    if (!await requireAdmin(req, res)) return;

    if (!targetId || !UUID_RE.test(String(targetId))) {
      return res.status(400).json({ ok: false, error: "Invalid targetId" });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ ok: false, error: "Invalid role" });
    }

    const { error } = await supabase
      .from("profiles")
      .upsert({ id: targetId, role }, { onConflict: "id" });

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, targetId, role });
  }

  /* ── APPROVE USER ── */
  if (action === "approve") {
    if (!await requireAdmin(req, res)) return;

    if (!targetId || !UUID_RE.test(String(targetId))) {
      return res.status(400).json({ ok: false, error: "Invalid targetId" });
    }

    const { error } = await supabase
      .from("profiles")
      .upsert({ id: targetId, approved: true, role: "premium" }, { onConflict: "id" });

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  /* ── LIST QUESTIONS ── */
  if (action === "list-questions") {
    if (!await requireAdmin(req, res)) return;

    const { category, search, page = 1 } = req.body || {};
    const limit = 50;
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    let query = supabase
      .from("driving_questions")
      .select("id, category, question, option_a, option_b, option_c, option_d, correct, explanation, difficulty, image_url, image_description, image_status, image_priority, image_prompt, image_source, image_notes, reviewed_at, reviewed_by, report_count", { count: "exact" })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (category) query = query.eq("category", category);
    if (search && String(search).trim()) query = query.ilike("question", `%${String(search).trim()}%`);

    const { imgFilter } = req.body || {};
    if (imgFilter === "none") query = query.is("image_url", null);
    if (imgFilter === "has") query = query.not("image_url", "is", null);
    if (imgFilter === "report") query = query.gt("report_count", 0);
    if (imgFilter === "missing") query = query.or("image_status.is.null,image_status.eq.missing");
    if (imgFilter === "prompt_ready") query = query.eq("image_status", "prompt_ready");
    if (imgFilter === "pending_upload") query = query.eq("image_status", "pending_upload");
    if (imgFilter === "uploaded") query = query.eq("image_status", "uploaded");
    if (imgFilter === "approved") query = query.eq("image_status", "approved");
    if (imgFilter === "priority-high") query = query.eq("image_priority", "high");
    if (imgFilter === "prompt-ready") query = query.eq("image_status", "prompt_ready");
    if (imgFilter === "pending-review") query = query.in("image_status", ["uploaded"]);

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, questions: data, total: count, page: Number(page), limit });
  }

  /* ── UPDATE QUESTION ── */
  if (action === "update-question") {
    if (!await requireAdmin(req, res)) return;

    const { questionId, updates } = req.body || {};
    if (!Number.isInteger(questionId) || questionId < 1)
      return res.status(400).json({ ok: false, error: "Invalid questionId" });
    if (!updates || typeof updates !== "object" || Array.isArray(updates))
      return res.status(400).json({ ok: false, error: "updates required" });

    const VALID_CATS = ["Vägmärken","Trafikregler","Korsningar","Möte & Omkörning","Hastighet",
      "Parkering","Miljö & Ekonomi","Alkohol & Droger","Säkerhet & Utrustning","Mörker & Sikt",
      "Väglag & Bromssträcka","Vägtunnlar","Bogsering & Lastsäkring","Fordon & Besiktning",
      "Körning med Släp","Nödsituationer"];

    const safe = {};
    const str = (v, max) => { const s = String(v ?? "").trim(); return s.length > 0 && s.length <= max ? s : null; };

    if (updates.question    !== undefined) { const v = str(updates.question, 500);    if (!v || v.length < 5)         return res.status(400).json({ ok: false, error: "question invalid" });   safe.question    = v; }
    if (updates.option_a    !== undefined) { const v = str(updates.option_a, 300);    if (!v)                          return res.status(400).json({ ok: false, error: "option_a invalid" });  safe.option_a    = v; }
    if (updates.option_b    !== undefined) { const v = str(updates.option_b, 300);    if (!v)                          return res.status(400).json({ ok: false, error: "option_b invalid" });  safe.option_b    = v; }
    if (updates.option_c    !== undefined) { const v = str(updates.option_c, 300);    if (!v)                          return res.status(400).json({ ok: false, error: "option_c invalid" });  safe.option_c    = v; }
    if (updates.option_d    !== undefined) { const v = str(updates.option_d, 300);    if (!v)                          return res.status(400).json({ ok: false, error: "option_d invalid" });  safe.option_d    = v; }
    if (updates.correct     !== undefined) { const v = String(updates.correct || "").toUpperCase(); if (!["A","B","C","D"].includes(v)) return res.status(400).json({ ok: false, error: "correct invalid" }); safe.correct = v; }
    if (updates.explanation !== undefined) { safe.explanation = updates.explanation ? String(updates.explanation).trim().slice(0, 2000) || null : null; }
    if (updates.difficulty  !== undefined) { if (!["easy","normal","hard"].includes(updates.difficulty)) return res.status(400).json({ ok: false, error: "difficulty invalid" }); safe.difficulty = updates.difficulty; }
    if (updates.category    !== undefined) { if (!VALID_CATS.includes(updates.category)) return res.status(400).json({ ok: false, error: "category invalid" }); safe.category = updates.category; }
    if ("image_url" in updates) {
      if (!updates.image_url) {
        safe.image_url = null;
      } else {
        const vs = String(updates.image_url).trim();
        const isWikimedia = vs.startsWith("https://upload.wikimedia.org/wikipedia/commons/") && vs.length <= 1000;
        const isOwnStorage = vs.startsWith("https://mnmotdluigzeehdjbhbu.supabase.co/storage/v1/object/public/question-images/") && vs.length <= 500;
        if (!isWikimedia && !isOwnStorage) {
          return res.status(400).json({ ok: false, error: "image_url must be Wikimedia commons URL, Supabase Storage URL, or null" });
        }
        safe.image_url = vs;
      }
    }
    if ("image_description" in updates) {
      safe.image_description = updates.image_description ? String(updates.image_description).trim().slice(0, 500) || null : null;
    }

    if (!Object.keys(safe).length) return res.status(400).json({ ok: false, error: "No valid fields to update" });

    const { data, error } = await supabase
      .from("driving_questions")
      .update(safe)
      .eq("id", questionId)
      .select()
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, question: data });
  }

  /* ── DELETE QUESTION ── */
  if (action === "delete-question") {
    if (!await requireAdmin(req, res)) return;
    const { questionId } = req.body || {};
    if (!Number.isInteger(questionId) || questionId < 1)
      return res.status(400).json({ ok: false, error: "Invalid questionId" });
    const { error } = await supabase.from("driving_questions").delete().eq("id", questionId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, deletedId: questionId });
  }

  /* ── GENERATE IMAGE PROMPT ── */
  if (action === "generate-prompt") {
    if (!await requireAdmin(req, res)) return;

    const { questionId } = req.body || {};
    const id = Number(questionId);
    if (!Number.isInteger(id) || id < 1)
      return res.status(400).json({ ok: false, error: "Invalid questionId" });

    const { data: question, error: fetchError } = await supabase
      .from("driving_questions")
      .select("id, category, question, option_a, option_b, option_c, option_d, correct")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ ok: false, error: fetchError.message });
    if (!question) return res.status(404).json({ ok: false, error: "Question not found" });

    const prompt = buildImagePrompt(question);

    const { error } = await supabase
      .from("driving_questions")
      .update({ image_prompt: prompt, image_status: "prompt_ready" })
      .eq("id", id);

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, prompt, questionId: id });
  }

  if (action === "update-image-status") {
    if (!await requireAdmin(req, res)) return;

    const { questionId, image_status, image_notes, image_source, image_priority } = req.body || {};
    const id = Number(questionId);
    if (!Number.isInteger(id) || id < 1)
      return res.status(400).json({ ok: false, error: "Invalid questionId" });

    const statuses = ["missing", "prompt_ready", "pending_upload", "uploaded", "approved", "rejected"];
    const sources = ["chatgpt_manual", "official_asset", "own_photo", "other", "none"];
    const priorities = ["high", "medium", "low", "none"];
    const updates = {};

    if (image_status !== undefined) {
      if (!statuses.includes(image_status))
        return res.status(400).json({ ok: false, error: "Invalid image_status" });
      updates.image_status = image_status;
      if (image_status === "approved" || image_status === "rejected") updates.reviewed_at = new Date().toISOString();
    }
    if (image_notes !== undefined) {
      updates.image_notes = image_notes ? String(image_notes).trim().slice(0, 500) || null : null;
    }
    if (image_source !== undefined) {
      if (!sources.includes(image_source))
        return res.status(400).json({ ok: false, error: "Invalid image_source" });
      updates.image_source = image_source;
    }
    if (image_priority !== undefined) {
      if (!priorities.includes(image_priority))
        return res.status(400).json({ ok: false, error: "Invalid image_priority" });
      updates.image_priority = image_priority;
    }

    if (!Object.keys(updates).length) return res.status(400).json({ ok: false, error: "No valid fields to update" });

    const { data, error } = await supabase
      .from("driving_questions")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, question: data });
  }

  if (action === "upload-image") {
    if (!await requireAdmin(req, res)) return;

    const { questionId, imageData, mimeType } = req.body || {};
    const id = Number(questionId);
    if (!Number.isInteger(id) || id < 1)
      return res.status(400).json({ ok: false, error: "Invalid questionId" });

    const extByMime = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const ext = extByMime[mimeType];
    if (!ext) return res.status(400).json({ ok: false, error: "Invalid mimeType" });
    if (!imageData || typeof imageData !== "string")
      return res.status(400).json({ ok: false, error: "imageData required" });

    let buffer;
    try {
      buffer = Buffer.from(imageData, "base64");
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid imageData" });
    }
    if (buffer.length > 5 * 1024 * 1024)
      return res.status(400).json({ ok: false, error: "Image too large" });

    const filename = `q-${id}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("question-images")
      .upload(filename, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) return res.status(500).json({ ok: false, error: uploadError.message });

    const { data: publicData } = supabase.storage
      .from("question-images")
      .getPublicUrl(filename);
    const publicUrl = publicData.publicUrl;

    const { error } = await supabase
      .from("driving_questions")
      .update({ image_url: publicUrl, image_status: "uploaded", image_source: "chatgpt_manual" })
      .eq("id", id);

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, url: publicUrl, filename });
  }

  if (action === "export-prompts") {
    if (!await requireAdmin(req, res)) return;

    const { category } = req.body || {};
    const rawLimit = req.body?.limit === undefined ? 10 : Number(req.body.limit);
    const count = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 10));

    let query = supabase
      .from("driving_questions")
      .select("id, category, question, option_a, option_b, option_c, option_d, correct, explanation, image_status, image_prompt, image_priority")
      .is("image_url", null)
      .order("image_priority", { ascending: true })
      .limit(count);

    if (category) query = query.eq("category", category);

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });

    const prompts = (data || []).map(q => ({
      id: q.id,
      category: q.category,
      question: q.question,
      priority: q.image_priority || "none",
      prompt: q.image_prompt || buildImagePrompt(q),
    }));

    return res.status(200).json({ ok: true, prompts, count: prompts.length });
  }

  /* ── SEND PITCH ── */
  if (action === "send-pitch") {
    if (!await requireAdmin(req, res)) return;

    if (!targetId || !UUID_RE.test(String(targetId))) {
      return res.status(400).json({ ok: false, error: "Invalid targetId" });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: "RESEND_API_KEY not configured" });
    }

    const { data: prof } = await supabase.from("profiles").select("role").eq("id", targetId).maybeSingle();
    if (!prof) return res.status(404).json({ ok: false, error: "User not found" });
    if (prof.role !== "gratis") return res.status(400).json({ ok: false, error: `User is ${prof.role}, not gratis` });

    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(targetId);
    if (userErr || !user?.email) return res.status(404).json({ ok: false, error: "Email not found" });

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "ProviaAI <noreply@proviaai.se>",
        to: user.email,
        subject: "Du pluggar på gratis. Här är vad du missar.",
        html: buildPitchHtml(user.email),
      }),
    });
    const result = await r.json();
    if (!result.id) return res.status(500).json({ ok: false, error: result.message || "Resend error" });
    return res.status(200).json({ ok: true, emailId: result.id, to: user.email });
  }

  return res.status(400).json({ ok: false, error: "Unknown action" });
}
