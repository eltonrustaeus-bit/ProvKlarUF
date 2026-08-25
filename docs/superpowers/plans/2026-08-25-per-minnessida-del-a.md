# P.E.R:s minnessida, Del A — implementationsplan

> **För agentiska arbetare:** OBLIGATORISK UNDERFÄRDIGHET: använd
> superpowers:subagent-driven-development (rekommenderas) eller
> superpowers:executing-plans för att köra planen uppgift för uppgift. Stegen
> använder kryssrutor (`- [ ]`).

**Mål:** En privat sida `per.html` som visar vad P.E.R. är (registret) och vad
han gör just nu (pulsen), låst bakom adminrollen.

**Arkitektur:** Registret är en ESM-modul i `api/` — inte en fil i `config/`,
eftersom repotroten serveras statiskt. Pulsen delas i en ren aggregeringsmodul
(`api/_per-pulse.js`, testbar utan databas) och databasfrågorna i `api/admin.js`.
Sidan hämtar båda genom två nya `action` i `api/admin.js`. Inga nya rutter.

**Teknik:** Vanlig HTML/CSS/JS utan byggsteg, ESM i `api/`, Supabase
`service_role` på servern, Playwright för sidtestet, Node utan testramverk för
resten (husets stil: `check(namn, villkor)` + `process.exit(failures?1:0)`).

**Spec:** `docs/superpowers/specs/2026-08-25-per-minnessida-design.md`

## Globala villkor

- **Funktionstaket är 12 av 12.** Skapa aldrig en ny fil i `api/` utan
  `_`-prefix. Nya ytor blir `action` i `api/admin.js`.
- **`api/admin.js` är ESM.** Statiska `import` överst i filen är rätt här.
- **Inget `user_id` får lämna servern** i något svar från `per-pulse`.
- **Tomt underlag skrivs som `TOO_FEW` (`"för få elever än"`), aldrig som `0`.**
- **Registret ligger i `api/`, aldrig i `config/`.** `vercel.json` har
  `outputDirectory: "."`, så `config/*.json` är publikt hämtbart —
  `https://exgen.se/config/education-catalog.json` svarade 200 vid mätning
  2026-08-25, medan `https://exgen.se/api/_site.js` svarade 404.
- **Designtoken ändras inte.** Bakgrund `#08100d`, accent `#1bff8c`, surface
  `#111a15` / `#162019`, text `#e8f5ee` / `#a8c4b4`, radie `5px`, DM Sans +
  DM Mono. Kopiera `<head>` och skalstruktur från `admin.html`.
- **Svenska i all text som når skärmen och i alla testnamn.**
- **Sviten körs EFTER commit.** `per.html` är en ny HTML-sida och
  `tests/frontend/sitemap-lastmod.test.mjs` läser git-datum.
- **Varje test sabotageverifieras:** inför avsiktligt fel, se rött, återställ.
  Ett test som aldrig setts bli rött bevakar ingenting.

## Filstruktur

| Fil | Ansvar |
|---|---|
| `api/_per-registry.js` | Klartextbeskrivning av varje P.E.R.-modul och flagga. Ingen logik, ingen I/O. |
| `api/_per-pulse.js` | Rena aggregeringsfunktioner. Tar rader, ger summor. Ingen databas, inget nätverk. |
| `api/admin.js` | Två nya `action`: `per-registry` och `per-pulse`. Äger databasfrågorna. |
| `per.html` | Sidan. Hämtar båda anropen och ritar dem. |
| `robots.txt` | `Disallow: /per.html` |
| `tests/per/per-registry.test.mjs` | Anti-röta åt båda hållen. |
| `tests/api/per-pulse.test.mjs` | Aggregeringen + källkodskontrakt på `admin.js`. |
| `tests/frontend/per-sida.test.mjs` | Att sidan ritar registret och pulsen. |

---

### Task 1: Registret

**Filer:**
- Skapa: `api/_per-registry.js`
- Skapa: `tests/per/per-registry.test.mjs`

**Gränssnitt:**
- Konsumerar: inget.
- Producerar: `PER_REGISTRY` — `{ moduler: Post[], flaggor: Post[] }` där
  `Post = { fil?: string, nyckel?: string, namn: string, gör: string, ser: string, gräns: string }`.
  Modulposter bär `fil` (basnamn, t.ex. `"_per-core.js"`), flaggposter bär
  `nyckel`.

- [ ] **Steg 1: Skriv det fallerande testet**

Skapa `tests/per/per-registry.test.mjs`:

```js
// Registret över vad P.E.R. består av (api/_per-registry.js).
//
// Användning:  node tests/per/per-registry.test.mjs   (exit 0 = pass)
//
// Sidan per.html har ett enda värde: att den stämmer. En handunderhållen
// översikt som ingen minns att uppdatera ger falskt lugn, och falskt lugn är
// sämre än ingen sida — då vet man åtminstone att man inte vet.
//
// Testet går därför rött åt BÅDA hållen: en modul utan post, och en post utan
// modul. Nästa gång någon lägger till en P.E.R.-modul står sviten i vägen tills
// registret beskriver den.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiDir = join(root, "api");
const { PER_REGISTRY } = await import(join(apiDir, "_per-registry.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const apiFiles = readdirSync(apiDir).filter(f => f.endsWith(".js"));

/* _per-registry.js beskriver sig inte själv. */
const moduleFiles = apiFiles
  .filter(f => /^_per-.*\.js$/.test(f) && f !== "_per-registry.js")
  .sort();

/* Flaggnycklarna härleds ur koden, inte ur en lista någon underhåller.
   TVÅ mönster, för att flaggor läses på två sätt i repot:
     1. flagsEnabled(supabase, ["nyckel"], id) — grinden i api/_flags.js
     2. from("feature_flags") … .eq("key", "nyckel") — api/_per-cache.js
        läser sin flagga direkt, utan att gå genom grinden. */
const flagKeys = new Set();
for (const f of apiFiles) {
  const src = readFileSync(join(apiDir, f), "utf8");
  for (const m of src.matchAll(/flagsEnabled\s*\(\s*(?:supabase\s*,\s*)?\[([^\]]*)\]/g)) {
    for (const k of m[1].matchAll(/["']([a-z0-9_]+)["']/g)) flagKeys.add(k[1]);
  }
  for (const m of src.matchAll(/from\(\s*["']feature_flags["']\s*\)[\s\S]{0,400}?\.eq\(\s*["']key["']\s*,\s*["']([a-z0-9_]+)["']/g)) {
    flagKeys.add(m[1]);
  }
}

console.log("\n— HÄRLEDNINGEN SJÄLV —");
/* Om regexarna slutar matcha blir varje kontroll nedan grön på tomma
   mängder, och testet skyddar ingenting utan att säga till. */
check("modulfiler hittas i api/", moduleFiles.length >= 10, `${moduleFiles.length} st`);
check("flaggnycklar hittas i koden", flagKeys.size >= 5, [...flagKeys].join(", "));

console.log("\n— MODUL UTAN POST —");
const beskrivnaFiler = new Set(PER_REGISTRY.moduler.map(m => m.fil));
for (const f of moduleFiles) {
  check(`${f} är beskriven`, beskrivnaFiler.has(f));
}

console.log("\n— POST UTAN MODUL —");
const filerPåDisk = new Set(apiFiles);
for (const m of PER_REGISTRY.moduler) {
  check(`${m.fil} finns på disk`, filerPåDisk.has(m.fil));
}

console.log("\n— FLAGGA UTAN POST —");
const beskrivnaFlaggor = new Set(PER_REGISTRY.flaggor.map(f => f.nyckel));
for (const k of [...flagKeys].sort()) {
  check(`${k} är beskriven`, beskrivnaFlaggor.has(k));
}

console.log("\n— TOM POST —");
/* En post som finns men är tom är värre än en som saknas: den saknade fångas
   av kontrollerna ovan, den tomma ser ut som en beskrivning. */
for (const p of [...PER_REGISTRY.moduler, ...PER_REGISTRY.flaggor]) {
  const id = p.fil || p.nyckel;
  for (const fält of ["namn", "gör", "ser", "gräns"]) {
    check(`${id}.${fält} är ifyllt`, typeof p[fält] === "string" && p[fält].trim().length >= 10, p[fält]);
  }
}

console.log("\n— GRÄNSERNA ÄR INTE DEKORATION —");
/* api/_per-memory.js bär regeln som är hela skälet till att _per-collective.js
   finns i stället för en tabell med elevfrågor. Ett register som listar modulen
   utan dess gräns beskriver en annan P.E.R. än den som körs. */
const minnet = PER_REGISTRY.moduler.find(m => m.fil === "_per-memory.js");
check("minnets gräns nämner att personuppgifter aldrig sparas",
  /aldrig/i.test(minnet?.gräns || "") && /(namn|personlig|personuppgift)/i.test(minnet?.gräns || ""),
  minnet?.gräns);

const kollektiva = PER_REGISTRY.moduler.find(m => m.fil === "_per-collective.js");
check("kollektiva lagrets gräns nämner k-anonymiteten",
  /k-anonym|fem distinkta|minst fem/i.test(kollektiva?.gräns || ""),
  kollektiva?.gräns);

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
```

