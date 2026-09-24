/**
 * De complete doorrekening: van invoer naar alle uitkomsten die de app toont.
 *
 * Eén functie die per profieljaar de baseline, de realistische strategie en het
 * optimum berekent, de besparing uitsplitst naar waar hij vandaan komt, en de
 * meerjarige businesscase opbouwt.
 */

import { co2Jaar, gemiddeldCo2, type Co2Jaar } from "./co2";
import { LocalTimeIndex } from "../data/timeaxis";
import { isPiekuur } from "../nettarief";
import { equivalentCycles, usableCapacityKwh, wearCostPerKwh } from "./battery";
import { dispatchBaseline } from "./dispatch-baseline";
import { dispatchOptimal } from "./dispatch-optimal";
import { dispatchRolling } from "./dispatch-rolling";
import { computeFinance, type FinanceResult, type SavingCurvePoint } from "./finance";
import { stepCost } from "./tariff";
import type {
  BatterySpec,
  DispatchResult,
  TariffSpec,
  Window,
} from "./types";
import type { Configuration } from "../worker/protocol";

/** Waar de besparing vandaan komt, in EUR over het venster. */
export interface SavingBreakdown {
  /** Zelf verbruiken wat anders was teruggeleverd: het belastingverschil. */
  selfConsumptionEur: number;
  /** Goedkoop laden en duur ontladen binnen dezelfde prijsreeks. */
  arbitrageEur: number;
  /** Niet hoeven terugleveren tegen een negatieve prijs. */
  avoidedNegativeExportEur: number;
  /**
   * Het omzettingsverlies, gewaardeerd tegen wat die kilowatturen hadden
   * opgeleverd. Staat NAAST de optelling, niet erin: het zit al verwerkt in de
   * zelfconsumptiepost. Zie breakdown().
   */
  conversionLossEur: number;
  /** Hoeveel kilowattuur er bij het laden en ontladen verdween. */
  conversionLossKwh: number;
  /** Som van bovenstaande; gelijk aan basiskosten minus kosten met batterij. */
  totalEur: number;
}

/**
 * De energieboekhouding van de batterij: wat erin ging, wat eruit kwam, en waar
 * het verschil bleef.
 *
 * Twee verliezen:
 *
 *   laadverlies     omzetting van wisselstroom naar de cel. Evenredig met wat
 *                   je erin stopt.
 *   ontlaadverlies  omzetting terug. Evenredig met wat je eruit haalt.
 *
 * Het eigen verbruik van de omvormer (standby) zit niet in het model: dat is
 * een vaste post van het bezit, geen gevolg van de handel. Zie BatterySpec.
 *
 * De euro's zijn opportuniteitskosten: een verloren kilowattuur kost je wat hij
 * had opgeleverd als hij er nog was geweest. Uit eigen overschot is dat de
 * terugleverprijs, van het net de afnameprijs. Alles tegen de afnameprijs
 * waarderen zou de post fors overschatten.
 */
export interface EnergyLosses {
  /** Wat er aan de AC-zijde in de batterij ging, kWh. */
  chargedKwh: number;
  /** Wat de batterij aan de AC-zijde weer afgaf, kWh. */
  deliveredKwh: number;
  chargeLossKwh: number;
  dischargeLossKwh: number;
  /** Som van de twee verliezen, kWh. */
  totalKwh: number;
  chargeLossEur: number;
  dischargeLossEur: number;
  totalEur: number;
  /**
   * De gemeten rondgang: hoeveel er per ingaande kilowattuur weer uit komt.
   * Ligt iets onder het rendement uit de specificatie, want aan het eind van
   * het venster zit er nog lading in de cel die niet meer geleverd is.
   */
  roundtrip: number;
}

/**
 * Wat de batterij in één kalendermaand deed.
 *
 * De jaarbesparing is één getal, en dat verbergt dat een thuisbatterij in juni
 * iets heel anders doet dan in december: in de zomer vangt hij zonoverschot af,
 * in de winter leeft hij van het prijsverschil tussen nacht en avondpiek. Wie
 * wil weten of een accu bij hém past, moet dat verloop kunnen zien.
 *
 * De maandgrenzen liggen in lokale tijd, net als de daggrenzen: een maand begint
 * om middernacht in Amsterdam, niet in UTC.
 */
export interface MonthTotals {
  /** 1 tot en met 12. */
  month: number;
  savingEur: number;
  /** Door de batterij geleverde energie, AC-zijdig, kWh. */
  throughputKwh: number;
  cycles: number;
  gridImportBaselineKwh: number;
  gridImportBatteryKwh: number;
  gridExportBaselineKwh: number;
  gridExportBatteryKwh: number;
  /** Gemiddeld verschil tussen de hoogste en laagste afnameprijs per dag. */
  priceSpreadEurPerKwh: number;
  /**
   * Netafname in de piekuren van het nettariefprofiel (winter 16–22 uur, zomer
   * 19–23 uur), zonder en met batterij, kWh. Zie `piekurenVoorMaand`.
   */
  peakHourImportBaselineKwh: number;
  peakHourImportBatteryKwh: number;
}

/**
 * Het gemiddelde dagprofiel van een seizoen, per uur van de dag.
 *
 * De jaarcijfers zeggen hoevéél een batterij verzet, niet wannéér. Dat laatste
 * is juist waar het om draait zodra het nettarief van het moment gaat afhangen:
 * een batterij verplaatst afname van de avond naar de nacht en van het net naar
 * je eigen dak. Zonder dit profiel is die verplaatsing nergens te zien.
 *
 * Alles in kWh per uur van een gemiddelde dag in dat seizoen, zodat winter en
 * zomer naast elkaar leesbaar zijn ook al telt de ene meer dagen dan de andere.
 * Uren in lokale tijd: een avondpiek is een wandklokbegrip.
 */
export interface SeasonProfile {
  /** "zomer" is april tot en met september; dezelfde grens als het nettarief. */
  season: "winter" | "zomer";
  /** Aantal dagen waarover is gemiddeld, over alle meegetelde jaren samen. */
  days: number;
  /** Van het net gehaald, zonder batterij, kWh per uur van de dag. */
  importBaseline: number[];
  /** Van het net gehaald, met batterij. */
  importBattery: number[];
  /** Aan het net teruggeleverd, zonder batterij. */
  exportBaseline: number[];
  /** Aan het net teruggeleverd, met batterij. */
  exportBattery: number[];
}

/**
 * De optelling waaruit een seizoensprofiel volgt: sommen per uur, plus hoeveel
 * kwartieren er in dat uur vielen. Apart van het profiel zelf, want over
 * meerdere jaren moet je de sommen bij elkaar optellen en pas daarna delen.
 */
export interface SeasonAccum {
  som: { impBasis: Float64Array; impBat: Float64Array; expBasis: Float64Array; expBat: Float64Array };
  stappen: Float64Array;
}

function leegAccum(): SeasonAccum {
  return {
    som: {
      impBasis: new Float64Array(24),
      impBat: new Float64Array(24),
      expBasis: new Float64Array(24),
      expBat: new Float64Array(24),
    },
    stappen: new Float64Array(24),
  };
}

/**
 * Uitkomsten voor één profieljaar zonder het optimum: alles wat uit de
 * realistische strategie en de baseline volgt. Het scenario rekent alleen dit;
 * het optimum kost een extra doorrekening per jaar en wordt daar nergens
 * getoond.
 */
export interface YearKern {
  year: number;
  firstDay: string;
  lastDay: string;
  isFullYear: boolean;
  /**
   * Netto afname en teruglevering zonder batterij, kWh: wat er door de meter
   * ging, dus NA afregelen. Afgeregeld overschot is niet teruggeleverd en staat
   * apart in `curtailedKwh`.
   */
  gridImportKwh: number;
  gridExportKwh: number;
  /**
   * Overschot dat is afgeregeld in plaats van teruggeleverd (alleen bij een
   * negatieve terugleverprijs en afregelen aan), zonder en met batterij, kWh.
   * Geen teruglevering en ook geen eigen verbruik: die stroom is nooit gebruikt.
   */
  curtailedKwh: number;
  curtailedWithBatteryKwh: number;
  baselineCostEur: number;
  realisticCostEur: number;
  realisticSavingEur: number;
  breakdown: SavingBreakdown;
  cyclesPerYear: number;
  /** Netafname met batterij, kWh — waar de reductie uit volgt. */
  gridImportWithBatteryKwh: number;
  /** Netinvoeding met batterij, kWh, na afregelen. */
  gridExportWithBatteryKwh: number;
  /** Energie die door de batterij ging, AC-zijdig geleverd, kWh. */
  throughputKwh: number;
  /** Wat er onderweg verloren ging. */
  losses: EnergyLosses;
  /** Per kalendermaand; maanden buiten het venster ontbreken. */
  months: MonthTotals[];
  /**
   * Netafname in de piekuren van het nettariefprofiel, zonder en met batterij,
   * kWh. Som van de maandwaarden.
   */
  peakHourImportKwh: number;
  peakHourImportWithBatteryKwh: number;
  /**
   * Slijtage van de laadbeurten in dit jaar, EUR: geleverde kWh maal de volle
   * aanschafprijs per kWh doorzet. Zit NIET in de besparing — die post zit al
   * in de aanschafprijs en zou anders dubbel tellen — maar staat ernaast, zodat
   * je ziet wat de handel van de batterij opsoupeert.
   */
  wearCostEur: number;
  /**
   * De CO2-balans van dit jaar (lib/model/co2.ts), of null als er voor het
   * jaar geen emissiefactoren in de data zitten.
   */
  co2: Co2Jaar | null;
}

/** Wat het optimum met perfecte kennis aan een jaar toevoegt. */
export interface YearOptimum {
  optimalCostEur: number;
  optimalSavingEur: number;
  /** Aandeel van het optimum dat de realistische strategie haalt, 0–1. */
  captureRate: number;
}

/** Uitkomsten voor één profieljaar, inclusief het optimum. */
export interface YearAnalysis extends YearKern, YearOptimum {}

