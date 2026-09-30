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

/**
 * De tinten als hexwaarde, gelijk aan --seq-* in theme.css (een test bewaakt
 * dat), zodat het contrast met de tekst erop te berekenen valt.
 */
export const TINT_HEX = {
  "var(--seq-100)": "#e3ecea",
  "var(--seq-200)": "#c2d6d2",
  "var(--seq-400)": "#6f9e97",
  "var(--seq-500)": "#4a807a",
  "var(--seq-700)": "#1a3c3b",
} as const;
export const TEKST_DONKER = "#1a1f1e";
export const TEKST_LICHT = "#ffffff";

function relatieveLuminantie(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** Het WCAG-contrast tussen twee hexkleuren: 1 (gelijk) tot 21. */
export function contrast(a: string, b: string): number {
  const la = relatieveLuminantie(a);
  const lb = relatieveLuminantie(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * De tekstkleur met het meeste contrast op de tint van deze factor. Eerder
 * kozen we op een drempel in de factor, en dat pakte precies bij het
 * donkerste blok de donkere tekst: 1,4 op 1, onleesbaar.
 */
export function tekstOpTint(factor: number): string {
  const bg = TINT_HEX[tintVoorFactor(factor) as keyof typeof TINT_HEX];
  return contrast(bg, TEKST_DONKER) >= contrast(bg, TEKST_LICHT) ? TEKST_DONKER : TEKST_LICHT;
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
  /** Loopt over middernacht: `tot` is dan groter dan 24 (25 = 01:00 de volgende dag). */
  wikkel?: boolean;
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
  // Een blok dat om middernacht doorloopt (23:00 tot 01:00) is één blok, geen
  // twee: dezelfde factor aan het begin en aan het eind van de dag telt samen.
  if (uit.length > 1 && uit[0]!.factor === uit[uit.length - 1]!.factor) {
    const eerste = uit.shift()!;
    const laatste = uit[uit.length - 1]!;
    laatste.tot = 24 + eerste.tot;
    laatste.wikkel = true;
  }
  // De naam volgt uit de plek in de dag en de hoogte van het blok, niet uit een
  // vaste lijst: zo klopt hij ook als de factoren ooit wijzigen.
  const hoogste = Math.max(...uit.map((b) => b.factor));
  for (const b of uit) {
    const middenUur = ((b.van + b.tot) / 2) % 24;
    b.naam =
      b.factor === 0
        ? "geen tarief"
        : b.factor === hoogste
          ? "piek"
          : b.wikkel
            ? "middernacht"
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

const B_STANDAARD = 780;
const PANEEL = 118;
/** Ruimte tussen de twee panelen: de uuras van het bovenste plus de kop van het onderste. */
const TUSSEN = 60;

const SEIZOENEN = [
  { maand: 1, titel: "Winter · oktober tot en met maart" },
  { maand: 6, titel: "Zomer · april tot en met september" },
];

/** De uren van een blok als tekst: "23.00 tot 1.00 uur". */
function uren(b: Blok): string {
  const u = (h: number) => `${h % 24}.00`;
  return `${u(b.van)} tot ${u(b.tot)} uur`;
}

export function Tariefblad({
  markeerPiek = false,
}: {
  /** Markeer het blok waarop de tegel "Afname in de piekuren" rust. */
  markeerPiek?: boolean;
}) {
  const { kader, tip, toon, wis, breedte: gemeten } = useTip();
  const [aangewezen, setAangewezen] = useState<string | null>(null);

  // De viewBox volgt het kader, zodat de letters overal even groot zijn en de
  // grafiek op een telefoon past zonder zijwaarts te scrollen.
  const B = gemeten ?? B_STANDAARD;
  const smal = B < 560;
  const MARGE = { boven: 24, rechts: smal ? 8 : 16, onder: 34, links: smal ? 44 : 52 };

  const basis = BASISTARIEF[NETTARIEF_JAAR];
  const panelen = SEIZOENEN.map((s) => ({ ...s, blokken: blokken(s.maand, basis) }));
  const heeftWikkel = panelen.some((p) => p.blokken.some((b) => b.wikkel));

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
          className="chart chart-fluid"
          role="img"
          aria-label={panelen
            .map(
              (p) =>
                `${p.titel}: ${p.blokken
                  .map((b) => `${uren(b)} ${centPerKwh(b.tarief)}`)
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
                {/* De eenheid van de as, boven het bovenste getal. */}
                <text
                  x={MARGE.links - 8}
                  y={paneelTop(i) - 9}
                  textAnchor="end"
                  className="as-label zwak"
                >
                  ct/kWh
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
                  const sleutel = `${i}-${b.van}`;
                  const kleur = tintVoorFactor(b.factor);
                  const rand =
                    aangewezen === sleutel
                      ? "var(--text-primary)"
                      : markeerPiek && b.piek
                        ? "var(--ac2)"
                        : "none";
                  const randB = aangewezen === sleutel ? 2 : 1.5;
                  // Een blok over middernacht bestaat uit twee stukken op
                  // dezelfde as: het einde van de dag en het begin ervan.
                  const stukken = b.tot > 24
                    ? [
                        { van: b.van, tot: 24 },
                        { van: 0, tot: b.tot - 24 },
                      ]
                    : [{ van: b.van, tot: b.tot }];
                  // Het label hoort bij het grootste stuk; bij gelijke stukken
                  // bij het eerste van de dag.
                  const hoofd = stukken.reduce((m, st) =>
                    st.tot - st.van > m.tot - m.van || (st.tot - st.van === m.tot - m.van && st.van < m.van) ? st : m,
                  );
                  const breed = (hoofd.tot - hoofd.van) * uurB;
                  const binnen = hoog > 22 && breed > 46;
                  const naamBinnen = binnen && hoog > 44 && breed > 52;
                  // Aan de rand van de plot blijft het label binnen de plot.
                  const aanLinks = hoofd.van === 0;
                  const aanRechts = hoofd.tot === 24;
                  // Een smal blok naast een hoger blok: het label loopt naar de
                  // lagere buur, anders verdwijnt het achter het hogere blok.
                  const bi = paneel.blokken.indexOf(b);
                  const links = bi > 0 ? paneel.blokken[bi - 1]! : null;
                  const rechts = bi < paneel.blokken.length - 1 ? paneel.blokken[bi + 1]! : null;
                  const smalBlok = !binnen && breed < 44 && !aanLinks && !aanRechts;
                  const naarLinks = smalBlok && (links?.tarief ?? 0) <= (rechts?.tarief ?? 0);
                  const naarRechts = smalBlok && !naarLinks;
                  const labelX = binnen
                    ? x(hoofd.van) + breed / 2
                    : aanLinks
                      ? x(hoofd.van) + 2
                      : aanRechts || naarLinks
                        ? x(hoofd.tot) - 2
                        : naarRechts
                          ? x(hoofd.van) + 2
                          : x(hoofd.van) + breed / 2;
                  const anker = binnen
                    ? "middle"
                    : aanLinks || naarRechts
                      ? "start"
                      : aanRechts || naarLinks
                        ? "end"
                        : "middle";
                  const tekstKleur = tekstOpTint(b.factor);
                  return (
                    <g key={sleutel}>
                      {stukken.map((st) => (
                        <rect
                          key={st.van}
                          x={x(st.van) + 1}
                          y={bovenkant}
                          width={(st.tot - st.van) * uurB - 2}
                          height={Math.max(2, hoog)}
                          fill={kleur}
                          rx={2}
                          stroke={rand}
                          strokeWidth={randB}
                        />
                      ))}
                      {/* Het bedrag staat in het blok; past het er niet in, dan
                          erboven. Kleur draagt de prijs nooit alleen. De kleur
                          gaat via style: de klasse mark-label zet zelf een fill
                          en wint van het attribuut. */}
                      <text
                        x={labelX}
                        y={binnen ? bovenkant + 17 : bovenkant - 6}
                        textAnchor={anker}
                        className={binnen ? "mark-label" : "mark-label op-lijn"}
                        style={binnen ? { fill: tekstKleur } : undefined}
                      >
                        {getal(b.tarief * 100, 1)} ct
                      </text>
                      {naamBinnen ? (
                        <text
                          x={labelX}
                          y={bovenkant + 32}
                          textAnchor="middle"
                          className="as-label"
                          style={{ fill: tekstKleur, opacity: 0.9 }}
                        >
                          {b.naam}
                        </text>
                      ) : breed >= 30 ? (
                        <text
                          x={x(hoofd.van) + breed / 2}
                          y={grond + 14}
                          textAnchor="middle"
                          className="as-label"
                          style={{ fill: "var(--text-secondary)" }}
                        >
                          {b.naam}
                        </text>
                      ) : null}
                    </g>
                  );
                })}

                {/* De uren staan op een eigen rij, met een streepje op de as,
                    zodat ze niet tussen de bloknamen door lopen. */}
                {[0, 6, 12, 18, 24].map((u) => (
                  <g key={`u${i}-${u}`}>
                    <line x1={x(u)} x2={x(u)} y1={grond} y2={grond + 4} stroke="var(--axis)" />
                    <text
                      x={x(u)}
                      y={grond + 30}
                      textAnchor={u === 0 ? "start" : u === 24 ? "end" : "middle"}
                      className="as-label zwak"
                    >
                      {smal ? `${u}.00` : `${u}.00 uur`}
                    </text>
                  </g>
                ))}

                {paneel.blokken.flatMap((b) =>
                  (b.tot > 24
                    ? [
                        { van: b.van, tot: 24 },
                        { van: 0, tot: b.tot - 24 },
                      ]
                    : [{ van: b.van, tot: b.tot }]
                  ).map((st) => (
                    <Trefvlak
                      key={`t${i}-${b.van}-${st.van}`}
                      x={x(st.van)}
                      y={paneelTop(i)}
                      breedte={(st.tot - st.van) * uurB}
                      hoogte={PANEEL}
                      onWijs={(punt) => {
                        setAangewezen(`${i}-${b.van}`);
                        toon(punt, {
                          titel: `${paneel.titel.split(" · ")[0]}, ${uren(b)}`,
                          regels: [
                            {
                              kleur: tintVoorFactor(b.factor),
                              label: `Nettarief vanaf ${NETTARIEF_JAAR}`,
                              waarde: centPerKwh(b.tarief),
                              uitkomst: true,
                            },
                            { label: "Wat je nu betaalt", waarde: "0 ct/kWh" },
                            { label: "Deel van het basistarief", waarde: `${getal(b.factor * 100, 0)}%` },
                          ],
                          noot: b.piek
                            ? "Piekblok: hierop wordt de \u2018Afname in de piekuren\u2019 gemeten."
                            : b.factor === 0
                              ? "Op deze uren betaal je geen nettarief: het net staat dan vol zonnestroom."
                              : undefined,
                        });
                      }}
                      onWis={() => {
                        setAangewezen(null);
                        wis();
                      }}
                    />
                  )),
                )}
              </g>
            );
          })}
        </svg>
      </Grafiek>

      <p className="tariefblad-legenda">
        Bedragen in centen per kilowattuur die je van het net haalt, bovenop de
        stroomprijs. Donkerder is duurder. Vandaag betaal je hiervoor{" "}
        <b>niets per kilowattuur</b>: je netkosten zijn een vast bedrag per jaar,
        vandaar de nul op de as. Elk blok is een deel van het basistarief van{" "}
        {centPerKwh(basis)}: 0, 30, 50, 70 of 100 procent, zoals in het voorstel staat.
        {markeerPiek
          ? " Het omlijnde blok is de piek waarop de \u2018Afname in de piekuren\u2019 wordt gemeten."
          : ""}
        {heeftWikkel
          ? " Het blok over middernacht is één blok: het staat links en rechts in beeld."
          : ""}
      </p>
    </>
  );
}
