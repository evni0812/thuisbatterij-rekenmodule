"use client";

/**
 * Het antwoord, boven de vouw, in gewone taal.
 *
 * Eén zin met het bedrag en de terugverdientijd, en de onzekerheid er direct
 * naast in plaats van eronder verstopt. Wie verder niets leest, heeft hier het
 * antwoord.
 */

import type { AnalysisResult } from "../lib/model/analysis";
import { euro, jaren } from "../lib/format";

export function Antwoord({
  result,
  investeringEur,
  bezig,
}: {
  result: AnalysisResult;
  investeringEur: number;
  bezig: boolean;
}) {
  const { averageSavingEur, minSavingEur, maxSavingEur, finance } = result;
  const spreiding = maxSavingEur - minSavingEur > 1;
  const terugverdient = finance.paybackYears !== null;
  const jaarBereik = result.perYear.filter((j) => j.isFullYear).length;

  return (
    <section className={bezig ? "antwoord bezig" : "antwoord"} aria-live="polite">
      <p className="antwoord-aanhef">Zonder saldering had deze batterij je</p>
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
            De aanschaf van {euro(investeringEur)} is dan{" "}
            <strong>terugverdiend na {jaren(finance.paybackYears)}</strong>.
          </>
        ) : (
          <>
            De aanschaf van {euro(investeringEur)} verdient zichzelf binnen de
            levensduur <strong>niet terug</strong>.
          </>
        )}
      </p>
    </section>
  );
}
