/**
 * Integratietest van de hele keten zoals de app hem uitvoert.
 *
 * De loader wordt hier via fetch aangesproken, precies zoals in de browser,
 * maar bediend vanaf het bestandssysteem. Zo test dit de echte code — inclusief
 * het binaire formaat, de tijdas-controle en de vensterselectie — in plaats van
 * een nabootsing daarvan.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadManifest, loadPriceYear, loadProfileYear, expandPricesToQuarters } from "../lib/data/loader";
import { runAnalysis, type AnalysisInput } from "../lib/model/analysis";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { buildResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import { PRESETS } from "../lib/presets";
import type { Manifest } from "../lib/data/manifest";
import { addDays, localMidnightUtcMs } from "../lib/data/timeaxis";

const DOMAIN = "871685900000056162";

beforeAll(() => {
  // Bedien /data vanaf public/data, zodat de loader onveranderd draait.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const pad = `public${url.startsWith("/") ? url : `/${url}`}`;
    const buf = readFileSync(pad);
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body,
      json: async () => JSON.parse(buf.toString("utf8")),
    } as Response;
  }) as typeof fetch;
});

function lowerBound(axis: Float64Array, target: number): number {
  let lo = 0;
  let hi = axis.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (axis[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Zelfde opbouw als de worker: profielen laden, knippen, residual en prijzen. */
async function bouwInvoer(
  manifest: Manifest,
  van: string,
  tot: string,
): Promise<AnalysisInput> {
  const preset = PRESETS[1]!;
  const windows: AnalysisInput["windows"] = [];

  for (const jaarSleutel of Object.keys(manifest.profielen[DOMAIN]!)) {
    const jaar = Number(jaarSleutel);
    const info = manifest.profielen[DOMAIN]![jaarSleutel]!;
    if (info.eerste_dag > tot || info.laatste_dag < van) continue;
    if (!manifest.prijzen[jaarSleutel]) continue;

    const prof = await loadProfileYear(manifest, DOMAIN, jaar);
    const price = await loadPriceYear(manifest, jaar);

    const firstDay = prof.firstDay > van ? prof.firstDay : van;
    const lastDay = prof.lastDay < tot ? prof.lastDay : tot;
    const start = lowerBound(prof.startMs, localMidnightUtcMs(firstDay));
    const end = lowerBound(prof.startMs, localMidnightUtcMs(addDays(lastDay, 1)));
    if (end <= start) continue;

    const startMs = prof.startMs.slice(start, end);
    const tariff = {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: price.levyEurPerKwh,
      feedInCostEurPerKwh: 0,
      allowCurtailment: true,
    };

    windows.push({
      year: jaar,
      firstDay,
      lastDay,
      isFullYear:
        firstDay === `${jaar}-01-01` && lastDay === `${jaar}-12-31` && prof.isFullYear,
      window: {
        startMs,
        residualKwh: buildResidual(
          prof.importFraction.slice(start, end),
          prof.exportFraction.slice(start, end),
          { annualGridImportKwh: 2500, annualGridExportKwh: 2000, spreadFactor: 1 },
        ),
        prices: buildPriceSeries(
          expandPricesToQuarters(startMs, price, "market"),
          tariff,
        ),
      },
    });
  }

  return {
    windows,
    battery: { ...preset.spec, wearCostEurPerKwh: 0 },
    tariff: {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: 0.17,
      feedInCostEurPerKwh: 0,
      allowCurtailment: true,
    },
    investmentEur: preset.prijsEur,
    cycleLife: preset.cycleLife,
    years: 15,
    priceEscalation: 0.02,
    discountRate: 0.03,
    calendarFadePerYear: 0.015,
    residualValueEur: 0,
  };
}

