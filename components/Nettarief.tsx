"use client";

/**
 * Wat het tijdsafhankelijke nettarief met de businesscase doet.
 *
 * Vanaf 1 januari 2029 gaat een groot deel van de netkosten afhangen van
 * wannéér je stroom gebruikt. Dat raakt een thuisbatterij harder dan wat ook:
 * de winteravond wordt duur op precies de uren waarop een accu kan leveren, en
 * de zomermiddag wordt gratis op precies de uren waarop hij kan laden.
 *
 * Deze sectie rekent dezelfde periode nog een keer door met dat tarief erbij,
 * zodat de vergelijking op dezelfde data en dezelfde batterij rust. Dat kost een
 * tweede volledige doorrekening van enkele seconden, dus hij start op verzoek —
 * net als het raster van batterijmaten.
 *
 * Het is nadrukkelijk een scenario. De structuur staat vast, de bedragen niet:
 * het voorstel toont alleen relatieve niveaus. Wat hier staat is een prognose
 * van CE Delft voor 2030, en dat staat er ook bij.
 */

import type { ReactNode } from "react";
import type { AnalysisResult } from "../lib/model/analysis";
import {
  BASISTARIEF,
  NETTARIEF_BRON,
  NETTARIEF_INGANG,
  NETTARIEF_JAAR,
  scenarioHeffing,
} from "../lib/nettarief";
import { centPerKwh, euro, getal, jaren, procent } from "../lib/format";
import { Figure } from "./chart-parts";
import { piekAandeel } from "./Statistieken";
import { Tariefblad } from "./Tariefblad";

export function Nettarief({
  huidig,
  scenario,
  actie,
}: {
  huidig: AnalysisResult;
  /** Null zolang het scenario nog wordt doorgerekend in de achtergrond. */
  scenario: AnalysisResult | null;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
}) {
  const verschil = scenario
    ? scenario.averageSavingEur - huidig.averageSavingEur
    : 0;
  const relatief =
    scenario && huidig.averageSavingEur !== 0
      ? verschil / huidig.averageSavingEur
      : 0;

  return (
    <Figure
      actie={actie}
      titel={
        scenario
          ? verschil > 0
            ? "Met het nieuwe nettarief wordt een thuisbatterij fors waardevoller"
            : "Met het nieuwe nettarief verandert er weinig aan de businesscase"
          : "Wat doet het nieuwe nettarief met de businesscase?"
      }
      toelichting={
        <>
          Vandaag betaal je je netkosten als een vast bedrag per jaar: je
          doorlaatwaarde maal een tarief, hoeveel je ook gebruikt en wanneer ook.
          Vanaf {NETTARIEF_INGANG} gaat dat om. Twee derde van het
          transporttarief wordt dan <b>per kilowattuur</b> in rekening gebracht,
          en die prijs hangt af van <b>het moment</b>: de winteravond wordt duur,
          de zomermiddag gratis. Precies de uren waarop een batterij levert en
          laadt.
        </>
      }
    >
      {/* Het tarievenblad zelf, want zonder dat is elk bedrag hieronder een
          black box. Winter en zomer als twee aparte panelen, met de nul van
          vandaag als nulpunt van de as. */}
      <Tariefblad markeerPiek />

      {scenario ? (
        <dl className="kerncijfers">
          <div>
            <dt>Besparing nu</dt>
            <dd>{euro(huidig.averageSavingEur)}</dd>
          </div>
          <div>
            <dt>Besparing met het nieuwe nettarief</dt>
            <dd className={verschil > 0 ? "goed" : undefined}>
              {euro(scenario.averageSavingEur)}
              <span className="dd-noot">
                {verschil > 0 ? "+" : ""}
                {euro(verschil)} per jaar, {procent(relatief, 0)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Terugverdientijd</dt>
            <dd>
              {jaren(scenario.finance.paybackYears)}
              <span className="dd-noot">
                nu {jaren(huidig.finance.paybackYears)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Laadbeurten per jaar</dt>
            <dd>
              {getal(scenario.stats.cyclesPerYear, 0)}
              <span className="dd-noot">
                nu {getal(huidig.stats.cyclesPerYear, 0)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Afname in de piekuren</dt>
            <dd>
              {procent(
                piekAandeel(
                  scenario.stats.peakHourImportBatteryKwh,
                  scenario.stats.gridImportBatteryKwh,
                ),
              )}
              <span className="dd-noot">
                nu{" "}
                {procent(
                  piekAandeel(huidig.stats.peakHourImportBatteryKwh, huidig.stats.gridImportBatteryKwh),
                )}
                , zonder batterij{" "}
                {procent(
                  piekAandeel(huidig.stats.peakHourImportBaselineKwh, huidig.stats.gridImportBaselineKwh),
                )}
              </span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="scenario-wacht">
          Dezelfde periode wordt nog een keer doorgerekend, nu met dit tarief
          erbij…
        </p>
      )}

      <details className="voetnoot-uitklap">
        <summary>Hoe hard is dit scenario?</summary>
        <p>
          De structuur staat in het codewijzigingsvoorstel dat de netbeheerders
          op 1 mei 2026 bij de ACM indienden: vijf tijdsblokken, vijf
          tariefhoogten en hoogstens vier per dag, twee seizoenen, en de
          wegingsfactoren per uur. De ACM besluit naar verwachting voor eind
          2026; invoering is in beginsel {NETTARIEF_INGANG}, met uitwijk naar
          2030. Het tarief geldt alleen voor wat je van het net haalt: op
          teruglevering staat geen heffing, en deze doorrekening rekent er dus
          ook geen.
        </p>
        <p>
          De tool rekent met {NETTARIEF_JAAR}, de beoogde invoeringsdatum. De
          energiebelasting van dat jaar hoort erbij en gaat mee:{" "}
          {centPerKwh(scenarioHeffing(NETTARIEF_JAAR))} inclusief opslag, tegen
          12,9 ct nu. Anders zou een nettarief van straks op een belasting van
          toen worden gestapeld, en de besparing schaalt daar bijna
          één-op-één mee.
        </p>
        <p>
          Het basistarief staat er niet in. Wat hier staat is {NETTARIEF_BRON},
          geijkt op een huishouden van 3.000 kWh per jaar; het hoogste blok komt
          daarmee op {centPerKwh(BASISTARIEF[NETTARIEF_JAAR])} uit. Het vaste deel — een
          capaciteitscomponent van een derde van het transporttarief plus
          aansluitvergoeding en meetdienst, samen ruim € 300 per jaar — valt
          buiten deze berekening: dat is met en zonder batterij gelijk. De
          prognose is gedragsonafhankelijk, en het voorstel herijkt blokken en
          factoren jaarlijks.
        </p>
      </details>

    </Figure>
  );
}
