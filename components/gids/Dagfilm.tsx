"use client";

/**
 * De dag als film: een schema van zon, huis, batterij en net, met daaronder een
 * tijdlijn met een schuif en een afspeelknop.
 *
 * Het schema laat per kwartier zien welke kant de stroom op gaat (de stromen
 * komen uit ./dag.ts). De film speelt een dag in zo'n tien seconden af, tenzij
 * je minder beweging hebt ingesteld: dan begint hij stil bij het moment waarop
 * de batterij het meeste doet, en speel je zelf af.
 *
 * Wat een schermlezer hoort: het onderschrift, één keer per fase en niet vaker
 * dan om de anderhalve seconde. Het schema zelf is een plaatje met een label;
 * de schuif meldt bij elk kwartier de klok, de prijs en hoe vol de batterij is.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getal } from "../../lib/format";
import type { SampleDay } from "../../lib/model/analysis";
import {
  beschrijf,
  centen,
  grootsteStroom,
  kwartierVanUur,
  kwhKwartier,
  mooisteKwartier,
  RUIS,
  stromenVan,
} from "./dag";

/** Zo lang duurt een dag in de film, in seconden. */
const DUUR_S = 10;

const ZON = "var(--series-5)";
const AFNAME = "var(--series-1)";
const TERUG = "var(--series-2)";
const BATTERIJ = "var(--series-3)";
const HUIS = "var(--ac)";

type Knoop = "zon" | "huis" | "batterij" | "net";
interface Punt {
  x: number;
  y: number;
}

interface Opzet {
  breed: number;
  hoog: number;
  straal: number;
  met: Record<Knoop, Punt>;
  zonder: Record<Knoop, Punt>;
}

/**
 * De plek van de knooppunten, voor een breed en een smal scherm. Op een telefoon
 * is de tekening kleiner dan de tekst: die krijgt daarom een eigen, dichter op
 * elkaar gezette opzet, zodat de letters ook daar leesbaar blijven. Zonder
 * panelen valt de zon weg en staat het net links.
 */
const RUIM: Opzet = {
  breed: 640,
  hoog: 414,
  straal: 42,
  met: {
    zon: { x: 108, y: 66 },
    net: { x: 532, y: 66 },
    huis: { x: 320, y: 178 },
    batterij: { x: 320, y: 330 },
  },
  zonder: {
    zon: { x: 108, y: 66 },
    huis: { x: 320, y: 78 },
    net: { x: 108, y: 292 },
    batterij: { x: 532, y: 292 },
  },
};
const KRAP: Opzet = {
  breed: 400,
  hoog: 346,
  straal: 34,
  met: {
    zon: { x: 62, y: 50 },
    net: { x: 338, y: 50 },
    huis: { x: 200, y: 150 },
    batterij: { x: 200, y: 262 },
  },
  zonder: {
    zon: { x: 62, y: 50 },
    huis: { x: 200, y: 62 },
    net: { x: 66, y: 252 },
    batterij: { x: 334, y: 252 },
  },
};

interface Verbinding {
  id: string;
  van: Knoop;
  naar: Knoop;
  kwh: number;
  kleur: string;
  /** Een stroom waarvan de grootte niet bekend is: alleen aan of uit. */
  vast?: boolean;
}

/** Zo ver blijft de lijn van het midden van een knooppunt vandaan. */
function uiteinden(a: Punt, b: Punt, terug: number, straal: number): { van: Punt; naar: Punt; hoek: number; lengte: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  const ux = dx / l;
  const uy = dy / l;
  const v = straal + 8;
  return {
    van: { x: a.x + ux * v, y: a.y + uy * v },
    naar: { x: b.x - ux * (v + terug), y: b.y - uy * (v + terug) },
    hoek: (Math.atan2(dy, dx) * 180) / Math.PI,
    lengte: l - 2 * v - terug,
  };
}

