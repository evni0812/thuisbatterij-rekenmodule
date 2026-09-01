/** WEGWERP — reviewmetingen. Verwijderen na afloop. */
import { readFileSync } from "node:fs";
import { beforeAll, describe, it } from "vitest";
import { loadManifest, loadPriceYear, loadProfileYear, expandPricesToQuarters } from "../lib/data/loader";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { dispatchOptimal } from "../lib/model/dispatch-optimal";
import { buildResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import { equivalentCycles, usableCapacityKwh, wearCostPerKwh, remainingCapacityFraction } from "../lib/model/battery";
import { computeFinance, type SavingCurvePoint } from "../lib/model/finance";
import { PRESETS } from "../lib/presets";
import type { BatterySpec, TariffSpec, Window } from "../lib/model/types";
import type { Manifest } from "../lib/data/manifest";
import { addDays, localMidnightUtcMs } from "../lib/data/timeaxis";

const DOMAIN = "871685900000056162";

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const pad = `public${url.startsWith("/") ? url : `/${url}`}`;
    const buf = readFileSync(pad);
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, arrayBuffer: async () => body, json: async () => JSON.parse(buf.toString("utf8")) } as Response;
  }) as typeof fetch;
});

function lowerBound(axis: Float64Array, t: number): number {
  let lo = 0, hi = axis.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (axis[m]! < t) lo = m + 1; else hi = m; }
  return lo;
}

export interface Win { year: number; isFullYear: boolean; window: Window; tariff: TariffSpec }

export async function bouwVensters(
  van: string, tot: string,
  opts: { feedInCost?: number; curtailment?: boolean; imp?: number; exp?: number; spread?: number; levyMode?: "median" | "exact" } = {},
): Promise<Win[]> {
  const manifest: Manifest = await loadManifest();
  const out: Win[] = [];
  for (const key of Object.keys(manifest.profielen[DOMAIN]!)) {
    const jaar = Number(key);
    const info = manifest.profielen[DOMAIN]![key]!;
    if (info.eerste_dag > tot || info.laatste_dag < van) continue;
    if (!manifest.prijzen[key]) continue;
    const prof = await loadProfileYear(manifest, DOMAIN, jaar);
    const price = await loadPriceYear(manifest, jaar);
    const firstDay = prof.firstDay > van ? prof.firstDay : van;
    const lastDay = prof.lastDay < tot ? prof.lastDay : tot;
    const start = lowerBound(prof.startMs, localMidnightUtcMs(firstDay));
    const end = lowerBound(prof.startMs, localMidnightUtcMs(addDays(lastDay, 1)));
    if (end <= start) continue;
    const startMs = prof.startMs.slice(start, end);
    const tariff: TariffSpec = {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: price.levyEurPerKwh,
      feedInCostEurPerKwh: opts.feedInCost ?? 0,
      allowCurtailment: opts.curtailment ?? true,
    };
    const market = expandPricesToQuarters(startMs, price, "market");
    let prices;
    if (opts.levyMode === "exact") {
      const allIn = expandPricesToQuarters(startMs, price, "allIn");
      const importPrice = new Float64Array(market.length);
      const exportPrice = new Float64Array(market.length);
      for (let i = 0; i < market.length; i++) {
        importPrice[i] = allIn[i]! + tariff.purchaseSurchargeEurPerKwh;
        exportPrice[i] = market[i]! - tariff.feedInCostEurPerKwh;
      }
      prices = { importPrice, exportPrice };
    } else {
      prices = buildPriceSeries(market, tariff);
    }
    out.push({
      year: jaar,
      isFullYear: firstDay === `${jaar}-01-01` && lastDay === `${jaar}-12-31` && prof.isFullYear,
      window: {
        startMs,
        residualKwh: buildResidual(
          prof.importFraction.slice(start, end),
          prof.exportFraction.slice(start, end),
          { annualGridImportKwh: opts.imp ?? 2500, annualGridExportKwh: opts.exp ?? 2000, spreadFactor: opts.spread ?? 1 },
        ),
        prices,
      },
      tariff,
    });
  }
  return out;
}

