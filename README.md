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
npm test             # 54 tests, waaronder de modelinvarianten
npm run build        # statische export naar out/
```

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
informatie kost. Op de echte data haalt de realistische strategie 50 tot 60% van
het optimum.

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

**Tijd.** Een Nederlandse dag heeft 92, 96 of 100 kwartieren. Dag-, maand- en
jaargrenzen worden in `Europe/Amsterdam` bepaald, koppelingen tussen reeksen in
UTC. Nergens staat een hardcoded 24 of 96.

**Normalisatie.** DYNAMIC-fracties sommeren over een kalenderjaar niet op 1 —
gemeten voor 2025: 1,0178 voor afname en 1,0495 voor invoeding. De build-stap
normaliseert per kalenderjaar naar exact 1. Een deelperiode wordt bewust **niet**
opnieuw genormaliseerd: drie wintermaanden horen meer dan een kwart van het
jaarvolume te bevatten.

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

Prestaties: ongeveer 430 ms voor de realistische strategie en 280 ms voor het
optimum per profieljaar; vier jaar met beide strategieën en de besparingscurve in
ruim drie seconden.
