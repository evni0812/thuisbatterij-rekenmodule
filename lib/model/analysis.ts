/**
 * De complete doorrekening: van invoer naar alle uitkomsten die de app toont.
 *
 * Eén functie die per profieljaar de baseline, de realistische strategie en het
 * optimum berekent, de besparing uitsplitst naar waar hij vandaan komt, en de
 * meerjarige businesscase opbouwt.
 */

import { LocalTimeIndex } from "../data/timeaxis";
import {
  equivalentCycles,
  marginalWearCostPerKwh,
  standbyKwhPerStep,
  usableCapacityKwh,
  wearCostPerKwh,
  WEAR_ONDERGRENS_DEEL,
} from "./battery";
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
 * Drie verliezen, en ze zijn wezenlijk anders van aard:
 *
 *   laadverlies     omzetting van wisselstroom naar de cel. Evenredig met wat
 *                   je erin stopt.
 *   ontlaadverlies  omzetting terug. Evenredig met wat je eruit haalt.
 *   standby         de elektronica die dag en nacht aan staat, ook als er niets
 *                   gebeurt. Hangt níét van het gebruik af, en is bij een
 *                   kleine batterij daarom relatief het zwaarst.
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
  standbyKwh: number;
  /** Som van de drie verliezen, kWh. */
  totalKwh: number;
  chargeLossEur: number;
  dischargeLossEur: number;
  standbyEur: number;
  totalEur: number;
  /**
   * De gemeten rondgang: hoeveel er per ingaande kilowattuur weer uit komt.
   * Ligt iets onder het rendement uit de specificatie, want aan het eind van
   * het venster zit er nog lading in de cel die niet meer geleverd is.
   */
  roundtrip: number;
}

/** Uitkomsten voor één profieljaar. */
export interface YearAnalysis {
  year: number;
  firstDay: string;
  lastDay: string;
  isFullYear: boolean;
  /** Netto afname en teruglevering zonder batterij, kWh. */
  gridImportKwh: number;
  gridExportKwh: number;
  baselineCostEur: number;
  realisticCostEur: number;
  optimalCostEur: number;
  realisticSavingEur: number;
  optimalSavingEur: number;
  breakdown: SavingBreakdown;
  cyclesPerYear: number;
  /** Aandeel van het optimum dat de realistische strategie haalt, 0–1. */
  captureRate: number;
  /** Netafname met batterij, kWh — waar de reductie uit volgt. */
  gridImportWithBatteryKwh: number;
  /** Netinvoeding met batterij, kWh. */
  gridExportWithBatteryKwh: number;
  /** Energie die door de batterij ging, AC-zijdig geleverd, kWh. */
  throughputKwh: number;
  /** Wat er onderweg verloren ging. */
  losses: EnergyLosses;
}

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
  /** Netinvoeding zonder en met batterij, kWh per jaar. */
  gridExportBaselineKwh: number;
  gridExportBatteryKwh: number;
  /** Zelfconsumptie: welk deel van je opwek je zelf gebruikt, 0–1. */
  selfConsumptionBaseline: number | null;
  selfConsumptionBattery: number | null;
  /** Autarkie: welk deel van je verbruik je zelf dekt, 0–1. */
  selfSufficiencyBaseline: number | null;
  selfSufficiencyBattery: number | null;
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
  /** Kalenderlevensduur van de batterij; stuurt de slijtagedrempel. */
  calendarLifeYears: number;
  years: number;
  priceEscalation: number;
  discountRate: number;
  calendarFadePerYear: number;
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

export interface AnalysisResult {
  perYear: YearAnalysis[];
  /** Gemiddelde jaarbesparing over de volledige profieljaren, EUR. */
  averageSavingEur: number;
  minSavingEur: number;
  maxSavingEur: number;
  finance: FinanceResult;
  curve: SavingCurvePoint[];
  priceGap: PriceGap;
  sampleDays: SampleDay[];
  stats: KeyStats;
  /** Verliezen per jaar, gemiddeld over de volledige profieljaren. */
  losses: EnergyLosses;
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
 * omzettingsverlies in euro's komt in beide op hetzelfde neer; standby staat
 * alleen hier, omdat het geen omzettingsverlies is maar eigen verbruik.
 */
export function energyLosses(
  window: Window,
  bat: DispatchResult,
  spec: BatterySpec,
): EnergyLosses {
  const n = window.residualKwh.length;
  const standbyPerStap = standbyKwhPerStep(spec);

  let geladen = 0;
  let geleverd = 0;
  let laadverliesKwh = 0;
  let laadverliesEur = 0;
  let ontlaadverliesKwh = 0;
  let ontlaadverliesEur = 0;
  let standbyEur = 0;

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

    // Standby loopt door of de batterij nu werkt of niet. Wat het kost hangt af
    // van waar je op dat moment staat: koop je bij, dan de afnameprijs; lever je
    // terug, dan de opbrengst die je misloopt.
    standbyEur += standbyPerStap * (bat.gridImportKwh[i]! > 0 ? ip : ep);
  }

