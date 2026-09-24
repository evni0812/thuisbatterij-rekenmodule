"use client";

/**
 * Wat er gebeurt terwijl je wacht, en wanneer je opnieuw moet rekenen.
 *
 * Twee standen, één plek bovenaan de pagina, op elk tabblad:
 *
 *   bezig      de doorrekening loopt: een balk die vult naarmate de stukken
 *              uit de pool binnenkomen, met de stappen erbij. Eerder dimde
 *              alleen het antwoordblok en stond er "Bezig met rekenen…" op een
 *              knop op het eerste tabblad; wie op een ander tabblad stond zag
 *              niets gebeuren.
 *   verouderd  de invoer is gewijzigd maar er is nog niet gerekend: het
 *              antwoord op het scherm hoort bij de vorige invoer. Dat hoort je
 *              niet te ontgaan, dus het staat hier als balk met de knop erin
 *              en niet alleen als regeltje onder de invoer.
 *
 * De stappen zijn de echte taken van de pool (lib/useAnalysis.ts, `Voortgang`),
 * geen verzonnen percentages: elk profieljaar is een jaar aan kwartierdata,
 * twee keer doorgerekend (realistisch en met perfecte voorspelling).
 */

import { useEffect, useState } from "react";
import type { Voortgang } from "../lib/useAnalysis";

function Stap({ klaar, bezig, children, teller }: { klaar: boolean; bezig: boolean; children: string; teller?: string }) {
  return (
    <li className={klaar ? "klaar" : bezig ? "bezig" : undefined}>
      <span className="wacht-stap-naam">{children}</span>
      {teller ? <span className="wacht-stap-teller">{teller}</span> : null}
    </li>
  );
}

export function Wachtscherm({
  voortgang,
  bezig,
  verouderd,
  eersteKeer,
  onBereken,
}: {
  voortgang: Voortgang | null;
  /** Er loopt een doorrekening. */
  bezig: boolean;
  /** De invoer is gewijzigd sinds het getoonde antwoord. */
  verouderd: boolean;
  /** Er is nog geen enkel antwoord getoond. */
  eersteKeer: boolean;
  onBereken: () => void;
}) {
  // Een klokje dat meeloopt: het zegt dat er iets gebeurt, ook als de balk
  // even stilstaat omdat het langste stuk (een profieljaar) nog loopt.
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    if (!bezig) return;
    const t = setInterval(() => setNu(Date.now()), 250);
    return () => clearInterval(t);
  }, [bezig]);

  if (bezig) {
    const v = voortgang;
    const pct = v ? Math.round(v.deel * 100) : null;
    const seconden = v ? Math.max(0, (nu - v.gestart) / 1000) : null;
    // De eerste stap die nog niet klaar is, is de lopende.
    const stappen = v
      ? [
          v.vensters.klaar >= v.vensters.totaal,
          v.curve.klaar >= v.curve.totaal,
          v.perfect,
          v.samenvoegen,
        ]
      : [false, false, false, false];
    const lopend = stappen.indexOf(false);
    return (
      <section className="wachtscherm" role="status" aria-live="polite">
        <div className="wachtscherm-kop">
          <h2>{eersteKeer ? "Je antwoord wordt berekend" : "Het antwoord wordt opnieuw berekend"}</h2>
          {seconden !== null ? (
            <span className="wachtscherm-tijd" aria-hidden="true">
              {seconden.toFixed(0)} s
            </span>
          ) : null}
        </div>
        <p className="wachtscherm-uitleg">
          {v
            ? `Elk profieljaar is een jaar aan kwartierdata, twee keer doorgerekend: zoals een slimme batterij het zou kunnen doen, en met perfecte kennis van morgen als ijkpunt. Dat verdeelt zich over ${
                v.vensters.totaal
              } ${v.vensters.totaal === 1 ? "jaar" : "jaren"} en een handvol workers; meestal is het binnen tien seconden klaar.`
            : "De gegevens worden geladen…"}
        </p>
        <div
          className={pct === null ? "voortgang onbepaald" : "voortgang"}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          aria-label="Voortgang van de doorrekening"
        >
          <div className="voortgang-balk" style={pct === null ? undefined : { width: `${Math.max(2, pct)}%` }} />
        </div>
        {v ? (
          <ol className="wacht-stappen">
            <Stap klaar={stappen[0]!} bezig={lopend === 0} teller={`${v.vensters.klaar} van ${v.vensters.totaal}`}>
              Profieljaren doorrekenen
            </Stap>
            <Stap klaar={stappen[1]!} bezig={lopend === 1} teller={`${v.curve.klaar} van ${v.curve.totaal}`}>
              Besparing bij slijtage meten
            </Stap>
            <Stap klaar={stappen[2]!} bezig={lopend === 2}>
              Perfecte voorspelling als ijkpunt
            </Stap>
            <Stap klaar={stappen[3]!} bezig={lopend === 3}>
              Samenvoegen tot het antwoord
            </Stap>
          </ol>
        ) : null}
      </section>
    );
  }

  if (verouderd) {
    return (
      <div className="herbereken-balk" role="status">
        <p>
          <b>Je invoer is gewijzigd.</b> Het antwoord op het scherm hoort nog bij je vorige
          invoer.
        </p>
        <button type="button" className="bereken-knop nadruk" onClick={onBereken}>
          Reken door
        </button>
      </div>
    );
  }

  return null;
}
