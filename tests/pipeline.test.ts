/**
 * End-to-end test op de ECHTE assets in public/data/.
 *
 * Dit is de belangrijkste controle van de hele keten: tijdas, normalisatie,
 * prijskoppeling en dispatch, op de werkelijke MFFBAS- en ANWB-data in plaats
 * van op een verzonnen profiel.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeBinary,
  expandPricesToQuarters,
  type PriceYear,
  type ProfileYear,
} from "../lib/data/loader";
import type { Manifest } from "../lib/data/manifest";
import { addDays, buildQuarterAxis, localMidnightUtcMs } from "../lib/data/timeaxis";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchOptimal } from "../lib/model/dispatch-optimal";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { buildResidual, solveNettingScale, summarizeResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import type { BatterySpec, HouseholdSpec, TariffSpec, Window } from "../lib/model/types";

const DATA = "public/data";
const DOMAIN = "871685900000056162"; // Liander

const manifest = JSON.parse(
  readFileSync(`${DATA}/manifest.json`, "utf8"),
) as Manifest;

function readBin(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function profileYear(domain: string, year: number): ProfileYear {
  const info = manifest.profielen[domain]![String(year)]!;
  const { series } = decodeBinary(readBin(`${DATA}/profile-${domain}-${year}.bin`));
  return {
    year,
    startMs: buildQuarterAxis(info.eerste_dag, addDays(info.laatste_dag, 1)),
    importFraction: series[0]!,
    exportFraction: series[1]!,
    firstDay: info.eerste_dag,
    lastDay: info.laatste_dag,
    isFullYear: info.volledig_jaar,
  };
}

function priceYear(year: number): PriceYear {
  const info = manifest.prijzen[String(year)]!;
  const { series } = decodeBinary(readBin(`${DATA}/prices-${year}.bin`));
  return {
    year,
    firstHourMs: localMidnightUtcMs(`${year}-01-01`),
    marketPrice: series[0]!,
    allInPrice: series[1]!,
    levyEurPerKwh: info.jaarconstante_eur_per_kwh,
  };
}

const HOUSEHOLD: HouseholdSpec = {
  annualGridImportKwh: 2500,
  annualGridExportKwh: 2000,
  spreadFactor: 1,
};

function battery(over: Partial<BatterySpec> = {}): BatterySpec {
  return {
    capacityKwh: 5,
    depthOfCharge: 0.95,
    maxChargeKw: 2.5,
    maxDischargeKw: 2.5,
    efficiency: Math.sqrt(0.9),
    standbyWatt: 0,
    wearCostEurPerKwh: 0,
    ...over,
  };
}

function makeWindow(year: number, tariff: TariffSpec): Window {
  const prof = profileYear(DOMAIN, year);
  const price = priceYear(year);
  const market = expandPricesToQuarters(prof.startMs, price, "market");
  return {
    startMs: prof.startMs,
    residualKwh: buildResidual(prof.importFraction, prof.exportFraction, HOUSEHOLD),
    prices: buildPriceSeries(market, tariff),
  };
}

function tariffFor(year: number, over: Partial<TariffSpec> = {}): TariffSpec {
  return {
    purchaseSurchargeEurPerKwh: 0,
    // De werkelijke heffing van dat jaar, afgeleid uit allInPrijs - marktprijs.
    energyTaxEurPerKwh: manifest.prijzen[String(year)]!.jaarconstante_eur_per_kwh,
    feedInCostEurPerKwh: 0,
    allowCurtailment: false,
    ...over,
  };
}

describe("assets", () => {
  it("dekt de verwachte periode", () => {
    const jaren = Object.keys(manifest.profielen[DOMAIN]!).sort();
    expect(jaren).toContain("2024");
    expect(jaren).toContain("2025");
    // DYNAMIC begint op 1 april 2023; dat aanloopjaar hoort erbij te zitten.
    expect(manifest.profielen[DOMAIN]!["2023"]!.eerste_dag).toBe("2023-04-01");
    expect(manifest.profielen[DOMAIN]!["2023"]!.volledig_jaar).toBe(false);
  });

  it("normaliseert volledige jaren op exact 1", () => {
    for (const year of [2024, 2025]) {
      const p = profileYear(DOMAIN, year);
      let a = 0;
      let b = 0;
      for (let i = 0; i < p.importFraction.length; i++) {
        a += p.importFraction[i]!;
        b += p.exportFraction[i]!;
      }
      expect(a).toBeCloseTo(1, 4);
      expect(b).toBeCloseTo(1, 4);
    }
  });

  it("laat een deelperiode bewust op minder dan 1 uitkomen", () => {
    // 2023 loopt van april t/m december: minder afname dan een heel jaar (de
    // zware wintermaanden januari tot maart ontbreken), maar bijna alle
    // teruglevering, want die valt vrijwel geheel in het zomerhalfjaar.
    const p = profileYear(DOMAIN, 2023);
    let a = 0;
    let b = 0;
    for (let i = 0; i < p.importFraction.length; i++) {
      a += p.importFraction[i]!;
      b += p.exportFraction[i]!;
    }
    expect(a).toBeGreaterThan(0.6);
    expect(a).toBeLessThan(0.75);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });

  it("bouwt een tijdas die klopt met het aantal kwartieren", () => {
    // 2024 is een schrikkeljaar zonder netto DST-effect: 366 * 96.
    expect(profileYear(DOMAIN, 2024).startMs.length).toBe(366 * 96);
    expect(profileYear(DOMAIN, 2025).startMs.length).toBe(35040);
  });
});

describe("volumes", () => {
  it("verliest zonder schaling volume aan het netten", () => {
    const prof = profileYear(DOMAIN, 2025);
    const residual = buildResidual(
      prof.importFraction,
      prof.exportFraction,
      HOUSEHOLD,
    );
    const s = summarizeResidual(residual, HOUSEHOLD);
    // Netto salderen binnen het kwartier: waar E17 en E18 elkaar overlappen
    // valt volume weg. Op deze data is dat ruim een zesde van de afname.
    expect(s.gridImportKwh).toBeLessThan(2500 * 0.9);
    expect(s.gridExportKwh).toBeLessThan(2000 * 0.9);
    // Het verschil tussen afname en teruglevering blijft wel behouden: het is
    // de som van de residual, en die is per constructie 2500 - 2000. De marge
    // is de float32-precisie van de fracties, opgeteld over 35.040 kwartieren.
    expect(s.gridImportKwh - s.gridExportKwh).toBeCloseTo(2500 - 2000, 1);
  });

  it("reproduceert met schaling exact de meterstanden", () => {
    /**
     * Eén meter kan binnen een kwartier niet tegelijk afnemen en terugleveren,
     * dus de jaartotalen op de afrekening zijn al genette sommen. Het model
     * hoort ze terug te geven, niet 83% ervan.
     */
    for (const year of [2024, 2025]) {
      const prof = profileYear(DOMAIN, year);
      const scale = solveNettingScale(prof.importFraction, prof.exportFraction, HOUSEHOLD);
      // Beide factoren liggen boven 1 (er moet volume bij), en niet absurd ver.
      expect(scale.importScale).toBeGreaterThan(1);
      expect(scale.exportScale).toBeGreaterThan(1);
      expect(scale.importScale).toBeLessThan(1.5);
      expect(scale.exportScale).toBeLessThan(1.5);

      const residual = buildResidual(
        prof.importFraction,
        prof.exportFraction,
        HOUSEHOLD,
        prof.startMs,
        scale,
      );
      const s = summarizeResidual(residual, HOUSEHOLD);
      expect(s.gridImportKwh).toBeCloseTo(2500, 0);
      expect(s.gridExportKwh).toBeCloseTo(2000, 0);
    }
  });

  it("laat de schaling van een vol jaar een deeljaar niet opblazen", () => {
    // De factoren van 2025 op het deeljaar 2023 (april t/m december): de
    // afname hoort onder een heel jaar te blijven, de teruglevering vrijwel
    // compleet te zijn, precies zoals de ongeschaalde fracties dat al deden.
    const vol = profileYear(DOMAIN, 2025);
    const scale = solveNettingScale(vol.importFraction, vol.exportFraction, HOUSEHOLD);
    const deel = profileYear(DOMAIN, 2023);
    const s = summarizeResidual(
      buildResidual(deel.importFraction, deel.exportFraction, HOUSEHOLD, deel.startMs, scale),
      HOUSEHOLD,
    );
    expect(s.importFractionOfYear).toBeGreaterThan(0.6);
    expect(s.importFractionOfYear).toBeLessThan(0.85);
    expect(s.exportFractionOfYear).toBeGreaterThan(s.importFractionOfYear);
    expect(s.exportFractionOfYear).toBeLessThanOrEqual(1.02);
  });
});

