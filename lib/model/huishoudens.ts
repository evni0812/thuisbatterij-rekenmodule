/**
 * Voor wie loont deze batterij?
 *
 * Dezelfde batterij, doorgerekend voor een reeks huishoudens: oplopende
 * teruglevering bij de eigen afname, plus één huishouden zonder zonnepanelen.
 * Eén realistische jaarsimulatie per punt, op hetzelfde jaar als het raster.
 *
 * Net als lib/model/raster.ts gedeeld tussen de worker en de build, zodat het
 * vooruitgerekende antwoord en het zelf gerekende hetzelfde zijn.
 */

import type { Invoerbron } from "../data/invoer";
import { vensterGrenzen } from "../data/invoer";
import { referentieIndexVan, slijtageVoor } from "./analysis";
import { dispatchBaseline } from "./dispatch-baseline";
import { dispatchRolling } from "./dispatch-rolling";
import type { Configuration } from "../worker/protocol";

/** De terugleverniveaus, kWh per jaar; zes punten van niets tot veel. */
export const HUISHOUDENS_TERUGLEVERING: readonly number[] = [0, 1000, 2000, 3000, 4000, 6000];

export interface HuishoudenVariant {
  /** Teruglevering in kWh per jaar; 0 bij "zonder zonnepanelen". */
  terugleveringKwh: number;
  /** Met panelen: het gemeten AMI-profiel; zonder: het AZI-profiel. */
  zonnepanelen: boolean;
}

export interface HuishoudenPunt extends HuishoudenVariant {
  afnameKwh: number;
  /** Besparing in het rasterjaar met de realistische strategie, euro. */
  savingEur: number;
  cyclesPerYear: number;
}

/** De vaste lijst: zes huishoudens met panelen, dan één zonder. */
export function huishoudensVarianten(): HuishoudenVariant[] {
  return [
    ...HUISHOUDENS_TERUGLEVERING.map((t) => ({ terugleveringKwh: t, zonnepanelen: true })),
    { terugleveringKwh: 0, zonnepanelen: false },
  ];
}

/** Is een bewaarde lijst punten nog dezelfde reeks als de huidige varianten? */
export function pastBijVarianten(punten: readonly (HuishoudenPunt | null)[] | undefined): boolean {
  if (!punten) return false;
  const v = huishoudensVarianten();
  if (punten.length !== v.length) return false;
  return punten.every(
    (p, i) =>
      p === null ||
      (p.terugleveringKwh === v[i]!.terugleveringKwh && p.zonnepanelen === v[i]!.zonnepanelen),
  );
}

/**
 * Dezelfde batterij, een ander huishouden. Alleen de teruglevering en het
 * profieltype veranderen; afname en alle batterij- en tariefvelden blijven.
 */
export function huishoudenConfiguratie(basis: Configuration, v: HuishoudenVariant): Configuration {
  const { afnametype: _weg, ...rest } = basis;
  void _weg;
  return {
    ...rest,
    household: {
      ...basis.household,
      annualGridExportKwh: v.zonnepanelen ? v.terugleveringKwh : 0,
    },
    ...(v.zonnepanelen ? {} : { afnametype: "AZI" as const }),
    annualProductionKwh: v.zonnepanelen ? basis.annualProductionKwh : 0,
  };
}

/**
 * Eén punt: één realistische jaarsimulatie op het referentiejaar, met de
 * slijtagedrempel van de eigen batterij, precies zoals in de hoofdanalyse.
 * Voor het huishouden met de eigen teruglevering is dit dus exact de
 * jaarbesparing van het referentiejaar in het hoofdresultaat.
 */
export async function huishoudenPunt(
  bron: Invoerbron,
  basis: Configuration,
  v: HuishoudenVariant,
): Promise<HuishoudenPunt> {
  const cfg = huishoudenConfiguratie(basis, v);
  const grenzen = vensterGrenzen(bron.gegevens, cfg);
  if (grenzen.length === 0) {
    throw new Error(`geen profieldata voor dit huishouden in netgebied ${cfg.domain}`);
  }
  const invoer = await bron.bouwInvoer(cfg, { alleenVenster: referentieIndexVan(grenzen) });
  const entry = invoer.windows[0]!;
  const basisDispatch = dispatchBaseline(entry.window, invoer.tariff);
  const { spec } = slijtageVoor(invoer);
  const res = dispatchRolling(entry.window, spec, invoer.tariff);
  return {
    ...v,
    afnameKwh: cfg.household.annualGridImportKwh,
    savingEur: basisDispatch.totalCostEur - res.totalCostEur,
    cyclesPerYear: res.equivalentCycles,
  };
}
