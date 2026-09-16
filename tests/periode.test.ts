/**
 * Het optellen per uur, dag en week.
 *
 * Wandkloktijd is de valkuil: een week heeft 168 uren behalve als de klok
 * verspringt, een dag loopt van middernacht tot middernacht in Amsterdam, en
 * een week begint op maandag. En hoe je ook optelt, de som blijft de som.
 */
import { describe, expect, it } from "vitest";
import { buildQuarterAxis } from "../lib/data/timeaxis";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { dagenLater, maandagVan, periodeReeks, voegReeksenSamen } from "../lib/model/periode";
import { buildPriceSeries } from "../lib/model/tariff";
import type { BatterySpec, TariffSpec, Window } from "../lib/model/types";

const TARIFF: TariffSpec = { purchaseSurchargeEurPerKwh: 0.02, energyTaxEurPerKwh: 0.11, feedInCostEurPerKwh: 0, allowCurtailment: true };
const SPEC: BatterySpec = { capacityKwh: 5, depthOfCharge: 0.95, maxChargeKw: 2.5, maxDischargeKw: 2.5, efficiency: Math.sqrt(0.9), wearCostEurPerKwh: 0 };

function venster(van: string, totExclusief: string): Window {
  const startMs = buildQuarterAxis(van, totExclusief);
  const n = startMs.length;
  const residual = new Float64Array(n);
  const market = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const uur = (i % 96) / 4;
    const zon = Math.max(0, Math.sin(((uur - 6) / 12) * Math.PI)) * 1.2;
    residual[i] = 0.12 + 0.3 * Math.exp(-((uur - 19) ** 2) / 4) - zon;
    market[i] = 0.08 - 0.05 * zon + 0.08 * Math.exp(-((uur - 19) ** 2) / 5);
  }
  return { startMs, residualKwh: residual, prices: buildPriceSeries(market, TARIFF) };
}

describe("kalender", () => {
  it("vindt de maandag van een week", () => {
    expect(maandagVan("2025-12-18")).toBe("2025-12-15"); // donderdag
    expect(maandagVan("2025-12-15")).toBe("2025-12-15");
    expect(maandagVan("2025-12-21")).toBe("2025-12-15"); // zondag
    expect(maandagVan("2026-01-01")).toBe("2025-12-29");
    expect(dagenLater("2025-12-31", 1)).toBe("2026-01-01");
  });
});

describe("optellen", () => {
  const w = venster("2025-10-20", "2025-11-03"); // twee weken, met de klokwissel op 26 oktober
  const base = dispatchBaseline(w, TARIFF);
  const real = dispatchRolling(w, SPEC, TARIFF);
  const WEAR = 0.05;

  it("geeft per uur 168 vakken in een gewone week, en 169 in de week met de extra klokuur", () => {
    const gewoon = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-27", "2025-11-02", "uur");
    expect(gewoon.vakken.length).toBe(168);
    expect(gewoon.vakken.every((v) => v.kwartieren === 4)).toBe(true);

    const wissel = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-20", "2025-10-26", "uur");
    // Op 26 oktober komt lokaal uur 2 twee keer voor: één vak van acht kwartieren.
    expect(wissel.vakken.length).toBe(168);
    const twee = wissel.vakken.find((v) => v.sleutel === "2025-10-26T02")!;
    expect(twee.kwartieren).toBe(8);
    expect(wissel.vakken.reduce((a, v) => a + v.kwartieren, 0)).toBe(96 * 6 + 100);
  });

  it("geeft per dag zeven vakken en per week twee, en de sommen kloppen", () => {
    const dagen = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-20", "2025-10-26", "dag");
    expect(dagen.vakken.map((v) => v.dag)).toEqual(["2025-10-20", "2025-10-21", "2025-10-22", "2025-10-23", "2025-10-24", "2025-10-25", "2025-10-26"]);
    const weken = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-20", "2025-11-02", "week");
    expect(weken.vakken.map((v) => v.dag)).toEqual(["2025-10-20", "2025-10-27"]);
    expect(weken.tot).toBe("2025-11-02");

    const uren = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-20", "2025-11-02", "uur");
    expect(weken.totaal.savingEur).toBeCloseTo(uren.totaal.savingEur, 9);
    expect(weken.totaal.savingEur).toBeCloseTo(base.totalCostEur - real.totalCostEur, 6);
    // Slijtage is geleverd maal de prijs, in elk vak en in het totaal.
    for (const v of weken.vakken) expect(v.wearCostEur).toBeCloseTo(v.deliveredKwh * WEAR, 9);
    expect(weken.totaal.wearCostEur).toBeCloseTo(weken.totaal.deliveredKwh * WEAR, 9);
  });

  it("voegt een week over een venstergrens uit twee delen samen", () => {
    const a = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-27", "2025-10-29", "week");
    const b = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-30", "2025-11-02", "week");
    const heel = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-27", "2025-11-02", "week");
    const samen = voegReeksenSamen([a, b], "week", "2025-10-27", "2025-11-02");
    expect(samen.vakken.length).toBe(1);
    expect(samen.vakken[0]!.savingEur).toBeCloseTo(heel.vakken[0]!.savingEur, 9);
    expect(samen.vakken[0]!.kwartieren).toBe(heel.vakken[0]!.kwartieren);
    expect(samen.vakken[0]!.avgImportPrice).toBeCloseTo(heel.vakken[0]!.avgImportPrice, 9);
  });

  it("slaat dagen buiten het venster over", () => {
    const r = periodeReeks(w, base, real, SPEC, WEAR, "2025-10-01", "2025-10-21", "dag");
    expect(r.vakken.map((v) => v.dag)).toEqual(["2025-10-20", "2025-10-21"]);
    expect(r.van).toBe("2025-10-20");
  });
});
