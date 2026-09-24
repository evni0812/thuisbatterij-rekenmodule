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
import { centPerKwh, datum, euroPrecies, procent } from "../lib/format";

export function Verantwoording({
  manifest,
  result,
  domein,
}: {
  manifest: Manifest;
  result: AnalysisResult;
  domein: string;
}) {
  // Alleen volledige jaren: een deeljaar heeft een ander seizoensgewicht en
  // hoort niet in hetzelfde gemiddelde als de rest van de pagina.
  const volledig = result.perYear.filter((j) => j.isFullYear);
  const basis = volledig.length > 0 ? volledig : result.perYear;
  const gemiddeldeCapture =
    basis.reduce((a, j) => a + j.captureRate, 0) / Math.max(1, basis.length);

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
            Verbruik en teruglevering volgen het{" "}
            <strong>gemeten gemiddelde kwartierpatroon</strong> van alle
            kleinverbruikers (E1A) met, of zonder, teruglevering in{" "}
            {netgebiedNaam(domein)} (MFFBAS/EDSN)
            {eerste && laatste ? (
              <>, van {datum(eerste)} tot {datum(laatste)}</>
            ) : null}
            , geschaald naar jouw jaartotalen. Het is geen meting van één
            huishouden. De prijzen zijn de <strong>werkelijke uurtarieven</strong>{" "}
            van ANWB Energie over diezelfde periode, inclusief btw.
          </p>
          <p>
            Er wordt niets voorspeld. De vraag is wat een batterij zou hebben
            opgeleverd als de saldering toen al was afgeschaft, met de uurprijzen
            zoals ze werkelijk waren en standaard de belasting en opslag van nu.
          </p>
        </div>

        <div>
          <h3>Wat het model wel en niet meeneemt</h3>
          <ul>
            <li>
              De getoonde bedragen zijn de <strong>variabele stroomkosten</strong>.
              Vastrecht, de belastingvermindering en het vaste deel van de
              netbeheerkosten zijn met en zonder batterij gelijk en beïnvloeden de
              besparing niet. Gaat het voorstel voor het nieuwe nettarief door,
              dan hangt een deel van die netkosten naar verwachting vanaf 2029
              wél van je gedrag af; wat dat doet staat in de sectie over het
              tijdsafhankelijke nettarief.
            </li>
            <li>
              Het profiel is een <strong>gemiddelde over veel huishoudens</strong> en
              daardoor gladder dan één aansluiting. Of dat de uitkomst te hoog of
              te laag maakt, is niet zeker. Hoe gevoelig hij ervoor is, zie je
              zelf: zet bij de instellingen „Pieken in je verbruik” hoger en
              reken opnieuw.
            </li>
            <li>
              De batterij plant met de prijzen die een dag van tevoren bekend worden,
              en met een verwachting van je verbruik. Niet met kennis van de
              toekomst. Hij haalt daarmee{" "}
              {procent(gemiddeldeCapture)} van wat met perfecte kennis mogelijk
              was geweest, gemiddeld over{" "}
              {volledig.length > 0 ? "de volledige jaren" : "de gekozen periode"}.
              {result.gap ? (
                <>
                  {" "}
                  Van het verschil komt{" "}
                  <strong>{euroPrecies(result.gap.forecastCostEur)}</strong> doordat
                  zon en verbruik van morgen een verwachting zijn, en{" "}
                  <strong>{euroPrecies(result.gap.horizonCostEur)}</strong> doordat
                  de prijzen van morgen pas rond 13:00 bekend worden. Het weer weegt
                  hier dus veel zwaarder dan de prijshorizon.
                </>
              ) : null}
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
              <th>Met perfecte kennis</th>
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
                <td>{euroPrecies(j.baselineCostEur)}</td>
                <td>{euroPrecies(j.realisticCostEur)}</td>
                <td>{euroPrecies(j.realisticSavingEur)}</td>
                <td>{euroPrecies(j.optimalSavingEur)}</td>
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
