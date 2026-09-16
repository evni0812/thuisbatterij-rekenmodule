"use client";

/**
 * Het tarievenblad van het nettarief vanaf 2029.
 *
 * ── Twee panelen, niet één ──────────────────────────────────────────────────
 * Winter en zomer in één assenstelsel leek zuinig: dezelfde uren, dezelfde as,
 * twee reeksen. In de praktijk werd het een muur van staven die elkaar
 * overlappen, waarin je geen van beide seizoenen nog kon volgen. Ze hoeven ook
 * niet in één beeld: je vergelijkt ze niet uur voor uur, je leest ze als twee
 * tariefbladen. Twee panelen onder elkaar op dezelfde schaal, dus.
 *
 * ── Blokken, geen uren ──────────────────────────────────────────────────────
 * Het tarief is per tijdsblok constant — dat is de hele opzet van het voorstel.
 * Vierentwintig losse staafjes tekenen suggereert vierentwintig tarieven; één
 * vlak per blok, met het bedrag erin, laat zien wat er werkelijk staat: vijf
 * blokken per dag met elk één prijs.
 *
 * ── En waar je vandaan komt ─────────────────────────────────────────────────
 * Een kleinverbruiker betaalt vandaag nul cent per kilowattuur transport: de
 * netkosten zitten in een vast bedrag per jaar. Dat is het hele punt van de
 * wijziging, dus de nullijn heet hier "nu".
 */

import { useState } from "react";
import { centPerKwh, getal } from "../lib/format";
import {
  BASISTARIEF,
  NETTARIEF_JAAR,
  factorVoorMaand,
  piekurenVoorMaand,
} from "../lib/nettarief";
import { Grafiek, Trefvlak, useTip } from "./chart-parts";

/** Kleur per wegingsfactor: donkerder is duurder. Sequentieel, één hue. */
export function tintVoorFactor(factor: number): string {
  if (factor <= 0) return "var(--seq-100)";
  if (factor <= 0.3) return "var(--seq-200)";
  if (factor <= 0.5) return "var(--seq-400)";
  if (factor <= 0.7) return "var(--seq-500)";
  return "var(--seq-700)";
}

/** Vanaf welke tint de tekst erop wit moet zijn om leesbaar te blijven. */
function tekstOpTint(factor: number): string {
  return factor >= 0.5 ? "var(--surface-1)" : "var(--text-primary)";
}

/** Eén aaneengesloten reeks uren met hetzelfde tarief. */
interface Blok {
  van: number;
  /** Exclusief: het eerste uur dat er niet meer bij hoort. */
  tot: number;
  factor: number;
  tarief: number;
  piek: boolean;
  naam: string;
}

function blokken(maand: number, basis: number): Blok[] {
  const factoren = factorVoorMaand(maand);
  const piek = piekurenVoorMaand(maand);
  const uit: Blok[] = [];
  for (let u = 0; u < 24; u++) {
    const laatste = uit[uit.length - 1];
    if (laatste && laatste.factor === factoren[u]!) {
      laatste.tot = u + 1;
      continue;
    }
    uit.push({
      van: u,
      tot: u + 1,
      factor: factoren[u]!,
      tarief: factoren[u]! * basis,
      piek: piek[u] === true,
      naam: "",
    });
  }
  // De naam volgt uit de plek in de dag en de hoogte van het blok, niet uit een
  // vaste lijst: zo klopt hij ook als de factoren ooit wijzigen.
  const hoogste = Math.max(...uit.map((b) => b.factor));
  for (const b of uit) {
    const middenUur = (b.van + b.tot) / 2;
    b.naam =
      b.factor === 0
        ? "gratis"
        : b.factor === hoogste
          ? "piek"
          : middenUur < 6.5
            ? "nacht"
            : middenUur < 10
              ? "ochtend"
              : middenUur < 17
                ? "dag"
                : "avond";
  }
  return uit;
}

const B = 780;
const PANEEL = 118;
const MARGE = { boven: 24, rechts: 16, onder: 30, links: 52 };
/** Ruimte tussen de twee panelen: de uuras van het bovenste plus de kop van het onderste. */
const TUSSEN = 52;

const SEIZOENEN = [
  { maand: 1, titel: "Winter · oktober tot en met maart" },
  { maand: 6, titel: "Zomer · april tot en met september" },
];