function Stroom({ v, plek, max, straal }: { v: Verbinding; plek: Record<Knoop, Punt>; max: number; straal: number }) {
  const a = plek[v.van];
  const b = plek[v.naar];
  const actief = v.kwh > RUIS;
  const w = (v.vast ? 6 : 4 + 12 * Math.sqrt(Math.min(1, v.kwh / max))) * (straal / 42);
  const kop = Math.max(13, w * 1.5);
  const g = uiteinden(a, b, actief ? kop * 0.8 : 0, straal);

  if (!actief) {
    return (
      <line
        className="dagfilm-rail-uit"
        x1={g.van.x}
        y1={g.van.y}
        x2={g.naar.x}
        y2={g.naar.y}
      />
    );
  }

  const periode = Math.round(w * 2.2 + 12);
  // Naar het huis toe zit het label dichter bij de bron, uit de buurt van "Je huis".
  const t = v.naar === "huis" && v.van === "net" && straal < 40 ? 0.38 : 0.5;
  const mid = { x: g.van.x + (g.naar.x - g.van.x) * t, y: g.van.y + (g.naar.y - g.van.y) * t };
  const punt = uiteinden(a, b, 0, straal).naar;

  return (
    <g data-stroom={v.id} style={{ color: v.kleur }}>
      <line
        className="dagfilm-rail"
        x1={g.van.x}
        y1={g.van.y}
        x2={g.naar.x}
        y2={g.naar.y}
        strokeWidth={w}
      />
      <line
        className="dagfilm-stippen"
        x1={g.van.x}
        y1={g.van.y}
        x2={g.naar.x}
        y2={g.naar.y}
        strokeWidth={w * 0.72}
        strokeDasharray={`0.1 ${periode}`}
        style={{ ["--periode" as string]: `-${periode}px` }}
      />
      <polygon
        className="dagfilm-pijl"
        points={`${-kop * 0.8},${-kop * 0.62} ${kop * 0.2},0 ${-kop * 0.8},${kop * 0.62}`}
        transform={`translate(${punt.x} ${punt.y}) rotate(${g.hoek})`}
      />
      {v.vast ? null : (
        <text className="dagfilm-waarde" x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="central">
          {kwhKwartier(v.kwh)}
        </text>
      )}
    </g>
  );
}

/** De vier iconen, getekend rond (0, 0) binnen een straal van ongeveer 28. */
function ZonIcoon({ actief }: { actief: boolean }) {
  return (
    <g className={actief ? "dagfilm-zon actief" : "dagfilm-zon"}>
      <g className="dagfilm-stralen">
        {Array.from({ length: 8 }, (_, k) => (
          <line key={k} x1={0} y1={-18} x2={0} y2={-27} transform={`rotate(${k * 45})`} />
        ))}
      </g>
      <circle r={11} className="dagfilm-vul" />
    </g>
  );
}

function HuisIcoon() {
  return (
    <g>
      <path d="M-25 -2 L0 -26 L25 -2" fill="none" />
      <path d="M-18 -6 V24 H18 V-6" fill="none" />
      <path d="M-5 24 V8 H5 V24" fill="none" />
    </g>
  );
}

function NetIcoon() {
  return (
    <g fill="none">
      <path d="M0 -28 L-13 26 M0 -28 L13 26" />
      <path d="M-17 -14 H17 M-14 0 H14" />
      <path d="M-13 26 L14 0 M13 26 L-14 0" strokeWidth={2} />
      <path d="M-17 -14 v6 M17 -14 v6 M-14 0 v6 M14 0 v6" />
    </g>
  );
}

function BatterijIcoon({ vulling }: { vulling: number }) {
  return (
    <g>
      <rect x={-6} y={-30} width={12} height={6} rx={2} className="dagfilm-vul" />
      <rect x={-15} y={-24} width={30} height={50} rx={6} fill="none" />
      <rect
        x={-11}
        y={-20}
        width={22}
        height={42}
        rx={3}
        className="dagfilm-niveau"
        style={{ transform: `scaleY(${Math.max(0.02, vulling)})` }}
      />
    </g>
  );
}

