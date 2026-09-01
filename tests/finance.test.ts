import { describe, expect, it } from "vitest";
import { computeFinance, interpolateCurve, type SavingCurvePoint } from "../lib/model/finance";

const CURVE: SavingCurvePoint[] = [
  { capacityFraction: 0.7, savingEur: 70, cyclesPerYear: 140 },
  { capacityFraction: 0.85, savingEur: 85, cyclesPerYear: 160 },
  { capacityFraction: 1, savingEur: 100, cyclesPerYear: 180 },
];

function input(over: Partial<Parameters<typeof computeFinance>[0]> = {}) {
  return {
    curve: CURVE,
    investmentEur: 1000,
    years: 15,
    priceEscalation: 0,
    discountRate: 0,
    calendarFadePerYear: 0,
    cycleLife: 100000,
    residualValueEur: 0,
    ...over,
  };
}

describe("interpolateCurve", () => {
  it("leest de steunpunten exact af", () => {
    expect(interpolateCurve(CURVE, 1).savingEur).toBe(100);
    expect(interpolateCurve(CURVE, 0.7).savingEur).toBe(70);
  });

  it("interpoleert lineair daartussen", () => {
    expect(interpolateCurve(CURVE, 0.925).savingEur).toBeCloseTo(92.5, 6);
  });

  it("kapt af buiten het gemeten bereik in plaats van te extrapoleren", () => {
    expect(interpolateCurve(CURVE, 0.1).savingEur).toBe(70);
    expect(interpolateCurve(CURVE, 5).savingEur).toBe(100);
  });
});

describe("computeFinance", () => {
  it("verdient een investering terug op het verwachte moment", () => {
    // Zonder enige degradatie, rente of prijsstijging: 100 per jaar maakt een
    // investering van 1000 na precies 10 jaar goed. cycleLife oneindig zet ook
    // de doorzetveroudering uit, zodat dit geval echt schoon is.
    const r = computeFinance(input({ cycleLife: Infinity }));
    expect(r.paybackYears).toBeCloseTo(10, 6);
    expect(r.npvEur).toBeCloseTo(15 * 100 - 1000, 6);
  });

  it("verdient later terug zodra de batterij slijt", () => {
    // Met doorzetveroudering daalt de capaciteit, dus ook de jaarbesparing, en
    // schuift het break-evenpunt naar achteren.
    const schoon = computeFinance(input({ cycleLife: Infinity }));
    const slijtend = computeFinance(input({ cycleLife: 6000 }));
    expect(slijtend.paybackYears!).toBeGreaterThan(schoon.paybackYears!);
  });

  it("geeft geen terugverdientijd als die er niet is", () => {
    const r = computeFinance(input({ investmentEur: 100000 }));
    expect(r.paybackYears).toBeNull();
    expect(r.npvEur).toBeLessThan(0);
  });

  it("verlaagt de besparing naarmate de batterij degradeert", () => {
    const zonder = computeFinance(input());
    const met = computeFinance(input({ calendarFadePerYear: 0.02 }));
    expect(met.npvEur).toBeLessThan(zonder.npvEur);
    const laatsteZonder = zonder.cashflows.at(-1)!;
    const laatsteMet = met.cashflows.at(-1)!;
    expect(laatsteMet.capacityFraction).toBeLessThan(laatsteZonder.capacityFraction);
    expect(laatsteMet.savingNominalEur).toBeLessThan(laatsteZonder.savingNominalEur);
  });

  it("signaleert het einde van de cycluslevensduur", () => {
    // 180 cycli per jaar op een levensduur van 900 zou vijf jaar zijn, maar de
    // capaciteit loopt onderweg terug en daarmee ook het aantal cycli per jaar.
    // Het omslagpunt valt daardoor in jaar 6 in plaats van 5.
    const r = computeFinance(input({ cycleLife: 900 }));
    expect(r.endOfLifeYear).toBe(6);
    expect(r.totalCycles).toBeGreaterThan(900);
  });

  it("verdisconteert latere jaren zwaarder", () => {
    const r = computeFinance(input({ discountRate: 0.05 }));
    const eerste = r.cashflows[0]!;
    const laatste = r.cashflows.at(-1)!;
    expect(eerste.savingDiscountedEur).toBeGreaterThan(laatste.savingDiscountedEur);
    expect(r.npvEur).toBeLessThan(computeFinance(input()).npvEur);
  });

  it("laat prijsstijging op alle componenten doorwerken", () => {
    // Het tweede jaar levert 3% meer op dan het eerste, op de degradatie na.
    const r = computeFinance(input({ priceEscalation: 0.03, cycleLife: Infinity }));
    expect(r.cashflows[1]!.savingNominalEur).toBeCloseTo(103, 6);
    // Het oude model escaleerde alleen EPEX en energiebelasting en liet opslag
    // en terugleverkosten nominaal staan; hier schaalt de hele besparing mee.
    expect(r.cashflows[14]!.savingNominalEur).toBeCloseTo(100 * 1.03 ** 14, 6);
  });

  it("vindt een intern rendement dat de contante waarde op nul zet", () => {
    const r = computeFinance(input());
    expect(r.irr).not.toBeNull();
    const flows = [-1000, ...r.cashflows.map((c) => c.savingNominalEur)];
    const npv = flows.reduce((s, cf, t) => s + cf / Math.pow(1 + r.irr!, t), 0);
    expect(Math.abs(npv)).toBeLessThan(0.01);
  });

  it("telt restwaarde mee in de contante waarde", () => {
    const zonder = computeFinance(input());
    const met = computeFinance(input({ residualValueEur: 200 }));
    expect(met.npvEur).toBeGreaterThan(zonder.npvEur);
  });
});
