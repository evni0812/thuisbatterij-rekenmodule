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
 * EIGEN GROEP — boven 800 W mag een batterij niet aan een gewoon stopcontact;
 * aan het stopcontact levert een Marstek of een Zendure 2400 dan ook maar
 * 800 W. Voor het volle vermogen legt een installateur een eigen groep aan, en
 * die zit bij de modellen boven 0,8 kW in de prijs: 300 euro, wat een enkele
 * extra groep gangbaar kost (300 tot 1.200 euro afhankelijk van de meterkast).
 * Dezelfde post zit in de kostenregel voor andere maten (lib/model/kosten.ts).
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
 * STANDBY — het eigen verbruik van de omvormer zit bewust NIET in het model.
 * Dit model gaat over wat de handel oplevert. Standby (7 tot 25 W bij deze
 * modellen, 60 tot 220 kWh per jaar) is een vaste post van het bezit, net als
 * de aanschaf, en loopt door of de batterij nu handelt of niet; hij hoort dus
 * naast de businesscase en niet in de dagcijfers. Eerder zat hij er wél in en
 * trok hij elke dag een paar cent van het resultaat af, waardoor een dag met een
 * winstgevende handel op nul uitkwam en als "slijtage voor niets" las.
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
  /** Bron van prijs en specificaties. */
  bron: string;
  /** Wanneer de prijs is nagekeken, JJJJ-MM-DD. */
  peildatum: string;
  spec: Omit<BatterySpec, "wearCostEurPerKwh">;
  cycleLife: number;
  /**
   * Hoe lang de batterij meegaat op leeftijd, los van hoeveel je hem gebruikt.
   *
   * Hoort bij de batterij, niet bij de analyse. Eerder werd hiervoor de
   * analyseperiode gebruikt, en dan ging de accu anders handelen zodra je die
   * schuif verzette.
   *
   * Vijftien jaar, naast een garantie die bij deze merken meestal tien jaar is
   * (HomeWizard noemt zelf vijftien jaar of 6.000 cycli tot 70% capaciteit).
   * De garantie is een ondergrens die de fabrikant durft toe te zeggen, geen
   * levensduur. Met de kalenderdegradatie van het model (1,5% per jaar) staat
   * er na vijftien jaar nog ruim 77% capaciteit, rond het gangbare einde-van-
   * leven-criterium van 70 tot 80%. Twaalf jaar zou ook te verdedigen zijn,
   * maar daar is geen bron die beter onderbouwt dan dit; het getal wordt
   * alleen ter duiding gebruikt en stuurt de dispatch niet.
   */
  kalenderLevensduurJaren: number;
}

function spec(
  capaciteitKwh: number,
  vermogenKw: number,
  rendementRondgang: number,
  dod: number,
): Omit<BatterySpec, "wearCostEurPerKwh"> {
  return {
    capacityKwh: capaciteitKwh,
    depthOfCharge: dod,
    maxChargeKw: vermogenKw,
    maxDischargeKw: vermogenKw,
    // Eenrichtingsrendement is de wortel van de rondgang.
    efficiency: Math.sqrt(rendementRondgang),
  };
}

