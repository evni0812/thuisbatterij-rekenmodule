/**
 * Van profielfracties naar de netto netuitwisseling van één huishouden.
 *
 * De MFFBAS-fracties beschrijven de VORM: welk deel van het jaarvolume in elk
 * kwartier valt. De gebruiker levert de SCHAAL: hoeveel kWh hij per jaar van het
 * net afneemt en hoeveel hij teruglevert. Beide getallen staan op de
 * jaarafrekening, en het zijn precies de twee schaalfactoren die de E17- en
 * E18-reeksen nodig hebben. Er hoeft dus niets aangenomen te worden over
 * oriëntatie, instraling of zelfconsumptiegraad: dat zit al in het gerealiseerde
 * profiel.
 *
 * ── Waarom netto ─────────────────────────────────────────────────────────────
 * E17 en E18 zijn gemiddelden over veel huishoudens. Op één kwartier zijn ze
 * allebei groter dan nul, terwijl één aansluiting op elk moment maar één kant op
 * kan. We trekken ze daarom van elkaar af. Zou je ze apart houden, dan mocht de
 * batterij op hetzelfde kwartier laden én ontladen — energie uit het niets.
 *
 * ── De keerzijde: het gemiddelde is te glad ──────────────────────────────────
 * Datzelfde middelen maakt het profiel vlakker dan een echte aansluiting: pieken
 * en dalen vallen tegen elkaar weg. Een batterij heeft juist waarde bij scherpe
 * verschillen, dus dit onderschat de zelfconsumptie systematisch. De
 * spreidingsfactor maakt die bias instelbaar en zichtbaar in plaats van
 * verborgen.
 */

import type { HouseholdSpec } from "./types";

/**
 * Bereken de netto netuitwisseling per kwartier.
 *
 * @returns kWh per kwartier; positief is afname van het net, negatief is
 *   teruglevering
 */
export function buildResidual(
  importFraction: Float32Array,
  exportFraction: Float32Array,
  household: HouseholdSpec,
): Float64Array {
  const n = importFraction.length;
  if (exportFraction.length !== n) {
    throw new Error(
      `afname- en invoedingsreeks verschillen in lengte: ${n} en ${exportFraction.length}`,
    );
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] =
      importFraction[i]! * household.annualGridImportKwh -
      exportFraction[i]! * household.annualGridExportKwh;
  }

  const spread = household.spreadFactor;
  if (spread !== 1) applySpread(out, spread);
  return out;
}

/**
 * Vergroot of verklein de uitslagen rond het dagelijkse gemiddelde.
 *
 * Het gemiddelde per dag blijft exact gelijk, dus de jaarvolumes veranderen niet
 * — alleen de scherpte van het profiel. Dat is precies de eigenschap waarin een
 * individuele aansluiting van het gemiddelde afwijkt.
 *
 * Het dagelijkse gemiddelde is de referentie, niet het jaargemiddelde: anders
 * zou opschalen de seizoenen uitvergroten in plaats van het dagpatroon.
 */
export function applySpread(residual: Float64Array, factor: number): void {
  const n = residual.length;
  // Dagen zijn hier blokken van gelijke lengte in de reeks; rond de
  // zomertijdovergangen wijkt één blok af, wat voor een gemiddelde niet uitmaakt.
  const perDay = 96;
  for (let start = 0; start < n; start += perDay) {
    const end = Math.min(n, start + perDay);
    let sum = 0;
    for (let i = start; i < end; i++) sum += residual[i]!;
    const mean = sum / (end - start);
    for (let i = start; i < end; i++) {
      residual[i] = mean + (residual[i]! - mean) * factor;
    }
  }
}

/** Samenvattende volumes van een residual-reeks, in kWh. */
export interface ResidualSummary {
  gridImportKwh: number;
  gridExportKwh: number;
  /** Hoeveel van het jaarvolume in dit venster valt, 0–1. */
  importFractionOfYear: number;
  exportFractionOfYear: number;
}

export function summarizeResidual(
  residual: Float64Array,
  household: HouseholdSpec,
): ResidualSummary {
  let imp = 0;
  let exp = 0;
  for (let i = 0; i < residual.length; i++) {
    const r = residual[i]!;
    if (r > 0) imp += r;
    else exp -= r;
  }
  return {
    gridImportKwh: imp,
    gridExportKwh: exp,
    importFractionOfYear:
      household.annualGridImportKwh > 0 ? imp / household.annualGridImportKwh : 0,
    exportFractionOfYear:
      household.annualGridExportKwh > 0 ? exp / household.annualGridExportKwh : 0,
  };
}
