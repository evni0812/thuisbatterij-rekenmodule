"use client";

/**
 * Gedeelde bouwstenen voor de grafieken.
 *
 * Alle grafieken zijn inline SVG met dezelfde anatomie: recessieve
 * rasterlijnen, een duidelijke nullijn, dunne marks met 4px afgeronde uiteinden
 * aan de kant van de waarde, en een legenda zodra er meer dan één serie is.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";

export const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
] as const;

export function Figure({
  titel,
  toelichting,
  children,
  actie,
}: {
  /** De titel noemt de conclusie, niet de asnamen. */
  titel: string;
  toelichting?: ReactNode;
  children: ReactNode;
  actie?: ReactNode;
}) {
  return (
    <figure className="figure">
      <div className="figure-kop">
        <div>
          <h3>{titel}</h3>
          {toelichting ? <p className="figure-uitleg">{toelichting}</p> : null}
        </div>
        {actie}
      </div>
      {children}
    </figure>
  );
}

export function Legenda({
  items,
}: {
  items: { kleur: string; label: string; waarde?: string }[];
}) {
  return (
    <ul className="legenda">
      {items.map((it) => (
        <li key={it.label}>
          <span className="legenda-vlak" style={{ background: it.kleur }} />
          <span className="legenda-label">{it.label}</span>
          {it.waarde ? <span className="legenda-waarde">{it.waarde}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Horizontale rasterlijnen plus de nullijn, in SVG-coördinaten. */
export function Raster({
  ticks,
  x0,
  x1,
  schaal,
  labelBreedte = 0,
  formatter,
}: {
  ticks: number[];
  x0: number;
  x1: number;
  schaal: (v: number) => number;
  labelBreedte?: number;
  formatter?: (v: number) => string;
}) {
  return (
    <g>
      {ticks.map((t) => {
        const y = schaal(t);
        const isNul = Math.abs(t) < 1e-9;
        return (
          <g key={t}>
            <line
              x1={x0}
              x2={x1}
              y1={y}
              y2={y}
              stroke={isNul ? "var(--axis)" : "var(--grid)"}
              strokeWidth={isNul ? 1.5 : 1}
            />
            {formatter && labelBreedte > 0 ? (
              <text
                x={x0 - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="as-label"
              >
                {formatter(t)}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Kies ronde tickwaarden binnen een bereik.
 * Altijd inclusief nul als het bereik daar doorheen loopt: dat is het ijkpunt.
 */
export function kiesTicks(min: number, max: number, aantal = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min || 0];
  }
  const ruw = (max - min) / aantal;
  const macht = Math.pow(10, Math.floor(Math.log10(Math.abs(ruw) || 1)));
  const genormaliseerd = ruw / macht;
  const stap =
    (genormaliseerd <= 1 ? 1 : genormaliseerd <= 2 ? 2 : genormaliseerd <= 5 ? 5 : 10) *
    macht;

  const ticks: number[] = [];
  const start = Math.ceil(min / stap) * stap;
  for (let t = start; t <= max + stap * 1e-6; t += stap) {
    ticks.push(Math.abs(t) < stap * 1e-6 ? 0 : t);
  }
  if (min < 0 && max > 0 && !ticks.some((t) => t === 0)) ticks.push(0);
  return ticks.sort((a, b) => a - b);
}


/* ── Aanwijzen ─────────────────────────────────────────────────────────────
 *
 * Elke grafiek leest af bij aanwijzen. Eerder stonden de waarden alleen als
 * vaste labels in de figuur, en moest je de rest uit de toelichting halen.
 *
 * De kaart volgt de muis maar dekt het aangewezen punt nooit af: hij staat
 * ernaast en klapt naar de andere kant zodra de cursor voorbij het midden komt.
 * Hij vangt zelf geen muis (`pointer-events: none`), zodat hij het aanwijzen
 * niet in de weg zit.
 */

export interface TipRegel {
  /** Het kleurvlakje vóór het label; laat weg als de regel geen reeks is. */
  kleur?: string;
  label: string;
  waarde?: string;
  /** De uitkomst: dikker, met een scheidingslijn erboven. */
  uitkomst?: boolean;
}

export interface TipInhoud {
  titel: string;
  regels: TipRegel[];
  /** Eén korte zin onderaan, voor context die geen getal is. */
  noot?: string;
}

interface TipStand {
  px: number;
  py: number;
  kaderBreedte: number;
  inhoud: TipInhoud;
}

/** Een punt met clientcoördinaten: een muis-, aanwijs- of aanraakgebeurtenis. */
interface Punt {
  clientX: number;
  clientY: number;
}

export function useTip() {
  const kader = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipStand | null>(null);

  const toon = useCallback((punt: Punt | null | undefined, inhoud: TipInhoud) => {
    const el = kader.current;
    if (!el || !punt) return;
    const r = el.getBoundingClientRect();
    setTip({
      px: punt.clientX - r.left,
      py: punt.clientY - r.top,
      kaderBreedte: r.width,
      inhoud,
    });
  }, []);

  const wis = useCallback(() => setTip(null), []);

  return { kader, tip, toon, wis };
}

/**
 * Het kader om een grafiek: de scrollende plot, met de aanwijskaart erbovenop.
 *
 * De kaart hangt aan het buitenste element en niet aan de scrollende laag,
 * anders zou hij mee scrollen of door `overflow-x` worden afgeknipt.
 */
export function Grafiek({
  label,
  tip,
  onWis,
  kader,
  klasse,
  children,
}: {
  /** Wat er in de scrollende regio te zien is, voor schermlezers. */
  label?: string;
  tip: ReturnType<typeof useTip>["tip"];
  onWis: () => void;
  kader: ReturnType<typeof useTip>["kader"];
  /** Extra klasse op de scrollende laag, bijvoorbeeld voor een minimumbreedte. */
  klasse?: string;
  children: ReactNode;
}) {
  return (
    <div className="chart-hover" ref={kader} onMouseLeave={onWis}>
      <div
        className={klasse ? `chart-wrap ${klasse}` : "chart-wrap"}
        tabIndex={0}
        role="group"
        aria-label={label ?? "Grafiek, horizontaal scrollbaar"}
      >
        {children}
      </div>
      <TipLaag tip={tip} />
    </div>
  );
}

/**
 * De kaart zelf, apart zodat een figuur die geen SVG is — de prijskloof, met
 * balken van gewone elementen — dezelfde kaart kan tonen zonder hem na te
 * bouwen.
 */
export function TipLaag({ tip }: { tip: TipStand | null }) {
  if (!tip) return null;
  const { px, py, kaderBreedte, inhoud } = tip;
  // Voorbij het midden klapt de kaart naar links, zodat hij binnen het kader
  // blijft zonder dat we zijn breedte hoeven te meten.
  const naarLinks = px > kaderBreedte * 0.55;
  return (
    <div
      className="tip"
      role="status"
      style={
        naarLinks
          ? { right: Math.max(8, kaderBreedte - px + 14), top: py }
          : { left: Math.max(8, px + 14), top: py }
      }
    >
      <p className="tip-titel">{inhoud.titel}</p>
      <ul className="tip-regels">
        {inhoud.regels.map((r, i) => (
          <li key={`${r.label}${i}`} className={r.uitkomst ? "tip-uitkomst" : undefined}>
            <span className="tip-label">
              {r.kleur ? <i style={{ background: r.kleur }} /> : null}
              {r.label}
            </span>
            {r.waarde ? <span className="tip-waarde">{r.waarde}</span> : null}
          </li>
        ))}
      </ul>
      {inhoud.noot ? <p className="tip-noot">{inhoud.noot}</p> : null}
    </div>
  );
}

/**
 * Een onzichtbaar trefvlak over een mark, breder dan de mark zelf.
 *
 * Aanwijzen mag niet vragen om precisie: een staaf van vier pixels breed is met
 * een muis nauwelijks te raken en met een vinger niet.
 *
 * Altijd doorzichtig en bovenop alle marks: het vlak moet de gebeurtenis
 * krijgen, ook boven een staaf. De markering van wat je aanwijst hoort dus
 * áchter de marks getekend te worden, niet hier.
 */
export function Trefvlak({
  x,
  y,
  breedte,
  hoogte,
  onWijs,
  onWis,
}: {
  x: number;
  y: number;
  breedte: number;
  hoogte: number;
  onWijs: (punt: Punt) => void;
  onWis: () => void;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={Math.max(1, breedte)}
      height={Math.max(1, hoogte)}
      fill="transparent"
      className="trefvlak"
      /*
       * Niet focusbaar en niet in de toegankelijkheidsboom. De svg eromheen
       * draagt role="img" met een samenvattende aria-label, en de inhoud van
       * zo'n element wordt toch niet voorgelezen; een focusbaar kind daarbinnen
       * is dan een val: wel bereikbaar met tab, niet aangekondigd. De cijfers
       * staan daarom in de tekst onder elke figuur.
       */
      aria-hidden="true"
      onMouseMove={(e) => onWijs(e)}
      onMouseEnter={(e) => onWijs(e)}
      onMouseLeave={onWis}
      onTouchStart={(e) => onWijs(e.touches[0]!)}
      onTouchMove={(e) => onWijs(e.touches[0]!)}
    />
  );
}