/**
 * Kerncijfers over de gekozen periode, per jaar.
 *
 * Zelfconsumptie en autarkie zijn de gangbare maten, maar ze vragen het BRUTO
 * verbruik en de BRUTO opwek — en die staan niet op je jaarafrekening; daar
 * staat alleen wat er door de meter ging. Ze worden daarom afgeleid uit één
 * extra getal, de jaaropwek van je panelen:
 *
 *   direct zelf gebruikt = opwek − teruglevering
 *   bruto verbruik       = netafname + direct zelf gebruikt
 *
 * Zonder dat getal blijven ze leeg en tonen we alleen wat wél exact volgt uit
 * de meterstanden.
 */
export interface KeyStats {
  /** Equivalente volledige cycli per jaar, en per dag. */
  cyclesPerYear: number;
  cyclesPerDay: number;
  /** Door de batterij geleverde energie per jaar, kWh. */
  throughputPerYearKwh: number;
  /** Netafname zonder en met batterij, kWh per jaar. */
  gridImportBaselineKwh: number;
  gridImportBatteryKwh: number;
  /**
   * Netinvoeding zonder en met batterij, kWh per jaar: wat er door de meter
   * ging, na afregelen. Beide kanten op dezelfde grondslag; eerder telde
   * "zonder" het ruwe overschot inclusief het afgeregelde deel en "met" niet,
   * waardoor de batterij veel meer teruglevering leek weg te nemen dan hij deed.
   */
  gridExportBaselineKwh: number;
  gridExportBatteryKwh: number;
  /**
   * Afgeregeld overschot zonder en met batterij, kWh per jaar: bij een
   * negatieve terugleverprijs weggegooid in plaats van teruggeleverd. Telt
   * niet als teruglevering en niet als eigen verbruik.
   */
  curtailedBaselineKwh: number;
  curtailedBatteryKwh: number;
  /**
   * Zelfconsumptie: welk deel van je opwek je zelf gebruikt, 0–1. Afgeregelde
   * stroom telt niet mee als zelf gebruikt.
   */
  selfConsumptionBaseline: number | null;
  selfConsumptionBattery: number | null;
  /** Autarkie: welk deel van je verbruik je zelf dekt, 0–1. */
  selfSufficiencyBaseline: number | null;
  selfSufficiencyBattery: number | null;
  /**
   * Netafname in de piekuren van het nettarief — winter 16 tot en met 22 uur,
   * zomer 19 tot en met 23 uur — zonder en met batterij, kWh per jaar.
   *
   * Dit is de maat voor wat een batterij voor het net doet: hoeveel er op de
   * duurste uren minder gevraagd wordt. Als aandeel van de netafname is het de
   * tegenhanger van zelfconsumptie: welk deel van wat je afneemt, valt in de
   * piek. Onafhankelijk van of het nettarief in de prijs zit, zodat het effect
   * van het tarief op het gedrag zichtbaar is.
   */
  peakHourImportBaselineKwh: number;
  peakHourImportBatteryKwh: number;
  /** Slijtage per jaar, EUR, en de volle slijtageprijs per geleverde kWh. Zie YearAnalysis. */
  wearCostPerYearEur: number;
  wearCostEurPerKwh: number;
}

export interface AnalysisInput {
  /**
   * Bruto jaaropwek van de panelen in kWh, als de gebruiker die weet.
   * Nodig voor zelfconsumptie en autarkie; zonder blijven die leeg.
   */
  annualProductionKwh?: number;
  /** Eén venster per profieljaar. */
  windows: { year: number; firstDay: string; lastDay: string; isFullYear: boolean; window: Window }[];
  battery: BatterySpec;
  tariff: TariffSpec;
  investmentEur: number;
  cycleLife: number;
  /** Kalenderlevensduur van de batterij, uit de catalogus; alleen ter duiding in de uitleg. */
  calendarLifeYears: number;
  years: number;
  priceEscalation: number;
  discountRate: number;
  calendarFadePerYear: number;
  /** Deel van de volle slijtageprijs als drempel voor de planner, 0–1; standaard 1. */
  wearFraction?: number;
  residualValueEur: number;
  /** Capaciteitsfracties waarop de besparingscurve wordt bemonsterd. */
  curveFractions?: number[];
}

/** Een dag uit de simulatie, om te laten zien wát de batterij doet. */
export interface SampleDay {
  label: string;
  /** Lokale kalenderdatum van deze dag. */
  date: string;
  startMs: number[];
  /**
   * Netto uitwisseling ZONDER batterij, kWh per kwartier.
   * Positief is afname van het net, negatief is teruglevering.
   */
  residualKwh: number[];
  /**
   * Netto uitwisseling MET batterij, kWh per kwartier, zelfde tekenafspraak.
   * Het verschil met residualKwh is precies wat de batterij doet.
   */
  netKwh: number[];
  /**
   * Overschot dat is afgeregeld in plaats van teruggeleverd, kWh per kwartier.
   * Alleen op momenten dat terugleveren geld zou kosten.
   */
  curtailedKwh: number[];
  socKwh: number[];
  chargeKwh: number[];
  dischargeKwh: number[];
  importPrice: number[];
  exportPrice: number[];
  usableCapacityKwh: number;
  /**
   * Teruglevering aan het net per kwartier zonder batterij, kWh: het deel van
   * de zonopwek dat het huis niet zelf gebruikte. Leeg als de componenten van
   * de residual niet zijn meegegeven.
   *
   * Niet hetzelfde als bruto zonopwek. Zie ResidualParts in residual.ts.
   */
  meterExportKwh: number[];
  /** Afname van het net per kwartier zonder batterij, kWh. Leeg zonder componenten. */
  meterImportKwh: number[];
  /**
   * Wat de dag tot dan toe gekost heeft, zonder en met batterij, in euro.
   *
   * Loopt op van nul om 00:00 tot de dagkosten om 24:00. Het verschil tussen de
   * twee lijnen op enig moment is wat de batterij op dat moment had opgeleverd;
   * het gat aan het eind is de dagbesparing.
   *
   * ── Waarom dit erbij hoort ────────────────────────────────────────────────
   * De andere panelen laten kilowatturen zien. Dat vertelt wát de batterij doet,
   * niet of het iets oplevert. Op een dag als 18 december 2025 koopt hij 's
   * nachts in en levert 's avonds, en komt het dagbedrag op nul uit — dat is aan
   * de kilowatturen niet te zien, maar aan twee lijnen die uit elkaar lopen en
   * weer bij elkaar komen wel.
   */
  cumulatiefBasisEur: number[];
  cumulatiefBatterijEur: number[];
  /** De kerngetallen van deze dag, los van de grafieken. */
  stats: SampleDayStats;
}

/**
 * Wat deze dag heeft opgeleverd, in getallen.
 *
 * Dezelfde grootheden als de jaarcijfers, maar over één etmaal, zodat je kunt
 * zien waar een jaarbedrag uit is opgebouwd. Ze worden hier berekend en niet in
 * de component, omdat er tarieflogica in zit: bij een negatieve prijs wordt een
 * overschot afgeregeld in plaats van verkocht, en dan kost het niets in plaats
 * van geld.
 */
export interface SampleDayStats {
  /** Variabele stroomkosten van deze dag zonder en met batterij, EUR. */
  baselineCostEur: number;
  batteryCostEur: number;
  /** Wat de batterij deze dag opleverde, EUR. Negatief kan: een misser. */
  savingEur: number;
  /**
   * Wat perfecte kennis van prijzen én verbruik deze dag had opgeleverd, EUR.
   * Null als het optimum niet is meegerekend.
   */
  optimalSavingEur: number | null;
  /** Afname van het net zonder en met batterij, kWh. */
  gridImportBaselineKwh: number;
  gridImportBatteryKwh: number;
  /** Teruglevering aan het net zonder en met batterij, kWh. */
  gridExportBaselineKwh: number;
  gridExportBatteryKwh: number;
  /** Wat er de batterij in ging en weer uit kwam, AC-zijdig, kWh. */
  chargedKwh: number;
  deliveredKwh: number;
  /** Waar de lading vandaan kwam: eigen overschot of inkoop, kWh. */
  chargedFromSolarKwh: number;
  chargedFromGridKwh: number;
  /** Equivalente volledige cycli op deze dag. */
  cycles: number;
  /** Hoogste lading van de dag, kWh. */
  socMaxKwh: number;
  /**
   * Lading aan het begin en het einde van de dag, kWh.
   *
   * ── Waarom dit een kerncijfer is ──────────────────────────────────────────
   * Een batterij houdt zich niet aan de kalender. Laden in de nacht van de 19e
   * om te ontladen op de 20e is precies wat je wilt op een dynamisch tarief,
   * maar de kosten vallen dan op de ene dag en de opbrengst op de andere. Op de
   * echte data van 2025 sluiten 64 dagen daardoor negatief af, samen ruim
   * achttien euro, terwijl die dagen samen met hun buurdag positief zijn.
   *
   * Zonder deze twee getallen leest zo'n dag als een misser van het model. Het
   * is er geen: het optimum met perfecte kennis maakt dezelfde keuze en komt op
   * exact hetzelfde negatieve dagbedrag uit.
   */
  socStartKwh: number;
  socEndKwh: number;
  /** Afgeregeld overschot, kWh. */
  curtailedKwh: number;
  /** Slijtage van de laadbeurten van deze dag, EUR; niet in savingEur verrekend. */
  wearCostEur: number;
  /** Hoogste en laagste afnameprijs van de dag, EUR/kWh. */
  priceMinEurPerKwh: number;
  priceMaxEurPerKwh: number;
  /**
   * Wat er zonder batterij die dag langs de meter ging, kWh: afname en
   * teruglevering apart, vóór het netten. Null als de componenten ontbreken.
   *
   * De teruglevering is het deel van de zonopwek dat het huis niet zelf
   * opmaakte. Het is niet de bruto opwek: wat direct werd gebruikt komt nooit
   * langs de meter en staat in geen enkele bron die deze tool gebruikt.
   */
  meterImportKwh: number | null;
  meterExportKwh: number | null;
}

/**
 * De prijskloof: waarom er überhaupt iets te besparen valt.
 *
 * Beide gemiddelden zijn VOLUMEGEWOGEN, niet simpel gemiddeld. Dat is het punt:
 * een huishouden met zonnepanelen neemt af als het duur is en levert terug als
 * het goedkoop is, dus het simpele uurgemiddelde verhult juist het effect waar
 * het om draait.
 */