export function fox(): { spec: Omit<BatterySpec, "wearCostEurPerKwh">; prijs: number; cycleLife: number } {
  const p = PRESETS.find((x) => x.id === "foxess-s22")!;
  return { spec: p.spec, prijs: p.prijsEur, cycleLife: p.cycleLife };
}

describe("info", () => {
  it("basis", async () => {
    const w = await bouwVensters("2023-04-01", "2026-12-31");
    const f = fox();
    const spec: BatterySpec = { ...f.spec, wearCostEurPerKwh: 0 };
    console.log("usable", usableCapacityKwh(spec).toFixed(4), "eta", spec.efficiency.toFixed(4));
    console.log("wear @6000", wearCostPerKwh(f.prijs, f.cycleLife, spec).toFixed(5));
    for (const x of w) console.log(x.year, "full", x.isFullYear, "n", x.window.residualKwh.length, "levy", x.tariff.energyTaxEurPerKwh);
  });
});

/** Mimic runAnalysis' financiële keten, met instelbare slijtagedrempel. */
function doorrekenen(
  vensters: Win[],
  base: Omit<BatterySpec, "wearCostEurPerKwh">,
  wear: number,
  investering: number,
  cycleLife: number,
  jaren = 15,
) {
  const spec: BatterySpec = { ...base, wearCostEurPerKwh: wear };
  const vol = vensters.filter((v) => v.isFullYear);
  const basis = vol.length ? vol : vensters;
  const besp: number[] = [];
  const cycli: number[] = [];
  const baselines: number[] = [];
  for (const v of basis) {
    const b = dispatchBaseline(v.window, v.tariff);
    const r = dispatchRolling(v.window, spec, v.tariff);
    let d = 0; for (let i = 0; i < r.dischargeKwh.length; i++) d += r.dischargeKwh[i]!;
    besp.push(b.totalCostEur - r.totalCostEur);
    cycli.push(equivalentCycles(d, spec));
    baselines.push(b.totalCostEur);
  }
  const gem = besp.reduce((a, b) => a + b, 0) / besp.length;
  const gemCycli = cycli.reduce((a, b) => a + b, 0) / cycli.length;

  // curve zoals analysis.ts: referentiejaar = laatste volledige jaar
  const refIdx = basis.length - 1;
  const ref = basis[refIdx]!;
  const volleBesparing = besp[refIdx]!;
  const curve: SavingCurvePoint[] = [0.7, 0.85, 1].map((f) => {
    if (f === 1) return { capacityFraction: 1, savingEur: gem, cyclesPerYear: gemCycli };
    const kleiner: BatterySpec = { ...spec, capacityKwh: spec.capacityKwh * f };
    const r = dispatchRolling(ref.window, kleiner, ref.tariff);
    const s = baselines[refIdx]! - r.totalCostEur;
    const verh = volleBesparing > 0 ? s / volleBesparing : 1;
    return { capacityFraction: f, savingEur: gem * verh, cyclesPerYear: gemCycli * verh };
  });
  const fin = computeFinance({
    curve, investmentEur: investering, years: jaren,
    priceEscalation: 0.02, discountRate: 0.03, calendarFadePerYear: 0.015,
    cycleLife, residualValueEur: 0,
  });
  return { gem, gemCycli, curve, fin, besp, cycli };
}

describe("1+2 slijtagedrempel", () => {
  it("sweep", async () => {
    const vensters = await bouwVensters("2023-04-01", "2026-12-31");
    const f = fox();
    const specNul: BatterySpec = { ...f.spec, wearCostEurPerKwh: 0 };
    const basisWear = wearCostPerKwh(f.prijs, f.cycleLife, specNul);
    console.log("basiswear EUR/kWh:", basisWear.toFixed(5));
    console.log("mult | wear ct | besparing/j | cycli/j | NPV15 | payback | EOL-jaar | totCycli15");
    for (const mult of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 1, 1.5, 2]) {
      const r = doorrekenen(vensters, f.spec, basisWear * mult, f.prijs, f.cycleLife);
      console.log(
        `${mult.toFixed(2)} | ${(basisWear * mult * 100).toFixed(2)} | ${r.gem.toFixed(2)} | ${r.gemCycli.toFixed(1)} | ${r.fin.npvEur.toFixed(2)} | ${r.fin.paybackYears === null ? "-" : r.fin.paybackYears.toFixed(2)} | ${r.fin.endOfLifeYear ?? "-"} | ${r.fin.totalCycles.toFixed(0)}`,
      );
    }
  }, 600000);
});

