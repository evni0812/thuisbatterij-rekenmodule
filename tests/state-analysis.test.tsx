// @vitest-environment jsdom
/**
 * De hook rond de workerpool: herstel na een crash, opnieuw proberen, en één
 * id-ruimte voor taken, dagen en periodes. De workers zijn nepworkers die
 * niets rekenen; het antwoord komt uit een bestand dat de test zelf klaarzet
 * (net als het vooruitgerekende antwoord in productie).
 */
import { readFileSync } from "node:fs";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { Invoerbron } from "../lib/data/invoer";
import { runAnalysis } from "../lib/model/analysis";
import type { WorkerRequest, WorkerResponse } from "../lib/worker/protocol";

class NepWorker {
  static alle: NepWorker[] = [];
  ontvangen: WorkerRequest[] = [];
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  beeindigd = false;
  constructor() {
    NepWorker.alle.push(this);
  }
  postMessage(msg: WorkerRequest): void {
    this.ontvangen.push(msg);
  }
  terminate(): void {
    this.beeindigd = true;
  }
  stuur(msg: WorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
  }
  crash(): void {
    this.onerror?.({ message: "out of memory" } as ErrorEvent);
  }
  soort(type: string) {
    return this.ontvangen.filter((m) => m.type === type);
  }
}

/** Een kort rekenvenster: een week, zodat het antwoord in een halve seconde klaar is. */
const CFG = maakConfiguratie({ ...STANDAARD, van: "2025-06-01", tot: "2025-06-07" });

const lees = (pad: string) => readFileSync(`public${pad}`);
const haal = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("voorbeeld.json")) {
    if (!voorbeeld) return { ok: false, status: 404 } as Response;
    return { ok: true, status: 200, json: async () => voorbeeld } as Response;
  }
  const buf = lees(url.split("?")[0]!);
  const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { ok: true, status: 200, arrayBuffer: async () => body, json: async () => JSON.parse(buf.toString("utf8")) } as Response;
}) as typeof fetch;

let voorbeeld: unknown = null;
let resultaat: ReturnType<typeof runAnalysis>;
let dataVersie: string;

async function nieuweHook(opties: { rasterNodig?: boolean } = { rasterNodig: true }) {
  // Een eigen exemplaar van de hook en zijn voorbeeldbelofte per test.
  vi.resetModules();
  const { useAnalysis } = await import("../lib/useAnalysis");
  return renderHook(() => useAnalysis(CFG, opties));
}

/** Laat alle nepworkers die er nu zijn zeggen dat ze klaar zijn. */
function alleKlaar(vanaf = 0) {
  for (const w of NepWorker.alle.slice(vanaf)) w.stuur({ type: "ready", manifest: {} });
}

/**
 * Laat de workers alle pooltaken "afmaken" (zonder antwoord) behalve de genoemde
 * soorten, zodat de wachtrij doorloopt tot bij het raster. Raster en huishoudens
 * blijven "bezig": er komen nooit rijen of punten binnen.
 */
const KLAAR_GEMELD = new WeakSet<WorkerRequest>();
function pomp(behalve: string[] = ["grid"], vanaf = 0) {
  for (let ronde = 0; ronde < 50; ronde++) {
    let gedaan = false;
    for (const w of NepWorker.alle.slice(vanaf)) {
      for (const m of w.ontvangen) {
        if (KLAAR_GEMELD.has(m) || m.type === "init" || m.type === "cancel" || behalve.includes(m.type)) continue;
        if (!("id" in m) || typeof m.id !== "number" || !["venster", "quick", "perfect", "voegSamen", "voegSamenScenario", "huishoudens", "grid"].includes(m.type)) continue;
        KLAAR_GEMELD.add(m);
        w.stuur({ type: "klaar", id: m.id });
        gedaan = true;
      }
    }
    if (!gedaan) return;
  }
}

