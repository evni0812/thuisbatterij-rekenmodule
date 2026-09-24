/**
 * Invarianten van de dispatch op echte data.
 *
 * Een onafhankelijke controle van wat de solver oplevert, per kwartier en per
 * jaar, zonder de solver te vertrouwen: de energiebalans sluit, de lading
 * volgt uit laden en ontladen, vermogen en capaciteit blijven binnen de
 * grenzen, er wordt nooit tegelijk geladen en ontladen, afregelen gebeurt
 * alleen bij een negatieve prijs, en kosten en cycli zijn opnieuw uit de
 * stromen te berekenen. Opgezet in de productie-review van september 2026;
 * hier in een snelle vorm (alle profieljaren, het optimum alleen voor de
 * standaard), zodat hij in de gewone suite past.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { Invoerbron } from "../lib/data/invoer";
import type { Instellingen } from "../lib/url-state";
import { slijtageVoor, type AnalysisInput } from "../lib/model/analysis";
import { usableCapacityKwh } from "../lib/model/battery";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchOptimal } from "../lib/model/dispatch-optimal";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { stuurVenster } from "../lib/model/doel";
import { HOURS_PER_STEP, type BatterySpec, type DispatchResult, type TariffSpec, type Window } from "../lib/model/types";

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

const GEVALLEN: { naam: string; inst: Partial<Instellingen>; optimum?: boolean }[] = [
  { naam: "Zendure 1,92 kWh / 0,8 kW (standaard)", inst: {}, optimum: true },
  { naam: "Anker 2,69 kWh, zelfconsumptie", inst: { presetId: "anker-solarbank3", doel: "zelfconsumptie" } },
  { naam: "Thuisaccu 10 kWh / 3,6 kW", inst: { presetId: "thuisaccu-10kwh" } },
  { naam: "20 kWh / 0,8 kW zonder afregelen", inst: { capaciteitKwh: 20, vermogenKw: 0.8, prijsEur: 699, curtailment: false } },
  { naam: "Marstek 5,1 kWh, uitstoot, 20% slijtage", inst: { presetId: "marstek-venus-e3", slijtageDeel: 0.2, doel: "uitstoot" } },
  { naam: "zonder zonnepanelen", inst: { zonnepanelen: false } },
];

const invoeren = new Map<string, AnalysisInput>();

beforeAll(async () => {
  const bron = new Invoerbron("/data", haal);
  await bron.init();
  for (const g of GEVALLEN) {
    const cfg = maakConfiguratie({ ...STANDAARD, ...g.inst });
    invoeren.set(g.naam, await bron.bouwInvoer(cfg));
  }
}, 120_000);

const EPS = 1e-9;

/** Tel per soort overtreding hoe vaak hij voorkomt; leeg is goed. */
function controleer(
  w: Window,
  spec: BatterySpec,
  tariff: TariffSpec,
  d: DispatchResult,
  alleenEigen: boolean,
): { fouten: Record<string, number>; kosten: number; cycli: number; celBalans: number } {
  const n = w.residualKwh.length;
  const eta = spec.efficiency;
  const bruikbaar = usableCapacityKwh(spec);
  const maxLaden = spec.maxChargeKw * HOURS_PER_STEP;
  const maxOntladen = spec.maxDischargeKw * HOURS_PER_STEP;
  const fouten: Record<string, number> = {};
  const fout = (k: string) => (fouten[k] = (fouten[k] ?? 0) + 1);
  let soc = 0;
  let kosten = 0;
  let geladen = 0;
  let geleverd = 0;
  for (let t = 0; t < n; t++) {
    const r = w.residualKwh[t]!;
    const c = d.chargeKwh[t]!;
    const x = d.dischargeKwh[t]!;
    const imp = d.gridImportKwh[t]!;
    const exp = d.gridExportKwh[t]!;
    const af = d.curtailedKwh[t]!;
    const ep = w.prices.exportPrice[t]!;
    if (c < -EPS || x < -EPS || imp < -EPS || exp < -EPS || af < -EPS) fout("negatief");
    if (c > EPS && x > EPS) fout("tegelijk laden en ontladen");
    if (imp > EPS && (exp > EPS || af > EPS)) fout("tegelijk afname en teruglevering");
    if (c > maxLaden + EPS) fout("laadvermogen");
    if (x > maxOntladen + EPS) fout("ontlaadvermogen");
    if (af > EPS && !(tariff.allowCurtailment && ep < 0)) fout("afregelen zonder negatieve prijs");
    if (Math.abs(imp - exp - af - (r + c - x)) > EPS) fout("energiebalans");
    // De lading volgt uit de vorige plus laden maal rendement min ontladen
    // gedeeld door rendement.
    soc = soc + c * eta - x / eta;
    if (Math.abs(soc - d.socKwh[t]!) > 1e-9) fout("SoC-recursie");
    soc = d.socKwh[t]!;
    if (soc < -EPS || soc > bruikbaar + EPS) fout("lading buiten de grenzen");
    if (alleenEigen) {
      if (c > Math.max(0, -r) + EPS) fout("zelfconsumptie laadt uit het net");
      if (x > Math.max(0, r) + EPS) fout("zelfconsumptie levert aan het net");
    }
    // Afgerekend in de echte prijzen, nooit in de stuurprijzen.
    kosten += imp * w.prices.importPrice[t]! - exp * ep;
    geladen += c;
    geleverd += x;
  }
  return {
    fouten,
    kosten,
    cycli: bruikbaar > 0 ? geleverd / eta / bruikbaar : 0,
    celBalans: geladen * eta - geleverd / eta - d.socKwh[n - 1]!,
  };
}

