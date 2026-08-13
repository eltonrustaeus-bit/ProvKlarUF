# Förbättringssidan som skärmflöde + ett delat sidhuvud

**Datum:** 2026-08-13
**Status:** godkänd inriktning, väntar på granskning av specen

## Mål

Två saker, i samma omgång eftersom de rör samma vokabulär:

1. `förbättring.html` slutar vara en skrollsida med fyra zoner uppe samtidigt och
   blir ett skärmflöde i app-sidans form: P.E.R säger ett faktum om just den
   eleven, erbjuder vägarna, och eleven klickar sig fram efter behov.
2. Sidhuvudet slutar finnas i fyra implementationer med olika innehåll per sida.
   En fil renderar det, en klassuppsättning bär det, och mobilpanelen blir ett
   fullbrett ark i stället för en nedkrympt skrivbordsdropdown.

---

## Vad som mättes

Allt nedan är läst ur koden, inte antaget.

### förbättring.html (1376 rader)

| Fynd | Belägg |
|---|---|
| Zonordningen motsäger sina egna kommentarer | DOM: Prov, Coach, Rapport, Felbank. Kommentarerna: `ZON 1 — PROV`, `ZON 3 — COACH`, `ZON 3 — LÄRARRAPPORT`, `ZON 2 — FELBANK`. Två zoner heter 3. |
| Felbanken kallas kärnan och ligger sist | Kommentar rad 457: "Kärnan". Den ligger under lärarrapporten, som kräver 3 prov. |
| Filtret ligger inte där det filtrerar | `#courseFilter` i zon 1 styr felbanken (zon 4), rapporten (zon 3) och nyckeltalen. Begreppschipsen byggs inuti zon 4. |
| `#showMode` byter ingen vy | Rad 1291: `change` anropar bara `goZone()`. En select som navigering. |
| Statusraden är en felsökningsutskrift | `setTopStatus('Åtkomst OK (premium)')` — sidan visar eleven sin egen roll. |
| En hel andra coach-motor är död | `buildCoachText` (rad 753), `deriveMethods` (735), `deriveTips` (745), `countMistakeDays` (710) — definierade, anropas aldrig. ~45 rader. |
| Död animationsslinga | Rad 1055 letar `.mCard`. Klassen finns bara i `live-demo.html`. |
| Tomma block | `@media(max-width:560px){}` (rad 167), `/* ── BIND TOGGLES ── */` (rad 1317). |
| Egen muspekare på 2 av 15 sidor | `cursor:none` finns i `förbättring.html` och `pricing.html`, ingen annanstans. |

### Sidhuvudet

Skrivbordsnaven är redan identisk på de sju sidor som har `xg-header`. Mobilmenyn är det inte:

| Sida | Klasser | Poster i panelen | Öppna/stäng |
|---|---|---|---|
| index | `.mWrap/.ddi` | 4 — saknar Hem | `exgen-shell.js` |
| pricing | `.mWrap/.ddi` | 5 | `exgen-shell.js` |
| integritetspolicy | `.mWrap/.ddi` | 5 | `exgen-shell.js` |
| konto | `.mWrap/.ddi` | 5 + logga ut | `exgen-shell.js` |
| admin | `.mWrap/.ddi` | 4 — saknar Körkortsteorin | `exgen-shell.js` |
| förbättring | `.menuWrap/.ddi` | **3** — saknar Hem *och* Min utveckling | `exgen-shell.js` |
| app | `.menuWrap/.ddItem` | 4 skrollankare + 3 länkar + språk + logga ut | egen `openMenuAnimated()` |
| korkortet | `.menuWrap/.ddItem` | 4 länkar + logga ut | egen, `korkortet.html:2727` |
| larare | ingen `xg-header` | egen `.topNav`, ingen navigering alls | — |
| live-demo | ingen header alls | — | — |

Ytterligare:

- `style.css` bär varje menyregel dubbelt — `.mWrap, .menuWrap` / `.mBtn, .menuBtn` /
  `.bars, .barsIcon` / `.drop, .dropdown` / `.ddi, .ddItem` / `.dpill, .ddPill`.
  En omdöpning som aldrig gjordes klar.
- Tre öppna-klasser stöds samtidigt i CSS: `.drop.on`, `.dropdown.is-open`, `.dropdown.open`.
- Mobilpanelen är en skrivbordsdropdown: `position:absolute; right:0; min-width:240px;
  border-radius:14px; box-shadow:0 16px 48px rgba(0,0,0,.5)`. Den skuggan är 50 % svart
  — en rest från mörkt tema på en vit sida.
