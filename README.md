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
npm test             # 167 tests, waaronder de modelinvarianten
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

## De pagina is een verhaal in vier delen

In de volgorde van een gesprek, met een zichtbare deelkop boven elk deel:

| Deel | Vraag | Secties |
|---|---|---|
| **Het antwoord** | Wat had het opgeleverd? | invoer, antwoord (nu én met het nettarief vanaf 2029), de cijfers op een rij |
| **Waarom** | Waar komt de besparing vandaan? | prijskloof, uitsplitsing, verliezen |
| **Wanneer** | Wanneer gebeurt het? | van jaar tot jaar, door het jaar heen, één dag van dichtbij |
| **Wat als** | En als het anders was? | het nettarief, een andere maat, over de looptijd |

Daarna de instellingen — onderaan, met een sprong ernaartoe vanaf de invoer en
terug — en de verantwoording. Beschrijving en wat-als staan zo niet meer door
elkaar, de tijdschaal loopt van grof naar fijn, en het inzicht dat de
businesscase omgooit staat in het antwoordblok in plaats van acht secties lager
achter een knop.

**Twee workers.** Scenario en raster draaien automatisch, zonder knop. Samen
kosten ze een seconde of vijfentwintig; in één worker zou de dagkiezer al die
tijd niet reageren. `lib/useAnalysis.ts` start daarom naast de hoofdworker een
tweede, uit hetzelfde bestand: de hoofdworker doet de analyse en de dagkiezer,
de achtergrondworker het scenario en het raster. De rasterlogica staat in
`lib/model/raster.ts`, gedeeld tussen worker en build.

## Het standaardantwoord staat klaar

Wie de tool opent zonder iets in te stellen, zag eerst vier seconden een leeg
scherm terwijl de worker vier profieljaren doorrekende. Dat antwoord is voor
iedereen hetzelfde — er zit geen willekeur in het model — dus het wordt bij de
build één keer uitgerekend en als `/voorbeeld.json` meegeleverd, samen met het
nettariefscenario dat in het antwoordblok staat.

Het **raster** van batterijmaten zit er bewust niet in. Tweeënveertig volledige
doorrekeningen passen niet binnen de zestig seconden die Next.js een statische
route gunt; de eerste poging brak daar de hele Vercel-build op af, drie keer
opnieuw geprobeerd en toen gestopt. Het raster staat ver onder de vouw en wordt
in de achtergrondworker berekend terwijl je de rest van de pagina leest.
`staticPageGenerationTimeout` staat op 180 zodat het scenario wél de ruimte
heeft.

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

**Waarom meer vermogen soms minder oplevert.** In het raster van batterijmaten
zakt de besparing op de kleinste maten iets als het vermogen omhooggaat: bij
1 kWh van € 47,43 bij 0,8 kW naar € 46,49 bij 5 kW, twee procent. Dat is geen
rekenfout en ook geen slijtagedrempel — die is over de hele rij gelijk (1,68
ct/kWh). Het is de voorspelfout, uitvergroot door vermogen. Dezelfde rij met een
perfecte verbruiksvoorspelling loopt netjes op:

| 1 kWh | 0,5 kW | 0,8 kW | 1,5 kW | 2,5 kW | 3,6 kW | 5 kW |
|---|---|---|---|---|---|---|
| Realistisch | 47,24 | 47,43 | 46,66 | 46,65 | 46,54 | 46,49 |
| Perfecte voorspelling | 51,80 | 52,46 | 52,51 | 52,49 | 52,47 | 52,46 |

Een accu van 0,8 kW kan er per kwartier hooguit 0,2 kWh naast zitten, een van
5 kW 1,25 kWh. Meer vermogen betekent dus ook harder de verkeerde kant op
handelen als de verwachting niet uitkomt, en bij een kleine accu weegt dat
zwaarder dan wat het extra vermogen oplevert — die is toch al capaciteitsgebonden.
Een echte batterij met een weersverwachting, of een regelaar die voorzichtiger
wordt naarmate hij onzekerder is, zou deze dip niet hebben. Onze regelaar hedget
niet en voert zijn plan op vol vermogen uit; de tool rekent daarmee aan de
voorzichtige kant.

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

