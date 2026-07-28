# ExGen — fokusskifte till grundskola och gymnasium (2026-07-28)

## Mål

ExGen ska vara en renodlad studieplattform för grundskolan och gymnasiet. Körkortsteorin
och Högskoleprovet ska döljas helt från gränssnittet — men ligga kvar i kodbasen, redo att
återaktiveras.

## Beslut som fattades innan kod (Eltons val)

Två saker var blockerande och gick inte att avgöra från koden:

1. **Prissättningen hängde helt på körkort.** Basic (29 kr) såldes på "30 teoriprov/mån +
   obegränsad körkortsträning". Gratis såldes på "10 kursfrågor/dag" — också körkort. Elton
   valde att bygga om planerna kring skolinnehåll i stället för att bara dölja raderna.
2. **Ämnessidor och studieverktyg finns inte i kodbasen.** De stod i uppdraget som prioritet
   men existerar inte. Elton valde att INTE bygga dem i den här omgången — de är stora nog
   att förtjäna egen spec. Denna leverans är dölj + landningssida + navigation + priser.

Dessutom: Gratisplanen höjdes från 2 till 3 prov/vecka, eftersom körkortets 10 kursfrågor/dag
var gratisplanens huvudsakliga innehåll. Utan höjningen hade Gratis blivit för tunt för att
någon skulle hinna se vad produkten gör.

## Modularkitektur — hur HP och Körkort döljs

Två filer med samma två booleans (repot har inget byggsteg, så webbläsaren och
serverfunktionerna behöver var sin kopia):

| Fil | Styr |
|---|---|
| `js/exgen-modules.js` | Gränssnittet: nav, CTA:er, kort, prisrader, sidvakter |
| `api/_modules.js` | Vad P.E.R och mejlen BERÄTTAR att produkten innehåller |

**Klientsidan:** `js/exgen-modules.js` laddas synkront i `<head>` på varje sida (före `<body>`
parsas) och injicerar `[data-module="korkort"],[data-module="hp"]{display:none !important}`.
Eftersom regeln finns innan sidan målas första gången hinner inget blinka till.

Allt som hör till en modul är taggat `data-module="korkort"` respektive `data-module="hp"` —
19 länkar plus 7 rader i prisjämförelsen.

**Sidvakter:** `korkortet.html` och `provia-hp.html` anropar `exgenRequireModule(...)` högst
upp i sin `<head>`. Är modulen av körs `location.replace('index.html')` — sidan renderar
aldrig och hamnar inte i historiken. Direkt-URL fungerar alltså inte heller.

**P.E.R-menyn i `shared.js`** byggs i JS, inte HTML. Där filtreras körkortsposten bort helt i
stället för att döljas med CSS — en dold-men-närvarande post skulle fortfarande gå att nå med
tangentbordsnavigering.

**Serversidan:** `api/_per-core.js` bygger P.E.R:s systemprompt villkorligt. Med modulen av
tas körkortsraden ur EXGEN-KARTA bort, `[GOTO:korkortet.html]` tas bort ur
navigationsinstruktionerna, och felskyddsregeln byts till "Erbjud aldrig körkortsteori eller
högskoleprov — de ingår inte i produkten just nu." Utan detta hade P.E.R fortsatt tipsa
elever om körkortsträning och länka till en sida som numera skickar dem tillbaka till start.

### Återaktivera

Sätt `korkort: true` (eller `hp: true`) i **båda** filerna. Inget annat behöver röras.
Verifierat: med `korkort: true` återkommer `[GOTO:korkortet.html]`, körkortsraden i
EXGEN-KARTA och den gamla felskyddstexten i den faktiskt renderade systemprompten.

Ingen funktionalitet, affärslogik, API-rutt, tabell eller data har raderats.

## Prisplaner efter ombyggnaden

| | Gratis | Basic 29 kr | Premium 79 kr |
|---|---|---|---|
| Prov på eget material | 3/vecka | 30/månad | Obegränsat |
| Rättning + modellsvar | Ja | Ja | Ja |
| Fota anteckningar (OCR) | — | Ja | Ja |
| Historik + synk | — | Ja | Ja |
| P.E.R | 5/vecka | 5/dag | Obegränsat |
| Felbank + AI-coach + lärarrapport | — | — | Ja |

