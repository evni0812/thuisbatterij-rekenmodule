# Thuisbatterij-rekentool

Wat had een thuisbatterij je opgeleverd als er geen saldering was geweest?

Deze tool rekent die vraag door op het **gemeten gemiddelde kwartierpatroon** van
alle kleinverbruikers (E1A) met, of zonder, teruglevering in een netgebied
(MFFBAS/EDSN), geschaald naar de jaartotalen van de gebruiker, en op de
**werkelijke uurtarieven** van ANWB Energie — geen synthetische curves en geen
prijsvoorspelling. Het profiel is geen meting van één huishouden: pieken van een
waterkoker of laadpaal zijn uitgemiddeld.

Op 1 januari 2027 stopt de salderingsregeling. Met een dynamisch contract krijg
je voor teruglevering dan de kale marktprijs van dat uur, min eventuele
terugleverkosten, terwijl afname het volle tarief met belasting kost. Dat gat is
de hele businesscase van een thuisbatterij. Met een vast of variabel contract
geldt tot en met 2030 een wettelijke minimumvergoeding van 50% van het kale
leveringstarief; die situatie rekent de tool niet door. De doorrekening gaat uit
van een dynamisch contract en een batterij die zelf op de uurprijzen stuurt.

De uitkomst is een doorrekening op historische prijzen met de belasting en
opslag van nu, geen persoonlijk advies en geen garantie. De tool is van de ANWB,
die ook energie en thuisbatterijen verkoopt; dat staat ook op de pagina.

De app draait volledig in de browser. Geen backend, geen API-calls tijdens
gebruik, alles vanaf de CDN.

