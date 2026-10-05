/**
 * Uitgangswaarden en batterijpresets.
 *
 * De lijst is bedoeld als dwarsdoorsnede van wat een Nederlands huishouden in
 * 2026 daadwerkelijk kan kopen: van een stekkerbatterij van twee kilowattuur
 * tot een vaste thuisaccu van tien. Modellen die alleen in capaciteit en prijs
 * op een ander lijken, staan er niet in — die voegen niets toe aan de keuze en
 * maken de lijst alleen langer.
 *
 * PRIJZEN — richtprijs van een wérkende set, peildatum 1 oktober 2026 (de twee
 * generieke thuisaccu's: 24 september). Bij de stekkerbatterijen zit de uitlezer van de slimme-meterpoort (P1) erbij: zonder
 * die uitlezer kan het ding niet op uurtarieven sturen, en dan is deze hele
 * rekentool niet van toepassing. Waar de uitlezer niet in de doos zit, is hij
 * opgeteld (circa 25 tot 35 euro).
 * Bij de twee generieke thuisaccu's is het een geïnstalleerde prijs inclusief
 * omvormer en montage; dat is wat zo'n systeem in de praktijk kost, en de oude
 * waarden hier (2.500 en 4.500 euro) waren kale hardwareprijzen die de
 * businesscase te rooskleurig maakten.
 *
 * EIGEN GROEP — boven 800 W mag een batterij niet aan een gewoon stopcontact;
 * aan het stopcontact levert een Marstek of een Zendure 2400 dan ook maar
 * 800 W. Voor het volle vermogen legt een installateur een eigen groep aan, en
 * die zit bij de modellen boven 0,8 kW in de prijs: 300 euro, wat een enkele
 * extra groep gangbaar kost (powerplugs.nl: 100 tot 200 euro in een
 * standaardsituatie, 300 tot 600 euro bij een volle meterkast; de tool rekent
 * met 300 euro).
 * Dezelfde post zit in de kostenregel voor andere maten (lib/model/kosten.ts).
 * Bij de Sessy-modellen is het de installatie door een Sessy-partner (300 euro
 * aangenomen; bronnen noemen 225 tot 400), bij de Sessy Plus de 600 euro
 * basisinstallatie van Sessy zelf, in plaats van de 300.
 *
 * ZENDURE BIJ ANWB — ANWB verkoopt de Zendure 800 Pro 2, 1600 AC+, 2400 AC+,
 * 2400 Pro en 3000 Mix AC+ in de webwinkel, met de P1-meter in de doos. De
 * prijzen van die vijf zijn de ANWB-prijzen (`bijAnwb`, `anwbUrl`). De AB3000L
 * is alleen een uitbreidingsaccu en staat er niet in.
 *
 * LADEN EN LEVEREN — sommige modellen laden sneller dan ze leveren (Sessy: 2,2
 * kW laden, 1,7 kW leveren). `spec()` neemt daarom een apart ontlaadvermogen
 * aan; `vermogenKw` is het hoogste van de twee, voor weergave, de kostenregel en
 * de stekkergrens.
 *
 * RENDEMENT — het rondgangsrendement is waar mogelijk een gemeten waarde uit
 * onafhankelijke tests, niet het getal van het datasheet. Per model staat in
 * `rendementBron` wat het is: gemeten door een testorganisatie, door
 * eigenaren (Sessy), afgeleid van een gemeten verwant model (Zendure 800 Pro 2
 * en 2400 Pro), opgave van de fabrikant, of een aanname. De kaarten laten elke
 * waarde die niet gemeten is zien als zodanig. Die twee lopen flink
 * uiteen: fabrikanten meten de cel, de praktijk meet de wandcontactdoos.
 * Die rondgangsrendementen komen uit losse laad-ontlaadrondes bij een vast
 * vermogen (energienerds.nl: HomeWizard 78,4% over vier rondes van 10 naar
 * 100% bij 800 W; Marstek ongeveer 83% bij 800 en bij 2.500 W; HomeWizard
 * noemt zelf 70 tot 85% voor de verliezen bij laden en ontladen en geeft de
 * stand-by apart op). Het stand-byverbruik bij stilstand zit daar dus NIET in;
 * het eigen verbruik tijdens laden en ontladen wel. Daarom is er geen
 * dubbeltelling met `standbyWatt` (zie STAND-BY hieronder), en telt de tool
 * stand-by alleen in kwartieren zonder laden of ontladen.
 *
 * BRUIKBAAR DEEL — 90% voor de stekkerbatterijen en 95% voor de vaste accu's,
 * als modelaanname. Fabrikanten definiëren "bruikbaar" onderling verschillend
 * (de een noemt de celcapaciteit, de ander wat eruit komt), dus een uniforme
 * aanname vergelijkt eerlijker dan de opgaves door elkaar gebruiken.
 *
 * STAND-BY — het eigen verbruik van de batterij als hij niet laadt of ontlaadt
 * (`standbyWatt`, hieronder per model; `standbyBron` zegt of het gemeten, een
 * schatting, een fabrieksopgave of een aanname is). Gemeten waar er een test
 * van is (energienerds.nl): HomeWizard 6 W in de standaardstand (in de
 * API-stand-by 0,52 W), Marstek 7 W (met een HomeWizard-slimme stekker),
 * Zendure 1600 AC+ 3 W, Zendure 2400 AC+ 3,4 W en Anker Solarbank Max AC
 * 31,6 W, telkens inclusief wat de omvormer intern verbruikt. Sessy geeft 3 W
 * op. Voor de Zendure SolarFlow 800 Pro 2 schat energienerds.nl 6 tot 9 W zonder
 * het apart te meten (8 W). De rest is een schatting of aanname die past bij
 * de omvormerklasse
 * (Indevolt noemt 7 W in diepe stand-by en 20 W voor de hoofdunit). Dat is 50
 * tot 220 kWh per jaar, als hij het hele jaar stilstond.
 *
 * Het veld zit hier en niet in `spec`: de dispatch mag er niets van weten. De
 * planner beslist per dag over de handel; stand-by is een vaste post van het
 * bezit die loopt of de batterij nu handelt of niet. Eerder zat hij in de
 * dispatch, en dan kwam een dag met een winstgevende handel op € 0,00 uit en
 * las hij als "slijtage voor niets". Nu telt hij mee in de jaarbesparing en de
 * terugverdientijd, buiten de dispatch en de dagcijfers om
 * (`standbyKosten` in lib/model/analysis.ts).
 */

