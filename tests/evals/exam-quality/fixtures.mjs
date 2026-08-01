// Eval fixtures — one per subject profile in api/_assessment.js, so every
// overlay and every verifier hint is exercised. The material is deliberately
// short (a realistic amount of pasted lesson notes) and written for this
// repository; it is not copied from any textbook.
//
// `expectProfile` is asserted by the runner: if detectSubjectProfile() stops
// routing a fixture to its subject, the eval says so instead of silently
// measuring the generic path.

export const FIXTURES = [
  {
    id: "matematik-2b",
    course: "Matematik 2b",
    level: "C",
    expectProfile: "mathematics",
    expectMath: true,
    material: `Andragradsekvationer.
En andragradsekvation skrivs på formen ax² + bx + c = 0 där a ≠ 0.

Nollproduktmetoden: om produkten av två faktorer är noll måste minst en faktor
vara noll. x(x - 4) = 0 ger x = 0 eller x = 4.

pq-formeln används när ekvationen är skriven som x² + px + q = 0:
x = -p/2 ± √((p/2)² - q)

Exempel: x² - 6x + 8 = 0 ger p = -6 och q = 8.
x = 3 ± √(9 - 8) = 3 ± 1, alltså x = 2 eller x = 4.

Diskriminanten (p/2)² - q avgör antalet reella lösningar: positiv ger två
lösningar, noll ger en dubbelrot, negativ ger ingen reell lösning.

Kvadratkomplettering: x² + 6x = x² + 6x + 9 - 9 = (x + 3)² - 9.

Tillämpning: en rektangel har omkretsen 26 cm och arean 40 cm². Sätt sidorna
till x och 13 - x. Då gäller x(13 - x) = 40, vilket ger x² - 13x + 40 = 0 med
lösningarna x = 5 och x = 8.`,
  },
  {
    id: "historia-1b",
    course: "Historia 1b",
    level: "C",
    expectProfile: "social_sciences",
    expectMath: false,
    material: `Franska revolutionen.
Bakgrund: Frankrike var på 1780-talet indelat i tre stånd. De två första
stånden, adeln och prästerskapet, var i stort sett befriade från skatt medan
tredje ståndet — omkring 97 procent av befolkningen — bar skattebördan.
Statsfinanserna var ansträngda efter deltagandet i det amerikanska
frihetskriget, och missväxten 1788 drev upp brödpriserna.

Ludvig XVI kallade in generalständerna i maj 1789 för första gången sedan 1614.
Tredje ståndet krävde omröstning per huvud i stället för per stånd, utropade sig
till nationalförsamling och avlade bollhuseden i juni 1789.

Den 14 juli 1789 stormades Bastiljen. I augusti antogs deklarationen om
människans och medborgarens rättigheter.

Skräckväldet 1793–1794 leddes av välfärdsutskottet med Robespierre som
ledande gestalt. Det slutade med Robespierres avrättning i juli 1794.

Napoleon Bonaparte tog makten genom statskuppen i november 1799 och kröntes
till kejsare 1804.

Konsekvenser: ståndssamhället avskaffades, idéerna om folksuveränitet och
medborgerliga rättigheter spreds i Europa, och det moderna nationsbegreppet
växte fram.`,
  },
  {
    id: "biologi-1",
    course: "Biologi 1",
    level: "C",
    expectProfile: "natural_sciences",
    expectMath: false,
    material: `Cellandning och fotosyntes.
Fotosyntesen sker i kloroplasterna hos växter, alger och cyanobakterier.
Summaformel: 6 CO₂ + 6 H₂O + ljusenergi → C₆H₁₂O₆ + 6 O₂.
Ljusreaktionerna sker i tylakoidmembranen och producerar ATP och NADPH.
Calvincykeln sker i stromat och bygger socker av koldioxid.

Cellandningen sker i mitokondrierna och är i princip fotosyntesen baklänges:
C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O + energi.
Den delas i glykolys (i cytoplasman), citronsyracykeln (i mitokondriematrix)
och elektrontransportkedjan (i det inre mitokondriemembranet).

Glykolysen ger en nettovinst på 2 ATP per glukosmolekyl. Fullständig aerob
nedbrytning ger ungefär 30–32 ATP per glukosmolekyl.

Vid syrebrist sker jäsning i stället. Mjölksyrajäsning i muskelceller ger
2 ATP och mjölksyra. Alkoholjäsning hos jäst ger etanol och koldioxid.

Enzymer är proteiner som sänker aktiveringsenergin. Deras aktivitet påverkas
av temperatur och pH; vid för hög temperatur denatureras de.`,
  },
  {
    id: "engelska-6",
    course: "Engelska 6",
    level: "C",
    expectProfile: "languages",
    expectMath: false,
    material: `English grammar: conditionals and reported speech.

Zero conditional — general truths: If you heat water to 100 °C, it boils.
First conditional — likely future: If it rains tomorrow, we will cancel the trip.
Second conditional — hypothetical present: If I had more time, I would learn Japanese.
Third conditional — unreal past: If she had studied, she would have passed.

Reported speech shifts the tense back one step:
"I am tired" → He said he was tired.
"I have finished" → She said she had finished.
"I will call you" → They said they would call me.

Time expressions also shift: now → then, today → that day, tomorrow → the
next day, yesterday → the day before.

Common idioms:
- to bite the bullet — to face something unpleasant with courage
- to let the cat out of the bag — to reveal a secret by accident
- once in a blue moon — very rarely
- to be on the fence — to be undecided

Note the difference between "used to + infinitive" (a past habit that has
stopped) and "be used to + -ing" (to be accustomed to something).`,
  },
  {
    id: "programmering-1",
    course: "Programmering 1",
    level: "C",
    expectProfile: "programming",
    expectMath: false,
    material: `Python: listor, loopar och funktioner.

Listor är nollindexerade. För listan tal = [10, 20, 30, 40] gäller att
tal[0] är 10 och tal[3] är 40. tal[-1] ger sista elementet, alltså 40.

Slicing: tal[1:3] ger [20, 30] — startindex inkluderas, slutindex exkluderas.
len(tal) ger 4.

for-loop över en lista:
    for t in tal:
        print(t)

range(5) ger talen 0, 1, 2, 3, 4 — alltså fem värden som börjar på noll.
range(2, 6) ger 2, 3, 4, 5.

while-loop körs så länge villkoret är sant. Glömmer man att förändra
loopvariabeln blir det en oändlig loop.

Funktioner definieras med def och returnerar med return. En funktion utan
return returnerar None.

    def dubbla(x):
        return x * 2

Listmetoder: append() lägger till sist, insert(i, v) lägger in på plats i,
pop() tar bort och returnerar sista elementet, remove(v) tar bort första
förekomsten av värdet v.

Vanligt fel: att blanda ihop = (tilldelning) med == (jämförelse).`,
  },
  {
    id: "entreprenorskap",
    course: "Entreprenörskap",
    level: "C",
    expectProfile: "generic",
    expectMath: false,
    material: `Entreprenörskap och företagsformer.

Affärsidén beskriver vad företaget erbjuder, till vem och varför kunden ska
välja just det. En bra affärsidé svarar på ett verkligt kundbehov.

Företagsformer i Sverige:
- Enskild firma: ägaren och företaget är samma juridiska person, ägaren har
  personligt ansvar för skulderna.
- Handelsbolag: två eller flera delägare som är solidariskt ansvariga.
- Aktiebolag: egen juridisk person, kräver aktiekapital, ägarnas ansvar är
  normalt begränsat till insatsen.
- UF-företag: en skolform av företagande som drivs under ett läsår inom
  Ung Företagsamhet och avvecklas när läsåret är slut.

Budget: resultatbudgeten visar förväntade intäkter och kostnader under en
period. Likviditetsbudgeten visar in- och utbetalningar över tid och svarar på
om pengarna räcker just den månaden.

Täckningsbidrag = försäljningspris minus rörlig kostnad per styck.
Nollpunkten nås när täckningsbidraget täcker de fasta kostnaderna.

SWOT-analys ställer interna styrkor och svagheter mot externa möjligheter och
hot.

Marknadsföringens fyra P: produkt, pris, plats och påverkan.`,
  },
];
