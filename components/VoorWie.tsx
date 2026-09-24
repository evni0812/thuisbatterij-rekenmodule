"use client";

/**
 * Voor wie loont deze batterij?
 *
 * Dezelfde batterij, doorgerekend voor een reeks huishoudens: oplopende
 * teruglevering bij jouw afname, en één huishouden zonder zonnepanelen. Per
 * punt één jaarsimulatie op hetzelfde jaar als de kaart van maten
 * (lib/model/huishoudens.ts); de financiën komen uit dezelfde afleiding als
 * de kaart, met de prijs van jouw batterij.
 *
 * Jouw eigen huishouden staat er als apart punt bij, uit het hoofdresultaat op
 * datzelfde jaar, zodat de lijn te ijken is aan wat bovenaan de pagina staat.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { HuishoudensState } from "../lib/useAnalysis";
import type { Configuration } from "../lib/worker/protocol";
import { referentieJaar, type AnalysisResult } from "../lib/model/analysis";
import { celFinance, type CelFinance } from "../lib/model/dimensionering";
import { euro, euroAs, getal, jaren, kwh, procent } from "../lib/format";
import { Figure, Grafiek, Legenda, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const B = 720;
const H = 240;
// Rechts genoeg ruimte voor "6.000 kWh", dat gecentreerd op de rechterrand
// staat en er bij 16 px half buiten viel.
const MARGE = { boven: 22, rechts: 40, onder: 46, links: 66 };

/*
 * Het huishouden zonder zonnepanelen krijgt een eigen strook links van de as.
 *
 * Het stond als ruit op x = 0, en las daardoor als het linkeruiteinde van de
 * blauwe lijn: "met panelen, maar nul teruglevering". Dat is het niet. Het is
 * een ander gemeten profiel — aansluitingen zónder invoeding — en het punt op
 * 0 kWh van die lijn bestaat óók en ligt er vlak naast. Twee punten die iets
 * heel anders betekenen op één plek. Nu staat het los, achter een streep, met
 * de rasterlijnen die wel doorlopen zodat de hoogte vergelijkbaar blijft.
 */
const AZI_STROOK = 92;

interface Punt {
  terugleveringKwh: number;
  zonnepanelen: boolean;
  fin: CelFinance;
}