import type { BatterySpec } from "./model/types";

/** Waar komt het rondgangsrendement vandaan? Zie RENDEMENT in de koptekst. */
export type RendementBron = "gemeten" | "eigenaren" | "afgeleid" | "datasheet" | "aanname";

/** Waar komt het stand-byverbruik vandaan? Zie STAND-BY in de koptekst. */
export type StandbyBron = "gemeten" | "schatting" | "fabrieksopgave" | "aanname";

/** Een bron bij een preset: waarvoor, en waar je hem vindt. */
export interface PresetBron {
  wat: string;
  url: string;
}

export const RENDEMENT_BRON_LABEL: Record<RendementBron, string> = {
  gemeten: "gemeten",
  eigenaren: "door eigenaren gemeten",
  afgeleid: "afgeleid van een ander model",
  datasheet: "opgave fabrikant",
  aanname: "aanname",
};

export const STANDBY_BRON_LABEL: Record<StandbyBron, string> = {
  gemeten: "gemeten",
  schatting: "schatting",
  fabrieksopgave: "opgave fabrikant",
  aanname: "aanname",
};

export interface BatteryPreset {
  id: string;
  naam: string;
  merk: string;
  /** Pad naar het merklogo in public/ (zie components/MerkLogo.tsx); leeg bij het generieke merk. */
  logo?: string;
  /** Verkoopt ANWB dit model in de webwinkel? */
  bijAnwb: boolean;
  /** De productpagina in de ANWB-webwinkel, als `bijAnwb`. */
  anwbUrl?: string;
  /** Een andere winkel als het model niet bij ANWB te koop is, met de prijs van daar. */
  winkel?: { naam: string; url: string };
  capaciteitKwh: number;
  /**
   * Het getal voor weergave en voor de kostenregel en de stekkergrens: het
   * leververmogen (`ontlaadvermogenKw`). De stekkergrens van 800 W gaat over
   * wat de batterij aan het stopcontact teruglevert; laden mag hoger, een
   * stopcontact mag gewoon 1.000 W afnemen (Zendure 800 Plus).
   */
  vermogenKw: number;
  /** Laadvermogen, kW. Gelijk aan `vermogenKw`, behalve als laden en leveren verschillen. */
  laadvermogenKw: number;
  /** Ontlaadvermogen, kW. */
  ontlaadvermogenKw: number;
  prijsEur: number;
  /** Waar de prijs vandaan komt: wat er wel en niet in zit. */
  prijsNoot: string;
  /** Korte waarschuwing bij de prijs op de kaart: voorverkoop of een actie die afloopt. */
  prijsLabel?: string;
  /**
   * Eigen verbruik als de batterij niet laadt of ontlaadt, in watt. De
   * gebruiker kan het overschrijven (Geavanceerd, `standbyWatt` in de
   * instellingen); `null` daar betekent deze waarde.
   */
  standbyWatt: number;
  /** Is `standbyWatt` gemeten, geschat, opgegeven door de fabrikant of een aanname? */
  standbyBron: StandbyBron;
  /** Waar het getal vandaan komt, in een zin voor onder het veld. */
  standbyNoot: string;
  /** Waar het rondgangsrendement in `spec` vandaan komt. */
  rendementBron: RendementBron;
  /** Korte bron van het rendement, in woorden. */
  rendementNoot: string;
  /** Opmerking bij het bruikbare deel (`spec.depthOfCharge`), als de opgaves afwijken van de uniforme aanname. */
  bruikbaarNoot?: string;
  /** Hoofdbron van de specificaties. */
  bron: string;
  /** Alle bronnen bij prijs, rendement, stand-by en specificaties, met URL. */
  bronnen: PresetBron[];
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
   * alleen ter duiding gebruikt en stuurt de dispatch niet. Sessy noemt voor
   * de 5 kWh-versie zelf tien jaar; daar rekent de lijst met tien.
   */
  kalenderLevensduurJaren: number;
}

/**
 * Laad- en ontlaadvermogen staan hier los van `vermogenKw`: de preset geeft ze
 * op (en `ontlaadKw` is optioneel, gelijk aan `laadKw` als het niet verschilt),
 * `vermogenKw` volgt eruit.
 */
function spec(
  capaciteitKwh: number,
  laadKw: number,
  rendementRondgang: number,
  dod: number,
  ontlaadKw: number = laadKw,
): Omit<BatterySpec, "wearCostEurPerKwh"> {
  return {
    capacityKwh: capaciteitKwh,
    depthOfCharge: dod,
    maxChargeKw: laadKw,
    maxDischargeKw: ontlaadKw,
    // Eenrichtingsrendement is de wortel van de rondgang.
    efficiency: Math.sqrt(rendementRondgang),
  };
}

