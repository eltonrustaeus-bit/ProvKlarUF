# P.E.R:s hjärna — design

**Datum:** 2026-08-25
**Status:** godkänd av Elton (levande karta + mätt puls)
**Bygger på:** `2026-08-25-per-minnessida-design.md` (Del A och B, mergade)

## Vad den är

En tredje sektion på `per.html`: en levande karta över P.E.R. Noderna är hans
moduler, flaggor och de rutter som använder dem. Kanterna är de verkliga
`import`-relationerna. Kartan rör sig av en kraftsimulering, och en nod lyser
upp när den delen **faktiskt** användes.

Skillnaden mot en snygg animation är hela poängen: rörelsen ska betyda något.
En nod som lyser för att det ser bra ut när noder lyser är en skärmsläckare.

## Tre lager, och bara ett av dem är nytt

### Strukturen — finns redan i koden

Noder och kanter härleds ur källan, inte ur en lista någon underhåller:

| Nodtyp | Källa | Antal i dag |
|---|---|---|
| P.E.R.-modul | `api/_per-*.js` | 13 |
| Flagga | `flagsEnabled([...])` och `from("feature_flags")…eq("key",…)` | 7 |
| Rutt | `api/*.js` utan `_`-prefix som importerar en P.E.R.-modul | 6 |

Kanterna är `import … from "./_…js"`, lästa ur filerna. `explain.js` har 16
utgående kanter och blir därför kartans nav — inte för att någon placerat den
där, utan för att den faktiskt är det.

Samma anti-röta som registret: ett test faller om grafen och koden glider isär.
En karta som visar en struktur som inte finns är sämre än ingen karta.

### Pulsen — den enda nya datan

`per_module_activity(module, hour, count)`. En rad per modul och timme,
uppräknad fire-and-forget från `api/_per-core.js` när ett block faktiskt
bifogas prompten.

- **Inget `user_id`, ingen frågetext, inget svar.** Bara ett namn, en timme och
  ett antal. Samma regel som `_per-memory.js` bär sedan start.
- **Fire-and-forget.** Räkningen får aldrig fördröja eller fälla ett svar till
  en elev. Fel sväljs, precis som `logProbe()` i `_per-cache.js`.
- **Volym:** högst ~13 moduler × 24 timmar = 312 rader per dygn. Rader äldre än
  30 dygn gallras i samma sats som skriver.
- **Retention 30 dygn.** Längre ger ingen bättre bild av "just nu" och gör bara
  tabellen större.

En nod utan mätpunkt ritas dämpad och märkt — aldrig med påhittad aktivitet.

### Rörelsen — handskriven

Kraftsimulering i `<canvas>`: repulsion mellan noder, fjädrar längs kanter,
lätt dämpning. Cirka 150 rader.

Ingen graflib från CDN. `d3-force` + `d3-selection` är ~280 kB för något som
ryms i en fil, och repot har inget byggsteg. Samma avvägning som KaTeX, fast
tvärtom: där var biblioteket värt det, här är det inte det.

**Simuleringen stannar när den är stilla.** En `requestAnimationFrame`-loop som
snurrar i evighet på en sida Elton lämnar öppen är en varm telefon och ingen
information. Loopen stoppas när den totala rörelsen understiger ett tröskelvärde
och startas om vid interaktion eller ny data.

## Vad kartan visar

- **Nodstorlek** — antal kanter. Navet ser ut som ett nav.
- **Nodfärg** — modul, flagga eller rutt. Tre färger ur den befintliga paletten,
  inga nya token.
- **Ljusstyrka** — aktivitet senaste timmen mot modulens eget dygnsmedel. En
  modul som alltid används ska inte lysa starkast bara för att den alltid
  används; det intressanta är *avvikelsen*.
- **Dämpad nod** — ingen mätpunkt, med den texten i noden när man klickar.
- **Klick på en nod** — visar registerposten: vad den gör, vad den ser, och
  vilken gräns den har. Grafen och registret är samma data, sedd på två sätt.

## Åtkomst

Oförändrad. Hjärnan är en sektion på `per.html` och ärver alla tre lagren:
`requireAuth`, `requireAdmin`, `requireOwner`, plus step-up med Face ID eller
Touch ID. Ett nytt `action` i `api/admin.js`: `per-brain`. Inga nya rutter —
taket är fortfarande 12.

Markupen byggs av JS efter att servern bekräftat ägaren, som resten av sidan.

## Test

- `tests/per/per-brain.test.mjs` — grafen mot koden: varje modul är en nod,
  varje `import` är en kant, ingen kant pekar på en nod som inte finns.
  Faller åt båda hållen, som registret.
- `tests/api/per-brain.test.mjs` — aggregeringen: aktivitet per modul och
  timme, avvikelse mot dygnsmedel, och att svaret aldrig innehåller `user_id`.
- `tests/frontend/per-brain.test.mjs` — kartan ritas, noder utan mätpunkt är
  dämpade och märkta, klick visar registerposten, och simuleringen **stannar**
  när grafen är stilla.

Varje test sabotageverifieras.

## Utanför omfattning

- **Tankeström i realtid.** Elton valde kartan. En ström av vad P.E.R. gör just
  nu är ett eget bygge och kräver en annan sorts loggning.
- **Att skriva från sidan.** Kartan är läsbar. Inga flaggor slås på härifrån.
- **Historik längre än 30 dygn.** Kartan visar nuläget, inte ett arkiv.
