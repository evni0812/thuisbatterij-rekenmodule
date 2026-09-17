/**
 * De afleiding op het raster: van jaarbesparing per maat naar netto resultaat,
 * uitbreidingsstappen en advies. Alles hier is rekenwerk zonder simulatie, dus
 * de tests werken met een kunstmatig raster.
 */
import { describe, expect, it } from "vitest";
import { standaardConfiguratie } from "../lib/configuratie";
import {
  advies,
  celCurve,
  celFinance,
  dichtsteKolom,
  rasterFinance,
  uitbreidingsstappen,
  type RasterMaten,
} from "../lib/model/dimensionering";
import { computeFinance, type SavingCurvePoint } from "../lib/model/finance";
import { kostenVan, ankerVan, kostenregelVan } from "../lib/model/kosten";
import { RASTER_VERMOGENS } from "../lib/model/raster";

const CURVE: SavingCurvePoint[] = [
  { capacityFraction: 0.7, savingEur: 80, cyclesPerYear: 300 },
  { capacityFraction: 0.85, savingEur: 92, cyclesPerYear: 280 },
  { capacityFraction: 1, savingEur: 100, cyclesPerYear: 260 },
];

describe("de curve van een cel", () => {
  it("neemt de vorm over en schaalt op het niveau van de cel", () => {
    const c = celCurve(CURVE, 50, 130);
    expect(c.map((p) => p.capacityFraction)).toEqual([0.7, 0.85, 1]);
    expect(c.map((p) => p.savingEur)).toEqual([40, 46, 50]);
    expect(c.map((p) => p.cyclesPerYear)).toEqual([150, 140, 130]);
  });

  it("valt terug op evenredig als de gekozen batterij niets bespaarde", () => {
    const plat = CURVE.map((p) => ({ ...p, savingEur: 0 }));
    expect(celCurve(plat, 50, 130).map((p) => p.savingEur)).toEqual([35, 42.5, 50]);
  });
});

describe("de financiën van een cel", () => {
  const cfg = standaardConfiguratie();

  it("zijn voor de eigen batterij exact de financiën van het hoofdantwoord", () => {
    const eigen = celFinance(
      { savingEur: 100, cyclesPerYear: 260 },
      cfg.battery.capacityKwh,
      cfg.battery.maxDischargeKw,
      cfg,
      CURVE,
    );
    const referentie = computeFinance({
      curve: CURVE,
      investmentEur: cfg.investmentEur,
      years: cfg.analysisYears,
      priceEscalation: cfg.priceEscalation,
      discountRate: cfg.discountRate,
      calendarFadePerYear: cfg.calendarFadePerYear,
      cycleLife: cfg.cycleLife,
      residualValueEur: cfg.residualValueEur,
    });
    expect(eigen.investeringEur).toBe(cfg.investmentEur);
    expect(eigen.npvEur).toBe(referentie.npvEur);
    expect(eigen.paybackYears).toBe(referentie.paybackYears);
    expect(eigen.irr).toBe(referentie.irr);
  });

  it("prijst een andere maat met de kostenregel", () => {
    const cel = celFinance({ savingEur: 200, cyclesPerYear: 200 }, 5, 2.5, cfg, CURVE);
    expect(cel.investeringEur).toBe(kostenVan(ankerVan(cfg), kostenregelVan(cfg), 5, 2.5));
    expect(cel.besparingEur).toBe(200);
  });

  it("reageert op de looptijd zonder dat het raster verandert", () => {
    const punt = { savingEur: 100, cyclesPerYear: 260 };
    const kort = celFinance(punt, 5, 0.8, { ...cfg, analysisYears: 5 }, CURVE);
    const lang = celFinance(punt, 5, 0.8, { ...cfg, analysisYears: 20 }, CURVE);
    expect(lang.npvEur).toBeGreaterThan(kort.npvEur);
  });
});

/** Eén kolom van 0,8 kW en één van 2,5 kW; de besparing vlakt af boven 3 kWh. */
function raster(vast: number[]): RasterMaten {
  const stekker = [40, 100, 150, 155];
  return {
    capacities: [1, 2, 3, 5],
    powers: [0.8, 2.5],
    rows: stekker.map((s, i) => [
      { capacityKwh: [1, 2, 3, 5][i]!, powerKw: 0.8, savingEur: s, cyclesPerYear: 200 },
      { capacityKwh: [1, 2, 3, 5][i]!, powerKw: 2.5, savingEur: vast[i]!, cyclesPerYear: 200 },
    ]),
  };
}

describe("uitbreidingsstappen en advies", () => {
  const cfg = standaardConfiguratie();

  it("markeert de eerste stap waarbij extra capaciteit netto geld kost", () => {
    const { stappen, omslag } = uitbreidingsstappen(raster([30, 90, 140, 145]), 0, cfg, CURVE);
    expect(stappen.map((s) => s.capacityKwh)).toEqual([1, 2, 3, 5]);
    expect(stappen[0]!.marginaalPerKwh).toBeNull();
    // Van 1 naar 2 kWh: 60 euro per jaar erbij voor 320 euro. Dat loont.
    expect(stappen[1]!.marginaalPerKwh).toBeGreaterThan(0);
    // Van 3 naar 5 kWh: 5 euro per jaar erbij voor 640 euro. Dat niet.
    expect(stappen[3]!.marginaalPerKwh).toBeLessThan(0);
    expect(omslag).toBe(3);
  });

  it("geeft geen omslag als elke stap loont", () => {
    const { omslag } = uitbreidingsstappen(
      { capacities: [1, 2], powers: [0.8], rows: [[{ capacityKwh: 1, powerKw: 0.8, savingEur: 40, cyclesPerYear: 200 }], [{ capacityKwh: 2, powerKw: 0.8, savingEur: 200, cyclesPerYear: 200 }]] },
      0,
      cfg,
      CURVE,
    );
    expect(omslag).toBeNull();
  });

  it("kiest de stekkerbatterij als de vaste aansluiting de installateur niet terugverdient", () => {
    // De vaste kolom bespaart nauwelijks meer dan de stekkerkolom.
    const a = advies(raster([41, 101, 151, 156]), cfg, CURVE)!;
    expect(a.beste.powerKw).toBe(0.8);
    expect(a.besteStekker!.capacityKwh).toBe(3);
    expect(a.besteVast!.powerKw).toBe(2.5);
    expect(a.vasteLoont).toBe(false);
  });

  it("kiest de vaste aansluiting als die genoeg extra oplevert", () => {
    const a = advies(raster([120, 260, 400, 420]), cfg, CURVE)!;
    expect(a.beste.powerKw).toBe(2.5);
    expect(a.vasteLoont).toBe(true);
  });

  it("wacht met een advies tot het raster vol is", () => {
    const r = raster([30, 90, 140, 145]);
    r.rows[2] = null;
    expect(advies(r, cfg, CURVE)).toBeNull();
    expect(rasterFinance(r, cfg, CURVE)[2]).toBeNull();
    expect(rasterFinance(r, cfg, CURVE)[0]).toHaveLength(2);
  });

  it("vindt de kolom die het dichtst bij het eigen vermogen ligt", () => {
    expect(dichtsteKolom(RASTER_VERMOGENS, 2.4)).toBe(3);
    expect(dichtsteKolom(RASTER_VERMOGENS, 3.5)).toBe(4);
    expect(dichtsteKolom(RASTER_VERMOGENS, 0.8)).toBe(1);
  });
});