export interface PriceGap {
  /** Gemiddelde prijs op de momenten dat er afname is, EUR/kWh. */
  weightedImportPrice: number;
  /** Gemiddelde opbrengst op de momenten dat er teruglevering is, EUR/kWh. */
  weightedExportPrice: number;
  /** Ongewogen gemiddelde marktprijs, ter vergelijking. */
  simpleAveragePrice: number;
  /** Aandeel van de kwartieren met een negatieve terugleverprijs. */
  negativePriceShare: number;
  /** Teruglevering die tegen een negatieve prijs plaatsvond, kWh. */
  exportAtNegativePriceKwh: number;
}

/**
 * Waarom de realistische strategie niet aan het optimum komt.
 *
 * Het optimum kent de hele periode vooraf; een echte batterij weet twee dingen
 * niet, en die zijn te scheiden door de strategie één keer te laten draaien met
 * een perfecte verbruiksvoorspelling maar dezelfde beperkte prijshorizon:
 *
 *   prijshorizon    Om 12:30 reiken de day-ahead prijzen tot vanavond 24:00;
 *                   pas na 13:00 tot morgen 24:00. De batterij plant dus soms
 *                   zonder te weten wat de nacht erna kost.
 *   verbruiksfout   Hoeveel zon er morgen valt en hoeveel er verbruikt wordt,
 *                   is een verwachting uit de voorgaande week. Dat is de grote
 *                   post: op de echte data 89 tot 94% van het gat.
 *
 * Gemeten op één representatief jaar, niet op alle jaren: het kost een extra
 * doorrekening en de verhouding tussen de twee posten verschilt nauwelijks per
 * jaar.
 */
export interface StrategyGap {
  /** Het jaar waarop dit is gemeten. */
  year: number;
  /** Besparing met perfecte kennis van alles, EUR. */
  optimalSavingEur: number;
  /** Besparing met perfect verbruik maar de echte prijshorizon, EUR. */
  perfectForecastSavingEur: number;
  /** Besparing zoals de tool hem rapporteert, EUR. */
  realisticSavingEur: number;
  /** Verlies doordat de prijzen van morgen pas om 13:00 bekend zijn, EUR. */
  horizonCostEur: number;
  /** Verlies doordat zon en verbruik van morgen een verwachting zijn, EUR. */
  forecastCostEur: number;
}

/**
 * Wat een doorrekening zonder optimum, voorbeelddagen en gat oplevert.
 *
 * Dit is alles wat het nettariefscenario nodig heeft: de pagina leest daarvan
 * de besparing, de kerncijfers, de financiën en de curve. Een volledige
 * `AnalysisResult` is hieraan toewijsbaar, dus bewaarde bundels en het
 * vooruitgerekende antwoord blijven bruikbaar.
 */
export interface ScenarioResult {
  perYear: YearKern[];
  /**
   * De uitsplitsing van de besparing, gemiddeld per jaar over de volledige
   * jaren — dezelfde grondslag als `losses`, `perMonth` en `averageSavingEur`.
   *
   * Eerder pakte de pagina hiervoor één profieljaar. Dat leverde een
   * uitsplitsing die optelde tot een ander bedrag dan het antwoord bovenaan,
   * en die per sectie een andere periode noemde. De posten zijn optelbaar, dus
   * middelen mag: `totalEur` is per constructie gelijk aan `averageSavingEur`.
   */
  breakdown: SavingBreakdown;
  /**
   * Het gemiddelde dagprofiel per seizoen, zonder en met batterij. Twee
   * elementen: winter en zomer, in die volgorde.
   */
  seasonProfiles: SeasonProfile[];
  /**
   * Gemiddeld per kalendermaand over de volledige profieljaren.
   *
   * Zelfde middeling als `stats` en `losses`: een deeljaar zou een maand die er
   * maar één keer in zit even zwaar laten wegen als een maand die er twee keer
   * in zit.
   */
  perMonth: MonthTotals[];
  /** Gemiddelde jaarbesparing over de volledige profieljaren, EUR. */
  averageSavingEur: number;
  minSavingEur: number;
  maxSavingEur: number;
  finance: FinanceResult;
  curve: SavingCurvePoint[];
  priceGap: PriceGap;
  stats: KeyStats;
  /** Verliezen per jaar, gemiddeld over de volledige profieljaren. */
  losses: EnergyLosses;
  /**
   * De CO2-balans, gemiddeld per jaar over de volledige profieljaren; null
   * als een van die jaren geen emissiefactoren heeft.
   */
  co2: Co2Jaar | null;
}

/** De volledige doorrekening: het scenario-deel plus optimum, voorbeelddagen en gat. */
export interface AnalysisResult extends Omit<ScenarioResult, "perYear"> {
  perYear: YearAnalysis[];
  sampleDays: SampleDay[];
  /** Waarom de realistische strategie onder het optimum blijft. */
  gap: StrategyGap | null;
}

/**
 * Splits de besparing uit naar herkomst.
 *
 * Drie posten die samen exact de besparing vormen:
 *
 *   zelfconsumptie  minder van het net afnemen doordat je je eigen stroom
 *                   bewaart tot je hem nodig hebt, minus de opbrengst die je
 *                   daarvoor opgeeft. Dit is de post die groeit nu de saldering
 *                   verdwijnt.
 *   negatieve prijs vermeden kosten op momenten dat terugleveren geld kóst.
 *   arbitrage       de netto waarde van stroom die je van het net kocht om
 *                   later te gebruiken of te verkopen.
 *
 * ── Waarom het omzettingsverlies er NIET tussen staat ───────────────────────
 * Verleidelijk om het als vierde post op te nemen, maar het zit al in de eerste
 * verwerkt: `minderImport` is de werkelijke reductie van je afname, en die is al
 * kleiner dan wat je opsloeg — precies door het verlies. Het er apart bij
 * aftrekken telt het twee keer, en omdat arbitrage als residu werd berekend,
 * vulde die het gat op met evenveel nep-arbitrage. Bij een batterij die nooit
 * van het net laadde stond er zo 32 euro "slim handelen" tegenover 32 euro
 * verlies, terwijl er geen enkele kilowattuur was ingekocht.
 *
 * Het verlies wordt daarom apart teruggegeven, als toelichting: zoveel is de
 * besparing lager dan hij zonder omzettingsverlies was geweest.
 */
export function breakdown(
  window: Window,
  base: DispatchResult,
  bat: DispatchResult,
  spec: BatterySpec,
): SavingBreakdown {
  const n = window.residualKwh.length;
  let avoided = 0;

  // Toerekening van de arbitrage: welk deel van alles wat de batterij opsloeg
  // kwam van het net, en wat leverde de ontlading op? Energie is niet te
  // labelen zodra ze in de cel zit, dus we rekenen naar rato toe.
  let geladenTotaal = 0;
  let geladenUitNet = 0;
  let kostenNetlading = 0;
  let ontlaadwaarde = 0;

  // Het omzettingsverlies, gewaardeerd tegen zijn opportuniteitskost.
  let verliesKwh = 0;
  let verliesEur = 0;

  for (let i = 0; i < n; i++) {
    const ip = window.prices.importPrice[i]!;
    const ep = window.prices.exportPrice[i]!;
    const laden = bat.chargeKwh[i]!;
    const ontladen = bat.dischargeKwh[i]!;
    const overschot = Math.max(0, -window.residualKwh[i]!);
    const tekort = Math.max(0, window.residualKwh[i]!);

    if (ep < 0) {
      // Terugleveren kost hier geld: wat de baseline moest weggeven en de
      // batterij opving, is pure winst.
      avoided += (base.gridExportKwh[i]! - bat.gridExportKwh[i]!) * -ep;
    }

    if (laden > 0) {
      const uitZon = Math.min(laden, overschot);
      const uitNet = laden - uitZon;
      geladenTotaal += laden;
      geladenUitNet += uitNet;
      kostenNetlading += uitNet * ip;

      // Een verloren kilowattuur kost je wat hij had opgeleverd als hij níét
      // verloren was gegaan. Uit eigen overschot is dat de terugleverprijs; van
      // het net de afnameprijs. Alles tegen de afnameprijs waarderen overschat
      // de post fors, want het meeste verlies ontstaat bij het opslaan van
      // overschot — en dat was maar een paar cent waard.
      const verliesIn = laden * (1 - spec.efficiency);
      verliesKwh += verliesIn;
      verliesEur += (verliesIn / laden) * (uitZon * ep + uitNet * ip);
    }

    if (ontladen > 0) {
      const naarHuis = Math.min(ontladen, tekort);
      const naarNet = ontladen - naarHuis;
      ontlaadwaarde += naarHuis * ip + naarNet * ep;

      const verliesUit = (ontladen / spec.efficiency) * (1 - spec.efficiency);
      verliesKwh += verliesUit;
      verliesEur += (verliesUit / ontladen) * (naarHuis * ip + naarNet * ep);
    }
  }

  const totaal = base.totalCostEur - bat.totalCostEur;

  // Wat de ingekochte stroom opbracht, naar rato van zijn aandeel in de lading.
  const aandeelNet = geladenTotaal > 0 ? geladenUitNet / geladenTotaal : 0;
  const arbitrage = aandeelNet * ontlaadwaarde - kostenNetlading;

  // Zelfconsumptie is het residu. Zo sluit de uitsplitsing per definitie aan op
  // het totaal en kan er geen onverklaard verschil ontstaan.
  const self = totaal - arbitrage - avoided;

  return {
    selfConsumptionEur: self,
    arbitrageEur: arbitrage,
    avoidedNegativeExportEur: avoided,
    conversionLossEur: verliesEur,
    conversionLossKwh: verliesKwh,
    totalEur: totaal,
  };
}

/**
 * Tel op hoeveel energie er in de batterij verdween, en wat dat kostte.
 *
 * Los van breakdown(), want dit is een andere vraag. Daar gaat het om waar de
 * besparing vandaan komt — hier om waar de kilowatturen bleven. Het
 * omzettingsverlies in euro's komt in beide op hetzelfde neer.
 */
