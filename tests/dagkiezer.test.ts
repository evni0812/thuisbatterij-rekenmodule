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
    calendarLifeYears: preset.kalenderLevensduurJaren,
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
   * Een batterij houdt zich niet aan de kalender. Op 9 november 2025 laadt hij
   * 's nachts en ontlaadt hij pas op de 10e: de inkoop valt op de ene dag, de
   * opbrengst op de andere. Die dag sluit daardoor negatief af, en dat is geen
   * fout van het model — het optimum met perfecte kennis maakt dezelfde keuze
   * en sluit die dag ook negatief af.
   *
   * De twee dagen samen zijn positief. Wie de batterij op zulke dagen zou
   * uitschakelen, laat de opbrengst van de volgende dag liggen.
   *
   * Dit voorbeeld stond eerder op 19 en 20 december. Sinds de planner met de
   * volle slijtageprijs rekent, laat hij die dagen liggen: de marge dekte de
   * slijtage niet. Daarna stond het op 23 en 24 november, tot de HomeWizard
   * op 80% rondgang kwam en de eindwaarde van het plan de slijtage meetelde.
   */
  it("laat een negatieve dag zien als lading die naar de volgende dag gaat", async () => {
    const cfg = config();
    const dag23 = (await vraagDag("2025-11-09", cfg))!;
    const dag24 = (await vraagDag("2025-11-10", cfg))!;

    // De 9e kost geld en eindigt voller dan hij begon.
    expect(dag23.stats.savingEur).toBeLessThan(0);
    expect(dag23.stats.socEndKwh - dag23.stats.socStartKwh).toBeGreaterThan(0.5);
    // Op de 9e is er wel geladen maar niet ontladen.
    expect(dag23.stats.chargedKwh).toBeGreaterThan(0.5);
    expect(dag23.stats.deliveredKwh).toBeLessThan(0.01);

    // De 10e begint met die lading en levert geld op.
    expect(dag24.stats.socStartKwh).toBeCloseTo(dag23.stats.socEndKwh, 6);
    expect(dag24.stats.savingEur).toBeGreaterThan(0);

    // Samen positief: uitschakelen op zulke dagen zou geld kosten.
    expect(dag23.stats.savingEur + dag24.stats.savingEur).toBeGreaterThan(0);

    // En het bewijs dat het geen misser is: perfecte kennis laadt ook op de
    // 9e voor de 10e, sluit die dag ook negatief af en is over de twee dagen
    // samen ook positief.
    expect(dag23.stats.optimalSavingEur).toBeLessThan(0);
    expect(dag23.stats.optimalSavingEur! + dag24.stats.optimalSavingEur!).toBeGreaterThan(0);
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

describe("het resultaat over een periode via de worker", () => {
  it("telt een week per uur op uit de bewaarde jaardispatch", async () => {
    ontvangen = [];
    await stuur({ type: "periode", id: 21, config: config(), van: "2025-12-15", tot: "2025-12-21", resolutie: "uur", kanaal: "week" });
    const fout = ontvangen.find((m) => m.type === "error");
    if (fout && fout.type === "error") throw new Error(fout.message);
    const res = ontvangen.find((m) => m.type === "periode");
    if (!res || res.type !== "periode") throw new Error("geen periode-antwoord");
    expect(res.id).toBe(21);
    expect(res.periode.vakken.length).toBe(168);
    expect(res.periode.totaal.wearCostEur).toBeGreaterThan(0);
    // De som van de uren is de som van de dagen.
    ontvangen = [];
    await stuur({ type: "periode", id: 22, config: config(), van: "2025-12-15", tot: "2025-12-21", resolutie: "dag", kanaal: "verloop" });
    const dagen = ontvangen.find((m) => m.type === "periode");
    if (!dagen || dagen.type !== "periode") throw new Error("geen periode-antwoord");
    expect(dagen.periode.vakken.length).toBe(7);
    expect(dagen.periode.totaal.savingEur).toBeCloseTo(res.periode.totaal.savingEur, 6);
  }, 60_000);

  it("beantwoordt van een reeks snel opeenvolgende periodevragen alleen de laatste", async () => {
    /**
     * De UI kan sneller vragen dan de worker rekent, bijvoorbeeld bij het
     * bladeren door maanden. De worker registreert elke aanvraag, geeft de
     * beurt terug aan de berichtenlus en rekent alleen als hij daarna nog de
     * laatste is. Eerder werden ze alle drie uitgerekend, achter elkaar.
     */
    ontvangen = [];
    const cfg = config();
    const vragen = [
      stuur({ type: "periode", id: 31, config: cfg, van: "2025-03-01", tot: "2025-03-31", resolutie: "dag", kanaal: "verloop" }),
      stuur({ type: "periode", id: 32, config: cfg, van: "2025-04-01", tot: "2025-04-30", resolutie: "dag", kanaal: "verloop" }),
      stuur({ type: "periode", id: 33, config: cfg, van: "2025-05-01", tot: "2025-05-31", resolutie: "dag", kanaal: "verloop" }),
    ];
    await Promise.all(vragen);
    const antwoorden = ontvangen.filter((m) => m.type === "periode");
    expect(antwoorden.map((m) => (m.type === "periode" ? m.id : -1))).toEqual([33]);
    const res = antwoorden[0]!;
    if (res.type !== "periode") throw new Error("geen periode-antwoord");
    expect(res.periode.vakken[0]!.dag).toBe("2025-05-01");
  }, 60_000);

  it("geeft de slijtage van een dag mee in de dagcijfers", async () => {
    // Een dag waarop de batterij levert: 3 december 2025 gaat hij van vol naar leeg.
    const dag = (await vraagDag("2025-12-03"))!;
    expect(dag.stats.wearCostEur).toBeGreaterThan(0);
    expect(dag.stats.wearCostEur).toBeLessThan(dag.stats.deliveredKwh);
  }, 60_000);
});

describe("opwarmen na een treffer in cache of preload", () => {
  /**
   * Na zo'n treffer heeft de hoofdworker nooit gerekend, en kostte de eerste
   * dag- of weekaanvraag het laden van alle profielen plus een jaarsimulatie:
   * ruim een seconde "wordt opgeteld…" over data die er al leek te zijn. De
   * opwarmtaak doet dat werk vooraf; daarna zijn dag en week een optelling.
   */
  it("maakt dag en week daarna een kwestie van milliseconden", async () => {
    const cfg = config({ from: "2024-01-01", to: "2025-12-31", household: { annualGridImportKwh: 3100, annualGridExportKwh: 1500, spreadFactor: 1 } });
    ontvangen = [];
    await stuur({ type: "warm", id: 700, config: cfg });
    // Geen antwoord op het opwarmen zelf, en zeker geen fout.
    expect(ontvangen.find((m) => m.type === "error")).toBeUndefined();

    ontvangen = [];
    const t0 = performance.now();
    await stuur({ type: "day", id: 701, date: "2025-06-15", config: cfg });
    await stuur({ type: "periode", id: 702, kanaal: "week", config: cfg, van: "2025-06-09", tot: "2025-06-15", resolutie: "uur" });
    const duur = performance.now() - t0;
    const dag = ontvangen.find((m) => m.type === "day");
    const week = ontvangen.find((m) => m.type === "periode");
    expect(dag && dag.type === "day" && dag.day?.date).toBe("2025-06-15");
    expect(week && week.type === "periode" && week.periode.vakken.length).toBe(168);
    // Ruim onder één jaarsimulatie: alles stond al klaar.
    expect(duur).toBeLessThan(250);
  }, 120_000);

  it("stopt zodra er een andere configuratie komt, zonder fout", async () => {
    ontvangen = [];
    // Twee opwarmingen achter elkaar: de tweede maakt de eerste achterhaald.
    const a = stuur({ type: "warm", id: 710, config: config({ from: "2025-01-01", to: "2025-12-31" }) });
    await stuur({ type: "cancel" });
    await a;
    expect(ontvangen.find((m) => m.type === "error")).toBeUndefined();
  }, 120_000);
});
