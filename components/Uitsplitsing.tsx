"use client";

/**
 * Waar de besparing vandaan komt.
 *
 * Dit is de kern van het verhaal: zonder saldering verschuift de waarde van
 * terugleveren naar zelf verbruiken. Die verschuiving zichtbaar maken is
 * informatiever dan één totaalbedrag tonen.
 */

import type { SavingBreakdown } from "../lib/model/analysis";
import { euro } from "../lib/format";
import { Figure } from "./chart-parts";

interface Post {
  label: string;
  uitleg: string;
  waarde: number;
  kleur: string;
}

export function Uitsplitsing({
  breakdown,
  periodeLabel,
}: {
  breakdown: SavingBreakdown;
  periodeLabel: string;
}) {
  const posten: Post[] = [
    {
      label: "Zelf verbruiken",
      uitleg:
        "Stroom die je opslaat in plaats van teruglevert, en later zelf gebruikt. " +
        "Je bespaart het verschil tussen wat afname kost en wat teruglevering opbrengt.",
      waarde: breakdown.selfConsumptionEur,
      kleur: "var(--series-1)",
    },
    {
      label: "Slim in- en verkopen",
      uitleg:
        "Laden als stroom goedkoop is en gebruiken als hij duur is, los van je eigen opwek.",
      waarde: breakdown.arbitrageEur,
      kleur: "var(--series-2)",
    },
    {
      label: "Negatieve prijzen ontlopen",
      uitleg:
        "Op sommige zonnige uren kost terugleveren geld. Wat je opslaat, hoef je niet weg te geven.",
      waarde: breakdown.avoidedNegativeExportEur,
      kleur: "var(--series-3)",
    },
    {
      label: "Verlies en slijtage",
      uitleg:
        "Een deel van de opgeslagen stroom gaat verloren bij het laden en ontladen, " +
        "en elke cyclus verbruikt een stukje levensduur.",
      waarde: breakdown.lossesEur,
      kleur: "var(--series-4)",
    },
  ];

  const zichtbaar = posten.filter((p) => Math.abs(p.waarde) > 0.5);
  const schaal = Math.max(
    ...zichtbaar.map((p) => Math.abs(p.waarde)),
    Math.abs(breakdown.totalEur),
    1,
  );

  return (
    <Figure
      titel="De winst zit vooral in zelf verbruiken, niet in slim handelen"
      toelichting={
        <>
          Zonder saldering is dit het hele verhaal: afnemen kost veel meer dan
          teruglevering opbrengt, dus elke kilowattuur die je zelf gebruikt in
          plaats van teruglevert, is het verschil waard. Bedragen over{" "}
          {periodeLabel}.
        </>
      }
    >
      <ul className="posten">
        {zichtbaar.map((p) => {
          const breedte = (Math.abs(p.waarde) / schaal) * 100;
          const negatief = p.waarde < 0;
          return (
            <li key={p.label} className="post">
              <div className="post-kop">
                <span className="post-label">
                  <span className="post-vlak" style={{ background: p.kleur }} />
                  {p.label}
                </span>
                <span className={negatief ? "post-waarde negatief" : "post-waarde"}>
                  {negatief ? "−" : "+"}
                  {euro(Math.abs(p.waarde))}
                </span>
              </div>
              <div className="post-balk">
                <span
                  className="post-vulling"
                  style={{ width: `${breedte}%`, background: p.kleur }}
                />
              </div>
              <p className="post-uitleg">{p.uitleg}</p>
            </li>
          );
        })}
      </ul>
      <div className="posten-totaal">
        <span>Samen</span>
        <strong>{euro(breakdown.totalEur)}</strong>
      </div>
    </Figure>
  );
}
