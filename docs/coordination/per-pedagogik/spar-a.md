# Spår A — server

**Skrivs bara av spår A.** Läses av båda. Se `README.md` för reglerna.

Ägda filer: `api/_per-core.js`, `api/explain.js`, `api/_per-memory.js`, `tests/per/**`

---

## Status

A1 och A2 klara. A3 (klargörande fråga) står näst på tur.

Gren: `feat/per-pedagogik`.

## Klart

### A1 — motsägelsen borttagen (`01dba2e`)

`## SVARSMÖNSTER` punkt 1 byggs nu av hjälpnivån i stället för att vara
konstant. Order, mall och ordgräns drar åt samma håll på varje nivå:

| nivå | UNDERVISNING | SVARSSTEG 1 | FORMAT |
|---|---|---|---|
| 0 | motfråga, ge INTE svaret | börja med motfrågan | max 80 ord |
| 1 | konceptet, inte svaret | börja med begreppet | max 150 ord |
| 3 | fullständig lösning | svara kärnfrågan direkt | ingen gräns |

`## RÖST` regel 2 säger nu att kortheten gäller HUR man skriver, aldrig OM
svaret ska ges.

Test: `tests/per/per-pedagogy.test.mjs`, 10 kontroller. Kör med
`node tests/per/per-pedagogy.test.mjs`. Inget nätverk, ingen webbläsare —
`buildPERSystemPrompt()` är en ren funktion.

### A2 — serversidigt tak (`2043f52`)

`helpCapFor(pageContext)` i **`api/_per-help.js`** — inte i `explain.js`, se
antaganden nedan. Hela taktabellen ur specen implementerad och testad, inklusive
skräpindata.

`api/explain.js` klämmer nu `helpLevel = min(begärd, tak)` och skickar
**`helpCap`** och **`helpLevelUsed`** i både SSE-avslutet och JSON-svaret,
enligt KONTRAKTET. Fälten är additiva — en klient som inte läser dem påverkas
inte.

Slår taket bygger prompten ett `## HJÄLPTAK` som säger varför, en gång. Slår det
inte nämns det inte alls.

Test: 25 kontroller i `tests/per/per-pedagogy.test.mjs` (P1-P8 prompten,
C1-C9 taket).

## Pågår

A3 — den klargörande frågan. Rör `api/_per-core.js` och `api/explain.js`.

## Frågor till andra spåret

Inga blockerande.

**`helpCap` och `helpLevelUsed` finns nu i svaret.** B4 kan bygga mot dem direkt.
`helpCap` är ett heltal 1-3 och säger vad servern tillät; `helpLevelUsed` är den
nivå som faktiskt användes. Gränssnittet ska rita låsta steg ur `helpCap` och
aldrig gissa taket själv — servern är den enda som vet.

**Servern är redan redo för `state.phase`.** Skickar du inget blir taket 2 under
prov, vilket är säkert men aldrig 1 och aldrig 3. Först när `phase` kommer fram
kan eleven få full lösning efter inlämning. Ingen brådska — inget går sönder
under tiden.

**`clarifyReply` finns i KONTRAKTET men läses ännu inte av servern.** Den kommer
i A3. Skicka den gärna redan nu om det passar din ordning; den ignoreras tyst
tills A3 landat.

## Observationer om andra spåret

Inga än — B har inte börjat.

## Antaganden jag gjort

- **`tests/api/` heter `tests/per/` i verkligheten.** Planen skrev
  `tests/api/per-pedagogy.test.mjs`. Katalogen finns inte; `tests/per/` finns
  och innehåller redan P.E.R:s enhetstester. Testet ligger där i stället.
  Påverkar inte spår B.

- **`package.json` saknar `"type": "module"`**, så Node läser om
  `api/_per-core.js` som ESM med en varning. Det fungerar och är samma väg
  `tests/frontend/per-context-pack.test.mjs` redan går (dynamisk import med
  absolut sökväg). Jag har INTE lagt till `"type": "module"` — det skulle
  påverka hur varje `.js` i repot tolkas, inklusive dina filer, och är inte
  mitt att bestämma ensam.

- **Taket ligger i `api/_per-help.js`, inte i `api/explain.js` som planen sa.**
  `explain.js` skapar en Supabase-klient på modulnivå och kastar
  "supabaseUrl is required" vid import utan env — taket hade alltså bara gått
  att testa med en riktig databas bakom sig. `_`-prefixet betyder hjälpare, inte
  rutt, så Vercel-taket på 12 är orört. Påverkar inte spår B: kontraktet är
  oförändrat.

- **`updateHelpLevelSignal` sparar nu `requestedLevel`, inte den klämda nivån.**
  Signalen lär sig vilket djup eleven föredrar, och taket är en spärr — inte en
  preferens. Sparades den klämda siffran hade systemet successivt lärt sig att
  en elev som alltid ber om full lösning vill ha mindre hjälp än hen vill.
  Nämns här eftersom det påverkar vad `preferred_help_level` betyder, och den
  siffran kan komma att synas i gränssnittet senare.

- **`per-visual.mjs` föll en gång och gick igenom vid omkörning.** Det är
  `-1`-flakigheten som dokumenterades i `per-visual.mjs` förra veckan:
  helsidesskärmdumpar kan skilja en pixel i höjd mellan två skott av samma
  träd. Ser du den falla: kör om innan du felsöker.
