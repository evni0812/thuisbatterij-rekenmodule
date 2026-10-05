/**
 * Het stand-byverbruik van de batterij: in de jaarbesparing en de
 * terugverdientijd, niet in de dispatch en niet in de dag.
 *
 * Eigenaarsbesluit: "Het stand-byverbruik van de batterij zit er niet in. Ik wil
 * dat wel in de terugverdientijd hebben en de jaarlijkse besparing. Alleen niet
 * in het handelsalgoritme op een dag." Tot 16 september 2026 zat het in de
 * dispatch, en kwam een dag met winstgevende handel op € 0,00 uit.
 *
 * De modeltests draaien op de echte data (public/data), zoals de andere
 * modeltests. De tests van de URL en de normalisatie van `sb` staan in
 * tests/url-state.test.ts, want die hebben een DOM nodig.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { dispatchSleutel } from "../lib/cache";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { Invoerbron } from "../lib/data/invoer";
import type { Ophaler } from "../lib/data/loader";
import {
  analyseWindow,
  breakdown,
  runAnalysis,
  runScenario,
  slijtageVoor,
  standbyKosten,
  type AnalysisInput,
  type AnalysisResult,
  type ScenarioResult,
} from "../lib/model/analysis";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { rasterJaar, rasterPunt, prijsPerKwhVan } from "../lib/model/raster";
import type { DispatchResult, TariffSpec, Window } from "../lib/model/types";
import { scenarioConfiguratie } from "../lib/nettarief";
import { PRESETS, STANDAARD_PRESET_ID } from "../lib/presets";

const vanSchijf: Ophaler = async (url) => new Response(new Uint8Array(readFileSync(`public${url}`)));
const bron = new Invoerbron("/data", vanSchijf);

/** Eén vol kalenderjaar: snel genoeg om het twee keer door te rekenen. */
const JAAR = { van: "2025-01-01", tot: "2025-12-31" };
const W = 8;

const preset = PRESETS.find((p) => p.id === STANDAARD_PRESET_ID)!;

async function invoer(over: Partial<typeof STANDAARD>): Promise<AnalysisInput> {
  return bron.bouwInvoer(maakConfiguratie({ ...STANDAARD, ...JAAR, ...over }));
}

/**
 * De stand-bykosten van een dispatch, nog eens uitgeschreven zonder
 * `standbyKosten` te gebruiken: dezelfde regel, maar zo letterlijk mogelijk
 * uit de opdracht, zodat een fout in de ene niet ook in de andere zit.
 */
function naRekenen(window: Window, bat: DispatchResult, tariff: TariffSpec, watt: number) {
  let kwh = 0;
  let eur = 0;
  let stil = 0;
  for (let i = 0; i < window.residualKwh.length; i++) {
    const laadt = bat.chargeKwh[i]! > 1e-9;
    const ontlaadt = bat.dischargeKwh[i]! > 1e-9;
    if (laadt || ontlaadt) continue;
    stil++;
    const k = (watt * 0.25) / 1000;
    kwh += k;
    const ip = window.prices.importPrice[i]!;
    const ep = window.prices.exportPrice[i]!;
    if (bat.gridImportKwh[i]! > 0) eur += k * ip;
    else if (tariff.allowCurtailment && ep < 0) eur += 0;
    else eur += k * ep;
  }
  return { kwh, eur, stil };
}