- `.mPageTitle` är stylad i `style.css` och används på noll sidor.
- `admin.html` laddar bara `style.css` — den behöver `exgen-tokens.css` + `exgen-shell.css`
  för att kunna bära det delade huvudet.

---

## Del 1 — `förbättring.html` som skärmflöde

### Skärmarna

Fem skärmar, nav och ekrar (inte en linjär wizard — därför ingen framstegsrad).

**`hem`** — ingången. P.E.R:s röst med ett faktum ur historik och felbank
(`setVoice()` finns redan och behålls), sedan vägarna som `.xf-opt`-rader där
varje `<small>` bär levande tillstånd:

```
[orb]  Du har 34 sparade fel.
       12 av dem i Matematik 2c. Du ligger på 71 % över dina senaste fem prov.

  Träna det du missat          34 fel · flest i Matematik 2c
  Se dina prov                 9 prov · senaste 71 %
  Fråga P.E.R vad du ska göra  analys från i går
  Rapport till läraren         9 prov · redo
```

Utan data byter ingången roll: vägarna som kräver prov blir inaktiva med sitt
skäl i `<small>`, och den primära raden blir *Gör ett prov i appen* → `app.html`.

**`felbank`** — kärnan, ett klick från ingången. Kursväljaren och begreppschipsen
sitter direkt ovanför listan de filtrerar. Åtgärdsraden (`n valda` · Rensa val ·
Träna markerade) ligger kvar ovanpå listan.

**`prov`** — kursväljaren, resultatgrafen och provlistan. Grafen flyttar hit från
Coach-zonen: den handlar om prov. Klick på ett prov sätter kursfiltret och går
till `felbank`, precis som i dag.

**`coach`** — P.E.R:s analys. Hämtas vid inträde om cachen är äldre än 24 h; ingen
extra knapp. Orben får `.busy` medan anropet pågår (klassen finns redan i
`exgen-ui.css`).

**`rapport`** — Skapa rapport · Kopiera · rapportrutan · laddningsöverlägget,
oförändrat. Nås bara när det finns ≥3 prov; på `hem` står skälet när det inte gör det.

### Routing

`location.hash` är sanningen: `#felbank`, `#prov`, `#coach`, `#rapport`, tomt = `hem`.
`show()` skriver hashen, `hashchange` läser den. Det ger tre saker på en gång —
djuplänkar från `app.html` och från P.E.R fungerar, webbläsarens bakåtknapp
fungerar, och `PER_TARGETS` blir sanna: i dag skrollar de, sedan navigerar de.

`← Tillbaka` inuti en skärm går till `hem`.

### Vad som försvinner

- `.howTo`-banderollen — ingångsskärmen *är* instruktionen.
- `#showMode`-selecten — blir två vägar på `hem`.
- Statusraden i hero (`heroMeta`, `#statusDot`, `#topStatusText`) och `setTopStatus()`.
  Fel som eleven kan göra något åt visas där de uppstår; rollen visas inte alls.
- Hela i18n-lagret: `LANG`, `T{}`, `applyLang()`, `#langBtn`, `#langPill`,
  `proviaai_lang`. Sidan blir svensk. (~120 rader.)
- Den döda coach-motorn: `buildCoachText`, `deriveMethods`, `deriveTips`,
  `countMistakeDays`.
- `.mCard`-animationen, `@media(max-width:560px){}`, `/* BIND TOGGLES */`.
- Egen muspekare (`#cursorDot`, `#cursorRing`, `cursor:none`, GSAP-blocket som
  driver dem).

### Vad som behålls oförändrat

Synk mot Supabase (`syncFromAccount`, auto vid inläsning + knapp på `prov`),
`gatePage()`/`mustHaveAccess()`, borttagning av enskilt fel (`doneBtn`),
P.E.R-tips per fel med sin cache, `LS_TRAIN_PICK` → `app.html#train`,
`Rensa all data` (flyttar till sidhuvudets sidlokala fack).

---

## Del 2 — `js/xf-screens.js`

Skärmmotorn i `js/exam-flow.js` (`screen()` rad 224, `mount()` 257, `buildDom()` 1497)
är ~90 rader som gör precis det förbättringssidan behöver. Den bryts **inte** ut —
`exam-flow.js` driver själva provet och lämnas orörd. I stället byggs samma
mekanik som eget lager, och driftspärren byggs ut så att en tredje kopia inte kan
smyga in tyst.

