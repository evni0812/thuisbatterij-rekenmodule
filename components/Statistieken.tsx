"use client";

/**
 * De kerncijfers in één oogopslag, als tegels met een gekleurde bovenrand.
 *
 * Elk cijfer staat met zijn verandering erbij: een zelfconsumptie van 71%
 * zegt weinig, "van 42% naar 71%" zegt alles. Dat verschil is immers wat de
 * batterij doet. Elke tegel heeft zijn eigen "Hoe is dit berekend?" met de
 * getallen van deze doorrekening.
 *
 * Zelfconsumptie en autarkie vragen het bruto verbruik en de bruto opwek, en
 * die staan niet op je jaarafrekening — daar staat alleen wat er door de meter
 * ging. Ze verschijnen daarom pas als je de jaaropwek van je panelen invult.
 */

import type { ReactNode } from "react";
import type { KeyStats } from "../lib/model/analysis";
import { centPerKwh, euro, getal, kwh, procent } from "../lib/format";
import { DIRECT_EIGEN_VERBRUIK_ZONDER_BATTERIJ } from "../lib/presets";
import { UITLEG, type UitlegContext, type UitlegId } from "../lib/uitleg";
import { Uitleg } from "./Uitleg";

/**
 * Welk deel van de netafname in de piekuren van het nettarief valt.
 *
 * De tegenhanger van zelfconsumptie: die zegt welk deel van je opwek je zelf
 * gebruikt, dit zegt welk deel van wat je afneemt op de duurste netuurtjes
 * valt. Beide als aandeel, zodat een klein en een groot huishouden hetzelfde
 * getal kunnen vergelijken.
 */
export function piekAandeel(piekKwh: number, afnameKwh: number): number {
  return afnameKwh > 0 ? Math.min(1, piekKwh / afnameKwh) : 0;
}

/**
 * Het verschil tussen twee percentages, in procentpunten.
 *
 * Bewust niet als percentage van een percentage: van 26% naar 35% is negen
 * procentpunt, niet "35% meer". Dat tweede getal klopt rekenkundig en zegt
 * niets.
 *
 * `van` en `naar` zijn fracties (0,34), geen procenten (34): deze functie
 * schaalt zelf. Wie er procenten in stopt krijgt honderd keer te veel — en
 * "−573 procentpunt" ziet er net genoeg uit als een getal om niet op te vallen.
 */
export function procentpunt(van: number, naar: number): string {
  const d = (naar - van) * 100;
  const teken = d > 0 ? "+" : d < 0 ? "−" : "";
  return `${teken}${getal(Math.abs(d), Math.abs(d) < 10 ? 1 : 0)} procentpunt`;
}

export function Tegel({
  label,
  waarde,
  van,
  naar,
  delta,
  deltaGoed,
  uitleg,
  extra,
  accent,
  knop,
}: {
  label: string;
  waarde?: string;
  /** Bij een verandering: de waarde zonder en met batterij. */
  van?: string;
  naar?: string;
  /** Hoeveel er veranderde, in de eenheid die bij het cijfer past. */
  delta?: string;
  /** Is die verandering een verbetering? Bepaalt de kleur van het chipje. */
  deltaGoed?: boolean;
  uitleg: string;
  /** Een derde stand, bijvoorbeeld onder het nettariefscenario. */
  extra?: ReactNode;
  /** Kleur van de bovenrand: de reeks waar dit cijfer bij hoort. */
  accent: string;
  /** De "Hoe is dit berekend?"-knop. */
  knop?: ReactNode;
}) {
  return (
    <div className="stat" style={{ "--tegel-accent": accent } as React.CSSProperties}>
      <div className="stat-kop">
        <div className="stat-label">{label}</div>
        {knop}
      </div>
      {van !== undefined && naar !== undefined ? (
        <div className="stat-verloop">
          <span className="stat-van">{van}</span>
          <span className="stat-pijl" aria-label="wordt">
            →
          </span>
          <span className="stat-naar">{naar}</span>
        </div>
      ) : (
        <div className="stat-waarde">{waarde}</div>
      )}
      {delta ? (
        <div className={deltaGoed ? "stat-delta goed" : "stat-delta"}>{delta}</div>
      ) : null}
      {extra ? <div className="stat-extra">{extra}</div> : null}
      <p className="stat-uitleg">{uitleg}</p>
    </div>
  );
}

