"use client";

/**
 * Het antwoord van het tabblad Uitstoot: wat de batterij het huishouden aan
 * CO2 scheelt.
 *
 * Alleen de afname telt hier. Elke kWh van het net is op dat uur met een
 * bepaalde uitstoot opgewekt; de batterij haalt afname weg uit de avond (gas,
 * soms kolen) en vervangt hem door eigen zonnestroom of door afname op een
 * schoner uur. Teruglevering is de voetafdruk van wie de stroom gebruikt, niet
 * van wie hem levert; dat perspectief staat apart, bij Nederland.
 */

import type { ReactNode } from "react";
import { huishoudPerspectief, type Co2Jaar } from "../lib/model/co2";
import { getal, kwh, procent } from "../lib/format";
import { Tegel } from "./Statistieken";

/** Wat een gemiddelde benzineauto in de praktijk uitstoot, gram per kilometer. */
export const AUTO_G_PER_KM = 150;

export function kg(n: number): string {
  return `${getal(n, Math.abs(n) < 10 ? 1 : 0)} kg`;
}

export function Co2Antwoord({
  co2,
  periodeLabel,
  actie,
}: {
  co2: Co2Jaar;
  /** "gemiddeld over 2024 en 2025" of "in 2025". */
  periodeLabel: string;
  actie?: ReactNode;
}) {
  const h = huishoudPerspectief(co2);
  const aandeel = h.zonderKg > 0 ? h.winstKg / h.zonderKg : 0;
  const km = (h.winstKg * 1000) / AUTO_G_PER_KM;
  const wint = h.winstKg > 0.5;

  return (
    <section className="antwoord co2-antwoord" aria-live="polite">
      <div className="antwoord-kop">
        <div>
          <h2>
            {wint
              ? `Deze batterij scheelt ${kg(h.winstKg)} CO2 per jaar`
              : "Deze batterij scheelt nauwelijks CO2"}
          </h2>
          <p className="antwoord-zin">
            De stroom die je van het net haalt kostte {kg(h.zonderKg)} CO2 per jaar; met batterij{" "}
            {kg(h.metKg)}, {procent(aandeel)} minder, {periodeLabel}. De batterij haalt afname weg
            uit de avond, als gascentrales draaien, en vervangt hem door je eigen zonnestroom of
            door stroom van een schoner uur.
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
          uitleg="Elke kWh van het net maal de uitstoot van de Nederlandse stroommix op dat uur, opgeteld over het jaar."
        />
        <Tegel
          label="Uitstoot per kWh die je afneemt"
          van={`${getal(h.factorZonderG)} g`}
          naar={`${getal(h.factorMetG)} g`}
          delta={`${h.factorMetG <= h.factorZonderG ? "−" : "+"}${getal(Math.abs(h.factorZonderG - h.factorMetG))} g per kWh`}
          deltaGoed={h.factorMetG < h.factorZonderG}
          accent="var(--series-2)"
          uitleg={`Gewogen naar wanneer je afneemt. De mix zelf zat gemiddeld op ${getal(co2.gemiddeldeFactorG)} g/kWh; wie vooral 's avonds afneemt zit daarboven.`}
        />
        <Tegel
          label="Van het net gehaald"
          van={kwh(co2.importBasisKwh)}
          naar={kwh(co2.importBatKwh)}
          delta={`${kwh(co2.importBasisKwh - co2.importBatKwh)} minder`}
          deltaGoed
          accent="var(--series-1)"
          uitleg="Het grootste deel van de winst: wat je zelf bewaart, hoef je 's avonds niet van het net te halen."
        />
        <Tegel
          label="Ter vergelijking"
          waarde={wint ? `${getal(km < 100 ? Math.round(km) : Math.round(km / 10) * 10)} km rijden` : "—"}
          accent="var(--series-4)"
          uitleg={`Dezelfde uitstoot als zoveel kilometer met een gemiddelde benzineauto (${AUTO_G_PER_KM} g CO2 per km in de praktijk).`}
        />
      </div>
    </section>
  );
}
