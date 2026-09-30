"use client";

/**
 * Minder CO2 door het jaar heen, per maand, met de zomer gearceerd.
 *
 * Dezelfde twee verdienmodellen als bij de euro's, maar met een ander gewicht:
 * in de zomer kan de batterij zonnestroom bewaren voor de avond, in de winter
 * verschuift hij afname van de avondpiek naar de nacht, en die nacht is lang
 * niet altijd schoner. Zonder zonnepanelen is er alleen dat tweede, en kan een
 * maand ook negatief uitvallen; de teksten volgen dat.
 */

import { useState, type ReactNode } from "react";
import type { Co2Jaar } from "../lib/model/co2";
import { getal } from "../lib/format";
import { Figure, Grafiek, Trefvlak, useTip } from "./chart-parts";
import { kg } from "./Co2Antwoord";

const MAANDEN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const VOLUIT = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/** "3 kg minder" of "2 kg meer", naar het teken. */
function minderMeer(kgMinder: number): string {
  return kgMinder >= 0 ? `${kg(kgMinder)} minder` : `${kg(-kgMinder)} meer`;
}

function isZomer(maand: number): boolean {
  return maand >= 4 && maand <= 9;
}

const B = 860;
const HOOGTE = 170;
const LINKS = 52;
const RECHTS = 16;
const ONDER = 46;
const BOVEN = 24;

export function Co2Maanden({
  co2,
  zonnepanelen = true,
  actie,
}: {
  co2: Co2Jaar;
  /** Met zonnepanelen kan de batterij zonnestroom bewaren; zonder alleen afname verschuiven. */
  zonnepanelen?: boolean;
  actie?: ReactNode;
}) {
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
      anker="co2-per-seizoen"
      actie={actie}
      titel={
        zomer <= 0 && winter <= 0
          ? `De batterij zorgt in beide seizoenen voor meer CO2: ${kg(-zomer)} in de zomer en ${kg(-winter)} in de winter`
          : zomer > winter
            ? `Je CO2-uitstoot daalt vooral in de zomer: ${minderMeer(zomer)}, tegen ${minderMeer(winter)} in de winter`
            : `Je CO2-uitstoot daalt vooral in de winter: ${minderMeer(winter)}, tegen ${minderMeer(zomer)} in de zomer`
      }
      toelichting={
        <>
          Per maand: hoeveel minder CO2 de stroom van het net veroorzaakt met batterij, gemiddeld
          over de volledige jaren. Een rode staaf is een maand met meer CO2. De gearceerde maanden
          zijn de zomer, april tot en met september.{" "}
          {zonnepanelen
            ? "In de zomer kan opgeslagen zonnestroom een deel van wat je 's avonds van het net haalt vervangen. In de winter verschuift de batterij die stroom naar de nacht, en die is niet altijd schoner."
            : "Zonder zonnepanelen verschuift de batterij alleen wat je van het net haalt: hij laadt van het net en levert later, en dat is niet op elk uur schoner."}
        </>
      }
    >
      <Grafiek kader={kader} tip={tip} onWis={() => { setAangewezen(null); wis(); }} label="Minder CO2 per maand">
        <svg viewBox={`0 0 ${B} ${BOVEN + HOOGTE + ONDER}`} className="chart" role="img" aria-label={`Minder CO2 per maand, het meest in ${VOLUIT[beste.month - 1]}`}>
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
                    { label: "Uitstoot van het net zonder batterij", waarde: kg(m.importBasisKg) },
                    { label: "Met batterij", waarde: kg(m.importBatKg) },
                    { kleur: "var(--series-3)", label: "Minder CO2", waarde: kg(m.winstKg), uitkomst: true },
                  ],
                  noot: !zonnepanelen
                    ? "Zonder zonnepanelen: wat je van het net haalt verschuift naar de uren waarop de batterij laadt."
                    : isZomer(m.month)
                      ? "Zomer: opgeslagen zonnestroom kan een deel van wat je 's avonds van het net haalt vervangen."
                      : "Winter: wat je van het net haalt verschuift van de avondpiek naar de nacht.",
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
