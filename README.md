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
opslag van nu, geen persoonlijk advies en geen garantie. De tool is van ANWB,
die ook energie en thuisbatterijen verkoopt; dat staat ook op de pagina.

De app draait volledig in de browser. Geen backend, geen API-calls tijdens
gebruik, alles vanaf de CDN.

## Aan de slag

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 721 tests, waaronder de modelinvarianten
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

## Stap voor stap: de begeleide route

Zonder tabblad in de link opent de tool een begeleide route in vijf stappen,
voor wie de tool voor het eerst ziet. In de kop wissel je tussen **Stap voor
stap** en **Alle cijfers** (de zeven tabbladen hieronder).

| Stap | Kop | Wat er gebeurt |
|---|---|---|
| 1 Jouw huis | Hoe ziet jouw huis eruit? | zonnepanelen ja of nee, afname en teruglevering van de jaarafrekening, netgebied |
| 2 Jouw batterij | Welke batterij wil je doorrekenen? | een kaart per batterij (stopcontact of installateur), het doel |
| 3 Wat hij doet | Wat doet de batterij op een dag? | een gewone zomer- of winterdag als film, per kwartier; daarna de jaarcijfers 's avonds en overdag |
| 4 Wat het oplevert | Wat had hij je opgeleverd? | de besparing per jaar, waar die vandaan komt, terugverdienen met en zonder nettarief, "Dit is geen voorspelling" |
| 5 Past het bij je? | Past een thuisbatterij bij jou? | een oordeel op de terugverdientijd tegen de levensduur, een checklist, een betere maat als die er is, delen |

De stappen rekenen niets zelf: ze lezen dezelfde doorrekening en schrijven
dezelfde instellingen als de tabbladen (contract in `components/gids/types.ts`).
Pas bij "Volgende" naar stap 3 wordt gewijzigde invoer doorgerekend. De stap
staat in de URL (`?stap=3`); een link met alleen instellingen opent bij stap 4,
het antwoord. Een link met `?tab=` of een figuuranker (`#per-maand`) opent
direct Alle cijfers, zodat bestaande links blijven werken. Het oordeel op stap
5 staat in `oordeel()` in `components/gids/uitkomst.ts`: onder 8 jaar "ruim
binnen de levensduur", tot en met de levensduur "terug, maar het duurt lang",
daarboven of nooit "niet terug". Een andere maat noemt stap 5 pas bij minstens
100 euro meer netto resultaat.

## De pagina: zeven tabbladen, elk over één onderwerp

De balk bovenaan heeft zeven tabbladen. Het label is een onderwerp, geen
vraagwoord: wie de balk leest, ziet waar iets over gaat. Het open tabblad staat
in de URL (`?tab=terugverdienen`); de panelen blijven gemount, zodat het
dagprofiel zijn gekozen dag houdt.

| Tab | Kop | Op dit tabblad |
|---|---|---|
| **Uitkomst** | Wat had een thuisbatterij je opgeleverd? | invoer, het antwoord (nu én met het nettarief vanaf 2029), cijfers op een rij, instellingen, bewaren |
| **Besparing** | Waar komt de besparing vandaan? | prijsverschil, opbouw van de besparing, verliezen |
| **Door het jaar** | Wanneer bespaart de batterij het meest? | per jaar, per maand, zomer- en winterdag, verloop over tijd, een dag of week van dichtbij |
| **Terugverdienen** | Verdient de batterij zichzelf terug? | over de looptijd, laadbeurten en levensduur, nettarief van 2029 |
| **Welke batterij** | Welke batterij past bij jou? | maat en vermogen, uitbreiden, sturing, voor wie |
| **CO2** | Wat scheelt de batterij aan CO2? | jouw CO2, CO2 per uur, CO2 per maand, CO2 voor Nederland |
| **Aannames en bronnen** | Hoe hard zijn deze cijfers? | de data en het model, wat we niet weten, bronnen |

**Elk tabblad opent op dezelfde manier.** Eerst een eyebrow met het label en wat
je er vindt, dan één vraag als kop, twee zinnen intro en een regel "Op dit
tabblad" met links naar de figuren. Wie de tool doorneemt, weet zonder te
scrollen wat er staat.

**Elke figuur heeft een vaste naam en een anker.** De titel van een figuur is
een conclusie die met de invoer meebeweegt ("De batterij verdient zijn geld in
de zomer", of in de winter). Daarboven staat een vaste naam ("Per maand"), en
daar kun je in een tekst naar verwijzen. Die naam is een link naar de figuur
zelf: `?tab=door-het-jaar#per-maand` opent het tabblad en scrolt ernaartoe, en
een anker zonder `?tab=` vindt zelf het goede tabblad. De namen, ankers en
volgorde staan op één plek, in `TABS` in `components/Tabs.tsx`;
`tests/tabs-uitleg.test.tsx` bewaakt dat elk anker een element heeft.

**Oude links blijven werken.** Tot september 2026 heetten de tabbladen Start,
Waarom, Wanneer, Wat als, Uitstoot en Methode. Ze heten nu Uitkomst, Besparing,
Door het jaar, Terugverdienen of Welke batterij, CO2 en Aannames en bronnen.
`leesTab()` stuurt de oude ids naar het nieuwe tabblad. `?tab=wat-als` komt uit
op Welke batterij, omdat de meeste figuren van dat oude tabblad daar staan.

**Twee manieren om van tabblad te wisselen.** De tablist in de balk is er om
ergens naartóé te springen; de stapper onder aan de pagina is er om verder te
lezen — chevron naar links, chevron naar rechts, en daartussen een pil met het
tabblad waar je staat. Die pil is letterlijk een venster: alle zeven titels
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

**De kerncijfers leiden met percentages.** Eigen verbruik, zelf gedekt (het deel
van je verbruik uit eigen panelen) en afname in de piekuren staan vooraan, elk met de verandering
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

**Geavanceerde instellingen** staan op Uitkomst in een `<details>`, geordend op wat
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
(laadbeurten × bruikbaar × rendement)` per kWh (`wearCostPerKwh`). Die post zit al in
de aanschafprijs die de terugverdientijd rekent en wordt daarom niet van de
besparing afgetrokken, maar hij is overal zichtbaar: als tegel bij de cijfers
(`KeyStats.wearCostPerYearEur`), per jaar (`YearAnalysis.wearCostEur`), per dag
(`SampleDayStats.wearCostEur`) en per vak in het periodeverloop. De aansturing
rekent met dezelfde prijs als drempel: is de slijtage hoger dan wat een laadbeurt
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
gaat onder dezelfde vlag mee: zeven jaarsimulaties, een paar seconden. En de
vergelijking van de doelen ook: zelfconsumptie en uitstoot, elk op de tarieven
van nu (met de voorbeelddag) en met het nettarief, vier doorrekeningen zonder
optimum.

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
| Uurtarieven | ANWB Energie, marktprijs en all-in, incl. btw | vanaf 2023 (sinds 20-06-2026 op hele centen) |

Beide via de `energiedata-nl` skill. Technisch komen de uurtarieven uit de
ANWB-API (`https://api.anwb.nl/energy/energy-services/v2/tarieven/electricity`,
zie `scripts/fetch_prices.py`); die geeft zonder de juiste parameters HTTP 400,
dus de pagina verwijst bezoekers naar de publieke tarievenpagina
(`https://www.anwb.nl/energie/actuele-tarieven`).

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