describe("2b fijne sweep rond nul", () => {
  it("fijn", async () => {
    const vensters = await bouwVensters("2023-04-01", "2026-12-31");
    const f = fox();
    const bw = wearCostPerKwh(f.prijs, f.cycleLife, { ...f.spec, wearCostEurPerKwh: 0 });
    for (const w of [0, 0.005, 0.01, 0.02, 0.03, 0.05]) {
      const r = doorrekenen(vensters, f.spec, w, f.prijs, f.cycleLife);
      console.log(`wear=${(w*100).toFixed(2)}ct (mult ${(w/bw).toFixed(3)}) besp=${r.gem.toFixed(2)} cycli=${r.gemCycli.toFixed(1)} NPV=${r.fin.npvEur.toFixed(2)} eol=${r.fin.endOfLifeYear ?? "-"} totCyc=${r.fin.totalCycles.toFixed(0)}`);
    }
  }, 600000);
});

describe("2c degradatie bindt?", () => {
  it("kalender vs cyclisch", async () => {
    for (const cpy of [250, 300, 385, 500]) {
      const rows: string[] = [];
      let cum = 0;
      for (let y = 0; y < 15; y++) {
        const cal = Math.pow(1 - 0.015, y);
        const cyc = 1 - 0.2 * (cum / 6000);
        const mult = cal * cyc;
        if (y % 7 === 0 || y === 14) rows.push(`j${y+1}: cal=${cal.toFixed(3)} cyc=${cyc.toFixed(3)} min=${Math.min(cal,cyc).toFixed(3)} prod=${mult.toFixed(3)}`);
        cum += cpy;
      }
      console.log(`cycli/jaar ${cpy}:`, rows.join(" | "));
    }
  });
});

import { LocalTimeIndex } from "../lib/data/timeaxis";
import { chooseSocLevels, emptyResult, executePath, finalize, planSocPath } from "../lib/model/solver";
import { localDayStarts, knownHorizonEnd } from "../lib/model/dispatch-rolling";
import { maxChargeKwhPerStep, maxDischargeKwhPerStep } from "../lib/model/battery";
import type { DispatchResult } from "../lib/model/types";

type Voorspeller = (actual: Float64Array, dayStarts: number[], dayOf: Int32Array, from: number, to: number, out: Float64Array, t0: number) => void;

/** Kopie van dispatchRolling met instelbare voorspeller. */
function rollingMet(window: Window, spec: BatterySpec, tariff: TariffSpec, voorspel: Voorspeller): DispatchResult {
  const n = window.residualKwh.length;
  const out = emptyResult(n);
  const usable = usableCapacityKwh(spec);
  const maxTransfer = Math.max(maxChargeKwhPerStep(spec) * spec.efficiency, maxDischargeKwhPerStep(spec) / spec.efficiency);
  const levels = chooseSocLevels(usable, maxTransfer);
  const index = new LocalTimeIndex(window.startMs[0]!, window.startMs[n - 1]!);
  const dayStarts = localDayStarts(window.startMs, index);
  const dayOf = new Int32Array(n);
  for (let d = 0; d < dayStarts.length; d++) {
    const end = d + 1 < dayStarts.length ? dayStarts[d + 1]! : n;
    for (let i = dayStarts[d]!; i < end; i++) dayOf[i] = d;
  }
  const planResidual = new Float64Array(n);
  let soc = 0;
  let volgend = 0;
  for (let i = 0; i < n; i++) if (index.localHour(window.startMs[i]!) === 13) { volgend = i; break; }
  for (let t = 0; t < n; ) {
    const horizonTo = Math.max(t + 1, knownHorizonEnd(t, window.startMs, dayStarts, dayOf, n, index));
    voorspel(window.residualKwh, dayStarts, dayOf, t, horizonTo, planResidual, t);
    const path = planSocPath(planResidual, window.prices.importPrice, window.prices.exportPrice, t, horizonTo, spec, tariff, levels, soc);
    if (volgend <= t) volgend = t + 96;
    const execTo = Math.min(volgend, horizonTo, n);
    soc = executePath(window, path.subarray(0, execTo - t), t, execTo, spec, tariff, soc, out);
    if (execTo >= volgend) volgend += 96;
    t = execTo;
  }
  return finalize(window, spec, tariff, out);
}

