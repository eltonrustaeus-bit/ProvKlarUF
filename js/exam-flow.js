/* js/exam-flow.js — P.E.R-ledd provskapare.
 *
 * Ersätter den fyrstegs-wizard som låg synlig i app.html. Den gamla wizarden
 * finns kvar i DOM:en bakom `hidden` och är fortfarande MOTORN: kvot,
 * generering, rättning, felbank, Supabase-persistens och P.E.R-kontext körs
 * oförändrat därifrån via window.ExGenEngine. Den här filen äger bara ytan.
 *
 * Bärande principer, i tur och ordning:
 *
 * 1. P.E.R föreslår, eleven bekräftar. Varje steg kostar ett tryck, inte ett
 *    svar. En öppen fråga ställs bara när det inte finns något att gissa på.
 * 2. Hjälp under provet är gratis att ta men syns i resultatet. Två poäng —
 *    en med hjälp, en utan — gör hjälpknappen till ett verktyg i stället för
 *    en genväg, och gör siffran värd något för en lärare.
 * 3. P.E.R avbryter bara när något faktiskt hänt. Aldrig på timer, aldrig
 *    beröm utan orsak. Tre inpass per prov, som mest.
 */
(function () {
  "use strict";

  var LS_DRAFT = "exgen_flow_draft";
  var LS_HISTORY = "proviaai_history";
  var LS_MISTAKES = "proviaai_mistakes";

  var MAX_NUDGES = 3;
  var NUDGE_GAP_MS = 45000;
  var STUCK_MS = 90000;

  /* Serverns tak på pastedText i api/generate-exam.js. Speglas här så att
     eleven ser gränsen medan hen klistrar in i stället för att upptäcka den
     genom att halva materialet tyst försvann. */
  var MATERIAL_MAX = 3000;

  // ── Små hjälpare ─────────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }

  function lsGet(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || "null");
      return v == null ? fallback : v;
    } catch (_) { return fallback; }
  }

  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // ── Tillstånd ────────────────────────────────────────────────────────────

  var S = {
    course: "",
    level: "C",
    qType: "mix",
    num: 12,
    material: "",
    exam: null,
    answers: {},   // qid -> svar
    helped: {},    // qid -> true om P.E.R öppnades på just den frågan
    idx: 0,
    startedAt: 0,
    nudges: 0,
    lastNudge: 0
  };

  var UI = {};          // cache av noder
  var typing = null;    // pågående skrivanimation
  var stuckTimer = null;

  // ── Prov-DNA ─────────────────────────────────────────────────────────────
  /* Allt P.E.R "vet sedan tidigare" kommer härifrån: samma historik och
     felbank som förbättringssidan redan bygger på. Ingen ny lagring, inget
     nytt API. Kallstart hanteras genom att erkännas, inte döljas. */

  function dna() {
    var hist = lsGet(LS_HISTORY, []) || [];
    var miss = lsGet(LS_MISTAKES, []) || [];
    if (!Array.isArray(hist)) hist = [];
    if (!Array.isArray(miss)) miss = [];

    var last = hist.length ? hist[hist.length - 1] : null;
    var recent = hist.slice(-5);
    var avg = recent.length
      ? Math.round(recent.reduce(function (a, x) { return a + (Number(x.percent) || 0); }, 0) / recent.length)
      : null;

    // Kurser i fallande aktualitet, utan dubbletter.
    var courses = [];
    for (var i = hist.length - 1; i >= 0 && courses.length < 4; i--) {
      var c = String(hist[i].course || "").trim();
      if (c && courses.indexOf(c) === -1) courses.push(c);
    }

    // De begrepp eleven faktiskt tappat poäng på, vanligast först.
    var tally = {};
    miss.slice(-60).forEach(function (m) {
      var k = String(m.course || "").trim();
      if (!k) return;
      tally[k] = (tally[k] || 0) + 1;
    });

    // Nivåförslag: håller nivån tills resultaten säger något annat. Två prov
    // över 85 % lyfter, under 50 % sänker. Ett enstaka bra prov flyttar
    // ingenting — det är brus, inte utveckling.
    var lvl = last ? String(last.level || "C") : "C";
    if (avg != null && recent.length >= 2) {
      if (avg >= 85 && lvl === "C") lvl = "A";
      else if (avg >= 85 && lvl === "E") lvl = "C";
      else if (avg < 50 && lvl === "A") lvl = "C";
      else if (avg < 50 && lvl === "C") lvl = "E";
    }

    return {
      count: hist.length,
      last: last,
      avg: avg,
      courses: courses,
      level: lvl,
      qType: last ? String(last.qType || "mix") : "mix",
      num: last ? clamp(Number(last.numQuestions) || 12, 3, 20) : 12,
      weakFor: function (course) {
        var c = String(course || "").trim().toLowerCase();
        var out = [];
        miss.slice(-60).forEach(function (m) {
          if (String(m.course || "").trim().toLowerCase() !== c) return;
          var q = String(m.question || "").slice(0, 60);
          if (q) out.push(q);
        });
        return out;
      },
      missCountFor: function (course) {
        var c = String(course || "").trim().toLowerCase();
        return miss.filter(function (m) {
          return String(m.course || "").trim().toLowerCase() === c;
        }).length;
      }
    };
  }

  // ── P.E.R:s röst ─────────────────────────────────────────────────────────

  function say(text, sub) {
    var line = UI.say, subEl = UI.sub;
    if (!line) return;
    if (typing) { clearInterval(typing); typing = null; }

    subEl.textContent = "";
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      line.textContent = text;
      subEl.textContent = sub || "";
      return;
    }

    line.textContent = "";
    line.classList.add("typing");
    var i = 0;
    // 16 ms/tecken är snabbare än läshastighet — raden känns skriven, inte
    // uppläst. Långsammare blir väntan; direkt blir det ingen närvaro alls.
    typing = setInterval(function () {
      i++;
      line.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(typing);
        typing = null;
        line.classList.remove("typing");
        if (sub) {
          subEl.textContent = sub;
          subEl.style.animation = "xf-rise 250ms cubic-bezier(.22,.61,.36,1) both";
        }
      }
    }, 16);
  }

  function busy(on) {
    if (UI.orb) UI.orb.classList.toggle("busy", !!on);
  }

  // ── Skärmar ──────────────────────────────────────────────────────────────

  var STEPS = ["start", "subject", "aim", "material", "contract", "result"];

  function screen(name) {
    STEPS.forEach(function (s) {
      var n = UI.screens[s];
      if (n) n.classList.toggle("on", s === name);
    });
    var pct = (STEPS.indexOf(name) / (STEPS.length - 1)) * 100;
    if (UI.bar) UI.bar.style.width = pct + "%";
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  /* Varje steg börjar med mount(): den pekar om P.E.R:s röst till skärmen som
     är på väg in och tömmer dess kropp. Ordningen spelar roll — stegen anropar
     say() innan de byter skärm, så pekas rösten om för sent skrivs raden i den
     skärm eleven just lämnat. */
  function mount(name) {
    var sc = UI.screens[name];
    UI.say = sc.querySelector(".xf-say");
    UI.sub = sc.querySelector(".xf-sub");
    UI.orb = sc.querySelector(".xf-orb");
    var b = sc.querySelector(".xf-body");
    b.innerHTML = "";
    return b;
  }

  // ── Steg 0: start ────────────────────────────────────────────────────────

  function stepStart() {
    var d = dna();
    var b = mount("start");

    if (d.count === 0) {
      say("Vad ska vi plugga på?", "Klistra in ditt material så bygger jag ett prov som liknar det du faktiskt får.");
    } else if (d.avg != null) {
      say("Redo för nästa prov?", "Du ligger på " + d.avg + " % i snitt över dina senaste prov.");
    } else {
      say("Redo för nästa prov?", null);
    }

    var act = el("div", "xf-act");
    var go = el("button", "xf-btn primary", "Skapa prov");
    go.type = "button";
    go.addEventListener("click", function () { stepSubject(); });
    act.appendChild(go);

    // Ett halvfärdigt prov ska aldrig gå förlorat för att mobilen låste sig
    // eller täckningen försvann på bussen.
    var draft = lsGet(LS_DRAFT, null);
    if (draft && draft.exam && Array.isArray(draft.exam.questions) && draft.exam.questions.length) {
      var back = el("button", "xf-btn ghost", "Fortsätt provet du började");
      back.type = "button";
      back.addEventListener("click", function () {
        S.course = draft.course || "";
        S.level = draft.level || "C";
        S.qType = draft.qType || "mix";
        S.num = draft.num || 12;
        S.material = draft.material || "";
        S.exam = draft.exam;
        S.answers = draft.answers || {};
        S.helped = draft.helped || {};
        S.idx = clamp(Number(draft.idx) || 0, 0, draft.exam.questions.length - 1);
        openExam();
      });
      act.appendChild(back);
    }

    b.appendChild(act);
    screen("start");
  }

  // ── Steg 1: ämne ─────────────────────────────────────────────────────────

  function stepSubject() {
    var d = dna();
    var b = mount("subject");

    if (d.courses.length) {
      say("Samma som sist?", "Tryck på en kurs, eller skriv en annan.");
    } else {
      say("Vilken kurs gäller det?", "Skriv kursens namn — t.ex. Biologi 1 eller Historia 1b.");
    }

    if (d.courses.length) {
      var chips = el("div", "xf-chips");
      d.courses.forEach(function (c) {
        var ch = el("button", "xf-chip", c);
        ch.type = "button";
        ch.addEventListener("click", function () {
          S.course = c;
          stepAim();
        });
        chips.appendChild(ch);
      });
      b.appendChild(chips);
    }

    var inp = el("input", "xf-input");
    inp.type = "text";
    inp.placeholder = d.courses.length ? "…eller skriv en annan kurs" : "Kurs eller ämne";
    inp.value = S.course || "";
    inp.setAttribute("autocomplete", "off");
    inp.setAttribute("aria-label", "Kurs eller ämne");
    b.appendChild(inp);

    var err = el("div", "xf-err");
    b.appendChild(err);

    function next() {
      var v = inp.value.trim();
      if (!v) { err.textContent = "Skriv vilken kurs det gäller så kan jag matcha nivån."; inp.focus(); return; }
      S.course = v;
      stepAim();
    }

    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") next(); });
    inp.addEventListener("input", function () { err.textContent = ""; });

    var act = el("div", "xf-act");
    var go = el("button", "xf-btn primary", "Vidare");
    go.type = "button";
    go.addEventListener("click", next);
    act.appendChild(go);
    act.appendChild(backBtn(stepStart));
    b.appendChild(act);

    screen("subject");
    setTimeout(function () { if (!d.courses.length) inp.focus(); }, 320);
  }

  // ── Steg 2: sikte ────────────────────────────────────────────────────────
  /* Här ligger hela skillnaden mot en vanlig inställningssida: P.E.R har redan
     fyllt i allt utifrån Prov-DNA. Eleven ska kunna trycka en gång och vara
     klar; ändringarna finns men kostar ett extra tryck att öppna. */

  function stepAim() {
    var d = dna();
    var b = mount("aim");

    S.level = d.level;
    S.qType = d.qType;
    S.num = d.num;

    var misses = d.missCountFor(S.course);

    if (d.count === 0) {
      say("Första provet i " + S.course + ".",
          "Jag siktar brett den här gången och kalibrerar efter ditt resultat.");
    } else if (misses > 0) {
      say("Jag siktar på nivå " + S.level + ".",
          "Du har " + misses + " tidigare fel i " + S.course + " — dem viktar jag upp.");
    } else {
      say("Jag siktar på nivå " + S.level + ".",
          "Baserat på dina senaste prov. Ändra om du vill något annat.");
    }

    var card = el("div", "xf-card");
    var dl = el("dl");
    dl.style.margin = "0";

    function row(label, value, hint) {
      var r = el("div", "xf-row");
      r.appendChild(el("dt", null, label));
      var dd = el("dd", null, value);
      if (hint) dd.appendChild(el("small", null, hint));
      r.appendChild(dd);
      return r;
    }

    var levelText = { E: "E — visa att du kan grunderna", C: "C — förklara och tillämpa", A: "A — analysera och värdera" };
    var typeText = { mix: "Blandat", mc: "Bara flerval", short: "Bara kortsvar" };

    var rLevel = row("Nivå", S.level, levelText[S.level]);
    var rType = row("Frågetyp", typeText[S.qType], null);
    var rNum = row("Antal frågor", String(S.num), null);
    dl.appendChild(rLevel);
    dl.appendChild(rType);
    dl.appendChild(rNum);
    card.appendChild(dl);
    b.appendChild(card);

    // Justeringarna ligger vikta. Den som är nöjd ser dem aldrig.
    var tweak = el("div");
    tweak.hidden = true;

    tweak.appendChild(pickerRow("Nivå", ["E", "C", "A"], S.level, function (v) {
      S.level = v;
      rLevel.querySelector("dd").firstChild.nodeValue = v;
      rLevel.querySelector("small").textContent = levelText[v];
    }));

    tweak.appendChild(pickerRow("Frågetyp", ["mix", "mc", "short"], S.qType, function (v) {
      S.qType = v;
      rType.querySelector("dd").textContent = typeText[v];
    }, function (v) { return typeText[v]; }));

    tweak.appendChild(pickerRow("Antal", ["6", "10", "12", "16", "20"], String(S.num), function (v) {
      S.num = Number(v);
      rNum.querySelector("dd").textContent = v;
    }));

    b.appendChild(tweak);

    var act = el("div", "xf-act");
    var go = el("button", "xf-btn primary", "Stämmer — vidare");
    go.type = "button";
    go.addEventListener("click", stepMaterial);
    act.appendChild(go);

    var adj = el("button", "xf-btn quiet", "Ändra");
    adj.type = "button";
    adj.addEventListener("click", function () {
      tweak.hidden = !tweak.hidden;
      adj.textContent = tweak.hidden ? "Ändra" : "Dölj";
    });
    act.appendChild(adj);
    act.appendChild(backBtn(stepSubject));
    b.appendChild(act);

    screen("aim");
  }

  function pickerRow(label, values, current, onPick, labeller) {
    var wrap = el("div");
    wrap.style.marginBottom = "18px";
    wrap.appendChild(el("div", "xf-eyebrow", label));
    var chips = el("div", "xf-chips");
    values.forEach(function (v) {
      var ch = el("button", "xf-chip" + (v === current ? " sel" : ""), labeller ? labeller(v) : v);
      ch.type = "button";
      ch.addEventListener("click", function () {
        Array.prototype.forEach.call(chips.children, function (c) { c.classList.remove("sel"); });
        ch.classList.add("sel");
        onPick(v);
      });
      chips.appendChild(ch);
    });
    wrap.appendChild(chips);
    return wrap;
  }

  // ── Steg 3: material ─────────────────────────────────────────────────────

  var STOP = ("och att det en som för med den de var på är av till om inte har " +
    "ett kan man vid han hon jag vi ni du sig men så där när eller alla också " +
    "detta denna dessa vilket vilken samt under efter före mellan genom mycket " +
    "andra vara blir blev hade skulle kunna finns bland utan över").split(" ");

  /* Begreppsläsning i klienten. Ingen AI, inget anrop — ord som återkommer i
     elevens egen text, filtrerade mot stoppord. Det är därför raden får heta
     "hittade begrepp" och inte "analyserat": den påstår bara det den vet. */
  function terms(text) {
    var words = String(text).toLowerCase().match(/[a-zåäö][a-zåäö\-]{4,}/g) || [];
    var freq = {};
    words.forEach(function (w) {
      if (STOP.indexOf(w) !== -1) return;
      freq[w] = (freq[w] || 0) + 1;
    });
    return Object.keys(freq)
      .filter(function (w) { return freq[w] >= 2; })
      .sort(function (a, b) { return freq[b] - freq[a]; })
      .slice(0, 6);
  }

  function stepMaterial() {
    var b = mount("material");

    say("Ge mig materialet.",
        "Klistra in anteckningar, en sammanfattning eller lärarens presentation. Rubriker och punktlistor ger bättre frågor.");

    var ta = el("textarea", "xf-area");
    ta.placeholder = "Klistra in här…";
    ta.value = S.material || "";
    ta.setAttribute("aria-label", "Studiematerial");
    b.appendChild(ta);

    var read = el("div", "xf-read");
    b.appendChild(read);

    // Bild → text går via samma OCR-knapp som redan finns i motorn.
    var ocrWrap = el("div", "xf-act");
    ocrWrap.style.marginTop = "14px";
    var file = el("input");
    file.type = "file";
    file.accept = "image/*";
    file.setAttribute("capture", "environment");
    file.style.display = "none";
    var ocrBtn = el("button", "xf-btn ghost", "Fota en sida i stället");
    ocrBtn.type = "button";
    ocrBtn.addEventListener("click", function () { file.click(); });
    file.addEventListener("change", function () {
      if (!file.files || !file.files[0]) return;
      ocrBtn.disabled = true;
      ocrBtn.textContent = "Läser bilden…";
      busy(true);
      window.ExGenEngine.ocr(file.files[0]).then(function (r) {
        busy(false);
        ocrBtn.disabled = false;
        ocrBtn.textContent = "Fota en sida i stället";
        if (r && r.ok && r.text) {
          ta.value = (ta.value ? ta.value + "\n\n" : "") + r.text;
          onType();
        } else {
          err.textContent = (r && r.error) || "Kunde inte läsa bilden. Prova en tydligare bild.";
        }
      });
    });
    ocrWrap.appendChild(ocrBtn);
    ocrWrap.appendChild(file);
    b.appendChild(ocrWrap);

    var err = el("div", "xf-err");
    b.appendChild(err);

    var act = el("div", "xf-act");
    var go = el("button", "xf-btn primary", "Klart");
    go.type = "button";
    go.disabled = true;
    go.addEventListener("click", function () {
      S.material = ta.value.trim().slice(0, MATERIAL_MAX);
      stepContract();
    });
    act.appendChild(go);
    act.appendChild(backBtn(stepAim));
    b.appendChild(act);

    function onType() {
      var v = ta.value.trim();
      err.textContent = "";
      go.disabled = v.length < 120;

      read.innerHTML = "";
      if (!v) return;

      if (v.length < 120) {
        read.appendChild(el("span", null, "Lite kort än — " + v.length + " av minst 120 tecken"));
        return;
      }

      var t = terms(v);
      read.appendChild(el("b", null, "Läser"));
      if (t.length) {
        t.forEach(function (w) {
          read.appendChild(el("span", "xf-term", w));
        });
      } else {
        read.appendChild(el("span", null, v.length + " tecken"));
      }
      if (v.length > MATERIAL_MAX) {
        var warn = el("span", null, "· använder de första " + MATERIAL_MAX + " tecknen");
        warn.style.color = "var(--exgen-warning-text)";
        read.appendChild(warn);
      }
    }

    ta.addEventListener("input", onType);
    onType();

    screen("material");
    setTimeout(function () { ta.focus(); }, 320);
  }

  // ── Steg 4: provkontraktet ───────────────────────────────────────────────
  /* Vad som ska byggas, innan det byggs. Fel rättas här — inte efter fyrtio
     sekunders väntan på fel prov. */

  function stepContract() {
    var d = dna();
    var b = mount("contract");
    var misses = d.missCountFor(S.course);

    say("Så här blir provet.", "Titta igenom. Ändrar du något nu slipper du göra om det sen.");

    var mins = estimateMinutes(S.num, S.qType);

    var card = el("div", "xf-card");
    var dl = el("dl");
    dl.style.margin = "0";

    function row(label, value, hint) {
      var r = el("div", "xf-row");
      r.appendChild(el("dt", null, label));
      var dd = el("dd", null, value);
      if (hint) dd.appendChild(el("small", null, hint));
      r.appendChild(dd);
      return r;
    }

    dl.appendChild(row("Kurs", S.course));
    dl.appendChild(row("Nivå", S.level));
    dl.appendChild(row("Omfattning", S.num + " frågor",
      S.qType === "mc" ? "Flervalsfrågor" : S.qType === "short" ? "Kortsvar" : "Blandat flerval och kortsvar"));
    dl.appendChild(row("Tar ungefär", "~" + mins + " min", "Räknat på din svarstid, inte på lästid"));
    if (misses > 0) {
      dl.appendChild(row("Extra vikt", misses + " tidigare fel", "Från din felbank i " + S.course));
    }
    card.appendChild(dl);
    b.appendChild(card);

    var t = terms(S.material);
    if (t.length) {
      var cov = el("div");
      cov.appendChild(el("div", "xf-eyebrow", "Begrepp jag hittade i ditt material"));
      var chips = el("div", "xf-cov");
      t.forEach(function (w) { chips.appendChild(el("span", null, w)); });
      cov.appendChild(chips);
      b.appendChild(cov);
    }

    var err = el("div", "xf-err");
    b.appendChild(err);

    var act = el("div", "xf-act");
    var go = el("button", "xf-btn primary", "Skapa provet");
    go.type = "button";
    go.addEventListener("click", function () { build(go, err); });
    act.appendChild(go);
    act.appendChild(backBtn(stepMaterial));
    b.appendChild(act);

    b.appendChild(el("div", "xf-note",
      "Frågorna byggs bara på begrepp som finns i ditt material — i nya situationer, inte med nytt stoff."));

    screen("contract");
  }

  function estimateMinutes(num, qType) {
    // Mätt mot faktiska svarstider i provläget: flerval ~1 min, kortsvar ~3.
    var per = qType === "mc" ? 1 : qType === "short" ? 3 : 2;
    return Math.max(5, Math.round(num * per));
  }

  // ── Generering ───────────────────────────────────────────────────────────

  function build(btn, err) {
    btn.disabled = true;
    btn.textContent = "Bygger…";
    busy(true);
    err.textContent = "";
    say("Bygger ditt prov.", "Tar oftast under en minut.");

    window.ExGenEngine.setInputs({
      course: S.course, level: S.level, qType: S.qType,
      num: S.num, material: S.material
    });

    window.ExGenEngine.generate().then(function (r) {
      busy(false);
      btn.disabled = false;
      btn.textContent = "Skapa provet";
      if (!r || !r.ok || !r.exam || !Array.isArray(r.exam.questions) || !r.exam.questions.length) {
        err.textContent = (r && r.error) || "Provet kunde inte byggas. Försök igen.";
        say("Det gick inte den här gången.", "Försök igen, gärna med färre frågor.");
        return;
      }
      S.exam = r.exam;
      S.answers = {};
      S.helped = {};
      S.idx = 0;
      S.nudges = 0;
      S.lastNudge = 0;
      saveDraft();
      openExam();
    });
  }

  // ── Provläget ────────────────────────────────────────────────────────────

  function qid(q, i) { return String(q.id != null ? q.id : i + 1); }

  function openExam() {
    S.startedAt = Date.now();
    UI.exam.classList.add("on");
    document.body.classList.add("xf-in-exam");
    document.body.style.overflow = "hidden";
    renderQuestion();
    tick();
  }

  function closeExam() {
    UI.exam.classList.remove("on");
    document.body.classList.remove("xf-in-exam");
    document.body.style.overflow = "";
    clearTimeout(stuckTimer);
    if (UI.clock) clearInterval(UI.clock);
  }

  function tick() {
    if (UI.clock) clearInterval(UI.clock);
    // Klockan räknar uppåt. En nedräkning skapar panik utan att lära någon
    // någonting — men eleven ska ändå se att tiden går.
    UI.clock = setInterval(function () {
      var s = Math.floor((Date.now() - S.startedAt) / 1000);
      UI.time.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }, 1000);
  }

  function renderQuestion() {
    var qs = S.exam.questions;
    var i = clamp(S.idx, 0, qs.length - 1);
    S.idx = i;
    var q = qs[i];
    var id = qid(q, i);

    // Prickraden: hela provets form på en gång, och en genväg till varje fråga.
    UI.dots.innerHTML = "";
    qs.forEach(function (qq, n) {
      var d = el("button", "xf-dot");
      d.type = "button";
      var did = qid(qq, n);
      if (n === i) d.classList.add("here");
      else if (String(S.answers[did] || "").trim()) d.classList.add("done");
      d.setAttribute("aria-label", "Fråga " + (n + 1));
      d.addEventListener("click", function () { S.idx = n; renderQuestion(); });
      UI.dots.appendChild(d);
    });

    UI.count.textContent = "Fråga " + (i + 1) + " / " + qs.length;

    var sheet = el("div", "xf-sheet");

    var head = el("div", "xf-q-head");
    head.appendChild(el("span", null, String(q.cognitive_level || "").trim() || "Uppgift"));
    head.appendChild(el("span", "xf-q-pts", (Number(q.points) || 0) + " p"));
    sheet.appendChild(head);

    sheet.appendChild(el("p", "xf-q-text", q.question || ""));

    if (q.type === "mc" && Array.isArray(q.options) && q.options.length) {
      var group = el("div", "xf-mc");
      q.options.forEach(function (opt, n) {
        var letter = String.fromCharCode(65 + n);
        var btn = el("button", "xf-mc-opt");
        btn.type = "button";
        btn.appendChild(el("span", "xf-mc-let", letter));
        btn.appendChild(el("span", null, opt));
        if (S.answers[id] === letter) btn.classList.add("sel");
        btn.addEventListener("click", function () {
          Array.prototype.forEach.call(group.children, function (c) { c.classList.remove("sel"); });
          btn.classList.add("sel");
          S.answers[id] = letter;
          saveDraft();
          armStuck();
          // Ett flervalssvar är ett avslut — gå vidare av sig själv, men först
          // efter att markeringen hunnit synas.
          setTimeout(function () { if (S.idx === i) next(); }, 260);
        });
        group.appendChild(btn);
      });
      sheet.appendChild(group);
    } else {
      var ta = el("textarea", "xf-answer");
      ta.placeholder = "Ditt svar…";
      ta.value = S.answers[id] || "";
      ta.setAttribute("aria-label", "Svar på fråga " + (i + 1));
      ta.addEventListener("input", function () {
        S.answers[id] = ta.value;
        saveDraft();
        armStuck();
      });
      sheet.appendChild(ta);
    }

    var ask = el("button", "xf-ask" + (S.helped[id] ? " used" : ""),
      S.helped[id] ? "✦ P.E.R hjälpte dig här" : "✦ Fråga P.E.R om den här frågan");
    ask.type = "button";
    ask.addEventListener("click", function () {
      S.helped[id] = true;
      ask.className = "xf-ask used";
      ask.textContent = "✦ P.E.R hjälpte dig här";
      saveDraft();
      askPer(q, i);
    });
    sheet.appendChild(ask);

    UI.sheetWrap.innerHTML = "";
    UI.sheetWrap.appendChild(sheet);
    UI.sheetWrap.scrollTop = 0;

    UI.prev.disabled = i === 0;
    UI.next.textContent = i === S.exam.questions.length - 1 ? "Lämna in" : "Nästa";

    armStuck();
    pace();
  }

  /* P.E.R får hela frågan som kontext så att svaret handlar om just den, inte
     om sidan i allmänhet. Samma mekanism som app.html redan använder. */
  function askPer(q, i) {
    if (window.setPerContext) {
      window.setPerContext({
        page: "prov",
        focus: {
          number: i + 1,
          text: String(q.question || "").slice(0, 400),
          type: q.type || "short",
          options: Array.isArray(q.options) ? q.options : [],
          points: Number(q.points) || 0,
          course: S.course,
          level: S.level
        }
      });
    }
    var bubble = document.getElementById("perBubble");
    if (bubble) bubble.click();
  }

  function next() {
    if (S.idx >= S.exam.questions.length - 1) { submit(); return; }
    S.idx++;
    renderQuestion();
    saveDraft();
  }

  function prev() {
    if (S.idx <= 0) return;
    S.idx--;
    renderQuestion();
    saveDraft();
  }

  // ── P.E.R:s inpass ───────────────────────────────────────────────────────
  /* Tre regler, alla utlösta av något som hänt. Ingen timer som bara går,
     ingen slumpad peppning. Max tre gånger, aldrig tätare än 45 sekunder. */

  function nudge(text) {
    if (S.nudges >= MAX_NUDGES) return;
    if (Date.now() - S.lastNudge < NUDGE_GAP_MS) return;
    S.nudges++;
    S.lastNudge = Date.now();
    UI.nudgeText.textContent = text;
    UI.nudge.classList.add("on");
    clearTimeout(UI.nudgeTimer);
    UI.nudgeTimer = setTimeout(function () { UI.nudge.classList.remove("on"); }, 11000);
  }

  function armStuck() {
    clearTimeout(stuckTimer);
    var i = S.idx;
    stuckTimer = setTimeout(function () {
      if (S.idx !== i) return;
      var q = S.exam.questions[i];
      var id = qid(q, i);
      if (String(S.answers[id] || "").trim()) return;
      nudge("Fastnat? Fråga mig om frågan, eller hoppa vidare och kom tillbaka. Blankt ger noll — en påbörjad tanke ger ofta poäng.");
    }, STUCK_MS);
  }

  function pace() {
    var qs = S.exam.questions;
    if (S.idx !== Math.floor(qs.length / 2)) return;
    var budget = estimateMinutes(qs.length, S.qType) * 60000;
    var spent = Date.now() - S.startedAt;
    if (spent > budget * 0.6) {
      nudge("Halvvägs, men du har använt mer än halva tiden. Korta ner svaren — full poäng kräver sällan mer än några meningar.");
    }
  }

  // ── Inlämning ────────────────────────────────────────────────────────────

  function submit() {
    var qs = S.exam.questions;
    var blank = qs.filter(function (q, n) {
      return !String(S.answers[qid(q, n)] || "").trim();
    }).length;

    if (blank > 0) {
      var ok = window.confirm(
        blank === 1
          ? "Du har 1 obesvarad fråga. Lämna in ändå?"
          : "Du har " + blank + " obesvarade frågor. Lämna in ändå?"
      );
      if (!ok) {
        for (var n = 0; n < qs.length; n++) {
          if (!String(S.answers[qid(qs[n], n)] || "").trim()) { S.idx = n; renderQuestion(); return; }
        }
        return;
      }
    }

    closeExam();
    machine();

    var answers = qs.map(function (q, n) {
      var id = qid(q, n);
      return { id: id, answer: String(S.answers[id] || "").trim() };
    });

    window.ExGenEngine.grade(answers).then(function (r) {
      if (!r || !r.ok || !r.result) {
        // Rättningen föll — lämna tillbaka eleven till provet med svaren kvar
        // i stället för till en död skärm. S.nudges nollställs så att beskedet
        // om felet aldrig tystas av inpasskvoten.
        stopMachine().then(function () {
          S.nudges = 0;
          S.lastNudge = 0;
          openExam();
          nudge((r && r.error) || "Rättningen gick inte igenom. Dina svar är kvar — prova att lämna in igen.");
        });
        return;
      }
      // Rättningen är i hamn: utkastet får försvinna först nu.
      try { localStorage.removeItem(LS_DRAFT); } catch (_) {}
      stopMachine().then(function () { stepResult(r.result); });
    });
  }

  // ── Maskinytan ───────────────────────────────────────────────────────────
  /* Raderna beskriver det som faktiskt sker på servern, i den ordning det
     sker. En påhittad förloppsmätare hade varit billigare att bygga och värd
     mindre: den som väntar ska få veta vad väntan går åt till. */

  var LOG = [
    ["01", "läser dina svar"],
    ["02", "matchar mot bedömningsmallen"],
    ["03", "väger delpoäng per fråga"],
    ["04", "jämför med dina tidigare prov"],
    ["05", "skriver din återkoppling"]
  ];

  var PEP = [
    "Det du gjorde nyss räknas oavsett vad siffran blir.",
    "Fel svar är den billigaste informationen du kan få.",
    "Ett prov säger var du är, inte vem du är."
  ];

  // Rättningen tar normalt tiotals sekunder, men ett cachat eller felande svar
  // kan komma på en tiondel. Utan golv blinkar hela skärmen mörk och ljus igen,
  // vilket läser som en bugg snarare än som ett steg.
  var MACHINE_MIN_MS = 1400;
  var machineShownAt = 0;

  function machine() {
    machineShownAt = Date.now();
    UI.machine.classList.add("on");
    document.body.classList.add("xf-grading");
    document.body.style.overflow = "hidden";
    UI.log.innerHTML = "";
    UI.pep.textContent = "";
    var n = 0;

    function step() {
      if (n >= LOG.length) return;
      Array.prototype.forEach.call(UI.log.children, function (c) { c.classList.remove("now"); });
      var row = el("div", "now");
      row.appendChild(el("i", null, LOG[n][0]));
      row.appendChild(el("span", null, LOG[n][1]));
      UI.log.appendChild(row);
      n++;
    }

    // Första raden direkt. Väntar den på intervallet står skärmen tom i nästan
    // två sekunder, och en tom mörk skärm läser som att något hängt sig.
    step();
    UI.machineTimer = setInterval(step, 1900);

    var p = 0;
    UI.pepTimer = setInterval(function () {
      UI.pep.textContent = PEP[p % PEP.length];
      p++;
    }, 6500);
    UI.pep.textContent = PEP[0];
  }

  function stopMachine() {
    return new Promise(function (done) {
      var left = Math.max(0, MACHINE_MIN_MS - (Date.now() - machineShownAt));
      setTimeout(function () {
        clearInterval(UI.machineTimer);
        clearInterval(UI.pepTimer);
        UI.machine.classList.remove("on");
        document.body.classList.remove("xf-grading");
        document.body.style.overflow = "";
        done();
      }, left);
    });
  }

  // ── Resultat ─────────────────────────────────────────────────────────────

  function stepResult(r) {
    var b = mount("result");
    var qs = S.exam.questions;
    var byId = {};
    qs.forEach(function (q, n) { byId[qid(q, n)] = q; });

    var total = Number(r.total_points) || 0;
    var max = Number(r.max_points) || 0;

    // Andra siffran: samma rättning, men poängen på de frågor där P.E.R var
    // inne stryks. Det är den siffran som gäller i en provsal, och den enda
    // som betyder något för en lärare.
    var helpedPts = 0;
    (r.per_question || []).forEach(function (item) {
      if (S.helped[String(item.id)]) helpedPts += Number(item.points) || 0;
    });
    var solo = total - helpedPts;
    var helpedCount = Object.keys(S.helped).length;
    var pct = max > 0 ? Math.round((total / max) * 100) : 0;

    if (helpedCount > 0) {
      say("Du fick " + total + " av " + max + ".",
          "Med hjälp på " + helpedCount + (helpedCount === 1 ? " fråga" : " frågor") + ". Utan hjälp hade det blivit " + solo + ".");
    } else {
      say("Du fick " + total + " av " + max + ".", "Helt på egen hand.");
    }

    // Andra kortet visas bara när det säger något nytt. Två identiska siffror
    // bredvid varandra läser som ett fel, inte som ett besked.
    var scores = el("div", "xf-scores" + (helpedCount ? "" : " solo"));
    var s1 = el("div", "xf-score lead");
    s1.appendChild(el("b", null, total + "/" + max));
    s1.appendChild(el("span", null, "Ditt resultat · " + pct + " %"));
    scores.appendChild(s1);

    if (helpedCount) {
      var s2 = el("div", "xf-score");
      s2.appendChild(el("b", null, solo + "/" + max));
      s2.appendChild(el("span", null, "I provsalen · utan hjälp"));
      scores.appendChild(s2);
    }
    b.appendChild(scores);

    // Vad provet faktiskt täckte, och var poängen läckte. topic kommer från
    // generate-exam.js — det behövde bara visas.
    var topics = {};
    (r.per_question || []).forEach(function (item) {
      var q = byId[String(item.id)] || {};
      var t = String(q.topic || "").trim();
      if (!t) return;
      if (!topics[t]) topics[t] = { got: 0, max: 0 };
      topics[t].got += Number(item.points) || 0;
      topics[t].max += Number(item.max_points) || 0;
    });
    var tKeys = Object.keys(topics);
    if (tKeys.length) {
      b.appendChild(el("div", "xf-eyebrow", "Vad provet täckte"));
      var cov = el("div", "xf-cov");
      tKeys.forEach(function (t) {
        var o = topics[t];
        var ratio = o.max > 0 ? o.got / o.max : 1;
        var chip = el("span", ratio < 0.6 ? "weak" : null, t + " " + o.got + "/" + o.max);
        cov.appendChild(chip);
      });
      b.appendChild(cov);
    }

    var list = el("div");
    list.style.marginTop = "28px";
    (r.per_question || []).forEach(function (item, n) {
      var q = byId[String(item.id)] || {};
      var got = Number(item.points) || 0;
      var m = Number(item.max_points) || 0;

      var it = el("div", "xf-item");
      var head = el("div", "xf-item-head");
      head.appendChild(el("span", null, "Fråga " + (n + 1) + (S.helped[String(item.id)] ? " · med hjälp" : "")));
      var score = el("b", got >= m && m > 0 ? "full" : got === 0 ? "miss" : null, got + "/" + m);
      head.appendChild(score);
      it.appendChild(head);

      if (q.question) it.appendChild(el("div", "xf-item-q", q.question));
      if (item.feedback) it.appendChild(el("div", "xf-item-fb", item.feedback));

      if (item.model_answer) {
        var mo = el("div", "xf-item-model");
        mo.appendChild(el("em", null, "Fullpoängssvar"));
        mo.appendChild(el("span", null, item.model_answer));
        it.appendChild(mo);
      }

      // Källraden — vilken del av elevens eget material frågan byggde på.
      var src = Array.isArray(q.source_references) ? q.source_references.filter(Boolean) : [];
      if (src.length) {
        it.appendChild(el("div", "xf-src", "Bygger på ditt material: " + src.slice(0, 2).join(" · ")));
      }

      list.appendChild(it);
    });
    b.appendChild(list);

    // Ett resultat ska sluta i en handling, inte i en siffra.
    var act = el("div", "xf-act");
    act.style.marginTop = "28px";

    var again = el("button", "xf-btn primary", "Gör om — nya frågor, samma nivå");
    again.type = "button";
    again.addEventListener("click", function () {
      var errBox = el("div", "xf-err");
      act.appendChild(errBox);
      build(again, errBox);
    });
    act.appendChild(again);

    var toImprove = el("a", "xf-btn ghost", "Se felbanken");
    toImprove.href = "förbättring.html";
    act.appendChild(toImprove);

    var fresh = el("button", "xf-btn quiet", "Nytt ämne");
    fresh.type = "button";
    fresh.addEventListener("click", function () {
      S.exam = null; S.answers = {}; S.helped = {}; S.material = "";
      stepSubject();
    });
    act.appendChild(fresh);
    b.appendChild(act);

    screen("result");
  }

  // ── Utkast ───────────────────────────────────────────────────────────────

  function saveDraft() {
    if (!S.exam) return;
    lsSet(LS_DRAFT, {
      ts: Date.now(),
      course: S.course, level: S.level, qType: S.qType, num: S.num,
      material: S.material, exam: S.exam,
      answers: S.answers, helped: S.helped, idx: S.idx
    });
  }

  function backBtn(fn) {
    var b = el("button", "xf-btn quiet", "Tillbaka");
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // ── Uppbyggnad av DOM ────────────────────────────────────────────────────

  function buildDom(root) {
    var prog = el("div", "xf-progress");
    UI.bar = el("i");
    prog.appendChild(UI.bar);
    root.appendChild(prog);

    UI.screens = {};
    STEPS.forEach(function (name) {
      var sc = el("section", "xf-screen");
      sc.dataset.screen = name;
      var inner = el("div", "xf-inner");

      var per = el("div", "xf-per");
      var orb = el("div", "xf-orb");
      var voice = el("div");
      voice.style.flex = "1";
      var h = el("h1", "xf-say");
      var sub = el("p", "xf-sub");
      voice.appendChild(h);
      voice.appendChild(sub);
      per.appendChild(orb);
      per.appendChild(voice);

      inner.appendChild(per);
      inner.appendChild(el("div", "xf-body"));
      sc.appendChild(inner);
      root.appendChild(sc);
      UI.screens[name] = sc;
    });

    // Provläget
    UI.exam = el("div", "xf-exam");
    var top = el("div", "xf-exam-top");
    UI.count = el("span", null, "Fråga 1");
    UI.dots = el("div", "xf-exam-dots");
    UI.time = el("span", null, "00:00");
    top.appendChild(UI.count);
    top.appendChild(UI.dots);
    top.appendChild(UI.time);
    UI.exam.appendChild(top);

    UI.sheetWrap = el("div", "xf-sheet-wrap");
    UI.exam.appendChild(UI.sheetWrap);

    var nav = el("div", "xf-exam-nav");
    UI.prev = el("button", "xf-btn ghost", "Föregående");
    UI.prev.type = "button";
    UI.prev.addEventListener("click", prev);
    UI.next = el("button", "xf-btn primary", "Nästa");
    UI.next.type = "button";
    UI.next.addEventListener("click", next);
    nav.appendChild(UI.prev);
    nav.appendChild(UI.next);
    UI.exam.appendChild(nav);

    UI.nudge = el("div", "xf-nudge");
    UI.nudgeText = el("span");
    var close = el("button", null, "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Stäng");
    close.addEventListener("click", function () { UI.nudge.classList.remove("on"); });
    UI.nudge.appendChild(UI.nudgeText);
    UI.nudge.appendChild(close);
    UI.exam.appendChild(UI.nudge);

    root.appendChild(UI.exam);

    // Maskinytan
    UI.machine = el("div", "xf-machine");
    UI.machine.appendChild(el("div", "xf-orb"));
    UI.log = el("div", "xf-log");
    UI.machine.appendChild(UI.log);
    UI.pep = el("div", "xf-pep");
    UI.machine.appendChild(UI.pep);
    root.appendChild(UI.machine);
  }

  // ── Start ────────────────────────────────────────────────────────────────

  function boot() {
    var root = document.getElementById("xf");
    if (!root) return;
    // Talar om för motorn att ytan är bemannad: dess egna toaster om lyckade
    // steg tystas, felen släpps igenom. Se showToast i app.html.
    window.__xfActive = true;
    buildDom(root);
    stepStart();

    document.addEventListener("keydown", function (e) {
      if (!UI.exam.classList.contains("on")) return;
      if (e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    });
  }

  // Motorn bor i app.html och initieras på DOMContentLoaded. Vänta in den
  // hellre än att gissa ordningen mellan två script-taggar.
  function waitForEngine(tries) {
    if (window.ExGenEngine && window.ExGenEngine.ready) { boot(); return; }
    if (tries > 200) return;   // 10 s — motorn kommer inte, låt sidan vara
    setTimeout(function () { waitForEngine(tries + 1); }, 50);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { waitForEngine(0); });
  } else {
    waitForEngine(0);
  }
})();
