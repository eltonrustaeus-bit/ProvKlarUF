# Samordning — P.E.R som lärare

Två sessioner arbetar parallellt på samma spec. Den här katalogen är hur de ser
varandra.

**Plan:** `docs/superpowers/plans/2026-08-14-per-som-larare.md`
**Spec:** `docs/superpowers/specs/2026-08-14-per-som-larare-design.md`

---

## Varför det här finns

Sessionerna kör i **olika worktrees på olika grenar**. Ingen av dem kan se den
andras ocommittade arbete, och ingen av dem kan fråga den andra något i realtid.
Utan en delad yta upptäcks en krock först vid merge — när båda redan byggt
klart.

---

## Reglerna

### 1. En fil, en skrivare

| Fil | Vem skriver | Vem läser |
|---|---|---|
| `spar-a.md` | **bara** spår A | båda |
| `spar-b.md` | **bara** spår B | båda |
| `README.md` | ingen (den här filen är låst) | båda |

Ingen session redigerar någonsin den andras fil. Konflikter blir därför inte
"sällsynta" — de blir **omöjliga**, eftersom två skrivare aldrig rör samma rad.

Det är samma princip som driftspärren i `tests/frontend/_harness.test.mjs`:
gör det felaktiga omöjligt i stället för att be någon vara försiktig.

### 2. En fil, en ägare — även i koden

| Spår | Äger | Rör aldrig |
|---|---|---|
| **A — server** | `api/_per-core.js`, `api/explain.js`, `api/_per-memory.js`, `tests/api/**` | `shared.js`, `js/**` |
| **B — klient** | `shared.js`, `js/exam-flow.js`, `tests/frontend/**` | `api/**` |

Behöver du en ändring i den andras fil: **be om den** under `## Frågor till
andra spåret`. Skriv den inte själv, inte ens om den är liten. En liten ändring
i någon annans fil är hur två grenar tyst börjar dra isär.

### 3. KONTRAKTET ändras aldrig ensidigt

Fälten `helpLevel`, `clarifyReply`, `helpCap`, `helpLevelUsed`, `state.phase`
och markören `[CLARIFY:a|b]` är låsta i planen.

Vill du ändra ett av dem: skriv förslaget under `## Frågor till andra spåret`,
**fortsätt med något annat**, och låt Elton avgöra. Bygg inte vidare på ett
kontrakt du ändrat själv.

### 4. Läs innan du börjar

Före varje ny uppgift:

```bash
git fetch origin coord/per-pedagogik
git show origin/coord/per-pedagogik:docs/coordination/per-pedagogik/spar-a.md   # eller -b
```

### 5. Skriv efter varje uppgift

```bash
# bara din egen fil
git add docs/coordination/per-pedagogik/spar-X.md
git commit -m "coord(X): <en rad om vad som hände>"
git push origin HEAD:coord/per-pedagogik
```

Filerna är disjunkta, så `push` går igenom utan rebase. Skulle det ändå klaga:
`git pull --rebase origin coord/per-pedagogik` och pusha om.

### 6. Ser du något bättre — säg det, ändra inte

Tycker du att det andra spåret valt fel: skriv observationen i **din** fil under
`## Observationer om andra spåret`, med rad och skäl. Gå inte in och rätta.

Är ni oense: båda skriver sin position i sin egen fil och **Elton avgör**. Ingen
av er "vinner" genom att committa först.

### 7. Statusrader ska gå att lita på

`## Klart` betyder testat och committat. Inte "nästan". Det andra spåret
planerar utifrån den raden.

---

## Om det ändå krockar

Sker en merge-konflikt i produktionskod har någon brutit regel 2. Laga inte
konflikten tyst — skriv i din fil vad som hände, så att regeln kan justeras i
stället för att brytas igen.
