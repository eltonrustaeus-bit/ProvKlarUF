# Eval: avläsning av handskrivna matematiklösningar

Mäter hur väl `mode:"solution"` i `api/ocr.js` läser en elevs lösning.

```bash
node tests/evals/solution-ocr/make-images.mjs            # genererar bilderna, en gång
OPENAI_API_KEY=… node tests/evals/solution-ocr/run.mjs   # mäter
```

Jämför modeller genom att sätta `OPENAI_VISION_MODEL` mellan körningarna.

Evalen ligger utanför testsviten med flit: den kostar API-anrop och kräver
nyckel. En svit som ska kunna köras gratis och offline får inte innehålla den.

## Två tal, och det andra är det viktiga

| Tal | Betydelse |
|---|---|
| `teckenfel (CER)` | Hur nära transkriptionen ligger facit. Lägre är bättre. |
| `bevarade fel` | Hur ofta modellen **lät bli** att rätta elevens misstag. Ska vara 100%. |

En modell med låg CER som tyst rättar elevens fel är oanvändbar. Då bedöms
eleven för ett arbete de inte utfört, felet når aldrig felbanken, och mastery
stiger på en kunskap de inte har. Fyra av fallen bär ett medvetet räknefel just
för att mäta det.

Tre fall prövar annat än räkning: `overstruket` (eleven tog tillbaka ett steg),
`namn-i-marginalen` (personuppgift som aldrig får transkriberas) och
`injektion` (text i bilden är data, inte instruktioner).

## Vad siffran från syntetiska bilder INTE är värd

`make-images.mjs` renderar rutat papper i ett handstilsliknande typsnitt. Det
mäter inte handskrift. En modell läser rena tecken långt bättre än blyerts på
rutat papper, så resultatet är **systematiskt för optimistiskt**.

Bilderna finns för att mätningen ska kunna byggas och köras innan riktiga foton
finns. De avgör inte vilken modell `OPENAI_VISION_MODEL` ska peka på.

## Vad som krävs innan modellvalet låses

15–20 **riktiga foton** av handskrivna lösningar:

- både slarvig och prydlig handstil
- både rätt och fel uträkningar
- både grundskola och gymnasium
- fotade som en elev gör det: mobil, sned vinkel, ojämnt ljus
- minst ett med överstrukna steg
- minst ett med namn i marginalen

Lägg dem i `images/` med samma filnamn som `id` i `cases.json`, och skriv facit
i `expected`. Katalogen är gitignorerad med flit: riktiga elevfoton innehåller
handskrift och ofta namn i marginalen, och får aldrig committas. Det som redan finns i `cases.json` kan då bytas ut mot de riktiga
fallen — strukturen är densamma.

Först då säger siffran något om vad en elev faktiskt kommer uppleva.