```js
var flow = XfScreens.create({
  root: document.getElementById("xf"),
  screens: ["hem", "felbank", "prov", "coach", "rapport"],
  title: "Min utveckling",   // sidans enda h1, visuellt dold
  hash: true                 // skriv och läs location.hash
});
flow.show("felbank");        // byter skärm, flyttar fokus, skriver hash
var body = flow.mount("felbank");  // pekar om rösten, tömmer kroppen
flow.say("Felbank", "34 frågor du tappat poäng på.");
flow.busy(true);
```

DOM-formen är identisk med den `exam-flow.js` bygger, så vokabulären gäller:

```
section.xf-screen > div.xf-inner
  > div.xf-per > div.xf-orb + div > h2.xf-say + p.xf-sub
  > div.xf-body
```

`.xf-screen`-reglerna (~15 rader) flyttar från `exam-flow.css` till `exgen-ui.css`,
där resten av det delade formspråket redan bor. `app.html` laddar båda filerna, så
inget ändras där. Det är nödvändigt eftersom förbättringssidan inte får ladda
`exam-flow.css` — den drar med sig `position:fixed`-provytan på en sida utan prov.

Motorn tar samma tillgänglighetsbeteende som originalet: `aria-hidden` på skärmar
som är av, fokus till den nya skärmens `.xf-say`, `scrollTo` utan mjuk animation.
Framstegsraden är valfri och **av** här — fyra jämbördiga vägar är inte fyra steg
mot ett mål.

---

## Del 3 — det delade sidhuvudet

### En fil renderar det

`js/exgen-shell.js` går från att bara binda knappen till att rendera hela huvudet.
Sidan deklarerar bara vem den är:

```html
<div data-xg-header data-page="forbattring"></div>
```

Skriptet bygger verktygsraden, headern, naven, kontoknappen, hamburgaren och
mobilarket ur **en** lista i filen. Sidlokala poster matas in före skriptet:

```html
<script>window.XG_MENU_EXTRA = [
  { label: "Rensa all data", id: "resetBtn", pill: "!", tone: "danger" }
];</script>
```

Det är facket `app.html` behöver för sina fyra skrollankare (01–04) och
`förbättring.html` för *Rensa all data*.

### Innehållet, samma överallt

Navigering: **Hem · Mockprov · Min utveckling · Körkortsteorin · Priser.**
Aktuell sida markeras med `.active` + `aria-current="page"` och **utelämnas inte** —
i dag saknar index sitt *Hem* och förbättring sitt *Min utveckling*, vilket gör
menyn olika beroende på var man står.

Kontodelen: *Mitt konto* / *Logga in* (`shared.js` byter redan etikett på
`.xg-login-btn` när en session finns) och *Logga ut*.

`data-module="korkort"` behålls på körkortsraden så `exgen-modules.js` kan dölja den.

### Klasserna

`xg-`-namnrymden äger redan huvudet (`xg-header`, `xg-nav`, `xg-brand`,
`xg-login-btn`). Menyn följer efter: `xg-menu-btn`, `xg-menu`, `xg-menu-item`,
`xg-menu-pill`, `xg-menu-sep`. När ingen sida längre refererar dem raderas
`.mWrap`, `.menuWrap`, `.mBtn`, `.menuBtn`, `.bars`, `.barsIcon`, `.drop`,
`.dropdown`, `.ddi`, `.ddItem`, `.ddi-ico`, `.dpill`, `.ddPill` och `.mPageTitle`
ur `style.css` — inklusive `.dropdown.open`, den tredje öppna-klassen.

### Sidorna

Nio sidor får huvudet: **index, pricing, app, konto, korkortet, förbättring,
integritetspolicy, admin, larare.** `admin.html` behöver `exgen-tokens.css` +
`exgen-shell.css` tillagda; `larare.html` byter ut sin `.topNav`.

Repot har 15 HTML-filer. De sex som inte får huvudet:

| Fil | Varför inte |
|---|---|
| `live-demo.html` | Helskärms-scriptad demo, ingen header i dag. Att lägga en meny över den vore en ny sak, inte en samordning. |
| `snart.html`, `aterstall.html` | Enskärmssidor utan navigering i dag (kommer-snart, lösenordsåterställning). Ett huvud där ger en väg *bort* från det enda sidan ber om. |
| `juridik.html` | Har ingen navigering i dag. Kan få huvudet — men den syns inte i naven, så den är inte en del av samordningen. |
| `google52ca1d3d9412d7b8.html` | Verifieringsstub. |
| **`provia-hp.html`** | **Öppen fråga.** Högskoleprovsappen har i dag *ingen* navigering alls — varken header, nav eller hamburgare. Det är inte en samordningsfråga utan ett hål: en elev som landar där kommer inte tillbaka. Den ingår inte i den här omgången om du inte säger till, men den bör tas. |

