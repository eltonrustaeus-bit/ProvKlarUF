# Del B — `förbättring.html` i app-sidans formspråk (2026-08-09)

Följer överlämningsposten `2026-08-09 23:30` i dagboken. Del A ligger i `main` via PR #53.
Grenen är `feat/forbattring-app-formsprak`, worktree `.claude/worktrees/design-b`, grenad från
`ec94754`.

## Problem

`förbättring.html` är 1452 rader och laddar redan `exgen-ui.css`, men använder **fyra**
`.xf-*`-selektorer på hela sidan — `.xf-per`, `.xf-orb`, `.xf-say`, `.xf-sub` — och alla fyra
sitter i rubriken. Kroppen är fem hopfällda `.section`-dragspel med eget formspråk: `.sHead`,
`.sNum`, `.sTitle`, `.sDesc`, `.sChev`, `.sDivider`, `.sBody`, `.dataGrid`, `.coachBox`,
`.filterRow`. Det är därför sidan ser ut som förut trots att rubriken är omgjord.

Men det egentliga problemet är inte att klassnamnen skiljer sig. **Femdelningen speglar inte hur
sidan används.** Läser man vad sektionerna gör:

| # | Sektion | Vad den faktiskt är |
|---|---|---|
| 01 | Prov | vägen in — dess egen undertext säger "klicka för att se felbank" |
| 02 | Coach | en avläsning, ingen interaktion |
| 03 | Lärarrapport | en avläsning plus en knapp |
| 04 | Träna misstag | **en åtgärdsrad för markeringen som görs i 05** |
| 05 | Felbank | kärnan — allt annat pekar hit |

Sektion 04 har ingen egen data. `trainSelectedBtn`, `clearSelectionBtn` och `selCountPill`
opererar på `LS_TRAIN_PICK`, som fylls av kryssrutorna i felbanken (`togglePickId` från
`renderMistakes`). Att den ligger som en egen hopfälld sektion ovanför felbanken betyder att
eleven kan fälla ut "Träna misstag", se "0 valda" och två knappar, och inte ha någon aning om var
man markerar något.

Fem jämlika dragspel för ett kärnobjekt, en väg in, en åtgärd och två avläsningar.

## Lösning

Tre zoner i en `.xf-measure`-kolumn (580px, samma som app-sidan — ingen ny bredd), inga dragspel.

```
┌─ .xf-measure ─────────────────────────────────┐
│  PROV                        [Kurs ▾]  [↻]    │   zon 1 — vägen in
│  ┌─ .xf-card ────────────────────────────────┐│
│  │ Matematik 2b · 12/16 · 3 dgr sedan        ││
│  └───────────────────────────────────────────┘│
│                                               │
│  FELBANK                          18 frågor   │   zon 2 — kärnan
│  ┌─ .xf-act ─────────────────────────────────┐│
│  │ 2 valda      [Rensa]  [Träna markerade]   ││
│  └───────────────────────────────────────────┘│
│  ┌─ .xf-opts ────────────────────────────────┐│
│  │ .xf-opt.sel  Vad sker i mitokondrien?     ││
│  │              ▸ ditt svar · modellsvar     ││
│  │ .xf-opt      Derivatan av x²·sin x        ││
│  └───────────────────────────────────────────┘│
│                                               │
│  COACH                                        │   zon 3 — avläsningar
│  ┌─ .xf-card ────────────────────────────────┐│
│  │ P.E.R · Rekommendation                    ││
│  └───────────────────────────────────────────┘│
│  LÄRARRAPPORT                                 │
│  ┌─ .xf-card ────────────────────────────────┐│
│  │ Kräver 3 prov      [Skapa] [Kopiera]      ││
│  └───────────────────────────────────────────┘│
└───────────────────────────────────────────────┘
```

### Varför vokabulären räcker

Den befintliga uppsättningen på arton selektorer täcker sidan utan tillägg, och en av dem passar
bättre än väntat:

