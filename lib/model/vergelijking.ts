/**
 * De drie doelen naast elkaar: wat rendement, zelfconsumptie en uitstoot voor
 * dezelfde batterij en hetzelfde huishouden doen.
 *
 * ── Wat er gerekend wordt ───────────────────────────────────────────────────
 * Per doel dezelfde configuratie met alleen `doel` anders
 * (`doelConfiguratie`), twee keer: op de tarieven van nu en met het nettarief
 * van 2029, zodat de terugverdientijd dezelfde overgang kent als het antwoord
 * bovenaan (lib/overgang.ts). Het gekozen doel is al doorgerekend: dat is het
 * hoofdantwoord en zijn scenario. De andere twee lopen als achtergrondgroep in
 * de pool (lib/useAnalysis.ts), als scenario-doorrekening: zonder optimum,
 * voorbeelddagen en gat, want de vergelijking leest daar niets van.
 *
 * Wat er per doel bewaard wordt is klein (`VergelijkingDeel`): de besparing,
 * de curve voor de financiën, de kerncijfers, de CO2 van de afname en één
 * voorbeelddag. Zo past de vergelijking van de standaardinvoer in de preload
 * zonder dat bestand te verdubbelen.
 *
 * ── Eén dag voor alle drie ──────────────────────────────────────────────────
 * De voorbeelddag is de doorsnee zomerdag van het hoofdantwoord (de dag met de
 * mediane prijsspreiding in de zomer van het referentiejaar). Die keuze hangt
 * alleen van de prijzen af, dus is voor alle drie de doelen dezelfde datum;
 * per doel wordt de dag uit de eigen dispatch gesneden.
 */

import {
  findDay,
  metZelfvoorziening,
  financeVoor,
  afleidingVanConfiguratie,
  referentieIndexVan,
  slijtageVoor,
  analyseWindow,
  curveFracties,
  meetCurvePunt,
  voegSamenScenario,
  type AnalysisInput,
  type AnalysisResult,
  type KeyStats,
  type SampleDay,
  type ScenarioResult,
  type VensterUitkomst,
} from "./analysis";
import { DOELEN, STANDAARD_DOEL } from "./doel";
import type { SavingCurvePoint } from "./finance";
import type { Doel } from "./types";
import { overgangsFinance } from "../overgang";
import type { Configuration } from "../worker/protocol";

/** De volgorde van de kaarten: die van `DOELEN`. */
export const VERGELIJK_DOELEN: readonly Doel[] = DOELEN.map((d) => d.id);

/**
 * Dezelfde configuratie met een ander doel, in precies de vorm die
 * `maakConfiguratie` zou maken: rendement is een afwezig veld. Anders krijgt
 * het rendement-deel van de vergelijking een andere sleutel dan het
 * hoofdantwoord en wordt het opnieuw gerekend.
 */
export function doelConfiguratie(config: Configuration, doel: Doel): Configuration {
  const { doel: _weg, ...rest } = config;
  void _weg;
  return doel === STANDAARD_DOEL ? rest : { ...rest, doel };
}

/** Wat de vergelijking van één doorrekening bewaart. */
export interface VergelijkingDeel {
  averageSavingEur: number;
  curve: SavingCurvePoint[];
  /** Zonder de zelfvoorzieningscijfers; die volgen uit de afleiding. */
  stats: KeyStats;
  /** De uitstoot van de netafname zonder en met batterij, kg; null zonder emissiefactoren. */
  co2: { importBasisKg: number; importBatKg: number } | null;
  /** De voorbeelddag uit deze dispatch; alleen voor de doorrekening op de tarieven van nu. */
  dag?: SampleDay | null;
}

export function deelVan(r: ScenarioResult, dag?: SampleDay | null): VergelijkingDeel {
  return {
    averageSavingEur: r.averageSavingEur,
    curve: r.curve,
    stats: r.stats,
    co2: r.co2 ? { importBasisKg: r.co2.importBasisKg, importBatKg: r.co2.importBatKg } : null,
    ...(dag !== undefined ? { dag } : {}),
  };
}

/** De datum van de voorbeelddag: de doorsnee zomerdag van het hoofdantwoord. */
export function vergelijkDatum(result: Pick<AnalysisResult, "sampleDays">): string | null {
  return result.sampleDays[0]?.date ?? null;
}

/**
 * De dag `datum` uit de realistische dispatch van de vensters. Met de volle
 * slijtageprijs, net als de voorbeelddagen van het hoofdantwoord.
 */
export function dagUitVensters(
  input: AnalysisInput,
  uitkomsten: readonly Pick<VensterUitkomst, "realistic">[],
  datum: string,
): SampleDay | null {
  const { spec, volleSlijtage } = slijtageVoor(input);
  for (let i = 0; i < input.windows.length; i++) {
    const w = input.windows[i]!;
    if (datum < w.firstDay || datum > w.lastDay) continue;
    const u = uitkomsten[i];
    if (!u) continue;
    const dag = findDay(w.window, u.realistic, spec, input.tariff, datum, undefined, volleSlijtage);
    if (dag) return dag;
  }
  return null;
}