## De batterijcatalogus

`PRESETS` in `lib/presets.ts` is de lijst waaruit de bezoeker kiest, geordend
per merk: eerst Zendure (het ANWB-assortiment, van klein naar groot), dan Sessy,
AlphaESS, Anker, HomeWizard, Marstek en als laatste de generieke thuisaccu's.
`perMerk()` geeft die groepen aan de keuze in stap 2 (kopje met logo, bij
Zendure het label "Verkrijgbaar bij ANWB"), aan de `<optgroup>`'s van de
keuzelijst en aan de bronnenlijst. Peildatum van de prijzen: 1 oktober 2026
(de generieke thuisaccu's 24 september).

Elke preset draagt, naast maat en prijs, waar de twee onzekerste getallen
vandaan komen: `rendementBron` (`gemeten`, `eigenaren`, `afgeleid`, `datasheet`
of `aanname`, met `rendementNoot`) en `standbyBron` (`gemeten`, `schatting`,
`fabrieksopgave` of `aanname`, met `standbyNoot`). Een kaart in stap 2 zegt het
erbij zodra het rendement niet gemeten is. `bronnen` bevat elke URL achter de
getallen; de bronnenlijst bij "Aannames en bronnen" toont ze allemaal.

| id | Model | kWh | kW | Prijs | Rendement | Stand-by | ANWB |
|---|---|---|---|---|---|---|---|
| zendure-800pro2 | Zendure SolarFlow 800 Pro 2 | 1,92 | 0,8 | € 699 | 84% afgeleid (voorganger 83 tot 85%, thuisbatterijgids 82%) | 8 W schatting | ja |
| zendure-1600ac | Zendure SolarFlow 1600 AC+ | 1,92 | 1,4 | € 1.029 | 87,6% gemeten | 3 W gemeten | ja |
| zendure-2400ac | Zendure SolarFlow 2400 AC+ | 2,4 | 2,4 | € 1.149 | 88% gemeten | 3,4 W gemeten | ja |
| zendure-2400pro | Zendure SolarFlow 2400 Pro | 2,4 | 2,4 | € 1.269 | 88% afgeleid van de 2400 AC+ | 3,4 W schatting | ja |
| zendure-3000mix | Zendure SolarFlow 3000 Mix AC+ | 8,0 | 3,0 | € 2.048 | 86% gemeten | 13 W schatting | ja |
| zendure-800plus | Zendure SolarFlow 800 Plus | 1,92 | 1,0 laden, 0,8 leveren | € 509 | 84% gemeten (83 tot 85%) | 8 W schatting | nee (TechPunt) |
| sessy-5kwh | Sessy 5 kWh | 5,5 (5,2 bruikbaar) | 2,2 laden, 1,7 leveren | € 3.850 | 82% door eigenaren gemeten | 3 W fabrieksopgave | nee |
| sessy-10kwh | Sessy 10 kWh | 11 (10,4 bruikbaar) | 2,2 laden, 1,7 leveren | € 5.800 | 82% door eigenaren gemeten | 3 W fabrieksopgave | nee |
| sessy-plus | Sessy Plus 15 kWh (voorverkoop) | 15 | 6 | € 10.000 | 85% aanname | 5 W aanname | nee |
| alphaess-vitapower3600 | AlphaESS VitaPower 3600 AC (voorverkoop) | 4 | 2,0 | € 1.299 | 85% aanname | 10 W aanname | nee |
| anker-solarbank3 | Anker SOLIX Solarbank 3 E2700 Pro | 2,69 | 0,8 | € 1.199 | 80% gemeten | 12 W schatting | nee |
| anker-solarbank-max | Anker SOLIX Solarbank Max AC | 7 | 3,5 | € 2.299 | 83,5% gemeten | 31,6 W gemeten | nee |
| homewizard-plugin | HomeWizard Plug-In Battery | 2,7 | 0,8 | € 1.220 | 80% gemeten (78,4%) | 6 W gemeten | nee |
| marstek-venus-e3 | Marstek Venus E 3.0 | 5,12 | 2,5 | € 1.499 | 83% gemeten | 7 W gemeten | nee |
| thuisaccu-5kwh | Thuisaccu 5 kWh, geïnstalleerd | 5 | 2,5 | € 3.750 | 90% aanname | 20 W schatting | nee |
| thuisaccu-10kwh | Thuisaccu 10 kWh, geïnstalleerd | 10 | 3,6 | € 5.750 | 90% aanname | 25 W schatting | nee |

Wat de tabel niet zegt:

- **Eén vermogen per batterij is het leververmogen.** De stekkergrens van
  800 W gaat over terugleveren aan het stopcontact; laden mag hoger. De
  Zendure 800 Plus laadt met 1.000 W en levert 800 W, en is dus gewoon een
  stekkerbatterij (geen eigen groep). Hij staat niet in de ANWB-webwinkel; de
  prijs is die van TechPunt (479 euro) plus 30 euro voor de P1-uitlezer.
- **Prijzen boven 0,8 kW** bevatten de eigen groep door een installateur
  (300 euro) of de installatie (Sessy: 300 euro aangenomen, bronnen noemen 225
  tot 400; Sessy Plus: de 600 euro basisinstallatie in plaats van de 300). De
  Anker Solarbank 3 staat op de actieprijs van de Herfst Sale (tot 12 oktober
  2026, daarna 1.599 euro), de AlphaESS op de voorverkoopprijs (tot 29 oktober
  2026, daarna 1.699 euro).
- **Laden en leveren los.** Bij Sessy laadt de batterij met 2,2 kW en levert hij
  1,7 kW. `spec()` neemt een apart ontlaadvermogen aan en `BatterySpec` krijgt
  beide (`maxChargeKw`, `maxDischargeKw`). `vermogenKw` van de preset is het
  hoogste van de twee en dient voor weergave, de kostenregel en de
  stekkergrens (`vermogenVan` in `lib/model/kosten.ts`). Wie bij Geavanceerd
  een eigen vermogen invult, zet laden én leveren op dat getal; het raster rekent
  altijd symmetrisch.
- **AlphaESS VitaPower 3600 AC:** 2,0 kW, omdat de basismodule intern maximaal
  ongeveer 2.000 W levert (energienerds.nl, p1meter.nl); AlphaESS zelf noemt
  3,68 kW met een installateur. Het bruikbare deel is de uniforme 90% (het
  datasheet noemt 95%).
- **Zendure 2400 Pro** is een hybride met vier MPPT-ingangen voor panelen; de
  tool rekent alleen de AC-kant. De AB3000L is alleen een uitbreidingsaccu en
  staat er niet in.
- **Marstek:** de Consumentenbond mat 4,3 kWh bruikbaar van de 5,12 kWh, dus de
  uniforme 90% is gunstig.
- **Rendement door eigenaren (Sessy)** is geen testorganisatie: eigenaren meten
  over maanden ongeveer 82%, het datasheet noemt 85%.
- **Logo's** staan lokaal in `public/logos/` (de CSP laat alleen `img-src 'self'`
  toe); de bron per logo staat in `components/MerkLogo.tsx`.

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

