"use client";

/**
 * React-hook om de rekenworkers aan te sturen.
 *
 * Twee workers, uit hetzelfde bestand:
 *
 *   hoofdworker        de analyse en de dagkiezer
 *   achtergrondworker  het nettariefscenario en het raster van batterijmaten
 *
 * ── Waarom twee ─────────────────────────────────────────────────────────────
 * Scenario en raster draaien nu automatisch, zonder knop. Samen kosten ze een
 * seconde of vijfentwintig. In één worker zou de dagkiezer al die tijd dood
 * zijn: de worker is bezet. Met een tweede worker blijft de hoofdworker vrij en
 * reageert de dagkiezer direct, terwijl de achtergrond doorrekent. Beide laden
 * dezelfde assets; dat is twee keer zestien megabyte in het geheugen, en dat
 * mag.
 *
 * Elke aanvraag krijgt een volgnummer zodat een laat antwoord op een inmiddels
 * achterhaalde configuratie genegeerd kan worden. Zonder die controle zou snel
 * schuiven met een regelaar de resultaten door elkaar kunnen gooien.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { configSleutel, leesCache, schrijfCache } from "./cache";
import type { AnalysisResult } from "./model/analysis";
import type { Manifest } from "./data/manifest";
import type { SampleDay } from "./model/analysis";
import { RASTER_CAPACITEITEN, RASTER_VERMOGENS } from "./model/raster";
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
  /** Het raster van maten; null zolang het nog loopt of nog niet is gestart. */
  grid: GridState | null;
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
  wisDag: () => void;
  /** Uitkomst van het nettariefscenario, of null zolang het nog loopt. */
  scenario: AnalysisResult | null;
  /** Of het scenario ook op teruglevering heft. */
  scenarioOpTeruglevering: boolean;
  /** Reken het scenario opnieuw met of zonder heffing op teruglevering. */
  zetScenarioOpTeruglevering: (opTeruglevering: boolean) => void;
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
 * iedereen hetzelfde, dus het staat nu als bestand klaar — inclusief het
 * scenario en het raster, die anders nog eens vijfentwintig seconden zouden
 * kosten.
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
  scenario?: AnalysisResult;
  grid?: GridPoint[][];
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

function maakWorker(): Worker {
  return new Worker(new URL("./worker/sim.worker.ts", import.meta.url), {
    type: "module",
  });
}

function volRaster(rows: GridPoint[][]): GridState {
  return {
    rows,
    capacities: RASTER_CAPACITEITEN,
    powers: RASTER_VERMOGENS,
    klaar: true,
    bezig: false,
  };
}

type InterneState = Omit<
  AnalysisState,
  "vraagDag" | "wisDag" | "herbereken" | "zetScenarioOpTeruglevering"
>;

