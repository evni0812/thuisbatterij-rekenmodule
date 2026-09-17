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
import type { AnalysisResult, ScenarioResult } from "../lib/model/analysis";
import type { Overgang } from "../lib/overgang";
import {
  BASISTARIEF,
  NETTARIEF_BRON,
  NETTARIEF_INGANG,
  NETTARIEF_JAAR,
  scenarioHeffing,
} from "../lib/nettarief";
import { centPerKwh, euro, getal, jaren, procent } from "../lib/format";
import { Figure } from "./chart-parts";
import { Tegel, piekAandeel, procentpunt } from "./Statistieken";
import { Tariefblad } from "./Tariefblad";

/** Het verschil tussen twee terugverdientijden, kort opgeschreven. */
function korter(van: number | null, naar: number | null): string | undefined {
  if (van === null || naar === null) return undefined;
  const d = van - naar;
  if (Math.abs(d) < 1 / 24) return "even lang";
  const maanden = Math.round(Math.abs(d) * 12);
  const woord =
    maanden < 12
      ? `${maanden} ${maanden === 1 ? "maand" : "maanden"}`
      : jaren(Math.abs(d));
  return `${woord} ${d > 0 ? "korter" : "langer"}`;
}

export function Nettarief({
  huidig,
  scenario,
  overgang,
  actie,
}: {
  huidig: AnalysisResult;
  /** Null zolang het scenario nog wordt doorgerekend in de achtergrond. */
  scenario: ScenarioResult | null;
  /** De terugverdientijd mét de tariefwissel van 2029 erin. */
  overgang: Overgang | null;
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
        /*
         * Dezelfde plaat als het overzicht bovenaan, en om dezelfde reden: waar
         * het om gaat is de verándering, niet de eindstand. Deze cijfers stonden
         * als losse kerncijfers met de oude waarde weggestopt in een voetnoot —
         * "448", eronder klein "nu 361" — zodat je zelf moest uitrekenen wat het
         * nettarief doet. Van → naar zet dat verschil in de hoofdregel.
         */
        <div className="stat-grid">
          <Tegel
            label="Besparing per jaar"
            van={euro(huidig.averageSavingEur)}
            naar={euro(scenario.averageSavingEur)}
            delta={`${verschil > 0 ? "+" : ""}${euro(verschil)} · ${procent(relatief, 0)}`}
            deltaGoed={verschil > 0}
            accent="var(--series-3)"
            uitleg={`Dezelfde jaren en dezelfde batterij, nog een keer doorgerekend met het tarief van ${NETTARIEF_JAAR} erbij.`}
          />
          <Tegel
            label="Terugverdientijd"
            van={jaren(huidig.finance.paybackYears)}
            naar={jaren((overgang ?? scenario).finance.paybackYears)}
            delta={korter(huidig.finance.paybackYears, (overgang ?? scenario).finance.paybackYears)}
            deltaGoed={
              huidig.finance.paybackYears !== null &&
              (overgang ?? scenario).finance.paybackYears !== null &&
              (overgang ?? scenario).finance.paybackYears! < huidig.finance.paybackYears!
            }
            accent="var(--ac)"
            uitleg={
              overgang && overgang.jarenOpHuidigTarief > 0
                ? `Koop je nu, dan draai je eerst ${overgang.jarenOpHuidigTarief} jaar op het tarief van vandaag en daarna op dat van ${overgang.ingangsjaar}. Links staat wat het zou worden als er niets verandert.`
                : "Links wat het zou worden als het tarief niet verandert, rechts met het nieuwe tarief."
            }
          />
          <Tegel
            label="Laadbeurten per jaar"
            van={getal(huidig.stats.cyclesPerYear, 0)}
            naar={getal(scenario.stats.cyclesPerYear, 0)}
            delta={`${scenario.stats.cyclesPerYear > huidig.stats.cyclesPerYear ? "+" : ""}${getal(scenario.stats.cyclesPerYear - huidig.stats.cyclesPerYear, 0)}`}
            accent="var(--series-1)"
            uitleg="Grotere prijsverschillen over de dag geven de batterij meer momenten waarop laden en leveren loont. Meer beurten is ook meer slijtage."
          />
          <Tegel
            label="Afname in de piekuren"
            van={procent(piekAandeel(huidig.stats.peakHourImportBatteryKwh, huidig.stats.gridImportBatteryKwh))}
            naar={procent(piekAandeel(scenario.stats.peakHourImportBatteryKwh, scenario.stats.gridImportBatteryKwh))}
            delta={procentpunt(piekAandeel(huidig.stats.peakHourImportBatteryKwh, huidig.stats.gridImportBatteryKwh), piekAandeel(scenario.stats.peakHourImportBatteryKwh, scenario.stats.gridImportBatteryKwh))}
            deltaGoed={piekAandeel(scenario.stats.peakHourImportBatteryKwh, scenario.stats.gridImportBatteryKwh) < piekAandeel(huidig.stats.peakHourImportBatteryKwh, huidig.stats.gridImportBatteryKwh)}
            extra={`zonder batterij ${procent(piekAandeel(huidig.stats.peakHourImportBaselineKwh, huidig.stats.gridImportBaselineKwh))}`}
            accent="var(--series-2)"
            uitleg="Het deel van je stroom dat je haalt op de uren waarop het net het drukst is — precies wat het nieuwe tarief wil afremmen."
          />
        </div>
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