**Waarom meer vermogen soms minder oplevert.** Momentopname van een oudere
modelversie en een ouder raster (met 1 kWh en 0,5 kW, dat er nu niet meer in
staat): in het raster van batterijmaten zakt de besparing op de kleinste maten
iets als het vermogen omhooggaat: bij 1 kWh van € 47,43 bij 0,8 kW naar € 46,49
bij 5 kW, twee procent. Dat is geen rekenfout en ook geen slijtagedrempel — die
is over de hele rij gelijk. Het is de voorspelfout, uitvergroot door vermogen.
Dezelfde rij met een perfecte verbruiksvoorspelling loopt netjes op:

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

**Stand-by zit in de jaarbesparing en de terugverdientijd, niet in de dispatch
en niet in de dag.** Het eigen verbruik van de batterij als hij niet laadt of
ontlaadt (3 tot 32 W bij de modellen in de catalogus; `standbyWatt` per preset in
`lib/presets.ts`) is een vaste post van het bezit. De eigenaar wil het in de
terugverdientijd en de jaarlijkse besparing, alleen niet in het handelsalgoritme
op een dag. Daarom rekent `standbyKosten` (`lib/model/analysis.ts`) het achteraf,
per kwartier, op de dispatch die er al is, en trekt het af van de vensteruitkomst:

- Alleen in kwartieren waarin de batterij niet laadt en niet ontlaadt. Tijdens
  laden en ontladen zit het eigen verbruik al in het gemeten
  rondgangsrendement; de rendementen komen uit losse laad-ontlaadrondes bij een
  vast vermogen (energienerds.nl: HomeWizard 78,4% over vier rondes, Marstek
  ongeveer 83%, Zendure 2400 AC+ 88,15%) en bevatten de stand-by bij stilstand dus niet. Zo is er geen
  dubbeltelling.
- Gewaardeerd op de situatie met batterij, met dezelfde prijzen als de dispatch
  (all-in afnameprijs inclusief heffing en, in het scenario, het nettarief): haalt
  het huis dat kwartier stroom van het net, dan tegen de afnameprijs, anders
  tegen de terugleverprijs (de stroom die je anders had geleverd; een negatieve
  prijs mag, dan levert stand-by iets op). Met afregelen aan en een negatieve
  prijs was dat overschot toch weggegooid en kost het niets.
- Het resultaat staat in `YearKern.standbyKwh` en `standbyCostEur`, als negatieve
  post `standbyEur` in `SavingBreakdown` (zodat de posten optellen tot
  `totalEur`), in de maandtotalen en in `realisticSavingEur`. Het optimum draagt
  zijn eigen stand-by, zodat het ideale geval en de capture rate vergelijkbaar
  blijven. Alles wat erop rust erft het: jaarschaling bij deelperiodes, het
  gemiddelde, de bandbreedte, de besparingscurve (kleinere capaciteiten met
  dezelfde watt), de financiën en de terugverdientijd, het nettariefscenario, de
  overgang, het raster en de huishoudens.
