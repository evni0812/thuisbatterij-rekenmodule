/**
 * Het resultaat over een periode, per uur, per dag of per week.
 *
 * Het dagprofiel toont één dag per kwartier; dit is de stap omhoog: een week
 * per uur, een maand per dag, een jaar per week. Dezelfde dispatch, alleen
 * anders opgeteld. Per vak staat wat de batterij deed en wat het opleverde,
 * én wat het aan slijtage kostte — die laatste post zit niet in de besparing
 * (hij zit al in de aanschafprijs) maar hoort er wel naast te staan.
 *
 * Alles in wandkloktijd: een dag is een lokale kalenderdag, een week loopt van
 * maandag tot en met zondag, een uur is een lokaal uur (op de dag dat de klok
 * verspringt heeft één uur acht kwartieren of geen).
 */

import { dayBoundaries } from "./analysis";
import type { BatterySpec, DispatchResult, Window } from "./types";

export type Resolutie = "uur" | "dag" | "week";

export interface PeriodeVak {
  /** Sleutel van het vak: "2025-12-15" (dag/week: de maandag) of "2025-12-15T13" (uur). */
  sleutel: string;
  /** De kalenderdag waarin het vak valt (bij week: de maandag), voor doorklikken. */
  dag: string;
  /** Besparing: kosten zonder batterij min kosten met, EUR. */
  savingEur: number;
  /** Slijtage van de laadbeurten in dit vak, tegen de volle aanschafprijs per kWh, EUR. */
  wearCostEur: number;
  chargedKwh: number;
  deliveredKwh: number;
  gridImportBaselineKwh: number;
  gridImportBatteryKwh: number;
  gridExportBaselineKwh: number;
  gridExportBatteryKwh: number;
  /** Ongewogen gemiddelde afnameprijs in het vak, EUR/kWh. */
  avgImportPrice: number;
  /** Lading aan het einde van het vak, kWh. */
  socEndKwh: number;
  /** Aantal kwartieren in het vak; bij een uur normaal 4. */
  kwartieren: number;
}

export interface PeriodeReeks {
  resolutie: Resolutie;
  /** Eerste en laatste kalenderdag die in de reeks zitten. */
  van: string;
  tot: string;
  vakken: PeriodeVak[];
  totaal: {
    savingEur: number;
    wearCostEur: number;
    chargedKwh: number;
    deliveredKwh: number;
    gridImportBaselineKwh: number;
    gridImportBatteryKwh: number;
  };
}

/** ISO-datum van de maandag van de week waarin deze datum valt. */
export function maandagVan(isoDatum: string): string {
  const [y, m, d] = isoDatum.split("-").map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d);
  const weekdag = (new Date(utc).getUTCDay() + 6) % 7; // ma=0 … zo=6
  return new Date(utc - weekdag * 86_400_000).toISOString().slice(0, 10);
}

