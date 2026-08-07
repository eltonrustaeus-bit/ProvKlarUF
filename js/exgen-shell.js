/* exgen-shell.js — beteendet i det delade sidhuvudet.
 *
 * Just nu bara mobilmenyn. Markupen (xg-header, .mWrap, .drop) ligger i
 * exgen-shell.css; det här är knappen som öppnar den.
 *
 * Skälet till att det blev en fil: bindningen fanns redan inline på index,
 * pricing och konto i tre identiska kopior, och app/förbättring har en fjärde
 * variant under id:t menuBtn. integritetspolicy hade ingen alls — sidan saknade
 * navigering helt under 720px, eftersom .hNav döljs där och det gamla
 * sidhuvudet aldrig fick någon hamburgare. En sjätte inline-kopia hade löst
 * den buggen och gjort driften värre.
 *
 * De fem andra sidorna har INTE migrerats hit. Det är en separat ändring som
 * rör fungerande sidor, och den hör inte hemma i en buggfix. Se PR-texten.
 *
 * Tar båda id-konventionerna så att en sida kan flyttas hit utan att först
 * döpas om. Gör ingenting om knappen eller panelen saknas.
 */
(function () {
  "use strict";

  var btn = document.getElementById("mBtn") || document.getElementById("menuBtn");
  var drop = document.getElementById("drop");
  if (!btn || !drop) return;

  var closeTimer;

  function open() {
    clearTimeout(closeTimer);
    drop.classList.remove("off");
    drop.style.display = "block";
    requestAnimationFrame(function () { drop.classList.add("on"); });
    btn.setAttribute("aria-expanded", "true");
  }

  function close() {
    btn.setAttribute("aria-expanded", "false");
    drop.classList.remove("on");
    drop.classList.add("off");
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      drop.classList.remove("off");
      drop.style.display = "none";
    }, 120);
  }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    drop.classList.contains("on") ? close() : open();
  });

  document.addEventListener("click", function (e) {
    if (!drop.classList.contains("on")) return;
    if (!drop.contains(e.target) && !btn.contains(e.target)) close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });
})();
