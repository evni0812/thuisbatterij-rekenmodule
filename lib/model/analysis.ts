/**
 * De complete doorrekening: van invoer naar alle uitkomsten die de app toont.
 *
 * Eén functie die per profieljaar de baseline, de realistische strategie en het
 * optimum berekent, de besparing uitsplitst naar waar hij vandaan komt, en de
 * meerjarige businesscase opbouwt.
 */

import { LocalTimeIndex } from "../data/timeaxis";
import { equivalentCycles, usableCapacityKwh, wearCostPerKwh } from "./battery";
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
  /** Rendementsverlies: wat er bij het laden en ontladen verdwijnt. */
  lossesEur: number;
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
  /** Zelfvoorzieningsgraad: welk deel van het verbruik niet van het net komt. */
  selfSufficiencyBaseline: number;
  selfSufficiencyBattery: number;
}

export interface AnalysisInput {
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
  residualKwh: number[];
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
}

/**
 * Splits de besparing uit naar herkomst.
 *
 * De posten zijn zo afgebakend dat ze elkaar niet overlappen en samen exact de
 * totale besparing vormen:
 *
 *   zelfconsumptie  minder van het net afnemen, minus de export-opbrengst die
 *                   je daarvoor opgeeft — maar alleen op momenten dat
 *                   teruglevering iets ópbrengt. Dit is de post die groeit nu
 *                   de saldering weg is: het verschil tussen wat afname kost en
 *                   wat teruglevering opbrengt is de hele businesscase.
 *   negatieve prijs vermeden kosten op momenten dat terugleveren geld kóst.
 *                   Apart gehouden omdat dit een wezenlijk ander mechanisme is
 *                   en snel groeit met de hoeveelheid zon op het net.
 *   verliezen       rendementsverlies en slijtage: wat de batterij zelf kost.
 *   arbitrage       wat er dan nog overblijft — het gevolg van op andere
 *                   momenten van het net nemen dan teruggeven.
 */
function breakdown(
  window: Window,
  base: DispatchResult,
  bat: DispatchResult,
  spec: BatterySpec,
): SavingBreakdown {
  const n = window.residualKwh.length;
  let self = 0;
  let avoided = 0;
  let verliesKwh = 0;
  let gewogenPrijs = 0;

  for (let i = 0; i < n; i++) {
    const ip = window.prices.importPrice[i]!;
    const ep = window.prices.exportPrice[i]!;

    const minderImport = base.gridImportKwh[i]! - bat.gridImportKwh[i]!;
    const minderExport = base.gridExportKwh[i]! - bat.gridExportKwh[i]!;

    if (ep < 0) {
      // Terugleveren kost hier geld: minder exporteren is pure winst. Zonder
      // curtailment betaalt de baseline dit; de batterij ontloopt het.
      avoided += minderExport * -ep;
      avoided += minderImport * ip;
    } else {
      self += minderImport * ip - minderExport * ep;
    }

    // Wat er bij laden en ontladen verdwijnt: er gaat meer in dan eruit komt.
    const verlies =
      bat.chargeKwh[i]! * (1 - spec.efficiency) +
      (bat.dischargeKwh[i]! / spec.efficiency) * (1 - spec.efficiency);
    verliesKwh += verlies;
    gewogenPrijs += verlies * ip;
  }

  const totaal = base.totalCostEur - bat.totalCostEur;
  const verliesEur = verliesKwh > 0 ? gewogenPrijs : 0;
  // Arbitrage is het residu, zodat de uitsplitsing per definitie optelt tot het
  // totaal en er geen onverklaard verschil kan ontstaan.
  const arbitrage = totaal - self - avoided + verliesEur;

  return {
    selfConsumptionEur: self,
    arbitrageEur: arbitrage,
    avoidedNegativeExportEur: avoided,
    lossesEur: -verliesEur,
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
  for (let i = 0; i < real.dischargeKwh.length; i++) {
    dischargeTotal += real.dischargeKwh[i]!;
    importWithBattery += real.gridImportKwh[i]!;
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
    selfSufficiencyBaseline: 0,
    selfSufficiencyBattery:
      totaalBehoefte > 0 ? 1 - importWithBattery / totaalBehoefte : 0,
  };
  return { analysis, realistic: real, baselineCost: base.totalCostEur };
}

function computePriceGap(windows: AnalysisInput["windows"]): PriceGap {
  let impVolume = 0;
  let impWaarde = 0;
  let expVolume = 0;
  let expWaarde = 0;
  let prijsSom = 0;
  let stappen = 0;
  let negatief = 0;
  let expNegatief = 0;

  for (const { window } of windows) {
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
    exportAtNegativePriceKwh: expNegatief,
  };
}

/**
 * Kies een representatieve zomer- en winterdag en leg vast wat de batterij doet.
 *
 * Representatief betekent hier: de dag met de mediane spreiding tussen hoogste
 * en laagste prijs binnen dat seizoen. Een extreme dag zou een spannender plaatje
 * geven maar een verkeerde indruk.
 */
function pickSampleDays(
  entry: AnalysisInput["windows"][number],
  spec: BatterySpec,
  dispatch: DispatchResult,
): SampleDay[] {
  const { window } = entry;
  const n = window.residualKwh.length;
  if (n === 0) return [];

  const index = new LocalTimeIndex(window.startMs[0]!, window.startMs[n - 1]!);

  // Dagen afbakenen in lokale tijd, want een dag is een wandklokbegrip.
  const grenzen: number[] = [];
  let vorige = Number.NaN;
  for (let i = 0; i < n; i++) {
    const d = index.localDayNumber(window.startMs[i]!);
    if (d !== vorige) {
      grenzen.push(i);
      vorige = d;
    }
  }
  grenzen.push(n);

  const kandidaten: { start: number; end: number; maand: number; spreiding: number }[] = [];
  for (let d = 0; d + 1 < grenzen.length; d++) {
    const start = grenzen[d]!;
    const end = grenzen[d + 1]!;
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
    const gekozen = set[Math.floor(set.length / 2)]!;
    const { start, end } = gekozen;
    const plak = <T,>(arr: { [k: number]: T }): T[] => {
      const uit: T[] = [];
      for (let i = start; i < end; i++) uit.push(arr[i]!);
      return uit;
    };
    return {
      label,
      date: index.localDate(window.startMs[start]!),
      startMs: plak(window.startMs),
      residualKwh: plak(window.residualKwh),
      socKwh: plak(dispatch.socKwh),
      chargeKwh: plak(dispatch.chargeKwh),
      dischargeKwh: plak(dispatch.dischargeKwh),
      importPrice: plak(window.prices.importPrice),
      exportPrice: plak(window.prices.exportPrice),
      usableCapacityKwh: usableCapacityKwh(spec),
    };
  };

  return [
    kies([6, 7, 8], "Een zomerdag"),
    kies([12, 1, 2], "Een winterdag"),
  ].filter((d): d is SampleDay => d !== null);
}

export function runAnalysis(input: AnalysisInput): AnalysisResult {
  const spec: BatterySpec = {
    ...input.battery,
    wearCostEurPerKwh: wearCostPerKwh(
      input.investmentEur,
      input.cycleLife,
      input.battery,
    ),
  };

  const uitkomsten = input.windows.map((w) => analyseWindow(w, spec, input.tariff));
  const perYear = uitkomsten.map((u) => u.analysis);

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

  return {
    perYear,
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
