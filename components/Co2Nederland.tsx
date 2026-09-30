"use client";

/**
 * Het perspectief van Nederland.
 *
 * Voor jouw voetafdruk telt alleen wat je afneemt. Voor Nederland telt ook wat
 * je teruglevert: die zonnestroom gebruikt een buur, en die hoeft dan niet uit
 * een gascentrale te komen. Behalve als de mix op dat uur al heel schoon is:
 * dan is er vaak, maar niet altijd, meer aanbod dan vraag, gaat jouw kWh de
 * grens over of wordt hij afgeschakeld, en verdringt hij in Nederland weinig.
 *
 * ── Een optelsom, geen verdeling ────────────────────────────────────────────
 * De figuur stond eerst als staafdiagram van de teruglevering per klasse
 * emissiefactor, met een schuif voor de drempel erboven. Dat klopte, maar je
 * zag nergens hoe je van die staven op het getal in de titel kwam. Nu is het
 * die som zelf: wat de batterij aan je afname scheelt (het perspectief van
 * jou), plus of min wat er verandert aan teruglevering die elders gas
 * vervangt, is wat hij Nederland scheelt. Dat is exact: nederlandPerspectief
 * trekt de vermeden uitstoot van de afname af, dus
 *   winst voor Nederland = winst voor jou − (vermeden zonder − vermeden met).
 *
 * De drempel voor overschot is een aanname, geen knop om mee te spelen. Hij
 * staat bij de geavanceerde instellingen ("Hoe je ernaar kijkt"). Het
 * staafdiagram per klasse (Co2OverschotStaven, hieronder) staat in "Hoe is dit
 * berekend?": daar is het de onderbouwing van de tweede stap.
 */

import { useState, type ReactNode } from "react";
import {
  CO2_KLASSE_G,
  huishoudPerspectief,
  klasseOndergrens,
  nederlandPerspectief,
  type Co2Jaar,
} from "../lib/model/co2";
import { getal, kwh, procent } from "../lib/format";
import {
  AsLabel,
  Figure,
  Grafiek,
  Legenda,
  Raster,
  Trefvlak,
  kiesTicks,
  useTip,
} from "./chart-parts";
import { kg } from "./Co2Antwoord";

const B = 760;
const H = 250;
const MARGE = { boven: 26, rechts: 16, onder: 54, links: 62 };

/** Kleiner dan dit, kg, telt als "geen verschil": de stap valt dan weg. */
const NIETS_KG = 0.05;

interface Post {
  label: string;
  waarde: number;
  kleur: string;
  uitleg: string;
}

