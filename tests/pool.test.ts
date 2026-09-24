/**
 * De parallelle weg moet exact hetzelfde antwoord geven als de doorlopende.
 *
 * Twee lagen: de pool zelf (met nepworkers: wachtrij, voorkeurworker, `klaar`,
 * annuleren) en het protocol door de échte worker (vensters, curvepunten,
 * perfecte voorspelling, samenvoegen), vergeleken met `runAnalysis` op
 * dezelfde invoer.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
import { Gegevensdeler } from "../lib/worker/ophalen";
import { verwachteSha256, type Manifest } from "../lib/data/manifest";
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

  function maak({ gereed = true } = {}) {
    NepWorker.alle = [];
    const berichten: { msg: WorkerResponse; worker: number }[] = [];
    const pool = new WorkerPool(3, () => new NepWorker() as unknown as Worker, (msg, worker) => berichten.push({ msg, worker }), () => {});
    if (gereed) for (const w of NepWorker.alle) w.stuur({ type: "ready", manifest: {} });
    berichten.length = 0;
    return { pool, berichten, workers: NepWorker.alle };
  }
  const cfg = maakConfiguratie(STANDAARD);
  const venster = (id: number, groep = 1): WorkerRequest & { id: number } => ({
    type: "venster", id, groep, config: cfg, jaarIndex: 0, metOptimum: true,
  });

  it("kiest voor elke machine minstens twee en hoogstens vier workers", () => {
    expect(poolGrootte(1, 8, 1280)).toBe(2);
    expect(poolGrootte(2, 8, 1280)).toBe(2);
    expect(poolGrootte(6, 8, 1280)).toBe(4);
    expect(poolGrootte(8, 8, 1280)).toBe(4);
    expect(poolGrootte(64, undefined, undefined)).toBe(4);
  });

  it("houdt het op een telefoon of zuinig toestel bij twee", () => {
    expect(poolGrootte(4, 8, 1280)).toBe(2); // vier kernen
    expect(poolGrootte(8, 4, 1280)).toBe(2); // 4 GB geheugen
    expect(poolGrootte(8, 8, 390)).toBe(2); // smal scherm
    expect(poolGrootte(8, undefined, 1280)).toBe(4); // geen deviceMemory (Safari, Firefox)
  });

  it("geeft een worker pas werk als hij zijn manifest heeft", () => {
    const { pool, workers } = maak({ gereed: false });
    pool.plaats({ groep: 1, bericht: venster(1) });
    pool.plaats({ groep: 1, bericht: venster(2) });
    expect(workers.map((w) => w.ontvangen.length)).toEqual([0, 0, 0]);
    // Worker 2 is als eerste klaar en krijgt de eerste taak; de rest wacht.
    workers[2]!.stuur({ type: "ready", manifest: {} });
    expect(workers[2]!.ontvangen.map((m) => (m as { id: number }).id)).toEqual([1]);
    workers[0]!.stuur({ type: "ready", manifest: {} });
    expect(workers[0]!.ontvangen.map((m) => (m as { id: number }).id)).toEqual([2]);
    expect(pool.isGereed(1)).toBe(false);
  });

  it("geeft de taken van een worker waarvan de initialisatie mislukte aan de anderen", () => {
    const { pool, workers, berichten } = maak({ gereed: false });
    workers[0]!.stuur({ type: "ready", manifest: {} });
    pool.plaats({ groep: 1, bericht: venster(1) }); // naar worker 0
    pool.plaats({ groep: 1, worker: 1, bericht: venster(2) }); // alleen voor worker 1
    workers[1]!.stuur({ type: "error", id: null, message: "manifest niet gevonden" });
    // De aanroeper hoort het (en beslist of het fataal is) …
    expect(berichten.map((b) => [b.msg.type, b.worker])).toEqual([["ready", 0], ["error", 1]]);
    // … en taak 2 gaat naar de eerste worker die vrij is.
    workers[0]!.stuur({ type: "klaar", id: 1 });
    expect(workers[0]!.ontvangen.map((m) => (m as { id: number }).id)).toEqual([1, 2]);
    expect(workers[1]!.ontvangen).toHaveLength(0);
  });

  it("beantwoordt een `haal` via de ophaaldienst, met een eigen kopie per worker", async () => {
    NepWorker.alle = [];
    const gevraagd: string[] = [];
    const bron = new Uint8Array([1, 2, 3, 4]).buffer;
    const dienst = {
      haal: async (url: string) => {
        gevraagd.push(url);
        return bron.slice(0);
      },
    };
    const pool = new WorkerPool(2, () => new NepWorker() as unknown as Worker, () => {}, () => {}, dienst);
    const [a, b] = NepWorker.alle;
    pool.init("/data");
    expect(a!.ontvangen[0]).toEqual({ type: "init", baseUrl: "/data", viaHoofdthread: true });
    a!.stuur({ type: "haal", verzoek: 7, url: "/data/prices-2025.bin" });
    b!.stuur({ type: "haal", verzoek: 7, url: "/data/prices-2025.bin" });
    await new Promise((r) => setTimeout(r, 0));
    const antwoordA = a!.ontvangen.find((m) => m.type === "gehaald") as { verzoek: number; buffer: ArrayBuffer };
    const antwoordB = b!.ontvangen.find((m) => m.type === "gehaald") as { verzoek: number; buffer: ArrayBuffer };
    expect(antwoordA.verzoek).toBe(7);
    expect([...new Uint8Array(antwoordB.buffer)]).toEqual([1, 2, 3, 4]);
    expect(antwoordA.buffer).not.toBe(antwoordB.buffer);
    expect(gevraagd).toEqual(["/data/prices-2025.bin", "/data/prices-2025.bin"]);
  });

  it("zet de hoofddoorrekening vóór het achtergrondwerk in de rij, in volgorde van plaatsen", () => {
    const { pool, workers } = maak();
    // Drie workers bezet, daarna twee achtergrondtaken en twee met voorrang.
    for (const id of [1, 2, 3]) pool.plaats({ groep: 1, bericht: venster(id) });
    pool.plaats({ groep: 2, bericht: venster(10, 2) });
    pool.plaats({ groep: 2, bericht: venster(11, 2) });
    pool.plaats({ groep: 3, voorrang: true, bericht: venster(20, 3) });
    pool.plaats({ groep: 3, voorrang: true, bericht: venster(21, 3) });
    const volgende: number[] = [];
    for (const w of [0, 1, 2, 0]) {
      const lopend = workers[w]!.ontvangen.at(-1) as { id: number };
      workers[w]!.stuur({ type: "klaar", id: lopend.id });
      volgende.push((workers[w]!.ontvangen.at(-1) as { id: number }).id);
    }
    expect(volgende).toEqual([20, 21, 10, 11]);
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

describe("de gedeelde ophaler", () => {
  /** Een nep-fetch die bijhoudt wat er gevraagd is. */
  function nepFetch(opties: { status?: (url: string) => number; traag?: boolean } = {}) {
    const urls: string[] = [];
    const inits: (RequestInit | undefined)[] = [];
    const f = (url: string, init?: RequestInit) => {
      urls.push(url);
      inits.push(init);
      if (opties.traag) {
        return new Promise<Response>((_, faal) => {
          init?.signal?.addEventListener("abort", () => faal(new DOMException("afgebroken", "AbortError")));
        });
      }
      const status = opties.status?.(url) ?? 200;
      const body = url.includes("manifest.json")
        ? new TextEncoder().encode(JSON.stringify({ gegenereerd: "2026-09-16T19:23:33Z" }))
        : new Uint8Array([9, 8, 7]);
      return Promise.resolve(new Response(status === 200 ? body : null, { status }));
    };
    return { f, urls, inits };
  }

  it("haalt elk bestand één keer, met de dataversie in de URL, en geeft elke vrager een kopie", async () => {
    const { f, urls, inits } = nepFetch();
    const deler = new Gegevensdeler("/data", f);
    const [a, b] = await Promise.all([deler.haal("/data/prices-2025.bin"), deler.haal("/data/prices-2025.bin")]);
    await deler.haal("/data/manifest.json");
    expect(urls).toEqual(["/data/manifest.json", "/data/prices-2025.bin?v=2026-09-16T19%3A23%3A33Z"]);
    // Het manifest wordt altijd opnieuw gevalideerd; de bestanden niet.
    expect(inits[0]?.cache).toBe("no-cache");
    expect(a).not.toBe(b);
    expect([...new Uint8Array(b)]).toEqual([9, 8, 7]);
  });

  it("meldt een ontbrekend manifest als fout", async () => {
    const { f } = nepFetch({ status: (u) => (u.includes("manifest") ? 404 : 200) });
    await expect(new Gegevensdeler("/data", f).manifest()).rejects.toThrow("manifest niet gevonden: HTTP 404");
  });

  it("geeft het op na de time-out in plaats van eeuwig te wachten", async () => {
    const { f } = nepFetch({ traag: true });
    const deler = new Gegevensdeler("/data", f, { manifest: 20, bestand: 20 });
    await expect(deler.manifest()).rejects.toThrow(/duurde langer dan/);
  });

  it("probeert een mislukt bestand bij de volgende vraag opnieuw", async () => {
    let fout = true;
    const { f, urls } = nepFetch({ status: (u) => (u.includes(".bin") && fout ? 503 : 200) });
    const deler = new Gegevensdeler("/data", f);
    await expect(deler.haal("/data/co2-2025.bin")).rejects.toThrow("HTTP 503");
    fout = false;
    await expect(deler.haal("/data/co2-2025.bin")).resolves.toBeInstanceOf(ArrayBuffer);
    expect(urls.filter((u) => u.includes("co2")).length).toBe(2);
  });
});

