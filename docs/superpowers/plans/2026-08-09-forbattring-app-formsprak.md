# Del B — `förbättring.html` i app-sidans formspråk — Implementationsplan

Spec: `docs/superpowers/specs/2026-08-09-forbattring-app-formsprak.md`
Gren: `feat/forbattring-app-formsprak`, worktree `.claude/worktrees/design-b`, grenad från `ec94754`.

Eltons tillägg till specen: sidan ska ligga **så nära app-sidan som det går** — samma format, rent
och stilrent. Planen nedan kopierar därför app-sidans skelett i stället för att tolka det.

## App-sidans faktiska skelett

Mätt i `js/exam-flow.js:1497` och `exam-flow.css:62`, inte gissat:

```
section.xf-screen[data-screen]        display:none tills .on
  div.xf-inner                        max-width: var(--xf-measure) = 580px
    div.xf-per
      div.xf-orb                      aria-hidden
      div  (flex:1)
        h2.xf-say                     tabIndex=-1, fokuseras vid skärmbyte
        p.xf-sub                      aria-live=polite
    div.xf-body                       innehållet
```

Två fynd som styr planen:

1. **`.xf-body` har ingen CSS alls.** Den är en ren grupperingsdiv. Rytmen kommer från
   `.xf-card`s egna marginaler. Inget att kopiera, bara strukturen.
2. **`.xf-inner` bor i `exam-flow.css`, som `förbättring.html` inte laddar.** Den är
   byte-ekvivalent med `.xf-measure` i `exgen-ui.css` — samma `max-width: var(--xf-measure)` —
   sånär som på `margin: auto 0`, som bara finns för att centrera en wizardskärm vertikalt.

**Beslut: använd `.xf-measure`, ladda inte `exam-flow.css`.** Att dra in wizardlagret på en sida
utan wizard hade tagit med `.xf-screen { display: none }` och en `position: fixed`-`.xf-exam` som
täcker hela viewporten. Samma bredd, samma token, inget bagage.

`förbättring.html` har redan `.xf-per` + `.xf-orb` + `.xf-say` + `.xf-sub` i rubriken — det är de
fyra selektorerna sidan använder idag. Rubriken är alltså redan app-sidans. Det som saknas är
kolumnen, kroppen och vokabulären i den.

## Globala villkor

- **Färgdesignen ändras aldrig.** Inga nya hex-värden, inga ändrade tokens. Radien är semantisk:
  fristående yta `--exgen-radius-lg`, klickbar kontroll `md`, yta i kort `sm`, märke `pill`.
- **Filens kodstil är pilfunktioner + `const`/`let`.** Behålls. (`shared.js` och
  `js/exam-flow.js` är ES5 men rörs inte här.)
- **`esc()` på allt användarinnehåll** som går in i `innerHTML`. Inte ett enda anrop får tappas.
- **Ingen ändring i `api/`.** Säkerhetschecklistan i `CLAUDE.md` utlöses inte.
- **Aldrig `git stash`** — stacken delas mellan worktrees.
- Efter varje task: `node tests/frontend/forbattring-behaviour.mjs` grönt, och
  **mutationsverifiera** — återställ fixen, se testet bli rött, lägg tillbaka.

---

### Task 1: Testriggen först, mot dagens sida

Skriv `tests/frontend/forbattring-behaviour.mjs` **innan** markupen rörs, och kör den mot den
oförändrade sidan. Ett test som aldrig sett det gamla beteendet kan inte bevisa att det överlevde.

De tre fällorna, alla bekräftade tidigare:

- `**/api/check-role` med `{allow:true, ok:true, role:"premium", approved:true}` registrerad
  **efter** den generella `**/api/**`-mocken — sist registrerad vinner i Playwright.
- `sessionStorage.setItem("pi_splash_shown","1")` i `addInitScript`.
- Seeda `localStorage` med prov och misstag så sidan har data att rendera.

Testerna, uttryckta som beteende:

1. Alla fem `PER_TARGETS`-mål scrollar till något som finns i DOM:en och blir synligt.
2. Markera en rad i felbanken uppdaterar räknaren **och** `LS_TRAIN_PICK`.
3. "Träna markerade" skickar exakt de markerade id:na vidare.
4. "Rensa val" nollar både markering och räknare.
5. Kursfiltret filtrerar provlista och felbank samtidigt.
6. Lärarrapporten avstängd under tre prov, påslagen vid tre.
7. Språkväxling byter varje synlig etikett — jämför mot `T.sv` / `T.en`, aldrig mot hårdkodade
   strängar.

**Klar när:** alla sju gröna mot dagens markup. Det är utgångsläget hela Del B mäts mot.

---

### Task 2: Kolumnen och kroppen

Byt sidans yttre behållare mot app-sidans form, utan att röra sektionerna inuti än.

```html
<div class="xf-measure">
  <div class="xf-per">…orb + say + sub, oförändrad…</div>
  <div class="xf-body">
    …de fem sektionerna, fortfarande som de är…
  </div>
</div>
```

Ett steg för sig så att en pixeljämförelse här visar **bara** vad kolumnbytet gör. Sidan är
bredare än 580px idag; den här commiten är den som smalnar av den, och den ska inte blandas ihop
med innehållsändringar.

**Klar när:** Task 1:s sju tester fortfarande gröna, och sidan renderar i en 580px-kolumn.

---

### Task 3: Zon 1 — Prov

Ersätt `#examSection`-dragspelet med en zon.

- `.xf-eyebrow` "PROV" i stället för `.sNum` + `.sTitle`. Numren 01–05 tas bort; de numrerade en
  ordning som inte finns.
- Filterraden (`courseFilter`, `showMode`, `syncBtn`) blir en `.xf-act` under etiketten.
- `renderExamList` producerar `.xf-opt`-rader i en `.xf-opts` i stället för `.dataGrid`-kort.
  Signaturen `renderExamList(h, courseFilter)` är oförändrad.
- Metadata per rad (poäng, datum) som `.xf-row` — `dt`/`dd`, vilket är vad `.xf-row` faktiskt är.
- `examListStatus` behåller `aria-live="polite"`.

**Behåll id:na** `examListTitle`, `examListSub`, `examListStatus`, `examList`, `courseFilter`,
`showMode`, `syncBtn`, `courseFilterLabel`, `showModeLabel` — `applyLang` och `$()` slår upp dem.

**Klar när:** sju tester gröna, `.dataGrid` borta ur zonen.

---

### Task 4: Zon 2 — Felbank, och åtgärdsraden som flyttar in

Den här är kärnan i Del B.

- `.xf-eyebrow` "FELBANK", antal frågor till höger.
- **Åtgärdsraden flyttar hit, ovanför listan.** `trainSelectedBtn`, `clearSelectionBtn` och
  `selCountPill` ur `#trainSection`, in i en `.xf-act` med `id="trainActions"`.
  `#trainSection` upphör som eget område.
- `renderMistakes` producerar `.xf-opt`-rader. **Kryssrutorna tas bort** — `.xf-opt.sel` är redan
  "markerad", med accentkanten ritad på insidan via `::before` så raden inte hoppar en pixel.
  Klick på raden anropar samma `togglePickId`.
- Utfällbart modellsvar behålls som idag, men i `.xf-note` inuti raden.
- `mTags` blir `.xf-chips` + `.xf-chip`.

`.xf-act--stick` (tre rader i `exgen-ui.css`, `position: sticky; top: 0; z-index: 2`) läggs till
här. **Enda tillägget till vokabulären i hela Del B.** Går den bort blir åtgärdsraden fast överst
i zonen — sämre men inte trasigt.

**Klar när:** sju tester gröna, och särskilt att markering, räknare, `LS_TRAIN_PICK` och
"Träna markerade" beter sig exakt som före Task 4. Mutationsverifiera markeringstestet.

---

### Task 5: Zon 3 — Coach och Lärarrapport

Två avläsningar, ett `.xf-card` var, `.xf-eyebrow` över.

- `coachBox` → `.xf-card`. `coachLabel` → `.xf-eyebrow`.
- `genReportBtn` + `copyReportBtn` → `.xf-act`. `reportPill` → `.xf-chip`.
- `reportLoadingOverlay` med sina tre `loadStep`-steg behålls som den är — den är redan
  återhållsam och har ingen motsvarighet i vokabulären att tvinga in den i.
