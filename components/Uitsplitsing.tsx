"use client";

/**
 * Waar de besparing vandaan komt.
 *
 * Dit is de kern van het verhaal: zonder saldering verschuift de waarde van
 * terugleveren naar zelf verbruiken. Die verschuiving zichtbaar maken is
 * informatiever dan één totaalbedrag tonen.
 *
 * ── Waarom een waterval en geen balkenrij ───────────────────────────────────
 * Deze sectie stond eerder als drie horizontale balken onder de prijskloof, die
 * er precies zo uitzag. Twee grafieken met dezelfde vorm direct onder elkaar
 * lezen als één grafiek die zichzelf herhaalt, terwijl ze iets heel anders
 * zeggen: de prijskloof vergelijkt twee prijzen, dit telt posten op tot een
 * totaal. Een waterval toont die optelling als optelling — elke post is een
 * stap vanaf de vorige — en kan een negatieve post (een tegengevallen inkoop)
 * gewoon als stap omlaag laten zien, wat een balk vanaf nul niet kan.
 */

import { useState, type ReactNode } from "react";
import type { SavingBreakdown } from "../lib/model/analysis";
import { euro, euroAs, kwh } from "../lib/format";
import { AsLabel, Figure, Grafiek, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

interface Post {
  label: string;
  uitleg: string;
  waarde: number;
  kleur: string;
}

const B = 760;
const H = 250;
const MARGE = { boven: 26, rechts: 16, onder: 54, links: 62 };

export function Uitsplitsing({
  breakdown,
  periodeLabel,
  afregelen = false,
  actie,
}: {
  breakdown: SavingBreakdown;
  periodeLabel: string;
  /** Regelt de omvormer af bij een negatieve prijs? Standaard niet. */
  afregelen?: boolean;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);

  const posten: Post[] = [
    {
      label: "Zelf gebruiken",
      uitleg:
        "Stroom die je opslaat in plaats van teruglevert, en later zelf gebruikt. " +
        "Je bespaart het verschil tussen wat afname kost en wat je voor teruglevering krijgt.",
      waarde: breakdown.selfConsumptionEur,
      kleur: "var(--series-1)",
    },
    {
      label: "Slim laden en leveren",
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
      kleur: "var(--series-4)",
    },
  ];

  // "Negatieve prijzen ontlopen" is nul zodra de omvormer afregelt (de
  // standaard): teruglevering kost dan op die momenten niets, dus er valt niets
  // te ontlopen. Een staaf van € 0 zonder uitleg leest als een fout; de post
  // valt dan weg en de toelichting zegt waarom. De andere twee posten blijven
  // altijd staan.
  const negatiefNul = Math.abs(breakdown.avoidedNegativeExportEur) < 0.5;
  const zichtbaar = negatiefNul ? posten.slice(0, 2) : posten;
  const aantal = zichtbaar.length === 2 ? "twee" : "drie";

  // De stappen van de waterval: elke post begint waar de vorige eindigde.
  let loopt = 0;
  const stappen = zichtbaar.map((p) => {
    const van = loopt;
    loopt += p.waarde;
    return { post: p, van, tot: loopt };
  });

  const alleWaarden = [0, breakdown.totalEur, ...stappen.flatMap((s) => [s.van, s.tot])];
  const ticks = kiesTicks(Math.min(...alleWaarden), Math.max(...alleWaarden), 4);
  const lo = Math.min(...ticks, ...alleWaarden);
  const hi = Math.max(...ticks, ...alleWaarden);
  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;
  const y = (v: number) => MARGE.boven + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * plotH;

  const kolommen = zichtbaar.length + 1;
  const kolomB = plotB / kolommen;
  const staafB = Math.min(96, kolomB * 0.54);
  const midden = (i: number) => MARGE.links + kolomB * (i + 0.5);

  // De titel volgt de uitkomst. Een vaste kop zou de grafiek eronder kunnen
  // tegenspreken zodra er weinig wordt teruggeleverd en de besparing juist uit
  // prijsverschillen komt.
  const zelf = breakdown.selfConsumptionEur;
  const handel = breakdown.arbitrageEur;
  const titel =
    zelf > handel * 1.5
      ? "De besparing zit vooral in zelf gebruiken, niet in slim laden en leveren"
      : handel > zelf * 1.5
        ? "Bij jouw invoer komt de besparing vooral uit prijsverschillen"
        : "Zelf gebruiken en slim laden en leveren besparen ongeveer evenveel";

  const aandeel = (v: number) =>
    breakdown.totalEur !== 0
      ? `${Math.round((v / breakdown.totalEur) * 100)}% van het totaal`
      : "";

  return (
    <Figure
      anker="opbouw"
      actie={actie}
      titel={titel}
      toelichting={
        <>
          Zonder saldering kost afnemen veel meer dan teruglevering opbrengt.
          Elke kilowattuur die je zelf gebruikt in plaats van teruglevert, is dat
          verschil waard. De {aantal} posten stapelen op tot de besparing over{" "}
          {periodeLabel}.
          {negatiefNul
            ? afregelen
              ? " Negatieve prijzen ontlopen staat er niet bij: je omvormer regelt bij een negatieve prijs af, en dan kost teruglevering op die momenten al niets."
              : " Negatieve prijzen ontlopen staat er niet bij: bij deze invoer levert dat vrijwel niets op."
            : null}
        </>
      }
    >
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={wis}
        label={`De besparing over ${periodeLabel}, opgebouwd uit ${aantal} posten`}
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart"
          role="img"
          aria-label={`De besparing van ${euro(breakdown.totalEur)} over ${periodeLabel}, opgebouwd uit ${zichtbaar
            .map((p) => `${p.label} ${euro(p.waarde)}`)
            .join(", ")}`}
        >
          {aangewezen !== null ? (
            <rect
              className="aangewezen"
              x={MARGE.links + kolomB * aangewezen}
              y={MARGE.boven - 10}
              width={kolomB}
              height={plotH + 10}
            />
          ) : null}

          <Raster
            ticks={ticks}
            x0={MARGE.links}
            x1={B - MARGE.rechts}
            schaal={y}
            labelBreedte={MARGE.links}
            formatter={(v) => euroAs(v)}
          />

          {stappen.map((s, i) => {
            const boven = Math.min(y(s.van), y(s.tot));
            const hoog = Math.max(2, Math.abs(y(s.tot) - y(s.van)));
            const volgende = i + 1 < stappen.length ? midden(i + 1) : midden(kolommen - 1);
            return (
              <g key={s.post.label}>
                <rect
                  x={midden(i) - staafB / 2}
                  y={boven}
                  width={staafB}
                  height={hoog}
                  rx={3}
                  fill={s.post.kleur}
                />
                {/* De verbindingslijn maakt de optelling zichtbaar: waar de ene
                    post eindigt, begint de volgende. */}
                <line
                  x1={midden(i) + staafB / 2}
                  x2={volgende - staafB / 2}
                  y1={y(s.tot)}
                  y2={y(s.tot)}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text
                  x={midden(i)}
                  y={boven - 8}
                  textAnchor="middle"
                  className="mark-label"
                >
                  {s.post.waarde < 0 ? "−" : "+"}
                  {euro(Math.abs(s.post.waarde))}
                </text>
                <AsLabel x={midden(i)} y={MARGE.boven + plotH + 20} tekst={s.post.label} />
              </g>
            );
          })}

          {/* De totaalkolom staat op de grond, niet op de stapel: het is geen
              vierde post maar de som van de drie ervoor. */}
          <rect
            x={midden(kolommen - 1) - staafB / 2}
            y={Math.min(y(0), y(breakdown.totalEur))}
            width={staafB}
            height={Math.max(2, Math.abs(y(breakdown.totalEur) - y(0)))}
            rx={3}
            fill="var(--series-3)"
          />
          <text
            x={midden(kolommen - 1)}
            y={Math.min(y(0), y(breakdown.totalEur)) - 8}
            textAnchor="middle"
            className="mark-label"
          >
            {euro(breakdown.totalEur)}
          </text>
          <AsLabel
            x={midden(kolommen - 1)}
            y={MARGE.boven + plotH + 20}
            tekst="Samen bespaard"
          />

          {[...zichtbaar, null].map((p, i) => (
            <Trefvlak
              key={p ? p.label : "totaal"}
              x={MARGE.links + kolomB * i}
              y={MARGE.boven - 10}
              breedte={kolomB}
              hoogte={plotH + 10}
              onWijs={(punt) => {
                setAangewezen(i);
                toon(
                  punt,
                  p
                    ? {
                        titel: p.label,
                        regels: [
                          { kleur: p.kleur, label: "Besparing", waarde: euro(p.waarde) },
                          { label: "Aandeel", waarde: aandeel(p.waarde) },
                        ],
                        noot: p.uitleg,
                      }
                    : {
                        titel: `Samen bespaard over ${periodeLabel}`,
                        regels: [
                          ...zichtbaar.map((q) => ({
                            kleur: q.kleur,
                            label: q.label,
                            waarde: euro(q.waarde),
                          })),
                          {
                            kleur: "var(--series-3)",
                            label: "Totaal",
                            waarde: euro(breakdown.totalEur),
                            uitkomst: true,
                          },
                        ],
                        noot: `Het omzettingsverlies van ${kwh(
                          breakdown.conversionLossKwh,
                        )} zit al in de eerste post verwerkt.`,
                      },
                );
              }}
              onWis={() => {
                setAangewezen(null);
                wis();
              }}
            />
          ))}
        </svg>
      </Grafiek>

      <ul className="posten-legenda">
        {zichtbaar.map((p) => (
          <li key={p.label}>
            <span className="post-vlak" style={{ background: p.kleur }} />
            <span>
              <b>{p.label}</b>: {p.uitleg}
            </span>
          </li>
        ))}
      </ul>

      <p className="posten-noot">
        Bij het laden en ontladen ging {kwh(breakdown.conversionLossKwh)}{" "}
        verloren, goed voor ongeveer {euro(breakdown.conversionLossEur)}. Dat
        staat hierboven niet als aparte kostenpost, want het zit al in de
        besparing. Je haalt minder van het net dan je in de batterij stopte, en
        dat verschil is het verlies. Zonder omzettingsverlies had je dus zo'n{" "}
        {euro(breakdown.totalEur + breakdown.conversionLossEur)} bespaard.
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
