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
import { marginalWearCostPerKwh } from "../model/battery";
import { dispatchBaseline } from "../model/dispatch-baseline";
import { dispatchOptimal } from "../model/dispatch-optimal";
import { dispatchRolling } from "../model/dispatch-rolling";
import {
  findDay,
  runAnalysis,
  type AnalysisInput,
  type SampleDay,
} from "../model/analysis";
import {
  buildResidualParts,
  GEEN_SCHALING,
  solveNettingScale,
  type NettingScale,
} from "../model/residual";
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

/** Het meest recente jaar waarvoor er prijzen zijn. */
function laatstePrijsjaar(m: Manifest): string {
  return Object.keys(m.prijzen).sort().at(-1)!;
}

/**
 * Schaalfactoren voor het netten, per netgebied en per stel jaarvolumes.
 *
 * Gebufferd, want de oplossing kost een tiental passes over een jaar en het
 * antwoord verandert alleen als het netgebied of de meterstanden veranderen —
 * niet als de gebruiker aan de batterij schuift.
 */
const scaleCache = new Map<string, NettingScale>();

async function nettingScaleFor(
  m: Manifest,
  config: Configuration,
): Promise<NettingScale> {
  const hh = config.household;
  const key = `${config.domain}:${hh.annualGridImportKwh}:${hh.annualGridExportKwh}`;
  const hit = scaleCache.get(key);
  if (hit) return hit;

  const jaren = Object.entries(m.profielen[config.domain] ?? {})
    .filter(([, info]) => info.volledig_jaar)
    .map(([y]) => Number(y))
    .sort((a, b) => b - a);
  // Zonder vol jaar valt er niets betrouwbaars op te lossen; dan blijft de
  // reeks ongeschaald en komen de volumes onder de meterstanden uit.
  if (jaren.length === 0) return GEEN_SCHALING;

  const prof = await getProfile(config.domain, jaren[0]!);
  const scale = solveNettingScale(prof.importFraction, prof.exportFraction, hh);
  scaleCache.set(key, scale);
  return scale;
}