- [ ] **Steg 2: Kör testet och se att det faller**

Kör: `node tests/per/per-registry.test.mjs`
Förväntat: krasch med `Cannot find module` för `_per-registry.js`.

- [ ] **Steg 3: Skriv registret**

Skapa `api/_per-registry.js`:

```js
// api/_per-registry.js — vad P.E.R. består av, i klartext.
//
// Filen finns för en enda läsare: den som bygger P.E.R. Efter tolv moduler,
// sex flaggor, en svarscache, ett långtidsminne och en kollektiv statistikvy
// fanns ingen yta som svarade på "vad kan han, och vad får han inte".
//
// VARFÖR I api/ OCH INTE I config/
// vercel.json sätter outputDirectory ".", så hela repotroten serveras
// statiskt. Mätt 2026-08-25 svarar https://exgen.se/config/education-catalog.json
// med 200 medan https://exgen.se/api/_site.js svarar 404 tack vare
// understrecksprefixet. En registerfil i config/ hade legat öppen för vem som
// helst medan låset skyddade resten av sidan.
//
// VARJE POST HAR TRE FÄLT, OCH DET TREDJE ÄR DET VIKTIGA
// gör/ser säger vad modulen är till för. `gräns` säger vad som hindrar den
// från att göra mer, och det är den delen som är svår att läsa sig till ur
// koden. tests/per/per-registry.test.mjs faller om något fält är tomt, om en
// modul saknar post, eller om en post pekar på en fil som inte finns.

export const PER_REGISTRY = {
  moduler: [
    {
      fil: "_per-core.js",
      namn: "Kärnan",
      gör: "Bygger P.E.R:s systemprompt och gör anropet till modellen. Varje svar i produkten går genom den här filen.",
      ser: "Elevens fråga, deras roll, sidkontexten och de kunskapsblock frågan utlöser.",
      gräns: "Kunskapsblocken är villkorade. Vision, FAQ och Alléskolan bifogas bara när frågan gäller dem — annars betalar varje svar för text ingen bad om.",
    },
    {
      fil: "_per-memory.js",
      namn: "Långtidsminnet",
      gör: "Sammanfattar elevens studiemönster till en kort profil som följer med i kommande samtal.",
      ser: "Elevens provhistorik och deras tidigare meddelanden till P.E.R.",
      gräns: "Sparar aldrig namn, e-post, telefon, kontouppgifter, hemligheter, exakta frågetexter eller personliga detaljer. Minnet gallras efter 90 dagar.",
    },
    {
      fil: "_per-context.js",
      namn: "Sidkontexten",
      gör: "Tar emot klientens beskrivning av var eleven står och gör den texten säker att lägga in i en prompt.",
      ser: "Sidnamn, aktuell fråga och provläge — allt skickat från webbläsaren.",
      gräns: "Klientens text är otrodd indata. Injektionsfraser och hemlighetsmönster byts mot [filtrerad klientkontext] innan något når modellen.",
    },
    {
      fil: "_per-help.js",
      namn: "Hjälptrappan",
      gör: "Avgör hur mycket hjälp eleven får: ledtråd, förklaring, steg för steg, eller full lösning.",
      ser: "Begärd hjälpnivå och var i flödet eleven befinner sig.",
      gräns: "Nivån avgörs på servern. En klient som ber om full lösning får den inte bara för att den frågar.",
    },
    {
      fil: "_per-role.js",
      namn: "Rollvalet",
      gör: "Väljer studieplanerare eller utmanare när situationen kräver en roll som bygger på vad eleven faktiskt kan.",
      ser: "Elevens uppmätta kunskapsläge per begrepp.",
      gräns: "Minst tre försök krävs innan ett begrepp får styra. Rollen får aldrig annonseras för eleven, och ett pågående prov slår varje roll.",
    },
    {
      fil: "_per-sales.js",
      namn: "Säljgrinden",
      gör: "Avgör om P.E.R. får nämna planer och priser, och hur mycket.",
      ser: "Var eleven är och vad de gör — aldrig ett enskilt ord i frågan.",
      gräns: "Under pågående prov och mitt i ett arbete säljer P.E.R. aldrig. Men en rak prisfråga utanför provet besvaras alltid, att vika undan är otjänlighet.",
    },
    {
      fil: "_per-identity.js",
      namn: "Grundare och UF",
      gör: "Ger P.E.R. den publika informationen om vem som byggt ExGen och hur UF-upplägget ser ut.",
      ser: "Ingen elevdata — bara statisk text i filen.",
      gräns: "Medvetet minimal. Inget om grundaren som inte redan är publikt.",
    },
    {
      fil: "_per-name.js",
      namn: "Namnet",
      gör: "Håller namnet och vad bokstäverna står för på ett ställe: Progressive Evidence Reasoning.",
      ser: "Ingenting.",
      gräns: "Namnet skrivs aldrig av för hand någon annanstans. Repot bar tre konkurrerande beskrivningar samtidigt innan filen fanns, och en modell som presenterar sig olika beroende på rutt läser som tre produkter.",
    },
    {
      fil: "_per-cache.js",
      namn: "Svarscachen",
      gör: "Sparar och återanvänder svar på frågor som bevisligen saknar elevdata, så samma fråga inte betalas två gånger.",
      ser: "Frågetext och svar på landningsbanan och förklaringsbanan.",
      gräns: "Ingen väg in från undervisningsläget. Den grenen läser elevens minne och kunskapsläge, och ett återanvänt svar hade varit två fel samtidigt: fel svar och en läcka.",
    },
    {
      fil: "_per-cache-guard.js",
      namn: "Cachevakten",
      gör: "Avgör vad som aldrig får hamna i svarscachen.",
      ser: "Texten som är på väg in i cachen.",
      gräns: "Strängare än minnets filter, för det som passerar här lagras i klartext och kan serveras till någon annan. Fångar svenskt personnummer och svenska injektionsfraser, som minnets regex inte gör.",
    },
    {
      fil: "_per-fingerprint.js",
      namn: "Fingeravtrycken",
      gör: "Räknar ut de nycklar svarscachen slår upp på.",
      ser: "Frågetexten och den kontext svaret beror av.",
      gräns: "Ingen I/O och inga projektberoenden — hela modulen går att testa utan databas och utan nätverk, vilket är hela skälet att den är skild från cachen.",
    },
    {
      fil: "_per-collective.js",
      namn: "Kollektiva lagret",
      gör: "Låter P.E.R. lära av alla elever utan att spara en enda av deras frågor eller svar.",
      ser: "Poäng per begrepp och avidentifierade felkoder, aggregerat över alla elever.",
      gräns: "K-anonymitet i vyn: ett begrepp syns först vid fem distinkta elever, en felkod vid tre. Vyn är dessutom oåtkomlig för klienter och läses bara av servern.",
    },
  ],

  flaggor: [
    {
      nyckel: "knowledge_engine_enabled",
      namn: "Kunskapsmotorn",
      gör: "Låter P.E.R. slå upp i det indexerade korpuset i stället för att svara ur modellens minne.",
      ser: "Elevens fråga, för att hitta relevanta stycken.",
      gräns: "Av som default, och ett fel vid läsningen av flaggan betyder AV — aldrig på.",
    },
    {
      nyckel: "legal_rag_enabled",
      namn: "Juridikens rättskällor",
      gör: "Låter juridiksvaren hämta belägg ur rättskällor innan de formuleras.",
      ser: "Frågan och det indexerade juridikkorpuset.",
      gräns: "Kräver att kunskapsmotorn också är på — båda flaggorna måste vara sanna samtidigt, annars är grinden stängd.",
    },
    {
      nyckel: "legal_shadow_mode",
      namn: "Skuggläge för juridik",
      gör: "Kör hela juridikkedjan och sparar utfallet utan att visa det för eleven.",
      ser: "Samma underlag som skarpt läge.",
      gräns: "Eleven ser aldrig resultatet. Läget finns för att mäta kvalitet innan något släpps på riktiga elever.",
    },
    {
      nyckel: "per_learner_loop_enabled",
      namn: "Elevloopen",
      gör: "Slår på återkopplingen där elevens fel styr vad nästa prov handlar om.",
      ser: "Rättade försök och felhändelser per begrepp.",
      gräns: "Av som default.",
    },
    {
      nyckel: "per_learner_profile_enabled",
      namn: "Elevprofilen",
      gör: "Låter P.E.R. läsa och skriva elevens profilfakta — skolform, program, kurs.",
      ser: "Tabellen learner_profile_facts.",
      gräns: "Härledda uppgifter under 0,65 säkerhet får forma svaret men aldrig påstås. Elevens eget svar skrivs aldrig över av en gissning.",
    },
    {
      nyckel: "per_answer_cache_enabled",
      namn: "Svarscachens grind",
      gör: "Slår på återanvändningen av svar.",
      ser: "Inget eget — den är grinden framför _per-cache.js.",
      gräns: "Av som default. Läses direkt ur feature_flags i stället för genom flagsEnabled, och ett fel vid läsningen betyder av.",
    },
  ],
};
```