describe("doorrekening op echte data", () => {
  it("levert een plausibele besparing zonder saldering", () => {
    const tariff = tariffFor(2025);
    const w = makeWindow(2025, tariff);
    const base = dispatchBaseline(w, tariff);
    const opt = dispatchOptimal(w, battery(), tariff);
    const real = dispatchRolling(w, battery(), tariff);

    const besparingOpt = base.totalCostEur - opt.totalCostEur;
    const besparingReal = base.totalCostEur - real.totalCostEur;

    // Een batterij hoort geld op te leveren als terugleveren veel minder
    // opbrengt dan afnemen kost.
    expect(besparingReal).toBeGreaterThan(0);
    expect(besparingReal).toBeLessThanOrEqual(besparingOpt);
    // Bovengrens: meer dan het hele afnamebedrag besparen kan niet.
    expect(besparingOpt).toBeLessThan(2500 * 0.4);
    // De realistische strategie hoort een groot deel van het optimum te halen.
    expect(besparingReal / besparingOpt).toBeGreaterThan(0.6);
  });

  it("levert in elk beschikbaar jaar een positieve besparing", () => {
    for (const year of [2024, 2025]) {
      const tariff = tariffFor(year);
      const w = makeWindow(year, tariff);
      const base = dispatchBaseline(w, tariff);
      const real = dispatchRolling(w, battery(), tariff);
      expect(base.totalCostEur - real.totalCostEur).toBeGreaterThan(0);
    }
  });

  it("draait een profieljaar binnen het tijdsbudget", () => {
    const tariff = tariffFor(2025);
    const w = makeWindow(2025, tariff);
    const spec = battery();

    // Eerst een korte opwarming: de eerste aanroep betaalt de JIT-compilatie van
    // de solver, en die kosten wil je niet in de meting. In de app gebeurt dat
    // eenmalig bij het opstarten van de worker.
    dispatchRolling(
      { ...w, residualKwh: w.residualKwh.slice(0, 2000), startMs: w.startMs.slice(0, 2000),
        prices: { importPrice: w.prices.importPrice.slice(0, 2000),
                  exportPrice: w.prices.exportPrice.slice(0, 2000) } },
      spec, tariff);

    const t0 = performance.now();
    dispatchRolling(w, spec, tariff);
    const rolling = performance.now() - t0;

    const t1 = performance.now();
    dispatchOptimal(w, spec, tariff);
    const optimal = performance.now() - t1;

    console.log(`  realistisch ${rolling.toFixed(0)} ms, optimum ${optimal.toFixed(0)} ms per profieljaar`);
    // Budget: beide strategieën samen ruim binnen een seconde per jaar, zodat
    // drie jaar met beide strategieën binnen een paar seconden klaar is.
    expect(rolling + optimal).toBeLessThan(1500);
  });
});

