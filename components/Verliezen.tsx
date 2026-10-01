"use client";

/**
 * Hoe efficiënt een thuisbatterij werkelijk is.
 *
 * Eén verlies: het omzettingsverlies, wat er bij laden en ontladen verdwijnt.
 * Schaalt mee met hoeveel je opslaat, en is wat "rendement heen en terug" op
 * een datasheet betekent.
 *
 * Het stand-byverbruik staat als aparte regel in de tabel. Het is geen
 * omzettingsverlies: het loopt door als de batterij niet laadt of ontlaadt, en
 * het zit NIET in de besparing verwerkt maar wordt ervan afgetrokken (zie
 * `standbyKosten` in lib/model/analysis.ts). Het staat dus niet in de balk van
 * de omzetting en niet in "Samen verloren", dat het omzettingsverlies telt.
 */

import type { ReactNode } from "react";
import type { EnergyLosses } from "../lib/model/analysis";
import { euro, euroPrecies, getal, kwh, procent, standbyKengetallen } from "../lib/format";
import { Figure, Legenda, TipLaag, useTip } from "./chart-parts";

const GELEVERD = "var(--series-3)";
const OMZETTING = "var(--series-4)";
/** Het stand-byverbruik: een eigen kleur, want het hoort niet bij de omzetting. */
const STANDBY = "var(--series-5)";
/** Het verlies bij het ontladen: dezelfde amber, met een streeppatroon erover. */
const OMZETTING_ONTLADEN =
  "repeating-linear-gradient(135deg, rgba(255,255,255,0.65) 0 2px, transparent 2px 5px), var(--series-4)";

export function Verliezen({
  losses,
  standbyKwh,
  standbyEur,
  standbyWatt,
  afnameKwh,
  besparingEur,
  actie,
}: {
  losses: EnergyLosses;
  /**
   * Het stand-byverbruik per jaar, kWh en EUR (positief is een kostenpost), en
   * het vermogen waarmee gerekend is. Al van de besparing afgetrokken.
   */
  standbyKwh: number;
  standbyEur: number;
  standbyWatt: number;
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
      anker="verliezen"
      actie={actie}
      titel={titel}
      toelichting={
        <>
          Stroom opslaan kost stroom: bij het laden en bij het ontladen gaat een
          deel verloren in de omzetting. Gemiddeld per jaar over de volledige
          jaren in de gekozen periode. Het stand-byverbruik van de batterij ({standbyKengetallen(standbyWatt, standbyKwh, standbyEur)})
          staat apart in de tabel: dat is al van de besparing afgetrokken.
        </>
      }
    >
      <div className="chart-hover" ref={kader} onMouseLeave={wis}>
        {/* ── 1. De omzetting ─────────────────────────────────────────────── */}
        <section className="efficientie-blok">
          <div className="efficientie-kop">
            <h4>De omzetting</h4>
            <p>
              Wat er van je stroom overblijft na het opslaan. Het omzettingsverlies
              schaalt mee met hoeveel je opslaat.
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
                  { kleur: OMZETTING_ONTLADEN, label: "Verlies bij het ontladen", waarde: kwh(dischargeLossKwh) },
                  { label: "In de batterij gestopt", waarde: kwh(chargedKwh), uitkomst: true },
                ],
                noot: `Van wat erin gaat, komt ${procent(roundtrip, 1)} er weer uit.`,
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
              style={{ width: deelVanLading(dischargeLossKwh), background: OMZETTING_ONTLADEN }}
            />
          </div>
          <Legenda
            items={[
              { kleur: GELEVERD, label: "geleverd aan het huis" },
              { kleur: OMZETTING, label: "verlies bij het laden" },
              { kleur: OMZETTING_ONTLADEN, label: "verlies bij het ontladen" },
            ]}
          />

          <p className="efficientie-zin">
            Je stopte er <strong>{kwh(chargedKwh)}</strong> in en kreeg{" "}
            <strong>{kwh(deliveredKwh)}</strong> terug. De omzetting kostte{" "}
            {kwh(omzetting)}, oftewel {euro(omzettingEur)}
            {restInCel > 1
              ? `; ${kwh(restInCel)} zat aan het eind van het jaar nog in de batterij`
              : ""}
            .
          </p>
        </section>

        <TipLaag tip={tip} />
      </div>

      {/* ── Samen ──────────────────────────────────────────────────────────── */}
      <dl className="kerncijfers">
        <div>
          <dt>Deel dat terugkomt</dt>
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
                bespaard
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
            <td>{euroPrecies(losses.chargeLossEur)}</td>
          </tr>
          <tr>
            <th scope="row">
              <span className="post-vlak" style={{ background: OMZETTING_ONTLADEN }} />
              <span>Verlies bij het ontladen</span>
            </th>
            <td>{kwh(dischargeLossKwh)}</td>
            <td>{euroPrecies(losses.dischargeLossEur)}</td>
          </tr>
          <tr>
            <th scope="row">
              <span className="post-vlak" style={{ background: STANDBY }} />
              <span>Stand-byverbruik</span>
            </th>
            <td>{kwh(standbyKwh)}</td>
            <td>{euroPrecies(standbyEur)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Samen kwijt</th>
            <td>{kwh(totalKwh + standbyKwh)}</td>
            <td>{euroPrecies(losses.totalEur + standbyEur)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="posten-noot">
        De twee verliezen bij het laden en ontladen zijn geen extra kostenpost
        bovenop de besparing hierboven: ze zitten er al in verwerkt. Je haalt
        minder van het net dan je in de batterij stopte, en dat verschil is
        precies wat daar staat. Het stand-byverbruik zit er niet in verwerkt:
        dat is een eigen post, die van de besparing is afgetrokken. Het telt
        alleen op de momenten dat de batterij niet laadt of ontlaadt; tijdens het
        laden en ontladen zit het eigen verbruik al in het rendement.
      </p>
    </Figure>
  );
}
