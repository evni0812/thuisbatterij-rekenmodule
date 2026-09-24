/**
 * De teksten achter "Hoe is dit berekend?", één blok per cijfer of grafiek.
 *
 * Elk blok is een functie van de doorrekening: het voorbeeld rekent met de
 * echte getallen van de gebruiker, niet met een vast voorbeeldhuishouden. Dat
 * is het verschil met de Energiecontract Monitor, waar de getallen uit één
 * dataset komen en dus vast kunnen staan.
 *
 * Bronnen en waarschuwingen die op meer plekken gelden staan één keer bovenaan,
 * zodat een disclaimer overal hetzelfde luidt.
 */

import type { ReactNode } from "react";
import { netgebiedNaam } from "./data/manifest";
import { centPerKwh, euro, euroPrecies, getal, jaren, kwh, procent } from "./format";
import { referentieJaar, type AnalysisResult, type ScenarioResult, type YearAnalysis } from "./model/analysis";
import { usableCapacityKwh } from "./model/battery";
import { RASTER_CAPACITEITEN, RASTER_VERMOGENS } from "./model/raster";
import { overgangZin, overgangsFinance } from "./overgang";
import {
  BASISTARIEF,
  NETTARIEF_BRON,
  NETTARIEF_JAAR,
  scenarioHeffing,
  type NettariefJaar,
} from "./nettarief";
import {
  DIRECT_EIGEN_VERBRUIK_ZONDER_BATTERIJ,
  PRIJSPEILDATUM,
  geschatteOpwekKwh,
  type BatteryPreset,
} from "./presets";
import { STRATEGIEEN, strategieVoor } from "./strategie";
import { HUISHOUDENS_TERUGLEVERING } from "./model/huishoudens";
import { STEKKER_GRENS_KW, kostenregelVan } from "./model/kosten";
import { CO2_KLASSE_G, STANDAARD_CO2_DREMPEL_G, huishoudPerspectief, nederlandPerspectief } from "./model/co2";
import { AUTO_G_PER_KM } from "../components/Co2Antwoord";
import { DOELEN, GRAM_PER_CENT, doelInfo } from "./model/doel";
import { doelKaarten, type VergelijkingDelen } from "./model/vergelijking";
import type { Configuration } from "./worker/protocol";

export interface UitlegBlok {
  titel: string;
  /** Eén of twee zinnen: wat staat hier eigenlijk? */
  watZieJe: ReactNode;
  bronnen: { naam: string; wat: ReactNode }[];
  stappen: ReactNode[];
  voorbeeld?: {
    regels: { wat: ReactNode; waarde: string; uitkomst?: boolean }[];
    toelichting?: ReactNode;
  };
  letop?: ReactNode[];
}

export interface UitlegContext {
  result: AnalysisResult;
  /** Het nettariefscenario, als het al is doorgerekend. */
  scenario: ScenarioResult | null;
  /** De configuratie waar `result` bij hoort. */
  config: Configuration;
  preset: BatteryPreset;
  /** Voor welk jaar het basistarief in het scenario geldt. */
  scenarioJaar?: NettariefJaar;
  /** De drie doelen naast elkaar, voor zover ze al zijn doorgerekend. */
  vergelijking?: VergelijkingDelen | null;
}

export type UitlegId =
  | "antwoord"
  | "zelfconsumptie"
  | "autarkie"
  | "vanHetNet"
  | "naarHetNet"
  | "piekuren"
  | "laadbeurten"
  | "doorzet"
  | "slijtage"
  | "verloop"
  | "prijskloof"
  | "uitsplitsing"
  | "verliezen"
  | "perJaar"
  | "maandverloop"
  | "verschuiving"
  | "dagprofiel"
  | "nettarief"
  | "batterijmaat"
  | "uitbreiden"
  | "voorwie"
  | "co2antwoord"
  | "co2uren"
  | "co2maanden"
  | "co2nederland"
  | "beurten"
  | "doelen"
  | "cashflow";

// ── Bronnen ────────────────────────────────────────────────────────────────

const PROFIEL_BRON = (c: Configuration) => ({
  naam: "MFFBAS profielfracties",
  wat:
    c.afnametype === "AZI" ? (
      <>
        Het gemeten gemiddelde verbruikspatroon per kwartier van alle
        kleinverbruikers zónder teruglevering (categorie E1A, afnametype AZI)
        in netgebied {netgebiedNaam(c.domain)}, geschaald naar jouw
        jaarafname. Een gemiddelde over veel aansluitingen, geen meting van
        één huishouden: pieken van een waterkoker of laadpaal zijn
        uitgemiddeld. Het is een eigen reeks, geen bewerking van het profiel
        met panelen.
      </>
    ) : (
      <>
        Het gemeten gemiddelde afname- en terugleverpatroon per kwartier van
        alle kleinverbruikers mét teruglevering (categorie E1A) in netgebied{" "}
        {netgebiedNaam(c.domain)}, geschaald naar jouw jaarafname en
        jaarteruglevering. Een gemiddelde over veel aansluitingen, geen meting
        van één huishouden: pieken van een waterkoker of laadpaal zijn
        uitgemiddeld.
      </>
    ),
});
const PRIJS_BRON = {
  naam: "ANWB Energie, uurtarieven",
  wat: (
    <>
      De marktprijs per uur inclusief btw, via de ANWB-API. Daarbovenop de
      heffing (energiebelasting plus opslag): standaard die van nu, of per uur
      die van toen als je dat kiest bij de geavanceerde instellingen. Sinds 20
      juni 2026 geeft de API de prijzen afgerond op hele centen. Elke uurprijs
      geldt voor de vier kwartieren van dat uur.
    </>
  ),
};
const BATTERIJ_BRON = (p: BatteryPreset) => ({
  naam: `Catalogus: ${p.naam}`,
  wat: (
    <>
      {getal(p.capaciteitKwh, 2)} kWh, {getal(p.vermogenKw, 1)} kW, rendement heen
      en terug {procent(p.spec.efficiency ** 2)}, bruikbaar deel{" "}
      {procent(p.spec.depthOfCharge)}. Prijs:{" "}
      {p.prijsNoot}, richtprijs {PRIJSPEILDATUM}.
    </>
  ),
});
const KOSTEN_BRON = (c: Configuration) => {
  const k = kostenregelVan(c);
  return {
    naam: "Richtprijzen van uitbreiding en installatie",
    wat: (
      <>
        Uitbreidingsmodules kosten bij vrijwel elk merk 310 tot 450 euro per kWh
        (Zendure AB2000X, Anker BP2700, HomeWizard; thuisbatterijgids.net), een
        hybride omvormer van 3 tot 5 kW 1.000 tot 2.500 euro, en een eigen groep
        door een installateur 300 tot 1.200 euro (powerplugs.nl). Hier gerekend
        met {euro(k.perKwhEur)} per kWh, {euro(k.perKwEur)} per kW en{" "}
        {euro(k.installatieEur)} installatie, peildatum {PRIJSPEILDATUM}; instelbaar
        bij de geavanceerde instellingen.
      </>
    ),
  };
};
const NED_BRON = {
  naam: "Nationaal Energie Dashboard (NED.nl), CO2-emissiefactor per uur",
  wat: (
    <>
      De gemiddelde uitstoot van één kWh die in Nederland werd opgewekt, per
      uur, in gram CO2 per kWh: de uitstoot van de elektriciteitsproductie
      gedeeld door de productie (type 27, ElectricityMix), zoals ned.nl die
      publiceert. Import telt daarin niet mee. Van 2023 tot nu; het allereerste
      uur van 2023 ontbreekt, en het lopende jaar loopt een paar uur achter.
    </>
  ),
};
const CE_BRON = {
  naam: "CE Delft en Netbeheer Nederland",
  wat: (
    <>
      De wegingsfactoren per uur uit het codewijzigingsvoorstel van 1 mei 2026
      (ACM, BR-2026-2242), en het basistarief uit {NETTARIEF_BRON}: een
      prognose van CE Delft, in opdracht van NVDE, Holland Solar,
      Energie-Nederland en Energy Storage NL.
    </>
  ),
};

// ── Waarschuwingen ─────────────────────────────────────────────────────────

const GEMIDDELD_LETOP = (
  <>
    Het profiel is het gemiddelde van alle aansluitingen in het netgebied en
    daardoor gladder dan één huishouden. Of dat de uitkomst te hoog of te laag
    maakt, is niet zeker. Met de schuif "Pieken in je verbruik" zie je hoe
    gevoelig de uitkomst ervoor is.
  </>
);
const GEEN_VOORSPELLING_LETOP = (
  <>
    Dit is geen voorspelling. De vraag is wat de batterij had opgeleverd op de
    prijzen en profielen zoals ze werkelijk waren, zonder saldering. Wat prijzen
    en belastingen de komende jaren doen, is onzeker.
  </>
);
const STANDBY_LETOP = (
  <>
    Het eigen stroomverbruik van de batterij zit niet in de besparing. Een
    thuisbatterij gebruikt ook stroom als hij niets doet, meestal 7 tot 25 watt:
    60 tot 220 kWh per jaar. Trek dat er in gedachten van af.
  </>
);
const DYNAMISCH_LETOP = (
  <>
    Deze doorrekening gaat uit van een dynamisch energiecontract en een batterij
    die zelf op de uurprijzen stuurt. Met een vast of variabel contract krijg je
    tot en met 2030 voor teruglevering minstens 50% van het kale
    leveringstarief; die situatie rekent de tool niet door.
  </>
);
const MARGINAAL_LETOP = (
  <>
    We rekenen met de gemiddelde uitstoot van de Nederlandse opwek per uur
    (NED). Voor het effect van één kWh meer of minder gebruiken onderzoekers
    liever de marginale uitstoot: die van de centrale die op- of afregelt.
    Daarvan is voor Nederland geen openbare uurreeks. Met een marginale factor
    kan de uitkomst ongunstiger uitvallen: draait op het laad- en ontlaaduur
    dezelfde gascentrale bij, dan blijven alleen de omzettingsverliezen over en
    stoot de batterij per saldo iets meer uit. Lees deze cijfers daarom als een
    toerekening, niet als gemeten vermeden uitstoot.
  </>
);
const PRODUCTIE_LETOP = (
  <>
    De uitstoot van het maken van de batterij is niet meegerekend; alleen wat
    hij verandert aan je netafname en teruglevering.
  </>
);
/** Waar de planner op stuurde, voor de CO2-uitleg: CO2-winst als bijeffect of als doel. */
function co2SturingLetop(c: Configuration): ReactNode {
  return c.doel === "uitstoot" ? (
    <>
      De batterij stuurt hier in de stand Uitstoot: hij mijdt de vuilste uren,
      ongeacht de prijs. De CO2-winst is dus het doel, en de besparing in euro's
      is lager dan bij sturen op rendement.
    </>
  ) : (
    <>
      De batterij stuurt hier op {c.doel === "zelfconsumptie" ? "zelfconsumptie" : "prijs (de stand Rendement)"}:
      de CO2-winst is een bijeffect, geen doel. In de stand Uitstoot stuurt hij
      wel op de uitstoot per uur; kies die bij "Waar stuurt de batterij op?" om
      het verschil te zien.
    </>
  );
}
/** Rekent deze doorrekening met het profiel zonder zonnepanelen? */
function zonderPanelen(c: Configuration): boolean {
  return c.afnametype === "AZI";
}
const EEN_LEVERANCIER_LETOP = (
  <>
    De prijzen zijn van één leverancier, ANWB Energie. Een andere dynamische
    leverancier rekent een andere opslag; dat verschuift de kosten, maar
    nauwelijks de besparing, want die zit in het prijsverschil tussen uren.
  </>
);

