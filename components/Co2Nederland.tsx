"use client";

/**
 * Het perspectief van Nederland.
 *
 * Voor jouw voetafdruk telt alleen wat je afneemt. Voor Nederland telt ook wat
 * je teruglevert: die zonnestroom gebruikt een buur, en die hoeft dan niet uit
 * een gascentrale te komen. Behalve als de mix op dat uur al heel schoon is:
 * dan is er vaak, maar niet altijd, meer aanbod dan vraag, gaat jouw kWh de
 * grens over of wordt hij afgeschakeld, en verdringt hij in Nederland weinig.
 * De drempel is een benadering van overschot, geen meting. Waar die grens ligt
 * is een keuze; daarom staat er een schuif. De balans bewaart afname en
 * teruglevering per klasse emissiefactor, dus de schuif rekent zonder wachten.
 *
 * De figuur toont de teruglevering per klasse: links de uren waarop de mix
 * schoon was (overschot), rechts de uren waarop jouw kWh wél iets verdrong.
 * Wat de batterij opslaat, verdwijnt vooral uit de linkerhelft, en dat is
 * precies waarom Nederland er ook op vooruitgaat.
 */

import { useState, type ReactNode } from "react";
import {
  CO2_KLASSEN,
  CO2_KLASSE_G,
  huishoudPerspectief,
  klasseOndergrens,
  nederlandPerspectief,
  type Co2Jaar,
} from "../lib/model/co2";
import { getal, kwh, procent } from "../lib/format";
import { Figure, Grafiek, Legenda, Trefvlak, useTip } from "./chart-parts";
import { kg } from "./Co2Antwoord";

const B = 720;
const H = 230;
const MARGE = { boven: 16, rechts: 16, onder: 40, links: 56 };
/** De laatste klasse die we tekenen: daarboven komt de mix zelden. */
const TOON_TOT = 24; // 480 g/kWh

