"use client";

/**
 * De kerncijfers in één oogopslag.
 *
 * Elk cijfer staat met zijn verandering erbij: een zelfconsumptie van 71%
 * zegt weinig, "van 42% naar 71%" zegt alles. Dat verschil is immers wat de
 * batterij doet.
 *
 * Zelfconsumptie en autarkie vragen het bruto verbruik en de bruto opwek, en
 * die staan niet op je jaarafrekening — daar staat alleen wat er door de meter
 * ging. Ze verschijnen daarom pas als je de jaaropwek van je panelen invult.
 */

import type { KeyStats } from "../lib/model/analysis";
import { getal, kwh, procent } from "../lib/format";

function Tegel({
  label,
  waarde,
  van,
  naar,
  uitleg,
}: {
  label: string;
  waarde?: string;
  /** Bij een verandering: de waarde zonder en met batterij. */
  van?: string;
  naar?: string;
  uitleg: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
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
      <p className="stat-uitleg">{uitleg}</p>
    </div>
  );
}

export function Statistieken({
  stats,
  opwekBekend,
}: {
  stats: KeyStats;
  opwekBekend: boolean;
}) {
  const importReductie =
    stats.gridImportBaselineKwh > 0
      ? 1 - stats.gridImportBatteryKwh / stats.gridImportBaselineKwh
      : 0;
  const exportReductie =
    stats.gridExportBaselineKwh > 0
      ? 1 - stats.gridExportBatteryKwh / stats.gridExportBaselineKwh
      : 0;

  return (
    <section className="statistieken">
      <h3>De cijfers op een rij</h3>
      <p className="statistieken-uitleg">
        Gemiddeld per jaar, over de volledige jaren in de gekozen periode.
      </p>

      <div className="stat-grid">
        {stats.selfConsumptionBaseline !== null &&
        stats.selfConsumptionBattery !== null ? (
          <Tegel
            label="Zelfconsumptie"
            van={procent(stats.selfConsumptionBaseline)}
            naar={procent(stats.selfConsumptionBattery)}
            uitleg="Welk deel van wat je panelen opwekken, je ook zelf gebruikt."
          />
        ) : null}

        {stats.selfSufficiencyBaseline !== null &&
        stats.selfSufficiencyBattery !== null ? (
          <Tegel
            label="Autarkie"
            van={procent(stats.selfSufficiencyBaseline)}
            naar={procent(stats.selfSufficiencyBattery)}
            uitleg="Welk deel van je verbruik je zelf dekt, zonder het net."
          />
        ) : null}

        <Tegel
          label="Van het net"
          van={kwh(stats.gridImportBaselineKwh)}
          naar={kwh(stats.gridImportBatteryKwh)}
          uitleg={`Je haalt ${procent(importReductie)} minder van het net.`}
        />

        <Tegel
          label="Naar het net"
          van={kwh(stats.gridExportBaselineKwh)}
          naar={kwh(stats.gridExportBatteryKwh)}
          uitleg={`Je levert ${procent(exportReductie)} minder terug, en gebruikt dat zelf.`}
        />

        <Tegel
          label="Cycli"
          waarde={`${getal(stats.cyclesPerDay, 2)} per dag`}
          uitleg={`${Math.round(stats.cyclesPerYear)} volledige laadbeurten per jaar. Meer cycli betekent meer opbrengst, maar ook snellere slijtage.`}
        />

        <Tegel
          label="Door de batterij"
          waarde={kwh(stats.throughputPerYearKwh)}
          uitleg="Wat de batterij per jaar aan je huis levert."
        />
      </div>

      {!opwekBekend ? (
        <p className="statistieken-noot">
          Vul bij de instellingen in hoeveel je panelen per jaar opwekken, dan
          komen daar zelfconsumptie en autarkie bij. Die zijn niet uit je
          meterstanden af te leiden: daar staat alleen wat er door de meter ging,
          niet wat je direct zelf verbruikte.
        </p>
      ) : null}
    </section>
  );
}
