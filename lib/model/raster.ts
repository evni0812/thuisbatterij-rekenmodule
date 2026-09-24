/**
 * Het raster van batterijmaten: één punt per combinatie van capaciteit en
 * vermogen, alleen de realistische strategie, op één representatief jaar.
 *
 * Dit stond in de worker, maar de build heeft het nu ook nodig: het raster
 * wordt voor de standaardconfiguratie vooruitgerekend, zodat een bezoeker het
 * direct ziet. Dezelfde puntfunctie voor beide, anders lopen ze uit elkaar en
 * ziet iemand eerst het ene raster en na een herberekening het andere.
 */

import { wearCostPerKwh } from "./battery";
import { dispatchRolling } from "./dispatch-rolling";
import type { AnalysisInput } from "./analysis";
import type { BatterySpec, DispatchResult, TariffSpec } from "./types";
import type { GridPoint } from "../worker/protocol";

/**
 * De maten die het raster doorrekent; ook de assen van de kaart.
 *
 * Alleen maten die je kunt kopen. Capaciteit van 2 kWh (een stekkerbatterij
 * met één accu) tot 20 kWh (een grote vaste thuisbatterij). Vermogen: 0,8 kW
 * is de grens voor een stekkerbatterij; 1,2 kW en 2,4 kW zijn de gangbare
 * stappen daarboven (een batterij met een eigen groep op één fase), 3,6 kW een
 * enkelfase-omvormer en 5 en 10 kW driefase-omvormers. De eerdere assen
 * begonnen bij 1 kWh en 0,5 kW; die maten bestaan als product niet, en de
 * kaart gaf er toch een advies over.
 */
export const RASTER_CAPACITEITEN = [2, 3, 5, 7.5, 10, 15, 20];
export const RASTER_VERMOGENS = [0.8, 1.2, 2.4, 3.6, 5, 10];

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
 * Eén run per punt, met de slijtageprijs van die maat maal het strategiedeel
 * als drempel: dezelfde regel als in `runAnalysis`.
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
  wearFraction = 1,
): GridPoint {
  const maat: BatterySpec = {
    ...battery,
    capacityKwh: cap,
    maxChargeKw: kw,
    maxDischargeKw: kw,
    wearCostEurPerKwh: 0,
  };
  const res = dispatchRolling(
    entry.window,
    { ...maat, wearCostEurPerKwh: wearCostPerKwh(prijsPerKwh * cap, cycleLife, maat) * wearFraction },
    tariff,
  );
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
