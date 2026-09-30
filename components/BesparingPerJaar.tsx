"use client";

/**
 * Besparing per jaar, de kernvraag: hoe gevoelig is de uitkomst voor welk jaar
 * je pakt?
 *
 * Twee marks per jaar: wat de batterij haalt, en het ideale geval met perfecte
 * kennis van morgen. Het verschil is zelf een resultaat.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import type { YearAnalysis } from "../lib/model/analysis";
import { euro, euroAs, getal, periode, procent } from "../lib/format";
import { Figure, Grafiek, Legenda, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const H = 260;

/** "apr tot dec" voor een deeljaar binnen één kalenderjaar; anders null. */
function kortDeel(j: YearAnalysis): { deel: string; jaar: string } | null {
  const [y1, m1] = j.firstDay.split("-").map(Number);
  const [y2, m2] = j.lastDay.split("-").map(Number);
  if (!y1 || !m1 || !y2 || !m2 || y1 !== y2) return null;
  const kort = (m: number) => MAANDEN_KORT[m - 1] ?? "";
  return { deel: `${kort(m1)} tot ${kort(m2)}`, jaar: String(y1) };
}
const MAANDEN_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

export function BesparingPerJaar({ jaren, actie }: { jaren: YearAnalysis[]; actie?: ReactNode }) {
  const [actief, setActief] = useState<number | null>(null);
  const { kader, tip, toon, wis, breedte: gemeten } = useTip();
  if (jaren.length === 0) return null;

  // De viewBox is zo breed als het kader, dus de letters zijn op elk scherm
  // even groot en op een telefoon past alles zonder zijwaarts te scrollen.
  const breedte = gemeten ?? Math.max(320, jaren.length * 130);
  const smal = breedte < 560;
  const MARGE = { boven: 16, rechts: smal ? 8 : 16, onder: smal ? 44 : 40, links: smal ? 46 : 56 };
  const plotB = breedte - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;

  const max = Math.max(...jaren.map((j) => j.optimalSavingEur), 1);
  const ticks = kiesTicks(0, max, 4);
  const bovengrens = Math.max(...ticks, max);
  const y = (v: number) => MARGE.boven + plotH - (v / bovengrens) * plotH;

  const groepB = plotB / jaren.length;
  const staafB = Math.min(48, groepB * (smal ? 0.34 : 0.3));

  return (
    <Figure
      anker="per-jaar"
      actie={actie}
      titel={
        jaren.every((j) => j.realisticSavingEur > 0)
          ? "Elk jaar bespaart de batterij iets, maar niet evenveel"
          : "Van jaar tot jaar verschilt wat de batterij bespaart"
      }
      toelichting={
        <>
          Hoeveel een batterij bespaart hangt af van hoe grillig de prijzen dat
          jaar waren. De lichte staaf is het ideale geval: wat er te besparen viel
          met perfecte kennis van morgen.
        </>
      }
    >
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setActief(null);
          wis();
        }}
        label="Besparing per jaar"
      >
        <svg
          viewBox={`0 0 ${breedte} ${H}`}
          className="chart chart-fluid"
          role="img"
          aria-label="Besparing per jaar, wat de batterij haalt naast het ideale geval met perfecte kennis van morgen"
        >
          <Raster
            ticks={ticks}
            x0={MARGE.links}
            x1={breedte - MARGE.rechts}
            schaal={y}
            labelBreedte={MARGE.links}
            formatter={(v) => euroAs(v)}
          />

          {jaren.map((j, i) => {
            const midden = MARGE.links + groepB * (i + 0.5);
            const xReal = midden - staafB - 1;
            const xOpt = midden + 1;
            const hReal = Math.max(0, plotH - (y(j.realisticSavingEur) - MARGE.boven));
            const hOpt = Math.max(0, plotH - (y(j.optimalSavingEur) - MARGE.boven));
            const isActief = actief === i;

            return (
              <g key={j.year}>
                {/* De markering van wat je aanwijst, achter de marks. */}
                {isActief ? (
                  <rect
                    className="aangewezen"
                    x={MARGE.links + groepB * i}
                    y={MARGE.boven}
                    width={groepB}
                    height={plotH}
                  />
                ) : null}
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
                {smal ? (
                  (() => {
                    const kort = j.isFullYear ? null : kortDeel(j);
                    return kort ? (
                      <text x={midden} y={H - 26} textAnchor="middle" className="as-label">
                        <tspan x={midden}>{kort.deel}</tspan>
                        <tspan x={midden} dy={15}>{kort.jaar}</tspan>
                      </text>
                    ) : (
                      <text x={midden} y={H - 22} textAnchor="middle" className="as-label">
                        {periode(j.firstDay, j.lastDay)}
                      </text>
                    );
                  })()
                ) : (
                  <>
                    <text x={midden} y={H - 22} textAnchor="middle" className="as-label">
                      {periode(j.firstDay, j.lastDay)}
                    </text>
                    {!j.isFullYear ? (
                      <text x={midden} y={H - 8} textAnchor="middle" className="as-label zwak">
                        deel van het jaar
                      </text>
                    ) : null}
                  </>
                )}
              </g>
            );
          })}

          {/* De trefvlakken bovenop: een hele jaarkolom is te raken. */}
          {jaren.map((j, i) => (
            <Trefvlak
              key={`t${j.year}`}
              x={MARGE.links + groepB * i}
              y={MARGE.boven}
              breedte={groepB}
              hoogte={plotH}
              onWijs={(punt) => {
                setActief(i);
                toon(punt, {
                  titel: periode(j.firstDay, j.lastDay),
                  regels: [
                    {
                      kleur: "var(--series-3)",
                      label: "Wat de batterij haalt",
                      waarde: euro(j.realisticSavingEur),
                      uitkomst: true,
                    },
                    {
                      kleur: "color-mix(in srgb, var(--series-3) 35%, transparent)",
                      label: "Ideaal geval (perfecte kennis van morgen)",
                      waarde: euro(j.optimalSavingEur),
                    },
                    { label: "Deel van het ideale geval", waarde: procent(j.captureRate) },
                    { label: "Laadbeurten", waarde: getal(j.cyclesPerYear, 0) },
                  ],
                  noot: j.isFullYear
                    ? undefined
                    : "Deel van een jaar: telt niet mee in het gemiddelde.",
                });
              }}
              onWis={() => {
                setActief(null);
                wis();
              }}
            />
          ))}
        </svg>
      </Grafiek>

      <Legenda
        items={[
          { kleur: "var(--series-3)", label: "wat de batterij haalt" },
          {
            kleur: "color-mix(in srgb, var(--series-3) 35%, transparent)",
            label: "ideaal geval (perfecte kennis van morgen)",
          },
        ]}
      />
    </Figure>
  );
}