type PresetInvoer = Omit<BatteryPreset, "vermogenKw" | "laadvermogenKw" | "ontlaadvermogenKw">;

/** Vult de vermogenvelden aan uit `spec`, zodat de getallen maar op één plek staan. */
function preset(p: PresetInvoer): BatteryPreset {
  return {
    ...p,
    laadvermogenKw: p.spec.maxChargeKw,
    ontlaadvermogenKw: p.spec.maxDischargeKw,
    vermogenKw: p.spec.maxDischargeKw,
  };
}

const ZENDURE_LOGO = "/logos/zendure.svg";
const SESSY_LOGO = "/logos/sessy.svg";
const ALPHAESS_LOGO = "/logos/alphaess.svg";
const ANKER_LOGO = "/logos/anker.svg";
const HOMEWIZARD_LOGO = "/logos/homewizard.svg";
const MARSTEK_LOGO = "/logos/marstek.png";

const ENERGIENERDS_HOMEWIZARD = "https://energienerds.nl/index.php/2026/03/26/homewizard-plug-in-battery-review";
const ENERGIENERDS_ZENDURE_MIX_VERGELIJKING = "https://energienerds.nl/index.php/2026/09/16/zendure-solarflow-mix-vergelijking";

/**
 * De catalogus, per merk, en binnen een merk van klein naar groot. Eerst het
 * ANWB-assortiment (Zendure), dan de andere merken op alfabet van de keuze die
 * wij hebben gemaakt; als laatste de generieke thuisaccu's.
 */
