"use client";

/**
 * Het antwoord, boven de vouw, in gewone taal.
 *
 * Eén zin met het bedrag en de terugverdientijd, en de onzekerheid er direct
 * naast in plaats van eronder verstopt. Wie verder niets leest, heeft hier het
 * antwoord.
 *
 * ── Terugkijken en vooruitkijken in één zin ─────────────────────────────────
 * Het bedrag is gemeten: dit hád een batterij opgeleverd op de prijzen en het
 * verbruik zoals ze werkelijk waren. De terugverdientijd is dat bedrag
 * doorgetrokken naar de toekomst, en dat is iets anders — een aanname, geen
 * meting. Die overgang staat daarom in de zin zelf ("blijft dat zo, dan…") en
 * niet alleen in de dialoog erachter. Kort houden: één voorwaardelijke bijzin
 * en één regel eronder. Wie het bedrag vertrouwt moet weten waar het meten
 * ophoudt, maar niet worden bedolven onder voorbehouden.
 */

import type { ReactNode } from "react";
import type { AnalysisResult, ScenarioResult } from "../lib/model/analysis";
import type { Overgang } from "../lib/overgang";
import { euro, jaren } from "../lib/format";

export function Antwoord({
  result,
  scenario,
  overgang,
  investeringEur,
  bezig,
  heffingVanNu = false,
  actie,
}: {
  result: AnalysisResult;
  /**
   * Dezelfde doorrekening met het tijdsafhankelijke nettarief vanaf 2029, of
   * null zolang die nog loopt. Dit is het inzicht dat de businesscase omslaat,
   * en het hoort dus in het antwoord — niet acht secties lager achter een knop.
   */
  scenario: ScenarioResult | null;
  /**
   * De terugverdientijd met de tariefwissel erin: de eerste jaren op het
   * huidige tarief, daarna op dat van 2029. Dit is het getal dat geldt voor wie
   * vandaag koopt; de twee doorrekeningen apart nemen elk hun eigen tarief voor
   * de hele levensduur en zijn daarmee te pessimistisch respectievelijk te
   * optimistisch.
   */
  overgang: Overgang | null;
  investeringEur: number;
  bezig: boolean;
  /**
   * Er is gerekend met de energiebelasting en opslag van nu in plaats van die
   * van toen. De aanhef moet dat zeggen: de heffing was in 2024 en 2025 een
   * kwart tot een derde hoger dan nu, en de besparing schaalt daar bijna
   * één-op-één mee.
   */
  heffingVanNu?: boolean;
  /** De knop "Hoe is dit berekend?" rechtsboven. */
  actie?: ReactNode;
}) {
  const { averageSavingEur, minSavingEur, maxSavingEur, finance } = result;
  const spreiding = maxSavingEur - minSavingEur > 1;
  const terugverdient = finance.paybackYears !== null;
  const jaarBereik = result.perYear.filter((j) => j.isFullYear).length;

  return (
    <section className={bezig ? "antwoord bezig" : "antwoord"} aria-live="polite">
      <div className="antwoord-kop">
        <p className="antwoord-aanhef">
          {heffingVanNu
            ? "Zonder saldering, met de energiebelasting van nu, had deze batterij je"
            : "Zonder saldering had deze batterij je"}
        </p>
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
        {terugverdient ? (
          <>
            Blijven de komende jaren hierop lijken, dan is de aanschaf van{" "}
            {euro(investeringEur)} <strong>terugverdiend na{" "}
            {jaren(finance.paybackYears)}</strong>.
          </>
        ) : (
          <>
            Zelfs als de komende jaren hierop blijven lijken, verdient de
            aanschaf van {euro(investeringEur)} zichzelf binnen de levensduur{" "}
            <strong>niet terug</strong>.
          </>
        )}
      </p>
      <p className="antwoord-grondslag">
        Gemeten op {jaarBereik > 1 ? `${jaarBereik} volledige jaren` : "een jaar"}{" "}
        echte prijzen en je eigen verbruik. De terugverdientijd trekt dat door
        naar de toekomst; dat is een aanname, geen voorspelling.
      </p>
      <p className={scenario ? "antwoord-scenario" : "antwoord-scenario plaatshouder"}>
        {scenario ? (
          <>
            Vanaf {overgang?.ingangsjaar ?? 2029} gaat het tijdsafhankelijke
            nettarief in, en wordt dat{" "}
            <strong>{euro(scenario.averageSavingEur)} per jaar</strong>.
            {overgang && overgang.jarenOpHuidigTarief > 0 ? (
              <>
                {" "}
                Koop je nu, dan draait de batterij eerst nog{" "}
                {overgang.jarenOpHuidigTarief === 1
                  ? "een jaar"
                  : `${overgang.jarenOpHuidigTarief} jaar`}{" "}
                op de tarieven van vandaag; over beide perioden samen is de
                aanschaf{" "}
                {overgang.finance.paybackYears !== null ? (
                  <>terugverdiend na {jaren(overgang.finance.paybackYears)}</>
                ) : (
                  <>niet terugverdiend</>
                )}
                .
              </>
            ) : null}
          </>
        ) : (
          <>Met het nettarief dat in 2029 ingaat: wordt doorgerekend…</>
        )}
      </p>
    </section>
  );
}
