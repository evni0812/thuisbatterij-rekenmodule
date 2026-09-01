/**
 * De complete doorrekening: van invoer naar alle uitkomsten die de app toont.
 *
 * Eén functie die per profieljaar de baseline, de realistische strategie en het
 * optimum berekent, de besparing uitsplitst naar waar hij vandaan komt, en de
 * meerjarige businesscase opbouwt.
 */

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
  /** Rendementsverlies en slijtage: de kosten van de batterij zelf. */
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

export interface AnalysisResult {
  perYear: YearAnalysis[];
  /** Gemiddelde jaarbesparing over de volledige profieljaren, EUR. */
  averageSavingEur: number;
  minSavingEur: number;
  maxSavingEur: number;
  finance: FinanceResult;
  curve: SavingCurvePoint[];
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
  let wear = 0;

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
    wear += spec.wearCostEurPerKwh * bat.dischargeKwh[i]!;
  }

  const totaal = base.totalCostEur - bat.totalCostEur;
  // Arbitrage is het residu, zodat de uitsplitsing per definitie optelt tot het
  // totaal en er geen onverklaard verschil kan ontstaan.
  const arbitrage = totaal - self - avoided + wear;

  return {
    selfConsumptionEur: self,
    arbitrageEur: arbitrage,
    avoidedNegativeExportEur: avoided,
    lossesEur: -wear,
    totalEur: totaal,
  };
}

function analyseWindow(
  entry: AnalysisInput["windows"][number],
  spec: BatterySpec,
  tariff: TariffSpec,
): YearAnalysis {
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
  return {
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

  const perYear = input.windows.map((w) => analyseWindow(w, spec, input.tariff));

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
  const fracties = input.curveFractions ?? [0.7, 0.85, 1];
  const curve: SavingCurvePoint[] = fracties.map((f) => {
    if (f === 1) {
      return {
        capacityFraction: 1,
        savingEur: gemiddeld,
        cyclesPerYear:
          basis.reduce((a, y) => a + y.cyclesPerYear, 0) /
          Math.max(1, basis.length),
      };
    }
    const kleiner: BatterySpec = { ...spec, capacityKwh: spec.capacityKwh * f };
    const uitkomsten = basis.map((y) => {
      const entry = input.windows.find((w) => w.year === y.year)!;
      return analyseWindow(entry, kleiner, input.tariff);
    });
    return {
      capacityFraction: f,
      savingEur:
        uitkomsten.reduce((a, u) => a + u.realisticSavingEur, 0) /
        Math.max(1, uitkomsten.length),
      cyclesPerYear:
        uitkomsten.reduce((a, u) => a + u.cyclesPerYear, 0) /
        Math.max(1, uitkomsten.length),
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

  return {
    perYear,
    averageSavingEur: gemiddeld,
    minSavingEur: Math.min(...besparingen),
    maxSavingEur: Math.max(...besparingen),
    finance,
    curve,
  };
}

export { usableCapacityKwh };
