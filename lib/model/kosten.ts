/**
 * Wat een andere maat batterij kost dan de gekozen.
 *
 * ── Waarom één generieke regel ──────────────────────────────────────────────
 * Elk model heeft zijn eigen uitbreidingspakketten, en die verschillen: bij de
 * ene hub groeit de capaciteit per module van 1,9 kWh en blijft het vermogen
 * op 800 W, bij de andere koop je hele units erbij en groeit alles mee. Dat
 * per model narekenen maakt de kaart van maten onvergelijkbaar tussen
 * batterijen. Daarom één regel voor allemaal, verankerd aan de gekozen
 * batterij: jouw batterij kost wat hij kost, en elke kilowattuur of kilowatt
 * erbij kost de gangbare meerprijs.
 *
 *   kosten(cap, kW) = prijs
 *                   + perKwh × (cap − cap₀)
 *                   + perKw  × (kW − kW₀)
 *                   + installatie, als je de grens van 0,8 kW oversteekt
 *
 * Symmetrisch: wie van een vaste thuisaccu terug naar een stekkerbatterij
 * rekent, krijgt de installateur er weer af.
 *
 * ── De standaardwaarden, peildatum september 2026 ───────────────────────────
 * PER kWh — uitbreidingsmodules kosten bij vrijwel elk merk hetzelfde:
 * Zendure AB2000X 599 euro voor 1,92 kWh (312 €/kWh), Anker SOLIX BP2700
 * 849 euro voor 2,69 kWh (316 €/kWh), HomeWizard een hele unit van 1.195 euro
 * voor 2,7 kWh (443 €/kWh), Marstek 1.199 euro voor 5,12 kWh (234 €/kWh).
 * Bron: thuisbatterijgids.net (uitbreidingsaccu's). Afgerond op 320.
 *
 * PER kW — het vermogen zit in de omvormer. Een hybride omvormer van 3 tot
 * 5 kW kost 1.000 tot 2.500 euro; de omvormer in een stekkerhub is goedkoper.
 * Bron: thuisbatterij-gids.nl, thuisbatterij.nl (prijzen 2026). Afgerond op 250.
 *
 * INSTALLATIE — boven 800 W mag een batterij niet aan een gewoon stopcontact
 * en komt er een installateur voor een eigen groep. Die kost volgens
 * powerplugs.nl/pages/eigen-groep 100 tot 200 euro in een standaardsituatie
 * en 300 tot 600 euro bij een volle meterkast of een lange kabel; wie een
 * nieuwe meterkast nodig heeft, zit hoger. 300 is een voorzichtig midden.
 */

import type { Configuration } from "../worker/protocol";

export interface Kostenregel {
  /** Meerprijs per kilowattuur capaciteit, euro. */
  perKwhEur: number;
  /** Meerprijs per kilowatt laad- en ontlaadvermogen, euro. */
  perKwEur: number;
  /** Eén keer, zodra het vermogen boven de stekkergrens komt: eigen groep. */
  installatieEur: number;
}

export const STANDAARD_KOSTENREGEL: Kostenregel = {
  perKwhEur: 320,
  perKwEur: 250,
  installatieEur: 300,
};

/**
 * Boven dit vermogen is het geen stekkerbatterij meer. Een gewoon stopcontact
 * mag 800 W leveren; daarboven komt er een eigen groep door een installateur.
 */
export const STEKKER_GRENS_KW = 0.8;

/** Vraagt dit vermogen een eigen groep door een installateur? */
export function isVasteAansluiting(kw: number): boolean {
  return kw > STEKKER_GRENS_KW + 1e-9;
}

/** De batterij waaraan de kostenregel is verankerd. */
export interface Anker {
  investmentEur: number;
  capaciteitKwh: number;
  vermogenKw: number;
}

/** De kostenregel uit de configuratie, met de standaard voor wat ontbreekt. */
export function kostenregelVan(config: Configuration): Kostenregel {
  return {
    perKwhEur: config.kostenPerKwhEur ?? STANDAARD_KOSTENREGEL.perKwhEur,
    perKwEur: config.kostenPerKwEur ?? STANDAARD_KOSTENREGEL.perKwEur,
    installatieEur: config.installatieEur ?? STANDAARD_KOSTENREGEL.installatieEur,
  };
}

/**
 * Het anker uit de getoonde configuratie: de batterij zoals hij is
 * doorgerekend, met de prijs die de gebruiker ervoor heeft staan. Zo telt een
 * eigen offerteprijs door in elke andere maat.
 */
export function ankerVan(config: Configuration): Anker {
  return {
    investmentEur: config.investmentEur,
    capaciteitKwh: config.battery.capacityKwh,
    vermogenKw: config.battery.maxDischargeKw,
  };
}

/**
 * Wat een batterij van deze maat kost, gerekend vanaf het anker.
 *
 * Bij de maat van het anker is dit exact de ankerprijs. De regel is lineair
 * plus één stap, dus in stappen naar een maat toe rekenen geeft dezelfde prijs
 * als in één keer. Nooit onder nul: een batterij van niets is gratis, niet
 * goedkoper.
 */
export function kostenVan(anker: Anker, regel: Kostenregel, cap: number, kw: number): number {
  const stap = Number(isVasteAansluiting(kw)) - Number(isVasteAansluiting(anker.vermogenKw));
  const kosten =
    anker.investmentEur +
    regel.perKwhEur * (cap - anker.capaciteitKwh) +
    regel.perKwEur * (kw - anker.vermogenKw) +
    regel.installatieEur * stap;
  return Math.max(0, kosten);
}