- **`.xf-opt` + `.xf-opt.sel`** är redan "valbar rad med markerat tillstånd", med accentkanten
  ritad på insidan via `::before` så raden inte hoppar en pixel när den väljs. Felbankens
  träningsval faller ut ur den utan en rad ny CSS. Kryssrutorna kan tas bort helt — markeringen
  *är* radens tillstånd.
- **`.xf-eyebrow`** (mono, 10,5px, VERSALER) ersätter `.sNum` + `.sTitle`. Numren 01–05 följer
  med i papperskorgen; de numrerade en ordning som inte finns.
- **`.xf-act`** är en flexrad för knappar — exakt det åtgärdsraden behöver.
- **`.xf-row`** är en `dt`/`dd`-rad för etikett/värde, **inte** en generisk flexrad. Används till
  provlistans metadata, inte till knappar.
- `.xf-card`, `.xf-note`, `.xf-chip`, `.xf-btn`, `.xf-sub` tar resten.

### Det enda tillägget

Åtgärdsraden ska följa med när felbankslistan är lång, annars måste eleven scrolla tillbaka upp
efter att ha markerat en fråga långt ner. Det finns inget sticky-mönster i `exgen-ui.css` idag.

Föreslås som **en modifierare, inte en ny primitiv**:

```css
.xf-act--stick { position: sticky; top: 0; z-index: 2; }
```

Tre rader, inga nya färger, inga nya tokens. Om granskaren hellre vill hålla vokabulären orörd är
alternativet en icke-fäst åtgärdsrad överst i zonen — sämre men inte trasigt. **Flaggas för
beslut, byggs inte förrän det är taget.**

### P.E.R:s mål

`PER_TARGETS` behåller **alla fem id:n** (`prov`, `coach`, `rapport`, `trana`, `felbank`).
Manifestet och P.E.R:s formuleringar hänger på dem, och en elev som ber om "träna misstag" ska
fortfarande komma rätt. Det som ändras är vad `go` gör:

| id | idag | efter |
|---|---|---|
| `prov` | `openSection('#examSection')` | `goZone('#zonProv')` |
| `felbank` | `openSection('#mistakeSection')` | `goZone('#zonFelbank')` |
| `trana` | `openSection('#trainSection')` | `goZone('#zonFelbank', '#trainActions')` |
| `coach` | `openSection('#coachSection')` | `goZone('#zonCoach')` |
| `rapport` | `openSection('#reportSection')` | `goZone('#zonRapport')` |

`goZone(sel, focusSel)` scrollar dit och blinkar målet kort — samma `--flash`-mönster som
`.planCard--flash` i Del A, så beteendet redan är etablerat och testat. Ingen utfällning behövs
eftersom inget är hopfällt.

`trana` pekar på felbankszonen med åtgärdsraden som fokus. Det är den ändring som gör målet
sant: eleven landar där markeringen görs, inte på två knappar utan sammanhang.

### Vad som försvinner

`toggleSection`, `bindToggles`, `isOpen`, `setOpen`, `restoreUiState`, `uiState`, `saveUiState`
och nyckeln `LS_UI_OPEN` blir meningslösa utan dragspel. Tas bort, inte lämnas döda.
`LS_UI_OPEN` blir en föräldralös `localStorage`-nyckel hos befintliga elever — den skrivs aldrig
igen och kostar inget, men noteras här så nästa person inte letar efter vem som skriver den.

## Filer

| Fil | Ändring |
|---|---|
| `förbättring.html` | markup för zonerna, `goZone`, `PER_TARGETS`, borttagna dragspelsfunktioner, `applyLang` uppdaterad |
| `exgen-ui.css` | tre rader `.xf-act--stick`, **bara om tillägget godkänns** |
| `tests/frontend/forbattring-behaviour.mjs` | ny — beteendetester, se nedan |

Ingen ändring i `api/`, `shared.js`, `js/exam-flow.js` eller `js/exgen-shell.js`.

## Det som inte får gå sönder

