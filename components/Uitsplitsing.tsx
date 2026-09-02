"use client";

/**
 * Waar de besparing vandaan komt.
 *
 * Dit is de kern van het verhaal: zonder saldering verschuift de waarde van
 * terugleveren naar zelf verbruiken. Die verschuiving zichtbaar maken is
 * informatiever dan één totaalbedrag tonen.
 */

import type { SavingBreakdown } from "../lib/model/analysis";
import { euro, kwh } from "../lib/format";
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

  ];

  const zichtbaar = posten.filter((p) => Math.abs(p.waarde) > 0.5);
  const schaal = Math.max(
    ...zichtbaar.map((p) => Math.abs(p.waarde)),
    Math.abs(breakdown.totalEur),
    1,
  );

  // De titel volgt de uitkomst. Een vaste kop zou de balken eronder kunnen
  // tegenspreken zodra er weinig wordt teruggeleverd en de winst juist uit
  // prijsverschillen komt.
  const zelf = breakdown.selfConsumptionEur;
  const handel = breakdown.arbitrageEur;
  const titel =
    zelf > handel * 1.5
      ? "De winst zit vooral in zelf verbruiken, niet in slim handelen"
      : handel > zelf * 1.5
        ? "Bij jouw invoer verdient de batterij vooral aan prijsverschillen"
        : "Zelf verbruiken en slim handelen leveren ongeveer evenveel op";

  return (
    <Figure
      titel={titel}
      toelichting={
        <>
          Zonder saldering kost afnemen veel meer dan teruglevering opbrengt.
          Elke kilowattuur die je zelf gebruikt in plaats van teruglevert, is dat
          verschil waard. Bedragen over {periodeLabel}.
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
        <span>Samen bespaard</span>
        <strong>{euro(breakdown.totalEur)}</strong>
      </div>
      <p className="posten-noot">
        Bij het laden en ontladen ging {kwh(breakdown.conversionLossKwh)}{" "}
        verloren, goed voor ongeveer {euro(breakdown.conversionLossEur)}. Dat
        staat hierboven niet als aparte kostenpost, want het is er al vanaf: je
        bespaart minder afname dan je aan stroom opsloeg, en dat verschil ís het
        verlies. Zonder omzettingsverlies had de batterij dus zo'n{" "}
        {euro(breakdown.totalEur + breakdown.conversionLossEur)} opgeleverd.
      </p>
      <p className="posten-noot">
        Slijtage staat er evenmin tussen. Die is geen aparte kostenpost naast de
        aanschafprijs: het ís die prijs, verdeeld over de laadbeurten. Je vindt
        hem terug in de terugverdientijd, waar de hele aanschaf tegen deze
        besparing wordt afgezet.
      </p>
    </Figure>
  );
}