export const PRESETS: BatteryPreset[] = [
  {
    id: "zendure-800pro2",
    naam: "Zendure SolarFlow 800 Pro 2",
    merk: "Zendure",
    capaciteitKwh: 1.92,
    vermogenKw: 0.8,
    prijsEur: 699,
    // Adviesprijs 789 euro; 699 is de actieprijs in de ANWB-webwinkel
    // (marktcheck 24-09-2026). De standaardconfiguratie rekent met de prijs
    // waarvoor hij nu te koop is.
    prijsNoot: "actieprijs in de ANWB-webwinkel, compleet met de P1-meter (adviesprijs 789 euro)",
    bron: "https://www.zendure.nl/products/solarflow-800-pro2",
    peildatum: "2026-09-24",
    spec: spec(1.92, 0.8, 0.88, 0.9),
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
    bron: "https://www.homewizard.com/shop/plug-in-battery/",
    peildatum: "2026-09-24",
    // HomeWizard noemt zelf een rendement in de praktijk van 70 tot 85%;
    // gebruikers en testers meten rond 75 tot 80%. Het datasheet claimt 92%,
    // maar dat is de cel, niet de wandcontactdoos. Eerder stond hier 85%, de
    // bovenkant van die band.
    spec: spec(2.7, 0.8, 0.8, 0.9),
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
    bron: "https://www.ankersolix.com/nl/products/a17c5",
    peildatum: "2026-09-24",
    // Laadt én levert tot 1.200 W, maar alleen aan een eigen groep; aan een
    // gewoon stopcontact is het 800 W, beide kanten op. Dit is de
    // stekkerversie, dus 0,8 kW. Wie hem aan een eigen groep hangt, zet het
    // vermogen op 1,2 kW en telt de installateur erbij.
    spec: spec(2.69, 0.8, 0.8, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    // De klasse tussen stekker en vaste accu: 1,4 kW aan een eigen groep (1,6
    // kW met een extra accu; het model rekent met de basisset). Boven 0,8 kW,
    // dus met 300 euro voor de eigen groep, net als de andere modellen boven
    // de stekkergrens. In de ANWB-webwinkel 966 euro (24-09-2026).
    id: "zendure-1600ac",
    naam: "Zendure SolarFlow 1600 AC+",
    merk: "Zendure",
    capaciteitKwh: 1.92,
    vermogenKw: 1.4,
    prijsEur: 1119,
    prijsNoot: "789 euro adviesprijs bij Zendure plus de P1-meter van 30 en 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    bron: "https://www.zendure.nl/products/zendure-solarflow-1600-ac",
    peildatum: "2026-09-24",
    spec: spec(1.92, 1.4, 0.88, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "zendure-2400ac",
    naam: "Zendure SolarFlow 2400 AC+",
    merk: "Zendure",
    capaciteitKwh: 2.4,
    vermogenKw: 2.4,
    prijsEur: 1179,
    prijsNoot: "849 euro plus de P1-meter van 30 en 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    bron: "https://www.zendure.nl/collections/solarflow-series",
    peildatum: "2026-09-24",
    spec: spec(2.4, 2.4, 0.88, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "marstek-venus-e3",
    naam: "Marstek Venus E 3.0",
    merk: "Marstek",
    capaciteitKwh: 5.12,
    vermogenKw: 2.5,
    prijsEur: 1499,
    prijsNoot: "1.199 euro met de P1-meter erbij, plus 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    bron: "https://www.marstek.nl/product/marstek-venus-e-3-0-plug-charge-thuisbatterij-5-12-kwh-incl-p1-meter/",
    peildatum: "2026-09-24",
    spec: spec(5.12, 2.5, 0.83, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  },
  {
    id: "anker-solarbank-max",
    naam: "Anker SOLIX Solarbank Max AC",
    merk: "Anker",
    capaciteitKwh: 7,
    vermogenKw: 3.5,
    prijsEur: 2434,
    prijsNoot: "2.099 euro plus de P1-meter van 35 en 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    bron: "https://www.ankersolix.com/nl",
    peildatum: "2026-09-24",
    spec: spec(7, 3.5, 0.85, 0.9),
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
    bron: "https://thuisbatterijgids.net/",
    peildatum: "2026-09-24",
    spec: spec(5, 2.5, 0.9, 0.95),
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
    bron: "https://thuisbatterijgids.net/",
    peildatum: "2026-09-24",
    spec: spec(10, 3.6, 0.9, 0.95),
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
/**
 * Welk deel van zijn eigen opwek een huishouden zónder batterij direct zelf
 * gebruikt: het overlapdeel van de zonnecurve en de verbruikscurve.
 *
 * Nodig omdat de twee interessantste percentages — welk deel van je zon je
 * zelf gebruikt, en welk deel van je verbruik je zelf dekt — het BRUTO getal
 * vragen, en je jaarafrekening alleen het netto getal kent: wat er door de
 * meter ging. Zonder een aanname hierover bleven beide cijfers leeg, en dat is
 * precies waar een thuisbatterij over gaat.
 *
 * 30% is de gangbare Nederlandse vuistregel voor een huishouden met panelen en
 * zonder batterij (praktijkcijfers lopen van 25 tot 35%, afhankelijk van hoe
 * groot de installatie is ten opzichte van het verbruik). De schatting wordt
 * alleen gebruikt als de bezoeker zijn eigen jaaropwek niet invult, en staat
 * dan als schatting in beeld.
 */
export const DIRECT_EIGEN_VERBRUIK_ZONDER_BATTERIJ = 0.3;

/**
 * Jaaropwek geschat uit de teruglevering: alles wat niet direct zelf is
 * gebruikt, ging het net op.
 */
export function geschatteOpwekKwh(terugleveringKwh: number): number {
  return terugleveringKwh / (1 - DIRECT_EIGEN_VERBRUIK_ZONDER_BATTERIJ);
}

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
/**
 * Geen structurele prijsstijging als uitgangspunt.
 *
 * De 2% die hier eerder stond was de inflatiedoelstelling, geen energieprijs-
 * verwachting. Wat een batterij verdient is het gat tussen afname en
 * teruglevering: energiebelasting plus opslag plus het prijsverschil over de
 * dag. De energiebelasting op stroom daalt juist (2025 → 2026) en staat voor
 * 2026 en 2027 vast op 11,1 ct incl. btw, als onderdeel van de verschuiving
 * van de lasten van stroom naar gas; PBL noemt de prijsontwikkeling tot 2030
 * "zeer onzeker" en geeft alleen bandbreedtes. Nul is dan het eerlijke
 * uitgangspunt; de schuif staat er voor wie anders verwacht.
 */
export const STANDAARD_PRIJSSTIJGING = 0;
export const STANDAARD_KALENDERDEGRADATIE = 0.015;
