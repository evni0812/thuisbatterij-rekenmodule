/** Berichten tussen de UI en de rekenworker. */

import type { AnalysisResult } from "../model/analysis";
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
  analysisYears: number;
  priceEscalation: number;
  discountRate: number;
  calendarFadePerYear: number;
  residualValueEur: number;
  /**
   * Neem de energiebelasting over uit de brondata van elk jaar in plaats van de
   * ingestelde waarde. Zo rekent de tool standaard met de tarieven zoals ze
   * werkelijk golden.
   */
  useHistoricalLevy: boolean;
}

export type WorkerRequest =
  | { type: "init"; baseUrl: string }
  | { type: "analyse"; id: number; config: Configuration };

export type WorkerResponse =
  | { type: "ready"; manifest: unknown }
  | { type: "result"; id: number; result: AnalysisResult; elapsedMs: number }
  | { type: "error"; id: number | null; message: string };