## Aan de slag

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 348 tests, waaronder de modelinvarianten
npm run build        # statische export naar out/
npm run clean        # bij een vastgelopen build-cache
```

**Bouwen naast een draaiende dev-server mag.** `next.config.mjs` leest de fase
die Next meegeeft en kiest daarop de map: de dev-server krijgt `.next-dev`, elk
buildcommando `.next`. Ze kunnen elkaars chunks dus niet meer overschrijven,
ongeacht hoe de build wordt gestart. Eerder hing dat aan een omgevingsvariabele
in `npm run build`, en dan viel de dev-server om met `Cannot find module
'./873.js'` zodra iemand `npx next build` of `vercel build` gebruikte. Zie je
die fout toch nog, dan is er oude rommel blijven staan: `npm run clean`.

**Breekt de build af zonder foutmelding?** Als `next build` stopt na
`Creating an optimized production build ...` en exitcode 0 geeft zonder `out/`
te maken, is de webpack-compile gesmoord door geheugendruk — kijk naar
`vm.swapusage`. `npx next build --turbopack` doet hetzelfde werk in een fractie
van het geheugen en levert dezelfde export op.

## De pagina: zes tabbladen, één verhaal

De pagina volgt de volgorde van een gesprek, in zes tabbladen in de balk
bovenaan. Het open tabblad staat in de URL (`?tab=waarom`), de panelen blijven
gemount zodat het dagprofiel zijn gekozen dag houdt.

| Tab | Vraag | Secties |
|---|---|---|
| **Start** | Wat had het opgeleverd? | invoer (drie velden), antwoord (nu én met het nettarief vanaf 2029), de cijfers op een rij, de uitklapbare geavanceerde instellingen, instellingen bewaren |
| **Waarom** | Waar komt de besparing vandaan? | prijskloof, uitsplitsing, verliezen |
| **Wanneer** | Wanneer gebeurt het? | van jaar tot jaar, door het jaar heen, de gemiddelde dag in winter en zomer, één dag van dichtbij |
| **Wat als** | En als het anders was? | het nettarief, een andere maat, over de looptijd |
| **Uitstoot** | Wat scheelt het aan CO2? | de voetafdruk van je netafname, wanneer stroom schoon is, de winst per maand, het perspectief van Nederland |
| **Methode** | Waar komen de cijfers vandaan? | verantwoording, controlegegevens, "wat we niet weten" |

**Twee manieren om van tabblad te wisselen.** De tablist in de balk is er om
ergens naartóé te springen; de stapper onder aan de pagina is er om verder te
lezen — chevron naar links, chevron naar rechts, en daartussen een pil met het
tabblad waar je staat. Die pil is letterlijk een venster: alle zes de titels
staan naast elkaar op één spoor, de pil laat er één van zien en het spoor
schuift op (`translateX(-i * 100%)`). Daardoor ís de beweging de navigatie — je
ziet de oude titel weglopen en de nieuwe binnenkomen, en bij een sprong van twee
schuift de tussenliggende titel er zichtbaar doorheen. Bij
`prefers-reduced-motion` vervalt de overgang en wisselt de titel gewoon.
Doorstappen scrolt naar boven, want de knop staat onderaan het vorige onderdeel.
De stapper staat één keer in de boom, ná de panelen: alleen het actieve paneel
is zichtbaar, dus hij hangt altijd onder wat je leest. Hij is een `<nav>` met
gewone knoppen en geen tweede tablist, zodat een schermlezer niet twee keer
dezelfde structuur krijgt.

**De terugverdientijd kent de ingangsdatum van het nettarief.** Het
tijdsafhankelijke tarief is een voorstel; gaat het door, dan naar verwachting
op 1 januari 2029 (mogelijk later). Een batterij die vanaf het einde van de
saldering meedraait, rekent dus eerst nog een paar jaar met het huidige
nettarief. `lib/overgang.ts`
rekent dat geval: `computeFinance` accepteert een tweede besparingscurve en het
jaar waarin die ingaat, en leest per jaar de goede curve af terwijl de
degradatie gewoon doorloopt — het is dezelfde batterij, alleen de prijzen
veranderen. Dat kost geen extra simulatie, want beide doorrekeningen leveren al
een curve van besparing tegen resterende capaciteit op. Het antwoord bovenaan,
de kerncijfers bij het nettarief en de cashflowgrafiek gebruiken alle drie dit
getal; in het antwoord is het de enige vetgedrukte terugverdientijd ("als het
nettarief-voorstel doorgaat"), met die van een ongewijzigd tarief erachter als
vergelijking. In de grafiek staat het omslagjaar als stippellijn. De twee losse
doorrekeningen leggen elk hún tarief over de hele levensduur en zijn dus te
pessimistisch respectievelijk te optimistisch — die blijven staan als
vergelijking van twee tariefwerelden, niet als voorspelling.

**De kerncijfers leiden met percentages.** Eigen verbruik, onafhankelijkheid
van het net en afname in de piekuren staan vooraan, elk met de verandering
eronder in procentpunten — van 26% naar 35% is negen procentpunt, niet "35%
meer". De eerste twee vragen de **bruto** jaaropwek, en die staat niet op een
jaarafrekening: daar staat alleen wat er door de meter ging. Vult de bezoeker
hem niet in, dan schat `geschatteOpwekKwh()` hem uit de teruglevering met de
gangbare vuistregel van 30% direct eigen verbruik zonder batterij, en zegt de
noot eronder dat het een schatting is en hoe je hem vervangt. Eerder bleven die
twee cijfers leeg tot je zelf iets invulde; dan mist de pagina precies de twee
getallen waar een thuisbatterij over gaat.

**Geen wat-als over een heffing op teruglevering.** Die stond er als schakelaar
en is eruit: het voorstel beprijst uitsluitend afname, er ís geen
terugleverheffing, en de tool rekent met een dynamisch contract zonder. Een
schakelaar voor iets wat niet bestaat kost de lezer meer dan hij oplevert.

**Slijtage staat er, maar niet vooraan.** In het verloop per maand of jaar
was ze eerst een grijs blokje onder elke staaf én een getal in de kop. Dat geeft
haar een gewicht dat ze niet heeft: het is afschrijving op een investering die
al gedaan is, geen kostenpost van die week. Ze staat nu als één zacht gezet
getal onder de grafiek.

**Cijfers en uitleg noemen hetzelfde jaar.** Losse jaarcijfers verwijzen naar
`referentieJaar()` uit `lib/model/analysis.ts`: het meest recente volledige
profieljaar. Eén definitie, gedeeld door de pagina en door `lib/uitleg.tsx` —
toen de pagina het eerste volledige jaar pakte en de uitleg het laatste, stond
er onder de grafiek € 89 over 2024 en in de dialoog ernaast € 100,25 over 2025.

**Uiterlijk en patronen komen van de Energiecontract Monitor**
(`~/code/energiecontract-monitor`): IBM Plex, één diep-teal accent, witte
kaarten op een grijsgroene ondergrond, KPI-tegels met een gekleurde bovenrand,
titels als stellingen. Eén thema, geen donkere modus. De twee tools horen er als
familie uit te zien.

**Elke grafiek leest af bij aanwijzen.** Wijs een maand, een uur, een jaar of
een vakje aan en er verschijnt een kaart met de getallen erachter; de kolom die
je aanwijst licht op. De bouwstenen staan in `components/chart-parts.tsx`
(`useTip`, `Grafiek`, `Trefvlak`, `TipLaag`). Drie regels die overal gelden: het
trefvlak is ruimer dan de mark zelf, want aanwijzen mag niet om precisie vragen;
de kaart staat náást de cursor en klapt om bij de rand, zodat hij het
aangewezen punt nooit afdekt; en de trefvlakken zijn `aria-hidden`, want de svg
eromheen draagt een samenvattende `aria-label` en een focusbaar kind daarbinnen
zou wel met tab bereikbaar zijn maar niet worden aangekondigd. Alles wat in een
kaart staat, staat daarom ook als tekst onder de figuur.

**Elke figuur heeft zijn eigen vorm.** Niet als versiering: twee grafieken met
dezelfde vorm onder elkaar lezen als één grafiek die zichzelf herhaalt. De
prijskloof vergelijkt twee prijzen (twee balken, met het gat ertussen
gemarkeerd), de uitsplitsing telt posten op tot een totaal (een waterval), de
verliezen zetten twee ongelijksoortige verliezen apart (twee blokken met elk hun
eigen kengetal), en het nettarief is een gewone grafiek met een as in centen in
plaats van een raster waarin kleur het bedrag moest dragen.

**"Hoe is dit berekend?"** Elke sectie en elke tegel heeft een knop die een
native `<dialog>` opent met een vaste opbouw: wat zie je, waar de getallen
vandaan komen, stap voor stap, jouw getallen, waar je op moet letten. De teksten
staan in `lib/uitleg.tsx` als functies van de doorrekening: het voorbeeld rekent
met de echte getallen van de gebruiker, niet met een vast voorbeeldhuishouden.
De component in `components/Uitleg.tsx` is het patroon van de monitor: `showModal()`
geeft focus-trap, inerte achtergrond en Esc gratis; een klik op de achtergrond
sluit.

**Geavanceerde instellingen** staan op Start in een `<details>`, geordend op wat
ze veranderen (jouw situatie, de batterij, je contract, hoe je ernaar kijkt) en
met het invoertype dat bij het getal past: bedragen, kilowatturen en percentages
tik je in, alleen de spreidingsfactor is een schuif. Het blok klapt vanzelf open
als er afwijkingen zijn.

**Instellingen bewaren** (`lib/opslag.ts`, `components/Bewaren.tsx`) werkt in
twee lagen in localStorage: "Onthoud mijn instellingen" bewaart de laatste set,
die bij een volgend bezoek zonder URL-parameters vanzelf laadt (met een melding
en een knop terug naar de standaard); daarnaast hoogstens acht profielen met een
naam om te laden of te verwijderen. Een URL met parameters wint altijd van de
bewaarde set, zodat een gedeelde link laat zien wat de afzender zag. Een set van
vóór een nieuw veld wordt aangevuld met de standaard.

**Maand en jaar.** Boven het dagprofiel staat het verloop over een periode
(`components/Verloop.tsx`): een maand per dag, een jaar per week, met bladeren
naar de vorige of volgende periode. Dezelfde dispatch als het dagprofiel,
opgeteld in wandkloktijd door `lib/model/periode.ts`; de worker levert het op
aanvraag uit de bewaarde jaardispatch (bericht `periode`). Per vak staat de
besparing. Een klik op een dag opent die dag in het dagprofiel.

**De week zit bij het dagprofiel.** Die stond hier eerst ook, als staafjes per
uur. Maar wat een week laat zien — wanneer de batterij laadt en levert, en hoe
dat ritme zich per dag herhaalt — is dezelfde vraag als die van het dagprofiel,
alleen over zeven dagen. Het verloop gaat over optellen; het profiel over
uitvoeren. Dus schakelt `components/Dagprofiel.tsx` nu tussen **Dag** en
**Week**, en tekent in de weekstand dezelfde vier panelen met 168 uurpunten in
plaats van 96 kwartieren.

Dat kon zonder de tekencode te verdubbelen. De x-as schaalt al op de lengte van
de reeks, dus die trok zich niets aan van het verschil. Wat wel moest: de
panelen werken nu op een `Profiel` — de vorm die ze echt nodig hebben — in
plaats van op een `SampleDay`, en de omrekening van kilowattuur naar kilowatt
is een parameter geworden. Die stond als constante `4` in het bestand, wat
klopte zolang er alleen kwartieren doorheen gingen; een uur van 0,25 kWh is
0,25 kW en geen 1 kW.

De week loopt over een **eigen workerkanaal**. Verloop en dagprofiel vragen
tegelijk een periode op, met verschillende resoluties, en de worker houdt per
soort bericht één volgnummer bij om verouderde aanvragen te laten vallen.
Deelden ze dat, dan annuleerde de ene figuur de andere en zag je bij allebei om
beurten "wordt opgeteld…". Vandaar `PeriodeKanaal` in het protocol en twee
slots in `lib/useAnalysis.ts`. De week wordt pas opgevraagd als je de knop
omzet: het is een tweede optelling over de jaardispatch, en wie alleen naar één
dag kijkt hoeft daar niet op te wachten.

**Slijtage staat ernaast, niet erin.** Elke geleverde kilowattuur gebruikt een
stukje van de levensduur; tegen de aanschafprijs is dat `investering ÷
(cycli × bruikbaar × rendement)` per kWh (`wearCostPerKwh`). Die post zit al in
de aanschafprijs die de terugverdientijd rekent en wordt daarom niet van de
besparing afgetrokken, maar hij is overal zichtbaar: als tegel bij de cijfers
(`KeyStats.wearCostPerYearEur`), per jaar (`YearAnalysis.wearCostEur`), per dag
(`SampleDayStats.wearCostEur`) en per vak in het periodeverloop. De planner
rekent met dezelfde prijs als drempel: is de slijtage hoger dan wat een beurt
oplevert, dan handelt de batterij niet.

**Een pool van workers.** Eén doorrekening bestaat uit onafhankelijke stukken:
elk profieljaar apart (rolling én optimum), twee curvepunten en één run met
perfecte voorspelling; het scenario idem zonder optimum; het raster in rijen.
`lib/useAnalysis.ts` verdeelt die stukken via `lib/worker/pool.ts` over
`min(4, kernen − 1)` workers uit hetzelfde bestand. Worker 0 is de hoofdworker:
die voegt samen (`voegSamen` in `lib/model/analysis.ts`), bewaart de dispatches
en beantwoordt de dagkiezer en de periodegrafiek; de rest doet vensters,
curvepunten en rasterrijen. De samenvoeging telt in de volgorde van de vensters
op, ongeacht welke worker het eerst klaar was, en geeft daardoor bit-voor-bit
hetzelfde als de doorlopende `runAnalysis` (bewaakt in `tests/pool.test.ts`).
Achter elkaar kostte de analyse vier seconden en scenario plus raster nog eens
eenentwintig; met vier workers is het kritieke pad één profieljaar plus het
samenvoegen, en staat het raster na een paar seconden.

**Wat je ziet terwijl er gerekend wordt.** Bovenaan de pagina, op elk
tabblad, staat tijdens een doorrekening één kaart (`components/Wachtscherm.tsx`)
met een balk die vult naarmate de stukken uit de pool binnenkomen en de echte
stappen erbij: profieljaren (n van m), besparing bij slijtage, perfecte
voorspelling, samenvoegen. `useAnalysis` houdt daarvoor een `Voortgang` bij,
met gewichten die ruwweg de rekentijd volgen. Eerder dimde alleen het
antwoordblok en stond "Bezig met rekenen…" op een knop op het eerste tabblad;
wie ergens anders stond zag niets gebeuren. Is de invoer gewijzigd zonder
nieuwe berekening, dan staat op dezelfde plek een balk met de rekenknop erin,
die onder de vaste kop blijft hangen.

**Opwarmen na een treffer.** Komt het antwoord uit de cache of de preload, dan
heeft de hoofdworker nooit gerekend, en kostte de eerste dag-, week- of
periodeaanvraag het laden van alle profielen plus een jaarsimulatie: ruim een
seconde "wordt opgeteld…" over data die er al leek te zijn. Direct na zo'n
treffer krijgt de hoofdworker nu een `warm`-bericht: hij bouwt de invoer en
rekent de jaardispatches vooraf, het referentiejaar eerst (realistisch, basis
én optimum, want de dagweergave toont het optimum), daarna de andere jaren, in
stukken met een adempauze ertussen zodat een echte aanvraag er altijd
tussendoor kan en alleen nog rekent wat ontbreekt. Een nieuwere configuratie of
`cancel` breekt hem af. De week in het dagprofiel wordt bovendien vooruit
opgevraagd voor elke getoonde dag, in plaats van pas bij de klik op Week: het
wachten na de klik was zichtbaarder dan het werk vooraf.

**Wat er niet meer gerekend wordt.** Het scenario leest de pagina alleen op
besparing, kerncijfers, financiën en curve; `runScenario` slaat het optimum, de
voorbeelddagen en het gat over (vijf jaarsimulaties minder). De cachesleutel
(`dispatchSleutel` in `lib/cache.ts`) omvat alleen de velden die de dispatch
veranderen; looptijd, rente, prijsstijging, degradatie, restwaarde en jaaropwek
worden bij het lezen opnieuw afgeleid met `pasAfleidingToe`, zodat zo'n schuif
geen seconde rekent. `VELDKLASSE` dwingt via het type af dat elk nieuw veld van
`Configuration` wordt ingedeeld. De bundels in localStorage (maximaal zes, met
een indexsleutel zodat opruimen niets hoeft te parsen) horen dus bij een
dispatch, niet bij een exacte configuratie. De rasterlogica staat in
`lib/model/raster.ts`, gedeeld tussen worker en build; de reeks huishoudens
(zeven jaarsimulaties, taak `huishoudens`) in `lib/model/huishoudens.ts`, op
dezelfde manier over de helpers verdeeld en in dezelfde bundel bewaard.

## Het standaardantwoord staat klaar

Wie de tool opent zonder iets in te stellen, zag eerst vier seconden een leeg
scherm terwijl de worker vier profieljaren doorrekende. Dat antwoord is voor
iedereen hetzelfde — er zit geen willekeur in het model — dus het wordt bij de
build één keer uitgerekend en als `/voorbeeld.json` meegeleverd, samen met het
nettariefscenario dat in het antwoordblok staat.

Het **raster** van batterijmaten zit er sinds september 2026 ook in. Eerder
niet: tweeënveertig doorrekeningen pasten niet binnen de zestig seconden die
Next.js een statische route gunt en braken de Vercel-build. Met
`staticPageGenerationTimeout` op 180 past het ruim, en zonder het raster in het
bestand rekende elke bezoeker het alsnog zelf (zeventien seconden in de
achtergrondworker), ook bij een treffer op de rest. `VOORBEELD_ZONDER_RASTER=1`
bij de build laat het weg als een bouwmachine te traag blijkt; de pagina bouwt
dan zonder raster in plaats van helemaal niet. De reeks huishoudens (Voor wie)
gaat onder dezelfde vlag mee: zeven jaarsimulaties, een paar seconden.

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

De app staat op Vercel en bouwt bij elke push naar `main`. `vercel.json` houdt
het op `next build`; de configuratie regelt zelf dat een build in `.next` landt
en de export in `out/`, dus Vercel hoeft niets te weten van hoe wij lokaal onze
mappen scheiden.

De data staat al in `public/data/`. Alleen als je die wilt verversen zijn de
Python-scripts nodig — zie [Data verversen](#data-verversen).

## Waar de cijfers vandaan komen

| Wat | Bron | Periode |
|---|---|---|
| Verbruik en teruglevering per kwartier | MFFBAS/EDSN **DYNAMIC** profielfracties, categorie E1A, afnametype AMI (met zonnepanelen) en AZI (zonder) | vanaf 2023-04-01 |
| Uurtarieven | ANWB Energie, marktprijs en all-in, incl. btw | vanaf 2021 |

Beide via de `energiedata-nl` skill.

**Waarom DYNAMIC en niet de standaardprofielen.** DYNAMIC wordt dagelijks
herberekend uit echte meetdata en bevat dus het werkelijke weer. Richting E17 is
wat een huishouden van het net haalt, E18 wat het erop zet — samen precies de
residual load waar de batterij op opereert. Er hoeft daardoor niets aangenomen te
worden over oriëntatie, instraling of zelfconsumptiegraad.

**Met of zonder zonnepanelen.** MFFBAS levert het E1A-profiel voor twee soorten
aansluiting: mét invoeding (AMI, huishoudens met zonnepanelen; de standaard) en
zónder invoeding (AZI). De keuze bovenaan de invoer wisselt tussen die twee
gemeten profielen (`Instellingen.zonnepanelen`, URL `zon`,
`Configuration.afnametype`). Zonder panelen staat de teruglevering op nul en de
opwek ook; de batterij verdient dan alleen aan het prijsverschil over de dag.
De vorm verschilt echt: het AZI-profiel heeft geen middagdip (Liander 2025: 4,7%
van het dagvolume om 12 uur tegen 2,6% bij huishoudens met panelen) en een
lagere nacht. Beide zijn gemeten gemiddelden over alle aansluitingen van die
soort in het netgebied, geen model en geen meting van één huishouden; `tests/zonnepanelen.test.ts`
bewaakt dat verschil. `scripts/build_assets.py` schrijft de AZI-reeksen als
`profile-<gebied>-<jaar>-azi.bin` en zet ze in het manifest onder
`profielen_zonder`. Andere verbruiksscenario's (warmtepomp, elektrische auto)
zijn bewust niet gebouwd: daar bestaat geen gemeten profiel voor en een model
zou als gemeten verbruik gelezen worden.

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
informatie kost. Op de echte data haalt de realistische strategie 74 tot 99% van
het optimum, afhankelijk van de maat van de batterij en het jaar; de app toont
het werkelijke percentage (gemiddeld over de volledige jaren) bij de
verantwoording.

**Dat gat is de weersvoorspelling, niet de prijshorizon.** Gemeten over 2025,
netgebied Liander, 2.500/2.000 kWh. De bedragen zijn een momentopname van een
eerdere modelversie (heffing van toen, oudere slijtagedrempel) en komen niet
meer overeen met de app; de verhoudingen tussen de rijen zijn waar het om gaat:

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
rekenfout en ook geen slijtagedrempel — die is over de hele rij gelijk. Het is
de voorspelfout, uitvergroot door vermogen. Dezelfde rij met een
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

**Standby zit niet in het model.** Het eigen verbruik van de omvormer (7 tot
25 W bij de modellen in de catalogus, bij de Zendure ruim € 20 per jaar) loopt
door of de batterij nu handelt of niet. Het is een vaste post van het bezit,
zoals de aanschaf, en hoort daarom naast de businesscase en niet in de
dagcijfers. Eerder zat het er wél in, en dan trok het elke dag een paar cent van
het resultaat af, ook op dagen waarop de handel winst maakte.

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

### Welke maat loont, en voor wie

De kaart van batterijmaten rekende lang alleen de besparing per maat uit, en
daarop wint de grootste batterij altijd. De weergaven "per kWh" en "per kW"
waren een omweg om de afnemende meeropbrengst zichtbaar te maken zonder te
weten wat een maat kost. Sinds september 2026 weet de kaart dat wél, en
beantwoordt ze de vraag direct: wat blijft er netto over.

**De kostenregel** (`lib/model/kosten.ts`) is één generieke regel, verankerd
aan de gekozen batterij:

```
kosten(cap, kW) = prijs van jouw batterij
                + 320 €/kWh × (cap − jouw cap)
                + 250 €/kW  × (kW − jouw kW)
                + 300 €     zodra je de grens van 0,8 kW oversteekt
