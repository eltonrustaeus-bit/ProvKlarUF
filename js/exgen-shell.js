/* exgen-shell.js — sidhuvudet: markup OCH beteende.
 *
 * Filen band tidigare bara mobilknappen. Skälet till att den nu renderar hela
 * huvudet är mätt, inte antaget — navigeringen fanns i fyra implementationer
 * med olika innehåll per sida:
 *
 *   index                saknade sitt eget Hem
 *   förbättring          saknade både Hem och Min utveckling
 *   admin                saknade Körkortsteorin
 *   app, korkortet       egna klassnamn (.ddItem) och egna animationer
 *   larare               ingen navigering alls
 *
 * Dessutom bar style.css varje menyregel dubbelt (.mWrap/.menuWrap,
 * .drop/.dropdown, .ddi/.ddItem), tre öppna-klasser stöddes samtidigt
 * (.drop.on, .dropdown.is-open, .dropdown.open), och sju av åtta sidor hämtade
 * en 1024px-ikon från ungdrive.se för att rita den i 12x12 medan index använde
 * en lokal fil på 2,4 kB.
 *
 * Ingen av skillnaderna var ett beslut. De var vad som hände när samma sak
 * skrevs åtta gånger.
 *
 * En sida deklarerar bara att den vill ha huvudet:
 *
 *     <div data-xg-header></div>
 *
 * Sidlokala poster (app-sidans skrollankare, förbättringssidans "Rensa all
 * data") sätts före skriptet och hamnar under en avdelare i arket, aldrig
 * blandade med navigeringen:
 *
 *     <script>window.XG_MENU_EXTRA = [{ label: "…", id: "…", pill: "…" }];</script>
 *
 * ORDNINGSKRAV: den här filen måste laddas FÖRE shared.js. Båda är defer och
 * körs i dokumentordning när readyState är "interactive" — och shared.js tar då
 * else-grenen och anropar syncLoginButtons() direkt, inte via
 * DOMContentLoaded. Renderas huvudet efteråt står kontoknappen kvar på "Logga
 * in" för en inloggad elev. tests/frontend/header-render.mjs H10 läser
 * skriptordningen i källan, H11 mäter etiketten i DOM:en.
 *
 * korkortet.html, provia-hp.html och live-demo.html migreras INTE hit. Deras
 * moduler är avstängda i js/exgen-modules.js och sidorna omdirigerar till
 * startsidan. Körkortsraden står ändå kvar i listan nedan med sitt data-module,
 * så att en enda flagga räcker den dag modulen släpps.
 *
 * Kontrakt och motiveringar: tests/frontend/header-render.mjs och
 * tests/frontend/header-behaviour.mjs.
 */