- [ ] **Steg 4: Kör testet och se att det går grönt**

Kör: `node tests/per/per-registry.test.mjs`
Förväntat: `Allt grönt`, exit 0.

- [ ] **Steg 5: Sabotageverifiera åt båda hållen**

Kör dessa tre, en i taget, och återställ efter varje:

**Varje sabotage måste hävda att det faktiskt applicerades.** Ett `sed` som inte
matchar tiger, testet förblir grönt, och du drar slutsatsen att kontrollen
fungerar. Det har hänt i det här repot: ett `python3 -c` med `\n` inuti en
dubbelciterad sträng blev en riktig radbrytning, `replace` matchade ingenting,
och sabotaget rapporterades som verifierat. Därför `assert` i varje block.

Skriv varje block till en fil och kör den — nedbäddade heredocs i ett skal
citerar sig själva sönder.

```bash
cat > /tmp/sab-a.py <<'SLUT'
import io
p = "api/_per-registry.js"; s = io.open(p, encoding="utf-8").read()
i = s.index('fil: "_per-name.js"')
start = s.rindex("    {", 0, i); end = s.index("    },", i) + 7
ny = s[:start] + s[end:]
assert "_per-name.js" not in ny, "sabotaget applicerades inte"
io.open(p, "w", encoding="utf-8").write(ny)
SLUT
python3 /tmp/sab-a.py
node tests/per/per-registry.test.mjs   # FAIL: "_per-name.js är beskriven"
git checkout api/_per-registry.js
```

```bash
cat > /tmp/sab-b.py <<'SLUT'
import io
p = "api/_per-registry.js"; s = io.open(p, encoding="utf-8").read()
gammal = 'fil: "_per-name.js"'
assert gammal in s, "mönstret finns inte, sabotaget hade tigit"
io.open(p, "w", encoding="utf-8").write(s.replace(gammal, 'fil: "_per-saknas.js"'))
SLUT
python3 /tmp/sab-b.py
node tests/per/per-registry.test.mjs   # FAIL: "_per-saknas.js finns på disk"
git checkout api/_per-registry.js
```

