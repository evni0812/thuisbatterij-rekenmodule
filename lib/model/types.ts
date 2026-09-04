/**
 * Kerntypes van het rekenmodel.
 *
 * Eenheden zijn overal expliciet in de veldnaam: kWh, kW, EUR, EurPerKwh.
 * Tijdreeksen zijn Float64Array met één waarde per kwartier, tenzij anders
 * vermeld. Het aantal kwartieren per dag is 92, 96 of 100 (zomertijdovergangen),
 * dus nergens in de code mag 96 of 24 hardcoded staan.
 */

/** Eén kwartier duurt 0,25 uur. */
export const HOURS_PER_STEP = 0.25;

/** Technische eigenschappen van de batterij. */
export interface BatterySpec {
  /** Nominale capaciteit in kWh (naamplaat). */
  capacityKwh: number;
  /** Bruikbaar deel van de capaciteit, 0–1. LFP zit rond 0,9–1,0. */
  depthOfCharge: number;
  /** Maximaal laadvermogen aan de AC-zijde, kW. */
  maxChargeKw: number;
  /** Maximaal ontlaadvermogen aan de AC-zijde, kW. */
  maxDischargeKw: number;
  /**
   * Eenrichtingsrendement, 0–1. Round-trip is het kwadraat hiervan.
   * Grijpt aan bij de omzetting naar en uit de cel; de vermogenslimieten
   * gelden aan de AC-zijde (wat door de meter gaat).
   */
  efficiency: number;
  /** Eigen verbruik van omvormer/BMS in W, continu. */
  standbyWatt: number;
  /** Slijtagekosten per kWh doorzet, EUR/kWh. Zie wearCostPerKwh(). */
  wearCostEurPerKwh: number;
}

/** Prijsopbouw. Alle bedragen in EUR/kWh, inclusief 21% btw. */
export interface TariffSpec {
  /** Inkoopvergoeding van de leverancier, opgeteld bij de marktprijs. */
  purchaseSurchargeEurPerKwh: number;
  /** Energiebelasting inclusief btw. */
  energyTaxEurPerKwh: number;
  /** Terugleverkosten, afgetrokken van de terugleververgoeding. */
  feedInCostEurPerKwh: number;
  /**
   * Mag de omvormer afregelen bij een negatieve terugleverprijs?
   * Zonder curtailment betaal je om terug te leveren; met curtailment
   * gooi je het overschot weg en is de opbrengst nul.
   */
  allowCurtailment: boolean;
}

/** Wat de gebruiker over zijn eigen aansluiting invult. */
export interface HouseholdSpec {
  /** Jaarlijkse afname van het net in kWh (van de jaarafrekening). */
  annualGridImportKwh: number;
  /** Jaarlijkse teruglevering aan het net in kWh (van de jaarafrekening). */
  annualGridExportKwh: number;
  /**
   * Amplitudecorrectie op het gemiddelde profiel, default 1,0.
   * De MFFBAS-fracties zijn een gemiddelde over veel huishoudens en dus
   * gladder dan één aansluiting; deze factor maakt die bias instelbaar.
   */
  spreadFactor: number;
}

/** De prijsreeksen voor één simulatievenster, per kwartier uitgerold. */
export interface PriceSeries {
  /** Wat één kWh van het net kost, EUR/kWh. */
  importPrice: Float64Array;
  /** Wat één kWh teruglevering opbrengt, EUR/kWh. Kan negatief zijn. */
  exportPrice: Float64Array;
}

/** Het simulatievenster: tijdas plus alle per-kwartier reeksen. */
export interface Window {
  /** UTC-milliseconden van het begin van elk kwartier. */
  startMs: Float64Array;
  /**
   * Netto netuitwisseling zonder batterij, kWh per kwartier.
   * Positief = afname van het net, negatief = teruglevering.
   */
  residualKwh: Float64Array;
  prices: PriceSeries;
  /**
   * De twee reeksen waaruit `residualKwh` is samengesteld, kWh per kwartier.
   *
   * Optioneel, en nergens nodig om te rekenen: de dispatch werkt uitsluitend op
   * de netto residual. Ze zijn er om bij één dag te kunnen laten zien wat er
   * van het dak kwam en wat het huis van het net haalde, want in de netto reeks
   * vallen die twee tegen elkaar weg.
   */
  parts?: {
    gridImportKwh: Float64Array;
    gridExportKwh: Float64Array;
  };
}

/** Uitkomst van één doorrekening. */
export interface DispatchResult {
  /** Netafname per kwartier met batterij, kWh (≥ 0). */
  gridImportKwh: Float64Array;
  /** Netinvoeding per kwartier met batterij, kWh (≥ 0). */
  gridExportKwh: Float64Array;
  /** Laadvermogen aan de AC-zijde per kwartier, kWh (≥ 0). */
  chargeKwh: Float64Array;
  /** Ontlaadvermogen aan de AC-zijde per kwartier, kWh (≥ 0). */
  dischargeKwh: Float64Array;
  /** Lading in de cel aan het einde van elk kwartier, kWh. */
  socKwh: Float64Array;
  /** Weggegooid overschot door curtailment, kWh. */
  curtailedKwh: Float64Array;
  /** Variabele energiekosten over het venster, EUR (negatief = opbrengst). */
  totalCostEur: number;
  /** Equivalente volledige cycli, geteld over de ontlading. */
  equivalentCycles: number;
}

/** Vergelijking van scenario's over hetzelfde venster. */
export interface ScenarioComparison {
  /** Zonder batterij: de referentie. */
  baseline: DispatchResult;
  /** Met batterij, realistische day-ahead strategie. */
  realistic: DispatchResult;
  /** Met batterij, perfect foresight: de bovengrens. */
  optimal: DispatchResult;
}
