/**
 * Batterij-boekhouding: capaciteit, vermogen, rendement, slijtage, cycli.
 *
 * Eén conventie, symmetrisch voor beide richtingen:
 *   de vermogenslimiet geldt aan de AC-zijde (wat door de meter gaat),
 *   het rendement grijpt aan bij de omzetting naar en uit de cel.
 *
 *   laden:    ac_in  <= maxChargeKw * dt      soc += ac_in * eta
 *   ontladen: ac_out <= maxDischargeKw * dt   soc -= ac_out / eta
 *
 * Round-trip is dus eta^2. Het oude Streamlit-model begrensde bij laden de
 * OPGESLAGEN kWh en bij ontladen de ONTTROKKEN kWh, waardoor een 800 W-batterij
 * tot 0,853 kWh/u opnam maar slechts 0,7505 kWh/u leverde.
 */

import { HOURS_PER_STEP, type BatterySpec } from "./types";

/** Bruikbare capaciteit: het deel van de naamplaat dat je echt mag gebruiken. */
export function usableCapacityKwh(spec: BatterySpec): number {
  return spec.capacityKwh * spec.depthOfCharge;
}

/** Round-trip rendement, 0–1. */
export function roundTripEfficiency(spec: BatterySpec): number {
  return spec.efficiency * spec.efficiency;
}

/** Maximale AC-afname per kwartier bij laden, kWh. */
export function maxChargeKwhPerStep(spec: BatterySpec, hours = HOURS_PER_STEP): number {
  return spec.maxChargeKw * hours;
}

/** Maximale AC-levering per kwartier bij ontladen, kWh. */
export function maxDischargeKwhPerStep(spec: BatterySpec, hours = HOURS_PER_STEP): number {
  return spec.maxDischargeKw * hours;
}

/** Standby-verbruik per kwartier, kWh. */
export function standbyKwhPerStep(spec: BatterySpec, hours = HOURS_PER_STEP): number {
  return (spec.standbyWatt / 1000) * hours;
}

/**
 * De MARGINALE slijtagekost per geleverde kWh.
 *
 * Dit is de schaduwprijs die de dispatch stuurt: is deze laadbeurt de moeite
 * waard? Het antwoord hangt af van de vraag of laadbeurten schaars zijn.
 *
 * Een batterij gaat kapot aan het eerste van twee dingen: ouderdom of
 * doorzet. Maakt hij zijn laadbeurten niet op binnen zijn kalenderlevensduur,
 * dan kost een extra beurt niets — de batterij was toch al afgeschreven op
 * tijd, niet op gebruik. Pas als de beurten wél opraken, vervroegt elke extra
 * beurt de vervanging, en dán is de aanschafprijs per beurt de juiste prijs.
 *
 * Gemeten voor een FoxESS S22 (2,1 kWh, 6000 beurten, 15 jaar): zonder drempel
 * draait hij 394 beurten per jaar, precies 5.910 over vijftien jaar. De
 * beurten zijn dus net niet schaars. Met de volle drempel van 11,3 ct zakt dat
 * naar 251 per jaar — hij sterft dan aan ouderdom met 40% van zijn beurten
 * ongebruikt, en dat kost 12 euro per jaar aan gemiste besparing.
 *
 * @param expectedCyclesPerYear  verwacht aantal beurten per jaar zonder drempel
 * @param calendarYears          hoe lang de batterij meegaat op leeftijd
 */
export function marginalWearCostPerKwh(
  investmentEur: number,
  cycleLife: number,
  spec: BatterySpec,
  expectedCyclesPerYear: number,
  calendarYears: number,
): number {
  const vol = wearCostPerKwh(investmentEur, cycleLife, spec);
  if (vol <= 0) return 0;

  const verwachtTotaal = expectedCyclesPerYear * calendarYears;
  if (verwachtTotaal <= cycleLife) return 0;

  // De beurten zijn schaars: laat de prijs lineair oplopen met de mate van
  // schaarste, vanaf nul op de grens tot de volle prijs bij twee keer zoveel
  // beurten als er zijn. Zo komt het gebruik vanzelf in de buurt van wat de
  // batterij aankan.
  //
  // Vanaf NUL, niet vanaf de helft. De aanloop begon eerder op 0,5 × vol, en dan
  // sprong de drempel bij de FoxESS-preset van 0,00 naar 5,60 ct/kWh tussen 400
  // en 401 verwachte beurten per jaar. Omdat die verwachting uit een proefrun
  // komt, wisselde de dispatch abrupt van gedrag bij een kleine wijziging in
  // capaciteit of vermogen — een sprong die in het raster van batterijmaten als
  // een dip zichtbaar werd.
  return vol * Math.min(1, (verwachtTotaal - cycleLife) / cycleLife);
}

/**
 * Slijtagekosten per kWh die de batterij AC-zijdig levert.
 *
 * Over de levensduur levert de batterij `cycleLife * usable * eta` kWh aan de
 * AC-zijde (elke cyclus haalt `usable` uit de cel, waarvan `usable * eta`
 * aankomt). De aanschafprijs wordt daarover uitgesmeerd.
 *
 * Deze grootheid stuurt de dispatch: arbitrage loont alleen als het prijsverschil
 * de slijtage dekt. Het oude model gebruikte hier de investering gedeeld door
 * (cycli x usable), dus zonder rendementscorrectie, en de optimalisatiepagina
 * zette de investering bovendien op EUR 1 waardoor slijtage effectief wegviel
 * en de batterij agressief ging netarbitreren.
 */
export function wearCostPerKwh(
  investmentEur: number,
  cycleLife: number,
  spec: BatterySpec,
): number {
  const usable = usableCapacityKwh(spec);
  if (cycleLife <= 0 || usable <= 0) return 0;
  return investmentEur / (cycleLife * usable * spec.efficiency);
}

/**
 * Equivalente volledige cycli, geteld over de ONTLADING.
 *
 * Eén volledige cyclus = de bruikbare capaciteit één keer uit de cel halen.
 * We rekenen terug van AC naar cel: `ac_out / eta` is wat de cel verliet.
 *
 * Het oude model telde bij laden EN ontladen op en kwam daardoor op 582
 * cycli/jaar waar 273 correct was — een factor 2 in de levensduurschatting.
 */
export function equivalentCycles(
  totalDischargeAcKwh: number,
  spec: BatterySpec,
): number {
  const usable = usableCapacityKwh(spec);
  if (usable <= 0) return 0;
  return totalDischargeAcKwh / spec.efficiency / usable;
}

/**
 * Resterende bruikbare capaciteit na `years` jaar en `cycles` doorlopen cycli.
 *
 * Twee verouderingsmechanismen die naast elkaar werken; we nemen de zwaarste
 * van de twee in plaats van ze te vermenigvuldigen, omdat ze grotendeels
 * dezelfde fysieke degradatie beschrijven en vermenigvuldigen dubbel telt.
 *
 * @param calendarFadePerYear jaarlijkse capaciteitsafname, bv. 0,015 voor 1,5%
 * @param cycleLife           cycli tot het einde van de levensduur (80% rest)
 */
export function remainingCapacityFraction(
  years: number,
  cycles: number,
  calendarFadePerYear: number,
  cycleLife: number,
): number {
  const calendar = Math.pow(1 - calendarFadePerYear, years);
  // Lineair naar 80% op het einde van de cyclus-levensduur.
  const cyclic = cycleLife > 0 ? 1 - 0.2 * (cycles / cycleLife) : 1;
  return Math.max(0, Math.min(calendar, cyclic));
}
