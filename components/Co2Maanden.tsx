"use client";

/**
 * De CO2-winst door het jaar heen.
 *
 * Dezelfde twee verdienmodellen als bij de euro's, maar met een ander gewicht:
 * in de zomer bewaart de batterij zonnestroom die anders 's avonds door gas
 * vervangen werd, in de winter verschuift hij afname van de avondpiek naar de
 * nacht, en die nacht is lang niet altijd schoner. De winst zit dus vooral in
 * de zomer, meer nog dan de euro's.
 */

import { useState, type ReactNode } from "react";
import type { Co2Jaar } from "../lib/model/co2";
import { getal } from "../lib/format";
import { Figure, Grafiek, Trefvlak, useTip } from "./chart-parts";
import { kg } from "./Co2Antwoord";

const MAANDEN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const VOLUIT = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

function isZomer(maand: number): boolean {
  return maand >= 4 && maand <= 9;
}

const B = 860;
const HOOGTE = 170;
const LINKS = 52;
const RECHTS = 16;
const ONDER = 46;
const BOVEN = 24;

export function Co2Maanden({ co2, actie }: { co2: Co2Jaar; actie?: ReactNode }) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const maanden = co2.perMaand.map((m) => ({ ...m, winstKg: m.importBasisKg - m.importBatKg }));
  if (maanden.length < 2) return null;

  const hoogste = Math.max(...maanden.map((m) => m.winstKg), 0.1);
  const laagste = Math.min(...maanden.map((m) => m.winstKg), 0);
  const span = hoogste - laagste;
  const y = (v: number) => BOVEN + (1 - (v - laagste) / span) * HOOGTE;
  const breedte = (B - LINKS - RECHTS) / maanden.length;
  const staaf = Math.min(46, breedte * 0.62);

  const som = (lijst: typeof maanden) => lijst.reduce((a, m) => a + m.winstKg, 0);
  const zomer = som(maanden.filter((m) => isZomer(m.month)));
  const winter = som(maanden.filter((m) => !isZomer(m.month)));
  const beste = maanden.reduce((a, m) => (m.winstKg > a.winstKg ? m : a), maanden[0]!);

  return (
    <Figure
      actie={actie}
      titel={
        zomer > winter
          ? `De CO2-winst zit in de zomer: ${kg(zomer)} tegen ${kg(winter)} in de winter`
          : `De CO2-winst zit in de winter: ${kg(winter)} tegen ${kg(zomer)} in de zomer`
      }
      toelichting={
        <>
          Hoeveel minder CO2 je netafname per maand kost met batterij, gemiddeld over de volledige
          jaren. De gearceerde helft is de zomer, april tot en met september. In de zomer vervangt
          bewaarde zonnestroom de avondafname; in de winter verschuift de batterij afname naar de
          nacht, en die is niet altijd schoner.
        </>
      }
    >
      <Grafiek kader={kader} tip={tip} onWis={() => { setAangewezen(null); wis(); }} label="CO2-winst per maand">
        <svg viewBox={`0 0 ${B} ${BOVEN + HOOGTE + ONDER}`} className="chart" role="img" aria-label={`CO2-winst per maand, het meest in ${VOLUIT[beste.month - 1]}`}>
          {maanden.map((m, i) =>
            isZomer(m.month) ? (
              <rect key={`z${m.month}`} x={LINKS + i * breedte} y={0} width={breedte} height={BOVEN + HOOGTE} fill="var(--series-4)" opacity={0.07} />
            ) : null,
          )}
          {aangewezen !== null ? (
            <rect className="aangewezen" x={LINKS + aangewezen * breedte} y={0} width={breedte} height={BOVEN + HOOGTE} opacity={0.85} />
          ) : null}
          <line x1={LINKS} x2={B - RECHTS} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
          <text x={LINKS - 10} y={y(0)} textAnchor="end" dominantBaseline="middle" className="as-label">0 kg</text>
          <text x={LINKS - 10} y={y(hoogste)} textAnchor="end" dominantBaseline="middle" className="as-label">{kg(hoogste)}</text>

          {maanden.map((m, i) => {
            const cx = LINKS + i * breedte + breedte / 2;
            const topY = Math.min(y(m.winstKg), y(0));
            const hoog = Math.abs(y(m.winstKg) - y(0));
            return (
              <g key={m.month}>
                <rect x={cx - staaf / 2} y={topY} width={staaf} height={Math.max(hoog, 1)} rx={3} fill={m.winstKg >= 0 ? "var(--series-3)" : "var(--critical)"} />
                <text x={cx} y={m.winstKg >= 0 ? topY - 6 : topY + hoog + 14} textAnchor="middle" className="mark-label">
                  {getal(m.winstKg, 0)}
                </text>
                <text x={cx} y={BOVEN + HOOGTE + 18} textAnchor="middle" className="as-label">
                  {MAANDEN[m.month - 1]}
                </text>
              </g>
            );
          })}

          {maanden.map((m, i) => (
            <Trefvlak
              key={`t${m.month}`}
              x={LINKS + i * breedte}
              y={0}
              breedte={breedte}
              hoogte={BOVEN + HOOGTE}
              onWijs={(punt) => {
                setAangewezen(i);
                toon(punt, {
                  titel: VOLUIT[m.month - 1]!,
                  regels: [
                    { label: "Uitstoot afname zonder batterij", waarde: kg(m.importBasisKg) },
                    { label: "Met batterij", waarde: kg(m.importBatKg) },
                    { kleur: "var(--series-3)", label: "Winst", waarde: kg(m.winstKg), uitkomst: true },
                  ],
                  noot: isZomer(m.month)
                    ? "Zomer: bewaarde zonnestroom vervangt de avondafname."
                    : "Winter: afname verschuift van de avondpiek naar de nacht.",
                });
              }}
              onWis={() => { setAangewezen(null); wis(); }}
            />
          ))}
        </svg>
      </Grafiek>
    </Figure>
  );
}
