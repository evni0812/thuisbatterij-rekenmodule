"use client";

/**
 * De drie doelen naast elkaar: wat rendement, zelfconsumptie en uitstoot voor
 * dít huishouden en déze batterij doen.
 *
 * Bovenaan per doel een kaart met dezelfde cijfers in dezelfde volgorde, zodat
 * je van links naar rechts kunt vergelijken; het doel waarmee de pagina nu
 * rekent is gemarkeerd, en met "Reken hiermee" zet je een ander doel in de
 * instellingen. Daaronder hoe dat eruitziet: dezelfde zomerdag drie keer, met
 * wanneer de batterij laadt en levert, en waarvandaan en waarheen.
 *
 * De getallen komen uit de vergelijking in lib/useAnalysis.ts; hoe ze tot
 * kaarten worden staat in lib/model/vergelijking.ts. De afleiding (looptijd,
 * rente, jaaropwek) is die van de getoonde configuratie, net als elders op de
 * pagina.
 */

import { useState, type ReactNode } from "react";
import { DOELEN, doelInfo } from "../lib/model/doel";
import type { Doel } from "../lib/model/types";
import { doelKaarten, type DoelKaart } from "../lib/model/vergelijking";
import type { VergelijkingState } from "../lib/useAnalysis";
import type { Configuration } from "../lib/worker/protocol";
import { centPerKwh, datum, euro, euroPrecies, getal, jaren, kwh, procent } from "../lib/format";
import { Figure, Grafiek, Raster, Trefvlak, kiesTicks, useTip, type TipRegel } from "./chart-parts";
import { kg } from "./Co2Antwoord";
import { momentLabel, splitsActies } from "./Dagprofiel";

/**
 * De titel als stelling: wat sturen op uitstoot kost en oplevert tegenover
 * rendement, of wat zelfconsumptie kost als dat het gekozen doel is.
 */
export function vergelijkingsTitel(
  kaarten: Partial<Record<Doel, DoelKaart>>,
  gekozen: Doel,
): string | null {
  const r = kaarten.rendement;
  const u = kaarten.uitstoot;
  const z = kaarten.zelfconsumptie;
  if (gekozen === "zelfconsumptie" && r && z) {
    const verschil = r.besparingEur - z.besparingEur;
    return verschil >= 0.5
      ? `Alleen je eigen zon opslaan kost je ${euro(verschil)} per jaar tegenover sturen op rendement`
      : "Alleen je eigen zon opslaan levert hier evenveel op als sturen op rendement";
  }
  if (!r || !u) return null;
  const kost = r.besparingEur - u.besparingEur;
  const extra = u.co2WinstKg !== null && r.co2WinstKg !== null ? u.co2WinstKg - r.co2WinstKg : null;
  const kostDeel = kost >= 0.5 ? `kost je ${euro(kost)} per jaar` : "kost je hier niets";
  if (extra === null) return `Sturen op uitstoot ${kostDeel} tegenover sturen op rendement`;
  if (extra < 0.5) return `Sturen op uitstoot ${kostDeel} en scheelt hier geen CO2 extra`;
  return `Sturen op uitstoot ${kostDeel} en scheelt ${kg(extra)} CO2 extra`;
}

function vanNaar(van: string, naar: string): ReactNode {
  return (
    <>
      {van} <span className="doelkaart-pijl" aria-label="wordt">→</span> {naar}
    </>
  );
}

export function Doelvergelijking({
  vergelijking,
  config,
  zonnepanelen = true,
  bezig = false,
  onKies,
  actie,
}: {
  vergelijking: VergelijkingState | null;
  /** De configuratie van het getoonde antwoord: het gekozen doel en de afleiding. */
  config: Configuration;
  zonnepanelen?: boolean;
  /** Er loopt een hoofddoorrekening; dan wacht "Reken hiermee". */
  bezig?: boolean;
  /** Zet dit doel in de instellingen en reken door. */
  onKies: (doel: Doel) => void;
  actie?: ReactNode;
}) {
  const gekozen = config.doel ?? "rendement";
  const kaarten = vergelijking ? doelKaarten(vergelijking, config) : {};
  const titel =
    vergelijkingsTitel(kaarten, gekozen) ??
    "Waar de batterij op stuurt, verandert wat hij oplevert en wat hij scheelt";

  return (
    <Figure
      actie={actie}
      titel={titel}
      toelichting={
        <>
          Dezelfde batterij en hetzelfde huishouden, drie keer doorgerekend: alleen
          waar de batterij op stuurt verschilt. Afgerekend wordt altijd in echte
          euro&apos;s, op dezelfde uurprijzen. Gemiddeld per jaar, over de volledige
          jaren.
        </>
      }
    >
      <div className="doelkaarten">
        {DOELEN.map(({ id }) => (
          <Kaart
            key={id}
            doel={id}
            kaart={kaarten[id] ?? null}
            fout={vergelijking?.fouten[id] ?? null}
            gekozen={id === gekozen}
            zonnepanelen={zonnepanelen}
            bezig={bezig}
            onKies={onKies}
          />
        ))}
      </div>
      <DoelDag kaarten={kaarten} gekozen={gekozen} />
    </Figure>
  );
}

