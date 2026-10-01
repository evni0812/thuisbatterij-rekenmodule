"use client";

/**
 * Stap 4: wat had hij je opgeleverd?
 *
 * Eén boodschap: het bedrag per jaar. Daaronder waar het vandaan komt, wanneer
 * de aanschaf terug is verdiend, en dat dit geen voorspelling is. Alle getallen
 * komen uit dezelfde doorrekening als de tabbladen (zie ./uitkomst.ts).
 */

import type { AnalysisResult } from "../../lib/model/analysis";
import { euro, jaren, standbyZin } from "../../lib/format";
import { NETTARIEF_JAAR } from "../../lib/nettarief";
import { overgangZin, type Overgang } from "../../lib/overgang";
import type { FinanceResult } from "../../lib/model/finance";
import { Optellend } from "./Optellend";
import type { GidsData } from "./types";
import {
  cumulatief,
  gedeeldeSchaal,
  grondslagZin,
  hoofdgetal,
  posten,
  sparkAlt,
  sparkPad,
  verliesNoot,
  type Post,
} from "./uitkomst";

export function StapOpbrengst(p: GidsData) {
  const { result, toon, scenario, overgang, bedragJarenTekst } = p;

  if (!result || !toon) return <Skelet />;

  const hoofd = hoofdgetal(result);
  const jarenTekst = result.perYear.some((j) => j.isFullYear) ? hoofd.jarenTekst : bedragJarenTekst;
  const heffingVanNu = toon.useHistoricalLevy === false;
  const investeringEur = toon.investmentEur;

  return (
    <>
      <section className="uk-hoofd" aria-label="Wat de batterij bespaart">
        <Munten />
        <div>
          <p className="uk-aanhef">Zonder saldering had deze batterij je</p>
          <p className="gids-groot uk-getal">
            <Optellend waarde={hoofd.gemiddeldEur} />
            <span className="uk-eenheid">per jaar bespaard</span>
          </p>
          {hoofd.band ? (
            <p className="uk-band">
              Tussen {euro(hoofd.band.minEur)} en {euro(hoofd.band.maxEur)}, afhankelijk van
              welk jaar je pakt.
            </p>
          ) : null}
          <p className="uk-grond">
            {grondslagZin(jarenTekst, heffingVanNu)} Uitgangspunt is een dynamisch
            energiecontract, waarbij je elk uur de marktprijs betaalt. Saldering, het verrekenen
            van teruglevering met afname, stopt op 1 januari 2027.{" "}
            {standbyZin(toon.standbyWatt, result.breakdown.standbyKwh, -result.breakdown.standbyEur)}
          </p>
        </div>
      </section>

      <section className="uk-blok" aria-labelledby="uk-bron">
        <h2 id="uk-bron">Waar komt het vandaan?</h2>
        <Verdeling result={result} />
      </section>

      <section className="uk-blok" aria-labelledby="uk-terug">
        <h2 id="uk-terug">Wanneer is de aanschaf terug?</h2>
        <p className="uk-intro">
          De aanschaf is {euro(investeringEur)}. Het nettarief is wat je aan de netbeheerder
          betaalt voor het gebruik van het stroomnet.
          {overgang ? <> We rekenen {overgangZin(overgang)} met het huidige nettarief en daarna met het nieuwe.</> : null}
        </p>
        <Terugverdienen
          result={result}
          overgang={overgang}
          scenarioKlaar={scenario !== null || p.scenarioFout !== null}
          investeringEur={investeringEur}
        />
        <div className="notitie waarschuwing uk-disclaimer" role="note">
          <p>
            <b>Dit is geen voorspelling.</b> We nemen de gemiddelde besparing van {jarenTekst}{" "}
            en laten die elk jaar terugkomen. Niemand weet wat de stroomprijzen, de belasting
            en het nettarief de komende jaren doen. Worden de prijsverschillen tussen de uren
            kleiner, dan duurt terugverdienen langer, en worden ze groter, dan gaat het sneller.
          </p>
        </div>
      </section>

      <div className="gids-verdieping">
        <button type="button" onClick={() => p.naarVerdieping("besparing")}>
          Waar komt de besparing vandaan?
        </button>
        <button type="button" onClick={() => p.naarVerdieping("terugverdienen", "looptijd")}>
          Over de looptijd
        </button>
        {p.uitleg("antwoord")}
      </div>
    </>
  );
}

/* ── Waar het vandaan komt ─────────────────────────────────────────────────── */

const POST_KLEUR: Record<Post["id"], string> = {
  zelf: "var(--series-1)",
  slim: "var(--series-2)",
  negatief: "var(--series-4)",
  standby: "var(--series-5)",
};

function Verdeling({ result }: { result: AnalysisResult }) {
  const lijst = posten(result.breakdown);
  const positief = lijst.filter((x) => x.waardeEur > 0);
  const som = positief.reduce((s, x) => s + x.waardeEur, 0);
  const alt = `De besparing van ${euro(result.averageSavingEur)} per jaar bestaat uit: ${lijst
    .map((x) => `${x.label.toLowerCase()} ${euro(x.waardeEur)}`)
    .join(", ")}.`;

  return (
    <>
      {som > 0 ? (
        <div className="uk-balk" role="img" aria-label={alt}>
          {positief.map((x) => (
            <span
              key={x.id}
              className="uk-deel"
              style={{ flexGrow: x.waardeEur, background: POST_KLEUR[x.id] }}
            />
          ))}
        </div>
      ) : null}
      <ul className="uk-posten">
        {lijst.map((x) => (
          <li key={x.id}>
            <span className="uk-stip" style={{ background: POST_KLEUR[x.id] }} aria-hidden="true" />
            <span className="uk-post-tekst">
              <strong>{x.label}</strong>
              <span>{x.uitleg}</span>
            </span>
            <span className="uk-post-bedrag">{euro(x.waardeEur)}</span>
          </li>
        ))}
      </ul>
      <p className="uk-noot">{verliesNoot(result.breakdown)}</p>
    </>
  );
}

