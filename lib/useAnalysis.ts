"use client";

/**
 * React-hook om de rekenworkers aan te sturen.
 *
 * Een pool van workers (lib/worker/pool.ts), zoveel als de machine kernen
 * heeft min één, met een maximum van vier (twee op een telefoon):
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
 *
 * ── Getoond en gevraagd ─────────────────────────────────────────────────────
 * Twee configuraties lopen hier naast elkaar: die van het GETOONDE antwoord
 * (`getoondeCfg`) en die van de invoer. Alles wat bij het antwoord hoort — het
 * scenario, het raster, de dagkiezer, de periodegrafiek — volgt de eerste.
 * Invoer wijzigen maakt het antwoord "verouderd", maar gooit niets weg; wie
 * zijn invoer terugzet, ziet het antwoord weer als actueel, met alles erbij.
 * Pas als er een nieuw antwoord verschijnt, wordt de achtergrond van het oude
 * opgeruimd.
 *
 * ── De data ─────────────────────────────────────────────────────────────────
 * De hoofdthread haalt het manifest en de bestanden één keer op en deelt ze
 * met de workers (lib/worker/ophalen.ts). Het manifest is er daardoor zodra
 * het binnen is, los van hoe snel de workers opstarten; en `gegenereerd` erin
 * is de dataversie waar de cache en het vooruitgerekende antwoord aan hangen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchSleutel, leesCache, leesCacheZonderData, schrijfCache, type Bundel } from "./cache";
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
import { Gegevensdeler } from "./worker/ophalen";
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
  /** Een fout in de hoofddoorrekening. */
  error: string | null;
  /**
   * De gegevens konden niet worden geladen (manifest onbereikbaar, offline,
   * een time-out) of de rekenmodule kon niet starten. Dan kan er niets
   * gerekend worden; de pagina zegt dat en biedt `probeerOpnieuw`.
   */
  fataal: string | null;
  /** Begin opnieuw: nieuwe workers, en de gegevens opnieuw ophalen. */
  probeerOpnieuw: () => void;
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
  /** Waarom de gevraagde dag niet kon worden opgehaald; blijft bij de dagkiezer. */
  dagFout: string | null;
  /** Vraag het batterijgedrag van één kalenderdag op. */
  vraagDag: (datum: string) => void;
  wisDag: () => void;
  /** Het resultaat over een periode, per dag of week; null zolang er geen is. */
  periode: PeriodeReeks | null;
  periodeBezig: boolean;
  /** Waarom de periode niet kon worden opgeteld. */
  periodeFout: string | null;
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
  weekFout: string | null;
  vraagWeek: (van: string, tot: string) => void;
  /** Uitkomst van het nettariefscenario, of null zolang het nog loopt. */
  scenario: ScenarioResult | null;
  /** Het scenario kon niet worden doorgerekend; dan wacht de pagina er niet meer op. */
  scenarioFout: string | null;
  /** Of het scenario ook op teruglevering heft. */
  scenarioOpTeruglevering: boolean;
  /** Reken het scenario opnieuw met of zonder heffing op teruglevering. */
  zetScenarioOpTeruglevering: (opTeruglevering: boolean) => void;
  /** Voor welk jaar het basistarief van het scenario geldt. */
  scenarioJaar: NettariefJaar;
  zetScenarioJaar: (jaar: NettariefJaar) => void;
}

export interface AnalyseOpties {
  /**
   * Of het raster van maten en de reeks huishoudens (tabblad "Wat als") nu
   * nodig zijn. Die kosten samen vijftig jaarsimulaties; op een telefoon is
   * dat een halve minuut rekenen op de achtergrond, bij elke nieuwe invoer,
   * voor een tabblad dat misschien nooit open gaat. Zonder deze optie worden
   * ze meteen gerekend.
   */
  rasterNodig?: boolean;
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
 * De sleutel bepaalt of het bruikbaar is. Hij bevat het modelversienummer, de
 * dataversie (`gegenereerd` uit het manifest) en een hash van de dispatch-
 * velden van de configuratie, dus een bezoeker met een afwijkende invoer, een
 * oud bestand of nieuwere data valt vanzelf terug op zelf rekenen. Wie alleen
 * een financiële instelling wijzigde, krijgt het antwoord wél, met de
 * afleiding opnieuw gedaan.
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
  /** Alleen voor het scenario: met welke schakelaars het is gestart. */
  opTeruglevering?: boolean;
  jaar?: NettariefJaar;
}

