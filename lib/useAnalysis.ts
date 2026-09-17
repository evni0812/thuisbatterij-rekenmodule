"use client";

/**
 * React-hook om de rekenworkers aan te sturen.
 *
 * Een pool van workers (lib/worker/pool.ts), zoveel als de machine kernen
 * heeft min één, met een maximum van vier:
 *
 *   worker 0     de hoofdworker: voegt samen, bewaart de dispatches en
 *                beantwoordt de dagkiezer en de periodegrafiek
 *   worker 1…n   helpers: profieljaren, curvepunten en rasterrijen
 *
 * ── Waarom een pool ─────────────────────────────────────────────────────────
 * Eén doorrekening bestaat uit onafhankelijke stukken: elk profieljaar apart
 * (rolling en optimum), twee curvepunten, één run met perfecte voorspelling.
 * Achter elkaar in één worker kostte dat vier seconden; het scenario nog eens
 * vier, en het raster van tweeënveertig maten zeventien. Verdeeld over vier
 * workers wordt het kritieke pad één profieljaar plus het samenvoegen. De
 * samenvoeging (`voegSamen` in lib/model/analysis.ts) telt in de volgorde van
 * de vensters op, ongeacht welke worker het eerst klaar was, en levert
 * daardoor bit-voor-bit hetzelfde antwoord als de doorlopende `runAnalysis`.
 *
 * Elke aanvraag krijgt een volgnummer en hoort bij een groep, zodat een laat
 * antwoord op een inmiddels achterhaalde configuratie genegeerd kan worden.
 * Zonder die controle zou snel schuiven met een regelaar de resultaten door
 * elkaar kunnen gooien.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchSleutel, leesCache, schrijfCache } from "./cache";
import { vensterGrenzen } from "./data/invoer";
import type { Manifest } from "./data/manifest";
import {
  afleidingVanConfiguratie,
  curveFracties,
  pasAfleidingToe,
  referentieIndexVan,
  type AnalysisResult,
  type CurveMeting,
  type SampleDay,
  type ScenarioResult,
  type VensterUitkomst,
} from "./model/analysis";
import {
  huishoudensVarianten,
  pastBijVarianten,
  type HuishoudenPunt,
  type HuishoudenVariant,
} from "./model/huishoudens";
import type { PeriodeReeks, Resolutie } from "./model/periode";
import { RASTER_CAPACITEITEN, RASTER_VERMOGENS } from "./model/raster";
import type { DispatchResult } from "./model/types";
import {
  NETTARIEF_JAAR,
  scenarioConfiguratie,
  type NettariefJaar,
} from "./nettarief";
import { WorkerPool, poolGrootte } from "./worker/pool";
import type {
  Configuration,
  GridPoint,
  PeriodeKanaal,
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

/**
 * Hoe ver de hoofddoorrekening is, voor het wachtscherm.
 *
 * De stukken zijn de taken van de pool: elk profieljaar (rolling én optimum),
 * de curvepunten, de run met perfecte voorspelling en het samenvoegen. De
 * gewichten volgen ruwweg de rekentijd, zodat de balk gelijkmatig loopt.
 */
export interface Voortgang {
  vensters: { klaar: number; totaal: number };
  curve: { klaar: number; totaal: number };
  perfect: boolean;
  samenvoegen: boolean;
  /** 0 tot 1. */
  deel: number;
  /** Wanneer de doorrekening begon, ms sinds epoch. */
  gestart: number;
}

export function voortgangDeel(v: Omit<Voortgang, "deel">): number {
  const gewichten = { venster: 1, curve: 0.3, perfect: 0.8, samenvoegen: 0.4 };
  const totaal =
    v.vensters.totaal * gewichten.venster + v.curve.totaal * gewichten.curve + gewichten.perfect + gewichten.samenvoegen;
  const klaar =
    v.vensters.klaar * gewichten.venster +
    v.curve.klaar * gewichten.curve +
    (v.perfect ? gewichten.perfect : 0) +
    (v.samenvoegen ? gewichten.samenvoegen : 0);
  return totaal > 0 ? Math.min(1, klaar / totaal) : 0;
}

