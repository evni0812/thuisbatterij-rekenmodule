/**
 * De CO2-balans: het huishouden en Nederland.
 *
 * De rekenregels zijn klein en exact te controleren op een kunstmatig venster;
 * daarnaast één doorrekening op de echte data, zodat de orde van grootte en
 * de koppeling met de assets (co2-<jaar>.bin) bewaakt zijn.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { Invoerbron } from "../lib/data/invoer";
import type { Ophaler } from "../lib/data/loader";
import { runAnalysis } from "../lib/model/analysis";
import {
  CO2_KLASSE_G,
  STANDAARD_CO2_DREMPEL_G,
  co2Jaar,
  gemiddeldCo2,
  huishoudPerspectief,
  klasseVan,
  nederlandPerspectief,
  normaliseerCo2Drempel,
} from "../lib/model/co2";
import type { DispatchResult, Window } from "../lib/model/types";

const haal: Ophaler = async (url) => {
  const buf = readFileSync(`public${url}`);
  return new Response(new Uint8Array(buf));
};

/** Vier kwartieren van één uur, op 15 juni 2025 om 12:00 lokale tijd. */
function venster(ef: number[], residual: number[]): Window {
  const start = Date.UTC(2025, 5, 15, 10, 0); // 12:00 CEST
  return {
    startMs: new Float64Array(ef.map((_, i) => start + i * 900_000)),
    residualKwh: new Float64Array(residual),
    prices: { importPrice: new Float64Array(ef.length), exportPrice: new Float64Array(ef.length) },
    co2GPerKwh: new Float64Array(ef),
  };
}

function dispatch(imp: number[], exp: number[]): DispatchResult {
  const n = imp.length;
  return {
    gridImportKwh: new Float64Array(imp),
    gridExportKwh: new Float64Array(exp),
    chargeKwh: new Float64Array(n),
    dischargeKwh: new Float64Array(n),
    socKwh: new Float64Array(n),
    curtailedKwh: new Float64Array(n),
    totalCostEur: 0,
    equivalentCycles: 0,
  } as unknown as DispatchResult;
}

