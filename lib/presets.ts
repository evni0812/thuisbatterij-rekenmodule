/**
 * Uitgangswaarden en batterijpresets.
 *
 * De lijst is bedoeld als dwarsdoorsnede van wat een Nederlands huishouden in
 * 2026 daadwerkelijk kan kopen: van een stekkerbatterij van twee kilowattuur
 * tot een vaste thuisaccu van tien. Modellen die alleen in capaciteit en prijs
 * op een ander lijken, staan er niet in — die voegen niets toe aan de keuze en
 * maken de lijst alleen langer.
 *
 * PRIJZEN — richtprijs van een wérkende set, peildatum september 2026. Bij de
 * stekkerbatterijen zit de P1-meter erbij: zonder die meter kan het ding niet
 * op uurtarieven sturen, en dan is deze hele rekentool niet van toepassing.
 * Waar de meter niet in de doos zit, is hij opgeteld (circa 25 tot 35 euro).
 * Bij de twee generieke thuisaccu's is het een geïnstalleerde prijs inclusief
 * omvormer en montage; dat is wat zo'n systeem in de praktijk kost, en de oude
 * waarden hier (2.500 en 4.500 euro) waren kale hardwareprijzen die de
 * businesscase te rooskleurig maakten.
 *
 * RENDEMENT — het rondgangsrendement is waar mogelijk een gemeten waarde uit
 * onafhankelijke tests, niet het getal van het datasheet. Die twee lopen flink
 * uiteen: fabrikanten meten de cel, de praktijk meet de wandcontactdoos.
 *
 * BRUIKBAAR DEEL — 90% voor de stekkerbatterijen en 95% voor de vaste accu's,
 * als modelaanname. Fabrikanten definiëren "bruikbaar" onderling verschillend
 * (de een noemt de celcapaciteit, de ander wat eruit komt), dus een uniforme
 * aanname vergelijkt eerlijker dan de opgaves door elkaar gebruiken.
 *
 * STANDBY — het eigen verbruik van de omvormer stond niet in de profielen van
 * het Streamlit-prototype, maar telt bij een klein systeem zwaar mee: 15 W
 * continu is 131 kWh per jaar, en bij een batterij van 2 kWh eet dat een flink
 * deel van de opbrengst op. Waar een test een getal noemt, staat dat getal er;
 * anders een schatting die past bij de omvormerklasse.
 */

import type { BatterySpec } from "./model/types";

export interface BatteryPreset {
  id: string;
  naam: string;
  merk: string;
  capaciteitKwh: number;
  vermogenKw: number;
  prijsEur: number;
  /** Waar de prijs vandaan komt: wat er wel en niet in zit. */
  prijsNoot: string;
  spec: Omit<BatterySpec, "wearCostEurPerKwh">;
  cycleLife: number;
  /**
   * Hoe lang de batterij meegaat op leeftijd, los van hoeveel je hem gebruikt.
   *
   * Hoort bij de batterij, niet bij de analyse. Eerder werd hiervoor de
   * analyseperiode gebruikt, en dan ging de accu anders handelen zodra je die
   * schuif verzette. Vijftien jaar is de gangbare garantietermijn-plus-marge
   * voor LFP; geen fabrikant in deze lijst belooft er meer.
   */
  kalenderLevensduurJaren: number;
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
    id: "zendure-800pro2",
    naam: "Zendure SolarFlow 800 Pro 2",
    merk: "Zendure",
    capaciteitKwh: 1.92,
    vermogenKw: 0.8,
    prijsEur: 819,
    prijsNoot: "789 euro plus de P1-meter van 30",
    spec: spec(1.92, 0.8, 0.88, 0.9, 12),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "homewizard-plugin",
    naam: "HomeWizard Plug-In Battery",
    merk: "HomeWizard",
    capaciteitKwh: 2.7,
    vermogenKw: 0.8,
    prijsEur: 1220,
    prijsNoot: "1.195 euro plus de P1-meter van 25",
    // 85% is het midden van wat gebruikers meten; het datasheet claimt 92%.
    spec: spec(2.7, 0.8, 0.85, 0.9, 10),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "anker-solarbank3",
    naam: "Anker SOLIX Solarbank 3 E2700 Pro",
    merk: "Anker",
    capaciteitKwh: 2.69,
    vermogenKw: 0.8,
    prijsEur: 1134,
    prijsNoot: "1.099 euro plus de P1-meter van 35",
    // Laadt tot 1.200 W maar levert 800 W terug; het model rekent met de
    // laagste van de twee, want die bepaalt hoeveel er 's avonds uit kan.
    spec: spec(2.69, 0.8, 0.8, 0.9, 12),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "zendure-2400ac",
    naam: "Zendure SolarFlow 2400 AC+",
    merk: "Zendure",
    capaciteitKwh: 2.4,
    vermogenKw: 2.4,
    prijsEur: 879,
    prijsNoot: "849 euro plus de P1-meter van 30",
    spec: spec(2.4, 2.4, 0.88, 0.9, 15),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "marstek-venus-e3",
    naam: "Marstek Venus E 3.0",
    merk: "Marstek",
    capaciteitKwh: 5.12,
    vermogenKw: 2.5,
    prijsEur: 1199,
    prijsNoot: "1.199 euro, P1-meter zit erbij",
    // 7 W standby is gemeten met een slimme stekker; laag voor deze klasse.
    spec: spec(5.12, 2.5, 0.83, 0.9, 7),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "anker-solarbank-max",
    naam: "Anker SOLIX Solarbank Max AC",
    merk: "Anker",
    capaciteitKwh: 7,
    vermogenKw: 3.5,
    prijsEur: 2134,
    prijsNoot: "2.099 euro plus de P1-meter van 35",
    spec: spec(7, 3.5, 0.85, 0.9, 20),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "thuisaccu-5kwh",
    naam: "Thuisaccu 5 kWh, geïnstalleerd",
    merk: "Generiek",
    capaciteitKwh: 5,
    vermogenKw: 2.5,
    prijsEur: 3750,
    prijsNoot: "inclusief omvormer en installatie",
    spec: spec(5, 2.5, 0.9, 0.95, 20),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "thuisaccu-10kwh",
    naam: "Thuisaccu 10 kWh, geïnstalleerd",
    merk: "Generiek",
    capaciteitKwh: 10,
    vermogenKw: 3.6,
    prijsEur: 5750,
    prijsNoot: "inclusief omvormer en installatie",
    spec: spec(10, 3.6, 0.9, 0.95, 25),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
];

/**
 * Waar de tool mee opent. De Marstek is het meest verkochte model van dit
 * moment en zit qua maat in het midden van de lijst, dus wie niets kiest ziet
 * een uitkomst die voor de meeste huishoudens herkenbaar is.
 */
/**
 * De batterij die je ziet als je niets kiest.
 *
 * De Zendure 800 Pro 2 is de goedkoopste stekkerbatterij in de lijst en
 * daarmee het eerlijkste startpunt: wie hier al ziet dat het niet uit kan,
 * weet genoeg. Een groter systeem laat een mooier bedrag zien, maar begint met
 * een investering die de meeste bezoekers niet overwegen.
 */
export const STANDAARD_PRESET_ID = "zendure-800pro2";

/** Peildatum van de prijzen hierboven, voor wie ze wil narekenen. */
export const PRIJSPEILDATUM = "september 2026";

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