/* ── Terugverdienen ────────────────────────────────────────────────────────── */

function Terugverdienen({
  result,
  overgang,
  scenarioKlaar,
  investeringEur,
}: {
  result: AnalysisResult;
  overgang: Overgang | null;
  scenarioKlaar: boolean;
  investeringEur: number;
}) {
  const nu = result.finance;
  const metNet = overgang?.finance ?? null;
  const reeksNu = cumulatief(nu, investeringEur);
  const reeksNet = metNet ? cumulatief(metNet, investeringEur) : null;
  // Eén schaal voor beide lijntjes: dezelfde eurohoogte is dezelfde afstand.
  const schaal = gedeeldeSchaal(reeksNu, reeksNet);
  const jaar = overgang?.ingangsjaar ?? NETTARIEF_JAAR;

  return (
    <div className="uk-kaarten">
      <Kaart
        hoofd
        kop={`Gaat het nettarief van ${jaar} door`}
        finance={metNet}
        reeks={reeksNet}
        schaal={schaal}
        wacht={!metNet}
        wachtTekst={
          scenarioKlaar
            ? "Dit kon niet worden doorgerekend."
            : `We rekenen het nettarief van ${jaar} nog door…`
        }
      />
      <Kaart
        kop="Blijft het nettarief zoals nu"
        finance={nu}
        reeks={reeksNu}
        schaal={schaal}
      />
    </div>
  );
}

function Kaart({
  hoofd = false,
  kop,
  finance,
  reeks,
  schaal,
  wacht = false,
  wachtTekst,
}: {
  hoofd?: boolean;
  kop: string;
  finance: FinanceResult | null;
  reeks: number[] | null;
  schaal: { min: number; max: number };
  wacht?: boolean;
  wachtTekst?: string;
}) {
  const klas = hoofd ? "uk-kaart uk-kaart-hoofd" : "uk-kaart";
  if (wacht || !finance || !reeks) {
    return (
      <div className={klas} aria-live="polite">
        <h3>{kop}</h3>
        <p className="uk-wacht">{wachtTekst}</p>
        <div className="uk-skelet-lijn" aria-hidden="true" />
      </div>
    );
  }
  const payback = finance.paybackYears;
  const pad = sparkPad(reeks, payback, 240, 76, schaal);
  return (
    <div className={klas}>
      <h3>{kop}</h3>
      {payback !== null ? (
        <p className="uk-tvt">
          <span className="uk-tvt-label">terugverdiend na</span>
          <strong>{jaren(payback)}</strong>
        </p>
      ) : (
        <p className="uk-tvt uk-tvt-nee">
          <strong>Niet terugverdiend binnen de looptijd</strong>
        </p>
      )}
      <svg
        className="uk-spark"
        viewBox="0 0 240 76"
        role="img"
        aria-label={sparkAlt(reeks, payback)}
      >
        <line x1="0" x2="240" y1={pad.nulY} y2={pad.nulY} className="uk-nul" />
        <path d={pad.vlak} className={payback !== null ? "uk-vlak" : "uk-vlak uk-vlak-min"} />
        <path d={pad.lijn} className={payback !== null ? "uk-lijn" : "uk-lijn uk-lijn-min"} />
        {pad.punt ? <circle cx={pad.punt.x} cy={pad.punt.y} r="4" className="uk-punt" /> : null}
      </svg>
      <p className="uk-spark-noot">
        Opgeteld na {reeks.length - 1} jaar: {euro(reeks[reeks.length - 1]!)}, na aftrek van de aanschaf.
      </p>
    </div>
  );
}

/* ── Tekeningetjes en wachtstand ───────────────────────────────────────────── */

/** Een stapeltje munten naast het hoofdgetal; versiering, dus verborgen voor schermlezers. */
function Munten() {
  return (
    <svg className="uk-munten" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <g>
        <ellipse cx="34" cy="78" rx="26" ry="9" fill="var(--seq-300)" />
        <rect x="8" y="66" width="52" height="12" fill="var(--seq-300)" />
        <ellipse cx="34" cy="66" rx="26" ry="9" fill="var(--seq-200)" />
        <ellipse cx="34" cy="62" rx="26" ry="9" fill="var(--seq-300)" />
        <rect x="8" y="50" width="52" height="12" fill="var(--seq-300)" />
        <ellipse cx="34" cy="50" rx="26" ry="9" fill="var(--seq-200)" />
      </g>
      <g className="uk-munt-boven">
        <ellipse cx="62" cy="44" rx="26" ry="9" fill="var(--seq-500)" />
        <rect x="36" y="32" width="52" height="12" fill="var(--seq-500)" />
        <ellipse cx="62" cy="32" rx="26" ry="9" fill="var(--seq-400)" />
        <text x="62" y="36" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">
          €
        </text>
      </g>
    </svg>
  );
}

export function Skelet() {
  return (
    <div className="uk-skelet" aria-hidden="true">
      <div className="uk-skelet-blok uk-skelet-groot" />
      <div className="uk-skelet-blok" />
      <div className="uk-skelet-blok uk-skelet-balk" />
      <div className="uk-skelet-rij">
        <div className="uk-skelet-blok uk-skelet-kaart" />
        <div className="uk-skelet-blok uk-skelet-kaart" />
      </div>
    </div>
  );
}
