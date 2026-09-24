"use client";

/**
 * Hoe efficiënt een thuisbatterij werkelijk is.
 *
 * Eén verlies: de omzetting, wat er bij laden en ontladen verdwijnt. Schaalt
 * mee met hoeveel je opslaat, en is wat "rendement heen en terug" op een
 * datasheet betekent.
 *
 * Het sluipverbruik van de omvormer stond hier eerder als tweede blok. Het zit
 * niet meer in het model: dit model gaat over wat de handel oplevert, en
 * standby loopt door of de batterij nu handelt of niet. Het is een vaste post
 * van het bezit, naast de aanschaf, en hoort niet in de dagcijfers.
 */

import type { ReactNode } from "react";
import type { EnergyLosses } from "../lib/model/analysis";
import { euro, getal, kwh, procent } from "../lib/format";
import { Figure, TipLaag, useTip } from "./chart-parts";

const GELEVERD = "var(--series-3)";
const OMZETTING = "var(--series-4)";

export function Verliezen({
  losses,
  afnameKwh,
  besparingEur,
  actie,
}: {
  losses: EnergyLosses;
  /** Jaarafname zonder batterij, om het verlies tegen af te zetten. */
  afnameKwh: number;
  /** Gemiddelde jaarbesparing, om de verliezen op schaal te zetten. */
  besparingEur: number;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const { kader, tip, toon, wis } = useTip();

  const {
    chargedKwh,
    deliveredKwh,
    chargeLossKwh,
    dischargeLossKwh,
    totalKwh,
    roundtrip,
  } = losses;

  if (chargedKwh <= 0) return null;

  const omzetting = chargeLossKwh + dischargeLossKwh;
  const omzettingEur = losses.chargeLossEur + losses.dischargeLossEur;

  // Blok A staat op de schaal van wat erin ging; de rest van de balk is lading
  // die aan het eind van het jaar nog in de cel zat.
  const deelVanLading = (v: number) => `${(v / chargedKwh) * 100}%`;
  const restInCel = Math.max(0, chargedKwh - deliveredKwh - omzetting);

  const titel = `Van elke 100 kWh die je opslaat, komt er ${getal(roundtrip * 100, 0)} weer uit`;

  return (
    <Figure
      actie={actie}
      titel={titel}
      toelichting={
        <>
          Stroom opslaan kost stroom: bij het laden en bij het ontladen gaat een
          deel verloren in de omzetting. Gemiddeld per jaar over de volledige
          jaren in de gekozen periode. Het eigen stroomverbruik van de batterij
          (stand-by; fabrikanten noemen zo'n 7 tot 25 watt, 60 tot 220 kWh per
          jaar) staat hier niet bij en is ook niet van de besparing afgetrokken.
        </>
      }
    >
      <div className="chart-hover" ref={kader} onMouseLeave={wis}>
        {/* ── 1. De omzetting ─────────────────────────────────────────────── */}
        <section className="efficientie-blok">
          <div className="efficientie-kop">
            <h4>De omzetting</h4>
            <p>
              Wat er van je lading overblijft. Dit schaalt mee met hoeveel je
              opslaat.
            </p>
          </div>

          <div
            className="verlies-balk groot"
            onMouseMove={(e) =>
              toon(e, {
                titel: "De omzetting, per jaar",
                regels: [
                  { kleur: GELEVERD, label: "Geleverd aan het huis", waarde: kwh(deliveredKwh) },
                  { kleur: OMZETTING, label: "Verlies bij het laden", waarde: kwh(chargeLossKwh) },
                  { kleur: OMZETTING, label: "Verlies bij het ontladen", waarde: kwh(dischargeLossKwh) },
                  { label: "In de batterij gestopt", waarde: kwh(chargedKwh), uitkomst: true },
                ],
                noot: `Rondgang: ${procent(roundtrip, 1)} van wat erin gaat, komt er weer uit.`,
              })
            }
          >
            <span
              className="verlies-deel"
              style={{ width: deelVanLading(deliveredKwh), background: GELEVERD }}
            >
              <b>{procent(roundtrip)}</b>
            </span>
            <span
              className="verlies-deel"
              style={{ width: deelVanLading(chargeLossKwh), background: OMZETTING }}
            />
            <span
              className="verlies-deel streep"
              style={{ width: deelVanLading(dischargeLossKwh), background: OMZETTING }}
            />
          </div>

          <p className="efficientie-zin">
            Je stopte er <strong>{kwh(chargedKwh)}</strong> in en kreeg{" "}
            <strong>{kwh(deliveredKwh)}</strong> terug. De omzetting kostte{" "}
            {kwh(omzetting)}, oftewel {euro(omzettingEur)}
            {restInCel > 1
              ? `; ${kwh(restInCel)} zat aan het eind van het jaar nog in de cel`
              : ""}
            .
          </p>
        </section>

        <TipLaag tip={tip} />
      </div>

      {/* ── Samen ──────────────────────────────────────────────────────────── */}
      <dl className="kerncijfers">
        <div>
          <dt>Rondgang van de omzetting</dt>
          <dd>{procent(roundtrip, 1)}</dd>
        </div>
        <div>
          <dt>Samen verloren</dt>
          <dd>
            {kwh(totalKwh)}
            <span className="dd-noot">
              {procent(totalKwh / Math.max(1, afnameKwh))} van de {kwh(afnameKwh)}{" "}
              die je zonder batterij van het net haalt
            </span>
          </dd>
        </div>
        <div>
          <dt>Wat dat verlies waard was</dt>
          <dd>
            {euro(losses.totalEur)}
            {besparingEur > 0 ? (
              <span className="dd-noot">
                tegenover {euro(besparingEur)} besparing; zonder enig verlies had
                de batterij ruwweg {euro(besparingEur + losses.totalEur)}{" "}
                opgeleverd
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

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
          <tr>
            <th scope="row">
              <span className="post-vlak" style={{ background: OMZETTING }} />
              <span>Verlies bij het laden</span>
            </th>
            <td>{kwh(chargeLossKwh)}</td>
            <td>{euro(losses.chargeLossEur)}</td>
          </tr>
          <tr>
            <th scope="row">
              <span className="post-vlak" style={{ background: OMZETTING }} />
              <span>Verlies bij het ontladen</span>
            </th>
            <td>{kwh(dischargeLossKwh)}</td>
            <td>{euro(losses.dischargeLossEur)}</td>
          </tr>
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
        Deze kilowatturen zijn geen extra kostenpost bovenop de besparing
        hierboven: ze zitten er al in verwerkt. Je bespaart minder afname dan je
        aan stroom opsloeg, en dat verschil is precies wat hier staat.
      </p>
    </Figure>
  );
}
