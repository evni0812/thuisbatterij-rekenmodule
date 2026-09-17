"use client";

/**
 * De businesscase over de levensduur.
 *
 * Eén lijn: wat je tot dan toe hebt terugverdiend. Begint diep negatief (de
 * aanschaf) en kruist de nullijn op het break-evenpunt — of niet, en dat is dan
 * óók het antwoord.
 */

import { useState, type ReactNode } from "react";
import type { FinanceResult } from "../lib/model/finance";
import type { Overgang } from "../lib/overgang";
import { euro, euroAs, jaren, procent } from "../lib/format";
import { Figure, Grafiek, Raster, Trefvlak, kiesTicks, useTip } from "./chart-parts";

const B = 720;
const H = 240;
const MARGE = { boven: 16, rechts: 16, onder: 34, links: 64 };

export function Cashflow({
  finance: huidigeFinance,
  overgang,
  investeringEur,
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
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const finance = overgang?.finance ?? huidigeFinance;
  const wisseljaar =
    overgang && overgang.jarenOpHuidigTarief > 0 && overgang.jarenOpHuidigTarief < 25
      ? overgang.jarenOpHuidigTarief
      : null;
  const cf = finance.cashflows;
  if (cf.length === 0) return null;

  const plotB = B - MARGE.links - MARGE.rechts;
  const plotH = H - MARGE.boven - MARGE.onder;

  const waarden = [-investeringEur, ...cf.map((c) => c.cumulativeNominalEur)];
  const min = Math.min(...waarden);
  const max = Math.max(...waarden, 0);
  const ticks = kiesTicks(min, max, 5);
  const lo = Math.min(...ticks, min);
  const hi = Math.max(...ticks, max);
  const y = (v: number) => MARGE.boven + (1 - (v - lo) / (hi - lo)) * plotH;
  const x = (j: number) => MARGE.links + (j / cf.length) * plotB;

  const punten = waarden
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(v)}`)
    .join(" ");

  const breakEven = finance.paybackYears;
  const positief = finance.npvEur >= 0;
  // Drie gevallen, niet twee. De lijn tekent nominale euro's en kan door nul
  // gaan terwijl de contante waarde negatief blijft; met twee titels zou de kop
  // dan zeggen dat hij zich niet terugverdient terwijl de grafiek eronder een
  // break-evenpunt markeert.
  const titel = positief
    ? "Over de looptijd levert de batterij meer op dan hij kost"
    : breakEven !== null
      ? "Je krijgt je geld terug, maar niet de rente die je erop misloopt"
      : "Over de looptijd verdient de batterij zichzelf niet terug";

  return (
    <Figure
      actie={actie}
      titel={titel}
      toelichting={
        <>
          Eén doorgerekend jaar, herhaald over de levensduur: wat je tot dat
          moment in totaal hebt terugverdiend, met de aanschafprijs als
          startpunt. De lijn telt de euro's zoals je ze krijgt.
          {wisseljaar !== null ? (
            <>
              {" "}
              Bij de stippellijn gaat het nieuwe nettarief in en wordt de
              jaaropbrengst hoger; daarna loopt hij steiler.
            </>
          ) : null}{" "}
          De contante waarde hieronder trekt de rente eraf die je op dat geld
          had kunnen maken. De besparing loopt terug naarmate de batterij
          slijt.
        </>
      }
    >
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setAangewezen(null);
          wis();
        }}
        label="Cumulatief terugverdiend bedrag over de analyseperiode"
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart"
          role="img"
          aria-label="Cumulatief terugverdiend bedrag over de analyseperiode"
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
                fill="var(--ac)"
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
              <text
                x={x(breakEven) + 6}
                y={MARGE.boven + 12}
                className="mark-label"
                fill="var(--success-text)"
              >
                terugverdiend na {jaren(breakEven)}
              </text>
            </g>
          ) : null}

          {[0, 5, 10, 15, 20, 25].
            filter((j) => j <= cf.length).
            map((j) => (
              <text key={j} x={x(j)} y={H - 12} textAnchor="middle" className="as-label">
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
                    ...(post
                      ? [
                          { label: "Besparing dat jaar", waarde: euro(post.savingNominalEur) },
                          {
                            label: "Resterende capaciteit",
                            waarde: procent(post.capacityFraction),
                          },
                          {
                            label: "Laadbeurten tot nu",
                            waarde: String(Math.round(post.cumulativeCycles)),
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

      <dl className="kerncijfers">
        <div>
          <dt>Terugverdientijd</dt>
          <dd>
            {jaren(finance.paybackYears)}
            <span className="dd-noot">als een gemiddeld jaar zich herhaalt</span>
          </dd>
        </div>
        <div>
          <dt>
            Contante waarde
            <span className="hint" title="De waarde van alle toekomstige besparingen, teruggerekend naar vandaag, minus de aanschafprijs.">?</span>
          </dt>
          <dd className={finance.npvEur >= 0 ? "goed" : "slecht"}>
            {euro(finance.npvEur)}
          </dd>
        </div>
        <div>
          <dt>
            Rendement
            <span className="hint" title="Wat de batterij per jaar opbrengt, uitgedrukt als rentepercentage. Ligt dat onder wat je op een spaarrekening krijgt, dan was je geld daar beter af.">?</span>
          </dt>
          <dd>{finance.irr === null ? "—" : procent(finance.irr, 1)}</dd>
        </div>
        <div>
          <dt>Laadbeurten in totaal</dt>
          <dd>
            {Math.round(finance.totalCycles)}
            {finance.endOfLifeYear !== null ? (
              <span className="dd-noot">
                na {finance.endOfLifeYear} jaar zijn de beloofde laadbeurten op; daarna
                rekenen we door met een batterij die verder slijt
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className="posten-noot">
        Deze lijn is geen prognose van de energiemarkt. Hij neemt de besparing
        die de batterij in de doorgerekende jaren <em>had</em> gehaald en laat
        die zich herhalen, met de prijsstijging en het capaciteitsverlies die je
        bij de geavanceerde instellingen hebt staan. Vallen de prijsverschillen
        tussen uren de komende jaren kleiner uit, dan schuift de
        terugverdientijd naar achteren; worden ze groter, dan naar voren.
      </p>

    </Figure>
  );
}