export const PRESETS: BatteryPreset[] = [
  preset({
    id: "zendure-800pro2",
    naam: "Zendure SolarFlow 800 Pro 2",
    merk: "Zendure",
    logo: ZENDURE_LOGO,
    bijAnwb: true,
    anwbUrl: "https://www.anwb.nl/webwinkel/p/257165/zendure-solarflow-800-pro-2-thuisbatterij",
    capaciteitKwh: 1.92,
    prijsEur: 699,
    // Adviesprijs 789 euro; 699 is de prijs in de ANWB-webwinkel (nagekeken
    // 01-10-2026). De standaardconfiguratie rekent met de prijs waarvoor hij
    // nu te koop is.
    prijsNoot: "prijs in de ANWB-webwinkel, compleet met de uitlezer van de slimme-meterpoort (P1) in de doos; adviesprijs 789 euro",
    // Stand-by: geschat, niet gemeten. energienerds.nl schat 6 tot 9 W voor de
    // SolarFlow 800 Pro en meet de stand-by niet apart; 8 W ligt in die band.
    standbyWatt: 8,
    standbyBron: "schatting",
    standbyNoot: "schatting; energienerds.nl schat 6 tot 9 W voor de SolarFlow 800 Pro en mat de stand-by niet apart",
    // Rendement: van de Pro 2 is geen meting. energienerds.nl mat 83 tot 85%
    // aan de voorganger (800 Pro) en thuisbatterijgids.net noemt 82% voor de
    // Pro 2; 84% ligt in die band.
    rendementBron: "afgeleid",
    rendementNoot: "geen meting van de Pro 2; energienerds.nl mat 83 tot 85% aan de voorganger 800 Pro, thuisbatterijgids.net noemt 82% voor de Pro 2",
    bron: "https://www.zendure.nl/products/solarflow-800-pro2",
    bronnen: [
      { wat: "prijs (ANWB-webwinkel)", url: "https://www.anwb.nl/webwinkel/p/257165/zendure-solarflow-800-pro-2-thuisbatterij" },
      { wat: "specificaties (Zendure)", url: "https://www.zendure.nl/products/solarflow-800-pro2" },
      { wat: "rendement (energienerds.nl, voorganger 800 Pro)", url: "https://energienerds.nl/index.php/2025/05/08/zendure-solarflow-800-pro-de-next-generation-pv-en-stekkerbatterij-energienerds-nl" },
      { wat: "rendement (thuisbatterijgids.net, Pro 2)", url: "https://thuisbatterijgids.net/thuisbatterij/zendure-solarflow-800-pro-2/" },
    ],
    peildatum: "2026-10-01",
    spec: spec(1.92, 0.8, 0.84, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    // De klasse tussen stekker en vaste accu: 1,4 kW aan een eigen groep (1,6
    // kW met twee of meer accu's; het model rekent met de basisset). Boven 0,8
    // kW, dus met 300 euro voor de eigen groep, net als de andere modellen
    // boven de stekkergrens.
    id: "zendure-1600ac",
    naam: "Zendure SolarFlow 1600 AC+",
    merk: "Zendure",
    logo: ZENDURE_LOGO,
    bijAnwb: true,
    anwbUrl: "https://www.anwb.nl/webwinkel/p/257161/zendure-solarflow-1600-ac-thuisbatterij",
    capaciteitKwh: 1.92,
    prijsEur: 1029,
    prijsNoot: "729 euro in de ANWB-webwinkel, met de uitlezer van de slimme-meterpoort (P1) in de doos, plus 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    standbyWatt: 3,
    standbyBron: "gemeten",
    standbyNoot: "gemeten door energienerds.nl: ongeveer 1 W via het net en 2 W intern, samen 3 W",
    rendementBron: "gemeten",
    rendementNoot: "gemeten door energienerds.nl: 86,9 tot 88,3% bij 800 W; wij rekenen met 87,6%",
    bron: "https://www.zendure.nl/products/zendure-solarflow-1600-ac",
    bronnen: [
      { wat: "prijs (ANWB-webwinkel)", url: "https://www.anwb.nl/webwinkel/p/257161/zendure-solarflow-1600-ac-thuisbatterij" },
      { wat: "specificaties (Zendure)", url: "https://www.zendure.nl/products/zendure-solarflow-1600-ac" },
      { wat: "rendement en stand-by (energienerds.nl)", url: "https://energienerds.nl/index.php/2026/02/13/zendure-solarflow-1600-ac-plus-review-2026" },
    ],
    peildatum: "2026-10-01",
    // 1,4 kW met de basisset; 1,6 kW met twee of meer accu's (energienerds.nl).
    spec: spec(1.92, 1.4, 0.876, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    id: "zendure-2400ac",
    naam: "Zendure SolarFlow 2400 AC+",
    merk: "Zendure",
    logo: ZENDURE_LOGO,
    bijAnwb: true,
    anwbUrl: "https://www.anwb.nl/webwinkel/p/252181/zendure-solarflow-2400-ac-thuisbatterij",
    capaciteitKwh: 2.4,
    prijsEur: 1149,
    prijsNoot: "849 euro in de ANWB-webwinkel, met de uitlezer van de slimme-meterpoort (P1) in de doos, plus 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    standbyWatt: 3.4,
    standbyBron: "gemeten",
    standbyNoot: "gemeten door energienerds.nl: 0,7 W via het net en 2,7 W intern, samen 3,4 W",
    rendementBron: "gemeten",
    rendementNoot: "gemeten door energienerds.nl: 88,15%",
    bron: "https://www.zendure.nl/products/zendure-solarflow-2400-ac",
    bronnen: [
      { wat: "prijs (ANWB-webwinkel)", url: "https://www.anwb.nl/webwinkel/p/252181/zendure-solarflow-2400-ac-thuisbatterij" },
      { wat: "specificaties (Zendure)", url: "https://www.zendure.nl/products/zendure-solarflow-2400-ac" },
      { wat: "rendement en stand-by (energienerds.nl)", url: "https://energienerds.nl/index.php/2026/02/10/zendure-solarflow-2400-ac-review-de-ultieme-ac-stekkerbatterij-voor-salderingsvrij-zelfverbruik" },
    ],
    peildatum: "2026-10-01",
    spec: spec(2.4, 2.4, 0.88, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    // Hybride: vier MPPT-ingangen voor panelen. De tool rekent alleen de
    // AC-kant (laden en leveren aan het net), dus de panelen-ingangen tellen
    // niet mee.
    id: "zendure-2400pro",
    naam: "Zendure SolarFlow 2400 Pro",
    merk: "Zendure",
    logo: ZENDURE_LOGO,
    bijAnwb: true,
    anwbUrl: "https://www.anwb.nl/webwinkel/p/257163/zendure-solarflow-2400-pro-thuisbatterij",
    capaciteitKwh: 2.4,
    prijsEur: 1269,
    prijsNoot: "969 euro in de ANWB-webwinkel, met de uitlezer van de slimme-meterpoort (P1) in de doos, plus 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    standbyWatt: 3.4,
    standbyBron: "schatting",
    standbyNoot: "schatting, gelijk aan de gemeten Zendure 2400 AC+ (dezelfde batterij en AC-omvormer); niet apart gemeten",
    rendementBron: "afgeleid",
    rendementNoot: "afgeleid van de 2400 AC+ (zelfde batterij en AC-omvormer; energienerds.nl mat daar 88,15%); de Pro zelf is niet gemeten",
    bron: "https://www.anwb.nl/webwinkel/p/257163/zendure-solarflow-2400-pro-thuisbatterij",
    bronnen: [
      { wat: "prijs en specificaties (ANWB-webwinkel)", url: "https://www.anwb.nl/webwinkel/p/257163/zendure-solarflow-2400-pro-thuisbatterij" },
      { wat: "rendement en stand-by van de 2400 AC+ (energienerds.nl)", url: "https://energienerds.nl/index.php/2026/02/10/zendure-solarflow-2400-ac-review-de-ultieme-ac-stekkerbatterij-voor-salderingsvrij-zelfverbruik" },
    ],
    peildatum: "2026-10-01",
    spec: spec(2.4, 2.4, 0.88, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    id: "zendure-3000mix",
    naam: "Zendure SolarFlow 3000 Mix AC+",
    merk: "Zendure",
    logo: ZENDURE_LOGO,
    bijAnwb: true,
    anwbUrl: "https://www.anwb.nl/webwinkel/p/257166/zendure-solarflow-3000-mix-ac-thuisbatterij",
    capaciteitKwh: 8,
    prijsEur: 2048,
    prijsNoot: "1.748 euro in de ANWB-webwinkel, met de uitlezer van de slimme-meterpoort (P1) in de doos, plus 300 euro voor een eigen groep door een installateur, want alleen aan een eigen groep levert hij 3 kW (aan het stopcontact 800 W)",
    standbyWatt: 13,
    standbyBron: "schatting",
    standbyNoot: "schatting; niet apart gemeten. De verwante 4000 Mix AC+ gebruikt 3 W via het net en 10 W intern (energienerds.nl)",
    rendementBron: "gemeten",
    rendementNoot: "gemeten door energienerds.nl: 87% bij 3.000 W en 85% bij 800 W; wij rekenen met 86%",
    bron: "https://www.anwb.nl/webwinkel/p/257166/zendure-solarflow-3000-mix-ac-thuisbatterij",
    bronnen: [
      { wat: "prijs en specificaties (ANWB-webwinkel)", url: "https://www.anwb.nl/webwinkel/p/257166/zendure-solarflow-3000-mix-ac-thuisbatterij" },
      { wat: "rendement (energienerds.nl)", url: "https://energienerds.nl/index.php/2026/08/27/review-zendure-solarflow-3000-mix-ac" },
      { wat: "stand-by van de verwante 4000 Mix AC+ (energienerds.nl)", url: ENERGIENERDS_ZENDURE_MIX_VERGELIJKING },
    ],
    peildatum: "2026-10-01",
    spec: spec(8, 3, 0.86, 0.9),
    cycleLife: 10000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    // De instapper van Zendure, niet in de ANWB-webwinkel maar wel bij
    // TechPunt (dat ook de ANWB-webwinkel levert). Laadt met 1.000 W uit het
    // stopcontact en levert 800 W: onder de stekkergrens, dus geen eigen groep.
    id: "zendure-800plus",
    naam: "Zendure SolarFlow 800 Plus",
    merk: "Zendure",
    logo: ZENDURE_LOGO,
    bijAnwb: false,
    winkel: { naam: "TechPunt", url: "https://www.techpunt.nl/en/products/zendure-solarflow-800-plus" },
    capaciteitKwh: 1.92,
    // 479 euro bij TechPunt (nagekeken 05-10-2026); de uitlezer van de
    // slimme-meterpoort (P1) zit er niet bij. Zendure verkoopt die voor 29,99
    // euro in een bundel; afgerond 30.
    prijsEur: 509,
    prijsNoot: "479 euro bij TechPunt plus 30 euro voor de uitlezer van de slimme-meterpoort (P1), die er niet bij zit",
    // Stand-by: niet gemeten. Zelfde klasse en omvormer als de 800 Pro 2.
    standbyWatt: 8,
    standbyBron: "schatting",
    standbyNoot: "schatting, zoals de 800 Pro 2; de stand-by van de 800 Plus is niet gemeten",
    rendementBron: "gemeten",
    rendementNoot: "energienerds.nl mat 83 tot 85% over drie volle rondes van 10 naar 100%, laden met 1.000 W en ontladen met 800 W",
    bron: "https://www.zendure.nl/products/solarflow-800-plus",
    bronnen: [
      { wat: "prijs (TechPunt)", url: "https://www.techpunt.nl/en/products/zendure-solarflow-800-plus" },
      { wat: "specificaties (Zendure)", url: "https://www.zendure.nl/products/solarflow-800-plus" },
      { wat: "rendement en vermogen (energienerds.nl)", url: "https://energienerds.nl/index.php/2025/12/06/review-zendure-solarflow-800-plus-compact-slim-en-handig" },
      { wat: "P1 niet inbegrepen (thuisbatterijgids.net)", url: "https://thuisbatterijgids.net/thuisbatterij/zendure-solarflow-800-plus-4/" },
    ],
    peildatum: "2026-10-05",
    // Laden 1,0 kW, leveren 0,8 kW.
    spec: spec(1.92, 1.0, 0.84, 0.9, 0.8),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    // Laadt sneller dan hij levert: 2,2 kW laden, 1,7 kW leveren. Vaste
    // aansluiting via een Sessy-partner; de installatiekosten staan niet op de
    // site, we rekenen 300 euro zoals bij elke vaste aansluiting (bronnen
    // noemen 225 tot 400 euro).
    id: "sessy-5kwh",
    naam: "Sessy 5 kWh",
    merk: "Sessy",
    logo: SESSY_LOGO,
    bijAnwb: false,
    capaciteitKwh: 5.5,
    prijsEur: 3850,
    prijsNoot: "3.550 euro bij Sessy plus 300 euro voor installatie door een Sessy-partner (de kosten staan niet op de site; bronnen noemen 225 tot 400 euro)",
    standbyWatt: 3,
    standbyBron: "fabrieksopgave",
    standbyNoot: "opgave van Sessy: 3 W",
    rendementBron: "eigenaren",
    rendementNoot: "gemeten door eigenaren over maanden, ongeveer 82% (geen testorganisatie); het datasheet noemt 85%",
    bron: "https://www.sessy.nl/wp-content/uploads/2025/09/Sessy-Datasheet-Sessy-2.0-5-kWh.pdf",
    bronnen: [
      { wat: "specificaties (datasheet Sessy)", url: "https://www.sessy.nl/wp-content/uploads/2025/09/Sessy-Datasheet-Sessy-2.0-5-kWh.pdf" },
      { wat: "prijs (Sessy)", url: "https://www.sessy.nl/bestellen/" },
      { wat: "installatiekosten (Solargarant)", url: "https://solargarant.nl/thuisbatterijen/sessy/kosten/" },
      { wat: "rendement (forum Sessy)", url: "https://forum.sessy.nl/waar-moet-ik-op-letten/rendement-sessy/" },
      { wat: "rendement (eigenaar, een jaar met Sessy)", url: "https://www.hellosmarthome.nl/post/update-1-jaar-met-de-sessy-thuisbatterij-heb-ik-er-echt-geld-mee-verdiend/" },
      { wat: "stand-by (Sessy)", url: "https://www.sessy.nl/specificaties/" },
    ],
    peildatum: "2026-10-01",
    // Nominaal 5,5 kWh, bruikbaar 5,2.
    spec: spec(5.5, 2.2, 0.82, 5.2 / 5.5, 1.7),
    cycleLife: 6000,
    kalenderLevensduurJaren: 10,
  }),
  preset({
    id: "sessy-10kwh",
    naam: "Sessy 10 kWh",
    merk: "Sessy",
    logo: SESSY_LOGO,
    bijAnwb: false,
    capaciteitKwh: 11,
    prijsEur: 5800,
    prijsNoot: "5.500 euro bij Sessy plus 300 euro voor installatie door een Sessy-partner (de kosten staan niet op de site; bronnen noemen 225 tot 400 euro)",
    standbyWatt: 3,
    standbyBron: "fabrieksopgave",
    standbyNoot: "opgave van Sessy: 3 W",
    rendementBron: "eigenaren",
    rendementNoot: "gemeten door eigenaren over maanden, ongeveer 82% (geen testorganisatie); het datasheet noemt 85%",
    bron: "https://www.sessy.nl/wp-content/uploads/2025/09/Sessy-Datasheet-Sessy-2.0-10-kWh.pdf",
    bronnen: [
      { wat: "specificaties (datasheet Sessy)", url: "https://www.sessy.nl/wp-content/uploads/2025/09/Sessy-Datasheet-Sessy-2.0-10-kWh.pdf" },
      { wat: "prijs (Sessy)", url: "https://www.sessy.nl/bestellen/" },
      { wat: "installatiekosten (Solargarant)", url: "https://solargarant.nl/thuisbatterijen/sessy/kosten/" },
      { wat: "rendement (forum Sessy)", url: "https://forum.sessy.nl/waar-moet-ik-op-letten/rendement-sessy/" },
      { wat: "rendement (eigenaar, een jaar met Sessy)", url: "https://www.hellosmarthome.nl/post/update-1-jaar-met-de-sessy-thuisbatterij-heb-ik-er-echt-geld-mee-verdiend/" },
      { wat: "stand-by (Sessy)", url: "https://www.sessy.nl/specificaties/" },
    ],
    peildatum: "2026-10-01",
    // Nominaal 11 kWh, bruikbaar 10,4.
    spec: spec(11, 2.2, 0.82, 10.4 / 11, 1.7),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    // Pre-order; de eerste levering is in oktober 2026. Rendement, levensduur
    // en stand-by zijn aannames: er is nog niets gemeten of opgegeven.
    id: "sessy-plus",
    naam: "Sessy Plus 15 kWh",
    merk: "Sessy",
    logo: SESSY_LOGO,
    bijAnwb: false,
    capaciteitKwh: 15,
    prijsEur: 10000,
    prijsLabel: "Voorverkoop, eerste levering oktober 2026",
    prijsNoot: "voorverkoop (pre-order), eerste levering oktober 2026: 9.400 euro plus 600 euro basisinstallatie; die installatie vervangt de 300 euro voor een eigen groep",
    standbyWatt: 5,
    standbyBron: "aanname",
    standbyNoot: "aanname; Sessy geeft voor de Plus nog geen stand-byverbruik op",
    rendementBron: "aanname",
    rendementNoot: "aanname van 85%; de Plus is nog niet geleverd, gemeten of opgegeven",
    bron: "https://www.sessy.nl/sessy-plus/",
    bronnen: [
      { wat: "specificaties en prijs (Sessy)", url: "https://www.sessy.nl/sessy-plus/" },
      { wat: "voorverkoop (Sessy)", url: "https://www.sessy.nl/nieuwe-sessy-voorverkoop/" },
    ],
    peildatum: "2026-10-01",
    spec: spec(15, 6, 0.85, 0.95),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    // Basismodule van 4 kWh, uitbreidbaar tot 16 kWh. AlphaESS noemt 3,68 kW
    // mits een installateur hem aansluit; de basismodule levert intern
    // maximaal ongeveer 2.000 W (energienerds.nl en p1meter.nl), en daar
    // rekenen we mee. Het datasheet noemt een DoD van 95%, maar voor
    // stekkerbatterijen geldt hier de uniforme 90%.
    id: "alphaess-vitapower3600",
    naam: "AlphaESS VitaPower 3600 AC",
    merk: "AlphaESS",
    logo: ALPHAESS_LOGO,
    bijAnwb: false,
    capaciteitKwh: 4,
    prijsEur: 1299,
    prijsLabel: "Voorverkoopprijs tot 29 oktober 2026",
    prijsNoot: "voorverkoopprijs 999 euro tot 29 oktober 2026 (daarna 1.699 euro), met een gratis uitlezer van de slimme-meterpoort (P1), plus 300 euro voor een eigen groep door een installateur",
    standbyWatt: 10,
    standbyBron: "aanname",
    standbyNoot: "aanname voor deze omvormerklasse; AlphaESS en energienerds.nl geven geen stand-byverbruik op. Het vermogen is 2,0 kW: AlphaESS noemt 3,68 kW met een installateur, maar de basismodule levert intern maximaal ongeveer 2.000 W",
    rendementBron: "aanname",
    rendementNoot: "aanname van 85%; de VitaPower is nog niet getest op rendement",
    bron: "https://www.alphaess.nl/products/alphaess-vitapower-3600-ac",
    bronnen: [
      { wat: "prijs en specificaties (AlphaESS)", url: "https://www.alphaess.nl/products/alphaess-vitapower-3600-ac" },
      { wat: "vermogen van de basismodule (energienerds.nl)", url: "https://energienerds.nl/index.php/2026/09/22/alphaess-vitapower-3600-ac-preview" },
    ],
    bruikbaarNoot: "Het datasheet noemt een bruikbaar deel van 95%; voor stekkerbatterijen rekent de lijst uniform met 90%.",
    peildatum: "2026-10-01",
    spec: spec(4, 2, 0.85, 0.9),
    cycleLife: 10000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    id: "anker-solarbank3",
    naam: "Anker SOLIX Solarbank 3 E2700 Pro",
    merk: "Anker",
    logo: ANKER_LOGO,
    bijAnwb: false,
    capaciteitKwh: 2.69,
    prijsEur: 1199,
    prijsLabel: "Actieprijs tot 12 oktober 2026",
    prijsNoot: "1.199 euro bij Anker NL, met de uitlezer van de slimme-meterpoort (P1) gratis erbij (Herfst Sale tot 12 oktober 2026, daarna 1.599 euro)",
    // Stand-by: schatting voor deze omvormerklasse; er is geen test van gevonden.
    standbyWatt: 12,
    standbyBron: "schatting",
    standbyNoot: "schatting voor deze omvormerklasse (stekkerbatterij)",
    rendementBron: "gemeten",
    rendementNoot: "gemeten door energienerds.nl: ongeveer 80% (79,7% in de review)",
    bron: "https://www.ankersolix.com/nl/products/a17c5",
    bronnen: [
      { wat: "prijs en specificaties (Anker NL)", url: "https://www.ankersolix.com/nl/products/a17c5" },
      { wat: "rendement (energienerds.nl, best buy guide)", url: "https://energienerds.nl/index.php/2025/10/28/best-buy-guide-hybride-stekkerbatterij-anker-vs-marstek-vs-zendure" },
      { wat: "rendement (energienerds.nl, review)", url: "https://energienerds.nl/index.php/2025/10/18/review-anker-solix-e2700-thuisbatterij" },
    ],
    peildatum: "2026-10-01",
    // Laadt én levert tot 1.200 W, maar alleen aan een eigen groep; aan een
    // gewoon stopcontact is het 800 W, beide kanten op. Dit is de
    // stekkerversie, dus 0,8 kW. Wie hem aan een eigen groep hangt, zet het
    // vermogen op 1,2 kW en telt de installateur erbij.
    spec: spec(2.69, 0.8, 0.8, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    // Anker SOLIX Solarbank Max AC (A17E2).
    id: "anker-solarbank-max",
    naam: "Anker SOLIX Solarbank Max AC",
    merk: "Anker",
    logo: ANKER_LOGO,
    bijAnwb: false,
    capaciteitKwh: 7,
    prijsEur: 2299,
    prijsNoot: "1.999 euro bij Anker NL, met de uitlezer van de slimme-meterpoort (P1) gratis erbij, plus 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    standbyWatt: 31.6,
    standbyBron: "gemeten",
    standbyNoot: "gemeten door energienerds.nl: 2,6 W via het net en 29 W intern, samen 31,6 W",
    rendementBron: "gemeten",
    rendementNoot: "gemeten door energienerds.nl: 83,5%",
    bron: "https://www.ankersolix.com/nl/products/a17e2",
    bronnen: [
      { wat: "prijs en specificaties (Anker NL)", url: "https://www.ankersolix.com/nl/products/a17e2" },
      { wat: "rendement en stand-by (energienerds.nl)", url: "https://energienerds.nl/index.php/2026/05/16/anker-solix-solarbank-max-ac-review" },
    ],
    peildatum: "2026-10-01",
    // Levensduur: 10.000 cycli tot 80% capaciteit (opgave Anker).
    spec: spec(7, 3.5, 0.835, 0.9),
    cycleLife: 10000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    id: "homewizard-plugin",
    naam: "HomeWizard Plug-In Battery",
    merk: "HomeWizard",
    logo: HOMEWIZARD_LOGO,
    bijAnwb: false,
    capaciteitKwh: 2.7,
    prijsEur: 1220,
    prijsNoot: "1.195 euro plus 25 euro voor de uitlezer van de slimme-meterpoort (P1)",
    // Stand-by: gemeten, niet geschat. energienerds.nl mat 6 W in de
    // standaardstand (AC aangesloten); in de API-stand-by is het 0,52 W. We
    // rekenen met de standaardstand, want zo staat hij als hij handelt.
    standbyWatt: 6,
    standbyBron: "gemeten",
    standbyNoot: "gemeten door energienerds.nl: 6 W in de standaardstand (AC aangesloten), 0,52 W in de API-stand-by",
    rendementBron: "gemeten",
    rendementNoot: "gemeten door energienerds.nl: 78,4% over vier laad-ontlaadrondes bij 800 W; wij rekenen met 80%",
    bron: "https://www.homewizard.com/shop/plug-in-battery/",
    bronnen: [
      { wat: "prijs en specificaties (HomeWizard)", url: "https://www.homewizard.com/shop/plug-in-battery/" },
      { wat: "rendement en stand-by (energienerds.nl)", url: ENERGIENERDS_HOMEWIZARD },
    ],
    peildatum: "2026-10-01",
    // HomeWizard noemt zelf een rendement in de praktijk van 70 tot 85%;
    // gebruikers en testers meten rond 75 tot 80%. Het datasheet claimt 92%,
    // maar dat is de cel, niet de wandcontactdoos. Eerder stond hier 85%, de
    // bovenkant van die band.
    spec: spec(2.7, 0.8, 0.8, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    id: "marstek-venus-e3",
    naam: "Marstek Venus E 3.0",
    merk: "Marstek",
    logo: MARSTEK_LOGO,
    bijAnwb: false,
    capaciteitKwh: 5.12,
    prijsEur: 1499,
    prijsNoot: "1.199 euro inclusief de uitlezer van de slimme-meterpoort (P1), plus 300 euro voor een eigen groep door een installateur, want aan het stopcontact levert hij maar 800 W",
    // Stand-by: gemeten, niet geschat. energienerds.nl mat 7 W met een
    // HomeWizard-slimme stekker.
    standbyWatt: 7,
    standbyBron: "gemeten",
    standbyNoot: "gemeten door energienerds.nl met een HomeWizard-slimme stekker",
    rendementBron: "gemeten",
    rendementNoot: "gemeten door energienerds.nl: ongeveer 83% bij 800 en bij 2.500 W",
    bron: "https://www.marstek.nl/product/marstek-venus-e-3-0-plug-charge-thuisbatterij-5-12-kwh-incl-p1-meter/",
    bronnen: [
      { wat: "prijs en specificaties (Marstek)", url: "https://www.marstek.nl/product/marstek-venus-e-3-0-plug-charge-thuisbatterij-5-12-kwh-incl-p1-meter/" },
      { wat: "rendement en stand-by (energienerds.nl)", url: "https://energienerds.nl/index.php/2026/01/10/beste-ac-stekkerbatterij-van-2026-indevolt-powerflex-2000-eco-vs-marstek-venus-e-3-0-vs-zendure-2400-ac" },
      { wat: "bruikbare capaciteit (Consumentenbond, via plugin-batterij.nl)", url: "https://plugin-batterij.nl/consumentenbond-test-thuisbatterijen-met-stekker/" },
    ],
    peildatum: "2026-10-01",
    // De Consumentenbond mat 4,3 kWh bruikbaar van de 5,12 kWh (84%); de
    // uniforme 90% is voor dit model dus gunstig.
    bruikbaarNoot: "De Consumentenbond mat 4,3 kWh bruikbaar van de 5,12 kWh; de uniforme 90% is voor dit model dus gunstig.",
    spec: spec(5.12, 2.5, 0.83, 0.9),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    id: "thuisaccu-5kwh",
    naam: "Thuisaccu 5 kWh, geïnstalleerd",
    merk: "Generiek",
    bijAnwb: false,
    capaciteitKwh: 5,
    prijsEur: 3750,
    prijsNoot: "inclusief omvormer en installatie",
    // Stand-by: schatting voor deze omvormerklasse; er is geen test van gevonden.
    standbyWatt: 20,
    standbyBron: "schatting",
    standbyNoot: "schatting voor een vaste thuisaccu met omvormer",
    rendementBron: "aanname",
    rendementNoot: "aanname van 90% voor een vaste accu met hybride omvormer; geen model, dus niets te meten",
    bron: "https://thuisbatterijgids.net/",
    bronnen: [{ wat: "richtprijs (thuisbatterijgids.net)", url: "https://thuisbatterijgids.net/" }],
    peildatum: "2026-09-24",
    spec: spec(5, 2.5, 0.9, 0.95),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
  preset({
    id: "thuisaccu-10kwh",
    naam: "Thuisaccu 10 kWh, geïnstalleerd",
    merk: "Generiek",
    bijAnwb: false,
    capaciteitKwh: 10,
    prijsEur: 5750,
    prijsNoot: "inclusief omvormer en installatie",
    // Stand-by: schatting voor deze omvormerklasse; er is geen test van gevonden.
    standbyWatt: 25,
    standbyBron: "schatting",
    standbyNoot: "schatting voor een vaste thuisaccu met omvormer",
    rendementBron: "aanname",
    rendementNoot: "aanname van 90% voor een vaste accu met hybride omvormer; geen model, dus niets te meten",
    bron: "https://thuisbatterijgids.net/",
    bronnen: [{ wat: "richtprijs (thuisbatterijgids.net)", url: "https://thuisbatterijgids.net/" }],
    peildatum: "2026-09-24",
    spec: spec(10, 3.6, 0.9, 0.95),
    cycleLife: 6000,
    kalenderLevensduurJaren: 15,
  }),
];

/** De merken in de volgorde van de lijst, met hun modellen: voor kopjes in de keuze en de bronnenlijst. */
export interface MerkGroep {
  merk: string;
  logo?: string;
  /** Verkoopt ANWB alle modellen van dit merk in de lijst? */
  bijAnwb: boolean;
  /** Verkoopt ANWB een deel ervan? */
  deelsBijAnwb: boolean;
  presets: BatteryPreset[];
}

export function perMerk(lijst: readonly BatteryPreset[] = PRESETS): MerkGroep[] {
  const groepen: MerkGroep[] = [];
  for (const p of lijst) {
    let g = groepen.find((x) => x.merk === p.merk);
    if (!g) {
      g = { merk: p.merk, logo: p.logo, bijAnwb: false, deelsBijAnwb: false, presets: [] };
      groepen.push(g);
    }
    g.presets.push(p);
  }
  for (const g of groepen) {
    g.bijAnwb = g.presets.every((p) => p.bijAnwb);
    g.deelsBijAnwb = g.presets.some((p) => p.bijAnwb);
  }
  return groepen;
}

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

export const PRIJSPEILDATUM = "oktober 2026";

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
 * dag. De energiebelasting op stroom daalt juist (2025 → 2026: 11,1 ct incl.
 * btw), als onderdeel van de verschuiving van de lasten van stroom naar gas;
 * het Belastingplan 2027 verandert het tarief niet, het bedrag voor 2027
 * volgt eind 2026 uit de inflatiecorrectie. Het PBL geeft voor de
 * groothandelsprijs van stroom in 2030 een bandbreedte van 53 tot 90 euro per
 * MWh (KEV 2026). Nul is dan het eerlijke
 * uitgangspunt; de schuif staat er voor wie anders verwacht.
 */
export const STANDAARD_PRIJSSTIJGING = 0;
export const STANDAARD_KALENDERDEGRADATIE = 0.015;
