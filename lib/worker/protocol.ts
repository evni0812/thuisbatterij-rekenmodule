/** Berichten tussen de UI en de rekenworker. */

import type { AnalysisResult, SampleDay } from "../model/analysis";
import type { BatterySpec, HouseholdSpec, TariffSpec } from "../model/types";

/** Alles wat de gebruiker instelt, in één object. */
export interface Configuration {
  /** EAN van het netgebied. */
  domain: string;
  /** Eerste en laatste kalenderdag van het venster (YYYY-MM-DD). */
  from: string;
  to: string;
  household: HouseholdSpec;
  battery: BatterySpec;
  tariff: TariffSpec;
  investmentEur: number;
  cycleLife: number;
  /**
   * Kalenderlevensduur van de batterij in jaren; bepaalt samen met cycleLife of
   * laadbeurten schaars zijn. Los van analysisYears, want dat is een keuze van
   * de gebruiker over de doorrekening en geen eigenschap van de accu.
   */
  calendarLifeYears: number;
  analysisYears: number;
  priceEscalation: number;
  discountRate: number;
  calendarFadePerYear: number;
  residualValueEur: number;
  /** Bruto jaaropwek van de panelen, voor zelfconsumptie en autarkie. */
  annualProductionKwh?: number;
  /**
   * Neem de energiebelasting over uit de brondata van elk jaar in plaats van de
   * ingestelde waarde. Zo rekent de tool standaard met de tarieven zoals ze
   * werkelijk golden.
   */
  useHistoricalLevy: boolean;
}

/** Eén doorgerekende combinatie van capaciteit en vermogen. */
export interface GridPoint {
  capacityKwh: number;
  powerKw: number;
  savingEur: number;
  cyclesPerYear: number;
}

export type WorkerRequest =
  | { type: "init"; baseUrl: string }
  | { type: "analyse"; id: number; config: Configuration }
  | {
      /**
       * Reken een raster van batterijmaten door. Dit kost tientallen
       * doorrekeningen, dus het wordt apart en op verzoek gestart, en de
       * resultaten komen rij voor rij binnen zodat de kaart zichtbaar vult.
       */
      type: "grid";
      id: number;
      config: Configuration;
      capacities: number[];
      powers: number[];
    }
  | {
      /**
       * Haal het batterijgedrag van één kalenderdag op.
       *
       * De configuratie gaat mee omdat de worker niet mag aannemen dat hij die
       * analyse zelf heeft gedraaid: een resultaat kan ook uit de browsercache
       * komen. Zonder de configuratie kon de worker dan geen enkele dag
       * leveren.
       */
      type: "day";
      id: number;
      date: string;
      config: Configuration;
    }
  | { type: "cancel" };

export type WorkerResponse =
  | { type: "ready"; manifest: unknown }
  | { type: "result"; id: number; result: AnalysisResult; elapsedMs: number }
  | {
      type: "grid-row";
      id: number;
      /** Index in `capacities`. */
      row: number;
      points: GridPoint[];
      done: boolean;
    }
  | { type: "day"; id: number; day: SampleDay | null; date: string }
  | { type: "error"; id: number | null; message: string };
