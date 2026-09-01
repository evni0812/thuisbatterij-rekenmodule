"use client";

/**
 * Een dag in detail: wat doet de batterij nu eigenlijk?
 *
 * ── Waarom deze vorm ────────────────────────────────────────────────────────
 * Drie panelen boven elkaar met één gedeelde tijdas. Ze delen de x-as maar niet
 * de y-as, want prijs, lading en vermogen zijn drie verschillende grootheden.
 * Ze in één plot proppen zou een dubbele y-as vragen, en die verzint een verband
 * dat er niet is.
 *
 * Elk paneel draagt zijn eigen labels aan de rechterkant van de lijnen, zodat je
 * nergens kleuren hoeft te matchen met een legenda. Dat scheelt ook de legenda
 * zelf: het middelste paneel heeft één lijn en de andere twee, allemaal ter
 * plekke benoemd.
 *
 * De ruimte is strikt verdeeld in drie kolommen — as-labels, plot, lijnlabels —
 * en niets mag daarbuiten treden. Eerder stonden de paneeltitels op x=0 en
 * liepen ze dwars over de as-labels heen.
 */

import { useEffect, useState } from "react";
import type { SampleDay } from "../lib/model/analysis";
import { centPerKwh, datum, getal } from "../lib/format";
import { Figure, kiesTicks } from "./chart-parts";

const B = 780;

/** Kolomindeling: as-labels | plot | lijnlabels. Niets treedt buiten zijn kolom. */
const AS_BREEDTE = 62;
const LABEL_BREEDTE = 132;
const PLOT_LINKS = AS_BREEDTE;
const PLOT_RECHTS = B - LABEL_BREEDTE;
const PLOT_BREEDTE = PLOT_RECHTS - PLOT_LINKS;

/** Ruimte boven elk paneel voor zijn titel, en de hoogte van het paneel zelf. */
const TITEL_RUIMTE = 30;
const HOOGTE = { prijs: 112, actie: 118, lading: 62, net: 112 };
const TIJDAS_HOOGTE = 28;

/**
 * De panelen staan in de volgorde van het verhaal: de prijs geeft de aanleiding,
 * de acties zijn wat de batterij doet, de lading is het gevolg daarvan, en het
 * net is het resultaat voor jou. De lading sluit direct aan op de acties, want
 * de helling van die lijn ís de optelsom van de staven erboven.
 */
const Y = {
  prijs: TITEL_RUIMTE,
  actie: TITEL_RUIMTE + HOOGTE.prijs + TITEL_RUIMTE,
  lading: TITEL_RUIMTE + HOOGTE.prijs + TITEL_RUIMTE + HOOGTE.actie + 20,
  net:
    TITEL_RUIMTE +
    HOOGTE.prijs +
    TITEL_RUIMTE +
    HOOGTE.actie +
    20 +
    HOOGTE.lading +
    TITEL_RUIMTE,
};
const H_TOTAAL = Y.net + HOOGTE.net + TIJDAS_HOOGTE;

/** Kwartier-kWh naar vermogen in kW: 0,25 kWh in een kwartier is 1 kW. */
const KWH_NAAR_KW = 4;

/** Minimale verticale afstand tussen twee lijnlabels, in SVG-eenheden. */
const LABEL_MIN_AFSTAND = 15;

