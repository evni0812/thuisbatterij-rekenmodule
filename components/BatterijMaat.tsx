"use client";

/**
 * Welke batterijmaat loont?
 *
 * Een raster van capaciteit tegen vermogen, gekleurd naar jaarbesparing. Dit
 * vervangt de optimalisatiepagina van het prototype, die drie problemen had:
 * de besparing daalde er bij een grotere batterij, de batterijspecificaties
 * werden overschreven door hardcoded waarden, en de aanschafprijs werd op één
 * euro gezet — waardoor de slijtagekosten wegvielen en de batterij in het model
 * veel agressiever ging handelen dan hij in werkelijkheid zou doen.
 *
 * Hier gelden de ingestelde specificaties, inclusief de echte prijs, en is de
 * uitkomst monotoon: meer capaciteit of meer vermogen levert nooit minder op.
 */

import { useState } from "react";
import type { GridState } from "../lib/useAnalysis";
import { euro, getal } from "../lib/format";
import { Figure } from "./chart-parts";

const CAPACITEITEN = [1, 2, 3, 5, 7.5, 10, 15];
const VERMOGENS = [0.5, 0.8, 1.5, 2.5, 3.6, 5];

export function BatterijMaat({
  grid,
  huidigeCapaciteit,
  huidigVermogen,
  onStart,
  onKies,
}: {
  grid: GridState | null;
  huidigeCapaciteit: number;
  huidigVermogen: number;
  onStart: (capaciteiten: number[], vermogens: number[]) => void;
  onKies: (capaciteit: number, vermogen: number) => void;
}) {
  const [gehoverd, setGehoverd] = useState<{ r: number; k: number } | null>(null);

  if (!grid) {
    return (
      <Figure
        titel="Welke maat batterij loont eigenlijk?"
        toelichting={
          <>
            Reken een reeks combinaties van capaciteit en vermogen door met jouw
            gegevens. Dat kost een paar seconden, want elke combinatie is een
            volledige doorrekening van een jaar aan kwartierdata.
          </>
        }
      >
        <button
          type="button"
          className="start-knop"
          onClick={() => onStart(CAPACITEITEN, VERMOGENS)}
        >
          Reken de maten door
        </button>
      </Figure>
    );
  }

  const alle = grid.rows.flatMap((r) => r ?? []);
  const max = Math.max(...alle.map((p) => p.savingEur), 1);
  const beste = alle.reduce<null | (typeof alle)[number]>(
    (b, p) => (b === null || p.savingEur > b.savingEur ? p : b),
    null,
  );

  // Sequentiële schaal: één hue, licht naar donker, want dit is magnitude.
  // De stap bepaalt ook de tekstkleur: wit op elke stap zetten maakte het
  // bedrag op de lichtste cellen onleesbaar (1,3:1). De eerste drie stappen
  // krijgen donkere tekst, de rest wit.
  const STAPPEN = 7;
  const stap = (waarde: number): number =>
    Math.min(STAPPEN - 1, Math.floor(Math.max(0, Math.min(1, waarde / max)) * STAPPEN));

  const actief = gehoverd ? grid.rows[gehoverd.r]?.[gehoverd.k] ?? null : null;

  return (
    <Figure
      titel={
        beste
          ? `Meer capaciteit helpt, maar het loopt dood zonder vermogen`
          : "Welke maat batterij loont eigenlijk?"
      }
      toelichting={
        <>
          Jaarbesparing per combinatie, met jouw verbruik en tarieven. Donkerder
          is meer. Klik een vakje om die maat door te rekenen.
          {grid.bezig ? " Nog even geduld, de kaart vult zich." : ""}
        </>
      }
    >
      <div className="heat-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th scope="col" className="heat-hoek">
                
              </th>
              {grid.powers.map((kw) => (
                <th key={kw} scope="col">
                  {getal(kw, 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.capacities.map((cap, r) => (
              <tr key={cap}>
                <th scope="row">{getal(cap, 1)}</th>
                {grid.powers.map((kw, k) => {
                  const punt = grid.rows[r]?.[k];
                  const isHuidig =
                    Math.abs(cap - huidigeCapaciteit) < 0.05 &&
                    Math.abs(kw - huidigVermogen) < 0.05;
                  return (
                    <td key={kw}>
                      {punt ? (
                        <button
                          type="button"
                          className={[
                            "heat-cel",
                            `stap-${stap(punt.savingEur)}`,
                            isHuidig ? "huidig" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onMouseEnter={() => setGehoverd({ r, k })}
                          onMouseLeave={() => setGehoverd(null)}
                          onFocus={() => setGehoverd({ r, k })}
                          onBlur={() => setGehoverd(null)}
                          onClick={() => onKies(cap, kw)}
                          aria-label={`${cap} kWh bij ${kw} kW: ${euro(punt.savingEur)} per jaar`}
                        >
                          {/* Het getal staat er altijd bij: kleur draagt nooit
                              alleen de betekenis. */}
                          <span>{Math.round(punt.savingEur)}</span>
                        </button>
                      ) : (
                        <span className="heat-cel leeg" aria-hidden="true" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="heat-voet">
        {actief ? (
          <p>
            <strong>
              {getal(actief.capacityKwh, 1)} kWh bij {getal(actief.powerKw, 1)} kW
            </strong>{" "}
            levert {euro(actief.savingEur)} per jaar op, bij{" "}
            {Math.round(actief.cyclesPerYear)} cycli.
          </p>
        ) : beste && grid.klaar ? (
          <p>
            De hoogste besparing in dit raster is {euro(beste.savingEur)} bij{" "}
            {getal(beste.capacityKwh, 1)} kWh en {getal(beste.powerKw, 1)} kW.
            Meer is niet altijd beter: elke extra kilowattuur levert minder op
            dan de vorige, terwijl de aanschafprijs gewoon doorloopt.
          </p>
        ) : (
          <p>Wijs een vakje aan voor de details.</p>
        )}
        <p className="heat-noot">
          Bedragen in euro per jaar, doorgerekend over het meest recente
          volledige jaar met de realistische regelstrategie.
        </p>
      </div>
    </Figure>
  );
}
