"use client";

/**
 * Instellingen bewaren in deze browser.
 *
 * Eén knop voor "onthoud dit", en daaronder profielen met een naam. Alles blijft
 * lokaal: er gaat niets naar een server, en wat je bewaart is met één klik weg.
 */

import { useState } from "react";
import { datum } from "../lib/format";
import {
  MAX_PROFIELEN,
  bewaarLaatste,
  bewaarProfiel,
  verwijderProfiel,
  vergeetLaatste,
  type Profiel,
} from "../lib/opslag";
import type { Instellingen } from "../lib/url-state";

export function Bewaren({
  inst,
  profielen,
  onProfielen,
  laatsteBewaard,
  onLaatste,
  onLaad,
}: {
  inst: Instellingen;
  profielen: Profiel[];
  onProfielen: (p: Profiel[]) => void;
  /** Tijdstip waarop de laatste set is bewaard, of null. */
  laatsteBewaard: string | null;
  onLaatste: (tijdstip: string | null) => void;
  onLaad: (inst: Instellingen) => void;
}) {
  const [naam, setNaam] = useState("");
  const [melding, setMelding] = useState<string | null>(null);

  const meld = (tekst: string) => {
    setMelding(tekst);
    setTimeout(() => setMelding(null), 3000);
  };

  return (
    <section className="bewaren" aria-labelledby="bewaren-kop">
      <div className="bewaren-kop">
        <div>
          <h2 id="bewaren-kop">Instellingen bewaren</h2>
          <p>
            In deze browser, nergens anders. Bewaarde instellingen laden vanzelf
            bij een volgend bezoek; een gedeelde link gaat altijd vóór.
          </p>
        </div>
        <div className="bewaren-rij">
          <button
            type="button"
            className="knop"
            onClick={() => {
              if (bewaarLaatste(inst)) {
                onLaatste(new Date().toISOString());
                meld("Bewaard. Bij je volgende bezoek staan deze instellingen klaar.");
              } else {
                meld("Bewaren lukte niet; de opslag van je browser is vol of geblokkeerd.");
              }
            }}
          >
            Onthoud mijn instellingen
          </button>
          {laatsteBewaard ? (
            <button
              type="button"
              className="knop licht"
              onClick={() => {
                vergeetLaatste();
                onLaatste(null);
                meld("Vergeten.");
              }}
            >
              Vergeet
            </button>
          ) : null}
        </div>
      </div>

      <div className="bewaren-rij">
        <div className="getal-veld klein">
          <input
            type="text"
            maxLength={40}
            value={naam}
            placeholder="Naam, bijvoorbeeld ‘Thuis’ of ‘Ouders’"
            aria-label="Naam voor dit profiel"
            onChange={(e) => setNaam(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="knop licht"
          disabled={naam.trim() === "" || (profielen.length >= MAX_PROFIELEN && !profielen.some((p) => p.naam === naam.trim()))}
          onClick={() => {
            const nieuw = bewaarProfiel(naam, inst);
            if (nieuw) {
              onProfielen(nieuw);
              setNaam("");
              meld(`Profiel “${naam.trim()}” bewaard.`);
            } else {
              meld(`Hoogstens ${MAX_PROFIELEN} profielen; verwijder er eerst een.`);
            }
          }}
        >
          Bewaar als profiel
        </button>
      </div>

      {profielen.length > 0 ? (
        <ul className="profielen">
          {profielen.map((p) => (
            <li key={p.naam} className="profiel">
              <span className="profiel-naam">{p.naam}</span>
              <span className="profiel-meta">
                {p.inst.afnameKwh} kWh af, {p.inst.terugleveringKwh} kWh terug
                {p.bewaard ? ` · ${datum(p.bewaard.slice(0, 10))}` : ""}
              </span>
              <button type="button" className="knop klein" onClick={() => onLaad(p.inst)}>
                Laad
              </button>
              <button
                type="button"
                className="knop licht klein"
                aria-label={`Verwijder profiel ${p.naam}`}
                onClick={() => onProfielen(verwijderProfiel(p.naam))}
              >
                Verwijder
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {melding ? (
        <p className="invoer-hint" role="status">
          {melding}
        </p>
      ) : null}
    </section>
  );
}