beforeEach(async () => {
  NepWorker.alle = [];
  window.localStorage.clear();
  vi.stubGlobal("Worker", NepWorker);
  vi.stubGlobal("fetch", haal);
  if (!resultaat) {
    const bron = new Invoerbron("/data", haal);
    dataVersie = (await bron.init()).gegenereerd;
    resultaat = runAnalysis(await bron.bouwInvoer(CFG));
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function metVoorbeeld() {
  const { dispatchSleutel } = await import("../lib/cache");
  voorbeeld = { versie: 1, sleutel: dispatchSleutel(CFG, dataVersie), gemaakt: "test", result: resultaat };
}

describe("een worker die crasht tijdens de hoofddoorrekening", () => {
  it("meldt een rekenfout en laat de knop Reken door weer werken", async () => {
    voorbeeld = null; // geen vooruitgerekend antwoord: de hook rekent zelf
    const { result } = await nieuweHook({ rasterNodig: false });
    expect(NepWorker.alle.length).toBeGreaterThanOrEqual(2);
    const eerste = NepWorker.alle.length;
    act(() => alleKlaar());
    await waitFor(() => expect(result.current.busy).toBe(true), { timeout: 5000 });

    const bezig = NepWorker.alle.find((w) => w.soort("venster").length > 0)!;
    act(() => bezig.crash());

    expect(result.current.error).toBe("de berekening liep vast; probeer het opnieuw");
    expect(result.current.busy).toBe(false);
    expect(result.current.fataal).toBeNull();
    // De worker is vervangen en de pool is niet leeg.
    expect(NepWorker.alle).toHaveLength(eerste + 1);
    expect(bezig.beeindigd).toBe(true);

    // Opnieuw rekenen: de nieuwe worker meldt zich en krijgt werk.
    act(() => NepWorker.alle[NepWorker.alle.length - 1]!.stuur({ type: "ready", manifest: {} }));
    act(() => result.current.herbereken());
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.error).toBeNull();
  }, 30_000);
});

describe("opnieuw proberen", () => {
  it("start raster en huishoudens opnieuw in plaats van ze op bezig te laten staan", async () => {
    await metVoorbeeld();
    const { result } = await nieuweHook();
    act(() => alleKlaar());
    await waitFor(() => expect(result.current.result).not.toBeNull(), { timeout: 5000 });
    await waitFor(() => {
      act(() => pomp());
      expect(result.current.grid?.bezig).toBe(true);
      expect(result.current.huishoudens?.bezig).toBe(true);
    });
    const oud = NepWorker.alle.length;

    // De rekenmodule viel weg; de gegevens zijn niet meer te laden.
    act(() => NepWorker.alle[0]!.stuur({ type: "error", id: null, message: "manifest niet gevonden" }));
    await waitFor(() => expect(result.current.fataal).toBe("manifest niet gevonden"));

    act(() => result.current.probeerOpnieuw());
    expect(result.current.fataal).toBeNull();
    await waitFor(() => expect(NepWorker.alle.length).toBeGreaterThan(oud));
    const nieuw = NepWorker.alle.slice(oud);
    expect(NepWorker.alle.slice(0, oud).every((w) => w.beeindigd)).toBe(true);

    act(() => alleKlaar(oud));
    // Het raster en de huishoudens beginnen van voren af aan op de nieuwe workers.
    await waitFor(() => {
      act(() => pomp([], oud));
      expect(nieuw.some((w) => w.soort("grid").length > 0)).toBe(true);
      expect(nieuw.some((w) => w.soort("huishoudens").length > 0)).toBe(true);
    }, { timeout: 5000 });
    expect(result.current.grid?.bezig).toBe(true);
    expect(result.current.grid?.rows.every((r) => r === null)).toBe(true);
  }, 30_000);
});

describe("één id-ruimte", () => {
  it("geeft dagen en periodes nooit het id van een pooltaak", async () => {
    await metVoorbeeld();
    const { result } = await nieuweHook();
    act(() => alleKlaar());
    await waitFor(() => {
      act(() => pomp());
      expect(NepWorker.alle.some((w) => w.soort("grid").length > 0)).toBe(true);
    }, { timeout: 5000 });

    // Elk soort telt hier eerst apart op; met eigen tellers zouden de eerste
    // dagen en periodes de nummers 1, 2, 3 … krijgen en botsen met pooltaken.
    for (const dag of ["2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05"]) {
      act(() => result.current.vraagDag(dag));
      act(() => result.current.vraagPeriode("2025-06-01", dag, "dag"));
      act(() => result.current.vraagWeek("2025-06-01", dag));
    }
    const alle = NepWorker.alle.flatMap((w) => w.ontvangen.filter((m) => m.type !== "init" && m.type !== "cancel"));
    const ids = alle.map((m) => (m as { id: number }).id);
    expect(ids.length).toBeGreaterThan(15);
    expect(new Set(ids).size).toBe(ids.length);
    expect(alle.filter((m) => m.type === "day")).toHaveLength(4);
    expect(alle.filter((m) => m.type === "periode")).toHaveLength(8);
  }, 30_000);

  it("koppelt een fout van een rastertaak niet aan de dag met hetzelfde nummer", async () => {
    await metVoorbeeld();
    const { result } = await nieuweHook();
    act(() => alleKlaar());
    await waitFor(() => {
      act(() => pomp());
      expect(NepWorker.alle.some((w) => w.soort("grid").length > 0)).toBe(true);
    }, { timeout: 5000 });
    act(() => result.current.vraagDag("2025-06-02"));
    expect(result.current.dagBezig).toBe(true);

    // Een rastertaak mislukt: het raster stopt, de dag niet.
    const gridTaak = NepWorker.alle.flatMap((w) => w.soort("grid"))[0] as WorkerRequest & { id: number };
    const eigenaar = NepWorker.alle.find((w) => w.soort("grid").includes(gridTaak))!;
    act(() => eigenaar.stuur({ type: "error", id: gridTaak.id, message: "raster stuk" }));
    expect(result.current.dagFout).toBeNull();
    expect(result.current.dagBezig).toBe(true);
    expect(result.current.grid?.bezig).toBe(false);
  }, 30_000);
});
