# P.E.R:s minnessida — design

**Datum:** 2026-08-25
**Status:** godkänd av Elton, byggs i två delar

## Problemet

P.E.R. har vuxit över tolv moduler, sex funktionsflaggor, en svarscache, ett
långtidsminne och en kollektiv statistikvy. Ingen enskild yta säger vad han kan
eller vad han minns. Elton kan i dag bara ta reda på det genom att läsa koden
eller dagboken, vilket betyder att han i praktiken inte gör det.

Sidan är alltså ett verktyg för att hålla koll, inte en produktyta. Den ska
läsas av en person: den som bygger P.E.R.

## Vad sidan visar

`per.html` — olistad, `Disallow: /per.html` i `robots.txt`, inte i
`sitemap.xml`, ingen länk från navigeringen. `js/site-gate.js` som på varje
annan sida.

Två sektioner.

### Registret — vad P.E.R. är

En klarspråksbeskrivning per P.E.R.-modul och per funktionsflagga, hämtad ur
`api/_per-registry.js` och serverad genom `per-registry`-anropet. Varje post
svarar på tre frågor:

- **Vad gör den?** En mening, utan kodtermer.
- **Vad ser den?** Vilken data modulen läser.
- **Vilken gräns har den?** Den regel som hindrar den från att göra mer.

**Registret får inte vara en statisk fil.** `vercel.json` sätter
`outputDirectory: "."`, så hela repotroten serveras statiskt — mätt 2026-08-25
svarar `https://exgen.se/config/education-catalog.json` med 200, medan
`https://exgen.se/api/_site.js` svarar 404 tack vare understrecksprefixet. En
registerfil i `config/` hade alltså varit hämtbar av vem som helst, och låset i
Del B hade skyddat halva sidan medan den andra halvan låg öppen. Registret bor
därför i `api/`.

Gränsen är inte dekoration. `api/_per-memory.js` bär regeln "Spara aldrig namn,
e-post, telefon, kontouppgifter, hemligheter, exakta frågetexter eller
personliga detaljer", och den regeln är hela skälet till att
`concept_collective_stats` finns i stället för en tabell med elevfrågor. Ett
register som listar moduler utan deras gränser beskriver en annan P.E.R. än den
som körs.

### Pulsen — vad P.E.R. gör just nu

Aggregat, aldrig enskilda elever. Servern summerar, klienten får bara summorna.
Inget `user_id` lämnar servern i något svar.

| Mätvärde | Källa |
|---|---|
| Antal långtidsminnen, färska mot passerad 90-dagars-TTL | `per_long_memory.updated_at` |
| Cachens beslutsfördelning (`hit_exact`, `hit_vector`, `near_miss`, `miss`, `blocked`) senaste 7 dygnen | `per_cache_probe` |
| Cacherader per status (`pending`, `approved`, `rejected`) och antal utgångna | `per_answer_cache` |
| Kvotanvändning per funktion, senaste 7 dygnen | `per_quota_counters` |
| Svåraste begreppen kollektivt, med vanligaste felkoder | `concept_collective_stats` |

`concept_collective_stats` bär redan k-anonymitet i vyn: en begreppsrad kräver
minst fem distinkta elever, en felkod minst tre. Sidan läser vyn som den är och
lägger inga egna trösklar ovanpå — och får därför inte heller ta bort någon.

**Tomma aggregat måste synas som tomma.** Produktionen har ett fåtal konton, så
flera mätvärden kommer att sakna underlag. Sidan skriver "för få elever än" där
det gäller. En nolla som ser ut som ett mätvärde är sämre än ingen siffra alls —
den skulle få Elton att tro att cachen aldrig träffar när sanningen är att den
aldrig har fått en chans.

## Anti-röta

Sidans värde är att den stämmer. En handunderhållen översikt som ingen minns att
uppdatera ger falskt lugn, vilket är sämre än ingen sida.

`tests/per/per-registry.test.mjs` går rött åt båda hållen:

1. **Modul utan post.** Varje `api/_per-*.js` utom `_per-registry.js` självt
   måste ha en post i registret.
2. **Flagga utan post.** Varje flaggnyckel som förekommer i ett
   `flagsEnabled(...)`-anrop i `api/` måste ha en post.
3. **Post utan modul.** Varje post som namnger en modul måste peka på en fil som
   finns.
4. **Tom post.** Varje post måste ha ifyllt `gör`, `ser` och `gräns` — en tom
   sträng räknas som saknad.

Nästa gång vi lägger till en P.E.R.-modul ställer sviten sig i vägen tills
registret beskriver den.

Namnet är avsiktligt *registret*, inte *manifestet*: `per-manifest.test.mjs`
finns redan och gäller sidkontextlagret i `shared.js`. Två saker som heter
manifest i samma repo blir två saker ingen hittar.

## Låset

Två lager. Ordningen är inte utbytbar.

### Lager 1 — behörighet

`requireAdmin()` i `api/admin.js`: giltig session **och**
`profiles.role === 'admin'`. Oförändrat, och det är fortfarande det som avgör
vem som får läsa.

### Lager 2 — step-up med WebAuthn

Face ID och Touch ID nås från webben via WebAuthn. En passkey bevisar att
begäran kommer från en registrerad enhet vars ägare precis identifierat sig
biometriskt. Det är **autentisering av en enhet, inte behörighet** — därför
ligger den ovanpå lager 1 och aldrig i stället för det. En passkey ensam skulle
inte hindra någon från att anropa API:t direkt.

**Flödet:**

