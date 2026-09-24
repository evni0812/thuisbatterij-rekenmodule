"use client";

/**
 * Wat er door de meter ging: afname en teruglevering, zonder en met batterij.
 *
 * Dit paneel zat eerder in het dagprofiel en is daar weggehaald omdat het af
 * te leiden was uit het actiepaneel. Dat klopt, maar "afleiden" is precies wat
 * een lezer niet doet: de vraag "hoeveel haalde ik nog van het net, en hoeveel
 * ging er nog het net op" verdient een eigen plaatje. Nu als losse figuur onder
 * het dagprofiel, op dezelfde dag of week.
 *
 * Boven de nullijn afname, eronder teruglevering. De stippellijn is zonder
 * batterij, het gevulde vlak met. Waar het vlak onder de stippellijn blijft,
 * heeft de batterij afname weggehaald; waar het boven de stippellijn ligt bij
 * teruglevering, ging er minder het net op. De toelichting volgt het teken van
 * het verschil: zonder zonnepanelen of op een dag waarop de batterij juist aan
 * het net verkocht, klopt "hield hij binnen" niet.
 */

import { useState } from "react";
import { getal, kwh } from "../lib/format";
import { Figure, Grafiek, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const B = 860;
const H = 230;
const MARGE = { boven: 16, rechts: 16, onder: 30, links: 60 };

export function Meterprofiel({
  startMs,
  residualKwh,
  netKwh,
  perKw,
  perUur,
}: {
  startMs: number[];
  /** Netto uitwisseling zonder batterij, kWh per punt; positief is afname. */
  residualKwh: number[];
  /** Idem met batterij. */
  netKwh: number[];
  /** Omrekening van kWh per punt naar kW: 4 bij kwartieren, 1 bij uren. */
  perKw: number;
  /** Een week per uur in plaats van een dag per kwartier. */
  perUur: boolean;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const n = residualKwh.length;
  if (n === 0 || netKwh.length !== n) return null;

  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;
  const x = (i: number) => MARGE.links + (i / n) * plotB;
  const top = Math.max(0.2, ...residualKwh.map((v) => Math.abs(v) * perKw), ...netKwh.map((v) => Math.abs(v) * perKw));
  const ticks = kiesTicks(-top, top, 5);
  const y = (kw: number) => MARGE.boven + (1 - (kw + top) / (2 * top)) * plotH;

  const stap = (reeks: number[]) =>
    reeks.flatMap((v, i) => [`${i === 0 ? "M" : "L"}${x(i)} ${y(v * perKw)}`, `L${x(i + 1)} ${y(v * perKw)}`]).join(" ");
  const vlak = `${stap(netKwh)} L${x(n)} ${y(0)} L${x(0)} ${y(0)} Z`;

  const som = (reeks: number[], teken: 1 | -1) =>
    reeks.reduce((a, v) => a + (teken === 1 ? Math.max(0, v) : Math.max(0, -v)), 0);
  const afnameZonder = som(residualKwh, 1);
  const afnameMet = som(netKwh, 1);
  const terugZonder = som(residualKwh, -1);
  const terugMet = som(netKwh, -1);

  const label = (i: number): string => {
    const d = new Date(startMs[i]!);
    const t = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
    return perUur ? `${d.toLocaleDateString("nl-NL", { weekday: "short", timeZone: "Europe/Amsterdam" })} ${t}` : t;
  };
  const asLabels = perUur
    ? Array.from({ length: 7 }, (_, d) => d * 24).filter((i) => i < n)
    : Array.from({ length: 9 }, (_, k) => k * 12).filter((i) => i < n);

  const periode = perUur ? "deze week" : "deze dag";

  return (
    <Figure
      titel={
        afnameMet < afnameZonder * 0.999
          ? `Van het net ${perUur ? "deze week" : "vandaag"}: ${kwh(afnameZonder)} zonder, ${kwh(afnameMet)} met batterij`
          : "Wat er door de meter ging, zonder en met batterij"
      }
      toelichting={
        <>
          Boven de lijn wat je van het net afnam, eronder wat je terugleverde. De stippellijn is zonder
          batterij, het vlak met.{" "}
          {terugZonder < 0.05 && terugMet < 0.05
            ? "Er ging deze periode vrijwel niets naar het net."
            : terugMet < terugZonder
              ? `Teruglevering ging van ${kwh(terugZonder)} naar ${kwh(terugMet)}: dat verschil ging de batterij in, voor later gebruik of om op een beter moment te verkopen.`
              : `Teruglevering ging van ${kwh(terugZonder)} naar ${kwh(terugMet)}: de batterij leverde ook zelf aan het net.`}
        </>
      }
    >
      <Grafiek kader={kader} tip={tip} onWis={() => { setAangewezen(null); wis(); }} label={`Netuitwisseling ${periode}, zonder en met batterij`}>
        <svg viewBox={`0 0 ${B} ${H}`} className="chart" role="img" aria-label={`Afname en teruglevering ${periode}, zonder en met batterij`}>
          {aangewezen !== null ? (
            <rect className="aangewezen" x={x(aangewezen)} y={MARGE.boven} width={plotB / n} height={plotH} />
          ) : null}
          <Raster ticks={ticks} x0={MARGE.links} x1={B - MARGE.rechts} schaal={y} labelBreedte={MARGE.links} formatter={(v) => `${getal(Math.abs(v), 1)} kW`} />
          <text x={MARGE.links - 8} y={MARGE.boven + 10} textAnchor="end" className="as-label">afname</text>
          <text x={MARGE.links - 8} y={MARGE.boven + plotH - 2} textAnchor="end" className="as-label">teruglevering</text>

          <path d={vlak} fill="var(--series-3)" opacity={0.22} />
          <path d={stap(netKwh)} fill="none" stroke="var(--series-3)" strokeWidth={1.6} />
          <path d={stap(residualKwh)} fill="none" stroke="var(--text-muted)" strokeWidth={1.4} strokeDasharray="4 3" />

          {asLabels.map((i) => (
            <text key={i} x={x(i)} y={H - 10} textAnchor={i === 0 ? "start" : "middle"} className="as-label">
              {label(i)}
            </text>
          ))}

          {residualKwh.map((_, i) => (
            <Trefvlak
              key={i}
              x={x(i)}
              y={MARGE.boven}
              breedte={plotB / n}
              hoogte={plotH}
              onWijs={(punt) => {
                setAangewezen(i);
                const z = residualKwh[i]! * perKw;
                const m = netKwh[i]! * perKw;
                toon(punt, {
                  titel: label(i),
                  regels: [
                    { label: z >= 0 ? "Afname zonder batterij" : "Teruglevering zonder batterij", waarde: `${getal(Math.abs(z), 2)} kW` },
                    { kleur: "var(--series-3)", label: m >= 0 ? "Afname met batterij" : "Teruglevering met batterij", waarde: `${getal(Math.abs(m), 2)} kW`, uitkomst: true },
                  ],
                });
              }}
              onWis={() => { setAangewezen(null); wis(); }}
            />
          ))}
        </svg>
      </Grafiek>
      <dl className="kerncijfers">
        <div>
          <dt>Van het net</dt>
          <dd>
            {kwh(afnameZonder)} → {kwh(afnameMet)}
            <span className="dd-noot">
              {afnameMet <= afnameZonder
                ? `${kwh(afnameZonder - afnameMet)} minder afname ${periode}`
                : `${kwh(afnameMet - afnameZonder)} méér afname ${periode}: de batterij laadde van het net`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Naar het net</dt>
          <dd>
            {kwh(terugZonder)} → {kwh(terugMet)}
            <span className="dd-noot">
              {terugMet <= terugZonder
                ? `${kwh(terugZonder - terugMet)} minder teruggeleverd`
                : `${kwh(terugMet - terugZonder)} méér teruggeleverd: de batterij verkocht aan het net`}
            </span>
          </dd>
        </div>
      </dl>
    </Figure>
  );
}
