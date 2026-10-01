/**
 * De bronnen van de batterijcatalogus, per merk en per model: waar de prijs,
 * het rendement en het stand-byverbruik vandaan komen. Staat bij "Aannames en
 * bronnen"; elke URL uit `PRESETS[].bronnen` komt hier terug.
 */

import { euro } from "../lib/format";
import { RENDEMENT_BRON_LABEL, STANDBY_BRON_LABEL, perMerk } from "../lib/presets";
import { MerkLogo } from "./MerkLogo";

export function BatterijBronnen() {
  return (
    <div className="batterij-bronnen">
      {perMerk().map((g) => (
        <div key={g.merk} className="batterij-bronnen-merk">
          <h4 className="batterij-bronnen-kop">
            <MerkLogo merk={g.merk} logo={g.logo} />
            {g.logo ? <span aria-hidden="true">{g.merk}</span> : null}
          </h4>
          <ul>
            {g.presets.map((p) => (
              <li key={p.id}>
                <b>{p.naam}</b>, {euro(p.prijsEur)} (peildatum {p.peildatum}): {p.prijsNoot}.
                {" "}Rendement {RENDEMENT_BRON_LABEL[p.rendementBron]}: {p.rendementNoot}.
                {" "}Stand-by {STANDBY_BRON_LABEL[p.standbyBron]}: {p.standbyNoot}.
                {p.bruikbaarNoot ? ` ${p.bruikbaarNoot}` : ""}
                {" "}Bronnen:{" "}
                {p.bronnen.map((b, i) => (
                  <span key={b.url}>
                    {i > 0 ? "; " : ""}
                    {b.wat}{" "}
                    <a href={b.url} rel="noopener" target="_blank">
                      {new URL(b.url).hostname.replace(/^www\./, "")}
                    </a>
                  </span>
                ))}
                .
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
