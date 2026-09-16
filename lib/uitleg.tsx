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
import { referentieJaar, type AnalysisResult, type YearAnalysis } from "./model/analysis";
import { usableCapacityKwh } from "./model/battery";
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
  scenario: AnalysisResult | null;
  /** De configuratie waar `result` bij hoort. */
  config: Configuration;
  preset: BatteryPreset;
  /** Voor welk jaar het basistarief in het scenario geldt. */
  scenarioJaar?: NettariefJaar;
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
  | "beurten"
  | "cashflow";

// ── Bronnen ────────────────────────────────────────────────────────────────

const PROFIEL_BRON = (c: Configuration) => ({
  naam: "MFFBAS profielfracties",
  wat:
    c.afnametype === "AZI" ? (
      <>
        Het werkelijk gemeten verbruikspatroon per kwartier van huishoudens
        zónder zonnepanelen (aansluiting zonder invoeding) in netgebied{" "}
        {netgebiedNaam(c.domain)}, categorie E1A. Geschaald naar jouw
        jaarafname. Dit is een eigen meting, geen bewerking van het profiel
        met panelen.
      </>
    ) : (
      <>
        Het werkelijk gemeten verbruiks- en terugleverpatroon per kwartier van
        huishoudens met zonnepanelen en een dynamisch contract in netgebied{" "}
        {netgebiedNaam(c.domain)}, categorie E1A. Geschaald naar jouw jaarafname
        en jaarteruglevering.
      </>
    ),
});
const PRIJS_BRON = {
  naam: "ANWB Energie, uurtarieven",
  wat: (
    <>
      De werkelijke inkoopprijs per uur, inclusief btw, en de heffing
      (energiebelasting plus opslag) zoals die op dat uur gold. Uitgesmeerd over
      de vier kwartieren van het uur.
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
const CE_BRON = {
  naam: "CE Delft en Netbeheer Nederland",
  wat: (
    <>
      De wegingsfactoren per uur uit het codewijzigingsvoorstel van 1 mei 2026,
      en het basistarief uit {NETTARIEF_BRON}.
    </>
  ),
};

// ── Waarschuwingen ─────────────────────────────────────────────────────────

const GEMIDDELD_LETOP = (
  <>
    Het profiel is een gemiddelde over veel huishoudens en daardoor gladder dan
    één aansluiting. Dat onderschat wat een batterij kan opvangen eerder dan
    dat het overdrijft. De schuif "Pieken in je verbruik" maakt dat instelbaar.
  </>
);
const GEEN_VOORSPELLING_LETOP = (
  <>
    Dit is geen voorspelling. De vraag is wat de batterij had opgeleverd op de
    prijzen en profielen zoals ze werkelijk waren, zonder saldering. Wat prijzen
    en belastingen de komende jaren doen, is onzeker.
  </>
);
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
  antwoord: ({ result, config, preset }) => {
    const j = referentie(result);
    const n = volledigeJaren(result);
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
        <>
          Het gemeten profiel geeft per kwartier hoeveel er van het net kwam en
          hoeveel ernaartoe ging. Beide worden zo geschaald dat het jaartotaal
          exact op jouw meterstanden uitkomt: {kwh(config.household.annualGridImportKwh)} afname en{" "}
          {kwh(config.household.annualGridExportKwh)} teruglevering.
        </>,
        <>
          Zonder batterij kost elk kwartier afname de uurprijs plus heffing, en
          levert elk kwartier teruglevering de kale uurprijs op. Zonder
          saldering dus: dat is de situatie vanaf 2027.
        </>,
        <>
          Met batterij plant een strategie elke dag om 13:00 de komende uren,
          op de day-ahead-prijzen die dan bekend zijn en een verwachting van je
          verbruik uit de afgelopen week. Ze laadt bij zonoverschot of goedkope
          uren en levert bij dure uren, binnen het vermogen en het rendement
          van de batterij.
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
          {
            wat: "Terugverdiend na",
            waarde: jaren(result.finance.paybackYears),
            uitkomst: true,
          },
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
      letop: [GEEN_VOORSPELLING_LETOP, GEMIDDELD_LETOP, EEN_LEVERANCIER_LETOP],
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
          Wat je direct zelf gebruikt is opwek min teruglevering: alles wat niet
          naar het net ging, is in huis opgegaan.
        </>,
        <>Zelfconsumptie is dat deel gedeeld door de opwek. Met batterij daalt de
          teruglevering, dus stijgt het aandeel.</>,
      ],
      voorbeeld: {
        regels: [
          {
            wat: geschat ? "Jaaropwek van je panelen (geschat)" : "Jaaropwek van je panelen (ingevuld)",
            waarde: kwh(opwek),
          },
          { wat: "Teruglevering zonder batterij", waarde: kwh(s.gridExportBaselineKwh) },
          { wat: "Zelf gebruikt zonder batterij: 1 − teruglevering ÷ opwek", waarde: procent(s.selfConsumptionBaseline ?? 0) },
          { wat: "Teruglevering met batterij", waarde: kwh(s.gridExportBatteryKwh) },
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
    const direct = Math.max(0, opwek - s.gridExportBaselineKwh);
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
        <>Bruto verbruik is netafname plus wat je direct van je eigen zon gebruikte (opwek min teruglevering).</>,
        <>Zelf gedekt is 1 min netafname gedeeld door bruto verbruik.</>,
        <>Met batterij daalt de netafname, dus stijgt het aandeel.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Direct zelf gebruikt: opwek − teruglevering", waarde: kwh(direct) },
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
    return {
      titel: "Van het net: hoeveel minder je afneemt",
      watZieJe: <>Je netafname per jaar zonder en met batterij, gemiddeld over de volledige jaren.</>,
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        <>Zonder batterij is de afname het geschaalde profiel: precies je meterstand.</>,
        <>
          Met batterij telt het model per kwartier wat er nog van het net komt:
          je verbruik min wat de batterij levert, plus wat de batterij van het
          net laadt.
        </>,
        <>Het verschil is wat de batterij aan eigen zon voor later bewaarde, min wat hij zelf aan het net kocht.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Netafname zonder batterij", waarde: kwh(s.gridImportBaselineKwh) },
          { wat: "Netafname met batterij", waarde: kwh(s.gridImportBatteryKwh) },
          { wat: "Minder van het net", waarde: `${kwh(s.gridImportBaselineKwh - s.gridImportBatteryKwh)} (${procent(1 - aandeel(s.gridImportBatteryKwh, s.gridImportBaselineKwh))})`, uitkomst: true },
        ],
      },
      letop: [
        <>
          Bij dure uren kan de batterij ook van het net laden om later te
          leveren. Dan stijgt de afname op dat moment; netto daalt hij toch,
          zolang er eigen zon te bewaren valt.
        </>,
      ],
    };
  },

  naarHetNet: ({ result, config }) => {
    const s = result.stats;
    return {
      titel: "Naar het net: hoeveel minder je teruglevert",
      watZieJe: <>Je teruglevering per jaar zonder en met batterij. Wat je niet teruglevert, gebruik je zelf.</>,
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        <>Zonder batterij gaat elk overschot naar het net, behalve bij een negatieve prijs: dan regelt de omvormer af.</>,
        <>Met batterij gaat een deel van het overschot eerst de batterij in; wat niet past of niet loont, gaat alsnog naar het net.</>,
        <>Zonder saldering is teruglevering weinig waard, dus elke bewaarde kilowattuur telt tegen de volle afnameprijs.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Teruglevering zonder batterij", waarde: kwh(s.gridExportBaselineKwh) },
          { wat: "Teruglevering met batterij", waarde: kwh(s.gridExportBatteryKwh) },
          { wat: "Zelf gebruikt in plaats van teruggeleverd", waarde: `${kwh(s.gridExportBaselineKwh - s.gridExportBatteryKwh)} (${procent(1 - aandeel(s.gridExportBatteryKwh, s.gridExportBaselineKwh))})`, uitkomst: true },
        ],
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
          nettarief vanaf 2029 het duurst maakt: winter 16 tot en met 22 uur,
          zomer 19 tot en met 23 uur.
        </>
      ),
      bronnen: [PROFIEL_BRON(config), CE_BRON],
      stappen: [
        <>De piekuren zijn de uren waarop de wegingsfactor van het nettarief op zijn maximum staat: in de winter 16–22 uur (factor 1,0), in de zomer 19–23 uur (factor 0,7).</>,
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
        <>Meer beurten is meer opbrengst, maar ook slijtage. De planner rekent elke beurt af tegen {procent(config.wearFraction ?? 1)} van de slijtageprijs per geleverde kWh (de gekozen strategie): dekt de marge dat niet, dan blijft de batterij stil.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Geleverd aan het huis per jaar", waarde: kwh(s.throughputPerYearKwh) },
          { wat: `Bruikbare capaciteit: ${getal(config.battery.capacityKwh, 2)} kWh × ${procent(config.battery.depthOfCharge)}`, waarde: `${getal(bruikbaar, 2)} kWh` },
          { wat: `Beurten: geleverd ÷ ${procent(config.battery.efficiency, 1)} ÷ bruikbaar`, waarde: `${getal(s.cyclesPerYear, 0)} per jaar`, uitkomst: true },
          { wat: `Levensduur uit de catalogus`, waarde: `${config.cycleLife} beurten, ${config.calendarLifeYears} jaar` },
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
        <>Over zijn levensduur levert de batterij {config.cycleLife} beurten × {getal(bruikbaar, 2)} kWh bruikbaar × {procent(config.battery.efficiency, 1)} rendement = {kwh(config.cycleLife * bruikbaar * config.battery.efficiency)} aan de stekkerkant.</>,
        <>De aanschafprijs gedeeld door dat totaal is de slijtageprijs per geleverde kWh: {centPerKwh(s.wearCostEurPerKwh)}.</>,
        <>Maal wat de batterij per jaar levert geeft de slijtage per jaar. Dit bedrag zit al in de aanschafprijs die de terugverdientijd rekent; het hier óók van de besparing aftrekken zou het dubbel tellen.</>,
        <>De planner rekent {procent(config.wearFraction ?? 1)} van deze prijs als drempel, {centPerKwh(s.wearCostEurPerKwh * (config.wearFraction ?? 1))}: een laadbeurt gaat alleen door als de marge na het omzettingsverlies daar bovenuit komt. Dat deel is de strategie-instelling; op 100% handelt de batterij alleen als elke beurt zijn eigen slijtage terugverdient, op 20% telt alleen het capaciteitsverlies dat er over de levensduur toch komt.</>,
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
            Blijft er na slijtage weinig over, dan verdient de batterij vooral zijn
            eigen vervanging terug. Het eigen verbruik van de omvormer (standby)
            zit niet in het model: dat is een vaste post van het bezit, geen gevolg
            van de handel.
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
        <><b>Negatieve prijs vermeden</b>: op kwartieren met een negatieve terugleverprijs kost terugleveren geld. Wat de batterij dan opvangt, is pure winst.</>,
        <><b>Goedkoop in, duur uit</b>: wat de batterij van het net kocht, naar rato van zijn aandeel in de lading, tegen wat het ontladen opbracht. Kan negatief zijn als een inkoop tegenviel.</>,
        <><b>Eigen zon bewaard</b>: de rest. Zo sluit de optelling per definitie op het totaal, en het omzettingsverlies zit er al in verwerkt.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Eigen zon bewaard", waarde: euroPrecies(b.selfConsumptionEur) },
          { wat: "Goedkoop in, duur uit", waarde: euroPrecies(b.arbitrageEur) },
          { wat: "Negatieve prijs vermeden", waarde: euroPrecies(b.avoidedNegativeExportEur) },
          { wat: `Samen: de besparing in ${periode}`, waarde: euroPrecies(b.totalEur), uitkomst: true },
          { wat: "Ter info: omzettingsverlies, al verwerkt in de eerste post", waarde: `${euroPrecies(b.conversionLossEur)} (${kwh(b.conversionLossKwh)})` },
        ],
      },
      letop: [
        <>Het omzettingsverlies staat er niet als vierde post bij: het zit al in "eigen zon bewaard". Apart aftrekken zou het twee keer tellen.</>,
      ],
    };
  },

  verliezen: ({ result, preset }) => {
    const l = result.losses;
    return {
      titel: "Wat er onderweg verloren gaat",
      watZieJe: <>Hoeveel kilowattuur er per jaar verdwijnt bij laden, ontladen en in de elektronica die dag en nacht aan staat, en wat dat kost.</>,
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

  nettarief: ({ result, scenario, scenarioJaar }) => {
    const jaar = scenarioJaar ?? NETTARIEF_JAAR;
    return {
      titel: "Het nettarief van 2029 en wat het met de businesscase doet",
      watZieJe: <>Dezelfde doorrekening nog een keer, nu met het tijdsafhankelijke nettarief dat vanaf 2029 gaat gelden bovenop de afnameprijs.</>,
      bronnen: [CE_BRON, PRIJS_BRON],
      stappen: [
        <>Het voorstel geeft per uur en per seizoen een wegingsfactor: 0, 0,3, 0,5, 0,7 of 1,0. Die staan vast. Het basistarief niet; dat is de prognose van CE Delft: {centPerKwh(BASISTARIEF[2030])} in 2030, en {centPerKwh(BASISTARIEF[2029])} in 2029 (7,5% lager).</>,
        <>Per kwartier komt factor × basistarief bovenop de afnameprijs. Alleen op afname: het voorstel beprijst geen invoeding.</>,
        <>De heffing wordt in dit scenario die van het scenariojaar: {centPerKwh(scenarioHeffing(jaar))} in plaats van de 13 tot 17 cent van toen, anders stapelt het een nettarief van straks op een belasting van toen.</>,
        <>De batterij plant opnieuw op de nieuwe prijzen: de winteravond wordt duurder, dus levert hij dan liever; de zomermiddag wordt gratis, dus laadt hij dan liever.</>,
      ],
      voorbeeld: scenario
        ? {
            regels: [
              { wat: "Besparing per jaar op de prijzen van toen", waarde: euro(result.averageSavingEur) },
              { wat: "Besparing per jaar met het nettarief", waarde: euro(scenario.averageSavingEur), uitkomst: true },
              { wat: "Terugverdientijd", waarde: `${jaren(result.finance.paybackYears)} → ${jaren(scenario.finance.paybackYears)}` },
              { wat: "Laadbeurten per jaar", waarde: `${getal(result.stats.cyclesPerYear, 0)} → ${getal(scenario.stats.cyclesPerYear, 0)}` },
            ],
          }
        : undefined,
      letop: [
        <>Scenario, geen tariefblad. De ACM beslist naar verwachting eind 2026; invoering is "in beginsel" 1 januari 2029, met uitwijk naar 2030.</>,
        <>De prognose is gedragsonafhankelijk. Als veel huishoudens de piek gaan mijden, herijken de netbeheerders blokken en factoren jaarlijks.</>,
        <>Het vaste deel van de netkosten (capaciteitscomponent, aansluitvergoeding, meetdienst) blijft buiten beeld: dat is met en zonder batterij gelijk.</>,
      ],
    };
  },

  batterijmaat: ({ result, config }) => {
    const j = referentie(result);
    return {
      titel: "Welke maat loont",
      watZieJe: <>Dezelfde doorrekening voor 42 combinaties van capaciteit en vermogen, op één profieljaar, zodat je ziet waar meer batterij nog iets oplevert.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON],
      stappen: [
        <>Elke cel is een volledige doorrekening van de realistische strategie voor die maat, op het meest recente volledige jaar ({j.year}). Het optimum blijft weg; dat zou de kaart minutenlang laten rekenen zonder de vraag te veranderen.</>,
        <>De aanschafprijs schaalt mee met de capaciteit ({euro(config.investmentEur / config.battery.capacityKwh)} per kWh, uit jouw batterij), zodat de slijtageprijs per laadbeurt bij elke maat klopt.</>,
        <>Standaard toont de kaart de besparing per kilowattuur capaciteit: dat laat zien waar de meerwaarde van een grotere batterij afvlakt.</>,
      ],
      letop: [
        <>Meer vermogen levert soms niets op: als de batterij toch al vol raakt of leeg is, helpt sneller laden niet. Meer capaciteit helpt alleen zolang je hem ook vol krijgt.</>,
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
          ) : (
            <>De kalender is eerder op dan de beurten: een lagere stand had meer beurten en meer opbrengst gegeven zonder dat de batterij eerder aan vervanging toe was. De cashflow hieronder rekent dat effect mee.</>
          ),
      },
      letop: [
        <>De zichtbare slijtagepost bij de cijfers rekent altijd met de volle prijs, ongeacht de strategie: dat is wat een kWh van de aanschaf opsoupeert. De strategie verandert alleen de beslissing van de planner.</>,
        <>Het model rekent met een vaste slijtageprijs per kWh. In werkelijkheid slijt een cel meer bij diepe beurten en bij een hoge laadtoestand; dat verfijnt de prijs, maar verandert de regel niet.</>,
      ],
    };
  },

  cashflow: ({ result, config }) => {
    const f = result.finance;
    const laatste = f.cashflows[f.cashflows.length - 1];
    return {
      titel: "Over de looptijd: terugverdientijd en contante waarde",
      watZieJe: <>De opgetelde besparing jaar na jaar tegenover de aanschafprijs, en wat dat vandaag waard is.</>,
      bronnen: [{ naam: "Jouw aannames", wat: <>Looptijd {config.analysisYears} jaar, prijsstijging {procent(config.priceEscalation, 1)} per jaar, rente die je misloopt {procent(config.discountRate, 1)}, capaciteitsverlies {procent(config.calendarFadePerYear, 2)} per jaar, levensduur {config.cycleLife} laadbeurten.</> }],
      stappen: [
        <>Elk jaar verliest de batterij capaciteit: door ouderdom, en door laadbeurten zodra de levensduur in zicht komt. De besparing bij minder capaciteit wordt afgelezen van een curve die op 70%, 85% en 100% capaciteit is doorgerekend.</>,
        <>Die besparing stijgt mee met de prijsstijging die je hebt ingesteld.</>,
        <>De terugverdientijd is het moment waarop de opgetelde nominale besparing de aanschafprijs inhaalt, lineair binnen het jaar.</>,
        <>De contante waarde rekent elk jaar terug met de rente die je misloopt en trekt de aanschaf ervan af. Positief betekent: beter dan het geld laten staan.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Aanschafprijs", waarde: euro(config.investmentEur) },
          { wat: "Besparing in het eerste jaar", waarde: euro(f.cashflows[0]?.savingNominalEur ?? 0) },
          ...(laatste
            ? [{ wat: `Opgeteld na ${config.analysisYears} jaar, nominaal`, waarde: euro(laatste.cumulativeNominalEur) }, { wat: `Resterende capaciteit na ${config.analysisYears} jaar`, waarde: procent(laatste.capacityFraction) }]
            : []),
          { wat: "Terugverdiend na", waarde: jaren(f.paybackYears), uitkomst: true },
          { wat: "Netto contante waarde", waarde: euro(f.npvEur), uitkomst: true },
          ...(f.irr !== null ? [{ wat: "Intern rendement", waarde: procent(f.irr, 1) }] : []),
          ...(f.endOfLifeYear !== null ? [{ wat: "Cycluslevensduur op in jaar", waarde: String(f.endOfLifeYear) }] : []),
        ],
      },
      letop: [
        <>De looptijd is een keuze van jou over de beoordeling, geen eigenschap van de accu. Rente en prijsstijging veranderen de contante waarde en de terugverdientijd, niet de jaaropbrengst.</>,
        GEEN_VOORSPELLING_LETOP,
      ],
    };
  },
};
