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
  grid: GridState | null;
  /** Start de rasterberekening; kost enkele seconden. */
  startGrid: (capacities: number[], powers: number[]) => void;
  /** Een opgevraagde losse dag, of null zolang er geen is opgehaald. */
  dag: SampleDay | null;
  /** De datum waarvoor geen gegevens bleken te zijn. */
  dagOntbreekt: string | null;
  /** Vraag het batterijgedrag van één kalenderdag op. */
  vraagDag: (datum: string) => void;
  wisDag: () => void;
}

/** Wachttijd voordat een wijziging een herberekening start, in milliseconden. */
const DEBOUNCE_MS = 180;

export function useAnalysis(config: Configuration | null): AnalysisState {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const pendingId = useRef<number | null>(null);

  const [state, setState] = useState<
    Omit<AnalysisState, "startGrid" | "vraagDag" | "wisDag">
  >({
    manifest: null,
    result: null,
    busy: false,
    error: null,
    elapsedMs: null,
    grid: null,
    dag: null,
    dagOntbreekt: null,
  });
  const gridId = useRef(0);
  const dagId = useRef(0);

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
        }));
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
      if (msg.type === "day") {
        if (msg.id !== dagId.current) return;
        setState((s) => ({
          ...s,
          dag: msg.day,
          dagOntbreekt: msg.day === null ? msg.date : null,
        }));
        return;
      }
      if (msg.type === "error") {
        if (msg.id !== null && msg.id !== pendingId.current) return;
        setState((s) => ({ ...s, busy: false, error: msg.message }));
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

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const send = useCallback((cfg: Configuration) => {
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++nextId.current;
    pendingId.current = id;
    setState((s) => ({ ...s, busy: true }));
    const msg: WorkerRequest = { type: "analyse", id, config: cfg };
    worker.postMessage(msg);
  }, []);

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

  const vraagDag = useCallback((datum: string) => {
    const worker = workerRef.current;
    if (!worker) return;
    const id = ++dagId.current;
    worker.postMessage({ type: "day", id, date: datum } satisfies WorkerRequest);
  }, []);

  const wisDag = useCallback(() => {
    dagId.current++;
    setState((s) => ({ ...s, dag: null, dagOntbreekt: null }));
  }, []);

  // Een wijziging in de invoer maakt een eerder raster en een opgehaalde dag
  // achterhaald: die hoorden bij de vorige doorrekening.
  useEffect(() => {
    setState((s) =>
      s.grid || s.dag ? { ...s, grid: null, dag: null, dagOntbreekt: null } : s,
    );
    const worker = workerRef.current;
    if (worker) worker.postMessage({ type: "cancel" } satisfies WorkerRequest);
  }, [JSON.stringify(config)]);

  useEffect(() => {
    if (!config || !state.manifest) return;
    const timer = setTimeout(() => send(config), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // De configuratie is een gewoon object; serialiseren is de eenvoudigste
    // manier om op inhoud te vergelijken in plaats van op referentie.
  }, [JSON.stringify(config), state.manifest, send]);

  return { ...state, startGrid, vraagDag, wisDag };
}