1. `passkey-auth-begin` — servern skapar en slumputmaning, skriver den till
   `admin_passkey_challenges` med 120 sekunders livstid, returnerar den.
2. Klienten anropar `navigator.credentials.get()`. Enheten visar Face ID eller
   Touch ID.
3. `passkey-auth-finish` — servern hämtar utmaningen, **raderar den**,
   verifierar signaturen mot den lagrade publika nyckeln, och utfärdar vid
   godkänt en step-up-token.

Utmaningen måste vara engångs. Apples passkeys rapporterar alltid
signaturräknare 0, så räknaren kan inte upptäcka en återspelad signatur —
raderingen av utmaningen är det enda som gör det.

**Step-up-token:** `HMAC-SHA256` över `{ userId, exp }` med
`PASSKEY_STEPUP_SECRET`, livstid 30 minuter, lagras i klientens
`sessionStorage`. Servern kräver den för `per-registry` och `per-pulse` utöver
adminrollen. Verifieringen sker alltså i API:t, inte genom att sidan döljer en
`<div>`.

**Registrering:** `passkey-register-begin` / `passkey-register-finish`, samma
utmaningsmönster. Kräver en levande lösenordssession och adminroll.

**Elton kan inte låsa ut sig.** Ingen passkey registrerad betyder att sidan
erbjuder registrering. Tappad enhet betyder inloggning med lösenord och
registrering av en ny — den gamla går att radera från sidan. Ingen väg leder
till ett läge där en manuell databasåtgärd krävs.

### Tabeller

```sql
create table public.admin_passkeys (
  credential_id text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  public_key    bytea not null,
  counter       bigint not null default 0,
  transports    text[],
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create table public.admin_passkey_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  challenge  text not null,
  kind       text not null check (kind in ('register','auth')),
  expires_at timestamptz not null
);
```

Båda får `enable row level security`,
`revoke all ... from public, anon, authenticated` och grants endast till
`service_role`, enligt husmönstret i `20260727_per_learner_loop.sql`. Ingen av
tabellerna nås någonsin från klienten.

Rollback-fil enligt konventionen i `supabase/migrations/`.

### Origin-bindning

Passkeys är bundna till sin `rpId`. En som registrerats på `exgen.se` fungerar
inte på en Vercel-preview eller på localhost. `PASSKEY_RP_ID` sätts som
miljövariabel med värdnamnet ur `SITE_ORIGIN` som standard, så att tester och
previews kan köra mot sin egen origin utan att röra produktionens.

## Beroende

`@simplewebauthn/server`.

Repot har i dag ett enda runtime-beroende (`@supabase/supabase-js`), så det här
föreslås inte lättvindigt. Skälet är att WebAuthn-verifiering betyder
CBOR-avkodning, COSE-nyckeltolkning och signaturverifiering — kod som går sönder
tyst och ser ut att fungera. En egen implementation som accepterar en ogiltig
signatur ger inget felmeddelande; den släpper bara in.

## Funktionstaket

Hobby-planen tillåter 12 serverlösa funktioner och alla 12 är använda. Sidan får
därför ingen egen route. Sex nya `action` läggs i `api/admin.js`, som redan är
admin-gatad:

`per-registry`, `per-pulse`, `passkey-register-begin`,
`passkey-register-finish`, `passkey-auth-begin`, `passkey-auth-finish`.

Antalet funktioner förblir 12.

## Test

**Del A**

- `tests/per/per-registry.test.mjs` — de fyra kontrakten ovan.
- `tests/api/per-pulse.test.mjs` — icke-admin får 403; svaret innehåller inget
  `user_id`; tomt underlag ger "för få elever än" och inte 0.
- `tests/frontend/per-sida.test.mjs` — sidan renderar registret och pulsen,
  Playwright med den befintliga riggen i `tests/frontend/_harness.mjs`.

**Del B**

- Playwrights virtuella autentiserare via CDP (`WebAuthn.enable`,
  `addVirtualAuthenticator`) kör äkta registrering och äkta inloggning i
  Chromium. Själva WebAuthn mockas inte.
- Serverside: utgången token nekas; token utfärdad för en annan användare nekas;
  återanvänd utmaning nekas; `per-pulse` utan step-up ger 403; admin utan
  passkey får erbjudande om registrering, inte data.

Varje test verifieras med sabotage: ett avsiktligt fel införs, testet ska bli
rött, felet återställs. Ett test som aldrig setts bli rött bevakar ingenting.

Sviten körs **efter** commit, enligt regeln i `CLAUDE.md` — `per.html` är en ny
HTML-sida och `sitemap-lastmod.test.mjs` läser git-datum.

## Uppdelning

**Del A:** `per.html`, registret, pulsen, rollgatad via `requireAdmin`. Mergas
när sviten är grön.

**Del B:** WebAuthn-lagret som egen PR.

Skälet till uppdelningen är felläget. Del A:s värsta utfall är en sida som visar
fel siffra. Del B:s värsta utfall är att Elton inte kommer in på sin egen sida.
De förtjänar inte samma granskning i samma diff.

## Utanför omfattning

- **Enskilda elevers minnen.** Sidan visar aggregat. Eleverna är till stor del
  minderåriga, och en uppslagsfunktion över deras minnen vore en
  övervakningspanel som personuppgiftsavtalet med skolan inte täcker.
- **Step-up för `admin.html`.** Användarlistan bär e-postadresser och är
  rimligen ett hårdare mål än den här sidan. Det är ett naturligt nästa steg
  efter Del B, men inte en del av det här bygget.
- **Redigering.** Sidan är läsbar, inte skrivbar. Inga flaggor slås på eller av
  härifrån.
