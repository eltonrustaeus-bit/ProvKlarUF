# P.E.R som systemlager — sidmanifest, mål i sidan, synlig medvetenhet (2026-08-09)

Del A av fyra. B (förbättring.html i app-sidans formspråk), C (index + pricing),
D (toppmenyn) specas var för sig när A är byggd.

## Problem

Eleven skrev "hjälp mig med frågan" mitt i ett prov. P.E.R svarade om en helt
annan fråga. Den visste inte vilken fråga skärmen visade.

Orsaken är inte att stödet saknas. Serversidan är redan byggd för det:
`api/_per-context.js:81` läser `raw.currentQuestion` och skriver
`Aktiv fråga: #7 …` i prompten. Felet ligger i att klienten aldrig fyller i den
nyckeln.

`js/exam-flow.js:969` skickar:

```js
window.setPerContext({
  page: "prov",
  focus: { number: i + 1, text: …, type: …, options: …, points: …, course: …, level: … }
});
```

`shared.js:129–139` (`getPageContext()`) kopierar vidare exakt åtta nycklar:
`currentQuestion`, `examState`, `questions`, `userScore`, `weakAreas`, `course`,
`level`, `mode`. `focus` finns inte bland dem. Hela objektet försvinner utan
felmeddelande, utan konsolvarning, utan spår. P.E.R fick `page: "prov"` och
ingenting mer, och gissade.

Tre följdfel i samma mekanism:

1. **Kontexten sätts bara vid knapptryck.** `askPer()` anropas enbart från
   `.xf-ask`-knappen (`js/exam-flow.js:932`). Öppnar eleven bubblan direkt
   sätts ingen fråga alls.
2. **Kontexten uppdateras aldrig vid frågebyte.** `renderQuestion()`
   (`js/exam-flow.js:864`) rör inte kontexten. Har eleven frågat om fråga 3 och
   sedan gått till fråga 7 står fråga 3 kvar som fokus.
3. **Elevens eget svar skickas aldrig.** P.E.R kan förklara frågan men inte
   bemöta vad eleven faktiskt svarat.

Det underliggande felet är att det inte finns något kontrakt. Varje sida hittar
på sina egna nyckelnamn och hoppas att `getPageContext()` råkar känna igen dem.
`focus` är instansen; tyst nyckelkassering är klassen. Nästa sida vi bygger
kommer träffa samma sak.

Utöver detta vill eleven kunna säga "ta mig till den frågan" eller "vad kostar
det här" och faktiskt hamna på rätt ställe. Sidnavigation finns redan
(`[GOTO:pricing.html]`, `api/_per-core.js:266`, hanterad i `shared.js:494`), men
bara till hela sidor. Det finns inget sätt att peka på en plats inuti en sida.

## Lösning i tre delar

### 1. Ett manifest istället för åtta gissade nycklar

Nytt publikt anrop på den befintliga `window.PER`-modulen (`shared.js:1133`
returnerar idag `{ register, send, _resetNudge, notifyExamDone }`):

```js
window.PER.describe({
  page:    "prov",
  focus:   { kind: "question", number: 7, of: 12,
             text: "…", options: ["…"], answer: "B", answered: true },
  targets: [ { id: "q7", label: "Fråga 7", hint: "Derivata av produkt", go: fn } ],
  state:   { answered: 5, remaining: 7, elapsed: "12:40" }
});
```

Exakt fyra toppnycklar. **En okänd toppnyckel loggar
`console.warn("[PER] okänd manifestnyckel: x — ignorerad")` i stället för att
slängas tyst.** Det är den egentliga fixen: nästa felstavning syns på en sekund.

Fältkontrakt:

| Fält | Typ | Betydelse |
|---|---|---|
| `page` | sträng | Vad sidan är. Samma värden som `describePage()` i `api/_per-context.js` redan normaliserar. |
| `focus` | objekt \| null | Vad eleven tittar på just nu. `kind` säger vad det är (`"question"` är det enda som används i Del A). |
| `targets` | array | Vart P.E.R kan skicka eleven inuti sidan. Tom array = inga in-sid-hopp. |
| `state` | objekt | Sammanfattning av läget. Tre tillåtna fält: `answered`, `remaining` (heltal, saneras av befintliga `cleanNumber()`), `elapsed` (sträng, max 12 tecken). Övriga fält varnar och ignoreras, samma regel som toppnycklarna. Mappas till serverns befintliga `examState`. |

Fältet heter `elapsed`, inte `timeLeft`: provklockan i `js/exam-flow.js:849`
räknar uppåt från `S.startedAt` och det finns ingen gräns att räkna ned mot.

