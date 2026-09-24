"use client";

/**
 * Wanneer is stroom schoon, en schuift de batterij daar naartoe?
 *
 * Twee lijnen: de gemiddelde emissiefactor van de Nederlandse mix per uur van
 * de dag, in de winter en in de zomer. In de zomer duikt hij 's middags diep
 * (zon), in beide seizoenen piekt hij 's avonds (gas). Daaronder, per uur, de
 * afname die de batterij van het net weghaalt: dat is het bewijs dat de winst
 * niet uit de lucht komt maar uit de avonduren.
 */

import { useState, type ReactNode } from "react";
import type { SeasonProfile } from "../lib/model/analysis";
import type { Co2Jaar } from "../lib/model/co2";
import { getal } from "../lib/format";
import { Figure, Grafiek, Legenda, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const B = 720;
const MARGE = { boven: 16, rechts: 16, onder: 30, links: 56 };
const LIJN_H = 170;
const TUSSEN = 14;
const STAAF_H = 56;
const H = MARGE.boven + LIJN_H + TUSSEN + STAAF_H + MARGE.onder;

const KLEUR = { winter: "var(--series-2)", zomer: "var(--series-3)" } as const;

function uurLabel(u: number): string {
  return `${String(u).padStart(2, "0")}:00`;
}

export function Co2Uren({
  co2,
  profielen,
  actie,
}: {
  co2: Co2Jaar;
  profielen: SeasonProfile[];
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);

  const seizoenen = (["winter", "zomer"] as const).map((s) => {
    const p = profielen.find((q) => q.season === s);
    const factor = co2.factorPerUur[s];
    // Wat de batterij per uur van het net weghaalt (positief) of erbij haalt.
    const daling = p ? p.importBaseline.map((v, u) => v - p.importBattery[u]!) : Array.from({ length: 24 }, () => 0);
    return { seizoen: s, factor, daling, dagen: p?.days ?? 0 };
  });

  const plotB = B - MARGE.links - MARGE.rechts;
  const uurB = plotB / 24;
  const x = (u: number) => MARGE.links + u * uurB;
  const factorMax = Math.max(1, ...seizoenen.flatMap((s) => s.factor));
  const ticks = kiesTicks(0, factorMax, 5);
  const top = Math.max(...ticks, factorMax);
  const y = (v: number) => MARGE.boven + (1 - v / top) * LIJN_H;
  const staafTop = MARGE.boven + LIJN_H + TUSSEN;
  const dalingMax = Math.max(0.05, ...seizoenen.flatMap((s) => s.daling.map((v) => Math.abs(v))));
  const yStaaf = (v: number) => staafTop + STAAF_H / 2 - (v / dalingMax) * (STAAF_H / 2);

  const pad = (reeks: number[]) =>
    reeks
      .flatMap((v, u) => [`${u === 0 ? "M" : "L"}${x(u)} ${y(v)}`, `L${x(u + 1)} ${y(v)}`])
      .join(" ");

  const zomer = seizoenen[1]!;
  const winter = seizoenen[0]!;
  const uurMin = (r: number[]) => r.indexOf(Math.min(...r));
  const uurMax = (r: number[]) => r.indexOf(Math.max(...r));
  const schoonst = uurMin(zomer.factor);
  const vuilst = uurMax(zomer.factor);
  const grootsteDaling = uurMax(zomer.daling);
  const verschuiftNaarSchoon = zomer.factor[grootsteDaling]! > zomer.factor[schoonst]! * 1.3;

  return (
    <Figure
      actie={actie}
      titel={
        verschuiftNaarSchoon
          ? `Stroom is om ${uurLabel(schoonst)} het schoonst en om ${uurLabel(vuilst)} het vuilst; de batterij haalt juist de avond van het net`
          : "Hoe schoon de stroom per uur is, en waar de batterij je afname weghaalt"
      }
      toelichting={
        <>
          Boven: de gemiddelde uitstoot van één kWh uit het Nederlandse net per uur van de dag, in de
          winter en in de zomer (april tot en met september). Onder: hoeveel afname de batterij op
          dat uur van het net weghaalt (boven de lijn) of erbij haalt om te laden (onder de lijn),
          kWh per gemiddelde dag.
        </>
      }
    >
      <Legenda
        items={[
          { kleur: KLEUR.winter, label: "winter", waarde: `${getal(winter.factor.reduce((a, b) => a + b, 0) / 24)} g/kWh gemiddeld` },
          { kleur: KLEUR.zomer, label: "zomer", waarde: `${getal(zomer.factor.reduce((a, b) => a + b, 0) / 24)} g/kWh gemiddeld` },
        ]}
      />
      <Grafiek kader={kader} tip={tip} onWis={() => { setAangewezen(null); wis(); }} label="Emissiefactor per uur van de dag">
        <svg viewBox={`0 0 ${B} ${H}`} className="chart" role="img" aria-label="Emissiefactor per uur van de dag, winter en zomer, met de afname die de batterij weghaalt">
          {aangewezen !== null ? (
            <rect className="aangewezen" x={x(aangewezen)} y={MARGE.boven} width={uurB} height={LIJN_H + TUSSEN + STAAF_H} />
          ) : null}
          <Raster ticks={ticks} x0={MARGE.links} x1={B - MARGE.rechts} schaal={y} labelBreedte={MARGE.links} formatter={(v) => `${getal(v)} g`} />
          {seizoenen.map((s) => (
            <path key={s.seizoen} d={pad(s.factor)} fill="none" stroke={KLEUR[s.seizoen]} strokeWidth={2} strokeLinejoin="round" />
          ))}

          {/* Onderpaneel: de afname die de batterij weghaalt, per uur. */}
          <line x1={MARGE.links} x2={B - MARGE.rechts} y1={yStaaf(0)} y2={yStaaf(0)} stroke="var(--axis)" />
          <text x={MARGE.links - 8} y={yStaaf(0)} textAnchor="end" dominantBaseline="middle" className="as-label">
            0 kWh
          </text>
          {seizoenen.map((s, si) =>
            s.daling.map((v, u) => {
              const w = uurB * 0.36;
              const cx = x(u) + uurB * (si === 0 ? 0.3 : 0.7);
              return (
                <rect
                  key={`${s.seizoen}${u}`}
                  x={cx - w / 2}
                  y={Math.min(yStaaf(v), yStaaf(0))}
                  width={w}
                  height={Math.max(1, Math.abs(yStaaf(v) - yStaaf(0)))}
                  fill={KLEUR[s.seizoen]}
                  opacity={0.75}
                />
              );
            }),
          )}

          {[0, 6, 12, 18, 24].map((u) => (
            <text key={u} x={x(u)} y={H - 10} textAnchor={u === 24 ? "end" : u === 0 ? "start" : "middle"} className="as-label">
              {uurLabel(u % 24)}
            </text>
          ))}

          {Array.from({ length: 24 }, (_, u) => (
            <Trefvlak
              key={u}
              x={x(u)}
              y={MARGE.boven}
              breedte={uurB}
              hoogte={LIJN_H + TUSSEN + STAAF_H}
              onWijs={(punt) => {
                setAangewezen(u);
                toon(punt, {
                  titel: `${uurLabel(u)} tot ${uurLabel((u + 1) % 24)}`,
                  regels: [
                    { kleur: KLEUR.winter, label: "Uitstoot per kWh, winter", waarde: `${getal(winter.factor[u]!)} g` },
                    { kleur: KLEUR.zomer, label: "Uitstoot per kWh, zomer", waarde: `${getal(zomer.factor[u]!)} g` },
                    { label: "Batterij haalt van het net weg, winter", waarde: `${getal(winter.daling[u]!, 2)} kWh` },
                    { label: "Batterij haalt van het net weg, zomer", waarde: `${getal(zomer.daling[u]!, 2)} kWh`, uitkomst: true },
                  ],
                  noot: "Per gemiddelde dag in dat seizoen; een negatief getal is laden van het net.",
                });
              }}
              onWis={() => { setAangewezen(null); wis(); }}
            />
          ))}
        </svg>
      </Grafiek>

      <dl className="kerncijfers">
        <div>
          <dt>Schoonste uur in de zomer</dt>
          <dd>
            {uurLabel(schoonst)}
            <span className="dd-noot">{getal(zomer.factor[schoonst]!)} g/kWh</span>
          </dd>
        </div>
        <div>
          <dt>Vuilste uur in de zomer</dt>
          <dd>
            {uurLabel(vuilst)}
            <span className="dd-noot">{getal(zomer.factor[vuilst]!)} g/kWh</span>
          </dd>
        </div>
        <div>
          <dt>Waar de batterij de meeste afname weghaalt</dt>
          <dd>
            {uurLabel(grootsteDaling)}
            <span className="dd-noot">
              {getal(zomer.daling[grootsteDaling]!, 2)} kWh per zomerdag, bij {getal(zomer.factor[grootsteDaling]!)} g/kWh
            </span>
          </dd>
        </div>
      </dl>
    </Figure>
  );
}
