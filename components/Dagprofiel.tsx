"use client";

/**
 * Een dag in detail: wat doet de batterij nu eigenlijk?
 *
 * Drie panelen onder elkaar met een gedeelde tijdas — prijs, lading,
 * netuitwisseling — en één cursor die ze verbindt. De waarden staan in een
 * vaste balk ónder de grafiek, niet in een zwevende tooltip: die dekte precies
 * de data af die je wilde aflezen, en op een telefoon is er helemaal geen ruimte
 * om iets te laten zweven.
 *
 * Het onderste paneel toont twee lijnen. Zonder batterij en met batterij, want
 * het verschil daartussen ís wat de batterij doet. Eerder stond hier alleen de
 * situatie zónder, terwijl het bijschrift het tegenovergestelde beloofde.
 */

import { useEffect, useState } from "react";
import type { SampleDay } from "../lib/model/analysis";
import { centPerKwh, datum, getal } from "../lib/format";
import { Figure, Legenda, kiesTicks } from "./chart-parts";

const B = 760;
/** Elk paneel krijgt een eigen strook, met ruimte voor zijn titel erboven. */
const PANEEL = { prijs: 118, lading: 92, net: 118 };
const TITEL_HOOGTE = 18;
const MARGE = { rechts: 16, links: 86, onder: 26 };

const Y_PRIJS = TITEL_HOOGTE;
const Y_LADING = Y_PRIJS + PANEEL.prijs + TITEL_HOOGTE;
const Y_NET = Y_LADING + PANEEL.lading + TITEL_HOOGTE;
const H_TOTAAL = Y_NET + PANEEL.net + MARGE.onder;

/** Kwartier-kWh naar vermogen in kW: 0,25 kWh in een kwartier is 1 kW. */
const KWH_NAAR_KW = 4;

