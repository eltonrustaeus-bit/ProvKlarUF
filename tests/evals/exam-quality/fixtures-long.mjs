// Long-form eval fixtures — the same six subjects as fixtures.mjs, but at the
// length and density of real pasted lesson notes (roughly 5-8x the short set).
//
// Why this set exists: the short fixtures are compressed summaries, and a
// compressed summary gives the generator fewer concrete details to build
// questions from, which plausibly inflates the error rate. This set holds
// everything else constant — same course names, same expected profiles, same
// runner — so the only variable is how much material the student pasted.
//
// Every fact below is checked. If the material itself were wrong the eval would
// be measuring the fixture author's mistakes rather than the model's.
//
// Select with FIXTURE_SET=long.

export const FIXTURES = [
  {
    id: "matematik-2b",
    course: "Matematik 2b",
    level: "C",
    expectProfile: "mathematics",
    expectMath: true,
    material: `ANTECKNINGAR — Matematik 2b, kapitel 3: Andragradsekvationer

1. GRUNDFORM
En andragradsekvation har formen ax² + bx + c = 0 där a ≠ 0.
Om a = 1 kallas den normerad och skrivs x² + px + q = 0.
En ekvation med a ≠ 1 kan alltid normeras genom division med a.
Exempel: 2x² - 10x + 12 = 0 blir x² - 5x + 6 = 0 efter division med 2.

2. NOLLPRODUKTMETODEN
Om en produkt av två faktorer är noll måste minst en faktor vara noll.
x(x - 4) = 0 ger x = 0 eller x = 4.
(x - 2)(x - 3) = 0 ger x = 2 eller x = 3.
Metoden kräver att ekvationen är faktoriserad och att högerledet är noll.
Vanligt fel: att dela bort x ur x² = 4x. Då tappar man lösningen x = 0.
Rätt: x² - 4x = 0, x(x - 4) = 0, x = 0 eller x = 4.

3. PQ-FORMELN
För x² + px + q = 0 gäller
    x = -p/2 ± √((p/2)² - q)

Exempel A: x² - 6x + 8 = 0. Här är p = -6 och q = 8.
x = 3 ± √(9 - 8) = 3 ± 1, alltså x = 2 eller x = 4.

Exempel B: x² + 4x - 5 = 0. Här är p = 4 och q = -5.
x = -2 ± √(4 + 5) = -2 ± 3, alltså x = 1 eller x = -5.

Exempel C: x² - 4x + 4 = 0. Här är p = -4 och q = 4.
x = 2 ± √(4 - 4) = 2 ± 0, alltså x = 2 (dubbelrot).

4. DISKRIMINANTEN
Uttrycket under rottecknet, (p/2)² - q, kallas diskriminanten och avgör antalet
reella lösningar:
  - Diskriminanten > 0: två olika reella lösningar
  - Diskriminanten = 0: exakt en reell lösning (dubbelrot)
  - Diskriminanten < 0: ingen reell lösning
Observera att diskriminantens tecken beror på BÅDE p och q. Att p = 0 räcker
inte för att avgöra något: x² + 1 = 0 har ingen reell lösning medan x² - 1 = 0
har två.

5. SAMBAND MELLAN RÖTTER OCH KOEFFICIENTER
För x² + px + q = 0 med rötterna x₁ och x₂ gäller
    x₁ + x₂ = -p
    x₁ · x₂ = q
Exempel: rötterna 2 och -4 ger summan -2, alltså -p = -2 och p = 2.
Produkten är -8, alltså q = -8. Ekvationen blir x² + 2x - 8 = 0.
Kontroll med pq-formeln: x = -1 ± √(1 + 8) = -1 ± 3 ger 2 och -4. Stämmer.

6. KVADRATKOMPLETTERING
Man lägger till och drar ifrån samma tal för att skapa en kvadrat.
x² + 6x = x² + 6x + 9 - 9 = (x + 3)² - 9
x² - 10x + 7 = (x - 5)² - 25 + 7 = (x - 5)² - 18
Regeln: halva koefficienten framför x, kvadrerad.
Metoden används för att lösa ekvationer och för att hitta en parabels
extrempunkt.

7. PARABLER
Grafen till y = ax² + bx + c är en parabel.
Om a > 0 vänder den uppåt och extrempunkten är ett minimum.
Om a < 0 vänder den nedåt och extrempunkten är ett maximum.
Symmetrilinjen ligger vid x = -p/2 för normerad form.
Nollställena är precis ekvationens lösningar, alltså där grafen skär x-axeln.
En parabel utan reella nollställen skär inte x-axeln alls.

Exempel: y = x² - 6x + 8 har nollställena 2 och 4, symmetrilinje x = 3, och
minimipunkten (3, -1) eftersom y(3) = 9 - 18 + 8 = -1.

8. TILLÄMPNINGAR
Rektangel: omkretsen är 26 cm och arean 40 cm². Sätt sidorna till x och 13 - x
eftersom halva omkretsen är 13. Då gäller x(13 - x) = 40, alltså
x² - 13x + 40 = 0 med lösningarna x = 5 och x = 8. Sidorna är 5 cm och 8 cm.

Kast: höjden ges av h(t) = -5t² + 20t. Marknivå betyder h = 0, alltså
-5t(t - 4) = 0, det vill säga t = 0 eller t = 4 sekunder. Högsta punkten ligger
mitt emellan, vid t = 2, och är h(2) = -20 + 40 = 20 meter.

Ekonomi: intäkten I(x) = x(100 - 2x) där x är antalet sålda enheter i tusental.
I(x) = 0 ger x = 0 eller x = 50.

9. VANLIGA FEL PÅ PROV
- Att glömma ± i pq-formeln och bara ange ena roten.
- Teckenfel i p: i x² - 6x + 8 är p = -6, inte 6.
- Att blanda ihop p och q.
- Att svara med x-värdet när frågan efterfrågar en y-koordinat.
- Att dela bort x och tappa en lösning.`,
  },
  {
    id: "historia-1b",
    course: "Historia 1b",
    level: "C",
    expectProfile: "social_sciences",
    expectMath: false,
    material: `ANTECKNINGAR — Historia 1b: Franska revolutionen 1789-1799

BAKGRUND OCH ORSAKER

Ståndssamhället. Frankrike var indelat i tre stånd. Första ståndet var
prästerskapet, andra ståndet adeln, och tredje ståndet allt övrigt — bönder,
arbetare och den växande borgarklassen. Tredje ståndet utgjorde omkring 97
procent av befolkningen men bar i praktiken hela skattebördan, eftersom de två
första stånden var i stort sett befriade från skatt.

Ekonomin. Statsfinanserna var svårt ansträngda. Frankrike hade lånat stort för
att stödja de amerikanska kolonierna i frihetskriget mot Storbritannien.
Missväxten 1788 drev upp brödpriserna kraftigt, och bröd utgjorde huvuddelen av
en arbetarfamiljs utgifter.

Idéerna. Upplysningen hade spridit tankar om folksuveränitet och maktdelning.
Montesquieu argumenterade för att den lagstiftande, verkställande och dömande
makten skulle skiljas åt. Rousseau skrev om samhällsfördraget och att makten
utgår från folket.

FÖRLOPPET

Generalständerna. Ludvig XVI kallade in generalständerna i maj 1789, för första
gången sedan 1614. Tvisten gällde omröstningsformen: varje stånd hade en röst,
vilket gav de två privilegierade stånden majoritet. Tredje ståndet krävde
omröstning per huvud.

Nationalförsamlingen. I juni 1789 utropade sig tredje ståndet till
nationalförsamling. När de utestängdes från sin möteslokal samlades de i en
bollhusbana och avlade bollhuseden — löftet att inte skiljas åt förrän Frankrike
fått en författning. Detta skedde alltså FÖRE stormningen av Bastiljen.

Bastiljen. Den 14 juli 1789 stormades fästningen Bastiljen i Paris. Den hölls av
en liten garnison och innehöll vid tillfället bara sju fångar. Betydelsen var
symbolisk: Bastiljen stod för kungens godtyckliga makt. Datumet är i dag
Frankrikes nationaldag.

Augusti 1789. Adelns privilegier avskaffades natten mot den 4 augusti. Senare
samma månad antogs deklarationen om människans och medborgarens rättigheter,
som slog fast att människor föds fria och lika i rättigheter.

Kvinnotåget. I oktober 1789 marscherade tusentals kvinnor från Paris till
Versailles och tvingade kungafamiljen att flytta till Paris.

Flykten till Varennes. I juni 1791 försökte kungafamiljen fly landet men greps i
Varennes. Förtroendet för kungen raserades.

Republiken. Monarkin avskaffades i september 1792 och Frankrike blev republik.
Ludvig XVI avrättades i januari 1793.

Skräckväldet. Åren 1793-1794 styrde välfärdsutskottet med Robespierre som
ledande gestalt. Tiotusentals avrättades, många i giljotinen. Skräckväldet
slutade i juli 1794 när Robespierre själv avrättades.

Direktoriet och Napoleon. Efter skräckväldet styrde direktoriet från 1795.
Napoleon Bonaparte tog makten genom statskuppen i november 1799 och kröntes till
kejsare 1804.

KONSEKVENSER

Ståndssamhället avskaffades och privilegier knutna till börd upphörde.
Idéerna om folksuveränitet och medborgerliga rättigheter spreds i Europa.
Det moderna nationsbegreppet växte fram: staten sågs som folkets, inte kungens.
Metersystemet infördes.
Revolutionen inspirerade senare frihetsrörelser men följdes också av krig som
drabbade hela kontinenten.

BEGREPP ATT KUNNA

Stånd — juridiskt avgränsad samhällsgrupp med egna rättigheter och skyldigheter.
Folksuveränitet — läran att den politiska makten utgår från folket.
Konstitutionell monarki — monarki där kungens makt begränsas av en författning.
Republik — statsskick utan monark, där statschefen utses.
Giljotin — avrättningsredskap, infört delvis som en likhetsreform eftersom alla
skulle avrättas på samma sätt oavsett stånd.

KÄLLKRITIK PÅ DEN HÄR PERIODEN

Mycket av samtidsmaterialet är propaganda från någon av sidorna. Fråga alltid
vem som skrivit, när, och i vilket syfte. Memoarer skrivna långt efteråt är
tendentiösa och påverkade av hur det gick.`,
  },
  {
    id: "biologi-1",
    course: "Biologi 1",
    level: "C",
    expectProfile: "natural_sciences",
    expectMath: false,
    material: `ANTECKNINGAR — Biologi 1: Cellens energiomsättning

FOTOSYNTES

Var: i kloroplasterna hos växter, alger och cyanobakterier.
Summaformel: 6 CO₂ + 6 H₂O + ljusenergi → C₆H₁₂O₆ + 6 O₂

Ljusreaktionerna sker i tylakoidmembranen. Klorofyll absorberar ljus, framför
allt i det röda och blå området, medan grönt ljus reflekteras — därav färgen.
Vatten spjälkas, syrgas frigörs som restprodukt, och ATP samt NADPH bildas.

Calvincykeln sker i stromat och kallas också de ljusoberoende reaktionerna. Här
byggs socker av koldioxid med hjälp av ATP och NADPH från ljusreaktionerna.
Enzymet rubisco fixerar koldioxiden.

Begränsande faktorer: ljusintensitet, koldioxidhalt och temperatur. Den faktor
som är i minst mängd begränsar hela processen.

CELLANDNING

Var: i cytoplasman och mitokondrierna.
Summaformel: C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O + energi

Cellandningen är i princip fotosyntesen baklänges, men delstegen är helt olika
och sker med andra enzymer.

Steg 1 — glykolysen. Sker i cytoplasman och kräver inget syre. En glukosmolekyl
(6 kol) spjälkas till två pyruvat (3 kol vardera). Nettovinst: 2 ATP och 2 NADH.

Steg 2 — citronsyracykeln. Sker i mitokondriematrix. Pyruvat omvandlas först
till acetyl-CoA, varvid koldioxid avges. Cykeln producerar NADH, FADH₂ och en
liten mängd ATP direkt.

Steg 3 — elektrontransportkedjan. Sker i det inre mitokondriemembranet. NADH och
FADH₂ lämnar sina elektroner, vilket driver protoner ut ur matrix och bygger upp
en protongradient. Protonerna strömmar tillbaka genom ATP-syntas, som bildar ATP.
Syre är den slutliga elektronmottagaren och bildar vatten. Utan syre stannar hela
kedjan.

Utbyte: glykolysen ger netto 2 ATP. Fullständig aerob nedbrytning av en
glukosmolekyl ger ungefär 30-32 ATP totalt. Den absolut största delen bildas i
elektrontransportkedjan.

JÄSNING

Vid syrebrist kan cellen bara använda glykolysen, som ger 2 ATP.
Mjölksyrajäsning sker i muskelceller vid hård ansträngning: pyruvat blir
mjölksyra. Alkoholjäsning hos jäst och vissa bakterier: pyruvat blir etanol och
koldioxid. Jäsningens funktion är att återbilda NAD⁺ så att glykolysen kan
fortsätta.

ENZYMER

Enzymer är proteiner som fungerar som katalysatorer. De sänker
aktiveringsenergin och förbrukas inte själva i reaktionen.
Substratet binder till enzymets aktiva säte. Specificiteten brukar beskrivas med
nyckel-och-lås-modellen, numera oftare som inducerad passform.

Temperatur: aktiviteten ökar med temperaturen upp till en optimumpunkt. Över den
denatureras enzymet — den tredimensionella strukturen förstörs och funktionen
går förlorad. Denaturering är i regel irreversibel.
pH: varje enzym har ett optimalt pH. Pepsin i magsäcken arbetar vid pH omkring 2,
medan de flesta enzymer i cellen fungerar nära neutralt pH.

CELLENS DELAR SOM HÖR TILL DETTA

Mitokondrie — cellandning. Har eget DNA och dubbelmembran.
Kloroplast — fotosyntes. Har också eget DNA och dubbelmembran.
Endosymbiontteorin förklarar båda: de antas härstamma från bakterier som togs upp
av en värdcell.
Cellmembranet — reglerar transport in och ut.
Ribosomer — proteinsyntes.

SAMBANDET I EKOSYSTEMET

Fotosyntesen binder solenergi i kemisk form och producerar syre.
Cellandningen frigör energin igen och producerar koldioxid.
Alla organismer, även växter, utför cellandning. Växter utför både och: under
dagen överstiger fotosyntesen cellandningen, under natten sker bara cellandning.
Kolets kretslopp drivs av dessa två processer tillsammans med nedbrytare.`,
  },
  {
    id: "engelska-6",
    course: "Engelska 6",
    level: "C",
    expectProfile: "languages",
    expectMath: false,
    material: `NOTES — English 6: Conditionals, reported speech and idiomatic language

1. THE CONDITIONALS

Zero conditional — general truths and scientific facts.
Form: If + present simple, present simple.
If you heat water to 100 °C, it boils.
If people don't eat, they get hungry.

First conditional — a real and likely future possibility.
Form: If + present simple, will + infinitive.
If it rains tomorrow, we will cancel the trip.
If she studies, she will pass the exam.
Note: "will" is not used in the if-clause in standard written English.

Second conditional — hypothetical or unlikely present or future.
Form: If + past simple, would + infinitive.
If I had more time, I would learn Japanese.
If I were you, I would apologise. ("were" for all persons in formal usage.)

Third conditional — an unreal past, something that did not happen.
Form: If + past perfect, would have + past participle.
If she had studied, she would have passed.
If we had left earlier, we would not have missed the train.

Mixed conditional — past condition with a present result.
If I had taken that job, I would be living in Berlin now.

2. REPORTED SPEECH

The tense normally shifts back one step ("backshift"):
  present simple → past simple:      "I am tired" → He said he was tired.
  present continuous → past continuous: "I am working" → She said she was working.
  present perfect → past perfect:    "I have finished" → She said she had finished.
  past simple → past perfect:        "I saw him" → He said he had seen him.
  will → would:                      "I will call you" → They said they would call me.
  can → could:                       "I can swim" → He said he could swim.
  must → had to:                     "I must go" → She said she had to go.

Time and place expressions shift as well:
  now → then
  today → that day
  tomorrow → the next day / the following day
  yesterday → the day before / the previous day
  here → there
  this → that

Questions become statements in word order:
  "Where do you live?" → She asked where I lived. (not "where did I live")
  Yes/no questions take if or whether: "Are you coming?" → He asked if I was coming.

No backshift is needed when the statement is still true, or when reporting
something universal: "Water boils at 100 °C" → He said water boils at 100 °C.

3. IDIOMS

  to bite the bullet — to face something unpleasant with courage
  to let the cat out of the bag — to reveal a secret by accident
  once in a blue moon — very rarely
  to be on the fence — to be undecided
  to cut corners — to do something badly in order to save time or money
  to hit the nail on the head — to describe exactly what is causing a problem
  to get cold feet — to become nervous and change your mind
  the ball is in your court — it is your turn to act
  to beat around the bush — to avoid saying something directly
  a blessing in disguise — something that seems bad but turns out to be good

4. COMMONLY CONFUSED STRUCTURES

used to + infinitive — a past habit that has stopped.
  I used to smoke, but I quit five years ago.
be used to + -ing — to be accustomed to something.
  I am used to working late.
get used to + -ing — the process of becoming accustomed.
  It took a month to get used to living abroad.

Since vs for: since + a point in time (since 2019), for + a period (for three years).

Few vs a few: "few friends" suggests almost none, "a few friends" suggests some.
The same distinction holds for little and a little with uncountable nouns.

5. REGISTER

Formal writing avoids contractions, phrasal verbs and idioms.
"The meeting was postponed" is more formal than "They put the meeting off".
Academic English prefers the passive when the agent is unimportant or obvious.`,
  },
  {
    id: "programmering-1",
    course: "Programmering 1",
    level: "C",
    expectProfile: "programming",
    expectMath: false,
    material: `ANTECKNINGAR — Programmering 1: Python, grunder

1. VARIABLER OCH DATATYPER

int — heltal, till exempel 5
float — decimaltal, till exempel 5.0 eller 2.5
str — text, "hej"
bool — True eller False
Python är dynamiskt typat: variabelns typ bestäms av värdet och kan ändras.
type(x) ger typen. int("5") ger heltalet 5, str(5) ger texten "5".

Heltalsdivision och vanlig division skiljer sig:
    7 / 2   ger 3.5   (float)
    7 // 2  ger 3     (heltalsdivision, avrundar nedåt)
    7 % 2   ger 1     (rest)

2. LISTOR

Listor är nollindexerade.
    tal = [10, 20, 30, 40]
    tal[0]   ger 10
    tal[3]   ger 40
    tal[-1]  ger 40  (sista elementet)
    tal[-2]  ger 30
    len(tal) ger 4
Att skriva tal[4] ger IndexError eftersom sista giltiga index är 3.

Slicing: startindex inkluderas, slutindex exkluderas.
    tal[1:3]  ger [20, 30]
    tal[:2]   ger [10, 20]
    tal[2:]   ger [30, 40]
    tal[:]    ger en kopia av hela listan

Listmetoder:
    append(v)     lägger till v sist
    insert(i, v)  lägger in v på plats i
    pop()         tar bort och returnerar sista elementet
    pop(i)        tar bort och returnerar elementet på plats i
    remove(v)     tar bort FÖRSTA förekomsten av värdet v
    sort()        sorterar listan på plats och returnerar None
    reverse()     vänder listan på plats
sorted(lista) returnerar en NY sorterad lista och lämnar originalet orört.

3. LOOPAR

for-loop över en lista:
    for t in tal:
        print(t)

range: range(5) ger 0, 1, 2, 3, 4 — alltså fem värden som börjar på noll.
range(2, 6) ger 2, 3, 4, 5.
range(0, 10, 2) ger 0, 2, 4, 6, 8.
range(5) innehåller INTE talet 5.

while-loop körs så länge villkoret är sant:
    i = 0
    while i < 3:
        print(i)
        i = i + 1
Glömmer man att förändra loopvariabeln blir det en oändlig loop.

break avbryter loopen helt. continue hoppar till nästa varv.

4. VILLKOR

    if x > 10:
        print("stort")
    elif x == 10:
        print("exakt tio")
    else:
        print("litet")

Jämförelseoperatorer: ==, !=, <, >, <=, >=
Logiska operatorer: and, or, not
Vanligt fel: att blanda ihop = (tilldelning) med == (jämförelse).

5. FUNKTIONER

    def dubbla(x):
        return x * 2

    print(dubbla(4))   ger 8

En funktion utan return returnerar None.
Parametrar kan ha standardvärden:
    def hälsa(namn, hälsning="Hej"):
        return hälsning + " " + namn
Anropet hälsa("Anna") ger "Hej Anna".

Lokala variabler finns bara inuti funktionen. En variabel som skapas i en
funktion syns inte utanför den.

6. STRÄNGAR

    s = "Programmering"
    len(s)        ger 13
    s[0]          ger "P"
    s.upper()     ger "PROGRAMMERING"
    s.lower()     ger "programmering"
    s.replace("m", "M")  returnerar en NY sträng
Strängar är oföränderliga: s[0] = "X" ger TypeError.
f-strängar: f"Talet är {x}" sätter in variabelns värde.

7. VANLIGA FEL

IndexError — index utanför listans längd.
TypeError — fel typ, till exempel "5" + 5.
NameError — variabel som inte finns.
IndentationError — fel indentering. Python använder indentering för att avgöra
vilka rader som hör till ett block, till skillnad från språk som använder klamrar.
ZeroDivisionError — division med noll.

8. GOD KODSTIL

Beskrivande variabelnamn: antal_elever, inte a.
Funktioner ska göra en sak.
Kommentarer förklarar varför, inte vad.
Undvik magiska tal — namnge dem som konstanter.`,
  },
  {
    id: "entreprenorskap",
    course: "Entreprenörskap",
    level: "C",
    expectProfile: "generic",
    expectMath: false,
    material: `ANTECKNINGAR — Entreprenörskap: affärsidé, företagsformer och kalkyl

1. AFFÄRSIDÉN

En affärsidé beskriver vad företaget erbjuder, till vem, och varför kunden ska
välja just detta. En bra affärsidé svarar mot ett verkligt kundbehov och går att
formulera på en mening.

Tre delar att alltid ha med:
  Kundgrupp — vem har problemet?
  Erbjudande — vad löser vi, och hur?
  Särskiljning — varför oss och inte konkurrenten?

Vanligt misstag: att beskriva produkten i stället för kundnyttan.

2. FÖRETAGSFORMER I SVERIGE

Enskild firma. Ägaren och företaget är samma juridiska person. Ägaren har
personligt och obegränsat ansvar för företagets skulder. Inget krav på
startkapital. Enkel administration. Passar små verksamheter med låg risk.

Handelsbolag. Två eller flera delägare. Delägarna är solidariskt ansvariga,
vilket betyder att en borgenär kan kräva hela skulden av vilken delägare som
helst. Företaget är en juridisk person men ansvaret är ändå personligt.

Kommanditbolag. En variant av handelsbolag där minst en delägare
(komplementären) har obegränsat ansvar medan övriga (kommanditdelägarna) bara
ansvarar med sin insats.

Aktiebolag. En egen juridisk person, skild från ägarna. Kräver aktiekapital.
Ägarnas ansvar är normalt begränsat till det insatta kapitalet. Mer omfattande
regler kring bokföring, årsredovisning och styrelse.

Ekonomisk förening. Medlemsstyrd, används ofta för kooperativ verksamhet.

UF-företag. En skolform av företagande som drivs under ett läsår inom Ung
Företagsamhet. Det är inte en juridisk företagsform i egentlig mening — UF-
företaget registreras hos Ung Företagsamhet och avvecklas när läsåret är slut.

3. BUDGET OCH KALKYL

Resultatbudget visar förväntade intäkter och kostnader under en period och
svarar på frågan om verksamheten går med vinst.

Likviditetsbudget visar in- och utbetalningar över tid och svarar på om pengarna
räcker just den månaden. Ett företag kan vara lönsamt och ändå gå omkull av
likviditetsbrist, till exempel om kunderna betalar sent.

Fasta kostnader är oberoende av produktionsvolymen: hyra, försäkring,
abonnemang.
Rörliga kostnader ökar med volymen: material, frakt per enhet.

Täckningsbidrag per styck = försäljningspris per styck minus rörlig kostnad per
styck.
Totalt täckningsbidrag = täckningsbidrag per styck gånger antal sålda enheter.
Resultat = totalt täckningsbidrag minus fasta kostnader.

Nollpunkten (kritisk volym) är den volym där totalt täckningsbidrag exakt täcker
de fasta kostnaderna, alltså där resultatet är noll.
Nollpunktsvolym = fasta kostnader delat med täckningsbidrag per styck.

Räkneexempel: priset är 120 kronor per styck, rörlig kostnad 70 kronor per
styck, fasta kostnader 20 000 kronor.
Täckningsbidraget blir 120 - 70 = 50 kronor per styck.
Nollpunkten blir 20 000 / 50 = 400 enheter.
Vid 600 sålda enheter blir resultatet 600 · 50 - 20 000 = 10 000 kronor.

4. SWOT-ANALYS

SWOT ställer interna och externa faktorer mot varandra.
  Interna: styrkor (strengths) och svagheter (weaknesses)
  Externa: möjligheter (opportunities) och hot (threats)
Analysen omfattar alltså BÅDE interna och externa faktorer — inte bara det ena.
Poängen är att koppla ihop dem: vilken styrka kan utnyttja vilken möjlighet?

5. MARKNADSFÖRING

De fyra P:na: produkt, pris, plats och påverkan.
Målgruppsanalys görs före kanalval, inte efter.
Segmentering delar marknaden i grupper; positionering handlar om vilken plats
företaget vill ta i kundens medvetande.

Prissättningsmetoder:
  Kostnadsbaserad — utgå från kostnaden och lägg på ett påslag.
  Konkurrensbaserad — utgå från vad andra tar.
  Värdebaserad — utgå från vad kunden är beredd att betala för nyttan.

6. FINANSIERING

Eget kapital — ägarnas egna insatta pengar.
Lån — måste betalas tillbaka med ränta.
Bidrag och stipendier — behöver inte återbetalas men är ofta villkorade.
Riskkapital — investeraren går in med pengar mot ägarandel.
Kundfinansiering — kunden betalar i förskott, vilket förbättrar likviditeten.`,
  },
];