export function energyLosses(
  window: Window,
  bat: DispatchResult,
  spec: BatterySpec,
): EnergyLosses {
  const n = window.residualKwh.length;

  let geladen = 0;
  let geleverd = 0;
  let laadverliesKwh = 0;
  let laadverliesEur = 0;
  let ontlaadverliesKwh = 0;
  let ontlaadverliesEur = 0;

  for (let i = 0; i < n; i++) {
    const ip = window.prices.importPrice[i]!;
    const ep = window.prices.exportPrice[i]!;
    const laden = bat.chargeKwh[i]!;
    const ontladen = bat.dischargeKwh[i]!;
    const overschot = Math.max(0, -window.residualKwh[i]!);
    const tekort = Math.max(0, window.residualKwh[i]!);

    if (laden > 0) {
      const uitZon = Math.min(laden, overschot);
      const uitNet = laden - uitZon;
      const verlies = laden * (1 - spec.efficiency);
      geladen += laden;
      laadverliesKwh += verlies;
      laadverliesEur += (verlies / laden) * (uitZon * ep + uitNet * ip);
    }

    if (ontladen > 0) {
      const naarHuis = Math.min(ontladen, tekort);
      const naarNet = ontladen - naarHuis;
      const verlies = (ontladen / spec.efficiency) * (1 - spec.efficiency);
      geleverd += ontladen;
      ontlaadverliesKwh += verlies;
      ontlaadverliesEur += (verlies / ontladen) * (naarHuis * ip + naarNet * ep);
    }
  }

  return {
    chargedKwh: geladen,
    deliveredKwh: geleverd,
    chargeLossKwh: laadverliesKwh,
    dischargeLossKwh: ontlaadverliesKwh,
    totalKwh: laadverliesKwh + ontlaadverliesKwh,
    chargeLossEur: laadverliesEur,
    dischargeLossEur: ontlaadverliesEur,
    totalEur: laadverliesEur + ontlaadverliesEur,
    roundtrip: geladen > 0 ? geleverd / geladen : 0,
  };
}

/**
 * Tel per kalendermaand op wat de batterij deed.
 *
 * Eén pass over de dispatch die er al is. De dagelijkse prijsspreiding wordt per
 * dag bepaald en daarna over de maand gemiddeld: het maandmaximum minus het
 * maandminimum zou de spreiding fors overdrijven, want dat vergelijkt een
 * goedkope nacht met een dure avond drie weken later — en daar kan geen batterij
 * tussen laden.
 */
export function maandTotalen(
  window: Window,
  base: DispatchResult,
  bat: DispatchResult,
  spec: BatterySpec,
): MonthTotals[] {
  const { starts, index } = dayBoundaries(window.startMs);
  const per = new Map<number, MonthTotals & { dagen: number; spreidingSom: number }>();

  for (let d = 0; d + 1 < starts.length; d++) {
    const a = starts[d]!;
    const b = starts[d + 1]!;
    const maand = Number(index.localDate(window.startMs[a]!).slice(5, 7));
    let m = per.get(maand);
    if (!m) {
      m = {
        month: maand,
        savingEur: 0,
        throughputKwh: 0,
        cycles: 0,
        gridImportBaselineKwh: 0,
        gridImportBatteryKwh: 0,
        gridExportBaselineKwh: 0,
        gridExportBatteryKwh: 0,
        priceSpreadEurPerKwh: 0,
        peakHourImportBaselineKwh: 0,
        peakHourImportBatteryKwh: 0,
        dagen: 0,
        spreidingSom: 0,
      };
      per.set(maand, m);
    }
    const piek = PIEKUREN[maand - 1]!;

    let hoog = -Infinity;
    let laag = Infinity;
    let ontladen = 0;
    for (let i = a; i < b; i++) {
      const ip = window.prices.importPrice[i]!;
      const ep = window.prices.exportPrice[i]!;
      m.savingEur +=
        (base.gridImportKwh[i]! - bat.gridImportKwh[i]!) * ip -
        (base.gridExportKwh[i]! - bat.gridExportKwh[i]!) * ep;
      m.gridImportBaselineKwh += base.gridImportKwh[i]!;
      m.gridImportBatteryKwh += bat.gridImportKwh[i]!;
      m.gridExportBaselineKwh += base.gridExportKwh[i]!;
      m.gridExportBatteryKwh += bat.gridExportKwh[i]!;
      ontladen += bat.dischargeKwh[i]!;
      if (ip > hoog) hoog = ip;
      if (ip < laag) laag = ip;
      // De piekuren van het nettarief zijn wandkloktijd, net als de maand.
      if (piek[index.localHour(window.startMs[i]!)]) {
        m.peakHourImportBaselineKwh += base.gridImportKwh[i]!;
        m.peakHourImportBatteryKwh += bat.gridImportKwh[i]!;
      }
    }
    m.throughputKwh += ontladen;
    m.dagen += 1;
    if (Number.isFinite(hoog) && Number.isFinite(laag)) m.spreidingSom += hoog - laag;
  }

  return [...per.values()]
    .map((m) => ({
      month: m.month,
      savingEur: m.savingEur,
      throughputKwh: m.throughputKwh,
      cycles: equivalentCycles(m.throughputKwh, spec),
      gridImportBaselineKwh: m.gridImportBaselineKwh,
      gridImportBatteryKwh: m.gridImportBatteryKwh,
      gridExportBaselineKwh: m.gridExportBaselineKwh,
      gridExportBatteryKwh: m.gridExportBatteryKwh,
      priceSpreadEurPerKwh: m.dagen > 0 ? m.spreidingSom / m.dagen : 0,
      peakHourImportBaselineKwh: m.peakHourImportBaselineKwh,
      peakHourImportBatteryKwh: m.peakHourImportBatteryKwh,
    }))
    .sort((a, b) => a.month - b.month);
}

/**
 * Tel per seizoen en per uur van de dag op wat er door de meter ging.
 *
 * Eén extra pass over de dispatch die er al is. Uur en maand in lokale tijd,
 * net als overal: het gaat om de avondpiek zoals je hem op de klok ziet, en de
 * zomergrens van het nettarief loopt op wandkloktijd.
 */
export function seizoensAccumulatie(
  window: Window,
  base: DispatchResult,
  bat: DispatchResult,
): { winter: SeasonAccum; zomer: SeasonAccum } {
  const n = window.residualKwh.length;
  const index = new LocalTimeIndex(window.startMs[0]!, window.startMs[n - 1]!);
  const uit = { winter: leegAccum(), zomer: leegAccum() };

  for (let i = 0; i < n; i++) {
    const ms = window.startMs[i]!;
    const maand = Number(index.localDate(ms).slice(5, 7));
    const uur = index.localHour(ms);
    const a = maand >= 4 && maand <= 9 ? uit.zomer : uit.winter;
    a.som.impBasis[uur]! += base.gridImportKwh[i]!;
    a.som.impBat[uur]! += bat.gridImportKwh[i]!;
    a.som.expBasis[uur]! += base.gridExportKwh[i]!;
    a.som.expBat[uur]! += bat.gridExportKwh[i]!;
    a.stappen[uur]! += 1;
  }
  return uit;
}

/** Tel twee accumulaties bij elkaar op, zodat jaren gemiddeld kunnen worden. */
function telAccumOp(a: SeasonAccum, b: SeasonAccum): void {
  for (let u = 0; u < 24; u++) {
    a.som.impBasis[u]! += b.som.impBasis[u]!;
    a.som.impBat[u]! += b.som.impBat[u]!;
    a.som.expBasis[u]! += b.som.expBasis[u]!;
    a.som.expBat[u]! += b.som.expBat[u]!;
    a.stappen[u]! += b.stappen[u]!;
  }
}

/**
 * Van sommen naar een gemiddelde dag.
 *
 * Elk uur telt vier kwartieren, dus het aantal dagen achter een uur is het
 * aantal kwartieren gedeeld door vier — ook als er door de zomertijd een uur
 * ontbreekt of dubbel voorkomt, want dan klopt de deling per uur nog steeds.
 */
function naarSeizoensprofiel(
  season: SeasonProfile["season"],
  a: SeasonAccum,
): SeasonProfile {
  const perDag = (som: Float64Array) =>
    Array.from({ length: 24 }, (_, u) =>
      a.stappen[u]! > 0 ? som[u]! / (a.stappen[u]! / 4) : 0,
    );
  let stappen = 0;
  for (let u = 0; u < 24; u++) stappen += a.stappen[u]!;
  return {
    season,
    days: stappen / 96,
    importBaseline: perDag(a.som.impBasis),
    importBattery: perDag(a.som.impBat),
    exportBaseline: perDag(a.som.expBasis),
    exportBattery: perDag(a.som.expBat),
  };
}

/** Piekuren per maand als 24 booleans, één keer opgebouwd. */
const PIEKUREN: readonly (readonly boolean[])[] = Array.from({ length: 12 }, (_, m) =>
  Array.from({ length: 24 }, (_, u) => isPiekuur(m + 1, u)),
);

/** Alleen de besparing, zonder baseline en optimum: voor de besparingscurve. */
function quickSaving(
  entry: AnalysisInput["windows"][number],
  spec: BatterySpec,
  tariff: TariffSpec,
  baselineCost: number,
): { savingEur: number; cyclesPerYear: number } {
  const real = dispatchRolling(entry.window, spec, tariff);
  let ontladen = 0;
  for (let i = 0; i < real.dischargeKwh.length; i++) ontladen += real.dischargeKwh[i]!;
  return {
    savingEur: baselineCost - real.totalCostEur,
    cyclesPerYear: equivalentCycles(ontladen, spec),
  };
}

/** De uitkomsten van één venster, zoals de samenvoeging ze nodig heeft. */
export interface VensterUitkomst {
  kern: YearKern;
  /** Alleen als het optimum is doorgerekend. */
  optimum?: YearOptimum;
  realistic: DispatchResult;
  optimal?: DispatchResult;
  baselineCost: number;
  /** Sommen per uur van de dag, per seizoen; pas na het middelen bruikbaar. */
  seizoenen: { winter: SeasonAccum; zomer: SeasonAccum };
}

export interface VensterOpties {
  /** Ook het optimum met perfecte kennis doorrekenen (een extra jaarsimulatie). */
  metOptimum: boolean;
  /** Volle slijtageprijs per geleverde kWh, voor de zichtbare slijtagepost. */
  wearEurPerKwh: number;
  /** Een al berekende realistische dispatch voor precies deze spec, indien voorhanden. */
  realistischAlBerekend?: DispatchResult;
}

