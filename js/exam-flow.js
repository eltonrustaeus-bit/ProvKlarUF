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

  /* Utkastet nycklas per användare. En global nyckel räckte inte: på en
     skoldator eller en familjedator hade nästa elev fått knappen "Fortsätt
     provet du började" och därmed föregående elevs material, frågor och
     skrivna svar. uid läggs dessutom i objektet och kontrolleras vid läsning,
     så att en nyckel som råkar överleva ett kontobyte ändå avvisas. */
  var LS_DRAFT_BASE = "exgen_flow_draft";
  var LS_HISTORY = "proviaai_history";
  var LS_MISTAKES = "proviaai_mistakes";

  // Ett övergivet utkast slutar vara till hjälp och börjar bli förvirrande.
  var DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  var MAX_NUDGES = 3;
  var NUDGE_GAP_MS = 45000;
  var STUCK_MS = 90000;

  // Utkastet sparas vid varje tangenttryck i svarsrutan. Ett 20-frågorsprov
  // med alternativ och källhänvisningar är tiotals kB, och att serialisera om
  // allt per tecken märks som hack på en mobil. Frågebyten och flervalsval
  // sparas fortfarande direkt — det är bara skrivandet som väntar.
  var DRAFT_DEBOUNCE_MS = 800;

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

  /* Returnerar om skrivningen gick igenom. Den gamla versionen svalde
     QuotaExceededError tyst, vilket bröt löftet att halvfärdiga prov överlever
     en stängd flik utan att någon fick veta det — och utrymmet är verkligen
     trångt: proviaai_history (60 poster), proviaai_mistakes (200) och
     proviaai_last_result (ett helt prov med resultat) delar samma kvot. */
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (_) { return false; }
  }

  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /* Användar-id läses ur samma Supabase-session som resten av appen. Går det
     inte att läsa faller vi tillbaka på "anon" — då blir utkastet i praktiken
     enhetsbundet igen, men bara för den som ändå inte är inloggad och därför
     inte kan generera något prov. */
  function uid() {
    try {
      var s = JSON.parse(localStorage.getItem("sb-mnmotdluigzeehdjbhbu-auth-token") || "{}");
      return (s && s.user && s.user.id) ? String(s.user.id) : "anon";
    } catch (_) { return "anon"; }
  }

  function draftKey() { return LS_DRAFT_BASE + "_" + uid(); }

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
    lastNudge: 0,
    generating: false,  // spärr mot dubbel generering (kostar kvot)
    submitting: false   // spärr mot dubbel inlämning
  };

  var UI = {};          // cache av noder
  var typing = null;    // pågående skrivanimation
  var stuckTimer = null;
  var draftTimer = null;
  var prevOverflow = null;   // body-overflow som gällde innan vi låste den

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

    /* Nivåförslag: håller nivån tills resultaten säger något annat. Två prov
       i RAD över 85 % lyfter, två i rad under 50 % sänker. Ett enstaka bra
       prov flyttar ingenting — det är brus, inte utveckling.

       Regeln såg tidigare på snittet över de fem senaste proven, vilket inte
       är samma sak och gav fel svar åt båda håll: 40, 40, 40, 100, 100 gav
       snittet 64 och inget lyft trots två raka toppresultat, medan 80 följt av
       92 gav snittet 86 och ett lyft trots att bara ett prov nådde gränsen. */
    var lvl = last ? String(last.level || "C") : "C";
    var lastTwo = hist.slice(-2).map(function (x) { return Number(x.percent) || 0; });
    if (lastTwo.length === 2) {
      var bothHigh = lastTwo[0] >= 85 && lastTwo[1] >= 85;
      var bothLow = lastTwo[0] < 50 && lastTwo[1] < 50;
      if (bothHigh && lvl === "C") lvl = "A";
      else if (bothHigh && lvl === "E") lvl = "C";
      else if (bothLow && lvl === "A") lvl = "C";
      else if (bothLow && lvl === "C") lvl = "E";
    }

    return {
      count: hist.length,
      last: last,
      avg: avg,
      courses: courses,
      level: lvl,
      qType: last ? String(last.qType || "mix") : "mix",
      num: last ? clamp(Number(last.numQuestions) || 12, 3, 20) : 12,
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
      if (!n) return;
      var on = s === name;
      n.classList.toggle("on", on);
      // display:none räcker för seende, men en skärmläsare som traverserar
      // DOM:en hittar annars alla sex skärmarnas rubriker på en gång.
      if (on) n.removeAttribute("aria-hidden");
      else n.setAttribute("aria-hidden", "true");
    });
    var pct = (STEPS.indexOf(name) / (STEPS.length - 1)) * 100;
    if (UI.bar) UI.bar.style.width = pct + "%";
    // "instant" är ett giltigt ScrollBehavior-värde men aldrig en egenskap på
    // window, så den gamla feature-detekteringen valde alltid "auto" och gav
    // en mjuk scroll där en omedelbar var meningen.
    window.scrollTo({ top: 0, behavior: "instant" });

    /* Flytta fokus till den nya skärmens rubrik. Utan detta blir fokus kvar på
       knappen eleven just tryckte — en knapp som nu är display:none — och både
       tangentbord och skärmläsare tappar var de är. Rubriken har tabindex="-1"
       så att den går att fokusera utan att hamna i tabbordningen. */
    var sc = UI.screens[name];
    var head = sc && sc.querySelector(".xf-say");
    if (head) {
      try { head.focus({ preventScroll: true }); } catch (_) { head.focus(); }
    }
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
    var draft = readDraft();
    if (draft) {
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
        S.submitting = false;
        // Motorn måste känna till provet igen — den startade om med sidan och
        // har ingen currentExam att rätta mot.
        window.ExGenEngine.setInputs({
          course: S.course, level: S.level, qType: S.qType,
          num: S.num, material: S.material
        });
        window.ExGenEngine.adoptExam(S.exam);
        openExam(Number(draft.startedAt) || 0);
      });
      act.appendChild(back);
    }

    b.appendChild(act);
    screen("start");
  }

  /* ── Kurskatalogen ──────────────────────────────────────────────────────
     Ämnen, kurser och nivåer ur Skolverkets läroplaner
     (config/education-catalog.web.json, genererad av tools/sync-skolverket.mjs).
     Både GY11 och Gy25 finns med: en elev som började före ämnesbetygsreformen
     läser fortfarande "Matematik 1b", och hela hens provhistorik hänger på just
     den strängen.

     Fältet är fortfarande fritext. Katalogen föreslår, den begränsar inte —
     eleven som pluggar något vi inte har en kod för ska inte stoppas av att en
     lista saknar raden.

     Filen är ~175 kB och hämtas därför först när ämnessteget faktiskt visas,
     aldrig vid sidladdning. */
  var eduCatalog = null, eduPending = null;

  function loadEduCatalog() {
    if (eduCatalog) return Promise.resolve(eduCatalog);
    if (eduPending) return eduPending;
    eduPending = fetch("/config/education-catalog.web.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { eduCatalog = d; return d; })
      .catch(function () { return null; });
    return eduPending;
  }

  /* Positionerna speglar webCatalog() i tools/sync-skolverket.mjs:
     ämne [kod, namn, skolform, läroplan, aktiv]
     nivå [kod, ämneskod, visningsnamn, läroplan, aktiv] */
  function eduSuggestions(query) {
    if (!eduCatalog) return [];
    var q = String(query || "").trim().toLowerCase();
    if (q.length < 2) return [];

    /* Träffar som BÖRJAR på det eleven skrev går först. Utan rangordningen
       fyllde katalogordningen listan med kurser som bara råkar innehålla ordet:
       "Biologi" gav fyrtio rader med Bevarandebiologi och Djurens biologi innan
       "Biologi 1" och "Biologi (grundskola)" ens syntes. Det är rätt data men
       fel svar på frågan. */
    var prefix = [], inuti = [], i, namn;

    var levels = eduCatalog.levels || [];
    for (i = 0; i < levels.length; i++) {
      namn = levels[i][2];
      var pos = namn.toLowerCase().indexOf(q);
      if (pos === 0) prefix.push(namn);
      else if (pos > 0) inuti.push(namn);
    }

    var subjects = eduCatalog.subjects || [];
    for (i = 0; i < subjects.length; i++) {
      if (subjects[i][2] !== "GR") continue;
      namn = subjects[i][1] + " (grundskola)";
      if (subjects[i][1].toLowerCase().indexOf(q) === 0) prefix.push(namn);
      else if (subjects[i][1].toLowerCase().indexOf(q) > 0) inuti.push(namn);
    }

    /* Inom prefixgruppen vinner det kortaste namnet. Katalogordningen är
       alfabetisk på ÄMNESKOD, vilket gav "Biologi – naturbruk – specialisering"
       före "Biologi 1". Längden är en grov men träffsäker närhetsmätning: ju
       mindre som står efter det eleven skrev, desto närmare är det det hen
       menade. */
    prefix.sort(function (a, b) { return a.length - b.length || a.localeCompare(b, "sv"); });
    return prefix.concat(inuti).slice(0, 40);
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
    inp.setAttribute("list", "xfCourseList");
    b.appendChild(inp);

    /* En datalist och inte en egen rullgardin: den ärver systemets tangent- och
       skärmläsarbeteende gratis, och fungerar likadant på mobil. Listan fylls om
       vid varje tangenttryck och kapas — 2192 poster i en datalist är oanvändbart
       på telefon, vilket är där de flesta pluggar. */
    var dl = el("datalist");
    dl.id = "xfCourseList";
    b.appendChild(dl);

    function paintSuggestions() {
      var rows = eduSuggestions(inp.value);
      dl.textContent = "";
      for (var i = 0; i < rows.length; i++) {
        var o = document.createElement("option");
        o.value = rows[i];
        dl.appendChild(o);
      }
    }

    loadEduCatalog().then(paintSuggestions);

    var err = el("div", "xf-err");
    b.appendChild(err);

    function next() {
      var v = inp.value.trim();
      if (!v) { err.textContent = "Skriv vilken kurs det gäller så kan jag matcha nivån."; inp.focus(); return; }
      S.course = v;
      stepAim();
    }

    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") next(); });
    inp.addEventListener("input", function () { err.textContent = ""; paintSuggestions(); });

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
    var all = Object.keys(freq);

    // Ord som återkommer är den starkaste signalen och kommer först.
    var repeated = all
      .filter(function (w) { return freq[w] >= 2; })
      .sort(function (a, b) { return freq[b] - freq[a]; });

    /* En kort inklistring — några meningar från en anteckning — innehåller
       ofta varje begrepp exakt en gång. Med enbart återkomstregeln blev raden
       då tom och föll tillbaka på ett teckenantal, vilket sett från elevens
       håll ser ut som att ingenting lästes. Mätt på produktionssajten:
       "Cellandning sker i mitokondrien. Glykolysen ger 2 ATP…" gav noll
       begrepp. Fyll därför på med de längsta orden — fortfarande elevens egna
       ord, bara valda på särprägel i stället för på upprepning. */
    if (repeated.length < 3) {
      var byLength = all
        .filter(function (w) { return repeated.indexOf(w) === -1 && w.length >= 7; })
        .sort(function (a, b) { return b.length - a.length; });
      repeated = repeated.concat(byLength);
    }

    return repeated.slice(0, 6);
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
    // Varje generering drar ur elevens kvot. Ett dubbelklick, eller "Gör om"
    // tryckt två gånger, får inte kosta två prov.
    if (S.generating) return;
    S.generating = true;

    btn.disabled = true;
    btn.textContent = "Bygger…";
    busy(true);
    err.textContent = "";
    say("Bygger ditt prov.", "Tar oftast under en minut.");

    function done() {
      S.generating = false;
      busy(false);
      btn.disabled = false;
      btn.textContent = "Skapa provet";
    }

    window.ExGenEngine.setInputs({
      course: S.course, level: S.level, qType: S.qType,
      num: S.num, material: S.material
    });

    window.ExGenEngine.generate().then(function (r) {
      done();
      if (!r || !r.ok || !r.exam || !Array.isArray(r.exam.questions) || !r.exam.questions.length) {
        err.textContent = (r && r.error) || "Provet kunde inte byggas. Försök igen.";
        say("Det gick inte den här gången.", "Försök igen, gärna med färre frågor.");
        return;
      }
      S.exam = normalizeIds(r.exam);
      S.answers = {};
      S.helped = {};
      S.idx = 0;
      S.nudges = 0;
      S.lastNudge = 0;
      S.submitting = false;
      saveDraft();
      openExam();

      /* Kvalitetskontrollen i generate-exam.js sorterar bort frågor den inte
         litar på, och gör det tyst: ett prov på tolv frågor kan landa på sju.
         Mätt skarpt mot gpt-4o-mini underkände verifieraren tre av sex. Utan
         det här beskedet ser eleven bara att kontraktet lovade ett antal och
         provet visar ett annat, vilket läser som en bugg i stället för som
         kvalitetsarbete. */
      var got = S.exam.questions.length;
      if (got < S.num) {
        nudge("Jag skrev " + S.num + " frågor men kastade " + (S.num - got) +
              " som inte höll måttet. Du får " + got + " — hellre färre och rätt.", true);
      }
    }).catch(function (e) {
      /* generate() går via runGenerate i app.html. postJson kastar aldrig, men
         kvotkontrollen på vägen dit gör det: checkQuota → getUserId →
         db.auth.getUser() avvisar när Supabase inte svarar. Utan den här
         grenen blir knappen kvar på "Bygger…" för alltid, utan felmeddelande. */
      done();
      err.textContent = "Något gick fel på vägen. Kontrollera uppkopplingen och försök igen.";
      say("Det gick inte den här gången.", "Försök igen om en stund.");
      if (window.console && console.warn) console.warn("[exam-flow] generate:", e);
    });
  }

  /* Fråge-id kommer ordagrant från modellen och JSON-schemat i
     api/generate-exam.js kräver ingen unikhet. Två frågor med samma id delade
     tidigare samma post i S.answers och S.helped: eleven svarade på fråga 4 och
     såg svaret dyka upp på fråga 9. Normaliseringen sker på plats, på samma
     objekt som motorn redan håller i currentExam, så att rättningens payload,
     felbanken och resultatmatchningen ser samma unika id:n. */
  function normalizeIds(exam) {
    var seen = {};
    exam.questions.forEach(function (q, i) {
      var id = String(q.id != null && String(q.id).trim() ? q.id : i + 1);
      if (seen[id]) id = id + "-" + (i + 1);
      seen[id] = true;
      q.id = id;
    });
    return exam;
  }

  // ── Provläget ────────────────────────────────────────────────────────────

  function qid(q, i) { return String(q.id != null ? q.id : i + 1); }

  /* Låser och låser upp sidans scroll utan att glömma vad som gällde innan.
     Att alltid återställa till tom sträng raderade ett eventuellt inline-värde
     som någon annan del av sidan hade satt. */
  function lockScroll(on) {
    if (on) {
      if (prevOverflow === null) prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    } else if (prevOverflow !== null) {
      document.body.style.overflow = prevOverflow;
      prevOverflow = null;
    }
  }

  function openExam(resumedAt) {
    // Vid återupptagning behålls den tid provet redan pågått. Att nollställa
    // klockan hade dolt att eleven redan suttit en halvtimme och gjort både
    // tidsangivelsen och tempo-varningen missvisande.
    S.startedAt = typeof resumedAt === "number" && resumedAt > 0 ? resumedAt : Date.now();
    UI.exam.classList.add("on");
    document.body.classList.add("xf-in-exam");
    lockScroll(true);
    renderQuestion();
    tick();
    watchKeyboard(true);
  }

  function closeExam() {
    UI.exam.classList.remove("on");
    document.body.classList.remove("xf-in-exam", "xf-per-open");
    lockScroll(false);
    clearTimeout(stuckTimer);
    clearTimeout(UI.nudgeTimer);
    UI.nudge.classList.remove("on");
    if (UI.clock) clearInterval(UI.clock);
    watchKeyboard(false);
    /* Fritextsvar publiceras debouncat (publishSoon, 500ms). Skriver eleven
       klart sista kortsvarsfrågan och trycker "Lämna in" inom den halv-
       sekunden hinner PER.describe(null) nedan köras först — och sedan
       brinner den redan schemalagda timern och kör publish() på nytt, mot
       ett S.exam som fortfarande finns kvar i minnet. Resultatet: manifestet
       återuppstår på resultatskärmen efter att just ha nollställts. Måste
       clear:as INNAN describe(null), annars hinner ingenting förhindra den. */
    clearTimeout(publishTimer);
    /* Samma felklass, en rad ovanför löste den för manifestet: saveDraftSoon()
       (längre ner i filen) har en egen debouncad timer på 800ms. Fyller eleven
       sista kortsvarsfältet och trycker "Lämna in" hinner den timern schemaläggas
       precis innan closeExam() körs. lsDel(draftKey()) tar bort utkastet så fort
       rättningen kommer tillbaka — men saveDraft() bryr sig bara om !S.exam, och
       S.exam nollställs först vid "Nytt ämne". Otömd brinner draftTimer under
       maskinytans animation och skriver tillbaka utkastet, så eleven erbjuds
       "Fortsätt provet du började" för ett prov som redan är rättat.*/
    clearTimeout(draftTimer);
    /* Manifestet hörde till frågan som stod på skärmen, inte till det som
       kommer efteråt (resultat, eller en helt annan skärm om eleven väljer
       "Nytt ämne"). Utan den här raden stod P.E.R kvar på "fråga 12 av 12"
       mitt på resultatskärmen — exakt den felklass branchen finns för att
       döda, bara flyttad hit. */
    if (window.PER && window.PER.describe) window.PER.describe(null);
  }

  /* Det virtuella tangentbordet på mobil läggs ovanpå sidan utan att ändra
     window.innerHeight, så .xf-exam-nav (position:fixed; bottom:0) hamnar bakom
     det så fort eleven skriver ett kortsvar — "Nästa" går inte att nå.
     visualViewport vet var den synliga ytan faktiskt slutar; skillnaden skickas
     till CSS som --xf-kb och navigeringen lyfts lika mycket. */
  function onViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    var hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--xf-kb", Math.round(hidden) + "px");
  }

  function watchKeyboard(on) {
    var vv = window.visualViewport;
    if (!vv) return;
    if (on) {
      vv.addEventListener("resize", onViewport);
      vv.addEventListener("scroll", onViewport);
      onViewport();
    } else {
      vv.removeEventListener("resize", onViewport);
      vv.removeEventListener("scroll", onViewport);
      document.documentElement.style.setProperty("--xf-kb", "0px");
    }
  }

  function tick() {
    if (UI.clock) clearInterval(UI.clock);
    // Klockan räknar uppåt. En nedräkning skapar panik utan att lära någon
    // någonting — men eleven ska ändå se att tiden går.
    function paint() {
      var s = Math.floor((Date.now() - S.startedAt) / 1000);
      UI.time.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }
    // Rita direkt, inte först vid nästa tick. Vid återupptagning står klockan
    // annars kvar på 00:00 i upp till en sekund och hoppar sedan till rätt tid,
    // vilket ser ut som att den nollställdes.
    paint();
    UI.clock = setInterval(paint, 1000);
  }

  /* Manifestet publiceras vid varje frågebyte, inte bara när hjälpknappen
     trycks. Före detta såg P.E.R { page: "prov" } och ingenting mer om eleven
     öppnade bubblan själv — och svarade om fel fråga.

     targets ger P.E.R en väg tillbaka: "ta mig till fråga 7" blir [GOTO:#q7],
     som shared.js slår upp här och kör med go() nedan. */
  var publishTimer = null;

  function publish() {
    if (!window.PER || !window.PER.describe) return;
    var qs = (S.exam && S.exam.questions) || [];
    if (!qs.length) return;
    var i = clamp(S.idx, 0, qs.length - 1);
    var q = qs[i];
    if (!q) return;
    var ans = String(S.answers[qid(q, i)] || "");
    var answered = 0;
    qs.forEach(function (qq, n) {
      if (String(S.answers[qid(qq, n)] || "").trim()) answered++;
    });
    window.PER.describe({
      page: "prov",
      focus: {
        kind: "question",
        number: i + 1,
        of: qs.length,
        text: String(q.question || "").slice(0, 400),
        type: q.type || "short",
        options: Array.isArray(q.options) ? q.options : [],
        category: String(q.topic || ""),
        answer: ans.slice(0, 200),
        answered: !!ans.trim()
      },
      targets: qs.map(function (qq, n) {
        return {
          id: "q" + (n + 1),
          label: "Fråga " + (n + 1),
          hint: String(qq.question || "").slice(0, 90),
          go: function () { S.idx = n; renderQuestion(); }
        };
      }),
      state: {
        answered: answered,
        remaining: qs.length - answered,
        elapsed: (UI.time && UI.time.textContent) || "",
        /* Signalen servern räknar hjälptaket ur. Så länge den här funktionen
           kör står eleven i ett pågående prov, och då når hjälpen högst
           "visa metoden" — aldrig facit. Se stepResult() för motsatsen. */
        phase: "exam"
      }
    });
  }

  /* Fritextsvar skickas 500 ms efter senaste tangenttryck. Varje tecken hade
     annars blivit ett nytt manifest. */
  function publishSoon() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(publish, 500);
  }

  function renderQuestion() {
    var qs = S.exam.questions;
    var i = clamp(S.idx, 0, qs.length - 1);
    S.idx = i;
    var q = qs[i];
    var id = qid(q, i);

    // P.E.R:s svar gällde föregående fråga. Bubblan går tillbaka i sitt gömda
    // läge vid frågebyte så att den inte ligger kvar över svarstexten.
    document.body.classList.remove("xf-per-open");

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
          publish();
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
        saveDraftSoon();
        publishSoon();
        armStuck();
      });
      sheet.appendChild(ta);
    }

    /* Tillståndsraden (#perSees i shared.js) syns bara vid hover över den
       flytande bubblan, och bubblan är helt dold under provet — så eleven kan
       aldrig se den där den skulle betytt något. Knappen är däremot alltid
       synlig. Den bär därför själv beskedet om vilken fråga P.E.R har: säger
       den "fråga 7" vet eleven att det är den frågan som gäller utan att
       behöva fråga. */
    var ask = el("button", "xf-ask" + (S.helped[id] ? " used" : ""),
      S.helped[id] ? "✦ P.E.R hjälpte dig här" : "✦ Fråga P.E.R om fråga " + (i + 1));
    ask.type = "button";
    ask.addEventListener("click", function () {
      /* Flaggan sätts bara om panelen faktiskt öppnas. Knappen på P.E.R-bubblan
         är en växlare: var panelen redan öppen stängde klicket den, och eleven
         fick ändå avdrag i provsalssiffran — för att ha stängt en panel. Hela
         tvåpoängsfunktionen står och faller med att den här flaggan är sann. */
      if (!askPer()) return;
      S.helped[id] = true;
      ask.className = "xf-ask used";
      ask.textContent = "✦ P.E.R hjälpte dig här";
      saveDraft();
    });
    sheet.appendChild(ask);

    UI.sheetWrap.innerHTML = "";
    UI.sheetWrap.appendChild(sheet);
    UI.sheetWrap.scrollTop = 0;

    UI.prev.disabled = i === 0;
    UI.next.textContent = i === S.exam.questions.length - 1 ? "Lämna in" : "Nästa";

    armStuck();
    pace();
    publish();
  }

  /* Öppnar P.E.R-panelen åt eleven. Frågekontexten sätts INTE här — publish()
     skickar redan rätt fråga till manifestet vid varje frågebyte (se ovan).
     Den här funktionen gör bara knapptrycket verkningsfullt: den släpper fram
     den annars dolda bubblan under provet och öppnar panelen om den inte
     redan är öppen.
     Returnerar om panelen faktiskt öppnades — anroparen sätter hjälpflaggan
     bara då. */
  function askPer() {
    var bubble = document.getElementById("perBubble");
    if (!bubble) return false;

    // shared.js sätter .per-open på bubblan medan panelen är uppe. Är den redan
    // öppen finns inget att göra — ett klick hade stängt den i stället.
    if (bubble.classList.contains("per-open")) {
      document.body.classList.add("xf-per-open");
      return true;
    }

    // Den flytande bubblan är dold under provet (den låg över svarstexten på
    // mobil). Klassen släpper fram widgeten så att panelen syns; den tas bort
    // igen vid frågebyte och när provet lämnas.
    document.body.classList.add("xf-per-open");
    bubble.click();
    scrollSheetClear();
    return true;
  }

  /* Panelen lägger sig över arkets nedre del på en telefon. exam-flow.css ger
     arket luft under sig så att ingenting blir instängt; den här raden gör att
     eleven slipper scrolla dit själv — frågans början hamnar överst i det band
     som är kvar ovanför panelen. Ingen effekt på en bred skärm, där panelen
     ligger vid sidan av arket. */
  function scrollSheetClear() {
    var wrap = document.querySelector(".xf-sheet-wrap");
    var sheet = wrap && wrap.querySelector(".xf-sheet");
    if (!wrap || !sheet) return;
    if (window.innerWidth > 600) return;
    var top = sheet.offsetTop - 8;
    if (top < 0) top = 0;
    try { wrap.scrollTo({ top: top, behavior: "smooth" }); }
    catch (_) { wrap.scrollTop = top; }
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

  /* system:true för besked som inte är coachning utan fakta om provet — de får
     inte tystas av inpasskvoten, för då blir de aldrig sagda. */
  function nudge(text, system) {
    if (!system) {
      if (S.nudges >= MAX_NUDGES) return;
      if (Date.now() - S.lastNudge < NUDGE_GAP_MS) return;
      S.nudges++;
    }
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
    /* Flervalsklick på sista frågan schemalägger next() om 260 ms, och next()
       på sista frågan lämnar in. Hann eleven trycka "Lämna in" däremellan kördes
       submit() två gånger: den andra fick tillbaka "Rättning pågår redan." från
       motorn, tolkade det som ett rättningsfel och öppnade provet igen — mitt
       under den första rättningen, som sedan landade bakom provöverlägget. */
    if (S.submitting) return;
    S.submitting = true;

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
        S.submitting = false;
        for (var n = 0; n < qs.length; n++) {
          if (!String(S.answers[qid(qs[n], n)] || "").trim()) { S.idx = n; renderQuestion(); return; }
        }
        return;
      }
    }

    var resumeAt = S.startedAt;
    closeExam();
    machine();

    var answers = qs.map(function (q, n) {
      var id = qid(q, n);
      return { id: id, answer: String(S.answers[id] || "").trim() };
    });

    // Rättningen föll — lämna tillbaka eleven till provet med svaren kvar i
    // stället för till en död skärm. S.nudges nollställs så att beskedet om
    // felet aldrig tystas av inpasskvoten.
    function backToExam(msg) {
      stopMachine().then(function () {
        S.submitting = false;
        S.nudges = 0;
        S.lastNudge = 0;
        openExam(resumeAt);
        nudge(msg);
      });
    }

    window.ExGenEngine.grade(answers).then(function (r) {
      if (!r || !r.ok || !r.result) {
        backToExam((r && r.error) || "Rättningen gick inte igenom. Dina svar är kvar — prova att lämna in igen.");
        return;
      }
      // Rättningen är i hamn: utkastet får försvinna först nu.
      lsDel(draftKey());
      stopMachine().then(function () { stepResult(r.result); });
    }).catch(function (e) {
      /* Utan den här grenen blir ett oväntat avslag från motorn en mörk skärm
         med låst scroll, utan knappar, som bara går att lämna med omladdning —
         och då är svaren borta. */
      backToExam("Något gick fel under rättningen. Dina svar är kvar — prova igen.");
      if (window.console && console.warn) console.warn("[exam-flow] grade:", e);
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
    /* lockScroll(true), inte en direkt tilldelning. Att sätta stilen här utan
       att gå genom lockScroll lämnade prevOverflow som null, och lockScroll(false)
       i stopMachine() gör ingenting när prevOverflow är null — den grenen finns
       just för att inte radera ett inline-värde som någon annan satt.

       Följden var att body.overflow blev "hidden" och satt kvar när
       resultatskärmen visades. Eleven såg sina poäng men kunde inte scrolla ner
       till frågorna, feedbacken eller modellsvaren. Hela värdet av rättningen
       låg utanför rutan. */
    lockScroll(true);
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
        lockScroll(false);
        done();
      }, left);
    });
  }

  // ── Resultat ─────────────────────────────────────────────────────────────

  function stepResult(r) {
    var b = mount("result");

    /* closeExam() har redan nollställt manifestet — frågan som stod på skärmen
       hör inte hit. Men "inget manifest" säger bara att P.E.R inte vet var
       eleven är, och servern tolkar okänt läge strängt: taket fastnar på
       "visa metoden" trots att provet är inlämnat och rättat.

       Här är det inlämnat. Ingen focus, inga targets — de gällde frågorna —
       men phase sägs rakt ut, så att hjälpen öppnas för att den ska öppnas och
       inte för att servern råkar sakna en fråga att hålla igen på. */
    if (window.PER && window.PER.describe) {
      window.PER.describe({ page: "resultat", state: { phase: "result" } });
    }
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

    /* Den andra siffran räknas bara som ett eget besked när den skiljer sig.
       Frågade eleven P.E.R men fick noll poäng på just den frågan är solo lika
       med total, och att då skriva "utan hjälp hade det blivit" följt av samma
       tal läser som ett fel. Villkoret är därför helpedPts, inte helpedCount. */
    var helpMattered = helpedPts > 0;

    if (helpMattered) {
      say("Du fick " + total + " av " + max + ".",
          "Med hjälp på " + helpedCount + (helpedCount === 1 ? " fråga" : " frågor") + ". Utan hjälp hade det blivit " + solo + ".");
    } else if (helpedCount > 0) {
      say("Du fick " + total + " av " + max + ".",
          "Du frågade P.E.R, men poängen är dina — de frågorna gav inget.");
    } else {
      say("Du fick " + total + " av " + max + ".", "Helt på egen hand.");
    }

    // Andra kortet visas bara när det säger något nytt. Två identiska siffror
    // bredvid varandra läser som ett fel, inte som ett besked.
    var scores = el("div", "xf-scores" + (helpMattered ? "" : " solo"));
    var s1 = el("div", "xf-score lead");
    s1.appendChild(el("b", null, total + "/" + max));
    s1.appendChild(el("span", null, "Ditt resultat · " + pct + " %"));
    scores.appendChild(s1);

    if (helpMattered) {
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

      /* Modellen inleder ofta sin återkoppling med "Poäng: 0/1." — samma
         siffra som redan står i rubriken en rad ovanför. Prefixet stryks här
         i stället för i prompten, eftersom grade.js svarar likadant till den
         gamla vyn och till lärarrapporten, som båda saknar den rubriken. */
      var fb = String(item.feedback || "").replace(/^\s*Poäng:\s*\d+\s*\/\s*\d+\.?\s*/i, "");
      if (fb) it.appendChild(el("div", "xf-item-fb", fb));

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

    // En felruta, återanvänd. Att skapa en ny per klick gav tre rader under
    // varandra efter tre misslyckade försök.
    var againErr = el("div", "xf-err");

    var again = el("button", "xf-btn primary", "Gör om — nya frågor, samma nivå");
    again.type = "button";
    again.addEventListener("click", function () { build(again, againErr); });
    act.appendChild(again);

    var toImprove = el("a", "xf-btn ghost", "Se felbanken");
    toImprove.href = "förbättring.html";
    act.appendChild(toImprove);

    var fresh = el("button", "xf-btn quiet", "Nytt ämne");
    fresh.type = "button";
    fresh.addEventListener("click", function () {
      S.exam = null; S.answers = {}; S.helped = {}; S.material = "";
      S.submitting = false;
      // Eleven har uttryckligen övergett provet. Låg utkastet kvar erbjöds det
      // tillbaka vid nästa sidladdning som "Fortsätt provet du började".
      lsDel(draftKey());
      stepSubject();
    });
    act.appendChild(fresh);
    b.appendChild(act);
    b.appendChild(againErr);

    screen("result");
  }

  // ── Utkast ───────────────────────────────────────────────────────────────

  function saveDraft() {
    clearTimeout(draftTimer);
    if (!S.exam) return;
    var ok = lsSet(draftKey(), {
      ts: Date.now(),
      uid: uid(),
      startedAt: S.startedAt,
      course: S.course, level: S.level, qType: S.qType, num: S.num,
      material: S.material, exam: S.exam,
      answers: S.answers, helped: S.helped, idx: S.idx
    });

    /* Utrymmet tog slut. Att spara utan frågorna är betydligt mindre och räcker
       för att svaren ska överleva — provet självt går att bygga om, men det
       eleven har skrivit går inte att återskapa. Först om även det misslyckas
       får eleven veta att löftet inte håller. */
    if (!ok) {
      var slim = lsSet(draftKey(), {
        ts: Date.now(), uid: uid(), startedAt: S.startedAt,
        course: S.course, level: S.level, qType: S.qType, num: S.num,
        answers: S.answers, helped: S.helped, idx: S.idx
      });
      if (!slim && !S.warnedStorage) {
        S.warnedStorage = true;
        nudge("Minnet i webbläsaren är fullt, så jag kan inte spara provet åt dig. Lämna in innan du stänger fliken.");
      }
    }
  }

  // Skrivande sparas fördröjt; allt annat direkt. Se DRAFT_DEBOUNCE_MS.
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_DEBOUNCE_MS);
  }

  /* Läser utkastet och avvisar det som inte hör hemma: fel användare, för
     gammalt, eller sparat i det bantade läget utan frågor (då finns inget prov
     att återuppta). */
  function readDraft() {
    var d = lsGet(draftKey(), null);
    if (!d || !d.exam || !Array.isArray(d.exam.questions) || !d.exam.questions.length) return null;
    if (String(d.uid || "") !== uid()) return null;
    if (d.ts && Date.now() - Number(d.ts) > DRAFT_MAX_AGE_MS) { lsDel(draftKey()); return null; }
    return d;
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

    /* Sidans enda h1. Skärmarnas egna rubriker är h2 — sex h1 samtidigt i
       DOM:en (en per flödessteg) gav ingen dokumentstruktur alls. Den här är
       visuellt dold men läses av skärmläsare och ger sidan ett namn. */
    var pageTitle = el("h1", null, "Skapa prov");
    pageTitle.style.cssText =
      "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;" +
      "clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0";
    root.appendChild(pageTitle);

    UI.screens = {};
    STEPS.forEach(function (name) {
      var sc = el("section", "xf-screen");
      sc.dataset.screen = name;
      sc.setAttribute("aria-hidden", "true");
      var inner = el("div", "xf-inner");

      var per = el("div", "xf-per");
      var orb = el("div", "xf-orb");
      orb.setAttribute("aria-hidden", "true");
      var voice = el("div");
      voice.style.flex = "1";
      var h = el("h2", "xf-say");
      // Fokuseras vid varje skärmbyte, se screen(). tabindex="-1" gör den
      // fokuserbar programmatiskt utan att lägga den i tabbordningen.
      h.tabIndex = -1;
      var sub = el("p", "xf-sub");
      // Rubriken skrivs fram tecken för tecken. aria-live här hade läst upp
      // varje delsträng; fokusflytten i screen() annonserar hela raden en gång.
      sub.setAttribute("aria-live", "polite");
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
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      // Utan detta scrollar arket i sidled samtidigt som frågan byts.
      e.preventDefault();
      if (e.key === "ArrowRight") next();
      else prev();
    });

    /* Ingången från felbanken. förbättring.html skickar eleven till
       app.html#train, och runTrainModeIfRequested() i app.html bygger ihop ett
       material av de fel eleven valt. Innan flödet fanns skrevs det rakt in i
       wizardens textruta; nu är den rutan dold, så materialet måste in här i
       stället. Hoppet går direkt till kontraktet — kurs och material är redan
       kända, och att fråga om dem igen vore att låtsas. */
    window.__xfPrefill = function (material, course) {
      var mat = String(material || "").trim();
      if (!mat) return false;
      S.material = mat.slice(0, MATERIAL_MAX);
      if (course) S.course = String(course).trim();
      if (!S.course) S.course = dna().courses[0] || "Repetition";
      var d = dna();
      S.level = d.level;
      S.qType = "mix";
      S.num = clamp(d.num, 3, 20);
      stepContract();
      return true;
    };
  }

  /* Motorn bor i app.html och initieras på DOMContentLoaded. Vänta in den
     hellre än att gissa ordningen mellan två script-taggar.

     Kommer den aldrig får eleven INTE en tom sida: den gamla wizarden tas fram
     ur sitt hidden-läge igen. Den är ful men fungerande, och en fungerande ful
     sida är oändligt mycket bättre än en vit. */
  function waitForEngine(tries) {
    if (window.ExGenEngine && window.ExGenEngine.ready) { boot(); return; }
    if (tries > 200) {
      var main = document.getElementById("main-content");
      if (main) main.removeAttribute("hidden");
      var xf = document.getElementById("xf");
      if (xf) xf.style.display = "none";
      if (window.console && console.error) {
        console.error("[exam-flow] ExGenEngine blev aldrig ready — föll tillbaka på wizarden.");
      }
      return;
    }
    setTimeout(function () { waitForEngine(tries + 1); }, 50);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { waitForEngine(0); });
  } else {
    waitForEngine(0);
  }
})();