describe("vensterselectie", () => {
  /** Dezelfde grenzenlogica als de worker gebruikt. */
  function lowerBound(axis: Float64Array, target: number): number {
    let lo = 0;
    let hi = axis.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (axis[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  it("selecteert precies de gevraagde dagen, ook rond de zomertijd", () => {
    const p = profileYear(DOMAIN, 2025);
    for (const [van, tot, dagen] of [
      ["2025-01-01", "2025-01-31", 31],
      ["2025-03-29", "2025-03-31", 3],   // bevat de voorjaarsovergang
      ["2025-10-25", "2025-10-27", 3],   // bevat de najaarsovergang
      ["2025-06-01", "2025-08-31", 92],
    ] as const) {
      const start = lowerBound(p.startMs, localMidnightUtcMs(van));
      const end = lowerBound(p.startMs, localMidnightUtcMs(addDays(tot, 1)));
      const verwacht = buildQuarterAxis(van, addDays(tot, 1)).length;
      expect(end - start, `${van}…${tot}`).toBe(verwacht);
      // Een gewone dag telt 96 kwartieren; de overgangsdagen 92 en 100.
      expect(verwacht).toBeGreaterThanOrEqual(dagen * 96 - 4);
      expect(verwacht).toBeLessThanOrEqual(dagen * 96 + 4);
    }
  });

  it("laat een deelvenster op minder dan het jaarvolume uitkomen", () => {
    const p = profileYear(DOMAIN, 2025);
    const start = lowerBound(p.startMs, localMidnightUtcMs("2025-06-01"));
    const end = lowerBound(p.startMs, localMidnightUtcMs("2025-09-01"));
    let zomer = 0;
    for (let i = start; i < end; i++) zomer += p.importFraction[i]!;
    // Drie zomermaanden: minder dan een kwart van de jaarafname, want de winter
    // weegt zwaarder. Dit is precies waarom een deelperiode niet opnieuw
    // genormaliseerd mag worden.
    expect(zomer).toBeGreaterThan(0.1);
    expect(zomer).toBeLessThan(0.25);
  });
});
