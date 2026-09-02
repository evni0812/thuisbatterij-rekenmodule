"use client";

/**
 * Waar de kilowatturen blijven.
 *
 * Een batterij geeft minder terug dan je erin stopt, en dat is voor veel mensen
 * de verrassing: niet het rendement op papier, maar hoeveel stroom er in een
 * jaar werkelijk in verdwijnt. Drie posten, en ze zijn wezenlijk anders:
 * laadverlies en ontlaadverlies schalen mee met het gebruik, standby juist
 * niet. Bij een kleine batterij die niet elke dag volloopt is die derde post
 * vaak de grootste — precies het inzicht dat een rendementspercentage verbergt.
 *
 * Bewust geen SVG maar gewone elementen: de waarden staan dan als tekst in de
 * pagina en zijn voorleesbaar, en de kleuren dragen nergens informatie die niet
 * ook in het label staat.
 */

import type { EnergyLosses } from "../lib/model/analysis";
import { euro, getal, kwh, procent } from "../lib/format";
import { Figure } from "./chart-parts";

const GELEVERD = "var(--series-3)";
const OMZETTING = "var(--series-4)";
const STANDBY = "var(--series-1)";

interface Regel {
  label: string;
  uitleg: string;
  kleur: string;
  kwh: number;
  eur: number;
}

