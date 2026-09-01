/**
 * Prijsopbouw: van marktprijs naar wat de consument betaalt en ontvangt.
 *
 * Alle bedragen zijn inclusief 21% btw. De ANWB-API levert de marktprijs al
 * inclusief btw, en de consument ontvangt de terugleververgoeding eveneens
 * inclusief btw, dus er wordt nergens btw bij- of afgeteld.
 *
 * We rekenen met de tarieven zoals ze in de gekozen periode werkelijk golden
 * en zetten alleen de saldering uit. Geen prijsprojectie: de vraag is wat de
 * batterij zou hebben opgeleverd, niet wat hij ooit gaat opleveren.
 */

import type { PriceSeries, TariffSpec } from "./types";

/**
 * Bouw de import- en exportprijsreeksen uit de kale marktprijs.
 *
 * @param marketPrice marktprijs per kwartier in EUR/kWh (incl. btw)
 */
export function buildPriceSeries(
  marketPrice: Float64Array,
  tariff: TariffSpec,
): PriceSeries {
  const n = marketPrice.length;
  const importPrice = new Float64Array(n);
  const exportPrice = new Float64Array(n);
  const surcharge = tariff.purchaseSurchargeEurPerKwh + tariff.energyTaxEurPerKwh;

  for (let i = 0; i < n; i++) {
    importPrice[i] = marketPrice[i]! + surcharge;
    exportPrice[i] = marketPrice[i]! - tariff.feedInCostEurPerKwh;
  }
  return { importPrice, exportPrice };
}

/**
 * Wat één kWh netuitwisseling kost. Positief `gridKwh` is afname, negatief is
 * teruglevering; de uitkomst is positief voor kosten en negatief voor opbrengst.
 *
 * Bij curtailment wordt teruglevering tegen een negatieve prijs afgeregeld: dan
 * levert het niets op in plaats van geld te kosten. Zonder curtailment betaal je
 * om terug te leveren, wat op momenten met negatieve marktprijzen echt gebeurt.
 */
export function stepCost(
  gridKwh: number,
  importPrice: number,
  exportPrice: number,
  allowCurtailment: boolean,
): number {
  if (gridKwh > 0) return gridKwh * importPrice;
  if (gridKwh === 0) return 0;
  if (allowCurtailment && exportPrice < 0) return 0;
  return gridKwh * exportPrice;
}

/**
 * Hoeveel van een overschot daadwerkelijk het net op gaat.
 * Met curtailment blijft bij een negatieve prijs alles thuis (weggegooid).
 */
export function deliverableExportKwh(
  surplusKwh: number,
  exportPrice: number,
  allowCurtailment: boolean,
): number {
  if (surplusKwh <= 0) return 0;
  if (allowCurtailment && exportPrice < 0) return 0;
  return surplusKwh;
}
