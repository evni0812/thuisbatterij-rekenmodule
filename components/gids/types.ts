/**
 * Het contract tussen de pagina en de begeleide stappen.
 *
 * De stappen rekenen niets zelf: ze lezen dezelfde doorrekening als de zeven
 * tabbladen (één `useAnalysis` in app/page.tsx) en schrijven dezelfde
 * instellingen. Zo staat er in de stappen nooit een ander getal dan in "Alle
 * cijfers", en hoeft een uitkomst maar op één plek te kloppen.
 */

import type { ReactNode } from "react";
import type { Manifest } from "../../lib/data/manifest";
import type { AnalysisResult, ScenarioResult } from "../../lib/model/analysis";
import type { BatteryPreset } from "../../lib/presets";
import type { Overgang } from "../../lib/overgang";
import type { GridState, HuishoudensState } from "../../lib/useAnalysis";
import type { Instellingen } from "../../lib/url-state";
import type { UITLEG } from "../../lib/uitleg";
import type { Configuration } from "../../lib/worker/protocol";
import type { TabId } from "../Tabs";

/** De vijf stappen, in volgorde. Het nummer in de URL is de index plus één. */
export const STAPPEN = [
  { id: "huis", naam: "Jouw huis" },
  { id: "batterij", naam: "Jouw batterij" },
  { id: "dag", naam: "Wat hij doet" },
  { id: "opbrengst", naam: "Wat het oplevert" },
  { id: "past", naam: "Past het bij je?" },
] as const;

export type StapId = (typeof STAPPEN)[number]["id"];

export interface GidsData {
  /** De live invoer, en een manier om er iets in te veranderen. */
  inst: Instellingen;
  zetInst: (patch: Partial<Instellingen>) => void;

  manifest: Manifest | null;
  /** De batterij van de invoer, met capaciteit, vermogen en prijs zoals gerekend. */
  preset: BatteryPreset;
  capaciteitKwh: number;
  vermogenKw: number;
  prijsEur: number;

  /**
   * De doorrekening en de configuratie die er precies bij hoort. Toon naast een
   * uitkomst altijd `toon`, nooit `inst`: de invoer kan al verder zijn dan het
   * antwoord.
   */
  result: AnalysisResult | null;
  toon: Configuration | null;
  /** Hetzelfde huishouden onder het nettarief van 2029, zodra dat klaar is. */
  scenario: ScenarioResult | null;
  /** Terugverdienen met eerst het huidige nettarief en daarna dat van 2029. */
  overgang: Overgang | null;
  /** Het nettarief-scenario is mislukt: dan komt `overgang` niet meer. */
  scenarioFout: string | null;
  /** Andere maten (raster) en andere huishoudens; alleen op de laatste stap. */
  grid: GridState | null;
  huishoudens: HuishoudensState | null;
  /** Rekende het getoonde antwoord met zonnepanelen? */
  toonZonnepanelen: boolean;
  /** "2024 en 2025": de jaren waarop de bedragen rusten. */
  bedragJarenTekst: string;

  bezig: boolean;
  /** De invoer is veranderd sinds het getoonde antwoord. */
  verouderd: boolean;
  herbereken: () => void;

  /** De knop "Hoe is dit berekend?" van een figuur, met de getallen van nu. */
  uitleg: (id: keyof typeof UITLEG) => ReactNode | undefined;
  /** Naar "Alle cijfers", op een tabblad en eventueel een figuur. */
  naarVerdieping: (tab: TabId, anker?: string) => void;
  /** Naar de volgende stap. */
  volgende: () => void;
}