`focus` mappas till serverns befintliga `currentQuestion` i `getPageContext()`,
plus två nya fält (`answer`, `answered`). Ingen ny datamodell på servern —
`cleanQuestion()` i `api/_per-context.js:23` utökas med två fält.

`window.setPerContext(ctx)` behålls som tunn wrapper runt `describe()` så att
`app.html:1474` (den gamla wizarden) och `förbättring.html:1258` fortsätter
fungera oförändrade medan sidorna flyttas över. Den mappar `ctx.currentQuestion`
→ `focus` och skickar resten vidare.

### 2. Mål inuti sidan

`[GOTO:]`-taggen utökas med ett prefix:

- `[GOTO:pricing.html]` — hel sida, oförändrat beteende
- `[GOTO:#q7]` — mål inuti nuvarande sida, nytt

Sidan äger målen. Till servern går bara `id`, `label` och `hint` — aldrig
`go`-funktionen. Klienten håller funktionen lokalt i `describe()`-anropets
manifest.

Två oberoende skyddsnät, båda krävs:

1. **Prompten begränsar.** Finns `targets` byggs en rad i systemprompten som
   listar giltiga id:n med etikett, och instruktionen att bara namnge id:n ur
   den listan. Är listan tom nämns in-sid-hopp inte alls i prompten.
2. **Klienten verifierar ändå.** `finalizeMsg()` (`shared.js:494`) slår upp id:t
   i det senast publicerade manifestets `targets` innan knappen ritas. Hittas
   inget id ritas ingen knapp och svarstexten står kvar oförändrad. Modellen kan
   aldrig navigera eleven till något sidan inte själv har erbjudit, och kan
   aldrig få `location` satt till en modellgenererad sträng.

Knappen använder samma `.per-nav-cta`-klass som sidnavigationen redan har.
Etiketten kommer från `target.label`, inte från `_perNavLabels` (som bara
innehåller sidor).

### 3. Fokus som lever, och som syns

**Lever:** `renderQuestion()` anropar `describe()` vid varje frågebyte — inte
bara från hjälpknappen. Med i `focus`: frågans nummer och totalantal, texten,
alternativen, **elevens eget svar** och om den är besvarad. `targets` fylls med
en post per fråga i provet, vars `go` sätter `S.idx` och renderar om.

Textsvar uppdaterar manifestet debouncat, 500 ms efter senaste tangenttryck, så
att varje tecken inte blir ett nytt manifest. Flervalssvar uppdaterar direkt vid
klick — de är diskreta händelser.

**Syns:** bubblan (`#perBubble`) får en tillståndsrad som visas vid hover och vid
tangentbordsfokus:

```
ser: fråga 7 av 12 · ditt svar B · 12:40 på provet
```

Raden byggs helt lokalt ur senaste manifestet. Inget AI-anrop, ingen kostnad,
ingen panel som öppnas. Saknas `focus` står det `ser: den här sidan` — och då
vet eleven att det inte är någon idé att fråga om frågan.

Detta löser det egentliga förtroendeproblemet: eleven kunde inte se att P.E.R
inte visste. Nu är det synligt innan frågan ställs, inte efteråt.

Orbens andningsring (`.xf-orb::after` i `exgen-ui.css`, 3,2 s) får en snabbare
variant (2,0 s) när `focus` är satt. `@media (prefers-reduced-motion: reduce)`
nollställer inte keyframe-varaktigheter, så ringen får en egen
`animation: none`-regel i samma mediablock.

## Filer

| Fil | Ändring |
|---|---|
| `shared.js` | `PER.describe()` + validering; `getPageContext()` läser manifestet; `setPerContext()` blir wrapper; `finalizeMsg()` hanterar `#id`; tillståndsraden på bubblan |
| `js/exam-flow.js` | `describe()` i `renderQuestion()` med svar + `targets`; `askPer()` slutar sätta egen kontext och bara öppnar panelen |
| `api/_per-context.js` | `cleanQuestion()` får `answer`/`answered`; ny `cleanTargets()`; `targets` med i `summary` |
| `api/_per-core.js` | `[GOTO:#id]` lärs ut; mållistan injiceras när den finns |
| `pricing.html` | Måldeklaration per plan (Gratis/Basic/Premium) |
| `förbättring.html` | Måldeklaration per sektion; utökar befintligt `setPerContext`-anrop med `targets` (fältet går genom wrappern, så `userScore`/`weakAreas` fortsätter flöda oförändrat) |