/**
 * Reken één venster door: baseline, realistische strategie en desgewenst het
 * optimum. Puur in zijn invoer, zodat vensters over meerdere workers verdeeld
 * kunnen worden en daarna met `voegSamen` tot hetzelfde resultaat leiden als
 * één doorlopende `runAnalysis`.
 */
export function analyseWindow(
  entry: AnalysisInput["windows"][number],
  spec: BatterySpec,
  tariff: TariffSpec,
  opties: VensterOpties,
): VensterUitkomst {
  const { window, year, firstDay, lastDay, isFullYear } = entry;
  const base = dispatchBaseline(window, tariff);
  const real = opties.realistischAlBerekend ?? dispatchRolling(window, spec, tariff);
  const opt = opties.metOptimum ? dispatchOptimal(window, spec, tariff) : undefined;

  // Zonder en met batterij op dezelfde grondslag: wat er door de meter ging,
  // na afregelen. Het ruwe overschot uit de residual telde eerder ook het
  // afgeregelde deel als teruglevering, alleen aan de kant zonder batterij.
  let imp = 0;
  let exp = 0;
  let afgeregeld = 0;
  for (let i = 0; i < base.gridImportKwh.length; i++) {
    imp += base.gridImportKwh[i]!;
    exp += base.gridExportKwh[i]!;
    afgeregeld += base.curtailedKwh[i]!;
  }

  let dischargeTotal = 0;
  let importWithBattery = 0;
  let exportWithBattery = 0;
  let afgeregeldMet = 0;
  for (let i = 0; i < real.dischargeKwh.length; i++) {
    dischargeTotal += real.dischargeKwh[i]!;
    importWithBattery += real.gridImportKwh[i]!;
    exportWithBattery += real.gridExportKwh[i]!;
    afgeregeldMet += real.curtailedKwh[i]!;
  }

  const realSaving = base.totalCostEur - real.totalCostEur;

  const months = maandTotalen(window, base, real, spec);
  let piekBasis = 0;
  let piekBat = 0;
  for (const m of months) {
    piekBasis += m.peakHourImportBaselineKwh;
    piekBat += m.peakHourImportBatteryKwh;
  }

  const kern: YearKern = {
    year,
    firstDay,
    lastDay,
    isFullYear,
    gridImportKwh: imp,
    gridExportKwh: exp,
    curtailedKwh: afgeregeld,
    curtailedWithBatteryKwh: afgeregeldMet,
    baselineCostEur: base.totalCostEur,
    realisticCostEur: real.totalCostEur,
    realisticSavingEur: realSaving,
    breakdown: breakdown(window, base, real, spec),
    cyclesPerYear: equivalentCycles(dischargeTotal, spec),
    gridImportWithBatteryKwh: importWithBattery,
    gridExportWithBatteryKwh: exportWithBattery,
    throughputKwh: dischargeTotal,
    losses: energyLosses(window, real, spec),
    months,
    peakHourImportKwh: piekBasis,
    peakHourImportWithBatteryKwh: piekBat,
    wearCostEur: dischargeTotal * opties.wearEurPerKwh,
    co2: window.co2GPerKwh ? co2Jaar(window, base, real) : null,
  };
  let optimum: YearOptimum | undefined;
  if (opt) {
    const optSaving = base.totalCostEur - opt.totalCostEur;
    optimum = {
      optimalCostEur: opt.totalCostEur,
      optimalSavingEur: optSaving,
      captureRate: optSaving > 0 ? realSaving / optSaving : 0,
    };
  }
  return {
    kern,
    optimum,
    realistic: real,
    optimal: opt,
    baselineCost: base.totalCostEur,
    seizoenen: seizoensAccumulatie(window, base, real),
  };
}

/**
 * De prijskloof, per jaar.
 *
 * Alleen volledige kalenderjaren tellen mee, en het resultaat wordt gedeeld
 * door hun aantal. Zonder dat zou het volume optellen over de hele reeks —
 * ruim drie jaar — terwijl het naast een jaarvolume wordt getoond. Dan lijkt
 * er meer teruglevering in negatieve uren te vallen dan er in een heel jaar is.
 */
function computePriceGap(
  windows: AnalysisInput["windows"],
  tariff: TariffSpec,
): PriceGap {
  const volledig = windows.filter((w) => w.isFullYear);
  const basis = volledig.length > 0 ? volledig : windows;
  const jaren = Math.max(1, basis.length);
  let impVolume = 0;
  let impWaarde = 0;
  let expVolume = 0;
  let expWaarde = 0;
  let prijsSom = 0;
  let stappen = 0;
  let negatief = 0;
  let expNegatief = 0;

  for (const { window } of basis) {
    const n = window.residualKwh.length;
    for (let i = 0; i < n; i++) {
      const r = window.residualKwh[i]!;
      const ip = window.prices.importPrice[i]!;
      const ep = window.prices.exportPrice[i]!;
      // De kale marktprijs: de exportprijs zonder de terugleverkosten die er in
      // buildPriceSeries af zijn gegaan. Anders verschuift het "ongewogen
      // gemiddelde" mee met een instelling die er niets mee te maken heeft.
      prijsSom += ep + tariff.feedInCostEurPerKwh;
      stappen++;
      if (ep < 0) negatief++;
      if (r > 0) {
        impVolume += r;
        impWaarde += r * ip;
      } else if (r < 0) {
        expVolume -= r;
        expWaarde += -r * ep;
        if (ep < 0) expNegatief -= r;
      }
    }
  }

  return {
    weightedImportPrice: impVolume > 0 ? impWaarde / impVolume : 0,
    weightedExportPrice: expVolume > 0 ? expWaarde / expVolume : 0,
    simpleAveragePrice: stappen > 0 ? prijsSom / stappen : 0,
    negativePriceShare: stappen > 0 ? negatief / stappen : 0,
    exportAtNegativePriceKwh: expNegatief / jaren,
  };
}

/**
 * Bakent de lokale kalenderdagen af in een venster.
 *
 * In lokale tijd, want een dag is een wandklokbegrip: de grens ligt op
 * middernacht in Amsterdam, niet in UTC.
 */
export function dayBoundaries(
  startMs: Float64Array,
): { starts: number[]; index: LocalTimeIndex } {
  const n = startMs.length;
  const index = new LocalTimeIndex(startMs[0]!, startMs[n - 1]!);
  const starts: number[] = [];
  let vorige = Number.NaN;
  for (let i = 0; i < n; i++) {
    const d = index.localDayNumber(startMs[i]!);
    if (d !== vorige) {
      starts.push(i);
      vorige = d;
    }
  }
  starts.push(n);
  return { starts, index };
}

/**
 * De kerngetallen van één dag.
 *
 * De kosten worden hier opnieuw opgeteld over alleen deze dag, met dezelfde
 * tarieflogica als de jaardoorrekening: bij een negatieve terugleverprijs kost
 * afgeregeld overschot niets, en teruglevering die wél doorgaat brengt dan geld
 * mee dat je moet betalen.
 *
 * De baseline wordt uit de residual herleid in plaats van uit een aparte
 * dispatch. Dat kan exact: zonder batterij gaat de residual ongewijzigd het net
 * op of af, met curtailment op precies dezelfde voorwaarde.
 */
export function dayStats(
  window: Window,
  dispatch: DispatchResult,
  spec: BatterySpec,
  tariff: TariffSpec,
  start: number,
  end: number,
  optimal?: DispatchResult,
  /** Volle slijtageprijs per geleverde kWh; nul laat de post op nul. */
  wearEurPerKwh = 0,
): SampleDayStats {
  let baselineCost = 0;
  let batteryCost = 0;
  let optimalCost = 0;
  let impBasis = 0;
  let expBasis = 0;
  let impBat = 0;
  let expBat = 0;
  let geladen = 0;
  let geleverd = 0;
  let uitZon = 0;
  let uitNet = 0;
  let afgeregeld = 0;
  let socMax = 0;
  let prijsMin = Infinity;
  let prijsMax = -Infinity;
  let meterImp = 0;
  let meterExp = 0;

  const parts = window.parts;

  for (let i = start; i < end; i++) {
    const ip = window.prices.importPrice[i]!;
    const ep = window.prices.exportPrice[i]!;
    const r = window.residualKwh[i]!;

    if (ip < prijsMin) prijsMin = ip;
    if (ip > prijsMax) prijsMax = ip;

    // Zonder batterij: de residual gaat ongewijzigd het net op of af.
    if (r > 0) {
      impBasis += r;
      baselineCost += r * ip;
    } else if (r < 0) {
      const overschot = -r;
      const weg = tariff.allowCurtailment && ep < 0 ? overschot : 0;
      expBasis += overschot - weg;
      baselineCost -= (overschot - weg) * ep;
    }

    // Met batterij: uit de dispatch.
    const gi = dispatch.gridImportKwh[i]!;
    const ge = dispatch.gridExportKwh[i]!;
    impBat += gi;
    expBat += ge;
    batteryCost += gi * ip - ge * ep;
    afgeregeld += dispatch.curtailedKwh[i]!;

    if (optimal) {
      optimalCost +=
        optimal.gridImportKwh[i]! * ip - optimal.gridExportKwh[i]! * ep;
    }

    const laden = dispatch.chargeKwh[i]!;
    const ontladen = dispatch.dischargeKwh[i]!;
    geladen += laden;
    geleverd += ontladen;
    if (laden > 0) {
      // Zolang er overschot is komt de lading daaruit; de rest is inkoop.
      const overschot = Math.max(0, -r);
      const zon = Math.min(laden, overschot);
      uitZon += zon;
      uitNet += laden - zon;
    }
    if (dispatch.socKwh[i]! > socMax) socMax = dispatch.socKwh[i]!;

    if (parts) {
      meterImp += parts.gridImportKwh[i]!;
      meterExp += parts.gridExportKwh[i]!;
    }
  }

  return {
    baselineCostEur: baselineCost,
    batteryCostEur: batteryCost,
    savingEur: baselineCost - batteryCost,
    optimalSavingEur: optimal ? baselineCost - optimalCost : null,
    gridImportBaselineKwh: impBasis,
    gridImportBatteryKwh: impBat,
    gridExportBaselineKwh: expBasis,
    gridExportBatteryKwh: expBat,
    chargedKwh: geladen,
    deliveredKwh: geleverd,
    chargedFromSolarKwh: uitZon,
    chargedFromGridKwh: uitNet,
    cycles: equivalentCycles(geleverd, spec),
    socMaxKwh: socMax,
    // De stand vóór deze dag is de eindstand van het vorige kwartier; op de
    // eerste dag van het venster begint de batterij leeg.
    socStartKwh: start > 0 ? dispatch.socKwh[start - 1]! : 0,
    socEndKwh: end > start ? dispatch.socKwh[end - 1]! : 0,
    curtailedKwh: afgeregeld,
    wearCostEur: geleverd * wearEurPerKwh,
    priceMinEurPerKwh: prijsMin === Infinity ? 0 : prijsMin,
    priceMaxEurPerKwh: prijsMax === -Infinity ? 0 : prijsMax,
    meterImportKwh: parts ? meterImp : null,
    meterExportKwh: parts ? meterExp : null,
  };
}