/** N-daags gemiddelde per positie-in-de-dag (de huidige methode, met N instelbaar). */
function nDaags(N: number): Voorspeller {
  return (actual, dayStarts, dayOf, from, to, out) => {
    const n = actual.length;
    for (let t = from; t < to; t++) {
      const day = dayOf[t]!;
      const pos = t - dayStarts[day]!;
      const firstDay = Math.max(0, day - N);
      let sum = 0, count = 0;
      for (let prev = firstDay; prev < day; prev++) {
        const idx = dayStarts[prev]! + pos;
        const end = prev + 1 < dayStarts.length ? dayStarts[prev + 1]! : n;
        if (idx < end) { sum += actual[idx]!; count++; }
      }
      if (count > 0) out[t] = sum / count;
      else { const upto = dayStarts[day] ?? 0; let all = 0; for (let i = 0; i < upto; i++) all += actual[i]!; out[t] = upto > 0 ? all / upto : 0; }
    }
  };
}

/** 7-daags gemiddelde, maar geschaald op wat er vandaag tot nu toe werkelijk gebeurde. */
function nDaagsGeschaald(N: number): Voorspeller {
  const basis = nDaags(N);
  return (actual, dayStarts, dayOf, from, to, out, t0) => {
    basis(actual, dayStarts, dayOf, from, to, out, t0);
    // schaalfactor uit de teruglever-kant van vandaag tot t0
    const day = dayOf[t0]!;
    const dagStart = dayStarts[day]!;
    if (t0 <= dagStart) return;
    let echtExp = 0, voorspeldExp = 0;
    const tmp = new Float64Array(actual.length);
    basis(actual, dayStarts, dayOf, dagStart, t0, tmp, dagStart);
    for (let i = dagStart; i < t0; i++) { if (actual[i]! < 0) echtExp -= actual[i]!; if (tmp[i]! < 0) voorspeldExp -= tmp[i]!; }
    if (voorspeldExp > 0.5 && echtExp > 0) {
      const k = Math.max(0.3, Math.min(3, echtExp / voorspeldExp));
      for (let t = from; t < to; t++) if (out[t]! < 0) out[t] = out[t]! * k;
    }
  };
}

describe("3 capture rate", () => {
  it("decompositie", async () => {
    const vensters = await bouwVensters("2023-04-01", "2026-12-31");
    const f = fox();
    for (const wear of [0.11271, 0]) {
      const spec: BatterySpec = { ...f.spec, wearCostEurPerKwh: wear };
      console.log(`--- wear ${wear}`);
      for (const v of vensters.filter((x) => x.isFullYear)) {
        const b = dispatchBaseline(v.window, v.tariff);
        const opt = dispatchOptimal(v.window, spec, v.tariff);
        const rp = dispatchRolling(v.window, spec, v.tariff, { perfectForecast: true });
        const ra = dispatchRolling(v.window, spec, v.tariff);
        const s = (d: DispatchResult) => b.totalCostEur - d.totalCostEur;
        console.log(
          `${v.year}: opt=${s(opt).toFixed(2)} rollingPerfect=${s(rp).toFixed(2)} (${(s(rp)/s(opt)*100).toFixed(1)}%) rollingEcht=${s(ra).toFixed(2)} (${(s(ra)/s(opt)*100).toFixed(1)}%) | horizonverlies=${(s(opt)-s(rp)).toFixed(2)} voorspelverlies=${(s(rp)-s(ra)).toFixed(2)}`,
        );
      }
    }
  }, 900000);
});

