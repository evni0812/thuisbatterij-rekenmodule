/**
 * Van instellingen naar een doorrekenbare configuratie.
 *
 * Stond in app/page.tsx, maar de build heeft hem nu ook nodig: die rekent het
 * standaardantwoord vooruit zodat een bezoeker meteen een uitkomst ziet in
 * plaats van vier seconden een leeg scherm. Bouwden pagina en build hun eigen
 * configuratie, dan zou de kleinste afwijking — een veld in een andere volgorde
 * is al genoeg voor een andere hash — het vooruitgerekende antwoord onvindbaar
 * maken. Dan zou de preload er zijn maar nooit gebruikt worden.
 */

import {
  PRESETS,
  STANDAARD_AFNAME_KWH,
  STANDAARD_ANALYSEJAREN,
  STANDAARD_DISCONTOVOET,
  STANDAARD_KALENDERDEGRADATIE,
  STANDAARD_PRESET_ID,
  STANDAARD_PRIJSSTIJGING,
  STANDAARD_TERUGLEVERING_KWH,
  type BatteryPreset,
} from "./presets";
import type { Instellingen } from "./url-state";
import type { Configuration } from "./worker/protocol";

/** Het netgebied van Liander: het grootste, en daarmee het meest waarschijnlijke. */
export const STANDAARD_NETGEBIED = "871685900000056162";

/**
 * De eerste dag waarvoor er profieldata is, en de laatste die we ooit willen
 * meenemen. Leeg in de instellingen betekent: alles wat er is.
 */
export const VROEGSTE_DAG = "2023-04-01";
export const LAATSTE_DAG = "2026-12-31";

export const STANDAARD: Instellingen = {
  afnameKwh: STANDAARD_AFNAME_KWH,
  terugleveringKwh: STANDAARD_TERUGLEVERING_KWH,
  presetId: STANDAARD_PRESET_ID,
  domein: STANDAARD_NETGEBIED,
  van: "",
  tot: "",
  spreiding: 1,
  terugleverkostenCt: 0,
  curtailment: true,
  heffing: "toen",
  analysejaren: STANDAARD_ANALYSEJAREN,
  discontovoet: STANDAARD_DISCONTOVOET,
  prijsstijging: STANDAARD_PRIJSSTIJGING,
  degradatie: STANDAARD_KALENDERDEGRADATIE,
  prijsEur: null,
  capaciteitKwh: null,
  vermogenKw: null,
  opwekKwh: null,
};

/** De gekozen batterij, of de eerste uit de lijst als het id niet bestaat. */
export function kiesPreset(presetId: string): BatteryPreset {
  return PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;
}

/**
 * Bouw de configuratie die de worker doorrekent.
 *
 * Capaciteit, vermogen en prijs komen uit de batterij, tenzij de gebruiker ze
 * zelf heeft overschreven.
 */
export function maakConfiguratie(inst: Instellingen): Configuration {
  const preset = kiesPreset(inst.presetId);
  return {
    domain: inst.domein,
    from: inst.van || VROEGSTE_DAG,
    to: inst.tot || LAATSTE_DAG,
    household: {
      annualGridImportKwh: inst.afnameKwh,
      annualGridExportKwh: inst.terugleveringKwh,
      spreadFactor: inst.spreiding,
    },
    battery: {
      ...preset.spec,
      capacityKwh: inst.capaciteitKwh ?? preset.capaciteitKwh,
      maxChargeKw: inst.vermogenKw ?? preset.vermogenKw,
      maxDischargeKw: inst.vermogenKw ?? preset.vermogenKw,
      wearCostEurPerKwh: 0,
    },
    tariff: {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: 0,
      feedInCostEurPerKwh: inst.terugleverkostenCt / 100,
      allowCurtailment: inst.curtailment,
    },
    investmentEur: inst.prijsEur ?? preset.prijsEur,
    cycleLife: preset.cycleLife,
    calendarLifeYears: preset.kalenderLevensduurJaren,
    analysisYears: inst.analysejaren,
    priceEscalation: inst.prijsstijging,
    discountRate: inst.discontovoet,
    calendarFadePerYear: inst.degradatie,
    residualValueEur: 0,
    annualProductionKwh: inst.opwekKwh ?? undefined,
    useHistoricalLevy: inst.heffing === "toen",
  };
}

/** De configuratie die een bezoeker ziet als hij niets instelt. */
export function standaardConfiguratie(): Configuration {
  return maakConfiguratie(STANDAARD);
}
