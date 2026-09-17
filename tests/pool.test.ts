/**
 * De parallelle weg moet exact hetzelfde antwoord geven als de doorlopende.
 *
 * Twee lagen: de pool zelf (met nepworkers: wachtrij, voorkeurworker, `klaar`,
 * annuleren) en het protocol door de échte worker (vensters, curvepunten,
 * perfecte voorspelling, samenvoegen), vergeleken met `runAnalysis` op
 * dezelfde invoer.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { Invoerbron, vensterGrenzen } from "../lib/data/invoer";
import {
  curveFracties,
  referentieIndexVan,
  runAnalysis,
  runScenario,
  type CurveMeting,
  type VensterUitkomst,
} from "../lib/model/analysis";
import { scenarioConfiguratie } from "../lib/nettarief";
import { WorkerPool, poolGrootte } from "../lib/worker/pool";
import type { Configuration, WorkerRequest, WorkerResponse } from "../lib/worker/protocol";

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

describe("de pool met nepworkers", () => {
  /** Een worker die niets rekent, maar berichten vastlegt en op commando `klaar` zegt. */
  class NepWorker {
    static alle: NepWorker[] = [];
    ontvangen: WorkerRequest[] = [];
    onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    constructor() {
      NepWorker.alle.push(this);
    }
    postMessage(msg: WorkerRequest): void {
      this.ontvangen.push(msg);
    }
    terminate(): void {}
    /** Laat de worker antwoorden. */
    stuur(msg: WorkerResponse): void {
      this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
    }
  }

  function maak() {
    NepWorker.alle = [];
    const berichten: { msg: WorkerResponse; worker: number }[] = [];
    const pool = new WorkerPool(3, () => new NepWorker() as unknown as Worker, (msg, worker) => berichten.push({ msg, worker }), () => {});
    return { pool, berichten, workers: NepWorker.alle };
  }
  const cfg = maakConfiguratie(STANDAARD);
  const venster = (id: number, groep = 1): WorkerRequest & { id: number } => ({
    type: "venster", id, groep, config: cfg, jaarIndex: 0, metOptimum: true,
  });

  it("kiest voor elke machine minstens twee en hoogstens vier workers", () => {
    expect(poolGrootte(1)).toBe(2);
    expect(poolGrootte(2)).toBe(2);
    expect(poolGrootte(4)).toBe(3);
    expect(poolGrootte(8)).toBe(4);
    expect(poolGrootte(64)).toBe(4);
  });

  it("verdeelt taken over vrije workers en wacht met de rest tot er een klaar is", () => {
    const { pool, workers } = maak();
    for (let i = 1; i <= 5; i++) pool.plaats({ groep: 1, bericht: venster(i) });
    // Drie workers, drie lopende taken; twee wachten.
    expect(workers.map((w) => w.ontvangen.length)).toEqual([1, 1, 1]);
    expect(pool.bezig(0) && pool.bezig(1) && pool.bezig(2)).toBe(true);
    workers[1]!.stuur({ type: "klaar", id: 2 });
    expect(workers[1]!.ontvangen.map((m) => (m as { id: number }).id)).toEqual([2, 4]);
    // Een `klaar` met een ander id dan de lopende taak verandert niets.
    workers[0]!.stuur({ type: "klaar", id: 99 });
    expect(workers[0]!.ontvangen).toHaveLength(1);
    workers[0]!.stuur({ type: "klaar", id: 1 });
    expect(workers[0]!.ontvangen.map((m) => (m as { id: number }).id)).toEqual([1, 5]);
  });

  it("houdt een taak voor de aangewezen worker vast tot die vrij is", () => {
    const { pool, workers } = maak();
    pool.plaats({ groep: 1, bericht: venster(1) }); // gaat naar worker 0
    pool.plaats({ groep: 1, worker: 0, bericht: venster(2) }); // moet wachten op worker 0
    pool.plaats({ groep: 1, bericht: venster(3) }); // mag naar worker 1
    expect(workers[0]!.ontvangen).toHaveLength(1);
    expect(workers[1]!.ontvangen).toHaveLength(1);
    expect(workers[2]!.ontvangen).toHaveLength(0);
    workers[0]!.stuur({ type: "klaar", id: 1 });
    expect(workers[0]!.ontvangen.map((m) => (m as { id: number }).id)).toEqual([1, 2]);
  });

  it("haalt met annuleren alleen de wachtende taken van die groep weg", () => {
    const { pool, workers } = maak();
    for (let i = 1; i <= 3; i++) pool.plaats({ groep: 1, bericht: venster(i, 1) });
    pool.plaats({ groep: 1, bericht: venster(4, 1) });
    pool.plaats({ groep: 2, bericht: venster(5, 2) });
    pool.annuleer(1);
    workers[0]!.stuur({ type: "klaar", id: 1 });
    // Taak 4 (groep 1) is weg; taak 5 (groep 2) komt aan de beurt.
    expect(workers[0]!.ontvangen.map((m) => (m as { id: number }).id)).toEqual([1, 5]);
  });

  it("geeft andere berichten door met het nummer van de worker", () => {
    const { pool, workers, berichten } = maak();
    void pool;
    workers[2]!.stuur({ type: "ready", manifest: {} });
    expect(berichten).toEqual([{ msg: { type: "ready", manifest: {} }, worker: 2 }]);
  });
});

