"use client";

/**
 * Wat de batterij met je dagprofiel doet, in winter en zomer.
 *
 * De jaarcijfers zeggen hoevéél een batterij verzet; dit zegt wannéér. Dat is
 * het hele mechanisme: stroom die je 's middags op het net zou zetten voor een
 * paar cent, gebruik je 's avonds zelf in plaats van hem voor het volle tarief
 * terug te kopen. Een batterij maakt geen energie — hij verplaatst hem.
 *
 * ── Waarom niet twee lijnen over elkaar ─────────────────────────────────────
 * De voor de hand liggende weergave is "zonder batterij" en "met batterij" als
 * twee lijnen in één assenstelsel. Die liggen het grootste deel van de dag op
 * elkaar en verschillen precies daar waar het spannend wordt een paar
 * millimeter. Je ziet dan twee lijnen en geen verschil.
 *
 * Hier is de verplaatsing zélf de mark: per uur staat er een kolom tussen de
 * twee waarden, groen als de batterij je van het net af houdt en oker als hij
 * er juist extra van afneemt om te laden. De grijze vorm eronder is het profiel
 * zonder batterij, zodat je ziet waarvandaan en waarnaartoe wordt verschoven.
 */

import { useState, type ReactNode } from "react";
import type { SeasonProfile } from "../lib/model/analysis";
import { getal, kwh, procent } from "../lib/format";
import { Figure, Grafiek, Trefvlak, useTip } from "./chart-parts";
import { Tegel } from "./Statistieken";

const B = 840;
/** Hoogte van één seizoenspaneel, zonder de titel en de as eronder. */
const PANEEL = 128;
const MARGE = { boven: 26, rechts: 18, onder: 34, links: 66 };
const TUSSEN = 46;

const MINDER = "var(--series-3)";
const MEER = "var(--series-4)";
const ZONDER = "var(--text-muted)";

/** Dagen per jaar in elk seizoen: zomer is april tot en met september. */
const DAGEN_PER_JAAR = { zomer: 183, winter: 182 } as const;

/** De uren (van, tot-en-niet-met) waarover de jaartegels tellen. */
const AVOND = [17, 23] as const;
const OVERDAG = [10, 16] as const;
const NACHT = [0, 6] as const;

/** Kilowatturen per jaar in een blok uren, uit het gemiddelde per uur van een seizoensdag. */
function perJaar(reeks: number[], [van, tot]: readonly [number, number], seizoen: "winter" | "zomer"): number {
  let som = 0;
  for (let u = van; u < tot; u++) som += reeks[u] ?? 0;
  return som * DAGEN_PER_JAAR[seizoen];
}

/** "−120 kWh (−35%)": de verandering, met teken en als aandeel. */
function verandering(zonder: number, met: number): string {
  const d = met - zonder;
  const teken = d < 0 ? "−" : "+";
  const deel = zonder > 0.5 ? ` (${teken}${procent(Math.abs(d) / zonder)})` : "";
  return `${teken}${kwh(Math.abs(d))} per jaar${deel}`;
}

/** Netto uitwisseling met het net: afname positief, teruglevering negatief. */
function netto(imp: number[], exp: number[]): number[] {
  return imp.map((v, u) => v - exp[u]!);
}

