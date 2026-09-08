"use client";

/**
 * Wat de batterij door het jaar heen doet.
 *
 * De jaarbesparing is één getal, en dat verbergt dat een thuisbatterij in juni
 * iets heel anders doet dan in december. In de zomer vangt hij zonoverschot af
 * dat anders voor een paar cent het net op was gegaan; in de winter leeft hij
 * van het verschil tussen een goedkope nacht en de avondpiek. Dat zijn twee
 * verdienmodellen in één apparaat, en of een accu bij jou past hangt ervan af
 * welke van de twee in jouw situatie het meeste oplevert.
 *
 * De zomergrens staat er expliciet in. Niet als versiering: het nieuwe
 * tijdsafhankelijke nettarief hanteert dezelfde grens (1 april tot 1 oktober),
 * en die twee helften gaan zich straks heel verschillend gedragen.
 */

import type { MonthTotals } from "../lib/model/analysis";
import { euro, getal } from "../lib/format";
import { Figure } from "./chart-parts";

const MAANDEN = [
  "jan", "feb", "mrt", "apr", "mei", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec",
];

/** April tot en met september; dezelfde grens als het nettarief vanaf 2029. */
function isZomer(maand: number): boolean {
  return maand >= 4 && maand <= 9;
}

const B = 860;
const HOOGTE = 190;
const LINKS = 52;
const RECHTS = 16;
const ONDER = 46;

export function MaandVerloop({ maanden }: { maanden: MonthTotals[] }) {
  if (maanden.length < 2) return null;

  const hoogste = Math.max(...maanden.map((m) => m.savingEur), 0.01);
  const laagste = Math.min(...maanden.map((m) => m.savingEur), 0);
  const span = hoogste - laagste;
  const y = (v: number) => (1 - (v - laagste) / span) * HOOGTE;
  const breedte = (B - LINKS - RECHTS) / maanden.length;
  const staaf = Math.min(46, breedte * 0.62);

  const zomer = maanden.filter((m) => isZomer(m.month));
  const winter = maanden.filter((m) => !isZomer(m.month));
  const som = (lijst: MonthTotals[]) => lijst.reduce((a, m) => a + m.savingEur, 0);
  const beste = maanden.reduce((a, m) => (m.savingEur > a.savingEur ? m : a), maanden[0]!);
  const slechtste = maanden.reduce((a, m) => (m.savingEur < a.savingEur ? m : a), maanden[0]!);

  return (
    <Figure
      titel={
        som(zomer) > som(winter)
          ? "De batterij verdient zijn geld in de zomer"
          : "De batterij verdient zijn geld in de winter"
      }
      toelichting={
        <>
          Besparing per maand, gemiddeld over de volledige jaren in de gekozen
          periode. De gearceerde helft is de zomer, van april tot en met
          september — dezelfde grens die het nieuwe nettarief vanaf 2029
          hanteert.
        </>
      }
    >
      <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${B} ${HOOGTE + ONDER}`}
        className="chart"
        role="img"
        aria-label={`Besparing per maand, van ${euro(slechtste.savingEur)} in ${
          MAANDEN[slechtste.month - 1]
        } tot ${euro(beste.savingEur)} in ${MAANDEN[beste.month - 1]}`}
      >
        {/* De zomerhelft als achtergrondvlak, zodat de grens één ding is en niet
            twaalf losjes gekleurde staven. */}
        {maanden.map((m, i) =>
          isZomer(m.month) ? (
            <rect
              key={`z${m.month}`}
              x={LINKS + i * breedte}
              y={0}
              width={breedte}
              height={HOOGTE}
              fill="var(--series-4)"
              opacity={0.07}
            />
          ) : null,
        )}

        <line x1={LINKS} x2={B - RECHTS} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
        <text x={LINKS - 10} y={y(0)} textAnchor="end" dominantBaseline="middle" className="as-label">
          € 0
        </text>
        <text x={LINKS - 10} y={y(hoogste)} textAnchor="end" dominantBaseline="middle" className="as-label">
          {euro(hoogste)}
        </text>

        {maanden.map((m, i) => {
          const cx = LINKS + i * breedte + breedte / 2;
          const top = Math.min(y(m.savingEur), y(0));
          const hoog = Math.abs(y(m.savingEur) - y(0));
          return (
            <g key={m.month}>
              <rect
                x={cx - staaf / 2}
                y={top}
                width={staaf}
                height={Math.max(hoog, 1)}
                rx={3}
                fill={m.savingEur >= 0 ? "var(--series-3)" : "var(--critical)"}
              />
              {/* Het bedrag staat er altijd bij: kleur en hoogte dragen nooit
                  alleen de betekenis. */}
              <text
                x={cx}
                y={m.savingEur >= 0 ? top - 6 : top + hoog + 14}
                textAnchor="middle"
                className="mark-label"
              >
                {getal(m.savingEur, 0)}
              </text>
              <text x={cx} y={HOOGTE + 18} textAnchor="middle" className="as-label">
                {MAANDEN[m.month - 1]}
              </text>
            </g>
          );
        })}
      </svg>
      </div>

      <dl className="kerncijfers">
        <div>
          <dt>Zomer, april tot oktober</dt>
          <dd>{euro(som(zomer))}</dd>
        </div>
        <div>
          <dt>Winter, oktober tot april</dt>
          <dd>{euro(som(winter))}</dd>
        </div>
        <div>
          <dt>Beste maand</dt>
          <dd>
            {euro(beste.savingEur)}
            <span className="dd-noot">
              {MAANDEN[beste.month - 1]}, {getal(beste.cycles, 0)} laadbeurten,
              prijsverschil {getal(beste.priceSpreadEurPerKwh * 100, 1)} ct/kWh per dag
            </span>
          </dd>
        </div>
        <div>
          <dt>Zwakste maand</dt>
          <dd>
            {euro(slechtste.savingEur)}
            <span className="dd-noot">
              {MAANDEN[slechtste.month - 1]}, {getal(slechtste.cycles, 0)} laadbeurten,
              prijsverschil {getal(slechtste.priceSpreadEurPerKwh * 100, 1)} ct/kWh per dag
            </span>
          </dd>
        </div>
      </dl>
    </Figure>
  );
}