export function Co2Nederland({
  co2,
  drempel,
  zonnepanelen = true,
  actie,
}: {
  co2: Co2Jaar;
  /** Onder deze emissiefactor telt teruglevering als overschot, g/kWh. */
  drempel: number;
  /** Zonder zonnepanelen is er geen eigen teruglevering, en vallen de zinnen daarover weg. */
  zonnepanelen?: boolean;
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const nl = nederlandPerspectief(co2, drempel);
  const h = huishoudPerspectief(co2);

  // Wat de batterij verandert aan teruglevering die elders gas vervangt: min
  // als hij zonnestroom opslaat die anders een buur had bediend, plus als hij
  // juist op vuile uren terug levert.
  const teruglevering = nl.vermedenMetKg - nl.vermedenZonderKg;
  const posten: Post[] = [
    {
      label: "Stroom van het net",
      waarde: h.winstKg,
      kleur: "var(--series-1)",
      uitleg:
        "Wat de batterij scheelt aan de uitstoot van de stroom die je van het net haalt. Dit telt ook voor jou zelf.",
    },
    ...(Math.abs(teruglevering) >= NIETS_KG
      ? [
          {
            label: "Teruglevering die gas vervangt",
            waarde: teruglevering,
            kleur: "var(--series-2)",
            uitleg:
              teruglevering < 0
                ? "Met batterij lever je minder aan het net op uren waarop een buur jouw stroom had gebruikt in plaats van stroom uit een centrale. Die vermeden uitstoot valt weg."
                : "Met batterij lever je meer aan het net op uren waarop jouw stroom elders een centrale vervangt. Dat scheelt Nederland nog iets extra.",
          },
        ]
      : []),
  ];

  // De stappen van de waterval: elke post begint waar de vorige eindigde.
  let loopt = 0;
  const stappen = posten.map((p) => {
    const van = loopt;
    loopt += p.waarde;
    return { post: p, van, tot: loopt };
  });

  const alleWaarden = [0, nl.winstKg, ...stappen.flatMap((s) => [s.van, s.tot])];
  const ticks = kiesTicks(Math.min(...alleWaarden), Math.max(...alleWaarden), 4);
  const lo = Math.min(...ticks, ...alleWaarden);
  const hi = Math.max(...ticks, ...alleWaarden);
  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;
  const y = (v: number) => MARGE.boven + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * plotH;

  const kolommen = posten.length + 1;
  const kolomB = plotB / kolommen;
  const staafB = Math.min(96, kolomB * 0.54);
  const midden = (i: number) => MARGE.links + kolomB * (i + 0.5);

  const overschotAandeel =
    co2.exportBasisKwh > 0 ? nl.overschotZonderKwh / co2.exportBasisKwh : 0;
  const metTeken = (v: number) => `${v < 0 ? "−" : "+"}${kg(Math.abs(v))}`;

  return (
    <Figure
      anker="co2-nederland"
      actie={actie}
      titel={
        nl.winstKg > 0.5
          ? `Voor Nederland komt er met deze batterij ${kg(nl.winstKg)} minder CO2 vrij per jaar`
          : nl.winstKg < -0.5
            ? `Voor Nederland komt er met deze batterij ${kg(-nl.winstKg)} meer CO2 vrij per jaar`
            : "Voor Nederland maakt de batterij per saldo nauwelijks verschil in CO2"
      }
      toelichting={
        zonnepanelen ? (
          <>
            Voor jou telt alleen wat je van het net haalt. Voor Nederland telt ook wat je
            aan het net levert: een buur gebruikt die stroom, en die hoeft dan niet uit een
            gascentrale te komen.{" "}
            {teruglevering <= -NIETS_KG
              ? `Met batterij lever je minder aan het net, en dat is ${kg(-teruglevering)} meer CO2 voor Nederland. Op de schoonste uren (onder ${getal(drempel)} g/kWh) geeft opslaan geen extra uitstoot: dan is er vaak meer stroom dan vraag.`
              : teruglevering >= NIETS_KG
                ? `De batterij levert ook aan het net op uren waarop de stroom vuil is, en dat scheelt Nederland nog ${kg(teruglevering)} extra.`
                : `Met batterij lever je minder aan het net, maar vooral op de schoonste uren (onder ${getal(drempel)} g/kWh). Dan is er vaak meer stroom dan vraag, en geeft opslaan geen extra uitstoot.`}
          </>
        ) : co2.exportBatKwh > 0.5 ? (
          <>
            Zonder zonnepanelen lever je zelf niets aan het net. Wat de batterij op dure uren aan
            het net levert ({kwh(co2.exportBatKwh)} per jaar), gebruikt een buur, en die hoeft dat
            dan niet uit een centrale te halen.
          </>
        ) : (
          <>
            Zonder zonnepanelen lever je niets terug. Voor Nederland telt dan alleen wat je van het
            net haalt, en is de uitkomst gelijk aan die voor jou.
          </>
        )
      }
    >
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setAangewezen(null);
          wis();
        }}
        label="Wat de batterij Nederland scheelt, opgebouwd uit wat je van het net haalt en wat je aan het net levert"
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart"
          role="img"
          aria-label={`Voor Nederland ${metTeken(nl.winstKg)} CO2 per jaar: ${stappen
            .map((s) => `${s.post.label} ${metTeken(s.post.waarde)}`)
            .join(", ")}`}
        >
          {aangewezen !== null ? (
            <rect
              className="aangewezen"
              x={MARGE.links + kolomB * aangewezen}
              y={MARGE.boven - 10}
              width={kolomB}
              height={plotH + 10}
            />
          ) : null}

          <Raster
            ticks={ticks}
            x0={MARGE.links}
            x1={B - MARGE.rechts}
            schaal={y}
            labelBreedte={MARGE.links}
            formatter={(v) => `${getal(v)} kg`}
          />

          {stappen.map((s, i) => {
            const boven = Math.min(y(s.van), y(s.tot));
            const hoog = Math.max(2, Math.abs(y(s.tot) - y(s.van)));
            const volgende = i + 1 < stappen.length ? midden(i + 1) : midden(kolommen - 1);
            return (
              <g key={s.post.label}>
                <rect
                  x={midden(i) - staafB / 2}
                  y={boven}
                  width={staafB}
                  height={hoog}
                  rx={3}
                  fill={s.post.kleur}
                />
                {/* De verbindingslijn maakt de optelling zichtbaar: waar de ene
                    stap eindigt, begint de volgende. */}
                <line
                  x1={midden(i) + staafB / 2}
                  x2={volgende - staafB / 2}
                  y1={y(s.tot)}
                  y2={y(s.tot)}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text x={midden(i)} y={boven - 8} textAnchor="middle" className="mark-label">
                  {metTeken(s.post.waarde)}
                </text>
                <AsLabel x={midden(i)} y={MARGE.boven + plotH + 20} tekst={s.post.label} />
              </g>
            );
          })}

          {/* Het totaal staat op de grond, niet op de stapel: het is geen
              extra stap maar de som van de stappen ervoor. */}
          <rect
            x={midden(kolommen - 1) - staafB / 2}
            y={Math.min(y(0), y(nl.winstKg))}
            width={staafB}
            height={Math.max(2, Math.abs(y(nl.winstKg) - y(0)))}
            rx={3}
            fill="var(--series-3)"
          />
          <text
            x={midden(kolommen - 1)}
            y={Math.min(y(0), y(nl.winstKg)) - 8}
            textAnchor="middle"
            className="mark-label"
          >
            {metTeken(nl.winstKg)}
          </text>
          <AsLabel x={midden(kolommen - 1)} y={MARGE.boven + plotH + 20} tekst="Voor Nederland" />

          {[...posten, null].map((p, i) => (
            <Trefvlak
              key={p ? p.label : "totaal"}
              x={MARGE.links + kolomB * i}
              y={MARGE.boven - 10}
              breedte={kolomB}
              hoogte={plotH + 10}
              onWijs={(punt) => {
                setAangewezen(i);
                toon(
                  punt,
                  p
                    ? {
                        titel: p.label,
                        regels: [{ kleur: p.kleur, label: "Scheelt per jaar", waarde: metTeken(p.waarde) }],
                        noot: p.uitleg,
                      }
                    : {
                        titel: "Voor Nederland",
                        regels: [
                          ...posten.map((q) => ({ kleur: q.kleur, label: q.label, waarde: metTeken(q.waarde) })),
                          { kleur: "var(--series-3)", label: "Samen", waarde: metTeken(nl.winstKg), uitkomst: true },
                        ],
                        noot: `Uitstoot die aan jouw aansluiting toe te rekenen is: ${kg(nl.zonderKg)} zonder batterij, ${kg(nl.metKg)} met.`,
                      },
                );
              }}
              onWis={() => {
                setAangewezen(null);
                wis();
              }}
            />
          ))}
        </svg>
      </Grafiek>

      <ul className="posten-legenda">
        {posten.map((p) => (
          <li key={p.label}>
            <span className="post-vlak" style={{ background: p.kleur }} />
            <span>
              <b>{p.label}</b>: {p.uitleg}
            </span>
          </li>
        ))}
      </ul>

      {zonnepanelen && co2.exportBasisKwh > 0.5 ? (
        <p className="posten-noot">
          Van je teruglevering viel {procent(overschotAandeel)} op uren waarop de stroom schoner was
          dan {getal(drempel)} g/kWh. Die tellen als overschot: daar vervangt jouw stroom weinig.
          Die grens is een aanname; je past hem aan bij de geavanceerde instellingen, onder "Hoe je
          ernaar kijkt". Hoe je teruglevering over de uren verdeeld is, staat bij "Hoe is dit
          berekend?".
        </p>
      ) : null}
    </Figure>
  );
}