function Naam({ p, tekst, sub, boven, straal }: { p: Punt; tekst: string; sub?: string; boven?: boolean; straal: number }) {
  const y = boven ? p.y - straal - (sub ? 34 : 12) : p.y + straal + (straal < 40 ? 20 : 24);
  return (
    <>
      <text className="dagfilm-naam" x={p.x} y={y} textAnchor="middle">
        {tekst}
      </text>
      {sub ? (
        <text className="dagfilm-sub" x={p.x} y={y + (straal < 40 ? 19 : 23)} textAnchor="middle">
          {sub}
        </text>
      ) : null}
    </>
  );
}

function Schema({
  dag,
  i,
  metPanelen,
  max,
  krap,
}: {
  dag: SampleDay;
  i: number;
  metPanelen: boolean;
  max: number;
  krap: boolean;
}) {
  const opzet = krap ? KRAP : RUIM;
  const STRAAL = opzet.straal;
  const plek = metPanelen ? opzet.met : opzet.zonder;
  const s = stromenVan(dag, i);
  const cap = Math.max(dag.usableCapacityKwh, 0.001);
  const soc = dag.socKwh[i]!;
  const vulling = Math.min(1, soc / cap);

  const netUit = s.batterijNaarNet > s.netNaarBatterij;
  const verbindingen: Verbinding[] = [
    ...(metPanelen
      ? ([
          { id: "zon-huis", van: "zon", naar: "huis", kwh: s.zonNaarHuis ? 1 : 0, kleur: ZON, vast: true },
          { id: "zon-batterij", van: "zon", naar: "batterij", kwh: s.zonNaarBatterij, kleur: ZON },
          { id: "zon-net", van: "zon", naar: "net", kwh: s.zonNaarNet, kleur: TERUG },
        ] as Verbinding[])
      : []),
    { id: "net-huis", van: "net", naar: "huis", kwh: s.netNaarHuis, kleur: AFNAME },
    netUit
      ? { id: "batterij-net", van: "batterij", naar: "net", kwh: s.batterijNaarNet, kleur: TERUG }
      : { id: "net-batterij", van: "net", naar: "batterij", kwh: s.netNaarBatterij, kleur: AFNAME },
    { id: "batterij-huis", van: "batterij", naar: "huis", kwh: s.batterijNaarHuis, kleur: BATTERIJ },
  ];

  const zonActief = s.overschot0 > RUIS;
  const netKleur = s.naarNet > s.vanNet ? TERUG : AFNAME;

  return (
    <svg
      viewBox={`0 0 ${opzet.breed} ${opzet.hoog}`}
      className={krap ? "dagfilm-schema krap" : "dagfilm-schema"}
      role="img"
      aria-label={
        metPanelen
          ? "Schema van je huis met zonnepanelen, batterij en het net. De pijlen laten zien welke kant de stroom nu op gaat; wat er gebeurt staat eronder in woorden."
          : "Schema van je huis, batterij en het net. De pijlen laten zien welke kant de stroom nu op gaat; wat er gebeurt staat eronder in woorden."
      }
    >
      {/* Eerst de lijnen, zodat de knooppunten erbovenop staan. */}
      {verbindingen.map((v) => (
        <Stroom key={v.id} v={v} plek={plek} max={max} straal={STRAAL} />
      ))}

      {metPanelen ? (
        <g
          data-knoop="zon"
          transform={`translate(${plek.zon.x} ${plek.zon.y})`}
          className={zonActief ? "dagfilm-knoop" : "dagfilm-knoop uit"}
          style={{ color: ZON }}
        >
          <circle r={STRAAL} className="dagfilm-cirkel" />
          <g transform={`scale(${STRAAL / 42})`}>
            <ZonIcoon actief={zonActief} />
          </g>
        </g>
      ) : null}

      <g
        data-knoop="net"
        transform={`translate(${plek.net.x} ${plek.net.y})`}
        className="dagfilm-knoop"
        style={{ color: netKleur }}
      >
        <circle r={STRAAL} className="dagfilm-cirkel" />
        <g transform={`scale(${STRAAL / 42})`}>
          <NetIcoon />
        </g>
      </g>

      <g
        data-knoop="huis"
        transform={`translate(${plek.huis.x} ${plek.huis.y})`}
        className="dagfilm-knoop"
        style={{ color: HUIS }}
      >
        <circle r={STRAAL} className="dagfilm-cirkel" />
        <g transform={`scale(${STRAAL / 42})`}>
          <HuisIcoon />
        </g>
      </g>

      <g
        data-knoop="batterij"
        transform={`translate(${plek.batterij.x} ${plek.batterij.y})`}
        className="dagfilm-knoop"
        style={{ color: BATTERIJ }}
      >
        <circle r={STRAAL} className="dagfilm-cirkel" />
        <g transform={`scale(${STRAAL / 42})`}>
          <BatterijIcoon vulling={vulling} />
        </g>
      </g>

      {metPanelen ? (
        <Naam
          p={plek.zon}
          tekst="Zonnepanelen"
          sub={s.afgeregeld > 0.01 ? "regelen af" : undefined}
          straal={STRAAL}
        />
      ) : null}
      <Naam
        p={plek.net}
        tekst="Net"
        sub={krap ? centen(dag.importPrice[i]!) : `stroom kost ${centen(dag.importPrice[i]!)}`}
        straal={STRAAL}
      />
      <Naam p={plek.huis} tekst="Je huis" boven straal={STRAAL} />
      <Naam
        p={plek.batterij}
        tekst="Batterij"
        sub={`${getal(soc, 1)} van ${getal(cap, 1)} kWh`}
        straal={STRAAL}
      />
    </svg>
  );
}