```bash
cat > /tmp/sab-c.py <<'SLUT'
import io
p = "api/_per-registry.js"; s = io.open(p, encoding="utf-8").read()
i = s.index('fil: "_per-name.js"')
j = s.index("gräns:", i); k = s.index("\n", j)
ut = s[:j] + 'gräns: "",' + s[k:]
# Måste TÖMMA fältet, inte korta det. Ett första försök bytte bara ut början av
# strängen och lämnade resten kvar — fältet var fortfarande långt, testet
# grönade, och sabotaget bevisade ingenting.
assert "Namnet skrivs aldrig av" not in ut, "sabotaget tömde inte fältet"
io.open(p, "w", encoding="utf-8").write(ut)
SLUT
python3 /tmp/sab-c.py
node tests/per/per-registry.test.mjs   # FAIL: "_per-name.js.gräns är ifyllt"
git checkout api/_per-registry.js
```

Alla tre måste ge minst ett `FAIL` och exit 1. Ger någon av dem grönt är den
kontrollen tom — laga testet innan du går vidare.

- [ ] **Steg 6: Commit**

```bash
git add api/_per-registry.js tests/per/per-registry.test.mjs
git commit -m "feat(per): registret över vad P.E.R. består av"
```

---

### Task 2: Pulsens aggregering

**Filer:**
- Skapa: `api/_per-pulse.js`
- Skapa: `tests/api/per-pulse.test.mjs`

**Gränssnitt:**
- Konsumerar: inget.
- Producerar:
  - `TOO_FEW: "för få elever än"`
  - `MIN_PROBES: 20`
  - `summariseMemories(rows, now) -> { totalt, färska, gamla }` där
    `rows = [{ updated_at: string }]` och `now` är ms.
  - `summariseProbes(rows) -> { totalt, per: {hit_exact,hit_vector,near_miss,miss,blocked}, träffkvot: number|string }`
  - `summariseCache(rows, now) -> { pending, approved, rejected, utgångna }` där
    `rows = [{ status: string, expires_at: string }]`
  - `summariseQuota(rows) -> [{ funktion: string, använt: number }]` sorterad
    fallande, där `rows = [{ feature: string, used: number }]`
  - `summariseConcepts(rows) -> [{ namn, medelpoäng, elever, felkoder }] | string`
    där `rows` är rader ur vyn `concept_collective_stats`.

- [ ] **Steg 1: Skriv det fallerande testet**

Skapa `tests/api/per-pulse.test.mjs`:

```js
// Pulsens aggregering (api/_per-pulse.js).
//
// Användning:  node tests/api/per-pulse.test.mjs   (exit 0 = pass)
//
// Funktionerna är rena med flit: de tar rader och ger summor. Ingen databas,
// inget nätverk, ingen mockning. Det som är svårt att få rätt här är inte
// matematiken utan vad som händer när underlaget är för tunt.
//
// PRODUKTIONEN HAR ETT FÅTAL KONTON. Flera mätvärden kommer att sakna underlag
// från dag ett. En nolla som ser ut som ett mätvärde är då sämre än ingen
// siffra alls: den skulle få läsaren att tro att cachen aldrig träffar, när
// sanningen är att den aldrig fått chansen.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = await import(join(root, "api", "_per-pulse.js"));

let failures = 0;
const check = (n, c, d = "") => {
  if (c) console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
  else { failures++; console.error(`  FAIL  ${n}${d ? " — " + d : ""}`); }
};

const NU = Date.parse("2026-08-25T12:00:00Z");
const dagarSedan = d => new Date(NU - d * 86_400_000).toISOString();

console.log("\n— LÅNGTIDSMINNEN —");
const minnen = P.summariseMemories([
  { updated_at: dagarSedan(1) },
  { updated_at: dagarSedan(40) },
  { updated_at: dagarSedan(91) },
  { updated_at: dagarSedan(200) },
], NU);
check("totalen räknar alla rader", minnen.totalt === 4, JSON.stringify(minnen));
check("färska är de inom 90 dygn", minnen.färska === 2);
check("gamla är de som passerat TTL", minnen.gamla === 2);
/* Gränsen är 90 dygn. Ett minne på dagen 90 är ännu inte gallringsbart —
   off-by-one här skulle få sidan att rapportera gallring som inte skett. */
check("exakt 90 dygn räknas som färskt", P.summariseMemories([{ updated_at: dagarSedan(90) }], NU).färska === 1);
check("tom lista ger nollor, inte krasch", P.summariseMemories([], NU).totalt === 0);

console.log("\n— CACHENS BESLUT —");
const probes = P.summariseProbes([
  ...Array(12).fill({ decision: "hit_exact" }),
  ...Array(4).fill({ decision: "hit_vector" }),
  ...Array(3).fill({ decision: "near_miss" }),
  ...Array(9).fill({ decision: "miss" }),
  ...Array(2).fill({ decision: "blocked" }),
]);
check("varje beslut räknas", probes.per.hit_exact === 12 && probes.per.miss === 9, JSON.stringify(probes.per));
check("totalen stämmer", probes.totalt === 30);
/* (12+4)/30 = 53,3 % — avrundat till heltal. */
check("träffkvoten räknar båda träffsorterna", probes.träffkvot === 53, String(probes.träffkvot));
check("blocked räknas men är ingen träff", probes.per.blocked === 2);

console.log("\n— FÖR TUNT UNDERLAG SÄGS RAKT UT —");
/* Under MIN_PROBES är en träffkvot brus, inte ett mätvärde. Att visa "0 %"
   på fyra sonderingar vore att påstå något som inte är mätt. */
const tunt = P.summariseProbes([{ decision: "miss" }, { decision: "miss" }]);
check("under 20 sonderingar ges TOO_FEW i stället för siffra", tunt.träffkvot === P.TOO_FEW, String(tunt.träffkvot));
check("men råa antal visas ändå", tunt.totalt === 2 && tunt.per.miss === 2);
check("noll sonderingar ger också TOO_FEW", P.summariseProbes([]).träffkvot === P.TOO_FEW);
check("TOO_FEW är svensk text, inte en nolla", P.TOO_FEW === "för få elever än");

console.log("\n— CACHERADER —");
const cache = P.summariseCache([
  { status: "approved", expires_at: dagarSedan(-5) },
  { status: "approved", expires_at: dagarSedan(2) },
  { status: "pending",  expires_at: dagarSedan(-1) },
  { status: "rejected", expires_at: dagarSedan(-1) },
], NU);
check("status räknas var för sig", cache.approved === 2 && cache.pending === 1 && cache.rejected === 1, JSON.stringify(cache));
check("utgångna räknas på expires_at, inte på status", cache.utgångna === 1);

console.log("\n— KVOTER —");
const kvot = P.summariseQuota([
  { feature: "per_chat", used: 3 },
  { feature: "per_chat", used: 5 },
  { feature: "explain",  used: 2 },
]);
check("samma funktion summeras", kvot.find(r => r.funktion === "per_chat")?.använt === 8, JSON.stringify(kvot));
check("sorteras fallande", kvot[0].funktion === "per_chat");
check("tom lista ger tom lista", P.summariseQuota([]).length === 0);

console.log("\n— SVÅRASTE BEGREPPEN —");
const begrepp = P.summariseConcepts([
  { concept_name: "Derivata", mean_score: 0.42, student_count: 7, common_error_codes: ["kedjeregel"] },
  { concept_name: "Bråk",     mean_score: 0.71, student_count: 9, common_error_codes: [] },
]);
check("namnet följer med", begrepp[0].namn === "Derivata", JSON.stringify(begrepp));
check("svårast först", begrepp[0].medelpoäng < begrepp[1].medelpoäng);
check("felkoderna följer med", begrepp[0].felkoder.length === 1);
/* Vyn concept_collective_stats bär redan k-anonymitet: minst fem distinkta
   elever per begreppsrad. En tom svarsmängd betyder alltså att tröskeln inte
   nåtts — inte att alla kan allt. */
check("tom vy ger TOO_FEW, inte tom lista", P.summariseConcepts([]) === P.TOO_FEW);

console.log("\n— INGET user_id LÄMNAR SERVERN —");
/* Aggregaten är hela integritetslöftet. Frågorna i admin.js får aldrig
   selecta en kolumn som pekar ut en elev — då spelar det ingen roll att
   funktionerna ovan summerar. */
const admin = readFileSync(join(root, "api", "admin.js"), "utf8");
const perBlock = admin.slice(admin.indexOf('action === "per-pulse"'));
check("per-pulse-blocket finns i admin.js", perBlock.length > 0 && admin.includes('action === "per-pulse"'));
check("ingen select av user_id i per-pulse", !/select\([^)]*user_id/.test(perBlock.slice(0, 3000)), "kolla select-strängarna");
check("per-pulse går genom requireAdmin", /requireAdmin/.test(admin));

console.log(failures ? `\n${failures} FEL\n` : "\nAllt grönt\n");
process.exit(failures ? 1 : 0);
```