function Kaart({
  doel,
  kaart,
  fout,
  gekozen,
  zonnepanelen,
  bezig,
  onKies,
}: {
  doel: Doel;
  kaart: DoelKaart | null;
  fout: string | null;
  gekozen: boolean;
  zonnepanelen: boolean;
  bezig: boolean;
  onKies: (doel: Doel) => void;
}) {
  const info = doelInfo(doel);
  return (
    <section
      className={gekozen ? "doelkaart gekozen" : "doelkaart"}
      aria-label={`${info.naam}${gekozen ? ", het doel waarmee de pagina nu rekent" : ""}`}
      data-doel={doel}
    >
      <div className="doelkaart-kop">
        <h4>{info.naam}</h4>
        {gekozen ? <span className="badge goed">Nu gekozen</span> : null}
      </div>
      <p className="doelkaart-kort">{info.kort}</p>
      {kaart ? (
        <dl className="doelcijfers">
          <div>
            <dt>Besparing per jaar</dt>
            <dd className="doelcijfer-hoofd">{euro(kaart.besparingEur)}</dd>
          </div>
          <div>
            <dt>CO2-winst per jaar</dt>
            <dd>
              {kaart.co2WinstKg === null
                ? "—"
                : kaart.co2WinstKg < 0
                  ? `${kg(-kaart.co2WinstKg)} méér`
                  : kg(kaart.co2WinstKg)}
            </dd>
          </div>
          {zonnepanelen && kaart.eigenVerbruik ? (
            <div>
              <dt>Eigen verbruik</dt>
              <dd>{vanNaar(procent(kaart.eigenVerbruik.van), procent(kaart.eigenVerbruik.naar))}</dd>
            </div>
          ) : null}
          <div>
            <dt>Van het net</dt>
            <dd>{vanNaar(getal(kaart.netafname.van), kwh(kaart.netafname.naar))}</dd>
          </div>
          {zonnepanelen ? (
            <div>
              <dt>Naar het net</dt>
              <dd>{vanNaar(getal(kaart.teruglevering.van), kwh(kaart.teruglevering.naar))}</dd>
            </div>
          ) : null}
          <div>
            <dt>Laadbeurten per jaar</dt>
            <dd>{getal(kaart.laadbeurten)}</dd>
          </div>
          <div>
            <dt>Terugverdiend na</dt>
            <dd>
              {kaart.terugverdientijd === null ? "niet binnen de looptijd" : jaren(kaart.terugverdientijd)}
              <span className="dd-noot">
                {kaart.metOvergang
                  ? "met de overgang naar het nettarief, zoals bovenaan"
                  : "als het nettarief blijft zoals nu"}
              </span>
            </dd>
          </div>
        </dl>
      ) : fout ? (
        <p className="doelkaart-wacht fout-tekst" role="alert">
          Dit doel kon niet worden doorgerekend. De andere kaarten kloppen wel.{" "}
          <span className="fout-detail">(Technische melding: {fout})</span>
        </p>
      ) : (
        <p className="doelkaart-wacht">Wordt doorgerekend…</p>
      )}
      <div className="doelkaart-actie">
        {gekozen ? (
          <p className="doelkaart-noot">Hiermee rekent de rest van de pagina.</p>
        ) : (
          <button
            type="button"
            className="knop licht klein"
            disabled={bezig}
            onClick={() => onKies(doel)}
            aria-label={`Reken hiermee: ${info.naam}`}
          >
            Reken hiermee
          </button>
        )}
      </div>
    </section>
  );
}

/* ── Hoe dat eruitziet: dezelfde dag, drie keer ──────────────────────────── */

const B = 720;
const MARGE = { links: 64, rechts: 16 };
const PRIJS_H = 64;
const STROOK_KOP = 24;
const STROOK_H = 74;
const AS_H = 26;
/** Van kWh per kwartier naar gemiddeld kW. */
const PER_KW = 4;