- NIET: de dispatch, de dagstatistieken (`dayStats`, de voorbeelddagen), de
  periodereeksen voor Verloop, de CO2-balans en de kWh-kerncijfers. De dag laat
  de handel zien; stand-by is een vaste post van het bezit die in het jaar en de
  terugverdientijd zit. Een dag zonder stand-by kan zo nooit meer op € 0,00
  uitkomen door iets dat er niet bij hoort.

De waarden staan met hun soort bron in de catalogustabel. Gemeten door
energienerds.nl: HomeWizard Plug-In 6 W (standaardstand met AC aangesloten; 0,52
W in de API-stand-by), Marstek Venus E 3.0 7 W (met een HomeWizard-slimme
stekker), Zendure 1600 AC+ 3 W en 2400 AC+ 3,4 W (telkens wat via het net
binnenkomt plus wat de omvormer intern verbruikt) en Anker Solarbank Max AC
31,6 W (2,6 W net, 29 W intern). Sessy geeft 3 W op. Zendure 800 Pro 2 8 W,
Zendure 2400 Pro 3,4 W, Zendure 3000 Mix AC+ 13 W, Anker Solarbank 3 12 W en de
generieke thuisaccu's van 5 en 10 kWh 20 en 25 W zijn een schatting; Sessy Plus
5 W en AlphaESS VitaPower 10 W een aanname. De gebruiker kan
het overschrijven bij de geavanceerde instellingen (`Instellingen.standbyWatt`,
URL-sleutel `sb`, 0 tot 100 W, leeg is de waarde van de batterij; een
batterijwissel zet het terug op leeg). Bij 8 W en de standaardinvoer is het 47,5
kWh per jaar (de batterij staat ongeveer twee derde van de kwartieren stil) en
€ 8,93; de besparing gaat van € 105,45 naar € 96,52 per jaar en de
terugverdientijd met de overgang naar het nettarief van 5,0 naar 5,3 jaar (zonder
overgang van 6,9 naar 7,6 jaar). In de cache is `standbyWatt` een
dispatch-veld (`VELDKLASSE` in `lib/cache.ts`): de dispatch verandert niet, maar
de bewaarde bundel bevat de aftrek, en die moet bij een andere waarde opnieuw
berekend worden.

**Waar dat gat vandaan komt.** Twee dingen weet een echte batterij niet: de
prijzen van morgen vóór de publicatie om 13:00, en hoeveel zon en verbruik
morgen brengt. Die twee zijn te scheiden door de strategie nog eens te laten
draaien met de werkelijke residual als "voorspelling", en dat is wat
`computeStrategyGap` doet. Momentopname van een oudere modelversie, gemeten op
Liander 2025 (de verhoudingen gelden, de bedragen niet meer):

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

**Het raster** (`lib/model/raster.ts`) is 7 capaciteiten (2, 3, 5, 7,5, 10, 15 en
20 kWh) bij 6 vermogens (0,8, 1,2, 2,4, 3,6, 5 en 10 kW): 7 × 6 = 42
doorrekeningen, elk één jaarsimulatie.

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
euro voor één extra groep (powerplugs.nl: 100 tot 200 euro in een
standaardsituatie, 300 tot 600 euro bij een volle meterkast; de tool rekent met
300 euro). Die post zit ook in de presetprijs van de modellen boven 0,8 kW (Marstek Venus E,
de Zendure-modellen vanaf de 1600 AC+, Anker Solarbank Max AC, AlphaESS), want aan het stopcontact leveren die
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

De aansturing (de software die bepaalt wanneer de batterij laadt en levert) kent
één taal: een prijs per kwartier voor afname en teruglevering,
plus een slijtagedrempel. De drie doelen (`lib/model/doel.ts`) zijn drie
manieren om het venster aan de solver te geven. **Rendement** is het venster
zoals het is. **Zelfconsumptie** houdt dezelfde prijzen maar bindt de aansturing
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
Gebalanceerd, Volop; Volop heette eerst "Maximaal rendement", maar dat botste met
het doel Rendement). Elke knop draagt zijn uitleg als tooltip en de regel eronder zegt
wat de stand in centen betekent: drempel per geleverde kWh, en het minimale
prijsverschil bij inkoop tegen 20 ct inclusief omzettingsverlies.

**De drie doelen naast elkaar** staan onder Sturing op het tabblad Welke batterij
(`components/Doelvergelijking.tsx`): per doel een kaart met besparing, CO2-winst
voor het huishouden, eigen verbruik, netafname en teruglevering, laadbeurten en
de terugverdientijd met de overgang naar het nettarief (dezelfde grondslag als
het antwoord bovenaan), het gekozen doel gemarkeerd, en daaronder dezelfde
zomerdag drie keer. "Reken hiermee" zet het doel in de instellingen en rekent
door. Het gekozen doel ís het antwoord en zijn scenario; de andere twee rekent
`useAnalysis` als achtergrondgroep in de pool (scenario-doorrekening zonder
optimum, plus de dag uit de dispatch bij het samenvoegen), pas als het tabblad
open is en vóór het raster in de rij. Wat er per doel bewaard wordt is klein
(`VergelijkingDeel` in `lib/model/vergelijking.ts`) en hangt in het geheugen aan
`dispatchSleutel` van de werkconfiguratie; een eerder antwoord met dat doel uit
de browsercache telt ook. Zo rekent terugwisselen van doel niets opnieuw. De
hoofddoorrekening en haar scenario krijgen voorrang in de pool (`voorrang` in
`PoolTaak`), zodat "Reken hiermee" niet achter de vergelijking of het raster
wacht. `tests/vergelijking.test.ts` bewaakt dat het gekozen doel bit-gelijk is
aan het antwoord, dat zelfconsumptie niet via de batterij met het net handelt,
en de rangorde op de standaardinvoer.

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
levert. Voor het standaardhuishouden met de Zendure, gemiddeld over de volle
jaren 2024 en 2025: 627 → 522 kg, 105 kg minder, 17%. De omzettingsverliezen zitten erin. De factor is de
gemiddelde van de opwek, niet de marginale (de duurste centrale, vrijwel altijd
gas). Met een marginale factor kan de uitkomst juist ongunstiger uitvallen:
draait op het laad- en ontlaaduur dezelfde gascentrale bij, dan blijven alleen
de omzettingsverliezen over. Een openbare uurreeks daarvan bestaat voor
Nederland niet; de pagina noemt de cijfers daarom een toerekening.

