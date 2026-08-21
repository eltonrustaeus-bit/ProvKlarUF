# P.E.R:s svarscache — återanvänd svar utan att läcka elever

**Datum:** 2026-08-21
**Status:** reviderad efter Codex-granskning, väntar på godkännande
**Granskning:** `docs/per/CODEX_REVIEW_CACHE.md` — 15 fynd, varav 6 HIGH
**Delsystem:** A av tre (se *Avgränsning*)

## Mål

När någon ställer en fråga P.E.R redan har besvarat ska svaret komma **direkt och
gratis**, utan ett OpenAI-anrop — men bara när svaret bevisligen är detsamma för
alla som frågar.

Utlöst av Eltons observation: varje fråga till P.E.R kostar pengar, och många
frågor är samma fråga.

---

## Vad som mättes först

### Trafiken finns inte än

| Tabell | Rader |
|---|---|
| `ai_usage_events` | 183, samtliga från 2026-07-19, en användare |
| `per_sessions` | 4 |
| `per_long_memory` | 2 |
| `student_attempts` | **0** |
| `auth.users` | 13 |

En cache sparar pengar i proportion till hur ofta samma fråga återkommer. Vid den
här volymen sparar den i praktiken ingenting. **Det är inget argument mot att
bygga den — men det avgör vad den ska optimeras för.** Vinsten idag är svarstid
och det lager delsystem B senare vilar på. Kostnadsvinsten kommer när elever
finns, och först då finns data att ställa in tröskeln på.

Konsekvens: allt som måste kalibreras mot verklig trafik byggs **mätbart från dag
ett** i stället för att gissas nu (se `per_cache_probe`).

### P.E.R:s svar är personliga — det är kärnproblemet

`buildPERSystemPrompt({})` ger 8 188 tecken (~2 340 tokens) *innan* någon
elevdata lagts till. Ovanpå det lägger `api/explain.js` `longMemory`,
`learningSignals`, `student_mastery`, svaga områden, provpoäng, hjälpnivå och
`pageContext`.

Ett cachat svar från elev A som återanvänds för elev B är två fel samtidigt: **fel
svar** (byggt på fel persons kunskapsläge) och **en läcka** av A:s resultat till B.
Cachen kan alltså inte ligga framför P.E.R. Den måste ligga framför de vägar där
prompten *bevisligen* saknar elevdata.

### Vilka vägar som är opersonliga — verifierat, inte antaget

| Läge | Rad | Elevdata i prompten? | Cachebar |
|---|---|---|---|
| `landingMode` | 250 | Nej — oautentiserad, `buildPERLandingPrompt` + sanerad `targets` | **Ja** |
| EXPLAIN MODE | 608 | Nej — enbart `question` + `correct` + `option_a..d` | **Ja** |
| Identitet / UF / namn | `_per-core.js:117` | **Ja** — se nedan | **Nej** |
| `tipsMode` | 79 | Ja — felbank | Nej |
| `legalMode` | 137 | Ja | Nej |
| READINESS | 294 | Ja — `body.scores` | Nej |
| TEACH MODE i övrigt | 328 | Ja, genomgående | Nej |

**Identitetsbanan ströks efter granskning (CR-CACHE-001).** Ett tidigare utkast
ville cacha grundar-/UF-frågor när `history` var tom. Det bygger på fel sak:
`api/explain.js:411` anropar `loadLongMemory(supabase, user.id)` och
`enrichMemoryFromExamData(supabase, user.id)` — **nycklade på användaren, inte på
sessionen**. Tom historik ger alltså ändå `longMemory`, `studentName`,
`learningSignals` och plan/kvot i prompten.

Förlusten är liten. `buildPERLandingPrompt` innehåller redan
`identityBlocks(userQuestion)` (`_per-core.js:474`), så en besökare som frågar vem
som byggt ExGen får sitt svar via landningsbanan — som är genuint opersonlig.

### Infrastruktur som redan finns

