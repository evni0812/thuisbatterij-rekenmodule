"use client";

/**
 * Hoe de batterij zijn laadbeurten opmaakt, tegenover zijn twee levensduren.
 *
 * Een batterij gaat kapot aan het eerste van twee dingen: zijn beurten raken op
 * (cycluslevensduur) of hij wordt te oud (kalenderlevensduur). De lijn telt de
 * beurten op over de looptijd; de horizontale streep is het aantal dat de cel
 * aankan, de verticale het jaar waarin de kalender op is. Waar de lijn eerst
 * tegenaan loopt, daaraan sterft hij.
 *
 * Dat is precies de vraag achter de strategie-instelling: laat de lijn de
 * horizontale streep niet halen, dan kostte elke beurt in werkelijkheid minder
 * dan de volle slijtageprijs, en was een lagere drempel beter geweest.
 */

import { useState, type ReactNode } from "react";
import type { KeyStats } from "../lib/model/analysis";
import type { FinanceResult } from "../lib/model/finance";
import type { Configuration } from "../lib/worker/protocol";
import { centPerKwh, getal, jaren, procent } from "../lib/format";
import { strategieVoor } from "../lib/strategie";
import { Figure, Grafiek, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const B = 720;
const H = 240;
const MARGE = { boven: 16, rechts: 16, onder: 34, links: 64 };

/** Illustratieve inkoopprijs voor het minimale prijsverschil, EUR/kWh. */
export const VOORBEELD_INKOOP = 0.2;

/**
 * Wat een geleverde kWh minstens moet opbrengen boven de inkoopprijs.
 *
 * Om 1 kWh te leveren koop je 1/η² kWh in. De marge is dan
 * `verkoop − inkoop/η²`, en die moet boven de drempel van de planner liggen.
 */
export function minimaalPrijsverschil(
  inkoopEurPerKwh: number,
  efficiency: number,
  drempelEurPerKwh: number,
): number {
  const rondgang = efficiency * efficiency;
  return inkoopEurPerKwh / rondgang - inkoopEurPerKwh + drempelEurPerKwh;
}

export function Laadbeurten({
  finance,
  stats,
  config,
  actie,
}: {
  finance: FinanceResult;
  stats: KeyStats;
  config: Configuration;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const cf = finance.cashflows;
  if (cf.length === 0) return null;

  const deel = config.wearFraction ?? 1;
  const drempel = stats.wearCostEurPerKwh * deel;
  const strategie = strategieVoor(deel);
  const kalender = config.calendarLifeYears;
  const inKalender = stats.cyclesPerYear * kalender;
  const jarenTotOp = stats.cyclesPerYear > 0 ? config.cycleLife / stats.cyclesPerYear : Infinity;
  const sterftAanBeurten = jarenTotOp < kalender;

  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;

  const waarden = [0, ...cf.map((c) => c.cumulativeCycles)];
  const max = Math.max(config.cycleLife * 1.05, ...waarden);
  const ticks = kiesTicks(0, max, 5);
  const hi = Math.max(...ticks, max);
  const y = (v: number) => MARGE.boven + (1 - v / hi) * plotH;
  const x = (j: number) => MARGE.links + (j / cf.length) * plotB;

  const punten = waarden.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`).join(" ");
  const kleur = sterftAanBeurten ? "var(--series-2)" : "var(--series-3)";

  const titel = sterftAanBeurten
    ? `Met ${getal(stats.cyclesPerYear, 0)} beurten per jaar zijn de cellen na ${jaren(jarenTotOp)} op, eerder dan de kalender`
    : `Met ${getal(stats.cyclesPerYear, 0)} beurten per jaar sterft de batterij aan zijn leeftijd, niet aan zijn beurten`;

  return (
    <Figure
      actie={actie}
      titel={titel}
      toelichting={
        <>
          De lijn telt de laadbeurten op over de looptijd. De streep bij{" "}
          {getal(config.cycleLife)} is wat de cellen aankunnen; de streep bij{" "}
          {kalender} jaar is de kalenderlevensduur. Waar de lijn het eerst
          tegenaan loopt, daaraan gaat de batterij kapot. De strategie-instelling
          bepaalt hoe steil de lijn loopt: hoe lager de drempel, hoe meer beurten
          en hoe hoger de jaaropbrengst, maar ook hoe eerder de cellen op zijn.
        </>
      }
    >
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setAangewezen(null);
          wis();
        }}
        label="Opgetelde laadbeurten over de looptijd tegenover de cycluslevensduur"
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart"
          role="img"
          aria-label="Opgetelde laadbeurten over de looptijd tegenover de cycluslevensduur"
        >
          {aangewezen !== null ? (
            <rect
              className="aangewezen"
              x={x(aangewezen) - plotB / cf.length / 2}
              y={MARGE.boven}
              width={plotB / cf.length}
              height={plotH}
            />
          ) : null}

          <Raster
            ticks={ticks}
            x0={MARGE.links}
            x1={B - MARGE.rechts}
            schaal={y}
            labelBreedte={MARGE.links}
            formatter={(v) => getal(v)}
          />

          {/* De cycluslevensduur: zoveel beurten kunnen de cellen aan. */}
          <line
            x1={MARGE.links}
            x2={B - MARGE.rechts}
            y1={y(config.cycleLife)}
            y2={y(config.cycleLife)}
            stroke="var(--critical)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text
            x={B - MARGE.rechts - 4}
            y={y(config.cycleLife) - 6}
            textAnchor="end"
            className="mark-label"
            fill="var(--critical)"
          >
            cellen op na {getal(config.cycleLife)} beurten
          </text>

          {/* De kalenderlevensduur, als hij binnen de looptijd valt. */}
          {kalender <= cf.length ? (
            <g>
              <line
                x1={x(kalender)}
                x2={x(kalender)}
                y1={MARGE.boven}
                y2={MARGE.boven + plotH}
                stroke="var(--axis)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <text x={x(kalender) - 6} y={MARGE.boven + 12} textAnchor="end" className="mark-label">
                kalender op na {kalender} jaar
              </text>
            </g>
          ) : null}

          <path
            d={`${punten} L${x(cf.length)} ${y(0)} L${x(0)} ${y(0)} Z`}
            fill={kleur}
            opacity={0.12}
          />
          <path
            d={punten}
            fill="none"
            stroke={kleur}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {[0, 5, 10, 15, 20, 25]
            .filter((j) => j <= cf.length)
            .map((j) => (
              <text key={j} x={x(j)} y={H - 12} textAnchor="middle" className="as-label">
                {j === 0 ? "nu" : `${j} jaar`}
              </text>
            ))}

          {aangewezen !== null ? (
            <circle
              cx={x(aangewezen)}
              cy={y(waarden[aangewezen]!)}
              r={4}
              fill={kleur}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          ) : null}
          {waarden.map((v, i) => (
            <Trefvlak
              key={`t${i}`}
              x={x(i) - plotB / cf.length / 2}
              y={MARGE.boven}
              breedte={plotB / cf.length}
              hoogte={plotH}
              onWijs={(punt) => {
                setAangewezen(i);
                const post = i > 0 ? cf[i - 1] : null;
                toon(punt, {
                  titel: i === 0 ? "Bij aanschaf" : `Na ${jaren(i)}`,
                  regels: [
                    {
                      kleur,
                      label: "Laadbeurten opgeteld",
                      waarde: `${getal(v)} van ${getal(config.cycleLife)}`,
                      uitkomst: true,
                    },
                    ...(post
                      ? [
                          { label: "Beurten dat jaar", waarde: getal(post.cyclesThisYear) },
                          { label: "Resterende capaciteit", waarde: procent(post.capacityFraction) },
                        ]
                      : []),
                  ],
                  noot:
                    finance.endOfLifeYear !== null && i === finance.endOfLifeYear
                      ? "In dit jaar zijn de beurten op."
                      : undefined,
                });
              }}
              onWis={() => {
                setAangewezen(null);
                wis();
              }}
            />
          ))}
        </svg>
      </Grafiek>

      <dl className="kerncijfers">
        <div>
          <dt>Laadbeurten per jaar</dt>
          <dd>{getal(stats.cyclesPerYear, 0)}</dd>
        </div>
        <div>
          <dt>In de kalenderlevensduur</dt>
          <dd>
            {getal(inKalender)}
            <span className="dd-noot">
              van de {getal(config.cycleLife)} beurten die de cellen aankunnen, in{" "}
              {kalender} jaar
            </span>
          </dd>
        </div>
        <div>
          <dt>Drempel van de planner</dt>
          <dd>
            {centPerKwh(drempel)}
            <span className="dd-noot">
              {strategie ? strategie.naam.toLowerCase() : "eigen stand"}: {procent(deel)} van de
              slijtageprijs van {centPerKwh(stats.wearCostEurPerKwh)} per geleverde kWh
            </span>
          </dd>
        </div>
        <div>
          <dt>Minimaal prijsverschil</dt>
          <dd>
            {centPerKwh(minimaalPrijsverschil(VOORBEELD_INKOOP, config.battery.efficiency, drempel))}
            <span className="dd-noot">
              bij inkoop tegen {centPerKwh(VOORBEELD_INKOOP)}: omzettingsverlies plus drempel.
              Onder dat verschil laat de planner de beurt liggen
            </span>
          </dd>
        </div>
      </dl>

      <p className="posten-noot">
        {sterftAanBeurten ? (
          <>
            De beurten raken op vóór de kalender. Elke beurt kost dan echt een
            stukje levensduur, en de volle slijtageprijs is de juiste drempel.
            Een lagere stand levert per jaar meer op, maar de batterij is eerder
            aan vervanging toe.
          </>
        ) : (
          <>
            De beurten raken niet op vóór de kalender. Een extra beurt kost dan
            in werkelijkheid minder dan de volle slijtageprijs, want de batterij
            was toch al afgeschreven op leeftijd. Een lagere stand van de
            strategie levert dan meer op zonder dat hij eerder aan vervanging toe
            is; de terugverdientijd onder de cashflow laat zien hoeveel.
          </>
        )}
      </p>
    </Figure>
  );
}
