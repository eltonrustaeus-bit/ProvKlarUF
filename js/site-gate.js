(function () {
  /* js/site-gate.js — publik grind under ombyggnaden.
   *
   * Måste ligga som FÖRSTA taggen i <head> på varje skyddad sida, laddad som
   * ett blockerande <script src> (varken async eller defer), så att dölj-regeln
   * nedan hinner gälla innan något av body målas. Samma mönster som
   * js/intro-splash.js och js/exgen-modules.js redan använder.
   *
   * Servern äger beslutet: /api/check-role svarar på action "maintenance_gate"
   * utifrån profiles.role. Klienten kan inte tala om för sig själv att den får
   * komma in. Men grinden är till för besökare, inte ett säkerhetsskydd —
   * sidornas filer är fortfarande publika och API:erna nås direkt av den som
   * har ett konto.
   *
   * Öppna sajten igen genom att sätta enabled:false i api/_maintenance.js.
   */
  var HIDE_ID = "_sg";
  var SAFETY_MS = 12000;
  var TARGET = "/snart.html";
  // Koden som skrevs in på snart.html. Den lagras för att slippa skriva om den
  // vid varje sidladdning, men den ÖPPNAR ingenting av sig själv: servern
  // jämför den mot ACCESS_CODE vid varje anrop. Se api/check-role.js.
  var PASS_KEY = "exgen_gate_pass";
  var BACK_KEY = "exgen_gate_back";

  // Undvik omdirigeringsloop om skriptet råkar hamna på målsidan.
  if (location.pathname.replace(/\/+$/, "") === TARGET.replace(/\/+$/, "")) return;

  var st = document.createElement("style");
  st.id = HIDE_ID;
  st.textContent = "body{visibility:hidden!important}";
  (document.head || document.documentElement).appendChild(st);

  var settled = false;

  function reveal() {
    var el = document.getElementById(HIDE_ID);
    if (el) el.remove();
  }

  function deny() {
    // Kom eleven hit på väg någonstans, minns vart — snart.html skickar
    // tillbaka dit när koden godtagits, i stället för till startsidan.
    try {
      localStorage.setItem(BACK_KEY, location.pathname + location.search + location.hash);
    } catch (_) {}
    // replace, inte href: den stängda sidan ska inte ligga kvar i historiken
    // och fånga besökaren i en loop när hen trycker bakåt.
    location.replace(TARGET);
  }

  function settle(fn) {
    if (settled) return;
    settled = true;
    fn();
  }

  /* Fail closed. Hänger nätet eller svarar API:et aldrig är svaret nej — annars
     skulle ett trasigt anrop öppna sajten för alla, vilket är precis motsatsen
     till vad grinden finns för. */
  setTimeout(function () { settle(deny); }, SAFETY_MS);

  function storedPass() {
    try { return localStorage.getItem(PASS_KEY) || ""; } catch (_) { return ""; }
  }

  function ask(authHeader) {
    var headers = { "Content-Type": "application/json" };
    if (authHeader) headers["Authorization"] = authHeader;
    var body = { action: "maintenance_gate" };
    var pass = storedPass();
    if (pass) body.code = pass;
    return fetch("/api/check-role", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });
  }

  function decide(res) {
    if (!res.ok) { settle(deny); return null; }
    return res.json().then(function (d) {
      settle(d && d.allow === true ? reveal : deny);
    });
  }

  /* Sessionen läses direkt ur localStorage i stället för via supabase-js.
     Biblioteket laddas som en vanlig <script> längre ner i sidan och finns inte
     ännu när den här körs — att vänta in det skulle lägga till just den
     fördröjning grinden ska undvika. Nyckeln är samma som shared.js använder. */
  function storedToken() {
    try {
      var s = JSON.parse(localStorage.getItem("sb-mnmotdluigzeehdjbhbu-auth-token") || "{}");
      return s && s.access_token ? s.access_token : "";
    } catch (_) { return ""; }
  }

  /* Fråga anonymt först. Med flaggan av svarar servern allow:true direkt, utan
     att röra Supabase — en normal dag kostar grinden alltså ett enda snabbt
     anrop. 401 betyder "flaggan är på, visa vem du är". */
  ask(null)
    .then(function (res) {
      if (res.status !== 401) return decide(res);
      var token = storedToken();
      if (!token) { settle(deny); return null; }
      return ask("Bearer " + token).then(decide);
    })
    .catch(function () { settle(deny); });
})();
