/**
 * De tariefwissel van 2029 in de terugverdientijd.
 *
 * Het nettarief gaat pas in 2029 in. Een doorrekening die dat tarief over de
 * hele levensduur legt, is voor wie vandaag koopt te optimistisch; een die het
 * helemaal negeert, te pessimistisch. Deze tests bewaken dat de uitkomst
 * daadwerkelijk tussen die twee in ligt, en dat hij naar de juiste kant
 * beweegt naarmate 2029 dichterbij komt.
 */
import { describe, expect, it } from "vitest";
import { computeFinance, type SavingCurvePoint } from "../lib/model/finance";
import { overgangsFinance } from "../lib/overgang";
import { NETTARIEF_JAAR } from "../lib/nettarief";
import type { AnalysisResult } from "../lib/model/analysis";
import type { Configuration } from "../lib/worker/protocol";

const curve = (bedrag: number): SavingCurvePoint[] => [
  { capacityFraction: 0.7, savingEur: bedrag * 0.75, cyclesPerYear: 200 },
  { capacityFraction: 1, savingEur: bedrag, cyclesPerYear: 250 },
];

/** Alleen de velden die de financiering gebruikt; de rest doet hier niet mee. */
const config = {
  investmentEur: 699,
  analysisYears: 15,
  priceEscalation: 0,
  discountRate: 0.03,
  calendarFadePerYear: 0.015,
  cycleLife: 6000,
  residualValueEur: 0,
} as unknown as Configuration;

const resultaat = (bedrag: number) =>
  ({ curve: curve(bedrag) }) as unknown as AnalysisResult;

const HUIDIG = 110;
const SCENARIO = 165;

function losseTerugverdientijd(bedrag: number): number {
  const f = computeFinance({
    curve: curve(bedrag),
    investmentEur: config.investmentEur,
    years: config.analysisYears,
    priceEscalation: config.priceEscalation,
    discountRate: config.discountRate,
    calendarFadePerYear: config.calendarFadePerYear,
    cycleLife: config.cycleLife,
    residualValueEur: config.residualValueEur,
  });
  expect(f.paybackYears).not.toBeNull();
  return f.paybackYears!;
}

describe("de tariefwissel van 2029", () => {
  it("ligt tussen de twee losse doorrekeningen in", () => {
    const traag = losseTerugverdientijd(HUIDIG);
    const snel = losseTerugverdientijd(SCENARIO);
    const o = overgangsFinance(
      resultaat(HUIDIG),
      resultaat(SCENARIO),
      config,
      new Date("2026-09-17T12:00:00Z"),
    );
    expect(o.finance.paybackYears).not.toBeNull();
    expect(o.finance.paybackYears!).toBeGreaterThan(snel);
    expect(o.finance.paybackYears!).toBeLessThan(traag);
  });

  it("telt de jaren tot de ingangsdatum, niet tot een vast getal", () => {
    const in2026 = overgangsFinance(
      resultaat(HUIDIG),
      resultaat(SCENARIO),
      config,
      new Date("2026-06-01T00:00:00Z"),
    );
    const in2028 = overgangsFinance(
      resultaat(HUIDIG),
      resultaat(SCENARIO),
      config,
      new Date("2028-06-01T00:00:00Z"),
    );
    expect(in2026.jarenOpHuidigTarief).toBe(NETTARIEF_JAAR - 2026);
    expect(in2028.jarenOpHuidigTarief).toBe(NETTARIEF_JAAR - 2028);
    // Hoe dichter bij 2029, hoe eerder het hogere bedrag begint te tellen.
    expect(in2028.finance.paybackYears!).toBeLessThan(in2026.finance.paybackYears!);
  });

  it("valt samen met het scenario zodra de ingangsdatum voorbij is", () => {
    const o = overgangsFinance(
      resultaat(HUIDIG),
      resultaat(SCENARIO),
      config,
      new Date("2031-01-01T00:00:00Z"),
    );
    expect(o.jarenOpHuidigTarief).toBe(0);
    expect(o.finance.paybackYears).toBeCloseTo(losseTerugverdientijd(SCENARIO), 6);
  });

  it("laat de batterij over de tariefgrens heen gewoon doorslijten", () => {
    /**
     * De wissel gaat over de prijzen, niet over het apparaat. Zou de degradatie
     * bij de overgang opnieuw beginnen, dan zou de resterende capaciteit in het
     * eerste scenariojaar hoger liggen dan in het jaar ervoor.
     */
    const o = overgangsFinance(
      resultaat(HUIDIG),
      resultaat(SCENARIO),
      config,
      new Date("2026-09-17T12:00:00Z"),
    );
    const fracties = o.finance.cashflows.map((c) => c.capacityFraction);
    for (let i = 1; i < fracties.length; i++) {
      expect(fracties[i]!).toBeLessThanOrEqual(fracties[i - 1]!);
    }
  });
});