function lijn(punten: [number, number][]): string {
  return punten.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

/**
 * Splits elke laad- en ontlaadactie uit naar herkomst en bestemming.
 *
 * Dat is exact af te leiden en het is precies wat het verhaal draagt: laden uit
 * je eigen overschot is iets heel anders dan inkopen van het net, en ontladen
 * voor eigen gebruik levert veel meer op dan terugverkopen.
 *
 *   laden  — zolang er overschot is, komt de lading daaruit; wat je meer laadt
 *            dan er over is, koop je in
 *   ontladen — zolang er tekort is, gaat de lading daarheen; wat je meer ontlaadt
 *            dan je zelf verbruikt, gaat het net op
 */
function splitsActies(dag: SampleDay): {
  uitZon: number[];
  uitNet: number[];
  naarHuis: number[];
  naarNet: number[];
} {
  const uitZon: number[] = [];
  const uitNet: number[] = [];
  const naarHuis: number[] = [];
  const naarNet: number[] = [];

  for (let i = 0; i < dag.startMs.length; i++) {
    const laden = dag.chargeKwh[i]!;
    const ontladen = dag.dischargeKwh[i]!;
    const overschot = Math.max(0, -dag.residualKwh[i]!);
    const tekort = Math.max(0, dag.residualKwh[i]!);

    const zon = Math.min(laden, overschot);
    uitZon.push(zon * KWH_NAAR_KW);
    uitNet.push((laden - zon) * KWH_NAAR_KW);

    const huis = Math.min(ontladen, tekort);
    naarHuis.push(huis * KWH_NAAR_KW);
    naarNet.push((ontladen - huis) * KWH_NAAR_KW);
  }
  return { uitZon, uitNet, naarHuis, naarNet };
}

/**
 * Duw labels uit elkaar die anders over elkaar heen zouden vallen.
 *
 * Alleen verticaal en alleen zover als nodig; ze blijven zo dicht mogelijk bij
 * het uiteinde van hun eigen lijn, zodat de koppeling zichtbaar blijft.
 */
function ontvlecht(posities: number[]): number[] {
  const volgorde = posities
    .map((y, i) => ({ y, i }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < volgorde.length; k++) {
    const vorige = volgorde[k - 1]!;
    const huidige = volgorde[k]!;
    if (huidige.y - vorige.y < LABEL_MIN_AFSTAND) {
      huidige.y = vorige.y + LABEL_MIN_AFSTAND;
    }
  }
  const uit = [...posities];
  for (const { y, i } of volgorde) uit[i] = y;
  return uit;
}

/** Eén lijnlabel rechts van de plot, met een verbindingsstreepje. */
function LijnLabel({
  y,
  yLijn,
  kleur,
  naam,
  waarde,
  gestippeld,
}: {
  y: number;
  yLijn: number;
  kleur: string;
  naam: string;
  waarde: string;
  gestippeld?: boolean;
}) {
  const x = PLOT_RECHTS + 8;
  return (
    <g>
      {/* Leader line: houdt het label verbonden met zijn lijn als het is
          weggeduwd om overlap te voorkomen. */}
      <path
        d={`M${PLOT_RECHTS} ${yLijn} L${x - 4} ${y}`}
        fill="none"
        stroke={kleur}
        strokeWidth={1}
        opacity={0.5}
      />
      <rect x={x} y={y - 5} width={9} height={2.5} rx={1.25} fill={kleur} />
      {gestippeld ? (
        <rect x={x + 3.5} y={y - 5} width={2} height={2.5} fill="var(--surface-1)" />
      ) : null}
      <text x={x + 14} y={y - 1} className="lijn-label">
        {naam}
      </text>
      <text x={x + 14} y={y + 11} className="lijn-waarde">
        {waarde}
      </text>
    </g>
  );
}

export function Dagprofiel({
  voorbeelden,
  losseDag,
  ontbreekt,
  eersteDag,
  laatsteDag,
  onVraagDag,
  onWisDag,
}: {
  voorbeelden: SampleDay[];
  losseDag: SampleDay | null;
  ontbreekt: string | null;
  eersteDag: string;
  laatsteDag: string;
  onVraagDag: (datum: string) => void;
  onWisDag: () => void;
}) {
  const [gekozen, setGekozen] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  const dag = losseDag ?? voorbeelden[gekozen];
  useEffect(() => setCursor(null), [dag?.date]);
  if (!dag) return null;

  const n = dag.startMs.length;
  const x = (i: number) => PLOT_LINKS + (i / Math.max(1, n - 1)) * PLOT_BREEDTE;
  const laatste = n - 1;

  // ── Paneel 1: prijs ──
  const pMin = Math.min(...dag.importPrice, ...dag.exportPrice);
  const pMax = Math.max(...dag.importPrice, ...dag.exportPrice);
  const pTicks = kiesTicks(pMin, pMax, 3);
  const pLo = Math.min(...pTicks, pMin);
  const pHi = Math.max(...pTicks, pMax);
  const yP = (v: number) =>
    Y.prijs + (1 - (v - pLo) / Math.max(1e-9, pHi - pLo)) * HOOGTE.prijs;

  // ── Paneel 2: wat de batterij doet ──
  const acties = splitsActies(dag);
  const aMax = Math.max(
    ...acties.uitZon.map((v, k) => v + acties.uitNet[k]!),
    ...acties.naarHuis.map((v, k) => v + acties.naarNet[k]!),
    0.2,
  );
  const yA = (v: number) => Y.actie + (1 - (v + aMax) / (2 * aMax)) * HOOGTE.actie;
  const staafB = Math.max(2, (PLOT_BREEDTE / n) * 0.8);

  // Totalen over de dag, voor de labels: die dragen het verhaal van dit paneel.
  const som = (a: number[]) => a.reduce((x, y) => x + y, 0) / KWH_NAAR_KW;
  const totaalZon = som(acties.uitZon);
  const totaalNet = som(acties.uitNet);
  const totaalHuis = som(acties.naarHuis);
  const totaalVerkocht = som(acties.naarNet);

  // ── Paneel 3: lading ──
  const cap = Math.max(dag.usableCapacityKwh, 0.001);
  const yS = (v: number) => Y.lading + (1 - v / cap) * HOOGTE.lading;
  const socMax = Math.max(...dag.socKwh);

  // ── Paneel 3: netuitwisseling ──
  const netKw = dag.netKwh.map((v) => v * KWH_NAAR_KW);
  const zonderKw = dag.residualKwh.map((v) => v * KWH_NAAR_KW);
  const nMax = Math.max(...netKw.map(Math.abs), ...zonderKw.map(Math.abs), 0.5);
  const nTicks = kiesTicks(-nMax, nMax, 4).filter((t) => Math.abs(t) > 1e-9);
  const yN = (v: number) => Y.net + (1 - (v + nMax) / (2 * nMax)) * HOOGTE.net;

  // Lijnlabels ontvlechten per paneel.
  const [yAfname, yTerug] = ontvlecht([
    yP(dag.importPrice[laatste]!),
    yP(dag.exportPrice[laatste]!),
  ]) as [number, number];
  const [yMet, yZonder] = ontvlecht([
    yN(netKw[laatste]!),
    yN(zonderKw[laatste]!),
  ]) as [number, number];

  const i = cursor;
  const isVoorbeeld = losseDag === null;

  const paneelTitel = (y: number, tekst: string, extra?: string) => (
    <>
      <text x={PLOT_LINKS} y={y - 12} className="paneel-titel">
        {tekst}
      </text>
      {extra ? (
        <text x={PLOT_RECHTS} y={y - 12} textAnchor="end" className="paneel-noot">
          {extra}
        </text>
      ) : null}
    </>
  );

  return (
    <Figure
      titel="Wat de batterij op een dag precies doet"
      toelichting={
        <>
          {datum(dag.date)}. Beweeg over de grafiek — of tik erop — voor de
          waarden op elk kwartier.
        </>
      }
      actie={
        <div className="dagkiezer">
          {voorbeelden.length > 1 ? (
            <div className="segment" role="tablist" aria-label="Kies een dag">
              {voorbeelden.map((d, k) => (
                <button
                  key={d.label}
                  role="tab"
                  aria-selected={isVoorbeeld && k === gekozen}
                  className={
                    isVoorbeeld && k === gekozen
                      ? "segment-knop actief"
                      : "segment-knop"
                  }
                  onClick={() => {
                    setGekozen(k);
                    onWisDag();
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ) : null}
          <label className="dagkiezer-datum">
            <span>of een dag naar keuze</span>
            <input
              type="date"
              min={eersteDag}
              max={laatsteDag}
              value={losseDag?.date ?? ""}
              onChange={(e) =>
                e.target.value ? onVraagDag(e.target.value) : onWisDag()
              }
            />
          </label>
        </div>
      }
    >
      {ontbreekt ? (
        <p className="dag-melding">
          Voor {datum(ontbreekt)} zijn geen gegevens in de gekozen periode. Kies
          een dag tussen {datum(eersteDag)} en {datum(laatsteDag)}.
        </p>
      ) : null}

      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${B} ${H_TOTAAL}`}
          className="chart dagprofiel-svg"
          role="img"
          aria-label={`Prijs, lading en netuitwisseling op ${datum(dag.date)}`}
          onMouseLeave={() => setCursor(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const rel = ((e.clientX - rect.left) / rect.width) * B;
            const k = Math.round(((rel - PLOT_LINKS) / PLOT_BREEDTE) * (n - 1));
            setCursor(k >= 0 && k < n ? k : null);
          }}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (!t) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const rel = ((t.clientX - rect.left) / rect.width) * B;
            const k = Math.round(((rel - PLOT_LINKS) / PLOT_BREEDTE) * (n - 1));
            setCursor(k >= 0 && k < n ? k : null);
          }}
        >
          {/* ══ Paneel 1: prijs ══ */}
          {paneelTitel(Y.prijs, "Prijs per kilowattuur")}
          {pTicks.map((t) => (
            <g key={`p${t}`}>
              <line
                x1={PLOT_LINKS}
                x2={PLOT_RECHTS}
                y1={yP(t)}
                y2={yP(t)}
                stroke={Math.abs(t) < 1e-9 ? "var(--axis)" : "var(--grid)"}
              />
              <text
                x={PLOT_LINKS - 10}
                y={yP(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="as-label"
              >
                {centPerKwh(t)}
              </text>
            </g>
          ))}
          <path
            d={lijn(dag.exportPrice.map((v, k) => [x(k), yP(v)]))}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeDasharray="5 3"
            strokeLinejoin="round"
          />
          <path
            d={lijn(dag.importPrice.map((v, k) => [x(k), yP(v)]))}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <LijnLabel
            y={yAfname}
            yLijn={yP(dag.importPrice[laatste]!)}
            kleur="var(--series-1)"
            naam="je betaalt"
            waarde={centPerKwh(dag.importPrice[laatste]!)}
          />
          <LijnLabel
            y={yTerug}
            yLijn={yP(dag.exportPrice[laatste]!)}
            kleur="var(--series-2)"
            naam="je krijgt"
            waarde={centPerKwh(dag.exportPrice[laatste]!)}
            gestippeld
          />

          {/* ══ Paneel 2: wat de batterij doet ══ */}
          {paneelTitel(Y.actie, "Wat de batterij doet")}
          <line x1={PLOT_LINKS} x2={PLOT_RECHTS} y1={yA(aMax / 2)} y2={yA(aMax / 2)} stroke="var(--grid)" />
          <line x1={PLOT_LINKS} x2={PLOT_RECHTS} y1={yA(-aMax / 2)} y2={yA(-aMax / 2)} stroke="var(--grid)" />
          {dag.startMs.map((_, k) => {
            const zon = acties.uitZon[k]!;
            const net = acties.uitNet[k]!;
            const huis = acties.naarHuis[k]!;
            const verkocht = acties.naarNet[k]!;
            const xk = x(k) - staafB / 2;
            const nul = yA(0);
            return (
              <g key={k}>
                {/* Omhoog: erin. Onderop wat uit eigen overschot komt, daarboven
                    wat is ingekocht — de volgorde is de voorkeursvolgorde. */}
                {zon > 0.001 ? (
                  <rect x={xk} y={yA(zon)} width={staafB} height={nul - yA(zon)} fill="var(--series-3)" />
                ) : null}
                {net > 0.001 ? (
                  <rect x={xk} y={yA(zon + net)} width={staafB} height={yA(zon) - yA(zon + net)} fill="var(--series-1)" />
                ) : null}
                {/* Omlaag: eruit. */}
                {huis > 0.001 ? (
                  <rect x={xk} y={nul} width={staafB} height={yA(-huis) - nul} fill="var(--series-3)" />
                ) : null}
                {verkocht > 0.001 ? (
                  <rect x={xk} y={yA(-huis)} width={staafB} height={yA(-huis - verkocht) - yA(-huis)} fill="var(--series-2)" />
                ) : null}
              </g>
            );
          })}
          <line x1={PLOT_LINKS} x2={PLOT_RECHTS} y1={yA(0)} y2={yA(0)} stroke="var(--axis)" strokeWidth={1.5} />
          <text x={PLOT_LINKS - 10} y={Y.actie + 12} textAnchor="end" className="as-label">
            erin
          </text>
          <text x={PLOT_LINKS - 10} y={yA(aMax / 2)} textAnchor="end" dominantBaseline="middle" className="as-label">
            {getal(aMax / 2, 1)} kW
          </text>
          <text x={PLOT_LINKS - 10} y={yA(0)} textAnchor="end" dominantBaseline="middle" className="as-label">
            0
          </text>
          <text x={PLOT_LINKS - 10} y={yA(-aMax / 2)} textAnchor="end" dominantBaseline="middle" className="as-label">
            {getal(aMax / 2, 1)} kW
          </text>
          <text x={PLOT_LINKS - 10} y={Y.actie + HOOGTE.actie - 4} textAnchor="end" className="as-label">
            eruit
          </text>

          {/* De dagtotalen dragen dit paneel: niet elk staafje telt, maar wel
              hoeveel er die dag in totaal is opgeslagen en waar het heen ging. */}
          <g className="actie-legende">
            {[
              { kleur: "var(--series-3)", naam: "uit eigen zon", waarde: totaalZon, y: Y.actie + 14 },
              { kleur: "var(--series-1)", naam: "ingekocht", waarde: totaalNet, y: Y.actie + 32 },
              { kleur: "var(--series-3)", naam: "zelf gebruikt", waarde: totaalHuis, y: Y.actie + HOOGTE.actie - 30 },
              { kleur: "var(--series-2)", naam: "verkocht", waarde: totaalVerkocht, y: Y.actie + HOOGTE.actie - 12 },
            ].map((r) =>
              r.waarde > 0.01 ? (
                <g key={r.naam}>
                  <rect x={PLOT_RECHTS + 8} y={r.y - 8} width={9} height={9} rx={2} fill={r.kleur} />
                  <text x={PLOT_RECHTS + 22} y={r.y} className="lijn-label">
                    {r.naam}
                  </text>
                  <text x={PLOT_RECHTS + 22} y={r.y + 12} className="lijn-waarde">
                    {getal(r.waarde, 2)} kWh
                  </text>
                </g>
              ) : null,
            )}
          </g>

          {/* ══ Paneel 3: lading ══ */}
          {paneelTitel(Y.lading, "Hoe vol hij daardoor is", `${getal(cap, 1)} kWh bruikbaar`)}
          <line
            x1={PLOT_LINKS}
            x2={PLOT_RECHTS}
            y1={yS(cap)}
            y2={yS(cap)}
            stroke="var(--grid)"
          />
          <path
            d={`${lijn(dag.socKwh.map((v, k) => [x(k), yS(v)]))} L${x(laatste)} ${yS(0)} L${x(0)} ${yS(0)} Z`}
            fill="var(--series-3)"
            opacity={0.18}
          />
          <path
            d={lijn(dag.socKwh.map((v, k) => [x(k), yS(v)]))}
            fill="none"
            stroke="var(--series-3)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <line x1={PLOT_LINKS} x2={PLOT_RECHTS} y1={yS(0)} y2={yS(0)} stroke="var(--axis)" />
          <text x={PLOT_LINKS - 10} y={yS(cap)} textAnchor="end" dominantBaseline="middle" className="as-label">
            vol
          </text>
          <text x={PLOT_LINKS - 10} y={yS(0)} textAnchor="end" dominantBaseline="middle" className="as-label">
            leeg
          </text>
          {/* Het hoogste punt is het verhaal van dit paneel: hoe vol werd hij? */}
          {socMax > cap * 0.05 ? (
            <g>
              <rect x={PLOT_RECHTS + 8} y={yS(socMax) - 8} width={9} height={9} rx={2} fill="var(--series-3)" />
              <text x={PLOT_RECHTS + 22} y={yS(socMax)} className="lijn-label">
                hoogste stand
              </text>
              <text x={PLOT_RECHTS + 22} y={yS(socMax) + 12} className="lijn-waarde">
                {getal(socMax, 1)} kWh
              </text>
            </g>
          ) : null}

          {/* ══ Paneel 3: netuitwisseling ══ */}
          {paneelTitel(Y.net, "Uitwisseling met het net")}
          {nTicks.map((t) => (
            <line
              key={`n${t}`}
              x1={PLOT_LINKS}
              x2={PLOT_RECHTS}
              y1={yN(t)}
              y2={yN(t)}
              stroke="var(--grid)"
            />
          ))}
          <line x1={PLOT_LINKS} x2={PLOT_RECHTS} y1={yN(0)} y2={yN(0)} stroke="var(--axis)" strokeWidth={1.5} />
          {/* De as zegt in woorden welke kant wat is: een getal alleen laat de
              lezer raden of positief nu afnemen of teruggeven betekent. */}
          <text x={PLOT_LINKS - 10} y={Y.net + 12} textAnchor="end" className="as-label">
            afnemen
          </text>
          <text x={PLOT_LINKS - 10} y={yN(0)} textAnchor="end" dominantBaseline="middle" className="as-label">
            0 kW
          </text>
          <text x={PLOT_LINKS - 10} y={Y.net + HOOGTE.net - 4} textAnchor="end" className="as-label">
            terugleveren
          </text>

          <path
            d={lijn(zonderKw.map((v, k) => [x(k), yN(v)]))}
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <path
            d={lijn(netKw.map((v, k) => [x(k), yN(v)]))}
            fill="none"
            stroke="var(--series-4)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <LijnLabel
            y={yMet}
            yLijn={yN(netKw[laatste]!)}
            kleur="var(--series-4)"
            naam="mét batterij"
            waarde={`${getal(Math.abs(netKw[laatste]!), 1)} kW`}
          />
          <LijnLabel
            y={yZonder}
            yLijn={yN(zonderKw[laatste]!)}
            kleur="var(--text-muted)"
            naam="zónder batterij"
            waarde={`${getal(Math.abs(zonderKw[laatste]!), 1)} kW`}
            gestippeld
          />

          {/* ══ Tijdas ══ */}
          {[0, 3, 6, 9, 12, 15, 18, 21].map((u) => {
            const k = Math.round((u / 24) * (n - 1));
            return (
              <text key={u} x={x(k)} y={H_TOTAAL - 9} textAnchor="middle" className="as-label">
                {String(u).padStart(2, "0")}:00
              </text>
            );
          })}

          {/* ══ Cursor ══ */}
          {i !== null ? (
            <g pointerEvents="none">
              <line
                x1={x(i)}
                x2={x(i)}
                y1={Y.prijs}
                y2={Y.net + HOOGTE.net}
                stroke="var(--text-primary)"
                strokeWidth={1}
                opacity={0.28}
              />
              <circle cx={x(i)} cy={yP(dag.importPrice[i]!)} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
              <circle cx={x(i)} cy={yP(dag.exportPrice[i]!)} r={4} fill="var(--series-2)" stroke="var(--surface-1)" strokeWidth={2} />
              <circle cx={x(i)} cy={yS(dag.socKwh[i]!)} r={4} fill="var(--series-3)" stroke="var(--surface-1)" strokeWidth={2} />
              <circle cx={x(i)} cy={yN(netKw[i]!)} r={4} fill="var(--series-4)" stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      </div>

      <Uitlezing dag={dag} i={i} />
    </Figure>
  );
}

/**
 * De waarden op het aangewezen moment.
 *
 * Vaste hoogte, ook zonder cursor: anders springt de pagina op en neer zodra je
 * de muis over de grafiek beweegt.
 */
function Uitlezing({ dag, i }: { dag: SampleDay; i: number | null }) {
  if (i === null) {
    return (
      <p className="uitlezing-leeg">
        Beweeg over de grafiek om per kwartier te zien wat er gebeurt.
      </p>
    );
  }

  const tijd = new Date(dag.startMs[i]!).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });

  const netKw = dag.netKwh[i]! * KWH_NAAR_KW;
  const afgeregeld = dag.curtailedKwh[i]! * KWH_NAAR_KW;
  const a = splitsActies(dag);

  const netTekst =
    Math.abs(netKw) < 0.02
      ? "niets"
      : netKw > 0
        ? `${getal(netKw, 1)} kW afnemen`
        : `${getal(-netKw, 1)} kW terugleveren`;

  // Zeg niet alleen dát hij laadt, maar waarvandaan en waarheen: dat is het
  // verschil tussen zelf verbruiken en handelen, en dus tussen veel en weinig
  // opbrengst.
  const zon = a.uitZon[i]!;
  const uitNet = a.uitNet[i]!;
  const huis = a.naarHuis[i]!;
  const verkocht = a.naarNet[i]!;
  let batterijTekst = "staat stil";
  if (zon + uitNet > 0.02) {
    const delen: string[] = [];
    if (zon > 0.02) delen.push(`${getal(zon, 1)} kW uit eigen zon`);
    if (uitNet > 0.02) delen.push(`${getal(uitNet, 1)} kW ingekocht`);
    batterijTekst = `laadt ${delen.join(" en ")}`;
  } else if (huis + verkocht > 0.02) {
    const delen: string[] = [];
    if (huis > 0.02) delen.push(`${getal(huis, 1)} kW voor eigen gebruik`);
    if (verkocht > 0.02) delen.push(`${getal(verkocht, 1)} kW verkocht`);
    batterijTekst = `levert ${delen.join(" en ")}`;
  }

  return (
    <div className="uitlezing">
      <span className="uitlezing-tijd">{tijd}</span>
      <span className="uitlezing-item">
        <i style={{ background: "var(--series-1)" }} />
        afname {centPerKwh(dag.importPrice[i]!)}
      </span>
      <span className="uitlezing-item">
        <i style={{ background: "var(--series-2)" }} />
        teruglevering {centPerKwh(dag.exportPrice[i]!)}
      </span>
      <span className="uitlezing-item">
        <i style={{ background: "var(--series-3)" }} />
        {batterijTekst} · {getal(dag.socKwh[i]!, 1)} kWh in de accu
      </span>
      <span className="uitlezing-item">
        <i style={{ background: "var(--series-4)" }} />
        {netTekst}
        {afgeregeld > 0.02 ? ` · ${getal(afgeregeld, 1)} kW afgeregeld` : ""}
      </span>
    </div>
  );
}
