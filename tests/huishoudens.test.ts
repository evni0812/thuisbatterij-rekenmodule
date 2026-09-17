/**
 * De reeks huishoudens (Voor wie), getest via de échte worker.
 *
 * De ijk is het huishouden met de eigen teruglevering: dat moet exact de
 * jaarbesparing van het referentiejaar in het hoofdresultaat opleveren, want
 * het is dezelfde simulatie met dezelfde drempel op hetzelfde jaar. Klopt dat
 * niet, dan toont de figuur een andere batterij dan de cijfers erboven.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { huishoudenConfiguratie, huishoudensVarianten, pastBijVarianten } from "../lib/model/huishoudens";
import { referentieJaar, type AnalysisResult } from "../lib/model/analysis";
import type { WorkerRequest, WorkerResponse } from "../lib/worker/protocol";

let ontvangen: WorkerResponse[] = [];
let stuur: (msg: WorkerRequest) => Promise<void>;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
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

  const nep = {
    onmessage: null as ((e: { data: WorkerRequest }) => unknown) | null,
    postMessage: (msg: WorkerResponse) => ontvangen.push(msg),
  };
  (globalThis as unknown as { self: typeof nep }).self = nep;
  await import("../lib/worker/sim.worker");
  stuur = async (msg: WorkerRequest) => {
    await nep.onmessage?.({ data: msg });
  };
  await stuur({ type: "init", baseUrl: "/data" });
}, 120_000);

const cfg = maakConfiguratie({ ...STANDAARD, van: "2025-01-01", tot: "2025-12-31" });

describe("de varianten", () => {
  it("zijn zes huishoudens met panelen en één zonder, en herkennen een bewaarde reeks", () => {
    const v = huishoudensVarianten();
    expect(v).toHaveLength(7);
    expect(v.filter((x) => x.zonnepanelen)).toHaveLength(6);
    expect(v.at(-1)).toEqual({ terugleveringKwh: 0, zonnepanelen: false });
    expect(pastBijVarianten(undefined)).toBe(false);
    expect(pastBijVarianten(v.map(() => null))).toBe(true);
    expect(pastBijVarianten(v.slice(1).map(() => null))).toBe(false);
  });

  it("verschuiven alleen de teruglevering en het profieltype", () => {
    const met = huishoudenConfiguratie(cfg, { terugleveringKwh: 4000, zonnepanelen: true });
    expect(met.household.annualGridExportKwh).toBe(4000);
    expect(met.household.annualGridImportKwh).toBe(cfg.household.annualGridImportKwh);
    expect(met.afnametype).toBeUndefined();
    expect(met.battery).toEqual(cfg.battery);
    expect(met.investmentEur).toBe(cfg.investmentEur);
    const zonder = huishoudenConfiguratie(cfg, { terugleveringKwh: 0, zonnepanelen: false });
    expect(zonder.afnametype).toBe("AZI");
    expect(zonder.household.annualGridExportKwh).toBe(0);
    expect(zonder.annualProductionKwh).toBe(0);
  });
});

describe("de workertaak huishoudens", () => {
  let result: AnalysisResult;

  beforeAll(async () => {
    ontvangen = [];
    await stuur({ type: "analyse", id: 1, config: cfg });
    const res = ontvangen.find((m) => m.type === "result");
    if (!res || res.type !== "result") throw new Error("geen resultaat");
    result = res.result;
  }, 120_000);

  it("levert per variant een punt en is geijkt aan het hoofdresultaat", async () => {
    const varianten = huishoudensVarianten();
    ontvangen = [];
    await stuur({ type: "huishoudens", id: 2, config: cfg, varianten, indices: varianten.map((_, i) => i) });
    const punten = ontvangen.filter((m) => m.type === "huishouden-punt");
    expect(punten).toHaveLength(varianten.length);
    expect(punten.map((m) => (m.type === "huishouden-punt" ? m.done : null)).at(-1)).toBe(true);
    expect(ontvangen.at(-1)).toEqual({ type: "klaar", id: 2 });

    const eigen = punten.find(
      (m) => m.type === "huishouden-punt" && m.punt?.zonnepanelen && m.punt.terugleveringKwh === cfg.household.annualGridExportKwh,
    );
    if (!eigen || eigen.type !== "huishouden-punt" || !eigen.punt) throw new Error("eigen huishouden ontbreekt");
    expect(eigen.punt.savingEur).toBeCloseTo(referentieJaar(result).realisticSavingEur, 9);
    expect(eigen.punt.cyclesPerYear).toBeCloseTo(referentieJaar(result).cyclesPerYear, 9);

    const zonder = punten.find((m) => m.type === "huishouden-punt" && m.punt?.zonnepanelen === false);
    if (!zonder || zonder.type !== "huishouden-punt" || !zonder.punt) throw new Error("huishouden zonder panelen ontbreekt");
    expect(zonder.punt.savingEur).toBeGreaterThan(0);
    expect(zonder.punt.savingEur).toBeLessThan(eigen.punt.savingEur);
  }, 120_000);

  it("doet alleen de opgedragen indices en meldt daarna klaar", async () => {
    const varianten = huishoudensVarianten();
    ontvangen = [];
    await stuur({ type: "huishoudens", id: 3, config: cfg, varianten, indices: [6, 0] });
    const punten = ontvangen.filter((m) => m.type === "huishouden-punt");
    expect(punten.map((m) => (m.type === "huishouden-punt" ? [m.index, m.done] : null))).toEqual([[6, false], [0, true]]);
    expect(ontvangen.at(-1)).toEqual({ type: "klaar", id: 3 });
  }, 120_000);
});