```

Waarom generiek en niet per model: uitbreidingspakketten verschillen per merk
(Zendure 1,92 kWh per module, Anker 2,69, HomeWizard en Marstek per hele unit)
en bij de meeste hubs groeit het vermogen niet mee. Per model narekenen maakt de
kaart onvergelijkbaar tussen batterijen. De moduleprijzen liggen bovendien
dicht bij elkaar: 312 €/kWh (Zendure AB2000X), 316 (Anker BP2700), 443
(HomeWizard-unit), 234 (Marstek). De grens van 0,8 kW is de stopcontactlimiet
van 800 W: daarboven legt een installateur een eigen groep aan, gangbaar 300
euro voor één extra groep (tot 1.200 als de meterkast op de schop moet). Die
post zit ook in de presetprijs van de modellen boven 0,8 kW (Marstek Venus E,
Zendure 2400 AC+, Anker Solarbank Max), want aan het stopcontact leveren die
maar 800 W. De drie getallen zijn instelbaar onder Geavanceerd, met bron.

Verankeren aan de gekozen batterij respecteert een eigen offerteprijs, en maakt
de regel padonafhankelijk: in stappen naar een maat toe klikken geeft dezelfde
prijs als in één keer. Een klik in de kaart zet daarom ook de prijs; eerder
rekende de hoofddoorrekening een Zendure van 10 kWh door voor 699 euro. Wie de
maat overschrijft zonder prijs, krijgt nu de kostenregelprijs vanaf de preset.

**Netto resultaat per cel** (`lib/model/dimensionering.ts`) is dezelfde
financiële doorrekening als het antwoord bovenaan: `computeFinance` met
looptijd, prijsstijging, rente, degradatie en cycluslevensduur. Hoe de
besparing terugloopt bij slijtage is alleen voor de gekozen batterij gemeten
(drie curvepunten); de andere cellen lenen de vórm van die curve en schalen hem
op hun eigen niveau. Voor de cel van de eigen batterij is dat exact de gemeten
curve. Het raster zelf is niet veranderd — elke cel is nog steeds één
jaarsimulatie met de lineair geschaalde slijtagedrempel — dus het bewaarde en
vooruitgerekende raster bleef geldig, en looptijd, rente of de kostenregel
verschuiven werkt de kaart direct bij zonder rekenen.

Eén jaar tegenover een gemiddelde: een cel rust op het meest recente volledige
jaar, het hoofdantwoord op het gemiddelde over alle volledige jaren. De cel van
de eigen maat komt daardoor niet precies op het hoofdantwoord uit; de teksten
noemen het jaar.

**Uitbreiden** zet één kolom van de kaart als lijn: netto resultaat tegen
capaciteit bij het vermogen van de eigen batterij, en bij het beste vermogen
uit de kaart als dat een ander is. Het verschil tussen twee stippen gedeeld
door de extra kilowatturen is wat die stap per kilowattuur opleverde; de streep
staat bij de eerste stap waar dat negatief wordt. Dat is het antwoord op
"wanneer is uitbreiden niet logisch meer".

**Voor wie** (`lib/model/huishoudens.ts`) rekent de gekozen batterij door voor
zes terugleverniveaus (0 tot 6.000 kWh) bij de eigen afname, plus één
huishouden zonder zonnepanelen op het gemeten AZI-profiel. Zeven jaarsimulaties
op het rasterjaar, als workertaak `huishoudens` verdeeld over de helpers, en
meegebakken in `/voorbeeld.json`. De ijk: het punt met de eigen teruglevering
is exact de jaarbesparing van het referentiejaar in het hoofdresultaat (test in
`tests/huishoudens.test.ts`). Het eigen huishouden staat als apart punt in de
figuur; waar de lijn de nullijn kruist, komt de batterij uit de kosten.

De regel boven de kaart ("Hoogste uitkomst in deze doorrekening", met jaar en
heffing erbij; bewust geen "advies") volgt uit de cel met de hoogste netto
contante waarde: een stekkerbatterij als de beste maat op of onder 0,8 kW ligt, anders
een batterij met eigen groep, met erbij wat de beste maat aan de andere kant
van de streep oplevert.

### Waar de batterij op stuurt: rendement, zelfconsumptie of uitstoot

De planner kent één taal: een prijs per kwartier voor afname en teruglevering,
plus een slijtagedrempel. De drie doelen (`lib/model/doel.ts`) zijn drie
manieren om het venster aan de solver te geven. **Rendement** is het venster
zoals het is. **Zelfconsumptie** houdt dezelfde prijzen maar bindt de planner
én de uitvoerder de handen: laden alleen uit eigen overschot, ontladen alleen
voor eigen tekort (`alleenEigen` in `planSocPath` en `executePath`); binnen
die grenzen kiest hij nog steeds het goedkoopste moment. Dat is wat de meeste
batterijen standaard doen, en wat veel mensen intuïtief verwachten. **Uitstoot**
zet de emissiefactor van dat uur op de plek van de afnameprijs (200 g wordt
0,20, dus één cent staat gelijk aan tien gram; de slijtagedrempel van 1,8 ct
wordt zo 18 g/kWh) en nul op de plek van de terugleverprijs: teruglevering is
de voetafdruk van wie hem gebruikt. Een negatieve terugleverprijs blijft
negatief zodat afregelen blijft werken. De afrekening (`finalize`, de
CO2-balans) gebruikt altijd het echte venster; alleen het plan verandert.

Het doel zit in het `Window` zelf (`doel`), niet in een optie: zo volgen alle
doorrekeningen (analyse, raster, dagkiezer, huishoudens, optimum) vanzelf
hetzelfde doel zonder dat het door tien aanroepen heen moet. Afwezig betekent
rendement, zodat de hash en de preload van een gewone doorrekening niet
veranderen. Bij sturen op uitstoot is het "optimum" ook in CO2 gerekend; de
euro's van de realistische strategie kunnen er dan bovenuit komen.

De keuze staat bij de invoer, samen met de slijtagestrategie (Zuinig,
Gebalanceerd, Volop; heette "Maximaal rendement", maar dat botste met het doel
Rendement). Elke knop draagt zijn uitleg als tooltip en de regel eronder zegt
wat de stand in centen betekent: drempel per geleverde kWh, en het minimale
prijsverschil bij inkoop tegen 20 ct inclusief omzettingsverlies.

**Wat er door de meter ging** staat sinds september 2026 weer als losse figuur
onder het dagprofiel (`components/Meterprofiel.tsx`): afname boven, teruglevering
onder, stippellijn zonder en vlak met batterij, op dezelfde dag of week. Het
was uit het dagprofiel gehaald omdat het af te leiden was uit het actiepaneel,
maar afleiden is precies wat een lezer niet doet.

### De CO2-balans

Elke kWh uit het net is op dat uur met een bepaalde uitstoot opgewekt. Het
Nationaal Energie Dashboard (ned.nl, TenneT en Gasunie) publiceert per uur de
emissiefactor van de Nederlandse elektriciteitsmix: de totale opwek gedeeld op
haar uitstoot, gram CO2 per kWh, import niet meegerekend. `scripts/fetch_co2.py`
haalt die reeks op (type 27 ElectricityMix, 2023 tot nu, zonder gaten; draai
hem met een Homebrew-Python, de systeem-Python van macOS krijgt een TLS-fout)
en `scripts/build_assets.py --alleen-co2` bakt er `co2-<jaar>.bin` van, één
float32-reeks per uur, zelfde tijdas als de prijzen. De loader rolt hem uit over
de kwartieren met NaN waar de reeks nog geen uur had; die kwartieren tellen
nergens mee en worden geteld. In 2025 lag de factor gemiddeld op 212 g/kWh,
tussen 18 en 460, en zat hij in 26% van de uren onder de 100.

**Het huishouden** (`lib/model/co2.ts`, `huishoudPerspectief`): de uitstoot
van de netafname is per kwartier afname maal factor, zonder en met batterij.
Alleen afname telt; wat je teruglevert is de voetafdruk van wie het gebruikt.
De batterij wint door eigen zonnestroom te bewaren voor de avond (gas) en door,
als hij van het net laadt, dat op een schoner uur te doen dan waarop hij
levert. Voor het standaardhuishouden met de Zendure in 2025: 652 → 542 kg,
110 kg minder, 17%. De omzettingsverliezen zitten erin. De factor is de
gemiddelde van de opwek, niet de marginale (de duurste centrale, vrijwel altijd
gas); marginaal zou de winst groter maken, maar bestaat niet als meetreeks.

**Nederland** (`nederlandPerspectief`): teruglevering is geen verlies als een
buur die kWh gebruikt en er minder uit een centrale hoeft te komen; die
vermeden uitstoot gaat van de afname af. Behalve op uren waarop de mix al onder
een drempel zit (standaard 100 g/kWh): dan is er meer groene stroom dan afname
en gaat de kWh de grens over of wordt hij afgeschakeld. Erik koos de
emissiefactor als maat voor overschot, boven de negatieve prijs of de netto
export: de vraag is of de stroom op dat moment bij de buren nog iets
verdringt, en dat zegt de factor direct. Om de drempel zonder herrekenen te
kunnen verschuiven, bewaart de balans afname en teruglevering per klasse van
20 g/kWh (31 klassen), met per klasse de uitstoot die de teruglevering elders
vermeed. De schuif staat bij de figuur zelf, als afleidingsveld
(`co2DrempelG`), niet in Geavanceerd. Voor het standaardhuishouden 2025: 585 →
486 kg voor Nederland, 99 kg minder; van de 2.000 kWh teruglevering viel 928
kWh in overschot-uren, met batterij nog 691.

De balans zit in elk jaar (`YearKern.co2`) en gemiddeld over de volledige
jaren in het resultaat (`co2`), dus in cache en preload; daarom `MODEL_VERSIE`
14. De dispatch rekent er niet mee, dus de bedragen en het solver-harnas zijn
ongewijzigd. Het tabblad Uitstoot toont het antwoord met tegels
(`Co2Antwoord`), de factor per uur van de dag in winter en zomer met de afname
die de batterij per uur weghaalt (`Co2Uren`), de winst per maand
(`Co2Maanden`) en het Nederlandse perspectief met de drempelschuif en de
teruglevering per klasse (`Co2Nederland`).

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

**Wat een laadbeurt kost.** De dispatch rekent met een schaduwprijs per geleverde
kWh: de volle slijtageprijs `investering ÷ (cycli × bruikbaar × rendement)`
(`wearCostPerKwh`). Een beurt gaat alleen door als de marge na het
omzettingsverlies groter is dan die slijtage. Is de slijtage hoger dan wat de
handel oplevert, dan handelt de batterij niet — dat is de hele regel.

**De strategie** (`Instellingen.slijtageDeel`, URL `slt`, `Configuration.wearFraction`)
bepaalt welk deel van die prijs de planner meerekent. Drie standen in
`lib/strategie.ts`: **Zuinig** (100%: elke beurt verdient zijn eigen slijtage
terug), **Gebalanceerd** (50%) en **Maximaal rendement** (20%: alleen het
capaciteitsverlies dat er over de levensduur toch komt). Een schuif laat elke
waarde ertussen toe. De zichtbare slijtagepost blijft altijd de volle prijs; de
strategie verandert alleen hoe de planner beslist.

Waarom dit een keuze is en geen vaste regel: een thuisbatterij sterft vaak
eerder aan ouderdom dan aan doorzet. De Zendure draait zuinig 279 beurten per
jaar, in vijftien jaar 4.200 van zijn 6.000; ook op de maximale stand (362 per
jaar, 5.400) raakt hij ze niet op. Een extra beurt kost dan in werkelijkheid
minder dan de volle prijs, en de literatuur is het erover eens dat de juiste
drempel de *marginale* slijtage is — wat één beurt extra echt aan levensduur
kost (Xu e.a., *Factoring the cycle aging cost of batteries participating in
electricity markets*, 2018; Schade, *Battery degradation: impact on economic
dispatch*, 2024; The Mobility House over hun optimizer). Die marginale prijs
hangt af van de vraag of de beurten vóór de kalender opraken, en dat weet je pas
achteraf; daarom kiest de gebruiker, en laat het financieringsmodel via
`remainingCapacityFraction` (de zwaarste van kalender- en cyclusslijtage) zien
wat de keuze doet met de terugverdientijd. Op de maximale stand is de
terugverdientijd van de Zendure korter, omdat hij aan zijn kalender sterft en de
extra beurten gratis waren; bij een batterij die wél aan zijn beurten sterft,
slaat dat om.

**De standaard staat op 20%, niet op 100%.** Doorgerekend op vier jaar echte
prijzen, Zendure 800 Pro 2 van EUR 699:

| Deel van de slijtageprijs | Besparing/jaar | Beurten/jaar | Terugverdiend | Contante waarde |
|---|---|---|---|---|
| 1,0 — Zuinig | € 111,67 | 278 | 6,5 jr | € 533 |
| 0,5 — Gebalanceerd | € 115,57 | 312 | 6,3 jr | € 576 |
| **0,2 — Maximaal** | **€ 118,74** | **361** | **6,1 jr** | **€ 610** |
| 0,0 — geen drempel | € 120,09 | 411 | 6,0 jr | € 624 |

Zes duizend beurten over vijftien kalenderjaren is vierhonderd per jaar, en zelfs
zonder drempel haalt de accu er 411. De beurten zijn dus niet het schaarse goed;
de kalender is dat. Elke beurt die een hogere drempel tegenhoudt, is opbrengst
die je laat liggen en niet inhaalt. Niet nul, want doorzet kost altijd
capaciteit: 0,2 is precies het deel dat `remainingCapacityFraction` aan de
beurten toerekent (lineair naar 80%), en de laatste stap naar nul levert nog
maar € 14 contante waarde op tegen vijftig extra beurten per jaar.

Het model kent **geen vervangingsmoment**: de capaciteit zakt lineair door onder
de 80% en er komt nooit een nieuwe accu. Dat zou een te lage drempel kunnen
belonen, maar hier gebeurt dat niet — de beurten raken niet op. Over vijftien
jaar verbruikt de Zendure 3.833 van zijn 6.000 beurten op de zuinige stand
(64%), 4.965 op 20% (83%) en 5.643 zonder drempel (94%). Op 20% blijft er ruim
een zesde over; de soepelheid van het financieringsmodel wordt dus nergens
uitgebuit. Op 0% wordt die marge krap, en dat is de tweede reden om daar niet te
gaan zitten.

Voor een accu die zijn beurten wél opmaakt binnen de looptijd mist het model die
klif, en is "Zuinig" de veiliger stand. Daarom blijft hij kiesbaar.

Let op bij het lezen van de cijfers: de slijtagepost is **geen kostenpost naast
de besparing**. Hij is de aanschafprijs, verdeeld over de beurten, en de
aanschafprijs zit al volledig in de terugverdientijd. "Besparing min slijtage"
telt die prijs dus twee keer en is geen betekenisvol getal.

**De figuur "Laadbeurten over de levensduur"** (`components/Laadbeurten.tsx`, in
het tabblad Wat als vóór de cashflow) maakt die afweging zichtbaar: de
opgetelde beurten uit `finance.cashflows` tegenover de cycluslevensduur
(horizontale streep) en de kalenderlevensduur (verticale streep). Waar de lijn
het eerst tegenaan loopt, daaraan sterft de batterij. De kerncijfers noemen de
drempel van de planner in centen en het minimale prijsverschil dat daaruit
volgt: om 1 kWh te leveren koop je 1/η² kWh in, dus bij inkoop tegen 20 ct moet
de verkoopprijs minstens `20/η² + drempel` zijn. De uitleg achter de knop legt
in vier stappen uit wat de drempel is, hoe de planner hem gebruikt, waarom je
hem wilt en waarom hij een keuze is.

Tot september 2026 zat er een vaste marginale drempel in: 20% zolang de beurten
niet schaars waren, oplopend bij schaarste, met een proefrun om dat te bepalen.
Die liet de batterij handelen op dagen waar de beurt méér aan slijtage kostte
dan hij opleverde (18 december 2025: € 0,07 opbrengst tegen € 0,12 slijtage)
zonder dat de gebruiker daar iets over te zeggen had. Dat is nu de expliciete
stand Volop (voorheen "Maximaal rendement"), en die is ook de standaard:
`STANDAARD_SLIJTAGEDEEL` = 0,2 in `lib/strategie.ts`.

**Het seizoensprofiel** (`seasonProfiles` in het resultaat) is de gemiddelde dag
van winter en zomer: per uur van de dag hoeveel er van het net kwam en hoeveel
er op ging, zonder en met batterij. Sommen per uur worden over de volledige
jaren opgeteld en pas daarna gedeeld door het aantal dagen, anders weegt een jaar
met minder dagen even zwaar. De seizoensgrens is dezelfde als die van het
nettarief: zomer is april tot en met september. Uren in lokale tijd — een
avondpiek is een wandklokbegrip.

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

**Waarom de batterij een dag met een kleine marge laat liggen.** Op 18 december 2025
kocht de Zendure 's nachts 1,8 kWh in bij 19 cent en leverde er 1,6 aan het huis
bij 26 cent. Na het omzettingsverlies bleef er **€ 0,067** over, terwijl de
slijtage van die beurt € 0,12 was tegen de volle aanschafprijs per kWh. Toen het
standby-verbruik nog in het model zat, kwam de dag op € 0,00 uit en las hij als
slijtage voor niets; dat was de reden om standby eruit te halen en de slijtage
apart te tonen. En het was de reden om de planner met de volle slijtageprijs te
laten rekenen: sinds die wijziging laat hij zo'n dag voorbijgaan.

**Geen prijsstijging als uitgangspunt.** De standaard voor de jaarlijkse
prijsstijging staat op 0% (was 2%, de inflatiedoelstelling, geen energieprijs-
verwachting). Wat een batterij verdient is het gat tussen afname en
teruglevering: energiebelasting plus opslag plus het prijsverschil over de dag.
De energiebelasting op stroom daalt van 2025 op 2026 en staat voor 2026 en 2027
vast op 11,1 ct/kWh incl. btw, als onderdeel van de lastenverschuiving van
stroom naar gas; PBL noemt de prijsontwikkeling tot 2030 "zeer onzeker" en geeft
alleen bandbreedtes. De schuif blijft voor wie anders verwacht.

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
heffing in september van 17,13 naar 14,29 ct. Standaard rekent de tool met de
heffing van nu (die van het meest recente prijsjaar, over alle jaren): dat past
bij een batterij die je vandaag koopt, en het antwoord zegt dat ook ("met de
belasting en opslag van nu"). De heffing van toen lag in 2024 en 2025 een kwart
tot een derde hoger, en de besparing schaalt daar bijna één-op-één mee; wie
daarmee wil rekenen kiest "van toen" bij de instellingen.

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

Het model rekent standaard met de netbeheerkosten zoals ze nu zijn: los van je
gedrag, en dus buiten de besparing. Dat gaat veranderen. Het transporttarief wordt
tijdsafhankelijk: het codewijzigingsvoorstel van de netbeheerders ligt sinds
1 mei 2026 bij de ACM, die naar verwachting voor eind 2026 beslist. Een derde van
het transporttarief wordt een capaciteitscomponent op de doorlaatwaarde van de
aansluiting; de rest gaat afhangen van wanneer en hoeveel je gebruikt. Vijf
tijdsblokken per dag, vijf tariefhoogten in totaal en hoogstens vier per dag, twee
seizoenen (zomer april tot en met september), geen onderscheid tussen weekdag en
weekend. Invoering is in beginsel 1 januari 2029, met drie uitwijkgronden naar
1 januari 2030.

**Wat vaststaat zijn de wegingsfactoren**, bijlage 5 van het voorstel: per uur en
per seizoen een factor uit {0; 0,3; 0,5; 0,7; 1,0}. **Wat niet vaststaat is het
basistarief.** `lib/nettarief.ts` neemt de factoren letterlijk over en zet er een
prognose van CE Delft onder (Beheersbare energiekosten voor huishoudens in 2030,
september 2026, op basis van Netbeheer Nederland 2026b en 2026c): EUR 0,191 per
kWh in 2030, inclusief btw, geijkt op een huishouden van 3.000 kWh met EUR 335
aan volume- en tijdsafhankelijk transporttarief. CE rekent met 7,5% stijging per
jaar; het scenario rekent met het niveau van 2029 (EUR 0,178), de beoogde
invoeringsdatum. De interface liet je hier eerst tussen 2029 en 2030 kiezen; dat
is eruit. Het was een keuze over een aanname in een scenario dat zelf al een
aanname is, en wie wil weten wat een batterij oplevert, wil niet eerst beslissen
welk prognosejaar hij aanhoudt. 2030 blijft in `BASISTARIEF` staan: het is de
uitwijkdatum uit het voorstel en de basis waaruit 2029 volgt. Figuur 4 van het rapport is precies factor × basistarief,
afgerond op centen:

| Uur | 0 | 1–6 | 7–9 | 10–15 | 16 | 17–18 | 19–22 | 23 |
|---|---|---|---|---|---|---|---|---|
| **okt–mrt** | 0,7 | 0,5 | 0,7 | 0,5 | 1,0 | 1,0 | 1,0 | 0,7 |
| **apr–sep** | 0,5 (0–2), 0,3 (3–6) | | 0,3 | 0,0 | 0,0 | 0,3 | 0,7 | 0,7 |

De winterpiek loopt van 16:00 tot en met 22:00; in de zomer begint de piek pas om
19:00 en loopt hij door tot en met 23:00, terwijl de middag van 10:00 tot en met
16:00 gratis is. `tests/nettarief.test.ts` vergelijkt de factoren met het
voorstel en de bedragen van 2030, op centen afgerond, cel voor cel met Figuur 4.

**De heffing in het scenario.** Het nettarief komt bovenop de energiebelasting en
de inkoopopslag. Op de historische prijzen staat de heffing van toen, 13 tot 17
cent; in 2029 en 2030 ligt de energiebelasting volgens CE Delft op EUR 0,075
respectievelijk 0,076 per kWh exclusief btw. Het scenario rekent daarom met de
heffing van het scenariojaar (energiebelasting van dat jaar plus de opslag zoals
die in 2026 in de data zit, ongeveer 11,2 ct in 2029) in plaats van die van toen.
Anders stapelt het een nettarief van 2030 op een belasting van 2024, en de
besparing schaalt bijna één-op-één met de heffing. `scenarioConfiguratie` in
`lib/nettarief.ts` is de ene plek waar het scenario wordt afgeleid, voor de
hoofdpagina, de build van het standaardantwoord en de vergelijker; anders zou de
cachesleutel op drie plekken net anders uitkomen.

Dat verandert de businesscase ingrijpend, want de piek valt op de uren waarop een
batterij levert en het nultarief op de uren waarop hij laadt. De winst zit vooral
in de winter, precies het seizoen waarin de accu nu bijna stilstaat.

Het vaste deel — de capaciteitscomponent (EUR 167 in de CE-doorrekening) plus
aansluitvergoeding en meetdienst (EUR 135) — blijft buiten de berekening, want
dat is met en zonder batterij gelijk. Het voorstel beprijst uitsluitend afname;
een tarief op invoeding zou een nieuw voorstel vergen. De schakelaar om het
tarief ook op teruglevering te heffen is dus een wat-als en staat standaard uit.
De prognose is gedragsonafhankelijk: als veel huishoudens de piek mijden, herijken
de netbeheerders blokken en factoren jaarlijks, en dat zit hier niet in.

Het variabele deel telt in dit scenario dus wél mee in de besparing, anders dan
de vaste netbeheerkosten hieronder. Dat is geen inconsistentie maar het hele
punt: zodra netkosten van je gedrag afhangen, zijn ze niet meer gelijk met en
zonder batterij.

### Wat er niet in zit

- Het vaste deel van de netbeheerkosten en de belastingvermindering.
  Die zijn met en zonder batterij gelijk en beïnvloeden de besparing niet; de
  getoonde bedragen zijn de variabele stroomkosten. Het tijdsafhankelijke deel
  van het nettarief is daar vanaf 2029 de uitzondering op — zie hierboven.
- Terugleverkosten-staffels per leverancier — wel als één instelbare €/kWh.
- Het profiel is een gemiddelde over veel huishoudens en daardoor gladder dan één
  aansluiting. Of dat de waarde van een batterij onder- of overschat, is niet
  onderbouwd; de spreidingsfactor laat zien hoe gevoelig de uitkomst ervoor is.
- Het eigen stroomverbruik van de batterij (standby, typisch 7 tot 25 W, 60 tot
  220 kWh per jaar). Bewust niet gemodelleerd; de pagina zegt dat bij het
  antwoord en in de Methode-tab.
- De uitstoot van het maken van de batterij. De CO2-cijfers zijn een
  toerekening met de gemiddelde (niet de marginale) uitstoot per uur.
- Kwartierprijzen. Sinds 1 oktober 2025 zijn day-ahead-prijzen per kwartier;
  de ANWB-API levert uurprijzen, sinds 20 juni 2026 afgerond op hele centen.

## Structuur

```
app/                    pagina, thema
components/             invoer en visualisaties
lib/model/              solver, strategieën, batterij, tarieven, financiën
lib/data/               loader, DST-veilige tijdas, manifest
lib/worker/             rekenworker, pool en protocol
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
DYNAMIC loopt twee dagen achter en recente dagen kunnen nog wijzigen. Het script
vult alleen ontbrekende dagen aan en haalt dagen die er al staan niet opnieuw
op, ook niet als EDSN ze later corrigeert. Wil je de laatste maanden verversen,
haal die dagen dan eerst uit `data/raw/dynamic/<netgebied>.csv` (of verwijder het
bestand) en draai het script opnieuw.