describe("3b voorspellers", () => {
  it("varianten", async () => {
    const vensters = (await bouwVensters("2023-04-01", "2026-12-31")).filter((v) => v.isFullYear);
    const f = fox();
    const spec: BatterySpec = { ...f.spec, wearCostEurPerKwh: 0 };
    const varianten: [string, Voorspeller][] = [
      ["1-daags (gisteren)", nDaags(1)],
      ["3-daags", nDaags(3)],
      ["7-daags (huidig)", nDaags(7)],
      ["14-daags", nDaags(14)],
      ["7-daags geschaald", nDaagsGeschaald(7)],
    ];
    for (const v of vensters) {
      const b = dispatchBaseline(v.window, v.tariff);
      const opt = dispatchOptimal(v.window, spec, v.tariff);
      const optS = b.totalCostEur - opt.totalCostEur;
      const parts: string[] = [];
      for (const [naam, fn] of varianten) {
        const r = rollingMet(v.window, spec, v.tariff, fn);
        const s = b.totalCostEur - r.totalCostEur;
        parts.push(`${naam}=${s.toFixed(2)} (${(s / optS * 100).toFixed(1)}%)`);
      }
      console.log(`${v.year} opt=${optS.toFixed(2)} | ${parts.join(" | ")}`);
    }
  }, 900000);
});

/** 7-daags vorm, maar herschaald op het WERKELIJKE dagtotaal (diagnose, niet realistisch). */
function vormPerfectVolume(): Voorspeller {
  const basis = nDaags(7);
  return (actual, dayStarts, dayOf, from, to, out, t0) => {
    basis(actual, dayStarts, dayOf, from, to, out, t0);
    const n = actual.length;
    for (let d = 0; d < dayStarts.length; d++) {
      const s = Math.max(from, dayStarts[d]!);
      const e = Math.min(to, d + 1 < dayStarts.length ? dayStarts[d + 1]! : n);
      if (e <= s) continue;
      let echtE = 0, vE = 0, echtI = 0, vI = 0;
      for (let i = s; i < e; i++) {
        if (actual[i]! < 0) echtE -= actual[i]!; else echtI += actual[i]!;
        if (out[i]! < 0) vE -= out[i]!; else vI += out[i]!;
      }
      const kE = vE > 0 ? echtE / vE : 1;
      const kI = vI > 0 ? echtI / vI : 1;
      for (let i = s; i < e; i++) out[i] = out[i]! < 0 ? out[i]! * kE : out[i]! * kI;
    }
  };
}

function nDaagsSchaal(N: number, kExp: number): Voorspeller {
  const basis = nDaags(N);
  return (a, ds, dof, from, to, out, t0) => {
    basis(a, ds, dof, from, to, out, t0);
    for (let t = from; t < to; t++) if (out[t]! < 0) out[t] = out[t]! * kExp;
  };
}

describe("3c diagnose voorspelling", () => {
  it("vorm vs volume", async () => {
    const vensters = (await bouwVensters("2023-04-01", "2026-12-31")).filter((v) => v.isFullYear);
    const f = fox();
    const spec: BatterySpec = { ...f.spec, wearCostEurPerKwh: 0 };
    const varianten: [string, Voorspeller][] = [
      ["7d", nDaags(7)],
      ["7d x0.7 export", nDaagsSchaal(7, 0.7)],
      ["7d x1.3 export", nDaagsSchaal(7, 1.3)],
      ["7d-vorm + echt dagvolume", vormPerfectVolume()],
    ];
    for (const v of vensters) {
      const b = dispatchBaseline(v.window, v.tariff);
      const optS = b.totalCostEur - dispatchOptimal(v.window, spec, v.tariff).totalCostEur;
      const parts = varianten.map(([naam, fn]) => {
        const s = b.totalCostEur - rollingMet(v.window, spec, v.tariff, fn).totalCostEur;
        return `${naam}=${s.toFixed(2)} (${(s/optS*100).toFixed(1)}%)`;
      });
      console.log(`${v.year} opt=${optS.toFixed(2)} | ${parts.join(" | ")}`);
    }
  }, 900000);
});