/** Snijd één dag uit een venster plus de bijbehorende dispatch. */
export function extractDay(
  window: Window,
  dispatch: DispatchResult,
  spec: BatterySpec,
  tariff: TariffSpec,
  start: number,
  end: number,
  label: string,
  date: string,
  optimal?: DispatchResult,
  wearEurPerKwh = 0,
): SampleDay {
  const plak = (arr: { [k: number]: number }): number[] => {
    const uit: number[] = [];
    for (let i = start; i < end; i++) uit.push(arr[i]!);
    return uit;
  };
  const net: number[] = [];
  // Cumulatieve kosten met dezelfde stepCost als de dispatch zelf gebruikt, dus
  // inclusief het afregelen bij een negatieve prijs. Een tweede kostenformule
  // naast de eerste zou onvermijdelijk uit elkaar lopen.
  const cumBasis: number[] = [];
  const cumBat: number[] = [];
  let lopendBasis = 0;
  let lopendBat = 0;
  for (let i = start; i < end; i++) {
    net.push(dispatch.gridImportKwh[i]! - dispatch.gridExportKwh[i]!);
    const ip = window.prices.importPrice[i]!;
    const ep = window.prices.exportPrice[i]!;
    lopendBasis += stepCost(window.residualKwh[i]!, ip, ep, tariff.allowCurtailment);
    lopendBat += stepCost(
      dispatch.gridImportKwh[i]! - dispatch.gridExportKwh[i]!,
      ip,
      ep,
      tariff.allowCurtailment,
    );
    cumBasis.push(lopendBasis);
    cumBat.push(lopendBat);
  }
  return {
    label,
    date,
    startMs: plak(window.startMs),
    residualKwh: plak(window.residualKwh),
    netKwh: net,
    curtailedKwh: plak(dispatch.curtailedKwh),
    socKwh: plak(dispatch.socKwh),
    chargeKwh: plak(dispatch.chargeKwh),
    dischargeKwh: plak(dispatch.dischargeKwh),
    importPrice: plak(window.prices.importPrice),
    exportPrice: plak(window.prices.exportPrice),
    usableCapacityKwh: usableCapacityKwh(spec),
    meterExportKwh: window.parts ? plak(window.parts.gridExportKwh) : [],
    meterImportKwh: window.parts ? plak(window.parts.gridImportKwh) : [],
    cumulatiefBasisEur: cumBasis,
    cumulatiefBatterijEur: cumBat,
    stats: dayStats(window, dispatch, spec, tariff, start, end, optimal, wearEurPerKwh),
  };
}

/** Zoek een kalenderdatum op in een venster en geef die dag terug. */
export function findDay(
  window: Window,
  dispatch: DispatchResult,
  spec: BatterySpec,
  tariff: TariffSpec,
  isoDate: string,
  optimal?: DispatchResult,
  wearEurPerKwh = 0,
): SampleDay | null {
  const { starts, index } = dayBoundaries(window.startMs);
  for (let d = 0; d + 1 < starts.length; d++) {
    const start = starts[d]!;
    if (index.localDate(window.startMs[start]!) === isoDate) {
      return extractDay(
        window,
        dispatch,
        spec,
        tariff,
        start,
        starts[d + 1]!,
        "",
        isoDate,
        optimal,
        wearEurPerKwh,
      );
    }
  }
  return null;
}

/**
 * Kies een representatieve zomer- en winterdag.
 *
 * Representatief betekent hier: de dag met de mediane spreiding tussen hoogste
 * en laagste prijs binnen dat seizoen. Een extreme dag zou een spannender
 * plaatje geven maar een verkeerde indruk.
 */
function pickSampleDays(
  entry: AnalysisInput["windows"][number],
  spec: BatterySpec,
  tariff: TariffSpec,
  dispatch: DispatchResult,
  optimal?: DispatchResult,
  wearEurPerKwh = 0,
): SampleDay[] {
  const { window } = entry;
  const n = window.residualKwh.length;
  if (n === 0) return [];

  const { starts, index } = dayBoundaries(window.startMs);
  const kandidaten: { start: number; end: number; maand: number; spreiding: number }[] = [];

  for (let d = 0; d + 1 < starts.length; d++) {
    const start = starts[d]!;
    const end = starts[d + 1]!;
    let hoog = -Infinity;
    let laag = Infinity;
    for (let i = start; i < end; i++) {
      const p = window.prices.importPrice[i]!;
      if (p > hoog) hoog = p;
      if (p < laag) laag = p;
    }
    const maand = Number(index.localDate(window.startMs[start]!).slice(5, 7));
    kandidaten.push({ start, end, maand, spreiding: hoog - laag });
  }

  const kies = (maanden: number[], label: string): SampleDay | null => {
    const set = kandidaten.filter((k) => maanden.includes(k.maand));
    if (set.length === 0) return null;
    set.sort((a, b) => a.spreiding - b.spreiding);
    const g = set[Math.floor(set.length / 2)]!;
    return extractDay(
      window,
      dispatch,
      spec,
      tariff,
      g.start,
      g.end,
      label,
      index.localDate(window.startMs[g.start]!),
      optimal,
      wearEurPerKwh,
    );
  };

  return [
    kies([6, 7, 8], "Een doorsnee zomerdag"),
    kies([12, 1, 2], "Een doorsnee winterdag"),
  ].filter((d): d is SampleDay => d !== null);
}

/**
 * Ontleed het gat tussen de realistische strategie en het optimum.
 *
 * Eén extra doorrekening: dezelfde rollende strategie, maar met de werkelijke
 * residual als "voorspelling". Wat er dan nog aan het optimum ontbreekt, komt
 * uitsluitend door de beperkte prijshorizon en het herplanmoment; de rest van
 * het gat is de verbruiksvoorspelling.
 */
export function computeStrategyGap(
  entry: AnalysisInput["windows"][number],
  spec: BatterySpec,
  tariff: TariffSpec,
  baselineCost: number,
  realisticSavingEur: number,
  optimalSavingEur: number,
): StrategyGap {
  return strategyGapUit(
    entry.year,
    perfectVoorspellingBesparing(entry, spec, tariff, baselineCost),
    realisticSavingEur,
    optimalSavingEur,
  );
}

/** De besparing van de rollende strategie met de werkelijke residual als voorspelling. */
export function perfectVoorspellingBesparing(
  entry: AnalysisInput["windows"][number],
  spec: BatterySpec,
  tariff: TariffSpec,
  baselineCost: number,
): number {
  const perfect = dispatchRolling(entry.window, spec, tariff, { perfectForecast: true });
  return baselineCost - perfect.totalCostEur;
}

/** Het gat uit de drie besparingen; puur rekenwerk, geen simulatie. */
export function strategyGapUit(
  year: number,
  perfectSaving: number,
  realisticSavingEur: number,
  optimalSavingEur: number,
): StrategyGap {
  // De twee posten kunnen door discretisatieruis een fractie negatief
  // uitvallen; dat is geen informatieverlies en hoort niet als zodanig getoond.
  return {
    year,
    optimalSavingEur,
    perfectForecastSavingEur: perfectSaving,
    realisticSavingEur,
    horizonCostEur: Math.max(0, optimalSavingEur - perfectSaving),
    forecastCostEur: Math.max(0, perfectSaving - realisticSavingEur),
  };
}

export interface AnalysisOptions {
  /**
   * Wordt gevuld met de realistische dispatch per venster.
   *
   * De worker bewaart die om later een willekeurige dag uit te kunnen snijden.
   * Ze gaan bewust niet in AnalysisResult: dat wordt over de worker-grens
   * gestuurd, en een jaar aan dispatch is enkele megabytes die de UI niet nodig
   * heeft zolang er geen dag wordt opgevraagd.
   */
  collectDispatches?: DispatchResult[];
  /**
   * Wordt gevuld met de perfect-foresight dispatch per venster, in dezelfde
   * volgorde als `collectDispatches`.
   *
   * Nodig om bij een losse dag te laten zien wat er die dag maximaal in zat.
   * Dat is precies waar de vraag "waar zit het verschil in" wordt beslecht: op
   * dagniveau zie je of de batterij een piek miste of een dal verkeerd inschatte.
   */
  collectOptimal?: DispatchResult[];
}

/**
 * De slijtageprijs en de batterijspec waarmee de planner rekent.
 *
 * De volle prijs is wat een geleverde kWh van de aanschaf opsoupeert; die komt
 * overal terug als zichtbare post. De planner rekent er een deel van als
 * schaduwprijs (de strategie, zie lib/strategie.ts): een beurt gaat alleen
 * door als de marge na het omzettingsverlies groter is dan dat deel van de
 * slijtage, anders staat de batterij stil.
 */
export function slijtageVoor(input: AnalysisInput): { volleSlijtage: number; spec: BatterySpec } {
  const volleSlijtage = wearCostPerKwh(input.investmentEur, input.cycleLife, input.battery);
  return {
    volleSlijtage,
    spec: { ...input.battery, wearCostEurPerKwh: volleSlijtage * (input.wearFraction ?? 1) },
  };
}