describe("volledige keten", () => {
  it("levert een compleet resultaat over de hele beschikbare periode", async () => {
    const manifest = await loadManifest();
    const invoer = await bouwInvoer(manifest, "2023-04-01", "2026-12-31");

    expect(invoer.windows.length).toBeGreaterThanOrEqual(3);
    const t0 = performance.now();
    const result = runAnalysis(invoer);
    const ms = performance.now() - t0;
    console.log(
      `  ${invoer.windows.length} profieljaren doorgerekend in ${ms.toFixed(0)} ms`,
    );

    // Elk onderdeel dat de pagina toont moet gevuld zijn.
    expect(result.perYear.length).toBe(invoer.windows.length);
    expect(result.finance.cashflows.length).toBe(15);
    expect(result.curve.length).toBe(3);
    expect(result.sampleDays.length).toBe(2);
    expect(result.sampleDays[0]!.socKwh.length).toBeGreaterThan(90);

    // De prijskloof is het uitgangspunt van het hele verhaal: afname moet
    // duurder zijn dan teruglevering opbrengt.
    expect(result.priceGap.weightedImportPrice).toBeGreaterThan(
      result.priceGap.weightedExportPrice,
    );

    // De besparing is positief en de uitsplitsing sluit aan op het totaal.
    for (const jaar of result.perYear) {
      expect(jaar.realisticSavingEur).toBeGreaterThan(0);
      const b = jaar.breakdown;
      const som =
        b.selfConsumptionEur + b.arbitrageEur + b.avoidedNegativeExportEur;
      expect(som).toBeCloseTo(b.totalEur, 6);
      expect(b.totalEur).toBeCloseTo(jaar.realisticSavingEur, 6);
    }

    // Budget. Vier profieljaren betekent vier keer een baseline, een
    // realistische strategie en een perfect-foresight optimum over 35.040
    // kwartieren, plus de besparingscurve. Dat kost enkele seconden en dat is
    // inherent aan de opzet — niet aan verspilling: de voorbeelddagen en de
    // curve hergebruiken de al berekende dispatches.
    //
    // De pagina blijft ondertussen bruikbaar: het rekenwerk draait in een
    // worker en het vorige resultaat blijft gedimd staan tot het nieuwe er is.
    // Een enkel jaar is binnen een seconde klaar.
    expect(ms).toBeLessThan(5000);
  });

  it("respecteert een zelfgekozen periode", async () => {
    const manifest = await loadManifest();
    const heel = await bouwInvoer(manifest, "2025-01-01", "2025-12-31");
    const zomer = await bouwInvoer(manifest, "2025-06-01", "2025-08-31");

    expect(heel.windows.length).toBe(1);
    expect(zomer.windows.length).toBe(1);

    const heelResultaat = runAnalysis(heel);
    const zomerResultaat = runAnalysis(zomer);

    // Een kwartaal levert minder op dan een heel jaar — en niet toevallig een
    // kwart, want de fracties worden niet geherschaald.
    expect(zomerResultaat.perYear[0]!.realisticSavingEur).toBeLessThan(
      heelResultaat.perYear[0]!.realisticSavingEur,
    );
    expect(zomerResultaat.perYear[0]!.isFullYear).toBe(false);
    expect(heelResultaat.perYear[0]!.isFullYear).toBe(true);
  });

  it("laat terugleverkosten de besparing vergroten", async () => {
    const manifest = await loadManifest();
    const basis = await bouwInvoer(manifest, "2025-01-01", "2025-12-31");

    // Met terugleverkosten wordt teruglevering minder waard, dus wordt zelf
    // verbruiken — en daarmee de batterij — waardevoller.
    const duurder: AnalysisInput = {
      ...basis,
      windows: basis.windows.map((w) => ({
        ...w,
        window: {
          ...w.window,
          prices: {
            importPrice: w.window.prices.importPrice,
            exportPrice: w.window.prices.exportPrice.map((p) => p - 0.05) as unknown as Float64Array,
          },
        },
      })),
    };
    // map() op een Float64Array geeft een Float64Array terug; expliciet houden.
    for (const w of duurder.windows) {
      expect(w.window.prices.exportPrice).toBeInstanceOf(Float64Array);
    }

    const zonder = runAnalysis(basis);
    const met = runAnalysis(duurder);
    expect(met.perYear[0]!.realisticSavingEur).toBeGreaterThan(
      zonder.perYear[0]!.realisticSavingEur,
    );
  });
});

