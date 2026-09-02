"use client";

/**
 * Besparing per profieljaar — de kernvraag: hoe gevoelig is de uitkomst voor
 * welk jaar je pakt?
 *
 * Twee marks per jaar: wat de batterij werkelijk haalt, en wat er bij perfecte
 * kennis in had gezeten. Het verschil is zelf een resultaat.
 */

import { useState } from "react";
import type { YearAnalysis } from "../lib/model/analysis";
import { euro, periode } from "../lib/format";
import { Figure, Legenda, Raster, kiesTicks } from "./chart-parts";

const H = 260;
const MARGE = { boven: 16, rechts: 16, onder: 40, links: 56 };

export function BesparingPerJaar({ jaren }: { jaren: YearAnalysis[] }) {
  const [actief, setActief] = useState<number | null>(null);
  if (jaren.length === 0) return null;

  const breedte = Math.max(320, jaren.length * 130);
  const plotB = breedte - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;

  const max = Math.max(...jaren.map((j) => j.optimalSavingEur), 1);
  const ticks = kiesTicks(0, max, 4);
  const bovengrens = Math.max(...ticks, max);
  const y = (v: number) => MARGE.boven + plotH - (v / bovengrens) * plotH;

  const groepB = plotB / jaren.length;
  const staafB = Math.min(38, groepB * 0.3);

  return (
    <Figure
      titel="In elk jaar levert de batterij iets op, maar niet evenveel"
      toelichting={
        <>
          Hoeveel een batterij oplevert hangt af van hoe grillig de prijzen dat
          jaar waren. De lichte staaf laat zien wat er met perfecte kennis
          vooraf in had gezeten.
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
          viewBox={`0 0 ${breedte} ${H}`}
          className="chart"
          role="img"
          aria-label="Besparing per profieljaar, werkelijk haalbaar naast het theoretisch maximum"
        >
          <Raster
            ticks={ticks}
            x0={MARGE.links}
            x1={breedte - MARGE.rechts}
            schaal={y}
            labelBreedte={MARGE.links}
            formatter={(v) => euro(v)}
          />

          {jaren.map((j, i) => {
            const midden = MARGE.links + groepB * (i + 0.5);
            const xReal = midden - staafB - 1;
            const xOpt = midden + 1;
            const hReal = Math.max(0, plotH - (y(j.realisticSavingEur) - MARGE.boven));
            const hOpt = Math.max(0, plotH - (y(j.optimalSavingEur) - MARGE.boven));
            const isActief = actief === i;

            return (
              <g
                key={j.year}
                onMouseEnter={() => setActief(i)}
                onMouseLeave={() => setActief(null)}
              >
                {/* Ruime trefzone: groter dan de marks zelf. */}
                <rect
                  x={MARGE.links + groepB * i}
                  y={MARGE.boven}
                  width={groepB}
                  height={plotH}
                  fill={isActief ? "var(--surface-2)" : "transparent"}
                />
                <rect
                  x={xOpt}
                  y={y(j.optimalSavingEur)}
                  width={staafB}
                  height={hOpt}
                  rx={4}
                  fill="var(--series-3)"
                  opacity={0.35}
                />
                <rect
                  x={xReal}
                  y={y(j.realisticSavingEur)}
                  width={staafB}
                  height={hReal}
                  rx={4}
                  fill="var(--series-3)"
                />
                {/* Directe waarde bij de staaf: kleur draagt nooit alleen. */}
                <text
                  x={xReal + staafB / 2}
                  y={y(j.realisticSavingEur) - 6}
                  textAnchor="middle"
                  className="mark-label"
                >
                  {euro(j.realisticSavingEur)}
                </text>
                <text
                  x={midden}
                  y={H - 22}
                  textAnchor="middle"
                  className="as-label"
                >
                  {periode(j.firstDay, j.lastDay)}
                </text>
                {!j.isFullYear ? (
                  <text
                    x={midden}
                    y={H - 8}
                    textAnchor="middle"
                    className="as-label zwak"
                  >
                    deel van het jaar
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <Legenda
        items={[
          { kleur: "var(--series-3)", label: "wat de batterij werkelijk haalt" },
          {
            kleur: "color-mix(in srgb, var(--series-3) 35%, transparent)",
            label: "maximaal haalbaar met perfecte kennis vooraf",
          },
        ]}
      />
    </Figure>
  );
}