describe("standbyKosten: welke kwartieren en tegen welke prijs", () => {
  // Vier kwartieren met de hand: laden, ontladen, stil met afname, stil zonder afname.
  const n = 4;
  const maak = (afregelen: boolean) => {
    const window: Window = {
      startMs: new Float64Array([0, 900_000, 1_800_000, 2_700_000]),
      residualKwh: new Float64Array(n),
      prices: {
        importPrice: new Float64Array([0.2, 0.3, 0.25, 0.22]),
        exportPrice: new Float64Array([0.05, 0.1, 0.04, -0.02]),
      },
    };
    const bat: DispatchResult = {
      gridImportKwh: new Float64Array([0.5, 0, 0.1, 0]),
      gridExportKwh: new Float64Array([0, 0, 0, 0.3]),
      chargeKwh: new Float64Array([0.4, 0, 0, 0]),
      dischargeKwh: new Float64Array([0, 0.4, 0, 0]),
      socKwh: new Float64Array(n),
      curtailedKwh: new Float64Array(n),
    } as DispatchResult;
    const tariff: TariffSpec = {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: 0,
      feedInCostEurPerKwh: 0,
      allowCurtailment: afregelen,
    };
    return { window, bat, tariff };
  };

  it("telt alleen kwartieren zonder laden en ontladen", () => {
    const { window, bat, tariff } = maak(false);
    const s = standbyKosten(window, bat, tariff, 20);
    // 20 W is 5 Wh per kwartier; twee van de vier kwartieren staan stil.
    expect(s.kwh).toBeCloseTo(2 * 0.005, 12);
    // Het laad- en het ontlaadkwartier kosten niets extra.
    expect(s.eurPerStap[0]).toBe(0);
    expect(s.eurPerStap[1]).toBe(0);
  });

  it("waardeert stilstand met afname tegen de afnameprijs van dat kwartier", () => {
    const { window, bat, tariff } = maak(false);
    expect(standbyKosten(window, bat, tariff, 20).eurPerStap[2]).toBeCloseTo(0.005 * 0.25, 12);
  });

  it("waardeert stilstand zonder afname tegen de terugleverprijs, ook als die negatief is", () => {
    const { window, bat, tariff } = maak(false);
    // De stroom die je anders had teruggeleverd tegen -2 ct: het kost geld om
    // terug te leveren, dus het stand-byverbruik levert hier iets op.
    expect(standbyKosten(window, bat, tariff, 20).eurPerStap[3]).toBeCloseTo(0.005 * -0.02, 12);
    expect(standbyKosten(window, bat, tariff, 20).eur).toBeCloseTo(0.005 * 0.25 + 0.005 * -0.02, 12);
  });

  it("kost niets op een negatieve prijs als de omvormer toch zou afregelen", () => {
    const { window, bat, tariff } = maak(true);
    expect(standbyKosten(window, bat, tariff, 20).eurPerStap[3]).toBe(0);
  });

  it("is nul bij 0 W", () => {
    const { window, bat, tariff } = maak(false);
    const s = standbyKosten(window, bat, tariff, 0);
    expect(s.kwh).toBe(0);
    expect(s.eur).toBe(0);
    expect(s.eurPerStap.every((v) => v === 0)).toBe(true);
  });

  it("breakdown: een aftrekpost met een negatief teken, en het totaal sluit", () => {
    const { window, bat, tariff } = maak(false);
    const base = {
      ...bat,
      gridImportKwh: new Float64Array([0.9, 0.2, 0.3, 0]),
      gridExportKwh: new Float64Array([0, 0, 0, 0.4]),
      totalCostEur: 1,
    } as DispatchResult;
    const bt = { ...bat, totalCostEur: 0.4 } as DispatchResult;
    const spec = { ...preset.spec, wearCostEurPerKwh: 0 };
    const zonder = breakdown(window, base, bt, spec);
    const s = standbyKosten(window, bat, tariff, 20);
    const met = breakdown(window, base, bt, spec, s);
    expect(zonder.standbyEur).toBe(0);
    expect(met.standbyEur).toBeCloseTo(-s.eur, 12);
    expect(met.standbyKwh).toBeCloseTo(s.kwh, 12);
    expect(met.totalEur).toBeCloseTo(zonder.totalEur - s.eur, 12);
    // De trade-posten blijven wat ze waren.
    expect(met.selfConsumptionEur).toBeCloseTo(zonder.selfConsumptionEur, 12);
    expect(met.arbitrageEur).toBeCloseTo(zonder.arbitrageEur, 12);
  });
});

