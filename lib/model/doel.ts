/**
 * Waar de planner op stuurt: rendement, zelfconsumptie of uitstoot.
 *
 * De solver kent maar één taal: een prijs per kwartier voor afname en voor
 * teruglevering, plus een slijtagedrempel. De drie doelen zijn daarom drie
 * manieren om het venster aan de solver te geven:
 *
 *   rendement       het venster zoals het is: de echte prijzen.
 *   zelfconsumptie  dezelfde prijzen, maar met de handen op de rug: laden mag
 *                   alleen uit eigen overschot, ontladen alleen voor eigen
 *                   tekort (`alleenEigen`). Binnen die grenzen kiest de planner
 *                   nog steeds het goedkoopste moment.
 *   uitstoot        de emissiefactor van dat uur als "prijs" voor afname, en
 *                   niets voor teruglevering (wat de buren met jouw stroom doen
 *                   is hun voetafdruk). De batterij vermijdt dan de vuilste
 *                   uren in plaats van de duurste. Eén cent staat gelijk aan
 *                   tien gram: de slijtagedrempel van bijvoorbeeld 1,8 ct wordt
 *                   zo 18 g/kWh, en een beurt gaat door als hij méér uitstoot
 *                   uitspaart dan dat.
 *
 * De afrekening blijft altijd in echte euro's: `finalize` en de CO2-balans
 * gebruiken het oorspronkelijke venster. Alleen het plan verandert.
 */

import type { Doel, Window } from "./types";

export const STANDAARD_DOEL: Doel = "rendement";

export interface DoelInfo {
  id: Doel;
  naam: string;
  /** Eén zin over wat de stand doet. */
  kort: string;
}

export const DOELEN: readonly DoelInfo[] = [
  {
    id: "rendement",
    naam: "Rendement",
    kort: "Zo weinig mogelijk euro's kwijt: eigen zon opslaan, bijkopen als het net goedkoop is en verkopen als het duur is.",
  },
  {
    id: "zelfconsumptie",
    naam: "Zelfconsumptie",
    kort: "Alleen je eigen zon opslaan en alleen je eigen verbruik dekken. Nooit laden uit het net, nooit terugleveren uit de batterij.",
  },
  {
    id: "uitstoot",
    naam: "Uitstoot",
    kort: "Zo weinig mogelijk CO2: de batterij vermijdt de uren waarop de stroom uit het net het vuilst is, ongeacht de prijs.",
  },
];

export function doelInfo(id: Doel | undefined): DoelInfo {
  return DOELEN.find((d) => d.id === (id ?? STANDAARD_DOEL)) ?? DOELEN[0]!;
}

/** Schaal van de uitstoot-"prijs": één cent per kWh staat gelijk aan tien gram. */
export const GRAM_PER_CENT = 10;

/**
 * Het venster zoals de planner het ziet, en of hij zich tot eigen overschot
 * en tekort moet beperken. Voor rendement is dit hetzelfde object.
 */
export function stuurVenster(window: Window): { venster: Window; alleenEigen: boolean } {
  const doel = window.doel ?? STANDAARD_DOEL;
  if (doel === "zelfconsumptie") return { venster: window, alleenEigen: true };
  if (doel !== "uitstoot" || !window.co2GPerKwh) return { venster: window, alleenEigen: false };

  const ef = window.co2GPerKwh;
  const n = ef.length;
  const importPrice = new Float64Array(n);
  const exportPrice = new Float64Array(n);
  // Een kwartier zonder factor (de reeks loopt achter) krijgt de laatste
  // bekende, anders de eerste erna: NaN zou de hele optimalisatie verzieken.
  let laatste = Number.NaN;
  for (let i = 0; i < n; i++) if (!Number.isNaN(ef[i]!)) { laatste = ef[i]!; break; }
  for (let i = 0; i < n; i++) {
    const g = ef[i]!;
    if (!Number.isNaN(g)) laatste = g;
    // g/kWh → "euro" per kWh: 200 g wordt 0,20, zodat 1 ct ≙ 10 g.
    importPrice[i] = (Number.isNaN(laatste) ? 0 : laatste) / (100 * GRAM_PER_CENT);
    // Teruglevering levert geen CO2-winst op voor het huishouden, dus nul.
    // Een negatieve prijs blijft wel negatief, en dan in euro's: die zijn in
    // dezelfde eenheid als de emissie-"prijs", want de wisselkoers 1 ct ≙ 10 g
    // geldt voor alles wat de planner weegt, net als voor de slijtagedrempel
    // (ook in euro's). Twee redenen om hem niet op nul te zetten: de
    // uitvoerder regelt af op het teken van déze prijs (executePath krijgt het
    // stuurvenster), en zonder afregelen kost terugleveren bij een negatieve
    // prijs echt geld, dat de planner met de wisselkoers mag afwegen tegen
    // uitgespaarde uitstoot.
    const ep = window.prices.exportPrice[i]!;
    exportPrice[i] = ep < 0 ? ep : 0;
  }
  return {
    venster: { ...window, prices: { importPrice, exportPrice } },
    alleenEigen: false,
  };
}
