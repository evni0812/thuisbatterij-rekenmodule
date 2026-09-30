"use client";

/**
 * De begeleide route: vijf stappen van jouw huis naar een eerlijk antwoord.
 *
 * Eén boodschap per stap, met onderaan steeds de weg naar de verdieping: de
 * zeven tabbladen onder "Alle cijfers" blijven de verantwoording. De stappen
 * lezen dezelfde doorrekening (zie ./types.ts).
 *
 * Rekenen gebeurt pas als het antwoord nodig is: wie op stap 1 of 2 iets
 * verandert, ziet geen wachtscherm; bij "Volgende" naar stap 3 wordt de
 * gewijzigde invoer doorgerekend.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { StapBatterij } from "./StapBatterij";
import { StapDag } from "./StapDag";
import { StapHuis } from "./StapHuis";
import { StapOpbrengst } from "./StapOpbrengst";
import { StapPast } from "./StapPast";
import { STAPPEN, type GidsData } from "./types";

export function Gids({
  stap,
  onStap,
  data,
  wachtscherm,
}: {
  /** 0 tot en met 4. */
  stap: number;
  onStap: (stap: number) => void;
  data: GidsData;
  /** Het gedeelde wachtscherm van de pagina, voor de stappen met een uitkomst. */
  wachtscherm: ReactNode;
}) {
  const kop = useRef<HTMLHeadingElement>(null);
  const eerste = useRef(true);

  // Na een stapwissel naar boven, en de focus op de kop van de nieuwe stap:
  // voor een schermlezer is dat de aankondiging dat er iets nieuws staat.
  useEffect(() => {
    if (eerste.current) {
      eerste.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    kop.current?.focus({ preventScroll: true });
  }, [stap]);

  const gaNaar = (doel: number) => {
    const naar = Math.max(0, Math.min(STAPPEN.length - 1, doel));
    // Vanaf stap 3 staat er een uitkomst: is de invoer veranderd, reken dan nu.
    if (naar >= 2 && data.verouderd && !data.bezig) data.herbereken();
    onStap(naar);
  };

  const gegevens: GidsData = { ...data, volgende: () => gaNaar(stap + 1) };
  const huidig = STAPPEN[stap]!;

  return (
    <div className="gids">
      <nav className="gids-voortgang" aria-label="Stappen">
        <ol>
          {STAPPEN.map((s, i) => (
            <li
              key={s.id}
              className={i === stap ? "actief" : i < stap ? "gedaan" : undefined}
            >
              <button
                type="button"
                onClick={() => gaNaar(i)}
                aria-current={i === stap ? "step" : undefined}
              >
                <span className="gids-nummer" aria-hidden="true">
                  {i < stap ? "✓" : i + 1}
                </span>
                <span className="gids-stapnaam">{s.naam}</span>
              </button>
            </li>
          ))}
        </ol>
        <div
          className="gids-balk"
          role="progressbar"
          aria-label="Voortgang"
          aria-valuemin={1}
          aria-valuemax={STAPPEN.length}
          aria-valuenow={stap + 1}
        >
          <span style={{ width: `${((stap + 1) / STAPPEN.length) * 100}%` }} />
        </div>
      </nav>

      <section className={`gids-stap gids-stap-${huidig.id}`} aria-labelledby="gids-kop">
        <p className="gids-eyebrow">
          Stap {stap + 1} van {STAPPEN.length} · {huidig.naam}
        </p>
        <h1 id="gids-kop" ref={kop} tabIndex={-1}>
          {KOPPEN[huidig.id]}
        </h1>

        {stap >= 2 ? wachtscherm : null}

        {huidig.id === "huis" ? <StapHuis {...gegevens} /> : null}
        {huidig.id === "batterij" ? <StapBatterij {...gegevens} /> : null}
        {huidig.id === "dag" ? <StapDag {...gegevens} /> : null}
        {huidig.id === "opbrengst" ? <StapOpbrengst {...gegevens} /> : null}
        {huidig.id === "past" ? <StapPast {...gegevens} /> : null}
      </section>

      <div className="gids-navigatie">
        {stap > 0 ? (
          <button type="button" className="knop licht" onClick={() => gaNaar(stap - 1)}>
            ← Vorige
          </button>
        ) : (
          <span />
        )}
        {stap < STAPPEN.length - 1 ? (
          <button type="button" className="knop gids-volgende" onClick={() => gaNaar(stap + 1)}>
            {VOLGENDE[huidig.id]} →
          </button>
        ) : (
          <button
            type="button"
            className="knop gids-volgende"
            onClick={() => data.naarVerdieping("uitkomst")}
          >
            Alle cijfers en verantwoording →
          </button>
        )}
      </div>
    </div>
  );
}

/** De vraag van elke stap. */
const KOPPEN: Record<(typeof STAPPEN)[number]["id"], string> = {
  huis: "Hoe ziet jouw huis eruit?",
  batterij: "Welke batterij wil je doorrekenen?",
  dag: "Wat doet de batterij op een dag?",
  opbrengst: "Wat had hij je opgeleverd?",
  past: "Past een thuisbatterij bij jou?",
};

/** Wat de knop naar de volgende stap zegt: waar hij je naartoe brengt. */
const VOLGENDE: Record<(typeof STAPPEN)[number]["id"], string> = {
  huis: "Kies een batterij",
  batterij: "Laat zien wat hij doet",
  dag: "Wat levert het op?",
  opbrengst: "Past het bij me?",
  past: "",
};
