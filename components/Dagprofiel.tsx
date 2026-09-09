"use client";

/**
 * Een dag in detail: wat doet de batterij nu eigenlijk?
 *
 * ── Waarom deze vorm ────────────────────────────────────────────────────────
 * Vier panelen boven elkaar met één gedeelde tijdas, in de volgorde van het
 * verhaal:
 *
 *   1. de prijs        waarom er iets te doen viel
 *   2. de acties       wat de batterij ermee deed
 *   3. de lading       wat daarvan het gevolg was
 *   4. het geld        wat het opleverde, opgeteld over de dag
 *
 * Ze delen de x-as maar niet de y-as: prijs, vermogen, lading en euro's zijn
 * vier verschillende grootheden. In één plot zou dat een dubbele y-as vragen,
 * en die verzint een verband dat er niet is.
 *
 * Paneel 4 verving de netuitwisseling met en zonder batterij. Dat was af te
 * leiden uit paneel 2 — netto is de residual plus laden min ontladen — en het
 * was het minst leesbare van de vier, met twee lijnen die grotendeels
 * samenvielen. Wat ontbrak was het geld: de andere panelen laten kilowatturen
 * zien, en daaruit is niet af te lezen of een dag iets oplevert.
 *
 * Elk paneel draagt zijn eigen labels aan de rechterkant van de lijnen, zodat je
 * nergens kleuren hoeft te matchen met een legenda.
 *
 * De ruimte is strikt verdeeld in drie kolommen — as-labels, plot, lijnlabels —
 * en niets mag daarbuiten treden. Eerder stonden de paneeltitels op x=0 en
 * liepen ze dwars over de as-labels heen.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { SampleDay } from "../lib/model/analysis";
import { addDays } from "../lib/data/timeaxis";
import { centPerKwh, datum, euroPrecies, getal, procent } from "../lib/format";
import { Figure, kiesTicks } from "./chart-parts";

const B = 860;

/** Kolomindeling: as-labels | plot | lijnlabels. Niets treedt buiten zijn kolom. */
const AS_BREEDTE = 84;
const LABEL_BREEDTE = 148;
const PLOT_LINKS = AS_BREEDTE;
const PLOT_RECHTS = B - LABEL_BREEDTE;
const PLOT_BREEDTE = PLOT_RECHTS - PLOT_LINKS;

/** Ruimte boven elk paneel voor zijn titel, en de hoogte van het paneel zelf. */
/**
 * Ruimte boven elk paneel voor de titel. Ruim genoeg dat de titel vrij staat
 * van de grafiek erboven: eerder raakte hij de onderste rasterlijn van het
 * vorige paneel en leek alles op elkaar gedrukt.
 */
const TITEL_RUIMTE = 42;
/**
 * De panelen waren te laag voor wat erin staat. Het actiepaneel draagt zes
 * reeksen en een legenda van acht regels, en de lading kreeg 84 eenheden voor
 * een lijn die het hele verhaal van de dag vertelt: dan is een volle batterij
 * nauwelijks te onderscheiden van een halfvolle. Een dagprofiel dat je moet
 * ontcijferen doet zijn werk niet, en verticale ruimte is het goedkoopste wat
 * we hebben — de figuur scrollt toch.
 */
const HOOGTE = { prijs: 150, actie: 215, lading: 125, net: 165 };
const TIJDAS_HOOGTE = 34;

/**
 * De panelen staan in de volgorde van het verhaal: de prijs geeft de aanleiding,
 * de acties zijn wat de batterij doet, de lading is het gevolg daarvan, en het
 * net is het resultaat voor jou. De lading sluit direct aan op de acties, want
 * de helling van die lijn ís de optelsom van de staven erboven.
 */
/** De lading sluit dichter aan op de acties: de helling van die lijn ís de
 *  optelsom van de staven erboven, dus die twee horen bij elkaar. */
const KOPPEL_RUIMTE = 30;

const Y = {
  prijs: TITEL_RUIMTE,
  actie: TITEL_RUIMTE + HOOGTE.prijs + TITEL_RUIMTE,
  lading:
    TITEL_RUIMTE + HOOGTE.prijs + TITEL_RUIMTE + HOOGTE.actie + KOPPEL_RUIMTE,
  net:
    TITEL_RUIMTE +
    HOOGTE.prijs +
    TITEL_RUIMTE +
    HOOGTE.actie +
    KOPPEL_RUIMTE +
    HOOGTE.lading +
    TITEL_RUIMTE,
};
const H_TOTAAL = Y.net + HOOGTE.net + TIJDAS_HOOGTE;