**Nederland** (`nederlandPerspectief`): teruglevering is geen verlies als een
buur die kWh gebruikt en er minder uit een centrale hoeft te komen; die
vermeden uitstoot gaat van de afname af. Behalve op uren waarop de mix al onder
een drempel zit (standaard 100 g/kWh): dan is er vaak, maar niet altijd, meer
aanbod dan vraag, en gaat de kWh de grens over of wordt hij afgeschakeld. De
drempel is een benadering van overschot, geen meting. Erik koos de
emissiefactor als maat voor overschot, boven de negatieve prijs of de netto
export: de vraag is of de stroom op dat moment bij de buren nog iets
verdringt, en dat zegt de factor direct. Om de drempel zonder herrekenen te
kunnen verschuiven, bewaart de balans afname en teruglevering per klasse van
20 g/kWh (30 klassen tot 600 g plus één open klasse daarboven, `CO2_KLASSEN`
= 31), met per klasse de uitstoot die de teruglevering elders
vermeed. De drempel is een afleidingsveld (`co2DrempelG`) en staat sinds 30
september 2026 in Geavanceerd, onder "Hoe je ernaar kijkt". Eerst stond hij als
schuif bij de figuur, maar een aanname voor de berekening is geen knop om mee
te spelen; zo'n schuif maakte de figuur alleen moeilijker te lezen.

De figuur (`Co2Nederland`) is een optelsom: wat de batterij scheelt aan je
afname, plus of min wat er verandert aan teruglevering die elders gas vervangt,
is wat hij Nederland scheelt. Dat is exact, want `nederlandPerspectief` trekt de
vermeden uitstoot van de afname af. Het staafdiagram van de teruglevering per
klasse (`Co2OverschotStaven`) staat in "Hoe is dit berekend?", via het veld
`figuur` van `UitlegBlok`. Voor het standaardhuishouden, gemiddeld over 2024 en
2025: +105 kg voor jou, −10 kg aan teruglevering die gas vervangt, samen 95 kg
minder voor Nederland (557 → 462 kg). Van de 2.000 kWh teruglevering viel
1.569 kWh in overschot-uren, met batterij nog 1.238. Zonder zonnepanelen levert
alleen de batterij iets terug (wat hij in dure uren verkoopt); de figuur zegt
dat dan met die getallen.

De balans zit in elk jaar (`YearKern.co2`) en gemiddeld over de volledige
jaren in het resultaat (`co2`), dus in cache en preload; daarom ging bij de
invoering het modelversienummer omhoog (`MODEL_VERSIE` in `lib/cache.ts`, nu 19).
De dispatch rekent er niet mee, dus de bedragen en het solver-harnas zijn
ongewijzigd. Het tabblad CO2 toont het antwoord met tegels
(`Co2Antwoord`), de factor per uur van de dag in winter en zomer met de afname
die de batterij per uur weghaalt (`Co2Uren`), de winst per maand
(`Co2Maanden`) en het Nederlandse perspectief als optelsom (`Co2Nederland`).

### Gedrag sinds 30 september 2026

Zeven dingen die sinds de review van eind september anders werken dan je uit de
oudere alinea's zou verwachten:

**De catalogus is per merk, met de bron van rendement en stand-by.** Sinds
modelversie 20 (1 oktober 2026) staan er vijftien modellen in van zeven merken,
elk met `rendementBron` en `standbyBron`; zie "De batterijcatalogus". De
standaardbatterij (Zendure 800 Pro 2) rekent met 84% rondgang in plaats van 88%
(er is geen meting van de Pro 2). Het standaardantwoord is daardoor van € 96,52
naar € 89,32 per jaar gegaan; de terugverdientijd van 5,3 naar 5,7 jaar met het
nettarief vanaf 2029 (overgang) en van 7,6 naar 8,2 jaar zonder, en het netto
resultaat van € 905 naar € 803.

**Stand-by zit in de jaarbesparing en de terugverdientijd.** Sinds modelversie 19
trekt `standbyKosten` het eigen verbruik van de batterij af, per batterij 6 tot
25 W, alleen in kwartieren zonder laden of ontladen. Dat staat niet in de
dispatch en niet in de dagfiguren (zie "Stand-by zit in de jaarbesparing"
hierboven). Bedragen in oudere alinea's, zoals € 105,45 per jaar voor de
standaardbatterij, zijn zonder die aftrek gemeten; met 8 W was het € 96,52 (na de catalogusupdate van 1 oktober met 84% rendement:
€ 89,32). De standaardinvoer verliest door stand-by ongeveer € 9 per jaar.

**Afregelen staat standaard uit.** Een omvormer die bij een negatieve prijs
stopt met terugleveren (`Instellingen.curtailment`, `lib/configuratie.ts`) is
geen standaard: de meeste omvormers doen het niet vanzelf. Wie het aanzet bij de
geavanceerde instellingen, krijgt een lagere besparing zonder batterij en dus een
lagere post "Negatieve prijzen ontlopen". Getallen in oudere alinea's kunnen nog
met afregelen aan zijn gemeten.

