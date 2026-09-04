/**
 * De dagkiezer, getest via de échte worker.
 *
 * ── Waarom dit bestand bestaat ──────────────────────────────────────────────
 * De dagkiezer deed niets, en geen enkele test merkte dat. De oorzaak zat niet
 * in het model maar in de koppeling: de worker bewaarde de dispatches van zijn
 * laatste doorrekening, maar een resultaat kan ook uit de browsercache komen.
 * Dan had de worker nooit gerekend, kwam elke dagaanvraag uit op "er is nog
 * geen doorrekening", en werd die fout in de UI weggegooid omdat hij bij een
 * ander volgnummer hoorde. Juist ná een refresh was de kiezer dus stuk, want
 * dan komt het resultaat altijd uit de cache.
 *
 * Daarom test dit de worker zoals de browser hem aanspreekt: berichten erin,
 * berichten eruit, met `self` en `fetch` nagebootst. De eerste test is precies
 * het gedrag dat ontbrak.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Manifest } from "../lib/data/manifest";
import type { SampleDay } from "../lib/model/analysis";
import { PRESETS } from "../lib/presets";
import type { Configuration, WorkerRequest, WorkerResponse } from "../lib/worker/protocol";

const DOMAIN = "871685900000056162";

/** De berichten die de worker heeft teruggestuurd. */
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

  // De worker praat via `self`. Node heeft dat niet, dus we zetten er een
  // dubbelganger neer vóór de import; de module hangt zijn onmessage eraan.
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

function config(over: Partial<Configuration> = {}): Configuration {
  const preset = PRESETS[1]!;
  return {
    domain: DOMAIN,
    from: "2025-01-01",
    to: "2025-12-31",
    household: {
      annualGridImportKwh: 2500,
      annualGridExportKwh: 2000,
      spreadFactor: 1,
    },
    battery: { ...preset.spec, wearCostEurPerKwh: 0 },
    tariff: {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: 0,
      feedInCostEurPerKwh: 0,
      allowCurtailment: true,
    },
    investmentEur: preset.prijsEur,
    cycleLife: preset.cycleLife,
    analysisYears: 15,
    priceEscalation: 0.02,
    discountRate: 0.03,
    calendarFadePerYear: 0.015,
    residualValueEur: 0,
    useHistoricalLevy: true,
    ...over,
  };
}

/** Vraag één dag op en geef terug wat de worker antwoordde. */
async function vraagDag(datum: string, cfg = config()): Promise<SampleDay | null> {
  ontvangen = [];
  await stuur({ type: "day", id: 1, date: datum, config: cfg });
  const fout = ontvangen.find((m) => m.type === "error");
  if (fout && fout.type === "error") throw new Error(fout.message);
  const antwoord = ontvangen.find((m) => m.type === "day");
  if (!antwoord || antwoord.type !== "day") throw new Error("geen dag-antwoord");
  return antwoord.day;
}

describe("een dag opvragen zonder voorafgaande doorrekening", () => {
  it("levert de dag, ook als de worker nooit een analyse heeft gedraaid", async () => {
    // Dit is de bug: precies de situatie na een refresh met een gevulde cache.
    const dag = await vraagDag("2025-06-15");
    expect(dag).not.toBeNull();
    expect(dag!.date).toBe("2025-06-15");
    expect(dag!.socKwh.length).toBe(96);
    expect(dag!.importPrice.length).toBe(96);
  }, 60_000);

  it("meldt netjes null voor een dag buiten de periode", async () => {
    expect(await vraagDag("2019-05-04")).toBeNull();
  }, 60_000);

  it("geeft de dag met 100 kwartieren op de najaarsovergang", async () => {
    const dag = await vraagDag("2025-10-26");
    expect(dag!.startMs.length).toBe(100);
  }, 60_000);

  it("werkt ook na een wijziging in de configuratie", async () => {
    // De worker moet merken dat zijn bewaarde dispatches bij een andere
    // batterij horen en opnieuw rekenen in plaats van de oude terug te geven.
    const klein = await vraagDag("2025-06-15");
    const groot = await vraagDag(
      "2025-06-15",
      config({
        battery: { ...PRESETS[1]!.spec, capacityKwh: 20, wearCostEurPerKwh: 0 },
      }),
    );
    expect(groot!.usableCapacityKwh).toBeGreaterThan(klein!.usableCapacityKwh * 2);
  }, 120_000);
});

