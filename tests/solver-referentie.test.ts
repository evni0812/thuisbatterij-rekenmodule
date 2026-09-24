/**
 * Het harnas voor solver-optimalisaties: bit-voor-bit hetzelfde als vóór.
 *
 * Twee lagen. Op planniveau: `planSocPath` tegen een letterlijke kopie van de
 * solver van 17 september 2026 (tests/solver-referentie.ts), op echte
 * planblokken uit het profieljaar 2025, voor batterijen van klein tot
 * groot-en-traag (S ≈ 400 niveaus). Op jaarniveau: de kosten en een hash over
 * de dispatch-arrays van `dispatchRolling` en `dispatchOptimal`, tegen getallen
 * die op die dag zijn vastgelegd. Die literalen mogen nooit meer bewegen: wordt
 * deze test rood, dan is een optimalisatie fout, en is dat geen reden om
 * MODEL_VERSIE op te hogen.
 *
 * ── Wat er met dit harnas is geprobeerd ─────────────────────────────────────
 * Per-niveau tabellen voor de lading, de grenzen hi/lo en hun tussenwaarden
 * (gehoist uit de binnenste lus, dezelfde expressies) plus hergebruik van de
 * werkbuffers over de 366 plannen van een jaar. Bit-identiek, bewezen met dit
 * harnas — en gemeten trager: 365 plannen 371 → 401 ms, het jaarplan van het
 * optimum 258 → 415 ms. De extra geheugenlezingen kosten meer dan de
 * vermenigvuldigingen die ze uitsparen, en V8 hoist het t-invariante deel
 * kennelijk al. De solver staat daarom weer zoals hij was; het harnas blijft,
 * voor wie het nog eens probeert.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import type { Instellingen } from "../lib/url-state";
import { Invoerbron } from "../lib/data/invoer";
import { slijtageVoor, type AnalysisInput } from "../lib/model/analysis";
import { dispatchOptimal } from "../lib/model/dispatch-optimal";
import {
  dispatchRolling,
  forecastResidual,
  publicationMoments,
} from "../lib/model/dispatch-rolling";
import { chooseSocLevels, planSocPath } from "../lib/model/solver";
import { maxChargeKwhPerStep, maxDischargeKwhPerStep, usableCapacityKwh } from "../lib/model/battery";
import type { BatterySpec } from "../lib/model/types";
import { LocalTimeIndex } from "../lib/data/timeaxis";
import { planSocPathReferentie } from "./solver-referentie";

const haal = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const buf = readFileSync(`public${url.startsWith("/") ? url : `/${url}`}`);
  const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => body,
    json: async () => JSON.parse(buf.toString("utf8")),
  } as Response;
}) as typeof fetch;

/** FNV-1a over de bytes van een reeks arrays: één getal voor een hele dispatch. */
function hash(arrs: Float64Array[]): string {
  let h = 0x811c9dc5;
  for (const a of arrs) {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < b.length; i++) {
      h ^= b[i]!;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16);
}

/** Vastgelegd op 17 september 2026 met de solver van vóór de optimalisaties. */
const GEVALLEN: {
  naam: string;
  inst: Partial<Instellingen>;
  rolling: number;
  rollingHash: string;
  optimal: number;
  optimalHash: string;
}[] = [
  { naam: "Zendure 1,92 kWh / 0,8 kW", inst: {}, rolling: 526.7709196871565, rollingHash: "5ed3145e", optimal: 517.2812897247147, optimalHash: "d4fcc7d6" },
  { naam: "Marstek 5,1 kWh, volle slijtage", inst: { presetId: "marstek-venus-e3", slijtageDeel: 1, prijsEur: 1199 }, rolling: 427.43857837733515, rollingHash: "9180953d", optimal: 392.97947005046007, optimalHash: "f9759aaa" },
  // De prijs staat hier vast: sinds de kostenregel krijgt een overschreven maat
  // anders een eigen prijs, en daarmee een andere slijtagedrempel. Dit harnas
  // gaat over de solver, niet over de prijs.
  { naam: "15 kWh / 0,5 kW", inst: { capaciteitKwh: 15, vermogenKw: 0.5, prijsEur: 699 }, rolling: 451.3598935342849, rollingHash: "a5f96e71", optimal: 419.31590709164783, optimalHash: "a395af2d" },
  { naam: "15 kWh / 0,5 kW zonder afregelen", inst: { capaciteitKwh: 15, vermogenKw: 0.5, prijsEur: 699, curtailment: false }, rolling: 461.456574668469, rollingHash: "2b788c65", optimal: 429.3838556342103, optimalHash: "a395af2d" },
  { naam: "zonder zonnepanelen", inst: { zonnepanelen: false }, rolling: 628.0923380665662, rollingHash: "e9a8a753", optimal: 627.6517252839958, optimalHash: "31d222b6" },
];