**Een periode korter dan een jaar, of zonder volledig kalenderjaar, wordt naar
een jaar geschaald.** `jaarSchaal` en `somTotJaar` in `lib/model/analysis.ts`
tellen de deelvensters op en vermenigvuldigen met 365 gedeeld door het aantal
dagen dat ze samen beslaan. Eerder middelde het model elk deelvenster als een
jaar: juni 2025 tot en met mei 2026 gaf dan € 52,70 en 14,5 jaar in plaats van
ongeveer € 105 en 6,9 jaar. Zit er een volledig kalenderjaar in de periode, dan
tellen de deeljaren niet mee in het gemiddelde, zoals altijd. De pagina noemt de
schaling bij de aannames en bij "Hoe is dit berekend?".

**Spreiding houdt de meterstanden.** De spreidingsfactor ("Pieken in je
verbruik") werkt op de netto reeks; daarna wordt opnieuw per kwartier genet en
worden de schaalfactoren van `solveNettingScale` op die gespreide reeks opgelost
(`startMs` geeft de lokale daggrenzen mee). Het jaartotaal blijft daardoor op de
ingevulde meterstanden, en de losse componenten (afname en teruglevering) volgen
uit de gespreide reeks in plaats van elk apart gespreid te worden. Een meterstand
die met dit profiel en deze spreiding niet te halen is, geeft een foutmelding.

**Opslag v2 bewaart alleen afwijkingen van de standaard.** `lib/opslag.ts` schrijft
onder `tbat:instellingen:v2` alleen de velden die anders zijn dan
`STANDAARD` (`afwijkingenVan`), net als de URL. Een bewaarde set volgt daardoor
een nieuwe standaard mee. Een set uit v1 wordt bij het eerste lezen omgezet en
opgeruimd; `curtailment` en `heffing` worden daarbij nooit overgenomen, want hun
standaard is veranderd en een volledige set zegt niet of de waarde een keuze was.

**De terugknop volgt de tabbladen.** Een tabwissel door de gebruiker krijgt een
eigen stap in de geschiedenis (`duwTab` in `app/page.tsx`); invoer wijzigen
vervangt alleen de huidige stap. `popstate` zet het tabblad terug en laat de
invoer staan.

### Conventies die vastliggen

**Vermogen en rendement.** De vermogenslimiet geldt aan de AC-zijde, het
rendement grijpt aan bij de omzetting naar en uit de cel:

```
laden:    ac_in  ≤ Pc · Δt      soc += ac_in · η
ontladen: ac_out ≤ Pd · Δt      soc −= ac_out / η
```

Round-trip is dus η². Symmetrisch in beide richtingen.

**Laadbeurten** worden alleen over de ontlading geteld: één volledige
laad-ontlaadgang is één laadbeurt (in de code `cycles`).

**Wat een laadbeurt kost.** De dispatch rekent met een schaduwprijs per geleverde
kWh: de volle slijtageprijs `investering ÷ (laadbeurten × bruikbaar × rendement)`
(`wearCostPerKwh`). Een beurt gaat alleen door als de marge na het
omzettingsverlies groter is dan die slijtage. Is de slijtage hoger dan wat de
handel oplevert, dan handelt de batterij niet — dat is de hele regel.

**De stand** (`Instellingen.slijtageDeel`, URL `slt`, `Configuration.wearFraction`)
bepaalt welk deel van die prijs de aansturing meerekent. Drie standen in
`lib/strategie.ts`: **Zuinig** (100%: elke beurt verdient zijn eigen slijtage
terug), **Gebalanceerd** (50%) en **Volop** (20%: alleen het
capaciteitsverlies dat er over de levensduur toch komt). Een schuif laat elke
waarde ertussen toe. De zichtbare slijtagepost blijft altijd de volle prijs; de
stand verandert alleen wat de aansturing beslist.

Waarom dit een keuze is en geen vaste regel: een thuisbatterij sterft vaak
eerder aan ouderdom dan aan doorzet. In de momentopname hieronder draait de
Zendure zuinig 279 laadbeurten per jaar, in vijftien jaar 4.200 van zijn 6.000;
ook op Volop (362 per jaar, 5.400) raakt hij ze niet op. Een extra beurt kost dan in werkelijkheid
minder dan de volle prijs, en de literatuur is het erover eens dat de juiste
drempel de *marginale* slijtage is — wat één beurt extra echt aan levensduur
kost (Xu e.a., *Factoring the cycle aging cost of batteries participating in
electricity markets*, 2018; C. Schade en R. Egging-Bratseth, *Battery
degradation: impact on economic dispatch*, 2024; The Mobility House over hun
optimizer). Die marginale prijs
hangt af van de vraag of de beurten vóór de kalender opraken, en dat weet je pas
achteraf; daarom kiest de gebruiker, en laat het financieringsmodel via
`remainingCapacityFraction` (de zwaarste van kalender- en cyclusslijtage) zien
wat de keuze doet met de terugverdientijd. Op Volop is de
terugverdientijd van de Zendure korter, omdat hij aan zijn kalender sterft en de
extra beurten gratis waren; bij een batterij die wél aan zijn beurten sterft,
slaat dat om.

**De standaard staat op 20%, niet op 100%.** Momentopname van een oudere
modelversie (vier jaar prijzen, heffing van toen, afregelen aan), Zendure 800 Pro 2
van EUR 699. De bedragen komen niet meer overeen met de app; de verhoudingen
tussen de rijen zijn waar het om gaat, en ook de getallen over laadbeurten en
kalender hieronder komen uit deze meting:

| Deel van de slijtageprijs | Besparing/jaar | Laadbeurten/jaar | Terugverdiend | Netto resultaat |
|---|---|---|---|---|
| 1,0 — Zuinig | € 111,67 | 278 | 6,5 jr | € 533 |
| 0,5 — Gebalanceerd | € 115,57 | 312 | 6,3 jr | € 576 |
| **0,2 — Volop** | **€ 118,74** | **361** | **6,1 jr** | **€ 610** |
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
het tabblad Terugverdienen, na de cashflow) maakt die afweging zichtbaar: de
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
`perMonth`, gemiddeld over de volledige profieljaren. Uit het gebouwde
standaardantwoord (`out/voorbeeld.json`, 30 september 2026, modelversie 17): de
Zendure op Liander, 2024 en 2025, met de heffing van nu en afregelen uit, samen
€ 105,45 per jaar.

