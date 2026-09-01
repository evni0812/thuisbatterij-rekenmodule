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
import { runAnalysis, type AnalysisInput } from "../model/analysis";
import { buildResidual } from "../model/residual";
import { buildPriceSeries } from "../model/tariff";
import type { Configuration, WorkerRequest, WorkerResponse } from "./protocol";

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

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      baseUrl = msg.baseUrl;
      manifest = await loadManifest(baseUrl);
      post({ type: "ready", manifest });
      return;
    }
    if (msg.type === "analyse") {
      if (!manifest) throw new Error("worker is nog niet geïnitialiseerd");
      const t0 = performance.now();
      const result = runAnalysis(await buildInput(msg.config));
      post({ type: "result", id: msg.id, result, elapsedMs: performance.now() - t0 });
    }
  } catch (err) {
    post({
      type: "error",
      id: msg.type === "analyse" ? msg.id : null,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
