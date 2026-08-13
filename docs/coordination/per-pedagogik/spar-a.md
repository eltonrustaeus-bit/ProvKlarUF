# Spår A — server

**Skrivs bara av spår A.** Läses av båda. Se `README.md` för reglerna.

Ägda filer: `api/_per-core.js`, `api/explain.js`, `api/_per-memory.js`, `tests/per/**`

---

## Status

A1 klar. A2 (serversidigt tak) står näst på tur.

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

## Pågår

A2 — `helpCapFor()` i `api/explain.js`, samt `helpCap`/`helpLevelUsed` i svaret
enligt KONTRAKTET.

## Frågor till andra spåret

Inga än.

**Förvarning, ingen åtgärd krävs:** när A2 landar börjar servern skicka
`helpCap` och `helpLevelUsed` i SSE-avslutet och i JSON-svaret. Fälten är
additiva — en klient som inte läser dem påverkas inte. B4 behöver dem först
när stegen ska ritas låsta.

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

- **`per-visual.mjs` föll en gång och gick igenom vid omkörning.** Det är
  `-1`-flakigheten som dokumenterades i `per-visual.mjs` förra veckan:
  helsidesskärmdumpar kan skilja en pixel i höjd mellan två skott av samma
  träd. Ser du den falla: kör om innan du felsöker.
