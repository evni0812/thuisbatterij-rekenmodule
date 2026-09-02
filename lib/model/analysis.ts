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
  usableCapacityKwh,
} from "./battery";
import { dispatchBaseline } from "./dispatch-baseline";
import { dispatchOptimal } from "./dispatch-optimal";
import { dispatchRolling } from "./dispatch-rolling";
import { computeFinance, type FinanceResult, type SavingCurvePoint } from "./finance";
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
): { analysis: YearAnalysis; realistic: DispatchResult; baselineCost: number } {
  const { window, year, firstDay, lastDay, isFullYear } = entry;
  const base = dispatchBaseline(window, tariff);
  const real = dispatchRolling(window, spec, tariff);
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
  };
  void totaalBehoefte;
  return { analysis, realistic: real, baselineCost: base.totalCostEur };
}

/**
 * De prijskloof, per jaar.
 *
 * Alleen volledige kalenderjaren tellen mee, en het resultaat wordt gedeeld
 * door hun aantal. Zonder dat zou het volume optellen over de hele reeks —
 * ruim drie jaar — terwijl het naast een jaarvolume wordt getoond. Dan lijkt
 * er meer teruglevering in negatieve uren te vallen dan er in een heel jaar is.
 */
function computePriceGap(windows: AnalysisInput["windows"]): PriceGap {
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
      prijsSom += ep;
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

/** Snijd één dag uit een venster plus de bijbehorende dispatch. */
export function extractDay(
  window: Window,
  dispatch: DispatchResult,
  spec: BatterySpec,
  start: number,
  end: number,
  label: string,
  date: string,
): SampleDay {
  const plak = (arr: { [k: number]: number }): number[] => {
    const uit: number[] = [];
    for (let i = start; i < end; i++) uit.push(arr[i]!);
    return uit;
  };
  const net: number[] = [];
  for (let i = start; i < end; i++) {
    net.push(dispatch.gridImportKwh[i]! - dispatch.gridExportKwh[i]!);
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
  };
}

/** Zoek een kalenderdatum op in een venster en geef die dag terug. */
export function findDay(
  window: Window,
  dispatch: DispatchResult,
  spec: BatterySpec,
  isoDate: string,
): SampleDay | null {
  const { starts, index } = dayBoundaries(window.startMs);
  for (let d = 0; d + 1 < starts.length; d++) {
    const start = starts[d]!;
    if (index.localDate(window.startMs[start]!) === isoDate) {
      return extractDay(window, dispatch, spec, start, starts[d + 1]!, "", isoDate);
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
  dispatch: DispatchResult,
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
      g.start,
      g.end,
      label,
      index.localDate(window.startMs[g.start]!),
    );
  };

  return [
    kies([6, 7, 8], "Een doorsnee zomerdag"),
    kies([12, 1, 2], "Een doorsnee winterdag"),
  ].filter((d): d is SampleDay => d !== null);
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
}

export function runAnalysis(
  input: AnalysisInput,
  options: AnalysisOptions = {},
): AnalysisResult {
  // Eerst uitvinden of laadbeurten schaars zijn. Dat kan alleen door te kijken
  // hoeveel de batterij er zonder drempel zou maken: pas als hij ze binnen zijn
  // kalenderlevensduur opmaakt, kost een extra beurt iets. Eén proefjaar is
  // genoeg voor die schatting.
  const zonderDrempel: BatterySpec = { ...input.battery, wearCostEurPerKwh: 0 };
  const proef = input.windows.find((w) => w.isFullYear) ?? input.windows[0];
  let verwachteCycli = 0;
  if (proef) {
    // Een grover SoC-rooster volstaat: we hoeven alleen te weten of het aantal
    // beurten boven of onder de levensduur uitkomt, niet wat het precies is.
    const p = dispatchRolling(proef.window, zonderDrempel, input.tariff, {
      socLevels: 41,
    });
    let ontladen = 0;
    for (let i = 0; i < p.dischargeKwh.length; i++) ontladen += p.dischargeKwh[i]!;
    verwachteCycli = equivalentCycles(ontladen, zonderDrempel);
  }

  const spec: BatterySpec = {
    ...input.battery,
    wearCostEurPerKwh: marginalWearCostPerKwh(
      input.investmentEur,
      input.cycleLife,
      input.battery,
      verwachteCycli,
      input.years,
    ),
  };

  const uitkomsten = input.windows.map((w) => analyseWindow(w, spec, input.tariff));
  const perYear = uitkomsten.map((u) => u.analysis);
  if (options.collectDispatches) {
    options.collectDispatches.length = 0;
    for (const u of uitkomsten) options.collectDispatches.push(u.realistic);
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

  return {
    perYear,
    stats,
    averageSavingEur: gemiddeld,
    minSavingEur: Math.min(...besparingen),
    maxSavingEur: Math.max(...besparingen),
    finance,
    curve,
    priceGap: computePriceGap(input.windows),
    sampleDays:
      toonVenster && toonDispatch
        ? pickSampleDays(toonVenster, spec, toonDispatch)
        : [],
  };
}

export { usableCapacityKwh };