describe("de invoer per venster", () => {
  it("is bit-voor-bit gelijk aan het venster uit de volledige invoer", async () => {
    const bron = new Invoerbron("/data", haal);
    await bron.init();
    const cfg = maakConfiguratie({ ...STANDAARD, van: "2024-03-01", tot: "2026-02-28" });
    const vol = await bron.bouwInvoer(cfg);
    const grenzen = vensterGrenzen(bron.gegevens, cfg);
    expect(grenzen.map((g) => [g.year, g.firstDay, g.lastDay, g.isFullYear])).toEqual(
      vol.windows.map((w) => [w.year, w.firstDay, w.lastDay, w.isFullYear]),
    );
    for (let k = 0; k < vol.windows.length; k++) {
      const los = await bron.bouwInvoer(cfg, { alleenVenster: k });
      expect(los.windows).toHaveLength(1);
      expect(los.windows[0]).toEqual(vol.windows[k]);
    }
  }, 60_000);
});

describe("het protocol door de echte worker", () => {
  let ontvangen: WorkerResponse[] = [];
  let stuur: (msg: WorkerRequest) => Promise<void>;

  beforeAll(async () => {
    globalThis.fetch = haal;
    const nep = {
      onmessage: null as ((e: { data: WorkerRequest }) => unknown) | null,
      postMessage: (msg: WorkerResponse) => ontvangen.push(msg),
    };
    (globalThis as unknown as { self: typeof nep }).self = nep;
    await import("../lib/worker/sim.worker");
    stuur = async (msg) => {
      await nep.onmessage?.({ data: msg });
    };
    await stuur({ type: "init", baseUrl: "/data" });
  }, 120_000);

  /** Speel de rol van de pool: alle stukken, dan samenvoegen. */
  async function parallel(cfg: Configuration, soort: "analyse" | "scenario") {
    const bron = new Invoerbron("/data", haal);
    await bron.init();
    const grenzen = vensterGrenzen(bron.gegevens, cfg);
    const ref = referentieIndexVan(grenzen);
    let id = 100;
    ontvangen = [];
    // In omgekeerde volgorde, zodat de samenvoeging echt op index moet sorteren.
    for (let k = grenzen.length - 1; k >= 0; k--) {
      await stuur({ type: "venster", id: ++id, groep: 7, config: cfg, jaarIndex: k, metOptimum: soort === "analyse" });
    }
    for (const fraction of curveFracties({})) {
      await stuur({ type: "quick", id: ++id, groep: 7, config: cfg, jaarIndex: ref, fraction });
    }
    if (soort === "analyse") await stuur({ type: "perfect", id: ++id, groep: 7, config: cfg, jaarIndex: ref });

    const klaar = ontvangen.filter((m) => m.type === "klaar").length;
    expect(klaar).toBe(grenzen.length + curveFracties({}).length + (soort === "analyse" ? 1 : 0));
    const uitkomsten: VensterUitkomst[] = [];
    for (const m of ontvangen) if (m.type === "venster-uitkomst") uitkomsten[m.jaarIndex] = m.uitkomst;
    const metingen: CurveMeting[] = ontvangen.flatMap((m) => (m.type === "quick" ? [m.meting] : []));
    const perfect = ontvangen.find((m) => m.type === "perfect");

    ontvangen = [];
    if (soort === "analyse") {
      await stuur({
        type: "voegSamen", id: ++id, groep: 7, config: cfg, uitkomsten, metingen,
        perfect: perfect && perfect.type === "perfect" ? perfect.besparing : null,
      });
      const res = ontvangen.find((m) => m.type === "result");
      if (!res || res.type !== "result") throw new Error("geen result: " + JSON.stringify(ontvangen.map((m) => m.type)));
      return res.result;
    }
    await stuur({ type: "voegSamenScenario", id: ++id, groep: 7, config: cfg, uitkomsten, metingen });
    const res = ontvangen.find((m) => m.type === "scenario");
    if (!res || res.type !== "scenario") throw new Error("geen scenario");
    return res.result;
  }

  it("levert via vensters en samenvoegen exact hetzelfde als runAnalysis", async () => {
    const cfg = maakConfiguratie({ ...STANDAARD, van: "2024-06-01", tot: "2025-12-31" });
    const bron = new Invoerbron("/data", haal);
    await bron.init();
    const referentie = runAnalysis(await bron.bouwInvoer(cfg));
    const via = await parallel(cfg, "analyse");
    expect(via).toEqual(referentie);
  }, 180_000);

  it("levert het scenario via vensters exact hetzelfde als runScenario", async () => {
    const cfg = scenarioConfiguratie(maakConfiguratie({ ...STANDAARD, van: "2025-01-01", tot: "2025-12-31" }), {
      jaar: 2029,
      opTeruglevering: false,
    });
    const bron = new Invoerbron("/data", haal);
    await bron.init();
    const referentie = runScenario(await bron.bouwInvoer(cfg));
    const via = await parallel(cfg, "scenario");
    expect(via).toEqual(referentie);
  }, 180_000);

  it("kan na het samenvoegen meteen een dag leveren uit de bewaarde dispatches", async () => {
    const cfg = maakConfiguratie({ ...STANDAARD, van: "2024-06-01", tot: "2025-12-31" });
    await parallel(cfg, "analyse");
    ontvangen = [];
    const t0 = performance.now();
    await stuur({ type: "day", id: 900, date: "2025-06-15", config: cfg });
    const dag = ontvangen.find((m) => m.type === "day");
    expect(dag && dag.type === "day" && dag.day?.date).toBe("2025-06-15");
    // Geen jaarsimulatie meer nodig: ruim onder de tijd van één rolling-run.
    expect(performance.now() - t0).toBeLessThan(250);
  }, 180_000);

  it("doet van een raster alleen de opgedragen rijen en meldt daarna klaar", async () => {
    const cfg = maakConfiguratie({ ...STANDAARD, van: "2025-01-01", tot: "2025-12-31" });
    ontvangen = [];
    await stuur({ type: "grid", id: 950, config: cfg, capacities: [1, 2, 3], powers: [0.8], rijen: [2, 0] });
    const rijen = ontvangen.filter((m) => m.type === "grid-row");
    expect(rijen.map((m) => (m.type === "grid-row" ? [m.row, m.done] : null))).toEqual([[2, false], [0, true]]);
    expect(ontvangen.at(-1)).toEqual({ type: "klaar", id: 950 });
  }, 120_000);
});