/**
 * Eén doel in één thread doorgerekend: de scenario-doorrekening plus de dag.
 * Voor de build (app/voorbeeld.json) en de tests; de browser doet hetzelfde
 * verdeeld over de pool en voegt samen met `voegSamenScenario`.
 */
export function rekenDeel(input: AnalysisInput, datum: string | null): VergelijkingDeel {
  const { spec, volleSlijtage } = slijtageVoor(input);
  const uitkomsten = input.windows.map((w) =>
    analyseWindow(w, spec, input.tariff, { metOptimum: false, wearEurPerKwh: volleSlijtage }),
  );
  const ref = referentieIndexVan(uitkomsten.map((u) => u.kern));
  const basisKosten = uitkomsten[ref]!.baselineCost;
  const metingen = curveFracties(input).map((f) => meetCurvePunt(input, spec, ref, f, basisKosten));
  const result = voegSamenScenario(input, uitkomsten, metingen);
  return deelVan(result, datum ? dagUitVensters(input, uitkomsten, datum) : undefined);
}

/** Wat een kaart van de vergelijking toont, met de afleiding van de getoonde configuratie. */
export interface DoelKaart {
  doel: Doel;
  besparingEur: number;
  /** CO2 die de batterij het huishouden scheelt, kg per jaar; null zonder emissiefactoren. */
  co2WinstKg: number | null;
  eigenVerbruik: { van: number; naar: number } | null;
  netafname: { van: number; naar: number };
  teruglevering: { van: number; naar: number };
  laadbeurten: number;
  /** Terugverdientijd met de overgang naar het nettarief, of zonder als die ontbreekt. */
  terugverdientijd: number | null;
  /** Of de terugverdientijd de overgang naar het nettarief meeneemt. */
  metOvergang: boolean;
  dag: SampleDay | null;
}

/**
 * Een kaart uit de twee delen van een doel. `nettarief` mag ontbreken (nog
 * onderweg, of mislukt); dan is de terugverdientijd die op de tarieven van nu.
 */
export function doelKaart(
  doel: Doel,
  nu: VergelijkingDeel,
  nettarief: VergelijkingDeel | null,
  config: Configuration,
): DoelKaart {
  const afleiding = afleidingVanConfiguratie(config);
  const stats = metZelfvoorziening(nu.stats, afleiding.annualProductionKwh);
  const terugverdientijd = nettarief
    ? overgangsFinance(nu, nettarief, config).finance.paybackYears
    : financeVoor(nu.curve, afleiding).paybackYears;
  return {
    doel,
    besparingEur: nu.averageSavingEur,
    // Hetzelfde als `huishoudPerspectief(co2).winstKg`: alleen de afname telt.
    co2WinstKg: nu.co2 ? nu.co2.importBasisKg - nu.co2.importBatKg : null,
    eigenVerbruik:
      stats.selfConsumptionBaseline !== null && stats.selfConsumptionBattery !== null
        ? { van: stats.selfConsumptionBaseline, naar: stats.selfConsumptionBattery }
        : null,
    netafname: { van: stats.gridImportBaselineKwh, naar: stats.gridImportBatteryKwh },
    teruglevering: { van: stats.gridExportBaselineKwh, naar: stats.gridExportBatteryKwh },
    laadbeurten: stats.cyclesPerYear,
    terugverdientijd,
    metOvergang: nettarief !== null,
    dag: nu.dag ?? null,
  };
}

/** De delen per doel, zoals de vergelijking in lib/useAnalysis.ts ze bijhoudt. */
export interface VergelijkingDelen {
  /** Op de tarieven van nu; undefined zolang het loopt. */
  nu: Record<Doel, VergelijkingDeel | undefined>;
  /** Met het nettarief; undefined zolang het loopt, null als het mislukte. */
  nettarief: Record<Doel, VergelijkingDeel | null | undefined>;
}

/**
 * De kaarten die er al zijn. Een kaart pas als ook het nettarief-deel binnen
 * is (of mislukte): anders springt de terugverdientijd halverwege van de ene
 * grondslag naar de andere.
 */
export function doelKaarten(v: VergelijkingDelen, config: Configuration): Partial<Record<Doel, DoelKaart>> {
  const uit: Partial<Record<Doel, DoelKaart>> = {};
  for (const doel of VERGELIJK_DOELEN) {
    const nu = v.nu[doel];
    const nt = v.nettarief[doel];
    if (nu && nt !== undefined) uit[doel] = doelKaart(doel, nu, nt, config);
  }
  return uit;
}