- `renderChart` behåller sin signatur; ramen runt grafen blir `.xf-card`.

**Behåll id:na** `coachHeader`, `coachTitle`, `coachSub`, `reportTitle`, `reportSub`,
`reportStatus`, `reportBox`, `reportPill`, `genReportBtn`, `copyReportBtn`.

**Klar när:** sju tester gröna, rapportknappen fortfarande avstängd under tre prov.

---

### Task 6: `goZone` ersätter `openSection`, och dragspelen städas bort

```js
const goZone = (sel, focusSel) => { … scrolla + kort blink, samma --flash-mönster som .planCard--flash i Del A … };
```

`PER_TARGETS` behåller **alla fem id:n**. Bara `go` byter:

| id | efter |
|---|---|
| `prov` | `goZone('#zonProv')` |
| `felbank` | `goZone('#zonFelbank')` |
| `trana` | `goZone('#zonFelbank', '#trainActions')` |
| `coach` | `goZone('#zonCoach')` |
| `rapport` | `goZone('#zonRapport')` |

Ta bort: `toggleSection`, `bindToggles`, `isOpen`, `setOpen`, `openSection`, `restoreUiState`,
`uiState`, `saveUiState`, konstanten `LS_UI_OPEN`. Lämna dem inte döda.

`LS_UI_OPEN` blir en föräldralös nyckel hos befintliga elever. Den skrivs aldrig igen och kostar
inget — noteras bara så nästa person inte letar efter vem som skriver den.

`setPerContext`-anropen (datagrenen ~rad 1288 och `DOMContentLoaded`) lever vidare oförändrade.
**Manifestet tar exakt fyra toppnycklar** — en femte loggar `console.warn`.

**Klar när:** test 1 grönt för alla fem målen, och `trana` landar på åtgärdsraden.
Mutationsverifiera: peka `trana` fel med flit, se testet bli rött.

---

### Task 7: Språket

Störst tyst risk i hela Del B. `applyLang()` sätter `textContent` på ett fyrtiotal id:n ur
`T[LANG]`, och sidan är tvåspråkig.

- Varje id som flyttat ska följa med i `applyLang`.
- Varje id som försvunnit (`sNum`-texterna, `trainSection`-rubrikerna) ska bort ur **både** `T.sv`
  och `T.en`.
- Nya etiketter läggs till i båda.

Går det fel blir det inte ett fel — texten står bara kvar på fel språk. Därför testar test 7 mot
`T`-tabellen och inte mot strängar.

**Klar när:** test 7 grönt åt båda hållen, och `Object.keys(T.sv)` och `Object.keys(T.en)` är
identiska mängder.

---

### Task 8: Bevisa att bara det avsedda ändrades

`tests/frontend/per-visual.mjs` gör redan hela dansen: tillfällig worktree av `origin/main`, två
körningar för brusgolvet, städning i `try/finally` och på `SIGINT`. **Återanvänd den, skriv ingen
ny rigg.**

- Mät brusgolvet först. Tro inte på ett pixelantal innan referensträdet körts mot sig självt.
- `index.html`, `pricing.html`, `app.html`, `konto.html`: **noll skiljande pixlar.** Del B rör
  bara `förbättring.html` plus möjligen tre rader i `exgen-ui.css`, och de tre raderna får inte
  synas någon annanstans.
- `förbättring.html` ska skilja sig mycket — det är hela poängen. Bilderna sparas som underlag,
  inte som ett tröskelvärde.

**Noll skiljande pixlar bevisar ingenting om du tittat på fel tillstånd.** `snart.html` visade noll
medan dess CSS var trasig, för att det ändrade låg bakom en ruta man måste klicka upp. Fotografera
felbanken med en rad markerad och ett modellsvar utfällt, inte bara sidan som den laddar.

---

## Efter planen

- Commit per task, mutationsverifierad.
- PR mot `main` med före/efter-bilder av `förbättring.html` och nollresultaten för de andra fyra.
- Dagbokspost enligt husets form.
- Del C (`index.html` + `pricing.html`) kopierar mönstret som fastställs här. Den öppna frågan
  från 8 augusti — ska index etiketter bli `.xf-eyebrow`? — tas med Elton innan C börjar.
