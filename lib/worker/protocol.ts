/** Berichten tussen de UI en de rekenworker. */

import type {
  AnalysisResult,
  CurveMeting,
  SampleDay,
  ScenarioResult,
  VensterUitkomst,
} from "../model/analysis";
import type { HuishoudenPunt, HuishoudenVariant } from "../model/huishoudens";
import type { PeriodeReeks, Resolutie } from "../model/periode";

import type { Afnametype } from "../data/manifest";
import type { NettariefJaar } from "../nettarief";
import type { BatterySpec, Doel, HouseholdSpec, TariffSpec } from "../model/types";

/**
 * Wie de periode opvroeg.
 *
 * Er zijn er twee: het verloop telt op per dag of week, het dagprofiel toont
 * een week per uur. Ze vragen tegelijk en met verschillende resoluties, dus
 * zonder dit label overschrijft het ene antwoord het andere — en annuleert de
 * laatste aanvraag de vorige, omdat de worker per soort één volgnummer bijhoudt.
 */
export type PeriodeKanaal = "verloop" | "week";

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
  /**
   * De kostenregel voor andere maten dan de gekozen batterij (lib/model/kosten.ts):
   * meerprijs per kWh, per kW en de installateur boven 0,8 kW. Afleiding, geen
   * dispatch: het raster rekent er niet mee, alleen de financiën per maat.
   * Optioneel met de standaard als terugval, zodat een bestaande configuratie
   * blijft werken.
   */
  kostenPerKwhEur?: number;
  kostenPerKwEur?: number;
  installatieEur?: number;
  /**
   * Drempel voor het Nederlandse CO2-perspectief, g/kWh: onder deze
   * emissiefactor telt teruglevering als overschot (lib/model/co2.ts).
   * Afleiding: de balans bewaart afname en teruglevering per klasse, dus de
   * drempel is achteraf toe te passen.
   */
  co2DrempelG?: number;
  /**
   * Waar de planner op stuurt (lib/model/doel.ts). Afwezig is "rendement",
   * zodat de hash van een gewone doorrekening niet verandert. Dispatch: een
   * ander doel is een andere batterij.
   */
  doel?: Doel;
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
      /**
       * Welke rijen (indices in `capacities`) deze worker doet; zonder dit
       * alle rijen. De pool verdeelt de rijen over de workers.
       */
      rijen?: number[];
    }
  | {
      /**
       * Reken de gekozen batterij door voor een reeks huishoudens (Voor wie).
       * Eén jaarsimulatie per variant; de pool verdeelt de indices over de
       * helpers zoals de rasterrijen.
       */
      type: "huishoudens";
      id: number;
      config: Configuration;
      varianten: HuishoudenVariant[];
      /** Welke varianten (indices in `varianten`) deze worker doet. */
      indices: number[];
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
      kanaal: PeriodeKanaal;
    }
  | {
      /**
       * Eén venster van de doorrekening, als taak voor de pool. De worker bouwt
       * alleen dat venster op (`bouwInvoer` met `alleenVenster`) en stuurt de
       * uitkomst inclusief de dispatch-arrays terug, zodat de hoofdworker ze
       * later voor de dagkiezer kan gebruiken.
       */
      type: "venster";
      id: number;
      groep: number;
      config: Configuration;
      jaarIndex: number;
      metOptimum: boolean;
    }
  | {
      /** Eén meetpunt van de besparingscurve op het referentiejaar. */
      type: "quick";
      id: number;
      groep: number;
      config: Configuration;
      jaarIndex: number;
      fraction: number;
    }
  | {
      /** De besparing met perfecte verbruiksvoorspelling op het referentiejaar. */
      type: "perfect";
      id: number;
      groep: number;
      config: Configuration;
      jaarIndex: number;
    }
  | {
      /**
       * Voeg de vensters samen tot het volledige resultaat; alleen voor de
       * hoofdworker, die daarna de dispatches bewaart voor de dagkiezer.
       */
      type: "voegSamen";
      id: number;
      groep: number;
      config: Configuration;
      uitkomsten: VensterUitkomst[];
      metingen: CurveMeting[];
      perfect: number | null;
    }
  | {
      /** Idem voor het scenario: zonder optimum, voorbeelddagen en gat. */
      type: "voegSamenScenario";
      id: number;
      groep: number;
      config: Configuration;
      uitkomsten: VensterUitkomst[];
      metingen: CurveMeting[];
    }
  | {
      /**
       * Warm de hoofdworker op na een treffer in cache of preload: bouw de
       * invoer en reken de jaardispatches alvast, zodat de eerste dag, week of
       * periode niet eerst anderhalve seconde hoeft te wachten. Geen antwoord;
       * een nieuwere configuratie of `cancel` breekt hem af.
       */
      type: "warm";
      id: number;
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
      /** De laatste rij die déze worker doet; of het raster vol is, weet de pool. */
      done: boolean;
    }
  | {
      type: "huishouden-punt";
      id: number;
      /** Index in `varianten`. */
      index: number;
      /** Null als de variant niet doorrekenbaar was; de rest gaat door. */
      punt: HuishoudenPunt | null;
      /** De laatste variant die déze worker doet. */
      done: boolean;
    }
  | { type: "day"; id: number; day: SampleDay | null; date: string }
  | { type: "scenario"; id: number; result: ScenarioResult }
  | { type: "periode"; id: number; kanaal: PeriodeKanaal; periode: PeriodeReeks }
  | { type: "venster-uitkomst"; id: number; groep: number; jaarIndex: number; uitkomst: VensterUitkomst }
  | { type: "quick"; id: number; groep: number; meting: CurveMeting }
  | { type: "perfect"; id: number; groep: number; besparing: number }
  /** Een pooltaak is afgerond (ook na een fout of annulering); de worker is vrij. */
  | { type: "klaar"; id: number }
  | { type: "error"; id: number | null; message: string };
