"use client";

/**
 * De businesscase over de levensduur.
 *
 * Eén lijn: wat je tot dan toe hebt terugverdiend. Begint diep negatief (de
 * aanschaf) en kruist de nullijn op het break-evenpunt — of niet, en dat is dan
 * óók het antwoord.
 */

import type { FinanceResult } from "../lib/model/finance";
import { euro, jaren, procent } from "../lib/format";
import { Figure, Raster, kiesTicks } from "./chart-parts";

const B = 720;
const H = 240;
const MARGE = { boven: 16, rechts: 16, onder: 34, links: 64 };

export function Cashflow({
  finance,
  investeringEur,
}: {
  finance: FinanceResult;
  investeringEur: number;
}) {
  const cf = finance.cashflows;
  if (cf.length === 0) return null;

  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;

  const waarden = [-investeringEur, ...cf.map((c) => c.cumulativeNominalEur)];
  const min = Math.min(...waarden);
  const max = Math.max(...waarden, 0);
  const ticks = kiesTicks(min, max, 5);
  const lo = Math.min(...ticks, min);
  const hi = Math.max(...ticks, max);
  const y = (v: number) => MARGE.boven + (1 - (v - lo) / (hi - lo)) * plotH;
  const x = (j: number) => MARGE.links + (j / cf.length) * plotB;

  const punten = waarden
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`)
    .join(" ");

  const breakEven = finance.paybackYears;
  const positief = finance.npvEur >= 0;
  // Drie gevallen, niet twee. De lijn tekent nominale euro's en kan door nul
  // gaan terwijl de contante waarde negatief blijft; met twee titels zou de kop
  // dan zeggen dat hij zich niet terugverdient terwijl de grafiek eronder een
  // break-evenpunt markeert.
  const titel = positief
    ? "Over de looptijd levert de batterij meer op dan hij kost"
    : breakEven !== null
      ? "Je krijgt je geld terug, maar niet de rente die je erop misloopt"
      : "Over de looptijd verdient de batterij zichzelf niet terug";

  return (
    <Figure
      titel={titel}
      toelichting={
        <>
          Wat je tot dat moment in totaal hebt terugverdiend, met de aanschafprijs
          als startpunt. De lijn telt de euro's zoals je ze krijgt. De contante
          waarde hieronder trekt daar de rente vanaf die je op dat geld had kunnen
          maken. De besparing loopt terug naarmate de batterij slijt.
        </>
      }
    >
      <div
        className="chart-wrap"
        tabIndex={0}
        role="group"
        aria-label="Grafiek, horizontaal scrollbaar"
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart"
          role="img"
          aria-label="Cumulatief terugverdiend bedrag over de analyseperiode"
        >
          <Raster
            ticks={ticks}
            x0={MARGE.links}
            x1={B - MARGE.rechts}
            schaal={y}
            labelBreedte={MARGE.links}
            formatter={(v) => euro(v)}
          />

          {/* Het gebied onder nul is nog niet terugverdiend. */}
          <path
            d={`${punten} L${x(cf.length)} ${y(0)} L${x(0)} ${y(0)} Z`}
            fill={positief ? "var(--series-3)" : "var(--critical)"}
            opacity={0.12}
          />
          <path
            d={punten}
            fill="none"
            stroke={positief ? "var(--series-3)" : "var(--critical)"}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {breakEven !== null && breakEven <= cf.length ? (
            <g>
              <line
                x1={x(breakEven)}
                x2={x(breakEven)}
                y1={MARGE.boven}
                y2={MARGE.boven + plotH}
                stroke="var(--good)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <text
                x={x(breakEven) + 6}
                y={MARGE.boven + 12}
                className="mark-label"
                fill="var(--success-text)"
              >
                terugverdiend na {jaren(breakEven)}
              </text>
            </g>
          ) : null}

          {[0, 5, 10, 15, 20, 25].
            filter((j) => j <= cf.length).
            map((j) => (
              <text key={j} x={x(j)} y={H - 12} textAnchor="middle" className="as-label">
                {j === 0 ? "nu" : `${j} jaar`}
              </text>
            ))}
        </svg>
      </div>

      <dl className="kerncijfers">
        <div>
          <dt>Terugverdientijd</dt>
          <dd>{jaren(finance.paybackYears)}</dd>
        </div>
        <div>
          <dt>
            Contante waarde
            <span className="hint" title="De waarde van alle toekomstige besparingen, teruggerekend naar vandaag, minus de aanschafprijs.">?</span>
          </dt>
          <dd className={finance.npvEur >= 0 ? "goed" : "slecht"}>
            {euro(finance.npvEur)}
          </dd>
        </div>
        <div>
          <dt>
            Rendement
            <span className="hint" title="Wat de batterij per jaar opbrengt, uitgedrukt als rentepercentage. Ligt dat onder wat je op een spaarrekening krijgt, dan was je geld daar beter af.">?</span>
          </dt>
          <dd>{finance.irr === null ? "—" : procent(finance.irr, 1)}</dd>
        </div>
        <div>
          <dt>Laadbeurten in totaal</dt>
          <dd>
            {Math.round(finance.totalCycles)}
            {finance.endOfLifeYear !== null ? (
              <span className="dd-noot">
                na {finance.endOfLifeYear} jaar zijn de beloofde laadbeurten op; daarna
                rekenen we door met een batterij die verder slijt
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </Figure>
  );
}
