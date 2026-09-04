/**
 * Perfect-foresight optimum: de bovengrens van wat een batterij kan opleveren.
 *
 * Plant op de werkelijke residual met volledige kennis van prijzen en verbruik.
 * Geen echte batterij haalt dit — het dient als benchmark voor de realistische
 * strategie en als correctheidstoets (die mag hier nooit bovenuit komen).
 *
 * Waarom DP en geen LP-solver: een WASM-solver (highs-js, glpk.js) kost ~1 MB
 * bundle voor een probleem dat hier in een paar honderd regels exact genoeg
 * wordt opgelost, en die bundle zou elke bezoeker downloaden.
 */

import {
  maxChargeKwhPerStep,
  maxDischargeKwhPerStep,
  usableCapacityKwh,
} from "./battery";
import {
  chooseSocLevels,
  emptyResult,
  executePath,
  finalize,
  passThrough,
  planSocPath,
} from "./solver";
import type { BatterySpec, DispatchResult, TariffSpec, Window } from "./types";

export interface OptimalOptions {
  socLevels?: number;
  /**
   * Bloklengte in kwartieren. Standaard het hele venster in één keer: dat is
   * pas écht optimaal. Blokken met een benaderende eindwaardefunctie zijn dat
   * niet, en dan kan de rollende strategie — die elke dag herplant — er zelfs
   * bovenuit komen, wat de benchmark waardeloos maakt.
   *
   * Het geheugen laat dit toe: de keuzetabel is n * levels * 4 bytes, dus 14 MB
   * voor een heel jaar bij 101 niveaus en 56 MB bij de 401 niveaus die een
   * grote batterij met klein vermogen krijgt. Dat is de grootste allocatie van
   * de doorrekening; hij leeft alleen tijdens het plannen in de worker.
   */
  blockSteps?: number;
}

export function dispatchOptimal(
  window: Window,
  spec: BatterySpec,
  tariff: TariffSpec,
  options: OptimalOptions = {},
): DispatchResult {
  const n = window.residualKwh.length;
  const out = emptyResult(n);
  if (usableCapacityKwh(spec) <= 0 || n === 0) {
    return passThrough(window, tariff, out);
  }

  // Het grid moet fijn genoeg zijn voor zowel de capaciteit als het vermogen.
  const usable = usableCapacityKwh(spec);
  const maxTransfer = Math.max(
    maxChargeKwhPerStep(spec) * spec.efficiency,
    maxDischargeKwhPerStep(spec) / spec.efficiency,
  );
  const levels = chooseSocLevels(usable, maxTransfer, options.socLevels);
  const blockSteps = options.blockSteps ?? n;

  let soc = 0;
  for (let from = 0; from < n; from += blockSteps) {
    const to = Math.min(n, from + blockSteps);
    const path = planSocPath(
      window.residualKwh,
      window.prices.importPrice,
      window.prices.exportPrice,
      from,
      to,
      spec,
      tariff,
      levels,
      soc,
      // Alleen tussenblokken krijgen een eindwaarde; het laatste blok niet,
      // want restlading levert aan het einde van het venster niets meer op.
      to < n,
    );
    // Geen correcties: het plan is al optimaal op de werkelijke residual.
    soc = executePath(window, path, from, to, spec, tariff, soc, out, false);
  }
  return finalize(window, spec, tariff, out);
}

export { DEFAULT_SOC_LEVELS } from "./solver";