/** De gekozen batterij voor een reeks huishoudens (Voor wie). */
export interface HuishoudensState {
  varianten: HuishoudenVariant[];
  /** Per variant: het punt, null als niet doorrekenbaar, undefined als nog onderweg. */
  punten: (HuishoudenPunt | null | undefined)[];
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
  /** Hoe ver de lopende hoofddoorrekening is; null als er geen loopt. */
  voortgang: Voortgang | null;
  /** Het raster van maten; null zolang het nog loopt of nog niet is gestart. */
  grid: GridState | null;
  /** De reeks huishoudens; null zolang hij nog niet is gestart. */
  huishoudens: HuishoudensState | null;
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
  /** Het resultaat over een periode, per dag of week; null zolang er geen is. */
  periode: PeriodeReeks | null;
  periodeBezig: boolean;
  vraagPeriode: (van: string, tot: string, resolutie: Resolutie) => void;
  /**
   * Eén week, opgeteld per uur, voor het dagprofiel.
   *
   * Een eigen slot en niet hetzelfde als `periode`: het verloop vraagt op
   * hetzelfde moment een maand of jaar op. Deelden ze er één, dan zou het ene
   * antwoord het andere overschrijven en zag je bij beide figuren afwisselend
   * "wordt opgeteld…".
   */
  week: PeriodeReeks | null;
  weekBezig: boolean;
  vraagWeek: (van: string, tot: string) => void;
  /** Uitkomst van het nettariefscenario, of null zolang het nog loopt. */
  scenario: ScenarioResult | null;
  /** Of het scenario ook op teruglevering heft. */
  scenarioOpTeruglevering: boolean;
  /** Reken het scenario opnieuw met of zonder heffing op teruglevering. */
  zetScenarioOpTeruglevering: (opTeruglevering: boolean) => void;
  /** Voor welk jaar het basistarief van het scenario geldt. */
  scenarioJaar: NettariefJaar;
  zetScenarioJaar: (jaar: NettariefJaar) => void;
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
 * scenario en het raster.
 *
 * De sleutel bepaalt of het bruikbaar is. Hij bevat zowel het modelversienummer
 * als een hash van de dispatch-velden van de configuratie, dus een bezoeker met
 * een afwijkende invoer of een oud bestand valt vanzelf terug op zelf rekenen.
 * Wie alleen een financiële instelling wijzigde, krijgt het antwoord wél, met
 * de afleiding opnieuw gedaan.
 */
interface Vooruitgerekend {
  versie: number;
  sleutel: string;
  gemaakt: string;
  result: AnalysisResult;
  scenario?: ScenarioResult;
  grid?: GridPoint[][];
  huishoudens?: (HuishoudenPunt | null)[];
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

function volHuishoudens(punten: (HuishoudenPunt | null)[]): HuishoudensState {
  return { varianten: huishoudensVarianten(), punten, klaar: true, bezig: false };
}

/** De ArrayBuffers van een dispatch, om zonder kopie door te geven. */
function buffersVan(d: DispatchResult | undefined): ArrayBuffer[] {
  if (!d) return [];
  return [d.gridImportKwh, d.gridExportKwh, d.chargeKwh, d.dischargeKwh, d.socKwh, d.curtailedKwh].map(
    (a) => a.buffer as ArrayBuffer,
  );
}

/**
 * Eén doorrekening in stukken: de vensters, de curvepunten en (alleen voor de
 * hoofdanalyse) de run met perfecte voorspelling. Zodra alles binnen is gaat
 * het naar de hoofdworker om samen te voegen.
 */
interface Groep {
  soort: "analyse" | "scenario";
  nummer: number;
  /** De configuratie van de gebruiker; de sleutel van cache en state. */
  cfg: Configuration;
  /** De configuratie die de workers doorrekenen (voor het scenario een andere). */
  werkCfg: Configuration;
  uitkomsten: (VensterUitkomst | null)[];
  metingen: CurveMeting[];
  verwachtMetingen: number;
  wilPerfect: boolean;
  perfect: number | null;
  perfectBinnen: boolean;
  /** Ids van alle taken van deze groep, om fouten te kunnen toewijzen. */
  taakIds: Set<number>;
  /** Het id van de samenvoegtaak, zodra die is geplaatst. */
  samenvoegId: number | null;
  start: number;
}

type InterneState = Omit<
  AnalysisState,
  | "vraagDag"
  | "wisDag"
  | "herbereken"
  | "zetScenarioOpTeruglevering"
  | "zetScenarioJaar"
  | "vraagPeriode"
  | "vraagWeek"
>;

export function useAnalysis(config: Configuration | null): AnalysisState {
  const poolRef = useRef<WorkerPool | null>(null);
  const manifestRef = useRef<Manifest | null>(null);
  const nextId = useRef(0);

  const [state, setState] = useState<InterneState>({
    manifest: null,
    result: null,
    busy: false,
    error: null,
    elapsedMs: null,
    getoondeConfig: null,
    uitCache: false,
    verouderd: false,
    voortgang: null,
    grid: null,
    huishoudens: null,
    dag: null,
    dagBezig: false,
    dagOntbreekt: null,
    periode: null,
    periodeBezig: false,
    week: null,
    weekBezig: false,
    scenario: null,
    scenarioOpTeruglevering: false,
    scenarioJaar: NETTARIEF_JAAR,
  });
  /** De configuratie waar het getoonde resultaat bij hoort. */
  const getoondVoor = useRef<string | null>(null);
  /** De configuratie van de lopende of laatst verstuurde aanvraag. */
  const laatsteConfig = useRef<Configuration | null>(null);
  const groepTeller = useRef(0);
  const groepen = useRef(new Map<number, Groep>());
  /** De groep waarvan het antwoord nog wordt verwacht, per soort. */
  const analyseGroep = useRef<number | null>(null);
  const scenarioGroep = useRef<number | null>(null);
  /** De ids van de rastertaken die nu mogen binnenkomen. */
  const gridIds = useRef(new Set<number>());
  const gridGroep = useRef<number | null>(null);
  /** Idem voor de reeks huishoudens. */
  const huishoudensIds = useRef(new Set<number>());
  const huishoudensGroep = useRef<number | null>(null);
  const dagId = useRef(0);
  const periodeId = useRef<Record<PeriodeKanaal, number>>({ verloop: 0, week: 0 });
  const opTerugleveringRef = useRef(false);
  const jaarRef = useRef<NettariefJaar>(NETTARIEF_JAAR);

  /** De laatst gevraagde periode, zodat hij bij een nieuw resultaat opnieuw kan. */
  const periodeVraag = useRef<Record<PeriodeKanaal, { van: string; tot: string; resolutie: Resolutie } | null>>({
    verloop: null,
    week: null,
  });

  /**
   * Warm de hoofdworker op voor een resultaat dat hij niet zelf rekende (cache
   * of preload): dag, week en verloop komen dan meteen in plaats van na
   * anderhalve seconde. Zie `warmOp` in lib/worker/sim.worker.ts.
   */
  const warmOp = useCallback((cfg: Configuration) => {
    poolRef.current?.postDirect(0, { type: "warm", id: ++nextId.current, config: cfg } satisfies WorkerRequest);
  }, []);

  /**
   * Stuur de laatst gevraagde periode (opnieuw) naar de hoofdworker, voor de
   * configuratie van het getoonde resultaat. Stabiel van identiteit, zodat een
   * component er in zijn effect op mag leunen zonder bij elke wijziging in de
   * live invoer opnieuw te vuren.
   */
  const herhaalPeriode = useCallback((kanaal?: PeriodeKanaal) => {
    const pool = poolRef.current;
    const cfg = laatsteConfig.current;
    if (!pool || !cfg) return;
    // Zonder kanaal: allebei opnieuw. Dat is het geval na een nieuwe
    // doorrekening, want dan is elke openstaande reeks verouderd.
    for (const k of kanaal ? [kanaal] : (["verloop", "week"] as PeriodeKanaal[])) {
      const vraag = periodeVraag.current[k];
      if (!vraag) continue;
      const id = ++periodeId.current[k];
      setState((s) => (k === "week" ? { ...s, weekBezig: true } : { ...s, periodeBezig: true }));
      pool.postDirect(0, { type: "periode", id, kanaal: k, config: cfg, ...vraag } satisfies WorkerRequest);
    }
  }, []);

  /**
   * Plaats de stukken van een doorrekening in de pool. Het referentiejaar gaat
   * als eerste: dat is het langste stuk (rolling én optimum) en bepaalt het
   * kritieke pad.
   */
  const startGroep = useCallback((soort: Groep["soort"], cfg: Configuration, werkCfg: Configuration) => {
    const pool = poolRef.current;
    const m = manifestRef.current;
    if (!pool || !m) return;
    const grenzen = vensterGrenzen(m, werkCfg);
    if (grenzen.length === 0) {
      if (soort === "analyse") {
        setState((s) => ({
          ...s,
          busy: false,
          error: `geen profieldata voor netgebied ${werkCfg.domain} tussen ${werkCfg.from} en ${werkCfg.to}`,
        }));
      }
      return;
    }
    const ref = referentieIndexVan(grenzen);
    const nummer = ++groepTeller.current;
    const fracties = curveFracties({});
    const groep: Groep = {
      soort,
      nummer,
      cfg,
      werkCfg,
      uitkomsten: grenzen.map(() => null),
      metingen: [],
      verwachtMetingen: fracties.length,
      wilPerfect: soort === "analyse",
      perfect: null,
      perfectBinnen: false,
      taakIds: new Set(),
      samenvoegId: null,
      start: Date.now(),
    };
    groepen.current.set(nummer, groep);
    if (soort === "analyse") {
      analyseGroep.current = nummer;
      const v = {
        vensters: { klaar: 0, totaal: grenzen.length },
        curve: { klaar: 0, totaal: fracties.length },
        perfect: false,
        samenvoegen: false,
        gestart: groep.start,
      };
      setState((s) => ({ ...s, voortgang: { ...v, deel: voortgangDeel(v) } }));
    } else scenarioGroep.current = nummer;

    type Stuk =
      | { type: "venster"; config: Configuration; jaarIndex: number; metOptimum: boolean }
      | { type: "quick"; config: Configuration; jaarIndex: number; fraction: number }
      | { type: "perfect"; config: Configuration; jaarIndex: number };
    const plaats = (stuk: Stuk) => {
      const id = ++nextId.current;
      groep.taakIds.add(id);
      pool.plaats({ groep: nummer, bericht: { ...stuk, id, groep: nummer } });
    };
    const volgorde = [ref, ...grenzen.map((_, i) => i).filter((i) => i !== ref)];
    for (const jaarIndex of volgorde) {
      plaats({ type: "venster", config: werkCfg, jaarIndex, metOptimum: soort === "analyse" });
    }
    for (const fraction of fracties) {
      plaats({ type: "quick", config: werkCfg, jaarIndex: ref, fraction });
    }
    if (soort === "analyse") plaats({ type: "perfect", config: werkCfg, jaarIndex: ref });
  }, []);

  /** Zet de stand van de hoofddoorrekening in de state, voor het wachtscherm. */
  const werkVoortgangBij = useCallback((groep: Groep) => {
    const v = {
      vensters: { klaar: groep.uitkomsten.filter((u) => u !== null).length, totaal: groep.uitkomsten.length },
      curve: { klaar: Math.min(groep.metingen.length, groep.verwachtMetingen), totaal: groep.verwachtMetingen },
      perfect: groep.perfectBinnen,
      samenvoegen: groep.samenvoegId !== null,
      gestart: groep.start,
    };
    setState((s) => ({ ...s, voortgang: { ...v, deel: voortgangDeel(v) } }));
  }, []);

  /** Zijn alle stukken binnen? Dan naar de hoofdworker om samen te voegen. */
  const probeerSamenvoegen = useCallback((groep: Groep) => {
    const pool = poolRef.current;
    if (!pool || groep.samenvoegId !== null) return;
    if (groep.uitkomsten.some((u) => u === null)) return;
    if (groep.metingen.length < groep.verwachtMetingen) return;
    if (groep.wilPerfect && !groep.perfectBinnen) return;
    const id = ++nextId.current;
    groep.samenvoegId = id;
    groep.taakIds.add(id);
    if (groep.soort === "analyse") werkVoortgangBij(groep);
    const uitkomsten = groep.uitkomsten as VensterUitkomst[];
    const transfer = uitkomsten.flatMap((u) => [...buffersVan(u.realistic), ...buffersVan(u.optimal)]);
    if (groep.soort === "analyse") {
      pool.plaats({
        groep: groep.nummer,
        worker: 0,
        transfer,
        bericht: {
          type: "voegSamen",
          id,
          groep: groep.nummer,
          config: groep.werkCfg,
          uitkomsten,
          metingen: groep.metingen,
          perfect: groep.perfect,
        },
      });
    } else {
      pool.plaats({
        groep: groep.nummer,
        worker: 0,
        transfer,
        bericht: {
          type: "voegSamenScenario",
          id,
          groep: groep.nummer,
          config: groep.werkCfg,
          uitkomsten,
          metingen: groep.metingen,
        },
      });
    }
  }, []);

  /** Verdeel de rijen van het raster over de helpers (of over alles als er maar één is). */
  const startGrid = useCallback((cfg: Configuration) => {
    const pool = poolRef.current;
    if (!pool) return;
    const nummer = ++groepTeller.current;
    gridGroep.current = nummer;
    gridIds.current = new Set();
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
    // De hoofdworker blijft vrij voor de dagkiezer zolang er helpers zijn.
    const helpers = pool.aantal > 1 ? [...Array(pool.aantal - 1).keys()].map((i) => i + 1) : [0];
    const perWorker: number[][] = helpers.map(() => []);
    RASTER_CAPACITEITEN.forEach((_, r) => perWorker[r % helpers.length]!.push(r));
    helpers.forEach((worker, k) => {
      const rijen = perWorker[k]!;
      if (rijen.length === 0) return;
      const id = ++nextId.current;
      gridIds.current.add(id);
      pool.plaats({
        groep: nummer,
        worker,
        bericht: {
          type: "grid",
          id,
          config: cfg,
          capacities: RASTER_CAPACITEITEN,
          powers: RASTER_VERMOGENS,
          rijen,
        },
      });
    });
  }, []);

  /**
   * Verdeel de huishoudens over de helpers, net als de rasterrijen. Zeven
   * jaarsimulaties; ze gaan vóór het raster de rij in omdat het er zo weinig
   * zijn en de figuur direct onder de kaart staat.
   */
  const startHuishoudens = useCallback((cfg: Configuration) => {
    const pool = poolRef.current;
    if (!pool) return;
    const nummer = ++groepTeller.current;
    huishoudensGroep.current = nummer;
    huishoudensIds.current = new Set();
    const varianten = huishoudensVarianten();
    setState((s) => ({
      ...s,
      huishoudens: { varianten, punten: varianten.map(() => undefined), klaar: false, bezig: true },
    }));
    const helpers = pool.aantal > 1 ? [...Array(pool.aantal - 1).keys()].map((i) => i + 1) : [0];
    const perWorker: number[][] = helpers.map(() => []);
    varianten.forEach((_, i) => perWorker[i % helpers.length]!.push(i));
    helpers.forEach((worker, k) => {
      const indices = perWorker[k]!;
      if (indices.length === 0) return;
      const id = ++nextId.current;
      huishoudensIds.current.add(id);
      pool.plaats({
        groep: nummer,
        worker,
        bericht: { type: "huishoudens", id, config: cfg, varianten, indices },
      });
    });
  }, []);

  /**
   * Start scenario, huishoudens en raster voor een configuratie, behalve wat er
   * al is. Het scenario gaat eerst in de wachtrij: het staat in de kop.
   */
  const startAchtergrond = useCallback(
    (
      cfg: Configuration,
      al: { scenario?: ScenarioResult; grid?: GridPoint[][]; huishoudens?: (HuishoudenPunt | null)[] },
    ) => {
      if (al.scenario) {
        setState((s) => ({ ...s, scenario: al.scenario! }));
      } else {
        startGroep(
          "scenario",
          cfg,
          scenarioConfiguratie(cfg, {
            jaar: jaarRef.current,
            opTeruglevering: opTerugleveringRef.current,
          }),
        );
      }
      // Een bewaarde reeks telt alleen als het nog dezelfde reeks is; anders
      // zouden oude punten onder nieuwe labels komen te staan.
      if (pastBijVarianten(al.huishoudens)) {
        setState((s) => ({ ...s, huishoudens: volHuishoudens(al.huishoudens!) }));
      } else {
        startHuishoudens(cfg);
      }
      if (al.grid) {
        setState((s) => ({ ...s, grid: volRaster(al.grid!) }));
      } else {
        startGrid(cfg);
      }
    },
    [startGroep, startGrid, startHuishoudens],
  );

  const onBericht = useCallback(
    (msg: WorkerResponse, worker: number) => {
      if (msg.type === "ready") {
        // Elke worker laadt zijn eigen manifest; één keer melden is genoeg.
        if (worker !== 0) return;
        manifestRef.current = msg.manifest as Manifest;
        setState((s) => ({ ...s, manifest: msg.manifest as Manifest }));
        return;
      }
      if (msg.type === "venster-uitkomst" || msg.type === "quick" || msg.type === "perfect") {
        const groep = groepen.current.get(msg.groep);
        if (!groep) return; // achterhaald
        if (msg.type === "venster-uitkomst") groep.uitkomsten[msg.jaarIndex] = msg.uitkomst;
        else if (msg.type === "quick") groep.metingen.push(msg.meting);
        else {
          groep.perfect = msg.besparing;
          groep.perfectBinnen = true;
        }
        if (groep.soort === "analyse") werkVoortgangBij(groep);
        probeerSamenvoegen(groep);
        return;
      }
      if (msg.type === "result") {
        const nummer = analyseGroep.current;
        const groep = nummer !== null ? groepen.current.get(nummer) : undefined;
        // Een antwoord op een achterhaalde aanvraag negeren we: anders zou een
        // trage berekening een nieuwere overschrijven.
        if (!groep || groep.samenvoegId !== msg.id) return;
        groepen.current.delete(groep.nummer);
        analyseGroep.current = null;
        const cfg = groep.cfg;
        setState((s) => ({
          ...s,
          result: msg.result,
          busy: false,
          voortgang: null,
          error: null,
          elapsedMs: Date.now() - groep.start,
          getoondeConfig: cfg,
          uitCache: false,
          verouderd: false,
        }));
        schrijfCache(cfg, { result: msg.result });
        getoondVoor.current = JSON.stringify(cfg);
        // De periodegrafiek hoort bij dit resultaat; de hoofdworker heeft de
        // dispatches nu al, dus dit kost alleen het optellen.
        herhaalPeriode();
        return;
      }
      if (msg.type === "scenario") {
        const nummer = scenarioGroep.current;
        const groep = nummer !== null ? groepen.current.get(nummer) : undefined;
        if (!groep || groep.samenvoegId !== msg.id) return;
        groepen.current.delete(groep.nummer);
        scenarioGroep.current = null;
        setState((s) => ({ ...s, scenario: msg.result }));
        // Alleen aanvullen: schrijfCache laat een bestaand `result` staan en
        // schrijft niets als er nog geen hoofdresultaat is.
        schrijfCache(groep.cfg, {
          scenario: msg.result,
          scenarioOpTeruglevering: opTerugleveringRef.current,
          scenarioJaar: jaarRef.current,
        });
        return;
      }
      if (msg.type === "grid-row") {
        if (!gridIds.current.has(msg.id)) return;
        setState((s) => {
          if (!s.grid) return s;
          const rows = [...s.grid.rows];
          rows[msg.row] = msg.points;
          const vol = rows.every((r) => r !== null);
          const grid = { ...s.grid, rows, klaar: vol, bezig: !vol };
          if (vol && laatsteConfig.current) {
            schrijfCache(laatsteConfig.current, { grid: rows as GridPoint[][] });
          }
          return { ...s, grid };
        });
        return;
      }
      if (msg.type === "huishouden-punt") {
        if (!huishoudensIds.current.has(msg.id)) return;
        setState((s) => {
          if (!s.huishoudens) return s;
          const punten = [...s.huishoudens.punten];
          punten[msg.index] = msg.punt;
          const vol = punten.every((p) => p !== undefined);
          if (vol && laatsteConfig.current) {
            schrijfCache(laatsteConfig.current, { huishoudens: punten as (HuishoudenPunt | null)[] });
          }
          return { ...s, huishoudens: { ...s.huishoudens, punten, klaar: vol, bezig: !vol } };
        });
        return;
      }
      if (msg.type === "periode") {
        if (msg.id !== periodeId.current[msg.kanaal]) return;
        setState((s) =>
          msg.kanaal === "week"
            ? { ...s, week: msg.periode, weekBezig: false }
            : { ...s, periode: msg.periode, periodeBezig: false },
        );
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
        const nummer = analyseGroep.current;
        const groep = nummer !== null ? groepen.current.get(nummer) : undefined;
        if (msg.id !== null && groep && groep.taakIds.has(msg.id)) {
          // Een fout in de hoofdanalyse: melden en stoppen met wachten.
          groepen.current.delete(groep.nummer);
          analyseGroep.current = null;
          setState((s) => ({ ...s, busy: false, voortgang: null, error: msg.message }));
          return;
        }
        if (
          msg.id !== null &&
          (msg.id === dagId.current ||
            msg.id === periodeId.current.verloop ||
            msg.id === periodeId.current.week)
        ) {
          setState((s) => ({
            ...s,
            dagBezig: false,
            periodeBezig: false,
            weekBezig: false,
            error: msg.message,
          }));
          return;
        }
        // Een fout in de achtergrond mag het hoofdantwoord niet raken; het
        // scenario en het raster blijven dan leeg en de pagina zegt dat.
        if (msg.id !== null && gridIds.current.has(msg.id)) {
          setState((s) => ({ ...s, grid: s.grid ? { ...s.grid, bezig: false } : null }));
        }
        if (msg.id !== null && huishoudensIds.current.has(msg.id)) {
          setState((s) => ({
            ...s,
            huishoudens: s.huishoudens ? { ...s.huishoudens, bezig: false } : null,
          }));
        }
      }
    },
    [herhaalPeriode, probeerSamenvoegen, werkVoortgangBij],
  );

  useEffect(() => {
    const pool = new WorkerPool(poolGrootte(), maakWorker, onBericht, (bericht) => {
      setState((s) => ({ ...s, busy: false, voortgang: null, error: bericht }));
    });
    poolRef.current = pool;
    pool.init("/data");

    // Meteen naast de workers starten. Het bestand is klein en de kans is groot
    // dat we het nodig hebben; zo staat het klaar tegen de tijd dat de
    // configuratie bekend is, in plaats van er dan pas op te wachten.
    void haalVoorbeeld();

    return () => {
      pool.terminate();
      poolRef.current = null;
    };
  }, [onBericht]);

  const send = useCallback(
    (cfg: Configuration) => {
      if (!poolRef.current) return;
      laatsteConfig.current = cfg;
      setState((s) => ({ ...s, busy: true }));
      startGroep("analyse", cfg, cfg);
      // Scenario en raster hangen alleen van de configuratie af, niet van het
      // antwoord. Ze gaan dus meteen mee de wachtrij in, achter de hoofdanalyse.
      startAchtergrond(cfg, {});
    },
    [startGroep, startAchtergrond],
  );

  const herbereken = useCallback(() => {
    if (config) send(config);
  }, [config, send]);

  const vraagDag = useCallback((datum: string) => {
    const pool = poolRef.current;
    // De configuratie van het GETOONDE resultaat, niet de live invoer: een dag
    // hoort bij de cijfers erboven. Met de live invoer stuurde elke slidertick
    // de worker aan het rekenen voor een configuratie die nooit getoond werd.
    const cfg = laatsteConfig.current;
    if (!pool || !cfg) return;
    const id = ++dagId.current;
    setState((s) => ({ ...s, dagBezig: true }));
    pool.postDirect(0, { type: "day", id, date: datum, config: cfg } satisfies WorkerRequest);
  }, []);

  const wisDag = useCallback(() => {
    dagId.current++;
    setState((s) => ({ ...s, dag: null, dagBezig: false, dagOntbreekt: null }));
  }, []);

  const vraagPeriode = useCallback(
    (van: string, tot: string, resolutie: Resolutie) => {
      periodeVraag.current.verloop = { van, tot, resolutie };
      herhaalPeriode("verloop");
    },
    [herhaalPeriode],
  );

  const vraagWeek = useCallback(
    (van: string, tot: string) => {
      periodeVraag.current.week = { van, tot, resolutie: "uur" };
      herhaalPeriode("week");
    },
    [herhaalPeriode],
  );

  /** Reken het scenario opnieuw met de huidige schakelaars. */
  const herstartScenario = useCallback(() => {
    const cfg = laatsteConfig.current;
    const oud = scenarioGroep.current;
    if (oud !== null) {
      poolRef.current?.annuleer(oud);
      groepen.current.delete(oud);
    }
    setState((s) => ({ ...s, scenario: null }));
    if (!cfg) return;
    startGroep(
      "scenario",
      cfg,
      scenarioConfiguratie(cfg, {
        jaar: jaarRef.current,
        opTeruglevering: opTerugleveringRef.current,
      }),
    );
  }, [startGroep]);

  const zetScenarioOpTeruglevering = useCallback(
    (opTeruglevering: boolean) => {
      opTerugleveringRef.current = opTeruglevering;
      setState((s) => ({ ...s, scenarioOpTeruglevering: opTeruglevering }));
      herstartScenario();
    },
    [herstartScenario],
  );

  const zetScenarioJaar = useCallback(
    (jaar: NettariefJaar) => {
      jaarRef.current = jaar;
      setState((s) => ({ ...s, scenarioJaar: jaar }));
      herstartScenario();
    },
    [herstartScenario],
  );

  // Een wijziging in de dispatch maakt raster, scenario en een opgehaalde dag
  // achterhaald: die hoorden bij de vorige doorrekening. Wachtend werk gaat
  // uit de rij, lopend rasterwerk stopt bij de volgende rij, en de volgnummers
  // gaan omhoog zodat een laat antwoord niet alsnog binnenvalt.
  useEffect(() => {
    // Verandert alleen de afleiding (looptijd, rente, …), dan blijven raster,
    // scenario, dag en periode gewoon geldig: de dispatch is dezelfde.
    if (
      config &&
      laatsteConfig.current &&
      dispatchSleutel(config) === dispatchSleutel(laatsteConfig.current)
    ) {
      return;
    }
    dagId.current++;
    periodeId.current.verloop++;
    periodeId.current.week++;
    gridIds.current = new Set();
    huishoudensIds.current = new Set();
    const pool = poolRef.current;
    for (const groep of groepen.current.values()) {
      if (groep.soort === "analyse") continue; // die wacht op zijn eigen antwoord
      pool?.annuleer(groep.nummer);
      groepen.current.delete(groep.nummer);
    }
    scenarioGroep.current = null;
    if (gridGroep.current !== null) pool?.annuleer(gridGroep.current);
    if (huishoudensGroep.current !== null) pool?.annuleer(huishoudensGroep.current);
    setState((s) =>
      s.grid ||
      s.huishoudens ||
      s.dag ||
      s.dagBezig ||
      s.scenario ||
      s.periode ||
      s.periodeBezig ||
      s.week ||
      s.weekBezig
        ? {
            ...s,
            grid: null,
            huishoudens: null,
            dag: null,
            dagBezig: false,
            dagOntbreekt: null,
            scenario: null,
            periode: null,
            periodeBezig: false,
            week: null,
            weekBezig: false,
          }
        : s,
    );
    pool?.postAlle({ type: "cancel" } satisfies WorkerRequest);
  }, [JSON.stringify(config)]);

  useEffect(() => {
    if (!config || !state.manifest) return;
    const sleutel = JSON.stringify(config);
    if (getoondVoor.current === sleutel) return;

    // Zelfde dispatch, andere afleiding: de financiën en de zelfvoorzienings-
    // cijfers volgen uit het getoonde resultaat zonder één seconde rekenen.
    const getoond = laatsteConfig.current;
    if (
      state.result &&
      getoond &&
      dispatchSleutel(getoond) === dispatchSleutel(config)
    ) {
      getoondVoor.current = sleutel;
      laatsteConfig.current = config;
      const scenarioCfg = scenarioConfiguratie(config, {
        jaar: jaarRef.current,
        opTeruglevering: opTerugleveringRef.current,
      });
      setState((s) => ({
        ...s,
        result: s.result ? pasAfleidingToe(s.result, afleidingVanConfiguratie(config)) : s.result,
        scenario: s.scenario
          ? pasAfleidingToe(s.scenario, afleidingVanConfiguratie(scenarioCfg))
          : s.scenario,
        getoondeConfig: config,
        verouderd: false,
      }));
      return;
    }

    // Eerst kijken of we dit al eens hebben uitgerekend. Dezelfde invoer op
    // dezelfde data geeft altijd hetzelfde antwoord — er zit geen willekeur in
    // het model — dus een bewaard resultaat is net zo geldig als een verse
    // berekening, en scheelt seconden bij elke refresh.
    const bewaard = leesCache(config);
    if (bewaard) {
      getoondVoor.current = sleutel;
      laatsteConfig.current = config;
      // De bundel hoort bij de dispatch; de afleiding (looptijd, rente, …)
      // kan van een eerdere instelling zijn en wordt hier opnieuw gedaan.
      setState((s) => ({
        ...s,
        result: pasAfleidingToe(bewaard.result, afleidingVanConfiguratie(config)),
        busy: false,
        error: null,
        getoondeConfig: config,
        uitCache: true,
        verouderd: false,
      }));
      // Wat er bewaard is, tonen we; wat ontbreekt, rekent de achtergrond bij.
      const scenarioCfg = scenarioConfiguratie(config, {
        jaar: jaarRef.current,
        opTeruglevering: opTerugleveringRef.current,
      });
      const scenarioPast =
        bewaard.scenario !== undefined &&
        (bewaard.scenarioOpTeruglevering ?? false) === opTerugleveringRef.current &&
        (bewaard.scenarioJaar ?? NETTARIEF_JAAR) === jaarRef.current;
      startAchtergrond(config, {
        scenario: scenarioPast
          ? pasAfleidingToe(bewaard.scenario!, afleidingVanConfiguratie(scenarioCfg))
          : undefined,
        grid: bewaard.grid,
        huishoudens: bewaard.huishoudens,
      });
      warmOp(config);
      herhaalPeriode();
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
        if (vooruit && vooruit.sleutel === dispatchSleutel(config)) {
          getoondVoor.current = sleutel;
          laatsteConfig.current = config;
          schrijfCache(config, {
            result: vooruit.result,
            scenario: vooruit.scenario,
            scenarioOpTeruglevering: false,
            scenarioJaar: NETTARIEF_JAAR,
            grid: vooruit.grid,
            huishoudens: vooruit.huishoudens,
          });
          // Het vooruitgerekende antwoord hoort bij de standaardafleiding; wie
          // alleen een financiële instelling wijzigde krijgt het toch, met de
          // afleiding opnieuw gedaan.
          setState((s) => ({
            ...s,
            result: pasAfleidingToe(vooruit.result, afleidingVanConfiguratie(config)),
            busy: false,
            error: null,
            getoondeConfig: config,
            uitCache: true,
            verouderd: false,
          }));
          startAchtergrond(config, {
            scenario:
              opTerugleveringRef.current || jaarRef.current !== NETTARIEF_JAAR || !vooruit.scenario
                ? undefined
                : pasAfleidingToe(
                    vooruit.scenario,
                    afleidingVanConfiguratie(
                      scenarioConfiguratie(config, { jaar: NETTARIEF_JAAR, opTeruglevering: false }),
                    ),
                  ),
            grid: vooruit.grid,
            huishoudens: vooruit.huishoudens,
          });
          warmOp(config);
          herhaalPeriode();
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
  }, [JSON.stringify(config), state.manifest, state.result, send, startAchtergrond, herhaalPeriode, warmOp]);

  return {
    ...state,
    vraagDag,
    wisDag,
    vraagPeriode,
    vraagWeek,
    herbereken,
    zetScenarioOpTeruglevering,
    zetScenarioJaar,
  };
}