export function useAnalysis(config: Configuration | null): AnalysisState {
  const hoofdRef = useRef<Worker | null>(null);
  const achtergrondRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const pendingId = useRef<number | null>(null);

  const [state, setState] = useState<InterneState>({
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
    scenarioOpTeruglevering: false,
  });
  /** De configuratie waar het getoonde resultaat bij hoort. */
  const getoondVoor = useRef<string | null>(null);
  /** De configuratie van de lopende of laatst verstuurde aanvraag. */
  const laatsteConfig = useRef<Configuration | null>(null);
  const gridId = useRef(0);
  const dagId = useRef(0);
  const scenarioId = useRef(0);
  const opTerugleveringRef = useRef(false);

  /**
   * Start scenario en raster in de achtergrondworker voor een configuratie,
   * behalve wat er al is. Het scenario gaat eerst: het staat in de kop en kost
   * vier seconden, het raster twintig.
   */
  const startAchtergrond = useCallback(
    (cfg: Configuration, al: { scenario?: AnalysisResult; grid?: GridPoint[][] }) => {
      const worker = achtergrondRef.current;
      if (!worker) return;
      if (al.scenario) {
        setState((s) => ({ ...s, scenario: al.scenario! }));
      } else {
        const id = ++scenarioId.current;
        worker.postMessage({
          type: "scenario",
          id,
          config: {
            ...cfg,
            netTariff: true,
            netTariffOnExport: opTerugleveringRef.current,
          },
        } satisfies WorkerRequest);
      }
      if (al.grid) {
        setState((s) => ({ ...s, grid: volRaster(al.grid!) }));
      } else {
        const id = ++gridId.current;
        setState((s) => ({
          ...s,
          grid: {
            rows: RASTER_CAPACITEITEN.map(() => null),
            capacities: RASTER_CAPACITEITEN,
            powers: RASTER_VERMOGENS,
            klaar: false,
            bezig: true,
          },
        }));
        worker.postMessage({
          type: "grid",
          id,
          config: cfg,
          capacities: RASTER_CAPACITEITEN,
          powers: RASTER_VERMOGENS,
        } satisfies WorkerRequest);
      }
    },
    [],
  );

  useEffect(() => {
    const hoofd = maakWorker();
    const achtergrond = maakWorker();
    hoofdRef.current = hoofd;
    achtergrondRef.current = achtergrond;

    hoofd.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "ready") {
        setState((s) => ({ ...s, manifest: msg.manifest as Manifest }));
        return;
      }
      if (msg.type === "result") {
        // Een antwoord op een achterhaalde aanvraag negeren we: anders zou een
        // trage berekening een nieuwere overschrijven.
        if (msg.id !== pendingId.current) return;
        const cfg = laatsteConfig.current;
        setState((s) => ({
          ...s,
          result: msg.result,
          busy: false,
          error: null,
          elapsedMs: msg.elapsedMs,
          getoondeConfig: cfg,
          uitCache: false,
          verouderd: false,
        }));
        if (cfg) {
          schrijfCache(cfg, { result: msg.result });
          getoondVoor.current = JSON.stringify(cfg);
          startAchtergrond(cfg, {});
        }
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

    achtergrond.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "scenario") {
        if (msg.id !== scenarioId.current) return;
        setState((s) => ({ ...s, scenario: msg.result }));
        const cfg = laatsteConfig.current;
        if (cfg) {
          schrijfCache(cfg, {
            result: state.result ?? msg.result,
            scenario: msg.result,
            scenarioOpTeruglevering: opTerugleveringRef.current,
          });
        }
        return;
      }
      if (msg.type === "grid-row") {
        if (msg.id !== gridId.current) return;
        setState((s) => {
          if (!s.grid) return s;
          const rows = [...s.grid.rows];
          rows[msg.row] = msg.points;
          const grid = { ...s.grid, rows, klaar: msg.done, bezig: !msg.done };
          if (msg.done && laatsteConfig.current && rows.every((r) => r !== null)) {
            schrijfCache(laatsteConfig.current, {
              result: s.result!,
              grid: rows as GridPoint[][],
            });
          }
          return { ...s, grid };
        });
        return;
      }
      if (msg.type === "error") {
        // Een fout in de achtergrond mag het hoofdantwoord niet raken; het
        // scenario en het raster blijven dan leeg en de pagina zegt dat.
        setState((s) => ({ ...s, grid: s.grid ? { ...s.grid, bezig: false } : null }));
      }
    };

    const stuk = (event: ErrorEvent) => {
      setState((s) => ({
        ...s,
        busy: false,
        error: event.message || "de rekenmodule kon niet starten",
      }));
    };
    hoofd.onerror = stuk;
    achtergrond.onerror = stuk;

    const init: WorkerRequest = { type: "init", baseUrl: "/data" };
    hoofd.postMessage(init);
    achtergrond.postMessage(init);

    // Meteen naast de workers starten. Het bestand is klein en de kans is groot
    // dat we het nodig hebben; zo staat het klaar tegen de tijd dat de
    // configuratie bekend is, in plaats van er dan pas op te wachten.
    void haalVoorbeeld();

    return () => {
      hoofd.terminate();
      achtergrond.terminate();
      hoofdRef.current = null;
      achtergrondRef.current = null;
    };
    // state.result in de scenario-handler is een momentopname; de cache wordt
    // daar alleen aangevuld, nooit als enige bron gelezen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAchtergrond]);

  const send = useCallback((cfg: Configuration) => {
    const worker = hoofdRef.current;
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

  const vraagDag = useCallback(
    (datum: string) => {
      const worker = hoofdRef.current;
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

  const zetScenarioOpTeruglevering = useCallback((opTeruglevering: boolean) => {
    opTerugleveringRef.current = opTeruglevering;
    const worker = achtergrondRef.current;
    const cfg = laatsteConfig.current;
    setState((s) => ({ ...s, scenarioOpTeruglevering: opTeruglevering, scenario: null }));
    if (!worker || !cfg) return;
    const id = ++scenarioId.current;
    worker.postMessage({
      type: "scenario",
      id,
      config: { ...cfg, netTariff: true, netTariffOnExport: opTeruglevering },
    } satisfies WorkerRequest);
  }, []);

  // Een wijziging in de invoer maakt raster, scenario en een opgehaalde dag
  // achterhaald: die hoorden bij de vorige doorrekening. Lopend achtergrondwerk
  // wordt afgebroken; de volgnummers gaan omhoog zodat een laat antwoord niet
  // alsnog binnenvalt.
  useEffect(() => {
    dagId.current++;
    gridId.current++;
    scenarioId.current++;
    setState((s) =>
      s.grid || s.dag || s.dagBezig || s.scenario
        ? { ...s, grid: null, dag: null, dagBezig: false, dagOntbreekt: null, scenario: null }
        : s,
    );
    const achtergrond = achtergrondRef.current;
    if (achtergrond) achtergrond.postMessage({ type: "cancel" } satisfies WorkerRequest);
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
        result: bewaard.result,
        busy: false,
        error: null,
        getoondeConfig: config,
        uitCache: true,
        verouderd: false,
      }));
      // Wat er bewaard is, tonen we; wat ontbreekt, rekent de achtergrond bij.
      const scenarioPast =
        bewaard.scenario !== undefined &&
        (bewaard.scenarioOpTeruglevering ?? false) === opTerugleveringRef.current;
      startAchtergrond(config, {
        scenario: scenarioPast ? bewaard.scenario : undefined,
        grid: bewaard.grid,
      });
      return;
    }

    // Nog niet eerder uitgerekend: de eerste keer doen we het meteen, daarna
    // markeren we het resultaat als verouderd en wacht de tool op een opdracht.
    if (state.result === null) {
      let levend = true;
      const timer = setTimeout(async () => {
        // Eerst het antwoord dat bij de build is uitgerekend. Past het bij deze
        // configuratie, dan is er niets te rekenen en staat het er meteen —
        // inclusief scenario en raster, als de build die heeft meegeleverd.
        const vooruit = await haalVoorbeeld();
        if (!levend) return;
        if (vooruit && vooruit.sleutel === configSleutel(config)) {
          getoondVoor.current = sleutel;
          laatsteConfig.current = config;
          schrijfCache(config, {
            result: vooruit.result,
            scenario: vooruit.scenario,
            scenarioOpTeruglevering: false,
            grid: vooruit.grid,
          });
          setState((s) => ({
            ...s,
            result: vooruit.result,
            busy: false,
            error: null,
            getoondeConfig: config,
            uitCache: true,
            verouderd: false,
          }));
          startAchtergrond(config, {
            scenario: opTerugleveringRef.current ? undefined : vooruit.scenario,
            grid: vooruit.grid,
          });
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
  }, [JSON.stringify(config), state.manifest, state.result, send, startAchtergrond]);

  return { ...state, vraagDag, wisDag, herbereken, zetScenarioOpTeruglevering };
}