let bron: Invoerbron;
const invoeren = new Map<string, AnalysisInput>();

beforeAll(async () => {
  bron = new Invoerbron("/data", haal);
  await bron.init();
  for (const g of GEVALLEN) {
    const cfg = maakConfiguratie({ ...STANDAARD, ...g.inst, van: "2025-01-01", tot: "2025-12-31" });
    // maakConfiguratie houdt de invoer binnen de grenzen van de pagina
    // (lib/normaliseer.ts: minstens 0,8 kW). Dit is een solvertest, geen
    // realistische batterij: het extreme vermogen gaat er daarna direct in.
    const kw = g.inst.vermogenKw;
    if (typeof kw === "number") cfg.battery = { ...cfg.battery, maxChargeKw: kw, maxDischargeKw: kw };
    invoeren.set(g.naam, await bron.bouwInvoer(cfg));
  }
}, 120_000);

describe("planSocPath tegen de referentie", () => {
  for (const g of GEVALLEN) {
    it(`geeft op echte planblokken hetzelfde pad: ${g.naam}`, () => {
      const invoer = invoeren.get(g.naam)!;
      const w = invoer.windows[0]!.window;
      const spec: BatterySpec = slijtageVoor(invoer).spec;
      const usable = usableCapacityKwh(spec);
      const maxTransfer = Math.max(
        maxChargeKwhPerStep(spec) * spec.efficiency,
        maxDischargeKwhPerStep(spec) / spec.efficiency,
      );
      const levels = chooseSocLevels(usable, maxTransfer);
      const n = w.residualKwh.length;
      const index = new LocalTimeIndex(w.startMs[0]!, w.startMs[n - 1]!);
      const dagStarts: number[] = [];
      const dagVan = new Int32Array(n);
      let vorigeDag = "";
      for (let i = 0; i < n; i++) {
        const d = index.localDate(w.startMs[i]!);
        if (d !== vorigeDag) {
          dagStarts.push(i);
          vorigeDag = d;
        }
        dagVan[i] = dagStarts.length - 1;
      }
      const momenten = publicationMoments(w.startMs, index);
      // Veertig planblokken door het jaar, met een echte voorspelling en een
      // startlading die door het jaar heen varieert.
      const stap = Math.max(1, Math.floor(momenten.length / 40));
      let getest = 0;
      for (let k = 0; k < momenten.length; k += stap) {
        const t = momenten[k]!;
        const horizon = Math.min(n, t + 140);
        const plan = new Float64Array(n);
        forecastResidual(w.residualKwh, dagStarts, dagVan, t, horizon, plan);
        const socStart = (usable * ((k * 7) % 11)) / 10;
        const nieuw = planSocPath(plan, w.prices.importPrice, w.prices.exportPrice, t, horizon, spec, invoer.tariff, levels, socStart, true);
        const oud = planSocPathReferentie(plan, w.prices.importPrice, w.prices.exportPrice, t, horizon, spec, invoer.tariff, levels, socStart, true);
        expect(Array.from(nieuw)).toEqual(Array.from(oud));
        getest++;
      }
      expect(getest).toBeGreaterThanOrEqual(30);
      // En één blok zonder eindwaarde, zoals het laatste blok van het optimum.
      const a = planSocPath(w.residualKwh, w.prices.importPrice, w.prices.exportPrice, 30_000, 30_500, spec, invoer.tariff, levels, usable / 2, false);
      const b = planSocPathReferentie(w.residualKwh, w.prices.importPrice, w.prices.exportPrice, 30_000, 30_500, spec, invoer.tariff, levels, usable / 2, false);
      expect(Array.from(a)).toEqual(Array.from(b));
    }, 120_000);
  }
});

describe("de jaardispatch tegen de vastgelegde getallen", () => {
  for (const g of GEVALLEN) {
    it(`komt exact op de oude kosten en dispatch uit: ${g.naam}`, () => {
      const invoer = invoeren.get(g.naam)!;
      const w = invoer.windows[0]!;
      const { spec } = slijtageVoor(invoer);
      const r = dispatchRolling(w.window, spec, invoer.tariff);
      expect(r.totalCostEur).toBe(g.rolling);
      expect(hash([r.chargeKwh, r.dischargeKwh, r.socKwh])).toBe(g.rollingHash);
      const o = dispatchOptimal(w.window, spec, invoer.tariff);
      expect(o.totalCostEur).toBe(g.optimal);
      expect(hash([o.chargeKwh, o.dischargeKwh, o.socKwh])).toBe(g.optimalHash);
    }, 120_000);
  }
});