export function Tariefblad({
  markeerPiek = false,
}: {
  /** Markeer het blok waarop de statistiek "minder uit de piekuren" rust. */
  markeerPiek?: boolean;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<string | null>(null);

  const basis = BASISTARIEF[NETTARIEF_JAAR];
  const panelen = SEIZOENEN.map((s) => ({ ...s, blokken: blokken(s.maand, basis) }));

  const plotB = B - MARGE.links - MARGE.rechts;
  const uurB = plotB / 24;
  const x = (u: number) => MARGE.links + u * uurB;
  const top = basis * 1.1;
  const paneelTop = (i: number) => MARGE.boven + i * (PANEEL + TUSSEN);
  const y = (i: number, v: number) => paneelTop(i) + (1 - v / top) * PANEEL;
  const H = MARGE.boven + panelen.length * (PANEEL + TUSSEN) - TUSSEN + MARGE.onder;

  const ticks = [0, 0.05, 0.1, 0.15].filter((t) => t <= top);

  return (
    <>
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setAangewezen(null);
          wis();
        }}
        label={`Het nettarief per tijdsblok in ${NETTARIEF_JAAR}, winter en zomer apart`}
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart"
          role="img"
          aria-label={panelen
            .map(
              (p) =>
                `${p.titel}: ${p.blokken
                  .map(
                    (b) =>
                      `${b.van}:00 tot ${b.tot}:00 ${centPerKwh(b.tarief)}`,
                  )
                  .join(", ")}`,
            )
            .join(". ")}
        >
          {panelen.map((paneel, i) => {
            const grond = y(i, 0);
            return (
              <g key={paneel.titel}>
                <text x={MARGE.links} y={paneelTop(i) - 9} className="paneel-titel">
                  {paneel.titel}
                </text>

                {ticks.map((t) => (
                  <g key={`${i}-${t}`}>
                    <line
                      x1={MARGE.links}
                      x2={B - MARGE.rechts}
                      y1={y(i, t)}
                      y2={y(i, t)}
                      stroke={t === 0 ? "var(--axis)" : "var(--grid)"}
                      strokeWidth={t === 0 ? 1.5 : 1}
                    />
                    <text
                      x={MARGE.links - 8}
                      y={y(i, t)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      className="as-label"
                    >
                      {t === 0 ? "nu 0" : getal(t * 100, 0)}
                    </text>
                  </g>
                ))}

                {paneel.blokken.map((b) => {
                  const bovenkant = y(i, b.tarief);
                  const hoog = grond - bovenkant;
                  const breed = (b.tot - b.van) * uurB;
                  const sleutel = `${i}-${b.van}`;
                  const binnen = hoog > 22 && breed > 42;
                  return (
                    <g key={sleutel}>
                      <rect
                        x={x(b.van) + 1}
                        y={bovenkant}
                        width={breed - 2}
                        height={Math.max(2, hoog)}
                        fill={tintVoorFactor(b.factor)}
                        rx={2}
                        stroke={
                          aangewezen === sleutel
                            ? "var(--text-primary)"
                            : markeerPiek && b.piek
                              ? "var(--ac2)"
                              : "none"
                        }
                        strokeWidth={aangewezen === sleutel ? 2 : 1.5}
                      />
                      {/* Het bedrag staat in het blok; past het er niet in, dan
                          erboven. Kleur draagt de prijs nooit alleen. */}
                      <text
                        x={x(b.van) + breed / 2}
                        y={binnen ? bovenkant + 16 : bovenkant - 6}
                        textAnchor="middle"
                        className={binnen ? "mark-label" : "mark-label op-lijn"}
                        fill={binnen ? tekstOpTint(b.factor) : "var(--text-primary)"}
                      >
                        {getal(b.tarief * 100, 1)} ct
                      </text>
                      {breed > 52 ? (
                        <text
                          x={x(b.van) + breed / 2}
                          y={grond + 14}
                          textAnchor="middle"
                          className="as-label"
                        >
                          {b.naam}
                        </text>
                      ) : null}
                    </g>
                  );
                })}

                {[0, 6, 12, 18, 24].map((u) => (
                  <text
                    key={`u${i}-${u}`}
                    x={x(u)}
                    y={grond + 27}
                    textAnchor="middle"
                    className="as-label zwak"
                  >
                    {u === 24 ? "24:00" : `${u}:00`}
                  </text>
                ))}

                {paneel.blokken.map((b) => (
                  <Trefvlak
                    key={`t${i}-${b.van}`}
                    x={x(b.van)}
                    y={paneelTop(i)}
                    breedte={(b.tot - b.van) * uurB}
                    hoogte={PANEEL}
                    onWijs={(punt) => {
                      setAangewezen(`${i}-${b.van}`);
                      toon(punt, {
                        titel: `${paneel.titel.split(" · ")[0]}, ${String(b.van).padStart(
                          2,
                          "0",
                        )}:00 – ${String(b.tot).padStart(2, "0")}:00`,
                        regels: [
                          {
                            kleur: tintVoorFactor(b.factor),
                            label: `Nettarief vanaf ${NETTARIEF_JAAR}`,
                            waarde: centPerKwh(b.tarief),
                            uitkomst: true,
                          },
                          { label: "Wat je nu betaalt", waarde: "0 ct/kWh" },
                          { label: "Wegingsfactor", waarde: getal(b.factor, 1) },
                        ],
                        noot: b.piek
                          ? "Piekblok: hierop wordt “minder uit de piekuren” gemeten."
                          : b.factor === 0
                            ? "Gratis: op deze uren staat het net vol zonnestroom."
                            : undefined,
                      });
                    }}
                    onWis={() => {
                      setAangewezen(null);
                      wis();
                    }}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </Grafiek>

      <p className="tariefblad-legenda">
        Bedragen in centen per kilowattuur die je van het net haalt, bovenop de
        stroomprijs. Donkerder is duurder. Vandaag betaal je hiervoor{" "}
        <b>niets per kilowattuur</b>: je netkosten zijn een vast bedrag per jaar,
        vandaar de nul op de as. Elk blok is een wegingsfactor uit het voorstel —
        0, 0,3, 0,5, 0,7 of 1 — maal het basistarief van {centPerKwh(basis)}.
        {markeerPiek
          ? " Het omlijnde blok is de piek waarop “afname in de piekuren” wordt gemeten."
          : ""}
      </p>
    </>
  );
}