/**
 * Het venster waar losse cijfers en de curve op rusten: het meest recente
 * volledige jaar, of het laatste venster als er geen volledig jaar in zit.
 */
export function referentieIndexVan(kernen: readonly { isFullYear: boolean }[]): number {
  for (let i = kernen.length - 1; i >= 0; i--) if (kernen[i]!.isFullYear) return i;
  return kernen.length - 1;
}

/** Eén meetpunt van de besparingscurve: de besparing bij een kleinere capaciteit. */
export interface CurveMeting {
  fraction: number;
  savingEur: number;
  cyclesPerYear: number;
}

/** De steunpunten van de besparingscurve als de invoer er geen opgeeft. */
export const STANDAARD_CURVE_FRACTIES: readonly number[] = [0.7, 0.85, 1];

/** De capaciteitsfracties waarvoor een extra doorrekening nodig is (niet 1). */
export function curveFracties(input: Pick<AnalysisInput, "curveFractions">): number[] {
  return (input.curveFractions ?? STANDAARD_CURVE_FRACTIES).filter((f) => f !== 1);
}

/**
 * Meet één curvepunt: dezelfde realistische strategie op het referentiejaar,
 * met een kleinere capaciteit. Eén jaarsimulatie.
 */
export function meetCurvePunt(
  input: AnalysisInput,
  spec: BatterySpec,
  referentieIndex: number,
  fraction: number,
  baselineCost: number,
): CurveMeting {
  const kleiner: BatterySpec = { ...spec, capacityKwh: spec.capacityKwh * fraction };
  const q = quickSaving(input.windows[referentieIndex]!, kleiner, input.tariff, baselineCost);
  return { fraction, ...q };
}

/**
 * De velden die niets aan de dispatch veranderen en alleen in de financiën en
 * de zelfvoorzieningscijfers doorwerken. Wie deze kent, kan een bewaard
 * resultaat voor een andere looptijd of rente hergebruiken zonder te rekenen.
 */
export interface Afleiding {
  investmentEur: number;
  cycleLife: number;
  years: number;
  priceEscalation: number;
  discountRate: number;
  calendarFadePerYear: number;
  residualValueEur: number;
  annualProductionKwh?: number;
}

export function afleidingVanInvoer(input: AnalysisInput): Afleiding {
  return {
    investmentEur: input.investmentEur,
    cycleLife: input.cycleLife,
    years: input.years,
    priceEscalation: input.priceEscalation,
    discountRate: input.discountRate,
    calendarFadePerYear: input.calendarFadePerYear,
    residualValueEur: input.residualValueEur,
    annualProductionKwh: input.annualProductionKwh,
  };
}

export function afleidingVanConfiguratie(config: Configuration): Afleiding {
  return {
    investmentEur: config.investmentEur,
    cycleLife: config.cycleLife,
    years: config.analysisYears,
    priceEscalation: config.priceEscalation,
    discountRate: config.discountRate,
    calendarFadePerYear: config.calendarFadePerYear,
    residualValueEur: config.residualValueEur,
    annualProductionKwh: config.annualProductionKwh,
  };
}

export function financeVoor(curve: SavingCurvePoint[], a: Afleiding): FinanceResult {
  return computeFinance({
    curve,
    investmentEur: a.investmentEur,
    years: a.years,
    priceEscalation: a.priceEscalation,
    discountRate: a.discountRate,
    calendarFadePerYear: a.calendarFadePerYear,
    cycleLife: a.cycleLife,
    residualValueEur: a.residualValueEur,
  });
}

/**
 * Zelfconsumptie en autarkie uit de netcijfers en de (geschatte) jaaropwek.
 * Wat je direct zelf gebruikt van je eigen opwek, zonder batterij, is alles
 * wat niet is teruggeleverd; daaruit volgt het bruto verbruik.
 */
export function metZelfvoorziening(stats: KeyStats, opwek: number | undefined): KeyStats {
  const impBasis = stats.gridImportBaselineKwh;
  const impBat = stats.gridImportBatteryKwh;
  const expBasis = stats.gridExportBaselineKwh;
  const expBat = stats.gridExportBatteryKwh;
  // Wat niet zelf gebruikt is: teruggeleverd plus afgeregeld. Afgeregelde
  // stroom is weggegooid, niet verbruikt; telde je hem niet mee, dan steeg het
  // eigen verbruik zonder batterij met elke negatieve middag.
  const nietGebruiktBasis = expBasis + stats.curtailedBaselineKwh;
  const nietGebruiktBat = expBat + stats.curtailedBatteryKwh;
  // Zonder opwek (zonder zonnepanelen) is er niets zelf te dekken: autarkie
  // bestaat dan niet. Eerder kwam er 0% → −3% uit, omdat een batterij die van
  // het net laadt met zijn omzettingsverlies de afname laat stijgen.
  const directEigen = opwek !== undefined && opwek > 0 ? Math.max(0, opwek - nietGebruiktBasis) : null;
  const brutoVerbruik = directEigen !== null ? impBasis + directEigen : null;
  return {
    ...stats,
    selfConsumptionBaseline:
      opwek && opwek > 0 ? Math.max(0, Math.min(1, 1 - nietGebruiktBasis / opwek)) : null,
    selfConsumptionBattery:
      opwek && opwek > 0 ? Math.max(0, Math.min(1, 1 - nietGebruiktBat / opwek)) : null,
    selfSufficiencyBaseline:
      brutoVerbruik && brutoVerbruik > 0
        ? Math.min(1, 1 - impBasis / brutoVerbruik)
        : null,
    selfSufficiencyBattery:
      brutoVerbruik && brutoVerbruik > 0
        ? Math.min(1, 1 - impBat / brutoVerbruik)
        : null,
  };
}

/**
 * Pas de afleidbare velden van een bewaard resultaat aan een andere looptijd,
 * rente, prijsstijging, degradatie, restwaarde of jaaropwek aan. Geen
 * simulatie: dezelfde curve, dezelfde netcijfers, alleen de financiën en de
 * zelfvoorzieningscijfers opnieuw. Levert per constructie hetzelfde als een
 * verse doorrekening met die velden, want `voegSamen` gebruikt dezelfde twee
 * functies.
 */
export function pasAfleidingToe<R extends ScenarioResult>(r: R, a: Afleiding): R {
  return {
    ...r,
    finance: financeVoor(r.curve, a),
    stats: metZelfvoorziening(r.stats, a.annualProductionKwh),
  };
}

/**
 * Voeg de vensters samen tot het scenario-deel van het resultaat: de
 * middelingen over de volledige jaren, de curve, de financiën en de kerncijfers.
 *
 * De volgorde van optellen is die van de vensters in `input.windows`, ongeacht
 * in welke volgorde ze zijn doorgerekend; zo geeft parallel rekenen exact
 * hetzelfde antwoord als achter elkaar.
 */