export function Verliezen({
  losses,
  afnameKwh,
  besparingEur,
}: {
  losses: EnergyLosses;
  /** Jaarafname zonder batterij, om het verlies tegen af te zetten. */
  afnameKwh: number;
  /** Gemiddelde jaarbesparing, om de verliezen op schaal te zetten. */
  besparingEur: number;
}) {
  const {
    chargedKwh,
    deliveredKwh,
    chargeLossKwh,
    dischargeLossKwh,
    standbyKwh,
    totalKwh,
    roundtrip,
  } = losses;

  if (chargedKwh <= 0) return null;

  // Beide balken op dezelfde schaal, anders vergelijk je lengtes die niets met
  // elkaar te maken hebben.
  const schaal = Math.max(chargedKwh, standbyKwh);
  const breedte = (v: number) => `${(v / schaal) * 100}%`;

  const omzetting = chargeLossKwh + dischargeLossKwh;
  const omzettingEur = losses.chargeLossEur + losses.dischargeLossEur;
  const standbyDomineert = standbyKwh > omzetting;

  // De titel noemt de conclusie, en die verschilt: bij een batterij die veel
  // draait is de omzetting de grootste post, bij een die stilstaat de
  // elektronica. Een vaste kop zou de balken eronder kunnen tegenspreken.
  const titel = standbyDomineert
    ? "Het meeste verlies zit niet in de omzetting, maar in de batterij zelf"
    : `Van elke 100 kWh die je opslaat, komt er ${getal(roundtrip * 100, 0)} weer uit`;

  const regels: Regel[] = [
    {
      label: "Verlies bij het laden",
      uitleg:
        "Omzetten van wisselstroom naar de cel kost energie. Dit schaalt mee " +
        "met hoeveel je opslaat.",
      kleur: OMZETTING,
      kwh: chargeLossKwh,
      eur: losses.chargeLossEur,
    },
    {
      label: "Verlies bij het ontladen",
      uitleg: "Dezelfde omzetting, de andere kant op.",
      kleur: OMZETTING,
      kwh: dischargeLossKwh,
      eur: losses.dischargeLossEur,
    },
    {
      label: "Stroom voor de batterij zelf",
      uitleg:
        "De omvormer en de regeling staan dag en nacht aan, ook als er niets " +
        "gebeurt. Dit hangt niet van je gebruik af.",
      kleur: STANDBY,
      kwh: standbyKwh,
      eur: losses.standbyEur,
    },
  ];

  return (
    <Figure
      titel={titel}
      toelichting={
        <>
          Stroom opslaan kost stroom. Hieronder staat waar die kilowatturen
          blijven, gemiddeld per jaar over de volledige jaren in de gekozen
          periode. De bedragen zijn wat die stroom je had opgeleverd als hij er
          nog was geweest: uit eigen zon de terugleverprijs, van het net de
          afnameprijs.
        </>
      }
    >
      <div className="verlies">
        <div className="verlies-balkrij">
          <div className="verlies-balklabel">
            <span>In de batterij gestopt</span>
            <strong>{kwh(chargedKwh)}</strong>
          </div>
          <div className="verlies-balk">
            <span
              className="verlies-deel"
              style={{ width: breedte(deliveredKwh), background: GELEVERD }}
            />
            {/* Laden en ontladen als één vlak: het is dezelfde omzetting, en
                twee even gekleurde segmenten naast elkaar suggereren een
                onderscheid dat de kleur niet maakt. De splitsing staat in de
                tabel eronder. */}
            <span
              className="verlies-deel"
              style={{ width: breedte(omzetting), background: OMZETTING }}
            />
          </div>
          <p className="verlies-onder">
            Daarvan kwam <strong>{kwh(deliveredKwh)}</strong> er weer uit; de
            rest ging op aan omzetting.
          </p>
        </div>

        <div className="verlies-balkrij">
          <div className="verlies-balklabel">
            <span>Verbruikt door de elektronica</span>
            <strong>{kwh(standbyKwh)}</strong>
          </div>
          <div className="verlies-balk">
            <span
              className="verlies-deel"
              style={{ width: breedte(standbyKwh), background: STANDBY }}
            />
          </div>
          <p className="verlies-onder">
            Continu verbruik, los van hoeveel je opslaat.
          </p>
        </div>
      </div>

      <table className="verlies-tabel">
        <caption className="visueel-verborgen">
          De verliesposten per jaar, in kilowattuur en in euro
        </caption>
        <thead>
          <tr>
            <th scope="col">Waar het bleef</th>
            <th scope="col">Per jaar</th>
            <th scope="col">Waarde</th>
          </tr>
        </thead>
        <tbody>
          {regels.map((r) => (
            <tr key={r.label}>
              <th scope="row">
                <span className="post-vlak" style={{ background: r.kleur }} />
                <span>
                  {r.label}
                  <span className="verlies-uitleg">{r.uitleg}</span>
                </span>
              </th>
              <td>{kwh(r.kwh)}</td>
              <td>{euro(r.eur)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Samen verloren</th>
            <td>{kwh(totalKwh)}</td>
            <td>{euro(losses.totalEur)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="posten-noot">
        Dat is {procent(totalKwh / Math.max(1, afnameKwh))} van de{" "}
        {kwh(afnameKwh)} die je zonder batterij van het net haalt, en{" "}
        {getal(totalKwh / Math.max(0.001, deliveredKwh), 2)} kWh voor elke
        kilowattuur die de batterij aflevert.
      </p>

      {besparingEur > 0 ? (
        <p className="posten-noot">
          Tegenover die {euro(losses.totalEur)} staat een besparing van{" "}
          {euro(besparingEur)}. Zonder enig verlies had de batterij dus ruwweg{" "}
          {euro(besparingEur + losses.totalEur)} opgeleverd: {" "}
          {procent(losses.totalEur / (besparingEur + losses.totalEur))} van wat
          hij bruto verdient, verdwijnt in het apparaat zelf.
        </p>
      ) : null}

      {standbyDomineert ? (
        <p className="posten-noot">
          De elektronica kost je hier meer dan de omzetting: {kwh(standbyKwh)}{" "}
          tegen {kwh(omzetting)}, oftewel {euro(losses.standbyEur)} tegen{" "}
          {euro(omzettingEur)}. Dat komt doordat dit verbruik dóórloopt terwijl
          de batterij een groot deel van het jaar weinig te doen heeft. Een
          grotere batterij, of een met minder eigen verbruik, verdeelt die vaste
          post over meer opgeslagen kilowatturen.
        </p>
      ) : null}

      <p className="posten-noot">
        Deze kilowatturen zijn geen extra kostenpost bovenop de besparing
        hierboven: ze zitten er al in verwerkt. Je bespaart minder afname dan je
        aan stroom opsloeg, en dat verschil is precies wat hier staat.
      </p>
    </Figure>
  );
}