/** De breedte van een element in pixels, zodat tekst in een figuur niet met het scherm meeschaalt. */
function useBreedte(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [breedte, zetBreedte] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const meet = () => zetBreedte(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    meet();
    if (typeof ResizeObserver === "undefined") return;
    const kijker = new ResizeObserver(meet);
    kijker.observe(el);
    return () => kijker.disconnect();
  }, []);
  return [ref, breedte];
}

/** De prijs en de lading over de dag, met een markering op het moment van nu. */
function Tijdlijn({ dag, i }: { dag: SampleDay; i: number }) {
  const n = dag.startMs.length;
  const [ref, B] = useBreedte();
  const H = 104;
  const top = 30;
  const bodem = 78;
  const prijzen = dag.importPrice;
  const laag = Math.min(...prijzen);
  const hoog = Math.max(...prijzen);
  const bereik = Math.max(hoog - laag, 0.02);
  const cap = Math.max(dag.usableCapacityKwh, 0.001);
  const x = (k: number) => (k / Math.max(1, n - 1)) * B;
  const yPrijs = (p: number) => bodem - ((p - laag) / bereik) * (bodem - top);
  const ySoc = (v: number) => bodem - Math.min(1, v / cap) * (bodem - top);

  const lijn = prijzen.map((p, k) => `${k === 0 ? "M" : "L"}${x(k).toFixed(1)} ${yPrijs(p).toFixed(1)}`).join(" ");
  const vlak = `M0 ${bodem} ${dag.socKwh.map((v, k) => `L${x(k).toFixed(1)} ${ySoc(v).toFixed(1)}`).join(" ")} L${B} ${bodem} Z`;

  const uren = useMemo(() => [0, 6, 12, 18].map((u) => ({ u, k: kwartierVanUur(dag, u) ?? 0 })), [dag]);

  const mx = x(i);
  const my = yPrijs(prijzen[i]!);
  const tekstX = Math.min(B - 34, Math.max(34, mx));

  return (
    <div ref={ref} className="dagfilm-tijdlijn-vak">
      <svg viewBox={`0 0 ${B} ${H}`} width={B} height={H} className="dagfilm-tijdlijn" aria-hidden="true" focusable="false">
        <path d={vlak} className="dagfilm-lading" />
        <line x1={0} x2={B} y1={bodem} y2={bodem} className="dagfilm-as" />
        <path d={lijn} className="dagfilm-prijslijn" />
        <line x1={mx} x2={mx} y1={top - 8} y2={bodem} className="dagfilm-markering" />
        <circle cx={mx} cy={my} r={5} className="dagfilm-punt" />
        <text x={tekstX} y={top - 13} textAnchor="middle" className="dagfilm-prijs">
          {centen(prijzen[i]!)}
        </text>
        {uren.map(({ u, k }) => (
          <text
            key={u}
            x={u === 0 ? 0 : x(k)}
            y={H - 6}
            textAnchor={u === 0 ? "start" : "middle"}
            className="dagfilm-uur"
          >
            {B < 480 ? `${u}.00` : `${u}.00 uur`}
          </text>
        ))}
        <text x={B} y={H - 6} textAnchor="end" className="dagfilm-uur">
          {B < 480 ? "24.00" : "24.00 uur"}
        </text>
      </svg>
    </div>
  );
}