*Överrulla gärna om avsikten var en annan avgränsning.*

---

## Del 4 — mobilarket

Under 861px (samma brytpunkt som `.xg-nav` redan döljs vid) öppnas menyn som ett
fullbrett ark under headern i stället för en 240px-dropdown i hörnet:

```
┌─────────────────────────┐
│ ExGen              ✕    │
├─────────────────────────┤
│  Hem                    │
│  Mockprov          App  │
│  Min utveckling  Coach  │
│  Körkortsteorin   Nytt  │
│  Priser         29/79   │
├─────────────────────────┤
│  Mitt konto             │
│  Logga ut          Lås  │
└─────────────────────────┘
```

- Full bredd, fäst under headern, egen skroll om innehållet är högre än skärmen.
- `padding-bottom: env(safe-area-inset-bottom)` så sista raden inte hamnar under
  hemindikatorn.
- Radhöjd minst 52px.
- Bakgrundsdimmer som stänger vid klick; `Escape` stänger; skroll låses på `body`
  medan arket är öppet; fokus fångas i arket och återlämnas till knappen vid stängning.
- Skuggan sänks till ljust tema (`--exgen-shadow-lg`) i stället för `rgba(0,0,0,.5)`.

Över 860px är arket aldrig synligt — komplementregeln `@media (min-width: 861px)`
finns redan i `exgen-shell.css` och behålls, omskriven till de nya klassnamnen.

---

## Avgränsningar

Utanför den här omgången:

- Färger, typsnitt, radie och skuggor ändras inte. Inga nya tokens.
- `js/exam-flow.js` rörs inte.
- Egen muspekare tas bort på `förbättring.html` (sidan skrivs om) men lämnas kvar
  på `pricing.html`. Att den finns på två sidor av nio är inkonsekvent — det är en
  egen fråga, inte en del av den här.
- `app.html`s gamla `#material`/`#settings`/`#exam`/`#result`-sektioner och dess
  `wizardRail` lämnas som de är. Sidhuvudet får bära deras skrollankare i det
  sidlokala facket precis som i dag.
- `Rensa all data` hör egentligen hemma på `konto.html`. Den flyttar inte nu.

---

## Hur det bevisas

Testriggen (`tests/frontend/_harness.mjs`) finns och används.

**`header-behaviour.mjs`** byggs ut till att köra över alla nio sidorna och hävda:

- exakt en navigering i DOM:en per sida
- identisk länkuppsättning på varenda sida
- aktuell sida markerad *och närvarande* i både nav och ark
- ingen destination förekommer två gånger i samma synfält
- vid 390 / 860 / 861 / 1280px syns exakt en av nav och hamburgare
- arket täcker inget interaktivt när det är stängt, och stängs av `Escape`

**`forbattring-flow.mjs`** (ny) hävdar:

- ingången listar rätt antal vägar för given data, och rätt skäl när data saknas
- exakt en skärm är synlig åt gången; övriga har `aria-hidden="true"`
- varje väg öppnar sin skärm och skriver rätt hash
- djuplänk (`förbättring.html#felbank`) landar direkt på rätt skärm
- bakåt går till `hem`
- kursväljaren och listan den filtrerar ligger i samma skärm
- inga referenser till borttagna id:n (`showMode`, `statusDot`, `langBtn`, `howToText`)

**`_harness.test.mjs`** driftspärr utökas: ingen fil utanför `js/xf-screens.js` och
`js/exam-flow.js` får definiera en egen skärmväxlare.

**`per-visual.mjs`** kommer visa stora skillnader på `förbättring.html` — det är
avsikten. Övriga sidor ska ligga inom brusgolvet utom där huvudet faktiskt bytts.

---

## Beslut som redan är tagna

| Fråga | Beslut |
|---|---|
| Struktur på förbättringssidan | P.E.R-skärmflöde med ingångsskärm |
| Mobilmenyn | Fullbrett ark |
| Omfattning | Alla sidor med ett huvud (nio; live-demo undantagen, se Del 3) |
| Språkväxlaren | Tas bort helt — sajten är svensk |
| Skärmmotorn | Ny delad fil `js/xf-screens.js`; `exam-flow.js` orörd |
