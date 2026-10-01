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
import { centPerKwh, euro, euroPrecies, getal, jaren, jarenReeks, kwh, procent, standbyKengetallen } from "./format";
import { referentieJaar, type AnalysisResult, type ScenarioResult, type YearAnalysis } from "./model/analysis";
import { usableCapacityKwh } from "./model/battery";
import { RASTER_CAPACITEITEN, RASTER_VERMOGENS } from "./model/raster";
import { rasterGrondslag } from "./model/dimensionering";
import { overgangZin, overgangsFinance } from "./overgang";
import {
  BASISTARIEF,
  HEFFING_NU,
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
import { Co2OverschotStaven } from "../components/Co2Nederland";
import { DOELEN, GRAM_PER_CENT, doelInfo, stuurZin } from "./model/doel";
import { doelKaarten, type VergelijkingDelen } from "./model/vergelijking";
import type { Configuration } from "./worker/protocol";

export interface UitlegBlok {
  titel: string;
  /** Eén of twee zinnen: wat staat hier eigenlijk? */
  watZieJe: ReactNode;
  bronnen: { naam: string; wat: ReactNode }[];
  stappen: ReactNode[];
  /** Een figuur die de stappen onderbouwt, met een kop erboven. */
  figuur?: { kop: string; inhoud: ReactNode };
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
      De marktprijs per uur inclusief btw, zoals ANWB Energie die publiceert
      (anwb.nl/energie/actuele-tarieven). Daarbovenop komt de heffing:
      energiebelasting plus opslag. Standaard is dat die van nu (
      {centPerKwh(HEFFING_NU)}), of per uur die van toen als je dat kiest bij de
      geavanceerde instellingen. Sinds 20 juni 2026 rondt ANWB Energie de
      prijzen af op hele centen. Elke uurprijs geldt voor de vier kwartieren van
      dat uur.
    </>
  ),
};
const BATTERIJ_BRON = (p: BatteryPreset) => ({
  naam: `Catalogus: ${p.naam}`,
  wat: (
    <>
      {getal(p.capaciteitKwh, 2)} kWh, {getal(p.vermogenKw, 1)} kW. Van elke 100
      kWh die je opslaat, komt er {getal(p.spec.efficiency ** 2 * 100)} terug.
      Bruikbaar deel: {procent(p.spec.depthOfCharge)}. Prijs: {p.prijsNoot},
      richtprijs {PRIJSPEILDATUM}.
    </>
  ),
});
const KOSTEN_BRON = (c: Configuration) => {
  const k = kostenregelVan(c);
  return {
    naam: "Richtprijzen van uitbreiding en installatie",
    wat: (
      <>
        Uitbreiding kost per merk 234 tot 443 euro per kWh. Zendure AB2000X
        312, Anker SOLIX BP2700 316, HomeWizard 443 en Marstek 234 euro; de
        laatste twee zijn een hele unit, gedeeld door de capaciteit
        (thuisbatterijgids.net). Een hybride omvormer van 3 tot 5 kW kost 1.000 tot 2.500 euro. Een eigen
        groep door een installateur kost 100 tot 200 euro in een
        standaardsituatie en 300 tot 600 euro bij een volle meterkast
        (powerplugs.nl). We rekenen met {euro(k.perKwhEur)} per kWh,{" "}
        {euro(k.perKwEur)} per kW en {euro(k.installatieEur)} voor de
        installatie, peildatum {PRIJSPEILDATUM}. Je past ze aan bij de
        geavanceerde instellingen.
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
      De wegingsfactoren per uur komen uit het voorstel dat de netbeheerders op
      1 mei 2026 indienden bij de Autoriteit Consument & Markt (ACM,
      BR-2026-2242). Het basistarief komt uit {NETTARIEF_BRON}: een prognose uit
      het rapport ‘Beheersbare energiekosten voor huishoudens in 2030’ (CE
      Delft, september 2026), in opdracht van NVDE, Holland Solar,
      Energie-Nederland en Energy Storage NL.
    </>
  ),
};

// ── Waarschuwingen ─────────────────────────────────────────────────────────

const GEMIDDELD_LETOP = (
  <>
    Het profiel is het gemiddelde van alle aansluitingen in het netgebied en
    daardoor gladder dan één huishouden. Of dat de uitkomst te hoog of te laag
    maakt, is niet zeker. Met de schuif ‘Pieken in je verbruik’ zie je hoe
    gevoelig de uitkomst ervoor is.
  </>
);
/** De jaren waarop het bedrag rust, als zinsdeel: "2024 en 2025", of "de gekozen periode". */
function jarenTekst(r: AnalysisResult): string {
  const j = r.perYear.filter((y) => y.isFullYear).map((y) => y.year);
  return j.length > 0 ? jarenReeks(j) : "de gekozen periode";
}
/**
 * Geen prijsvoorspelling, wel een aanname over de toekomst. Dezelfde zin
 * staat op Aannames en bronnen (app/page.tsx).
 */
const geenVoorspellingLetop = (r: AnalysisResult) => (
  <>
    We gebruiken geen prijsvoorspelling: het bedrag is wat de batterij in{" "}
    {jarenTekst(r)} had opgeleverd. De terugverdientijd trekt dat door naar de
    toekomst; dat is een aanname.
  </>
);
const DYNAMISCH_LETOP = (c: Configuration) => (
  <>
    Deze doorrekening gaat uit van een dynamisch energiecontract en een batterij
    die {stuurZin(c.doel)}. Met een vast of variabel contract krijg je tot en
    met 2030 voor teruglevering minstens 50 procent van het kale
    leveringstarief. Die situatie rekent de tool niet door.
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
/** Waar de aansturing op stuurde, voor de CO2-uitleg: minder CO2 als bijeffect of als doel. */
function co2SturingLetop(c: Configuration): ReactNode {
  return c.doel === "uitstoot" ? (
    <>
      De batterij stuurt hier op uitstoot: hij mijdt de uren met de meeste
      CO2, ongeacht de prijs. Minder CO2 is dus het doel, en de besparing in
      euro's is lager dan bij sturen op rendement.
    </>
  ) : (
    <>
      De batterij stuurt hier op {c.doel === "zelfconsumptie" ? "zelfconsumptie" : "rendement, dus op de prijs"}:
      minder CO2 is een bijeffect, geen doel. Bij het doel Uitstoot stuurt hij
      wel op de uitstoot per uur. Kies dat bij ‘Waar stuurt de batterij op?’ om
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

/** "de 2 volledige jaren", "het volledige jaar" of "de gekozen periode, omgerekend naar een jaar". */
function periodeTekst(n: number): string {
  if (n > 1) return `de ${n} volledige jaren`;
  if (n === 1) return "het volledige jaar";
  return "de gekozen periode, omgerekend naar een jaar";
}

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
      titel: "Het antwoord: de besparing per jaar en de terugverdientijd",
      watZieJe: (
        <>
          Wat deze batterij je per jaar had bespaard op je variabele stroomkosten,
          gemiddeld over {periodeTekst(n)} in de data, en wanneer de aanschaf
          daarmee is terugverdiend.
        </>
      ),
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON, BATTERIJ_BRON(preset)],
      stappen: [
        zonderPanelen(config) ? (
          <>
            Het gemeten gemiddelde profiel van je netgebied geeft per kwartier
            hoeveel er van het net kwam. We schalen het zo dat elk volledig jaar
            op jouw meterstand uitkomt: {kwh(config.household.annualGridImportKwh)} afname.
          </>
        ) : (
          <>
            Het gemeten gemiddelde profiel van je netgebied geeft per kwartier
            hoeveel er van het net kwam en hoeveel ernaartoe ging. We schalen
            beide zo dat elk volledig jaar op jouw meterstanden uitkomt:{" "}
            {kwh(config.household.annualGridImportKwh)} afname en{" "}
            {kwh(config.household.annualGridExportKwh)} teruglevering.
          </>
        ),
        <>
          Zonder batterij kost elk kwartier afname de uurprijs plus heffing
          ({config.useHistoricalLevy === false ? "die van nu" : "die van toen"}),
          en levert elk kwartier teruglevering de kale uurprijs op, min
          eventuele terugleverkosten. We rekenen zonder saldering: wat je
          teruglevert wordt dan niet meer afgetrokken van wat je afneemt. Dat is
          de situatie met een dynamisch contract vanaf 1 januari 2027.
        </>,
        <>
          Met batterij plant de aansturing elke dag om 13.00 uur de komende uren.
          De aansturing is de software die bepaalt wanneer de batterij laadt en
          levert. Ze gebruikt de prijzen voor morgen, die rond 13.00 uur bekend
          worden. Daarnaast gebruikt ze een verwachting van je verbruik uit de
          afgelopen week.{" "}
          {config.doel === "zelfconsumptie"
            ? "Ze laadt alleen met overschot van je eigen panelen en levert alleen aan je eigen huis"
            : config.doel === "uitstoot"
              ? "Ze laadt op uren waarop de stroom van het net schoon is en levert op de uren met veel CO2"
              : zonderPanelen(config)
                ? "Ze laadt als stroom goedkoop is en levert als stroom duur is"
                : "Ze laadt bij zonoverschot of als stroom goedkoop is en levert als stroom duur is"}
          , binnen het vermogen van de batterij en met het omzettingsverlies erbij.
        </>,
        <>
          De besparing is het verschil tussen de kosten zonder en met batterij,
          per jaar, en dan gemiddeld over de volledige jaren.
          {config.standbyWatt > 0
            ? ` In de kosten met batterij zit het stand-byverbruik van de batterij (${standbyKengetallen(config.standbyWatt, result.breakdown.standbyKwh, -result.breakdown.standbyEur)}). Dat telt alleen op de momenten dat de batterij niet laadt of ontlaadt, tegen de prijs van dat kwartier. De aansturing weet er niets van; de dagfiguren laten alleen de handel zien.`
            : " Het stand-byverbruik van de batterij staat op 0 W, dus daar is niets van afgetrokken."}
          {n === 0
            ? " Bevat de gekozen periode geen volledig kalenderjaar, dan tellen we de deelperioden op en schalen we ze naar een jaar: 365 gedeeld door het aantal dagen dat ze samen beslaan."
            : ""}
        </>,
        <>
          Voor de terugverdientijd loopt de besparing jaar na jaar door, met{" "}
          {procent(config.priceEscalation, 1)} prijsstijging en{" "}
          {procent(config.calendarFadePerYear, 2)} capaciteitsverlies per jaar. Het
          jaar waarin de opgetelde besparing de aanschafprijs inhaalt, is de
          terugverdientijd. Dat is een aanname: het verleden herhaalt zich.
        </>,
        <>
          Het voorgestelde nettarief gaat, als het doorgaat, naar verwachting
          op 1 januari {NETTARIEF_JAAR} in. De vetgedrukte terugverdientijd
          rekent daarom{" "}
          {overgang ? overgangZin(overgang) : "de eerste jaren"} met het
          huidige nettarief en de jaren daarna met het nieuwe, op dezelfde
          batterij die gewoon doorslijt. Ter vergelijking staat erachter de
          terugverdientijd als het nettarief blijft zoals nu.
        </>,
      ],
      voorbeeld: {
        regels: [
          { wat: `Stroomkosten zonder batterij, ${j.year}`, waarde: euroPrecies(j.baselineCostEur) },
          { wat: `Stroomkosten met batterij, ${j.year}, inclusief stand-byverbruik`, waarde: euroPrecies(j.realisticCostEur) },
          { wat: `Daarvan stand-byverbruik, ${j.year}`, waarde: euroPrecies(j.standbyCostEur) },
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
                  wat: "Terugverdientijd, als het nettarief-voorstel doorgaat",
                  waarde: jaren(overgang.finance.paybackYears),
                  uitkomst: true,
                },
                {
                  wat: "Ter vergelijking, terugverdientijd als het nettarief blijft zoals nu",
                  waarde: jaren(result.finance.paybackYears),
                },
              ]
            : [
                {
                  wat: "Terugverdientijd, als het nettarief blijft zoals nu",
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
              meer een batterij bespaart.
            </>
          ) : undefined,
      },
      letop: [
        config.doel && config.doel !== "rendement" ? (
          <>De batterij stuurt hier op <b>{doelInfo(config.doel).naam.toLowerCase()}</b>. {doelInfo(config.doel).kort} De besparing in euro's is daardoor lager dan bij sturen op rendement. Dat is de prijs van die keuze.</>
        ) : null,
        geenVoorspellingLetop(result),
        DYNAMISCH_LETOP(config),
        GEMIDDELD_LETOP,
        EEN_LEVERANCIER_LETOP,
      ],
    };
  },

  zelfconsumptie: ({ result, config }) => {
    const s = result.stats;
    const opwek = config.annualProductionKwh ?? 0;
    const geschat = isGeschatteOpwek(config);
    return {
      titel: "Cijfers op een rij: eigen verbruik, het deel van je zonnestroom dat je zelf gebruikt",
      watZieJe: (
        <>
          Welk deel van wat je panelen opwekken je zelf gebruikt, zonder en
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
        <>Het eigen verbruik is dat deel gedeeld door de opwek. Met batterij gaat een
          deel van het overschot de batterij in in plaats van naar het net, dus
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
          Ter indicatie voor de opwek: Milieu Centraal rekent met 3.000 kWh
          per jaar voor acht panelen van 435 wattpiek, ongeveer 860 kWh per
          kilowattpiek. Een te hoge opwek maakt het aandeel te laag, en andersom.
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
      titel: "Cijfers op een rij: zelf gedekt, het deel van je verbruik uit eigen panelen",
      watZieJe: (
        <>
          Welk deel van je totale stroomverbruik uit je eigen panelen komt,
          direct of via de batterij. De rest haal je van het net.
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
      titel: stijgt ? "Cijfers op een rij: wat de batterij aan je afname van het net verandert" : "Cijfers op een rij: hoeveel minder je van het net haalt",
      watZieJe: <>Je netafname per jaar zonder en met batterij, gemiddeld over de volledige jaren.</>,
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        <>Zonder batterij is de afname het geschaalde profiel, dus gelijk aan je meterstand.</>,
        <>
          Met batterij telt het model per kwartier wat er nog van het net komt:
          je verbruik min wat de batterij levert, plus wat de batterij van het
          net laadt.
        </>,
        zonderPanelen(config) ? (
          <>Zonder zonnepanelen laadt de batterij alleen van het net. Wat hij later levert, hoef je dan niet van het net te halen, maar het omzettingsverlies komt erbovenop. Ook wat hij in dure uren aan het net levert, telt mee.</>
        ) : (
          <>Het verschil is wat de batterij aan eigen zonnestroom voor later bewaarde, min wat hij zelf van het net haalde.</>
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
      titel: "Cijfers op een rij: hoeveel minder je aan het net levert",
      watZieJe: <>Je teruglevering per jaar zonder en met batterij. Wat je minder teruglevert, gaat de batterij in, of wordt bij een negatieve prijs afgeregeld. Afgeregelde stroom telt niet als eigen verbruik.</>,
      bronnen: [PROFIEL_BRON(config)],
      stappen: [
        config.tariff.allowCurtailment ? (
          <>Zonder batterij gaat elk overschot naar het net, behalve bij een negatieve prijs: dan regelt de omvormer af, zoals ingesteld. Die afgeregelde stroom telt niet als teruglevering en niet als eigen verbruik.</>
        ) : (
          <>Zonder batterij gaat elk overschot naar het net, ook bij een negatieve prijs: afregelen staat uit, zoals bij de meeste installaties. Kan de jouwe het wel, zet het dan aan bij de geavanceerde instellingen.</>
        ),
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
      titel: "Cijfers op een rij: afname in de piekuren",
      watZieJe: (
        <>
          Welk deel van wat je van het net haalt, valt op de uren waarop het
          voorgestelde nettarief vanaf 2029 het duurst is. Dat is in de winter
          van 16.00 tot 23.00 uur en in de zomer van 19.00 tot 24.00 uur.
        </>
      ),
      bronnen: [PROFIEL_BRON(config), CE_BRON],
      stappen: [
        <>De piekuren zijn de uren met de hoogste wegingsfactor van het nettarief: in de winter van 16.00 tot 23.00 uur (factor 1,0), in de zomer van 19.00 tot 24.00 uur (factor 0,7).</>,
        <>Per kwartier in die uren tellen we de netafname op, zonder en met batterij, op de tijd van je klok.</>,
        <>Het aandeel is die piekafname gedeeld door de totale netafname. Zo is het te vergelijken met eigen verbruik: een aandeel, geen kilowatturen.</>,
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
        <>Welke uren als piekuur tellen, hangt niet af van het nettarief in de prijs. Het verschil tussen nu en 2029 is dus alleen het gedrag van de batterij.</>,
        GEMIDDELD_LETOP,
      ],
    };
  },

  laadbeurten: ({ result, config, preset }) => {
    const s = result.stats;
    const bruikbaar = usableCapacityKwh(config.battery);
    return {
      titel: "Cijfers op een rij: laadbeurten, hoe hard de batterij werkt",
      watZieJe: <>Hoe vaak de batterij per jaar volledig vol en leeg gaat, als je alle stukjes laden en ontladen optelt.</>,
      bronnen: [BATTERIJ_BRON(preset)],
      stappen: [
        <>Het model telt alles wat de batterij per jaar aan het huis levert, aan de stekkerkant.</>,
        <>Dat delen we door de bruikbare capaciteit, met het omzettingsverlies bij het ontladen erbij: zoveel keer is de batterij gevuld en geleegd.</>,
        <>Meer laadbeurten kunnen meer besparen, maar kosten ook slijtage. De aansturing rekent elke laadbeurt af tegen {procent(config.wearFraction ?? 1)} van de slijtageprijs per geleverde kWh (de gekozen stand): dekt het prijsverschil dat niet, dan blijft de batterij stil.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Geleverd aan het huis per jaar", waarde: kwh(s.throughputPerYearKwh) },
          { wat: `Bruikbare capaciteit: ${getal(config.battery.capacityKwh, 2)} kWh × ${procent(config.battery.depthOfCharge)}`, waarde: `${getal(bruikbaar, 2)} kWh` },
          { wat: `Laadbeurten: geleverd ÷ ${procent(config.battery.efficiency, 1)} (één richting) ÷ bruikbaar`, waarde: `${getal(s.cyclesPerYear, 0)} per jaar`, uitkomst: true },
          { wat: `Levensduur uit de catalogus`, waarde: `${getal(config.cycleLife)} laadbeurten, ${config.calendarLifeYears} jaar` },
        ],
        toelichting: <>{getal(s.cyclesPerYear, 0)} laadbeurten per jaar is {getal(s.cyclesPerYear * config.calendarLifeYears, 0)} in {config.calendarLifeYears} jaar: {s.cyclesPerYear * config.calendarLifeYears < config.cycleLife ? "de batterij is dan eerder te oud dan versleten." : "de batterij is dan eerder versleten dan te oud, en dat weegt mee in de terugverdientijd."}</>,
      },
    };
  },

  doorzet: ({ result, preset }) => ({
    titel: "Cijfers op een rij: wat de batterij per jaar levert",
    watZieJe: <>Hoeveel kilowattuur de batterij per jaar aan je huis (of het net) afgeeft, aan de stekkerkant.</>,
    bronnen: [BATTERIJ_BRON(preset)],
    stappen: [
      <>Per kwartier telt het model wat de batterij ontlaadt.</>,
      <>Dat is minder dan wat erin ging: van elke 100 kWh die je opslaat, komt er {getal(preset.spec.efficiency ** 2 * 100)} terug. Zie Verliezen.</>,
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
      titel: "Cijfers op een rij: slijtage, wat de laadbeurten van de aanschafprijs opmaken",
      watZieJe: (
        <>
          Elke geleverde kilowattuur gebruikt een stukje van de levensduur van de
          batterij. Hier staat wat dat per jaar kost tegen de aanschafprijs, naast
          de besparing, niet ervan afgetrokken.
        </>
      ),
      bronnen: [BATTERIJ_BRON(preset)],
      stappen: [
        <>Over zijn levensduur levert de batterij {getal(config.cycleLife)} laadbeurten × {getal(bruikbaar, 2)} kWh bruikbaar × {procent(config.battery.efficiency, 1)} (wat er bij het ontladen overblijft) = {kwh(config.cycleLife * bruikbaar * config.battery.efficiency)} aan de stekkerkant.</>,
        <>De aanschafprijs gedeeld door dat totaal is de slijtageprijs per geleverde kWh: {centPerKwh(s.wearCostEurPerKwh)}.</>,
        <>Maal wat de batterij per jaar levert geeft de slijtage per jaar. Dit bedrag zit al in de aanschafprijs die de terugverdientijd rekent; het hier óók van de besparing aftrekken zou het dubbel tellen.</>,
        <>De aansturing rekent {procent(config.wearFraction ?? 1)} van deze prijs als drempel, {centPerKwh(s.wearCostEurPerKwh * (config.wearFraction ?? 1))}: een laadbeurt gaat alleen door als het prijsverschil na het omzettingsverlies daar bovenuit komt. Dat deel stel je in bij ‘Hoe zuinig met de laadbeurten?’. Op Zuinig (100 procent) loont een laadbeurt alleen als hij zijn eigen slijtage terugverdient. Op Volop (20 procent) telt een laadbeurt voor een vijfde mee. De batterij is bij veel gebruik eerder te oud dan versleten, en een extra laadbeurt kost dan weinig levensduur. Een rekenvoorbeeld staat bij Laadbeurten en levensduur.</>,
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
            wat de batterij bespaart op aan zijn eigen afschrijving.
          </>
        ),
      },
    };
  },

  prijskloof: ({ result, config }) => {
    const g = result.priceGap;
    return {
      titel: "Prijsverschil: waarom er iets te besparen valt",
      watZieJe: <>Wat je gemiddeld betaalt op de momenten dat je afneemt, en wat je gemiddeld krijgt op de momenten dat je teruglevert. Dat prijsverschil is waar een batterij van leeft.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON],
      stappen: [
        <>Beide gemiddelden wegen mee met je volume: een kwartier telt zwaarder als er op dat moment meer door de meter ging.</>,
        <>Een huishouden met panelen neemt af als het duur is (avond, winter) en levert terug als het goedkoop is (middag, zomer). Het simpele uurgemiddelde verbergt dat; het gewogen gemiddelde laat het zien.</>,
        <>Bij afname telt de heffing mee, bij teruglevering niet: zonder saldering krijg je de kale marktprijs. Dat is het grootste deel van het prijsverschil.</>,
        <>Beide bedragen zijn <b>inclusief 21% btw</b>. De prijsreeks van ANWB Energie staat al inclusief btw, en ANWB Energie keert ook de terugleververgoeding inclusief btw uit.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Gewogen afnameprijs", waarde: centPerKwh(g.weightedImportPrice) },
          { wat: "Gewogen terugleverprijs", waarde: centPerKwh(g.weightedExportPrice) },
          { wat: "Diezelfde terugleverprijs exclusief btw, ter controle", waarde: centPerKwh(g.weightedExportPrice / 1.21) },
          { wat: "Ongewogen gemiddelde marktprijs, ter vergelijking", waarde: centPerKwh(g.simpleAveragePrice) },
          { wat: "Prijsverschil per kWh", waarde: centPerKwh(g.weightedImportPrice - g.weightedExportPrice), uitkomst: true },
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
      titel: "Opbouw van de besparing: waar de besparing vandaan komt",
      watZieJe: (
        <>
          De besparing in {periode}, in een paar posten die samen het totaal vormen.
        </>
      ),
      bronnen: [{ naam: "De doorrekening zelf", wat: <>Per kwartier: wat de batterij laadde, ontlaadde, en tegen welke prijs.</> }],
      stappen: [
        <>We splitsen elk volledig jaar apart uit. De posten tellen op tot de gemiddelde besparing die bovenaan staat.</>,
        <><b>Negatieve prijzen ontlopen</b>: op kwartieren met een negatieve terugleverprijs kost terugleveren geld. Wat de batterij dan opvangt, hoef je niet weg te geven. Staat afregelen aan (je omvormer stopt dan met terugleveren bij een negatieve prijs; standaard staat het uit), dan kost teruglevering op die momenten al niets. Deze post is dan nul en staat niet in de figuur.</>,
        <><b>Slim laden en leveren</b>: wat het ontladen opbracht, min wat de batterij ervoor van het net haalde (naar rato van dat deel van de lading). Kan negatief zijn als het laden achteraf toch duur bleek.</>,
        <><b>Stand-byverbruik</b>: wat de batterij zelf verbruikt in de kwartieren dat hij niet laadt of ontlaadt, tegen de prijs van dat kwartier. Dit is de enige aftrekpost; hij staat er alleen als er een stand-byverbruik is ingesteld.</>,
        <><b>Zelf gebruiken</b>: wat overblijft van de handel, zodat de optelling altijd op het totaal uitkomt. Het omzettingsverlies zit er al in verwerkt.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Zelf gebruiken", waarde: euroPrecies(b.selfConsumptionEur) },
          { wat: "Slim laden en leveren", waarde: euroPrecies(b.arbitrageEur) },
          { wat: "Negatieve prijzen ontlopen", waarde: euroPrecies(b.avoidedNegativeExportEur) },
          { wat: "Stand-byverbruik", waarde: euroPrecies(b.standbyEur) },
          { wat: `Samen: de besparing in ${periode}`, waarde: euroPrecies(b.totalEur), uitkomst: true },
          { wat: "Ter info: omzettingsverlies, al verwerkt in de eerste post", waarde: `${euroPrecies(b.conversionLossEur)} (${kwh(b.conversionLossKwh)})` },
        ],
      },
      letop: [
        <>Het omzettingsverlies staat er niet als aparte post bij: het zit al in ‘zelf gebruiken’. Apart aftrekken zou het twee keer tellen. Het stand-byverbruik zit nergens anders in verwerkt, en staat er daarom wel als post.</>,
      ],
    };
  },

  verliezen: ({ result, preset }) => {
    const l = result.losses;
    return {
      titel: "Verliezen: wat er onderweg verloren gaat",
      watZieJe: <>Hoeveel kilowattuur er per jaar verdwijnt bij laden en ontladen, en wat dat kost.</>,
      bronnen: [BATTERIJ_BRON(preset)],
      stappen: [
        <>Laadverlies is evenredig met wat erin gaat: {procent(1 - preset.spec.efficiency, 1)} van elke geladen kilowattuur.</>,
        <>Ontlaadverlies is evenredig met wat eruit komt, tegen hetzelfde percentage.</>,
        <>De euro's zijn wat die kilowatturen hadden opgeleverd als ze er nog waren: uit eigen overschot de terugleverprijs, van het net de afnameprijs.</>,
        <>Het stand-byverbruik komt er apart bij: alleen in de kwartieren dat de batterij niet laadt of ontlaadt, want tijdens laden en ontladen zit het eigen verbruik al in het rendement. Het staat niet in de besparing verwerkt maar gaat ervan af.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Laadverlies", waarde: `${kwh(l.chargeLossKwh)} · ${euroPrecies(l.chargeLossEur)}` },
          { wat: "Ontlaadverlies", waarde: `${kwh(l.dischargeLossKwh)} · ${euroPrecies(l.dischargeLossEur)}` },
          { wat: "Samen per jaar", waarde: `${kwh(l.totalKwh)} · ${euroPrecies(l.totalEur)}`, uitkomst: true },
          { wat: "Stand-byverbruik, apart", waarde: `${kwh(result.breakdown.standbyKwh)} · ${euroPrecies(-result.breakdown.standbyEur)}` },
          { wat: "Van elke 100 kWh die je opslaat, komt er terug", waarde: `${getal(l.roundtrip * 100, 1)} kWh` },
        ],
        toelichting: (() => {
          const catalogus = preset.spec.efficiency ** 2;
          const verschil = l.roundtrip - catalogus;
          if (verschil < -0.0005) {
            return <>Het gemeten getal ligt iets onder wat de catalogus opgeeft ({getal(catalogus * 100)} van de 100). Aan het eind van het jaar zit er nog lading in de batterij die niet meer is geleverd.</>;
          }
          if (verschil > 0.0005) {
            return <>Het gemeten getal ligt iets boven wat de catalogus opgeeft ({getal(catalogus * 100)} van de 100).</>;
          }
          return <>Dat komt overeen met wat de catalogus opgeeft ({getal(catalogus * 100)} van de 100).</>;
        })(),
      },
    };
  },

  perJaar: ({ result }) => {
    const j = referentie(result);
    return {
      titel: "Per jaar: de besparing van jaar tot jaar",
      watZieJe: <>De besparing per kalenderjaar, en daarnaast wat er met perfecte kennis vooraf maximaal in had gezeten.</>,
      bronnen: [PRIJS_BRON],
      stappen: [
        <>Elk kalenderjaar in de gekozen periode wordt apart doorgerekend, met de prijzen en het profiel van dat jaar.</>,
        <>De donkere staaf is de aansturing zoals een echte batterij plant. Ze gebruikt de prijzen voor morgen, die rond 13.00 uur bekend worden, en een verwachting van het verbruik.</>,
        <>De lichte staaf is het optimum met perfecte kennis van alle prijzen en al het verbruik vooraf. Dat bestaat niet in het echt, maar het laat zien hoeveel er nog te winnen zou zijn met betere voorspellingen.</>,
        <>Een deeljaar (bijvoorbeeld een periode die op 1 april begint) is lager, omdat er maanden ontbreken. Het telt niet mee in het gemiddelde zolang er een volledig jaar is. Zonder volledig kalenderjaar tellen we de deelperioden op en schalen we ze naar een jaar.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: `Realistisch, ${j.year}`, waarde: euroPrecies(j.realisticSavingEur) },
          { wat: `Met perfecte kennis, ${j.year}`, waarde: euroPrecies(j.optimalSavingEur) },
          { wat: "Aandeel van het optimum dat de aansturing haalt", waarde: procent(j.captureRate), uitkomst: true },
          ...(result.gap
            ? [
                { wat: "Verlies doordat zon en verbruik van morgen een verwachting zijn", waarde: euroPrecies(result.gap.forecastCostEur) },
                { wat: "Verlies doordat de prijzen van morgen pas om 13.00 uur bekend zijn", waarde: euroPrecies(result.gap.horizonCostEur) },
              ]
            : []),
        ],
      },
      letop: [geenVoorspellingLetop(result)],
    };
  },

  maandverloop: ({ result, config }) => {
    const beste = [...result.perMonth].sort((a, b) => b.savingEur - a.savingEur)[0];
    const slechtste = [...result.perMonth].sort((a, b) => a.savingEur - b.savingEur)[0];
    const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
    return {
      titel: "Per maand: hoe de besparing over het jaar verdeeld is",
      watZieJe: <>De besparing per kalendermaand, gemiddeld over de volledige jaren. Voor een batterij is een zomermaand heel anders dan een wintermaand.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON],
      stappen: [
        <>Per kwartier wordt het verschil in kosten zonder en met batterij aan de kalendermaand toegerekend, in lokale tijd.</>,
        zonderPanelen(config) ? (
          <>Zonder zonnepanelen leeft de batterij het hele jaar van het prijsverschil tussen nacht en avond.</>
        ) : (
          <>In de zomer vangt de batterij zonoverschot op dat anders bijna niets opbracht; in de winter leeft hij van het prijsverschil tussen nacht en avond.</>
        ),
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
      titel: "Zomer- en winterdag: hoe de batterij je dagprofiel verschuift",
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
        <>De gekleurde kolom per uur is het verschil tussen beide situaties. Groen betekent dat de batterij je van het net af houdt, oker dat hij er juist extra van haalt om te laden.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: `Winter: grootste verschuiving, om ${w.uur}.00 uur`, waarde: `${getal(w.kwh, 2)} kWh` },
          { wat: `Zomer: grootste verschuiving, om ${z.uur}.00 uur`, waarde: `${getal(z.kwh, 2)} kWh` },
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
            Het verschil in teruglevering blijft in huis: dat is de stroom
            waarop je het prijsverschil tussen afname en teruglevering bespaart.
          </>
        ),
      },
      letop: [GEMIDDELD_LETOP],
    };
  },

  verloop: ({ result }) => ({
    titel: "Verloop over tijd: het resultaat over een maand of een jaar",
    watZieJe: <>Dezelfde doorrekening als het dagprofiel, opgeteld per dag (maand) of per week (jaar): wat de batterij bespaarde, en wat de laadbeurten aan slijtage kostten.</>,
    bronnen: [PRIJS_BRON],
    stappen: [
      <>Per kwartier is de besparing het verschil tussen de kosten zonder en met batterij: afname maal afnameprijs, min teruglevering maal terugleverprijs.</>,
      <>Die kwartieren tellen we op in vakken van een dag of een week, op de tijd van je klok. Een dag loopt van middernacht tot middernacht in Amsterdam, een week van maandag tot en met zondag.</>,
      <>De slijtage per vak is wat de batterij in dat vak leverde maal de volle slijtageprijs per kWh ({centPerKwh(result.stats.wearCostEurPerKwh)}). Die post zit al in de aanschafprijs en wordt daarom niet van de besparing afgetrokken, maar staat er wel naast.</>,
      <>Een dag of week kan negatief zijn zonder dat er iets misgaat: kosten en besparing vallen op verschillende dagen. De batterij laadt 's nachts en levert de volgende dag, dus de kosten staan in het ene vak en de besparing in het volgende.</>,
    ],
    letop: [geenVoorspellingLetop(result)],
  }),

  dagprofiel: ({ result }) => ({
    titel: "Een dag of week van dichtbij: wat de batterij op één dag doet",
    watZieJe: <>Wat de batterij op één dag (of in één week) doet: de prijs per kwartier, laden en ontladen, de lading, en wat de dag tot dan toe kostte zonder en met batterij.</>,
    bronnen: [PRIJS_BRON],
    stappen: [
      <>De twee voorbeelddagen zijn de dag met de <b>middelste</b> prijsspreiding (de mediaan) in de zomer en in de winter van het meest recente volledige jaar. Niet de beste dag, niet de slechtste: een doorsnee dag.</>,
      <>Een dag loopt van middernacht tot middernacht in Amsterdam en heeft 92, 96 of 100 kwartieren, afhankelijk van de zomertijd.</>,
      <>De batterij houdt zich niet aan de kalender: lading die 's nachts van het net is gehaald wordt de volgende dag geleverd. Een dag kan daardoor negatief afsluiten terwijl de twee dagen samen positief zijn. De begin- en eindstand van de lading staan er daarom bij.</>,
      <>Met de datumkiezer haal je elke andere dag uit de periode op. Die halen we uit de al doorgerekende jaren, dus je hoeft niet op een nieuwe berekening te wachten.</>,
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
      titel: "Nettarief van 2029: het voorstel en wat het voor de terugverdientijd betekent",
      watZieJe: <>Dezelfde doorrekening nog een keer, nu met het tijdsafhankelijke nettarief bovenop de afnameprijs. Gaat het voorstel van de netbeheerders door, dan geldt dat tarief naar verwachting vanaf 1 januari 2029, mogelijk later. De Autoriteit Consument &amp; Markt (ACM) beslist erover.</>,
      bronnen: [CE_BRON, PRIJS_BRON],
      stappen: [
        <>Het voorstel geeft per uur en per seizoen een wegingsfactor: 0, 0,3, 0,5, 0,7 of 1,0. Die staan vast. Het basistarief niet. Dat is een prognose van CE Delft, in opdracht van NVDE, Holland Solar, Energie-Nederland en Energy Storage NL: {centPerKwh(BASISTARIEF[2030])} in 2030 en {centPerKwh(BASISTARIEF[2029])} in 2029 (ongeveer 7% lager: één jaar tariefstijging van 7,5% eraf).</>,
        <>Per kwartier komt factor × basistarief bovenop de afnameprijs. Alleen op afname: het voorstel beprijst geen invoeding.</>,
        <>De heffing wordt in dit scenario die van het scenariojaar: {centPerKwh(scenarioHeffing(jaar))} inclusief opslag, in plaats van {config.useHistoricalLevy ? "die van toen, per uur zoals hij in de prijsdata zat" : `die van nu (${centPerKwh(HEFFING_NU)})`}. Het nettarief van straks hoort bij de belasting van straks.</>,
        <>De batterij plant opnieuw op de nieuwe prijzen: de winteravond wordt duurder, dus levert hij dan liever; de zomermiddag wordt gratis, dus laadt hij dan liever.</>,
        <>De bedragen hieronder zijn de doorrekening alsof dit tarief er de hele periode al was. Zo zijn de twee situaties goed te vergelijken. Voor de terugverdientijd telt dat niet: die staat elders op de pagina mét de ingangsdatum erin, dus de eerste jaren op het huidige nettarief.</>,
      ],
      voorbeeld: scenario
        ? {
            regels: [
              { wat: "Besparing per jaar, met het huidige nettarief", waarde: euro(result.averageSavingEur) },
              { wat: "Besparing per jaar, met het nettarief van 2029", waarde: euro(scenario.averageSavingEur), uitkomst: true },
              { wat: "Terugverdientijd als het nettarief blijft zoals nu", waarde: jaren(result.finance.paybackYears) },
              { wat: "Terugverdientijd als het voorstel doorgaat (eerst het huidige tarief, dan het nieuwe)", waarde: jaren(overgangsFinance(result, scenario, config).finance.paybackYears), uitkomst: true },
              { wat: "Laadbeurten per jaar", waarde: `${getal(result.stats.cyclesPerYear, 0)} → ${getal(scenario.stats.cyclesPerYear, 0)}` },
            ],
          }
        : undefined,
      letop: [
        <>Dit is een scenario, geen vastgesteld tarief. De ACM beslist naar verwachting eind 2026. Invoering is in beginsel 1 januari 2029, mogelijk later.</>,
        <>De prognose houdt geen rekening met gedrag. Gaan veel huishoudens de piek mijden, dan passen de netbeheerders de tijdsblokken en factoren jaarlijks aan.</>,
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
      titel: "Maat en vermogen: welke maat loont",
      watZieJe: <>Dezelfde doorrekening voor {RASTER_CAPACITEITEN.length * RASTER_VERMOGENS.length} combinaties van capaciteit en vermogen, elk met zijn eigen prijs, zodat je ziet welke maat het meeste netto resultaat geeft en waar meer batterij niets meer toevoegt.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON, KOSTEN_BRON(config)],
      stappen: [
        <>Elke cel is een volledige doorrekening van de aansturing voor die maat, op het meest recente volledige jaar ({j.year}). Het optimum blijft weg; dat zou de kaart minutenlang laten rekenen zonder de vraag te veranderen.</>,
        <>Daarna gaat elke cel naar het niveau van het gemiddelde over de volle jaren: maal de verhouding tussen het gemiddelde en {j.year} bij jouw batterij. Het jaar geeft de verhouding tussen de maten, het gemiddelde het niveau; alle jaren voor elke maat doorrekenen zou de kaart verdubbelen.</>,
        <><b>De prijs per maat</b> volgt één regel, verankerd aan jouw batterij. Jouw batterij kost {euro(config.investmentEur)}, elke kilowattuur erbij {euro(k.perKwhEur)} en elke kilowatt erbij {euro(k.perKwEur)}. Wie de grens van {getal(STEKKER_GRENS_KW, 1)} kW oversteekt, betaalt eenmalig {euro(k.installatieEur)} voor een eigen groep door een installateur. Dat kost 100 tot 200 euro in een standaardsituatie en 300 tot 600 euro bij een volle meterkast. Boven 800 W is een eigen groep de norm. Terug naar een stekkerbatterij gaat de installateur er weer af.</>,
        <>Geen uitbreidingspakketten per merk: die verschillen per model en bij de meeste hubs groeit het vermogen niet mee. Eén regel voor alle maten houdt de kaart vergelijkbaar; de drie getallen zijn instelbaar voor wie een offerte heeft.</>,
        <><b>Netto resultaat</b> is wat de batterij over de looptijd oplevert, na aftrek van de aanschaf en de rente die je misloopt. Het is dezelfde doorrekening als bovenaan de pagina, maar zonder de overgang naar het nettarief. Het telt de jaarbesparing over {config.analysisYears} jaar, met {procent(config.priceEscalation, 1)} prijsstijging, {procent(config.discountRate, 1)} rente en de slijtage van de laadbeurten, min de prijs van die maat. Hoe de besparing terugloopt bij slijtage, is alleen voor jouw batterij gemeten. De andere maten lenen die vorm.</>,
        <>De hoogste uitkomst is de cel met het hoogste netto resultaat in deze doorrekening. Dat is geen persoonlijk advies. Terugverdientijd en jaarbesparing staan er als schakelaar naast. Op jaarbesparing wint de grootste batterij altijd, daarom begint de kaart met netto resultaat.</>,
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
        <>Staat jouw batterij in het raster, dan bespaart zijn cel per jaar wat het antwoord bovenaan zegt. Netto resultaat en terugverdientijd wijken toch af: {rasterGrondslag(config).replace(/^Gerekend/, "de kaart rekent").replace(/\.$/, "")}.</>,
        <>Meer vermogen levert soms niets op: als de batterij toch al vol raakt of leeg is, helpt sneller laden niet. Meer capaciteit helpt alleen zolang je hem ook vol krijgt.</>,
      ],
    };
  },

  uitbreiden: ({ result, config }) => {
    const j = referentie(result);
    return {
      titel: "Uitbreiden: tot welke maat het loont",
      watZieJe: <>Eén kolom uit de kaart van maten als lijn: het netto resultaat per capaciteit bij het vermogen van jouw batterij, en bij het beste vermogen uit de kaart als dat een ander is.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON, KOSTEN_BRON(config)],
      stappen: [
        <>Elke stip is een cel uit de kaart: dezelfde jaarsimulatie ({j.year}) op het niveau van het gemiddelde jaar, dezelfde prijs uit de kostenregel, dezelfde financiële doorrekening over {config.analysisYears} jaar.</>,
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
      titel: "Voor wie: voor welke huishoudens deze batterij loont",
      watZieJe: <>Jouw batterij doorgerekend voor huishoudens met jouw afname maar een andere teruglevering ({HUISHOUDENS_TERUGLEVERING.map((t) => getal(t)).join(", ")} kWh per jaar), en voor een huishouden zonder zonnepanelen.</>,
      bronnen: [PROFIEL_BRON(config), PRIJS_BRON],
      stappen: [
        <>Per huishouden één jaarsimulatie op {j.year}, met dezelfde batterij, dezelfde prijs ({euro(config.investmentEur)}) en dezelfde slijtagedrempel als jouw doorrekening. Alleen de teruglevering verschuift; het profiel wordt zo geschaald dat het jaartotaal klopt. Daarna gaat elk punt naar het niveau van het gemiddelde jaar, net als de kaart van maten.</>,
        <>Het huishouden zonder zonnepanelen rekent met het gemeten profiel van aansluitingen zonder invoeding (MFFBAS, afnametype AZI): het gemeten gemiddelde van alle aansluitingen zonder teruglevering in het netgebied, geen bewerking van het profiel met panelen.</>,
        <>Het netto resultaat per punt is dezelfde financiële doorrekening als bovenaan, over {config.analysisYears} jaar. Waar de lijn de nullijn kruist, komt de batterij uit de kosten; dat punt staat in de titel, lineair tussen de twee dichtstbijzijnde huishoudens.</>,
        <>Jouw eigen huishouden staat erbij uit het hoofdresultaat, op hetzelfde niveau: zijn jaarbesparing is die van het antwoord bovenaan, zodat de lijn daaraan te ijken is. Hoort jouw teruglevering bij één van de zes niveaus, zoals bij de standaardinvoer (2.000 kWh), dan valt jouw punt over dat huishouden heen. {rasterGrondslag(config)}</>,
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
      // Het teken bepaalt het woord: een doel dat meer uitstoot geeft "meer",
      // niet "-x kg minder".
      const co2 =
        k.co2WinstKg === null
          ? ""
          : Math.round(Math.abs(k.co2WinstKg)) === 0
            ? ", CO2 ongeveer gelijk"
            : `, ${getal(Math.abs(k.co2WinstKg))} kg CO2 ${k.co2WinstKg > 0 ? "minder" : "meer"}`;
      return [{
        wat: `${naam}${id === gekozen ? " (gekozen)" : ""}`,
        waarde: `${euro(k.besparingEur)} per jaar${co2}`,
        uitkomst: id === gekozen,
      }];
    });
    return {
      titel: "Sturing: de drie doelen waar de batterij op stuurt",
      watZieJe: (
        <>
          Dezelfde batterij en hetzelfde huishouden, drie keer doorgerekend.
          Alleen het doel van de aansturing verschilt; de uurprijzen, het profiel
          en de batterij zijn dezelfde.
        </>
      ),
      bronnen: [PRIJS_BRON, PROFIEL_BRON(config), NED_BRON],
      stappen: [
        <>
          <b>Rendement</b> stuurt op prijs: laden als stroom goedkoop is of als
          er eigen zon over is, leveren als hij duur is, ook aan het net. Dit is
          het doel waarmee de tool standaard rekent. De vermindering van CO2 die
          je erbij ziet is een bijeffect: goedkope uren zijn vaak schone uren,
          maar niet altijd.
        </>,
        <>
          <b>Zelfconsumptie</b> gebruikt dezelfde prijzen, maar met de handen op
          de rug: laden mag alleen uit eigen overschot, leveren alleen aan het
          eigen huis. Nooit laden uit het net, nooit terugleveren uit de
          batterij. Binnen die grenzen kiest de aansturing nog wel het beste
          moment.
        </>,
        <>
          <b>Uitstoot</b> geeft de aansturing de emissiefactor van elk uur in
          plaats van de prijs: de gemiddelde uitstoot van de Nederlandse opwek
          op dat uur (NED), niet de marginale van de centrale die bijspringt. De
          batterij mijdt dan de uren met de meeste CO2, ongeacht de prijs. Wat
          je teruglevert telt voor jouw eigen uitstoot niet mee. Om de slijtage
          mee te wegen staat één cent gelijk aan {GRAM_PER_CENT} gram.
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
          voorbeelddag is voor alle drie dezelfde: de gewone zomerdag (juni tot
          en met augustus) van het tabblad Door het jaar.
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
        titel: "Jouw CO2: de CO2-balans",
        watZieJe: <>Voor deze periode zijn er geen emissiefactoren in de data.</>,
        bronnen: [NED_BRON],
        stappen: [<>De reeks van NED loopt van 2023 tot nu; kies een periode daarbinnen.</>],
      };
    }
    const h = huishoudPerspectief(c);
    return {
      titel: "Jouw CO2: wat de batterij scheelt aan de uitstoot van jouw stroom",
      watZieJe: <>De uitstoot van de stroom die je van het net haalt, zonder en met batterij, gemiddeld per jaar over de {n > 1 ? `${n} volledige jaren` : "gekozen periode"}.</>,
      bronnen: [NED_BRON, PROFIEL_BRON(config)],
      stappen: [
        <>Per kwartier: wat je van het net afnam (uit de doorrekening, zonder en met batterij) maal de emissiefactor van dat uur. Opgeteld over het jaar is dat de uitstoot van je netafname.</>,
        <>Alleen afname telt. Wat je teruglevert gebruikt iemand anders; dat telt bij hem mee. Het perspectief van Nederland, waar teruglevering wél meetelt, staat onderaan het tabblad.</>,
        zonderPanelen(config) ? (
          <>Zonder zonnepanelen laadt de batterij alleen van het net. Minder CO2 ontstaat als hij laadt op uren waarop de mix schoner is dan op de uren waarop hij levert. Omdat er bij laden en ontladen stroom verloren gaat, haal je in totaal meer van het net; dat telt mee met de factor van het laaduur.</>
        ) : (
          <>De batterij kan op twee manieren voor minder CO2 zorgen. Hij bewaart je eigen zonnestroom voor de avond, zodat je dan minder van het net haalt terwijl gascentrales draaien. En als hij van het net laadt, kan hij dat doen op uren waarop de mix schoner is dan wanneer hij levert.</>
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
            ? [{ wat: `Evenveel als autorijden (${AUTO_G_PER_KM} g/km)`, waarde: `${getal(Math.round((h.winstKg * 1000) / AUTO_G_PER_KM / 10) * 10)} km` }]
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
    titel: "CO2 per uur: wanneer stroom schoon is",
    watZieJe: <>De gemiddelde emissiefactor per uur van de dag in winter en zomer, en per uur hoeveel afname de batterij van het net weghaalt.</>,
    bronnen: [NED_BRON],
    stappen: [
      <>De lijn is het gemiddelde van de emissiefactor over alle dagen van het seizoen, per uur van de dag, over de volledige jaren. Zomer is april tot en met september, dezelfde grens als het nettarief.</>,
      <>De staven eronder komen uit de seizoensprofielen op het tabblad Door het jaar: de gemiddelde afname per uur zonder batterij min die met batterij. Boven de lijn haalt de batterij afname weg, eronder laadt hij van het net.</>,
      <>Vallen de staven boven de lijn samen met de hoge uren van de curve, dan komt de vermindering van CO2 uit de avond; vallen de staven onder de lijn samen met de lage uren, dan laadt de batterij schoon.</>,
    ],
    letop: [
      <>Een gemiddeld dagprofiel vlakt uit: op één dag is de middagfactor lager en de avondpiek hoger dan hier. De optelling per kwartier in de balans gebruikt de echte uren, niet dit gemiddelde.</>,
      result.co2 && result.co2.ontbrekendeKwartieren > 0
        ? <>Voor {getal(result.co2.ontbrekendeKwartieren / 4)} uur ontbrak de factor (de NED-reeks loopt achter); die uren tellen nergens mee.</>
        : <>De reeks van NED heeft geen gaten in de gekozen periode.</>,
    ],
  }),

  co2maanden: ({ config }) => ({
    titel: "CO2 per maand: hoeveel minder CO2 elke maand",
    watZieJe: <>Hoeveel minder CO2 je netafname per maand kost met batterij, gemiddeld over de volledige jaren.</>,
    bronnen: [NED_BRON],
    stappen: [
      <>Per maand: de uitstoot van de afname zonder batterij min die met batterij, opgeteld uit de kwartieren van die maand en gemiddeld over de jaren waarin de maand voorkomt.</>,
      zonderPanelen(config) ? (
        <>Zonder zonnepanelen verschuift de batterij alleen afname: hij laadt van het net en levert later. Dat geeft minder CO2 in maanden waarin de laaduren schoner zijn dan de leveruren, en meer waar het andersom is.</>
      ) : (
        <>In de zomer kan de batterij zonnestroom bewaren voor de avond, als er anders stroom van gascentrales nodig was: dat scheelt veel CO2 per kWh. In de winter verschuift hij afname van de avondpiek naar de nacht, en die nacht is niet altijd schoner: soms draait er dan meer kolen of minder wind.</>
      ),
    ],
    letop: [
      <>In een maand kan de batterij juist meer CO2 geven: dan laadde hij op uren die vuiler waren dan de uren waarop hij leverde. Financieel kan dat nog steeds lonen, want de prijs volgt de mix niet één op één.</>,
      co2SturingLetop(config),
      MARGINAAL_LETOP,
    ],
  }),

  co2nederland: ({ result, config }) => {
    const c = result.co2;
    const drempel = config.co2DrempelG ?? STANDAARD_CO2_DREMPEL_G;
    const nl = c ? nederlandPerspectief(c, drempel) : null;
    return {
      titel: "CO2 voor Nederland: het perspectief van Nederland",
      watZieJe: <>Wat de batterij Nederland als geheel scheelt, met je teruglevering erbij. De figuur telt twee stappen op: wat hij scheelt aan je afname, en wat er verandert aan teruglevering die elders gas vervangt.</>,
      bronnen: [NED_BRON, PROFIEL_BRON(config)],
      stappen: [
        <>Vanuit Nederland is jouw teruglevering geen verlies: een buur gebruikt die kWh en er hoeft minder uit een centrale te komen. Die vermeden uitstoot is de teruglevering maal de factor van dat uur, en gaat van de uitstoot van je afname af.</>,
        <>Behalve op uren waarop de mix al onder de drempel zit ({getal(drempel)} g/kWh): dan is er vaak, maar niet altijd, meer aanbod dan vraag in Nederland, en gaat de kWh de grens over of wordt hij afgeschakeld. Die teruglevering telt hier niet mee. De drempel is een benadering van overschot, geen meting.</>,
        <>De balans bewaart afname en teruglevering per klasse van {CO2_KLASSE_G} g/kWh. De drempel stel je in bij de geavanceerde instellingen, onder "Hoe je ernaar kijkt"; hij rondt af op de klassegrens en rekent zonder wachten.</>,
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
      figuur: c && !zonderPanelen(config)
        ? {
            kop: "Op welke uren je teruglevert",
            inhoud: (
              <>
                <p className="uitleg-noot">
                  Je teruglevering per klasse van {CO2_KLASSE_G} g/kWh: hoe schoon de stroom was op
                  het uur dat je terugleverde. Links van de stippellijn ({getal(drempel)} g/kWh) telt
                  ze als overschot, rechts vervangt ze opwek elders. Wat de batterij rechts van de
                  lijn opslaat, is de tweede stap in de figuur.
                </p>
                <Co2OverschotStaven co2={c} drempel={drempel} />
              </>
            ),
          }
        : undefined,
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
      titel: "Laadbeurten en levensduur: wanneer een laadbeurt de moeite waard is",
      watZieJe: (
        <>
          Hoe de batterij zijn laadbeurten opmaakt tegenover wat de cellen
          aankunnen en hoe oud hij mag worden, en welke drempel de aansturing
          gebruikt om te beslissen of een laadbeurt doorgaat.
        </>
      ),
      bronnen: [
        BATTERIJ_BRON(preset),
        {
          naam: "Literatuur over slijtage in de aansturing",
          wat: (
            <>
              B. Xu e.a., <i>Factoring the cycle aging cost of batteries participating in
              electricity markets</i> (2018); C. Schade en R. Egging-Bratseth, <i>Battery
              degradation: impact on economic dispatch</i> (2024). Beide concluderen dat een batterij alleen
              moet handelen als het prijsverschil boven de marginale slijtage ligt:
              wat één laadbeurt extra werkelijk aan levensduur kost.
            </>
          ),
        },
      ],
      stappen: [
        <>
          <b>Wat de drempel is.</b> Elke kWh die de batterij levert, gebruikt een
          stukje van zijn levensduur. De aansturing, de software die bepaalt
          wanneer de batterij laadt en levert, rekent daar een prijs voor: de
          slijtageprijs per geleverde kWh, {centPerKwh(s.wearCostEurPerKwh)} bij deze
          batterij (aanschaf ÷ laadbeurten × bruikbaar × wat er bij het ontladen
          overblijft), maal het deel dat de gekozen stand meerekent ({procent(deel)}).
          Dat is {centPerKwh(drempel)}.
        </>,
        <>
          <b>Een rekenvoorbeeld.</b> De aansturing telt die prijs bij de kosten
          van elke kWh die de batterij levert. Een laadbeurt gaat alleen door
          als wat hij oplevert groter is dan wat hij kost aan inkoop,
          omzettingsverlies én drempel. Om 1 kWh te leveren haal je 1 ÷{" "}
          {procent(rondgang, 1)} = {getal(1 / rondgang, 2)} kWh van het net, dus
          bij een inkoopprijs van {centPerKwh(inkoop)} moet de verkoopprijs
          minstens {centPerKwh(inkoop + verlies + drempel)} zijn:{" "}
          {centPerKwh(verlies)} voor het omzettingsverlies en{" "}
          {centPerKwh(drempel)} voor de slijtage. Op andere standen is dat{" "}
          {STRATEGIEEN.filter((st) => Math.abs(st.deel - deel) > 1e-9)
            .map((st) => `${centPerKwh(inkoop + verlies + s.wearCostEurPerKwh * st.deel)} bij ${st.naam} (${procent(st.deel)})`)
            .join(" en ")}.
        </>,
        <>
          <b>Waarom je hem gebruikt.</b> Zonder drempel handelt de batterij op elk
          prijsverschil dat het omzettingsverlies dekt, ook voor een paar cent, en
          verbruikt hij zijn laadbeurten voor bijna niets. Met de volle prijs als
          drempel (Zuinig) verdient elke laadbeurt zijn eigen slijtage terug,
          maar laat de batterij ook laadbeurten liggen die per saldo wél iets
          hadden opgeleverd als hij toch aan ouderdom aan zijn einde komt.
        </>,
        <>
          <b>Waarom het een keuze is.</b> Een batterij is aan het einde van zijn
          levensduur zodra het eerste van twee dingen gebeurt: zijn laadbeurten
          raken op, of hij wordt te oud. Raken de laadbeurten niet op vóór de
          kalender, dan kost een extra laadbeurt in werkelijkheid minder dan de
          volle prijs, want de cellen waren toch al afgeschreven op leeftijd. Wat
          een laadbeurt echt kost, hangt dus af van hoe vaak je handelt, en dat
          bepaalt de drempel. De drie standen ({STRATEGIEEN.map((st) => `${st.naam} ${procent(st.deel)}`).join(", ")})
          zijn drie antwoorden op die vraag.
        </>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Slijtageprijs per geleverde kWh", waarde: centPerKwh(s.wearCostEurPerKwh) },
          { wat: `Stand: ${strategie ? strategie.naam : "eigen stand"}, ${procent(deel)} daarvan`, waarde: centPerKwh(drempel), uitkomst: true },
          { wat: `Minimaal prijsverschil bij inkoop tegen ${centPerKwh(inkoop)}`, waarde: centPerKwh(verlies + drempel) },
          { wat: "Laadbeurten per jaar met deze drempel", waarde: getal(s.cyclesPerYear, 0) },
          { wat: `In ${config.calendarLifeYears} jaar kalenderlevensduur`, waarde: `${getal(inKalender)} van ${getal(config.cycleLife)}` },
          ...(jarenTotOp !== null ? [{ wat: "Laadbeurten op na", waarde: jaren(jarenTotOp), uitkomst: true }] : []),
        ],
        toelichting:
          jarenTotOp !== null && jarenTotOp < config.calendarLifeYears ? (
            <>De laadbeurten zijn eerder op dan de kalender: elke laadbeurt kost hier echt levensduur, en een strenge drempel is op zijn plaats.</>
          ) : deel > 0.2 ? (
            <>De batterij is eerder te oud dan versleten. Een lagere stand kan dan meer laadbeurten en een hogere besparing geven, zolang de laadbeurten niet opraken vóór de kalender. Kies een andere stand en reken opnieuw om het te zien.</>
          ) : (
            <>De batterij is eerder te oud dan versleten: hij gaat eerder door ouderdom achteruit dan door zijn laadbeurten.</>
          ),
      },
      letop: [
        <>De zichtbare slijtagepost bij de cijfers rekent altijd met de volle prijs, ongeacht de stand: dat is wat een kWh van de aanschaf opmaakt. De stand verandert alleen wat de aansturing beslist.</>,
        <>Het model rekent met een vaste slijtageprijs per kWh. In werkelijkheid slijt een cel meer bij diepe laadbeurten en bij een hoge laadtoestand; dat verfijnt de prijs, maar verandert de regel niet.</>,
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
      titel: "Over de looptijd: terugverdientijd en netto resultaat",
      watZieJe: <>De opgetelde besparing jaar na jaar tegenover de aanschafprijs, en wat de batterij over de looptijd oplevert na aftrek van de aanschaf en de rente die je misloopt.</>,
      bronnen: [{ naam: "Jouw aannames", wat: <>Looptijd {config.analysisYears} jaar, prijsstijging {procent(config.priceEscalation, 1)} per jaar, rente die je misloopt {procent(config.discountRate, 1)}, capaciteitsverlies {procent(config.calendarFadePerYear, 2)} per jaar, levensduur {getal(config.cycleLife)} laadbeurten.</> }],
      stappen: [
        <>Elk jaar verliest de batterij capaciteit: door ouderdom, en door laadbeurten zodra de levensduur in zicht komt. De besparing bij minder capaciteit wordt afgelezen van een curve die op 70%, 85% en 100% capaciteit is doorgerekend.</>,
        overgang ? (
          <>Het voorgestelde nettarief gaat naar verwachting op 1 januari {overgang.ingangsjaar} in. De lijn rekent daarom {overgangZin(overgang)} met de besparing onder het huidige nettarief, en daarna met die onder het nieuwe: dezelfde batterij, die gewoon doorslijt.</>
        ) : (
          <>Het nettariefscenario is nog niet doorgerekend; tot dan rekent de lijn met het huidige nettarief over de hele looptijd.</>
        ),
        <>Die besparing stijgt mee met de prijsstijging die je hebt ingesteld.</>,
        <>De terugverdientijd is het moment waarop de opgetelde besparing, zonder rente, de aanschafprijs inhaalt. Binnen het jaar rekenen we lineair.</>,
        <>Het netto resultaat telt de besparing van elk jaar mee tegen de rente die je misloopt, en trekt de aanschaf ervan af. Is het positief, dan is de batterij beter dan het geld laten staan.</>,
      ],
      voorbeeld: {
        regels: [
          { wat: "Aanschafprijs", waarde: euro(config.investmentEur) },
          { wat: "Besparing in het eerste jaar", waarde: euro(f.cashflows[0]?.savingNominalEur ?? 0) },
          ...(laatste
            ? [
                { wat: `Opgeteld na ${config.analysisYears} jaar, min de aanschaf (zonder rente)`, waarde: euro(laatste.cumulativeNominalEur) },
                { wat: `Resterende capaciteit na ${config.analysisYears} jaar`, waarde: procent(laatste.capacityFraction) },
              ]
            : []),
          { wat: overgang ? "Terugverdientijd, als het nettarief-voorstel doorgaat" : "Terugverdientijd", waarde: jaren(f.paybackYears), uitkomst: true },
          { wat: "Netto resultaat", waarde: euro(f.npvEur), uitkomst: true },
          ...(f.irr !== null ? [{ wat: "Rendement op je aankoop", waarde: procent(f.irr, 1) }] : []),
          ...(f.endOfLifeYear !== null ? [{ wat: "Laadbeurten van de cellen op in jaar", waarde: String(f.endOfLifeYear) }] : []),
          ...(overgang
            ? [
                {
                  wat: "Ter vergelijking, als het nettarief blijft zoals nu: terugverdientijd",
                  waarde: jaren(result.finance.paybackYears),
                },
                {
                  wat: "Ter vergelijking, als het nettarief blijft zoals nu: netto resultaat",
                  waarde: euro(result.finance.npvEur),
                },
                ...(result.finance.irr !== null
                  ? [{ wat: "Ter vergelijking, als het nettarief blijft zoals nu: rendement op je aankoop", waarde: procent(result.finance.irr, 1) }]
                  : []),
              ]
            : []),
        ],
      },
      letop: [
        <>De looptijd is jouw keuze voor de beoordeling, geen eigenschap van de batterij. Rente verandert alleen het netto resultaat; prijsstijging ook de terugverdientijd. Geen van beide verandert de jaarbesparing.</>,
        geenVoorspellingLetop(result),
      ],
    };
  },
};
