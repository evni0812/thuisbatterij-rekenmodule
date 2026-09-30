/**
 * Een worker die crasht geeft zijn taak vrij en wordt vervangen. Zonder dat bleef
 * `huidig[w]` gevuld: de worker leek voor altijd bezet en zijn taak eeuwig bezig.
 */
import { describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { MAX_HERSTARTS, REKENFOUT, WorkerPool, type PoolFase } from "../lib/worker/pool";
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
  crash(message = "boem"): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const cfg = maakConfiguratie(STANDAARD);
const venster = (id: number, groep = 1): WorkerRequest & { id: number } => ({
  type: "venster", id, groep, config: cfg, jaarIndex: 0, metOptimum: true,
});
const ids = (w: NepWorker) => w.ontvangen.filter((m) => m.type !== "init").map((m) => (m as { id: number }).id);

function maak({ gereed = true, aantal = 3 } = {}) {
  NepWorker.alle = [];
  const berichten: { msg: WorkerResponse; worker: number }[] = [];
  const fouten: { bericht: string; fase: PoolFase; worker: number }[] = [];
  const pool = new WorkerPool(
    aantal,
    () => new NepWorker() as unknown as Worker,
    (msg, worker) => berichten.push({ msg, worker }),
    (bericht, fase, worker) => fouten.push({ bericht, fase, worker }),
  );
  pool.init("/data");
  if (gereed) for (const w of [...NepWorker.alle]) w.stuur({ type: "ready", manifest: {} });
  berichten.length = 0;
  return { pool, berichten, fouten, oorspronkelijk: [...NepWorker.alle] };
}

describe("een worker die crasht na een geslaagde initialisatie", () => {
  it("sluit zijn lopende taak af als fout, in plaats van hem eeuwig bezig te laten", () => {
    const { pool, berichten, fouten, oorspronkelijk } = maak();
    pool.plaats({ groep: 1, bericht: venster(7) });
    expect(pool.bezig(0)).toBe(true);

    oorspronkelijk[0]!.crash("out of memory");

    expect(berichten).toEqual([{ msg: { type: "error", id: 7, message: REKENFOUT }, worker: 0 }]);
    expect(fouten).toEqual([{ bericht: REKENFOUT, fase: "runtime", worker: 0 }]);
    expect(pool.bezig(0)).toBe(false);
  });

  it("vervangt de worker, initialiseert de nieuwe en negeert de oude", () => {
    const { pool, berichten, oorspronkelijk } = maak();
    pool.plaats({ groep: 1, bericht: venster(1) });
    const oud = oorspronkelijk[0]!;
    oud.crash();

    expect(oud.beeindigd).toBe(true);
    expect(NepWorker.alle).toHaveLength(4);
    const nieuw = NepWorker.alle[3]!;
    expect(nieuw.ontvangen[0]).toMatchObject({ type: "init", baseUrl: "/data" });
    expect(pool.isGereed(0)).toBe(false);

    // Een laat bericht van de oude worker hoort er niet meer bij.
    berichten.length = 0;
    oud.stuur({ type: "klaar", id: 1 });
    oud.stuur({ type: "error", id: 1, message: "laat" });
    expect(berichten).toHaveLength(0);

    // De nieuwe krijgt weer werk zodra hij `ready` meldt.
    pool.plaats({ groep: 1, worker: 0, bericht: venster(2) });
    expect(ids(nieuw)).toEqual([]);
    nieuw.stuur({ type: "ready", manifest: {} });
    expect(ids(nieuw)).toEqual([2]);
    expect(pool.isGereed(0)).toBe(true);
  });

  it("laat de rest van de wachtrij op de andere workers doorlopen", () => {
    const { pool, oorspronkelijk } = maak();
    for (let i = 1; i <= 5; i++) pool.plaats({ groep: 1, bericht: venster(i) });
    // 1, 2 en 3 lopen; 4 en 5 wachten.
    expect(oorspronkelijk.map(ids)).toEqual([[1], [2], [3]]);
    oorspronkelijk[0]!.crash();
    oorspronkelijk[1]!.stuur({ type: "klaar", id: 2 });
    expect(ids(oorspronkelijk[1]!)).toEqual([2, 4]);
    oorspronkelijk[2]!.stuur({ type: "klaar", id: 3 });
    expect(ids(oorspronkelijk[2]!)).toEqual([3, 5]);
  });

  it("meldt een crash van een idle worker zonder foutbericht voor een taak", () => {
    const { pool, berichten, fouten, oorspronkelijk } = maak();
    oorspronkelijk[1]!.crash();
    expect(berichten).toEqual([]);
    expect(fouten).toEqual([{ bericht: REKENFOUT, fase: "runtime", worker: 1 }]);
    expect(pool.heeftWerkers()).toBe(true);
  });

  it("behandelt een onleesbaar bericht (messageerror) als een crash", () => {
    const { pool, berichten, fouten, oorspronkelijk } = maak();
    pool.plaats({ groep: 1, bericht: venster(9) });
    oorspronkelijk[0]!.onmessageerror?.({} as MessageEvent);
    expect(berichten).toEqual([{ msg: { type: "error", id: 9, message: REKENFOUT }, worker: 0 }]);
    expect(fouten.map((f) => f.fase)).toEqual(["runtime"]);
    expect(oorspronkelijk[0]!.beeindigd).toBe(true);
    expect(pool.bezig(0)).toBe(false);
  });

  it("geeft een worker op die te vaak crasht, en houdt zijn vaste taken niet vast", () => {
    const { pool, oorspronkelijk } = maak({ aantal: 2 });
    let huidig = oorspronkelijk[1]!;
    for (let i = 0; i < MAX_HERSTARTS; i++) {
      huidig.crash();
      huidig = NepWorker.alle[NepWorker.alle.length - 1]!;
      huidig.stuur({ type: "ready", manifest: {} });
    }
    expect(NepWorker.alle).toHaveLength(2 + MAX_HERSTARTS);
    pool.plaats({ groep: 1, worker: 1, bericht: venster(1) });
    expect(ids(huidig)).toEqual([1]);
    // Nog één crash: geen nieuwe worker meer, en de taak die alleen hij mocht doen gaat naar 0.
    huidig.crash();
    expect(NepWorker.alle).toHaveLength(2 + MAX_HERSTARTS);
    expect(pool.isGereed(1)).toBe(false);
    pool.plaats({ groep: 1, worker: 1, bericht: venster(2) });
    expect(ids(oorspronkelijk[0]!)).toEqual([2]);
    expect(pool.heeftWerkers()).toBe(true);
  });

  it("meldt dat er geen werkers meer zijn als alle workers zijn opgegeven", () => {
    const { pool, oorspronkelijk } = maak({ aantal: 2 });
    const laatste = [oorspronkelijk[0]!, oorspronkelijk[1]!];
    for (let i = 0; i <= MAX_HERSTARTS; i++) {
      for (let k = 0; k < 2; k++) {
        laatste[k]!.crash();
        const nieuw = NepWorker.alle[NepWorker.alle.length - 1]!;
        if (i < MAX_HERSTARTS) {
          nieuw.stuur({ type: "ready", manifest: {} });
          laatste[k] = nieuw;
        }
      }
    }
    expect(pool.heeftWerkers()).toBe(false);
  });
});

describe("een worker die crasht tijdens het opstarten", () => {
  it("is een initfout: geen vervanging, en zijn vaste taken gaan naar de anderen", () => {
    const { pool, fouten, oorspronkelijk } = maak({ gereed: false });
    oorspronkelijk[0]!.stuur({ type: "ready", manifest: {} });
    pool.plaats({ groep: 1, worker: 1, bericht: venster(1) });
    oorspronkelijk[1]!.crash("kon script niet laden");
    expect(fouten).toEqual([{ bericht: "kon script niet laden", fase: "init", worker: 1 }]);
    expect(NepWorker.alle).toHaveLength(3);
    expect(ids(oorspronkelijk[0]!)).toEqual([1]);
    expect(pool.heeftWerkers()).toBe(true);
  });

  it("geeft een lege melding een leesbare tekst", () => {
    const { fouten, oorspronkelijk } = maak({ gereed: false });
    oorspronkelijk[0]!.onerror?.({ message: "" } as ErrorEvent);
    expect(fouten[0]?.bericht).toMatch(/kon niet starten/);
  });
});

describe("een gestopte pool", () => {
  it("reageert niet meer op crashes", () => {
    const { pool, fouten, oorspronkelijk } = maak();
    const w = oorspronkelijk[0]!;
    pool.terminate();
    w.onerror?.({ message: "laat" } as ErrorEvent);
    expect(fouten).toEqual([]);
    expect(NepWorker.alle).toHaveLength(3);
  });
});