describe("voorbeelddag", () => {
  it("toont de netuitwisseling mét batterij, niet die zonder", async () => {
    const manifest = await loadManifest();
    const invoer = await bouwInvoer(manifest, "2025-01-01", "2025-12-31");
    const result = runAnalysis(invoer);
    const dag = result.sampleDays[0]!;

    expect(dag.netKwh.length).toBe(dag.residualKwh.length);

    // De twee reeksen moeten verschillen: doen ze dat niet, dan toont de
    // grafiek de situatie zonder batterij terwijl het bijschrift het
    // tegenovergestelde belooft.
    let verschillend = 0;
    for (let i = 0; i < dag.netKwh.length; i++) {
      if (Math.abs(dag.netKwh[i]! - dag.residualKwh[i]!) > 1e-9) verschillend++;
    }
    expect(verschillend).toBeGreaterThan(0);

    // Het verschil is precies wat de batterij doet: laden erbij, ontladen
    // eraf, plus het eigen standby-verbruik van de omvormer, min wat er is
    // afgeregeld — dat laatste gaat niet naar het net en komt dus ook niet
    // door de meter.
    const standbyKwh = (PRESETS[1]!.spec.standbyWatt / 1000) * 0.25;
    for (let i = 0; i < dag.netKwh.length; i++) {
      const batterij = dag.chargeKwh[i]! - dag.dischargeKwh[i]!;
      const verwacht =
        dag.residualKwh[i]! + standbyKwh + batterij + dag.curtailedKwh[i]!;
      expect(dag.netKwh[i]!).toBeCloseTo(verwacht, 6);
    }
  });

  it("vlakt de uitwisseling af in plaats van hem te vergroten", async () => {
    const manifest = await loadManifest();
    const invoer = await bouwInvoer(manifest, "2025-01-01", "2025-12-31");
    const dag = runAnalysis(invoer).sampleDays.find((d) => /zomer/i.test(d.label))!;

    // Op een zomerdag hoort de batterij de teruglever-piek op te vangen, dus de
    // grootste uitslag naar het net wordt kleiner.
    const piekZonder = Math.min(...dag.residualKwh);
    const piekMet = Math.min(...dag.netKwh);
    expect(piekMet).toBeGreaterThan(piekZonder);
  });
});

