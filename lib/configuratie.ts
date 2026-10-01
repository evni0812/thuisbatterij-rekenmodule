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
  geschatteOpwekKwh,
  STANDAARD_AFNAME_KWH,
  STANDAARD_ANALYSEJAREN,
  STANDAARD_DISCONTOVOET,
  STANDAARD_KALENDERDEGRADATIE,
  STANDAARD_PRESET_ID,
  STANDAARD_PRIJSSTIJGING,
  STANDAARD_TERUGLEVERING_KWH,
  type BatteryPreset,
} from "./presets";
import { STANDAARD_CO2_DREMPEL_G } from "./model/co2";
import { STANDAARD_DOEL } from "./model/doel";
import { STANDAARD_KOSTENREGEL, kostenVan } from "./model/kosten";
import { LAATSTE_DAG, VROEGSTE_DAG, normaliseer } from "./normaliseer";
import { STANDAARD_SLIJTAGEDEEL } from "./strategie";
import type { Instellingen } from "./url-state";
import type { Configuration } from "./worker/protocol";

/** Het netgebied van Liander: het grootste, en daarmee het meest waarschijnlijke. */
export const STANDAARD_NETGEBIED = "871685900000056162";

// De grenzen van de periode wonen bij `normaliseer`, dat er de instellingen
// mee klemt; hier blijven ze onder dezelfde naam bereikbaar.
export { VROEGSTE_DAG, LAATSTE_DAG };

export const STANDAARD: Instellingen = {
  afnameKwh: STANDAARD_AFNAME_KWH,
  terugleveringKwh: STANDAARD_TERUGLEVERING_KWH,
  zonnepanelen: true,
  presetId: STANDAARD_PRESET_ID,
  domein: STANDAARD_NETGEBIED,
  van: "",
  tot: "",
  spreiding: 1,
  terugleverkostenCt: 0,
  // Afregelen bij een negatieve prijs staat uit: de meeste omvormers doen het
  // niet vanzelf. Wie het wel kan, zet het aan bij de geavanceerde instellingen.
  curtailment: false,
  // De heffing van nu (energiebelasting plus opslag van het meest recente
  // prijsjaar, 12,885 ct in 2026) over alle jaren: wat een koper vandaag wil
  // weten. Raster, huishoudens en de overgang rekenen op dezelfde configuratie
  // en dus dezelfde grondslag; het scenario zet er de heffing van 2029 voor in
  // de plaats. "toen" blijft een keuze in de geavanceerde instellingen.
  heffing: "nu",
  analysejaren: STANDAARD_ANALYSEJAREN,
  discontovoet: STANDAARD_DISCONTOVOET,
  prijsstijging: STANDAARD_PRIJSSTIJGING,
  degradatie: STANDAARD_KALENDERDEGRADATIE,
  slijtageDeel: STANDAARD_SLIJTAGEDEEL,
  kostenPerKwh: STANDAARD_KOSTENREGEL.perKwhEur,
  kostenPerKw: STANDAARD_KOSTENREGEL.perKwEur,
  installatieEur: STANDAARD_KOSTENREGEL.installatieEur,
  co2Drempel: STANDAARD_CO2_DREMPEL_G,
  doel: STANDAARD_DOEL,
  prijsEur: null,
  capaciteitKwh: null,
  vermogenKw: null,
  opwekKwh: null,
  standbyWatt: null,
};

/** De gekozen batterij, of de eerste uit de lijst als het id niet bestaat. */
export function kiesPreset(presetId: string): BatteryPreset {
  return PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;
}

/** De batterij zoals hij wordt doorgerekend, en waar hij van de gekozen preset afwijkt. */
export interface EffectieveBatterij {
  capaciteitKwh: number;
  /** Het hoogste van laden en ontladen: voor weergave, de kostenregel en de stekkergrens. */
  vermogenKw: number;
  /** Laadvermogen waarmee gerekend wordt. */
  laadKw: number;
  /** Ontlaadvermogen waarmee gerekend wordt. */
  ontlaadKw: number;
  prijsEur: number;
  /** Wijkt de waarde af van die van de preset? Dan staat hij als "aangepast" in beeld. */
  aangepast: { capaciteit: boolean; vermogen: boolean; prijs: boolean };
}

/** `effectieveBatterij` voor instellingen die al door `normaliseer` zijn. */
function effectief(inst: Instellingen): EffectieveBatterij {
  const preset = kiesPreset(inst.presetId);
  const kosten = {
    perKwhEur: inst.kostenPerKwh,
    perKwEur: inst.kostenPerKw,
    installatieEur: inst.installatieEur,
  };
  const capaciteitKwh = inst.capaciteitKwh ?? preset.capaciteitKwh;
  // Een eigen vermogen zet laden én leveren op hetzelfde getal; zonder eigen
  // vermogen blijven ze wat de preset opgeeft (Sessy: 2,2 kW laden, 1,7 leveren).
  const eigenVermogen = inst.vermogenKw !== null;
  const vermogenKw = inst.vermogenKw ?? preset.vermogenKw;
  const laadKw = eigenVermogen ? vermogenKw : preset.laadvermogenKw;
  const ontlaadKw = eigenVermogen ? vermogenKw : preset.ontlaadvermogenKw;
  const prijsEur =
    inst.prijsEur ??
    kostenVan(
      { investmentEur: preset.prijsEur, capaciteitKwh: preset.capaciteitKwh, vermogenKw: preset.vermogenKw },
      kosten,
      capaciteitKwh,
      vermogenKw,
    );
  return {
    capaciteitKwh,
    vermogenKw,
    laadKw,
    ontlaadKw,
    prijsEur,
    aangepast: {
      capaciteit: capaciteitKwh !== preset.capaciteitKwh,
      vermogen: laadKw !== preset.laadvermogenKw || ontlaadKw !== preset.ontlaadvermogenKw,
      prijs: prijsEur !== preset.prijsEur,
    },
  };
}