| | jan | feb | mrt | apr | mei | jun | jul | aug | sep | okt | nov | dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Besparing | 3,99 | 4,04 | 10,68 | 10,63 | 11,90 | 11,91 | 11,92 | 12,68 | 11,68 | 7,92 | 4,47 | 3,64 |

Ruim tachtig procent (85%) valt tussen maart en oktober. In december en januari
bespaart de batterij maar vier euro per maand: het prijsverschil op een
winterdag is dan klein (rond de 10 cent) en dat is weinig om het
omzettingsverlies te dekken. Dat is de reden om naar het tijdsafhankelijke
nettarief te kijken, want dat legt zijn piek juist in de winteravond.

**Waarom de batterij een dag met een kleine marge laat liggen.** Op 18 december 2025
kocht de Zendure 's nachts 1,8 kWh in bij 19 cent en leverde er 1,6 aan het huis
bij 26 cent. Na het omzettingsverlies bleef er **€ 0,067** over, terwijl de
slijtage van die beurt € 0,12 was tegen de volle aanschafprijs per kWh. Toen het
standby-verbruik nog in de dispatch zat, kwam de dag op € 0,00 uit en las hij als
slijtage voor niets; dat was de reden om standby uit de dispatch te halen en de
slijtage apart te tonen. Sinds modelversie 19 zit stand-by wel in de jaarbesparing
en de terugverdientijd, maar nog steeds niet in de dag. En het was de reden om de planner met de volle slijtageprijs te
laten rekenen: sinds die wijziging laat hij zo'n dag voorbijgaan.

**Geen prijsstijging als uitgangspunt.** De standaard voor de jaarlijkse
prijsstijging staat op 0% (was 2%, de inflatiedoelstelling, geen energieprijs-
verwachting). Wat een batterij verdient is het gat tussen afname en
teruglevering: energiebelasting plus opslag plus het prijsverschil over de dag.
De energiebelasting op stroom daalt van 2025 op 2026 (11,1 ct/kWh incl. btw),
als onderdeel van de lastenverschuiving van stroom naar gas. Het Belastingplan
2027 (37022, ingediend, nog niet aangenomen) verandert het tarief niet; het
bedrag voor 2027 volgt eind 2026 uit de inflatiecorrectie. Het PBL geeft in de
Klimaat- en Energieverkenning 2026 voor de groothandelsprijs van stroom in 2030
70 euro per MWh met een bandbreedte van 53 tot 90. De schuif blijft voor wie
anders verwacht.

**Financiële instellingen raken de natuurkunde niet.** Discontovoet, prijsstijging en
looptijd veranderen het netto resultaat, niet de jaarbesparing en niet het aantal
laadbeurten. Bij 3% en bij 0% rente komt dezelfde besparing per jaar uit het model.
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
huishoudens, per energierichting opgeteld over een steekproef van slimme meters,
en overlappen elkaar op veel kwartieren. Het model trekt ze per kwartier van
elkaar af: volgens de netbeheerders zelf neemt één aansluiting binnen een
kwartier meestal óf af óf levert terug, en is de overlap een eigenschap van de
groep (codewijzigingsvoorstel profielallocatie, BR-2021-1822). Daarbij valt
volume weg: met 2.500/2.000 kWh bleef er zonder correctie 2.086/1.586 over. De
jaartotalen op de afrekening zijn daardoor vrijwel genette sommen, dus het model
schaalt de twee fracties met factoren (`solveNettingScale`, ruwweg 1,20 en 1,25)
zodat de genette reeks over een vol jaar exact op de meterstanden uitkomt.
Deeljaren lenen die factoren van het meest recente volle jaar. Het scheelt bijna
een vijfde in de besparing.

De schaling lost één onbekende op met bisectie, en komt bij elke verhouding op
de meterstanden uit. De vast-punt-iteratie die er eerst stond, gaf het op zodra
geen kwartier meer een overschot had: boven een verhouding van ongeveer 58
tussen afname en teruglevering (30.000 tegen 500 kWh is al 60) verdween de
teruglevering stil uit het model. `tests/pipeline.test.ts` controleert de
meterstanden nu voor alle netgebieden, van 30.000/100 tot 100/30.000 kWh.

**Waarom niet apart houden.** Houd je E17 en E18 apart, dan kloppen de
meterstanden vanzelf, maar laadt de batterij uit de teruglevering en levert hij
in hetzelfde kwartier aan de afname: stroom schuiven tussen buren. Doorgerekend
op Liander 2025 (2.500/2.000 kWh, perfecte vooruitblik, beide varianten op de
meterstanden):

| Invoer | Overlap | Zendure 800 Pro 2 | 5 kWh / 2,5 kW |
|---|---|---|---|
| genet en geschaald (de tool) | 0 kWh | € 125 | € 257 |
| 90% van de overlap weggenet | 49 kWh | € 131 | € 262 |
| 50% weggenet | 227 kWh | € 153 | € 276 |
| apart gehouden | 414 kWh | € 177 | € 290 |

De extra besparing komt volledig uit de overlap: de opgeslagen zonnestroom
verdubbelt van 461 naar 890 kWh. Wat één echt huis binnen een kwartier beide
kanten op doet (een wolk, een waterkoker), is volgens metingen op seconde- en
minuutbasis goed voor enkele procentpunten zelfconsumptie, en met een batterij
verwaarloosbaar (Tjaden e.a., HTW Berlin 2014; Beck e.a., Applied Energy 2016).
Netten zit daarom het dichtst bij één aansluiting. Blijft er bij een echt huis
een tiende van de overlap over, dan ligt de besparing zo'n 5% hoger. Een
openbare dataset met kwartierstanden van losse huishoudens, beide telwerken
apart, om dat te ijken bestaat niet; een paar tientallen P1-metingen zouden het
beslechten.

