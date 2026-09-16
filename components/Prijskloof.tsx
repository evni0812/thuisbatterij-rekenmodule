"use client";

/**
 * Waarom er iets te besparen valt.
 *
 * Zonder saldering betaal je voor afname het volle tarief inclusief
 * energiebelasting, maar krijg je voor teruglevering alleen de kale marktprijs.
 * Dat verschil is de hele businesscase, en het is groter dan de meeste mensen
 * denken — juist omdat je afneemt als het duur is en teruglevert als het
 * goedkoop is.
 *
 * Het gat zelf is gemarkeerd in de bovenste balk: het stuk dat de ene prijs
 * boven de andere uitsteekt, is precies wat een batterij per kilowattuur kan
 * verdienen. Zonder die markering moest je twee balklengtes van elkaar
 * aftrekken met je ogen.
 */

import type { ReactNode } from "react";
import type { PriceGap } from "../lib/model/analysis";
import { centPerKwh, kwh, procent } from "../lib/format";
import { Figure, TipLaag, useTip } from "./chart-parts";

export function Prijskloof({
  gap,
  afnameKwh,
  terugleveringKwh,
  actie,
}: {
  gap: PriceGap;
  afnameKwh: number;
  terugleveringKwh: number;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();

  const schaal = Math.max(gap.weightedImportPrice, gap.weightedExportPrice, 0.01);
  const impBreedte = (gap.weightedImportPrice / schaal) * 100;
  const expBreedte = (Math.max(0, gap.weightedExportPrice) / schaal) * 100;
  const verschil = gap.weightedImportPrice - gap.weightedExportPrice;

  return (
    <Figure
      actie={actie}
      titel="Je betaalt veel meer voor stroom dan je ervoor terugkrijgt"
      toelichting={
        <>
          Dit is waar de besparing vandaan komt: het gat waar een thuisbatterij in
          stapt. Beide bedragen zijn
          gewogen naar wanneer je werkelijk afneemt en teruglevert. Niet het
          gemiddelde over alle uren dus, want dat verhult juist het effect.
          Allebei inclusief btw: dat is wat er op je afrekening staat.
        </>
      }
    >
      <div className="chart-hover" ref={kader} onMouseLeave={wis}>
        <div className="kloof">
          <div
            className="kloof-rij"
            onMouseMove={(e) =>
              toon(e, {
                titel: "Wat je betaalt bij afname",
                regels: [
                  {
                    kleur: "var(--series-1)",
                    label: "Gewogen afnameprijs",
                    waarde: centPerKwh(gap.weightedImportPrice),
                  },
                  { label: "Je neemt per jaar af", waarde: kwh(afnameKwh) },
                  {
                    label: "Marktprijs, ongewogen",
                    waarde: centPerKwh(gap.simpleAveragePrice),
                  },
                ],
                noot: "Marktprijs plus energiebelasting en inkoopopslag, alles inclusief btw, gewogen naar de uren waarop je werkelijk afneemt.",
              })
            }
          >
            <div className="kloof-label">
              <span className="post-vlak" style={{ background: "var(--series-1)" }} />
              Wat je betaalt bij afname
            </div>
            <div className="kloof-balk">
              <span
                className="kloof-vulling"
                style={{ width: `${impBreedte}%`, background: "var(--series-1)" }}
              />
              {/* Het gat als vlak in de balk zelf: geen twee lengtes meer die je
                  van elkaar moet aftrekken. */}
              {verschil > 0 ? (
                <span
                  className="kloof-gat"
                  style={{
                    left: `${expBreedte}%`,
                    width: `${Math.max(0, impBreedte - expBreedte)}%`,
                  }}
                >
                  <b>{centPerKwh(verschil)} te winnen</b>
                </span>
              ) : null}
            </div>
            <strong className="kloof-waarde">
              {centPerKwh(gap.weightedImportPrice)}
            </strong>
          </div>

          <div
            className="kloof-rij"
            onMouseMove={(e) =>
              toon(e, {
                titel: "Wat je krijgt bij teruglevering",
                regels: [
                  {
                    kleur: "var(--series-2)",
                    label: "Gewogen terugleverprijs",
                    waarde: centPerKwh(gap.weightedExportPrice),
                  },
                  { label: "Je levert per jaar terug", waarde: kwh(terugleveringKwh) },
                  {
                    label: "Uren met een negatieve prijs",
                    waarde: procent(gap.negativePriceShare, 1),
                  },
                ],
                noot: "De kale marktprijs, inclusief btw maar zonder heffing, gewogen naar de zonnige uren waarop je teruglevert.",
              })
            }
          >
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
        <TipLaag tip={tip} />
      </div>

      <p className="kloof-conclusie">
        Elke kilowattuur die je zelf gebruikt in plaats van teruglevert, scheelt je
        dus <strong>{centPerKwh(verschil)}</strong>. Je levert{" "}
        {kwh(terugleveringKwh)} terug en neemt {kwh(afnameKwh)} af, dus daar valt
        wat te halen.
      </p>

      {gap.negativePriceShare > 0.005 ? (
        <p className="kloof-noot">
          In {procent(gap.negativePriceShare, 1)} van de tijd was de prijs
          negatief: terugleveren kostte dan geld in plaats van dat het iets
          opbracht. Daar viel {kwh(gap.exportAtNegativePriceKwh)} van jouw
          jaarlijkse teruglevering in. Veel meer dan dat tijdsaandeel doet vermoeden,
          want je levert nu eenmaal terug op precies de zonnige uren
          waarop iedereen dat doet en de prijs onderuit gaat.
        </p>
      ) : null}
    </Figure>
  );
}
