/* js/xf-screens.js — skärmväxlaren, delad.
 *
 * Bygger N skärmar med samma form som provskaparen, visar en åt gången och
 * sköter det som är lätt att glömma: aria-hidden på skärmarna som är av, fokus
 * till den nya skärmens rubrik, en enda h1 på sidan, och — om man ber om det —
 * webbläsarens historik.
 *
 * Formen är identisk med den js/exam-flow.js bygger, så exgen-ui.css:s
 * vokabulär gäller rakt av:
 *
 *   section.xf-screen > div.xf-inner
 *     > div.xf-per > div.xf-orb + div > h2.xf-say + p.xf-sub
 *     > div.xf-body
 *
 * Behållaren äger modulen INTE. exam-flow.css sätter #xf till min-height:100dvh
 * och display:flex för provflödets räkning; en annan konsument får bestämma
 * själv. .xf-screen har flex:1, som helt enkelt är inert om föräldern inte är
 * en flexbehållare — skärmen fungerar ändå.
 *
 * Den här filen är INTE utbruten ur exam-flow.js. Provflödet lämnas orört — det
 * är den högst riskerade filen på sajten, och en delad modul är inte värd att
 * betala för med provet. Följden är två implementationer av samma idé, och det
 * är ett medvetet och avgränsat beslut: driftspärren i
 * tests/frontend/_harness.test.mjs ser till att det aldrig blir en tredje.
 *
 * En avsiktlig skillnad mot exam-flow.js: där finns en dold "aktuell röst"-
 * pekare som mount() flyttar, med en dokumenterad ordningsfälla — say() före
 * mount() skriver raden i skärmen eleven just lämnade. Här tar varje anrop sitt
 * skärmnamn som argument, så fällan kan inte uppstå.
 *
 * LADDA INTE MED defer. Filen definierar bara window.XfScreens och rör ingen
 * DOM vid laddning, men en sida vars egen kod ligger sist i <body> körs UNDER
 * parsningen — alltså före varje defer-skript. Med defer blev det
 * "ReferenceError: XfScreens is not defined" på förbättring.html, och sidan
 * byggde noll skärmar utan att något annat gick sönder.
 *
 * Kontrakt och motiveringar: tests/frontend/xf-screens.mjs.
 */
(function (global) {
  "use strict";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var SR_ONLY =
    "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;" +
    "clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0";

  function create(opts) {
    opts = opts || {};
    var root = opts.root;
    var names = opts.screens || [];
    var useHash = !!opts.hash;
    if (!root || !names.length) throw new Error("xf-screens: root och screens krävs");

    var parts = {};      // namn -> { screen, say, sub, orb, body }
    var current = null;
    var listeners = [];

    /* Sidans enda h1, visuellt dold. Skärmarnas rubriker är h2 — fem h1 i samma
       DOM (en per skärm) ger ingen dokumentstruktur alls. */
    if (opts.title) {
      var h1 = el("h1", null, opts.title);
      h1.style.cssText = SR_ONLY;
      root.appendChild(h1);
    }

    names.forEach(function (name) {
      var sc = el("section", "xf-screen");
      sc.dataset.screen = name;
      sc.setAttribute("aria-hidden", "true");

      var inner = el("div", "xf-inner");
      var per = el("div", "xf-per");
      var orb = el("div", "xf-orb");
      orb.setAttribute("aria-hidden", "true");

      var col = el("div");
      col.style.cssText = "flex:1;min-width:0";
      var say = el("h2", "xf-say");
      /* tabindex -1: fokuserbar programmatiskt vid skärmbyte, utan att hamna i
         tabbordningen. */
      say.tabIndex = -1;
      var sub = el("p", "xf-sub");
      /* aria-live på undertexten, inte på rubriken: rubriken annonseras redan av
         fokusflytten, och två annonseringar av samma byte är brus. */
      sub.setAttribute("aria-live", "polite");
      col.appendChild(say);
      col.appendChild(sub);
      per.appendChild(orb);
      per.appendChild(col);

      var body = el("div", "xf-body");
      inner.appendChild(per);
      inner.appendChild(body);
      sc.appendChild(inner);
      root.appendChild(sc);

      parts[name] = { screen: sc, say: say, sub: sub, orb: orb, body: body };
    });

    /* Den första skärmen är sidans grundtillstånd och får inget eget fragment —
       annars bär en delad länk till startläget ett fragment som inte betyder
       något. */
    function hashFor(name) {
      return name === names[0] ? "" : "#" + name;
    }

    function apply(name) {
      names.forEach(function (n) {
        var on = n === name;
        parts[n].screen.classList.toggle("on", on);
        /* display:none räcker för den som ser. En skärmläsare som traverserar
           DOM:en hittar annars alla skärmars rubriker samtidigt. */
        if (on) parts[n].screen.removeAttribute("aria-hidden");
        else parts[n].screen.setAttribute("aria-hidden", "true");
      });
      current = name;
      /* "instant" är ett giltigt ScrollBehavior-värde men aldrig en egenskap på
         window — en feature-detektering här väljer alltid "auto" och ger en mjuk
         scroll där en omedelbar var meningen. */
      window.scrollTo({ top: 0, behavior: "instant" });
      try { parts[name].say.focus({ preventScroll: true }); }
      catch (_) { parts[name].say.focus(); }
      for (var i = 0; i < listeners.length; i++) listeners[i](name);
    }

    function show(name, silent) {
      if (!parts[name]) return false;
      if (name === current) return true;
      if (useHash && !silent) {
        /* pushState, inte location.hash: en hash-tilldelning utlöser hashchange,
           som skulle ropa tillbaka hit och byta skärm en gång till. pushState är
           tyst och ger ändå bakåtknappen ett steg att gå till. */
        history.pushState({ xf: name }, "", location.pathname + location.search + hashFor(name));
      }
      apply(name);
      return true;
    }

    if (useHash) {
      window.addEventListener("popstate", function () {
        var want = decodeURIComponent(location.hash.replace(/^#/, ""));
        show(parts[want] ? want : names[0], true);
      });
    }

    /* Startläge. En djuplänk (förbättring.html#felbank) ska landa på sin skärm —
       annars är länken app.html och P.E.R skickar eleven till en lögn. */
    var start = useHash ? decodeURIComponent(location.hash.replace(/^#/, "")) : "";
    apply(parts[start] ? start : names[0]);

    return {
      show: function (name) { return show(name, false); },
      current: function () { return current; },
      has: function (name) { return !!parts[name]; },
      body: function (name) {
        var p = parts[name];
        if (!p) return null;
        p.body.innerHTML = "";
        return p.body;
      },
      say: function (name, text, sub) {
        var p = parts[name];
        if (!p) return;
        p.say.textContent = text == null ? "" : String(text);
        p.sub.textContent = sub == null ? "" : String(sub);
      },
      busy: function (name, on) {
        var p = parts[name];
        if (p) p.orb.classList.toggle("busy", !!on);
      },
      on: function (fn) { if (typeof fn === "function") listeners.push(fn); }
    };
  }

  global.XfScreens = { create: create };
})(window);