describe("de kerncijfers van een dag", () => {
  it("laat de besparing het verschil tussen de twee kosten zijn", async () => {
    const s = (await vraagDag("2025-06-15"))!.stats;
    expect(s.savingEur).toBeCloseTo(s.baselineCostEur - s.batteryCostEur, 9);
  }, 60_000);

  it("splitst de lading naar herkomst zonder iets kwijt te raken", async () => {
    const s = (await vraagDag("2025-06-15"))!.stats;
    expect(s.chargedFromSolarKwh + s.chargedFromGridKwh).toBeCloseTo(
      s.chargedKwh,
      9,
    );
  }, 60_000);

  it("houdt de lading binnen de bruikbare capaciteit", async () => {
    const dag = (await vraagDag("2025-06-15"))!;
    expect(dag.stats.socMaxKwh).toBeGreaterThan(0);
    expect(dag.stats.socMaxKwh).toBeLessThanOrEqual(dag.usableCapacityKwh + 1e-9);
  }, 60_000);

  it("komt op een zomerdag niet boven het optimum uit", async () => {
    const s = (await vraagDag("2025-06-15"))!.stats;
    expect(s.optimalSavingEur).not.toBeNull();
    // Het optimum kent de hele periode; per losse dag kan de rollende strategie
    // er niet bovenuit komen, op discretisatieruis na.
    expect(s.savingEur).toBeLessThanOrEqual(s.optimalSavingEur! + 0.02);
  }, 60_000);

  it("telt de afname met batterij nooit hoger dan zonder", async () => {
    const s = (await vraagDag("2025-06-15"))!.stats;
    expect(s.gridImportBatteryKwh).toBeLessThanOrEqual(
      s.gridImportBaselineKwh + 1e-9,
    );
  }, 60_000);

  it("noemt een prijsverschil dat niet negatief is", async () => {
    const s = (await vraagDag("2025-01-15"))!.stats;
    expect(s.priceMaxEurPerKwh).toBeGreaterThanOrEqual(s.priceMinEurPerKwh);
  }, 60_000);
});

describe("waar het gat met het optimum vandaan komt", () => {
  it("scheidt de prijshorizon van de verbruiksvoorspelling, en telt op tot het geheel", async () => {
    ontvangen = [];
    await stuur({ type: "analyse", id: 7, config: config() });
    const fout = ontvangen.find((m) => m.type === "error");
    if (fout && fout.type === "error") throw new Error(fout.message);
    const res = ontvangen.find((m) => m.type === "result");
    if (!res || res.type !== "result") throw new Error("geen resultaat");
    const gap = res.result.gap;
    expect(gap).not.toBeNull();

    const jaar = res.result.perYear.find((j) => j.year === gap!.year)!;
    const geheel = jaar.optimalSavingEur - jaar.realisticSavingEur;

    // De twee posten samen zijn het hele gat.
    expect(gap!.horizonCostEur + gap!.forecastCostEur).toBeCloseTo(geheel, 6);
    // En de perfecte voorspelling ligt tussen de twee uitersten in.
    expect(gap!.perfectForecastSavingEur).toBeGreaterThanOrEqual(
      gap!.realisticSavingEur - 0.01,
    );
    expect(gap!.perfectForecastSavingEur).toBeLessThanOrEqual(
      gap!.optimalSavingEur + 0.01,
    );

    /**
     * De verhouding is het antwoord op de vraag waarom de strategie het
     * optimum niet haalt: niet omdat de prijzen van morgen pas om 13:00
     * bekend worden, maar omdat zon en verbruik van morgen een verwachting
     * zijn. Het plan dat om 13:00 wordt gemaakt reikt tot morgen 24:00 en
     * wordt maar 24 uur uitgevoerd, dus er is altijd elf uur zicht voorbij de
     * uitvoering. Het weer weegt daarom zwaarder.
     */
    expect(gap!.forecastCostEur).toBeGreaterThan(gap!.horizonCostEur * 3);
  }, 120_000);
});