**Viktig rättelse under arbetet:** designutkastet gav Basic tillgång till felbanken. Vid
kontroll av koden visade det sig att hela `förbättring.html` är premium-låst
(`role==='premium'||role==='admin'`, `förbättring.html:830`) — Basic får ingen åtkomst alls.
Prissidan skrevs därför om till att matcha vad koden faktiskt gör, i stället för att lova
något som inte levereras. Vill man ge Basic felbanken är det en enradsändring i den gaten —
men det är ett affärsbeslut, inte en textändring.

## Ändrade filer

**Nya:** `js/exgen-modules.js`, `api/_modules.js`

**Modulsystem (script + taggning):** samtliga 11 sidor med gränssnitt (alla utom Googles
verifieringsfil, som saknar navigation)

**Landningssida (`index.html`):** brand-tagg, meta/OG/Twitter-beskrivningar, hero-ingress,
primär CTA, hero-produktbild (vägmärkesfråga → matematikfråga), statistikrad (körkortssiffror
→ verifierbara påståenden om skoldelen), produktvisning (bromssträcka → samhällskunskap),
funktionssektion, stegen, tre FAQ-svar, `PROVIA_AUTH_REDIRECT`

**Priser (`pricing.html`):** alla tre plankort, jämförelsetabell, meta, FAQ

**Kvot i synk:** `api/_provia-rules.js` (gratis 2→3/vecka) och `app.html`s klientsidiga
`ROLE_LIMITS` — den senare hårdkodade 2 och hade blockerat gratisanvändare vid 2 trots att
servern tillåter 3

**Navigation:** "Förbättring" → "Min utveckling" på 8 sidor plus sidans egen titel och
i18n-strängar i `app.html`

**Kopia som når användare:** `js/intro-splash.js` (startskärmens tagline),
`api/signup.js` (välkomstmejl), `api/admin.js` (uppgraderingsmejl), `konto.html`,
`integritetspolicy.html`, `api/_per-core.js` (planbeskrivningar)

## Verifiering

- Systemprompten renderades på riktigt och kontrollerades: noll körkortsreferenser, noll
  ointerpolerade `${...}` (en `${}` som hamnat utanför en template literal hade annars gett
  literal text i prompten)
- Återaktivering bevisad genom att flippa flaggan och rendera om
- Modulscriptet kört i en DOM-stub: rätt CSS injiceras, båda sidvakterna redirectar
- Alla sidor serveras 200 lokalt, modulscriptet finns i varje sidas `<head>`
- Sveptest: noll otaggade länkar kvar till dolda moduler
- Syntaxkontroll på samtliga ändrade JS-filer

**Känt, ej orsakat av denna ändring:** `förbättring.html` ger 404 under lokal `vercel dev`
på grund av de svenska tecknen i filnamnet. Produktion svarar 200 på exakt samma URL. Samma
klass av lokal dev-artefakt som request-body-problemet i `generate-exam`/`grade`.

## Kvar att göra (utanför denna leverans)

1. **Ämnessidor och studieverktyg** — finns inte, behöver egen designrunda: vilka ämnen, vad
   en ämnessida innehåller, hur den kopplas till mockprov och felbank.
2. **Felbank till Basic?** — enradsändring i `förbättring.html:830`, men ett prisbeslut.
3. **`live-demo.html`** — marknadsföringssida, fortfarande full av körkortsinnehåll. Den är
   inte länkad från navigationen men nås från startsidans "Se live-demo".
4. **`larare.html`** — lärarvyn är fortfarande låst till ett hårdkodat `OWNER_ID` ("private
   demo"). Ska skolor kunna använda den vid lansering behöver den roll-baserad åtkomst.
5. **Automatiska tester saknas** för `explain.js`/`_per-core.js`/`_per-memory.js` — den mest
   affärskritiska ytan har ingen regressionsskydd.