/** Kwartier-kWh naar vermogen in kW: 0,25 kWh in een kwartier is 1 kW. */
const KWH_NAAR_KW = 4;

/**
 * Minimale verticale afstand tussen twee lijnlabels, in SVG-eenheden.
 *
 * Een label is twee regels: de naam op y−1 en de waarde op y+11, met het
 * kleurblokje op y−5. Van boven- tot onderkant is dat ruim twintig eenheden.
 * Deze marge stond op 15, en dan schoof de waarde van het ene label over de
 * naam van het volgende — zichtbaar zodra twee lijnen op dezelfde hoogte
 * eindigen, zoals "zónder batterij" en "mét batterij" op een dag waarop de
 * batterij 's avonds leeg is.
 */
const LABEL_MIN_AFSTAND = 28;

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
  bezig = false,
  eersteDag,
  laatsteDag,
  onVraagDag,
  onWisDag,
}: {
  voorbeelden: SampleDay[];
  losseDag: SampleDay | null;
  ontbreekt: string | null;
  /** Er wordt een dag opgehaald; de knoppen blijven bruikbaar. */
  bezig?: boolean;
  eersteDag: string;
  laatsteDag: string;
  onVraagDag: (datum: string) => void;
  onWisDag: () => void;
}) {
  const [gekozen, setGekozen] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  const dag = losseDag ?? voorbeelden[gekozen];
  const huidigeDatum = dag?.date ?? "";
  useEffect(() => setCursor(null), [dag?.date]);

  // Doorbladeren gaat altijd vanaf de dag die nu op het scherm staat, ook als
  // dat een van de voorbeelddagen is. Zo kun je vanuit een doorsnee zomerdag
  // naar de dag ernaast, wat precies is wat je wilt als je iets ziet dat je
  // niet verwacht.
  const stap = useCallback(
    (richting: -1 | 1) => {
      if (!huidigeDatum) return;
      const doel = addDays(huidigeDatum, richting);
      if (doel < eersteDag || doel > laatsteDag) return;
      onVraagDag(doel);
    },
    [huidigeDatum, eersteDag, laatsteDag, onVraagDag],
  );

  const kanTerug = huidigeDatum > eersteDag;
  const kanVooruit = huidigeDatum !== "" && huidigeDatum < laatsteDag;

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
  // Wat er te halen viel: overschot om op te slaan, en eigen verbruik om te
  // dekken. Zonder deze context lijkt het laden willekeurig — je kunt niet zien
  // of de batterij het overschot opvangt of dat er iets blijft liggen.
  const overschotKw = dag.residualKwh.map((v) => Math.max(0, -v) * KWH_NAAR_KW);
  const tekortKw = dag.residualKwh.map((v) => Math.max(0, v) * KWH_NAAR_KW);
  // De zon die de meter haalde, los van wat het huis er op dat moment van
  // opsnoepte. Op een zonnige dag ligt die lijn vlak boven het netto overschot;
  // waar ze uiteenlopen, gebruikte het huis op dat moment zelf stroom.
  const zonKw = dag.meterExportKwh.map((v) => v * KWH_NAAR_KW);
  const heeftZonReeks = zonKw.length === dag.residualKwh.length;
  const zonTotaal = dag.stats.meterExportKwh;
  const aMax = Math.max(
    ...acties.uitZon.map((v, k) => v + acties.uitNet[k]!),
    ...acties.naarHuis.map((v, k) => v + acties.naarNet[k]!),
    ...overschotKw,
    ...tekortKw,
    ...(heeftZonReeks ? zonKw : []),
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
  const totaalOverschot = overschotKw.reduce((a, b) => a + b, 0) / KWH_NAAR_KW;

  // ── Paneel 3: lading ──
  const cap = Math.max(dag.usableCapacityKwh, 0.001);
  const yS = (v: number) => Y.lading + (1 - v / cap) * HOOGTE.lading;
  const socMax = Math.max(...dag.socKwh);

  // ── Paneel 3: netuitwisseling ──
  // Paneel 4 toont geld, geen vermogen: wat de dag tot dan toe gekost heeft,
  // zonder en met batterij. De schaal loopt van de laagste naar de hoogste
  // waarde die een van beide lijnen aanneemt, met nul er altijd in — anders
  // zweeft een dag die alleen maar geld kost boven een onzichtbare nullijn.
  const cumBasis = dag.cumulatiefBasisEur;
  const cumBat = dag.cumulatiefBatterijEur;
  const heeftGeldreeks = cumBasis.length === n && cumBat.length === n;
  const gLaag = heeftGeldreeks ? Math.min(0, ...cumBasis, ...cumBat) : 0;
  const gHoog = heeftGeldreeks ? Math.max(0, ...cumBasis, ...cumBat) : 1;
  const gSpan = Math.max(gHoog - gLaag, 0.05);
  const nTicks = kiesTicks(gLaag, gHoog, 4);
  const yN = (v: number) => Y.net + (1 - (v - gLaag) / gSpan) * HOOGTE.net;

  /**
   * Welk moment de lijnlabels tonen.
   *
   * Standaard het einde van de dag, maar zodra je een moment aanwijst dát
   * moment. Eerder stonden er twee verschillende getallen voor dezelfde reeks
   * op het scherm: de uitleesregel onderaan zei "13:00, afname 22,5 ct" terwijl
   * het label bij de lijn 32,2 ct bleef tonen — de eindstand van de dag. Wat de
   * prijs op het aangewezen moment was, stond dus nergens bij de lijn zelf.
   */
  const wijs = cursor ?? laatste;

  // Lijnlabels ontvlechten per paneel.
  const [yAfname, yTerug] = ontvlecht([
    yP(dag.importPrice[wijs]!),
    yP(dag.exportPrice[wijs]!),
  ]) as [number, number];
  const [yMet, yZonder] = ontvlecht([
    yN(heeftGeldreeks ? cumBat[wijs]! : 0),
    yN(heeftGeldreeks ? cumBasis[wijs]! : 0),
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
          {datum(dag.date)}, een dag met een middelmatig prijsverschil. Niet de dag
          waarop de batterij het best presteerde. Wijs een moment aan voor de
          waarden op dat kwartier.
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
          <div className="dagkiezer-datum">
            <button
              type="button"
              className="dagstap"
              aria-label="Vorige dag"
              title="Vorige dag"
              disabled={!kanTerug}
              onClick={() => stap(-1)}
            >
              ‹
            </button>
            <input
              type="date"
              aria-label="Kies zelf een dag"
              min={eersteDag}
              max={laatsteDag}
              value={huidigeDatum}
              onChange={(e) =>
                e.target.value ? onVraagDag(e.target.value) : onWisDag()
              }
              onKeyDown={(e) => {
                // Met de pijltjes door de dagen: de datuminvoer zelf gebruikt
                // omhoog en omlaag voor het veld onder de cursor, dus links en
                // rechts zijn vrij en liggen het meest voor de hand.
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  stap(-1);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  stap(1);
                }
              }}
            />
            <button
              type="button"
              className="dagstap"
              aria-label="Volgende dag"
              title="Volgende dag"
              disabled={!kanVooruit}
              onClick={() => stap(1)}
            >
              ›
            </button>
            {bezig ? <span className="dagkiezer-bezig" aria-live="polite">rekent…</span> : null}
          </div>
        </div>
      }
    >
      {ontbreekt ? (
        <p className="dag-melding">
          Voor {datum(ontbreekt)} zijn geen gegevens in de gekozen periode. Kies
          een dag tussen {datum(eersteDag)} en {datum(laatsteDag)}.
        </p>
      ) : null}

      <DagCijfers dag={dag} />

      <div
        className="chart-wrap"
        tabIndex={0}
        role="group"
        aria-label="Grafiek, horizontaal scrollbaar"
      >
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
            yLijn={yP(dag.importPrice[wijs]!)}
            kleur="var(--series-1)"
            naam="je betaalt"
            waarde={centPerKwh(dag.importPrice[wijs]!)}
          />
          <LijnLabel
            y={yTerug}
            yLijn={yP(dag.exportPrice[wijs]!)}
            kleur="var(--series-2)"
            naam="je krijgt"
            waarde={centPerKwh(dag.exportPrice[wijs]!)}
            gestippeld
          />

          {/* ══ Paneel 2: wat de batterij doet ══ */}
          {paneelTitel(
            Y.actie,
            "Wat er te halen valt, en wat de batterij ermee doet",
            heeftZonReeks && zonTotaal !== null && zonTotaal > 0.01
              ? "zon = wat de meter passeerde, niet de bruto opwek"
              : undefined,
          )}
          <line x1={PLOT_LINKS} x2={PLOT_RECHTS} y1={yA(aMax / 2)} y2={yA(aMax / 2)} stroke="var(--grid)" />
          <line x1={PLOT_LINKS} x2={PLOT_RECHTS} y1={yA(-aMax / 2)} y2={yA(-aMax / 2)} stroke="var(--grid)" />

          {/* De context achter de staven: hoeveel zon er over was om op te
              slaan, en hoeveel je zelf verbruikte. De staven vallen daarbinnen,
              dus je ziet in één oogopslag wat de batterij oppakt en wat blijft
              liggen omdat hij vol is of te weinig vermogen heeft. */}
          <path
            d={`${lijn(overschotKw.map((v, k) => [x(k), yA(v)]))} L${x(laatste)} ${yA(0)} L${x(0)} ${yA(0)} Z`}
            fill="var(--text-muted)"
            opacity={0.13}
          />
          <path
            d={`${lijn(tekortKw.map((v, k) => [x(k), yA(-v)]))} L${x(laatste)} ${yA(0)} L${x(0)} ${yA(0)} Z`}
            fill="var(--text-muted)"
            opacity={0.13}
          />
          <path
            d={lijn(overschotKw.map((v, k) => [x(k), yA(v)]))}
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <path
            d={lijn(tekortKw.map((v, k) => [x(k), yA(-v)]))}
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {/* De zon die de meter haalde. Staat boven de grijze context zodat je
              kunt zien hoeveel van het dak kwam en hoeveel daarvan het huis
              meteen zelf gebruikte: het verschil tussen deze lijn en de
              gestippelde is precies dat. */}
          {heeftZonReeks && zonTotaal !== null && zonTotaal > 0.01 ? (
            <path
              d={lijn(zonKw.map((v, k) => [x(k), yA(v)]))}
              fill="none"
              stroke="var(--series-5)"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          ) : null}
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
          <text x={PLOT_LINKS - 10} y={Y.actie + 10} textAnchor="end" className="as-kop">
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
          <text x={PLOT_LINKS - 10} y={Y.actie + HOOGTE.actie - 2} textAnchor="end" className="as-kop">
            eruit
          </text>

          {/* De dagtotalen dragen dit paneel: niet elk staafje telt, maar wel
              hoeveel er die dag in totaal is opgeslagen en waar het heen ging. */}
          {/*
            De posities stonden hier vast, met de eerste vier vanaf de bovenkant
            en de laatste twee vanaf de onderkant. Zodra alle zes zichtbaar waren
            — een zonnige dag waarop de batterij zowel inkoopt als verkoopt —
            stonden "ingekocht" en "zelf gebruikt" acht pixels uit elkaar terwijl
            elk blokje er ruim twintig nodig heeft, en liepen de teksten door
            elkaar heen.

            Nu worden de zichtbare regels over de paneelhoogte verdeeld. Bij vier
            of minder is de stap dezelfde 34 als voorheen; pas als het er meer
            zijn krimpt hij, precies genoeg om te passen.
          */}
          <g className="actie-legende">
            {(() => {
              /*
                De legenda stond als één lijst van zes, en twee regels waren
                allebei groen: "opgeslagen" en "zelf gebruikt". In de grafiek is
                dat te volgen omdat de richting het onderscheid draagt — omhoog
                is erin, omlaag is eruit — maar in de legenda staan twee
                identieke blokjes onder elkaar met verschillende namen, en dan
                lijkt het een fout.

                Groen betekent hier consequent "je eigen stroom", blauw "van het
                net" en oranje "naar het net". Dat klopt in beide richtingen, dus
                de kleuren blijven; de legenda groepeert nu op richting en zegt
                per regel waar de stroom vandaan komt of heen gaat.
              */
              const groepen: {
                kop?: string;
                regels: { kleur: string; naam: string; waarde: number; vaag?: boolean }[];
              }[] = [
                {
                  regels: [
                    {
                      kleur: "var(--series-5)",
                      naam: "zon naar de meter",
                      waarde: heeftZonReeks && zonTotaal !== null ? zonTotaal : 0,
                    },
                    {
                      kleur: "var(--text-muted)",
                      naam: "netto over",
                      waarde: totaalOverschot,
                      vaag: true,
                    },
                  ],
                },
                {
                  kop: "laden",
                  regels: [
                    { kleur: "var(--series-3)", naam: "uit eigen zon", waarde: totaalZon },
                    { kleur: "var(--series-1)", naam: "uit het net", waarde: totaalNet },
                  ],
                },
                {
                  kop: "ontladen",
                  regels: [
                    { kleur: "var(--series-3)", naam: "naar je huis", waarde: totaalHuis },
                    { kleur: "var(--series-2)", naam: "naar het net", waarde: totaalVerkocht },
                  ],
                },
              ];

              // Alles onder een tiende van een wattuur is ruis en zou de lijst
              // alleen langer maken; een groep zonder regels valt weg.
              const zichtbaar = groepen
                .map((g) => ({ ...g, regels: g.regels.filter((r) => r.waarde > 0.01) }))
                .filter((g) => g.regels.length > 0);

              const REGEL = 28;
              const KOP = 16;
              const uit: ReactNode[] = [];
              let y = Y.actie - 4;

              for (const groep of zichtbaar) {
                if (groep.kop) {
                  uit.push(
                    <text
                      key={`kop-${groep.kop}`}
                      x={PLOT_RECHTS + 8}
                      y={y}
                      className="legende-kop"
                    >
                      {groep.kop}
                    </text>,
                  );
                  y += KOP;
                }
                for (const r of groep.regels) {
                  uit.push(
                    <g key={r.naam}>
                      <rect
                        x={PLOT_RECHTS + 8}
                        y={y - 8}
                        width={9}
                        height={9}
                        rx={2}
                        fill={r.kleur}
                        opacity={r.vaag ? 0.4 : 1}
                      />
                      <text x={PLOT_RECHTS + 22} y={y} className="lijn-label">
                        {r.naam}
                      </text>
                      <text x={PLOT_RECHTS + 22} y={y + 12} className="lijn-waarde">
                        {getal(r.waarde, 2)} kWh
                      </text>
                    </g>,
                  );
                  y += REGEL;
                }
              }
              return uit;
            })()}
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

          {/* ══ Paneel 4: wat het kostte ══ */}
          {/*
            Het vorige paneel hier toonde de netuitwisseling met en zonder
            batterij. Dat is af te leiden uit het actiepaneel — netto is de
            residual plus laden min ontladen — en het was het minst leesbare van
            de vier, met twee lijnen die grotendeels samenvallen.

            Wat ontbrak was het geld. De andere panelen laten kilowatturen zien:
            wát de batterij doet, niet of het iets oplevert. Hier lopen de kosten
            met en zonder batterij uit elkaar en weer naar elkaar toe, en het gat
            aan het eind ís de dagbesparing.
          */}
          {paneelTitel(Y.net, "Wat het je kostte, opgeteld over de dag")}
          {heeftGeldreeks ? (
            <>
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
              {nTicks.map((t) => (
                <text
                  key={`nt${t}`}
                  x={PLOT_LINKS - 10}
                  y={yN(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="as-label"
                >
                  {euroPrecies(t)}
                </text>
              ))}
              <line
                x1={PLOT_LINKS}
                x2={PLOT_RECHTS}
                y1={yN(0)}
                y2={yN(0)}
                stroke="var(--axis)"
                strokeWidth={1.5}
              />

              {/* Het vlak tussen de twee lijnen is de besparing die zich
                  opbouwt. Groen als de batterij voorloopt, rood als hij die dag
                  achterloopt — dat laatste gebeurt 's nachts, wanneer hij
                  inkoopt voor later. */}
              <path
                d={`${lijn(cumBasis.map((v, k) => [x(k), yN(v)]))} L${x(laatste)} ${yN(
                  cumBat[laatste]!,
                )} ${cumBat
                  .map((v, k) => [x(laatste - k), yN(cumBat[laatste - k]!)] as [number, number])
                  .map(([px, py]) => `L${px} ${py}`)
                  .join(" ")} Z`}
                fill="var(--series-3)"
                opacity={0.14}
              />
              <path
                d={lijn(cumBasis.map((v, k) => [x(k), yN(v)]))}
                fill="none"
                stroke="var(--text-muted)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <path
                d={lijn(cumBat.map((v, k) => [x(k), yN(v)]))}
                fill="none"
                stroke="var(--series-4)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <LijnLabel
                y={yMet}
                yLijn={yN(cumBat[wijs]!)}
                kleur="var(--series-4)"
                naam="mét batterij"
                waarde={euroPrecies(cumBat[wijs]!)}
              />
              <LijnLabel
                y={yZonder}
                yLijn={yN(cumBasis[wijs]!)}
                kleur="var(--text-muted)"
                naam="zónder batterij"
                waarde={euroPrecies(cumBasis[wijs]!)}
                gestippeld
              />
            </>
          ) : null}

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
              {heeftGeldreeks ? (
                <circle cx={x(i)} cy={yN(cumBat[i]!)} r={4} fill="var(--series-4)" stroke="var(--surface-1)" strokeWidth={2} />
              ) : null}
            </g>
          ) : null}
        </svg>
      </div>

      <Uitlezing dag={dag} i={i} />
    </Figure>
  );
}

