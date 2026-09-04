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
 *
 * ── Waarom er drie weergaven zijn ───────────────────────────────────────────
 * Het totaal beantwoordt "hoeveel levert deze maat op", en daarop wint de
 * grootste batterij altijd. Dat is waar, en het is misleidend: de aanschafprijs
 * loopt mee omhoog. De vraag die een koper werkelijk heeft is wat elke
 * kilowattuur bijdraagt, en dan draait het beeld om — de eerste kilowattuur
 * doet het meeste werk, de laatste vult alleen nog de randen op. Daarom staat
 * die weergave voorop.
 */

import { useState, type ReactNode } from "react";
import type { GridState } from "../lib/useAnalysis";
import type { GridPoint } from "../lib/worker/protocol";
import { euro, euroPrecies, getal } from "../lib/format";
import { Figure } from "./chart-parts";

const CAPACITEITEN = [1, 2, 3, 5, 7.5, 10, 15];
const VERMOGENS = [0.5, 0.8, 1.5, 2.5, 3.6, 5];

type Weergave = "perKwh" | "perKw" | "totaal";

interface Modus {
  /** Wat er op de schakelknop staat. */
  knop: string;
  /** De grootheid die het vakje toont. */
  waarde: (p: GridPoint) => number;
  /** Het getal in het vakje: kort, want de ruimte is krap. */
  cel: (n: number) => string;
  /** Hetzelfde bedrag in lopende tekst, met eenheid. */
  bedrag: (n: number) => string;
  /** Waar het getal per stuk over gaat, voor schermlezers en de voetregel. */
  eenheid: string;
  noot: string;
}

const MODI: Record<Weergave, Modus> = {
  perKwh: {
    knop: "Per kWh",
    // Delen door de capaciteit maakt de afnemende meeropbrengst direct
    // zichtbaar: hetzelfde bedrag, maar afgezet tegen wat je ervoor koopt.
    waarde: (p) => (p.capacityKwh > 0 ? p.savingEur / p.capacityKwh : 0),
    cel: (n) => getal(n, 1),
    bedrag: (n) => `${euroPrecies(n)} per kWh`,
    eenheid: "per kilowattuur capaciteit",
    noot:
      "Bedragen in euro per kilowattuur capaciteit per jaar, doorgerekend over " +
      "het meest recente volledige jaar met de realistische regelstrategie.",
  },
  perKw: {
    knop: "Per kW",
    waarde: (p) => (p.powerKw > 0 ? p.savingEur / p.powerKw : 0),
    cel: (n) => getal(n, 1),
    bedrag: (n) => `${euroPrecies(n)} per kW`,
    eenheid: "per kilowatt vermogen",
    noot:
      "Bedragen in euro per kilowatt vermogen per jaar, doorgerekend over het " +
      "meest recente volledige jaar met de realistische regelstrategie.",
  },
  totaal: {
    knop: "Totaal",
    waarde: (p) => p.savingEur,
    cel: (n) => String(Math.round(n)),
    bedrag: (n) => `${euro(n)} per jaar`,
    eenheid: "per jaar",
    noot:
      "Bedragen in euro per jaar, doorgerekend over het meest recente " +
      "volledige jaar met de realistische regelstrategie.",
  },
};

