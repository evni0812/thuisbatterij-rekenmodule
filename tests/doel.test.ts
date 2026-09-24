/**
 * De drie doelen van de planner op echte data, één jaar.
 *
 * Rendement is de referentie (het solver-harnas bewaakt dat die niet
 * verschuift). Zelfconsumptie mag het net nooit rechtstreeks aanraken, en
 * uitstoot moet méér CO2 uitsparen dan rendement, tegen minder euro's.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { Invoerbron } from "../lib/data/invoer";
import type { Ophaler } from "../lib/data/loader";
import { runAnalysis, type AnalysisResult } from "../lib/model/analysis";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { DOELEN, stuurVenster } from "../lib/model/doel";
import { huishoudPerspectief } from "../lib/model/co2";
import type { Doel } from "../lib/model/types";

const haal: Ophaler = async (url) => new Response(new Uint8Array(readFileSync(`public${url}`)));

const uitkomsten = new Map<Doel, AnalysisResult>();
let bron: Invoerbron;

beforeAll(async () => {
  bron = new Invoerbron("/data", haal);
  await bron.init();
  for (const d of DOELEN) {
    const cfg = maakConfiguratie({ ...STANDAARD, doel: d.id, van: "2025-01-01", tot: "2025-12-31" });
    uitkomsten.set(d.id, runAnalysis(await bron.bouwInvoer(cfg)));
  }
}, 120_000);

describe("de configuratie", () => {
  it("laat het standaarddoel weg uit de configuratie, zodat de hash niet verandert", () => {
    expect(maakConfiguratie(STANDAARD).doel).toBeUndefined();
    expect(maakConfiguratie({ ...STANDAARD, doel: "uitstoot" }).doel).toBe("uitstoot");
  });

  it("geeft het doel door in het venster", async () => {
    const invoer = await bron.bouwInvoer(maakConfiguratie({ ...STANDAARD, doel: "zelfconsumptie", van: "2025-06-01", tot: "2025-06-07" }));
    expect(invoer.windows[0]!.window.doel).toBe("zelfconsumptie");
    const w = invoer.windows[0]!.window;
    expect(stuurVenster(w).alleenEigen).toBe(true);
    expect(stuurVenster({ ...w, doel: undefined }).venster.prices).toBe(w.prices);
    const u = stuurVenster({ ...w, doel: "uitstoot" });
    expect(u.alleenEigen).toBe(false);
    // 200 g/kWh wordt 0,20 "euro": één cent is tien gram.
    expect(u.venster.prices.importPrice[100]).toBeCloseTo(w.co2GPerKwh![100]! / 1000, 9);
    expect(u.venster.prices.exportPrice[100]).toBeLessThanOrEqual(0);
  });
});

describe("zelfconsumptie", () => {
  it("laadt nooit uit het net en levert nooit uit de batterij terug", async () => {
    const invoer = await bron.bouwInvoer(maakConfiguratie({ ...STANDAARD, doel: "zelfconsumptie", van: "2025-01-01", tot: "2025-12-31" }));
    const w = invoer.windows[0]!.window;
    const spec = { ...invoer.battery, wearCostEurPerKwh: 0.02 };
    const basis = dispatchBaseline(w, invoer.tariff);
    const res = dispatchRolling(w, spec, invoer.tariff);
    for (let i = 0; i < w.residualKwh.length; i++) {
      const r = w.residualKwh[i]!;
      // Laden hooguit het overschot, ontladen hooguit het tekort.
      expect(res.chargeKwh[i]!).toBeLessThanOrEqual(Math.max(0, -r) + 1e-9);
      expect(res.dischargeKwh[i]!).toBeLessThanOrEqual(Math.max(0, r) + 1e-9);
      // Dus nooit meer afname of teruglevering dan zonder batterij.
      expect(res.gridImportKwh[i]!).toBeLessThanOrEqual(basis.gridImportKwh[i]! + 1e-9);
      expect(res.gridExportKwh[i]!).toBeLessThanOrEqual(basis.gridExportKwh[i]! + 1e-9);
    }
    expect(res.totalCostEur).toBeLessThan(basis.totalCostEur);
  }, 60_000);

  it("bespaart minder euro's dan rendement, want het mist de handel", () => {
    expect(uitkomsten.get("zelfconsumptie")!.averageSavingEur).toBeLessThan(uitkomsten.get("rendement")!.averageSavingEur);
    expect(uitkomsten.get("zelfconsumptie")!.averageSavingEur).toBeGreaterThan(0);
  });
});

describe("uitstoot", () => {
  it("spaart meer CO2 uit dan rendement, tegen minder euro's", () => {
    const r = huishoudPerspectief(uitkomsten.get("rendement")!.co2!);
    const u = huishoudPerspectief(uitkomsten.get("uitstoot")!.co2!);
    expect(u.winstKg).toBeGreaterThan(r.winstKg);
    expect(uitkomsten.get("uitstoot")!.averageSavingEur).toBeLessThanOrEqual(uitkomsten.get("rendement")!.averageSavingEur);
    console.log("doelen 2025", {
      rendement: { eur: uitkomsten.get("rendement")!.averageSavingEur.toFixed(0), kg: r.winstKg.toFixed(0) },
      zelfconsumptie: { eur: uitkomsten.get("zelfconsumptie")!.averageSavingEur.toFixed(0), kg: huishoudPerspectief(uitkomsten.get("zelfconsumptie")!.co2!).winstKg.toFixed(0) },
      uitstoot: { eur: uitkomsten.get("uitstoot")!.averageSavingEur.toFixed(0), kg: u.winstKg.toFixed(0) },
    });
  });
});
