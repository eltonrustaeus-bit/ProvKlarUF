/* exgen-modules.js — enda källan för vilka produktmoduler som är synliga.
 *
 * ExGen är sedan 2026-07-28 en renodlad studieplattform för grundskolan och gymnasiet.
 * Körkortsteorin och Högskoleprovet är INTE borttagna — all kod, alla API-rutter, all
 * affärslogik och all data ligger kvar orörd. De är bara dolda från användargränssnittet.
 *
 * ── ÅTERAKTIVERA EN MODUL ────────────────────────────────────────────────────
 * Sätt motsvarande flagga nedan till true. Det är hela ingreppet:
 *   • nav-länkar, CTA:er, kort och prisrader med data-module="<namn>" blir synliga igen
 *   • modulens egen sida slutar omdirigera till startsidan
 * Ingen annan fil behöver röras.
 *
 * ── SÅ HÄR FUNGERAR DET ──────────────────────────────────────────────────────
 * Filen laddas SYNKRONT i <head> på varje sida (före <body> parsas) och injicerar en
 * CSS-regel som döljer avstängda moduler. Därför hinner inget blinka till på skärmen —
 * elementen är dolda redan första gången de målas, inte gömda i efterhand av JS.
 */
(function () {
  var MODULES = {
    korkort: false, // Körkortsteorin — korkortet.html + api/check-role.js kk-kvoter
    hp: false,      // Högskoleprovet — provia-hp.html + api/hp.js
  };

  window.EXGEN_MODULES = MODULES;

  // Dölj allt som hör till en avstängd modul, innan sidan målas första gången.
  var off = [];
  for (var key in MODULES) {
    if (Object.prototype.hasOwnProperty.call(MODULES, key) && !MODULES[key]) {
      off.push('[data-module="' + key + '"]');
    }
  }
  if (off.length) {
    var style = document.createElement('style');
    style.setAttribute('data-exgen-modules', '');
    style.textContent = off.join(',') + '{display:none !important}';
    (document.head || document.documentElement).appendChild(style);
  }

  /* Sidvakt: anropas överst i en modulsidas egen <head> (korkortet.html, provia-hp.html).
   * Är modulen av skickas besökaren till startsidan istället — sidan får aldrig rendera.
   * `replace` används så att modulsidan inte hamnar i historiken (annars fastnar man i en
   * loop när man trycker bakåt). */
  window.exgenRequireModule = function (name) {
    if (!MODULES[name]) {
      location.replace('index.html');
      return false;
    }
    return true;
  };
})();
