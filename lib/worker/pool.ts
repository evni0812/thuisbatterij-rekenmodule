/**
 * Een pool van rekenworkers, aangestuurd vanaf de hoofdthread.
 *
 * De doorrekening bestaat uit onafhankelijke stukken: elk profieljaar apart,
 * twee curvepunten, één run met perfecte voorspelling, en de rijen van het
 * raster. Die stukken kunnen naast elkaar op meerdere kernen draaien; alleen
 * het samenvoegen hoeft achter elkaar. Deze klasse verdeelt de stukken over
 * de workers en meldt de antwoorden terug; wat er met de antwoorden gebeurt,
 * bepaalt de aanroeper (lib/useAnalysis.ts).
 *
 * Worker 0 is de hoofdworker: die krijgt het samenvoegen en bewaart daarna
 * de dispatches voor de dagkiezer. Dag- en periodeaanvragen gaan er direct
 * naartoe, buiten de wachtrij om, zodat de worker zelf kan bepalen welke van
 * een reeks snelle aanvragen hij nog beantwoordt.
 *
 * Een pooltaak is klaar als de worker `{ type: "klaar", id }` stuurt — ook na
 * een fout of een annulering. Zonder dat signaal zou een worker die zijn
 * rasterrijen halverwege liet vallen voor altijd bezet lijken.
 */

import type { WorkerRequest, WorkerResponse } from "./protocol";

export interface PoolTaak {
  bericht: WorkerRequest & { id: number };
  /** Bij elkaar horende taken; annuleren gaat per groep. */
  groep: number;
  /** Alleen deze worker mag hem doen (bijvoorbeeld de hoofdworker). */
  worker?: number;
  /** ArrayBuffers die zonder kopie mee mogen. */
  transfer?: Transferable[];
}

/** Hoeveel workers zinvol zijn op deze machine: één kern vrij voor de UI. */
export function poolGrootte(hardwareConcurrency = navigator.hardwareConcurrency ?? 4): number {
  return Math.max(2, Math.min(4, hardwareConcurrency - 1));
}

export class WorkerPool {
  private readonly workers: Worker[] = [];
  /** Het id van de taak die elke worker nu doet, of null als hij vrij is. */
  private readonly huidig: (PoolTaak | null)[] = [];
  private wachtrij: PoolTaak[] = [];
  private gestopt = false;

  constructor(
    aantal: number,
    maak: () => Worker,
    private readonly onBericht: (msg: WorkerResponse, worker: number) => void,
    private readonly onFout: (bericht: string) => void,
  ) {
    for (let i = 0; i < aantal; i++) {
      const w = maak();
      w.onmessage = (event: MessageEvent<WorkerResponse>) => this.ontvang(event.data, i);
      w.onerror = (event: ErrorEvent) => this.onFout(event.message || "de rekenmodule kon niet starten");
      this.workers.push(w);
      this.huidig.push(null);
    }
  }

  get aantal(): number {
    return this.workers.length;
  }

  /** Stuur `init` naar alle workers; elk laadt zijn eigen manifest. */
  init(baseUrl: string): void {
    for (const w of this.workers) w.postMessage({ type: "init", baseUrl } satisfies WorkerRequest);
  }

  /** Zet een taak in de wachtrij en start hem zodra er een worker vrij is. */
  plaats(taak: PoolTaak): void {
    if (this.gestopt) return;
    this.wachtrij.push(taak);
    this.verdeel();
  }

  /** Haal alle wachtende taken van deze groep weg; lopende taken lopen uit. */
  annuleer(groep: number): void {
    this.wachtrij = this.wachtrij.filter((t) => t.groep !== groep);
  }

  /** Bericht buiten de wachtrij om, bijvoorbeeld een dag of een annulering. */
  postDirect(worker: number, msg: WorkerRequest, transfer: Transferable[] = []): void {
    if (this.gestopt) return;
    this.workers[worker]?.postMessage(msg, transfer);
  }

  /** Naar alle workers tegelijk, buiten de wachtrij om. */
  postAlle(msg: WorkerRequest): void {
    if (this.gestopt) return;
    for (const w of this.workers) w.postMessage(msg);
  }

  /** Is deze worker met een taak bezig? */
  bezig(worker: number): boolean {
    return this.huidig[worker] !== null;
  }

  terminate(): void {
    this.gestopt = true;
    this.wachtrij = [];
    for (const w of this.workers) w.terminate();
  }

  private ontvang(msg: WorkerResponse, worker: number): void {
    if (msg.type === "klaar") {
      const lopend = this.huidig[worker];
      if (lopend && lopend.bericht.id === msg.id) {
        this.huidig[worker] = null;
        this.verdeel();
      }
      return;
    }
    this.onBericht(msg, worker);
  }

  private verdeel(): void {
    for (let w = 0; w < this.workers.length && this.wachtrij.length > 0; w++) {
      if (this.huidig[w] !== null) continue;
      const index = this.wachtrij.findIndex((t) => t.worker === undefined || t.worker === w);
      if (index < 0) continue;
      const [taak] = this.wachtrij.splice(index, 1);
      this.huidig[w] = taak!;
      this.workers[w]!.postMessage(taak!.bericht, taak!.transfer ?? []);
    }
  }
}
