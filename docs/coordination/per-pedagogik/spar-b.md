# Spår B — klient

**Skrivs bara av spår B.** Läses av båda. Se `README.md` för reglerna.

Ägda filer: `shared.js`, `js/exam-flow.js`, `tests/frontend/**`

Gren: `feat/per-klient` (worktree `.claude/worktrees/per-klient`)

---

## Status

B1–B5 klara. Hela frontend-sviten grön: **21/21 filer, 0 fel** (545 s).

## Klart

_(testat och committat — det andra spåret planerar utifrån den här listan)_

- **B1 — `state.phase` i manifestet.** `1171809`
  `js/exam-flow.js:publish()` skickar `phase: "exam"`. `stepResult()` publicerar
  `{ page: "resultat", state: { phase: "result" } }`. `shared.js` godtar bara de
  två värdena; en okänd sträng faller igenom som saknad.
  `tests/frontend/per-exam-context.test.mjs`: 37 ok.

- **B2 — klienten skickar nivån.** `61b156b`
  `helpLevel` (heltal 0–3) och `clarifyReply` (sträng eller `null`) ligger i
  kroppen till `/api/explain`, i både SSE- och JSON-grenen. Nivån hålls per
  fråga och nollställs när fokus byts.

- **B3 — stegknapparna.** `61b156b`
  Rad under svaret, byggd som `.per-chips`. Etiketter enligt planen:
  `Förklara begreppet` (1), `Visa metoden` (2), `Ge mig svaret` (3). Ett klick
  skriver etiketten som ett elevmeddelande i loggen och skickar den nivån.

- **B4 — taket syns.** `61b156b`
  Steg över `helpCap` ritas låsta (`disabled`, dämpade, kvar på skärmen), aldrig
  gömda. Taket kommer uteslutande ur svaret.

- **B5 — klargörandets knappar.** `61b156b`
  `[CLARIFY:a|b]` parsas där `[GOTO:]` redan parsas, markören tas bort ur den
  synliga texten, två knappar ritas, och ett klick skickar **samma**
  `userQuestion` igen med `clarifyReply` satt.
  `tests/frontend/per-ladder.test.mjs` (ny): 28 ok.

Muteringskontrollerat, alla fem: nivån ur kroppen fäller 7, ignorerat tak fäller
4, ostädad `[CLARIFY:]` fäller 1, saknad `phase`-kopiering fäller 6.

## Pågår

Inget. Spår B är klart mot planen.

## Frågor till andra spåret

1. **`helpCap` måste ligga i BÅDA svarsgrenarna.** Klienten läser `ev.helpCap`
   på SSE-eventet med `done: true`, och `data.helpCap` i JSON-svaret. Saknas
   fältet ritas alla steg öppna — servern klämmer ändå, så spärren håller, men
   eleven får se ett tak som inte stämmer. Planens A2 steg 3 säger båda; det här
   är bara en kvittens på att klienten verkligen kräver båda.

2. **`clarifyReply` skickas alltid, som `null` när den saknas** — inte som ett
   utelämnat fält. Behandla `null` som "inget klargörande gjort".

3. **`helpLevelUsed` läses inte av klienten.** Gränssnittet ritar ur `helpCap`
   och sin egen begärda nivå. Skicka gärna fältet ändå — men om A tänkt sig att
   klienten skulle rita ur `helpLevelUsed` i stället, säg till, för då är vi
   oense om vad raden visar.

## Observationer om andra spåret

_(ser du något bättre: skriv det här med rad och skäl, ändra inte)_

- **`helpCapFor()` returnerar 3 på resultatskärmen via fel gren.** Planens
  utkast (A2 steg 3) kollar `if (!q || !q.text) return 3;` **före**
  `if (phase === "result") return 3;`. `closeExam()` i `js/exam-flow.js`
  nollställer manifestet vid inlämning, så på resultatskärmen finns ingen
  `currentQuestion` alls — första grenen träffar, och `phase === "result"`
  hinner aldrig läsas.

  Svaret blir rätt (3 endera vägen), så det är ingen bugg idag. Men taket sätts
  då av att en fråga *saknas*, inte av att provet är *inlämnat*, och de två är
  inte samma sak. Skulle någon senare låta resultatskärmen bära en fråga igen —
  t.ex. "förklara fråga 4 som du fick fel på" i felgenomgången, vilket etapp 4
  pekar mot — faller taket tyst till 2 på en elev som redan lämnat in.

  Förslag, inte ändring: läs `phase === "result"` först. Jag har inte rört
  `api/`. B publicerar `phase: "result"` på resultatskärmen redan nu, så
  signalen finns där att läsa.

## Antaganden jag gjort

- **Stegen ritas bara när P.E.R har en fråga i fokus** (`_perManifest.focus`).
  "Ge mig svaret" under ett svar om prisplanerna är inte en hjälpnivå, bara en
  knapp som ser ut som en. Följden: ingen stege på resultatskärmen, där fokus är
  nollställt. Om etapp 4:s felgenomgång ska ha stegen får det villkoret
  omprövas.

- **Ingen stege medan ett klargörande väntar på svar.** Att erbjuda mer hjälp
  innan P.E.R svarat ber eleven eskalera något som inte sagts än.

- **Ingen stege i landningsläget** (utloggad, 2 gratisfrågor). Den vägen har
  redan sin egen fortsättning i `addAnswerCTA`.

- **Nivån nollställs vid frågebyte, inte vid ny fritextfråga.** Skriver eleven
  en ny fråga om *samma* uppgift behålls nivån — hen har redan eskalerat en
  gång, och att tvinga tillbaka till 0 hade läst som att systemet glömde.

- **`clarifyReply` höjer inte nivån.** Ett klargörande är samma fråga en gång
  till, inte mer hjälp.

- **T9c i `per-exam-context.test.mjs` skärptes i stället för att tas bort.**
  Den krävde tidigare att `examState` var helt borta på resultatskärmen. Med
  `phase` måste objektet finnas — annars läser servern "vet inte" och taket
  fastnar på 2 för en elev som redan lämnat in. Nya kravet: `examState` får bara
  bära `phase`, aldrig gamla provsiffror. Det var det T9 egentligen fanns för.
