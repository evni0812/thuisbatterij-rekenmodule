/**
 * Uitgangswaarden en batterijpresets.
 *
 * De presets komen uit de opgeslagen profielen van het Streamlit-prototype
 * (data/saved_profiles/) en zijn aangevuld met een standby-verbruik, dat daar
 * ontbrak maar bij een klein systeem zwaar meetelt: 15 W continu is 131 kWh per
 * jaar, en bij een batterij van 2 kWh eet dat een flink deel van de opbrengst op.
 */

import type { BatterySpec } from "./model/types";

export interface BatteryPreset {
  id: string;
  naam: string;
  merk: string;
  capaciteitKwh: number;
  vermogenKw: number;
  prijsEur: number;
  spec: Omit<BatterySpec, "wearCostEurPerKwh">;
  cycleLife: number;
}

function spec(
  capaciteitKwh: number,
  vermogenKw: number,
  rendementRondgang: number,
  dod: number,
  standbyWatt: number,
): Omit<BatterySpec, "wearCostEurPerKwh"> {
  return {
    capacityKwh: capaciteitKwh,
    depthOfCharge: dod,
    maxChargeKw: vermogenKw,
    maxDischargeKw: vermogenKw,
    // Eenrichtingsrendement is de wortel van de rondgang.
    efficiency: Math.sqrt(rendementRondgang),
    standbyWatt,
  };
}

export const PRESETS: BatteryPreset[] = [
  {
    id: "zendure-800pro",
    naam: "Zendure SolarFlow 800 Pro",
    merk: "Zendure",
    capaciteitKwh: 1.92,
    vermogenKw: 0.8,
    prijsEur: 829,
    spec: spec(1.92, 0.8, 0.88, 0.9, 12),
    cycleLife: 6000,
  },
  {
    id: "foxess-s22",
    naam: "FoxESS S22",
    merk: "FoxESS",
    capaciteitKwh: 2.1,
    vermogenKw: 0.8,
    prijsEur: 1199,
    spec: spec(2.1, 0.8, 0.88, 0.9, 12),
    cycleLife: 6000,
  },
  {
    id: "anker-solarbank3",
    naam: "Anker Solarbank 3 E2700 Pro",
    merk: "Anker",
    capaciteitKwh: 2.7,
    vermogenKw: 0.8,
    prijsEur: 1099,
    spec: spec(2.7, 0.8, 0.88, 0.9, 12),
    cycleLife: 6000,
  },
  {
    id: "zendure-2400ac",
    naam: "Zendure SolarFlow 2400 AC Plus",
    merk: "Zendure",
    capaciteitKwh: 2.4,
    vermogenKw: 2.4,
    prijsEur: 998,
    spec: spec(2.4, 2.4, 0.88, 0.9, 15),
    cycleLife: 6000,
  },
  {
    id: "thuisaccu-5kwh",
    naam: "Thuisaccu 5 kWh",
    merk: "Generiek",
    capaciteitKwh: 5,
    vermogenKw: 2.5,
    prijsEur: 2500,
    spec: spec(5, 2.5, 0.9, 0.95, 20),
    cycleLife: 6000,
  },
  {
    id: "thuisaccu-10kwh",
    naam: "Thuisaccu 10 kWh",
    merk: "Generiek",
    capaciteitKwh: 10,
    vermogenKw: 3.6,
    prijsEur: 4500,
    spec: spec(10, 3.6, 0.9, 0.95, 25),
    cycleLife: 6000,
  },
];

/**
 * Gemiddelde Nederlandse aansluiting mét zonnepanelen, als startpunt.
 * Bron: orde van grootte van een huishouden met circa 3.500 kWh verbruik en
 * 3,5 kWp aan panelen.
 */
export const STANDAARD_AFNAME_KWH = 2500;
export const STANDAARD_TERUGLEVERING_KWH = 2000;

export const STANDAARD_ANALYSEJAREN = 15;
export const STANDAARD_DISCONTOVOET = 0.03;
export const STANDAARD_PRIJSSTIJGING = 0.02;
export const STANDAARD_KALENDERDEGRADATIE = 0.015;