/** Een scenario dat binnenkwam vóór het antwoord waar het bij hoort. */
interface ScenarioInDeWacht {
  dispatch: string;
  result: ScenarioResult;
  opTeruglevering: boolean;
  jaar: NettariefJaar;
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
  | "probeerOpnieuw"
>;

const LEGE_ACHTERGROND = {
  grid: null,
  huishoudens: null,
  dag: null,
  dagBezig: false,
  dagOntbreekt: null,
  dagFout: null,
  periode: null,
  periodeBezig: false,
  periodeFout: null,
  week: null,
  weekBezig: false,
  weekFout: null,
} satisfies Partial<InterneState>;

export function useAnalysis(config: Configuration | null, opties: AnalyseOpties = {}): AnalysisState {
  const rasterNodig = opties.rasterNodig ?? true;
  const poolRef = useRef<WorkerPool | null>(null);
  const manifestRef = useRef<Manifest | null>(null);
  const nextId = useRef(0);
  /** Verhoogd door `probeerOpnieuw`: start de workers en het ophalen opnieuw. */
  const [poging, setPoging] = useState(0);

  const [state, setState] = useState<InterneState>({
    manifest: null,
    result: null,
    busy: false,
    error: null,
    fataal: null,
    elapsedMs: null,
    getoondeConfig: null,
    uitCache: false,
    verouderd: false,
    voortgang: null,
    ...LEGE_ACHTERGROND,
    scenario: null,
    scenarioFout: null,
    scenarioOpTeruglevering: false,
    scenarioJaar: NETTARIEF_JAAR,
  });
  /** De configuratie (als JSON) waar het getoonde resultaat bij hoort. */
  const getoondVoor = useRef<string | null>(null);
  /** De configuratie van het getoonde resultaat; dag, periode en raster horen daarbij. */
  const getoondeCfg = useRef<Configuration | null>(null);
  /**
   * Het getoonde resultaat is een noodoplossing: een bewaard antwoord dat werd
   * getoond omdat de gegevens niet te laden waren. Zodra dat wel lukt, wordt
   * het opnieuw bekeken in plaats van als "al getoond" te gelden.
   */
  const voorlopig = useRef(false);
  /** De invoer zoals hij nu is, voor antwoorden die later binnenkomen. */
  const huidigeConfig = useRef<Configuration | null>(config);
  huidigeConfig.current = config;
  const rasterNodigRef = useRef(rasterNodig);
  rasterNodigRef.current = rasterNodig;

  const groepTeller = useRef(0);
  const groepen = useRef(new Map<number, Groep>());
  /** De groep waarvan het antwoord nog wordt verwacht, per soort. */
  const analyseGroep = useRef<number | null>(null);
  const scenarioGroep = useRef<number | null>(null);
  /** Voor welke dispatch het getoonde scenario is; null als er geen staat. */
  const scenarioVoor = useRef<string | null>(null);
  const scenarioWacht = useRef<ScenarioInDeWacht | null>(null);
  /** De ids van de rastertaken die nu mogen binnenkomen, en voor welke configuratie. */
  const gridIds = useRef(new Set<number>());
  const gridGroep = useRef<number | null>(null);
  const gridCfg = useRef<Configuration | null>(null);
  /** Idem voor de reeks huishoudens. */
  const huishoudensIds = useRef(new Set<number>());
  const huishoudensGroep = useRef<number | null>(null);
  const huishoudensCfg = useRef<Configuration | null>(null);
  const dagId = useRef(0);
  const periodeId = useRef<Record<PeriodeKanaal, number>>({ verloop: 0, week: 0 });
  const opTerugleveringRef = useRef(false);
  const jaarRef = useRef<NettariefJaar>(NETTARIEF_JAAR);

  /** De laatst gevraagde periode, zodat hij bij een nieuw resultaat opnieuw kan. */
  const periodeVraag = useRef<Record<PeriodeKanaal, { van: string; tot: string; resolutie: Resolutie } | null>>({
    verloop: null,
    week: null,
  });

  /** De dataversie voor de cache: `gegenereerd` uit het manifest. */
  const dataVersie = () => manifestRef.current?.gegenereerd ?? null;
  const bewaar = (cfg: Configuration, deel: Partial<Bundel>) => {
    const versie = dataVersie();
    if (versie) schrijfCache(cfg, versie, deel);
  };

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
    const cfg = getoondeCfg.current;
    if (!pool || !cfg) return;
    // Zonder kanaal: allebei opnieuw. Dat is het geval na een nieuwe
    // doorrekening, want dan is elke openstaande reeks verouderd.
    for (const k of kanaal ? [kanaal] : (["verloop", "week"] as PeriodeKanaal[])) {
      const vraag = periodeVraag.current[k];
      if (!vraag) continue;
      const id = ++periodeId.current[k];
      setState((s) =>
        k === "week" ? { ...s, weekBezig: true, weekFout: null } : { ...s, periodeBezig: true, periodeFout: null },
      );
      pool.postDirect(0, { type: "periode", id, kanaal: k, config: cfg, ...vraag } satisfies WorkerRequest);
    }
  }, []);

  /** Haal een groep uit de pool en uit de boekhouding; lopende taken lopen uit en worden genegeerd. */
  const staak = useCallback((nummer: number | null) => {
    if (nummer === null) return;
    poolRef.current?.annuleer(nummer);
    groepen.current.delete(nummer);
    if (analyseGroep.current === nummer) analyseGroep.current = null;
    if (scenarioGroep.current === nummer) scenarioGroep.current = null;
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
      const fout = `geen profieldata voor netgebied ${werkCfg.domain} tussen ${werkCfg.from} en ${werkCfg.to}`;
      setState((s) =>
        soort === "analyse" ? { ...s, busy: false, voortgang: null, error: fout } : { ...s, scenarioFout: fout },
      );
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
      ...(soort === "scenario" ? { opTeruglevering: opTerugleveringRef.current, jaar: jaarRef.current } : {}),
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
    } else {
      scenarioGroep.current = nummer;
      setState((s) => (s.scenarioFout ? { ...s, scenarioFout: null } : s));
    }

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

  /** Start het scenario voor deze configuratie, met de schakelaars zoals ze nu staan. */
  const startScenario = useCallback(
    (cfg: Configuration) => {
      staak(scenarioGroep.current);
      startGroep(
        "scenario",
        cfg,
        scenarioConfiguratie(cfg, { jaar: jaarRef.current, opTeruglevering: opTerugleveringRef.current }),
      );
    },
    [staak, startGroep],
  );

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
  }, [werkVoortgangBij]);

  /** Verdeel de rijen van het raster over de helpers (of over alles als er maar één is). */
  const startGrid = useCallback((cfg: Configuration) => {
    const pool = poolRef.current;
    if (!pool) return;
    if (gridGroep.current !== null) pool.annuleer(gridGroep.current);
    const nummer = ++groepTeller.current;
    gridGroep.current = nummer;
    gridIds.current = new Set();
    gridCfg.current = cfg;
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
    if (huishoudensGroep.current !== null) pool.annuleer(huishoudensGroep.current);
    const nummer = ++groepTeller.current;
    huishoudensGroep.current = nummer;
    huishoudensIds.current = new Set();
    huishoudensCfg.current = cfg;
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
   * Ruim de achtergrond van het vorige antwoord op: raster, huishoudens, dag
   * en periodes horen bij een andere dispatch. Alleen aanroepen als er een
   * NIEUW antwoord getoond wordt — invoer wijzigen alleen is geen reden: wie
   * terugzet naar wat er stond, hoort alles terug te zien.
   */
  const wisAchtergrond = useCallback(() => {
    dagId.current++;
    periodeId.current.verloop++;
    periodeId.current.week++;
    gridIds.current = new Set();
    huishoudensIds.current = new Set();
    const pool = poolRef.current;
    if (gridGroep.current !== null) pool?.annuleer(gridGroep.current);
    if (huishoudensGroep.current !== null) pool?.annuleer(huishoudensGroep.current);
    gridGroep.current = null;
    huishoudensGroep.current = null;
    setState((s) => ({ ...s, ...LEGE_ACHTERGROND }));
    pool?.postAlle({ type: "cancel" } satisfies WorkerRequest);
  }, []);

  /**
   * Zet een antwoord op het scherm en maak de achtergrond erbij compleet: wat
   * er al is (uit cache of preload, of een scenario dat eerder binnenkwam)
   * tonen, de rest starten. Raster en huishoudens alleen als het tabblad
   * "Wat als" ze nodig heeft.
   */
  const toonAntwoord = useCallback(
    (
      cfg: Configuration,
      result: AnalysisResult,
      herkomst: { uitCache: boolean; elapsedMs?: number },
      al: { scenario?: ScenarioResult; grid?: GridPoint[][]; huishoudens?: (HuishoudenPunt | null)[] },
    ) => {
      const nieuweDispatch = !getoondeCfg.current || dispatchSleutel(getoondeCfg.current) !== dispatchSleutel(cfg);
      if (nieuweDispatch) wisAchtergrond();
      getoondVoor.current = JSON.stringify(cfg);
      getoondeCfg.current = cfg;
      voorlopig.current = false;
      const huidig = huidigeConfig.current;
      setState((s) => ({
        ...s,
        result,
        busy: analyseGroep.current !== null,
        error: null,
        fataal: null,
        getoondeConfig: cfg,
        uitCache: herkomst.uitCache,
        elapsedMs: herkomst.elapsedMs ?? s.elapsedMs,
        // Kwam het antwoord binnen terwijl de invoer alweer anders was, dan is
        // het meteen verouderd.
        verouderd: huidig !== null && JSON.stringify(huidig) !== JSON.stringify(cfg),
      }));

      // Het scenario: uit wat er meekwam, uit de wachtkamer, of opnieuw.
      const dispatch = dispatchSleutel(cfg);
      const scenarioCfg = scenarioConfiguratie(cfg, {
        jaar: jaarRef.current,
        opTeruglevering: opTerugleveringRef.current,
      });
      const wacht = scenarioWacht.current;
      const uitWacht =
        wacht &&
        wacht.dispatch === dispatch &&
        wacht.opTeruglevering === opTerugleveringRef.current &&
        wacht.jaar === jaarRef.current
          ? wacht.result
          : undefined;
      const scenario = al.scenario ?? uitWacht;
      if (scenario) {
        scenarioWacht.current = null;
        scenarioVoor.current = dispatch;
        setState((s) => ({
          ...s,
          scenario: pasAfleidingToe(scenario, afleidingVanConfiguratie(scenarioCfg)),
          scenarioFout: null,
        }));
        if (uitWacht) {
          bewaar(cfg, {
            scenario: uitWacht,
            scenarioOpTeruglevering: opTerugleveringRef.current,
            scenarioJaar: jaarRef.current,
          });
        }
        staak(scenarioGroep.current);
      } else if (nieuweDispatch || scenarioVoor.current !== dispatch) {
        scenarioVoor.current = null;
        setState((s) => ({ ...s, scenario: null }));
        const lopend = scenarioGroep.current !== null ? groepen.current.get(scenarioGroep.current) : undefined;
        // Loopt het scenario voor dit antwoord al (het ging tegelijk met de
        // hoofddoorrekening de rij in), dan wachten we daarop.
        if (!lopend || dispatchSleutel(lopend.cfg) !== dispatch) startScenario(cfg);
      }

      // Raster en huishoudens: alleen bij een nieuwe dispatch opnieuw bekijken.
      if (nieuweDispatch) {
        if (pastBijVarianten(al.huishoudens)) {
          huishoudensCfg.current = cfg;
          setState((s) => ({ ...s, huishoudens: volHuishoudens(al.huishoudens!) }));
        } else if (rasterNodigRef.current) {
          startHuishoudens(cfg);
        }
        if (al.grid) {
          gridCfg.current = cfg;
          setState((s) => ({ ...s, grid: volRaster(al.grid!) }));
        } else if (rasterNodigRef.current) {
          startGrid(cfg);
        }
      }
    },
    // `bewaar` leest alleen refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wisAchtergrond, staak, startScenario, startGrid, startHuishoudens],
  );

  const onBericht = useCallback(
    (msg: WorkerResponse, worker: number) => {
      if (msg.type === "ready") {
        // Het manifest komt van de hoofdthread (Gegevensdeler); `ready` is voor
        // de pool, die pas taken geeft aan een worker die klaar is.
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
        setState((s) => ({ ...s, voortgang: null }));
        toonAntwoord(cfg, msg.result, { uitCache: false, elapsedMs: Date.now() - groep.start }, {});
        bewaar(cfg, { result: msg.result });
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
        const dispatch = dispatchSleutel(groep.cfg);
        const opTeruglevering = groep.opTeruglevering ?? false;
        const jaar = groep.jaar ?? NETTARIEF_JAAR;
        const getoond = getoondeCfg.current;
        if (!getoond || dispatchSleutel(getoond) !== dispatch) {
          // Het scenario van een antwoord dat er nog niet is: bewaren tot het er is.
          scenarioWacht.current = { dispatch, result: msg.result, opTeruglevering, jaar };
          return;
        }
        scenarioVoor.current = dispatch;
        const scenarioCfg = scenarioConfiguratie(getoond, { jaar, opTeruglevering });
        setState((s) => ({
          ...s,
          scenario: pasAfleidingToe(msg.result, afleidingVanConfiguratie(scenarioCfg)),
          scenarioFout: null,
        }));
        // Alleen aanvullen: schrijfCache laat een bestaand `result` staan en
        // schrijft niets als er nog geen hoofdresultaat is.
        bewaar(groep.cfg, { scenario: msg.result, scenarioOpTeruglevering: opTeruglevering, scenarioJaar: jaar });
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
          if (vol && gridCfg.current) bewaar(gridCfg.current, { grid: rows as GridPoint[][] });
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
          if (vol && huishoudensCfg.current) {
            bewaar(huishoudensCfg.current, { huishoudens: punten as (HuishoudenPunt | null)[] });
          }
          return { ...s, huishoudens: { ...s.huishoudens, punten, klaar: vol, bezig: !vol } };
        });
        return;
      }
      if (msg.type === "periode") {
        if (msg.id !== periodeId.current[msg.kanaal]) return;
        setState((s) =>
          msg.kanaal === "week"
            ? { ...s, week: msg.periode, weekBezig: false, weekFout: null }
            : { ...s, periode: msg.periode, periodeBezig: false, periodeFout: null },
        );
        return;
      }
      if (msg.type === "day") {
        if (msg.id !== dagId.current) return;
        setState((s) => ({
          ...s,
          dag: msg.day,
          dagBezig: false,
          dagFout: null,
          dagOntbreekt: msg.day === null ? msg.date : null,
        }));
        return;
      }
      if (msg.type === "error") {
        if (msg.id === null) {
          // De initialisatie mislukte. Voor een helper vangt de pool dat op
          // (zijn taken gaan naar de anderen); zonder hoofdworker kan er niets.
          if (worker !== 0) return;
          staak(analyseGroep.current);
          setState((s) => ({ ...s, busy: false, voortgang: null, fataal: msg.message }));
          return;
        }
        const id = msg.id;
        const groep = [...groepen.current.values()].find((g) => g.taakIds.has(id));
        if (groep?.soort === "analyse") {
          // Een fout in de hoofdanalyse: melden en stoppen met wachten.
          staak(groep.nummer);
          setState((s) => ({ ...s, busy: false, voortgang: null, error: msg.message }));
          return;
        }
        if (groep?.soort === "scenario") {
          // Het scenario faalde: zeggen, in plaats van eeuwig "onderweg".
          staak(groep.nummer);
          const getoond = getoondeCfg.current;
          if (getoond && dispatchSleutel(getoond) === dispatchSleutel(groep.cfg)) {
            setState((s) => ({ ...s, scenarioFout: msg.message }));
          }
          return;
        }
        // Dag en periode: de fout blijft bij de figuur die erom vroeg. Een
        // melding "er ging iets mis bij het rekenen" bovenaan de pagina, naast
        // een geldig antwoord, zou dat antwoord ten onrechte in twijfel trekken.
        if (id === dagId.current) {
          setState((s) => ({ ...s, dagBezig: false, dagFout: msg.message }));
          return;
        }
        if (id === periodeId.current.verloop) {
          setState((s) => ({ ...s, periodeBezig: false, periodeFout: msg.message }));
          return;
        }
        if (id === periodeId.current.week) {
          setState((s) => ({ ...s, weekBezig: false, weekFout: msg.message }));
          return;
        }
        // Een fout in de achtergrond mag het hoofdantwoord niet raken; het
        // raster blijft dan leeg en de pagina zegt dat.
        if (gridIds.current.has(id)) {
          setState((s) => ({ ...s, grid: s.grid ? { ...s.grid, bezig: false } : null }));
        }
        if (huishoudensIds.current.has(id)) {
          setState((s) => ({
            ...s,
            huishoudens: s.huishoudens ? { ...s.huishoudens, bezig: false } : null,
          }));
        }
      }
    },
    // `bewaar` leest alleen refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [herhaalPeriode, probeerSamenvoegen, werkVoortgangBij, toonAntwoord, staak],
  );

  useEffect(() => {
    const deler = new Gegevensdeler("/data");
    const fataal = (bericht: string) =>
      setState((s) => ({ ...s, busy: false, voortgang: null, fataal: bericht }));
    let pool: WorkerPool;
    try {
      pool = new WorkerPool(poolGrootte(), maakWorker, onBericht, fataal, deler);
    } catch (err) {
      // Een browser zonder module-workers, of een beveiligingsregel die ze
      // tegenhoudt: dan kan er niets gerekend worden, en dat zeggen we.
      fataal(`de rekenmodule kon niet starten in deze browser (${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    poolRef.current = pool;
    pool.init("/data");
    let levend = true;
    deler.manifest().then(
      (m) => {
        if (!levend) return;
        manifestRef.current = m;
        setState((s) => ({ ...s, manifest: m }));
      },
      (err: unknown) => {
        if (!levend) return;
        fataal(err instanceof Error ? err.message : String(err));
      },
    );

    // Meteen naast de workers starten. Het bestand is klein en de kans is groot
    // dat we het nodig hebben; zo staat het klaar tegen de tijd dat de
    // configuratie bekend is, in plaats van er dan pas op te wachten.
    void haalVoorbeeld();

    return () => {
      levend = false;
      pool.terminate();
      poolRef.current = null;
      groepen.current.clear();
      analyseGroep.current = null;
      scenarioGroep.current = null;
      gridGroep.current = null;
      huishoudensGroep.current = null;
    };
  }, [onBericht, poging]);

  const probeerOpnieuw = useCallback(() => {
    // Een nieuw manifest kan een nieuwe dataversie zijn; wat er getoond wordt
    // (een bewaard antwoord) wordt dan opnieuw bekeken.
    if (getoondVoor.current !== null) voorlopig.current = true;
    manifestRef.current = null;
    setState((s) => ({ ...s, fataal: null, error: null, manifest: null, busy: false, voortgang: null }));
    setPoging((p) => p + 1);
  }, []);

  const send = useCallback(
    (cfg: Configuration) => {
      if (!poolRef.current || !manifestRef.current) return;
      // Een lopende hoofddoorrekening voor een andere invoer is achterhaald:
      // wachtende stukken gaan uit de rij, lopende worden genegeerd.
      staak(analyseGroep.current);
      setState((s) => ({ ...s, busy: true, error: null }));
      startGroep("analyse", cfg, cfg);
      // Het scenario hangt alleen van de configuratie af, niet van het
      // antwoord. Het gaat dus meteen mee de wachtrij in, achter de
      // hoofdanalyse; komt het eerder binnen, dan wacht het op het antwoord.
      // Het getoonde antwoord houdt zijn eigen scenario tot het nieuwe er is.
      if (!getoondeCfg.current || dispatchSleutel(getoondeCfg.current) !== dispatchSleutel(cfg)) {
        const lopend = scenarioGroep.current !== null ? groepen.current.get(scenarioGroep.current) : undefined;
        const getoondeDispatch = getoondeCfg.current ? dispatchSleutel(getoondeCfg.current) : null;
        // Loopt het scenario van het getoonde antwoord nog, laat dat dan
        // afmaken; anders vervangt dit het.
        if (!lopend || dispatchSleutel(lopend.cfg) !== getoondeDispatch || scenarioVoor.current === getoondeDispatch) {
          startScenario(cfg);
        }
      }
    },
    [staak, startGroep, startScenario],
  );

  const herbereken = useCallback(() => {
    if (config) send(config);
  }, [config, send]);

  const vraagDag = useCallback((datum: string) => {
    const pool = poolRef.current;
    // De configuratie van het GETOONDE resultaat, niet de live invoer en niet
    // die van een doorrekening die nog loopt: een dag hoort bij de cijfers
    // erboven.
    const cfg = getoondeCfg.current;
    if (!pool || !cfg) return;
    const id = ++dagId.current;
    setState((s) => ({ ...s, dagBezig: true, dagFout: null }));
    pool.postDirect(0, { type: "day", id, date: datum, config: cfg } satisfies WorkerRequest);
  }, []);

  const wisDag = useCallback(() => {
    dagId.current++;
    setState((s) => ({ ...s, dag: null, dagBezig: false, dagOntbreekt: null, dagFout: null }));
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

  /** Reken het scenario van het getoonde antwoord opnieuw met de huidige schakelaars. */
  const herstartScenario = useCallback(() => {
    const cfg = getoondeCfg.current;
    staak(scenarioGroep.current);
    scenarioWacht.current = null;
    scenarioVoor.current = null;
    setState((s) => ({ ...s, scenario: null, scenarioFout: null }));
    if (!cfg) return;
    startScenario(cfg);
  }, [staak, startScenario]);

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

  // Het raster en de huishoudens pas als het tabblad erom vraagt, en dan voor
  // het GETOONDE antwoord.
  useEffect(() => {
    const cfg = getoondeCfg.current;
    if (!rasterNodig || !state.result || !cfg || !poolRef.current || state.fataal) return;
    if (state.grid === null) startGrid(cfg);
    if (state.huishoudens === null) startHuishoudens(cfg);
  }, [rasterNodig, state.result, state.grid, state.huishoudens, state.fataal, startGrid, startHuishoudens]);

  // Gegevens onbereikbaar en nog niets op het scherm: toon dan wat er van deze
  // invoer bewaard is, van welke dataversie ook. Beter een antwoord over iets
  // oudere data (met de melding dat het uit een eerdere doorrekening komt) dan
  // alleen een foutmelding.
  useEffect(() => {
    if (!state.fataal || state.result || !config) return;
    const bewaard = leesCacheZonderData(config);
    if (!bewaard) return;
    getoondVoor.current = JSON.stringify(config);
    getoondeCfg.current = config;
    voorlopig.current = true;
    setState((s) => ({
      ...s,
      result: pasAfleidingToe(bewaard.result, afleidingVanConfiguratie(config)),
      getoondeConfig: config,
      uitCache: true,
      verouderd: false,
      scenario: bewaard.scenario
        ? pasAfleidingToe(
            bewaard.scenario,
            afleidingVanConfiguratie(
              scenarioConfiguratie(config, {
                jaar: (bewaard.scenarioJaar ?? NETTARIEF_JAAR) as NettariefJaar,
                opTeruglevering: bewaard.scenarioOpTeruglevering ?? false,
              }),
            ),
          )
        : null,
      grid: bewaard.grid ? volRaster(bewaard.grid) : null,
      huishoudens: pastBijVarianten(bewaard.huishoudens) ? volHuishoudens(bewaard.huishoudens!) : null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fataal, state.result, JSON.stringify(config)]);

  useEffect(() => {
    if (!config || !state.manifest) return;
    const sleutel = JSON.stringify(config);
    const versie = state.manifest.gegenereerd;

    // Terug bij wat er staat: het antwoord is weer actueel. Een doorrekening
    // voor een tussenliggende invoer is dan achterhaald.
    if (getoondVoor.current === sleutel && !voorlopig.current) {
      if (analyseGroep.current !== null) {
        staak(analyseGroep.current);
        setState((s) => ({ ...s, busy: false, voortgang: null }));
      }
      setState((s) => (s.verouderd ? { ...s, verouderd: false } : s));
      // Het scenario kan onderweg voor die andere invoer zijn vervangen.
      const dispatch = dispatchSleutel(config);
      const lopend = scenarioGroep.current !== null ? groepen.current.get(scenarioGroep.current) : undefined;
      if (scenarioVoor.current !== dispatch && (!lopend || dispatchSleutel(lopend.cfg) !== dispatch)) {
        startScenario(config);
      }
      return;
    }

    // Zelfde dispatch, andere afleiding: de financiën en de zelfvoorzienings-
    // cijfers volgen uit het getoonde resultaat zonder één seconde rekenen.
    const getoond = getoondeCfg.current;
    if (state.result && getoond && !voorlopig.current && dispatchSleutel(getoond) === dispatchSleutel(config)) {
      getoondVoor.current = sleutel;
      getoondeCfg.current = config;
      if (analyseGroep.current !== null) staak(analyseGroep.current);
      const scenarioCfg = scenarioConfiguratie(config, {
        jaar: jaarRef.current,
        opTeruglevering: opTerugleveringRef.current,
      });
      setState((s) => ({
        ...s,
        busy: false,
        voortgang: null,
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
    const bewaard = leesCache(config, versie);
    if (bewaard) {
      staak(analyseGroep.current);
      // De bundel hoort bij de dispatch; de afleiding (looptijd, rente, …)
      // kan van een eerdere instelling zijn en wordt hier opnieuw gedaan.
      const scenarioPast =
        bewaard.scenario !== undefined &&
        (bewaard.scenarioOpTeruglevering ?? false) === opTerugleveringRef.current &&
        (bewaard.scenarioJaar ?? NETTARIEF_JAAR) === jaarRef.current;
      setState((s) => ({ ...s, voortgang: null }));
      toonAntwoord(config, pasAfleidingToe(bewaard.result, afleidingVanConfiguratie(config)), { uitCache: true }, {
        scenario: scenarioPast ? bewaard.scenario : undefined,
        grid: bewaard.grid,
        huishoudens: bewaard.huishoudens,
      });
      warmOp(config);
      herhaalPeriode();
      return;
    }

    // Nog niet eerder uitgerekend: de eerste keer doen we het meteen, daarna
    // markeren we het resultaat als verouderd en wacht de tool op een opdracht.
    if (state.result === null || voorlopig.current) {
      let levend = true;
      const timer = setTimeout(async () => {
        // Eerst het antwoord dat bij de build is uitgerekend. Past het bij deze
        // configuratie en deze data, dan is er niets te rekenen en staat het er
        // meteen — inclusief scenario en raster, als de build die heeft
        // meegeleverd.
        const vooruit = await haalVoorbeeld();
        if (!levend) return;
        if (vooruit && vooruit.sleutel === dispatchSleutel(config, versie)) {
          bewaar(config, {
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
          toonAntwoord(
            config,
            pasAfleidingToe(vooruit.result, afleidingVanConfiguratie(config)),
            { uitCache: true },
            {
              scenario:
                opTerugleveringRef.current || jaarRef.current !== NETTARIEF_JAAR ? undefined : vooruit.scenario,
              grid: vooruit.grid,
              huishoudens: vooruit.huishoudens,
            },
          );
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
    setState((s) => (s.verouderd ? s : { ...s, verouderd: true }));
    return;
    // De configuratie is een gewoon object; serialiseren is de eenvoudigste
    // manier om op inhoud te vergelijken in plaats van op referentie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config), state.manifest, state.result, send, toonAntwoord, herhaalPeriode, warmOp, staak, startScenario]);

  return {
    ...state,
    vraagDag,
    wisDag,
    vraagPeriode,
    vraagWeek,
    herbereken,
    probeerOpnieuw,
    zetScenarioOpTeruglevering,
    zetScenarioJaar,
  };
}