- [ ] **Steg 2: Kör testet och se att det faller**

Kör: `node tests/api/per-pulse.test.mjs`
Förväntat: krasch med `Cannot find module` för `_per-pulse.js`.

- [ ] **Steg 3: Skriv aggregeringen**

Skapa `api/_per-pulse.js`:

```js
// api/_per-pulse.js — rena funktioner som gör rader till summor.
//
// Ingen databas, inget nätverk, inga projektberoenden. Frågorna bor i
// api/admin.js; det här är bara matematiken, och den går därför att testa
// utan att något behöver mockas.
//
// VARFÖR TOO_FEW FINNS
// Produktionen har ett fåtal konton. Flera mätvärden saknar underlag från dag
// ett, och en nolla som ser ut som ett mätvärde är då sämre än ingen siffra
// alls — den skulle få läsaren att tro att cachen aldrig träffar när sanningen
// är att den aldrig fått chansen.

export const TOO_FEW = "för få elever än";

/** Under så här många sonderingar är en träffkvot brus, inte en mätning. */
export const MIN_PROBES = 20;

/** Samma 90 dygn som MEMORY_TTL_DAYS i api/_per-memory.js. */
export const MEMORY_TTL_DAYS = 90;

const TRÄFFAR = ["hit_exact", "hit_vector"];
const BESLUT = ["hit_exact", "hit_vector", "near_miss", "miss", "blocked"];

export function summariseMemories(rows = [], now = Date.now()) {
  let färska = 0;
  for (const r of rows) {
    const t = Date.parse(r?.updated_at ?? "");
    // Ett oläsbart datum räknas som gammalt: hellre rapportera gallringsbart
    // än att påstå att ett minne är färskt utan att veta.
    const ålderDagar = Number.isFinite(t) ? (now - t) / 86_400_000 : Infinity;
    if (ålderDagar <= MEMORY_TTL_DAYS) färska++;
  }
  return { totalt: rows.length, färska, gamla: rows.length - färska };
}

export function summariseProbes(rows = []) {
  const per = Object.fromEntries(BESLUT.map(d => [d, 0]));
  for (const r of rows) if (r?.decision in per) per[r.decision]++;
  const totalt = rows.length;
  const träffar = TRÄFFAR.reduce((s, d) => s + per[d], 0);
  const träffkvot = totalt < MIN_PROBES ? TOO_FEW : Math.round((träffar / totalt) * 100);
  return { totalt, per, träffkvot };
}

export function summariseCache(rows = [], now = Date.now()) {
  const ut = { pending: 0, approved: 0, rejected: 0, utgångna: 0 };
  for (const r of rows) {
    if (r?.status in ut) ut[r.status]++;
    const t = Date.parse(r?.expires_at ?? "");
    if (Number.isFinite(t) && t <= now) ut.utgångna++;
  }
  return ut;
}

export function summariseQuota(rows = []) {
  const per = new Map();
  for (const r of rows) {
    const f = String(r?.feature ?? "").trim();
    if (!f) continue;
    per.set(f, (per.get(f) || 0) + (Number(r?.used) || 0));
  }
  return [...per.entries()]
    .map(([funktion, använt]) => ({ funktion, använt }))
    .sort((a, b) => b.använt - a.använt);
}

export function summariseConcepts(rows = []) {
  // Vyn concept_collective_stats bär k-anonymiteten själv: minst fem distinkta
  // elever per begreppsrad, minst tre per felkod. En tom svarsmängd betyder
  // att tröskeln inte nåtts — inte att alla kan allt.
  if (!rows.length) return TOO_FEW;
  return rows
    .map(r => ({
      namn: String(r?.concept_name ?? "okänt begrepp"),
      medelpoäng: Number(r?.mean_score ?? 0),
      elever: Number(r?.student_count ?? 0),
      felkoder: Array.isArray(r?.common_error_codes) ? r.common_error_codes : [],
    }))
    .sort((a, b) => a.medelpoäng - b.medelpoäng);
}
```

- [ ] **Steg 4: Kör testet — de tre sista kontrollerna ska fortfarande falla**

Kör: `node tests/api/per-pulse.test.mjs`
Förväntat: allt under `— INGET user_id LÄMNAR SERVERN —` ger `FAIL`, resten
`PASS`. Det är rätt: `admin.js` får sitt `per-pulse` först i Task 3.

- [ ] **Steg 5: Commit**

```bash
git add api/_per-pulse.js tests/api/per-pulse.test.mjs
git commit -m "feat(per): aggregeringen bakom pulsen"
```

---

### Task 3: Anropen i admin.js

**Filer:**
- Ändra: `api/admin.js` — nya `import` överst, två nya `action`-block före
  raden `return res.status(400).json({ ok: false, error: "Unknown action" });`

**Gränssnitt:**
- Konsumerar: `PER_REGISTRY` från Task 1; `summariseMemories`,
  `summariseProbes`, `summariseCache`, `summariseQuota`, `summariseConcepts`,
  `TOO_FEW` från Task 2.
- Producerar: HTTP-svaren
  - `POST /api/admin { action: "per-registry" }` → `{ ok: true, registry: PER_REGISTRY }`
  - `POST /api/admin { action: "per-pulse" }` →
    `{ ok: true, pulse: { minnen, cacheBeslut, cacheRader, kvoter, begrepp, hämtad } }`

