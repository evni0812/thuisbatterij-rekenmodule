/**
 * Rekenworker: laadt de assets en draait de doorrekening buiten de UI-thread.
 *
 * De hele analyse — drie strategieën over meerdere profieljaren plus de
 * besparingscurve — kost enkele seconden. Op de hoofdthread zou dat de pagina
 * laten bevriezen tijdens het slepen van een schuifregelaar.
 */

import {
  expandPricesToQuarters,
  loadManifest,
  loadPriceYear,
  loadProfileYear,
  type PriceYear,
  type ProfileYear,
} from "../data/loader";
import { addDays, localMidnightUtcMs } from "../data/timeaxis";
import type { Manifest } from "../data/manifest";
import { equivalentCycles, wearCostPerKwh } from "../model/battery";
import { dispatchBaseline } from "../model/dispatch-baseline";
import { dispatchRolling } from "../model/dispatch-rolling";
import { findDay, runAnalysis, type AnalysisInput } from "../model/analysis";
import { buildResidual } from "../model/residual";
import { buildPriceSeries } from "../model/tariff";
import type { BatterySpec, DispatchResult } from "../model/types";
import type {
  Configuration,
  GridPoint,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

let manifest: Manifest | null = null;
let baseUrl = "/data";

const profileCache = new Map<string, ProfileYear>();
const priceCache = new Map<number, PriceYear>();

async function getProfile(domain: string, year: number): Promise<ProfileYear> {
  const key = `${domain}:${year}`;
  const hit = profileCache.get(key);
  if (hit) return hit;
  const loaded = await loadProfileYear(manifest!, domain, year, baseUrl);
  profileCache.set(key, loaded);
  return loaded;
}

async function getPrice(year: number): Promise<PriceYear> {
  const hit = priceCache.get(year);
  if (hit) return hit;
  const loaded = await loadPriceYear(manifest!, year, baseUrl);
  priceCache.set(year, loaded);
  return loaded;
}

/** Welke kalenderjaren raakt het gekozen venster, en waar liggen de grenzen? */
function yearsInRange(
  m: Manifest,
  domain: string,
  from: string,
  to: string,
): number[] {
  const beschikbaar = Object.keys(m.profielen[domain] ?? {}).map(Number);
  return beschikbaar
    .filter((y) => {
      const info = m.profielen[domain]![String(y)]!;
      // Overlap tussen [eerste_dag, laatste_dag] en [from, to].
      return info.eerste_dag <= to && info.laatste_dag >= from;
    })
    .sort((a, b) => a - b);
}

/**
 * Knip een profieljaar bij tot het gekozen venster.
 *
 * De fracties worden NIET geherschaald: ze zijn genormaliseerd op het hele
 * kalenderjaar, en juist daardoor levert een deelvenster automatisch het juiste
 * deelvolume op. Renormaliseren zou volume verzinnen — drie wintermaanden horen
 * meer dan een kwart van het jaarvolume te bevatten.
 *
 * De grenzen worden in lokale tijd bepaald: "1 juli" begint op 30 juni 22:00
 * UTC in de zomer en op 23:00 UTC in de winter.
 */
function sliceRange(
  prof: ProfileYear,
  from: string,
  to: string,
): { start: number; end: number; firstDay: string; lastDay: string } {
  const firstDay = prof.firstDay > from ? prof.firstDay : from;
  const lastDay = prof.lastDay < to ? prof.lastDay : to;
  if (firstDay > lastDay) {
    return { start: 0, end: 0, firstDay, lastDay };
  }

  const vanaf = localMidnightUtcMs(firstDay);
  const totEnMet = localMidnightUtcMs(addDays(lastDay, 1));

  return {
    start: lowerBound(prof.startMs, vanaf),
    end: lowerBound(prof.startMs, totEnMet),
    firstDay,
    lastDay,
  };
}

/** Eerste index waarvan de waarde niet kleiner is dan `target`. */
function lowerBound(axis: Float64Array, target: number): number {
  let lo = 0;
  let hi = axis.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (axis[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function buildInput(config: Configuration): Promise<AnalysisInput> {
  const m = manifest!;
  const jaren = yearsInRange(m, config.domain, config.from, config.to);
  if (jaren.length === 0) {
    throw new Error(
      `geen profieldata voor netgebied ${config.domain} tussen ${config.from} en ${config.to}`,
    );
  }

  const windows: AnalysisInput["windows"] = [];
  for (const year of jaren) {
    const prof = await getProfile(config.domain, year);
    const price = await getPrice(year);
    const { start, end, firstDay, lastDay } = sliceRange(prof, config.from, config.to);
    if (end <= start) continue;

    const startMs = prof.startMs.slice(start, end);
    const market = expandPricesToQuarters(startMs, price, "market");

    // Standaard rekenen we met de heffing zoals die in dat jaar werkelijk gold,
    // afgeleid uit allInPrijs minus marktprijs. Dat maakt de uitkomst een
    // tegenfeitelijke doorrekening van wat er echt gebeurd is, geen voorspelling.
    const tariff = config.useHistoricalLevy
      ? { ...config.tariff, energyTaxEurPerKwh: price.levyEurPerKwh }
      : config.tariff;

    windows.push({
      year,
      firstDay,
      lastDay,
      isFullYear:
        firstDay === `${year}-01-01` &&
        lastDay === `${year}-12-31` &&
        prof.isFullYear,
      window: {
        startMs,
        residualKwh: buildResidual(
          prof.importFraction.slice(start, end),
          prof.exportFraction.slice(start, end),
          config.household,
        ),
        prices: buildPriceSeries(market, tariff),
      },
    });
  }

  return {
    windows,
    battery: config.battery,
    tariff: config.tariff,
    investmentEur: config.investmentEur,
    cycleLife: config.cycleLife,
    years: config.analysisYears,
    priceEscalation: config.priceEscalation,
    discountRate: config.discountRate,
    calendarFadePerYear: config.calendarFadePerYear,
    residualValueEur: config.residualValueEur,
  };
}

function post(msg: WorkerResponse): void {
  self.postMessage(msg);
}

/**
 * Rekent een raster van batterijmaten door, rij voor rij.
 *
 * Alleen de realistische strategie en alleen op één representatief jaar: een
 * volledig raster met het optimum erbij zou minutenlang duren, en de vraag die
 * deze kaart beantwoordt — welke maat loont — hangt niet af van de bovengrens.
 *
 * Na elke rij geven we de beurt terug aan de berichtenlus, zodat een annulering
 * of een nieuwe aanvraag ertussen kan komen.
 */
async function runGrid(
  id: number,
  config: Configuration,
  capacities: number[],
  powers: number[],
): Promise<void> {
  const invoer = await buildInput(config);
  // Het meest recente volledige jaar is het representatiefst; anders het laatste.
  const volledig = invoer.windows.filter((w) => w.isFullYear);
  const entry = (volledig.length > 0 ? volledig : invoer.windows).at(-1);
  if (!entry) throw new Error("geen doorrekenbare periode voor het raster");

  const basis = dispatchBaseline(entry.window, invoer.tariff);

  for (let r = 0; r < capacities.length; r++) {
    if (huidigeGrid !== id) return; // een nieuwere aanvraag heeft voorrang
    const cap = capacities[r]!;
    const points: GridPoint[] = [];

    for (const kw of powers) {
      const spec: BatterySpec = {
        ...invoer.battery,
        capacityKwh: cap,
        maxChargeKw: kw,
        maxDischargeKw: kw,
        wearCostEurPerKwh: wearCostPerKwh(
          config.investmentEur,
          config.cycleLife,
          { ...invoer.battery, capacityKwh: cap },
        ),
      };
      const res = dispatchRolling(entry.window, spec, invoer.tariff);
      let ontladen = 0;
      for (let i = 0; i < res.dischargeKwh.length; i++) ontladen += res.dischargeKwh[i]!;
      points.push({
        capacityKwh: cap,
        powerKw: kw,
        savingEur: basis.totalCostEur - res.totalCostEur,
        cyclesPerYear: equivalentCycles(ontladen, spec),
      });
    }

    post({ type: "grid-row", id, row: r, points, done: r === capacities.length - 1 });
    // Even terug naar de berichtenlus.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Volgnummer van het raster dat nu mag draaien; ouder werk stopt vanzelf. */
let huidigeGrid = -1;

/**
 * De laatste doorrekening, bewaard zodat elke kalenderdag opvraagbaar is zonder
 * opnieuw te rekenen. De dispatch over een heel jaar staat er al; er hoeft
 * alleen een dag uit gesneden te worden.
 */
let laatste: {
  windows: AnalysisInput["windows"];
  dispatches: DispatchResult[];
  spec: BatterySpec;
} | null = null;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      baseUrl = msg.baseUrl;
      manifest = await loadManifest(baseUrl);
      post({ type: "ready", manifest });
      return;
    }
    if (msg.type === "cancel") {
      huidigeGrid = -1;
      return;
    }
    if (msg.type === "grid") {
      if (!manifest) throw new Error("worker is nog niet geïnitialiseerd");
      huidigeGrid = msg.id;
      await runGrid(msg.id, msg.config, msg.capacities, msg.powers);
      return;
    }
    if (msg.type === "day") {
      if (!laatste) throw new Error("er is nog geen doorrekening om een dag uit te halen");
      let dag = null;
      for (let i = 0; i < laatste.windows.length; i++) {
        dag = findDay(
          laatste.windows[i]!.window,
          laatste.dispatches[i]!,
          laatste.spec,
          msg.date,
        );
        if (dag) break;
      }
      post({ type: "day", id: msg.id, day: dag, date: msg.date });
      return;
    }
    if (msg.type === "analyse") {
      if (!manifest) throw new Error("worker is nog niet geïnitialiseerd");
      const t0 = performance.now();
      const invoer = await buildInput(msg.config);
      // De dispatches komen uit dezelfde doorrekening; opnieuw rekenen zou een
      // paar seconden kosten voor iets dat er al is.
      const dispatches: DispatchResult[] = [];
      const result = runAnalysis(invoer, { collectDispatches: dispatches });

      laatste = {
        windows: invoer.windows,
        dispatches,
        spec: {
          ...invoer.battery,
          wearCostEurPerKwh: wearCostPerKwh(
            invoer.investmentEur,
            invoer.cycleLife,
            invoer.battery,
          ),
        },
      };

      post({ type: "result", id: msg.id, result, elapsedMs: performance.now() - t0 });
    }
  } catch (err) {
    post({
      type: "error",
      id:
        msg.type === "analyse" || msg.type === "grid" || msg.type === "day"
          ? msg.id
          : null,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