// ── Hulp ───────────────────────────────────────────────────────────────────

/** Het meest recente volledige profieljaar, of het laatste venster. */
const referentie: (r: AnalysisResult) => YearAnalysis = referentieJaar;

function volledigeJaren(r: AnalysisResult): number {
  return r.perYear.filter((j) => j.isFullYear).length;
}

const aandeel = (deel: number, geheel: number) => (geheel > 0 ? deel / geheel : 0);

/** Komt de jaaropwek uit de schatting, of heeft de bezoeker hem zelf ingevuld? */
function isGeschatteOpwek(c: Configuration): boolean {
  return (
    Math.abs(
      (c.annualProductionKwh ?? 0) -
        geschatteOpwekKwh(c.household.annualGridExportKwh),
    ) <= 0.5
  );
}

// ── De blokken ─────────────────────────────────────────────────────────────

export const UITLEG: Record<UitlegId, (ctx: UitlegContext) => UitlegBlok> = {
  antwoord: ({ result, scenario, config, preset }) => {
    const j = referentie(result);
    const n = volledigeJaren(result);
    const overgang = scenario ? overgangsFinance(result, scenario, config) : null;
    return {
      titel: "De besparing per jaar en de terugverdientijd",
      watZieJe: (
        <>
          Wat deze batterij je per jaar had bespaard op je variabele stroomkosten,
          gemiddeld over de {n > 1 ? `${n} volledige jaren` : "gekozen periode"} in
          de data, en wanneer de aanschaf daarmee is terugverdiend.
        </>
      ),
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON, BATTERIJ_BRON(preset)],
      stappen: [
        zonderPanelen(config) ? (
          <>
            Het gemeten gemiddelde profiel van je netgebied geeft per kwartier
            hoeveel er van het net kwam. Het wordt zo geschaald dat elk vol jaar
            exact op jouw meterstand uitkomt: {kwh(config.household.annualGridImportKwh)} afname.
          </>
        ) : (
          <>
            Het gemeten gemiddelde profiel van je netgebied geeft per kwartier
            hoeveel er van het net kwam en hoeveel ernaartoe ging. Beide worden zo
            geschaald dat elk vol jaar exact op jouw meterstanden uitkomt:{" "}
            {kwh(config.household.annualGridImportKwh)} afname en{" "}
            {kwh(config.household.annualGridExportKwh)} teruglevering.
          </>
        ),
        <>
          Zonder batterij kost elk kwartier afname de uurprijs plus heffing
          ({config.useHistoricalLevy === false ? "die van nu" : "die van toen"}),
          en levert elk kwartier teruglevering de kale uurprijs op, min
          eventuele terugleverkosten. Zonder saldering dus: dat is de situatie
          met een dynamisch contract vanaf 1 januari 2027.
        </>,
        <>
          Met batterij plant een strategie elke dag om 13:00 de komende uren,
          op de day-ahead-prijzen die dan bekend zijn en een verwachting van je
          verbruik uit de afgelopen week.{" "}
          {config.doel === "zelfconsumptie"
            ? "Ze laadt alleen uit eigen zonoverschot en levert alleen aan je eigen huis"
            : config.doel === "uitstoot"
              ? "Ze laadt op uren waarop de stroom uit het net schoon is en levert op de vuile uren"
              : zonderPanelen(config)
                ? "Ze laadt op goedkope uren en levert op dure uren"
                : "Ze laadt bij zonoverschot of goedkope uren en levert bij dure uren"}
          , binnen het vermogen en het rendement van de batterij.
        </>,
        <>
          De besparing is het verschil tussen de kosten zonder en met batterij,
          per jaar, en dan gemiddeld over de volledige jaren.
        </>,
        <>
          Voor de terugverdientijd loopt de besparing jaar na jaar door, met{" "}
          {procent(config.priceEscalation, 1)} prijsstijging en{" "}
          {procent(config.calendarFadePerYear, 2)} capaciteitsverlies per jaar. Het
          jaar waarin de opgetelde besparing de aanschafprijs inhaalt, is de
          terugverdientijd.
        </>,
        <>
          Het voorgestelde nettarief gaat, als het doorgaat, naar verwachting
          op 1 januari {NETTARIEF_JAAR} in. De vetgedrukte terugverdientijd
          rekent daarom{" "}
          {overgang ? overgangZin(overgang) : "de eerste jaren"} met het
          huidige nettarief en de jaren daarna met het nieuwe, op dezelfde
          batterij die gewoon doorslijt. Ter vergelijking staat erachter wat het
          wordt als het nettarief blijft zoals nu.
        </>,
      ],
      voorbeeld: {
        regels: [
          { wat: `Stroomkosten zonder batterij, ${j.year}`, waarde: euroPrecies(j.baselineCostEur) },
          { wat: `Stroomkosten met batterij, ${j.year}`, waarde: euroPrecies(j.realisticCostEur) },
          { wat: `Besparing in ${j.year}`, waarde: euroPrecies(j.realisticSavingEur) },
          {
            wat: n > 1 ? `Gemiddeld over ${n} volledige jaren` : "Besparing per jaar",
            waarde: euro(result.averageSavingEur),
            uitkomst: true,
          },
          { wat: "Aanschafprijs", waarde: euro(config.investmentEur) },
          ...(overgang
            ? [
                {
                  wat: "Terugverdiend na, als het nettarief-voorstel doorgaat",
                  waarde: jaren(overgang.finance.paybackYears),
                  uitkomst: true,
                },
                {
                  wat: "Ter vergelijking: als het nettarief blijft zoals nu",
                  waarde: jaren(result.finance.paybackYears),
                },
              ]
            : [
                {
                  wat: "Terugverdiend na, als het nettarief blijft zoals nu",
                  waarde: jaren(result.finance.paybackYears),
                  uitkomst: true,
                },
              ]),
        ],
        toelichting:
          result.minSavingEur !== result.maxSavingEur ? (
            <>
              Per jaar loopt het van {euro(result.minSavingEur)} tot{" "}
              {euro(result.maxSavingEur)}: hoe grilliger de prijzen dat jaar, hoe
              meer een batterij verdient.
            </>
          ) : undefined,
      },
      letop: [
        config.doel && config.doel !== "rendement" ? (
          <>De batterij stuurt hier op <b>{doelInfo(config.doel).naam.toLowerCase()}</b>: {doelInfo(config.doel).kort} De besparing in euro's is daardoor lager dan bij sturen op rendement; dat is de prijs van die keuze, en die staat hier eerlijk.</>
        ) : null,
GEEN_VOORSPELLING_LETOP, DYNAMISCH_LETOP, STANDBY_LETOP, GEMIDDELD_LETOP, EEN_LEVERANCIER_LETOP],
    };
  },

  zelfconsumptie: ({ result, config }) => {
    const s = result.stats;
    const opwek = config.annualProductionKwh ?? 0;
    const geschat = isGeschatteOpwek(config);
    return {
      titel: "Eigen verbruik: welk deel van je zon je zelf gebruikt",
      watZieJe: (
        <>
          Welk deel van wat je panelen opwekken je ook zelf gebruikt, zonder en
          met batterij. De rest gaat naar het net.
        </>
      ),
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        geschat ? (
          <>
            Je meterstanden zeggen niet hoeveel je panelen opwekken; alleen wat
            er door de meter ging. Je hebt de jaaropwek niet ingevuld, dus is hij
            geschat: een huishouden met panelen en zonder batterij gebruikt
            ongeveer {procent(DIRECT_EIGEN_VERBRUIK_ZONDER_BATTERIJ)} van zijn
            opwek direct zelf, dus opwek ≈ teruglevering ÷{" "}
            {getal(1 - DIRECT_EIGEN_VERBRUIK_ZONDER_BATTERIJ, 1)}.
          </>
        ) : (
          <>
            Je meterstanden zeggen niet hoeveel je panelen opwekken; alleen wat
            er door de meter ging. Daarom vragen we de jaaropwek apart, en die
            heb je ingevuld.
          </>
        ),
        <>
          Wat je direct zelf gebruikt is opwek min teruglevering, min wat de
          omvormer bij een negatieve prijs afregelde. Afgeregelde stroom is
          nooit gebruikt en telt dus niet als eigen verbruik.
        </>,
        <>Zelfconsumptie is dat deel gedeeld door de opwek. Met batterij gaat een
          deel van het overschot de batterij in in plaats van het net op, dus
          stijgt het aandeel.</>,
      ],
      voorbeeld: {
        regels: [
          {
            wat: geschat ? "Jaaropwek van je panelen (geschat)" : "Jaaropwek van je panelen (ingevuld)",
            waarde: kwh(opwek),
          },
          { wat: "Teruglevering zonder batterij", waarde: kwh(s.gridExportBaselineKwh) },
          ...(s.curtailedBaselineKwh > 0.5
            ? [{ wat: "Afgeregeld bij negatieve prijzen, zonder batterij", waarde: kwh(s.curtailedBaselineKwh) }]
            : []),
          {
            wat:
              s.curtailedBaselineKwh > 0.5
                ? "Zelf gebruikt zonder batterij: 1 − (teruglevering + afgeregeld) ÷ opwek"
                : "Zelf gebruikt zonder batterij: 1 − teruglevering ÷ opwek",
            waarde: procent(s.selfConsumptionBaseline ?? 0),
          },
          { wat: "Teruglevering met batterij", waarde: kwh(s.gridExportBatteryKwh) },
          ...(s.curtailedBaselineKwh > 0.5 || s.curtailedBatteryKwh > 0.5
            ? [{ wat: "Afgeregeld met batterij", waarde: kwh(s.curtailedBatteryKwh) }]
            : []),
          { wat: "Zelf gebruikt met batterij", waarde: procent(s.selfConsumptionBattery ?? 0), uitkomst: true },
        ],
      },
      letop: [
        <>
          Vuistregel voor de opwek: ongeveer 900 kWh per kWp aan panelen. Een
          te hoge opwek maakt het aandeel te laag, en andersom.
        </>,
        ...(geschat
          ? [
              <>
                Zolang de opwek geschat is, staat het percentage zónder batterij
                per definitie op {procent(DIRECT_EIGEN_VERBRUIK_ZONDER_BATTERIJ)}.
                De sprong die de batterij maakt is wél gerekend op jouw
                werkelijke teruglevering. Vul je eigen jaaropwek in voor het
                echte vertrekpunt.
              </>,
            ]
          : []),
      ],
    };
  },

  autarkie: ({ result, config }) => {
    const s = result.stats;
    const opwek = config.annualProductionKwh ?? 0;
    // Afgeregelde stroom is niet gebruikt: hij hoort niet bij "direct zelf
    // gebruikt", net zo min als teruglevering. Dezelfde regel als
    // `metZelfvoorziening` in lib/model/analysis.ts.
    const direct = Math.max(0, opwek - s.gridExportBaselineKwh - s.curtailedBaselineKwh);
    return {
      titel: "Onafhankelijk van het net: welk deel van je verbruik je zelf dekt",
      watZieJe: (
        <>
          Welk deel van je totale stroomverbruik je zelf dekt, uit eigen zon
          direct of via de batterij. Wat overblijft komt van het net.
        </>
      ),
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        <>Bruto verbruik is netafname plus wat je direct van je eigen zon gebruikte: opwek min teruglevering, min wat de omvormer bij een negatieve prijs afregelde.</>,
        <>Zelf gedekt is 1 min netafname gedeeld door bruto verbruik.</>,
        <>Met batterij daalt de netafname, dus stijgt het aandeel.</>,
      ],
      voorbeeld: {
        regels: [
          {
            wat:
              s.curtailedBaselineKwh > 0.5
                ? "Direct zelf gebruikt: opwek − teruglevering − afgeregeld"
                : "Direct zelf gebruikt: opwek − teruglevering",
            waarde: kwh(direct),
          },
          { wat: "Bruto verbruik: netafname + direct zelf gebruikt", waarde: kwh(s.gridImportBaselineKwh + direct) },
          { wat: "Zelf gedekt zonder batterij", waarde: procent(s.selfSufficiencyBaseline ?? 0) },
          { wat: "Netafname met batterij", waarde: kwh(s.gridImportBatteryKwh) },
          { wat: "Zelf gedekt met batterij", waarde: procent(s.selfSufficiencyBattery ?? 0), uitkomst: true },
        ],
      },
      letop: isGeschatteOpwek(config)
        ? [
            <>
              De opwek is geschat uit je teruglevering; vul je eigen jaaropwek in
              bij de geavanceerde instellingen voor een exact cijfer.
            </>,
          ]
        : undefined,
    };
  },

  vanHetNet: ({ result, config }) => {
    const s = result.stats;
    const verschil = s.gridImportBaselineKwh - s.gridImportBatteryKwh;
    const stijgt = verschil < -0.5;
    return {
      titel: stijgt ? "Van het net: wat de batterij aan je afname verandert" : "Van het net: hoeveel minder je afneemt",
      watZieJe: <>Je netafname per jaar zonder en met batterij, gemiddeld over de volledige jaren.</>,
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        <>Zonder batterij is de afname het geschaalde profiel: precies je meterstand.</>,
        <>
          Met batterij telt het model per kwartier wat er nog van het net komt:
          je verbruik min wat de batterij levert, plus wat de batterij van het
          net laadt.
        </>,
        zonderPanelen(config) ? (
          <>Zonder zonnepanelen laadt de batterij alleen van het net. Wat hij later levert, haal je eerder van het net, plus het omzettingsverlies; het verschil is dat verlies, en wat hij in dure uren aan het net verkoopt.</>
        ) : (
          <>Het verschil is wat de batterij aan eigen zon voor later bewaarde, min wat hij zelf aan het net kocht.</>
        ),
      ],
      voorbeeld: {
        regels: [
          { wat: "Netafname zonder batterij", waarde: kwh(s.gridImportBaselineKwh) },
          { wat: "Netafname met batterij", waarde: kwh(s.gridImportBatteryKwh) },
          {
            wat: stijgt ? "Meer van het net" : "Minder van het net",
            waarde: `${kwh(Math.abs(verschil))}${s.gridImportBaselineKwh > 0 ? ` (${procent(Math.abs(verschil) / s.gridImportBaselineKwh)})` : ""}`,
            uitkomst: true,
          },
        ],
      },
      letop: [
        stijgt ? (
          <>
            Hier stijgt je afname per saldo: de batterij laadt van het net om
            later te leveren, en het omzettingsverlies komt erbovenop. De
            besparing zit in wánneer je afneemt, niet in hoeveel: goedkoop
            laden, duur uitsparen.
          </>
        ) : (
          <>
            Bij goedkope uren kan de batterij ook van het net laden om later te
            leveren. Dan stijgt de afname op dat moment; netto daalt hij hier
            toch, omdat er eigen zon te bewaren valt.
          </>
        ),
      ],
    };
  },

  naarHetNet: ({ result, config }) => {
    const s = result.stats;
    const verschil = s.gridExportBaselineKwh - s.gridExportBatteryKwh;
    return {
      titel: "Naar het net: hoeveel minder je teruglevert",
      watZieJe: <>Je teruglevering per jaar zonder en met batterij. Wat je minder teruglevert, gaat de batterij in, of wordt bij een negatieve prijs afgeregeld. Afgeregelde stroom telt niet als eigen verbruik.</>,
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        <>Zonder batterij gaat elk overschot naar het net, behalve bij een negatieve prijs: dan neemt het model aan dat de omvormer afregelt (instelbaar). Die afgeregelde stroom telt niet als teruglevering en niet als eigen verbruik.</>,
        <>Met batterij gaat een deel van het overschot eerst de batterij in; wat niet past of niet loont, gaat alsnog naar het net.</>,
        <>Zonder saldering is teruglevering weinig waard, dus elke bewaarde kilowattuur telt tegen de volle afnameprijs.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Teruglevering zonder batterij", waarde: kwh(s.gridExportBaselineKwh) },
          { wat: "Teruglevering met batterij", waarde: kwh(s.gridExportBatteryKwh) },
          {
            wat: verschil < -0.5 ? "Meer teruggeleverd" : "Minder teruggeleverd",
            waarde: `${kwh(Math.abs(verschil))}${s.gridExportBaselineKwh > 0 ? ` (${procent(Math.abs(verschil) / s.gridExportBaselineKwh)})` : ""}`,
            uitkomst: true,
          },
          ...(s.curtailedBaselineKwh > 0.5 || s.curtailedBatteryKwh > 0.5
            ? [
                {
                  wat: "Afgeregeld bij negatieve prijzen, zonder → met batterij",
                  waarde: `${kwh(s.curtailedBaselineKwh)} → ${kwh(s.curtailedBatteryKwh)}`,
                },
              ]
            : []),
        ],
        toelichting:
          s.curtailedBaselineKwh > 0.5 ? (
            <>
              Afregelen telt niet als teruglevering en niet als eigen verbruik:
              die stroom is nooit opgewekt. De batterij vangt er een deel van
              op; wat hij opvangt, gebruik je later zelf.
            </>
          ) : undefined,
      },
    };
  },

  piekuren: ({ result, scenario, config }) => {
    const s = result.stats;
    const basis = aandeel(s.peakHourImportBaselineKwh, s.gridImportBaselineKwh);
    const met = aandeel(s.peakHourImportBatteryKwh, s.gridImportBatteryKwh);
    const sc = scenario ? aandeel(scenario.stats.peakHourImportBatteryKwh, scenario.stats.gridImportBatteryKwh) : null;
    return {
      titel: "Afname in de piekuren",
      watZieJe: (
        <>
          Welk deel van wat je van het net haalt, valt op de uren die het
          voorgestelde nettarief vanaf 2029 het duurst maakt: in de winter van
          16.00 tot 23.00 uur, in de zomer van 19.00 tot 24.00 uur.
        </>
      ),
      bronnen: [PROFIEL_BRON(config), CE_BRON],
      stappen: [
        <>De piekuren zijn de uren waarop de wegingsfactor van het nettarief op zijn maximum staat: in de winter 16.00–23.00 uur (factor 1,0), in de zomer 19.00–24.00 uur (factor 0,7).</>,
        <>Per kwartier in die uren tellen we de netafname op, zonder en met batterij, in wandkloktijd.</>,
        <>Het aandeel is die piekafname gedeeld door de totale netafname. Zo is het te vergelijken met zelfconsumptie: een aandeel, geen kilowatturen.</>,
        <>Onder het nettarief van 2029 verandert het gedrag van de batterij: de winteravond wordt duurder, dus levert hij dan liever. Het scenario rekent dat door.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Piekafname zonder batterij ÷ netafname", waarde: `${kwh(s.peakHourImportBaselineKwh)} ÷ ${kwh(s.gridImportBaselineKwh)} = ${procent(basis)}` },
          { wat: "Met batterij, op de prijzen van toen", waarde: `${kwh(s.peakHourImportBatteryKwh)} ÷ ${kwh(s.gridImportBatteryKwh)} = ${procent(met)}`, uitkomst: sc === null },
          ...(sc !== null && scenario
            ? [{ wat: "Met batterij, onder het nettarief van 2029", waarde: `${kwh(scenario.stats.peakHourImportBatteryKwh)} ÷ ${kwh(scenario.stats.gridImportBatteryKwh)} = ${procent(sc)}`, uitkomst: true }]
            : []),
        ],
      },
      letop: [
        <>De definitie hangt niet af van of het nettarief in de prijs zit; zo is het verschil tussen "nu" en "2029" zuiver het gedrag van de batterij.</>,
        GEMIDDELD_LETOP,
      ],
    };
  },

  laadbeurten: ({ result, config, preset }) => {
    const s = result.stats;
    const bruikbaar = usableCapacityKwh(config.battery);
    return {
      titel: "Laadbeurten: hoe hard de batterij werkt",
      watZieJe: <>Hoe vaak de batterij per jaar volledig vol en leeg gaat, als je alle deelbeurten optelt.</>,
      bronnen: [BATTERIJ_BRON(preset)],
      stappen: [
        <>Het model telt alles wat de batterij per jaar aan het huis levert, aan de stekkerkant.</>,
        <>Dat deelt het door het rendement in één richting en door de bruikbare capaciteit: zoveel keer is de cel gevuld en geleegd.</>,
        <>Meer beurten kan meer opleveren, maar kost ook slijtage. De planner rekent elke beurt af tegen {procent(config.wearFraction ?? 1)} van de slijtageprijs per geleverde kWh (de gekozen strategie): dekt de marge dat niet, dan blijft de batterij stil.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Geleverd aan het huis per jaar", waarde: kwh(s.throughputPerYearKwh) },
          { wat: `Bruikbare capaciteit: ${getal(config.battery.capacityKwh, 2)} kWh × ${procent(config.battery.depthOfCharge)}`, waarde: `${getal(bruikbaar, 2)} kWh` },
          { wat: `Beurten: geleverd ÷ ${procent(config.battery.efficiency, 1)} ÷ bruikbaar`, waarde: `${getal(s.cyclesPerYear, 0)} per jaar`, uitkomst: true },
          { wat: `Levensduur uit de catalogus`, waarde: `${getal(config.cycleLife)} beurten, ${config.calendarLifeYears} jaar` },
        ],
        toelichting: <>{getal(s.cyclesPerYear, 0)} beurten per jaar is {getal(s.cyclesPerYear * config.calendarLifeYears, 0)} in {config.calendarLifeYears} jaar: {s.cyclesPerYear * config.calendarLifeYears < config.cycleLife ? "de kalender gaat eerder op dan de cellen." : "de cellen slijten eerder dan de kalender, en dat weegt mee in de terugverdientijd."}</>,
      },
    };
  },

  doorzet: ({ result, preset }) => ({
    titel: "Door de batterij: wat hij per jaar levert",
    watZieJe: <>Hoeveel kilowattuur de batterij per jaar aan je huis (of het net) afgeeft, aan de stekkerkant.</>,
    bronnen: [BATTERIJ_BRON(preset)],
    stappen: [
      <>Per kwartier telt het model wat de batterij ontlaadt.</>,
      <>Dat is minder dan wat erin ging: het rendement heen en terug van {procent(preset.spec.efficiency ** 2)} gaat ervan af. Zie de sectie over verliezen.</>,
    ],
    voorbeeld: {
      regels: [
        { wat: "In de batterij gegaan per jaar", waarde: kwh(result.losses.chargedKwh) },
        { wat: "Verloren bij laden en ontladen", waarde: kwh(result.losses.totalKwh) },
        { wat: "Geleverd per jaar", waarde: kwh(result.stats.throughputPerYearKwh), uitkomst: true },
      ],
    },
  }),

  slijtage: ({ result, config, preset }) => {
    const s = result.stats;
    const bruikbaar = usableCapacityKwh(config.battery);
    return {
      titel: "Slijtage: wat de laadbeurten van de aanschaf opsouperen",
      watZieJe: (
        <>
          Elke geleverde kilowattuur gebruikt een stukje van de levensduur van de
          batterij. Hier staat wat dat per jaar kost tegen de aanschafprijs, naast
          de besparing, niet ervan afgetrokken.
        </>
      ),
      bronnen: [BATTERIJ_BRON(preset)],
      stappen: [
        <>Over zijn levensduur levert de batterij {getal(config.cycleLife)} beurten × {getal(bruikbaar, 2)} kWh bruikbaar × {procent(config.battery.efficiency, 1)} rendement = {kwh(config.cycleLife * bruikbaar * config.battery.efficiency)} aan de stekkerkant.</>,
        <>De aanschafprijs gedeeld door dat totaal is de slijtageprijs per geleverde kWh: {centPerKwh(s.wearCostEurPerKwh)}.</>,
        <>Maal wat de batterij per jaar levert geeft de slijtage per jaar. Dit bedrag zit al in de aanschafprijs die de terugverdientijd rekent; het hier óók van de besparing aftrekken zou het dubbel tellen.</>,
        <>De planner rekent {procent(config.wearFraction ?? 1)} van deze prijs als drempel, {centPerKwh(s.wearCostEurPerKwh * (config.wearFraction ?? 1))}: een laadbeurt gaat alleen door als de marge na het omzettingsverlies daar bovenuit komt. Dat deel is de strategie-instelling; op 100% handelt de batterij alleen als elke beurt zijn eigen slijtage terugverdient. Op 20% rekent de planner een beurt maar een vijfde van die prijs: de batterij gaat bij veel gebruik eerder door ouderdom dan door zijn beurten achteruit, en een extra beurt kost dan weinig levensduur.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Aanschafprijs", waarde: euro(config.investmentEur) },
          { wat: "Geleverd over de levensduur", waarde: kwh(config.cycleLife * bruikbaar * config.battery.efficiency) },
          { wat: "Slijtageprijs per geleverde kWh", waarde: centPerKwh(s.wearCostEurPerKwh) },
          { wat: "Geleverd per jaar", waarde: kwh(s.throughputPerYearKwh) },
          { wat: "Slijtage per jaar", waarde: euro(s.wearCostPerYearEur), uitkomst: true },
          { wat: "Besparing per jaar, ter vergelijking", waarde: euro(result.averageSavingEur) },
        ],
        toelichting: (
          <>
            Ligt de slijtage per jaar dicht bij de besparing, dan gaat bijna alles
            wat de batterij bespaart op aan zijn eigen afschrijving. Het eigen
            stroomverbruik van de batterij (standby, meestal 60 tot 220 kWh per
            jaar) zit niet in het model en is ook niet van de besparing
            afgetrokken.
          </>
        ),
      },
    };
  },

  prijskloof: ({ result, config }) => {
    const g = result.priceGap;
    return {
      titel: "De prijskloof: waarom er iets te besparen valt",
      watZieJe: <>Wat je gemiddeld betaalt op de momenten dat je afneemt, en wat je gemiddeld krijgt op de momenten dat je teruglevert. Het gat daartussen is waar een batterij van leeft.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON],
      stappen: [
        <>Beide gemiddelden zijn gewogen met je volume: elk kwartier telt mee naar hoeveel er op dat moment door de meter ging.</>,
        <>Een huishouden met panelen neemt af als het duur is (avond, winter) en levert terug als het goedkoop is (middag, zomer). Het simpele uurgemiddelde verbergt dat; het gewogen gemiddelde laat het zien.</>,
        <>Bij afname telt de heffing mee, bij teruglevering niet: zonder saldering krijg je de kale marktprijs. Dat is het grootste deel van de kloof.</>,
        <>Beide bedragen zijn <b>inclusief 21% btw</b>. De prijsreeks van ANWB Energie staat al inclusief btw, en je krijgt je terugleververgoeding ook inclusief btw uitbetaald, dus er wordt nergens btw bij- of afgeteld.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Gewogen afnameprijs", waarde: centPerKwh(g.weightedImportPrice) },
          { wat: "Gewogen terugleverprijs", waarde: centPerKwh(g.weightedExportPrice) },
          { wat: "Diezelfde terugleverprijs exclusief btw, ter controle", waarde: centPerKwh(g.weightedExportPrice / 1.21) },
          { wat: "Ongewogen gemiddelde marktprijs, ter vergelijking", waarde: centPerKwh(g.simpleAveragePrice) },
          { wat: "Kloof per kWh", waarde: centPerKwh(g.weightedImportPrice - g.weightedExportPrice), uitkomst: true },
          { wat: "Aandeel kwartieren met een negatieve terugleverprijs", waarde: procent(g.negativePriceShare, 1) },
        ],
      },
      letop: [EEN_LEVERANCIER_LETOP],
    };
  },

  uitsplitsing: ({ result }) => {
    const b = result.breakdown;
    const n = volledigeJaren(result);
    const periode =
      n > 1 ? `een gemiddeld jaar over ${n} volledige jaren` : "het profieljaar";
    return {
      titel: "Waar de besparing vandaan komt",
      watZieJe: (
        <>
          De besparing in {periode}, in drie posten die samen exact het totaal
          zijn.
        </>
      ),
      bronnen: [{ naam: "De doorrekening zelf", wat: <>Per kwartier: wat de batterij laadde, ontlaadde, en tegen welke prijs.</> }],
      stappen: [
        <>Elk volledig profieljaar wordt apart uitgesplitst; de posten zijn optelbaar, dus het gemiddelde ervan telt op tot de gemiddelde besparing die bovenaan staat.</>,
        <><b>Negatieve prijzen ontlopen</b>: op kwartieren met een negatieve terugleverprijs kost terugleveren geld. Wat de batterij dan opvangt, hoef je niet weg te geven. Staat afregelen aan (de standaard), dan kost teruglevering op die momenten al niets, want de omvormer stopt dan; deze post is dan nul en staat niet in de figuur.</>,
        <><b>Slim in- en verkopen</b>: wat de batterij van het net kocht, naar rato van zijn aandeel in de lading, tegen wat het ontladen opbracht. Kan negatief zijn als een inkoop tegenviel.</>,
        <><b>Zelf verbruiken</b>: de rest. Zo sluit de optelling per definitie op het totaal, en het omzettingsverlies zit er al in verwerkt.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Zelf verbruiken", waarde: euroPrecies(b.selfConsumptionEur) },
          { wat: "Slim in- en verkopen", waarde: euroPrecies(b.arbitrageEur) },
          { wat: "Negatieve prijzen ontlopen", waarde: euroPrecies(b.avoidedNegativeExportEur) },
          { wat: `Samen: de besparing in ${periode}`, waarde: euroPrecies(b.totalEur), uitkomst: true },
          { wat: "Ter info: omzettingsverlies, al verwerkt in de eerste post", waarde: `${euroPrecies(b.conversionLossEur)} (${kwh(b.conversionLossKwh)})` },
        ],
      },
      letop: [
        <>Het omzettingsverlies staat er niet als vierde post bij: het zit al in "zelf verbruiken". Apart aftrekken zou het twee keer tellen.</>,
      ],
    };
  },

  verliezen: ({ result, preset }) => {
    const l = result.losses;
    return {
      titel: "Wat er onderweg verloren gaat",
      watZieJe: <>Hoeveel kilowattuur er per jaar verdwijnt bij laden en ontladen, en wat dat kost.</>,
      bronnen: [BATTERIJ_BRON(preset)],
      stappen: [
        <>Laadverlies is evenredig met wat erin gaat: {procent(1 - preset.spec.efficiency, 1)} van elke geladen kilowattuur.</>,
        <>Ontlaadverlies is evenredig met wat eruit komt, tegen hetzelfde eenrichtingsrendement.</>,
        <>De euro's zijn wat die kilowatturen hadden opgeleverd als ze er nog waren: uit eigen overschot de terugleverprijs, van het net de afnameprijs.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Laadverlies", waarde: `${kwh(l.chargeLossKwh)} · ${euroPrecies(l.chargeLossEur)}` },
          { wat: "Ontlaadverlies", waarde: `${kwh(l.dischargeLossKwh)} · ${euroPrecies(l.dischargeLossEur)}` },
          { wat: "Samen per jaar", waarde: `${kwh(l.totalKwh)} · ${euroPrecies(l.totalEur)}`, uitkomst: true },
          { wat: "Gemeten rendement heen en terug", waarde: procent(l.roundtrip, 1) },
        ],
        toelichting: <>Het gemeten rendement ligt iets onder het rendement uit de catalogus ({procent(preset.spec.efficiency ** 2)}): aan het eind van het jaar zit er nog lading in die niet meer geleverd is.</>,
      },
      letop: [STANDBY_LETOP],
    };
  },

  perJaar: ({ result }) => {
    const j = referentie(result);
    return {
      titel: "Van jaar tot jaar",
      watZieJe: <>De besparing per profieljaar, en daarnaast wat er met perfecte kennis vooraf maximaal in had gezeten.</>,
      bronnen: [PRIJS_BRON],
      stappen: [
        <>Elk kalenderjaar in de gekozen periode wordt apart doorgerekend, met de prijzen en het profiel van dat jaar.</>,
        <>De donkere staaf is de realistische strategie: plannen op day-ahead-prijzen en een verwachting van het verbruik.</>,
        <>De lichte staaf is het optimum met perfecte kennis van alle prijzen en al het verbruik vooraf. Dat bestaat niet in het echt, maar het laat zien hoeveel er nog te winnen zou zijn met betere voorspellingen.</>,
        <>Een deeljaar (bijvoorbeeld een periode die op 1 april begint) is per definitie lager en telt niet mee in het gemiddelde.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: `Realistisch, ${j.year}`, waarde: euroPrecies(j.realisticSavingEur) },
          { wat: `Met perfecte kennis, ${j.year}`, waarde: euroPrecies(j.optimalSavingEur) },
          { wat: "Aandeel van het optimum dat de strategie haalt", waarde: procent(j.captureRate), uitkomst: true },
          ...(result.gap
            ? [
                { wat: "Verlies doordat zon en verbruik van morgen een verwachting zijn", waarde: euroPrecies(result.gap.forecastCostEur) },
                { wat: "Verlies doordat de prijzen van morgen pas om 13:00 bekend zijn", waarde: euroPrecies(result.gap.horizonCostEur) },
              ]
            : []),
        ],
      },
      letop: [GEEN_VOORSPELLING_LETOP],
    };
  },

  maandverloop: ({ result, config }) => {
    const beste = [...result.perMonth].sort((a, b) => b.savingEur - a.savingEur)[0];
    const slechtste = [...result.perMonth].sort((a, b) => a.savingEur - b.savingEur)[0];
    const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
    return {
      titel: "Door het jaar heen",
      watZieJe: <>De besparing per kalendermaand, gemiddeld over de volledige jaren. Zomer en winter zijn wezenlijk anders voor een batterij.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON],
      stappen: [
        <>Per kwartier wordt het verschil in kosten zonder en met batterij aan de kalendermaand toegerekend, in lokale tijd.</>,
        <>In de zomer vangt de batterij zonoverschot op dat anders bijna niets opbracht; in de winter leeft hij van het prijsverschil tussen nacht en avond.</>,
        <>Maanden die in meer jaren voorkomen worden gemiddeld; een maand die maar één keer in de data zit telt één keer.</>,
      ],
      voorbeeld: beste && slechtste
        ? {
            regels: [
              { wat: `Beste maand: ${MAANDEN[beste.month - 1]}`, waarde: euroPrecies(beste.savingEur), uitkomst: true },
              { wat: `Zwakste maand: ${MAANDEN[slechtste.month - 1]}`, waarde: euroPrecies(slechtste.savingEur) },
              { wat: `Gemiddeld dagelijks prijsverschil in ${MAANDEN[beste.month - 1]}`, waarde: centPerKwh(beste.priceSpreadEurPerKwh) },
            ],
          }
        : undefined,
    };
  },

  verschuiving: ({ result, config }) => {
    const winter = result.seasonProfiles.find((p) => p.season === "winter");
    const zomer = result.seasonProfiles.find((p) => p.season === "zomer");
    const piek = (p: typeof winter) => {
      if (!p) return { uur: 0, kwh: 0 };
      let beste = 0;
      let uur = 0;
      for (let u = 0; u < 24; u++) {
        const d =
          p.importBaseline[u]! -
          p.exportBaseline[u]! -
          (p.importBattery[u]! - p.exportBattery[u]!);
        if (d > beste) {
          beste = d;
          uur = u;
        }
      }
      return { uur, kwh: beste };
    };
    const w = piek(winter);
    const z = piek(zomer);
    return {
      titel: "Hoe de batterij je dagprofiel verschuift",
      watZieJe: (
        <>
          Wat er op een gemiddelde dag per uur door je meter gaat, in de winter
          en in de zomer, zonder en met batterij. Boven de nullijn haal je van
          het net, eronder lever je terug.
        </>
      ),
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        <>Elk kwartier van de doorrekening wordt toegerekend aan het uur van de dag waarin het valt, in lokale tijd, en aan het seizoen: zomer is april tot en met september.</>,
        <>De sommen worden gedeeld door het aantal dagen, zodat er een gemiddelde dag uit komt. Winter en zomer staan op dezelfde schaal; anders lijkt een winterdag net zo extreem als een zomerdag.</>,
        <>De getekende waarde is de netto uitwisseling: afname min teruglevering. Eén lijn per situatie dus, geen twee.</>,
        <>De gekleurde kolom per uur is het verschil tussen beide situaties. Groen betekent dat de batterij je van het net af houdt, oker dat hij er juist extra van afneemt om te laden.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: `Winter: grootste verschuiving, om ${w.uur}:00`, waarde: `${getal(w.kwh, 2)} kWh` },
          { wat: `Zomer: grootste verschuiving, om ${z.uur}:00`, waarde: `${getal(z.kwh, 2)} kWh` },
          ...(zomer
            ? [
                {
                  wat: "Zomer: teruglevering per dag, zonder batterij",
                  waarde: kwh(zomer.exportBaseline.reduce((a, b) => a + b, 0)),
                },
                {
                  wat: "Zomer: teruglevering per dag, met batterij",
                  waarde: kwh(zomer.exportBattery.reduce((a, b) => a + b, 0)),
                  uitkomst: true,
                },
              ]
            : []),
        ],
        toelichting: (
          <>
            Het verschil in teruglevering blijft in huis: dat is precies de
            stroom waarop je het gat tussen afname- en terugleverprijs bespaart.
          </>
        ),
      },
      letop: [GEMIDDELD_LETOP],
    };
  },

  verloop: ({ result }) => ({
    titel: "Het resultaat over een week, een maand of een jaar",
    watZieJe: <>Dezelfde doorrekening als het dagprofiel, opgeteld per uur (week), per dag (maand) of per week (jaar): wat de batterij opleverde, en wat de laadbeurten aan slijtage kostten.</>,
    bronnen: [PRIJS_BRON],
    stappen: [
      <>Per kwartier is de besparing het verschil tussen de kosten zonder en met batterij: afname maal afnameprijs, min teruglevering maal terugleverprijs.</>,
      <>Die kwartieren worden opgeteld in vakken van een uur, een dag of een week, in wandkloktijd: een dag loopt van middernacht tot middernacht in Amsterdam, een week van maandag tot en met zondag.</>,
      <>De slijtage per vak is wat de batterij in dat vak leverde maal de volle slijtageprijs per kWh ({centPerKwh(result.stats.wearCostEurPerKwh)}). Die post zit al in de aanschafprijs en wordt daarom niet van de besparing afgetrokken, maar staat er wel naast.</>,
      <>Een vak kan negatief zijn zonder dat er iets mis is: lading die 's nachts is ingekocht wordt de volgende dag geleverd, dus de kosten vallen in het ene vak en de opbrengst in het volgende.</>,
    ],
    letop: [
      <>Het eigen verbruik van de omvormer (standby) zit niet in het model. Het loopt door of de batterij handelt of niet en hoort bij het bezit, niet bij de handel.</>,
      GEEN_VOORSPELLING_LETOP,
    ],
  }),

  dagprofiel: ({ result }) => ({
    titel: "Eén dag van dichtbij",
    watZieJe: <>Wat de batterij op één dag doet: de prijs per kwartier, laden en ontladen, de lading, en wat de dag tot dan toe kostte zonder en met batterij.</>,
    bronnen: [PRIJS_BRON],
    stappen: [
      <>De twee voorbeelddagen zijn de dag met de <b>mediane</b> prijsspreiding in de zomer en in de winter van het meest recente volledige jaar. Niet de beste dag, niet de slechtste: een doorsnee dag.</>,
      <>Een dag loopt van middernacht tot middernacht in Amsterdam en heeft 92, 96 of 100 kwartieren, afhankelijk van de zomertijd.</>,
      <>De batterij houdt zich niet aan de kalender: lading die 's nachts is ingekocht wordt de volgende dag geleverd. Een dag kan daardoor negatief afsluiten terwijl de twee dagen samen positief zijn. De begin- en eindstand van de lading staan er daarom bij.</>,
      <>Met de datumkiezer haal je elke andere dag uit de periode op; die wordt dan uit de al berekende jaardispatch gesneden.</>,
    ],
    voorbeeld: result.sampleDays[0]
      ? {
          regels: [
            { wat: `${result.sampleDays[0].label}: ${result.sampleDays[0].date}`, waarde: euroPrecies(result.sampleDays[0].stats.savingEur) },
            ...(result.sampleDays[1]
              ? [{ wat: `${result.sampleDays[1].label}: ${result.sampleDays[1].date}`, waarde: euroPrecies(result.sampleDays[1].stats.savingEur) }]
              : []),
            { wat: "Hoogste lading op de eerste dag", waarde: `${getal(result.sampleDays[0].stats.socMaxKwh, 2)} kWh van ${getal(result.sampleDays[0].usableCapacityKwh, 2)} kWh bruikbaar`, uitkomst: true },
          ],
        }
      : undefined,
  }),

  nettarief: ({ result, scenario, config, scenarioJaar }) => {
    const jaar = scenarioJaar ?? NETTARIEF_JAAR;
    return {
      titel: "Het voorgestelde nettarief en wat het met de businesscase doet",
      watZieJe: <>Dezelfde doorrekening nog een keer, nu met het tijdsafhankelijke nettarief bovenop de afnameprijs. Als het voorstel van de ACM doorgaat, geldt dat tarief naar verwachting vanaf 1 januari 2029, mogelijk later.</>,
      bronnen: [CE_BRON, PRIJS_BRON],
      stappen: [
        <>Het voorstel geeft per uur en per seizoen een wegingsfactor: 0, 0,3, 0,5, 0,7 of 1,0. Die staan vast. Het basistarief niet; dat is de prognose van CE Delft, in opdracht van NVDE, Holland Solar, Energie-Nederland en Energy Storage NL: {centPerKwh(BASISTARIEF[2030])} in 2030, en {centPerKwh(BASISTARIEF[2029])} in 2029 (ongeveer 7% lager: één jaar tariefstijging van 7,5% eraf).</>,
        <>Per kwartier komt factor × basistarief bovenop de afnameprijs. Alleen op afname: het voorstel beprijst geen invoeding.</>,
        <>De heffing wordt in dit scenario die van het scenariojaar: {centPerKwh(scenarioHeffing(jaar))} in plaats van de 13 tot 17 cent van toen, anders stapelt het een nettarief van straks op een belasting van toen.</>,
        <>De batterij plant opnieuw op de nieuwe prijzen: de winteravond wordt duurder, dus levert hij dan liever; de zomermiddag wordt gratis, dus laadt hij dan liever.</>,
        <>De bedragen hieronder zijn de doorrekening alsof dit tarief er de hele periode al was — zo zijn de twee werelden zuiver te vergelijken. Voor de terugverdientijd telt dat niet: die staat elders op de pagina mét de ingangsdatum erin, dus de eerste jaren op het huidige nettarief.</>,
      ],
      voorbeeld: scenario
        ? {
            regels: [
              { wat: "Besparing per jaar op de prijzen van toen", waarde: euro(result.averageSavingEur) },
              { wat: "Besparing per jaar met het nettarief", waarde: euro(scenario.averageSavingEur), uitkomst: true },
              { wat: "Terugverdientijd als het nettarief blijft zoals nu", waarde: jaren(result.finance.paybackYears) },
              { wat: "Terugverdientijd als het voorstel doorgaat (eerst het huidige tarief, dan het nieuwe)", waarde: jaren(overgangsFinance(result, scenario, config).finance.paybackYears), uitkomst: true },
              { wat: "Laadbeurten per jaar", waarde: `${getal(result.stats.cyclesPerYear, 0)} → ${getal(scenario.stats.cyclesPerYear, 0)}` },
            ],
          }
        : undefined,
      letop: [
        <>Scenario, geen tariefblad. De ACM beslist naar verwachting eind 2026; invoering is "in beginsel" 1 januari 2029, mogelijk later.</>,
        <>De prognose is gedragsonafhankelijk. Als veel huishoudens de piek gaan mijden, herijken de netbeheerders blokken en factoren jaarlijks.</>,
        <>Het vaste deel van de netkosten (capaciteitscomponent, aansluitvergoeding, meetdienst) blijft buiten beeld: dat is met en zonder batterij gelijk.</>,
      ],
    };
  },

  batterijmaat: ({ result, config }) => {
    const j = referentie(result);
    const k = kostenregelVan(config);
    const cap = config.battery.capacityKwh;
    const kw = config.battery.maxDischargeKw;
    const voorbeeldCap = 5;
    const voorbeeldKw = 2.5;
    const stap = (voorbeeldKw > STEKKER_GRENS_KW ? 1 : 0) - (kw > STEKKER_GRENS_KW ? 1 : 0);
    const voorbeeldPrijs =
      config.investmentEur + k.perKwhEur * (voorbeeldCap - cap) + k.perKwEur * (voorbeeldKw - kw) + k.installatieEur * stap;
    return {
      titel: "Welke maat loont",
      watZieJe: <>Dezelfde doorrekening voor {RASTER_CAPACITEITEN.length * RASTER_VERMOGENS.length} combinaties van capaciteit en vermogen, elk met zijn eigen prijs, zodat je ziet welke maat netto het meest oplevert en waar meer batterij niets meer toevoegt.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON, KOSTEN_BRON(config)],
      stappen: [
        <>Elke cel is een volledige doorrekening van de realistische strategie voor die maat, op het meest recente volledige jaar ({j.year}). Het optimum blijft weg; dat zou de kaart minutenlang laten rekenen zonder de vraag te veranderen.</>,
        <><b>De prijs per maat</b> volgt één regel, verankerd aan jouw batterij: die kost {euro(config.investmentEur)}, elke kilowattuur erbij {euro(k.perKwhEur)}, elke kilowatt erbij {euro(k.perKwEur)}, en wie de grens van {getal(STEKKER_GRENS_KW, 1)} kW oversteekt betaalt eenmalig {euro(k.installatieEur)} voor een eigen groep door een installateur (boven 800 W is een vaste aansluiting op een eigen groep de norm). Terug naar een stekkerbatterij gaat de installateur er weer af.</>,
        <>Geen uitbreidingspakketten per merk: die verschillen per model en bij de meeste hubs groeit het vermogen niet mee. Eén regel voor alle maten houdt de kaart vergelijkbaar; de drie getallen zijn instelbaar voor wie een offerte heeft.</>,
        <><b>Netto resultaat</b> is dezelfde financiële doorrekening als bovenaan de pagina: de jaarbesparing herhaald over {config.analysisYears} jaar, met {procent(config.priceEscalation, 1)} prijsstijging, {procent(config.discountRate, 1)} rente die je misloopt en de slijtage van de laadbeurten, min de prijs van die maat. Hoe de besparing terugloopt bij slijtage is alleen voor jouw batterij gemeten; de andere maten lenen die vorm.</>,
        <>De hoogste uitkomst is de cel met de hoogste netto contante waarde in deze doorrekening; geen persoonlijk advies. Terugverdientijd en jaarbesparing staan er als schakelaar naast; op besparing wint de grootste altijd, en dat is precies waarom de kaart met netto begint.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Jouw batterij", waarde: `${getal(cap, 2)} kWh, ${getal(kw, 1)} kW, ${euro(config.investmentEur)}` },
          { wat: `Meerprijs ${getal(voorbeeldCap - cap, 2)} kWh`, waarde: euro(k.perKwhEur * (voorbeeldCap - cap)) },
          { wat: `Meerprijs ${getal(voorbeeldKw - kw, 1)} kW`, waarde: euro(k.perKwEur * (voorbeeldKw - kw)) },
          { wat: "Eigen groep door installateur", waarde: euro(k.installatieEur * stap) },
          { wat: `Prijs van ${voorbeeldCap} kWh bij ${getal(voorbeeldKw, 1)} kW`, waarde: euro(Math.max(0, voorbeeldPrijs)), uitkomst: true },
        ],
      },
      letop: [
        <>De kaart rust op één jaar ({j.year}); het antwoord bovenaan op het gemiddelde over alle volledige jaren. De cel van jouw eigen maat komt daardoor niet precies op dat antwoord uit.</>,
        <>Meer vermogen levert soms niets op: als de batterij toch al vol raakt of leeg is, helpt sneller laden niet. Meer capaciteit helpt alleen zolang je hem ook vol krijgt.</>,
      ],
    };
  },

  uitbreiden: ({ result, config }) => {
    const j = referentie(result);
    return {
      titel: "Tot welke maat loont uitbreiden",
      watZieJe: <>Eén kolom uit de kaart van maten als lijn: het netto resultaat per capaciteit bij het vermogen van jouw batterij, en bij het beste vermogen uit de kaart als dat een ander is.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON, KOSTEN_BRON(config)],
      stappen: [
        <>Elke stip is een cel uit de kaart: dezelfde jaarsimulatie ({j.year}), dezelfde prijs uit de kostenregel, dezelfde financiële doorrekening over {config.analysisYears} jaar.</>,
        <>Van stip naar stip is het verschil in netto resultaat gedeeld door de extra kilowatturen wat die stap per kilowattuur opleverde. Zolang dat positief is, verdient de grotere batterij zijn meerprijs terug.</>,
        <>De streep staat bij de eerste stap waar dat omslaat: vanaf daar kost elke extra kilowattuur meer dan hij over de looptijd oplevert. Dat is het antwoord op "wanneer is uitbreiden niet logisch meer".</>,
      ],
      letop: [
        <>De lijn kent alleen de capaciteiten uit het raster; het echte omslagpunt ligt ergens tussen twee stippen.</>,
        <>Een grotere batterij bij hetzelfde vermogen loopt sneller tegen zijn vermogen aan: hij krijgt de extra ruimte niet meer vol of leeg. Dat is waarom de lijn afvlakt, los van de prijs.</>,
      ],
    };
  },

  voorwie: ({ result, config }) => {
    const j = referentie(result);
    return {
      titel: "Voor wie deze batterij loont",
      watZieJe: <>Jouw batterij doorgerekend voor huishoudens met jouw afname maar een andere teruglevering ({HUISHOUDENS_TERUGLEVERING.map((t) => getal(t)).join(", ")} kWh per jaar), en voor een huishouden zonder zonnepanelen.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON],
      stappen: [
        <>Per huishouden één jaarsimulatie met de realistische strategie op {j.year}, met dezelfde batterij, dezelfde prijs ({euro(config.investmentEur)}) en dezelfde slijtagedrempel als jouw doorrekening. Alleen de teruglevering verschuift; het profiel wordt zo geschaald dat het jaartotaal klopt.</>,
        <>Het huishouden zonder zonnepanelen rekent met het gemeten profiel van aansluitingen zonder invoeding (MFFBAS, afnametype AZI): het gemeten gemiddelde van alle aansluitingen zonder teruglevering in het netgebied, geen bewerking van het profiel met panelen.</>,
        <>Het netto resultaat per punt is dezelfde financiële doorrekening als bovenaan, over {config.analysisYears} jaar. Waar de lijn de nullijn kruist, komt de batterij uit de kosten; dat punt staat in de titel, lineair tussen de twee dichtstbijzijnde huishoudens.</>,
        <>Jouw eigen huishouden staat erbij uit het hoofdresultaat op datzelfde jaar, zodat de lijn te ijken is aan de cijfers bovenaan.</>,
      ],
      letop: [
        <>Alle huishoudens delen jouw afname. Wie meer of minder verbruikt, zit op een andere lijn; verander de afname en reken opnieuw om die te zien.</>,
        GEMIDDELD_LETOP,
      ],
    };
  },

  doelen: ({ config, vergelijking }) => {
    const kaarten = vergelijking ? doelKaarten(vergelijking, config) : {};
    const gekozen = config.doel ?? "rendement";
    const regels = DOELEN.flatMap(({ id, naam }) => {
      const k = kaarten[id];
      if (!k) return [];
      const co2 = k.co2WinstKg === null ? "" : `, ${getal(k.co2WinstKg)} kg CO2 minder`;
      return [{
        wat: `${naam}${id === gekozen ? " (gekozen)" : ""}`,
        waarde: `${euro(k.besparingEur)} per jaar${co2}`,
        uitkomst: id === gekozen,
      }];
    });
    return {
      titel: "Drie doelen: waar de batterij op stuurt",
      watZieJe: (
        <>
          Dezelfde batterij en hetzelfde huishouden, drie keer doorgerekend.
          Alleen waar de planner op stuurt verschilt; de uurprijzen, het profiel
          en de batterij zijn dezelfde.
        </>
      ),
      bronnen: [PRIJS_BRON, PROFIEL_BRON(config), NED_BRON],
      stappen: [
        <>
          <b>Rendement</b> stuurt op prijs: laden als stroom goedkoop is of als
          er eigen zon over is, leveren als hij duur is, ook aan het net. Dit is
          de stand van het antwoord bovenaan. De CO2-winst die je erbij ziet is
          een bijeffect: goedkope uren zijn vaak schone uren, maar niet altijd.
        </>,
        <>
          <b>Zelfconsumptie</b> gebruikt dezelfde prijzen, maar met de handen op
          de rug: laden mag alleen uit eigen overschot, leveren alleen aan het
          eigen huis. Nooit laden uit het net, nooit terugleveren uit de
          batterij. Binnen die grenzen kiest de planner nog wel het beste
          moment.
        </>,
        <>
          <b>Uitstoot</b> geeft de planner de emissiefactor van elk uur in plaats
          van de prijs: de gemiddelde uitstoot van de Nederlandse opwek op dat
          uur (NED), niet de marginale van de centrale die bijspringt. De
          batterij mijdt dan de vuilste uren, ongeacht de prijs. Teruglevering
          telt voor jouw voetafdruk niet mee. Om de slijtage mee te wegen staat
          één cent gelijk aan {GRAM_PER_CENT} gram.
        </>,
        <>
          De afrekening gaat altijd in echte euro&apos;s: elke stand wordt
          achteraf afgerekend op de werkelijke uurprijzen, en de CO2 op de
          werkelijke uurfactoren. Alleen het plan verschilt. Daarom kost een
          ander doel dan rendement vrijwel altijd geld; de kaarten laten zien
          hoeveel, en wat je ervoor terugkrijgt.
        </>,
        <>
          De terugverdientijd rekent voor elk doel zoals het antwoord bovenaan:
          eerst de tarieven van nu, daarna het voorgestelde nettarief. De
          voorbeelddag is voor alle drie dezelfde: de doorsnee zomerdag van het
          tabblad Wanneer.
        </>,
      ],
      ...(regels.length > 0 ? { voorbeeld: { regels } } : {}),
      letop: [
        MARGINAAL_LETOP,
        <>
          Zonder zonnepanelen is er geen eigen overschot, dus doet de stand
          Zelfconsumptie dan niets.
        </>,
        GEMIDDELD_LETOP,
      ],
    };
  },

  co2antwoord: ({ result, config }) => {
    const c = result.co2;
    const n = volledigeJaren(result);
    if (!c) {
      return {
        titel: "De CO2-balans",
        watZieJe: <>Voor deze periode zijn er geen emissiefactoren in de data.</>,
        bronnen: [NED_BRON],
        stappen: [<>De reeks van NED loopt van 2023 tot nu; kies een periode daarbinnen.</>],
      };
    }
    const h = huishoudPerspectief(c);
    return {
      titel: "Wat de batterij jouw voetafdruk scheelt",
      watZieJe: <>De uitstoot van de stroom die je van het net haalt, zonder en met batterij, gemiddeld per jaar over de {n > 1 ? `${n} volledige jaren` : "gekozen periode"}.</>,
      bronnen: [NED_BRON, PROFIEL_BRON(config)],
      stappen: [
        <>Per kwartier: wat je van het net afnam (uit de doorrekening, zonder en met batterij) maal de emissiefactor van dat uur. Opgeteld over het jaar is dat de uitstoot van je netafname.</>,
        <>Alleen afname telt. Wat je teruglevert gebruikt iemand anders; dat is zijn voetafdruk. Het perspectief van Nederland, waar teruglevering wél meetelt, staat onderaan het tabblad.</>,
        zonderPanelen(config) ? (
          <>Zonder zonnepanelen laadt de batterij alleen van het net. CO2-winst ontstaat als hij laadt op uren waarop de mix schoner is dan op de uren waarop hij levert. Omdat er bij laden en ontladen stroom verloren gaat, haal je in totaal meer van het net; dat telt mee met de factor van het laaduur.</>
        ) : (
          <>De batterij kan op twee manieren winst geven: hij bewaart je eigen zonnestroom voor de avond, zodat je dan minder van het net haalt terwijl gascentrales draaien, en als hij van het net laadt, kan hij dat doen op uren waarop de mix schoner is dan wanneer hij levert.</>
        ),
        <>De gewogen factor is de uitstoot gedeeld door de afname: hoger dan het jaargemiddelde van de mix als je vooral 's avonds afneemt, lager als de batterij je afname naar schone uren schuift.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Netafname zonder batterij", waarde: kwh(c.importBasisKwh) },
          { wat: "Uitstoot daarvan", waarde: `${getal(h.zonderKg)} kg` },
          { wat: "Netafname met batterij", waarde: kwh(c.importBatKwh) },
          { wat: "Uitstoot daarvan", waarde: `${getal(h.metKg)} kg` },
          { wat: h.winstKg >= 0 ? "Minder uitstoot per jaar" : "Meer uitstoot per jaar", waarde: `${getal(Math.abs(h.winstKg))} kg`, uitkomst: true },
          ...(h.winstKg > 0.5
            ? [{ wat: `Zoveel als autorijden (${AUTO_G_PER_KM} g/km)`, waarde: `${getal(Math.round((h.winstKg * 1000) / AUTO_G_PER_KM / 10) * 10)} km` }]
            : []),
        ],
      },
      letop: [
        MARGINAAL_LETOP,
        co2SturingLetop(config),
        <>De omzettingsverliezen van de batterij zitten erin: wat hij extra van het net haalt om te laden, telt mee met de factor van dat uur.</>,
        PRODUCTIE_LETOP,
        <>De autokilometers zijn een vergelijking, geen berekening: een middelgrote benzineauto stoot 149 g CO2 per km uit de uitlaat uit (co2emissiefactoren.nl, 2025), hier afgerond op {AUTO_G_PER_KM} g/km.</>,
      ],
    };
  },

  co2uren: ({ result }) => ({
    titel: "Wanneer stroom schoon is",
    watZieJe: <>De gemiddelde emissiefactor per uur van de dag in winter en zomer, en per uur hoeveel afname de batterij van het net weghaalt.</>,
    bronnen: [NED_BRON],
    stappen: [
      <>De lijn is het gemiddelde van de emissiefactor over alle dagen van het seizoen, per uur van de dag, over de volledige jaren. Zomer is april tot en met september, dezelfde grens als het nettarief.</>,
      <>De staven eronder komen uit de seizoensprofielen op het tabblad Wanneer: de gemiddelde afname per uur zonder batterij min die met batterij. Boven de lijn haalt de batterij afname weg, eronder laadt hij van het net.</>,
      <>Vallen de staven boven de lijn samen met de hoge uren van de curve, dan komt de CO2-winst uit de avond; vallen de staven onder de lijn samen met de lage uren, dan laadt de batterij schoon.</>,
    ],
    letop: [
      <>Een gemiddeld dagprofiel vlakt uit: op één dag is de middagfactor lager en de avondpiek hoger dan hier. De optelling per kwartier in de balans gebruikt de echte uren, niet dit gemiddelde.</>,
      result.co2 && result.co2.ontbrekendeKwartieren > 0
        ? <>Voor {getal(result.co2.ontbrekendeKwartieren / 4)} uur ontbrak de factor (de NED-reeks loopt achter); die uren tellen nergens mee.</>
        : <>De reeks van NED heeft geen gaten in de gekozen periode.</>,
    ],
  }),

  co2maanden: ({ config }) => ({
    titel: "De CO2-winst per maand",
    watZieJe: <>Hoeveel minder CO2 je netafname per maand kost met batterij, gemiddeld over de volledige jaren.</>,
    bronnen: [NED_BRON],
    stappen: [
      <>Per maand: de uitstoot van de afname zonder batterij min die met batterij, opgeteld uit de kwartieren van die maand en gemiddeld over de jaren waarin de maand voorkomt.</>,
      zonderPanelen(config) ? (
        <>Zonder zonnepanelen verschuift de batterij alleen afname: hij laadt van het net en levert later. Dat geeft winst in maanden waarin de laaduren schoner zijn dan de leveruren, en verlies waar het andersom is.</>
      ) : (
        <>In de zomer kan de batterij zonnestroom bewaren voor de avond, als er anders stroom van gascentrales nodig was: veel winst per kWh. In de winter verschuift hij afname van de avondpiek naar de nacht, en die nacht is niet altijd schoner: soms draait er dan meer kolen of minder wind.</>
      ),
    ],
    letop: [
      <>Een maand kan negatief uitvallen: dan laadde de batterij op uren die vuiler waren dan de uren waarop hij leverde. Financieel kan dat nog steeds lonen, want de prijs volgt de mix niet één op één.</>,
      co2SturingLetop(config),
      MARGINAAL_LETOP,
    ],
  }),

  co2nederland: ({ result, config }) => {
    const c = result.co2;
    const drempel = config.co2DrempelG ?? STANDAARD_CO2_DREMPEL_G;
    const nl = c ? nederlandPerspectief(c, drempel) : null;
    return {
      titel: "Het perspectief van Nederland",
      watZieJe: <>Wat de batterij Nederland als geheel scheelt, met je teruglevering erbij: vanaf welke emissiefactor jouw zonnestroom elders nog iets verdringt, en hoeveel ervan in overschot-uren viel.</>,
      bronnen: [NED_BRON, PROFIEL_BRON(config)],
      stappen: [
        <>Vanuit Nederland is jouw teruglevering geen verlies: een buur gebruikt die kWh en er hoeft minder uit een centrale te komen. Die vermeden uitstoot is de teruglevering maal de factor van dat uur, en gaat van de uitstoot van je afname af.</>,
        <>Behalve op uren waarop de mix al onder de drempel zit ({getal(drempel)} g/kWh): dan is er vaak, maar niet altijd, meer aanbod dan vraag in Nederland, en gaat de kWh de grens over of wordt hij afgeschakeld. Die teruglevering telt hier niet mee. De drempel is een benadering van overschot, geen meting.</>,
        <>De balans bewaart afname en teruglevering per klasse van {CO2_KLASSE_G} g/kWh. Daardoor kun je de drempel verschuiven zonder opnieuw te rekenen; hij rondt af op de klassegrens.</>,
        zonderPanelen(config) ? (
          c && c.exportBatKwh > 0.5 ? (
            <>Zonder zonnepanelen lever je zelf niets terug. Alleen wat de batterij in dure uren aan het net verkoopt ({kwh(c.exportBatKwh)} per jaar) telt voor Nederland extra mee; daardoor wijkt het perspectief van Nederland een fractie af van dat van je eigen afname.</>
          ) : (
            <>Zonder zonnepanelen lever je niets terug, en is het perspectief van Nederland gelijk aan dat van je eigen afname.</>
          )
        ) : (
          <>De batterij kan Nederland op twee manieren helpen: hij kan afname weghalen uit vuile uren (net als voor jou), en wat hij opslaat, kan uit overschot-uren komen, waar het toch weinig verdrong. Wat hij opslaat uit de andere uren gaat er juist van af: die buur moet dan toch naar de centrale.</>
        ),
      ],
      voorbeeld: nl && c
        ? {
            regels: [
              { wat: "Uitstoot afname zonder batterij", waarde: `${getal(c.importBasisKg)} kg` },
              { wat: "Vermeden door teruglevering (boven de drempel)", waarde: `${getal(nl.vermedenZonderKg)} kg` },
              { wat: "Voor Nederland, zonder batterij", waarde: `${getal(nl.zonderKg)} kg` },
              { wat: "Voor Nederland, met batterij", waarde: `${getal(nl.metKg)} kg` },
              { wat: nl.winstKg >= 0 ? "Minder uitstoot voor Nederland" : "Meer uitstoot voor Nederland", waarde: `${getal(Math.abs(nl.winstKg))} kg`, uitkomst: true },
              { wat: "Teruglevering in overschot-uren, zonder → met", waarde: `${kwh(nl.overschotZonderKwh)} → ${kwh(nl.overschotMetKwh)}` },
            ],
          }
        : undefined,
      letop: [
        <>De drempel is een keuze. Onder de 100 g/kWh bestaat de Nederlandse mix overwegend uit zon, wind en kernenergie; bij 100 g/kWh kan nog zo'n kwart uit gas komen. In 2025 zat de mix in ongeveer een kwart van de uren onder die grens. Wie de drempel op nul zet, telt alle teruglevering als nuttig en ziet de twee perspectieven naar elkaar toe kruipen.</>,
        <>Of een kWh werkelijk geëxporteerd of afgeschakeld werd, weet deze factor niet; NED publiceert de netto import en export wel, maar niet per aansluiting. De emissiefactor als maat voor overschot is een benadering, en een voorzichtige: op uren met veel export is de factor laag, en die uren tellen hier al als overschot.</>,
        MARGINAAL_LETOP,
        PRODUCTIE_LETOP,
        GEMIDDELD_LETOP,
      ],
    };
  },

  beurten: ({ result, config, preset }) => {
    const s = result.stats;
    const deel = config.wearFraction ?? 1;
    const drempel = s.wearCostEurPerKwh * deel;
    const rondgang = config.battery.efficiency ** 2;
    const inkoop = 0.2;
    const verlies = inkoop / rondgang - inkoop;
    const strategie = strategieVoor(deel);
    const inKalender = s.cyclesPerYear * config.calendarLifeYears;
    const jarenTotOp = s.cyclesPerYear > 0 ? config.cycleLife / s.cyclesPerYear : null;
    return {
      titel: "De slijtagedrempel: wanneer een laadbeurt de moeite waard is",
      watZieJe: (
        <>
          Hoe de batterij zijn laadbeurten opmaakt tegenover wat de cellen
          aankunnen en hoe oud hij mag worden, en welke drempel de planner
          gebruikt om te beslissen of een beurt doorgaat.
        </>
      ),
      bronnen: [
        BATTERIJ_BRON(preset),
        {
          naam: "Literatuur over slijtage in de aansturing",
          wat: (
            <>
              Xu e.a., <i>Factoring the cycle aging cost of batteries participating in
              electricity markets</i> (2018); Schade, <i>Battery degradation: impact on
              economic dispatch</i> (2024). Beide concluderen dat een batterij alleen
              moet handelen als de marge boven de marginale slijtage ligt: wat één
              beurt extra werkelijk aan levensduur kost.
            </>
          ),
        },
      ],
      stappen: [
        <>
          <b>Wat de drempel is.</b> Elke kWh die de batterij levert, gebruikt een
          stukje van zijn levensduur. De planner rekent daar een prijs voor: de
          slijtageprijs per geleverde kWh, {centPerKwh(s.wearCostEurPerKwh)} bij deze
          batterij (aanschaf ÷ beurten × bruikbaar × rendement), maal het deel dat
          de strategie meerekent ({procent(deel)}). Dat is {centPerKwh(drempel)}.
        </>,
        <>
          <b>Hoe hij werkt.</b> De planner telt die prijs bij de kosten van elke
          kWh ontladen. Een beurt gaat alleen door als wat hij oplevert groter is
          dan wat hij kost aan inkoop, omzettingsverlies én drempel. Om 1 kWh te
          leveren koop je 1 ÷ {procent(rondgang, 1)} = {getal(1 / rondgang, 2)} kWh in, dus
          bij een inkoopprijs van {centPerKwh(inkoop)} moet de verkoopprijs minstens{" "}
          {centPerKwh(inkoop + verlies + drempel)} zijn: {centPerKwh(verlies)} voor het
          verlies en {centPerKwh(drempel)} voor de slijtage.
        </>,
        <>
          <b>Waarom je hem gebruikt.</b> Zonder drempel handelt de batterij op elk
          prijsverschil dat het omzettingsverlies dekt, ook voor een paar cent, en
          verbruikt hij zijn beurten voor bijna niets. Met de volle prijs als drempel
          verdient elke beurt zijn eigen slijtage tegen de aanschafprijs terug, maar
          laat de batterij ook beurten liggen die per saldo wél iets hadden
          opgeleverd als hij toch aan ouderdom sterft.
        </>,
        <>
          <b>Waarom het een keuze is.</b> Een batterij gaat kapot aan het eerste van
          twee dingen: zijn beurten raken op, of hij wordt te oud. Raken de beurten
          niet op vóór de kalender, dan kost een extra beurt in werkelijkheid minder
          dan de volle prijs, want de cellen waren toch al afgeschreven op leeftijd.
          Wat een beurt écht kost, hangt dus af van hoe vaak je handelt, en dat is
          precies wat de drempel bepaalt. De drie standen ({STRATEGIEEN.map((st) => `${st.naam} ${procent(st.deel)}`).join(", ")})
          zijn drie antwoorden op die vraag.
        </>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Slijtageprijs per geleverde kWh", waarde: centPerKwh(s.wearCostEurPerKwh) },
          { wat: `Strategie: ${strategie ? strategie.naam : "eigen stand"}, ${procent(deel)} daarvan`, waarde: centPerKwh(drempel), uitkomst: true },
          { wat: `Minimaal prijsverschil bij inkoop tegen ${centPerKwh(inkoop)}`, waarde: centPerKwh(verlies + drempel) },
          { wat: "Laadbeurten per jaar met deze drempel", waarde: getal(s.cyclesPerYear, 0) },
          { wat: `In ${config.calendarLifeYears} jaar kalenderlevensduur`, waarde: `${getal(inKalender)} van ${getal(config.cycleLife)}` },
          ...(jarenTotOp !== null ? [{ wat: "Beurten op na", waarde: jaren(jarenTotOp), uitkomst: true }] : []),
        ],
        toelichting:
          jarenTotOp !== null && jarenTotOp < config.calendarLifeYears ? (
            <>De beurten zijn eerder op dan de kalender: elke beurt kost hier echt levensduur, en een strenge drempel is op zijn plaats.</>
          ) : deel > 0.2 ? (
            <>De kalender is eerder op dan de beurten. Een lagere stand kan dan meer beurten en meer opbrengst geven, zolang de beurten niet opraken vóór de kalender. Kies een andere stand en reken opnieuw om het te zien.</>
          ) : (
            <>De kalender is eerder op dan de beurten: de batterij gaat eerder door ouderdom dan door zijn laadbeurten achteruit.</>
          ),
      },
      letop: [
        <>De zichtbare slijtagepost bij de cijfers rekent altijd met de volle prijs, ongeacht de strategie: dat is wat een kWh van de aanschaf opsoupeert. De strategie verandert alleen de beslissing van de planner.</>,
        <>Het model rekent met een vaste slijtageprijs per kWh. In werkelijkheid slijt een cel meer bij diepe beurten en bij een hoge laadtoestand; dat verfijnt de prijs, maar verandert de regel niet.</>,
      ],
    };
  },

  cashflow: ({ result, scenario, config }) => {
    // Dezelfde grondslag als de kaart erboven: met de overgang naar het
    // nettarief zodra dat scenario er is. De dialoog rekende eerder met het
    // huidige tarief over de hele looptijd, en gaf zo 6 jaar en 11 maanden
    // naast een kaart met 5 jaar.
    const overgang = scenario ? overgangsFinance(result, scenario, config) : null;
    const f = overgang?.finance ?? result.finance;
    const laatste = f.cashflows[f.cashflows.length - 1];
    return {
      titel: "Over de looptijd: terugverdientijd en contante waarde",
      watZieJe: <>De opgetelde besparing jaar na jaar tegenover de aanschafprijs, en wat dat vandaag waard is.</>,
      bronnen: [{ naam: "Jouw aannames", wat: <>Looptijd {config.analysisYears} jaar, prijsstijging {procent(config.priceEscalation, 1)} per jaar, rente die je misloopt {procent(config.discountRate, 1)}, capaciteitsverlies {procent(config.calendarFadePerYear, 2)} per jaar, levensduur {getal(config.cycleLife)} laadbeurten.</> }],
      stappen: [
        <>Elk jaar verliest de batterij capaciteit: door ouderdom, en door laadbeurten zodra de levensduur in zicht komt. De besparing bij minder capaciteit wordt afgelezen van een curve die op 70%, 85% en 100% capaciteit is doorgerekend.</>,
        overgang ? (
          <>Het voorgestelde nettarief gaat naar verwachting op 1 januari {overgang.ingangsjaar} in. De lijn rekent daarom {overgangZin(overgang)} met de besparing onder het huidige nettarief, en daarna met die onder het nieuwe: dezelfde batterij, die gewoon doorslijt.</>
        ) : (
          <>Het nettariefscenario is nog niet doorgerekend; tot dan rekent de lijn met het huidige nettarief over de hele looptijd.</>
        ),
        <>Die besparing stijgt mee met de prijsstijging die je hebt ingesteld.</>,
        <>De terugverdientijd is het moment waarop de opgetelde nominale besparing de aanschafprijs inhaalt, lineair binnen het jaar.</>,
        <>De contante waarde rekent elk jaar terug met de rente die je misloopt en trekt de aanschaf ervan af. Positief betekent: beter dan het geld laten staan.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Aanschafprijs", waarde: euro(config.investmentEur) },
          { wat: "Besparing in het eerste jaar", waarde: euro(f.cashflows[0]?.savingNominalEur ?? 0) },
          ...(laatste
            ? [
                { wat: `Opgeteld na ${config.analysisYears} jaar, netto na aftrek van de aanschaf (nominaal)`, waarde: euro(laatste.cumulativeNominalEur) },
                { wat: `Resterende capaciteit na ${config.analysisYears} jaar`, waarde: procent(laatste.capacityFraction) },
              ]
            : []),
          { wat: overgang ? "Terugverdiend na, als het nettarief-voorstel doorgaat" : "Terugverdiend na", waarde: jaren(f.paybackYears), uitkomst: true },
          { wat: "Netto contante waarde", waarde: euro(f.npvEur), uitkomst: true },
          ...(f.irr !== null ? [{ wat: "Intern rendement", waarde: procent(f.irr, 1) }] : []),
          ...(f.endOfLifeYear !== null ? [{ wat: "Laadbeurten van de cellen op in jaar", waarde: String(f.endOfLifeYear) }] : []),
          ...(overgang
            ? [
                {
                  wat: "Ter vergelijking, als het nettarief blijft zoals nu: terugverdiend na",
                  waarde: jaren(result.finance.paybackYears),
                },
                {
                  wat: "Ter vergelijking, als het nettarief blijft zoals nu: netto contante waarde",
                  waarde: euro(result.finance.npvEur),
                },
                ...(result.finance.irr !== null
                  ? [{ wat: "Ter vergelijking, als het nettarief blijft zoals nu: intern rendement", waarde: procent(result.finance.irr, 1) }]
                  : []),
              ]
            : []),
        ],
      },
      letop: [
        <>De looptijd is een keuze van jou over de beoordeling, geen eigenschap van de accu. Rente verandert alleen de contante waarde; prijsstijging ook de terugverdientijd. Geen van beide verandert de jaaropbrengst.</>,
        GEEN_VOORSPELLING_LETOP,
      ],
    };
  },
};