Prestaties: ongeveer 410 ms voor de realistische strategie en 270 tot 325 ms
voor het optimum per profieljaar (`tests/pipeline.test.ts` drukt het af). Eén
doorlopende `runAnalysis` over vier vensters is elf jaarsimulaties, ruim 3,9 s;
in de browser lopen die stukken parallel over de pool. Er is geen proefrun meer
om de slijtagedrempel te bepalen: die staat vooraf vast, zodat elk jaar en elk
rasterpunt precies één realistische doorrekening kost.

De binnenste lus van de solver is bewust niet verder geoptimaliseerd: delingen
vervangen door vermenigvuldigingen gaf tot 30% winst maar veranderde het antwoord
met twaalf cent per jaar, doordat het laatste bit een keuze tussen bijna gelijke
kandidaten kan kantelen. Bit-identieke ingrepen zijn ook geprobeerd, in
september 2026: de t-invariante grootheden (lading, grenzen en tussenwaarden
per niveau) vooraf in tabellen en de werkbuffers hergebruiken over de 366
plannen van een jaar. Aantoonbaar hetzelfde antwoord, maar gemeten trager
(365 plannen 371 → 401 ms, het jaarplan van het optimum 258 → 415 ms): de
geheugenlezingen kosten meer dan de vermenigvuldigingen die ze uitsparen. Het
harnas dat dit bewijst staat in `tests/solver-referentie.test.ts`, met een
letterlijke kopie van de solver en vastgelegde kosten en hashes van de
dispatch; wie het nog eens probeert, heeft daarmee de meetlat. De snelheid komt
uit parallelle workers per profieljaar, niet uit de rekenkunde.
