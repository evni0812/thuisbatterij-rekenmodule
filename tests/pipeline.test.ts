/**
 * End-to-end test op de ECHTE assets in public/data/.
 *
 * Dit is de belangrijkste controle van de hele keten: tijdas, normalisatie,
 * prijskoppeling en dispatch, op de werkelijke MFFBAS- en ANWB-data in plaats
 * van op een verzonnen profiel.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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

describe("de bestanden", () => {
  it("komen overeen met de sha256 in het manifest", () => {
    const bestanden: [string, { sha256?: string; bytes: number }][] = [
      ...Object.entries(manifest.prijzen).map(([j, i]) => [`prices-${j}.bin`, i] as [string, typeof i]),
      ...Object.entries(manifest.co2 ?? {}).map(([j, i]) => [`co2-${j}.bin`, i] as [string, typeof i]),
      ...Object.entries(manifest.profielen).flatMap(([g, jaren]) =>
        Object.entries(jaren).map(([j, i]) => [`profile-${g}-${j}.bin`, i] as [string, typeof i]),
      ),
      ...Object.entries(manifest.profielen_zonder ?? {}).flatMap(([g, jaren]) =>
        Object.entries(jaren).map(([j, i]) => [`profile-${g}-${j}-azi.bin`, i] as [string, typeof i]),
      ),
    ];
    expect(bestanden.length).toBeGreaterThan(100);
    for (const [naam, info] of bestanden) {
      const b = readFileSync(`${DATA}/${naam}`);
      expect(b.byteLength, naam).toBe(info.bytes);
      expect(createHash("sha256").update(b).digest("hex"), naam).toBe(info.sha256);
    }
  });

  it("levert geen prijsjaren die niets gebruikt", () => {
    // De profielen beginnen op 2023-04-01; de prijzen van 2021 en 2022 hadden
    // bovendien een te lage heffing en in 2022 H2 21% btw in plaats van 9%.
    expect(Object.keys(manifest.prijzen).sort()[0]).toBe("2023");
    expect(readdirSync(DATA).filter((f) => /^prices-202[12]/.test(f))).toEqual([]);
  });

  it("kapt de profielen af op de laatste volledige prijsdag", () => {
    const tot = manifest.profielen_tot!;
    expect(tot).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const soort of [manifest.profielen, manifest.profielen_zonder ?? {}]) {
      for (const jaren of Object.values(soort)) {
        for (const info of Object.values(jaren)) expect(info.laatste_dag <= tot).toBe(true);
      }
    }
    // En die dag heeft ook echt een prijs voor elk uur.
    const jaar = Number(tot.slice(0, 4));
    const p = priceYear(jaar);
    const laatsteUur = (localMidnightUtcMs(addDays(tot, 1)) - p.firstHourMs) / 3_600_000 - 1;
    expect(p.marketPrice.length).toBeGreaterThan(laatsteUur);
  });

  it("meet de afronding op hele centen van de bron", () => {
    // Sinds 20 juni 2026 rondt de ANWB-API af; de heffing van nu blijft de
    // echte 12,885 ct en kantelt niet naar 13,00.
    const p26 = manifest.prijzen["2026"]!;
    expect(p26.hele_centen_vanaf).toBe("2026-06-20");
    expect(p26.aandeel_hele_centen!).toBeGreaterThan(0.1);
    expect(p26.jaarconstante_eur_per_kwh).toBeCloseTo(0.128848, 6);
    expect(manifest.prijzen["2025"]!.aandeel_hele_centen).toBeLessThan(0.01);
  });

  it("weigert een bestand met een ander aantal reeksen of bytes", () => {
    const buf = readBin(`${DATA}/prices-2025.bin`);
    expect(() => decodeBinary(buf, 2)).not.toThrow();
    expect(() => decodeBinary(buf, 1)).toThrow(/reeksen/);
    const langer = new Uint8Array(buf.byteLength + 4);
    langer.set(new Uint8Array(buf));
    expect(() => decodeBinary(langer.buffer)).toThrow(/bytes/);
    expect(() => decodeBinary(buf.slice(0, buf.byteLength - 4))).toThrow(/bytes/);
  });

  it("geeft een uur zonder emissiefactor NaN, geen nul", () => {
    const { series } = decodeBinary(readBin(`${DATA}/co2-2023.bin`), 1);
    let nul = 0;
    for (const v of series[0]!) if (v === 0) nul++;
    expect(nul).toBe(0);
    expect(Number.isNaN(series[0]![0]!)).toBe(true);
  });
});

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
     * Eén meter neemt binnen een kwartier meestal óf af óf levert terug, dus
     * de jaartotalen op de afrekening zijn vrijwel genette sommen. Het model
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

  it("reproduceert de meterstanden bij elke verhouding, in elk netgebied", () => {
    /**
     * De oude vast-punt-iteratie gaf het op zodra geen kwartier meer een
     * overschot had. Boven een verhouding van ongeveer 58 verdween de
     * teruglevering dan stil, en bij 100.000/2.000 kwam de afname uit op
     * 148.213 kWh. Die verhouding ligt binnen de invoergrenzen (30.000 tegen
     * 500 is al 60), dus de uitersten horen hier, beide kanten op.
     */
    const verhoudingen: [number, number][] = [
      [2500, 2000],
      [1000, 1000],
      [30000, 500],
      [30000, 100],
      [100000, 2000],
      [500, 30000],
      [100, 30000],
    ];
    // Het laatste volle jaar per netgebied: dat is het jaar waarop de app zijn
    // schaalfactoren bepaalt (lib/data/invoer.ts).
    for (const domain of Object.keys(manifest.profielen)) {
      const jaar = Object.entries(manifest.profielen[domain]!)
        .filter(([, info]) => info.volledig_jaar)
        .map(([y]) => Number(y))
        .sort((a, b) => b - a)[0];
      if (jaar === undefined) continue;
      const prof = profileYear(domain, jaar);
      for (const [af, tl] of verhoudingen) {
        const hh: HouseholdSpec = { annualGridImportKwh: af, annualGridExportKwh: tl, spreadFactor: 1 };
        const scale = solveNettingScale(prof.importFraction, prof.exportFraction, hh);
        const s = summarizeResidual(
          buildResidual(prof.importFraction, prof.exportFraction, hh, prof.startMs, scale),
          hh,
        );
        const plek = `${domain} ${jaar} ${af}/${tl}`;
        // Relatief op een duizendste: de fracties zijn float32, en bij
        // 100.000 kWh telt die ruis op tot enkele kWh.
        expect(Math.abs(s.gridImportKwh / af - 1), plek).toBeLessThan(1e-3);
        expect(Math.abs(s.gridExportKwh / tl - 1), plek).toBeLessThan(1e-3);
      }
    }
  }, 30_000);

  it("weigert meterstanden die met het profiel onhaalbaar zijn", () => {
    // Een profiel waarin teruglevering nergens de afname overtreft: geen enkele
    // schaal maakt dan een kwartier met overschot. Liever een fout dan een
    // uitkomst die stil niet op de meterstanden uitkomt.
    const vorm = new Float32Array(96).fill(1 / 96);
    const hh: HouseholdSpec = { annualGridImportKwh: 2500, annualGridExportKwh: 2000, spreadFactor: 1 };
    expect(() => solveNettingScale(vorm, vorm, hh)).toThrow(/niet te halen/);
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