`pricing.html` och `förbättring.html` tas med i Del A trots att deras *utseende*
hör till B och C. Skälet är att en mekanism med en enda konsument inte går att
bedöma — måldeklarationerna är några rader var och bevisar att kontraktet
fungerar på sidor som inte är provet.

## Felhantering

| Fall | Beteende |
|---|---|
| Sidan anropar aldrig `describe()` | `getPageContext()` faller tillbaka på URL-gissningen som idag |
| Okänd toppnyckel i manifestet | `console.warn`, övriga fält används |
| `focus` saknar `text` | Fokus utelämnas ur prompten; tillståndsraden visar `ser: den här sidan` |
| Modellen hittar på ett `#id` | Ingen knapp ritas, svaret står kvar oförändrat |
| `target.go` kastar | Fångas i `try/catch`, knappen blir en no-op, fel loggas |
| `targets` tom eller saknas | Mållistan utelämnas ur prompten helt |
| `localStorage` otillgängligt | Oförändrat — manifestet lever i minnet, inte i lagring |

Ingen av dessa vägar får kasta vidare upp i `send()`. Ett trasigt manifest ska
degradera P.E.R till dagens beteende, aldrig hindra ett svar.

## Säkerhet

`api/` berörs, så checklistan gäller:

- **Indata valideras före användning.** `targets` saneras av samma
  `cleanText()`/`BLOCKED_CONTEXT_REGEX` i `api/_per-context.js:3` som redan
  filtrerar `currentQuestion`. Max 24 mål, `id` max 40 tecken och begränsat till
  `[a-z0-9_-]`, `label` max 60, `hint` max 90.
- **Auth oförändrad.** Inga nya endpoints, ingen ny dataåtkomst. `api/explain.js`
  behåller sin befintliga auth- och kvotgrind.
- **Inga hemligheter i svaret.** Manifestet är klientdata som går ut och kommer
  tillbaka som ett id — inget serverdata tillkommer i svarskroppen.
- **Ingen rå SQL.** Inga DB-frågor tillkommer.
- **Modellstyrd navigation kan inte lämna sidan.** `#id` slås upp i den lokala
  listan och anropar en sidägd funktion. `location` sätts aldrig från
  modellutdata. Sidprefixet (`[GOTO:sida.html]`) behåller dagens beteende med
  `_perNavLabels`-uppslagning.

## Test

Playwright-riggen i `$CLAUDE_JOB_DIR/tmp` (`pagediff.mjs`, `pxcmp-multi.mjs`)
återanvänds. Nya kontroller:

1. **Manifestet når nätverket.** Generera prov, gå till fråga 7, svara B, öppna
   P.E.R, fånga `fetch`-kroppen till `/api/explain` och verifiera att
   `pageContext.currentQuestion.number === 7` och `.answer === "B"`. Detta test
   hade fällt `focus`-buggen direkt.
2. **Fokus följer med.** Byt till fråga 3 utan att röra hjälpknappen, verifiera
   att nästa anrop bär fråga 3.
3. **Påhittat id ritar ingen knapp.** Mocka ett svar med `[GOTO:#finnsinte]`,
   verifiera att `.per-nav-cta` inte finns och att svarstexten är intakt.
4. **Giltigt id navigerar.** Mocka `[GOTO:#q7]`, klicka, verifiera att fråga 7
   visas.
5. **Tillståndsraden stämmer.** Hovra bubblan, läs texten, jämför mot faktiskt
   frågeindex.
6. **Okänd nyckel varnar.** `describe({ blaj: 1 })` ger exakt en `console.warn`.
7. **Ingen visuell drift.** Pixeldiff på app, förbättring och pricing mot
   `origin/main`, med brusgolvet mätt först (widget dold, sticky header låst,
   `.joinCta` dold — samma tre källor som tidigare mätningar).

## Avgränsning

Del A ändrar **inte**:

- Utseendet på `förbättring.html`, `index.html`, `pricing.html` — det är B och C.
- Toppmenyn och `exgen-shell.css` — det är D.
- P.E.R:s förmåga att *utföra* handlingar (starta prov, byta nivå, filtrera
  felbanken). Målregistret som byggs här är exakt det lager en sådan förmåga
  behöver, men varje handling kräver en ångra-väg och egen riskbedömning. Eget
  projekt, senare.
- Minneslagret (`api/_per-memory.js`, `per_long_memory`) — separat subsystem,
  specat 2026-07-28.
- Panelen som auto-öppnas på timer. Noterad som kandidat för Del D, orörd här.
- `app.html`:s gamla dolda wizard och dess `setPerContext`-anrop på rad 1474 —
  fortsätter fungera via wrappern.
