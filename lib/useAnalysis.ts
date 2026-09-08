"use client";

/**
 * React-hook om de rekenworker aan te sturen.
 *
 * De worker wordt één keer opgestart en hergebruikt; elke aanvraag krijgt een
 * volgnummer zodat een laat antwoord op een inmiddels achterhaalde configuratie
 * genegeerd kan worden. Zonder die controle zou snel schuiven met een regelaar
 * de resultaten door elkaar kunnen gooien.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { configSleutel, leesCache, schrijfCache } from "./cache";
import type { AnalysisResult } from "./model/analysis";
import type { Manifest } from "./data/manifest";
import type { SampleDay } from "./model/analysis";
import type {
  Configuration,
  GridPoint,
  WorkerRequest,
  WorkerResponse,
} from "./worker/protocol";

export interface GridState {
  /** Rijen zoals ze binnenkomen; ontbrekende rijen zijn nog niet berekend. */
  rows: (GridPoint[] | null)[];
  capacities: number[];
  powers: number[];
  klaar: boolean;
  bezig: boolean;
}

export interface AnalysisState {
  manifest: Manifest | null;
  result: AnalysisResult | null;
  /** Er loopt een berekening; toon het vorige resultaat gedimd in plaats van leeg. */
  busy: boolean;
  error: string | null;
  elapsedMs: number | null;
  /**
   * De configuratie die bij het GETOONDE resultaat hoort.
   *
   * Presentatiecomponenten moeten hieruit lezen, niet uit de live invoer. Anders
   * komt een verse batterijprijs naast een oude terugverdientijd te staan, in
   * dezelfde zin — en dat is geen verouderd antwoord meer maar een verzonnen
   * antwoord.
   */
  getoondeConfig: Configuration | null;
  /** Het getoonde resultaat komt uit een eerdere doorrekening. */
  uitCache: boolean;
  /** De invoer is gewijzigd sinds het getoonde resultaat. */
  verouderd: boolean;
  /** Reken opnieuw door, ook als er een bewaard resultaat is. */
  herbereken: () => void;
  grid: GridState | null;
  /** Start de rasterberekening; kost enkele seconden. */
  startGrid: (capacities: number[], powers: number[]) => void;
  /** Een opgevraagde losse dag, of null zolang er geen is opgehaald. */
  dag: SampleDay | null;
  /**
   * Er wordt een dag opgehaald. Bij een resultaat uit de cache moet de worker
   * dat jaar eerst doorrekenen, en dat duurt een halve seconde.
   */
  dagBezig: boolean;
  /** De datum waarvoor geen gegevens bleken te zijn. */
  dagOntbreekt: string | null;
  /** Vraag het batterijgedrag van één kalenderdag op. */
  vraagDag: (datum: string) => void;
  /** Uitkomst van het nettariefscenario, of null zolang het niet gedraaid is. */
  scenario: AnalysisResult | null;
  scenarioBezig: boolean;
  /** Reken dezelfde periode nog eens door mét het tijdsafhankelijke nettarief. */
  startScenario: (opTeruglevering: boolean) => void;
  wisDag: () => void;
}

/**
 * Wachttijd voordat een wijziging een herberekening start.
 *
 * Alleen van toepassing op wijzigingen die direct doorrekenen; de zware
 * instellingen wachten op een expliciete opdracht.
 */
const DEBOUNCE_MS = 180;

/**
 * Het standaardantwoord dat bij de build is uitgerekend.
 *
 * Wie de tool opent zonder iets in te stellen, zag eerst vier seconden een leeg
 * scherm terwijl de worker vier profieljaren doorrekende. Dat antwoord is voor
 * iedereen hetzelfde, dus het staat nu als bestand klaar: 12 kB over de lijn in
 * plaats van vier seconden rekenen.
 *
 * De sleutel bepaalt of het bruikbaar is. Hij bevat zowel het modelversienummer
 * als een hash van de configuratie, dus een bezoeker met een afwijkende invoer
 * of een oud bestand valt vanzelf terug op zelf rekenen.
 */
interface Vooruitgerekend {
  versie: number;
  sleutel: string;
  gemaakt: string;
  result: AnalysisResult;
}

let voorbeeldBelofte: Promise<Vooruitgerekend | null> | null = null;

function haalVoorbeeld(): Promise<Vooruitgerekend | null> {
  if (voorbeeldBelofte) return voorbeeldBelofte;
  voorbeeldBelofte = fetch("/voorbeeld.json")
    .then((r) => (r.ok ? (r.json() as Promise<Vooruitgerekend>) : null))
    // Ontbreekt het bestand of is het stuk, dan rekent de tool gewoon zelf.
    // Een preload die faalt mag nooit meer kosten dan de tijd die hij bespaart.
    .catch(() => null);
  return voorbeeldBelofte;
}

