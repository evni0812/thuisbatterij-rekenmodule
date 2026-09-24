"use client";

/**
 * Wanneer is uitbreiden niet logisch meer?
 *
 * Eén kolom uit de kaart van maten, als lijn: netto resultaat tegen
 * capaciteit, bij het vermogen van jouw batterij (en bij het beste vermogen
 * uit de kaart, als dat een ander is). Waar de lijn afbuigt kost elke extra
 * kilowattuur meer dan hij oplevert; daar staat de streep.
 *
 * Geen eigen rekenwerk: alles komt uit het raster, met de kostenregel en de
 * financiële doorrekening van lib/model/dimensionering.ts.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { GridState } from "../lib/useAnalysis";
import type { Configuration } from "../lib/worker/protocol";
import type { SavingCurvePoint } from "../lib/model/finance";
import {
  RASTER_GRONDSLAG,
  advies,
  dichtsteKolom,
  uitbreidingsstappen,
  type RasterNiveau,
  type Uitbreidingsstap,
} from "../lib/model/dimensionering";
import { euro, euroAs, getal, jaren, procent } from "../lib/format";
import { Figure, Grafiek, Legenda, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const B = 720;
const H = 240;
// Rechts genoeg ruimte voor het laatste aslabel: bij 16 px liep "20 kWh"
// half buiten het kader, want dat label staat gecentreerd op de rechterrand.
const MARGE = { boven: 22, rechts: 38, onder: 34, links: 66 };

export function Uitbreiden({
  grid,
  config,
  curve,
  niveau,
  actie,
}: {
  grid: GridState | null;
  config: Configuration;
  curve: SavingCurvePoint[];
  /** Van het rasterjaar naar het gemiddelde over de volledige jaren (`rasterNiveau`). */
  niveau?: RasterNiveau;
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);

  const kHuidig = grid ? dichtsteKolom(grid.powers, config.battery.maxDischargeKw) : 0;
  const nb = niveau?.besparing ?? 1;
  const nc = niveau?.cycli ?? 1;
  const raad = useMemo(
    () => (grid && grid.klaar ? advies(grid, config, curve, { besparing: nb, cycli: nc }) : null),
    [grid, config, curve, nb, nc],
  );
  const kBeste = grid && raad ? grid.powers.indexOf(raad.beste.powerKw) : kHuidig;
  const huidig = useMemo(
    () => (grid ? uitbreidingsstappen(grid, kHuidig, config, curve, { besparing: nb, cycli: nc }) : null),
    [grid, kHuidig, config, curve, nb, nc],
  );
  const beste = useMemo(
    () =>
      grid && kBeste !== kHuidig
        ? uitbreidingsstappen(grid, kBeste, config, curve, { besparing: nb, cycli: nc })
        : null,
    [grid, kBeste, kHuidig, config, curve, nb, nc],
  );

  if (!grid || !grid.klaar || !huidig || huidig.stappen.length < 2) {
    return (
      <Figure
        actie={actie}
        titel="Tot welke maat loont uitbreiden?"
        toelichting={<>Volgt zodra de kaart van maten klaar is.</>}
      >
        <p className="raster-wacht">De grafiek wordt doorgerekend…</p>
      </Figure>
    );
  }

  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;
  const capMax = Math.max(...grid.capacities);
  const x = (cap: number) => MARGE.links + (cap / capMax) * plotB;

  const reeksen: { naam: string; kleur: string; stappen: Uitbreidingsstap[]; kw: number }[] = [
    { naam: `bij ${getal(grid.powers[kHuidig]!, 1)} kW (jouw vermogen)`, kleur: "var(--series-1)", stappen: huidig.stappen, kw: grid.powers[kHuidig]! },
    ...(beste
      ? [{ naam: `bij ${getal(grid.powers[kBeste]!, 1)} kW (het beste vermogen)`, kleur: "var(--series-2)", stappen: beste.stappen, kw: grid.powers[kBeste]! }]
      : []),
  ];
  const waarden = reeksen.flatMap((r) => r.stappen.map((s) => s.fin.npvEur));
  /*
   * Zeven in plaats van vijf. Het diepste punt van deze curve ligt ver onder
   * nul en bepaalt de schaal; met vijf ticks werd de stap 1.000 en kreeg de
   * hele winstzone geen enkele lijn boven de nul. Je zag dán wel dát 3 kWh het
   * beste was, maar niet waarvéél — precies de vraag van deze figuur.
   */
  const ticks = kiesTicks(Math.min(...waarden, 0), Math.max(...waarden, 0), 7);
  const lo = Math.min(...ticks, ...waarden);
  const hi = Math.max(...ticks, ...waarden);
  const y = (v: number) => MARGE.boven + (hi > lo ? (1 - (v - lo) / (hi - lo)) * plotH : plotH / 2);

  const pad = (stappen: Uitbreidingsstap[]) =>
    stappen.map((s, i) => `${i === 0 ? "M" : "L"}${x(s.capacityKwh)} ${y(s.fin.npvEur)}`).join(" ");

  const top = huidig.stappen.reduce((b, s) => (s.fin.npvEur > b.fin.npvEur ? s : b), huidig.stappen[0]!);
  const omslag = huidig.omslag;
  const totCap = omslag !== null ? huidig.stappen[omslag - 1]!.capacityKwh : null;
  const laatste = huidig.stappen[huidig.stappen.length - 1]!;

  const titel =
    totCap !== null
      ? `Bij jouw vermogen loont uitbreiden tot ${getal(totCap, 1)} kWh`
      : top.fin.npvEur > 0
        ? "Binnen dit raster levert elke stap omhoog nog iets op"
        : "Bij jouw vermogen komt geen enkele capaciteit netto uit de kosten";

  /*
   * Welke aslabels passen? De capaciteiten liggen niet gelijkmatig (2, 3, 5,
   * 7,5, 10, 15, 20) en de as is lineair, dus onderaan staan ze dicht op elkaar.
   * Een label dat te kort op zijn voorganger volgt slaan we over; de laatste
   * krijgt voorrang, want het uiteinde van de schaal moet leesbaar zijn.
   */
  const asLabels: number[] = [];
  for (const cap of grid.capacities) {
    const vorige = asLabels[asLabels.length - 1];
    if (vorige !== undefined && x(cap) - x(vorige) < 38) {
      if (cap !== capMax) continue;
      asLabels.pop();
    }
    asLabels.push(cap);
  }

  // Trefvlakken: de grenzen halverwege tussen de capaciteiten.
  const grenzen = huidig.stappen.map((s, i, arr) => {
    const links = i === 0 ? 0 : (arr[i - 1]!.capacityKwh + s.capacityKwh) / 2;
    const rechts = i === arr.length - 1 ? capMax : (s.capacityKwh + arr[i + 1]!.capacityKwh) / 2;
    return { links: x(links), rechts: x(rechts) };
  });

  return (
    <Figure
      actie={actie}
      titel={titel}
      toelichting={
        <>
          Dezelfde cellen als in de kaart, nu als lijn: wat elke capaciteit
          opbrengt min wat hij kost, over {config.analysisYears} jaar en bij een
          vast vermogen. Zolang de lijn stijgt, verdient een grotere batterij
          zijn meerprijs terug; waar hij afbuigt niet meer. Boven de nullijn
          levert de batterij geld op, eronder kost hij geld.
        </>
      }
    >
      {reeksen.length > 1 ? <Legenda items={reeksen.map((r) => ({ kleur: r.kleur, label: r.naam }))} /> : null}
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setAangewezen(null);
          wis();
        }}
        label="Netto resultaat per capaciteit"
      >
        <svg viewBox={`0 0 ${B} ${H}`} className="chart" role="img" aria-label="Netto resultaat per capaciteit">
          {aangewezen !== null ? (
            <rect
              className="aangewezen"
              x={grenzen[aangewezen]!.links}
              y={MARGE.boven}
              width={grenzen[aangewezen]!.rechts - grenzen[aangewezen]!.links}
              height={plotH}
            />
          ) : null}

          <Raster ticks={ticks} x0={MARGE.links} x1={B - MARGE.rechts} schaal={y} labelBreedte={MARGE.links} formatter={(v) => euroAs(v)} />

          {reeksen.map((r) => (
            <g key={r.naam}>
              <path d={pad(r.stappen)} fill="none" stroke={r.kleur} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {r.stappen.map((s) => (
                <circle key={s.capacityKwh} cx={x(s.capacityKwh)} cy={y(s.fin.npvEur)} r={3.5} fill={r.kleur} />
              ))}
            </g>
          ))}

          {totCap !== null ? (
            <g>
              <line
                x1={x(totCap)}
                x2={x(totCap)}
                y1={MARGE.boven}
                y2={MARGE.boven + plotH}
                stroke="var(--ac)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              {/* Onderlangs en niet bovenaan: daar kruiste het label de top van
                  de curve. Links van de streep is het vlak onder de lijn leeg,
                  want na de omslag daalt hij. Past het daar niet, dan klapt het
                  naar de andere kant. De halo houdt het leesbaar waar het toch
                  een rasterlijn raakt. */}
              <text
                x={x(totCap) + (x(totCap) > B / 2 ? -6 : 6)}
                y={MARGE.boven + plotH - 8}
                textAnchor={x(totCap) > B / 2 ? "end" : "start"}
                className="mark-label op-lijn"
                fill="var(--ac)"
              >
                vanaf hier kost uitbreiden geld
              </text>
            </g>
          ) : null}

          {asLabels.map((cap) => (
            <text key={cap} x={x(cap)} y={H - 12} textAnchor="middle" className="as-label">
              {getal(cap, 1)} kWh
            </text>
          ))}

          {huidig.stappen.map((s, i) => (
            <Trefvlak
              key={s.capacityKwh}
              x={grenzen[i]!.links}
              y={MARGE.boven}
              breedte={grenzen[i]!.rechts - grenzen[i]!.links}
              hoogte={plotH}
              onWijs={(punt) => {
                setAangewezen(i);
                toon(punt, {
                  titel: `${getal(s.capacityKwh, 1)} kWh`,
                  regels: [
                    ...reeksen.map((r, ri) => {
                      const st = r.stappen.find((q) => q.capacityKwh === s.capacityKwh);
                      return {
                        kleur: r.kleur,
                        label: `Netto bij ${getal(r.kw, 1)} kW`,
                        waarde: st ? euro(st.fin.npvEur) : "—",
                        uitkomst: ri === 0,
                      };
                    }),
                    { label: "Investering", waarde: euro(s.fin.investeringEur) },
                    { label: "Terugverdientijd", waarde: jaren(s.fin.paybackYears) },
                    ...(s.marginaalPerKwh !== null
                      ? [{ label: "Per extra kWh sinds de vorige stap", waarde: euro(s.marginaalPerKwh) }]
                      : []),
                  ],
                  noot:
                    omslag !== null && i === omslag
                      ? "Vanaf deze stap kost elke extra kilowattuur meer dan hij oplevert."
                      : undefined,
                });
              }}
              onWis={() => {
                setAangewezen(null);
                wis();
              }}
            />
          ))}
        </svg>
      </Grafiek>

      {/*
        De drie cijfers volgen de vraag: waar ligt het optimum, wat kost de stap
        erna, en hoe duur wordt doorschieten?

        Hier stond eerder "de laatste stap in het raster: € -321 per extra kWh"
        naast "de stap naar 5 kWh kost € 1,69 per kilowattuur". Allebei klopten
        ze — vlak na de top is de marginale opbrengst bijna nul en helemaal
        rechts stort hij in — maar naast elkaar, zonder die uitleg, lazen ze als
        twee bedragen die elkaar tegenspreken. Hele bedragen bij een hele maat
        zijn te controleren aan de lijn erboven.
      */}
      <dl className="kerncijfers">
        <div>
          <dt>Beste capaciteit bij jouw vermogen</dt>
          <dd className={top.fin.npvEur >= 0 ? "goed" : "slecht"}>
            {getal(top.capacityKwh, 1)} kWh
            <span className="dd-noot">
              {euro(top.fin.npvEur)} over {config.analysisYears} jaar, na aftrek van de{" "}
              {procent(config.discountRate, 1)} rente die je misloopt
            </span>
          </dd>
        </div>
        <div>
          <dt>Eén maat groter</dt>
          {omslag !== null && omslag > 0 ? (
            <dd>
              {getal(huidig.stappen[omslag]!.capacityKwh, 1)} kWh
              <span className="dd-noot">
                levert {euro(huidig.stappen[omslag - 1]!.fin.npvEur - huidig.stappen[omslag]!.fin.npvEur)} minder
                op dan {getal(huidig.stappen[omslag - 1]!.capacityKwh, 1)} kWh, terwijl hij meer kost
              </span>
            </dd>
          ) : (
            <dd>
              levert nog iets op
              <span className="dd-noot">binnen dit raster buigt de lijn nergens naar beneden af</span>
            </dd>
          )}
        </div>
        <div>
          <dt>De grootste maat in het raster</dt>
          <dd className={laatste.fin.npvEur >= 0 ? "goed" : "slecht"}>
            {euro(laatste.fin.npvEur)}
            <span className="dd-noot">
              wat {getal(laatste.capacityKwh, 1)} kWh netto zou opleveren: zo duur is doorschieten
            </span>
          </dd>
        </div>
      </dl>
      <p className="posten-noot">{RASTER_GRONDSLAG}</p>
    </Figure>
  );
}