  const standbyKwh = standbyPerStap * n;
  return {
    chargedKwh: geladen,
    deliveredKwh: geleverd,
    chargeLossKwh: laadverliesKwh,
    dischargeLossKwh: ontlaadverliesKwh,
    standbyKwh,
    totalKwh: laadverliesKwh + ontlaadverliesKwh + standbyKwh,
    chargeLossEur: laadverliesEur,
    dischargeLossEur: ontlaadverliesEur,
    standbyEur,
    totalEur: laadverliesEur + ontlaadverliesEur + standbyEur,
    roundtrip: geladen > 0 ? geleverd / geladen : 0,
  };
}

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

function analyseWindow(
  entry: AnalysisInput["windows"][number],
  spec: BatterySpec,
  tariff: TariffSpec,
  /** Een al berekende realistische dispatch voor precies deze spec, indien voorhanden. */
  realistischAlBerekend?: DispatchResult,
): {
  analysis: YearAnalysis;
  realistic: DispatchResult;
  optimal: DispatchResult;
  baselineCost: number;
} {
  const { window, year, firstDay, lastDay, isFullYear } = entry;
  const base = dispatchBaseline(window, tariff);
  const real = realistischAlBerekend ?? dispatchRolling(window, spec, tariff);
  const opt = dispatchOptimal(window, spec, tariff);

  let imp = 0;
  let exp = 0;
  for (let i = 0; i < window.residualKwh.length; i++) {
    const r = window.residualKwh[i]!;
    if (r > 0) imp += r;
    else exp -= r;
  }

  let dischargeTotal = 0;
  let importWithBattery = 0;
  let exportWithBattery = 0;
  for (let i = 0; i < real.dischargeKwh.length; i++) {
    dischargeTotal += real.dischargeKwh[i]!;
    importWithBattery += real.gridImportKwh[i]!;
    exportWithBattery += real.gridExportKwh[i]!;
  }

  const realSaving = base.totalCostEur - real.totalCostEur;
  const optSaving = base.totalCostEur - opt.totalCostEur;

  // Zelfvoorziening meten we op de afname: hoeveel minder het net hoeft te
  // leveren. Zonder bruto verbruik is dat de eerlijkste maat die we hebben.
  const totaalBehoefte = imp;
  const analysis: YearAnalysis = {
    year,
    firstDay,
    lastDay,
    isFullYear,
    gridImportKwh: imp,
    gridExportKwh: exp,
    baselineCostEur: base.totalCostEur,
    realisticCostEur: real.totalCostEur,
    optimalCostEur: opt.totalCostEur,
    realisticSavingEur: realSaving,
    optimalSavingEur: optSaving,
    breakdown: breakdown(window, base, real, spec),
    cyclesPerYear: equivalentCycles(dischargeTotal, spec),
    captureRate: optSaving > 0 ? realSaving / optSaving : 0,
    gridImportWithBatteryKwh: importWithBattery,
    gridExportWithBatteryKwh: exportWithBattery,
    throughputKwh: dischargeTotal,
    losses: energyLosses(window, real, spec),
  };
  void totaalBehoefte;
  return {
    analysis,
    realistic: real,
    optimal: opt,
    baselineCost: base.totalCostEur,
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

  const standby = standbyKwhPerStep(spec);
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

    // Met batterij: uit de dispatch, die de standby al in het net verwerkt.
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
      // Zolang er overschot is komt de lading daaruit; de rest is inkoop. Het
      // standby-verbruik hoort bij het huis, niet bij het overschot.
      const overschot = Math.max(0, -r - standby);
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
    stats: dayStats(window, dispatch, spec, tariff, start, end, optimal),
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
  const perfect = dispatchRolling(entry.window, spec, tariff, {
    perfectForecast: true,
  });
  const perfectSaving = baselineCost - perfect.totalCostEur;

  // De twee posten kunnen door discretisatieruis een fractie negatief
  // uitvallen; dat is geen informatieverlies en hoort niet als zodanig getoond.
  return {
    year: entry.year,
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

export function runAnalysis(
  input: AnalysisInput,
  options: AnalysisOptions = {},
): AnalysisResult {
  // Eerst uitvinden of laadbeurten schaars zijn: pas als de batterij ze binnen
  // zijn kalenderlevensduur opmaakt, kost een extra beurt méér dan de
  // ondergrens. Eén proefjaar is genoeg voor die schatting.
  //
  // De proefrun draait mét de ondergrens, niet zonder drempel. Dat is niet
  // alleen realistischer — een beurt kost altijd iets — het houdt ook de
  // hergebruiktruc in stand: blijkt de drempel op de ondergrens te blijven, dan
  // ÍS deze run de realistische dispatch van dat jaar en hoeft hij niet
  // opnieuw. Zonder die keuze zou elke doorrekening een volledige extra
  // jaarsimulatie kosten, want de drempel is sinds de ondergrens nooit meer nul.
  const ondergrens =
    wearCostPerKwh(input.investmentEur, input.cycleLife, input.battery) *
    WEAR_ONDERGRENS_DEEL;
  const metOndergrens: BatterySpec = {
    ...input.battery,
    wearCostEurPerKwh: ondergrens,
  };
  const proef = input.windows.find((w) => w.isFullYear) ?? input.windows[0];
  let verwachteCycli = 0;
  let proefRun: DispatchResult | undefined;
  if (proef) {
    proefRun = dispatchRolling(proef.window, metOndergrens, input.tariff);
    verwachteCycli = proefRun.equivalentCycles;
  }

  const drempel = marginalWearCostPerKwh(
    input.investmentEur,
    input.cycleLife,
    input.battery,
    verwachteCycli,
    input.calendarLifeYears,
  );
  const spec: BatterySpec = { ...input.battery, wearCostEurPerKwh: drempel };

  const uitkomsten = input.windows.map((w) =>
    analyseWindow(
      w,
      spec,
      input.tariff,
      w === proef && Math.abs(drempel - ondergrens) < 1e-12 ? proefRun : undefined,
    ),
  );
  const perYear = uitkomsten.map((u) => u.analysis);
  if (options.collectDispatches) {
    options.collectDispatches.length = 0;
    for (const u of uitkomsten) options.collectDispatches.push(u.realistic);
  }
  if (options.collectOptimal) {
    options.collectOptimal.length = 0;
    for (const u of uitkomsten) options.collectOptimal.push(u.optimal);
  }

  // Alleen volledige jaren tellen mee voor het gemiddelde en de bandbreedte:
  // een deelperiode is per definitie lager en zou de uitkomst vertekenen.
  const volledig = perYear.filter((y) => y.isFullYear);
  const basis = volledig.length > 0 ? volledig : perYear;
  const besparingen = basis.map((y) => y.realisticSavingEur);
  const gemiddeld =
    besparingen.reduce((a, b) => a + b, 0) / Math.max(1, besparingen.length);

  // Besparingscurve: dezelfde doorrekening bij een paar kleinere capaciteiten,
  // zodat de degradatie over de jaren geïnterpoleerd kan worden in plaats van
  // opnieuw gesimuleerd.
  // De curve wordt op ÉÉN representatief jaar bemonsterd, niet op alle jaren.
  // Hij dient alleen om de degradatie over de looptijd te interpoleren, en de
  // vorm van saving(capaciteit) verschilt nauwelijks tussen jaren — het niveau
  // wel, en dat komt uit het gemiddelde hieronder. Alle jaren bemonsteren zou
  // de doorrekening verdubbelen voor een verwaarloosbaar verschil.
  const referentieJaar = basis[basis.length - 1]!;
  const referentieIndex = perYear.indexOf(referentieJaar);
  const referentieEntry = input.windows[referentieIndex]!;
  const referentieBasis = uitkomsten[referentieIndex]!.baselineCost;

  const fracties = input.curveFractions ?? [0.7, 0.85, 1];
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
    const kleiner: BatterySpec = { ...spec, capacityKwh: spec.capacityKwh * f };
    const q = quickSaving(referentieEntry, kleiner, input.tariff, referentieBasis);
    // Het referentiejaar geeft de VORM; het gemiddelde over alle jaren geeft het
    // NIVEAU. Zo blijft de curve consistent met de getoonde jaarbesparing.
    const verhouding = volleBesparing > 0 ? q.savingEur / volleBesparing : 1;
    return {
      capacityFraction: f,
      savingEur: gemiddeld * verhouding,
      cyclesPerYear: gemiddeldeCycli * verhouding,
    };
  });

  const finance = computeFinance({
    curve,
    investmentEur: input.investmentEur,
    years: input.years,
    priceEscalation: input.priceEscalation,
    discountRate: input.discountRate,
    calendarFadePerYear: input.calendarFadePerYear,
    cycleLife: input.cycleLife,
    residualValueEur: input.residualValueEur,
  });

  // Voorbeelddagen komen uit het meest recente volledige jaar: dat is het
  // herkenbaarst en het best gedekt.
  const toonIndex = referentieIndex >= 0 ? referentieIndex : perYear.length - 1;
  const toonVenster = input.windows[toonIndex];
  const toonDispatch = uitkomsten[toonIndex]?.realistic;
  const toonOptimaal = uitkomsten[toonIndex]?.optimal;

  // Kerncijfers over de volledige jaren, per jaar gemiddeld.
  const gem = (f: (y: YearAnalysis) => number) =>
    basis.reduce((a, y) => a + f(y), 0) / Math.max(1, basis.length);

  const impBasis = gem((y) => y.gridImportKwh);
  const impBat = gem((y) => y.gridImportWithBatteryKwh);
  const expBasis = gem((y) => y.gridExportKwh);
  const expBat = gem((y) => y.gridExportWithBatteryKwh);
  const cycli = gem((y) => y.cyclesPerYear);

  const opwek = input.annualProductionKwh;
  // Wat je direct zelf gebruikt van je eigen opwek, zonder batterij: alles wat
  // niet is teruggeleverd. Daaruit volgt het bruto verbruik.
  const directEigen = opwek !== undefined ? Math.max(0, opwek - expBasis) : null;
  const brutoVerbruik = directEigen !== null ? impBasis + directEigen : null;

  const stats: KeyStats = {
    cyclesPerYear: cycli,
    cyclesPerDay: cycli / 365,
    throughputPerYearKwh: gem((y) => y.throughputKwh),
    gridImportBaselineKwh: impBasis,
    gridImportBatteryKwh: impBat,
    gridExportBaselineKwh: expBasis,
    gridExportBatteryKwh: expBat,
    selfConsumptionBaseline:
      opwek && opwek > 0 ? Math.min(1, 1 - expBasis / opwek) : null,
    selfConsumptionBattery:
      opwek && opwek > 0 ? Math.min(1, 1 - expBat / opwek) : null,
    selfSufficiencyBaseline:
      brutoVerbruik && brutoVerbruik > 0
        ? Math.min(1, 1 - impBasis / brutoVerbruik)
        : null,
    selfSufficiencyBattery:
      brutoVerbruik && brutoVerbruik > 0
        ? Math.min(1, 1 - impBat / brutoVerbruik)
        : null,
  };

  // Verliezen per jaar. Alle posten zijn optelbaar en dus middelbaar; de
  // rondgang niet — die volgt uit de gemiddelde in- en uitgaande energie.
  const geladenGem = gem((y) => y.losses.chargedKwh);
  const geleverdGem = gem((y) => y.losses.deliveredKwh);
  const losses: EnergyLosses = {
    chargedKwh: geladenGem,
    deliveredKwh: geleverdGem,
    chargeLossKwh: gem((y) => y.losses.chargeLossKwh),
    dischargeLossKwh: gem((y) => y.losses.dischargeLossKwh),
    standbyKwh: gem((y) => y.losses.standbyKwh),
    totalKwh: gem((y) => y.losses.totalKwh),
    chargeLossEur: gem((y) => y.losses.chargeLossEur),
    dischargeLossEur: gem((y) => y.losses.dischargeLossEur),
    standbyEur: gem((y) => y.losses.standbyEur),
    totalEur: gem((y) => y.losses.totalEur),
    roundtrip: geladenGem > 0 ? geleverdGem / geladenGem : 0,
  };

  return {
    perYear,
    stats,
    losses,
    averageSavingEur: gemiddeld,
    minSavingEur: Math.min(...besparingen),
    maxSavingEur: Math.max(...besparingen),
    finance,
    curve,
    priceGap: computePriceGap(input.windows, input.tariff),
    sampleDays:
      toonVenster && toonDispatch
        ? pickSampleDays(toonVenster, spec, input.tariff, toonDispatch, toonOptimaal)
        : [],
    gap:
      referentieIndex >= 0
        ? computeStrategyGap(
            referentieEntry,
            spec,
            input.tariff,
            referentieBasis,
            referentieJaar.realisticSavingEur,
            referentieJaar.optimalSavingEur,
          )
        : null,
  };
}

export { usableCapacityKwh };