export function dagenLater(isoDatum: string, n: number): string {
  const [y, m, d] = isoDatum.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

function leegVak(sleutel: string, dag: string): PeriodeVak {
  return {
    sleutel,
    dag,
    savingEur: 0,
    wearCostEur: 0,
    chargedKwh: 0,
    deliveredKwh: 0,
    gridImportBaselineKwh: 0,
    gridImportBatteryKwh: 0,
    gridExportBaselineKwh: 0,
    gridExportBatteryKwh: 0,
    avgImportPrice: 0,
    socEndKwh: 0,
    kwartieren: 0,
  };
}

/**
 * Tel de dispatch op over [vanIso, totIso] (beide inclusief, lokale
 * kalenderdagen) in vakken van de gevraagde resolutie.
 *
 * Kwartieren buiten het venster worden overgeslagen; een periode die voor het
 * begin van de data begint levert gewoon minder vakken op.
 */
export function periodeReeks(
  window: Window,
  base: DispatchResult,
  dispatch: DispatchResult,
  spec: BatterySpec,
  wearEurPerKwh: number,
  vanIso: string,
  totIso: string,
  resolutie: Resolutie,
): PeriodeReeks {
  void spec;
  const { index } = dayBoundaries(window.startMs);
  const n = window.startMs.length;
  const vakken = new Map<string, PeriodeVak>();

  for (let i = 0; i < n; i++) {
    const ms = window.startMs[i]!;
    const dag = index.localDate(ms);
    if (dag < vanIso || dag > totIso) continue;

    let sleutel: string;
    let vakDag: string;
    if (resolutie === "uur") {
      sleutel = `${dag}T${String(index.localHour(ms)).padStart(2, "0")}`;
      vakDag = dag;
    } else if (resolutie === "dag") {
      sleutel = dag;
      vakDag = dag;
    } else {
      sleutel = maandagVan(dag);
      vakDag = sleutel;
    }

    let v = vakken.get(sleutel);
    if (!v) {
      v = leegVak(sleutel, vakDag);
      vakken.set(sleutel, v);
    }

    const ip = window.prices.importPrice[i]!;
    const ep = window.prices.exportPrice[i]!;
    const kostenZonder = base.gridImportKwh[i]! * ip - base.gridExportKwh[i]! * ep;
    const kostenMet = dispatch.gridImportKwh[i]! * ip - dispatch.gridExportKwh[i]! * ep;

    v.savingEur += kostenZonder - kostenMet;
    v.wearCostEur += dispatch.dischargeKwh[i]! * wearEurPerKwh;
    v.chargedKwh += dispatch.chargeKwh[i]!;
    v.deliveredKwh += dispatch.dischargeKwh[i]!;
    v.gridImportBaselineKwh += base.gridImportKwh[i]!;
    v.gridImportBatteryKwh += dispatch.gridImportKwh[i]!;
    v.gridExportBaselineKwh += base.gridExportKwh[i]!;
    v.gridExportBatteryKwh += dispatch.gridExportKwh[i]!;
    v.avgImportPrice += ip;
    v.socEndKwh = dispatch.socKwh[i]!;
    v.kwartieren += 1;
  }

  const lijst = [...vakken.values()].sort((a, b) => (a.sleutel < b.sleutel ? -1 : 1));
  for (const v of lijst) v.avgImportPrice = v.kwartieren > 0 ? v.avgImportPrice / v.kwartieren : 0;

  const totaal = lijst.reduce(
    (t, v) => ({
      savingEur: t.savingEur + v.savingEur,
      wearCostEur: t.wearCostEur + v.wearCostEur,
      chargedKwh: t.chargedKwh + v.chargedKwh,
      deliveredKwh: t.deliveredKwh + v.deliveredKwh,
      gridImportBaselineKwh: t.gridImportBaselineKwh + v.gridImportBaselineKwh,
      gridImportBatteryKwh: t.gridImportBatteryKwh + v.gridImportBatteryKwh,
    }),
    { savingEur: 0, wearCostEur: 0, chargedKwh: 0, deliveredKwh: 0, gridImportBaselineKwh: 0, gridImportBatteryKwh: 0 },
  );

  return {
    resolutie,
    van: lijst[0]?.dag ?? vanIso,
    tot: lijst.length > 0 ? (resolutie === "week" ? dagenLater(lijst[lijst.length - 1]!.dag, 6) : lijst[lijst.length - 1]!.dag) : totIso,
    vakken: lijst,
    totaal,
  };
}

/** Voeg reeksen van opeenvolgende vensters (jaren) samen tot één reeks. */
export function voegReeksenSamen(delen: PeriodeReeks[], resolutie: Resolutie, vanIso: string, totIso: string): PeriodeReeks {
  const perSleutel = new Map<string, PeriodeVak>();
  for (const deel of delen) {
    for (const v of deel.vakken) {
      const al = perSleutel.get(v.sleutel);
      if (!al) {
        perSleutel.set(v.sleutel, { ...v });
        continue;
      }
      // Een week die over een jaargrens loopt komt uit twee vensters.
      const kw = al.kwartieren + v.kwartieren;
      al.avgImportPrice = kw > 0 ? (al.avgImportPrice * al.kwartieren + v.avgImportPrice * v.kwartieren) / kw : 0;
      al.kwartieren = kw;
      al.savingEur += v.savingEur;
      al.wearCostEur += v.wearCostEur;
      al.chargedKwh += v.chargedKwh;
      al.deliveredKwh += v.deliveredKwh;
      al.gridImportBaselineKwh += v.gridImportBaselineKwh;
      al.gridImportBatteryKwh += v.gridImportBatteryKwh;
      al.gridExportBaselineKwh += v.gridExportBaselineKwh;
      al.gridExportBatteryKwh += v.gridExportBatteryKwh;
      if (v.sleutel >= al.sleutel) al.socEndKwh = v.socEndKwh;
    }
  }
  const lijst = [...perSleutel.values()].sort((a, b) => (a.sleutel < b.sleutel ? -1 : 1));
  const totaal = lijst.reduce(
    (t, v) => ({
      savingEur: t.savingEur + v.savingEur,
      wearCostEur: t.wearCostEur + v.wearCostEur,
      chargedKwh: t.chargedKwh + v.chargedKwh,
      deliveredKwh: t.deliveredKwh + v.deliveredKwh,
      gridImportBaselineKwh: t.gridImportBaselineKwh + v.gridImportBaselineKwh,
      gridImportBatteryKwh: t.gridImportBatteryKwh + v.gridImportBatteryKwh,
    }),
    { savingEur: 0, wearCostEur: 0, chargedKwh: 0, deliveredKwh: 0, gridImportBaselineKwh: 0, gridImportBatteryKwh: 0 },
  );
  return { resolutie, van: vanIso, tot: totIso, vakken: lijst, totaal };
}