Bygget tillför **ingen ny teknik**:

- `extensions.vector` + HNSW (`20260722_knowledge_engine_embeddings.sql`)
- `text-embedding-3-small`, 1536 dim (ADR 0005)
- `getEmbedding(text, { apiKey, fetchImpl })` — `src/retrieval/legal-retrieval.mjs:16`,
  tar `fetchImpl` som parameter och är därför testbar utan nätverk
- RLS-mönstret "enable RLS, noll policyer, `service_role` only"
- Feature flag-mönstret (`per_learner_loop_enabled`, av som default)
- `review_status`-mönstret `pending`/`approved` från `knowledge_chunks`

---

## Beslut

### 1. Två banor: `landing` och `explain`

Ingen sälj-/supportcache, inga generella begreppsförklaringar, ingen
identitetsbana.

**Varför inte sälj/support:** frågorna rör produkten, men prompten runt dem
(`api/explain.js:393`) bär ändå elevens mastery. Att cacha dem kräver en andra,
avskalad promptväg som måste hållas ren för alltid.

**Varför inte begreppsfrågor:** de anpassas idag till elevens nivå och hjälpstege.
Att cacha dem gör dem generiska — det ändrar produkten, inte bara kostnaden.

**Varför inte opt-out:** en missad undantagsregel blir en läcka mellan elever. Fel
default när användarna till stor del är minderåriga.

### 2. Fingeravtrycket är en hash av den renderade prompten

Ett cachat svar är en frusen kopia av en prompt som fortsätter förändras.

Konkret fall i koden: `founderAge()` i `api/_per-identity.js` räknar Eltons ålder
från födelsedatum. Den 7 mars slår den om. Ett svar cachat i februari säger "18
år" i evighet — utan att någon rört koden.

Ett tidigare utkast räknade upp promptens inputs. **Det avvisades (CR-CACHE-004):
en uppräkning måste underhållas och kommer att glida.** `PROVIA_KB` byggs
exempelvis av `buildPublicProviaKnowledge()` (`_provia-rules.js:159`) — där
priserna bor. En prisändring hade inte ogiltigförklarat något.

I stället:

```
fingerprint = sha256( OPENAI_MODEL + "\n" + promptSkelett(lane, request) )
```

`promptSkelett` är den faktiska prompten renderad med **alla fältvärden blankade**
— för `landing` frågan, för `explain` frågan *och* alla fyra alternativen plus
facit. Kvar står bara det som är gemensamt för alla frågor på banan: instruktioner,
`PROVIA_KB`, `MODULES`-beroende rader och target-listan. Fältvärdena hör hemma i
`payload_hash`, inte här — annars blir fingeravtrycket unikt per fråga och slutar
fungera som versionsmarkör.

**Med ett undantag som måste skrivas ut.** `identityBlocks(userQuestion)`
(`_per-core.js:117`) renderas bara när frågan matchar en trigger. Blankar skelettet
frågan försvinner blocket — och därmed `founderAge()` ur fingeravtrycket. Då hade
ett cachat grundarsvar överlevt födelsedagen ändå, vilket var precis det fall
fingeravtrycket finns för.

Skelettet renderas därför med **samtliga villkorade block framtvingade**: grundare,
UF och namnblocket, oavsett fråga. Fingeravtrycket täcker då allt som *kan* forma
ett svar på banan, inte bara det som formade just detta svar. Det gör att fler
rader ogiltigförklaras än strikt nödvändigt — en UF-ändring dödar även
prisfrågor — och det är rätt avvägning: en onödig miss kostar ett AI-anrop, en
missad ogiltigförklaring serverar fel fakta.

Då ingår `PROVIA_KB`,
priser, `MODULES.korkort`, `MODULES.demo`, `targets` och `founderAge()`
automatiskt — för alltid, utan att någon behöver komma ihåg dem.