function DoelDag({
  kaarten,
  gekozen,
}: {
  kaarten: Partial<Record<Doel, DoelKaart>>;
  gekozen: Doel;
}) {
  const { kader, tip, toon, wis } = useTip();
  const [aangewezen, setAangewezen] = useState<number | null>(null);
  const rijen = DOELEN.map(({ id }) => ({ doel: id, dag: kaarten[id]?.dag ?? null }));
  const basis = rijen.find((r) => r.doel === gekozen)?.dag ?? rijen.find((r) => r.dag)?.dag ?? null;
  const compleet = rijen.every((r) => r.dag && basis && r.dag.date === basis.date);

  if (!basis || !compleet) {
    return (
      <div className="doeldag">
        <h4 className="doeldag-kop">Hoe dat eruitziet op één dag</h4>
        <p className="doelkaart-wacht">
          {Object.keys(kaarten).length === DOELEN.length
            ? "Voor deze doorrekening is er geen voorbeelddag."
            : "De voorbeelddag verschijnt zodra de drie doelen zijn doorgerekend…"}
        </p>
      </div>
    );
  }

  const n = basis.startMs.length;
  const plotB = B - MARGE.links - MARGE.rechts;
  const x = (i: number) => MARGE.links + (i / n) * plotB;
  const staafB = Math.max(1, plotB / n - 1);

  // Eén vermogensschaal voor alle drie: anders lijkt een batterij die weinig
  // doet net zo druk als een die de hele dag handelt.
  const acties = rijen.map((r) => splitsActies(r.dag!, PER_KW));
  let piek = 0.1;
  for (const a of acties) {
    for (let i = 0; i < n; i++) {
      piek = Math.max(piek, a.uitZon[i]! + a.uitNet[i]!, a.naarHuis[i]! + a.naarNet[i]!);
    }
  }
  // Een ronde grens boven de piek, in halve kilowatts, met die grens als tick
  // boven en onder de nul: zo is elke strook op dezelfde maat af te lezen.
  const kwMax = Math.ceil(piek * 2) / 2;
  const kwTicks = [-kwMax, 0, kwMax];

  const prijzen = basis.importPrice;
  const pMin = Math.min(0, ...prijzen);
  const pMax = Math.max(...prijzen);
  const pTicks = kiesTicks(pMin, pMax, 2);
  const pLo = Math.min(pMin, ...pTicks);
  const pHi = Math.max(pMax, ...pTicks);
  const yP = (v: number) => 8 + (1 - (v - pLo) / (pHi - pLo || 1)) * (PRIJS_H - 16);

  const stroomTop = (k: number) => PRIJS_H + k * (STROOK_KOP + STROOK_H) + STROOK_KOP;
  const H = PRIJS_H + DOELEN.length * (STROOK_KOP + STROOK_H) + AS_H;
  const uren = [0, 6, 12, 18, 24];

  const prijsPad = prijzen
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${yP(p).toFixed(1)}H${x(i + 1).toFixed(1)}`)
    .join("");

  function tipVoor(i: number) {
    const regels: TipRegel[] = [
      { kleur: "var(--series-1)", label: "Je betaalt", waarde: centPerKwh(prijzen[i]!) },
    ];
    rijen.forEach((r, k) => {
      const a = acties[k]!;
      const laden = a.uitZon[i]! + a.uitNet[i]!;
      const leveren = a.naarHuis[i]! + a.naarNet[i]!;
      const wat =
        laden > 0.02
          ? `laadt ${getal(laden, 1)} kW${a.uitNet[i]! > 0.02 ? (a.uitZon[i]! > 0.02 ? ", deels uit het net" : " uit het net") : " uit eigen zon"}`
          : leveren > 0.02
            ? `levert ${getal(leveren, 1)} kW${a.naarNet[i]! > 0.02 ? (a.naarHuis[i]! > 0.02 ? ", deels aan het net" : " aan het net") : " aan je huis"}`
            : "doet niets";
      regels.push({ label: doelInfo(r.doel).naam, waarde: wat });
    });
    return { titel: momentLabel(basis!.startMs[i]!, false), regels };
  }

  return (
    <div className="doeldag">
      <h4 className="doeldag-kop">
        Hoe dat eruitziet op {datum(basis.date)}, een doorsnee zomerdag
      </h4>
      <p className="figure-uitleg">
        Boven de prijs die je die dag voor afname betaalde. Daaronder per doel
        wat de batterij deed: boven de lijn laden (groen uit eigen zon, blauw uit
        het net), eronder leveren (groen aan je huis, oranje aan het net).
      </p>
      <Grafiek
        kader={kader}
        tip={tip}
        onWis={() => {
          setAangewezen(null);
          wis();
        }}
        label={`Laden en leveren per doel op ${datum(basis.date)}, horizontaal scrollbaar`}
      >
        <svg
          viewBox={`0 0 ${B} ${H}`}
          className="chart"
          role="img"
          aria-label={`Wat de batterij op ${datum(basis.date)} deed bij elk van de drie doelen`}
        >
          {aangewezen !== null ? (
            <rect
              className="aangewezen"
              x={x(aangewezen)}
              y={0}
              width={plotB / n}
              height={H - AS_H}
            />
          ) : null}

          {/* De prijs van die dag. */}
          <Raster
            ticks={pTicks}
            x0={MARGE.links}
            x1={B - MARGE.rechts}
            schaal={yP}
            labelBreedte={MARGE.links}
            formatter={(v) => `${getal(v * 100)} ct`}
          />
          <path d={prijsPad} fill="none" stroke="var(--series-1)" strokeWidth={1.8} />

          {rijen.map((r, k) => {
            const a = acties[k]!;
            const top = stroomTop(k);
            const nul = top + STROOK_H / 2;
            const yK = (v: number) => nul - (v / kwMax) * (STROOK_H / 2 - 2);
            const s = r.dag!.stats;
            return (
              <g key={r.doel} className={r.doel === gekozen ? "doeldag-strook gekozen" : "doeldag-strook"}>
                <text x={MARGE.links} y={top - 8} className="paneel-titel doeldag-titel">
                  {doelInfo(r.doel).naam}
                  {r.doel === gekozen ? " (gekozen)" : ""}
                </text>
                <text x={B - MARGE.rechts} y={top - 8} textAnchor="end" className="as-label">
                  {`${euroPrecies(s.savingEur)} bespaard · ${getal(s.chargedFromSolarKwh, 1)} kWh uit zon, ${getal(
                    s.chargedFromGridKwh,
                    1,
                  )} uit het net`}
                </text>
                <Raster
                  ticks={kwTicks}
                  x0={MARGE.links}
                  x1={B - MARGE.rechts}
                  schaal={yK}
                  labelBreedte={MARGE.links}
                  formatter={(v) => `${getal(Math.abs(v), 1)} kW`}
                />
                {Array.from({ length: n }, (_, i) => {
                  const xi = x(i) + 0.5;
                  const zon = a.uitZon[i]!;
                  const net = a.uitNet[i]!;
                  const huis = a.naarHuis[i]!;
                  const verkocht = a.naarNet[i]!;
                  if (zon + net + huis + verkocht < 0.005) return null;
                  return (
                    <g key={i}>
                      {zon > 0 ? <rect x={xi} y={yK(zon)} width={staafB} height={nul - yK(zon)} fill="var(--series-3)" /> : null}
                      {net > 0 ? (
                        <rect x={xi} y={yK(zon + net)} width={staafB} height={yK(zon) - yK(zon + net)} fill="var(--series-1)" />
                      ) : null}
                      {huis > 0 ? <rect x={xi} y={nul} width={staafB} height={yK(-huis) - nul} fill="var(--series-3)" /> : null}
                      {verkocht > 0 ? (
                        <rect
                          x={xi}
                          y={yK(-huis)}
                          width={staafB}
                          height={yK(-huis - verkocht) - yK(-huis)}
                          fill="var(--series-2)"
                        />
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {uren.map((u) => {
            const xu = MARGE.links + (u / 24) * plotB;
            return (
              <text
                key={u}
                x={xu}
                y={H - 8}
                textAnchor={u === 0 ? "start" : u === 24 ? "end" : "middle"}
                className="as-label"
              >
                {`${String(u).padStart(2, "0")}:00`}
              </text>
            );
          })}

          {Array.from({ length: n }, (_, i) => (
            <Trefvlak
              key={i}
              x={x(i)}
              y={0}
              breedte={plotB / n}
              hoogte={H - AS_H}
              onWijs={(punt) => {
                setAangewezen(i);
                toon(punt, tipVoor(i));
              }}
              onWis={() => {
                setAangewezen(null);
                wis();
              }}
            />
          ))}
        </svg>
      </Grafiek>
    </div>
  );
}
