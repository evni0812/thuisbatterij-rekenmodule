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
 *
 * Een worker krijgt pas taken als hij `ready` heeft gemeld; tot dan blijven ze
 * in de wachtrij voor wie wel klaar is. En met een ophaaldienst beantwoordt de
 * pool de `haal`-verzoeken van de workers, zodat elk bestand één keer wordt
 * gedownload (lib/worker/ophalen.ts).
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

/**
 * Hoeveel workers zinvol zijn op deze machine: één kern vrij voor de UI.
 *
 * Op een telefoon of een zuinige laptop hoogstens twee. Elke worker houdt zijn
 * eigen profielen, prijzen en dispatches vast (tientallen MB per stuk), en een
 * toestel met 4 GB geheugen of vier kernen wint weinig met een derde en vierde
 * worker: de kernen zijn traag of worden door de browser zelf gebruikt, en het
 * geheugen raakt op. `deviceMemory` bestaat alleen in Chromium; ontbreekt het,
 * dan beslissen de kernen en de schermbreedte.
 */
export function poolGrootte(
  hardwareConcurrency = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4,
  geheugenGb: number | undefined = typeof navigator !== "undefined"
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    : undefined,
  schermBreedte: number | undefined = typeof window !== "undefined" ? window.innerWidth : undefined,
): number {
  const zuinig =
    hardwareConcurrency <= 4 ||
    (geheugenGb !== undefined && geheugenGb <= 4) ||
    (schermBreedte !== undefined && schermBreedte < 700);
  return Math.max(2, Math.min(zuinig ? 2 : 4, hardwareConcurrency - 1));
}

/** Wie de bestanden voor de workers ophaalt; zie lib/worker/ophalen.ts. */
export interface Ophaaldienst {
  haal(url: string): Promise<ArrayBuffer>;
}

export class WorkerPool {
  private readonly workers: Worker[] = [];
  /** Het id van de taak die elke worker nu doet, of null als hij vrij is. */
  private readonly huidig: (PoolTaak | null)[] = [];
  /**
   * Heeft de worker zijn manifest en kan hij werk aannemen? Een taak gaat
   * alleen naar een klare worker: die van een trage worker blijft liggen voor
   * een worker die wél klaar is, in plaats van achter zijn download te wachten.
   */
  private readonly gereed: boolean[] = [];
  /** De initialisatie van deze worker mislukte; hij doet niets meer. */
  private readonly kapot: boolean[] = [];
  private wachtrij: PoolTaak[] = [];
  private gestopt = false;

  constructor(
    aantal: number,
    maak: () => Worker,
    private readonly onBericht: (msg: WorkerResponse, worker: number) => void,
    private readonly onFout: (bericht: string) => void,
    /** Zonder dienst haalt elke worker zijn bestanden zelf op. */
    private readonly dienst: Ophaaldienst | null = null,
  ) {
    for (let i = 0; i < aantal; i++) {
      const w = maak();
      w.onmessage = (event: MessageEvent<WorkerResponse>) => this.ontvang(event.data, i);
      w.onerror = (event: ErrorEvent) => this.onFout(event.message || "de rekenmodule kon niet starten");
      this.workers.push(w);
      this.huidig.push(null);
      this.gereed.push(false);
      this.kapot.push(false);
    }
  }

  get aantal(): number {
    return this.workers.length;
  }

  /** Stuur `init` naar alle workers; met een ophaaldienst halen ze hun bestanden via de hoofdthread. */
  init(baseUrl: string): void {
    for (const w of this.workers) {
      w.postMessage({ type: "init", baseUrl, viaHoofdthread: this.dienst !== null } satisfies WorkerRequest);
    }
  }

  /** Is deze worker klaar voor werk? */
  isGereed(worker: number): boolean {
    return this.gereed[worker] === true;
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
    if (msg.type === "haal") {
      this.bedien(worker, msg.verzoek, msg.url);
      return;
    }
    if (msg.type === "ready") {
      this.gereed[worker] = true;
      this.onBericht(msg, worker);
      this.verdeel();
      return;
    }
    if (msg.type === "error" && msg.id === null) {
      // De initialisatie van deze worker is mislukt. Taken die alleen hij mocht
      // doen gaan naar wie er wel is; de aanroeper beslist of dit fataal is.
      this.kapot[worker] = true;
      for (const t of this.wachtrij) if (t.worker === worker) delete t.worker;
      this.onBericht(msg, worker);
      this.verdeel();
      return;
    }
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

  /** Beantwoord een `haal` van een worker met een eigen kopie van de bytes. */
  private bedien(worker: number, verzoek: number, url: string): void {
    const w = this.workers[worker];
    if (!w || !this.dienst) return;
    this.dienst.haal(url).then(
      (buffer) => {
        if (!this.gestopt) w.postMessage({ type: "gehaald", verzoek, buffer } satisfies WorkerRequest, [buffer]);
      },
      (err: unknown) => {
        if (!this.gestopt) {
          w.postMessage({
            type: "gehaald",
            verzoek,
            fout: err instanceof Error ? err.message : String(err),
          } satisfies WorkerRequest);
        }
      },
    );
  }

  private verdeel(): void {
    for (let w = 0; w < this.workers.length && this.wachtrij.length > 0; w++) {
      if (this.huidig[w] !== null || !this.gereed[w] || this.kapot[w]) continue;
      const index = this.wachtrij.findIndex((t) => t.worker === undefined || t.worker === w);
      if (index < 0) continue;
      const [taak] = this.wachtrij.splice(index, 1);
      this.huidig[w] = taak!;
      this.workers[w]!.postMessage(taak!.bericht, taak!.transfer ?? []);
    }
  }
}