Det löser samtidigt CR-CACHE-005: klientstyrda `targets` hamnar i fingeravtrycket,
så olika target-set får skilda cache-namnrum. Ett förgiftat set kan inte träffa det
legitima.

TTL ligger ovanpå som bortre gräns för det hashen inte kan täcka (lagändringar,
extern verklighet). 30 dygn.

### 3. Endast godkända rader serveras

`landingMode` är oautentiserad (`api/explain.js:249`) och rate-limitern fail-open:ar
(`api/explain.js:270`). En angripare kan via promptinjektion få ett svar cachat som
sedan serveras till riktiga besökare. **Värsta utfallet är inte elevdataläcka utan
falska pris- och produktfakta på marknadsytan** (CR-CACHE-003).

Codex ville stryka vektorsökningen för landing. Det tar bort just det som
efterfrågades — "liknande fråga". Löst i stället med en status-grind, samma mönster
som `knowledge_chunks.review_status` redan använder:

- Nya rader skrivs som **`pending`**.
- **Endast `approved` rader läses någonsin** — exakt eller via vektor.
- Godkännande sker med en dokumenterad SQL-sats mot `per_answer_cache`.

Angriparen kan alltså skriva. Ingen besökare kan träffa det som skrivits.

`lane='explain'` skrivs som `approved` direkt: prompten innehåller ingen
angripartext som når någon annan, eftersom nyckeln är hela payloaden (nästa
beslut) och en påhittad fråga därför bara kan träffa sig själv.

**Godkännandeflödet** är manuellt och dokumenterat, ingen adminyta. Två satser,
som läggs i `docs/per/CACHE_GODKANNANDE.md`:

```sql
-- Se vad som väntar (nyast först)
select id, left(question_text, 120) as fraga, left(answer, 300) as svar, created_at
  from public.per_answer_cache
 where lane = 'landing' and status = 'pending'
 order by created_at desc limit 50;

-- Godkänn de rader du läst och står bakom
update public.per_answer_cache set status = 'approved' where id in ('…','…');
```

Det ger en bieffekt som är värd mer än cachen just nu: listan visar vad besökare
faktiskt frågar landningssidan om. Rader som aldrig godkänns går ut av sig själva
via `expires_at`.

### 4. Ingen `user_id` i cachen

`api/_per-memory.js:319` instruerar redan modellen: *"Spara aldrig namn, e-post,
telefon, kontouppgifter, hemligheter, exakta frågetexter eller personliga
detaljer."*

En cache kan inte följa den regeln — den måste lagra frågetexten för att matcha på
den. Regeln gäller minnessammanfattningen, inte cachen, men motsättningen löses
uttryckligen här:

- Cachen lagrar **frågetext och svar, aldrig vem som frågade.** Ingen `user_id`,
  ingen FK till `auth.users`.
- Frågor som fastnar i cachegrinden (nästa avsnitt) cachas inte alls — varken
  läsning eller skrivning.
- Pseudonymisering avvisades: med 13 användare går en hash att slå tillbaka till en
  person på sekunder. Skyddskänsla utan skydd.

---

## Arkitektur

### Var cachen bor

| Alternativ | Bedömning |
|---|---|
| **Postgres + pgvector** | **Valt.** Extension, indextyp, embeddingmodell och RLS-mönster finns redan och är granskade. Noll ny teknik. |
| Minne i funktionen | Vercel-funktioner är kortlivade och per-instans. Vid dagens trafik dör varje instans innan den fått två frågor. |
| Vercel KV / Redis | Ingen vektorsökning — "liknande fråga" försvinner. Extra tjänst att hålla vid liv. |

### Datamodell

```sql
create table public.per_answer_cache (
  id             uuid primary key default gen_random_uuid(),
  lane           text not null check (lane in ('landing','explain')),
  payload_hash   text not null,          -- sha256 av kanonisk payload, se nedan
  fingerprint    text not null,          -- sha256 av renderad prompt + modell
  question_text  text not null,          -- klarat cachegrinden, längdbegränsad
  answer         text not null,
  embedding      extensions.vector(1536),-- null för lane='explain'
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  hits           integer not null default 0,
  created_at     timestamptz not null default now(),
  last_hit_at    timestamptz,
  expires_at     timestamptz not null,
  unique (lane, fingerprint, payload_hash)
);
```

