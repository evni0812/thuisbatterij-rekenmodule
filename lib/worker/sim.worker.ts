/**
 * Rekenworker: laadt de assets en draait de doorrekening buiten de UI-thread.
 *
 * De hele analyse — drie strategieën over meerdere profieljaren plus de
 * besparingscurve — kost enkele seconden. Op de hoofdthread zou dat de pagina
 * laten bevriezen tijdens het slepen van een schuifregelaar.
 */

import { Invoerbron } from "../data/invoer";
import type { Manifest } from "../data/manifest";
import {
  marginalWearCostPerKwh,
  wearCostPerKwh,
  WEAR_ONDERGRENS_DEEL,
} from "../model/battery";
import { dispatchBaseline } from "../model/dispatch-baseline";
import { dispatchOptimal } from "../model/dispatch-optimal";
import { dispatchRolling } from "../model/dispatch-rolling";
import {
  findDay,
  runAnalysis,
  type AnalysisInput,
  type SampleDay,
} from "../model/analysis";
import type { BatterySpec, DispatchResult } from "../model/types";
import type {
  Configuration,
  GridPoint,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

/**
 * De invoerbron leeft zolang de worker leeft, zodat geladen profielen, prijzen
 * en schaalfactoren tussen aanvragen bewaard blijven.
 */
let bron = new Invoerbron();
let manifest: Manifest | null = null;

async function buildInput(config: Configuration): Promise<AnalysisInput> {
  return bron.bouwInvoer(config);
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
      const maat: BatterySpec = {
        ...invoer.battery,
        capacityKwh: cap,
        maxChargeKw: kw,
        maxDischargeKw: kw,
        wearCostEurPerKwh: 0,
      };
      // Eerst met de ondergrens: dat vertelt of de beurten voor deze maat
      // schaars zijn. Zijn ze dat niet, dan blijft de drempel op die ondergrens
      // staan en ís deze run al het antwoord. Alleen bij schaarste volgt een
      // tweede run met een hogere drempel. Zo kost het raster in de regel één
      // doorrekening per punt in plaats van twee.
      const ondergrens =
        wearCostPerKwh(prijsPerKwh * cap, config.cycleLife, maat) *
        WEAR_ONDERGRENS_DEEL;
      const vrij = dispatchRolling(
        entry.window,
        { ...maat, wearCostEurPerKwh: ondergrens },
        invoer.tariff,
      );
      const wear = marginalWearCostPerKwh(
        prijsPerKwh * cap,
        config.cycleLife,
        maat,
        vrij.equivalentCycles,
        config.calendarLifeYears,
      );
      const res =
        wear > ondergrens + 1e-12
          ? dispatchRolling(entry.window, { ...maat, wearCostEurPerKwh: wear }, invoer.tariff)
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
  const ondergrens =
    wearCostPerKwh(invoer.investmentEur, invoer.cycleLife, invoer.battery) *
    WEAR_ONDERGRENS_DEEL;
  const metOndergrens: BatterySpec = {
    ...invoer.battery,
    wearCostEurPerKwh: ondergrens,
  };
  const proef = invoer.windows.find((w) => w.isFullYear) ?? invoer.windows[0];
  let verwachteCycli = 0;
  const dispatches = new Map<number, DispatchResult>();
  if (proef) {
    const p = dispatchRolling(proef.window, metOndergrens, invoer.tariff);
    verwachteCycli = p.equivalentCycles;
    // Blijft de drempel op de ondergrens, dan ís deze run de realistische
    // dispatch van dat jaar en hoeft hij niet opnieuw.
    const idx = invoer.windows.indexOf(proef);
    dispatches.set(idx, p);
  }
  const wear = marginalWearCostPerKwh(
    invoer.investmentEur,
    invoer.cycleLife,
    invoer.battery,
    verwachteCycli,
    invoer.calendarLifeYears,
  );
  if (wear > ondergrens + 1e-12) dispatches.clear();

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
      bron = new Invoerbron(msg.baseUrl);
      manifest = await bron.init();
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
