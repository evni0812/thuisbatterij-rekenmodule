/** Berichten tussen de UI en de rekenworker. */

import type { AnalysisResult, SampleDay } from "../model/analysis";
import type { PeriodeReeks, Resolutie } from "../model/periode";
import type { Afnametype } from "../data/manifest";
import type { NettariefJaar } from "../nettarief";
import type { BatterySpec, HouseholdSpec, TariffSpec } from "../model/types";

/** Alles wat de gebruiker instelt, in één object. */
export interface Configuration {
  /** EAN van het netgebied. */
  domain: string;
  /** Eerste en laatste kalenderdag van het venster (YYYY-MM-DD). */
  from: string;
  to: string;
  household: HouseholdSpec;
  /**
   * Welk gemeten profiel: AMI (met zonnepanelen, standaard) of AZI (zonder).
   * Optioneel en standaard afwezig, zodat de hash van een gewone doorrekening
   * niet verandert.
   */
  afnametype?: Afnametype;
  battery: BatterySpec;
  tariff: TariffSpec;
  investmentEur: number;
  cycleLife: number;
  /**
   * Kalenderlevensduur van de batterij in jaren, uit de catalogus. Stuurt de
   * dispatch niet; staat ter duiding in de uitleg bij de laadbeurten.
   */
  calendarLifeYears: number;
  analysisYears: number;
  priceEscalation: number;
  discountRate: number;
  calendarFadePerYear: number;
  /**
   * Deel van de volle slijtageprijs dat de planner per geleverde kWh rekent,
   * 0–1; standaard 1. Zie lib/strategie.ts.
   */
  wearFraction?: number;
  residualValueEur: number;
  /** Bruto jaaropwek van de panelen, voor zelfconsumptie en autarkie. */
  annualProductionKwh?: number;
  /**
   * Neem de energiebelasting over uit de brondata van elk jaar in plaats van de
   * ingestelde waarde. Zo rekent de tool standaard met de tarieven zoals ze
   * werkelijk golden.
   */
  useHistoricalLevy: boolean;
  /**
   * Reken met het tijdsafhankelijke nettarief dat vanaf 2029 gaat gelden.
   *
   * Optioneel en standaard afwezig: zo verandert de configuratiehash van een
   * gewone doorrekening niet, en blijft het vooruitgerekende standaardantwoord
   * bruikbaar. Alleen het scenario zet hem aan.
   */
  netTariff?: boolean;
  /**
   * Heft het nettarief ook op teruglevering. Het voorstel sluit dat expliciet
   * uit — alleen afname wordt beprijsd — dus dit is een wat-als.
   */
  netTariffOnExport?: boolean;
  /** Voor welk jaar het basistarief van het nettarief geldt; standaard 2029. */
  netTariffYear?: NettariefJaar;
  /**
   * Vaste heffing (energiebelasting plus inkoopopslag, incl. btw) per kWh die
   * de heffing uit de data vervangt. Het nettariefscenario zet hier de heffing
   * van 2029 of 2030, zodat een nettarief van dan niet op een belasting van
   * toen wordt gestapeld.
   */
  levyEurPerKwh?: number;
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
  | {
      /**
       * Reken hetzelfde nog eens door met een afwijkende configuratie, zonder de
       * hoofddoorrekening te verstoren. Gebruikt voor het nettariefscenario.
       */
      type: "scenario";
      id: number;
      config: Configuration;
    }
  | {
      /**
       * Het resultaat over een periode, opgeteld per uur, dag of week. Net als
       * de dag komt dit uit de bewaarde jaardispatch; de configuratie gaat mee
       * voor het geval die er (na een cachetreffer) nog niet is.
       */
      type: "periode";
      id: number;
      config: Configuration;
      /** Eerste en laatste kalenderdag, inclusief. */
      van: string;
      tot: string;
      resolutie: Resolutie;
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
  | { type: "scenario"; id: number; result: AnalysisResult }
  | { type: "periode"; id: number; periode: PeriodeReeks }
  | { type: "error"; id: number | null; message: string };
