"use client";

/**
 * Het antwoord van het tabblad Uitstoot: wat de batterij het huishouden aan
 * CO2 scheelt, of kost.
 *
 * Alleen de afname telt hier. Elke kWh van het net is op dat uur met een
 * bepaalde uitstoot opgewekt; de batterij kan afname weghalen uit de avond
 * (gas, soms kolen) en die aanvullen met eigen zonnestroom of met afname op een
 * schoner uur. Zonder zonnepanelen, of als de batterij op vuile uren laadt,
 * kan het ook andersom uitvallen: dan staat dat er, met het teken erbij.
 * Teruglevering is de voetafdruk van wie de stroom gebruikt, niet van wie hem
 * levert; dat perspectief staat apart, bij Nederland.
 *
 * Het is een toerekening met de gemiddelde uitstoot per uur, geen gemeten
 * vermeden uitstoot; dat staat er in één zin onder.
 */

import type { ReactNode } from "react";
import { huishoudPerspectief, type Co2Jaar } from "../lib/model/co2";
import type { Doel } from "../lib/model/types";
import { getal, kwh, procent } from "../lib/format";
import { Tegel } from "./Statistieken";

/**
 * Wat een middelgrote benzineauto uit de uitlaat uitstoot, gram per kilometer:
 * 149 g/km (co2emissiefactoren.nl, 2025, tank-to-wheel), afgerond.
 */
export const AUTO_G_PER_KM = 150;

export function kg(n: number): string {
  return `${getal(n, Math.abs(n) < 10 ? 1 : 0)} kg`;
}

export function Co2Antwoord({
  co2,
  periodeLabel,
  zonnepanelen = true,
  doel = "rendement",
  actie,
}: {
  co2: Co2Jaar;
  /** Bijwoordelijk, past achter "kostte": "gemiddeld per jaar over 2024 en 2025" of "in 2025". */
  periodeLabel: string;
  /** Rekent de doorrekening met het profiel met zonnepanelen? Kiest de uitleg. */
  zonnepanelen?: boolean;
  /** Waar de batterij op stuurde: bij "uitstoot" is de CO2-winst het doel, anders een bijeffect. */
  doel?: Doel;
  actie?: ReactNode;
}) {
  const h = huishoudPerspectief(co2);
  const aandeel = h.zonderKg > 0 ? Math.abs(h.winstKg) / h.zonderKg : 0;
  const km = (h.winstKg * 1000) / AUTO_G_PER_KM;
  const wint = h.winstKg > 0.5;
  const verliest = h.winstKg < -0.5;
  const minderAfname = co2.importBatKwh < co2.importBasisKwh;

  const titel = wint
    ? `Deze batterij scheelt ${kg(h.winstKg)} CO2 per jaar`
    : verliest
      ? `Met deze batterij stoot je netafname ${kg(-h.winstKg)} méér CO2 uit per jaar`
      : "Deze batterij scheelt nauwelijks CO2";

  const hoe = wint
    ? zonnepanelen
      ? "De batterij haalt afname weg uit de avond, als er vaker gascentrales draaien, en vult die aan met je eigen zonnestroom of met stroom van een schoner uur."
      : "Zonder zonnepanelen laadt de batterij van het net, op uren waarop de stroom gemiddeld schoner is dan op de uren waarop hij levert."
    : verliest
      ? "De batterij laadt hier vaker op uren met vuilere stroom dan de uren waarop hij levert, en bij laden en ontladen gaat stroom verloren. Per saldo kost je netafname daardoor meer CO2."
      : "Wat de batterij op de ene uren wint, verliest hij op andere, en bij laden en ontladen gaat stroom verloren.";

  const sturing =
    doel === "uitstoot"
      ? "De batterij stuurt hier op uitstoot: hij mijdt de vuilste uren, ongeacht de prijs."
      : `De batterij stuurt hier op ${doel === "zelfconsumptie" ? "zelfconsumptie" : "prijs"}; de CO2-winst is een bijeffect. In de stand Uitstoot stuurt hij erop.`;

  return (
    <section className="antwoord co2-antwoord" aria-live="polite">
      <div className="antwoord-kop">
        <div>
          <h2>{titel}</h2>
          <p className="antwoord-zin">
            De stroom die je van het net haalt, kostte {periodeLabel} {kg(h.zonderKg)} CO2;
            met batterij {kg(h.metKg)}, {procent(aandeel)} {h.winstKg >= 0 ? "minder" : "meer"}.{" "}
            {hoe} {sturing}
          </p>
          <p className="antwoord-grondslag">
            Gerekend met de gemiddelde uitstoot van de Nederlandse opwek per uur, niet met de
            marginale uitstoot van de centrale die op- of afregelt. Lees dit als een toerekening,
            niet als gemeten vermeden uitstoot. De uitstoot van het maken van de batterij is niet
            meegerekend.
          </p>
        </div>
        {actie}
      </div>

      <div className="stat-grid">
        <Tegel
          label="Uitstoot van je netafname"
          van={kg(h.zonderKg)}
          naar={kg(h.metKg)}
          delta={`${h.winstKg >= 0 ? "−" : "+"}${kg(Math.abs(h.winstKg))} per jaar`}
          deltaGoed={h.winstKg > 0}
          accent="var(--series-3)"
          uitleg="Elke kWh van het net maal de gemiddelde uitstoot van de Nederlandse opwek op dat uur, opgeteld over het jaar."
        />
        <Tegel
          label="Uitstoot per kWh die je afneemt"
          van={`${getal(h.factorZonderG)} g`}
          naar={`${getal(h.factorMetG)} g`}
          delta={`${h.factorMetG <= h.factorZonderG ? "−" : "+"}${getal(Math.abs(h.factorZonderG - h.factorMetG))} g per kWh`}
          deltaGoed={h.factorMetG < h.factorZonderG}
          accent="var(--series-2)"
          uitleg={`Gewogen naar wanneer je afneemt. De Nederlandse opwek zat gemiddeld over alle uren op ${getal(co2.gemiddeldeFactorG)} g/kWh; wie vooral 's avonds afneemt, zit daarboven.`}
        />
        <Tegel
          label="Van het net gehaald"
          van={kwh(co2.importBasisKwh)}
          naar={kwh(co2.importBatKwh)}
          delta={`${kwh(Math.abs(co2.importBasisKwh - co2.importBatKwh))} ${minderAfname ? "minder" : "meer"}`}
          deltaGoed={minderAfname}
          accent="var(--series-1)"
          uitleg={
            !minderAfname
              ? "Met batterij haal je meer van het net: wat hij levert, moet hij eerst laden, en bij laden en ontladen gaat stroom verloren."
              : zonnepanelen
                ? "Wat je minder van het net haalt, komt uit zonnestroom die de batterij heeft opgeslagen."
                : "Wat je per saldo minder van het net haalt."
          }
        />
        <Tegel
          label="Ter vergelijking"
          waarde={wint ? `${getal(km < 100 ? Math.round(km) : Math.round(km / 10) * 10)} km rijden` : "—"}
          accent="var(--series-4)"
          uitleg={`Dezelfde uitstoot als zoveel kilometer met een middelgrote benzineauto: 149 g CO2 per km uit de uitlaat (co2emissiefactoren.nl, 2025), afgerond op ${AUTO_G_PER_KM} g.`}
        />
      </div>
    </section>
  );
}