describe("op echte data, één vol jaar, standaardbatterij", () => {
  let zonder: AnalysisResult;
  let met: AnalysisResult;
  let inZonder: AnalysisInput;
  let inMet: AnalysisInput;

  beforeAll(async () => {
    await bron.init();
    inZonder = await invoer({ standbyWatt: 0 });
    inMet = await invoer({ standbyWatt: W });
    zonder = runAnalysis(inZonder);
    met = runAnalysis(inMet);
  }, 180_000);

  it("zet de watt in de input; 0 W is geen stand-by", () => {
    expect(inZonder.standbyWatt).toBe(0);
    expect(inMet.standbyWatt).toBe(W);
  });

  it("0 W geeft exact de oude besparing: de handel, zonder iets af te trekken", () => {
    const { spec } = slijtageVoor(inZonder);
    const w = inZonder.windows[0]!;
    const basis = dispatchBaseline(w.window, inZonder.tariff);
    const real = dispatchRolling(w.window, spec, inZonder.tariff);
    const oud = basis.totalCostEur - real.totalCostEur;
    const j = zonder.perYear[0]!;
    expect(j.realisticSavingEur).toBe(oud);
    expect(j.realisticCostEur).toBe(real.totalCostEur);
    expect(j.standbyKwh).toBe(0);
    expect(j.standbyCostEur).toBe(0);
    expect(j.breakdown.standbyEur).toBe(0);
    expect(j.breakdown.standbyKwh).toBe(0);
    expect(j.breakdown.totalEur).toBe(oud);
    expect(zonder.averageSavingEur).toBe(oud);
  });

  it("met stand-by daalt de besparing met precies standbyCostEur", () => {
    const a = zonder.perYear[0]!;
    const b = met.perYear[0]!;
    expect(b.standbyCostEur).toBeGreaterThan(0);
    expect(b.realisticSavingEur).toBeCloseTo(a.realisticSavingEur - b.standbyCostEur, 9);
    expect(b.realisticCostEur).toBeCloseTo(a.realisticCostEur + b.standbyCostEur, 9);
    expect(met.averageSavingEur).toBeCloseTo(zonder.averageSavingEur - b.standbyCostEur, 9);
    // Ook het optimum draagt zijn eigen stand-by, en de capture rate blijft een verhouding van nettowaarden.
    expect(b.optimalSavingEur).toBeLessThan(a.optimalSavingEur);
    expect(b.captureRate).toBeCloseTo(b.realisticSavingEur / b.optimalSavingEur, 12);
  });

  it("rekent de kosten zoals de opdracht ze beschrijft, op de dispatch van de batterij", () => {
    const { spec } = slijtageVoor(inMet);
    const w = inMet.windows[0]!;
    const real = dispatchRolling(w.window, spec, inMet.tariff);
    const verwacht = naRekenen(w.window, real, inMet.tariff, W);
    const b = met.perYear[0]!;
    expect(b.standbyKwh).toBeCloseTo(verwacht.kwh, 9);
    expect(b.standbyCostEur).toBeCloseTo(verwacht.eur, 9);
    // Een batterij die geen volle 8.760 uur stilstaat: er is ook gehandeld.
    expect(verwacht.stil).toBeGreaterThan(0);
    expect(verwacht.stil).toBeLessThan(w.window.residualKwh.length);
    expect(b.standbyKwh).toBeCloseTo((verwacht.stil * W * 0.25) / 1000, 9);
    expect(b.standbyKwh).toBeLessThan((W * 8760) / 1000);
    // En binnen de 60 tot 220 kWh per jaar waar de pagina vroeger over sprak (minder, want niet tijdens handel).
    expect(b.standbyKwh).toBeGreaterThan(30);
  });

  it("sluit de opbouw: de posten tellen op tot de besparing", () => {
    for (const r of [zonder, met]) {
      const b = r.breakdown;
      expect(b.selfConsumptionEur + b.arbitrageEur + b.avoidedNegativeExportEur + b.standbyEur).toBeCloseTo(
        b.totalEur,
        9,
      );
      expect(b.totalEur).toBeCloseTo(r.averageSavingEur, 9);
      const j = r.perYear[0]!;
      expect(j.breakdown.totalEur).toBeCloseTo(j.realisticSavingEur, 9);
    }
    expect(met.breakdown.standbyEur).toBeCloseTo(-met.perYear[0]!.standbyCostEur, 12);
    expect(met.breakdown.standbyEur).toBeLessThan(0);
    // De trade-posten zijn die van zonder stand-by: de dispatch is niet veranderd.
    expect(met.breakdown.selfConsumptionEur).toBeCloseTo(zonder.breakdown.selfConsumptionEur, 9);
    expect(met.breakdown.arbitrageEur).toBeCloseTo(zonder.breakdown.arbitrageEur, 9);
  });

  it("laat de maanden optellen tot het jaar", () => {
    const j = met.perYear[0]!;
    expect(j.months.reduce((a, m) => a + m.savingEur, 0)).toBeCloseTo(j.realisticSavingEur, 9);
    expect(met.perMonth.reduce((a, m) => a + m.savingEur, 0)).toBeCloseTo(met.averageSavingEur, 9);
    // Elke maand is lager dan zonder stand-by, behalve als een maand met negatieve prijzen er iets aan overhield.
    const verschil = zonder.perMonth.map((m, i) => m.savingEur - met.perMonth[i]!.savingEur);
    expect(verschil.reduce((a, v) => a + v, 0)).toBeCloseTo(j.standbyCostEur, 9);
    expect(verschil.filter((v) => v > 0).length).toBeGreaterThanOrEqual(10);
  });

  it("verandert de dispatch niet, en dus ook de dag niet", () => {
    const { spec } = slijtageVoor(inZonder);
    const a = analyseWindow(inZonder.windows[0]!, spec, inZonder.tariff, { metOptimum: true, wearEurPerKwh: 0.1, standbyWatt: 0 });
    const b = analyseWindow(inMet.windows[0]!, spec, inMet.tariff, { metOptimum: true, wearEurPerKwh: 0.1, standbyWatt: W });
    for (const k of ["gridImportKwh", "gridExportKwh", "chargeKwh", "dischargeKwh", "socKwh", "curtailedKwh"] as const) {
      expect(Array.from(b.realistic[k])).toEqual(Array.from(a.realistic[k]));
      expect(Array.from(b.optimal![k])).toEqual(Array.from(a.optimal![k]));
    }
    expect(b.realistic.totalCostEur).toBe(a.realistic.totalCostEur);
    // De voorbeelddagen, met hun dagstatistieken, zijn identiek: de dag laat de handel zien.
    expect(met.sampleDays.length).toBeGreaterThan(0);
    expect(met.sampleDays).toEqual(zonder.sampleDays);
    // En de kWh-kerncijfers en de CO2-balans ook.
    expect(met.stats.gridImportBatteryKwh).toBe(zonder.stats.gridImportBatteryKwh);
    expect(met.stats.gridExportBatteryKwh).toBe(zonder.stats.gridExportBatteryKwh);
    expect(met.stats.cyclesPerYear).toBe(zonder.stats.cyclesPerYear);
    expect(met.stats.throughputPerYearKwh).toBe(zonder.stats.throughputPerYearKwh);
    expect(met.co2).toEqual(zonder.co2);
    expect(met.losses).toEqual(zonder.losses);
    expect(met.perYear[0]!.gridImportWithBatteryKwh).toBe(zonder.perYear[0]!.gridImportWithBatteryKwh);
  });

  it("maakt de terugverdientijd langer", () => {
    expect(zonder.finance.paybackYears).not.toBeNull();
    expect(met.finance.paybackYears).not.toBeNull();
    expect(met.finance.paybackYears!).toBeGreaterThan(zonder.finance.paybackYears!);
    expect(met.finance.npvEur).toBeLessThan(zonder.finance.npvEur);
    // De curve rust op de besparing na stand-by.
    expect(met.curve.find((p) => p.capacityFraction === 1)!.savingEur).toBeCloseTo(met.averageSavingEur, 9);
    expect(met.finance.cashflows[0]!.savingNominalEur).toBeCloseTo(met.averageSavingEur, 6);
  });

  it("neemt de kleinere capaciteiten in de curve mee, met dezelfde watt", () => {
    // Het gat tussen 70% en 100% mag niet groter zijn dan zonder stand-by: de aftrek is bij een kleinere batterij
    // nooit kleiner dan nul en de curve blijft stijgend met de capaciteit.
    const punten = met.curve.slice().sort((a, b) => a.capacityFraction - b.capacityFraction);
    for (let i = 1; i < punten.length; i++) {
      expect(punten[i]!.savingEur).toBeGreaterThanOrEqual(punten[i - 1]!.savingEur - 1e-9);
    }
    expect(punten[0]!.savingEur).toBeLessThan(zonder.curve.slice().sort((a, b) => a.capacityFraction - b.capacityFraction)[0]!.savingEur);
  });

  it("zit ook in het scenario met nettarief", async () => {
    const cfgMet = maakConfiguratie({ ...STANDAARD, ...JAAR, standbyWatt: W });
    const cfgZonder = maakConfiguratie({ ...STANDAARD, ...JAAR, standbyWatt: 0 });
    const sMet: ScenarioResult = runScenario(await bron.bouwInvoer(scenarioConfiguratie(cfgMet)));
    const sZonder: ScenarioResult = runScenario(await bron.bouwInvoer(scenarioConfiguratie(cfgZonder)));
    expect(scenarioConfiguratie(cfgMet).standbyWatt).toBe(W);
    const kosten = sMet.perYear[0]!.standbyCostEur;
    expect(kosten).toBeGreaterThan(0);
    expect(sMet.averageSavingEur).toBeCloseTo(sZonder.averageSavingEur - kosten, 9);
    // In het nettariefscenario is afname duurder, dus de stand-by ook.
    expect(kosten).toBeGreaterThan(met.perYear[0]!.standbyCostEur * 0.9);
  }, 120_000);

  it("zit ook in het raster van maten", () => {
    const entry = rasterJaar(inMet);
    const basis = dispatchBaseline(entry.window, inMet.tariff);
    const prijsPerKwh = prijsPerKwhVan(inMet, preset.prijsEur);
    const punt = (watt: number) =>
      rasterPunt(entry, basis, inMet.battery, inMet.tariff, preset.capaciteitKwh, preset.vermogenKw, prijsPerKwh, preset.cycleLife, 1, watt);
    const a = punt(0);
    const b = punt(W);
    expect(b.cyclesPerYear).toBe(a.cyclesPerYear);
    expect(a.savingEur - b.savingEur).toBeGreaterThan(5);
    expect(a.savingEur - b.savingEur).toBeLessThan((W * 8760 * 0.4) / 1000);
  });

  it("de gekozen batterij heeft per watt dezelfde stand-bykosten, lineair in de watt", () => {
    const { spec } = slijtageVoor(inMet);
    const w = inMet.windows[0]!;
    const real = dispatchRolling(w.window, spec, inMet.tariff);
    const een = standbyKosten(w.window, real, inMet.tariff, 10);
    const twee = standbyKosten(w.window, real, inMet.tariff, 20);
    expect(twee.kwh).toBeCloseTo(2 * een.kwh, 9);
    expect(twee.eur).toBeCloseTo(2 * een.eur, 9);
  });
});