/** Heeft de gebruiker minder beweging ingesteld? Null zolang dat nog niet bekend is. */
function useMinderBeweging(): boolean | null {
  const [minder, zetMinder] = useState<boolean | null>(null);
  useEffect(() => {
    const m = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!m) {
      zetMinder(false);
      return;
    }
    zetMinder(m.matches);
    const op = () => zetMinder(m.matches);
    m.addEventListener?.("change", op);
    return () => m.removeEventListener?.("change", op);
  }, []);
  return minder;
}

export function Dagfilm({
  dag,
  metPanelen,
  autoplay = true,
}: {
  dag: SampleDay;
  metPanelen: boolean;
  /** Begin vanzelf met afspelen zodra de film in beeld komt. */
  autoplay?: boolean;
}) {
  const n = dag.startMs.length;
  const wortel = useRef<HTMLDivElement>(null);
  const [filmRef, filmBreedte] = useBreedte();
  const minder = useMinderBeweging();
  const [i, zetI] = useState(() => (autoplay ? 0 : mooisteKwartier(dag)));
  const [speelt, zetSpeelt] = useState(false);
  const [zichtbaar, zetZichtbaar] = useState(false);
  const positie = useRef(i);
  const begonnen = useRef(false);

  const max = useMemo(() => grootsteStroom(dag), [dag]);
  const beeld = beschrijf(dag, i, metPanelen);

  // In beeld: pas dan begint de film, anders is hij afgelopen voor je hem ziet.
  useEffect(() => {
    const el = wortel.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      zetZichtbaar(true);
      return;
    }
    const kijker = new IntersectionObserver(
      (rijen) => {
        if (rijen.some((r) => r.isIntersecting)) {
          zetZichtbaar(true);
          kijker.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    kijker.observe(el);
    return () => kijker.disconnect();
  }, []);

  useEffect(() => {
    if (minder === null || begonnen.current) return;
    if (minder) {
      // Geen vanzelf bewegende film: begin bij het moment waar het om draait.
      begonnen.current = true;
      const k = mooisteKwartier(dag);
      positie.current = k;
      zetI(k);
      return;
    }
    if (autoplay && zichtbaar) {
      begonnen.current = true;
      positie.current = 0;
      zetI(0);
      zetSpeelt(true);
    }
  }, [minder, autoplay, zichtbaar, dag]);

  useEffect(() => {
    if (!speelt) return;
    let raf = 0;
    let laatste: number | null = null;
    const tik = (nu: number) => {
      // Het eerste beeld zet alleen de klok; na een verborgen tabblad springen we
      // niet ineens een halve dag verder.
      const dt = laatste === null ? 0 : Math.max(0, Math.min(0.1, (nu - laatste) / 1000));
      laatste = nu;
      positie.current = Math.min(n - 1, positie.current + (dt * n) / DUUR_S);
      const k = Math.floor(positie.current);
      zetI(k);
      if (positie.current >= n - 1) {
        zetSpeelt(false);
        return;
      }
      raf = requestAnimationFrame(tik);
    };
    raf = requestAnimationFrame(tik);
    return () => cancelAnimationFrame(raf);
  }, [speelt, n]);

  // Voor een schermlezer: het onderschrift, één keer per fase en niet vaker dan
  // om de paar tellen. Het zichtbare onderschrift springt wel bij elk kwartier mee.
  const [aangekondigd, zetAangekondigd] = useState("");
  const laatsteFase = useRef<string | null>(null);
  const tekstNu = useRef(beeld.tekst);
  tekstNu.current = beeld.tekst;
  useEffect(() => {
    if (laatsteFase.current === beeld.fase) return;
    const t = window.setTimeout(() => {
      laatsteFase.current = beeld.fase;
      zetAangekondigd(tekstNu.current);
    }, laatsteFase.current === null ? 0 : 1500);
    return () => window.clearTimeout(t);
  }, [beeld.fase]);

  const naarBegin = i >= n - 1 && !speelt;
  const soc = dag.socKwh[i]!;
  const cap = Math.max(dag.usableCapacityKwh, 0.001);

  return (
    <div className="dagfilm" ref={wortel} data-fase={beeld.fase}>
      <div className="dagfilm-film" ref={filmRef}>
        <Schema dag={dag} i={i} metPanelen={metPanelen} max={max} krap={filmBreedte < 520} />
      </div>

      <div className="dagfilm-bediening">
        <div className="dagfilm-rij">
          <button
            type="button"
            className="dagfilm-knop"
            onClick={() => {
              if (speelt) {
                zetSpeelt(false);
                return;
              }
              if (naarBegin) {
                positie.current = 0;
                zetI(0);
              }
              zetSpeelt(true);
            }}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
              {speelt ? (
                <path d="M5 3h3.5v14H5zM11.5 3H15v14h-3.5z" />
              ) : naarBegin ? (
                <path d="M10 3a7 7 0 1 0 7 7h-2.4A4.6 4.6 0 1 1 10 5.4V8l4-4-4-4z" transform="translate(0 1.5)" />
              ) : (
                <path d="M6 3.5v13l11-6.5z" />
              )}
            </svg>
            {speelt ? "Pauze" : naarBegin ? "Nog een keer" : "Afspelen"}
          </button>
          <div className="dagfilm-klok" aria-hidden="true">
            {beeld.klok}
          </div>
        </div>

        <p className="dagfilm-onderschrift" data-fase={beeld.fase}>
          <span className="dagfilm-onderschrift-zin">{beeld.zin}</span>
        </p>
        <div className="visueel-verborgen" role="status" aria-live="polite" aria-atomic="true">
          {aangekondigd}
        </div>
      </div>

      <div className="dagfilm-tijd">
        <Tijdlijn dag={dag} i={i} />
        <input
          type="range"
          className="dagfilm-schuif"
          min={0}
          max={n - 1}
          step={1}
          value={i}
          aria-label="Tijdstip op de dag"
          aria-valuetext={`${beeld.klok}, stroom kost ${centen(dag.importPrice[i]!)}, batterij ${Math.round(
            (soc / cap) * 100,
          )}% vol`}
          onChange={(e) => {
            const k = Number(e.target.value);
            positie.current = k;
            zetSpeelt(false);
            zetI(k);
          }}
        />
        <ul className="dagfilm-legenda">
          <li>
            <span className="dagfilm-swatch lijn" aria-hidden="true" />
            wat stroom kost
          </li>
          <li>
            <span className="dagfilm-swatch vlak" aria-hidden="true" />
            hoe vol de batterij is
          </li>
        </ul>
      </div>
    </div>
  );
}