**Heffing per uur.** Energiebelasting plus inkoopopslag komt uit
allInPrijs − marktprijs, per uur en niet als jaarconstante: in 2025 zakte de
heffing in september van 17,13 naar 14,29 ct. Standaard rekent de tool met de
heffing van nu (die van het meest recente prijsjaar, over alle jaren): dat past
bij een batterij die je vandaag koopt, en het antwoord zegt dat ook ("met de
belasting en opslag van nu"). De heffing van toen lag in 2024 en 2025 ruim een
derde hoger (17,1 tot 18,0 ct tegen 12,9 ct nu; `heffingToenTekst` leidt de zin
op de pagina af uit de prijsdata). De besparing groeit veel minder hard mee:
voor de standaardbatterij met zonnepanelen 13% (`BESPARING_MET_HEFFING_TOEN`,
gemeten met afregelen aan, de standaard tot 30 september 2026; nagerekend met de
huidige standaard in `tests/voorbeeld.test.ts`), zonder panelen zelfs iets minder,
want dan betaalt ook het laden uit het net de hogere heffing. Wie met de
heffing van toen wil rekenen, kiest "van toen" bij de instellingen.

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
de inkoopopslag. De gewone doorrekening rekent standaard met de heffing van nu
(12,9 ct), op verzoek met die van toen (17 tot 18 ct in 2023 tot en met 2025); in
2029 en 2030 ligt de energiebelasting volgens CE Delft op EUR 0,075
respectievelijk 0,076 per kWh exclusief btw. Het scenario rekent daarom met de
heffing van het scenariojaar (energiebelasting van dat jaar plus de opslag zoals
die in 2026 in de data zit, ongeveer 10,9 ct in 2029), ongeacht de keuze tussen
nu en toen: het nettarief van straks hoort bij de belasting van straks.
`scenarioConfiguratie` in
`lib/nettarief.ts` is de ene plek waar het scenario wordt afgeleid, voor de
hoofdpagina, de build van het standaardantwoord en de vergelijker; anders zou de
cachesleutel op drie plekken net anders uitkomen.

Dat verandert de businesscase ingrijpend, want de piek valt op de uren waarop een
batterij levert en het nultarief op de uren waarop hij laadt. De winst zit vooral
in de winter, precies het seizoen waarin de accu nu bijna stilstaat.

Het vaste deel — de capaciteitscomponent (EUR 167 in de CE-doorrekening) plus
aansluitvergoeding en meetdienst (EUR 135) — blijft buiten de berekening, want
dat is met en zonder batterij gelijk. Het voorstel beprijst uitsluitend afname;
een tarief op invoeding zou een nieuw voorstel vergen. In de code bestaat nog een
optie om het tarief ook op teruglevering te heffen (`opTeruglevering` in
`scenarioConfiguratie`, standaard uit), maar de pagina heeft daar geen schakelaar
voor; zie "Geen wat-als over een heffing op teruglevering" hierboven.
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
- Terugleverkosten-staffels per leverancier — wel als één instelbare €/kWh. Dat ANWB
  Energie geen terugleverkosten rekent (standaard 0 cent), is een aanname.
- Het profiel is een gemiddelde over veel huishoudens en daardoor gladder dan één
  aansluiting. Of dat de waarde van een batterij onder- of overschat, is niet
  onderbouwd; de spreidingsfactor laat zien hoe gevoelig de uitkomst ervoor is.
- Het eigen stroomverbruik van de batterij (stand-by) is een waarde per batterij,
  geen meting aan jouw batterij. Gemeten waar er een test van is (HomeWizard 6 W,
  Marstek 7 W, Zendure 3 tot 3,4 W, Anker Max 31,6 W; energienerds.nl), anders
  een opgave van de fabrikant (Sessy) of een schatting of aanname voor de omvormerklasse
  (Indevolt: 7 W in diepe stand-by, 20 W voor de hoofdunit). Het is van de
  besparing afgetrokken, alleen op de momenten dat de batterij niet laadt of
  ontlaadt, en met dezelfde watt voor elke maat in het raster en de curve. Het
  staat niet in de dagfiguren. Een stand-by die per uur of per standen
  verschilt (de API-stand-by van de HomeWizard is 0,52 W) is niet gemodelleerd.
- De uitstoot van het maken van de batterij. De CO2-cijfers zijn een
  toerekening met de gemiddelde (niet de marginale) uitstoot per uur.
- Kwartierprijzen. Sinds 1 oktober 2025 zijn day-ahead-prijzen per kwartier;
  de ANWB-API levert uurprijzen, sinds 20 juni 2026 afgerond op hele centen.

## Structuur

```
app/                    pagina, thema
components/             invoer en visualisaties
lib/presets.ts          de batterijcatalogus, per merk, met bronnen
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

- **Catalogus** — `tests/batterij-catalogus.test.tsx`: elke preset heeft een
  rendementbron, stand-bybron, bron-URL, peildatum en (behalve generiek) een
  logo in `public/logos` zonder script of externe verwijzing; prijzen boven 0,8 kW
  bevatten de eigen groep of installatie; groepering per merk met Zendure eerst;
  laden en leveren apart bij Sessy; elke bron-URL staat in de bronnenlijst.
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
DYNAMIC loopt twee dagen achter en recente dagen kunnen nog wijzigen. Zonder
optie vult het script alleen ontbrekende dagen aan. Met `--opnieuw N` haalt het
de laatste N dagen van de periode eerst uit het bestand en daarna opnieuw op,
zodat correcties van EDSN meekomen:

```bash
python3 scripts/fetch_dynamic.py --opnieuw 60   # ververs de laatste twee maanden
```

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