`payload_hash` är **inte** enbart frågetexten (CR-CACHE-002):

| Bana | Kanonisk payload |
|---|---|
| `landing` | `normalizeQuestion(question)` |
| `explain` | `normalizeQuestion(question)` + `correct` + `option_a..d`, i fast ordning, med fältseparator |

Explain-prompten formas av alla sex fälten (`api/explain.js:609-622`). Samma
frågetext med ändrat facit eller ändrade alternativ måste ge en annan nyckel —
annars serveras fel förklaring.

```sql
create table public.per_cache_probe (
  id             uuid primary key default gen_random_uuid(),
  lane           text not null,
  decision       text not null check (decision in ('hit_exact','hit_vector','near_miss','miss','blocked')),
  similarity     real,
  cache_id       uuid,          -- vilken rad som träffades/nästan träffade
  fingerprint_px text,          -- fingeravtryckets första 12 tecken
  created_at     timestamptz not null default now()
);
```

Sonden är **textlös och utan `user_id`**, men bär `cache_id` och
fingeravtrycksprefix så att en skadlig rad går att hitta och rensa vid incident
(CR-CACHE-014). `uuid`-nyckel i stället för `bigserial` — då finns ingen sekvens
att ge rättigheter på (CR-CACHE-007).

### Rättigheter

Explicit, enligt husmönstret i `20260727_per_learner_loop.sql:353` och
`20260820_per_collective_stats.sql:80`:

```sql
alter table public.per_answer_cache enable row level security;   -- noll policyer
alter table public.per_cache_probe  enable row level security;   -- noll policyer

revoke all on table public.per_answer_cache from public, anon, authenticated;
revoke all on table public.per_cache_probe  from public, anon, authenticated;
grant select, insert, update on public.per_answer_cache to service_role;
grant insert                 on public.per_cache_probe  to service_role;
```

Alla RPC:er: `security definer`, `set search_path = public`, och

```sql
revoke execute on function public.<fn> from public, anon, authenticated;
grant  execute on function public.<fn> to service_role;
```

"Enable RLS + noll policyer" ensamt räcker inte — projektet vet redan det
(CR-CACHE-007, CR-CACHE-008).

### Uppslagsordning

```
fråga in
  │
  ├─ cachegrinden nekar? ──────────► probe:blocked, kör live, cacha inget
  │
  ├─ 1. exakt: (lane, fingerprint, payload_hash), status='approved', ej utgången
  │      träff ──► svara, probe:hit_exact                 [0 kostnad, 0 nätverk]
  │
  ├─ 2. lane='explain'? ──► ingen vektorsökning alls, probe:miss, kör live
  │
  ├─ 3. embedding av frågan   (~1/2000 av ett fullt anrop)
  │      cosine ≥ 0.95 OCH slot-guard godkänner ──► svara, probe:hit_vector
  │      cosine 0.88–0.95, eller slot-guard nekar ──► probe:near_miss, kör live
  │      annars ──► probe:miss, kör live
  │
  └─ live-svar ──► storeAnswer() efter att svaret skickats (aldrig blockerande)
```

Ordagranna upprepningar kostar **ingenting alls**, inte ens en embedding.

Explain-banan är hash-only med avsikt: dess indata är klientstyrd (`body.question`
m.fl.), och utan vektormatchning kan en påhittad fråga bara träffa sig själv.

### Slot-guard före varje vektorträff

Cosinus ensamt räcker inte (CR-CACHE-011). Två frågor kan ligga mycket nära och
ändå ha motsatta svar:

