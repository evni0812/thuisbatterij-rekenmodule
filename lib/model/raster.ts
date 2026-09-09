/**
 * Het raster van batterijmaten: één punt per combinatie van capaciteit en
 * vermogen, alleen de realistische strategie, op één representatief jaar.
 *
 * Dit stond in de worker, maar de build heeft het nu ook nodig: het raster
 * wordt voor de standaardconfiguratie vooruitgerekend, zodat een bezoeker het
 * direct ziet. Dezelfde puntfunctie voor beide, anders lopen ze uit elkaar en
 * ziet iemand eerst het ene raster en na een herberekening het andere.
 */

import { marginalWearCostPerKwh, wearCostPerKwh, WEAR_ONDERGRENS_DEEL } from "./battery";
import { dispatchRolling } from "./dispatch-rolling";
import type { AnalysisInput } from "./analysis";
import type { BatterySpec, DispatchResult, TariffSpec } from "./types";
import type { GridPoint } from "../worker/protocol";

/** De maten die het raster doorrekent; ook de assen van de kaart. */
export const RASTER_CAPACITEITEN = [1, 2, 3, 5, 7.5, 10, 15];
export const RASTER_VERMOGENS = [0.5, 0.8, 1.5, 2.5, 3.6, 5];

/**
 * Het jaar waarop het raster rekent: het meest recente volledige, anders het
 * laatste. Een volledig raster met alle jaren én het optimum zou minutenlang
 * duren, en de vraag die de kaart beantwoordt — welke maat loont — hangt niet
 * af van de bovengrens of van het precieze jaar.
 */
export function rasterJaar(invoer: AnalysisInput): AnalysisInput["windows"][number] {
  const volledig = invoer.windows.filter((w) => w.isFullYear);
  const entry = (volledig.length > 0 ? volledig : invoer.windows).at(-1);
  if (!entry) throw new Error("geen doorrekenbare periode voor het raster");
  return entry;
}

/**
 * Eén punt van het raster.
 *
 * De investering schaalt mee met de capaciteit: een batterij van 20 kWh kost
 * niet hetzelfde als de gekozen van 2 kWh. Zonder die correctie kreeg elke maat
 * de prijs van de gekozen batterij, en werd een grote batterij vrijwel zonder
 * slijtagedrempel doorgerekend.
 *
 * Eerst met de ondergrens: dat vertelt of de beurten voor deze maat schaars
 * zijn. Zijn ze dat niet, dan blijft de drempel op die ondergrens en ís deze
 * run al het antwoord. Alleen bij schaarste volgt een tweede run.
 */
export function rasterPunt(
  entry: AnalysisInput["windows"][number],
  basis: DispatchResult,
  battery: BatterySpec,
  tariff: TariffSpec,
  cap: number,
  kw: number,
  prijsPerKwh: number,
  cycleLife: number,
  calendarLifeYears: number,
): GridPoint {
  const maat: BatterySpec = {
    ...battery,
    capacityKwh: cap,
    maxChargeKw: kw,
    maxDischargeKw: kw,
    wearCostEurPerKwh: 0,
  };
  const ondergrens =
    wearCostPerKwh(prijsPerKwh * cap, cycleLife, maat) * WEAR_ONDERGRENS_DEEL;
  const vrij = dispatchRolling(
    entry.window,
    { ...maat, wearCostEurPerKwh: ondergrens },
    tariff,
  );
  const wear = marginalWearCostPerKwh(
    prijsPerKwh * cap,
    cycleLife,
    maat,
    vrij.equivalentCycles,
    calendarLifeYears,
  );
  const res =
    wear > ondergrens + 1e-12
      ? dispatchRolling(entry.window, { ...maat, wearCostEurPerKwh: wear }, tariff)
      : vrij;
  return {
    capacityKwh: cap,
    powerKw: kw,
    savingEur: basis.totalCostEur - res.totalCostEur,
    cyclesPerYear: res.equivalentCycles,
  };
}

/** Prijs per kWh capaciteit van de gekozen batterij, om andere maten te prijzen. */
export function prijsPerKwhVan(invoer: AnalysisInput, investmentEur: number): number {
  return invoer.battery.capacityKwh > 0 ? investmentEur / invoer.battery.capacityKwh : 0;
}