describe("de controlesom uit het manifest", () => {
  const INHOUD = new Uint8Array([9, 8, 7]);
  const GOED = createHash("sha256").update(INHOUD).digest("hex");

  function metSom(som: string, teller: { n: number } = { n: 0 }): typeof fetch {
    return ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("manifest.json")) {
        const manifest = {
          gegenereerd: "2026-09-16T19:23:33Z",
          prijzen: { "2025": { sha256: som } },
          co2: { "2025": { sha256: GOED } },
          profielen: { "871685900000056162": { "2025": { sha256: som } } },
          profielen_zonder: { "871685900000056162": { "2025": { sha256: GOED } } },
        };
        return Promise.resolve(new Response(JSON.stringify(manifest)));
      }
      teller.n++;
      return Promise.resolve(new Response(INHOUD));
    }) as typeof fetch;
  }

  it("laat een bestand door waarvan de sha256 klopt", async () => {
    const deler = new Gegevensdeler("/data", metSom(GOED));
    const bytes = await deler.haal("/data/prices-2025.bin");
    expect([...new Uint8Array(bytes)]).toEqual([9, 8, 7]);
    await expect(deler.haal("/data/profile-871685900000056162-2025-azi.bin")).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("weigert een bestand waarvan de sha256 afwijkt, met een fout die zegt wat er mis is", async () => {
    const teller = { n: 0 };
    const deler = new Gegevensdeler("/data", metSom("0".repeat(64), teller));
    await expect(deler.haal("/data/prices-2025.bin")).rejects.toThrow(
      /prices-2025\.bin is beschadigd.*controlesom klopt niet met het manifest/,
    );
    await expect(deler.haal("/data/profile-871685900000056162-2025.bin")).rejects.toThrow(/controlesom/);
    // Een fout blijft niet in de deler hangen: de volgende vraag haalt opnieuw.
    await expect(deler.haal("/data/prices-2025.bin")).rejects.toThrow(/controlesom/);
    expect(teller.n).toBe(3);
    // Een bestand met een kloppende som in hetzelfde manifest gaat gewoon door.
    await expect(deler.haal("/data/co2-2025.bin")).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("controleert niet als het manifest geen som kent", async () => {
    const deler = new Gegevensdeler("/data", metSom(GOED));
    await expect(deler.haal("/data/co2-2024.bin")).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("vindt de som bij elke soort bestand", () => {
    const m = {
      prijzen: { "2025": { sha256: "p" } },
      co2: { "2024": { sha256: "c" } },
      profielen: { "123": { "2023": { sha256: "a" } } },
      profielen_zonder: { "123": { "2023": { sha256: "z" } } },
    } as unknown as Manifest;
    expect(verwachteSha256(m, "/data/prices-2025.bin?v=x")).toBe("p");
    expect(verwachteSha256(m, "/data/co2-2024.bin")).toBe("c");
    expect(verwachteSha256(m, "/data/profile-123-2023.bin")).toBe("a");
    expect(verwachteSha256(m, "/data/profile-123-2023-azi.bin")).toBe("z");
    expect(verwachteSha256(m, "/data/manifest.json")).toBeUndefined();
  });
});

describe("een worker die werk krijgt vóór zijn manifest binnen is", () => {
  const cfg = maakConfiguratie({ ...STANDAARD, van: "2025-01-01", tot: "2025-12-31" });

  async function nieuweWorker(fetchFn: typeof fetch) {
    vi.resetModules();
    globalThis.fetch = fetchFn;
    const ontvangen: WorkerResponse[] = [];
    const nep = {
      onmessage: null as ((e: { data: WorkerRequest }) => Promise<void>) | null,
      postMessage: (msg: WorkerResponse) => ontvangen.push(msg),
    };
    (globalThis as unknown as { self: typeof nep }).self = nep;
    await import("../lib/worker/sim.worker");
    return { ontvangen, stuur: (msg: WorkerRequest) => nep.onmessage!({ data: msg }) };
  }

  it("wacht op de initialisatie in plaats van te falen", async () => {
    // Regressie: een helper die zijn taak kreeg terwijl zijn manifest nog
    // onderweg was, gooide "worker is nog niet geïnitialiseerd", en omdat die
    // fout buiten de pooltaak viel kwam er nooit een `klaar`.
    let laatGaan!: () => void;
    const poort = new Promise<void>((r) => (laatGaan = r));
    const { ontvangen, stuur } = await nieuweWorker((async (input: RequestInfo | URL) => {
      if (String(input).endsWith("manifest.json")) await poort;
      return haal(input);
    }) as typeof fetch);
    const init = stuur({ type: "init", baseUrl: "/data" });
    const taak = stuur({ type: "quick", id: 5, groep: 1, config: cfg, jaarIndex: 0, fraction: 0.5 });
    await new Promise((r) => setTimeout(r, 20));
    expect(ontvangen).toEqual([]);
    laatGaan();
    await Promise.all([init, taak]);
    expect(ontvangen.map((m) => m.type).sort()).toEqual(["klaar", "quick", "ready"]);
  }, 60_000);

  it("meldt een mislukte initialisatie, en geeft een pooltaak daarna toch vrij", async () => {
    const { ontvangen, stuur } = await nieuweWorker((async () => ({ ok: false, status: 404 }) as Response) as typeof fetch);
    await stuur({ type: "init", baseUrl: "/data" });
    expect(ontvangen).toEqual([{ type: "error", id: null, message: "manifest niet gevonden: HTTP 404" }]);
    await stuur({ type: "venster", id: 6, groep: 1, config: cfg, jaarIndex: 0, metOptimum: false });
    expect(ontvangen.slice(1)).toEqual([
      { type: "error", id: 6, message: "manifest niet gevonden: HTTP 404" },
      { type: "klaar", id: 6 },
    ]);
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
    // Een eigen exemplaar van de worker: de tests hierboven laden er ook een.
    vi.resetModules();
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