```
"vad kostar Premium?"   vs  "vad kostar Basic?"
"får jag köra om här?"  vs  "får jag inte köra om här?"
```

Embeddings är svaga just på negation och utbytta egennamn. En vektorträff används
därför **bara** om alla tre stämmer mellan fråga och cachad rad:

| Slot | Regel |
|---|---|
| Siffror | Samma multiset av tal (`29`, `79`, `2026`) |
| Plannamn | Samma förekomstmängd ur `{gratis, basic, premium}` |
| Negationsparitet | Samma antal negationer mod 2 (`inte`, `aldrig`, `utan`, `ej`) |

Skiljer något — miss, oavsett cosinus. Guarden skyddar innan mätdata finns;
näramiss-loggen kalibrerar tröskeln när trafik finns.

### Kanonisering — exakt kontrakt

Hash-träffen står och faller med den (CR-CACHE-012):

1. Unicode **NFC**
2. Trimma, kollapsa allt blanksteg till enkelt mellanslag
3. Gemener via `toLocaleLowerCase('sv')` — svenska diakriter **bevaras** (`å ä ö` är inte `a a o`)
4. Ta bort skiljetecken **endast i slutet** (`?`, `!`, `.`)
5. Bevara siffror, bindestreck och `/` inuti ord — `A-B` är inte `AB`
6. Ingen HTML-avkodning; en fråga som innehåller `&lt;` är inte samma fråga som en med `<`
7. Trunkera till 500 tecken **före** hashning, så att två långa frågor med samma
   inledning inte kollapsar till samma nyckel utan att det är avsiktligt

### Cachegrinden

Egen modul, **inte** minnesmodulens regex (CR-CACHE-006). `PRIVATE_OR_SECRET_REGEX`
(`_per-memory.js:13`) är skriven för minnessammanfattningar och fångar inte
personnummer eller svenska injektionsfraser.

`api/_per-cache-guard.js` nekar cachning när frågan innehåller:

- e-post, telefonnummer, API-nycklar (ärvs från befintliga mönster)
- svenskt personnummer (`ÅÅMMDD-XXXX`, `ÅÅÅÅMMDDXXXX`)
- svenska injektionsfraser (`strunta i`, `bortse från`, `låtsas att`, `visa din systemprompt`, `agera som`)
- engelska motsvarigheter (`ignore previous`, `system prompt`, `developer message`)

Codex ville dessutom lagra bara hash och en kort preview i stället för
frågetexten. **Avvisat:** svaret måste lagras helt — det är hela poängen — och
frågetexten behövs för att kalibrera tröskeln. Skyddet ligger i att inget cachas
som inte klarat grinden, inte i att lagra mindre av det som klarat den.

### Skrivning och träffbokföring

**Träff** — en sats, inte läs-ändra-skriv (CR-CACHE-009):

```sql
update public.per_answer_cache
   set hits = hits + 1, last_hit_at = now()
 where id = p_id
returning answer;
```

**Skrivning** — `insert ... on conflict do nothing` (CR-CACHE-010). `answer` skrivs
**aldrig** över. Två parallella missar kan ge olika svar; den första vinner, den
andra kastas. Ingen "sista skrivaren vinner".

### Kodmoduler

Fyra små moduler med en uppgift var.

| Fil | Ansvar | Beroenden |
|---|---|---|
| `api/_per-cache-guard.js` | Ren funktion. Nekar/tillåter cachning av en frågetext. | inga |
| `api/_per-fingerprint.js` | Ren funktion, ingen I/O. `normalizeQuestion()`, `payloadHash()`, `fingerprintOf(renderedPrompt)`, slot-guard. | inga |
| `api/_per-cache.js` | Enda modulen som känner till tabellerna. `lookupCached()`, `storeAnswer()`. | de två ovan, `getEmbedding` |
| `api/explain.js` | Inkoppling på två ställen. Ingen cachelogik i filen. | `_per-cache.js` |

De två rena modulerna hålls fria från I/O just för att kunna testas utan databas
och utan nätverk.

