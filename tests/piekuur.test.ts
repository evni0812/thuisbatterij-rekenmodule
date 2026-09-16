/**
 * De piekuurstatistiek: hoeveel er op de duurste netuurtjes van het net komt.
 *
 * De definitie is die van het nettariefprofiel — de uren waarop het profiel
 * van die maand op zijn maximum staat — en wordt in wandkloktijd gemeten. Een
 * dag met 100 kwartieren mag geen kwartier dubbel tellen en de zomermiddag
 * hoort er nooit bij.
 */
import { describe, expect, it } from "vitest";
import { buildQuarterAxis } from "../lib/data/timeaxis";
import { isPiekuur, piekurenVoorMaand } from "../lib/nettarief";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { maandTotalen, runAnalysis } from "../lib/model/analysis";
import { buildPriceSeries } from "../lib/model/tariff";
import type { BatterySpec, TariffSpec, Window } from "../lib/model/types";

const TARIFF: TariffSpec = {
  purchaseSurchargeEurPerKwh: 0.02,
  energyTaxEurPerKwh: 0.11,
  feedInCostEurPerKwh: 0,
  allowCurtailment: true,
};

const SPEC: BatterySpec = {
  capacityKwh: 5,
  depthOfCharge: 0.95,
  maxChargeKw: 2.5,
  maxDischargeKw: 2.5,
  efficiency: Math.sqrt(0.9),
  wearCostEurPerKwh: 0,
};

describe("de piekuren", () => {
  it("zijn in de winter 16 tot en met 22 uur en in de zomer 19 tot en met 23 uur", () => {
    for (const m of [1, 2, 3, 10, 11, 12]) {
      const p = piekurenVoorMaand(m);
      expect(p.length).toBe(24);
      for (let u = 0; u < 24; u++) expect(p[u], `maand ${m} uur ${u}`).toBe(u >= 16 && u <= 22);
    }
    for (const m of [4, 5, 6, 7, 8, 9]) {
      const p = piekurenVoorMaand(m);
      for (let u = 0; u < 24; u++) expect(p[u], `maand ${m} uur ${u}`).toBe(u >= 19 && u <= 23);
    }
    expect(isPiekuur(1, 16)).toBe(true);
    expect(isPiekuur(7, 16)).toBe(false);
  });
});

describe("de piekafname in de maandtotalen", () => {
  it("telt op de najaarsovergang precies zeven uur per dag, in wandkloktijd", () => {
    // 25 t/m 28 oktober: de 26e heeft 100 kwartieren; het extra uur valt om
    // 02:00 en dus buiten de piek. Constante afname van 1 kWh per kwartier.
    const startMs = buildQuarterAxis("2025-10-25", "2025-10-29");
    const n = startMs.length;
    const residual = new Float64Array(n).fill(1);
    const market = new Float64Array(n).fill(0.1);
    const window: Window = { startMs, residualKwh: residual, prices: buildPriceSeries(market, TARIFF) };
    const base = dispatchBaseline(window, TARIFF);

    const maanden = maandTotalen(window, base, base, SPEC);
    expect(maanden.length).toBe(1);
    const okt = maanden[0]!;
    expect(okt.month).toBe(10);
    // Vier dagen × 7 uur × 4 kwartieren × 1 kWh.
    expect(okt.peakHourImportBaselineKwh).toBeCloseTo(4 * 7 * 4, 9);
    expect(okt.peakHourImportBatteryKwh).toBeCloseTo(okt.peakHourImportBaselineKwh, 9);
    // Controle: de dag met 100 kwartieren zit er echt in.
    expect(n).toBe(96 * 3 + 100);
  });

  it("wordt door een batterij kleiner, nooit groter", () => {
    // Een week met zon overdag en een piek 's avonds, in juli.
    const startMs = buildQuarterAxis("2025-07-01", "2025-07-08");
    const n = startMs.length;
    const residual = new Float64Array(n);
    const market = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const uur = (i % 96) / 4;
      const zon = Math.max(0, Math.sin(((uur - 6) / 12) * Math.PI)) * 1.0;
      const last = 0.1 + 0.4 * Math.exp(-((uur - 20) ** 2) / 3);
      residual[i] = last - zon;
      market[i] = 0.08 - 0.05 * zon + 0.08 * Math.exp(-((uur - 20) ** 2) / 4);
    }
    const window: Window = { startMs, residualKwh: residual, prices: buildPriceSeries(market, TARIFF) };
    const base = dispatchBaseline(window, TARIFF);
    const bat = dispatchRolling(window, SPEC, TARIFF);
    const juli = maandTotalen(window, base, bat, SPEC)[0]!;
    expect(juli.peakHourImportBaselineKwh).toBeGreaterThan(0);
    expect(juli.peakHourImportBatteryKwh).toBeLessThan(juli.peakHourImportBaselineKwh);
    expect(juli.peakHourImportBatteryKwh).toBeGreaterThanOrEqual(0);
  });

  it("komt als kerncijfer en per jaar in de doorrekening terecht", () => {
    const startMs = buildQuarterAxis("2025-01-01", "2025-01-15");
    const n = startMs.length;
    const residual = new Float64Array(n);
    const market = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const uur = (i % 96) / 4;
      residual[i] = 0.1 + 0.3 * Math.exp(-((uur - 19) ** 2) / 4);
      market[i] = 0.06 + 0.1 * Math.exp(-((uur - 19) ** 2) / 4);
    }
    const window: Window = { startMs, residualKwh: residual, prices: buildPriceSeries(market, TARIFF) };
    const lite = runAnalysis({
      windows: [{ year: 2025, firstDay: "2025-01-01", lastDay: "2025-01-14", isFullYear: false, window }],
      battery: SPEC,
      tariff: TARIFF,
      investmentEur: 2000,
      cycleLife: 6000,
      calendarLifeYears: 15,
      years: 15,
      priceEscalation: 0.02,
      discountRate: 0.03,
      calendarFadePerYear: 0.015,
      residualValueEur: 0,
    });
    const jaar = lite.perYear[0]!;
    expect(jaar.peakHourImportKwh).toBeGreaterThan(0);
    expect(jaar.peakHourImportWithBatteryKwh).toBeLessThanOrEqual(jaar.peakHourImportKwh);
    expect(lite.stats.peakHourImportBaselineKwh).toBeCloseTo(jaar.peakHourImportKwh, 9);
    expect(lite.stats.peakHourImportBatteryKwh).toBeCloseTo(jaar.peakHourImportWithBatteryKwh, 9);
    // De maanden tellen op tot het jaar.
    const somMaanden = jaar.months.reduce((a, m) => a + m.peakHourImportBaselineKwh, 0);
    expect(somMaanden).toBeCloseTo(jaar.peakHourImportKwh, 9);
  });
});
