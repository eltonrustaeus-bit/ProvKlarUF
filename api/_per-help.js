// api/_per-help.js — hur mycket hjälp P.E.R får ge, avgjort på servern.
//
// `_`-prefixet betyder hjälpare, inte rutt. Vercel Hobby-taket på 12 rutter är
// orört (se API-tabellen i CLAUDE.md).
//
// VARFÖR EN EGEN FIL
// Taket hörde logiskt hemma i api/explain.js, men den filen skapar en
// Supabase-klient på modulnivå och kastar "supabaseUrl is required" vid import
// utan env. Ett tak som bara går att köra med en riktig databas bakom sig är
// ett tak ingen testar — och det här är den enda kod som står mellan en elev
// och facit mitt i ett prov.
//
// VARFÖR SERVERN
// helpLevel från klienten är ett önskemål, inte ett beslut. Att låta klienten
// avgöra vore att låta den part som har intresse av att kringgå spärren
// bestämma om den gäller.
//
// Kontrakt och hela taktabellen: tests/per/per-pedagogy.test.mjs (C1-C9) och
// docs/superpowers/specs/2026-08-14-per-som-larare-design.md.

/** Högsta hjälpnivå som får ges i den här sidkontexten.
 *
 *  0 motfråga · 1 begreppet · 2 metoden steg för steg · 3 fullständig lösning
 *
 *  | Läge                          | Tak |
 *  |-------------------------------|-----|
 *  | prov pågår, inget försök      |  1  |
 *  | prov pågår, försök gjort      |  2  |
 *  | efter inlämning               |  3  |
 *  | ingen provkontext             |  3  |
 *  | phase saknas, provkontext finns| 2  |
 *
 *  Sista raden är avsiktlig: en äldre klient som ännu inte lärt sig skicka
 *  phase ska inte kunna få facit av misstag. Saknas information gäller den
 *  tolkning som skyddar eleven — samma princip som spärren själv.
 */
export function helpCapFor(pageContext) {
  const q = pageContext && pageContext.currentQuestion;

  // Ingen provfråga i sikte — eleven pluggar fritt, inget att skydda.
  // Kravet på en icke-tom text är inte kosmetiskt: ett tomt frågeobjekt är
  // inte ett prov, och att behandla det som ett hade låst hjälpen på sidor
  // som inte har med prov att göra.
  if (!q || typeof q.text !== "string" || !q.text.trim()) return 3;

  // Jämförelsen kräver en riktig sträng. En klient som skickar ett objekt med
  // toString() === "result" ska inte kunna öppna facit; === mot en sträng ger
  // false för allt som inte ÄR strängen.
  const phase = pageContext.examState && pageContext.examState.phase;
  if (phase === "result") return 3;

  // Strikt true. "true" som sträng, 1, eller ett sanningsvärde som råkar vara
  // sant räknas inte som ett äkta försök — annars sänker en slarvig klient
  // skyddet utan att någon märker det.
  if (phase === "exam" && q.answered !== true) return 1;

  // Provet pågår, eller så vet vi inte vilket läge klienten är i.
  return 2;
}
