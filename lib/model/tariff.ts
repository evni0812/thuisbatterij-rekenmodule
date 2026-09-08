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
 * @param levyPerStep Heffing per kwartier (energiebelasting plus inkoopopslag),
 *   EUR/kWh. Vervangt de vaste `energyTaxEurPerKwh` uit het tarief.
 *
 *   De heffing is binnen een jaar niet constant: in 2025 was hij tot september
 *   17,13 ct en daarna 14,29 ct, en in 2026 verschoof hij halverwege van 12,88
 *   naar 13,00 ct. Eén jaarconstante rekent dan een kwartaal lang 2,8 ct per
 *   kWh te veel op elke afname. Met de reeks uit allInPrijs − marktprijs klopt
 *   elk uur.
 */
export function buildPriceSeries(
  marketPrice: Float64Array,
  tariff: TariffSpec,
  levyPerStep?: Float64Array,
  /**
   * Tijdsafhankelijk nettarief per kwartier, EUR/kWh. Optioneel: alleen het
   * scenario voor 2029 vult dit. Komt bovenop de afnameprijs, en wordt van de
   * terugleververgoeding afgetrokken als het ook op invoeding wordt geheven —
   * of dat gebeurt is in het voorstel nog niet vastgelegd.
   */
  netTariffPerStep?: Float64Array,
  netTariffOnExport = false,
): PriceSeries {
  const n = marketPrice.length;
  if (levyPerStep && levyPerStep.length !== n) {
    throw new Error(
      `heffingsreeks van ${levyPerStep.length} kwartieren past niet op ${n} prijzen`,
    );
  }
  const importPrice = new Float64Array(n);
  const exportPrice = new Float64Array(n);
  const surcharge = tariff.purchaseSurchargeEurPerKwh + tariff.energyTaxEurPerKwh;

  for (let i = 0; i < n; i++) {
    const heffing = levyPerStep
      ? levyPerStep[i]! + tariff.purchaseSurchargeEurPerKwh
      : surcharge;
    const net = netTariffPerStep ? netTariffPerStep[i]! : 0;
    importPrice[i] = marketPrice[i]! + heffing + net;
    exportPrice[i] =
      marketPrice[i]! - tariff.feedInCostEurPerKwh - (netTariffOnExport ? net : 0);
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
