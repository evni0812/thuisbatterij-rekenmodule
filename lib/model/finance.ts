/**
 * Van jaarbesparing naar investeringsbeslissing.
 *
 * De doorrekening over de levensduur gebruikt de gemeten jaarbesparing als
 * basis en corrigeert die voor degradatie: een batterij die na tien jaar nog
 * 80% van zijn capaciteit heeft, levert ook minder op.
 *
 * ── Waarom niet elk jaar opnieuw simuleren ──────────────────────────────────
 * Het oude Streamlit-model draaide een volledige jaarsimulatie per analysejaar,
 * en deed dat opnieuw voor NPV, voor de terugverdientijd, voor de IRR en voor
 * elke gevoeligheidsparameter: ruim 240 jaarsimulaties per pageload, goed voor
 * dertien seconden wachten.
 *
 * De besparing is echter een gladde, concave functie van de bruikbare
 * capaciteit. Een handvol steunpunten en lineaire interpolatie daartussen geeft
 * dus vrijwel dezelfde uitkomst tegen een fractie van de rekentijd.
 */

import { remainingCapacityFraction } from "./battery";

/** Besparing bij een gegeven fractie van de nominale capaciteit. */
export interface SavingCurvePoint {
  /** Fractie van de nominale capaciteit, 0–1. */
  capacityFraction: number;
  /** Jaarbesparing in EUR bij die capaciteit. */
  savingEur: number;
  /** Equivalente volledige cycli per jaar bij die capaciteit. */
  cyclesPerYear: number;
}

export interface FinanceInput {
  /** Steunpunten van de besparingscurve, oplopend in capacityFraction. */
  curve: SavingCurvePoint[];
  investmentEur: number;
  /** Aantal jaren dat de analyse beslaat. */
  years: number;
  /** Jaarlijkse stijging van de energieprijzen, bv. 0,02 voor 2%. */
  priceEscalation: number;
  /** Discontovoet voor de contante waarde, bv. 0,03. */
  discountRate: number;
  /** Kalenderveroudering per jaar, bv. 0,015. */
  calendarFadePerYear: number;
  /** Cycli tot het einde van de levensduur. */
  cycleLife: number;
  /** Restwaarde aan het einde van de analyseperiode, EUR. */
  residualValueEur: number;
}

export interface YearCashflow {
  year: number;
  /** Resterende bruikbare capaciteit als fractie van nominaal. */
  capacityFraction: number;
  savingNominalEur: number;
  savingDiscountedEur: number;
  cumulativeNominalEur: number;
  cyclesThisYear: number;
  cumulativeCycles: number;
}

export interface FinanceResult {
  cashflows: YearCashflow[];
  npvEur: number;
  /** Terugverdientijd in jaren op nominale basis, of null als die er niet is. */
  paybackYears: number | null;
  /** Intern rendement, of null als er geen tekenwisseling is. */
  irr: number | null;
  /** Jaar waarin de cycluslevensduur op raakt, of null binnen de horizon. */
  endOfLifeYear: number | null;
  totalCycles: number;
}

/**
 * Lees de besparing af bij een willekeurige capaciteitsfractie.
 *
 * Lineair tussen de steunpunten; buiten het bereik wordt niet geëxtrapoleerd
 * maar afgekapt, want de curve is alleen gemeten binnen dat bereik.
 */
export function interpolateCurve(
  curve: SavingCurvePoint[],
  fraction: number,
): { savingEur: number; cyclesPerYear: number } {
  if (curve.length === 0) return { savingEur: 0, cyclesPerYear: 0 };
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (fraction <= first.capacityFraction) {
    return { savingEur: first.savingEur, cyclesPerYear: first.cyclesPerYear };
  }
  if (fraction >= last.capacityFraction) {
    return { savingEur: last.savingEur, cyclesPerYear: last.cyclesPerYear };
  }
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (fraction <= b.capacityFraction) {
      const span = b.capacityFraction - a.capacityFraction;
      const t = span > 0 ? (fraction - a.capacityFraction) / span : 0;
      return {
        savingEur: a.savingEur + (b.savingEur - a.savingEur) * t,
        cyclesPerYear: a.cyclesPerYear + (b.cyclesPerYear - a.cyclesPerYear) * t,
      };
    }
  }
  return { savingEur: last.savingEur, cyclesPerYear: last.cyclesPerYear };
}

