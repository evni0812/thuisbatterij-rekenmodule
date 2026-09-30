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
import type { Overgang } from "../lib/overgang";
import type { Configuration } from "../lib/worker/protocol";
import { centPerKwh, getal, jaren, procent } from "../lib/format";
import { strategieVoor } from "../lib/strategie";
import { Figure, Grafiek, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const B_STANDAARD = 720;
const H = 240;

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
  overgang = null,
  actie,
}: {
  finance: FinanceResult;
  stats: KeyStats;
  config: Configuration;
  /**
   * De looptijd met het nettarief vanaf 2029. Deze figuur rekent op het
   * huidige tarief; met het nettarief handelt de batterij vaker, en de
   * cashflow verderop telt dié beurten. Zonder deze vergelijking zei de ene
   * figuur "de beurten raken niet op" en de andere "na 15 jaar zijn ze op".
   */
  overgang?: Overgang | null;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis, breedte: gemeten } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const cf = finance.cashflows;
  if (cf.length === 0) return null;

  // De viewBox volgt het kader: op een telefoon past de grafiek zonder te
  // scrollen, met letters op ware grootte.
  const B = gemeten ?? B_STANDAARD;
  const smal = B < 560;
  const MARGE = { boven: 16, rechts: smal ? 10 : 16, onder: 34, links: smal ? 50 : 64 };

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
  // De cellenlabel staat boven de rode lijn, het kalenderlabel onderaan de
  // plot: bovenin raakten ze elkaar zodra de lijn tegen het plafond aan loopt.
  const yCellen = y(config.cycleLife) - 6;
  const yKalenderLabel = MARGE.boven + plotH - 8;
  const kleur = sterftAanBeurten ? "var(--series-2)" : "var(--series-3)";

  // Met het nettarief handelt de batterij vaker; zegt de cashflow daardoor dat
  // de beurten op raken, dan staat dat hier ook, met de grondslag erbij.
  const ov = overgang?.finance ?? null;
  const nettariefZin =
    ov && ov.totalCycles > finance.totalCycles + 0.5
      ? `Met het voorgestelde nettarief vanaf ${overgang!.ingangsjaar} laadt en levert de batterij vaker. Over ${ov.cashflows.length} jaar zijn dat ${getal(ov.totalCycles)} laadbeurten${
          ov.endOfLifeYear !== null && finance.endOfLifeYear === null
            ? `, en in jaar ${ov.endOfLifeYear} zijn de ${getal(config.cycleLife)} laadbeurten van de batterij op`
            : ""
        }. Dat telt de looptijd hieronder.`
      : null;

  const titel = sterftAanBeurten
    ? `Met ${getal(stats.cyclesPerYear, 0)} laadbeurten per jaar is de batterij na ${jaren(jarenTotOp)} aan vervanging toe, eerder door gebruik dan door leeftijd`
    : `Met ${getal(stats.cyclesPerYear, 0)} laadbeurten per jaar is de batterij eerder aan vervanging toe door leeftijd dan door gebruik`;

  return (
    <Figure
      anker="laadbeurten"
      actie={actie}
      titel={titel}
      toelichting={
        <>
          De lijn telt de laadbeurten op over de looptijd, met het huidige
          nettarief. De streep bij {getal(config.cycleLife)} laadbeurten is wat de
          batterij aankan. De streep bij {kalender} jaar is zijn levensduur in
          jaren. Wat de lijn het eerst raakt, bepaalt of de batterij aan zijn einde
          komt door gebruik of door leeftijd. De strategie-instelling bepaalt hoe steil de lijn loopt: hoe
          lager de drempel, hoe meer laadbeurten en hoe hoger de besparing per
          jaar, maar ook hoe eerder de batterij op is.
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
        label="Opgetelde laadbeurten over de looptijd tegenover de levensduur in laadbeurten"
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart chart-fluid"
          role="img"
          aria-label="Opgetelde laadbeurten over de looptijd tegenover de levensduur in laadbeurten"
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

          {/* De levensduur in laadbeurten: zoveel kan de batterij aan. */}
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
            y={yCellen}
            textAnchor="end"
            className="mark-label op-lijn"
            style={{ fill: "var(--critical)" }}
          >
            batterij op na {getal(config.cycleLife)} laadbeurten
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
              <text x={x(kalender) - 6} y={yKalenderLabel} textAnchor="end" className="mark-label op-lijn">
                levensduur van {kalender} jaar
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
              <text
                key={j}
                x={x(j)}
                y={H - 12}
                textAnchor={x(j) > B - MARGE.rechts - 20 ? "end" : "middle"}
                className="as-label"
              >
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
                          { label: "Laadbeurten dat jaar", waarde: getal(post.cyclesThisYear) },
                          { label: "Resterende capaciteit", waarde: procent(post.capacityFraction) },
                        ]
                      : []),
                  ],
                  noot:
                    finance.endOfLifeYear !== null && i === finance.endOfLifeYear
                      ? "In dit jaar zijn de laadbeurten op."
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
          <dt>Laadbeurten in {kalender} jaar</dt>
          <dd>
            {getal(inKalender)}
            <span className="dd-noot">
              van de {getal(config.cycleLife)} laadbeurten die de batterij aankan
            </span>
          </dd>
        </div>
        <div>
          <dt>Drempel van de aansturing</dt>
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
              als je stroom van het net haalt voor {centPerKwh(VOORBEELD_INKOOP)}: het
              omzettingsverlies plus de drempel. Onder dat verschil laat de
              aansturing de laadbeurt liggen
            </span>
          </dd>
        </div>
      </dl>

      <p className="posten-noot">
        {sterftAanBeurten ? (
          <>
            De laadbeurten zijn op voordat de batterij te oud is. Elke laadbeurt
            kost dan echt een stukje levensduur, en de volle slijtageprijs is de
            juiste drempel. Een lagere stand kan per jaar meer besparen, maar de
            laadbeurten zijn dan nog eerder op.
          </>
        ) : deel > 0.2 ? (
          <>
            De laadbeurten zijn niet op voordat de batterij te oud is. Een extra
            laadbeurt kost dan in werkelijkheid minder dan de volle slijtageprijs,
            want de batterij verliest toch al waarde door leeftijd. Een lagere
            stand van de strategie kan dan meer besparen, zolang de laadbeurten
            niet alsnog eerder op zijn dan de leeftijd. Kies een andere stand en
            reken opnieuw om het te zien.
          </>
        ) : (
          <>
            De laadbeurten zijn niet op voordat de batterij te oud is. De batterij
            gaat eerder door leeftijd achteruit dan door zijn laadbeurten.
          </>
        )}
        {nettariefZin ? <> {nettariefZin}</> : null}
      </p>
    </Figure>
  );
}