describe("batterijmaat-raster", () => {
  /**
   * De test die het oude model niet haalt.
   *
   * In het Streamlit-prototype daalde de besparing bij een grotere batterij
   * (8 kWh gaf 203,05 en 15 kWh 202,32) en leverde 3,6 kW minder op dan 2,4 kW.
   * Dat waren modelartefacten, en het was precies de as die de optimalisatie-
   * pagina plotte. Hier moet het raster in beide richtingen kloppen.
   */
  it("is monotoon in capaciteit en in vermogen", async () => {
    const manifest = await loadManifest();
    const invoer = await bouwInvoer(manifest, "2025-01-01", "2025-12-31");
    const entry = invoer.windows[0]!;
    const basis = dispatchBaseline(entry.window, {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: manifest.prijzen["2025"]!.jaarconstante_eur_per_kwh,
      feedInCostEurPerKwh: 0,
      allowCurtailment: true,
    });
    const tariff = {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: manifest.prijzen["2025"]!.jaarconstante_eur_per_kwh,
      feedInCostEurPerKwh: 0,
      allowCurtailment: true,
    };

    const capaciteiten = [1, 2, 3, 5, 7.5, 10];
    const vermogens = [0.5, 0.8, 1.5, 2.5, 3.6];

    const raster: number[][] = [];
    for (const cap of capaciteiten) {
      const rij: number[] = [];
      for (const kw of vermogens) {
        const spec = {
          ...invoer.battery,
          capacityKwh: cap,
          maxChargeKw: kw,
          maxDischargeKw: kw,
          wearCostEurPerKwh: 0,
        };
        const res = dispatchRolling(entry.window, spec, tariff);
        rij.push(basis.totalCostEur - res.totalCostEur);
      }
      raster.push(rij);
    }

    // De realistische strategie plant op een voorspelling, dus een enkele
    // uitschieter van een paar procent is geen fout maar het gevolg van
    // beslissen onder onzekerheid. Structurele dalingen zijn dat wel.
    const marge = 0.03;

    for (let k = 0; k < vermogens.length; k++) {
      for (let r = 1; r < capaciteiten.length; r++) {
        const vorige = raster[r - 1]![k]!;
        const huidige = raster[r]![k]!;
        expect(
          huidige,
          `bij ${vermogens[k]} kW daalde de besparing van ${capaciteiten[r - 1]} naar ${capaciteiten[r]} kWh`,
        ).toBeGreaterThanOrEqual(vorige * (1 - marge) - 0.01);
      }
    }

    for (let r = 0; r < capaciteiten.length; r++) {
      for (let k = 1; k < vermogens.length; k++) {
        const vorige = raster[r]![k - 1]!;
        const huidige = raster[r]![k]!;
        expect(
          huidige,
          `bij ${capaciteiten[r]} kWh daalde de besparing van ${vermogens[k - 1]} naar ${vermogens[k]} kW`,
        ).toBeGreaterThanOrEqual(vorige * (1 - marge) - 0.01);
      }
    }

    // En het effect moet substantieel zijn: een tienvoudige batterij hoort
    // duidelijk meer op te leveren dan de kleinste.
    expect(raster.at(-1)!.at(-1)!).toBeGreaterThan(raster[0]![0]! * 2);
  });
});

describe("prijskloof", () => {
  /**
   * De prijskloof staat naast de jaarvolumes die de gebruiker invulde, dus hij
   * moet ook per jaar gelden. Toen hij over de hele reeks van ruim drie jaar
   * werd opgeteld, leek er meer teruglevering in negatieve uren te vallen
   * (1749 kWh) dan er in een heel jaar was (2400 kWh).
   */
  it("rekent per jaar, niet over de hele reeks", async () => {
    const manifest = await loadManifest();

    const eenJaar = runAnalysis(await bouwInvoer(manifest, "2025-01-01", "2025-12-31"));
    const alles = runAnalysis(await bouwInvoer(manifest, "2023-04-01", "2026-12-31"));

    // Meer jaren erbij mag het VOLUME per jaar niet laten oplopen.
    expect(alles.priceGap.exportAtNegativePriceKwh).toBeLessThan(
      eenJaar.priceGap.exportAtNegativePriceKwh * 2,
    );
    // En het kan nooit meer zijn dan wat er per jaar wordt teruggeleverd.
    for (const r of [eenJaar, alles]) {
      expect(r.priceGap.exportAtNegativePriceKwh).toBeLessThanOrEqual(2000);
      expect(r.priceGap.exportAtNegativePriceKwh).toBeGreaterThanOrEqual(0);
    }
  });

  it("weegt de prijzen naar wanneer je werkelijk afneemt en teruglevert", async () => {
    const manifest = await loadManifest();
    const r = runAnalysis(await bouwInvoer(manifest, "2025-01-01", "2025-12-31"));
    const g = r.priceGap;

    // Het hele punt van wegen: een huishouden met panelen neemt af als het duur
    // is en levert terug als het goedkoop is, dus beide wijken af van het
    // ongewogen gemiddelde — en wel in tegengestelde richting.
    expect(g.weightedImportPrice).toBeGreaterThan(g.weightedExportPrice);
    expect(g.weightedExportPrice).toBeLessThan(g.simpleAveragePrice);
  });
});