export function computeFinance(input: FinanceInput): FinanceResult {
  const cashflows: YearCashflow[] = [];
  let cumulative = -input.investmentEur;
  let cumulativeCycles = 0;
  let npv = -input.investmentEur;
  let endOfLifeYear: number | null = null;

  for (let y = 0; y < input.years; y++) {
    const fraction = remainingCapacityFraction(
      y,
      cumulativeCycles,
      input.calendarFadePerYear,
      input.cycleLife,
    );
    const { savingEur, cyclesPerYear } = interpolateCurve(input.curve, fraction);

    // Alle energieprijzen stijgen mee, dus de besparing schaalt evenredig. Het
    // oude model liet opslag en terugleverkosten nominaal staan en escaleerde
    // alleen EPEX en energiebelasting — inconsistent.
    const escalated = savingEur * Math.pow(1 + input.priceEscalation, y);
    const discounted = escalated / Math.pow(1 + input.discountRate, y + 1);

    cumulativeCycles += cyclesPerYear;
    cumulative += escalated;
    npv += discounted;

    if (endOfLifeYear === null && cumulativeCycles >= input.cycleLife) {
      endOfLifeYear = y + 1;
    }

    cashflows.push({
      year: y + 1,
      capacityFraction: fraction,
      savingNominalEur: escalated,
      savingDiscountedEur: discounted,
      cumulativeNominalEur: cumulative,
      cyclesThisYear: cyclesPerYear,
      cumulativeCycles,
    });
  }

  // Restwaarde valt aan het einde van de horizon.
  if (input.residualValueEur !== 0 && input.years > 0) {
    npv += input.residualValueEur / Math.pow(1 + input.discountRate, input.years);
    cumulative += input.residualValueEur;
    const laatste = cashflows[cashflows.length - 1]!;
    laatste.cumulativeNominalEur = cumulative;
  }

  return {
    cashflows,
    npvEur: npv,
    paybackYears: findPayback(cashflows, input.investmentEur),
    irr: findIrr(cashflows, input.investmentEur, input.residualValueEur),
    endOfLifeYear,
    totalCycles: cumulativeCycles,
  };
}

/**
 * Terugverdientijd op nominale basis, lineair geïnterpoleerd binnen het jaar
 * waarin het break-evenpunt valt.
 */
function findPayback(
  cashflows: YearCashflow[],
  investment: number,
): number | null {
  let cumulative = -investment;
  for (const cf of cashflows) {
    const vorige = cumulative;
    cumulative = cf.cumulativeNominalEur;
    if (cumulative >= 0) {
      if (vorige >= 0) return cf.year - 1;
      const span = cumulative - vorige;
      const deel = span !== 0 ? -vorige / span : 0;
      return cf.year - 1 + deel;
    }
  }
  return null;
}

/** Intern rendement via bisectie. Null als er geen tekenwisseling is. */
function findIrr(
  cashflows: YearCashflow[],
  investment: number,
  residualValue: number,
): number | null {
  const flows = [-investment, ...cashflows.map((c) => c.savingNominalEur)];
  if (residualValue !== 0 && flows.length > 1) {
    flows[flows.length - 1] = flows[flows.length - 1]! + residualValue;
  }

  const npvAt = (r: number): number =>
    flows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + r, t), 0);

  let lo = -0.9;
  let hi = 2;
  if (npvAt(lo) * npvAt(hi) > 0) return null;

  for (let i = 0; i < 200 && hi - lo > 1e-7; i++) {
    const mid = (lo + hi) / 2;
    if (npvAt(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
