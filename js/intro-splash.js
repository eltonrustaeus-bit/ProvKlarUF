(function () {
  /* ══════════════════════════════════════
     EXGEN × UNGDRIVE — INTRO SPLASH
     Logo alltid synlig, 4.5s premium reveal
  ══════════════════════════════════════ */

  /* Show the branded splash once per browser session — not on every internal
     navigation. Returning before any DOM/style injection means repeat page
     loads reveal content instantly with no hidden-content window. */
  try {
    if (sessionStorage.getItem('pi_splash_shown')) return;
    sessionStorage.setItem('pi_splash_shown', '1');
  } catch (_) { /* sessionStorage blocked → fall through and show splash */ }

  /* ── Block body, but NOT the splash ── */
  var blockSt = document.createElement('style');
  blockSt.textContent =
    'body>*{opacity:0!important;pointer-events:none!important}' +
    '#piSplash{opacity:1!important;pointer-events:auto!important}';
  document.head.appendChild(blockSt);

  /* ── All CSS ── */
  var st = document.createElement('style');
  st.textContent = [

    /* ── Overlay ── */
    '#piSplash{',
      'position:fixed;inset:0;z-index:9999;background:#08100d;',
      'display:flex;flex-direction:column;align-items:center;',
      'justify-content:center;overflow:hidden;',
    '}',

    /* Grid */
    '#piSplash::before{',
      'content:"";position:absolute;inset:0;pointer-events:none;z-index:0;',
      'background-image:',
        'linear-gradient(rgba(0,183,217,.035) 1px,transparent 1px),',
        'linear-gradient(90deg,rgba(0,183,217,.035) 1px,transparent 1px);',
      'background-size:56px 56px;',
      'mask-image:radial-gradient(ellipse 75% 75% at 50% 44%,#000,transparent);',
      '-webkit-mask-image:radial-gradient(ellipse 75% 75% at 50% 44%,#000,transparent);',
      'opacity:0;animation:piFadeIn 1.4s ease .1s forwards;',
    '}',

    /* Large ambient glow orb — slowly drifts */
    '#piOrb{',
      'position:absolute;width:500px;height:500px;pointer-events:none;z-index:0;',
      'background:radial-gradient(circle,rgba(0,183,217,.11) 0%,transparent 65%);',
      'filter:blur(55px);',
      'top:50%;left:50%;margin:-250px 0 0 -250px;',
      'opacity:0;',
      'animation:piFadeIn .8s ease .2s forwards,piOrbDrift 8s ease-in-out 1s infinite;',
    '}',
    '@keyframes piOrbDrift{',
      '0%,100%{transform:translateY(0) scale(1)}',
      '50%{transform:translateY(-18px) scale(1.06)}',
    '}',

    /* ── Content wrapper ── */
    '#piContent{',
      'position:relative;z-index:1;',
      'display:flex;flex-direction:column;align-items:center;gap:0;',
    '}',

    /* ── Logo — ALWAYS VISIBLE from t=0 ── */
    '#piLogoWrap{',
      'position:relative;',
      'opacity:.55;transform:scale(.82);',
      'animation:piLogoReveal .65s cubic-bezier(.34,1.5,.64,1) .08s forwards;',
    '}',
    '@keyframes piLogoReveal{',
      'to{opacity:1;transform:scale(1)}',
    '}',
    '#piLogoWrap .exgenMark{',
      'box-shadow:0 0 0 1px rgba(0,183,217,.18),0 12px 40px rgba(0,0,0,.55);',
    '}',
    /* Glow ring — expands outward after logo settles */
    '#piLogoWrap::after{',
      'content:"";position:absolute;inset:-12px;border-radius:28px;',
      'border:1.5px solid rgba(0,183,217,.0);',
      'animation:piRingPulse 3s ease-in-out .9s infinite;',
    '}',
    '@keyframes piRingPulse{',
      '0%{border-color:rgba(0,183,217,.0);transform:scale(1)}',
      '40%{border-color:rgba(0,183,217,.4);transform:scale(1.06)}',
      '100%{border-color:rgba(0,183,217,.0);transform:scale(1.12)}',
    '}',
    /* Subtle inner glow that pulses */
    '#piLogoGlow{',
      'position:absolute;inset:-20px;border-radius:35px;pointer-events:none;',
      'background:radial-gradient(circle,rgba(0,183,217,.22),transparent 70%);',
      'filter:blur(14px);',
      'opacity:0;animation:piGlowPulse 2.6s ease-in-out 1.1s infinite;',
    '}',
    '@keyframes piGlowPulse{',
      '0%,100%{opacity:0}',
      '50%{opacity:1}',
    '}',

    /* ── Name ── */
    '#piName{',
      'font:700 30px/1 "DM Sans",sans-serif;color:#e8f5ee;',
      'letter-spacing:-.035em;margin-top:20px;',
      'opacity:0;transform:translateY(16px);',
      'animation:piSlideUp .5s cubic-bezier(.22,1,.36,1) .62s forwards;',
    '}',

    /* ── Tagline ── */
    '#piTagline{',
      'font:400 13.5px/1.55 "DM Sans",sans-serif;color:#6b8f7c;',
      'text-align:center;max-width:230px;margin-top:9px;',
      'opacity:0;transform:translateY(12px);',
      'animation:piSlideUp .48s cubic-bezier(.22,1,.36,1) .95s forwards;',
    '}',

    /* ── Divider ── */
    '#piDivider{',
      'height:1px;background:linear-gradient(90deg,transparent,rgba(0,183,217,.28),transparent);',
      'width:0;margin:24px auto;',
      'animation:piDividerDraw .6s cubic-bezier(.22,1,.36,1) 1.2s forwards;',
    '}',
    '@keyframes piDividerDraw{to{width:60px}}',

    /* ── UngDrive section ── */
    '#piPartner{',
      'display:flex;flex-direction:column;align-items:center;gap:9px;',
      'opacity:0;transform:translateY(10px);',
      'animation:piSlideUp .48s cubic-bezier(.22,1,.36,1) 1.45s forwards;',
    '}',
    '#piPartnerLabel{',
      'font:500 9.5px "DM Mono",monospace;color:#3d6650;',
      'letter-spacing:.16em;text-transform:uppercase;',
    '}',
    '#piBadge{',
      'display:flex;align-items:center;gap:9px;',
      'padding:7px 16px;',
      'border:1px solid rgba(0,183,217,.22);border-radius:22px;',
      'background:rgba(0,183,217,.06);text-decoration:none;',
      'transition:background .2s,border-color .2s;',
    '}',
    '#piBadge:hover{background:rgba(0,183,217,.12);border-color:rgba(0,183,217,.38)}',
    '#piBadge img{border-radius:5px;opacity:.92}',
    '#piBadgeName{font:600 13px "DM Sans",sans-serif;color:#c4dfd0;letter-spacing:-.01em}',

    /* ── Pulsing dots ── */
    '#piDots{',
      'position:absolute;bottom:38px;left:50%;transform:translateX(-50%);',
      'display:flex;gap:7px;align-items:center;',
      'opacity:0;animation:piFadeIn .5s ease 1.9s forwards;',
    '}',
    '.piDot{',
      'width:4px;height:4px;border-radius:50%;',
      'background:rgba(0,183,217,.3);',
      'animation:piDotAnim 1.6s ease-in-out infinite;',
    '}',
    '.piDot:nth-child(1){animation-delay:0s}',
    '.piDot:nth-child(2){animation-delay:.28s}',
    '.piDot:nth-child(3){animation-delay:.56s}',
    '@keyframes piDotAnim{',
      '0%,100%{opacity:.3;transform:scale(1)}',
      '50%{opacity:1;transform:scale(1.5)}',
    '}',

    /* ── Shared ── */
    '@keyframes piFadeIn{to{opacity:1}}',
    '@keyframes piSlideUp{to{opacity:1;transform:translateY(0)}}',

    /* ── EXIT ── */
    /* Content contracts + fades */
    '#piContent.piOut{',
      'animation:piContentOut .55s cubic-bezier(.4,0,1,1) forwards;',
    '}',
    '@keyframes piContentOut{',
      'to{opacity:0;transform:scale(.9) translateY(-12px)}',
    '}',
    /* Overlay fades after short delay */
    '#piSplash.piOut{',
      'animation:piOverOut .7s ease .22s forwards;',
    '}',
    '@keyframes piOverOut{to{opacity:0}}',

    /* ── Reduced motion ── */
    '@media(prefers-reduced-motion:reduce){',
      '#piLogoWrap,#piName,#piTagline,#piDivider,#piPartner{',
        'animation:none!important;opacity:1!important;transform:none!important}',
      '#piDivider{width:60px}',
      '#piOrb,#piSplash::before{animation:none!important;opacity:1!important}',
      '#piLogoWrap::after,#piLogoGlow,#piDots,.piDot{animation:none!important}',
      '#piDots{opacity:1!important}',
      '#piContent.piOut{animation:none!important;opacity:0!important;transform:none!important}',
      '#piSplash.piOut{animation:none!important;opacity:0!important}',
    '}',

  ].join('');
  document.head.appendChild(st);

  /* ── Build HTML ── */
  function build() {
    var el = document.createElement('div');
    el.id = 'piSplash';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div id="piOrb"></div>' +
      '<div id="piContent">' +
        '<div id="piLogoWrap">' +
          '<div id="piLogoGlow"></div>' +
          '<span class="exgenMark" style="--em:92px" aria-hidden="true">Ex</span>' +
        '</div>' +
        '<div id="piName">ExGen</div>' +
        '<div id="piTagline">AI-tränare för körkortsteorin och egna prov</div>' +
        '<div id="piDivider"></div>' +
        '<div id="piPartner">' +
          '<span id="piPartnerLabel">Backed by</span>' +
          '<a id="piBadge" href="https://ungdrive.se" target="_blank" rel="noopener">' +
            '<img src="https://ungdrive.se/img/icon-ios-1024@1x.png"' +
                 ' width="22" height="22" alt="UngDrive">' +
            '<span id="piBadgeName">UngDrive</span>' +
          '</a>' +
        '</div>' +
      '</div>' +
      '<div id="piDots">' +
        '<div class="piDot"></div>' +
        '<div class="piDot"></div>' +
        '<div class="piDot"></div>' +
      '</div>';

    document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  /* ── Reveal ── */
  function reveal(splashEl) {
    if (splashEl._done) return;
    splashEl._done = true;
    var c = document.getElementById('piContent');
    if (c) c.classList.add('piOut');
    splashEl.classList.add('piOut');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(function () {
      splashEl.remove();
      st.remove();
      blockSt.remove();
    }, reduced ? 60 : 950);
  }

  var pgLoaded = false, minDone = false, splashEl = null;

  /* Respect prefers-reduced-motion: skip the long branded splash so content
     (which is hidden behind blockSt) is not withheld for ~4s from users who
     opted out of motion. They get a near-instant reveal instead. */
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var MIN_DELAY = REDUCED ? 100 : 3900;
  var SAFETY_DELAY = REDUCED ? 600 : 6500;

  function tryReveal() {
    if (pgLoaded && minDone && splashEl) reveal(splashEl);
  }

  window.addEventListener('load', function () { pgLoaded = true; tryReveal(); });
  setTimeout(function () { minDone = true; tryReveal(); }, MIN_DELAY);   /* min splash time */
  setTimeout(function () { if (splashEl) { reveal(splashEl); } blockSt.remove(); }, SAFETY_DELAY); /* safety */

  document.addEventListener('DOMContentLoaded', function () {
    splashEl = build();
  });
})();
