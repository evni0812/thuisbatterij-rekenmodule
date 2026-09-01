/**
 * De referentie: geen batterij.
 *
 * Alleen de residual load gaat het net op of af. Dit is het scenario waartegen
 * elke besparing wordt afgezet, doorgerekend met exact dezelfde tariefstructuur
 * zodat het enige verschil tussen de scenario's de batterij zelf is.
 */

import { emptyResult, passThrough } from "./solver";
import type { DispatchResult, TariffSpec, Window } from "./types";

export function dispatchBaseline(
  window: Window,
  tariff: TariffSpec,
): DispatchResult {
  return passThrough(window, tariff, emptyResult(window.residualKwh.length));
}