describe("de balans van één venster", () => {
  // Zonder batterij: 1 kWh afname op 400 g, 2 kWh teruglevering op 50 g.
  // Met batterij: de teruglevering is opgeslagen en de afname vervangen.
  const w = venster([400, 50, 50, 300], [1, -1, -1, 0.5]);
  const basis = dispatch([1, 0, 0, 0.5], [0, 1, 1, 0]);
  const bat = dispatch([0, 0, 0, 0.5], [0, 0, 0, 0]);
  const c = co2Jaar(w, basis, bat);

  it("rekent de uitstoot van de afname per kwartier met de factor van dat kwartier", () => {
    expect(c.importBasisKg).toBeCloseTo(1 * 0.4 + 0.5 * 0.3, 9);
    expect(c.importBatKg).toBeCloseTo(0.5 * 0.3, 9);
    const h = huishoudPerspectief(c);
    expect(h.winstKg).toBeCloseTo(0.4, 9);
    expect(h.factorZonderG).toBeCloseTo(((0.4 + 0.15) * 1000) / 1.5, 6);
  });

  it("bewaart afname en teruglevering per klasse emissiefactor", () => {
    expect(klasseVan(50)).toBe(2);
    expect(klasseVan(400)).toBe(20);
    expect(klasseVan(9999)).toBe(30);
    expect(c.klassen.exportBasisKwh[2]).toBeCloseTo(2, 9);
    expect(c.klassen.exportBasisKg[2]).toBeCloseTo(2 * 0.05, 9);
    expect(c.klassen.importBasisKwh[20]).toBeCloseTo(1, 9);
    expect(c.klassen.kwartieren.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("telt teruglevering voor Nederland alleen mee boven de drempel", () => {
    // Drempel 100: de teruglevering op 50 g was overschot en vermeed niets.
    const laag = nederlandPerspectief(c, 100);
    expect(laag.vermedenZonderKg).toBeCloseTo(0, 9);
    expect(laag.overschotZonderKwh).toBeCloseTo(2, 9);
    expect(laag.winstKg).toBeCloseTo(0.4, 9);
    // Drempel 40: dezelfde teruglevering verdrong elders wél opwek (2 × 50 g),
    // en die winst gaat verloren zodra de batterij hem opslaat.
    const geen = nederlandPerspectief(c, 40);
    expect(geen.vermedenZonderKg).toBeCloseTo(0.1, 9);
    expect(geen.winstKg).toBeCloseTo(0.4 - 0.1, 9);
    expect(geen.aandeelOverschotUren).toBeCloseTo(0, 9);
    expect(laag.aandeelOverschotUren).toBeCloseTo(0.5, 9);
  });

  it("slaat kwartieren zonder factor over en telt ze", () => {
    const w2 = venster([400, NaN], [1, 1]);
    const c2 = co2Jaar(w2, dispatch([1, 1], [0, 0]), dispatch([1, 1], [0, 0]));
    expect(c2.ontbrekendeKwartieren).toBe(1);
    expect(c2.importBasisKg).toBeCloseTo(0.4, 9);
    expect(c2.gemiddeldeFactorG).toBe(400);
  });

  it("middelt over jaren per veld", () => {
    const g = gemiddeldCo2([c, c])!;
    expect(g.importBasisKg).toBeCloseTo(c.importBasisKg, 9);
    expect(g.klassen.exportBasisKwh[2]).toBeCloseTo(2, 9);
    expect(g.perMaand).toEqual(c.perMaand);
    expect(gemiddeldCo2([])).toBeNull();
    expect(CO2_KLASSE_G).toBe(20);
  });
});

describe("de drempel", () => {
  it("is een veelvoud van de klassebreedte tussen 0 en 400", () => {
    expect(normaliseerCo2Drempel(100)).toBe(100);
    expect(normaliseerCo2Drempel(110)).toBe(120);
    expect(normaliseerCo2Drempel(101)).toBe(120);
    expect(normaliseerCo2Drempel(80.5)).toBe(100);
    expect(normaliseerCo2Drempel(-30)).toBe(0);
    expect(normaliseerCo2Drempel(1000)).toBe(400);
    expect(normaliseerCo2Drempel(Number.NaN)).toBe(STANDAARD_CO2_DREMPEL_G);
    for (let g = 0; g <= 400; g += 7) expect(normaliseerCo2Drempel(g) % CO2_KLASSE_G).toBe(0);
  });

  it("geeft na normaliseren hetzelfde perspectief als de ruwe drempel", () => {
    // Het perspectief rondt binnen een klasse toch al af; de normalisatie maakt
    // alleen zichtbaar wat er gerekend wordt.
    const w = venster([90, 110, 130, 250], [-1, -1, -1, -1]);
    const c = co2Jaar(w, dispatch([0, 0, 0, 0], [1, 1, 1, 1]), dispatch([0, 0, 0, 0], [0.5, 0.5, 0.5, 0.5]));
    for (const g of [0, 5, 95, 100, 101, 119, 120, 133, 260, 399, 400]) {
      expect(nederlandPerspectief(c, normaliseerCo2Drempel(g)).vermedenZonderKg).toBe(
        nederlandPerspectief(c, g).vermedenZonderKg,
      );
    }
  });
});

describe("op de echte data", () => {
  it("levert een plausibele CO2-winst voor het standaardhuishouden in 2025", async () => {
    const bron = new Invoerbron("/data", haal);
    await bron.init();
    const cfg = maakConfiguratie({ ...STANDAARD, van: "2025-01-01", tot: "2025-12-31" });
    const r = runAnalysis(await bron.bouwInvoer(cfg));
    const c = r.co2!;
    expect(c).not.toBeNull();
    const h = huishoudPerspectief(c);
    const nl = nederlandPerspectief(c, 100);
    console.log("co2 2025", {
      zonderKg: h.zonderKg.toFixed(0), metKg: h.metKg.toFixed(0), winstKg: h.winstKg.toFixed(1),
      factorZonder: h.factorZonderG.toFixed(0), factorMet: h.factorMetG.toFixed(0),
      gemFactor: c.gemiddeldeFactorG.toFixed(0),
      nlZonder: nl.zonderKg.toFixed(0), nlMet: nl.metKg.toFixed(0), nlWinst: nl.winstKg.toFixed(1),
      overschotZonderKwh: nl.overschotZonderKwh.toFixed(0), overschotMetKwh: nl.overschotMetKwh.toFixed(0),
      aandeelOverschotUren: nl.aandeelOverschotUren.toFixed(2), ontbrekend: c.ontbrekendeKwartieren,
    });
    // De afname van 2.500 kWh weegt ergens tussen 150 en 350 g/kWh.
    expect(h.zonderKg).toBeGreaterThan(2500 * 0.15);
    expect(h.zonderKg).toBeLessThan(2500 * 0.35);
    // De batterij verschuift naar schonere uren en vervangt afname door eigen zon.
    expect(h.winstKg).toBeGreaterThan(0);
    expect(h.factorMetG).toBeLessThan(h.factorZonderG);
    expect(c.ontbrekendeKwartieren).toBe(0);
    // Middaguren in de zomer zijn schoner dan avonduren.
    expect(c.factorPerUur.zomer[13]!).toBeLessThan(c.factorPerUur.zomer[19]!);
    expect(c.perMaand).toHaveLength(12);
  }, 60_000);
});
