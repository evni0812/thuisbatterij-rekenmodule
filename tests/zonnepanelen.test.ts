/**
 * Het scenario zonder zonnepanelen rust op echte metingen: het MFFBAS-profiel
 * van aansluitingen zonder invoeding (AZI), als apart bestand naast dat van
 * de aansluitingen mét invoeding (AMI).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { yearsInRange } from "../lib/data/invoer";
import { loadManifest, loadProfileYear } from "../lib/data/loader";
import { Invoerbron } from "../lib/data/invoer";
import type { Manifest } from "../lib/data/manifest";
import { runAnalysis } from "../lib/model/analysis";

const DOMAIN = "871685900000056162";

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

describe("de configuratie", () => {
  it("laat het standaardgeval ongemoeid: geen afnametype, hash blijft gelijk", () => {
    const c = maakConfiguratie(STANDAARD);
    expect("afnametype" in c).toBe(false);
    expect(c.household.annualGridExportKwh).toBe(STANDAARD.terugleveringKwh);
  });

  it("zet zonder zonnepanelen het AZI-profiel, geen teruglevering en geen opwek", () => {
    const c = maakConfiguratie({ ...STANDAARD, zonnepanelen: false, terugleveringKwh: 2000, opwekKwh: 3500 });
    expect(c.afnametype).toBe("AZI");
    expect(c.household.annualGridExportKwh).toBe(0);
    expect(c.annualProductionKwh).toBe(0);
  });
});

describe("de assets", () => {
  it("bevatten voor elk netgebied dezelfde jaren met en zonder invoeding", async () => {
    const m: Manifest = await loadManifest("/data", haal);
    expect(m.profielen_zonder).toBeDefined();
    for (const gebied of m.netgebieden) {
      expect(Object.keys(m.profielen_zonder![gebied] ?? {})).toEqual(Object.keys(m.profielen[gebied] ?? {}));
    }
    expect(yearsInRange(m, DOMAIN, "2025-01-01", "2025-12-31", "AZI")).toEqual([2025]);
  }, 30_000);

  it("geven zonder panelen een gemeten dagvorm zonder middagdip", async () => {
    /**
     * Het verschil dat het scenario rechtvaardigt: bij huishoudens met panelen
     * zakt de afname midden op de dag weg (de zon dekt het verbruik), bij
     * huishoudens zonder panelen niet. Gemeten op Liander 2025: 2,6% tegen
     * 4,7% van het dagvolume om 12 uur.
     */
    const m = await loadManifest("/data", haal);
    const met = await loadProfileYear(m, DOMAIN, 2025, "/data", haal, "AMI");
    const zonder = await loadProfileYear(m, DOMAIN, 2025, "/data", haal, "AZI");
    expect(zonder.importFraction.length).toBe(met.importFraction.length);

    const aandeelMiddag = (f: Float32Array) => {
      let middag = 0;
      let totaal = 0;
      for (let i = 0; i < f.length; i++) {
        totaal += f[i]!;
        const kwartier = i % 96;
        if (kwartier >= 48 && kwartier < 52) middag += f[i]!;
      }
      return middag / totaal;
    };
    const dipMet = aandeelMiddag(met.importFraction);
    const dipZonder = aandeelMiddag(zonder.importFraction);
    expect(dipZonder).toBeGreaterThan(dipMet * 1.5);
    // Beide genormaliseerd op jaarsom 1.
    const som = (f: Float32Array) => f.reduce((a, b) => a + b, 0);
    expect(som(zonder.importFraction)).toBeCloseTo(1, 3);
    expect(som(met.importFraction)).toBeCloseTo(1, 3);
  }, 30_000);
});

describe("de doorrekening zonder panelen", () => {
  it("levert via de echte assets een uitkomst met alleen prijsverschil als bron", async () => {
    const bron = new Invoerbron("/data", haal);
    await bron.init();
    const config = maakConfiguratie({
      ...STANDAARD,
      zonnepanelen: false,
      van: "2025-01-01",
      tot: "2025-12-31",
    });
    const invoer = await bron.bouwInvoer(config);
    expect(invoer.windows).toHaveLength(1);
    // Zonder invoeding is er nooit een negatieve restvraag: niets om op te slaan.
    const w = invoer.windows[0]!.window;
    let negatief = 0;
    for (let i = 0; i < w.residualKwh.length; i++) if (w.residualKwh[i]! < 0) negatief++;
    expect(negatief).toBe(0);

    const res = runAnalysis(invoer);
    expect(res.stats.gridExportBaselineKwh).toBeCloseTo(0, 6);
    expect(res.averageSavingEur).toBeGreaterThan(0);
    // En duidelijk minder dan met panelen: alleen handel, geen zonnestroom.
    const met = runAnalysis(
      await bron.bouwInvoer(maakConfiguratie({ ...STANDAARD, van: "2025-01-01", tot: "2025-12-31" })),
    );
    expect(res.averageSavingEur).toBeLessThan(met.averageSavingEur);
    console.log("ZONDER", res.averageSavingEur.toFixed(2), "MET", met.averageSavingEur.toFixed(2), "cycli", res.stats.cyclesPerYear.toFixed(0), "tvt", res.finance.paybackYears);
  }, 120_000);
});