export function Statistieken({
  stats,
  scenarioStats = null,
  opwekBekend,
  geschatteOpwek,
  context = null,
}: {
  stats: KeyStats;
  /**
   * De kerncijfers onder het nettarief van 2029, zodra dat scenario is
   * doorgerekend. Alleen de piekuren gebruiken ze: dat is het cijfer dat door
   * het nieuwe tarief wezenlijk verandert.
   */
  scenarioStats?: KeyStats | null;
  opwekBekend: boolean;
  /** De jaaropwek waarmee is gerekend; alleen nodig als hij geschat is. */
  geschatteOpwek: number;
  /** Voor de "Hoe is dit berekend?"-knoppen; zonder context geen knoppen. */
  context?: UitlegContext | null;
}) {
  const importReductie =
    stats.gridImportBaselineKwh > 0
      ? 1 - stats.gridImportBatteryKwh / stats.gridImportBaselineKwh
      : 0;
  const exportReductie =
    stats.gridExportBaselineKwh > 0
      ? 1 - stats.gridExportBatteryKwh / stats.gridExportBaselineKwh
      : 0;
  const piekBasis = piekAandeel(stats.peakHourImportBaselineKwh, stats.gridImportBaselineKwh);
  const piekBatterij = piekAandeel(stats.peakHourImportBatteryKwh, stats.gridImportBatteryKwh);
  const piekScenario = scenarioStats
    ? piekAandeel(scenarioStats.peakHourImportBatteryKwh, scenarioStats.gridImportBatteryKwh)
    : null;
  const piekMinderKwh = stats.peakHourImportBaselineKwh - stats.peakHourImportBatteryKwh;

  const knop = (id: UitlegId) =>
    context ? <Uitleg blok={UITLEG[id](context)} variant="icoon" /> : null;

  return (
    <section className="statistieken">
      <h3>De cijfers op een rij</h3>
      <p className="statistieken-uitleg">
        Gemiddeld per jaar, over de volledige jaren in de gekozen periode.
      </p>

      <div className="stat-grid">
        {/* Eerst de drie percentages: die zeggen iets los van hoe groot je
            huishouden is, en ze zijn waar een batterij over gaat. De
            kilowatturen erachter geven ze hun schaal. */}
        {stats.selfConsumptionBaseline !== null &&
        stats.selfConsumptionBattery !== null ? (
          <Tegel
            label="Eigen verbruik"
            van={procent(stats.selfConsumptionBaseline)}
            naar={procent(stats.selfConsumptionBattery)}
            delta={procentpunt(stats.selfConsumptionBaseline, stats.selfConsumptionBattery)}
            deltaGoed={stats.selfConsumptionBattery > stats.selfConsumptionBaseline}
            uitleg={`Welk deel van wat je panelen opwekken, je ook zelf gebruikt.${
              opwekBekend ? "" : " Op basis van een geschatte jaaropwek — zie hieronder."
            }`}
            accent="var(--series-5)"
            knop={knop("zelfconsumptie")}
          />
        ) : null}

        {stats.selfSufficiencyBaseline !== null &&
        stats.selfSufficiencyBattery !== null ? (
          <Tegel
            label="Onafhankelijk van het net"
            van={procent(stats.selfSufficiencyBaseline)}
            naar={procent(stats.selfSufficiencyBattery)}
            delta={procentpunt(stats.selfSufficiencyBaseline, stats.selfSufficiencyBattery)}
            deltaGoed={stats.selfSufficiencyBattery > stats.selfSufficiencyBaseline}
            uitleg={`Welk deel van je verbruik je zelf dekt, zonder het net.${
              opwekBekend ? "" : " Op basis van een geschatte jaaropwek — zie hieronder."
            }`}
            accent="var(--series-5)"
            knop={knop("autarkie")}
          />
        ) : null}

        <Tegel
          label="Afname in de piekuren"
          van={procent(piekBasis)}
          naar={procent(piekBatterij)}
          delta={procentpunt(piekBasis, piekBatterij)}
          deltaGoed={piekBatterij < piekBasis}
          extra={
            piekScenario !== null ? (
              <>
                Met het nettarief van 2029: <strong>{procent(piekScenario)}</strong>
              </>
            ) : null
          }
          uitleg={`Welk deel van wat je van het net haalt op de piekuren van het voorgestelde nettarief valt: in de winter 16.00–23.00 uur, in de zomer 19.00–24.00 uur. De batterij haalt er ${kwh(piekMinderKwh)} per jaar uit.`}
          accent="var(--ac)"
          knop={knop("piekuren")}
        />

        <Tegel
          label="Van het net"
          van={kwh(stats.gridImportBaselineKwh)}
          naar={kwh(stats.gridImportBatteryKwh)}
          delta={`${procent(importReductie)} minder`}
          deltaGoed={importReductie > 0}
          uitleg="Wat je in een jaar van het net haalt, zonder en met batterij."
          accent="var(--series-1)"
          knop={knop("vanHetNet")}
        />

        <Tegel
          label="Naar het net"
          van={kwh(stats.gridExportBaselineKwh)}
          naar={kwh(stats.gridExportBatteryKwh)}
          delta={`${procent(exportReductie)} minder`}
          deltaGoed={exportReductie > 0}
          uitleg="Wat je teruglevert, zonder en met batterij. Wat eraf gaat, gaat de batterij in. Stroom die de omvormer bij een negatieve prijs afregelt, telt hier niet mee en geldt ook niet als eigen verbruik."
          accent="var(--series-2)"
          knop={knop("naarHetNet")}
        />

        <Tegel
          label="Laadbeurten"
          waarde={`${getal(stats.cyclesPerDay, 2)} per dag`}
          uitleg={`${Math.round(stats.cyclesPerYear)} volledige beurten per jaar. Meer beurten kan meer opleveren, maar kost ook slijtage.`}
          accent="var(--series-3)"
          knop={knop("laadbeurten")}
        />

        <Tegel
          label="Door de batterij"
          waarde={kwh(stats.throughputPerYearKwh)}
          uitleg="Wat de batterij per jaar aan je huis levert."
          accent="var(--series-3)"
          knop={knop("doorzet")}
        />

        <Tegel
          label="Slijtage"
          waarde={`${euro(stats.wearCostPerYearEur)} per jaar`}
          uitleg={`Wat de laadbeurten van de aanschafprijs opsouperen: ${centPerKwh(stats.wearCostEurPerKwh)} geleverd. Zit al in de aanschaf en is niet van de besparing afgetrokken.`}
          accent="var(--series-4)"
          knop={knop("slijtage")}
        />
      </div>

      {!opwekBekend ? (
        <p className="statistieken-noot">
          <b>Eigen verbruik en onafhankelijkheid rusten op een schatting.</b> Ze
          vragen je bruto jaaropwek, en die staat niet op je jaarafrekening: daar
          staat alleen wat er door de meter ging, niet wat je direct zelf
          verbruikte. We gaan uit van{" "}
          {procent(DIRECT_EIGEN_VERBRUIK_ZONDER_BATTERIJ)} direct eigen verbruik
          zonder batterij, de gangbare vuistregel, en komen daarmee op{" "}
          {kwh(geschatteOpwek)} per jaar. Vul{" "}
          <a href="#instellingen">bij de geavanceerde instellingen</a> je echte
          jaaropwek in, dan rekenen deze twee met jouw getal.
        </p>
      ) : null}
    </section>
  );
}