export function Verschuiving({
  profielen,
  zonnepanelen = true,
  actie,
}: {
  profielen: SeasonProfile[];
  /** Zonder zonnepanelen is er geen middagoverschot: dan gaat het om goedkoop laden en duur leveren. */
  zonnepanelen?: boolean;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<{ p: number; u: number } | null>(null);

  // Een seizoen zonder dagen komt voor bij een korte periode; die tekenen we
  // niet als een vlakke lijn maar laten we weg.
  const bruikbaar = profielen.filter((p) => p.days > 0);
  if (bruikbaar.length === 0) return null;

  const reeksen = bruikbaar.map((p) => ({
    profiel: p,
    zonder: netto(p.importBaseline, p.exportBaseline),
    met: netto(p.importBattery, p.exportBattery),
  }));

  // Eén schaal voor beide seizoenen: anders lijkt een winterdag net zo extreem
  // als een zomerdag terwijl de zomer twee keer zo ver uitslaat.
  const alles = reeksen.flatMap((r) => [...r.zonder, ...r.met]);
  const top = Math.max(0.2, ...alles.map((v) => Math.abs(v)));

  const plotB = B - MARGE.links - MARGE.rechts;
  const uurB = plotB / 24;
  const x = (u: number) => MARGE.links + u * uurB;
  const paneelTop = (i: number) => MARGE.boven + i * (PANEEL + TUSSEN);
  const y = (i: number, v: number) => paneelTop(i) + (1 - v / top) * (PANEEL / 2);

  const H = MARGE.boven + reeksen.length * (PANEEL + TUSSEN) - TUSSEN + MARGE.onder;

  /**
   * Wat de verschuiving per jaar betekent, per seizoen: hoeveel minder je 's
   * avonds van het net haalt, en waar die stroom vandaan komt (overdag minder
   * teruglevering met panelen, 's nachts meer afname zonder). Uit dezelfde
   * gemiddelde dagen als de figuur, maal het aantal dagen van het seizoen.
   */
  const jaarcijfers = reeksen.map((r) => {
    const s = r.profiel.season;
    const p = r.profiel;
    return {
      seizoen: s,
      avondZonder: perJaar(p.importBaseline, AVOND, s),
      avondMet: perJaar(p.importBattery, AVOND, s),
      overdagZonder: perJaar(p.exportBaseline, OVERDAG, s),
      overdagMet: perJaar(p.exportBattery, OVERDAG, s),
      nachtZonder: perJaar(p.importBaseline, NACHT, s),
      nachtMet: perJaar(p.importBattery, NACHT, s),
    };
  });

  // Waar de batterij de avondafname het sterkst indrukt: dat is het verhaal.
  const grootsteDaling = reeksen.map((r) => {
    let beste = 0;
    let uur = 0;
    for (let u = 0; u < 24; u++) {
      const d = r.zonder[u]! - r.met[u]!;
      if (d > beste) {
        beste = d;
        uur = u;
      }
    }
    return { uur, kwh: beste };
  });

  const stap = (waarden: number[], i: number) =>
    waarden
      .flatMap((v, u) => [
        `${u === 0 ? "M" : "L"}${x(u)} ${y(i, v)}`,
        `L${x(u + 1)} ${y(i, v)}`,
      ])
      .join(" ");

  return (
    <Figure
      anker="zomer-en-winter"
      actie={actie}
      titel={
        zonnepanelen && grootsteDaling[1] && grootsteDaling[1].kwh > (grootsteDaling[0]?.kwh ?? 0)
          ? "In de zomer verschuift de batterij een deel van je middagoverschot naar de avond"
          : grootsteDaling.every((d) => d.uur >= 17)
            ? "De batterij haalt je avondpiek van het net af"
            : "De batterij verschuift wat je van het net haalt naar andere uren"
      }
      toelichting={
        <>
          De gemiddelde dag in winter en zomer: wat er per uur door de meter
          gaat. Boven de nullijn haal je stroom van het net, eronder lever je
          stroom aan het net. <b>Het grijze vlak is hoe die dag eruitzag zonder
          batterij.</b> De zwarte lijn is dezelfde dag met batterij, en de
          gekleurde kolommen zijn het verschil.
        </>
      }
    >
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={wis}
        label="Het gemiddelde dagprofiel in winter en zomer, met en zonder batterij"
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart"
          role="img"
          aria-label={reeksen
            .map(
              (r, i) =>
                `${r.profiel.season}: de batterij haalt om ${grootsteDaling[i]!.uur}.00 uur het meest van het net af, ${getal(
                  grootsteDaling[i]!.kwh,
                  2,
                )} kWh`,
            )
            .join(". ")}
        >
          {reeksen.map((r, i) => {
            const nul = y(i, 0);
            return (
              <g key={r.profiel.season}>
                <text x={MARGE.links} y={paneelTop(i) - 10} className="paneel-titel">
                  {r.profiel.season === "winter"
                    ? "Winter: oktober tot en met maart"
                    : "Zomer: april tot en met september"}
                </text>

                {/* De aangewezen kolom, achter alles. */}
                {aangewezen && aangewezen.p === i ? (
                  <rect
                    className="aangewezen"
                    x={x(aangewezen.u)}
                    y={paneelTop(i)}
                    width={uurB}
                    height={PANEEL}
                  />
                ) : null}

                {/* Het profiel zonder batterij als grijze vorm. */}
                <path
                  d={`${stap(r.zonder, i)} L${x(24)} ${nul} L${x(0)} ${nul} Z`}
                  fill={ZONDER}
                  opacity={0.16}
                />

                {/* De verplaatsing per uur: van de oude waarde naar de nieuwe. */}
                {r.zonder.map((v, u) => {
                  const nieuw = r.met[u]!;
                  const hoog = Math.abs(y(i, nieuw) - y(i, v));
                  if (hoog < 0.4) return null;
                  return (
                    <rect
                      key={`d${u}`}
                      x={x(u) + uurB * 0.2}
                      y={Math.min(y(i, v), y(i, nieuw))}
                      width={uurB * 0.6}
                      height={hoog}
                      fill={nieuw < v ? MINDER : MEER}
                      rx={2}
                    />
                  );
                })}

                {/* Het profiel met batterij als lijn bovenop. */}
                <path
                  d={stap(r.met, i)}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                />

                <line
                  x1={MARGE.links}
                  x2={B - MARGE.rechts}
                  y1={nul}
                  y2={nul}
                  stroke="var(--axis)"
                  strokeWidth={1.5}
                />

                {/* De as: alleen de nullijn en de uiterste waarde. Meer getallen
                    leiden af van waar het hier om gaat, de vorm. */}
                <text
                  x={MARGE.links - 10}
                  y={nul}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="as-label"
                >
                  0
                </text>
                <text
                  x={MARGE.links - 10}
                  y={y(i, top) + 4}
                  textAnchor="end"
                  className="as-label"
                >
                  {getal(top, 1)} kWh
                </text>
                <text
                  x={MARGE.links - 10}
                  y={y(i, -top)}
                  textAnchor="end"
                  className="as-label"
                >
                  −{getal(top, 1)}
                </text>

                {[0, 6, 12, 18].map((u) => (
                  <text
                    key={`u${u}`}
                    x={x(u) + uurB / 2}
                    y={paneelTop(i) + PANEEL + 16}
                    textAnchor="middle"
                    className="as-label"
                  >
                    {u}.00 uur
                  </text>
                ))}

                {r.zonder.map((_, u) => (
                  <Trefvlak
                    key={`t${u}`}
                    x={x(u)}
                    y={paneelTop(i)}
                    breedte={uurB}
                    hoogte={PANEEL}
                    onWijs={(punt) => {
                      setAangewezen({ p: i, u });
                      const p = r.profiel;
                      const verschil = r.met[u]! - r.zonder[u]!;
                      toon(punt, {
                        titel: `${r.profiel.season === "winter" ? "Winter" : "Zomer"}, ${u}.00 tot ${u + 1}.00 uur`,
                        regels: [
                          {
                            kleur: ZONDER,
                            label: "Zonder batterij",
                            waarde: duiding(r.zonder[u]!),
                          },
                          {
                            kleur: "var(--text-primary)",
                            label: "Met batterij",
                            waarde: duiding(r.met[u]!),
                          },
                          {
                            kleur: verschil < 0 ? MINDER : MEER,
                            label: verschil < 0 ? "Minder van het net" : "Extra van het net",
                            waarde: `${getal(Math.abs(verschil), 2)} kWh`,
                            uitkomst: true,
                          },
                        ],
                        noot: `Gemiddeld over ${getal(p.days, 0)} dagen. Stroom naar het net telt negatief.`,
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

      <ul className="legenda">
        <li>
          <span
            className="legenda-vlak"
            style={{ background: ZONDER, opacity: 0.3 }}
          />
          <span className="legenda-label">
            zonder batterij: wat er door de meter ging
          </span>
        </li>
        <li>
          <span className="legenda-vlak" style={{ background: "var(--text-primary)" }} />
          <span className="legenda-label">met batterij</span>
        </li>
        <li>
          <span className="legenda-vlak" style={{ background: MINDER }} />
          <span className="legenda-label">het verschil: de batterij levert</span>
        </li>
        <li>
          <span className="legenda-vlak" style={{ background: MEER }} />
          <span className="legenda-label">het verschil: de batterij laadt</span>
        </li>
      </ul>

      <p className="verschuiving-winst">
        <b>Wat dat per jaar scheelt.</b> Dezelfde gemiddelde dagen, opgeteld over
        de dagen van elk seizoen.
      </p>

      <div className="stat-grid">
        {jaarcijfers.map((j) => {
          const naam = j.seizoen === "winter" ? "Winter" : "Zomer";
          const maanden =
            j.seizoen === "winter" ? "oktober tot en met maart" : "april tot en met september";
          return (
            <Tegel
              key={`avond-${j.seizoen}`}
              label={`${naam}: van het net 's avonds`}
              vanLabel="Zonder batterij"
              naarLabel="Met batterij"
              van={kwh(j.avondZonder)}
              naar={kwh(j.avondMet)}
              delta={verandering(j.avondZonder, j.avondMet)}
              deltaGoed={j.avondMet < j.avondZonder}
              uitleg={`Wat je per jaar tussen ${AVOND[0]}.00 en ${AVOND[1]}.00 uur van het net haalt, van ${maanden}.`}
              accent={MINDER}
            />
          );
        })}
        {jaarcijfers.map((j) => {
          const naam = j.seizoen === "winter" ? "Winter" : "Zomer";
          const maanden =
            j.seizoen === "winter" ? "oktober tot en met maart" : "april tot en met september";
          if (zonnepanelen) {
            // Een seizoen waarin je overdag nauwelijks levert, zegt niets.
            if (j.overdagZonder < 5) return null;
            return (
              <Tegel
                key={`overdag-${j.seizoen}`}
                label={`${naam}: naar het net overdag`}
                vanLabel="Zonder batterij"
                naarLabel="Met batterij"
                van={kwh(j.overdagZonder)}
                naar={kwh(j.overdagMet)}
                delta={verandering(j.overdagZonder, j.overdagMet)}
                deltaGoed={j.overdagMet < j.overdagZonder}
                uitleg={`Zonnestroom die je per jaar tussen ${OVERDAG[0]}.00 en ${OVERDAG[1]}.00 uur aan het net levert, van ${maanden}. Wat de batterij opvangt, gebruik je 's avonds zelf.`}
                accent="var(--series-2)"
              />
            );
          }
          return (
            <Tegel
              key={`nacht-${j.seizoen}`}
              label={`${naam}: van het net 's nachts`}
              vanLabel="Zonder batterij"
              naarLabel="Met batterij"
              van={kwh(j.nachtZonder)}
              naar={kwh(j.nachtMet)}
              delta={verandering(j.nachtZonder, j.nachtMet)}
              uitleg={`Wat je per jaar tussen ${NACHT[0]}.00 en ${NACHT[1]}.00 uur van het net haalt, van ${maanden}. Hier laadt de batterij als de stroom goedkoop is.`}
              accent={MEER}
            />
          );
        })}
      </div>

    </Figure>
  );
}

/** Eén waarde met de richting erbij; "−0,4 kWh" zegt op zichzelf niets. */
function duiding(v: number): string {
  if (Math.abs(v) < 0.005) return "0 kWh";
  return v > 0
    ? `${getal(v, 2)} kWh van het net`
    : `${getal(-v, 2)} kWh naar het net`;
}
