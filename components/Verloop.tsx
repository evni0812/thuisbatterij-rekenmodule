"use client";

/**
 * Het resultaat over een periode: een maand per dag, een jaar per week. De stap
 * omhoog vanaf het dagprofiel, met dezelfde dispatch.
 *
 * De week zat hier ook, als staafjes per uur. Die is naar het dagprofiel
 * verhuisd: daar staat al wat de batterij binnen een dag uitvoert, en een week
 * per uur hoort bij dat verhaal in plaats van bij het optellen over maanden en
 * jaren. Wat hier overblijft is de vraag hoe het over langere tijd uitpakt.
 *
 * Per vak één ding: wat de batterij die periode opleverde.
 *
 * De slijtage stond hier eerst als grijs blokje onder elke staaf en in de kop.
 * Dat gaf haar een gewicht dat ze niet heeft: het is afschrijving op een
 * investering die al gedaan is, niet iets wat je die week betaalt. Ze staat nu
 * als één getal onder de grafiek, waar ze thuishoort — goed om te weten,
 * secundair aan de vraag wat de batterij oplevert.
 *
 * Een klik op een dag opent die dag in het dagprofiel eronder.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { datum, euro, euroPrecies, getal, kwh } from "../lib/format";
import { dagenLater, type PeriodeReeks, type PeriodeVak, type Resolutie } from "../lib/model/periode";
import { Figure, Legenda } from "./chart-parts";

export type Weergave = "maand" | "jaar";

const WEERGAVEN: { id: Weergave; label: string; resolutie: Resolutie; per: string }[] = [
  { id: "maand", label: "Maand", resolutie: "dag", per: "per dag" },
  { id: "jaar", label: "Jaar", resolutie: "week", per: "per week" },
];

const MAANDEN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** Begin en einde (inclusief) van de periode waar `anker` in valt. */
export function periodeVan(weergave: Weergave, anker: string): { van: string; tot: string } {
  const [y, m] = anker.split("-").map(Number) as [number, number];
  if (weergave === "maand") {
    const van = `${y}-${String(m).padStart(2, "0")}-01`;
    const laatste = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { van, tot: `${y}-${String(m).padStart(2, "0")}-${String(laatste).padStart(2, "0")}` };
  }
  return { van: `${y}-01-01`, tot: `${y}-12-31` };
}