- **`applyLang()` sätter `textContent` på ett fyrtiotal id:n** ur `T[LANG]`. Sidan är tvåspråkig.
  Varje id som flyttar måste följa med i `applyLang`, och varje id som försvinner måste bort ur
  `T.sv` **och** `T.en`. Det här är den största konkreta risken i hela Del B — det är tyst när det
  går fel, texten blir bara kvar på fel språk.
- **`setPerContext`-manifestet tar exakt fyra toppnycklar.** En femte loggar `console.warn`.
  Anropet i datagrenen (rad ~1288) och `DOMContentLoaded`-anropet ska båda leva vidare.
- **54 element-id:n** slås upp via `$()`. Behåll dem eller uppdatera varje anropsställe.
- Sidan är enda vägen till felbanken och lärarrapporten. Ingen funktion får försvinna.
- `renderMistakes`, `renderExamList`, `renderCoachSection`, `renderReportState`, `renderChart`
  och `mergeMistakes` behåller sina signaturer; det är markupen de producerar som ändras.

## Säkerhet

`esc()` används redan på allt användarinnehåll som går in i `innerHTML` i `renderMistakes` och
`renderExamList`. Omskrivningen får inte tappa ett enda `esc()`-anrop — frågetexter och modellsvar
kommer från OpenAI och elevens eget material. Inga nya `innerHTML`-ställen utan `esc()`.

Ingen ändring i `api/`, så säkerhetschecklistan i `CLAUDE.md` utlöses inte.

## Test

Återanvänd `tests/frontend/per-visual.mjs` för pixeljämförelsen — den gör redan tillfällig
worktree av `origin/main`, två körningar för brusgolvet, städning i `try/finally` och på `SIGINT`.
**Skriv ingen ny visuell rigg.**

Tre fällor som ger falska nollor, alla tre bekräftade tidigare:

1. Registrera `**/api/check-role` med `{allow:true, ok:true, role:"premium", approved:true}`
   **efter** den generella `**/api/**`-mocken — sist registrerad vinner i Playwright. Utan den
   fotograferar man `snart.html` på båda sidor.
2. `sessionStorage.setItem("pi_splash_shown","1")` i `addInitScript`. `intro-splash.js` håller
   `body > *` på `opacity: 0` i ~4,5 s via JS-timer; `animation: none` biter inte.
3. Mät brusgolvet innan du tror på ett pixelantal.

**Beteende, inte text.** Nya `tests/frontend/forbattring-behaviour.mjs` ska bevisa:

- Alla fem `PER_TARGETS`-mål scrollar till en zon som faktiskt finns i DOM:en och blir synlig.
  `trana` ska landa på åtgärdsraden.
- Att markera en rad i felbanken uppdaterar räknaren **och** `LS_TRAIN_PICK`, och att
  "Träna markerade" tar med exakt de markerade id:na.
- "Rensa val" nollar både markeringen och räknaren.
- Kursfiltret filtrerar provlista och felbank samtidigt, som idag.
- Lärarrapporten är avstängd under tre prov och påslagen vid tre.
- Språkväxlingen byter varje synlig etikett — kör `applyLang` åt båda hållen och jämför mot
  `T.sv`/`T.en` i stället för mot hårdkodade strängar.

**Mutationsverifiera varje fix.** Återställ, se testet bli rött, lägg tillbaka. Ett test som
passerar både före och efter skyddar ingenting.

## Avgränsning

- **Färgdesignen rörs inte.** Inga nya hex-värden, inga ändrade tokens. Radien är semantisk:
  fristående yta `lg`, klickbar kontroll `md`, yta inuti kort `sm`, märke eller mätare `pill`.
- Filens egen kodstil är pilfunktioner och `const`/`let` — den behålls. (`shared.js` och
  `js/exam-flow.js` är ES5, men de rörs inte här.)
- `index.html` och `pricing.html` är Del C. Toppmenyn och `exgen-shell.css` är Del D.
- Den auto-öppnande P.E.R-panelen på `pricing.html` hör till Del D och rörs inte nu.
- `style.css`-radierna rörs inte; `korkortet.html` laddar den fortfarande.