function lijn(punten: [number, number][]): string {
  return punten.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
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

  // Een zelf opgezochte dag heeft voorrang op de voorbeelden.
  const dag = losseDag ?? voorbeelden[gekozen];

  useEffect(() => setCursor(null), [dag?.date]);

  if (!dag) return null;

  const n = dag.startMs.length;
  const plotB = B - MARGE.links - MARGE.rechts;
  const x = (i: number) => MARGE.links + (i / Math.max(1, n - 1)) * plotB;

  // ── Prijs ──
  const pMin = Math.min(...dag.importPrice, ...dag.exportPrice);
  const pMax = Math.max(...dag.importPrice, ...dag.exportPrice);
  const pTicks = kiesTicks(pMin, pMax, 3);
  const pLo = Math.min(...pTicks, pMin);
  const pHi = Math.max(...pTicks, pMax);
  const yP = (v: number) =>
    Y_PRIJS + (1 - (v - pLo) / Math.max(1e-9, pHi - pLo)) * PANEEL.prijs;

  // ── Lading ──
  const cap = Math.max(dag.usableCapacityKwh, 0.001);
  const ySoc = (v: number) => Y_LADING + (1 - v / cap) * PANEEL.lading;

  // ── Net ──
  const netKw = dag.netKwh.map((v) => v * KWH_NAAR_KW);
  const zonderKw = dag.residualKwh.map((v) => v * KWH_NAAR_KW);
  const nMax = Math.max(...netKw.map(Math.abs), ...zonderKw.map(Math.abs), 0.5);
  const nTicks = kiesTicks(-nMax, nMax, 4);
  const yN = (v: number) => Y_NET + (1 - (v + nMax) / (2 * nMax)) * PANEEL.net;

  const i = cursor;
  const isVoorbeeld = losseDag === null;

  return (
    <Figure
      titel="Wat de batterij op een dag precies doet"
      toelichting={
        <>
          {datum(dag.date)}. Beweeg over de grafiek — of tik erop — voor de
          waarden op elk moment van de dag.
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
          className="chart"
          role="img"
          aria-label={`Prijs, lading en netuitwisseling op ${datum(dag.date)}`}
          onMouseLeave={() => setCursor(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const rel = ((e.clientX - rect.left) / rect.width) * B;
            const k = Math.round(((rel - MARGE.links) / plotB) * (n - 1));
            setCursor(k >= 0 && k < n ? k : null);
          }}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (!t) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const rel = ((t.clientX - rect.left) / rect.width) * B;
            const k = Math.round(((rel - MARGE.links) / plotB) * (n - 1));
            setCursor(k >= 0 && k < n ? k : null);
          }}
        >
          {/* ── Prijs ── */}
          <text x={0} y={Y_PRIJS - 6} className="paneel-titel">
            Prijs per kilowattuur
          </text>
          {pTicks.map((t) => (
            <g key={`p${t}`}>
              <line
                x1={MARGE.links}
                x2={B - MARGE.rechts}
                y1={yP(t)}
                y2={yP(t)}
                stroke={Math.abs(t) < 1e-9 ? "var(--axis)" : "var(--grid)"}
                strokeWidth={Math.abs(t) < 1e-9 ? 1.5 : 1}
              />
              <text
                x={MARGE.links - 10}
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
            d={lijn(dag.importPrice.map((v, k) => [x(k), yP(v)]))}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d={lijn(dag.exportPrice.map((v, k) => [x(k), yP(v)]))}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeDasharray="5 3"
            strokeLinejoin="round"
          />

          {/* ── Lading ── */}
          <text x={0} y={Y_LADING - 6} className="paneel-titel">
            Lading van de batterij
          </text>
          <path
            d={`${lijn(dag.socKwh.map((v, k) => [x(k), ySoc(v)]))} L${x(n - 1)} ${ySoc(0)} L${x(0)} ${ySoc(0)} Z`}
            fill="var(--series-3)"
            opacity={0.18}
          />
          <path
            d={lijn(dag.socKwh.map((v, k) => [x(k), ySoc(v)]))}
            fill="none"
            stroke="var(--series-3)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <line
            x1={MARGE.links}
            x2={B - MARGE.rechts}
            y1={ySoc(0)}
            y2={ySoc(0)}
            stroke="var(--axis)"
            strokeWidth={1}
          />
          <text x={MARGE.links - 10} y={ySoc(cap)} textAnchor="end" dominantBaseline="middle" className="as-label">
            {getal(cap, 1)} kWh
          </text>
          <text x={MARGE.links - 10} y={ySoc(0)} textAnchor="end" dominantBaseline="middle" className="as-label">
            leeg
          </text>

          {/* ── Netuitwisseling ── */}
          <text x={0} y={Y_NET - 6} className="paneel-titel">
            Uitwisseling met het net
          </text>
          {nTicks.map((t) => (
            <line
              key={`n${t}`}
              x1={MARGE.links}
              x2={B - MARGE.rechts}
              y1={yN(t)}
              y2={yN(t)}
              stroke={Math.abs(t) < 1e-9 ? "var(--axis)" : "var(--grid)"}
              strokeWidth={Math.abs(t) < 1e-9 ? 1.5 : 1}
            />
          ))}
          {/* De as zegt in woorden welke kant wat is: een getal alleen laat de
              lezer raden of positief nu afnemen of teruggeven betekent. */}
          <text x={MARGE.links - 10} y={yN(nMax * 0.55)} textAnchor="end" dominantBaseline="middle" className="as-label">
            {getal(nMax * 0.55, 1)} kW eraf
          </text>
          <text x={MARGE.links - 10} y={yN(0)} textAnchor="end" dominantBaseline="middle" className="as-label">
            niets
          </text>
          <text x={MARGE.links - 10} y={yN(-nMax * 0.55)} textAnchor="end" dominantBaseline="middle" className="as-label">
            {getal(nMax * 0.55, 1)} kW erop
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

          {/* ── Tijdas ── */}
          {[0, 3, 6, 9, 12, 15, 18, 21].map((u) => {
            const k = Math.round((u / 24) * (n - 1));
            return (
              <text key={u} x={x(k)} y={H_TOTAAL - 8} textAnchor="middle" className="as-label">
                {String(u).padStart(2, "0")}:00
              </text>
            );
          })}

          {/* ── Cursor ── */}
          {i !== null ? (
            <g pointerEvents="none">
              <line
                x1={x(i)}
                x2={x(i)}
                y1={Y_PRIJS}
                y2={Y_NET + PANEEL.net}
                stroke="var(--text-primary)"
                strokeWidth={1}
                opacity={0.3}
              />
              <circle cx={x(i)} cy={yP(dag.importPrice[i]!)} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
              <circle cx={x(i)} cy={yP(dag.exportPrice[i]!)} r={4} fill="var(--series-2)" stroke="var(--surface-1)" strokeWidth={2} />
              <circle cx={x(i)} cy={ySoc(dag.socKwh[i]!)} r={4} fill="var(--series-3)" stroke="var(--surface-1)" strokeWidth={2} />
              <circle cx={x(i)} cy={yN(netKw[i]!)} r={4} fill="var(--series-4)" stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      </div>

      <Uitlezing dag={dag} i={i} />

      <Legenda
        items={[
          { kleur: "var(--series-1)", label: "prijs bij afname" },
          { kleur: "var(--series-2)", label: "opbrengst bij teruglevering" },
          { kleur: "var(--series-3)", label: "lading van de batterij" },
          { kleur: "var(--series-4)", label: "net, mét batterij" },
          { kleur: "var(--text-muted)", label: "net, zónder batterij" },
        ]}
      />
    </Figure>
  );
}

/**
 * De waarden op het aangewezen moment, in een vaste balk onder de grafiek.
 *
 * Blijft staan als er geen cursor is, met een uitnodiging in plaats van een
 * lege plek: dan springt de pagina niet op en neer bij het bewegen van de muis.
 */
function Uitlezing({ dag, i }: { dag: SampleDay; i: number | null }) {
  if (i === null) {
    return (
      <p className="uitlezing-leeg">
        Beweeg over de grafiek om de waarden per kwartier te zien.
      </p>
    );
  }

  const tijd = new Date(dag.startMs[i]!).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });

  const netKw = dag.netKwh[i]! * KWH_NAAR_KW;
  const laden = dag.chargeKwh[i]! * KWH_NAAR_KW;
  const ontladen = dag.dischargeKwh[i]! * KWH_NAAR_KW;
  const afgeregeld = dag.curtailedKwh[i]! * KWH_NAAR_KW;

  const richting = (kw: number): string =>
    Math.abs(kw) < 0.02
      ? "niets"
      : kw > 0
        ? `${getal(kw, 1)} kW eraf`
        : `${getal(-kw, 1)} kW erop`;

  const watDoetHij =
    laden > 0.02
      ? `laadt met ${getal(laden, 1)} kW`
      : ontladen > 0.02
        ? `levert ${getal(ontladen, 1)} kW`
        : "staat stil";

  return (
    <dl className="uitlezing">
      <div className="uitlezing-tijd">
        <dt>Tijd</dt>
        <dd>{tijd}</dd>
      </div>
      <div>
        <dt><i style={{ background: "var(--series-1)" }} />Afname kost</dt>
        <dd>{centPerKwh(dag.importPrice[i]!)}</dd>
      </div>
      <div>
        <dt><i style={{ background: "var(--series-2)" }} />Teruglevering geeft</dt>
        <dd>{centPerKwh(dag.exportPrice[i]!)}</dd>
      </div>
      <div>
        <dt><i style={{ background: "var(--series-3)" }} />Batterij</dt>
        <dd>
          {getal(dag.socKwh[i]!, 1)} kWh · {watDoetHij}
        </dd>
      </div>
      <div>
        <dt><i style={{ background: "var(--series-4)" }} />Net</dt>
        <dd>
          {richting(netKw)}
          {afgeregeld > 0.02 ? (
            <span className="dd-noot">{getal(afgeregeld, 1)} kW afgeregeld</span>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}