export function useAnalysis(config: Configuration | null): AnalysisState {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const pendingId = useRef<number | null>(null);

  const [state, setState] = useState<
    Omit<
      AnalysisState,
      "startGrid" | "vraagDag" | "wisDag" | "herbereken" | "startScenario"
    >
  >({
    manifest: null,
    result: null,
    busy: false,
    error: null,
    elapsedMs: null,
    getoondeConfig: null,
    uitCache: false,
    verouderd: false,
    grid: null,
    dag: null,
    dagBezig: false,
    dagOntbreekt: null,
    scenario: null,
    scenarioBezig: false,
  });
  /** De configuratie waar het getoonde resultaat bij hoort. */
  const getoondVoor = useRef<string | null>(null);
  const gridId = useRef(0);
  const dagId = useRef(0);
  const scenarioId = useRef(0);

  useEffect(() => {
    const worker = new Worker(
      new URL("./worker/sim.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "ready") {
        setState((s) => ({ ...s, manifest: msg.manifest as Manifest }));
        return;
      }
      if (msg.type === "result") {
        // Een antwoord op een achterhaalde aanvraag negeren we: anders zou een
        // trage berekening een nieuwere overschrijven.
        if (msg.id !== pendingId.current) return;
        setState((s) => ({
          ...s,
          result: msg.result,
          busy: false,
          error: null,
          elapsedMs: msg.elapsedMs,
          getoondeConfig: laatsteConfig.current,
          uitCache: false,
          verouderd: false,
        }));
        if (laatsteConfig.current) {
          schrijfCache(laatsteConfig.current, msg.result);
          getoondVoor.current = JSON.stringify(laatsteConfig.current);
        }
        return;
      }
      if (msg.type === "grid-row") {
        if (msg.id !== gridId.current) return;
        setState((s) => {
          if (!s.grid) return s;
          const rows = [...s.grid.rows];
          rows[msg.row] = msg.points;
          return {
            ...s,
            grid: { ...s.grid, rows, klaar: msg.done, bezig: !msg.done },
          };
        });
        return;
      }
      if (msg.type === "scenario") {
        if (msg.id !== scenarioId.current) return;
        setState((s) => ({ ...s, scenario: msg.result, scenarioBezig: false }));
        return;
      }
      if (msg.type === "day") {
        if (msg.id !== dagId.current) return;
        setState((s) => ({
          ...s,
          dag: msg.day,
          dagBezig: false,
          dagOntbreekt: msg.day === null ? msg.date : null,
        }));
        return;
      }
      if (msg.type === "error") {
        if (msg.id !== null && msg.id !== pendingId.current) return;
        setState((s) => ({ ...s, busy: false, dagBezig: false, error: msg.message }));
      }
    };

    worker.onerror = (event) => {
      setState((s) => ({
        ...s,
        busy: false,
        error: event.message || "de rekenmodule kon niet starten",
      }));
    };

    const init: WorkerRequest = { type: "init", baseUrl: "/data" };
    worker.postMessage(init);

    // Meteen naast de worker starten. Het bestand is klein en de kans is groot
    // dat we het nodig hebben; zo staat het klaar tegen de tijd dat de
    // configuratie bekend is, in plaats van er dan pas op te wachten.
    void haalVoorbeeld();

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  /** De configuratie van de lopende of laatst verstuurde aanvraag. */
  const laatsteConfig = useRef<Configuration | null>(null);

  const send = useCallback((cfg: Configuration) => {
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++nextId.current;
    pendingId.current = id;
    laatsteConfig.current = cfg;
    setState((s) => ({ ...s, busy: true }));
    const msg: WorkerRequest = { type: "analyse", id, config: cfg };
    worker.postMessage(msg);
  }, []);

  const herbereken = useCallback(() => {
    if (config) send(config);
  }, [config, send]);

  const startGrid = useCallback(
    (capacities: number[], powers: number[]) => {
      const worker = workerRef.current;
      if (!worker || !config) return;
      const id = ++gridId.current;
      setState((s) => ({
        ...s,
        grid: {
          rows: capacities.map(() => null),
          capacities,
          powers,
          klaar: false,
          bezig: true,
        },
      }));
      const msg: WorkerRequest = { type: "grid", id, config, capacities, powers };
      worker.postMessage(msg);
    },
    [config],
  );

  const vraagDag = useCallback(
    (datum: string) => {
      const worker = workerRef.current;
      if (!worker || !config) return;
      const id = ++dagId.current;
      // De configuratie gaat mee: de worker kan de analyse niet zelf hebben
      // gedraaid als het resultaat uit de cache kwam.
      setState((s) => ({ ...s, dagBezig: true }));
      worker.postMessage({
        type: "day",
        id,
        date: datum,
        config,
      } satisfies WorkerRequest);
    },
    [config],
  );

  const wisDag = useCallback(() => {
    dagId.current++;
    setState((s) => ({ ...s, dag: null, dagBezig: false, dagOntbreekt: null }));
  }, []);

  // Een wijziging in de invoer maakt een eerder raster en een opgehaalde dag
  // achterhaald: die hoorden bij de vorige doorrekening.
  useEffect(() => {
    // Ook het volgnummer omhoog: een dag die nog onderweg is hoort bij de
    // vorige configuratie en mag niet alsnog binnenvallen.
    dagId.current++;
    setState((s) =>
      s.grid || s.dag || s.dagBezig
        ? { ...s, grid: null, dag: null, dagBezig: false, dagOntbreekt: null }
        : s,
    );
    const worker = workerRef.current;
    if (worker) worker.postMessage({ type: "cancel" } satisfies WorkerRequest);
  }, [JSON.stringify(config)]);

  useEffect(() => {
    if (!config || !state.manifest) return;
    const sleutel = JSON.stringify(config);
    if (getoondVoor.current === sleutel) return;

    // Eerst kijken of we dit al eens hebben uitgerekend. Dezelfde invoer op
    // dezelfde data geeft altijd hetzelfde antwoord — er zit geen willekeur in
    // het model — dus een bewaard resultaat is net zo geldig als een verse
    // berekening, en scheelt seconden bij elke refresh.
    const bewaard = leesCache(config);
    if (bewaard) {
      getoondVoor.current = sleutel;
      laatsteConfig.current = config;
      setState((s) => ({
        ...s,
        result: bewaard,
        busy: false,
        error: null,
        getoondeConfig: config,
        uitCache: true,
        verouderd: false,
      }));
      return;
    }

    // Nog niet eerder uitgerekend: de eerste keer doen we het meteen, daarna
    // markeren we het resultaat als verouderd en wacht de tool op een opdracht.
    if (state.result === null) {
      let levend = true;
      const timer = setTimeout(async () => {
        // Eerst het antwoord dat bij de build is uitgerekend. Past het bij deze
        // configuratie, dan is er niets te rekenen en staat het er meteen.
        const vooruit = await haalVoorbeeld();
        if (!levend) return;
        if (vooruit && vooruit.sleutel === configSleutel(config)) {
          getoondVoor.current = sleutel;
          laatsteConfig.current = config;
          // Ook bewaren, zodat een volgend bezoek het bestand niet meer hoeft
          // op te halen en een gewijzigde invoer er weer op terug kan vallen.
          schrijfCache(config, vooruit.result);
          setState((s) => ({
            ...s,
            result: vooruit.result,
            busy: false,
            error: null,
            getoondeConfig: config,
            uitCache: true,
            verouderd: false,
          }));
          return;
        }
        send(config);
      }, DEBOUNCE_MS);
      return () => {
        levend = false;
        clearTimeout(timer);
      };
    }
    setState((s) => ({ ...s, verouderd: true }));
    return;
    // De configuratie is een gewoon object; serialiseren is de eenvoudigste
    // manier om op inhoud te vergelijken in plaats van op referentie.
  }, [JSON.stringify(config), state.manifest, state.result, send]);

  const startScenario = useCallback(
    (opTeruglevering: boolean) => {
      const worker = workerRef.current;
      const config = laatsteConfig.current;
      if (!worker || !config) return;
      const id = ++scenarioId.current;
      setState((s) => ({ ...s, scenarioBezig: true }));
      worker.postMessage({
        type: "scenario",
        id,
        config: { ...config, netTariff: true, netTariffOnExport: opTeruglevering },
      } satisfies WorkerRequest);
    },
    [],
  );

  // Een nieuw hoofdresultaat maakt het scenario ongeldig: het hoort bij de
  // vorige configuratie en zou anders naast verse cijfers blijven staan.
  useEffect(() => {
    setState((s) => (s.scenario === null ? s : { ...s, scenario: null }));
  }, [JSON.stringify(config)]);

  return { ...state, startGrid, vraagDag, wisDag, herbereken, startScenario };
}