export function VoorWie({
  huishoudens,
  result,
  config,
  actie,
}: {
  huishoudens: HuishoudensState | null;
  result: AnalysisResult;
  config: Configuration;
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const cap = config.battery.capacityKwh;
  const kw = config.battery.maxDischargeKw;

  const punten = useMemo<Punt[]>(() => {
    if (!huishoudens) return [];
    return huishoudens.punten.flatMap((p) =>
      p
        ? [{ terugleveringKwh: p.terugleveringKwh, zonnepanelen: p.zonnepanelen, fin: celFinance(p, cap, kw, config, result.curve) }]
        : [],
    );
  }, [huishoudens, cap, kw, config, result.curve]);

  const jaar = referentieJaar(result);
  const eigen = useMemo<Punt>(() => {
    const zon = config.afnametype !== "AZI";
    return {
      terugleveringKwh: zon ? config.household.annualGridExportKwh : 0,
      zonnepanelen: zon,
      fin: celFinance({ savingEur: jaar.realisticSavingEur, cyclesPerYear: jaar.cyclesPerYear }, cap, kw, config, result.curve),
    };
  }, [config, jaar, cap, kw, result.curve]);

  if (!huishoudens || (!huishoudens.klaar && punten.length < 2)) {
    return (
      <Figure
        actie={actie}
        titel="Voor wie loont deze batterij?"
        toelichting={<>Dezelfde batterij voor zeven andere huishoudens. Dat rekent op de achtergrond.</>}
      >
        <p className="raster-wacht">De figuur wordt doorgerekend…</p>
      </Figure>
    );
  }

  const metPanelen = punten.filter((p) => p.zonnepanelen).sort((a, b) => a.terugleveringKwh - b.terugleveringKwh);
  const zonder = punten.find((p) => !p.zonnepanelen) ?? null;

  const strook = zonder ? AZI_STROOK : 0;
  const x0 = MARGE.links + strook;
  const plotB = B - x0 - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;
  const tMax = Math.max(...metPanelen.map((p) => p.terugleveringKwh), eigen.terugleveringKwh, 1);
  const x = (t: number) => x0 + (t / tMax) * plotB;
  /** Het midden van de strook links: daar staat het huishouden zonder panelen. */
  const xZonder = MARGE.links + strook / 2;
  const waarden = [...punten, eigen].map((p) => p.fin.npvEur);
  const ticks = kiesTicks(Math.min(...waarden, 0), Math.max(...waarden, 0), 7);
  const lo = Math.min(...ticks, ...waarden);
  const hi = Math.max(...ticks, ...waarden);
  const y = (v: number) => MARGE.boven + (hi > lo ? (1 - (v - lo) / (hi - lo)) * plotH : plotH / 2);

  const pad = metPanelen.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.terugleveringKwh)} ${y(p.fin.npvEur)}`).join(" ");

  /** Vanaf welke teruglevering de batterij netto uit de kosten komt, lineair tussen de punten. */
  const grens = ((): number | null => {
    for (let i = 0; i < metPanelen.length; i++) {
      const p = metPanelen[i]!;
      if (p.fin.npvEur > 0) {
        if (i === 0) return 0;
        const v = metPanelen[i - 1]!;
        const t = (0 - v.fin.npvEur) / (p.fin.npvEur - v.fin.npvEur);
        return v.terugleveringKwh + t * (p.terugleveringKwh - v.terugleveringKwh);
      }
    }
    return null;
  })();

  const titel =
    grens === null
      ? "Deze batterij komt bij geen van deze huishoudens netto uit de kosten"
      : grens === 0
        ? `Als ${jaar.year} zich herhaalt, loont deze batterij ook zonder teruglevering`
        : `Als ${jaar.year} zich herhaalt, loont deze batterij vanaf ongeveer ${kwh(Math.round(grens / 100) * 100)} teruglevering per jaar`;

  const asLabels: number[] = [];
  for (const p of metPanelen) {
    const vorige = asLabels[asLabels.length - 1];
    if (vorige !== undefined && x(p.terugleveringKwh) - x(vorige) < 40) {
      if (p.terugleveringKwh !== tMax) continue;
      asLabels.pop();
    }
    asLabels.push(p.terugleveringKwh);
  }

  const grenzen = metPanelen.map((p, i, arr) => {
    const links = i === 0 ? 0 : (arr[i - 1]!.terugleveringKwh + p.terugleveringKwh) / 2;
    const rechts = i === arr.length - 1 ? tMax : (p.terugleveringKwh + arr[i + 1]!.terugleveringKwh) / 2;
    return { links: x(links), rechts: x(rechts) };
  });

  const tipVoor = (p: Punt, naam: string) => ({
    titel: naam,
    regels: [
      { label: "Besparing per jaar", waarde: euro(p.fin.besparingEur) },
      { label: "Netto na rente", waarde: euro(p.fin.npvEur), uitkomst: true },
      { label: "Terugverdiend na", waarde: jaren(p.fin.paybackYears) },
    ],
    noot: `Bij een afname van ${kwh(config.household.annualGridImportKwh)}, als ${jaar.year} zich herhaalt.`,
  });

  return (
    <Figure
      actie={actie}
      titel={titel}
      toelichting={
        <>
          Jouw batterij ({getal(cap, 2)} kWh, {euro(config.investmentEur)}) voor huishoudens met jouw
          afname maar een andere teruglevering, en voor een huishouden zonder zonnepanelen. Netto
          resultaat over {config.analysisYears} jaar; boven de nullijn komt hij uit de kosten. Netto
          is hier ná aftrek van de {procent(config.discountRate, 1)} rente die je misloopt; een
          terugverdientijd telt de euro's kaal, en kan daardoor binnen die {config.analysisYears} jaar
          vallen terwijl er netto nog een tekort staat.
          {huishoudens.bezig ? " De figuur vult zich nog." : ""}
        </>
      }
    >
      {/*
        Twee items, niet drie. "Jouw huishouden" stond er als derde kleur bij,
        vlak naast twee andere groentinten, terwijl het geen eigen categorie is
        maar jouw plek op de blauwe lijn. In de figuur is het de dikke stip met
        het label "jij"; dat wijst zichzelf aan.
      */}
      <Legenda
        items={[
          { kleur: "var(--series-1)", label: "met zonnepanelen, per teruglevering" },
          ...(zonder ? [{ kleur: "var(--series-2)", label: "zonder zonnepanelen" }] : []),
        ]}
      />
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setAangewezen(null);
          wis();
        }}
        label="Netto resultaat per huishouden"
      >
        <svg viewBox={`0 0 ${B} ${H}`} className="chart" role="img" aria-label="Netto resultaat per huishouden">
          {aangewezen !== null && grenzen[aangewezen] ? (
            <rect
              className="aangewezen"
              x={grenzen[aangewezen]!.links}
              y={MARGE.boven}
              width={grenzen[aangewezen]!.rechts - grenzen[aangewezen]!.links}
              height={plotH}
            />
          ) : null}

          <Raster ticks={ticks} x0={MARGE.links} x1={B - MARGE.rechts} schaal={y} labelBreedte={MARGE.links} formatter={(v) => euroAs(v)} />

          {metPanelen.length > 1 ? (
            <path d={pad} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : null}
          {metPanelen.map((p) => (
            <circle key={p.terugleveringKwh} cx={x(p.terugleveringKwh)} cy={y(p.fin.npvEur)} r={3.5} fill="var(--series-1)" />
          ))}

          {zonder ? (
            <g>
              {/* De streep scheidt de strook van de schaal: links één huishouden
                  dat niet op die as thuishoort, rechts de reeks. */}
              <line
                x1={x0 - 14}
                x2={x0 - 14}
                y1={MARGE.boven}
                y2={MARGE.boven + plotH}
                stroke="var(--axis)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <rect
                x={xZonder - 5}
                y={y(zonder.fin.npvEur) - 5}
                width={10}
                height={10}
                fill="var(--series-2)"
                transform={`rotate(45 ${xZonder} ${y(zonder.fin.npvEur)})`}
              />
              <text x={xZonder} y={H - 26} textAnchor="middle" className="as-label">
                zonder
              </text>
              <text x={xZonder} y={H - 14} textAnchor="middle" className="as-label">
                panelen
              </text>
            </g>
          ) : null}

          <circle
            cx={x(eigen.terugleveringKwh)}
            cy={y(eigen.fin.npvEur)}
            r={5.5}
            fill="var(--ac)"
            stroke="var(--surface-1)"
            strokeWidth={2}
          />
          <text x={x(eigen.terugleveringKwh) + 8} y={y(eigen.fin.npvEur) - 8} className="mark-label op-lijn" fill="var(--ac)">
            jij
          </text>

          {asLabels.map((t) => (
            <text key={t} x={x(t)} y={H - 26} textAnchor="middle" className="as-label">
              {getal(t)} kWh
            </text>
          ))}
          <text x={(x0 + B - MARGE.rechts) / 2} y={H - 8} textAnchor="middle" className="as-label zwak">
            teruglevering per jaar
          </text>

          {metPanelen.map((p, i) => (
            <Trefvlak
              key={p.terugleveringKwh}
              x={grenzen[i]!.links}
              y={MARGE.boven}
              breedte={grenzen[i]!.rechts - grenzen[i]!.links}
              hoogte={plotH}
              onWijs={(punt) => {
                setAangewezen(i);
                toon(punt, tipVoor(p, `Teruglevering ${kwh(p.terugleveringKwh)} per jaar`));
              }}
              onWis={() => {
                setAangewezen(null);
                wis();
              }}
            />
          ))}
        </svg>
      </Grafiek>

      <dl className="kerncijfers">
        <div>
          <dt>Jouw huishouden</dt>
          <dd className={eigen.fin.npvEur >= 0 ? "goed" : "slecht"}>
            {euro(eigen.fin.npvEur)}
            <span className="dd-noot">
              netto bij {eigen.zonnepanelen ? `${kwh(eigen.terugleveringKwh)} teruglevering` : "geen zonnepanelen"}, als{" "}
              {jaar.year} zich herhaalt
            </span>
          </dd>
        </div>
        <div>
          <dt>Uit de kosten vanaf</dt>
          <dd>
            {grens === null ? "geen van deze huishoudens" : grens === 0 ? "elke teruglevering" : `${kwh(Math.round(grens / 100) * 100)} teruglevering`}
          </dd>
        </div>
        {zonder ? (
          <div>
            <dt>Zonder zonnepanelen</dt>
            <dd className={zonder.fin.npvEur >= 0 ? "goed" : "slecht"}>
              {euro(zonder.fin.npvEur)}
              <span className="dd-noot">
                {zonder.fin.paybackYears === null
                  ? "verdient zich niet terug"
                  : zonder.fin.npvEur < 0
                    ? `de aanschaf is er na ${jaren(zonder.fin.paybackYears)} uit, maar de gemiste rente niet`
                    : `terugverdiend na ${jaren(zonder.fin.paybackYears)}`}
              </span>
            </dd>
          </div>
        ) : (
          <div>
            <dt>Zonder zonnepanelen</dt>
            <dd>
              —<span className="dd-noot">voor dit netgebied is er geen gemeten profiel zonder panelen</span>
            </dd>
          </div>
        )}
      </dl>
      <p className="posten-noot">
        Alleen de teruglevering verschuift; afname, batterij, tarieven en prijs blijven die van jou.
        Het huishouden zonder zonnepanelen rekent met het gemeten gemiddelde profiel van alle aansluitingen zonder
        invoeding: een batterij verdient daar alleen aan het prijsverschil over de dag.
      </p>
    </Figure>
  );
}