- [ ] **Steg 1: Lägg till importerna**

`api/admin.js` är ESM. Lägg dessa direkt under de befintliga importerna överst
i filen:

```js
import { PER_REGISTRY } from "./_per-registry.js";
import {
  summariseMemories, summariseProbes, summariseCache,
  summariseQuota, summariseConcepts,
} from "./_per-pulse.js";
```

- [ ] **Steg 2: Lägg till de två action-blocken**

Direkt före `return res.status(400).json({ ok: false, error: "Unknown action" });`
i `handler`:

```js
  if (action === "per-registry") {
    if (!(await requireAdmin(req, res))) return;
    return res.status(200).json({ ok: true, registry: PER_REGISTRY });
  }

  if (action === "per-pulse") {
    if (!(await requireAdmin(req, res))) return;

    // Aggregat, aldrig enskilda elever: ingen select nedan hämtar user_id.
    // tests/api/per-pulse.test.mjs läser de här select-strängarna och faller
    // om någon börjar hämta en kolumn som pekar ut en person.
    const nu = Date.now();
    const sjuDygnSedan = new Date(nu - 7 * 86_400_000).toISOString();
    const sjuDagarsDatum = sjuDygnSedan.slice(0, 10);

    const [minnen, sonder, rader, kvoter, begrepp] = await Promise.all([
      supabase.from("per_long_memory").select("updated_at").limit(5000),
      supabase.from("per_cache_probe").select("decision").gte("created_at", sjuDygnSedan).limit(5000),
      supabase.from("per_answer_cache").select("status, expires_at").limit(5000),
      supabase.from("per_quota_counters").select("feature, used").gte("day", sjuDagarsDatum).limit(5000),
      supabase.from("concept_collective_stats")
        .select("concept_name, mean_score, student_count, common_error_codes")
        .order("mean_score", { ascending: true }).limit(8),
    ]);

    return res.status(200).json({
      ok: true,
      pulse: {
        minnen:      summariseMemories(minnen.data || [], nu),
        cacheBeslut: summariseProbes(sonder.data || []),
        cacheRader:  summariseCache(rader.data || [], nu),
        kvoter:      summariseQuota(kvoter.data || []),
        begrepp:     summariseConcepts(begrepp.data || []),
        hämtad:      new Date(nu).toISOString(),
      },
    });
  }
```

- [ ] **Steg 3: Kör testet och se att allt går grönt**

Kör: `node tests/api/per-pulse.test.mjs`
Förväntat: `Allt grönt`, exit 0 — även de tre kontrollerna under
`— INGET user_id LÄMNAR SERVERN —`.

- [ ] **Steg 4: Sabotageverifiera user_id-kontrollen**

```bash
cat > /tmp/sab-uid.py <<'SLUT'
import io
p = "api/admin.js"; s = io.open(p, encoding="utf-8").read()
gammal = 'select("updated_at").limit(5000)'
assert gammal in s, "mönstret finns inte, sabotaget hade tigit"
io.open(p, "w", encoding="utf-8").write(s.replace(gammal, 'select("updated_at, user_id").limit(5000)', 1))
SLUT
python3 /tmp/sab-uid.py
node tests/api/per-pulse.test.mjs   # FAIL: "ingen select av user_id i per-pulse"
git checkout api/admin.js
```

Ger den grönt är kontrollen tom — hela integritetslöftet vilar på den raden.

- [ ] **Steg 5: Kontrollera att funktionstaket inte rörts**

Kör: `ls api/*.js | grep -v '/_' | wc -l`
Förväntat: `12`. Blir det 13 har någon skapat en ny rutt — Vercel Hobby
distribuerar då inte projektet alls.

- [ ] **Steg 6: Commit**

```bash
git add api/admin.js
git commit -m "feat(per): per-registry och per-pulse som adminanrop"
```

---

### Task 4: Sidan

**Filer:**
- Skapa: `per.html`
- Ändra: `robots.txt` — rad efter `Disallow: /admin.html`
- Skapa: `tests/frontend/per-sida.test.mjs`

**Gränssnitt:**
- Konsumerar: `POST /api/admin { action: "per-registry" }` och
  `{ action: "per-pulse" }` från Task 3.
- Producerar: inget som senare uppgifter läser.

- [ ] **Steg 1: Skriv det fallerande testet**

Skapa `tests/frontend/per-sida.test.mjs`:

```js
import { ROOT, serve, mockApis, seed, report } from "./_harness.mjs";
// P.E.R:s minnessida (per.html).
//
// Användning:  node tests/frontend/per-sida.test.mjs
//
// Sidan har en enda läsare och ett enda syfte: att stämma. Testerna nedan
// mäter tre saker som alla kan gå sönder tyst:
//   1. att registret faktiskt ritas ut, inte bara hämtas
//   2. att gränsen — det svåraste fältet att läsa sig till ur koden — syns
//   3. att "för få elever än" skrivs som text och inte som en nolla
//
// Riggen kommer från _harness.mjs. Läs kommentaren där innan du lägger till
// egna mockar — sidan bakom js/site-gate.js kräver att check-role registreras
// EFTER den generella **/api/**-rutten.

const { chromium } = await import(ROOT + "/node_modules/playwright/index.mjs");
const srv = await serve(ROOT, { indexFile: "per.html" });

const R = report("per-sida");
const ok = (n, c, d = "") => R.ok(n, c, d);

/* Egna svar går genom mockApis `extra`, som registreras SIST och därför vinner
   över den generella **/api/**-rutten. Se kommentaren i _harness.mjs — en
   felvänd ordning gav vid ett tillfälle sex gröna kontroller på en tom sida. */
const adminRoute = route => {
  const body = JSON.parse(route.request().postData() || "{}");
  if (body.action === "per-registry") {
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, registry: {
        moduler: [{ fil: "_per-memory.js", namn: "Långtidsminnet", gör: "Sammanfattar elevens studiemönster.", ser: "Provhistorik.", gräns: "Sparar aldrig namn eller personliga detaljer." }],
        flaggor: [{ nyckel: "per_answer_cache_enabled", namn: "Svarscachens grind", gör: "Slår på återanvändningen.", ser: "Inget eget.", gräns: "Av som default." }],
      } }),
    });
  }
  if (body.action === "per-pulse") {
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, pulse: {
        minnen: { totalt: 4, färska: 3, gamla: 1 },
        cacheBeslut: { totalt: 2, per: { hit_exact: 0, hit_vector: 0, near_miss: 0, miss: 2, blocked: 0 }, träffkvot: "för få elever än" },
        cacheRader: { pending: 1, approved: 0, rejected: 0, utgångna: 0 },
        kvoter: [{ funktion: "per_chat", använt: 8 }],
        begrepp: "för få elever än",
        hämtad: "2026-08-25T12:00:00.000Z",
      } }),
    });
  }
  return route.fulfill({ status: 400, contentType: "application/json", body: '{"ok":false}' });
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await mockApis(page, {
  role: "admin",
  profiles: { id: "u1", approved: true, role: "admin" },
  extra: [["**/api/admin", adminRoute]],
});
await seed(page, { role: "admin", user: { id: "u1" } });

await page.goto(`${srv.url}/per.html`, { waitUntil: "networkidle" });
await page.waitForSelector("#registret .post", { timeout: 8000 }).catch(() => {});

const text = await page.evaluate(() => document.body.innerText);

ok("T1 modulens namn ritas ut", text.includes("Långtidsminnet"), text.slice(0, 200));
ok("T2 gränsen ritas ut", text.includes("Sparar aldrig namn"));
ok("T3 flaggan ritas ut", text.includes("Svarscachens grind"));
ok("T4 minnessiffrorna ritas ut", /\b4\b/.test(text) && text.includes("färska"));
ok("T5 kvoten ritas ut", text.includes("per_chat") && text.includes("8"));

/* Det viktigaste testet i filen. Skrivs tunt underlag ut som "0 %" läser
   sidan som en mätning, och läsaren drar slutsatsen att cachen aldrig
   träffar — när sanningen är att den aldrig fått chansen. */
ok("T6 tunt underlag skrivs som text, inte som noll",
  text.includes("för få elever än") && !/träffkvot[^\n]*\b0\s*%/i.test(text), text.slice(0, 400));

ok("T7 sidan bär noindex",
  await page.evaluate(() => !!document.querySelector('meta[name="robots"][content*="noindex"]')));

await ctx.close();
await browser.close();
await srv.close();

process.exit(R.finish());
```