/** Eén periode verder of terug. */
function verschuif(weergave: Weergave, anker: string, richting: 1 | -1): string {
  const [y, m, d] = anker.split("-").map(Number) as [number, number, number];
  if (weergave === "maand") {
    const dt = new Date(Date.UTC(y, m - 1 + richting, 1));
    return dt.toISOString().slice(0, 10);
  }
  return `${y + richting}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function periodeLabel(weergave: Weergave, van: string, tot: string): string {
  if (weergave === "maand") {
    const [y, m] = van.split("-").map(Number) as [number, number];
    return `${["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"][m - 1]} ${y}`;
  }
  return van.slice(0, 4);
}

const B = 840;
const H = 250;
const MARGE = { boven: 18, rechts: 16, onder: 30, links: 58 };

export function Verloop({
  periode,
  bezig,
  eersteDag,
  laatsteDag,
  onVraag,
  onKiesDag,
  actie,
}: {
  periode: PeriodeReeks | null;
  bezig: boolean;
  /** De grenzen van de data, om niet buiten de periode te kunnen bladeren. */
  eersteDag: string;
  laatsteDag: string;
  onVraag: (van: string, tot: string, resolutie: Resolutie) => void;
  /** Een klik op een dag: open die dag in het dagprofiel. */
  onKiesDag: (datum: string) => void;
  actie?: ReactNode;
}) {
  const [weergave, setWeergave] = useState<Weergave>("maand");
  const [anker, setAnker] = useState<string>(laatsteDag);

  // Nieuwe data: terug naar het einde ervan.
  useEffect(() => {
    setAnker(laatsteDag);
  }, [laatsteDag]);

  const bereik = useMemo(() => periodeVan(weergave, anker), [weergave, anker]);
  const resolutie = WEERGAVEN.find((w) => w.id === weergave)!.resolutie;

  useEffect(() => {
    if (!eersteDag || !laatsteDag) return;
    onVraag(bereik.van, bereik.tot, resolutie);
    // onVraag verandert met de configuratie; dat is precies wanneer opnieuw vragen moet.
  }, [bereik.van, bereik.tot, resolutie, onVraag, eersteDag, laatsteDag]);

  const kanTerug = bereik.van > eersteDag;
  const kanVooruit = bereik.tot < laatsteDag;
  const past = periode && periode.resolutie === resolutie && periode.van >= bereik.van && periode.tot <= dagenLater(bereik.tot, 6);
  const vakken: PeriodeVak[] = past ? periode.vakken : [];

  // Schaal: de besparing omhoog, en alleen omlaag als een periode geld kóstte.
  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;
  const hoogste = Math.max(0.01, ...vakken.map((v) => v.savingEur));
  const laagste = Math.min(0, ...vakken.map((v) => v.savingEur));
  const span = hoogste - laagste || 1;
  const y = (v: number) => MARGE.boven + ((hoogste - v) / span) * plotH;
  const nul = y(0);
  const slot = vakken.length > 0 ? plotB / vakken.length : plotB;
  const staaf = Math.max(1, Math.min(slot * 0.7, 40));
  const x = (i: number) => MARGE.links + i * slot + (slot - staaf) / 2;

  // As-labels: per dag in de week, om de vijf dagen in de maand, per maand in het jaar.
  const labels: { x: number; tekst: string }[] = [];
  vakken.forEach((v, i) => {
    if (resolutie === "dag") {
      const d = Number(v.dag.slice(8));
      if (d === 1 || d % 5 === 0) labels.push({ x: x(i) + staaf / 2, tekst: String(d) });
    } else {
      const vorige = vakken[i - 1];
      if (!vorige || vorige.dag.slice(5, 7) !== v.dag.slice(5, 7)) {
        // De eerste week van elke maand krijgt de maandnaam, als de maandag er nog in valt.
        const m = Number(dagenLater(v.dag, 6).slice(5, 7));
        labels.push({ x: x(i), tekst: MAANDEN[m - 1]! });
      }
    }
  });

  const t = periode?.totaal;
  const titel =
    past && t
      ? `${periodeLabel(weergave, bereik.van, bereik.tot).replace(/^./, (c) => c.toUpperCase())}: ${euro(t.savingEur)} bespaard`
      : "Het resultaat over een week, een maand of een jaar";

  const ticks = [hoogste, hoogste / 2, 0, laagste].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <Figure
      titel={titel}
      toelichting={
        <>
          Dezelfde doorrekening als het dagprofiel, opgeteld{" "}
          {WEERGAVEN.find((w) => w.id === weergave)!.per}. Groen is wat de
          batterij die periode opleverde, rood wat hij kostte. Klik op een{" "}
          {resolutie === "week" ? "week" : "dag"} om die in het dagprofiel te
          bekijken.
        </>
      }
      actie={
        <div className="figure-acties">
          <div className="segment" role="group" aria-label="Periode">
            {WEERGAVEN.map((w) => (
              <button
                key={w.id}
                type="button"
                aria-pressed={weergave === w.id}
                className={weergave === w.id ? "segment-knop actief" : "segment-knop"}
                onClick={() => setWeergave(w.id)}
              >
                {w.label}
              </button>
            ))}
          </div>
          {actie}
        </div>
      }
    >
      <div className="verloop-nav">
        <button
          type="button"
          className="knop licht klein"
          disabled={!kanTerug}
          onClick={() => setAnker((a) => verschuif(weergave, a, -1))}
          aria-label="Vorige periode"
        >
          ← vorige
        </button>
        <span className="verloop-periode">{periodeLabel(weergave, bereik.van, bereik.tot)}</span>
        <button
          type="button"
          className="knop licht klein"
          disabled={!kanVooruit}
          onClick={() => setAnker((a) => verschuif(weergave, a, 1))}
          aria-label="Volgende periode"
        >
          volgende →
        </button>
        {bezig ? <span className="verloop-bezig">wordt opgeteld…</span> : null}
      </div>

      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className={bezig ? "chart verloop bezig" : "chart verloop"}
          role="img"
          aria-label={`Besparing en slijtage ${WEERGAVEN.find((w) => w.id === weergave)!.per}, ${periodeLabel(weergave, bereik.van, bereik.tot)}`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGE.links} x2={B - MARGE.rechts} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={tick === 0 ? 1.5 : 1} />
              <text x={MARGE.links - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="as-label">
                {euro(tick)}
              </text>
            </g>
          ))}
          {vakken.map((v, i) => {
            const top = Math.min(nul, y(v.savingEur));
            const hoog = Math.abs(y(v.savingEur) - nul);
            const titelTekst = resolutie === "dag" ? datum(v.dag) : `week van ${datum(v.dag)}`;
            return (
              <g
                key={v.sleutel}
                className="verloop-vak"
                onClick={() => onKiesDag(v.dag)}
                role="button"
                tabIndex={-1}
              >
                <title>
                  {`${titelTekst}\nbesparing ${euroPrecies(v.savingEur)}\ngeleverd ${getal(v.deliveredKwh, 1)} kWh, geladen ${getal(v.chargedKwh, 1)} kWh\nnetafname ${getal(v.gridImportBaselineKwh, 1)} → ${getal(v.gridImportBatteryKwh, 1)} kWh`}
                </title>
                <rect x={x(i) - (slot - staaf) / 2} y={MARGE.boven} width={slot} height={plotH} fill="transparent" />
                <rect
                  x={x(i)}
                  y={top}
                  width={staaf}
                  height={Math.max(0.5, hoog)}
                  fill={v.savingEur >= 0 ? "var(--series-3)" : "var(--critical)"}
                  rx={1}
                />
              </g>
            );
          })}
          {labels.map((l) => (
            <text key={l.x} x={l.x} y={H - MARGE.onder + 18} className="as-label" textAnchor={resolutie === "dag" ? "middle" : "start"}>
              {l.tekst}
            </text>
          ))}
        </svg>
      </div>

      <Legenda
        items={[
          { kleur: "var(--series-3)", label: "Bespaard" },
          { kleur: "var(--critical)", label: "Gekost" },
        ]}
      />

      {past && t ? (
        <dl className="kerncijfers">
          <div>
            <dt>Bespaard</dt>
            <dd>{euro(t.savingEur)}</dd>
          </div>
          <div>
            <dt>Waarvan afschrijving</dt>
            <dd className="zacht">
              {euro(t.wearCostEur)}
              <span className="dd-noot">
                het deel van de aanschafprijs dat deze beurten opmaken — al
                betaald, gaat niet nóg een keer van de besparing af
              </span>
            </dd>
          </div>
          <div>
            <dt>Door de batterij</dt>
            <dd>
              {kwh(t.deliveredKwh)}
              <span className="dd-noot">{kwh(t.chargedKwh)} erin</span>
            </dd>
          </div>
          <div>
            <dt>Van het net</dt>
            <dd>
              {kwh(t.gridImportBatteryKwh)}
              <span className="dd-noot">zonder batterij {kwh(t.gridImportBaselineKwh)}</span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="scenario-wacht">
          {bezig ? "De periode wordt opgeteld…" : "Kies een periode om het resultaat te zien."}
        </p>
      )}
    </Figure>
  );
}
