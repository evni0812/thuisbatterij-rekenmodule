"use client";

/**
 * Gedeelde bouwstenen voor de grafieken.
 *
 * Alle grafieken zijn inline SVG met dezelfde anatomie: recessieve
 * rasterlijnen, een duidelijke nullijn, dunne marks met 4px afgeronde uiteinden
 * aan de kant van de waarde, en een legenda zodra er meer dan één serie is.
 */

import type { ReactNode } from "react";

export const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
] as const;

export function Figure({
  titel,
  toelichting,
  children,
  actie,
}: {
  /** De titel noemt de conclusie, niet de asnamen. */
  titel: string;
  toelichting?: ReactNode;
  children: ReactNode;
  actie?: ReactNode;
}) {
  return (
    <figure className="figure">
      <div className="figure-kop">
        <div>
          <h3>{titel}</h3>
          {toelichting ? <p className="figure-uitleg">{toelichting}</p> : null}
        </div>
        {actie}
      </div>
      {children}
    </figure>
  );
}

export function Legenda({
  items,
}: {
  items: { kleur: string; label: string; waarde?: string }[];
}) {
  return (
    <ul className="legenda">
      {items.map((it) => (
        <li key={it.label}>
          <span className="legenda-vlak" style={{ background: it.kleur }} />
          <span className="legenda-label">{it.label}</span>
          {it.waarde ? <span className="legenda-waarde">{it.waarde}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Horizontale rasterlijnen plus de nullijn, in SVG-coördinaten. */
export function Raster({
  ticks,
  x0,
  x1,
  schaal,
  labelBreedte = 0,
  formatter,
}: {
  ticks: number[];
  x0: number;
  x1: number;
  schaal: (v: number) => number;
  labelBreedte?: number;
  formatter?: (v: number) => string;
}) {
  return (
    <g>
      {ticks.map((t) => {
        const y = schaal(t);
        const isNul = Math.abs(t) < 1e-9;
        return (
          <g key={t}>
            <line
              x1={x0}
              x2={x1}
              y1={y}
              y2={y}
              stroke={isNul ? "var(--axis)" : "var(--grid)"}
              strokeWidth={isNul ? 1.5 : 1}
            />
            {formatter && labelBreedte > 0 ? (
              <text
                x={x0 - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="as-label"
              >
                {formatter(t)}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Kies ronde tickwaarden binnen een bereik.
 * Altijd inclusief nul als het bereik daar doorheen loopt: dat is het ijkpunt.
 */
export function kiesTicks(min: number, max: number, aantal = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min || 0];
  }
  const ruw = (max - min) / aantal;
  const macht = Math.pow(10, Math.floor(Math.log10(Math.abs(ruw) || 1)));
  const genormaliseerd = ruw / macht;
  const stap =
    (genormaliseerd <= 1 ? 1 : genormaliseerd <= 2 ? 2 : genormaliseerd <= 5 ? 5 : 10) *
    macht;

  const ticks: number[] = [];
  const start = Math.ceil(min / stap) * stap;
  for (let t = start; t <= max + stap * 1e-6; t += stap) {
    ticks.push(Math.abs(t) < stap * 1e-6 ? 0 : t);
  }
  if (min < 0 && max > 0 && !ticks.some((t) => t === 0)) ticks.push(0);
  return ticks.sort((a, b) => a - b);
}

/**
 * Tooltip die binnen het kader blijft.
 * Volgt de muis maar wijkt uit bij de randen, zodat hij nooit half wegvalt.
 */
export function Tooltip({
  x,
  y,
  breedte,
  kaderBreedte,
  children,
}: {
  x: number;
  y: number;
  breedte: number;
  kaderBreedte: number;
  children: ReactNode;
}) {
  const links = Math.min(Math.max(8, x - breedte / 2), kaderBreedte - breedte - 8);
  return (
    <div
      className="tooltip"
      style={{ left: links, top: y, width: breedte }}
      role="status"
    >
      {children}
    </div>
  );
}
