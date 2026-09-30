/**
 * Een periode zonder volledig kalenderjaar, en de curve van kleinere batterijen.
 *
 * Twaalf maanden over een jaargrens (juni 2025 tot en met mei 2026) bestaan uit
 * twee deelvensters. Elk als een jaar middelen gaf de helft van de besparing:
 * € 52,66 in plaats van ± € 105 en een terugverdientijd van 14,5 in plaats van
 * 6,9 jaar. Op de echte data, want dat is waar de fout zichtbaar werd.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { Invoerbron } from "../lib/data/invoer";
import type { Ophaler } from "../lib/data/loader";
import {
  jaarSchaal,
  meetCurvePunt,
  referentieIndexVan,
  runScenario,
  slijtageVoor,
  type AnalysisInput,
  type ScenarioResult,
} from "../lib/model/analysis";

const vanSchijf: Ophaler = async (url) => new Response(new Uint8Array(readFileSync(`public${url}`)));
const bron = new Invoerbron("/data", vanSchijf);

async function reken(over: Partial<typeof STANDAARD>): Promise<{ input: AnalysisInput; r: ScenarioResult }> {
  const input = await bron.bouwInvoer(maakConfiguratie({ ...STANDAARD, ...over }));
  return { input, r: runScenario(input) };
}

const som = (r: ScenarioResult, f: (y: ScenarioResult["perYear"][number]) => number) =>
  r.perYear.reduce((a, y) => a + f(y), 0);

describe("jaarSchaal", () => {
  it("is 1 voor twaalf aaneengesloten maanden en extrapoleert een kortere periode", () => {
    expect(
      jaarSchaal([
        { firstDay: "2025-06-01", lastDay: "2025-12-31" },
        { firstDay: "2026-01-01", lastDay: "2026-05-31" },
      ]),
    ).toBe(1);
    expect(jaarSchaal([{ firstDay: "2024-01-01", lastDay: "2024-12-31" }])).toBeCloseTo(365 / 366, 12);
    expect(jaarSchaal([{ firstDay: "2025-06-01", lastDay: "2025-11-30" }])).toBeCloseTo(365 / 183, 12);
    // Onleesbaar: niets om op te schalen.
    expect(jaarSchaal([{ firstDay: "x", lastDay: "y" }])).toBe(1);
  });
});

describe("periode zonder volledig kalenderjaar", () => {
  let jaargrens: { input: AnalysisInput; r: ScenarioResult };
  let standaard: { input: AnalysisInput; r: ScenarioResult };
  let halfjaar: { input: AnalysisInput; r: ScenarioResult };

  beforeAll(async () => {
    await bron.init();
    standaard = await reken({});
    jaargrens = await reken({ van: "2025-06-01", tot: "2026-05-31" });
    halfjaar = await reken({ van: "2025-06-01", tot: "2025-11-30" });
  }, 120_000);

  it("telt twaalf maanden over een jaargrens op in plaats van te middelen", () => {
    const { r } = jaargrens;
    expect(r.perYear.length).toBe(2);
    expect(r.perYear.some((y) => y.isFullYear)).toBe(false);
    // 365 dagen: de schaal is 1, dus het jaar is exact de som van de twee vensters.
    expect(r.averageSavingEur).toBeCloseTo(som(r, (y) => y.realisticSavingEur), 6);
    expect(r.stats.gridImportBaselineKwh).toBeCloseTo(som(r, (y) => y.gridImportKwh), 6);
    expect(r.stats.gridExportBatteryKwh).toBeCloseTo(som(r, (y) => y.gridExportWithBatteryKwh), 6);
    expect(r.stats.cyclesPerYear).toBeCloseTo(som(r, (y) => y.cyclesPerYear), 6);
    expect(r.stats.throughputPerYearKwh).toBeCloseTo(som(r, (y) => y.throughputKwh), 6);
    expect(r.stats.peakHourImportBaselineKwh).toBeCloseTo(som(r, (y) => y.peakHourImportKwh), 6);
    expect(r.losses.totalKwh).toBeCloseTo(som(r, (y) => y.losses.totalKwh), 6);
    expect(r.breakdown.totalEur).toBeCloseTo(r.averageSavingEur, 6);
    // Geen bandbreedte: er is één jaar.
    expect(r.minSavingEur).toBe(r.averageSavingEur);
    expect(r.maxSavingEur).toBe(r.averageSavingEur);
    // De financiën rusten op dat getal.
    expect(r.curve.find((p) => p.capacityFraction === 1)!.savingEur).toBe(r.averageSavingEur);
    expect(r.finance.cashflows[0]!.savingNominalEur).toBeCloseTo(r.averageSavingEur, 6);
  });

  it("komt in de buurt van het gemiddelde van de volle jaren", () => {
    const gem = standaard.r.averageSavingEur;
    expect(jaargrens.r.averageSavingEur).toBeGreaterThan(gem * 0.8);
    expect(jaargrens.r.averageSavingEur).toBeLessThan(gem * 1.2);
    expect(jaargrens.r.finance.paybackYears).not.toBeNull();
    expect(Math.abs(jaargrens.r.finance.paybackYears! - standaard.r.finance.paybackYears!)).toBeLessThan(1.5);
    // Netafname en cycli liggen ook op jaarniveau, niet op dat van een half jaar.
    expect(jaargrens.r.stats.gridImportBaselineKwh).toBeGreaterThan(2500 * 0.9);
    expect(jaargrens.r.stats.gridImportBaselineKwh).toBeLessThan(2500 * 1.15);
    expect(jaargrens.r.stats.cyclesPerYear).toBeGreaterThan(standaard.r.stats.cyclesPerYear * 0.8);
    expect(jaargrens.r.stats.cyclesPerYear).toBeLessThan(standaard.r.stats.cyclesPerYear * 1.2);
  });

  it("middelt de maanden en schaalt ze niet", () => {
    // Elke kalendermaand komt hier in één venster voor: het maandcijfer is dat
    // van het venster zelf, en de twaalf maanden tellen op tot het jaar.
    const { r } = jaargrens;
    expect(r.perMonth.length).toBe(12);
    const juni = r.perMonth.find((m) => m.month === 6)!;
    const uitVenster = r.perYear[0]!.months.find((m) => m.month === 6)!;
    expect(juni.savingEur).toBeCloseTo(uitVenster.savingEur, 9);
    expect(r.perMonth.reduce((a, m) => a + m.savingEur, 0)).toBeCloseTo(r.averageSavingEur, 6);
  });

  it("extrapoleert een kortere periode met 365 gedeeld door het aantal dagen", () => {
    const { r } = halfjaar;
    expect(r.perYear.length).toBe(1);
    const f = 365 / 183;
    expect(r.averageSavingEur).toBeCloseTo(r.perYear[0]!.realisticSavingEur * f, 6);
    expect(r.stats.gridImportBaselineKwh).toBeCloseTo(r.perYear[0]!.gridImportKwh * f, 6);
    expect(r.priceGap.exportAtNegativePriceKwh).toBeGreaterThanOrEqual(0);
    if (r.co2) {
      expect(r.co2.importBasisKwh).toBeCloseTo(r.perYear[0]!.co2!.importBasisKwh * f, 6);
    }
  });

  it("laat de uitkomst bij minstens één vol jaar zoals hij was: het gemiddelde van de volle jaren", () => {
    const { r } = standaard;
    const vol = r.perYear.filter((y) => y.isFullYear);
    expect(vol.length).toBeGreaterThanOrEqual(2);
    expect(r.perYear.length).toBeGreaterThan(vol.length);
    const gem = (f: (y: (typeof vol)[number]) => number) => vol.reduce((a, y) => a + f(y), 0) / vol.length;
    expect(r.averageSavingEur).toBeCloseTo(gem((y) => y.realisticSavingEur), 9);
    expect(r.minSavingEur).toBe(Math.min(...vol.map((y) => y.realisticSavingEur)));
    expect(r.maxSavingEur).toBe(Math.max(...vol.map((y) => y.realisticSavingEur)));
    expect(r.stats.gridImportBaselineKwh).toBeCloseTo(gem((y) => y.gridImportKwh), 9);
    expect(r.stats.cyclesPerYear).toBeCloseTo(gem((y) => y.cyclesPerYear), 9);
    expect(r.losses.totalKwh).toBeCloseTo(gem((y) => y.losses.totalKwh), 9);
    if (r.co2) expect(r.co2.importBasisKg).toBeCloseTo(gem((y) => y.co2!.importBasisKg), 9);
  });
});

describe("de curve van kleinere capaciteiten", () => {
  it("draagt de gemeten cycli, niet die van het besparingsquotiënt", async () => {
    await bron.init();
    const { input, r } = await reken({});
    const ref = referentieIndexVan(r.perYear);
    const { spec } = slijtageVoor(input);
    const vol = r.curve.find((p) => p.capacityFraction === 1)!;
    for (const punt of r.curve.filter((p) => p.capacityFraction !== 1)) {
      const q = meetCurvePunt(input, spec, ref, punt.capacityFraction, r.perYear[ref]!.baselineCostEur);
      // Het niveau is het gemiddelde over de volle jaren, de vorm komt van het
      // referentiejaar: dezelfde grondslag als de besparing.
      const verwacht = vol.cyclesPerYear * (q.cyclesPerYear / r.perYear[ref]!.cyclesPerYear);
      expect(punt.cyclesPerYear).toBeCloseTo(verwacht, 9);
      // Een kleinere batterij zet per kWh capaciteit méér om, niet minder.
      expect(punt.cyclesPerYear).toBeGreaterThan(vol.cyclesPerYear);
    }
  }, 60_000);
});
