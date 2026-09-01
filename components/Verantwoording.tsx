"use client";

/**
 * Waar de cijfers vandaan komen en waar het model ophoudt.
 *
 * Een rekentool die zijn eigen grenzen verzwijgt, wekt meer vertrouwen dan hij
 * verdient. Dit staat er niet als disclaimer maar als onderdeel van het antwoord.
 */

import type { Manifest } from "../lib/data/manifest";
import { netgebiedNaam } from "../lib/data/manifest";
import type { AnalysisResult } from "../lib/model/analysis";
import { centPerKwh, datum, procent } from "../lib/format";

export function Verantwoording({
  manifest,
  result,
  domein,
}: {
  manifest: Manifest;
  result: AnalysisResult;
  domein: string;
}) {
  const gemiddeldeCapture =
    result.perYear.reduce((a, j) => a + j.captureRate, 0) /
    Math.max(1, result.perYear.length);

  const jaren = Object.values(manifest.profielen[domein] ?? {});
  const eerste = jaren[0]?.eerste_dag;
  const laatste = jaren[jaren.length - 1]?.laatste_dag;

  return (
    <section className="verantwoording">
      <h2>Waar deze cijfers vandaan komen</h2>

      <div className="verantwoording-grid">
        <div>
          <h3>De data</h3>
          <p>
            Verbruik en teruglevering komen uit de{" "}
            <strong>werkelijk gemeten kwartierprofielen</strong> van MFFBAS voor{" "}
            {netgebiedNaam(domein)}
            {eerste && laatste ? (
              <> , van {datum(eerste)} tot {datum(laatste)}</>
            ) : null}
            . De prijzen zijn de <strong>werkelijke uurtarieven</strong> van ANWB
            Energie over diezelfde periode, inclusief btw.
          </p>
          <p>
            Er wordt niets voorspeld. De vraag is wat een batterij zou hebben
            opgeleverd als de saldering toen al was afgeschaft — met de tarieven
            zoals ze werkelijk golden.
          </p>
        </div>

        <div>
          <h3>Wat het model wel en niet meeneemt</h3>
          <ul>
            <li>
              De getoonde bedragen zijn de <strong>variabele stroomkosten</strong>.
              Vastrecht, netbeheerkosten en de belastingvermindering zijn met en
              zonder batterij gelijk en beïnvloeden de besparing niet.
            </li>
            <li>
              Het profiel is een <strong>gemiddelde over veel huishoudens</strong> en
              daardoor gladder dan één aansluiting. Dat onderschat de waarde van
              een batterij eerder dan dat het hem overdrijft.
            </li>
            <li>
              De batterij plant met de day-ahead prijzen en een verwachting van je
              verbruik, niet met kennis van de toekomst. Hij haalt daarmee{" "}
              {procent(gemiddeldeCapture)} van wat met perfecte kennis mogelijk
              was geweest.
            </li>
            <li>
              Wat er in komende jaren gebeurt met prijzen en belastingen is
              onzeker. Historische uitkomsten zijn geen garantie.
            </li>
          </ul>
        </div>
      </div>

      <details className="controle">
        <summary>Controlegegevens per jaar</summary>
        <table>
          <thead>
            <tr>
              <th>Periode</th>
              <th>Afname</th>
              <th>Teruglevering</th>
              <th>Zonder batterij</th>
              <th>Met batterij</th>
              <th>Besparing</th>
              <th>Maximaal</th>
              <th>Cycli</th>
            </tr>
          </thead>
          <tbody>
            {result.perYear.map((j) => (
              <tr key={j.year}>
                <td>
                  {j.firstDay} t/m {j.lastDay}
                  {!j.isFullYear ? <span className="dd-noot">deel</span> : null}
                </td>
                <td>{Math.round(j.gridImportKwh)} kWh</td>
                <td>{Math.round(j.gridExportKwh)} kWh</td>
                <td>{j.baselineCostEur.toFixed(2)}</td>
                <td>{j.realisticCostEur.toFixed(2)}</td>
                <td>{j.realisticSavingEur.toFixed(2)}</td>
                <td>{j.optimalSavingEur.toFixed(2)}</td>
                <td>{Math.round(j.cyclesPerYear)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="controle-noot">
          Gewogen afnameprijs {centPerKwh(result.priceGap.weightedImportPrice)},
          gewogen terugleverprijs {centPerKwh(result.priceGap.weightedExportPrice)},
          ongewogen gemiddelde marktprijs{" "}
          {centPerKwh(result.priceGap.simpleAveragePrice)}. Dat de gewogen
          prijzen verschillen van het ongewogen gemiddelde is precies het effect
          waar het om draait.
        </p>
      </details>
    </section>
  );
}