/** Het beste punt volgens de gekozen grootheid. */
function besteVan(punten: GridPoint[], modus: Modus): GridPoint | null {
  return punten.reduce<GridPoint | null>(
    (b, p) => (b === null || modus.waarde(p) > modus.waarde(b) ? p : b),
    null,
  );
}

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
  const [weergave, setWeergave] = useState<Weergave>("perKwh");

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

  const modus = MODI[weergave];
  const alle = grid.rows.flatMap((r) => r ?? []);
  const max = Math.max(...alle.map(modus.waarde), Number.MIN_VALUE);
  const beste = besteVan(alle, modus);

  // Sequentiële schaal: één hue, licht naar donker, want dit is magnitude.
  // De stap bepaalt ook de tekstkleur: wit op elke stap zetten maakte het
  // bedrag op de lichtste cellen onleesbaar (1,3:1). De eerste drie stappen
  // krijgen donkere tekst, de rest wit.
  const STAPPEN = 7;
  const stap = (waarde: number): number =>
    Math.min(STAPPEN - 1, Math.floor(Math.max(0, Math.min(1, waarde / max)) * STAPPEN));

  const actief = gehoverd ? grid.rows[gehoverd.r]?.[gehoverd.k] ?? null : null;

  // Het beste punt van de kleinste en de grootste rij: daarmee is te zeggen of
  // de opbrengst per eenheid daalt, in plaats van dat aan te nemen.
  const eersteRij = besteVan(grid.rows[0] ?? [], modus);
  const laatsteRij = besteVan(grid.rows[grid.rows.length - 1] ?? [], modus);
  const daalt =
    eersteRij !== null &&
    laatsteRij !== null &&
    modus.waarde(eersteRij) > modus.waarde(laatsteRij);

  const titel = ((): string => {
    if (!beste || !grid.klaar) return "Welke maat batterij loont eigenlijk?";
    if (weergave === "totaal") {
      return "Meer capaciteit helpt, maar het loopt dood zonder vermogen";
    }
    if (weergave === "perKwh") {
      return daalt
        ? "De eerste kilowattuur levert het meeste op"
        : "Wat elke kilowattuur capaciteit oplevert";
    }
    return daalt
      ? "Vermogen betaalt zich alleen terug tot een zeker punt"
      : "Wat elke kilowatt vermogen oplevert";
  })();

  const besteZin = ((): ReactNode => {
    if (!beste) return null;
    const plek = (
      <>
        {getal(beste.capacityKwh, 1)} kWh en {getal(beste.powerKw, 1)} kW
      </>
    );
    if (weergave === "totaal") {
      return (
        <>
          De hoogste besparing in dit raster is {euro(beste.savingEur)} bij {plek}.
          Meer is niet altijd beter: elke extra kilowattuur levert minder op dan
          de vorige, terwijl de aanschafprijs gewoon doorloopt.
        </>
      );
    }
    return (
      <>
        De hoogste opbrengst {modus.eenheid} is{" "}
        {modus.bedrag(modus.waarde(beste))} bij {plek}.
        {daalt && laatsteRij ? (
          <>
            {" "}
            Bij {getal(laatsteRij.capacityKwh, 1)} kWh is dat nog{" "}
            {modus.bedrag(modus.waarde(laatsteRij))}. Dat is de kern van de
            afweging: het totaal groeit nog wel, maar elke euro aanschaf koopt
            steeds minder besparing.
          </>
        ) : null}
      </>
    );
  })();

  return (
    <Figure
      titel={titel}
      toelichting={
        <>
          {weergave === "totaal"
            ? "Jaarbesparing per combinatie"
            : `Jaarbesparing ${modus.eenheid}, per combinatie`}
          , met jouw verbruik en tarieven. Donkerder is meer. Klik een vakje om
          die maat door te rekenen.
          {grid.bezig ? " Nog even geduld, de kaart vult zich." : ""}
        </>
      }
      actie={
        <div className="segment" role="group" aria-label="Wat het raster toont">
          {(Object.keys(MODI) as Weergave[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={weergave === id}
              className={weergave === id ? "segment-knop actief" : "segment-knop"}
              onClick={() => setWeergave(id)}
            >
              {MODI[id].knop}
            </button>
          ))}
        </div>
      }
    >
      <div className="heat-wrap">
        <table className="heat">
          <caption className="heat-caption">
            Rijen: capaciteit in kWh. Kolommen: vermogen in kW.
          </caption>
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
                            `stap-${stap(modus.waarde(punt))}`,
                            isHuidig ? "huidig" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onMouseEnter={() => setGehoverd({ r, k })}
                          onMouseLeave={() => setGehoverd(null)}
                          onFocus={() => setGehoverd({ r, k })}
                          onBlur={() => setGehoverd(null)}
                          onClick={() => onKies(cap, kw)}
                          aria-label={`${cap} kWh bij ${kw} kW: ${modus.bedrag(
                            modus.waarde(punt),
                          )}`}
                        >
                          {/* Het getal staat er altijd bij: kleur draagt nooit
                              alleen de betekenis. */}
                          <span>{modus.cel(modus.waarde(punt))}</span>
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
            levert {euro(actief.savingEur)} per jaar op
            {weergave === "totaal"
              ? ""
              : `, ${modus.bedrag(modus.waarde(actief))}`}
            , bij {Math.round(actief.cyclesPerYear)} cycli.
          </p>
        ) : beste && grid.klaar ? (
          <p>{besteZin}</p>
        ) : (
          <p>Wijs een vakje aan voor de details.</p>
        )}
        <p className="heat-noot">{modus.noot}</p>
      </div>
    </Figure>
  );
}
