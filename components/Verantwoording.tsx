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
import { centPerKwh, datum, euroPrecies, getal, jarenReeks, periode, procent } from "../lib/format";
import { FiguurNaam } from "./chart-parts";

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
  const bedragJaren = volledig.length > 0 ? jarenReeks(volledig.map((j) => j.year)) : "de gekozen periode";
  const eerste = jaren[0]?.eerste_dag;
  const laatste = jaren[jaren.length - 1]?.laatste_dag;

  return (
    <section id="data-en-model" className="verantwoording">
      <FiguurNaam anker="data-en-model" />
      <h3>Waar deze cijfers vandaan komen</h3>

      <div className="verantwoording-grid">
        <div>
          <h4>De gegevens</h4>
          <p>
            Verbruik en teruglevering volgen het{" "}
            <strong>gemeten gemiddelde kwartierpatroon</strong> van alle
            kleinverbruikers (E1A) met, of zonder, teruglevering in{" "}
            {netgebiedNaam(domein)} (MFFBAS/EDSN)
            {eerste && laatste ? (
              <>, van {datum(eerste)} tot {datum(laatste)}</>
            ) : null}
            . We schalen dat naar jouw jaartotalen. Het is geen meting van één
            huishouden. De prijzen zijn de <strong>werkelijke uurtarieven</strong>{" "}
            van ANWB Energie over diezelfde periode, inclusief btw.
          </p>
          <p>
            We gebruiken geen prijsvoorspelling: het bedrag is wat de batterij
            in {bedragJaren} had opgeleverd. De terugverdientijd trekt dat door
            naar de toekomst; dat is een aanname. We rekenen zonder saldering,
            met de uurprijzen van toen en standaard de energiebelasting en
            opslag van nu.
          </p>
          <p>
            Is je periode korter dan een jaar of zit er geen volledig
            kalenderjaar in, dan schalen we de uitkomst naar een jaar: 365
            gedeeld door het aantal dagen.
          </p>
        </div>

        <div>
          <h4>Wat het model wel en niet meeneemt</h4>
          <ul>
            <li>
              De getoonde bedragen zijn de <strong>variabele stroomkosten</strong>.
              Vastrecht, de belastingvermindering en het vaste deel van de
              netbeheerkosten zijn met en zonder batterij gelijk en beïnvloeden de
              besparing niet. Gaat het voorstel voor het nieuwe nettarief door,
              dan hangt een deel van die netkosten naar verwachting vanaf 2029
              wél van je gedrag af. Wat dat doet, staat bij Nettarief van 2029.
            </li>
            <li>
              Het <strong>stand-byverbruik van de batterij</strong> is van de
              besparing afgetrokken ({getal(result.breakdown.standbyKwh)} kWh per jaar,{" "}
              {euroPrecies(-result.breakdown.standbyEur)}), alleen op de momenten
              dat de batterij niet laadt of ontlaadt. De aansturing weet er niets
              van, en de dagfiguren laten alleen de handel zien.
            </li>
            <li>
              Het profiel is een <strong>gemiddelde over veel huishoudens</strong> en
              daardoor gladder dan één aansluiting. Of dat de uitkomst te hoog of
              te laag maakt, is niet zeker. Hoe gevoelig hij ervoor is, zie je
              zelf: zet bij de instellingen ‘Pieken in je verbruik’ hoger en
              reken opnieuw.
            </li>
            <li>
              De aansturing van de batterij, de software die bepaalt wanneer hij
              laadt en levert, plant met de prijzen voor morgen, die rond 13.00
              uur bekend worden, en met een verwachting van je verbruik. Ze kent de
              toekomst niet. Daarmee haalt ze{" "}
              {procent(gemiddeldeCapture)} van wat met perfecte kennis mogelijk
              was, gemiddeld over{" "}
              {volledig.length > 0 ? "de volledige jaren" : "de gekozen periode"}.
              {result.gap ? (
                <>
                  {" "}
                  Waar dat verschil vandaan komt, hebben we gemeten in{" "}
                  {result.gap.year}: dat jaar kostte{" "}
                  <strong>{euroPrecies(result.gap.forecastCostEur)}</strong> de
                  verwachting van zon en verbruik voor morgen, en{" "}
                  <strong>{euroPrecies(result.gap.horizonCostEur)}</strong> het
                  wachten op de prijzen van morgen, die pas rond 13.00 uur bekend
                  zijn. Het weer weegt dus veel zwaarder dan de prijzen.
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
              <th>Waarvan stand-by</th>
              <th>Besparing</th>
              <th>Met perfecte kennis</th>
              <th>Laadbeurten</th>
            </tr>
          </thead>
          <tbody>
            {result.perYear.map((j) => (
              <tr key={j.year}>
                <td>
                  {periode(j.firstDay, j.lastDay)}
                  {!j.isFullYear ? <span className="dd-noot">deel</span> : null}
                </td>
                <td>{Math.round(j.gridImportKwh)} kWh</td>
                <td>{Math.round(j.gridExportKwh)} kWh</td>
                <td>{euroPrecies(j.baselineCostEur)}</td>
                <td>{euroPrecies(j.realisticCostEur)}</td>
                <td>{euroPrecies(j.standbyCostEur)}</td>
                <td>{euroPrecies(j.realisticSavingEur)}</td>
                <td>{euroPrecies(j.optimalSavingEur)}</td>
                <td>{getal(j.cyclesPerYear)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="controle-noot">
          Gewogen afnameprijs {centPerKwh(result.priceGap.weightedImportPrice)},
          gewogen terugleverprijs {centPerKwh(result.priceGap.weightedExportPrice)},
          ongewogen gemiddelde marktprijs{" "}
          {centPerKwh(result.priceGap.simpleAveragePrice)}. Het verschil tussen
          de gewogen prijzen en het ongewogen gemiddelde is het effect waar het
          om draait.
        </p>
      </details>
    </section>
  );
}
