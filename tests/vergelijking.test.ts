/**
 * De vergelijking van de drie doelen (tabblad "Wat als"), op de standaard-
 * configuratie en alle data.
 *
 * Drie afspraken: het gekozen doel in de vergelijking is bit voor bit het
 * antwoord bovenaan; zelfconsumptie raakt het net niet via de batterij; en de
 * rangorde klopt — uitstoot scheelt de meeste CO2, rendement levert de meeste
 * euro's op.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { dispatchSleutel } from "../lib/cache";
import { STANDAARD, maakConfiguratie, standaardConfiguratie } from "../lib/configuratie";
import { Invoerbron } from "../lib/data/invoer";
import type { Ophaler } from "../lib/data/loader";
import {
  analyseWindow,
  runAnalysis,
  runScenario,
  slijtageVoor,
  type AnalysisResult,
  type ScenarioResult,
} from "../lib/model/analysis";
import type { Doel } from "../lib/model/types";
import {
  VERGELIJK_DOELEN,
  deelVan,
  doelConfiguratie,
  doelKaart,
  doelKaarten,
  rekenDeel,
  vergelijkDatum,
  type VergelijkingDeel,
} from "../lib/model/vergelijking";
import { scenarioConfiguratie } from "../lib/nettarief";
import { overgangsFinance } from "../lib/overgang";

const haal: Ophaler = async (url) => new Response(new Uint8Array(readFileSync(`public${url}`)));
const config = standaardConfiguratie();

let bron: Invoerbron;
let hoofd: AnalysisResult;
let hoofdScenario: ScenarioResult;
const nu = new Map<Doel, VergelijkingDeel>();
const nettarief = new Map<Doel, VergelijkingDeel>();

beforeAll(async () => {
  bron = new Invoerbron("/data", haal);
  await bron.init();
  hoofd = runAnalysis(await bron.bouwInvoer(config));
  hoofdScenario = runScenario(await bron.bouwInvoer(scenarioConfiguratie(config)));
  const datum = vergelijkDatum(hoofd);
  for (const doel of VERGELIJK_DOELEN) {
    const werk = doelConfiguratie(config, doel);
    nu.set(doel, rekenDeel(await bron.bouwInvoer(werk), datum));
    nettarief.set(doel, rekenDeel(await bron.bouwInvoer(scenarioConfiguratie(werk)), null));
  }
}, 240_000);

describe("de werkconfiguratie per doel", () => {
  it("heeft voor elk doel dezelfde sleutel als de configuratie die de instellingen maken", () => {
    for (const doel of VERGELIJK_DOELEN) {
      expect(dispatchSleutel(doelConfiguratie(config, doel))).toBe(
        dispatchSleutel(maakConfiguratie({ ...STANDAARD, doel })),
      );
    }
    // Rendement is een afwezig veld, niet `doel: "rendement"`.
    expect("doel" in doelConfiguratie(maakConfiguratie({ ...STANDAARD, doel: "uitstoot" }), "rendement")).toBe(false);
  });
});

describe("het gekozen doel in de vergelijking", () => {
  it("geeft exact dezelfde besparing als het antwoord bovenaan", () => {
    // Apart doorgerekend, als scenario zonder optimum: toch bit-gelijk.
    expect(nu.get("rendement")!.averageSavingEur).toBe(hoofd.averageSavingEur);
    expect(nu.get("rendement")!.curve).toEqual(hoofd.curve);
    expect(nettarief.get("rendement")!.averageSavingEur).toBe(hoofdScenario.averageSavingEur);
    // En de kaart uit het antwoord zelf (zoals de pagina hem vult) ook.
    const kaart = doelKaart("rendement", deelVan(hoofd, hoofd.sampleDays[0]), deelVan(hoofdScenario), config);
    expect(kaart.besparingEur).toBe(hoofd.averageSavingEur);
    expect(kaart.terugverdientijd).toBe(overgangsFinance(hoofd, hoofdScenario, config).finance.paybackYears);
    expect(kaart.laadbeurten).toBe(hoofd.stats.cyclesPerYear);
  });

  it("snijdt dezelfde voorbeelddag uit als het antwoord", () => {
    const dag = nu.get("rendement")!.dag!;
    const voorbeeld = hoofd.sampleDays[0]!;
    expect(dag.date).toBe(voorbeeld.date);
    expect(dag.chargeKwh).toEqual(voorbeeld.chargeKwh);
    expect(dag.dischargeKwh).toEqual(voorbeeld.dischargeKwh);
    expect(dag.stats.savingEur).toBe(voorbeeld.stats.savingEur);
    // Alle drie de doelen op dezelfde dag.
    for (const doel of VERGELIJK_DOELEN) expect(nu.get(doel)!.dag!.date).toBe(voorbeeld.date);
  });
});

describe("zelfconsumptie", () => {
  it("laadt 0 kWh uit het net en levert 0 kWh uit de batterij aan het net", async () => {
    const invoer = await bron.bouwInvoer(doelConfiguratie(config, "zelfconsumptie"));
    const { spec, volleSlijtage } = slijtageVoor(invoer);
    let uitNet = 0;
    let naarNet = 0;
    let geladen = 0;
    for (const entry of invoer.windows) {
      const u = analyseWindow(entry, spec, invoer.tariff, { metOptimum: false, wearEurPerKwh: volleSlijtage });
      const r = entry.window.residualKwh;
      for (let i = 0; i < r.length; i++) {
        const laden = u.realistic.chargeKwh[i]!;
        const ontladen = u.realistic.dischargeKwh[i]!;
        geladen += laden;
        uitNet += Math.max(0, laden - Math.max(0, -r[i]!));
        naarNet += Math.max(0, ontladen - Math.max(0, r[i]!));
      }
    }
    expect(geladen).toBeGreaterThan(100);
    expect(uitNet).toBeLessThan(1e-6);
    expect(naarNet).toBeLessThan(1e-6);
    expect(nu.get("zelfconsumptie")!.dag!.stats.chargedFromGridKwh).toBeLessThan(1e-9);
  });
});

describe("de rangorde op de standaardconfiguratie", () => {
  it("uitstoot scheelt minstens zoveel CO2 als rendement, rendement bespaart het meest", () => {
    const kaarten = doelKaarten(
      {
        nu: Object.fromEntries(VERGELIJK_DOELEN.map((d) => [d, nu.get(d)])) as Record<Doel, VergelijkingDeel>,
        nettarief: Object.fromEntries(VERGELIJK_DOELEN.map((d) => [d, nettarief.get(d)])) as Record<
          Doel,
          VergelijkingDeel
        >,
      },
      config,
    );
    const r = kaarten.rendement!;
    const z = kaarten.zelfconsumptie!;
    const u = kaarten.uitstoot!;
    expect(u.co2WinstKg!).toBeGreaterThanOrEqual(r.co2WinstKg!);
    expect(r.besparingEur).toBeGreaterThanOrEqual(z.besparingEur);
    expect(r.besparingEur).toBeGreaterThanOrEqual(u.besparingEur);
    // Elke kaart rekent de terugverdientijd met de overgang, net als bovenaan.
    for (const k of [r, z, u]) expect(k.metOvergang).toBe(true);
  });
});
