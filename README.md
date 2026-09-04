# Thuisbatterij-rekentool

Wat had een thuisbatterij je opgeleverd als er geen saldering was geweest?

Deze tool rekent die vraag door op **werkelijk gemeten kwartierprofielen** en
**werkelijke uurtarieven** — geen synthetische curves en geen prijsvoorspelling.
Vanaf 2027 vervalt de saldering: teruglevering brengt dan nog de kale marktprijs
op, terwijl afname het volle tarief kost. Dat gat is de hele businesscase van een
thuisbatterij, en dit is de eerlijkste manier om te laten zien hoe groot het is.

De app draait volledig in de browser. Geen backend, geen API-calls tijdens
gebruik, alles vanaf de CDN.

## Aan de slag

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 133 tests, waaronder de modelinvarianten
npm run build        # statische export naar out/
npm run clean        # bij een vastgelopen build-cache
```

**Stop de dev-server voordat je bouwt.** Ze delen state, en een build onder een
draaiende dev-server laat die omvallen met `Cannot find module './833.js'` of een
fout over het React Client Manifest. De build schrijft naar een eigen map
(`.next-build`), wat de ergste chunk-corruptie voorkomt, maar niet alles.
Loopt het toch vast: `npm run clean`.

**Breekt de build af zonder foutmelding?** Als `next build` stopt na
`Creating an optimized production build ...` en exitcode 0 geeft zonder `out/`
te maken, is de webpack-compile gesmoord door geheugendruk — kijk naar
`vm.swapusage`. `npx next build --turbopack` doet hetzelfde werk in een fractie
van het geheugen en levert dezelfde export op.

## Het standaardantwoord staat klaar

Wie de tool opent zonder iets in te stellen, zag eerst vier seconden een leeg
scherm terwijl de worker vier profieljaren doorrekende. Dat antwoord is voor
iedereen hetzelfde — er zit geen willekeur in het model — dus het wordt bij de
build één keer uitgerekend en als `/voorbeeld.json` meegeleverd: 40 kB, 12 kB
over de lijn.

De route-handler in `app/voorbeeld.json/route.ts` draait tijdens de build en
leest de assets van schijf in plaats van via `fetch`. Daarom neemt
`lib/data/loader.ts` een `Ophaler` als parameter, en bouwt `lib/data/invoer.ts`
de modelinvoer voor zowel de worker als de build. Dezelfde code, één antwoord.

Bruikbaar is het bestand alleen als de sleutel klopt: die bevat het
modelversienummer uit `lib/cache.ts` én een hash van de configuratie. Een
bezoeker met afwijkende invoer, of een bestand van vóór een modelwijziging,
valt vanzelf terug op zelf rekenen. `tests/voorbeeld.test.ts` bewaakt die
afspraak, want als de twee kanten uit elkaar lopen blijft de tool werken en is
hij alleen weer traag — een regressie die niemand opmerkt.

## Publiceren

De app staat op Vercel en bouwt bij elke push naar `main`. `vercel.json`
overschrijft het buildcommando bewust met `next build` in plaats van
`npm run build`: dat laatste zet `NEXT_BUILD_DIR=.next-build`, en die map vindt
Vercel niet terug omdat het zijn eigen configuratie leest zonder die variabele.
Zo blijft alles op `.next` staan en komt de export in `out/`.

De data staat al in `public/data/`. Alleen als je die wilt verversen zijn de
Python-scripts nodig — zie [Data verversen](#data-verversen).

## Waar de cijfers vandaan komen

| Wat | Bron | Periode |
|---|---|---|
| Verbruik en teruglevering per kwartier | MFFBAS/EDSN **DYNAMIC** profielfracties, categorie E1A, afnametype AMI | vanaf 2023-04-01 |
| Uurtarieven | ANWB Energie, marktprijs en all-in, incl. btw | vanaf 2021 |

Beide via de `energiedata-nl` skill.

**Waarom DYNAMIC en niet de standaardprofielen.** DYNAMIC wordt dagelijks
herberekend uit echte meetdata en bevat dus het werkelijke weer. Richting E17 is
wat een huishouden van het net haalt, E18 wat het erop zet — samen precies de
residual load waar de batterij op opereert. Er hoeft daardoor niets aangenomen te
worden over oriëntatie, instraling of zelfconsumptiegraad.

**Waarom E1A en niet E1B.** E1A is het enkeltariefprofiel, passend bij een
dynamisch contract. E1B is dubbeltarief en sommeert over een jaar op ongeveer 2
in plaats van 1 — het prototype gebruikte dat profiel wel.

## Het rekenmodel

### Twee strategieën

**Perfect foresight** (`dispatch-optimal.ts`) plant met volledige kennis van
prijzen en verbruik: de bovengrens van wat er in had gezeten. Geen echte batterij
haalt dit; het dient als benchmark en als correctheidstoets.

**Rollende horizon** (`dispatch-rolling.ts`) is wat een moderne slimme batterij
werkelijk doet. Hij kent de day-ahead prijzen tot het einde van morgen en plant
met een verwachting van je verbruik uit de voorgaande week — niet met kennis van
de toekomst. Herplannen gebeurt eens per dag, uitgelijnd op het publicatiemoment
van de nieuwe prijzen.

Het verschil tussen beide is zelf een resultaat: het laat zien wat onvolmaakte
informatie kost. Op de echte data haalt de realistische strategie ruwweg 85 tot
90% van het optimum, afhankelijk van de batterij; de app toont het werkelijke
percentage bij de verantwoording.

**Dat gat is de weersvoorspelling, niet de prijshorizon.** Gemeten over 2025,
netgebied Liander, 2.500/2.000 kWh:

| | 1,92 kWh / 0,8 kW | 10 kWh / 3,6 kW |
|---|---|---|
| Realistisch, herplannen 1× per dag | € 101,48 | € 298,07 |
| Herplannen elke 6 uur | € 101,53 | € 298,16 |
| Met perfecte verbruiksvoorspelling | € 109,75 | € 350,11 |
| Volledig optimum | € 110,18 | € 356,28 |

Vaker herplannen levert vijf cent op een jaar op. Zou de strategie daarentegen
weten wat het morgen doet, dan haalt ze 99,6% respectievelijk 98,3% van het
optimum. Wat de batterij beperkt is dus niet dat ze de prijzen van overmorgen
niet kent, maar dat ze de zon van morgen niet kent. De voorspelling hier is het
gemiddelde van hetzelfde kwartier over de voorgaande week; een echte batterij
gebruikt een weersverwachting en doet het dus beter. Deze tool rekent daarmee
aan de voorzichtige kant.

**Standby is geen detail.** Bij de Zendure van 1,92 kWh kost 12 W continu
€ 22,47 per jaar, tegenover een besparing van € 101. Dat is ook de verklaring
voor dagen met een negatieve besparing: op een dag zonder prijsverschil verdient
de batterij niets en blijft het eigen verbruik staan.

**Waar dat gat vandaan komt.** Twee dingen weet een echte batterij niet: de
prijzen van morgen vóór de publicatie om 13:00, en hoeveel zon en verbruik
morgen brengt. Die twee zijn te scheiden door de strategie nog eens te laten
draaien met de werkelijke residual als "voorspelling", en dat is wat
`computeStrategyGap` doet. Gemeten op Liander 2025:

| Batterij | Gat met het optimum | Prijshorizon | Verbruiksvoorspelling |
|---|---|---|---|
| 5,1 kWh / 2,5 kW | € 28,60 | € 1,73 (6%) | € 26,90 (94%) |
| 10 kWh / 3,6 kW | € 56,60 | € 6,37 (11%) | € 50,20 (89%) |

De prijshorizon is dus bijna niet het probleem, en dat is te begrijpen: het plan
dat om 13:00 wordt gemaakt reikt tot morgen 24:00 en wordt maar vierentwintig uur
uitgevoerd, dus er is altijd ruim tien uur zicht voorbij de uitvoering. Het weer
is wat de strategie beperkt. Vaker herplannen helpt daarom niet: van eens per dag
naar elk uur verandert de opbrengst met dertig cent per jaar.

Beide strategieën mogen de batterij ook **naar het net ontladen** als de prijs
dat waard maakt. Dat is de handelsmodus van een moderne thuisbatterij op een
dynamisch contract. De uitvoerder van de realistische strategie krijgt het plan
én de voorspelling waarop het gemaakt is, zodat hij bewuste verkoop doorlaat maar
een tegenvallend tekort niet met extra netlevering opvult.

Beide gebruiken dezelfde solver (`solver.ts`): dynamisch programmeren over een
SoC-grid, met **lineaire interpolatie van de waardefunctie**. Dat laatste is geen
detail — zonder interpolatie moet elke laadstap een geheel aantal gridstappen
zijn, en bij 15 kWh op 0,8 kW verdwijnt dan een kwart van het laadvermogen in
afronding, met een niet-monotone besparing tot gevolg.

### Conventies die vastliggen

**Vermogen en rendement.** De vermogenslimiet geldt aan de AC-zijde, het
rendement grijpt aan bij de omzetting naar en uit de cel:

```
laden:    ac_in  ≤ Pc · Δt      soc += ac_in · η
ontladen: ac_out ≤ Pd · Δt      soc −= ac_out / η
```

Round-trip is dus η². Symmetrisch in beide richtingen.

**Cycli** worden alleen over de ontlading geteld: één volledige laad-ontlaadgang
is precies één cyclus.

**Slijtage telt één keer.** De slijtagekosten sturen de dispatch — ze bepalen of
een extra cyclus de moeite waard is — maar ze worden niet van de gerapporteerde
besparing afgetrokken. Slijtage is niet iets bovenop de aanschafprijs; het ís die
prijs, uitgesmeerd over de cycli, en die staat al als investering in de
businesscase.

**Tijd.** Een Nederlandse dag heeft 92, 96 of 100 kwartieren. Dag-, maand- en
jaargrenzen worden in `Europe/Amsterdam` bepaald, koppelingen tussen reeksen in
UTC. Nergens staat een hardcoded 24 of 96.

**Normalisatie.** DYNAMIC-fracties sommeren over een kalenderjaar niet op 1 —
gemeten voor 2025: 1,0178 voor afname en 1,0495 voor invoeding. De build-stap
normaliseert per kalenderjaar naar exact 1. Een deelperiode wordt bewust **niet**
opnieuw genormaliseerd: drie wintermaanden horen meer dan een kwart van het
jaarvolume te bevatten.

**Netten en de meterstanden.** E17 en E18 zijn gemiddelden over veel
huishoudens en overlappen elkaar op veel kwartieren; het model trekt ze per
kwartier van elkaar af, want één aansluiting kan maar één kant op. Daarbij valt
volume weg: met 2.500/2.000 kWh bleef er zonder correctie 2.086/1.586 over. De
jaartotalen op de afrekening zijn zelf al genette sommen, dus het model schaalt
de twee fracties met factoren (`solveNettingScale`, ruwweg 1,20 en 1,25) zodat de
genette reeks over een vol jaar exact op de meterstanden uitkomt. Deeljaren lenen
die factoren van het meest recente volle jaar. Het scheelt bijna een vijfde in de
besparing.

**Heffing per uur.** Energiebelasting plus inkoopopslag komt uit
allInPrijs − marktprijs, per uur en niet als jaarconstante: in 2025 zakte de
heffing in september van 17,13 naar 14,29 ct. Wie met de heffing van nu wil
rekenen — die ligt een kwart tot een derde onder die van 2024 en 2025, en de
besparing schaalt daar bijna één-op-één mee — zet dat aan bij de instellingen;
dan geldt de heffing van het meest recente prijsjaar over alle jaren.

**Een dag is geen sluitende eenheid.** Een batterij houdt zich niet aan de
kalender: laden in de nacht van de 19e om te ontladen op de 20e is precies wat
je wilt op een dynamisch tarief, maar de inkoop valt dan op de ene dag en de
opbrengst op de andere. Op 2025 sluiten daardoor 64 van de 365 dagen negatief af,
samen € 18,63, terwijl diezelfde dagen met hun buurdag positief zijn. Van die 64
zijn er 41 puur dagovergang; de 23 waarop de batterij begint en eindigt op
dezelfde stand kosten samen € 0,89 over het hele jaar, en dat is de echte prijs
van een verkeerde inschatting.

Dat het geen modelfout is, blijkt uit het optimum: dat kent de hele periode
vooraf en maakt op zulke dagen dezelfde keuze, tot op de cent. De dagweergave
laat daarom de stand om 00:00 en om 24:00 zien, zodat een negatief dagbedrag
verklaard is in plaats van verdacht.

**Bruto zonopwek zit niet in de data.** De bron is meterdata: E17 is wat het huis
van het net haalde, E18 wat het erop zette. Wat de panelen produceerden en direct
werd opgemaakt, komt nooit langs de meter en staat dus in geen van beide reeksen.
De dagweergave toont daarom de **teruglevering** per kwartier, met dat voorbehoud
er expliciet bij. Voor bruto opwek per kwartier zou je de opbrengstmeting van de
omvormer nodig hebben.

### Wat er niet in zit

- Vastrecht, netbeheerkosten en de belastingvermindering. Die zijn met en zonder
  batterij gelijk en beïnvloeden de besparing niet; de getoonde bedragen zijn de
  variabele stroomkosten.
- Terugleverkosten-staffels per leverancier — wel als één instelbare €/kWh.
- Het profiel is een gemiddelde over veel huishoudens en daardoor gladder dan één
  aansluiting. Dat onderschat de waarde van een batterij eerder dan dat het hem
  overdrijft. De spreidingsfactor maakt die bias instelbaar.

## Structuur

```
app/                    pagina, thema
components/             invoer en visualisaties
lib/model/              solver, strategieën, batterij, tarieven, financiën
lib/data/               loader, DST-veilige tijdas, manifest
lib/worker/             rekenworker en protocol
public/data/            manifest.json + binaire assets
scripts/                Python, alleen voor het verversen van data
tests/                  invarianten en integratietests
legacy/                 het Streamlit-prototype, als referentie
```

## De testsuite

De tests bewaken de eigenschappen die het prototype miste:

- **Monotonie** — meer capaciteit of vermogen levert nooit minder op. Strikt voor
  het optimum, met marge voor de realistische strategie, want die plant op een
  voorspelling. Dit is de test die het oude model faalt.
- **Optimum ≥ realistisch** voor elke configuratie.
- **Energiebalans** sluit per kwartier tot 1e-9.
- **Zomertijd** — 92, 96 en 100 kwartieren per dag, en de vensterselectie klopt
  eromheen.
- **Normalisatie** — volledige jaren op exact 1, deelperioden bewust lager.
- **Integratie** op de echte assets, met `fetch` naar het bestandssysteem, zodat
  het binaire formaat en de loader echt getest worden.
- **De worker als geheel** (`tests/dagkiezer.test.ts`) — berichten erin,
  berichten eruit, met `self` nagebootst. Dat vangt de fouten die tussen de
  modules vallen in plaats van erin. De dagkiezer was daar stuk: hij vroeg een
  dag op die de worker alleen kon leveren als hij de analyse zélf had gedraaid,
  en na een refresh komt die uit de browsercache. Elke modeltest bleef groen.

De bestanden draaien **achter elkaar** (`fileParallelism: false`). Twee tests
meten hoe lang een doorrekening duurt, en parallel meten die de bezetting van de
machine in plaats van het model: hetzelfde werk kwam op 3,7 seconden uit alleen
en op 10,8 naast de andere bestanden.

## Data verversen

```bash
python3 scripts/fetch_dynamic.py            # profielfracties, alle netgebieden
python3 scripts/fetch_prices.py             # vult de uurtarieven aan tot vandaag
python3 scripts/build_assets.py             # → public/data/
```

`fetch_dynamic.py` slaat over wat er al ligt. De EDSN-API staat 1000 requests per
dag per IP toe; alle netgebieden over de volle periode kost er ongeveer 700.
DYNAMIC loopt twee dagen achter en recente dagen kunnen nog wijzigen, dus ververs
de laatste maanden opnieuw.

Prestaties: ongeveer 450 ms voor de realistische strategie en 270 ms voor het
optimum per profieljaar; vier jaar met beide strategieën, de besparingscurve en
de ontleding van het gat met het optimum in ruim drie en een halve seconde. De proefrun die bepaalt of laadbeurten schaars zijn, draait
op volle resolutie en wordt hergebruikt als de drempel nul blijkt — bij vrijwel
elke preset. Het raster van batterijmaten doet hetzelfde per punt en kost
daardoor in de regel één doorrekening per punt in plaats van twee.

De binnenste lus van de solver is bewust niet verder geoptimaliseerd: delingen
vervangen door vermenigvuldigingen gaf tot 30% winst maar veranderde het antwoord
met twaalf cent per jaar, doordat het laatste bit een keuze tussen bijna gelijke
kandidaten kan kantelen. Wie meer snelheid wil, haalt die uit parallelle workers
per profieljaar, niet uit de rekenkunde.