**Wat een laadbeurt kost.** De dispatch rekent met een schaduwprijs per kWh
doorzet: is deze beurt de marge waard? Die prijs loopt op met de schaarste van de
laadbeurten, maar zakt nooit onder **20% van de volle slijtageprijs**. Die
ondergrens sluit aan op wat het financieringsmodel al doet — `remainingCapacityFraction`
rekent 20% capaciteitsverlies over de cycluslevensduur, ongeacht schaarste — en
zonder die grens noemde de dispatch een beurt gratis terwijl de businesscase hem
wél boekte.

De kalenderlevensduur komt uit de **batterij**, niet uit de analyseperiode. Eerder
stond daar `analysisYears`: zette je de doorrekening op tien jaar, dan zakte de
drempel naar nul en ging de accu vrijer handelen. Een financiële schuif stuurde zo
het fysieke gedrag.

Gemeten over 2025, netgebied Liander, 2.500/2.000 kWh:

| | Zendure 1,92 kWh | Thuisaccu 10 kWh |
|---|---|---|
| Drempel voor → na | 0,49 → 1,68 ct/kWh | 0,00 → 2,37 ct/kWh |
| Besparing | € 101,48 → € 100,32 | € 298,07 → € 289,85 |
| Laadbeurten per jaar | 406 → 362 | 266 → 230 |

Elf procent minder beurten voor ruim één procent minder besparing. De Zendure blijft
daarmee onder zijn 6.000 beurten in vijftien jaar, waar hij er eerst overheen ging.

**De dagweergave toont vier panelen**: de prijs, wat de batterij deed, hoe vol
hij werd, en wat het opgeteld kostte met en zonder batterij. Dat laatste paneel
verving de netuitwisseling, die af te leiden was uit het actiepaneel en bestond
uit twee lijnen die grotendeels samenvielen. Wat ontbrak was het geld: aan
kilowatturen is niet te zien of een dag iets oplevert. `tests/components.test.tsx`
bewaakt dat het einde van die lijnen exact de dagkosten uit de kerncijfers is.

**Het jaar is niet één getal.** `runAnalysis` levert naast `perYear` ook
`perMonth`, gemiddeld over de volledige profieljaren. Gemeten voor de Zendure op
Liander 2024–2025:

| | jan | feb | mrt | apr | mei | jun | jul | aug | sep | okt | nov | dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Besparing | 0,96 | 2,00 | 10,33 | 10,67 | 12,49 | 12,40 | 12,35 | 13,08 | 11,51 | 6,40 | 1,85 | 0,67 |

Ruim tachtig procent valt tussen maart en oktober. In januari en december doet de
accu vrijwel niets: het prijsverschil is dan 10 à 11 cent per dag en dat is te
weinig om het omzettingsverlies en het eigen verbruik te dekken. Dat is precies
de reden om naar het tijdsafhankelijke nettarief te kijken, want dat legt zijn
piek juist in de winteravond.

**Waarom de batterij handelt op een dag die niets oplevert.** Op 18 december 2025
koopt de Zendure 's nachts 1,8 kWh in, levert er 1,6 aan het huis, en komt uit op een
dagbesparing van nul. Dat lijkt slijtage voor niets. Het is het tegenovergestelde:
zonder te handelen kost die dag **€ 0,066**, want het eigen verbruik van de omvormer
loopt door of hij nu werkt of niet. De handel verdient precies dat terug. Standby
kost de Zendure € 22 per jaar op een besparing van € 100; op een dag met weinig
prijsverschil is dat het hele resultaat.

