/* js/per-onboarding.js — P.E.R:s introduktion för nya konton.
 *
 * Fyra frågor, alltid hoppbar, resten lär P.E.R. sig efter hand. Ett längre
 * formulär hade gett en fylligare profil på de konton som orkade fylla i det,
 * och sämre data totalt: den som hoppar av innan appen ens visats lämnar
 * ingenting alls.
 *
 * Ingen byggkedja, som resten av ExGen. IIFE, egna stilar, vanilla DOM.
 *
 * Servern äger besluten. Klienten frågar "ska den visas?" och får ja eller
 * nej — den läser aldrig av flaggan eller onboarded_at själv, eftersom båda
 * hänger på saker klienten inte får se.
 */
(function () {
  "use strict";

  var SESSION_KEY = "sb-mnmotdluigzeehdjbhbu-auth-token";
  var CATALOG_URL = "/config/education-catalog.web.json";
  var SKIP_KEY = "exgen_onboarding_dismissed";

  function token() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return "";
      var s = JSON.parse(raw);
      return (s && s.access_token) || "";
    } catch (_) { return ""; }
  }

  function api(action, body) {
    return fetch("/api/check-role", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
      body: JSON.stringify(Object.assign({ action: action }, body || {})),
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  /* ── Stilar ───────────────────────────────────────────────────────────────
     Ljusa ExGen-tokens med fallback, eftersom exgen-tokens.css inte är länkad
     från varje sida än. Gradienten används bara som fyllning och aldrig bakom
     text — den klarar inte AA i något textläge (se exgen-tokens.css). */
  var CSS = [
    '#perOb{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;',
      'background:var(--exgen-bg,#fff);padding:20px;overflow-y:auto;',
      'font-family:var(--exgen-font,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);',
      'color:var(--exgen-text,#1B2430)}',
    '#perOb[hidden]{display:none}',
    /* Klass, inte inline body.style.overflow. app.htmls hideLock() nollar den
       inline-stilen när inloggningslåset släpps, vilket sker asynkront efter
       att introduktionen redan öppnat sig — sidan bakom gick då att scrolla. */
    'html.perOb-lock,html.perOb-lock body{overflow:hidden}',
    '#perObCard{width:100%;max-width:560px;margin:auto}',

    /* P.E.R-märket. En ring som ritas upp en gång, inte en loop — en
       animation som aldrig tar slut läser hjärnan som "det laddar", och
       ingenting laddar här. */
    '.perObMark{width:64px;height:64px;margin:0 auto 22px;position:relative}',
    '.perObMark svg{display:block;width:100%;height:100%}',
    '.perObRing{fill:none;stroke:url(#perObGrad);stroke-width:5;stroke-linecap:round;',
      'stroke-dasharray:170;stroke-dashoffset:170;transform:rotate(-90deg);transform-origin:50% 50%;',
      'animation:perObDraw .9s cubic-bezier(.22,.61,.36,1) forwards}',
    '.perObCore{fill:url(#perObGrad);opacity:0;animation:perObPop .5s cubic-bezier(.22,.61,.36,1) .5s forwards}',
    '@keyframes perObDraw{to{stroke-dashoffset:0}}',
    '@keyframes perObPop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}',

    '.perObStep{animation:perObIn .34s cubic-bezier(.22,.61,.36,1) both}',
    '@keyframes perObIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',

    '.perObSay{font-size:clamp(19px,4.4vw,25px);font-weight:700;letter-spacing:-.02em;',
      'line-height:1.28;margin:0 0 8px;text-align:center}',
    '.perObSub{font-size:14px;line-height:1.55;color:var(--exgen-text-secondary,#667085);',
      'margin:0 0 24px;text-align:center}',

    '.perObOpts{display:flex;flex-direction:column;gap:9px}',
    '.perObOpt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;',
      'background:var(--exgen-bg,#fff);border:1.5px solid var(--exgen-border,#E4E7EC);',
      'border-radius:var(--exgen-radius,12px);padding:14px 16px;font:inherit;color:inherit;',
      'transition:border-color .15s cubic-bezier(.22,.61,.36,1),background .15s,transform .15s}',
    '.perObOpt:hover{border-color:var(--exgen-teal,#00B7D9);background:var(--exgen-bg-secondary,#F8FAFC)}',
    '.perObOpt:active{transform:scale(.99)}',
    '.perObOpt:focus-visible{outline:2px solid var(--exgen-teal,#00B7D9);outline-offset:2px}',
    '.perObOpt[aria-pressed="true"]{border-color:var(--exgen-teal,#00B7D9);background:var(--exgen-bg-secondary,#F8FAFC)}',
    '.perObOptT{display:block;font-weight:600;font-size:15px}',
    '.perObOptD{display:block;font-size:13px;color:var(--exgen-text-secondary,#667085);margin-top:2px}',
    '.perObTick{margin-left:auto;flex:none;width:20px;height:20px;border-radius:50%;',
      'border:1.5px solid var(--exgen-border,#E4E7EC);display:grid;place-items:center;font-size:12px;color:#fff}',
    '.perObOpt[aria-pressed="true"] .perObTick{background:var(--exgen-teal,#00B7D9);border-color:var(--exgen-teal,#00B7D9)}',

    '.perObGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(62px,1fr));gap:8px}',
    '.perObGrid .perObOpt{justify-content:center;text-align:center;padding:14px 8px}',

    '.perObField{width:100%;box-sizing:border-box;padding:12px 14px;font:inherit;font-size:15px;',
      'border:1.5px solid var(--exgen-border,#E4E7EC);border-radius:var(--exgen-radius,12px);',
      'background:var(--exgen-bg,#fff);color:inherit;margin-bottom:10px}',
    '.perObField:focus{outline:none;border-color:var(--exgen-teal,#00B7D9)}',

    '.perObScroll{max-height:236px;overflow-y:auto;-webkit-overflow-scrolling:touch;',
      'border:1px solid var(--exgen-border,#E4E7EC);border-radius:var(--exgen-radius,12px);padding:8px}',
    '.perObScroll .perObOpt{border:none;padding:10px 12px;border-radius:8px}',

    '.perObBar{display:flex;align-items:center;gap:12px;margin-top:22px}',
    '.perObNext{flex:1;cursor:pointer;border:none;border-radius:var(--exgen-radius,12px);padding:13px 20px;',
      'font:inherit;font-weight:700;font-size:15px;color:var(--exgen-navy,#0E1B2A);',
      'background:var(--exgen-gradient,linear-gradient(110deg,#00B7D9 0%,#28C3B5 48%,#76D76A 100%));',
      'transition:filter .15s,opacity .15s}',
    '.perObNext:hover{filter:brightness(1.06)}',
    '.perObNext:disabled{opacity:.4;cursor:not-allowed}',
    /* min-height 44px: knappen trycks med tummen, och 14px text med 8px padding
       ger en träffyta på ~36px — under det som går att träffa pålitligt. */
    '.perObSkip{background:none;border:none;cursor:pointer;font:inherit;font-size:14px;',
      'min-height:44px;padding:8px 12px;',
      'color:var(--exgen-text-secondary,#667085);text-decoration:underline;text-underline-offset:3px}',
    '.perObSkip:hover{color:var(--exgen-text,#1B2430)}',

    '.perObDots{display:flex;gap:6px;justify-content:center;margin-top:20px}',
    '.perObDot{width:6px;height:6px;border-radius:50%;background:var(--exgen-border,#E4E7EC);transition:background .2s,width .2s}',
    '.perObDot.on{width:18px;background:var(--exgen-teal,#00B7D9)}',

    '.perObNote{font-size:12.5px;line-height:1.5;color:var(--exgen-text-secondary,#667085);',
      'text-align:center;margin:18px 0 0}',

    '@media (prefers-reduced-motion:reduce){',
      '#perOb *,#perOb *::before{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}',
      '.perObRing{stroke-dashoffset:0}.perObCore{opacity:1}}',
  ].join("");

  function injectCss() {
    if (document.getElementById("perObCss")) return;
    var st = document.createElement("style");
    st.id = "perObCss";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "onclick") n.addEventListener("click", attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* ── Katalogen ────────────────────────────────────────────────────────────
     Hämtas först när ett gymnasiesteg faktiskt visas. Filen är ~175 kB och ska
     inte belasta den som är i grundskolan eller hoppar över direkt. */
  var catalog = null;
  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    return fetch(CATALOG_URL)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { catalog = d; return d; })
      .catch(function () { return null; });
  }

  // Positionerna speglar webCatalog() i tools/sync-skolverket.mjs.
  function programs() { return ((catalog && catalog.programs) || []); }
  function subjectName(code) {
    var rows = (catalog && catalog.subjects) || [];
    for (var i = 0; i < rows.length; i++) if (rows[i][0] === code) return rows[i][1];
    return null;
  }

  var state = { persona: null, values: {} };

  function start() {
    injectCss();

    var host = el("div", { id: "perOb", role: "dialog", "aria-modal": "true", "aria-label": "Lär känna P.E.R." });
    var card = el("div", { id: "perObCard" });
    host.appendChild(card);
    document.body.appendChild(host);

    document.documentElement.classList.add("perOb-lock");

    function close() {
      document.documentElement.classList.remove("perOb-lock");
      document.removeEventListener("keydown", onKey);
      host.remove();
    }

    function skip() {
      try { localStorage.setItem(SKIP_KEY, "1"); } catch (_) {}
      /* Ett överhoppat svar är också ett svar: onboarded_at sätts, så
         introduktionen inte möter samma person vid varje inloggning.
         Inga värden skickas med. */
      api("onboarding_complete", { persona: state.persona || "elev", values: {} });
      close();
    }

    /* aria-modal säger åt skärmläsare att ignorera sidan bakom, men det stoppar
       inte Tab. Utan fällan vandrar fokus ut i appen bakom överlägget, och den
       som navigerar med tangentbord tappar bort sig i en dialog de inte kan se
       att de lämnat. */
    function onKey(e) {
      if (e.key === "Escape") return skip();
      if (e.key !== "Tab") return;
      var fokuserbara = host.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])");
      if (!fokuserbara.length) return;
      var först = fokuserbara[0];
      var sist = fokuserbara[fokuserbara.length - 1];
      if (e.shiftKey && document.activeElement === först) { e.preventDefault(); sist.focus(); }
      else if (!e.shiftKey && document.activeElement === sist) { e.preventDefault(); först.focus(); }
      else if (!host.contains(document.activeElement)) { e.preventDefault(); först.focus(); }
    }
    document.addEventListener("keydown", onKey);

    var steps = [];
    var idx = 0;

    function markSvg() {
      var wrap = el("div", { class: "perObMark" });
      wrap.innerHTML =
        '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
        '<defs><linearGradient id="perObGrad" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#00B7D9"/><stop offset=".5" stop-color="#28C3B5"/>' +
        '<stop offset="1" stop-color="#76D76A"/></linearGradient></defs>' +
        '<circle class="perObRing" cx="32" cy="32" r="27"/>' +
        '<circle class="perObCore" cx="32" cy="32" r="9"/></svg>';
      return wrap;
    }

    function dots() {
      var row = el("div", { class: "perObDots" });
      for (var i = 0; i < steps.length; i++) {
        row.appendChild(el("span", { class: "perObDot" + (i === idx ? " on" : "") }));
      }
      return row;
    }

    function option(title, desc, selected, onPick) {
      var kids = [el("span", {}, [
        el("span", { class: "perObOptT", text: title }),
        desc ? el("span", { class: "perObOptD", text: desc }) : null,
      ])];
      kids.push(el("span", { class: "perObTick", text: "✓", "aria-hidden": "true" }));
      return el("button", {
        type: "button",
        class: "perObOpt",
        "aria-pressed": selected ? "true" : "false",
        onclick: onPick,
      }, kids);
    }

    /* Ett steg = rubrik, innehåll och en knapprad. render() byter innehåll och
       flyttar fokus till rubriken, så att en skärmläsare läser upp den nya
       frågan i stället för att lämna fokus kvar på knappen som försvann. */
    function render() {
      var step = steps[idx];
      var body = el("div", { class: "perObStep" });

      var head = el("h2", { class: "perObSay", text: step.say, tabindex: "-1" });
      body.appendChild(head);
      if (step.sub) body.appendChild(el("p", { class: "perObSub", text: step.sub }));
      body.appendChild(step.build());

      var next = el("button", { type: "button", class: "perObNext", text: step.nextLabel || "Fortsätt" });
      if (step.canAdvance && !step.canAdvance()) next.disabled = true;
      next.addEventListener("click", function () { advance(); });

      var bar = el("div", { class: "perObBar" }, [
        next,
        el("button", { type: "button", class: "perObSkip", text: "Hoppa över", onclick: skip }),
      ]);
      body.appendChild(bar);
      body.appendChild(dots());
      if (step.note) body.appendChild(el("p", { class: "perObNote", text: step.note }));

      card.textContent = "";
      card.appendChild(markSvg());
      card.appendChild(body);
      head.focus();
    }

    function advance() {
      buildSteps();
      if (idx >= steps.length - 1) return finish();
      idx += 1;
      render();
    }

    /* Ett enkelval behöver ingen bekräftelseknapp. Att välja "Gymnasiet" och
       sedan trycka Fortsätt är två handlingar för ett beslut, och med fem steg
       blir det tio tryck för en introduktion som ska kännas kort. Flervalssteg
       (ämnen) och frivilliga steg (mål) behåller knappen, eftersom "klar" där
       inte går att utläsa ur ett klick. */
    function pickAndAdvance() {
      buildSteps();
      if (idx >= steps.length - 1) return render();
      idx += 1;
      render();
    }

    function finish() {
      var payload = { persona: state.persona || "elev", values: state.values };
      close();
      api("onboarding_complete", payload);
    }

    /* Stegen byggs om efter varje val, eftersom vilka frågor som återstår beror
       på svaren: grundskolan får ingen programfråga, och lärare och föräldrar
       får inte elevens frågor alls. */
    function buildSteps() {
      steps = [stepPersona()];
      if (state.persona === "elev") {
        steps.push(stepSchoolType());
        if (state.values.school_type === "gymnasium") steps.push(stepProgram());
        steps.push(stepYear());
        steps.push(stepSubjects());
        steps.push(stepGoal());
      } else if (state.persona === "larare") {
        steps.push(stepTeacher());
      } else if (state.persona === "foralder") {
        steps.push(stepParent());
      }
    }

    function stepPersona() {
      return {
        say: "Innan vi börjar vill jag lära känna dig lite.",
        sub: "Hur använder du ExGen?",
        canAdvance: function () { return !!state.persona; },
        build: function () {
          var box = el("div", { class: "perObOpts" });
          [
            ["elev", "Elev", "Jag pluggar själv"],
            ["larare", "Lärare", "Jag undervisar"],
            ["foralder", "Förälder", "Jag stöttar mitt barn"],
          ].forEach(function (row) {
            box.appendChild(option(row[1], row[2], state.persona === row[0], function () {
              var bytte = state.persona !== row[0];
              state.persona = row[0];
              if (bytte) state.values = {};
              pickAndAdvance();
            }));
          });
          return box;
        },
      };
    }

    function stepSchoolType() {
      return {
        say: "Var pluggar du?",
        canAdvance: function () { return !!state.values.school_type; },
        build: function () {
          var box = el("div", { class: "perObOpts" });
          [
            ["grundskola", "Grundskolan", "Årskurs 1–9"],
            ["gymnasium", "Gymnasiet", "Ett nationellt program"],
          ].forEach(function (row) {
            box.appendChild(option(row[1], row[2], state.values.school_type === row[0], function () {
              if (state.values.school_type !== row[0]) {
                // Byte av skolform gör program, årskurs och ämnen ogiltiga.
                delete state.values.program_code;
                delete state.values.grade_year;
                delete state.values.subject_codes;
              }
              state.values.school_type = row[0];
              loadCatalog();
              pickAndAdvance();
            }));
          });
          return box;
        },
      };
    }

    function stepProgram() {
      return {
        say: "Vilket program går du?",
        sub: "Sök på programmets namn.",
        canAdvance: function () { return !!state.values.program_code; },
        note: "Uppgifterna kommer från Skolverkets läroplaner.",
        build: function () {
          var wrap = el("div", {});
          var search = el("input", {
            class: "perObField", type: "search", placeholder: "Sök program…",
            "aria-label": "Sök gymnasieprogram", autocomplete: "off",
          });
          var list = el("div", { class: "perObScroll" });
          wrap.appendChild(search);
          wrap.appendChild(list);

          function paint() {
            var q = search.value.trim().toLowerCase();
            list.textContent = "";
            var rows = programs().filter(function (p) {
              return !q || p[1].toLowerCase().indexOf(q) !== -1;
            }).slice(0, 60);
            if (!rows.length) {
              list.appendChild(el("p", { class: "perObSub", style: "margin:12px 0", text: catalog ? "Inget program matchar." : "Hämtar programmen…" }));
              return;
            }
            rows.forEach(function (p) {
              list.appendChild(option(p[1], null, state.values.program_code === p[0], function () {
                state.values.program_code = p[0];
                /* Programmets ämnen fyller i ämnessteget i förväg. Eleven
                   behöver då bara ta bort det som inte stämmer i stället för
                   att leta rätt på tretton ämnen i en lista på 900. */
                state.values.subject_codes = (p[5] || []).slice(0, 12);
                pickAndAdvance();
              }));
            });
          }

          search.addEventListener("input", paint);
          loadCatalog().then(paint);
          paint();
          return wrap;
        },
      };
    }

    function stepYear() {
      var gymnasium = state.values.school_type === "gymnasium";
      return {
        say: gymnasium ? "Vilket år går du?" : "Vilken årskurs går du i?",
        canAdvance: function () { return !!state.values.grade_year; },
        build: function () {
          var grid = el("div", { class: "perObGrid" });
          var max = gymnasium ? 3 : 9;
          for (var i = 1; i <= max; i++) {
            (function (n) {
              grid.appendChild(option(gymnasium ? "År " + n : String(n), null, state.values.grade_year === n, function () {
                state.values.grade_year = n;
                pickAndAdvance();
              }));
            })(i);
          }
          return grid;
        },
      };
    }

    function stepSubjects() {
      return {
        say: "Vilka ämnen vill du ha hjälp med?",
        sub: "Välj de viktigaste — du kan ändra det när som helst.",
        canAdvance: function () { return true; },
        nextLabel: "Fortsätt",
        build: function () {
          var wrap = el("div", {});
          var chosen = state.values.subject_codes || [];
          var box = el("div", { class: "perObScroll" });

          function paint() {
            box.textContent = "";
            var codes = state.values.subject_codes || [];
            var pool = codes.slice();
            /* Programmets egna ämnen ligger överst. Är inget program valt
               (grundskolan) visas grundskolans ämnen. */
            if (state.values.school_type === "grundskola" && catalog) {
              (catalog.subjects || []).forEach(function (s) {
                if (s[2] === "GR" && pool.indexOf(s[0]) === -1) pool.push(s[0]);
              });
            }
            if (!pool.length) {
              box.appendChild(el("p", { class: "perObSub", style: "margin:12px 0", text: "Hämtar ämnen…" }));
              return;
            }
            pool.slice(0, 40).forEach(function (code) {
              var namn = subjectName(code) || code;
              var on = (state.values.subject_codes || []).indexOf(code) !== -1;
              box.appendChild(option(namn, null, on, function () {
                var cur = state.values.subject_codes || [];
                var i = cur.indexOf(code);
                if (i === -1) { if (cur.length < 12) cur.push(code); }
                else cur.splice(i, 1);
                state.values.subject_codes = cur;
                paint();
              }));
            });
          }

          wrap.appendChild(box);
          if (!catalog) loadCatalog().then(paint);
          if (!chosen.length) state.values.subject_codes = [];
          paint();
          return wrap;
        },
      };
    }

    function stepGoal() {
      return {
        say: "Vad siktar du på?",
        sub: "Frivilligt — men det hjälper mig lägga nivån rätt.",
        canAdvance: function () { return true; },
        nextLabel: "Klart",
        note: "Du kan se och ändra allt jag vet om dig under Konto.",
        build: function () {
          var wrap = el("div", {});
          wrap.appendChild(el("p", { class: "perObSub", style: "text-align:left;margin:0 0 8px", text: "Målbetyg" }));
          var grid = el("div", { class: "perObGrid" });
          ["E", "D", "C", "B", "A"].forEach(function (g) {
            grid.appendChild(option(g, null, state.values.goal_grade === g, function () {
              state.values.goal_grade = state.values.goal_grade === g ? undefined : g;
              if (!state.values.goal_grade) delete state.values.goal_grade;
              render();
            }));
          });
          wrap.appendChild(grid);

          wrap.appendChild(el("p", { class: "perObSub", style: "text-align:left;margin:18px 0 8px", text: "Hur vill du att jag förklarar?" }));
          var box = el("div", { class: "perObOpts" });
          [
            ["stegvis", "Steg för steg"],
            ["ledtrad_forst", "Ledtråd först, svar sen"],
            ["kort", "Korta svar"],
            ["utforlig", "Utförliga förklaringar"],
          ].forEach(function (row) {
            box.appendChild(option(row[1], null, state.values.help_style === row[0], function () {
              state.values.help_style = state.values.help_style === row[0] ? undefined : row[0];
              if (!state.values.help_style) delete state.values.help_style;
              render();
            }));
          });
          wrap.appendChild(box);
          return wrap;
        },
      };
    }

    function stepTeacher() {
      return {
        say: "Kort om din undervisning.",
        sub: "Frivilligt. Det påverkar bara hur jag formulerar mig med dig.",
        canAdvance: function () { return true; },
        nextLabel: "Klart",
        /* Lärarpanelen nämns med flit inte här. Att välja Lärare i
           introduktionen ger ingen behörighet till elevdata — rollen sätts
           separat — och en text som antyder motsatsen skapar en förväntan
           produkten inte infriar. */
        note: "Du kan se och ändra allt jag vet om dig under Konto.",
        build: function () {
          var wrap = el("div", {});
          var skola = el("input", { class: "perObField", type: "text", placeholder: "Skola (frivilligt)", "aria-label": "Skola", maxlength: "80" });
          var arskurser = el("input", { class: "perObField", type: "text", placeholder: "Årskurser du undervisar i (frivilligt)", "aria-label": "Årskurser", maxlength: "80" });
          skola.value = state.values.school_name || "";
          arskurser.value = state.values.teaches_grades || "";
          skola.addEventListener("input", function () { state.values.school_name = skola.value; });
          arskurser.addEventListener("input", function () { state.values.teaches_grades = arskurser.value; });
          wrap.appendChild(skola);
          wrap.appendChild(arskurser);
          return wrap;
        },
      };
    }

    function stepParent() {
      return {
        say: "Bra att veta.",
        sub: "Jag visar aldrig ditt barns svar, chattar eller enskilda resultat för dig. Vill ni dela något är det ditt barn som bjuder in dig.",
        canAdvance: function () { return true; },
        nextLabel: "Jag förstår",
        note: "Du kan se och ändra allt jag vet om dig under Konto.",
        build: function () {
          var wrap = el("div", {});
          var vad = el("input", {
            class: "perObField", type: "text", maxlength: "200",
            placeholder: "Vad vill du ha hjälp med? (frivilligt)", "aria-label": "Vad vill du ha hjälp med",
          });
          vad.value = state.values.focus_note || "";
          vad.addEventListener("input", function () { state.values.focus_note = vad.value; });
          wrap.appendChild(vad);
          return wrap;
        },
      };
    }

    buildSteps();
    render();
  }

  function boot() {
    if (!token()) return;
    try { if (localStorage.getItem(SKIP_KEY)) return; } catch (_) {}
    api("onboarding_state").then(function (d) {
      if (d && d.show === true) start();
    }).catch(function () { /* introduktionen är aldrig värd att fela på */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Testkrok — samma mönster som window.__perTestCtx i shared.js.
  window.__perOnboarding = { start: start, state: state };
})();
