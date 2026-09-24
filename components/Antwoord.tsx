"use client";

/**
 * Het antwoord, boven de vouw, in gewone taal.
 *
 * Eén zin met het bedrag en de terugverdientijd, en de onzekerheid er direct
 * naast in plaats van eronder verstopt. Wie verder niets leest, heeft hier het
 * antwoord.
 *
 * ── Terugkijken en vooruitkijken in één zin ─────────────────────────────────
 * Het bedrag is doorgerekend: dit hád een batterij opgeleverd op de uurprijzen
 * zoals ze werkelijk waren. De terugverdientijd is dat bedrag doorgetrokken
 * naar de toekomst, en dat is iets anders — een aanname, geen meting. Die
 * overgang staat daarom in de zin zelf ("blijven de komende jaren hierop
 * lijken…") en niet alleen in de dialoog erachter.
 *
 * ── Eén hoofdgetal ──────────────────────────────────────────────────────────
 * Er is één vetgedrukte terugverdientijd: die mét de overgang naar het
 * voorgestelde nettarief (eerst het huidige tarief, daarna het nieuwe). Dat is
 * hetzelfde getal als in de uitleg, bij het nettarief en in de cashflow. De
 * terugverdientijd als het tarief blijft zoals het is, staat erachter als
 * vergelijking. Zolang het scenario nog rekent, is die vergelijking het enige
 * getal, en dan staat dat er ook bij.
 */

import type { ReactNode } from "react";
import type { AnalysisResult, ScenarioResult } from "../lib/model/analysis";
import { overgangZin, type Overgang } from "../lib/overgang";
import { euro, jaren, jarenReeks } from "../lib/format";

/** De terugverdientijd als zinsdeel: "terugverdiend na 7 jaar" of "niet terugverdiend". */
function terugverdiend(payback: number | null): string {
  return payback !== null ? `terugverdiend na ${jaren(payback)}` : "niet terugverdiend";
}

export function Antwoord({
  result,
  scenario,
  overgang,
  investeringEur,
  bezig,
  heffingVanNu = true,
  actie,
}: {
  result: AnalysisResult;
  /**
   * Dezelfde doorrekening met het voorgestelde tijdsafhankelijke nettarief,
   * of null zolang die nog loopt.
   */
  scenario: ScenarioResult | null;
  /**
   * De terugverdientijd met de tariefwissel erin: de eerste jaren op het
   * huidige tarief, daarna op het voorgestelde nettarief. Dit is het
   * hoofdgetal.
   */
  overgang: Overgang | null;
  investeringEur: number;
  bezig: boolean;
  /**
   * Gerekend met de energiebelasting en opslag van nu (de standaard) in plaats
   * van die van toen. De grondslag onder het bedrag noemt welke.
   */
  heffingVanNu?: boolean;
  /** De knop "Hoe is dit berekend?" rechtsboven. */
  actie?: ReactNode;
}) {
  const { averageSavingEur, minSavingEur, maxSavingEur, finance } = result;
  const spreiding = maxSavingEur - minSavingEur > 1;
  const volledig = result.perYear.filter((j) => j.isFullYear);
  const jaarBereik = volledig.length;
  const jaartallen = jarenReeks(
    (jaarBereik > 0 ? volledig : result.perYear).map((j) => j.year),
  );

  return (
    <section className={bezig ? "antwoord bezig" : "antwoord"} aria-live="polite">
      <div className="antwoord-kop">
        <p className="antwoord-aanhef">Zonder saldering had deze batterij je</p>
        {actie}
      </div>
      <p className="antwoord-bedrag">
        {euro(averageSavingEur)}
        <span className="antwoord-eenheid">per jaar</span>
      </p>
      <p className="antwoord-zin">
        bespaard
        {spreiding && jaarBereik > 1 ? (
          <>
            {" "}
            — tussen {euro(minSavingEur)} en {euro(maxSavingEur)}, afhankelijk van
            welk jaar je pakt
          </>
        ) : null}
        .{" "}
        {overgang ? (
          <>
            Blijven de komende jaren hierop lijken en gaat het voorstel voor het
            nieuwe nettarief door, dan is de aanschaf van {euro(investeringEur)}{" "}
            <strong>{terugverdiend(overgang.finance.paybackYears)}</strong>. Blijft
            het nettarief zoals nu: {terugverdiend(finance.paybackYears)}.
          </>
        ) : finance.paybackYears !== null ? (
          <>
            Blijven de komende jaren hierop lijken en blijft het nettarief zoals
            nu, dan is de aanschaf van {euro(investeringEur)}{" "}
            <strong>terugverdiend na {jaren(finance.paybackYears)}</strong>.
          </>
        ) : (
          <>
            Zelfs als de komende jaren hierop blijven lijken, verdient de
            aanschaf van {euro(investeringEur)} zichzelf binnen de looptijd{" "}
            <strong>niet terug</strong> zolang het nettarief blijft zoals nu.
          </>
        )}
      </p>
      <p className="antwoord-grondslag">
        Doorgerekend op de uurprijzen van {jaartallen} met de belasting en
        opslag van {heffingVanNu ? "nu" : "toen"}. De terugverdientijd trekt dat
        door naar de toekomst; dat is een aanname, geen voorspelling. Deze
        doorrekening gaat uit van een dynamisch energiecontract en een batterij
        die zelf op de uurprijzen stuurt. Het eigen stroomverbruik van de
        batterij (ongeveer 60 tot 220 kWh per jaar) is er niet van afgetrokken.
      </p>
      <p className={scenario ? "antwoord-scenario" : "antwoord-scenario plaatshouder"}>
        {scenario ? (
          <>
            Als het voorstel van de ACM doorgaat, geldt naar verwachting vanaf 1
            januari {overgang?.ingangsjaar ?? 2029} (mogelijk later) een
            tijdsafhankelijk nettarief. Met dat tarief was de besparing{" "}
            <strong>{euro(scenario.averageSavingEur)} per jaar</strong> geweest.
            {overgang && overgang.jarenOpHuidigTarief > 0 ? (
              <>
                {" "}
                De terugverdientijd hierboven rekent {overgangZin(overgang)} met
                het huidige nettarief en daarna met het nieuwe.
              </>
            ) : null}
          </>
        ) : (
          <>Met het voorgestelde nettarief: wordt doorgerekend…</>
        )}
      </p>
    </section>
  );
}