### Felbeteende

Varje cachefel faller igenom till det riktiga anropet. **En trasig cache får göra
P.E.R långsam, aldrig trasig.** Samma `catch`-och-fortsätt-mönster som
`loadPerHistory()` (`api/explain.js:213`).

Gäller uttryckligen: embeddinganropet timeoutar, tabellen saknas, RPC:n felar,
flaggan går inte att läsa. Inget av det når användaren. `storeAnswer()` körs efter
att svaret skickats och blockerar aldrig.

### Feature flag

`per_answer_cache_enabled`, **av som default**, samma mönster som
`per_learner_loop_enabled`. Ytan är inert i produktion tills flaggan slås på.

---

## Test

Plain `.mjs`, `node <fil>`, exit 0 = pass — projektets konvention.
`tests/per/per-cache.test.mjs`.

| Vad som låses | Varför |
|---|---|
| Kanoniseringens sju regler, var för sig | Hash-träffen står och faller med dem |
| `å ä ö` kollapsar inte till `a a o` | Regel 3, lätt att råka bryta |
| `A-B` ≠ `AB`, `&lt;` ≠ `<` | Regel 5 och 6 |
| Fingeravtryck ändras vid `OPENAI_MODEL` | Modellbyte får inte servera gamla svar |
| Fingeravtryck ändras vid `MODULES`-omslag | Flaggomslag måste ogiltigförklara |
| Fingeravtryck ändras vid `founderAge()` | Det konkreta åldersfallet |
| Fingeravtryck ändras vid prisändring i `PLAN_RULES` | Beviset att renderad prompt slår uppräkning |
| Fingeravtryck ändras vid annat `targets`-set | CR-CACHE-005 |
| `explain`: samma fråga + annat `correct` ⇒ annan nyckel | CR-CACHE-002 |
| Slot-guard: Premium/Basic, negation, tal | CR-CACHE-011 |
| Grinden nekar personnummer och svenska injektionsfraser | CR-CACHE-006 |
| `pending`-rad serveras aldrig | CR-CACHE-003 — hela förgiftningsskyddet |
| Utgången rad ger miss | TTL |
| Fel `lane` ger aldrig träff | Banornas isolering |
| Kastande stub ⇒ live-svar, inte fel | Fail-open |
| Ingen kolumn heter `user_id` | Beslut 4, låst i test |

Testet ska bevisligen kunna gå rött: verifieras genom att tillfälligt släppa
`status`-filtret, tillfälligt slå av slot-guarden och tillfälligt lägga till en
`user_id`-kolumn — samma metod som `per-scope-identity.test.mjs` verifierades med.

---

## Avgränsning

Delsystem **A** av tre. Ingår **inte**:

- **B — kollektiv hjärna:** kurerat bibliotek av bra svar som alla elever
  förbättrar. Bygger på A:s lager och på `status`-fältet som införs här.
- **C — personlig fördjupning:** P.E.R blir bättre på *dig*. `per_long_memory` och
  `student_mastery` finns; `student_attempts` är 0, så evidenskedjan måste flöda
  först.

Ingen ändring av `MODULES`. Inga ändringar i befintliga prompter.

**Separat uppföljning, utanför detta bygge:** `consume_anon_rate` och
`anon_rate_limit` saknar forward-migration i repot — bara nämnda i
`supabase/migrations/README.md` (CR-CACHE-013). Cachen är inte beroende av dem
eftersom landningsskrivningar landar som `pending`, men spårningshålet finns kvar
och bör lagas för sig.

---

## Vad detta ger, ärligt

**Idag:** snabbare svar på landningssidan och på facitförklaringar, efter att du
godkänt de första raderna. Noll kronor sparade — det finns ingen trafik att spara
på.

**Vid riktig trafik:** en exakt träff kostar noll, en vektorträff ~1/2000 av ett
fullt anrop. Och lagret som delsystem B vilar på.