(function (global) {
  "use strict";

  /* Ikonerna är path-data, inte hela SVG:er, så att storlek och stroke sätts på
     ett ställe. Samma ikoner som de handskrivna menyerna bar. */
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>',
    pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    car: '<path d="M5 11 8.5 5h7L19 11"/><rect x="2" y="11" width="20" height="8" rx="2"/><circle cx="7.5" cy="19" r="2"/><circle cx="16.5" cy="19" r="2"/>',
    card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
  };

  /* Sajtens navigering. En lista, en gång. */
  var NAV = [
    { href: "index.html",       label: "Hem",            icon: "home" },
    { href: "app.html",         label: "Mockprov",       icon: "doc",   pill: "AI" },
    { href: "förbättring.html", label: "Min utveckling", icon: "pulse", pill: "Coach" },
    { href: "korkortet.html",   label: "Körkortsteorin", icon: "car",   pill: "Nytt", module: "korkort" },
    { href: "pricing.html",     label: "Priser",         icon: "card",  pill: "29/79" }
  ];

  function svg(name) {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || "") + "</svg>";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  /* Vilken sida vi står på. Härleds ur adressen, inte ur ett attribut sidan
     sätter — ett attribut kan bli fel vid en kopiering och märker det aldrig.
     Avkodning behövs: förbättring.html kommer som f%C3%B6rb%C3%A4ttring.html. */
  function currentPage() {
    var p = decodeURIComponent(location.pathname).split("/").pop();
    return p || "index.html";
  }

  function markup() {
    var here = currentPage();

    var navHtml = NAV.map(function (item) {
      var on = item.href === here;
      return '<a class="xg-nav-link' + (on ? " active" : "") + '"' +
        (item.module ? ' data-module="' + item.module + '"' : "") +
        ' href="' + esc(item.href) + '"' + (on ? ' aria-current="page"' : "") + ">" +
        esc(item.label) + "</a>";
    }).join("");

    /* Aktuell sida markeras men UTELÄMNAS INTE. Att lämna bort den var precis
       det som gjorde menyn olika beroende på var man stod. */
    var itemHtml = NAV.map(function (item) {
      var on = item.href === here;
      return '<a class="xg-menu-item' + (on ? " active" : "") + '"' +
        (item.module ? ' data-module="' + item.module + '"' : "") +
        ' href="' + esc(item.href) + '"' + (on ? ' aria-current="page"' : "") + ">" +
        '<span class="xg-menu-ico">' + svg(item.icon) + "</span>" +
        "<span>" + esc(item.label) + "</span>" +
        (item.pill ? '<span class="xg-menu-pill">' + esc(item.pill) + "</span>" : "") +
        "</a>";
    }).join("");

    /* Sidlokala poster. En knapp, aldrig en länk — det som är sidlokalt är en
       handling på sidan, inte en destination. */
    var extra = (global.XG_MENU_EXTRA || []).map(function (item) {
      return '<button class="xg-menu-item" type="button"' +
        (item.id ? ' id="' + esc(item.id) + '"' : "") +
        (item.scroll ? ' data-scroll="' + esc(item.scroll) + '"' : "") + ">" +
        '<span class="xg-menu-ico"></span>' +
        "<span>" + esc(item.label) + "</span>" +
        (item.pill ? '<span class="xg-menu-pill">' + esc(item.pill) + "</span>" : "") +
        "</button>";
    }).join("");

    var policyAktiv = here === "integritetspolicy.html";

    return '' +
      '<div class="xg-utility-bar">' +
        '<div class="xg-utility-wrap">' +
          '<a class="xg-utility-badge" href="https://ungdrive.se" target="_blank" rel="noopener" aria-label="Backed by UngDrive">' +
            /* Lokal fil. Sju av åtta sidor hämtade en 1024px-bild från
               ungdrive.se för att rita den i 12x12 — en tredjepartsförfrågan
               per sidladdning, på en sajt med en integritetspolicy. */
            '<img src="/image/ungdrive-icon.png" width="12" height="12" alt="">' +
            "<span>Backed by UngDrive</span>" +
          "</a>" +
          '<div class="xg-utility-right">' +
            '<a href="integritetspolicy.html"' + (policyAktiv ? ' aria-current="page"' : "") +
            ">Integritetspolicy</a></div>" +
        "</div>" +
      "</div>" +
      '<header class="xg-header">' +
        '<div class="xg-header-wrap">' +
          '<a class="xg-brand" href="index.html">' +
            '<img src="image/exgen-logo.png" alt="ExGen" style="height:20px;width:auto">' +
            '<div class="xg-brand-tag">Studieplattform för skolan</div>' +
          "</a>" +
          '<div class="xg-header-right">' +
            '<nav class="xg-nav" aria-label="Huvudnavigation">' + navHtml + "</nav>" +
            '<a class="xg-login-btn" href="konto.html" data-pv-auth="login">Logga in</a>' +
            '<button class="xg-menu-btn" type="button" aria-label="Meny" aria-expanded="false" aria-controls="xgMenu">' +
              '<span class="xg-menu-bars" aria-hidden="true"><span></span><span></span><span></span></span>' +
            "</button>" +
          "</div>" +
        "</div>" +
        /* Arket ligger INUTI <header>. Ett <nav> på body-nivå hade lagt sajtens
           navigering utanför header-landmärket — en skärmläsare som hoppar till
           "banner" hade hittat märket och kontoknappen men inte destinationerna.
           position:fixed fungerar ändå: .xg-header är position:sticky, och
           sticky skapar ingen containing block för fixed (bara transform,
           filter, perspective och contain gör det). */
        '<div class="xg-menu-dim" hidden></div>' +
        '<nav class="xg-menu" id="xgMenu" aria-label="Meny" hidden>' +
          itemHtml +
          '<div class="xg-menu-sep"></div>' +
          /* Ingen "Mitt konto"-rad. Kontoknappen i huvudet fälls aldrig ihop —
             den står framme vid varje bredd — så en rad här hade gett två
             synliga kontroller till samma destination med arket öppet. Det är
             exakt den dubblering huvudarbetet finns för att ta bort, och
             header-behaviour.mjs fångade den. "Logga ut" står kvar: det är en
             handling, inte en destination, och finns ingen annanstans. */
          '<button class="xg-menu-item" type="button" id="xgLogout">' +
            '<span class="xg-menu-ico">' + svg("lock") + "</span><span>Logga ut</span>" +
            '<span class="xg-menu-pill">Lås</span></button>' +
          (extra ? '<div class="xg-menu-sep"></div>' + extra : "") +
        "</nav>" +
      "</header>";
  }

  function bind() {
    var btn = document.querySelector(".xg-menu-btn");
    var menu = document.querySelector(".xg-menu");
    var dim = document.querySelector(".xg-menu-dim");
    if (!btn || !menu || !dim) return;

    function open() {
      menu.hidden = false;
      dim.hidden = false;
      requestAnimationFrame(function () {
        menu.classList.add("on");
        dim.classList.add("on");
      });
      btn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      var first = menu.querySelector("a, button");
      if (first) first.focus();
    }

    function close(restoreFocus) {
      if (!menu.classList.contains("on")) return;
      menu.classList.remove("on");
      dim.classList.remove("on");
      btn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      /* hidden sätts först när övergången är klar. Sätts den direkt hoppar arket
         bort i stället för att glida — och ett stängt ark som ligger kvar utan
         hidden fångar klick över hela sidan. */
      window.setTimeout(function () {
        if (!menu.classList.contains("on")) { menu.hidden = true; dim.hidden = true; }
      }, 200);
      /* Fokus tillbaka till knappen. Utan det står fokus kvar i ett ark som inte
         längre syns, och nästa Tab börjar i tomma luften. */
      if (restoreFocus !== false) btn.focus();
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.classList.contains("on")) close(); else open();
    });
    dim.addEventListener("click", function () { close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    /* Ett klick på en länk navigerar ändå — att lämna arket öppet bakom sig var
       en skillnad utan avsikt i de gamla implementationerna. */
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) window.setTimeout(function () { close(false); }, 80);
    });

    /* Fokusfälla. Ett öppet ark som täcker sidan får inte gå att tabba ur — då
       hamnar fokus i innehåll som ligger under ett överlägg. */
    menu.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = menu.querySelectorAll("a[href], button:not([disabled])");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ── Brygga: sidor som ännu inte migrerat ────────────────────────────────
     index, pricing, konto, förbättring och app laddar redan den här filen, men
     bär fortfarande sitt handskrivna huvud med .mWrap/#mBtn respektive
     .menuWrap/#menuBtn. Utan det här hade de fått en hamburgare som inte
     öppnas i samma stund som filen skrevs om — ett trasigt mellanläge mellan
     två commits.

     Det här är den gamla bindningen, oförändrad, och den dör tillsammans med
     de sista .ddi-klasserna när sidorna migreras. app.html rörs inte: den har
     en egen fjärde variant med is-open/is-closing i sin egen JS. */
  function bindLegacy() {
    var btn = document.getElementById("mBtn") || document.getElementById("menuBtn");
    var panel = document.getElementById("drop") || document.getElementById("menu");
    if (!btn || !panel) return;
    var closeTimer;

    function open() {
      clearTimeout(closeTimer);
      panel.classList.remove("off");
      panel.style.display = "block";
      requestAnimationFrame(function () { panel.classList.add("on"); });
      btn.setAttribute("aria-expanded", "true");
    }
    function close() {
      if (!panel.classList.contains("on")) return;
      btn.setAttribute("aria-expanded", "false");
      panel.classList.remove("on");
      panel.classList.add("off");
      clearTimeout(closeTimer);
      closeTimer = setTimeout(function () {
        panel.classList.remove("off");
        panel.style.display = "none";
      }, 120);
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panel.classList.contains("on")) close(); else open();
    });
    document.addEventListener("click", function (e) {
      if (!panel.classList.contains("on")) return;
      if (!panel.contains(e.target) && !btn.contains(e.target)) close();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    panel.addEventListener("click", function (e) {
      if (e.target.closest("a")) setTimeout(close, 80);
    });
  }

  function render() {
    var slot = document.querySelector("[data-xg-header]");
    if (!slot) { bindLegacy(); return; }
    slot.innerHTML = markup();
    bind();
  }

  global.XgShell = { render: render, NAV: NAV };
  render();
})(window);
