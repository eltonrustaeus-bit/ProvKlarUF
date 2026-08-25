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
      fil: "_per-review.js",
      namn: "Självgranskningen",
      gör: "Läser P.E.R:s färdiga svar innan eleven hinner lita på det, och letar efter faktafel, löst uppgift, röjd hemlighet, räknefel och obelagda påståenden om eleven.",
      ser: "Elevens fråga, det färdiga svaret, begärd hjälpnivå och läroplanen för området. Ingen historik, inget minne.",
      gräns: "Den RÄTTAR aldrig — den flaggar och citerar. En modell som ombeds fixa sitt eget svar skriver om det till något som låter bättre och tappar både felet och spåret av det. Fail open: ett trasigt granskningssvar visar ingen rättelse alls.",
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
    {
      fil: "_per-graph-data.js",
      namn: "Kartans underlag",
      gör: "Bär den färdiguträknade grafen — noder och kanter — som hjärnan ritar. GENERERAD av tools/build-per-graph.mjs, aldrig skriven för hand.",
      ser: "Ingenting vid körning. Innehållet härleddes ur api/ när filen genererades.",
      gräns: "Genereras i stället för att läsas vid körning, eftersom en filläsning i api/admin.js tog ned hela adminpanelen: Vercel laddar rutten som CJS och import.meta är ett syntaxfel där. Ett test faller om filen glidit isär från källan.",
    },
    {
      fil: "_per-brain.js",
      namn: "Hjärnan",
      gör: "Härleder kartan över P.E.R. ur källkoden — vilka moduler som finns och vilka som importerar varandra — och väver ihop den med hur aktiv varje del varit.",
      ser: "Filnamn och filinnehåll i api/, plus rader ur per_module_activity. Ingen elevdata.",
      gräns: "Strukturen hittas aldrig på: en nod finns bara om filen finns, och en kant bara om importen finns. En modul utan mätpunkt får null, aldrig noll — noll betyder mätt och tyst, null betyder inte mätt alls.",
    },
    {
      fil: "_per-pulse.js",
      namn: "Pulsen",
      gör: "Gör rader till summor åt den här sidan: hur många minnen som finns, hur ofta cachen träffar, vad kvoterna använts till.",
      ser: "Rader som api/admin.js redan hämtat — modulen gör själv ingen databasfråga.",
      gräns: "Aggregat, aldrig enskilda elever. Och ett underlag som är för tunt rapporteras som text, inte som en nolla: en träffkvot räknad på fyra sonderingar är brus, och en nolla hade lästs som en mätning.",
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
      nyckel: "per_legal_rag_enabled",
      namn: "Juridikläget i P.E.R.",
      gör: "Öppnar den separata juridikgrenen i api/explain.js, där svaret byggs ur rättskällor.",
      ser: "Frågan, och bara godkända stycken ur pilotkorpuset.",
      gräns: "Inte samma flagga som legal_rag_enabled ovan, trots namnet — den gäller kunskapsmotorn i api/knowledge.js, den här gäller explain.js. Grenen kräver dessutom legalMode:true i anropet, och ingen frontend skickar det än.",
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
      gräns: "Av som default, och kräver att kunskapsmotorn och rättskällorna är på samtidigt — alla tre flaggorna läses i samma anrop. En ifylld allowed_user_ids stänger dessutom grinden för alla utom de uppräknade.",
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