describe("3d herplanfrequentie", () => {
  it("replan", async () => {
    const vensters = (await bouwVensters("2023-04-01", "2026-12-31")).filter((v) => v.isFullYear);
    const f = fox();
    for (const wear of [0, 0.11271]) {
      const spec: BatterySpec = { ...f.spec, wearCostEurPerKwh: wear };
      for (const v of vensters) {
        const b = dispatchBaseline(v.window, v.tariff);
        const parts = [96, 24, 8, 4].map((rs) => {
          const s = b.totalCostEur - dispatchRolling(v.window, spec, v.tariff, { replanSteps: rs }).totalCostEur;
          return `${rs}=${s.toFixed(2)}`;
        });
        console.log(`wear=${wear} ${v.year} | ${parts.join(" | ")}`);
      }
    }
  }, 900000);
});

describe("4 randgevallen", () => {
  it("edge", async () => {
    const f = fox();
    const mk = (o: Partial<BatterySpec>): BatterySpec => ({ ...f.spec, wearCostEurPerKwh: 0, ...o });
    const gevallen: [string, () => Promise<Win[]>, Partial<BatterySpec>][] = [
      ["normaal", () => bouwVensters("2025-01-01", "2025-12-31"), {}],
      ["teruglevering=0", () => bouwVensters("2025-01-01", "2025-12-31", { exp: 0 }), {}],
      ["afname=0", () => bouwVensters("2025-01-01", "2025-12-31", { imp: 0 }), {}],
      ["beide=0", () => bouwVensters("2025-01-01", "2025-12-31", { imp: 0, exp: 0 }), {}],
      ["capaciteit=0", () => bouwVensters("2025-01-01", "2025-12-31"), { capacityKwh: 0 }],
      ["capaciteit=1e-6", () => bouwVensters("2025-01-01", "2025-12-31"), { capacityKwh: 1e-6 }],
      ["dod=0", () => bouwVensters("2025-01-01", "2025-12-31"), { depthOfCharge: 0 }],
      ["vermogen=1000kW", () => bouwVensters("2025-01-01", "2025-12-31"), { maxChargeKw: 1000, maxDischargeKw: 1000 }],
      ["terugleverkosten 1,00", () => bouwVensters("2025-01-01", "2025-12-31", { feedInCost: 1.0 }), {}],
      ["terugleverkosten 1,00 zonder curtail", () => bouwVensters("2025-01-01", "2025-12-31", { feedInCost: 1.0, curtailment: false }), {}],
      ["curtailment uit", () => bouwVensters("2025-01-01", "2025-12-31", { curtailment: false }), {}],
      ["eta=1", () => bouwVensters("2025-01-01", "2025-12-31"), { efficiency: 1 }],
      ["standby=0", () => bouwVensters("2025-01-01", "2025-12-31"), { standbyWatt: 0 }],
      ["standby=200W", () => bouwVensters("2025-01-01", "2025-12-31"), { standbyWatt: 200 }],
    ];
    for (const [naam, maak, over] of gevallen) {
      const v = (await maak())[0]!;
      const spec = mk(over);
      const b = dispatchBaseline(v.window, v.tariff);
      const r = dispatchRolling(v.window, spec, v.tariff);
      const o = dispatchOptimal(v.window, spec, v.tariff);
      let d = 0, c = 0, curt = 0;
      for (let i = 0; i < r.dischargeKwh.length; i++) { d += r.dischargeKwh[i]!; c += r.chargeKwh[i]!; curt += r.curtailedKwh[i]!; }
      const rs = b.totalCostEur - r.totalCostEur;
      const os = b.totalCostEur - o.totalCostEur;
      console.log(
        `${naam.padEnd(34)} basis=${b.totalCostEur.toFixed(2)} real=${rs.toFixed(2)} opt=${os.toFixed(2)} capture=${os !== 0 ? (rs/os*100).toFixed(1) : "n/a"}% laad=${c.toFixed(0)} ontlaad=${d.toFixed(0)} cycli=${r.equivalentCycles.toFixed(1)} curtail=${curt.toFixed(0)} finite=${[b.totalCostEur, rs, os].every(Number.isFinite)}`,
      );
      if (rs > os + 0.01) console.log(`   !! realistisch (${rs.toFixed(2)}) BOVEN optimum (${os.toFixed(2)})`);
    }
  }, 900000);
});