describe("de configuratie en de cache", () => {
  it("elke preset heeft een waarde tussen 0 en 100 W en zegt of ze gemeten of geschat is", () => {
    expect(PRESETS.length).toBeGreaterThan(0);
    for (const p of PRESETS) {
      expect(Number.isFinite(p.standbyWatt), p.id).toBe(true);
      expect(p.standbyWatt, p.id).toBeGreaterThan(0);
      expect(p.standbyWatt, p.id).toBeLessThanOrEqual(100);
      expect(["gemeten", "schatting", "fabrieksopgave", "aanname"], p.id).toContain(p.standbyBron);
      expect(p.standbyNoot.length, p.id).toBeGreaterThan(5);
    }
    const waarde = Object.fromEntries(PRESETS.map((p) => [p.id, p.standbyWatt]));
    expect(waarde).toEqual({
      "zendure-800pro2": 8,
      "zendure-1600ac": 3,
      "zendure-2400ac": 3.4,
      "zendure-2400pro": 3.4,
      "zendure-3000mix": 13,
      "zendure-800plus": 8,
      "sessy-5kwh": 3,
      "sessy-10kwh": 3,
      "sessy-plus": 5,
      "alphaess-vitapower3600": 10,
      "anker-solarbank3": 12,
      "anker-solarbank-max": 31.6,
      "homewizard-plugin": 6,
      "marstek-venus-e3": 7,
      "thuisaccu-5kwh": 20,
      "thuisaccu-10kwh": 25,
    });
    expect(PRESETS.filter((p) => p.standbyBron === "gemeten").map((p) => p.id).sort()).toEqual([
      "anker-solarbank-max",
      "homewizard-plugin",
      "marstek-venus-e3",
      "zendure-1600ac",
      "zendure-2400ac",
    ]);
    expect(PRESETS.filter((p) => p.standbyBron === "fabrieksopgave").map((p) => p.id)).toEqual(["sessy-5kwh", "sessy-10kwh"]);
    expect(PRESETS.filter((p) => p.standbyBron === "aanname").map((p) => p.id)).toEqual(["sessy-plus", "alphaess-vitapower3600"]);
  });

  it("de dispatch krijgt de watt niet te zien: BatterySpec kent geen standbyWatt", () => {
    const c = maakConfiguratie({ ...STANDAARD, standbyWatt: 40 });
    expect(c.standbyWatt).toBe(40);
    expect("standbyWatt" in c.battery).toBe(false);
    expect("standbyWatt" in preset.spec).toBe(false);
  });

  it("null volgt de preset; een eigen waarde wint; buiten 0 tot 100 wordt geklemd", () => {
    expect(maakConfiguratie({ ...STANDAARD }).standbyWatt).toBe(preset.standbyWatt);
    expect(maakConfiguratie({ ...STANDAARD, presetId: "marstek-venus-e3" }).standbyWatt).toBe(7);
    expect(maakConfiguratie({ ...STANDAARD, presetId: "marstek-venus-e3", standbyWatt: 30 }).standbyWatt).toBe(30);
    expect(maakConfiguratie({ ...STANDAARD, standbyWatt: 0 }).standbyWatt).toBe(0);
    expect(maakConfiguratie({ ...STANDAARD, standbyWatt: 500 }).standbyWatt).toBe(100);
    expect(maakConfiguratie({ ...STANDAARD, standbyWatt: -3 }).standbyWatt).toBe(0);
  });

  it("de cachesleutel verandert mee: een bewaard antwoord met een andere watt is niet geldig", () => {
    const a = maakConfiguratie({ ...STANDAARD, standbyWatt: preset.standbyWatt });
    const b = maakConfiguratie({ ...STANDAARD, standbyWatt: 30 });
    expect(dispatchSleutel(a)).not.toBe(dispatchSleutel(b));
    // De waarde van de preset volgen of hem zelf invullen is dezelfde berekening, dus dezelfde sleutel.
    expect(dispatchSleutel(a)).toBe(dispatchSleutel(maakConfiguratie({ ...STANDAARD })));
  });
});