describe("invarianten van de dispatch op echte data", () => {
  for (const g of GEVALLEN) {
    it(g.naam, () => {
      const invoer = invoeren.get(g.naam)!;
      expect(invoer.windows.length).toBeGreaterThanOrEqual(3);
      const { spec } = slijtageVoor(invoer);
      for (const venster of invoer.windows) {
        const w = venster.window;
        const { alleenEigen } = stuurVenster(w);

        // De basis, onafhankelijk nagerekend.
        const basis = dispatchBaseline(w, invoer.tariff);
        let basisKosten = 0;
        for (let t = 0; t < w.residualKwh.length; t++) {
          const r = w.residualKwh[t]!;
          const ep = w.prices.exportPrice[t]!;
          if (r > 0) basisKosten += r * w.prices.importPrice[t]!;
          else if (!(invoer.tariff.allowCurtailment && ep < 0)) basisKosten += r * ep;
        }
        expect(basis.totalCostEur).toBeCloseTo(basisKosten, 6);

        const uitvoeringen: [string, DispatchResult][] = [["rollend", dispatchRolling(w, spec, invoer.tariff)]];
        if (g.optimum) uitvoeringen.push(["optimum", dispatchOptimal(w, spec, invoer.tariff)]);
        for (const [soort, d] of uitvoeringen) {
          const c = controleer(w, spec, invoer.tariff, d, alleenEigen);
          expect(c.fouten, `${soort} ${venster.year}`).toEqual({});
          expect(d.totalCostEur, `${soort}: kosten uit de stromen`).toBeCloseTo(c.kosten, 6);
          expect(d.equivalentCycles, `${soort}: cycli uit de stromen`).toBeCloseTo(c.cycli, 9);
          expect(Math.abs(c.celBalans), `${soort}: wat erin ging is eruit of zit er nog`).toBeLessThan(1e-6);
        }
        // Het optimum is de bovengrens: de rollende strategie haalt het niet.
        if (g.optimum) {
          const rollend = basis.totalCostEur - uitvoeringen[0]![1].totalCostEur;
          const optimum = basis.totalCostEur - uitvoeringen[1]![1].totalCostEur;
          expect(rollend).toBeGreaterThan(0);
          expect(rollend).toBeLessThanOrEqual(optimum + 1e-6);
        }
      }
    }, 60_000);
  }
});