/** Tot en met deze klasse tekenen we; daarboven komt de mix zelden. */
const TOON_TOT = 24; // 480 g/kWh
const SB = 720;
const SH = 230;
const SMARGE = { boven: 30, rechts: 16, onder: 40, links: 56 };

/**
 * De onderbouwing van de tweede stap: je teruglevering per klasse emissiefactor,
 * zonder en met batterij, met de drempel als stippellijn. Links daarvan telt
 * teruglevering als overschot, rechts vervangt ze opwek elders. Staat in de
 * dialoog "Hoe is dit berekend?".
 *
 * De twee labels staan boven het plotvlak, niet erin: eerder viel "benaderd
 * overschot" over de hoogste staaf heen.
 */
export function Co2OverschotStaven({ co2, drempel }: { co2: Co2Jaar; drempel: number }) {
  const klassen = Array.from({ length: TOON_TOT + 1 }, (_, k) => k);
  // De laatste getekende klasse vangt alles daarboven, zodat er niets wegvalt.
  const som = (lijst: number[], k: number) =>
    k < TOON_TOT ? lijst[k]! : lijst.slice(TOON_TOT).reduce((a, b) => a + b, 0);
  const zonder = klassen.map((k) => som(co2.klassen.exportBasisKwh, k));
  const met = klassen.map((k) => som(co2.klassen.exportBatKwh, k));

  const plotB = SB - SMARGE.links - SMARGE.rechts;
  const plotH = SH - SMARGE.boven - SMARGE.onder;
  const kB = plotB / klassen.length;
  const x = (k: number) => SMARGE.links + k * kB;
  const maxKwh = Math.max(1, ...zonder, ...met);
  const y = (v: number) => SMARGE.boven + (1 - v / maxKwh) * plotH;
  const eersteNuttig = klassen.findIndex((k) => klasseOndergrens(k) >= drempel);
  const grensX = eersteNuttig === -1 ? SB - SMARGE.rechts : x(eersteNuttig);

  return (
    <figure className="uitleg-figuur">
      <Legenda
        items={[
          { kleur: "var(--series-1)", label: "teruglevering zonder batterij", waarde: kwh(co2.exportBasisKwh) },
          { kleur: "var(--series-3)", label: "met batterij", waarde: kwh(co2.exportBatKwh) },
        ]}
      />
      <svg
        viewBox={`0 0 ${SB} ${SH}`}
        className="chart"
        role="img"
        aria-label={`Teruglevering per klasse van ${CO2_KLASSE_G} g/kWh, zonder en met batterij; onder ${getal(drempel)} g/kWh telt ze als overschot`}
      >
        <rect x={SMARGE.links} y={SMARGE.boven} width={Math.max(0, grensX - SMARGE.links)} height={plotH} fill="var(--series-4)" opacity={0.08} />
        <line x1={SMARGE.links} x2={SB - SMARGE.rechts} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
        <text x={SMARGE.links - 8} y={y(maxKwh)} textAnchor="end" dominantBaseline="middle" className="as-label">{getal(maxKwh)} kWh</text>
        <text x={SMARGE.links - 8} y={y(0)} textAnchor="end" dominantBaseline="middle" className="as-label">0</text>

        {klassen.map((k) => {
          const w = kB * 0.36;
          return (
            <g key={k}>
              <rect x={x(k) + kB * 0.3 - w / 2} y={y(zonder[k]!)} width={w} height={Math.max(0, y(0) - y(zonder[k]!))} fill="var(--series-1)" opacity={0.85} />
              <rect x={x(k) + kB * 0.7 - w / 2} y={y(met[k]!)} width={w} height={Math.max(0, y(0) - y(met[k]!))} fill="var(--series-3)" />
            </g>
          );
        })}

        <line x1={grensX} x2={grensX} y1={SMARGE.boven - 16} y2={SMARGE.boven + plotH} stroke="var(--ac)" strokeWidth={1.5} strokeDasharray="4 3" />
        {grensX > SMARGE.links + 70 ? (
          <text x={grensX - 6} y={SMARGE.boven - 8} textAnchor="end" className="mark-label" fill="var(--text-muted)">
            overschot
          </text>
        ) : null}
        <text x={grensX + 6} y={SMARGE.boven - 8} className="mark-label" fill="var(--ac)">
          vervangt opwek elders
        </text>

        {klassen.filter((k) => k % 5 === 0).map((k) => (
          <text key={k} x={x(k)} y={SH - 12} textAnchor="middle" className="as-label">
            {klasseOndergrens(k)}{k === TOON_TOT ? "+" : ""} g
          </text>
        ))}
      </svg>
    </figure>
  );
}
