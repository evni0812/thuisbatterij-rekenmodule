"use client";

/**
 * De businesscase over de levensduur.
 *
 * Eén lijn: wat je tot dan toe hebt terugverdiend. Begint diep negatief (de
 * aanschaf) en kruist de nullijn op het break-evenpunt — of niet, en dat is dan
 * óók het antwoord. Met de overgang naar het nettarief erbij staat er een
 * tweede, gestippelde lijn naast: hetzelfde als het tarief blijft zoals nu.
 */

import { useState, type ReactNode } from "react";
import type { FinanceResult } from "../lib/model/finance";
import type { Overgang } from "../lib/overgang";
import { euro, euroAs, getal, jaren, procent } from "../lib/format";
import { Figure, Grafiek, Legenda, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const B_STANDAARD = 720;
const H = 240;
/** De lijn als het tarief blijft zoals nu: neutraal, zodat de hoofdlijn voorgaat. */
const KLEUR_NU = "var(--text-muted)";

export function Cashflow({
  finance: huidigeFinance,
  overgang,
  investeringEur,
  cycleLife,
  jarenTekst,
  actie,
}: {
  finance: FinanceResult;
  /**
   * De businesscase met de tariefwissel van 2029 erin. Zodra die er is, tekent
   * de lijn dié — anders staat hier een andere terugverdientijd dan boven aan
   * de pagina, en dat is precies het soort tegenspraak waar een lezer op
   * afhaakt.
   */
  overgang: Overgang | null;
  investeringEur: number;
  /** Hoeveel volledige beurten de cellen aankunnen, voor de noot bij het totaal. */
  cycleLife?: number;
  /** Welke jaren het gemiddelde draagt, bv. "2024 en 2025", voor de disclaimer. */
  jarenTekst?: string;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis, breedte: gemeten } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const finance = overgang?.finance ?? huidigeFinance;
  const wisseljaar =
    overgang && overgang.jarenOpHuidigTarief > 0 && overgang.jarenOpHuidigTarief < 25
      ? overgang.jarenOpHuidigTarief
      : null;
  const cf = finance.cashflows;
  if (cf.length === 0) return null;
  // Ter vergelijking: dezelfde looptijd als het tarief blijft zoals nu. Alleen
  // als er een overgang is; anders is de hoofdlijn dat al.
  const zonder =
    overgang && huidigeFinance.cashflows.length === cf.length ? huidigeFinance : null;

  // De viewBox volgt het kader: op een telefoon past de grafiek zonder te
  // scrollen, met letters op ware grootte.
  const B = gemeten ?? B_STANDAARD;
  const smal = B < 560;
  const MARGE = { boven: 16, rechts: smal ? 10 : 16, onder: 34, links: smal ? 60 : 64 };

  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;

  const waarden = [-investeringEur, ...cf.map((c) => c.cumulativeNominalEur)];
  const waardenZonder = zonder
    ? [-investeringEur, ...zonder.cashflows.map((c) => c.cumulativeNominalEur)]
    : null;
  const alle = [...waarden, ...(waardenZonder ?? [])];
  const min = Math.min(...alle);
  const max = Math.max(...alle, 0);
  const ticks = kiesTicks(min, max, 5);
  const lo = Math.min(...ticks, min);
  const hi = Math.max(...ticks, max);
  const y = (v: number) => MARGE.boven + (1 - (v - lo) / (hi - lo)) * plotH;
  const x = (j: number) => MARGE.links + (j / cf.length) * plotB;

  const lijn = (reeks: number[]) =>
    reeks.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`).join(" ");
  const punten = lijn(waarden);

  // Het totaal aan beurten hoort bij de lijn, en die rekent met de overgang:
  // dan handelt de batterij vanaf 2029 vaker dan de figuur Laadbeurten (die op
  // het huidige tarief rekent) laat zien. Dat staat er daarom bij, en "daarna"
  // alleen als er na het eindjaar nog looptijd over is.
  const beurtenNoot = ((): string | null => {
    const cellen = cycleLife ? `de ${getal(cycleLife)} laadbeurten van de batterij` : "de opgegeven laadbeurten";
    const grondslag = overgang
      ? `met het nettarief vanaf ${overgang.ingangsjaar} laadt en levert de batterij vaker dan nu`
      : null;
    const eind = finance.endOfLifeYear;
    const op =
      eind === null
        ? cycleLife
          ? `binnen ${cellen}`
          : null
        : eind >= cf.length
          ? `in jaar ${eind} zijn ${cellen} op`
          : `na ${eind} jaar zijn ${cellen} op; daarna rekenen we door met een batterij die verder slijt`;
    const delen = [grondslag, op].filter((d): d is string => d !== null);
    return delen.length > 0 ? delen.join("; ") : null;
  })();

  const breakEven = finance.paybackYears;
  const positief = finance.npvEur >= 0;
  // Drie gevallen, niet twee. De lijn tekent nominale euro's en kan door nul
  // gaan terwijl de contante waarde negatief blijft; met twee titels zou de kop
  // dan zeggen dat hij zich niet terugverdient terwijl de grafiek eronder een
  // break-evenpunt markeert.
  const titel = positief
    ? "Over de looptijd bespaart de batterij meer dan hij kost"
    : breakEven !== null
      ? "Je krijgt je geld terug, maar niet de rente die je erop misloopt"
      : "De batterij is niet terugverdiend binnen de looptijd";

  return (
    <Figure
      anker="looptijd"
      actie={actie}
      titel={titel}
      toelichting={
        <>
          Het gemiddelde doorgerekende jaar, herhaald over de looptijd: wat je tot dat
          moment in totaal hebt terugverdiend, met de aanschafprijs als
          startpunt. De lijn telt de euro's zoals je ze krijgt.
          {wisseljaar !== null ? (
            <>
              {" "}
              Bij de verticale stippellijn gaat het voorgestelde nettarief in, als
              het voorstel doorgaat. Vanaf daar volgt de groene lijn de besparing
              per jaar onder dat tarief.
            </>
          ) : null}
          {zonder ? (
            <>
              {" "}
              De grijze lijn laat zien hoe het loopt als het nettarief blijft zoals
              nu.
            </>
          ) : null}{" "}
          De besparing loopt terug naarmate de batterij slijt.
        </>
      }
    >
      <div className="notitie waarschuwing looptijd-disclaimer" role="note">
        <p>
          <b>Dit is geen voorspelling.</b> We nemen de gemiddelde besparing van{" "}
          {jarenTekst ?? "de doorgerekende jaren"} en laten die elk jaar
          terugkomen. Niemand weet wat de stroomprijzen, de belasting en het
          nettarief de komende jaren doen. Worden de prijsverschillen tussen de
          uren kleiner, dan duurt terugverdienen langer; worden ze groter, dan
          gaat het sneller.
        </p>
      </div>
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setAangewezen(null);
          wis();
        }}
        label="Opgetelde besparing min de aanschafprijs, over de looptijd"
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart chart-fluid"
          role="img"
          aria-label="Opgetelde besparing min de aanschafprijs, over de looptijd"
        >
          {aangewezen !== null ? (
            <rect
              className="aangewezen"
              x={x(aangewezen) - plotB / cf.length / 2}
              y={MARGE.boven}
              width={plotB / cf.length}
              height={plotH}
            />
          ) : null}

          <Raster
            ticks={ticks}
            x0={MARGE.links}
            x1={B - MARGE.rechts}
            schaal={y}
            labelBreedte={MARGE.links}
            formatter={(v) => euroAs(v)}
          />

          {waardenZonder ? (
            <path
              d={lijn(waardenZonder)}
              fill="none"
              stroke={KLEUR_NU}
              strokeWidth={1.75}
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />
          ) : null}

          {/* Het gebied onder nul is nog niet terugverdiend. */}
          <path
            d={`${punten} L${x(cf.length)} ${y(0)} L${x(0)} ${y(0)} Z`}
            fill={positief ? "var(--series-3)" : "var(--critical)"}
            opacity={0.12}
          />
          <path
            d={punten}
            fill="none"
            stroke={positief ? "var(--series-3)" : "var(--critical)"}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {wisseljaar !== null && wisseljaar <= cf.length ? (
            <g>
              <line
                x1={x(wisseljaar)}
                x2={x(wisseljaar)}
                y1={MARGE.boven}
                y2={MARGE.boven + plotH}
                stroke="var(--ac)"
                strokeWidth={1.5}
                strokeDasharray="2 4"
              />
              <text
                x={x(wisseljaar) + 6}
                y={MARGE.boven + plotH - 6}
                className="mark-label op-lijn"
                style={{ fill: "var(--ac)" }}
              >
                nettarief {overgang!.ingangsjaar}
              </text>
            </g>
          ) : null}

          {breakEven !== null && breakEven <= cf.length ? (
            <g>
              <line
                x1={x(breakEven)}
                x2={x(breakEven)}
                y1={MARGE.boven}
                y2={MARGE.boven + plotH}
                stroke="var(--good)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              {/* Staat het punt in de rechterhelft, dan loopt de tekst naar links,
                  zodat hij binnen de grafiek blijft. */}
              <text
                x={x(breakEven) + (x(breakEven) > B * 0.55 ? -6 : 6)}
                y={MARGE.boven + 12}
                textAnchor={x(breakEven) > B * 0.55 ? "end" : "start"}
                className="mark-label op-lijn"
                style={{ fill: "var(--success-text)" }}
              >
                terugverdiend na {jaren(breakEven)}
              </text>
            </g>
          ) : null}

          {[0, 5, 10, 15, 20, 25].
            filter((j) => j <= cf.length).
            map((j) => (
              <text
                key={j}
                x={x(j)}
                y={H - 12}
                textAnchor={x(j) > B - MARGE.rechts - 20 ? "end" : "middle"}
                className="as-label"
              >
                {j === 0 ? "nu" : `${j} jaar`}
              </text>
            ))}

          {/* Het punt dat je aanwijst, en de trefvlakken eromheen. */}
          {aangewezen !== null ? (
            <circle
              cx={x(aangewezen)}
              cy={y(waarden[aangewezen]!)}
              r={4}
              fill={positief ? "var(--series-3)" : "var(--critical)"}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          ) : null}
          {waarden.map((v, i) => (
            <Trefvlak
              key={`t${i}`}
              x={x(i) - plotB / cf.length / 2}
              y={MARGE.boven}
              breedte={plotB / cf.length}
              hoogte={plotH}
              onWijs={(punt) => {
                setAangewezen(i);
                const post = i > 0 ? cf[i - 1] : null;
                toon(punt, {
                  titel: i === 0 ? "Bij aanschaf" : `Na ${jaren(i)}`,
                  regels: [
                    {
                      kleur: positief ? "var(--series-3)" : "var(--critical)",
                      label: v >= 0 ? "Terugverdiend" : "Nog niet terugverdiend",
                      waarde: euro(v),
                      uitkomst: true,
                    },
                    ...(waardenZonder && i > 0
                      ? [
                          {
                            kleur: KLEUR_NU,
                            label: "Als het nettarief blijft zoals nu",
                            waarde: euro(waardenZonder[i]!),
                          },
                        ]
                      : []),
                    ...(post
                      ? [
                          { label: "Besparing dat jaar", waarde: euro(post.savingNominalEur) },
                          {
                            label: "Resterende capaciteit",
                            waarde: procent(post.capacityFraction),
                          },
                          {
                            label: "Laadbeurten tot nu",
                            waarde: getal(post.cumulativeCycles),
                          },
                        ]
                      : [{ label: "Aanschafprijs", waarde: euro(investeringEur) }]),
                  ],
                  noot:
                    breakEven !== null && i === Math.ceil(breakEven)
                      ? "Rond dit jaar staat de teller op nul."
                      : undefined,
                });
              }}
              onWis={() => {
                setAangewezen(null);
                wis();
              }}
            />
          ))}
        </svg>
      </Grafiek>
      {zonder ? (
        <Legenda
          items={[
            {
              kleur: positief ? "var(--series-3)" : "var(--critical)",
              label: `Met het nettarief vanaf ${overgang!.ingangsjaar}`,
            },
            { kleur: KLEUR_NU, label: "Als het nettarief blijft zoals nu" },
          ]}
        />
      ) : null}

      {zonder ? (
        <table className="verlies-tabel looptijd-vergelijking">
          <caption className="visueel-verborgen">
            De looptijd met en zonder het nieuwe nettarief
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visueel-verborgen">Kengetal</span>
              </th>
              <th scope="col">Met nettarief {overgang!.ingangsjaar}</th>
              <th scope="col">Tarief zoals nu</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Terugverdientijd</th>
              <td>{jaren(finance.paybackYears)}</td>
              <td>{jaren(zonder.paybackYears)}</td>
            </tr>
            <tr>
              <th scope="row">Netto resultaat</th>
              <td className={finance.npvEur >= 0 ? "goed" : "slecht"}>{euro(finance.npvEur)}</td>
              <td className={zonder.npvEur >= 0 ? "goed" : "slecht"}>{euro(zonder.npvEur)}</td>
            </tr>
            <tr>
              <th scope="row">Rendement op je aankoop</th>
              <td>{finance.irr === null ? "niet te berekenen" : procent(finance.irr, 1)}</td>
              <td>{zonder.irr === null ? "niet te berekenen" : procent(zonder.irr, 1)}</td>
            </tr>
            <tr>
              <th scope="row">Laadbeurten in totaal</th>
              <td>{getal(finance.totalCycles)}</td>
              <td>{getal(zonder.totalCycles)}</td>
            </tr>
          </tbody>
        </table>
      ) : null}

      {zonder ? (
        <p className="posten-noot">
          De terugverdientijd geldt als een gemiddeld jaar zich herhaalt. Het netto
          resultaat is alle besparingen over de looptijd, minus de aanschafprijs en
          de rente die je misloopt. Het rendement op je aankoop is wat de batterij
          per jaar oplevert, als rentepercentage: ligt dat onder de rente van een
          spaarrekening, dan had je je geld daar beter kunnen laten staan.
          {beurtenNoot ? ` Laadbeurten: ${beurtenNoot}.` : null}
        </p>
      ) : (
      <dl className="kerncijfers">
        <div>
          <dt>Terugverdientijd</dt>
          <dd>
            {jaren(finance.paybackYears)}
            <span className="dd-noot">als een gemiddeld jaar zich herhaalt</span>
          </dd>
        </div>
        <div>
          <dt>Netto resultaat</dt>
          <dd className={finance.npvEur >= 0 ? "goed" : "slecht"}>
            {euro(finance.npvEur)}
            <span className="dd-noot">
              alle besparingen over de looptijd, minus de aanschafprijs en de
              rente die je misloopt
            </span>
          </dd>
        </div>
        <div>
          <dt>Rendement op je aankoop</dt>
          <dd>
            {finance.irr === null ? "niet te berekenen" : procent(finance.irr, 1)}
            <span className="dd-noot">
              wat je aankoop per jaar oplevert, als rentepercentage. Ligt dat
              onder de rente van een spaarrekening, dan had je je geld daar
              beter kunnen laten staan
            </span>
          </dd>
        </div>
        <div>
          <dt>Laadbeurten in totaal</dt>
          <dd>
            {getal(finance.totalCycles)}
            {beurtenNoot ? <span className="dd-noot">{beurtenNoot}</span> : null}
          </dd>
        </div>
      </dl>
      )}
      <p className="posten-noot">
        De lijnen rekenen met de prijsstijging en het capaciteitsverlies die je
        bij de geavanceerde instellingen hebt staan.
      </p>

    </Figure>
  );
}