- [ ] **Steg 2: Kör testet och se att det faller**

Kör: `node tests/frontend/per-sida.test.mjs`
Förväntat: T1–T7 ger `FAIL` (sidan finns inte, servern svarar 404).

- [ ] **Steg 3: Bygg sidan**

Skapa `per.html`. Kopiera `<head>`-blocket ur `admin.html` rad 1–21 rakt av
(site-gate, favicons, DM Sans/DM Mono, `style.css`, `exgen-tokens.css`,
`exgen-shell.css`), byt `<title>` till `ExGen – P.E.R:s minne` och lägg till
`<meta name="robots" content="noindex, nofollow" />`. Sedan:

```html
<style>
  .pageHero{padding:32px 0 24px;border-bottom:1px solid var(--l);margin-bottom:24px}
  .pageSub{font-size:13px;color:var(--t2);line-height:1.7;max-width:62ch}
  .sekt{margin-bottom:40px}
  .sektRubrik{font-size:17px;font-weight:700;color:var(--t);margin:0 0 4px}
  .sektSub{font-family:var(--mono);font-size:11px;color:var(--t3);margin:0 0 14px}
  .rutnät{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
  .post{background:var(--s);border:1px solid var(--l);border-radius:var(--r);padding:14px}
  .postNamn{font-size:14px;font-weight:700;color:var(--t);margin:0 0 2px}
  .postFil{font-family:var(--mono);font-size:10px;color:var(--t3);margin:0 0 10px}
  .postFält{font-size:12.5px;color:var(--t2);line-height:1.6;margin:0 0 7px}
  .postFält b{color:var(--t);font-weight:600}
  .postGräns{border-top:1px solid var(--l);padding-top:8px;margin-top:9px}
  .statsRow{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px}
  .statBox{background:var(--s);border:1px solid var(--l);border-radius:var(--r);padding:14px}
  .statLabel{font-family:var(--mono);font-size:9.5px;font-weight:500;color:var(--t3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px}
  .statVal{font-size:21px;font-weight:700;color:var(--t)}
  .statVal.tunt{font-size:12.5px;font-weight:500;color:var(--t3);line-height:1.5}
  .statVal.accent{color:var(--a)}
</style>
```

Kroppen — samma skalstruktur som `admin.html` (loader, header, `<main>`):

```html
<main class="wrap">
  <div class="pageHero">
    <h1 class="pageTitle">P.E.R:s minne</h1>
    <p class="pageSub" id="status">Kontrollerar åtkomst…</p>
  </div>

  <section class="sekt">
    <h2 class="sektRubrik">Registret</h2>
    <p class="sektSub">vad P.E.R. är — moduler och flaggor</p>
    <div class="rutnät" id="registret"></div>
  </section>

  <section class="sekt">
    <h2 class="sektRubrik">Pulsen</h2>
    <p class="sektSub" id="pulsTid">vad han gör just nu</p>
    <div class="statsRow" id="pulsen"></div>
    <div class="rutnät" id="begreppen"></div>
  </section>
</main>
```

Skriptet. Läs `SB_URL`/`SB_KEY` ur `admin.html` rad 243–245 och använd samma
värden och samma `db.auth.getSession()`-mönster:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
const SB_URL = 'https://mnmotdluigzeehdjbhbu.supabase.co';
const SB_KEY = 'sb_publishable_T541A0HFXsw0zQRAhIy0kA_x0hcsfVN';
const db = window.supabase.createClient(SB_URL, SB_KEY);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TOO_FEW = 'för få elever än';

async function anropa(action) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) return null;
  return res.json();
}

function ritaPost(p) {
  return `<div class="post">
    <p class="postNamn">${esc(p.namn)}</p>
    <p class="postFil">${esc(p.fil || p.nyckel)}</p>
    <p class="postFält"><b>Gör:</b> ${esc(p.gör)}</p>
    <p class="postFält"><b>Ser:</b> ${esc(p.ser)}</p>
    <p class="postFält postGräns"><b>Gräns:</b> ${esc(p.gräns)}</p>
  </div>`;
}

/* Ett värde som inte är ett tal skrivs som text i mindre stil. Att rendera
   "för få elever än" som en stor siffra vore att låtsas att den är mätt. */
function ritaStat(etikett, värde, accent) {
  const tunt = typeof värde !== 'number';
  return `<div class="statBox">
    <div class="statLabel">${esc(etikett)}</div>
    <div class="statVal ${tunt ? 'tunt' : (accent ? 'accent' : '')}">${esc(värde)}</div>
  </div>`;
}