export function Co2Nederland({
  co2,
  drempel,
  onDrempel,
  zonnepanelen = true,
  actie,
}: {
  co2: Co2Jaar;
  /** Zonder zonnepanelen is er geen teruglevering, en vallen de zinnen daarover weg. */
  zonnepanelen?: boolean;
  /** Onder deze emissiefactor telt teruglevering als overschot, g/kWh. */
  drempel: number;
  onDrempel: (g: number) => void;
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const nl = nederlandPerspectief(co2, drempel);
  const h = huishoudPerspectief(co2);

  const klassen = Array.from({ length: TOON_TOT + 1 }, (_, k) => k);
  // De laatste getekende klasse vangt alles daarboven, zodat er niets wegvalt.
  const som = (lijst: number[], k: number) =>
    k < TOON_TOT ? lijst[k]! : lijst.slice(TOON_TOT).reduce((a, b) => a + b, 0);
  const zonder = klassen.map((k) => som(co2.klassen.exportBasisKwh, k));
  const met = klassen.map((k) => som(co2.klassen.exportBatKwh, k));
  const kwartieren = klassen.map((k) => som(co2.klassen.kwartieren, k));

  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;
  const kB = plotB / klassen.length;
  const x = (k: number) => MARGE.links + k * kB;
  const maxKwh = Math.max(1, ...zonder, ...met);
  const y = (v: number) => MARGE.boven + (1 - v / maxKwh) * plotH;
  const eersteNuttig = klassen.findIndex((k) => klasseOndergrens(k) >= drempel);
  const grensX = eersteNuttig === -1 ? B - MARGE.rechts : x(eersteNuttig);

  const overschotAandeelZonder = co2.exportBasisKwh > 0 ? nl.overschotZonderKwh / co2.exportBasisKwh : 0;
  const opgeslagenOverschot = nl.overschotZonderKwh - nl.overschotMetKwh;

  return (
    <Figure
      actie={actie}
      titel={
        nl.winstKg > 0.5
          ? `Voor Nederland scheelt de batterij ${kg(nl.winstKg)} CO2 per jaar`
          : nl.winstKg < -0.5
            ? `Voor Nederland stoot je aansluiting met deze batterij ${kg(-nl.winstKg)} méér CO2 uit per jaar`
            : "Voor Nederland scheelt de batterij per saldo nauwelijks CO2"
      }
      toelichting={
        zonnepanelen ? (
          <>
            Voor jou telt alleen je afname ({h.winstKg >= 0 ? `${kg(h.winstKg)} minder` : `${kg(-h.winstKg)} meer`}).
            Voor Nederland telt ook wat je teruglevert: een buur gebruikt die stroom en er hoeft minder
            uit een gascentrale te komen. Behalve op uren waarop de mix al onder {getal(drempel)} g/kWh
            zit: dan is er vaak, maar niet altijd, meer aanbod dan vraag, en gaat jouw kWh de grens over
            of wordt hij afgeschakeld. Van jouw teruglevering viel {procent(overschotAandeelZonder)} in
            zulke uren;{" "}
            {opgeslagenOverschot > 0.5
              ? `daarvan vangt de batterij ${kwh(opgeslagenOverschot)} op voor later.`
              : "daarvan vangt de batterij vrijwel niets op."}{" "}
            De drempel is een benadering van overschot, geen meting.
          </>
        ) : (
          <>
            Zonder zonnepanelen lever je niets terug. Voor Nederland telt dan alleen je afname, en is
            de uitkomst gelijk aan die voor jou ({h.winstKg >= 0 ? `${kg(h.winstKg)} minder` : `${kg(-h.winstKg)} meer`}).
          </>
        )
      }
    >
      <label className="co2-drempel">
        <span>
          Overschot onder <b>{getal(drempel)} g/kWh</b>
          <span className="co2-drempel-noot">
            {" "}
            · in {procent(nl.aandeelOverschotUren)} van de uren was de mix zo schoon
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={CO2_KLASSE_G * (TOON_TOT - 4)}
          step={CO2_KLASSE_G}
          value={drempel}
          onChange={(e) => onDrempel(Number(e.target.value))}
          aria-label="Drempel voor overschot, gram CO2 per kWh"
        />
      </label>

      <Legenda
        items={[
          { kleur: "var(--series-1)", label: "teruglevering zonder batterij", waarde: kwh(co2.exportBasisKwh) },
          { kleur: "var(--series-3)", label: "met batterij", waarde: kwh(co2.exportBatKwh) },
        ]}
      />
      <Grafiek kader={kader} tip={tip} onWis={() => { setAangewezen(null); wis(); }} label="Teruglevering per klasse emissiefactor">
        <svg viewBox={`0 0 ${B} ${H}`} className="chart" role="img" aria-label="Teruglevering per klasse emissiefactor van de stroommix, zonder en met batterij">
          {/* De overschotzone: links van de drempel. */}
          <rect x={MARGE.links} y={MARGE.boven} width={Math.max(0, grensX - MARGE.links)} height={plotH} fill="var(--series-4)" opacity={0.08} />
          {aangewezen !== null ? (
            <rect className="aangewezen" x={x(aangewezen)} y={MARGE.boven} width={kB} height={plotH} />
          ) : null}
          <line x1={MARGE.links} x2={B - MARGE.rechts} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
          <text x={MARGE.links - 8} y={y(maxKwh)} textAnchor="end" dominantBaseline="middle" className="as-label">{getal(maxKwh)} kWh</text>
          <text x={MARGE.links - 8} y={y(0)} textAnchor="end" dominantBaseline="middle" className="as-label">0</text>

          {klassen.map((k) => {
            const w = kB * 0.36;
            return (
              <g key={k}>
                <rect x={x(k) + kB * 0.3 - w / 2} y={y(zonder[k]!)} width={w} height={Math.max(0, y(0) - y(zonder[k]!))} fill="var(--series-1)" opacity={0.85} />
                <rect x={x(k) + kB * 0.7 - w / 2} y={y(met[k]!)} width={w} height={Math.max(0, y(0) - y(met[k]!))} fill="var(--series-3)" />
              </g>
            );
          })}

          <line x1={grensX} x2={grensX} y1={MARGE.boven} y2={MARGE.boven + plotH} stroke="var(--ac)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={grensX + 6} y={MARGE.boven + 12} className="mark-label" fill="var(--ac)">
            vanaf hier verdringt teruglevering opwek
          </text>
          <text x={Math.max(MARGE.links + 4, grensX - 6)} y={MARGE.boven + 12} textAnchor="end" className="mark-label" fill="var(--text-muted)">
            {grensX > MARGE.links + 120 ? "benaderd overschot" : ""}
          </text>

          {klassen.filter((k) => k % 5 === 0).map((k) => (
            <text key={k} x={x(k)} y={H - 12} textAnchor="middle" className="as-label">
              {klasseOndergrens(k)}{k === TOON_TOT ? "+" : ""} g
            </text>
          ))}

          {klassen.map((k) => (
            <Trefvlak
              key={`t${k}`}
              x={x(k)}
              y={MARGE.boven}
              breedte={kB}
              hoogte={plotH}
              onWijs={(punt) => {
                setAangewezen(k);
                const nuttig = klasseOndergrens(k) >= drempel;
                toon(punt, {
                  titel: k === TOON_TOT ? `${klasseOndergrens(k)} g/kWh en hoger` : `${klasseOndergrens(k)} tot ${klasseOndergrens(k + 1)} g/kWh`,
                  regels: [
                    { kleur: "var(--series-1)", label: "Teruglevering zonder batterij", waarde: kwh(zonder[k]!) },
                    { kleur: "var(--series-3)", label: "Met batterij", waarde: kwh(met[k]!), uitkomst: true },
                    { label: "Uren per jaar met deze mix", waarde: getal(kwartieren[k]! / 4) },
                  ],
                  noot: nuttig
                    ? "Op deze uren vervangt jouw teruglevering opwek elders in Nederland."
                    : "Op deze uren was de mix zo schoon dat er vaak, maar niet altijd, meer aanbod dan vraag was: hier geteld als overschot.",
                });
              }}
              onWis={() => { setAangewezen(null); wis(); }}
            />
          ))}
        </svg>
      </Grafiek>

      <dl className="kerncijfers">
        <div>
          <dt>Uitstoot voor Nederland, door jouw aansluiting</dt>
          <dd className={nl.winstKg >= 0 ? "goed" : "slecht"}>
            {kg(nl.zonderKg)} → {kg(nl.metKg)}
            <span className="dd-noot">afname min wat je teruglevering elders vermijdt</span>
          </dd>
        </div>
        <div>
          <dt>Teruglevering als overschot</dt>
          <dd>
            {kwh(nl.overschotZonderKwh)} → {kwh(nl.overschotMetKwh)}
            <span className="dd-noot">
              onder {getal(drempel)} g/kWh;{" "}
              {opgeslagenOverschot >= 0
                ? `de batterij vangt ${kwh(opgeslagenOverschot)} op`
                : `met batterij ${kwh(-opgeslagenOverschot)} meer`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Wat je teruglevering elders vermeed</dt>
          <dd>
            {kg(nl.vermedenZonderKg)} → {kg(nl.vermedenMetKg)}
            <span className="dd-noot">
              {nl.vermedenMetKg < nl.vermedenZonderKg - 0.05
                ? "minder, want een deel van je zonnestroom gaat nu de batterij in"
                : nl.vermedenMetKg > nl.vermedenZonderKg + 0.05
                  ? "meer, want de batterij levert ook terug op uren met een vuile mix"
                  : "vrijwel gelijk"}
            </span>
          </dd>
        </div>
      </dl>
      <p className="posten-noot">
        Hoe lager je de drempel zet, hoe meer van je teruglevering als nuttig voor Nederland telt en
        hoe kleiner het verschil tussen de twee perspectieven. Op {getal(CO2_KLASSEN - 1)} klassen van{" "}
        {CO2_KLASSE_G} g/kWh; de schuif loopt in die stappen.
      </p>
    </Figure>
  );
}