async function buildInput(config: Configuration): Promise<AnalysisInput> {
  const m = manifest!;
  const jaren = yearsInRange(m, config.domain, config.from, config.to);
  if (jaren.length === 0) {
    throw new Error(
      `geen profieldata voor netgebied ${config.domain} tussen ${config.from} en ${config.to}`,
    );
  }

  // De schaalfactoren die de genette reeks op de meterstanden laten uitkomen
  // worden op één VOL kalenderjaar bepaald en voor alle jaren gebruikt, ook de
  // deeljaren. Een deeljaar zou anders de jaartotalen in een deel van het jaar
  // proppen. Het meest recente volle jaar is het representatiefst.
  const schaling = await nettingScaleFor(m, config);

  // Zonder historische heffing rekenen we met de heffing van nu: die van het
  // meest recente prijsjaar in de data, tenzij de gebruiker er zelf een opgaf.
  const actueleHeffing =
    config.tariff.energyTaxEurPerKwh > 0
      ? config.tariff.energyTaxEurPerKwh
      : m.prijzen[laatstePrijsjaar(m)]!.jaarconstante_eur_per_kwh;

  const windows: AnalysisInput["windows"] = [];
  for (const year of jaren) {
    const prof = await getProfile(config.domain, year);
    const price = await getPrice(year);
    const { start, end, firstDay, lastDay } = sliceRange(prof, config.from, config.to);
    if (end <= start) continue;

    const startMs = prof.startMs.slice(start, end);
    const market = expandPricesToQuarters(startMs, price, "market");

    // Standaard rekenen we met de heffing zoals die op elk uur werkelijk gold:
    // allInPrijs minus marktprijs, per uur, want binnen een jaar verschuift hij
    // (2025: 17,13 ct tot september, daarna 14,29 ct). Dat maakt de uitkomst
    // een tegenfeitelijke doorrekening van wat er echt gebeurd is.
    //
    // Met de heffing van nu wordt dezelfde vraag naar het heden getrokken: wat
    // had deze batterij opgeleverd op de prijzen van toen, maar met de
    // belasting en opslag van vandaag. Dat is wat een koper wil weten.
    let heffing: Float64Array;
    if (config.useHistoricalLevy) {
      const allIn = expandPricesToQuarters(startMs, price, "allIn");
      heffing = new Float64Array(market.length);
      for (let i = 0; i < heffing.length; i++) heffing[i] = allIn[i]! - market[i]!;
    } else {
      heffing = new Float64Array(market.length).fill(actueleHeffing);
    }

    const delen = buildResidualParts(
      prof.importFraction.slice(start, end),
      prof.exportFraction.slice(start, end),
      config.household,
      startMs,
      schaling,
    );

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
        residualKwh: delen.residualKwh,
        parts: {
          gridImportKwh: delen.gridImportKwh,
          gridExportKwh: delen.gridExportKwh,
        },
        prices: buildPriceSeries(market, config.tariff, heffing),
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
    annualProductionKwh: config.annualProductionKwh,
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

    // De investering schaalt mee met de capaciteit: een batterij van 20 kWh kost
    // niet hetzelfde als de gekozen batterij van 2 kWh. Zonder die correctie
    // kreeg elke maat de prijs van de gekozen batterij, en werd een grote
    // batterij vrijwel zonder slijtagedrempel doorgerekend.
    const prijsPerKwh =
      invoer.battery.capacityKwh > 0
        ? config.investmentEur / invoer.battery.capacityKwh
        : 0;

    for (const kw of powers) {
      const zonderDrempel: BatterySpec = {
        ...invoer.battery,
        capacityKwh: cap,
        maxChargeKw: kw,
        maxDischargeKw: kw,
        wearCostEurPerKwh: 0,
      };
      // Eerst zonder drempel: dat vertelt of de beurten voor deze maat schaars
      // zijn. Zijn ze dat niet, dan is de drempel nul en ís deze run al het
      // antwoord. Alleen bij schaarste volgt een tweede run mét drempel. Zo
      // kost het raster in de regel één doorrekening per punt in plaats van
      // twee — en bij de presets zijn de beurten bijna nooit schaars.
      const vrij = dispatchRolling(entry.window, zonderDrempel, invoer.tariff);
      const wear = marginalWearCostPerKwh(
        prijsPerKwh * cap,
        config.cycleLife,
        zonderDrempel,
        vrij.equivalentCycles,
        config.analysisYears,
      );
      const res =
        wear > 0
          ? dispatchRolling(entry.window, { ...zonderDrempel, wearCostEurPerKwh: wear }, invoer.tariff)
          : vrij;
      points.push({
        capacityKwh: cap,
        powerKw: kw,
        savingEur: basis.totalCostEur - res.totalCostEur,
        cyclesPerYear: res.equivalentCycles,
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
 *
 * ── Waarom hier een sleutel bij hoort ───────────────────────────────────────
 * Een resultaat kan ook uit de browsercache komen. Dan heeft de worker nooit
 * gerekend en stond hier `null`, waardoor élke dagaanvraag afketste op "er is
 * nog geen doorrekening" — en die fout werd in de UI stilzwijgend genegeerd,
 * want hij hoorde bij een ander volgnummer dan de lopende analyse. Voor de
 * gebruiker deed de dagkiezer dus gewoon niets, en juist na een refresh, want
 * dan komt het resultaat altijd uit de cache.
 *
 * Nu weet de worker bij welke configuratie zijn dispatches horen en kan hij ze
 * alsnog maken als ze ontbreken. Per jaar, en alleen het jaar dat gevraagd
 * wordt: dat is één doorrekening van ruim 400 ms in plaats van de volle analyse.
 */
let laatste: {
  sleutel: string;
  invoer: AnalysisInput;
  spec: BatterySpec;
  /** Realistische dispatch per venster-index; leeg tot hij nodig is. */
  dispatches: Map<number, DispatchResult>;
  /** Perfect-foresight dispatch per venster-index, voor de vergelijking. */
  optimaal: Map<number, DispatchResult>;
} | null = null;

/** Onderscheidt configuraties die tot een andere dispatch leiden. */
function configSleutel(config: Configuration): string {
  return JSON.stringify(config);
}

/**
 * Zorg dat er dispatches zijn die bij deze configuratie horen.
 *
 * Bij een treffer verandert er niets. Anders wordt de invoer opnieuw opgebouwd
 * en de slijtagedrempel opnieuw bepaald, op dezelfde manier als in
 * `runAnalysis` — anders zou de dagweergave een andere batterij tonen dan de
 * cijfers erboven.
 */
async function zorgVoorInvoer(config: Configuration): Promise<NonNullable<typeof laatste>> {
  const sleutel = configSleutel(config);
  if (laatste && laatste.sleutel === sleutel) return laatste;

  const invoer = await buildInput(config);
  const zonderDrempel: BatterySpec = { ...invoer.battery, wearCostEurPerKwh: 0 };
  const proef = invoer.windows.find((w) => w.isFullYear) ?? invoer.windows[0];
  let verwachteCycli = 0;
  const dispatches = new Map<number, DispatchResult>();
  if (proef) {
    const p = dispatchRolling(proef.window, zonderDrempel, invoer.tariff);
    verwachteCycli = p.equivalentCycles;
    // Is de drempel nul, dan ís deze run de realistische dispatch van dat jaar.
    const idx = invoer.windows.indexOf(proef);
    dispatches.set(idx, p);
  }
  const wear = marginalWearCostPerKwh(
    invoer.investmentEur,
    invoer.cycleLife,
    invoer.battery,
    verwachteCycli,
    invoer.years,
  );
  if (wear > 0) dispatches.clear();

  laatste = {
    sleutel,
    invoer,
    spec: { ...invoer.battery, wearCostEurPerKwh: wear },
    dispatches,
    optimaal: new Map(),
  };
  return laatste;
}

/** Zoek de dag op, en reken het jaar waarin hij valt door als dat nog moet. */
function haalDag(
  staat: NonNullable<typeof laatste>,
  isoDate: string,
): SampleDay | null {
  for (let i = 0; i < staat.invoer.windows.length; i++) {
    const entry = staat.invoer.windows[i]!;
    // De vensters weten hun eigen bereik; alleen het jaar dat de datum bevat
    // hoeft gerekend te worden.
    if (isoDate < entry.firstDay || isoDate > entry.lastDay) continue;

    let real = staat.dispatches.get(i);
    if (!real) {
      real = dispatchRolling(entry.window, staat.spec, staat.invoer.tariff);
      staat.dispatches.set(i, real);
    }
    let opt = staat.optimaal.get(i);
    if (!opt) {
      opt = dispatchOptimal(entry.window, staat.spec, staat.invoer.tariff);
      staat.optimaal.set(i, opt);
    }
    const dag: SampleDay | null = findDay(
      entry.window,
      real,
      staat.spec,
      staat.invoer.tariff,
      isoDate,
      opt,
    );
    if (dag) return dag;
  }
  return null;
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
      if (!manifest) throw new Error("worker is nog niet geïnitialiseerd");
      const staat = await zorgVoorInvoer(msg.config);
      post({ type: "day", id: msg.id, day: haalDag(staat, msg.date), date: msg.date });
      return;
    }
    if (msg.type === "analyse") {
      if (!manifest) throw new Error("worker is nog niet geïnitialiseerd");
      const t0 = performance.now();
      const invoer = await buildInput(msg.config);
      // De dispatches komen uit dezelfde doorrekening; opnieuw rekenen zou een
      // paar seconden kosten voor iets dat er al is.
      const dispatches: DispatchResult[] = [];
      const optimaal: DispatchResult[] = [];
      const result = runAnalysis(invoer, {
        collectDispatches: dispatches,
        collectOptimal: optimaal,
      });

      // De dagkiezer moet dezelfde drempel gebruiken als de doorrekening zelf.
      const laatsteCycli = result.stats.cyclesPerYear;
      laatste = {
        sleutel: configSleutel(msg.config),
        invoer,
        spec: {
          ...invoer.battery,
          wearCostEurPerKwh: marginalWearCostPerKwh(
            invoer.investmentEur,
            invoer.cycleLife,
            invoer.battery,
            laatsteCycli,
            invoer.years,
          ),
        },
        dispatches: new Map(dispatches.map((d, i) => [i, d])),
        optimaal: new Map(optimaal.map((d, i) => [i, d])),
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