describe("de manifest-melding bij init", () => {
  it("stuurt het manifest zodat de UI de periode kent", async () => {
    ontvangen = [];
    await stuur({ type: "init", baseUrl: "/data" });
    const klaar = ontvangen.find((m) => m.type === "ready");
    expect(klaar).toBeDefined();
    const m = (klaar as { manifest: Manifest }).manifest;
    expect(Object.keys(m.profielen[DOMAIN]!).length).toBeGreaterThan(1);
  }, 60_000);
});

describe("de dagovergang verklaart de negatieve dagbedragen", () => {
  /**
   * Een batterij houdt zich niet aan de kalender. Op 19 december 2025 laadt hij
   * 's nachts vol en ontlaadt hij pas op de 20e: de inkoop valt op de ene dag,
   * de opbrengst op de andere. Die dag sluit daardoor negatief af, en dat is
   * geen fout van het model — het optimum met perfecte kennis maakt dezelfde
   * keuze en komt op hetzelfde bedrag uit.
   *
   * De twee dagen samen zijn positief. Wie de batterij op zulke dagen zou
   * uitschakelen, laat de opbrengst van de volgende dag liggen.
   */
  it("laat een negatieve dag zien als lading die naar de volgende dag gaat", async () => {
    const cfg = config();
    const dag19 = (await vraagDag("2025-12-19", cfg))!;
    const dag20 = (await vraagDag("2025-12-20", cfg))!;

    // De 19e kost geld en eindigt voller dan hij begon.
    expect(dag19.stats.savingEur).toBeLessThan(0);
    expect(dag19.stats.socEndKwh - dag19.stats.socStartKwh).toBeGreaterThan(0.5);
    // Op de 19e is er wel geladen maar niet ontladen.
    expect(dag19.stats.chargedKwh).toBeGreaterThan(0.5);
    expect(dag19.stats.deliveredKwh).toBeLessThan(0.01);

    // De 20e begint met die lading en levert geld op.
    expect(dag20.stats.socStartKwh).toBeCloseTo(dag19.stats.socEndKwh, 6);
    expect(dag20.stats.savingEur).toBeGreaterThan(0);

    // Samen positief: uitschakelen op zulke dagen zou geld kosten.
    expect(dag19.stats.savingEur + dag20.stats.savingEur).toBeGreaterThan(0);

    // En het bewijs dat het geen misser is: perfecte kennis doet hetzelfde.
    expect(dag19.stats.optimalSavingEur).toBeLessThan(0);
    expect(dag19.stats.optimalSavingEur!).toBeCloseTo(dag19.stats.savingEur, 1);
  }, 120_000);

  it("begint de eerste dag van het venster op een lege batterij", async () => {
    const dag = (await vraagDag("2025-01-01"))!;
    expect(dag.stats.socStartKwh).toBe(0);
  }, 60_000);
});

describe("wat er van het dak kwam", () => {
  it("geeft de teruglevering per kwartier, los van de netto uitwisseling", async () => {
    const dag = (await vraagDag("2025-06-15"))!;
    expect(dag.meterExportKwh.length).toBe(dag.residualKwh.length);
    expect(dag.meterImportKwh.length).toBe(dag.residualKwh.length);

    // De twee componenten zijn samen precies de netto reeks waarop gerekend is.
    for (let i = 0; i < dag.residualKwh.length; i++) {
      expect(dag.meterImportKwh[i]! - dag.meterExportKwh[i]!).toBeCloseTo(
        dag.residualKwh[i]!,
        9,
      );
    }

    // Op een zomerdag gaat er zon naar de meter, en meer dan het netto
    // overschot, want het huis verbruikt op datzelfde moment ook.
    const zon = dag.stats.meterExportKwh!;
    const nettoOver = dag.residualKwh.reduce((a, v) => a + Math.max(0, -v), 0);
    expect(zon).toBeGreaterThan(0.5);
    expect(zon).toBeGreaterThan(nettoOver);
  }, 60_000);

  it("levert op een winterdag vrijwel geen zon naar de meter", async () => {
    const dag = (await vraagDag("2025-12-19"))!;
    expect(dag.stats.meterExportKwh!).toBeLessThan(
      (await vraagDag("2025-06-15"))!.stats.meterExportKwh!,
    );
  }, 120_000);
});