/**
 * Het stand-byverbruik waarmee gerekend wordt, in watt: de eigen waarde, of
 * anders die van de gekozen batterij. Voor instellingen die al door
 * `normaliseer` zijn.
 */
function effectieveStandbyWatt(inst: Instellingen): number {
  return inst.standbyWatt ?? kiesPreset(inst.presetId).standbyWatt;
}

/**
 * Het stand-byverbruik in watt zoals het gerekend wordt, en of het van de
 * gekozen batterij afwijkt. De enige bron voor wat het veld bij Geavanceerd
 * toont én voor wat `maakConfiguratie` naar de worker stuurt.
 */
export function effectiefStandby(invoer: Instellingen): { watt: number; aangepast: boolean } {
  const inst = normaliseer(invoer, STANDAARD);
  const watt = effectieveStandbyWatt(inst);
  return { watt, aangepast: watt !== kiesPreset(inst.presetId).standbyWatt };
}

/**
 * De capaciteit, het vermogen en de prijs waarmee gerekend wordt: de enige bron
 * voor wat de pagina bij de batterij toont (het prijsveld, de hint onder de
 * keuze, de slijtageprijs) én voor wat `maakConfiguratie` naar de worker stuurt.
 *
 * Capaciteit, vermogen en prijs komen uit de batterij, tenzij de gebruiker ze
 * zelf heeft overschreven. Is de maat overschreven maar de prijs niet, dan
 * volgt de prijs uit de kostenregel vanaf de preset: een Zendure van 10 kWh
 * kost niet 699 euro. Bij de presetmaat is dat exact de presetprijs, zodat de
 * standaardconfiguratie en haar hash niet veranderen.
 */
export function effectieveBatterij(invoer: Instellingen): EffectieveBatterij {
  return effectief(normaliseer(invoer, STANDAARD));
}

/**
 * Bouw de configuratie die de worker doorrekent.
 *
 * De batterijmaat en -prijs komen uit `effectieveBatterij`.
 *
 * De instellingen gaan eerst door `normaliseer` (lib/normaliseer.ts): wat hier
 * binnenkomt kan uit een URL of een oude bewaarde set komen, en een negatief
 * vermogen of een looptijd van tien miljoen jaar hoort nooit bij de worker aan
 * te komen. Voor instellingen binnen de grenzen verandert er niets.
 */
export function maakConfiguratie(invoer: Instellingen): Configuration {
  const inst = normaliseer(invoer, STANDAARD);
  const preset = kiesPreset(inst.presetId);
  const kosten = {
    perKwhEur: inst.kostenPerKwh,
    perKwEur: inst.kostenPerKw,
    installatieEur: inst.installatieEur,
  };
  const { capaciteitKwh: capaciteit, laadKw, ontlaadKw, prijsEur: prijs } = effectief(inst);
  // Zonder zonnepanelen is er niets om terug te leveren en geen eigen opwek;
  // het profiel wisselt naar de gemeten aansluitingen zonder invoeding. Het
  // veld blijft afwezig in het standaardgeval, zodat de hash niet verandert.
  const zon = inst.zonnepanelen;
  return {
    domain: inst.domein,
    from: inst.van || VROEGSTE_DAG,
    to: inst.tot || LAATSTE_DAG,
    household: {
      annualGridImportKwh: inst.afnameKwh,
      annualGridExportKwh: zon ? inst.terugleveringKwh : 0,
      spreadFactor: inst.spreiding,
    },
    ...(zon ? {} : { afnametype: "AZI" as const }),
    // Alleen een afwijkend doel komt in de configuratie, zodat de hash van een
    // gewone doorrekening (en daarmee de preload) niet verandert.
    ...(inst.doel !== STANDAARD_DOEL ? { doel: inst.doel } : {}),
    battery: {
      ...preset.spec,
      capacityKwh: capaciteit,
      maxChargeKw: laadKw,
      maxDischargeKw: ontlaadKw,
      wearCostEurPerKwh: 0,
    },
    tariff: {
      purchaseSurchargeEurPerKwh: 0,
      energyTaxEurPerKwh: 0,
      feedInCostEurPerKwh: inst.terugleverkostenCt / 100,
      allowCurtailment: inst.curtailment,
    },
    investmentEur: prijs,
    cycleLife: preset.cycleLife,
    calendarLifeYears: preset.kalenderLevensduurJaren,
    analysisYears: inst.analysejaren,
    priceEscalation: inst.prijsstijging,
    discountRate: inst.discontovoet,
    calendarFadePerYear: inst.degradatie,
    wearFraction: inst.slijtageDeel,
    residualValueEur: 0,
    // Zonder opgegeven jaaropwek een schatting uit de teruglevering, zodat
    // "eigen verbruik" en "onafhankelijk van het net" niet leeg blijven. Dat de
    // waarde geschat is, staat bij de cijfers zelf.
    annualProductionKwh: zon ? (inst.opwekKwh ?? geschatteOpwekKwh(inst.terugleveringKwh)) : 0,
    useHistoricalLevy: inst.heffing === "toen",
    kostenPerKwhEur: kosten.perKwhEur,
    kostenPerKwEur: kosten.perKwEur,
    installatieEur: kosten.installatieEur,
    co2DrempelG: inst.co2Drempel,
    standbyWatt: effectieveStandbyWatt(inst),
  };
}

/** De configuratie die een bezoeker ziet als hij niets instelt. */
export function standaardConfiguratie(): Configuration {
  return maakConfiguratie(STANDAARD);
}
