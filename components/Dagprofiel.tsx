"use client";

/**
 * Een dag in detail: wat doet de batterij nu eigenlijk?
 *
 * Twee gestapelde vlakken maken het mechanisme zichtbaar: bovenin de prijs door
 * de dag heen, onderin de lading van de batterij tegen de netuitwisseling. Wie
 * beide naast elkaar ziet, snapt in één oogopslag dat de batterij vult als het
 * goedkoop is en leegt als het duur is.
 */

import { useState } from "react";
import type { SampleDay } from "../lib/model/analysis";
import { centPerKwh, datum, getal } from "../lib/format";
import { Figure, Legenda, kiesTicks } from "./chart-parts";

const B = 720;
const H_PRIJS = 90;
const H_ENERGIE = 130;
const MARGE = { boven: 12, rechts: 12, onder: 26, links: 46 };

function pad(punten: [number, number][]): string {
  return punten.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

export function Dagprofiel({ dagen }: { dagen: SampleDay[] }) {
  const [gekozen, setGekozen] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const dag = dagen[gekozen];
  if (!dag) return null;

  const n = dag.startMs.length;
  const plotB = B - MARGE.links - MARGE.rechts;
  const x = (i: number) => MARGE.links + (i / Math.max(1, n - 1)) * plotB;

  // Prijsvlak
  const prijzen = dag.importPrice;
  const pMin = Math.min(...prijzen, ...dag.exportPrice);
  const pMax = Math.max(...prijzen);
  const pTicks = kiesTicks(pMin, pMax, 3);
  const pLo = Math.min(...pTicks, pMin);
  const pHi = Math.max(...pTicks, pMax);
  const yP = (v: number) =>
    MARGE.boven + (1 - (v - pLo) / Math.max(1e-9, pHi - pLo)) * (H_PRIJS - MARGE.boven - 8);

  // Energievlak: lading als vlak, netuitwisseling als lijn rond nul.
  const cap = Math.max(dag.usableCapacityKwh, 0.001);
  const rMax = Math.max(...dag.residualKwh.map(Math.abs), 0.1);
  const eTop = MARGE.boven;
  const eBodem = H_ENERGIE - MARGE.onder;
  const ySoc = (v: number) => eBodem - (v / cap) * (eBodem - eTop);
  const yRes = (v: number) => (eTop + eBodem) / 2 - (v / rMax) * ((eBodem - eTop) / 2);

  const socPad =
    pad(dag.socKwh.map((v, i) => [x(i), ySoc(v)] as [number, number])) +
    ` L${x(n - 1)} ${eBodem} L${x(0)} ${eBodem} Z`;

  const actief = hover ?? null;

  return (
    <Figure
      titel="De batterij vult zich als stroom goedkoop is en leegt als hij duur is"
      toelichting={
        <>
          {dag.label.toLowerCase()} in deze periode, {datum(dag.date)}. Bovenin de
          prijs per uur, onderin de lading van de batterij en wat er met het net
          wordt uitgewisseld.
        </>
      }
      actie={
        dagen.length > 1 ? (
          <div className="segment" role="tablist" aria-label="Kies een dag">
            {dagen.map((d, i) => (
              <button
                key={d.label}
                role="tab"
                aria-selected={i === gekozen}
                className={i === gekozen ? "segment-knop actief" : "segment-knop"}
                onClick={() => setGekozen(i)}
              >
                {d.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${B} ${H_PRIJS + H_ENERGIE}`}
          className="chart"
          role="img"
          aria-label={`Prijsverloop en batterijgedrag op ${datum(dag.date)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const rel = ((e.clientX - rect.left) / rect.width) * B;
            const i = Math.round(((rel - MARGE.links) / plotB) * (n - 1));
            setHover(i >= 0 && i < n ? i : null);
          }}
        >
          {/* Prijs */}
          {pTicks.map((t) => (
            <g key={`p${t}`}>
              <line
                x1={MARGE.links}
                x2={B - MARGE.rechts}
                y1={yP(t)}
                y2={yP(t)}
                stroke={Math.abs(t) < 1e-9 ? "var(--axis)" : "var(--grid)"}
                strokeWidth={Math.abs(t) < 1e-9 ? 1.5 : 1}
              />
              <text x={MARGE.links - 8} y={yP(t)} textAnchor="end" dominantBaseline="middle" className="as-label">
                {centPerKwh(t)}
              </text>
            </g>
          ))}
          <path
            d={pad(prijzen.map((v, i) => [x(i), yP(v)] as [number, number]))}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d={pad(dag.exportPrice.map((v, i) => [x(i), yP(v)] as [number, number]))}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />

          {/* Energie */}
          <g transform={`translate(0 ${H_PRIJS})`}>
            <path d={socPad} fill="var(--series-3)" opacity={0.22} />
            <path
              d={pad(dag.socKwh.map((v, i) => [x(i), ySoc(v)] as [number, number]))}
              fill="none"
              stroke="var(--series-3)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <line
              x1={MARGE.links}
              x2={B - MARGE.rechts}
              y1={yRes(0)}
              y2={yRes(0)}
              stroke="var(--axis)"
              strokeWidth={1.5}
            />
            <path
              d={pad(dag.residualKwh.map((v, i) => [x(i), yRes(v)] as [number, number]))}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1.5}
            />
            <text x={MARGE.links - 8} y={ySoc(cap)} textAnchor="end" dominantBaseline="middle" className="as-label">
              vol
            </text>
            <text x={MARGE.links - 8} y={eBodem} textAnchor="end" dominantBaseline="middle" className="as-label">
              leeg
            </text>
          </g>

          {/* Uuraanduiding */}
          {[0, 6, 12, 18].map((u) => {
            const i = Math.round((u / 24) * (n - 1));
            return (
              <text key={u} x={x(i)} y={H_PRIJS + H_ENERGIE - 6} textAnchor="middle" className="as-label">
                {String(u).padStart(2, "0")}:00
              </text>
            );
          })}

          {actief !== null ? (
            <line
              x1={x(actief)}
              x2={x(actief)}
              y1={MARGE.boven}
              y2={H_PRIJS + H_ENERGIE - MARGE.onder}
              stroke="var(--text-muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ) : null}
        </svg>

        {actief !== null ? (
          <div className="dag-uitlezing">
            <span>
              {new Date(dag.startMs[actief]!).toLocaleTimeString("nl-NL", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Amsterdam",
              })}
            </span>
            <span>afname {centPerKwh(dag.importPrice[actief]!)}</span>
            <span>teruglevering {centPerKwh(dag.exportPrice[actief]!)}</span>
            <span>lading {getal(dag.socKwh[actief]!, 1)} kWh</span>
          </div>
        ) : null}
      </div>

      <Legenda
        items={[
          { kleur: "var(--series-1)", label: "prijs bij afname" },
          { kleur: "var(--series-2)", label: "opbrengst bij teruglevering" },
          { kleur: "var(--series-3)", label: "lading van de batterij" },
          { kleur: "var(--text-muted)", label: "uitwisseling met het net" },
        ]}
      />
    </Figure>
  );
}