**Financiële instellingen raken de natuurkunde niet.** Discontovoet, prijsstijging en
looptijd veranderen de contante waarde, niet de jaaropbrengst en niet het aantal
laadbeurten. Bij 3% en bij 0% rente komt dezelfde € 94,71 per jaar uit het model.
`tests/model.test.ts` bewaakt dat.

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

### Het nettarief dat er vanaf 2029 aankomt

Per 1 januari 2029 wordt een groot deel van de netkosten volume- en
tijdsafhankelijk: het voorstel van de netbeheerders ligt sinds 4 mei 2026 bij de
ACM, die naar verwachting voor eind 2026 beslist. Circa een derde blijft vast,
de rest gaat afhangen van wanneer en hoeveel je gebruikt. Vier prijsniveaus,
vijf tijdsblokken, twee seizoenen.

**De bedragen zijn nog niet gepubliceerd**; het voorstel toont alleen relatieve
niveaus. `lib/nettarief.ts` bevat daarom een prognose: CE Delft, geprognosticeerde
nettarieven 2030, op basis van Netbeheer Nederland (2026b, 2026c). Vijf niveaus,
per uur en per maand:

| Uur | 0 | 1–6 | 7–9 | 10–16 | 17–18 | 19–22 | 23 |
|---|---|---|---|---|---|---|---|
| **okt–mrt** | 0,13 | 0,10 | 0,13 | 0,10 (10–15), 0,19 (16) | 0,19 | 0,19 | 0,13 |
| **apr–sep** | 0,10 | 0,10 (1–2), 0,06 (3–6) | 0,06 | 0,00 | 0,06 | 0,13 | 0,13 |

De winterpiek loopt van 16:00 tot en met 22:00; in de zomer begint de piek pas om
19:00 en loopt hij door tot en met 23:00, terwijl de middag van 10:00 tot en met
16:00 gratis is. `tests/nettarief.test.ts` vergelijkt beide rijen cel voor cel met
Figuur 4.

Dat verandert de businesscase ingrijpend, want de piek valt op de uren waarop een
batterij levert en het nultarief op de uren waarop hij laadt. Gemeten op Liander
2024–2025, 2.500/2.000 kWh:

| | Zendure 1,92 kWh | Thuisaccu 10 kWh |
|---|---|---|
| Nu | € 94,71, terugverdiend in 8,5 jaar | € 269,72, verdient zich niet terug |
| Met nettarief | € 158,42, in 5,1 jaar | € 407,25, in 13,2 jaar |
| Waarvan winter | € 22 → € 51 | € 65 → € 134 |

De prognose is geijkt op een huishouden van 3.000 kWh per jaar: € 335 aan
volume- en tijdsafhankelijk transporttarief, wat volgens de ACM-rekenmethodiek
uitkomt op ongeveer € 0,19/kWh als bovenste trede. Het vaste deel — € 167
vastrecht plus € 135 periodieke aansluitvergoeding — blijft buiten de
berekening, want dat is met en zonder batterij gelijk.

De winst zit vooral in de winter, precies het seizoen waarin de accu nu bijna
stilstaat. Of teruglevering ook wordt beprijsd staat niet in het voorstel; dat is
een schakelaar die standaard uit staat.

Het variabele deel telt in dit scenario dus wél mee in de besparing, anders dan
de vaste netbeheerkosten hieronder. Dat is geen inconsistentie maar het hele
punt: zodra netkosten van je gedrag afhangen, zijn ze niet meer gelijk met en
zonder batterij.

### Wat er niet in zit

- Vastrecht, de belastingvermindering en het vaste deel van de netbeheerkosten.
  Die zijn met en zonder batterij gelijk en beïnvloeden de besparing niet; de
  getoonde bedragen zijn de variabele stroomkosten. Het tijdsafhankelijke deel
  van het nettarief is daar vanaf 2029 de uitzondering op — zie hierboven.
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