export function voegSamenScenario(
  input: AnalysisInput,
  uitkomsten: readonly VensterUitkomst[],
  metingen: readonly CurveMeting[],
): ScenarioResult {
  if (uitkomsten.length !== input.windows.length) {
    throw new Error(`${uitkomsten.length} vensteruitkomsten voor ${input.windows.length} vensters`);
  }
  const { volleSlijtage } = slijtageVoor(input);
  const perYear = uitkomsten.map((u) => u.kern);

  // Alleen volledige jaren tellen mee voor het gemiddelde en de bandbreedte:
  // een deelperiode is per definitie lager en zou de uitkomst vertekenen.
  const volledig = perYear.filter((y) => y.isFullYear);
  const basis = volledig.length > 0 ? volledig : perYear;
  // Maandgemiddelde over dezelfde volledige jaren. Een maand telt alleen mee in
  // de jaren waarin hij ook echt voorkomt; anders zou een venster dat halverwege
  // begint de eerste maanden verwateren.
  const maandBuckets = new Map<number, { som: MonthTotals; jaren: number }>();
  for (const jaar of basis) {
    for (const m of jaar.months) {
      const hit = maandBuckets.get(m.month);
      if (!hit) {
        maandBuckets.set(m.month, { som: { ...m }, jaren: 1 });
        continue;
      }
      hit.jaren += 1;
      hit.som.savingEur += m.savingEur;
      hit.som.throughputKwh += m.throughputKwh;
      hit.som.cycles += m.cycles;
      hit.som.gridImportBaselineKwh += m.gridImportBaselineKwh;
      hit.som.gridImportBatteryKwh += m.gridImportBatteryKwh;
      hit.som.gridExportBaselineKwh += m.gridExportBaselineKwh;
      hit.som.gridExportBatteryKwh += m.gridExportBatteryKwh;
      hit.som.priceSpreadEurPerKwh += m.priceSpreadEurPerKwh;
      hit.som.peakHourImportBaselineKwh += m.peakHourImportBaselineKwh;
      hit.som.peakHourImportBatteryKwh += m.peakHourImportBatteryKwh;
    }
  }
  const perMonth: MonthTotals[] = [...maandBuckets.values()]
    .map(({ som, jaren }) => ({
      month: som.month,
      savingEur: som.savingEur / jaren,
      throughputKwh: som.throughputKwh / jaren,
      cycles: som.cycles / jaren,
      gridImportBaselineKwh: som.gridImportBaselineKwh / jaren,
      gridImportBatteryKwh: som.gridImportBatteryKwh / jaren,
      gridExportBaselineKwh: som.gridExportBaselineKwh / jaren,
      gridExportBatteryKwh: som.gridExportBatteryKwh / jaren,
      priceSpreadEurPerKwh: som.priceSpreadEurPerKwh / jaren,
      peakHourImportBaselineKwh: som.peakHourImportBaselineKwh / jaren,
      peakHourImportBatteryKwh: som.peakHourImportBatteryKwh / jaren,
    }))
    .sort((a, b) => a.month - b.month);

  // Het seizoensprofiel over dezelfde volledige jaren: sommen optellen en pas
  // daarna delen, anders weegt een jaar met minder dagen even zwaar mee.
  const seizoenSom = { winter: leegAccum(), zomer: leegAccum() };
  for (let i = 0; i < perYear.length; i++) {
    if (!basis.includes(perYear[i]!)) continue;
    const s = uitkomsten[i]!.seizoenen;
    telAccumOp(seizoenSom.winter, s.winter);
    telAccumOp(seizoenSom.zomer, s.zomer);
  }
  const seasonProfiles: SeasonProfile[] = [
    naarSeizoensprofiel("winter", seizoenSom.winter),
    naarSeizoensprofiel("zomer", seizoenSom.zomer),
  ];

  const besparingen = basis.map((y) => y.realisticSavingEur);
  const gemiddeld =
    besparingen.reduce((a, b) => a + b, 0) / Math.max(1, besparingen.length);

  // Besparingscurve: dezelfde doorrekening bij een paar kleinere capaciteiten,
  // zodat de degradatie over de jaren geïnterpoleerd kan worden in plaats van
  // opnieuw gesimuleerd. Bemonsterd op ÉÉN representatief jaar: de vorm van
  // saving(capaciteit) verschilt nauwelijks tussen jaren, het niveau wel, en
  // dat komt uit het gemiddelde. Het referentiejaar geeft de VORM; het
  // gemiddelde over alle jaren geeft het NIVEAU.
  const referentieJaar = perYear[referentieIndexVan(perYear)]!;
  const fracties = input.curveFractions ?? STANDAARD_CURVE_FRACTIES;
  const volleBesparing = referentieJaar.realisticSavingEur;
  const gemiddeldeCycli =
    basis.reduce((a, y) => a + y.cyclesPerYear, 0) / Math.max(1, basis.length);

  const curve: SavingCurvePoint[] = fracties.map((f) => {
    if (f === 1) {
      return {
        capacityFraction: 1,
        savingEur: gemiddeld,
        cyclesPerYear: gemiddeldeCycli,
      };
    }
    const q = metingen.find((m) => m.fraction === f);
    if (!q) throw new Error(`curvemeting voor fractie ${f} ontbreekt`);
    const verhouding = volleBesparing > 0 ? q.savingEur / volleBesparing : 1;
    return {
      capacityFraction: f,
      savingEur: gemiddeld * verhouding,
      cyclesPerYear: gemiddeldeCycli * verhouding,
    };
  });

  const afleiding = afleidingVanInvoer(input);
  const finance = financeVoor(curve, afleiding);

  // Kerncijfers over de volledige jaren, per jaar gemiddeld.
  const gem = (f: (y: YearKern) => number) =>
    basis.reduce((a, y) => a + f(y), 0) / Math.max(1, basis.length);

  const cycli = gem((y) => y.cyclesPerYear);
  const stats: KeyStats = metZelfvoorziening(
    {
      cyclesPerYear: cycli,
      cyclesPerDay: cycli / 365,
      throughputPerYearKwh: gem((y) => y.throughputKwh),
      gridImportBaselineKwh: gem((y) => y.gridImportKwh),
      gridImportBatteryKwh: gem((y) => y.gridImportWithBatteryKwh),
      gridExportBaselineKwh: gem((y) => y.gridExportKwh),
      gridExportBatteryKwh: gem((y) => y.gridExportWithBatteryKwh),
      curtailedBaselineKwh: gem((y) => y.curtailedKwh),
      curtailedBatteryKwh: gem((y) => y.curtailedWithBatteryKwh),
      selfConsumptionBaseline: null,
      selfConsumptionBattery: null,
      selfSufficiencyBaseline: null,
      selfSufficiencyBattery: null,
      peakHourImportBaselineKwh: gem((y) => y.peakHourImportKwh),
      peakHourImportBatteryKwh: gem((y) => y.peakHourImportWithBatteryKwh),
      wearCostPerYearEur: gem((y) => y.wearCostEur),
      wearCostEurPerKwh: volleSlijtage,
    },
    afleiding.annualProductionKwh,
  );

  // Verliezen per jaar. Alle posten zijn optelbaar en dus middelbaar; de
  // rondgang niet — die volgt uit de gemiddelde in- en uitgaande energie.
  const geladenGem = gem((y) => y.losses.chargedKwh);
  const geleverdGem = gem((y) => y.losses.deliveredKwh);
  const losses: EnergyLosses = {
    chargedKwh: geladenGem,
    deliveredKwh: geleverdGem,
    chargeLossKwh: gem((y) => y.losses.chargeLossKwh),
    dischargeLossKwh: gem((y) => y.losses.dischargeLossKwh),
    totalKwh: gem((y) => y.losses.totalKwh),
    chargeLossEur: gem((y) => y.losses.chargeLossEur),
    dischargeLossEur: gem((y) => y.losses.dischargeLossEur),
    totalEur: gem((y) => y.losses.totalEur),
    roundtrip: geladenGem > 0 ? geleverdGem / geladenGem : 0,
  };

  const breakdownGem: SavingBreakdown = {
    selfConsumptionEur: gem((y) => y.breakdown.selfConsumptionEur),
    arbitrageEur: gem((y) => y.breakdown.arbitrageEur),
    avoidedNegativeExportEur: gem((y) => y.breakdown.avoidedNegativeExportEur),
    conversionLossEur: gem((y) => y.breakdown.conversionLossEur),
    conversionLossKwh: gem((y) => y.breakdown.conversionLossKwh),
    totalEur: gem((y) => y.breakdown.totalEur),
  };

  return {
    perYear,
    breakdown: breakdownGem,
    seasonProfiles,
    perMonth,
    stats,
    losses,
    averageSavingEur: gemiddeld,
    minSavingEur: Math.min(...besparingen),
    maxSavingEur: Math.max(...besparingen),
    finance,
    curve,
    priceGap: computePriceGap(input.windows, input.tariff),
    co2: basis.every((y) => y.co2 !== null) ? gemiddeldCo2(basis.map((y) => y.co2!)) : null,
  };
}

/**
 * Voeg de vensters samen tot het volledige resultaat. Alle vensters moeten
 * het optimum bevatten; de voorbeelddagen en het gat komen uit het
 * referentiejaar.
 *
 * @param perfectSaving  besparing met perfecte verbruiksvoorspelling op het
 *   referentiejaar (`perfectVoorspellingBesparing`), of null om het gat over te slaan
 */
export function voegSamen(
  input: AnalysisInput,
  uitkomsten: readonly VensterUitkomst[],
  metingen: readonly CurveMeting[],
  perfectSaving: number | null,
): AnalysisResult {
  const kern = voegSamenScenario(input, uitkomsten, metingen);
  const { spec, volleSlijtage } = slijtageVoor(input);
  const perYear: YearAnalysis[] = uitkomsten.map((u) => {
    if (!u.optimum) throw new Error(`venster ${u.kern.year} is zonder optimum doorgerekend`);
    return { ...u.kern, ...u.optimum };
  });
  const ref = referentieIndexVan(perYear);
  const toon = uitkomsten[ref]!;
  return {
    ...kern,
    perYear,
    // Voorbeelddagen komen uit het meest recente volledige jaar: dat is het
    // herkenbaarst en het best gedekt.
    sampleDays: pickSampleDays(
      input.windows[ref]!,
      spec,
      input.tariff,
      toon.realistic,
      toon.optimal,
      volleSlijtage,
    ),
    gap:
      perfectSaving === null
        ? null
        : strategyGapUit(
            perYear[ref]!.year,
            perfectSaving,
            perYear[ref]!.realisticSavingEur,
            perYear[ref]!.optimalSavingEur,
          ),
  };
}

/**
 * De volledige doorrekening, achter elkaar in één thread: de referentie
 * waaraan de parallelle weg (vensters over workers, daarna `voegSamen`)
 * gelijk moet zijn.
 */
export function runAnalysis(
  input: AnalysisInput,
  options: AnalysisOptions = {},
): AnalysisResult {
  const { spec, volleSlijtage } = slijtageVoor(input);
  const uitkomsten = input.windows.map((w) =>
    analyseWindow(w, spec, input.tariff, { metOptimum: true, wearEurPerKwh: volleSlijtage }),
  );
  if (options.collectDispatches) {
    options.collectDispatches.length = 0;
    for (const u of uitkomsten) options.collectDispatches.push(u.realistic);
  }
  if (options.collectOptimal) {
    options.collectOptimal.length = 0;
    for (const u of uitkomsten) options.collectOptimal.push(u.optimal!);
  }
  const ref = referentieIndexVan(uitkomsten.map((u) => u.kern));
  const basisKosten = uitkomsten[ref]!.baselineCost;
  const metingen = curveFracties(input).map((f) => meetCurvePunt(input, spec, ref, f, basisKosten));
  const perfect = perfectVoorspellingBesparing(input.windows[ref]!, spec, input.tariff, basisKosten);
  return voegSamen(input, uitkomsten, metingen, perfect);
}

/**
 * De doorrekening voor het nettariefscenario: zonder optimum, voorbeelddagen
 * en gat, want daar leest de pagina niets van. Dat scheelt vier jaarsimulaties
 * van het optimum en één met perfecte voorspelling.
 */
export function runScenario(input: AnalysisInput): ScenarioResult {
  const { spec, volleSlijtage } = slijtageVoor(input);
  const uitkomsten = input.windows.map((w) =>
    analyseWindow(w, spec, input.tariff, { metOptimum: false, wearEurPerKwh: volleSlijtage }),
  );
  const ref = referentieIndexVan(uitkomsten.map((u) => u.kern));
  const basisKosten = uitkomsten[ref]!.baselineCost;
  const metingen = curveFracties(input).map((f) => meetCurvePunt(input, spec, ref, f, basisKosten));
  return voegSamenScenario(input, uitkomsten, metingen);
}

/**
 * Het jaar waar losse cijfers naar verwijzen: het meest recente volledige
 * profieljaar, of het laatste venster als er geen volledig jaar in zit.
 *
 * Eén definitie, want de uitsplitsing in de pagina en de uitleg erachter
 * moeten hetzelfde jaar noemen. Toen de pagina het eerste volledige jaar pakte
 * en de uitleg het laatste, stond er onder de grafiek € 89 over 2024 en in de
 * uitleg ernaast € 100,25 over 2025 — dezelfde vraag, twee antwoorden.
 */
export function referentieJaar(r: AnalysisResult): YearAnalysis {
  const vol = r.perYear.filter((j) => j.isFullYear);
  return vol[vol.length - 1] ?? r.perYear[r.perYear.length - 1]!;
}

export { usableCapacityKwh };
