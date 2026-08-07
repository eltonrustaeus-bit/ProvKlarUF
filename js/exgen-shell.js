/* exgen-shell.js — beteendet i det delade sidhuvudet.
 *
 * Just nu bara mobilmenyn. Markupen (xg-header, .mWrap/.menuWrap, panelen)
 * ligger i exgen-shell.css och i sidorna; det här är knappen som öppnar den.
 *
 * Skälet till att det blev en fil: bindningen fanns i fem kopior av tre olika
 * implementationer.
 *
 *   index, pricing, konto  — #mBtn + #drop, inline, identiska
 *   förbättring            — #menuBtn + #menu, samma algoritm, andra id:n
 *   integritetspolicy      — ingen alls; sidan saknade navigering under 720px
 *
 * app.html är INTE migrerad hit. Den kör en fjärde variant med is-open och
 * openMenuAnimated()/closeMenuAnimated() — en annan animation, inte samma
 * kod med andra namn. Att dra in den hade ändrat hur menyn rör sig där.
 *
 * Filen tar båda id-konventionerna så att en sida kan flyttas hit utan att
 * först döpas om, och gör ingenting om knappen eller panelen saknas.
 *
 * Att stänga menyn när man klickar en länk i den kom från förbättring.html och
 * gäller nu alla sidor. Länken navigerar ändå; att lämna panelen öppen bakom
 * sig var en skillnad utan avsikt.
 */
(function () {
  "use strict";

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
    panel.classList.contains("on") ? close() : open();
  });

  document.addEventListener("click", function (e) {
    if (!panel.classList.contains("on")) return;
    if (!panel.contains(e.target) && !btn.contains(e.target)) close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });

  /* Klick på en länk i panelen navigerar — låt inte panelen stå kvar öppen. */
  panel.addEventListener("click", function (e) {
    if (e.target.closest("a")) setTimeout(close, 80);
  });
})();
