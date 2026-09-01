"use client";

/**
 * Waarom er iets te besparen valt.
 *
 * Zonder saldering betaal je voor afname het volle tarief inclusief
 * energiebelasting, maar krijg je voor teruglevering alleen de kale marktprijs.
 * Dat verschil is de hele businesscase, en het is groter dan de meeste mensen
 * denken — juist omdat je afneemt als het duur is en teruglevert als het
 * goedkoop is.
 */

import type { PriceGap } from "../lib/model/analysis";
import { centPerKwh, kwh, procent } from "../lib/format";
import { Figure } from "./chart-parts";

export function Prijskloof({
  gap,
  afnameKwh,
  terugleveringKwh,
}: {
  gap: PriceGap;
  afnameKwh: number;
  terugleveringKwh: number;
}) {
  const schaal = Math.max(gap.weightedImportPrice, gap.weightedExportPrice, 0.01);
  const impBreedte = (gap.weightedImportPrice / schaal) * 100;
  const expBreedte = (Math.max(0, gap.weightedExportPrice) / schaal) * 100;
  const verschil = gap.weightedImportPrice - gap.weightedExportPrice;

  return (
    <Figure
      titel="Je betaalt veel meer voor stroom dan je ervoor terugkrijgt"
      toelichting={
        <>
          Dit is het gat waar een thuisbatterij in stapt. Beide bedragen zijn
          gewogen naar wanneer je werkelijk afneemt en teruglevert — niet het
          gemiddelde over alle uren, want dat verhult juist het effect.
        </>
      }
    >
      <div className="kloof">
        <div className="kloof-rij">
          <div className="kloof-label">
            <span className="post-vlak" style={{ background: "var(--series-1)" }} />
            Wat je betaalt bij afname
          </div>
          <div className="kloof-balk">
            <span
              className="kloof-vulling"
              style={{ width: `${impBreedte}%`, background: "var(--series-1)" }}
            />
          </div>
          <strong className="kloof-waarde">
            {centPerKwh(gap.weightedImportPrice)}
          </strong>
        </div>

        <div className="kloof-rij">
          <div className="kloof-label">
            <span className="post-vlak" style={{ background: "var(--series-2)" }} />
            Wat je krijgt bij teruglevering
          </div>
          <div className="kloof-balk">
            <span
              className="kloof-vulling"
              style={{ width: `${expBreedte}%`, background: "var(--series-2)" }}
            />
          </div>
          <strong className="kloof-waarde">
            {centPerKwh(gap.weightedExportPrice)}
          </strong>
        </div>
      </div>

      <p className="kloof-conclusie">
        Elke kilowattuur die je zelf gebruikt in plaats van teruglevert, is dus{" "}
        <strong>{centPerKwh(verschil)}</strong> waard. Je levert{" "}
        {kwh(terugleveringKwh)} terug en neemt {kwh(afnameKwh)} af, dus daar valt
        wat te halen.
      </p>

      {gap.negativePriceShare > 0.005 ? (
        <p className="kloof-noot">
          In {procent(gap.negativePriceShare, 1)} van de tijd was de prijs
          negatief: terugleveren kostte dan geld in plaats van dat het iets
          opbracht. Daar viel {kwh(gap.exportAtNegativePriceKwh)} van jouw
          jaarlijkse teruglevering in — veel meer dan dat tijdsaandeel doet
          vermoeden, want je levert nu eenmaal terug op precies de zonnige uren
          waarop iedereen dat doet en de prijs onderuit gaat.
        </p>
      ) : null}
    </Figure>
  );
}