async function ladda() {
  const status = document.getElementById('status');

  const reg = await anropa('per-registry');
  if (!reg?.ok) { status.textContent = 'Ingen åtkomst. Sidan kräver adminkonto.'; return; }
  status.textContent = 'Det här är en privat sida. Registret beskrivs i api/_per-registry.js och bevakas av tests/per/per-registry.test.mjs.';
  document.getElementById('registret').innerHTML =
    [...reg.registry.moduler, ...reg.registry.flaggor].map(ritaPost).join('');

  const p = await anropa('per-pulse');
  if (!p?.ok) return;
  const d = p.pulse;
  document.getElementById('pulsTid').textContent = 'hämtad ' + new Date(d.hämtad).toLocaleString('sv-SE');
  document.getElementById('pulsen').innerHTML = [
    ritaStat('Långtidsminnen', d.minnen.totalt),
    ritaStat('Varav färska', d.minnen.färska, true),
    ritaStat('Passerat 90 dygn', d.minnen.gamla),
    ritaStat('Cachens träffkvot', typeof d.cacheBeslut.träffkvot === 'number' ? d.cacheBeslut.träffkvot + ' %' : d.cacheBeslut.träffkvot, true),
    ritaStat('Sonderingar 7 dygn', d.cacheBeslut.totalt),
    ritaStat('Cacherader godkända', d.cacheRader.approved),
    ritaStat('Cacherader väntande', d.cacheRader.pending),
    ritaStat('Cacherader utgångna', d.cacheRader.utgångna),
    ...d.kvoter.map(k => ritaStat('Kvot ' + k.funktion, k.använt)),
  ].join('');

  document.getElementById('begreppen').innerHTML = (d.begrepp === TOO_FEW)
    ? `<div class="post"><p class="postNamn">Svåraste begreppen</p><p class="postFält">${esc(TOO_FEW)} — vyn concept_collective_stats visar ett begrepp först vid fem distinkta elever.</p></div>`
    : d.begrepp.map(b => `<div class="post">
        <p class="postNamn">${esc(b.namn)}</p>
        <p class="postFil">${esc(b.elever)} elever · medelpoäng ${esc(b.medelpoäng)}</p>
        <p class="postFält">${b.felkoder.length ? 'Vanligaste fel: ' + esc(b.felkoder.join(', ')) : 'Inga felkoder över tröskeln.'}</p>
      </div>`).join('');
}

ladda();
</script>
```

- [ ] **Steg 4: Håll sidan borta från sökmotorer**

I `robots.txt`, direkt efter raden `Disallow: /admin.html`:

```
Disallow: /per.html
```

- [ ] **Steg 5: Kör testet och se att allt går grönt**

Kör: `node tests/frontend/per-sida.test.mjs`
Förväntat: T1–T7 `PASS`, exit 0.

- [ ] **Steg 6: Sabotageverifiera T6, filens viktigaste kontroll**

```bash
cat > /tmp/sab-t6.py <<'SLUT'
import io
p = "per.html"; s = io.open(p, encoding="utf-8").read()
gammal = "typeof d.cacheBeslut.träffkvot === 'number' ? d.cacheBeslut.träffkvot + ' %' : d.cacheBeslut.träffkvot"
assert gammal in s, "mönstret finns inte, sabotaget hade tigit"
io.open(p, "w", encoding="utf-8").write(s.replace(gammal, "(Number(d.cacheBeslut.träffkvot) || 0) + ' %'", 1))
SLUT
python3 /tmp/sab-t6.py
node tests/frontend/per-sida.test.mjs   # FAIL på T6
git checkout per.html
```

- [ ] **Steg 7: Commit**

```bash
git add per.html robots.txt tests/frontend/per-sida.test.mjs
git commit -m "feat(per): privat sida som visar registret och pulsen"
```

---

### Task 5: Dokumentation och hel svit

**Filer:**
- Ändra: `CLAUDE.md` — nytt avsnitt efter `## Matematikdjupet (2026-08-25)`

**Gränssnitt:**
- Konsumerar: allt från Task 1–4.
- Producerar: inget kod-gränssnitt.

- [ ] **Steg 1: Skriv avsnittet i CLAUDE.md**

Lägg in efter det sista stycket i `## Matematikdjupet (2026-08-25)`:

```markdown
## P.E.R:s minnessida (2026-08-25)
- **Registret bor i `api/_per-registry.js`, aldrig i `config/`.** `vercel.json`
  har `outputDirectory: "."`, så hela repotroten serveras statiskt — mätt
  2026-08-25 svarar `/config/education-catalog.json` med 200 medan
  `/api/_site.js` ger 404 tack vare understrecksprefixet. En registerfil i
  `config/` hade legat öppen för vem som helst.
- **`tests/per/per-registry.test.mjs` går rött åt BÅDA hållen.** En
  `api/_per-*.js` utan post, och en post som pekar på en fil som inte finns.
  Flaggnycklarna härleds ur koden i två mönster: `flagsEnabled([...])` och
  `from("feature_flags") … .eq("key", …)` — `_per-cache.js` läser sin flagga
  direkt, utan att gå genom grinden. Slutar båda regexarna matcha blir varje
  kontroll grön på tomma mängder, och därför kontrollerar testet först att
  härledningen hittade något alls.
- **Tomt underlag skrivs som `TOO_FEW`, aldrig som `0`.** Produktionen har ett
  fåtal konton. En nolla som ser ut som ett mätvärde får läsaren att tro att
  cachen aldrig träffar, när sanningen är att den aldrig fått chansen. En
  träffkvot under 20 sonderingar är brus, inte en mätning.
- **Pulsen är aggregat, aldrig enskilda elever.** Ingen `select` i
  `per-pulse`-blocket hämtar `user_id`, och `tests/api/per-pulse.test.mjs`
  läser select-strängarna och faller om någon börjar. Eleverna är till stor del
  minderåriga; en uppslagsfunktion över deras minnen vore en övervakningspanel
  som personuppgiftsavtalet inte täcker.
- **`concept_collective_stats` bär k-anonymiteten själv** — fem distinkta
  elever per begrepp, tre per felkod. Sidan läser vyn som den är och lägger
  varken till eller tar bort en tröskel.
- **Sidan är rollgatad, inte låst med Face ID än.** `requireAdmin` är gaten.
  WebAuthn-lagret är Del B i
  `docs/superpowers/specs/2026-08-25-per-minnessida-design.md`, och en passkey
  autentiserar en enhet — den är aldrig ett ersättningsgate för rollkollen.
```

- [ ] **Steg 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: P.E.R:s minnessida i CLAUDE.md"
```

- [ ] **Steg 3: Kör hela sviten — EFTER commit**

`tests/frontend/sitemap-lastmod.test.mjs` jämför `<lastmod>` i `sitemap.xml`
mot `git log`-datumet för varje HTML-sida. Körs sviten före committen är
git-datumet det gamla och testet blir grönt på fel grund. Se
`CLAUDE.md` → Core Rules.

```bash
node tests/frontend/run-all.mjs
node tests/per/per-registry.test.mjs
node tests/api/per-pulse.test.mjs
```

Förväntat: samma filer gröna som på `main` innan grenen började, plus de nya.
`per-visual.mjs` flaggar olika vyer mellan körningar — jämför mot en körning på
orörd `origin/main` innan du kallar den ett fel.

`per.html` läggs **inte** till i `sitemap.xml` — sidan är olistad. Faller
`sitemap-lastmod.test.mjs` på `per.html` betyder det att någon lagt in den
där; ta bort raden i stället för att ändra testet.

- [ ] **Steg 4: Öppna PR**

```bash
git push -u origin feat/per-minnessida
gh pr create --title "feat(per): privat sida för P.E.R:s register och puls" --body "Del A av docs/superpowers/specs/2026-08-25-per-minnessida-design.md"
```