/**
 * De kerngetallen van de dag, boven de grafieken.
 *
 * ── Waarom dit er staat ─────────────────────────────────────────────────────
 * De grafieken laten zien wát er gebeurt, maar niet wat het opleverde. Een
 * jaarbedrag van tweehonderd euro wordt pas begrijpelijk als je ziet dat het
 * uit driehonderdvijfenzestig dagen van rond de vijftig cent bestaat, met
 * uitschieters op de dagen dat het prijsverschil groot was.
 *
 * Het laatste cijfer is de vergelijking met perfecte kennis. Dat is precies de
 * plek waar zichtbaar wordt waar het verschil tussen de twee strategieën
 * vandaan komt: op een vlakke dag zijn ze gelijk, op een dag met een misgelopen
 * piek loopt het uiteen.
 */
function DagCijfers({ dag }: { dag: SampleDay }) {
  const s = dag.stats;
  const minderAfname = s.gridImportBaselineKwh - s.gridImportBatteryKwh;
  const minderTeruglevering = s.gridExportBaselineKwh - s.gridExportBatteryKwh;
  const gemist =
    s.optimalSavingEur !== null ? s.optimalSavingEur - s.savingEur : null;

  // Wat er over de dagrand heen gaat. Een tiende kWh is meetruis; daarboven is
  // het de verklaring van het dagbedrag en hoort het erbij te staan.
  const overDeRand = s.socEndKwh - s.socStartKwh;
  const randTelt = Math.abs(overDeRand) > 0.1;

  return (
    <div className="dagcijfers">
      <div className="dagcijfer dagcijfer--hoofd">
        <span className="dagcijfer-waarde">{euroPrecies(s.savingEur)}</span>
        <span className="dagcijfer-label">
          {s.savingEur < 0 ? "kostte deze dag" : "bespaard op deze dag"}
        </span>
        <span className="dagcijfer-noot">
          {euroPrecies(s.baselineCostEur)} zonder batterij,{" "}
          {euroPrecies(s.batteryCostEur)} met
        </span>
      </div>

      {/*
       * De dagrand krijgt een eigen tegel zodra er lading over de middernacht
       * heen gaat. Dat is de reden dat een dagbedrag negatief kan zijn: de
       * inkoop valt op deze dag, het gebruik op de volgende.
       */}
      {randTelt ? (
        <div className="dagcijfer">
          <span className="dagcijfer-waarde">
            {overDeRand > 0 ? "+" : ""}
            {getal(overDeRand, 1)} kWh
          </span>
          <span className="dagcijfer-label">
            {overDeRand > 0 ? "gaat mee naar morgen" : "kwam van gisteren"}
          </span>
          <span className="dagcijfer-noot">
            {getal(s.socStartKwh, 1)} kWh om 00:00, {getal(s.socEndKwh, 1)} kWh om
            24:00.{" "}
            {overDeRand > 0
              ? "Wat je hier inkocht, gebruik je morgen; die opbrengst staat op de volgende dag."
              : "Wat je hier gebruikte, kocht je gisteren; die kosten staan op de vorige dag."}
          </span>
        </div>
      ) : null}

      <div className="dagcijfer">
        <span className="dagcijfer-waarde">{getal(s.deliveredKwh, 1)} kWh</span>
        <span className="dagcijfer-label">uit de batterij gehaald</span>
        <span className="dagcijfer-noot">
          {getal(s.chargedKwh, 1)} kWh erin, waarvan{" "}
          {getal(s.chargedFromGridKwh, 1)} ingekocht
        </span>
      </div>

      {s.meterExportKwh !== null ? (
        <div className="dagcijfer">
          <span className="dagcijfer-waarde">
            {getal(s.meterExportKwh, 1)} kWh
          </span>
          <span className="dagcijfer-label">zon naar de meter</span>
          <span className="dagcijfer-noot">
            wat je panelen die dag over hadden. Wat je direct zelf gebruikte komt
            niet langs de meter en zit hier niet in.
          </span>
        </div>
      ) : null}

      <div className="dagcijfer">
        <span className="dagcijfer-waarde">{getal(s.cycles, 2)}</span>
        <span className="dagcijfer-label">laadbeurten</span>
        <span className="dagcijfer-noot">
          hoogste stand {getal(s.socMaxKwh, 1)} van {getal(dag.usableCapacityKwh, 1)} kWh
        </span>
      </div>

      <div className="dagcijfer">
        <span className="dagcijfer-waarde">{getal(minderAfname, 1)} kWh</span>
        <span className="dagcijfer-label">minder van het net</span>
        <span className="dagcijfer-noot">
          {getal(s.gridImportBaselineKwh, 1)} → {getal(s.gridImportBatteryKwh, 1)} kWh,
          en {getal(minderTeruglevering, 1)} kWh minder teruggeleverd
        </span>
      </div>

      <div className="dagcijfer">
        <span className="dagcijfer-waarde">
          {centPerKwh(s.priceMaxEurPerKwh - s.priceMinEurPerKwh)}
        </span>
        <span className="dagcijfer-label">prijsverschil op deze dag</span>
        <span className="dagcijfer-noot">
          laagste {centPerKwh(s.priceMinEurPerKwh)}, hoogste{" "}
          {centPerKwh(s.priceMaxEurPerKwh)}
        </span>
      </div>

      {gemist !== null ? (
        <div className="dagcijfer">
          <span className="dagcijfer-waarde">
            {/* Bij een besparing van bijna nul zegt een percentage niets, en bij
                een negatieve besparing zou het een absurd getal worden. Dan
                noemen we het bedrag zelf. */}
            {s.optimalSavingEur! > 0.02 && s.savingEur >= 0
              ? procent(Math.min(1, s.savingEur / s.optimalSavingEur!))
              : euroPrecies(s.savingEur)}
          </span>
          <span className="dagcijfer-label">van wat er in zat</span>
          <span className="dagcijfer-noot">
            {Math.abs(gemist) < 0.01
              ? "gelijk aan wat met perfecte kennis van prijzen én weer mogelijk was; dit dagbedrag komt dus niet door een verkeerde inschatting"
              : `met perfecte kennis van prijzen én weer was het ${euroPrecies(
                  s.optimalSavingEur!,
                )} geweest, dus ${euroPrecies(gemist)} meer`}
          </span>
        </div>
      ) : null}
    </div>
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
        Wijs een moment aan om te zien wat er dan gebeurt.
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
  const overschot = Math.max(0, -dag.residualKwh[i]!) * KWH_NAAR_KW;
  const zon = a.uitZon[i]!;
  const uitNet = a.uitNet[i]!;
  const huis = a.naarHuis[i]!;
  const verkocht = a.naarNet[i]!;
  let batterijTekst = overschot > 0.02 ? `${getal(overschot, 1)} kW zon over` : "staat stil";
  if (zon + uitNet > 0.02) {
    const delen: string[] = [];
    if (zon > 0.02) delen.push(`${getal(zon, 1)} kW uit eigen zon`);
    if (uitNet > 0.02) delen.push(`${getal(uitNet, 1)} kW ingekocht`);
    batterijTekst = `laadt ${delen.join(" en ")}`;
    // Blijft er zon liggen omdat de batterij vol is of te weinig vermogen
    // heeft? Dat is precies wat je wilt weten.
    const rest = overschot - zon;
    if (rest > 0.05) batterijTekst += `, ${getal(rest, 1)} kW blijft over`;
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
        {batterijTekst} · {getal(dag.socKwh[i]!, 1)} kWh in de batterij
      </span>
      <span className="uitlezing-item">
        <i style={{ background: "var(--series-4)" }} />
        {netTekst}
        {afgeregeld > 0.02 ? ` · ${getal(afgeregeld, 1)} kW niet teruggeleverd` : ""}
      </span>
    </div>
  );
}
