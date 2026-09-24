/**
 * Rekenworker: laadt de assets en draait de doorrekening buiten de UI-thread.
 *
 * De hele analyse — drie strategieën over meerdere profieljaren plus de
 * besparingscurve — kost enkele seconden. Op de hoofdthread zou dat de pagina
 * laten bevriezen tijdens het slepen van een schuifregelaar.
 */

import { Invoerbron } from "../data/invoer";
import type { Manifest } from "../data/manifest";
import { wearCostPerKwh } from "../model/battery";
import { prijsPerKwhVan, rasterJaar, rasterPunt } from "../model/raster";
import { huishoudenPunt, type HuishoudenPunt, type HuishoudenVariant } from "../model/huishoudens";
import { dispatchBaseline } from "../model/dispatch-baseline";
import { dispatchOptimal } from "../model/dispatch-optimal";
import { dispatchRolling } from "../model/dispatch-rolling";
import { periodeReeks, voegReeksenSamen, type PeriodeReeks } from "../model/periode";
import {
  analyseWindow,
  findDay,
  meetCurvePunt,
  perfectVoorspellingBesparing,
  referentieIndexVan,
  runAnalysis,
  runScenario,
  slijtageVoor,
  voegSamen,
  voegSamenScenario,
  type AnalysisInput,
  type SampleDay,
  type VensterUitkomst,
} from "../model/analysis";
import { dispatchSleutel } from "../cache";
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
/**
 * De initialisatie, als belofte. Elke aanvraag wacht hierop in plaats van te
 * controleren of er al een manifest is.
 *
 * Eerder gooide een worker die een taak kreeg vóór zijn manifest binnen was
 * "worker is nog niet geïnitialiseerd". Dat gebeurde gewoon: de pool verdeelt
 * taken zodra hij ze heeft, en alleen worker 0 meldde zich klaar. Met een
 * trage verbinding voor de helpers faalde zo de hele doorrekening, en omdat
 * de fout buiten `pooltaak` viel kwam er geen `klaar`: de helpers bleven de
 * rest van de sessie bezet. Nu wacht een vroege taak gewoon tot het manifest
 * er is, en faalt hij alleen als de initialisatie zelf faalde.
 */
let initBelofte: Promise<Manifest> | null = null;

/** Wacht tot de worker klaar is voor werk; gooit als de initialisatie mislukte. */
async function klaarVoorWerk(): Promise<void> {
  if (!initBelofte) throw new Error("worker is nog niet geïnitialiseerd");
  await initBelofte;
}

/**
 * Bestanden via de hoofdthread (lib/worker/ophalen.ts): één download voor alle
 * workers. Elk verzoek krijgt een nummer; het antwoord `gehaald` lost de
 * bijbehorende belofte op.
 */
let verzoekTeller = 0;
const openstaand = new Map<number, { los: (r: Response) => void; faal: (e: Error) => void }>();
const viaHoofdthread = (url: string): Promise<Response> =>
  new Promise((los, faal) => {
    const verzoek = ++verzoekTeller;
    openstaand.set(verzoek, { los, faal });
    post({ type: "haal", verzoek, url });
  });

async function buildInput(config: Configuration): Promise<AnalysisInput> {
  return bron.bouwInvoer(config);
}

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

/** De ArrayBuffers van een dispatch, om zonder kopie over te dragen. */
function buffersVan(d: DispatchResult | undefined): ArrayBuffer[] {
  if (!d) return [];
  return [d.gridImportKwh, d.gridExportKwh, d.chargeKwh, d.dischargeKwh, d.socKwh, d.curtailedKwh].map(
    (a) => a.buffer as ArrayBuffer,
  );
}

/**
 * Voer een pooltaak uit en meld daarna altijd `klaar`, ook na een fout: anders
 * blijft de worker in de pool voor altijd bezet.
 */
async function pooltaak(id: number, werk: () => Promise<void>): Promise<void> {
  try {
    await klaarVoorWerk();
    await werk();
  } catch (err) {
    post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  } finally {
    post({ type: "klaar", id });
  }
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
  rijen: number[],
): Promise<void> {
  const invoer = await buildInput(config);
  const entry = rasterJaar(invoer);
  const basis = dispatchBaseline(entry.window, invoer.tariff);
  const prijsPerKwh = prijsPerKwhVan(invoer, config.investmentEur);

  for (let k = 0; k < rijen.length; k++) {
    const r = rijen[k]!;
    const cap = capacities[r]!;
    const points: GridPoint[] = [];
    for (const kw of powers) {
      // Na elk punt terug naar de berichtenlus, niet pas na een rij: een rij is
      // zeven jaarsimulaties, ruim een seconde op een telefoon, en zolang
      // bleef een annulering of een nieuwere aanvraag liggen.
      if (huidigeGrid !== id) return; // een nieuwere aanvraag heeft voorrang
      points.push(
        rasterPunt(
          entry,
          basis,
          invoer.battery,
          invoer.tariff,
          cap,
          kw,
          prijsPerKwh,
          config.cycleLife,
          config.wearFraction ?? 1,
        ),
      );
      await adempauze();
    }
    if (huidigeGrid !== id) return;
    post({ type: "grid-row", id, row: r, points, done: k === rijen.length - 1 });
  }
}

/**
 * De gekozen batterij voor een reeks huishoudens, punt voor punt. Een variant
 * die niet doorrekenbaar is (geen profiel voor dat netgebied) levert null en
 * houdt de rest niet op.
 */
async function runHuishoudens(
  id: number,
  config: Configuration,
  varianten: HuishoudenVariant[],
  indices: number[],
): Promise<void> {
  for (let k = 0; k < indices.length; k++) {
    if (huidigeHuishoudens !== id) return; // een nieuwere aanvraag heeft voorrang
    const index = indices[k]!;
    let punt: HuishoudenPunt | null;
    try {
      punt = await huishoudenPunt(bron, config, varianten[index]!);
    } catch {
      punt = null;
    }
    post({ type: "huishouden-punt", id, index, punt, done: k === indices.length - 1 });
    await adempauze();
  }
}

/**
 * Warm de hoofdworker op voor de dagkiezer, de week en het verloop.
 *
 * Na een treffer in cache of preload heeft deze worker nooit gerekend: de
 * eerste dag- of periodeaanvraag moest dan eerst alle profielen laden en een
 * jaar doorrekenen, ruim een seconde waarin de figuur "wordt opgeteld…" zei
 * over data die er al leek te zijn. Dit doet dat werk vooraf, in stukken met
 * een adempauze ertussen zodat een echte aanvraag er altijd tussendoor kan;
 * die vindt dan wat al klaar is en rekent alleen wat nog ontbreekt.
 *
 * Volgorde: het referentiejaar eerst (daar staan de voorbeelddagen en het
 * verloop opent er), met de realistische dispatch, de basis en het optimum
 * (de dagweergave toont ook het optimum); daarna de andere jaren, alleen
 * realistisch en basis. Een nieuwere aanvraag, een andere configuratie of een
 * `cancel` breekt hem af; wat al gerekend is, blijft staan.
 */
async function warmOp(id: number, config: Configuration): Promise<void> {
  const staat = await zorgVoorInvoer(config);
  const ref = referentieIndexVan(staat.invoer.windows);
  const volgorde = [ref, ...staat.invoer.windows.map((_, i) => i).filter((i) => i !== ref)];
  const nogGeldig = () => huidigeWarm === id && (laatste === staat || vorige === staat);
  for (const i of volgorde) {
    const entry = staat.invoer.windows[i]!;
    if (!nogGeldig()) return;
    if (!staat.dispatches.has(i)) staat.dispatches.set(i, dispatchRolling(entry.window, staat.spec, staat.invoer.tariff));
    await adempauze();
    if (!nogGeldig()) return;
    if (!staat.basis.has(i)) staat.basis.set(i, dispatchBaseline(entry.window, staat.invoer.tariff));
    await adempauze();
    if (i !== ref) continue;
    if (!nogGeldig()) return;
    if (!staat.optimaal.has(i)) staat.optimaal.set(i, dispatchOptimal(entry.window, staat.spec, staat.invoer.tariff));
    await adempauze();
  }
}

/** De berichten die als pooltaak lopen: de pool wacht op hun `klaar`. */
const POOLTAKEN = new Set<WorkerRequest["type"]>([
  "grid",
  "huishoudens",
  "venster",
  "quick",
  "perfect",
  "voegSamen",
  "voegSamenScenario",
]);

/** Volgnummer van het raster dat nu mag draaien; ouder werk stopt vanzelf. */
let huidigeGrid = -1;
/** Volgnummer van de opwarming die nu mag doorlopen. */
let huidigeWarm = -1;
/** Idem voor de huishoudens. */
let huidigeHuishoudens = -1;
/**
 * Volgnummers van de laatst ontvangen dag-, periode- en scenario-aanvraag.
 *
 * Berichten stapelen zich op als de UI sneller vraagt dan de worker rekent.
 * Elke aanvraag registreert eerst zijn nummer en geeft dan de beurt terug aan
 * de berichtenlus; de aanvragen die al in de wachtrij stonden registreren zich
 * dan ook. Wie daarna niet meer de laatste is, doet niets. Zo kost een reeks
 * van twintig aanvragen één berekening in plaats van twintig.
 */
let huidigeDag = -1;
/** Per kanaal een eigen volgnummer: anders annuleert de week het verloop. */
const huidigePeriode: Record<string, number> = { verloop: -1, week: -1 };
let huidigScenario = -1;

/** Geef de beurt terug aan de berichtenlus, zodat wachtende berichten binnenkomen. */
function adempauze(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
interface Doorrekening {
  sleutel: string;
  invoer: AnalysisInput;
  spec: BatterySpec;
  /** Realistische dispatch per venster-index; leeg tot hij nodig is. */
  dispatches: Map<number, DispatchResult>;
  /** Perfect-foresight dispatch per venster-index, voor de vergelijking. */
  optimaal: Map<number, DispatchResult>;
  /** Dispatch zonder batterij per venster-index; goedkoop, maar niet gratis. */
  basis: Map<number, DispatchResult>;
}
let laatste: Doorrekening | null = null;
/**
 * De doorrekening vóór `laatste`. Een uitstapje — een dag opvragen voor een
 * andere configuratie — mag de dispatches van het hoofdresultaat niet wissen,
 * anders moet het volgende dagje uit dat hoofdresultaat weer een halve seconde
 * rekenen. Twee slots is genoeg: de getoonde en de vorige.
 */
let vorige: Doorrekening | null = null;

/**
 * Onderscheidt configuraties die tot een andere dispatch leiden. Financiële
 * velden (looptijd, rente, prijsstijging, degradatie, restwaarde, jaaropwek)
 * tellen niet mee: daarvoor hoeft geen dag opnieuw gerekend te worden.
 */
const configSleutel = dispatchSleutel;

/**
 * Zorg dat er dispatches zijn die bij deze configuratie horen.
 *
 * Bij een treffer verandert er niets. Anders wordt de invoer opnieuw opgebouwd
 * met dezelfde slijtageprijs als drempel als in `runAnalysis` — anders zou de
 * dagweergave een andere batterij tonen dan de cijfers erboven.
 */
async function zorgVoorInvoer(config: Configuration): Promise<Doorrekening> {
  const sleutel = configSleutel(config);
  if (laatste && laatste.sleutel === sleutel) return laatste;
  if (vorige && vorige.sleutel === sleutel) {
    // Terug naar de vorige configuratie: wissel de slots, niets weggooien.
    const t = laatste;
    laatste = vorige;
    vorige = t;
    return laatste;
  }

  // Twee aanvragen voor dezelfde nieuwe configuratie (de opwarming en een dag)
  // bouwen de invoer één keer, en krijgen hetzelfde slot.
  const lopend = inOpbouw.get(sleutel);
  if (lopend) return lopend;
  const opbouw = (async () => {
    const invoer = await buildInput(config);
    const staat: Doorrekening = {
      sleutel,
      invoer,
      spec: {
        ...invoer.battery,
        wearCostEurPerKwh:
          wearCostPerKwh(invoer.investmentEur, invoer.cycleLife, invoer.battery) *
          (invoer.wearFraction ?? 1),
      },
      dispatches: new Map(),
      optimaal: new Map(),
      basis: new Map(),
    };
    // Kwam het slot intussen via een samenvoeging binnen, dan wint dat: daar
    // staan de dispatches al in.
    if (laatste && laatste.sleutel === sleutel) return laatste;
    vorige = laatste;
    laatste = staat;
    return staat;
  })();
  inOpbouw.set(sleutel, opbouw);
  try {
    return await opbouw;
  } finally {
    inOpbouw.delete(sleutel);
  }
}
const inOpbouw = new Map<string, Promise<Doorrekening>>();

/** Zoek de dag op, en reken het jaar waarin hij valt door als dat nog moet. */
function haalDag(
  staat: Doorrekening,
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
      wearCostPerKwh(staat.invoer.investmentEur, staat.invoer.cycleLife, staat.invoer.battery),
    );
    if (dag) return dag;
  }
  return null;
}

/**
 * Tel de dispatch op over een periode. Alleen de jaren die de periode raken
 * worden (zo nodig) doorgerekend; een week over een jaargrens komt uit twee.
 */
function haalPeriode(
  staat: Doorrekening,
  van: string,
  tot: string,
  resolutie: Parameters<typeof periodeReeks>[7],
): PeriodeReeks {
  const wear = wearCostPerKwh(staat.invoer.investmentEur, staat.invoer.cycleLife, staat.invoer.battery);
  const delen: PeriodeReeks[] = [];
  for (let i = 0; i < staat.invoer.windows.length; i++) {
    const entry = staat.invoer.windows[i]!;
    if (entry.lastDay < van || entry.firstDay > tot) continue;
    let real = staat.dispatches.get(i);
    if (!real) {
      real = dispatchRolling(entry.window, staat.spec, staat.invoer.tariff);
      staat.dispatches.set(i, real);
    }
    let base = staat.basis.get(i);
    if (!base) {
      base = dispatchBaseline(entry.window, staat.invoer.tariff);
      staat.basis.set(i, base);
    }
    delen.push(periodeReeks(entry.window, base, real, staat.spec, wear, van, tot, resolutie));
  }
  return voegReeksenSamen(delen, resolutie, van, tot);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "gehaald") {
    const wacht = openstaand.get(msg.verzoek);
    openstaand.delete(msg.verzoek);
    if (!wacht) return;
    if (msg.buffer) wacht.los(new Response(msg.buffer));
    else wacht.faal(new Error(msg.fout ?? "kon het bestand niet laden"));
    return;
  }
  try {
    if (msg.type === "init") {
      bron = new Invoerbron(msg.baseUrl, msg.viaHoofdthread ? viaHoofdthread : fetch);
      initBelofte = bron.init();
      const manifest = await initBelofte;
      post({ type: "ready", manifest });
      return;
    }
    if (msg.type === "cancel") {
      huidigeGrid = -1;
      huidigeHuishoudens = -1;
      huidigScenario = -1;
      huidigeWarm = -1;
      return;
    }
    if (msg.type === "warm") {
      huidigeWarm = msg.id;
      await klaarVoorWerk();
      await adempauze();
      if (huidigeWarm !== msg.id) return;
      await warmOp(msg.id, msg.config);
      return;
    }
    if (msg.type === "huishoudens") {
      huidigeHuishoudens = msg.id;
      await pooltaak(msg.id, () => runHuishoudens(msg.id, msg.config, msg.varianten, msg.indices));
      return;
    }
    if (msg.type === "grid") {
      huidigeGrid = msg.id;
      const rijen = msg.rijen ?? msg.capacities.map((_, i) => i);
      await pooltaak(msg.id, () => runGrid(msg.id, msg.config, msg.capacities, msg.powers, rijen));
      return;
    }
    if (msg.type === "venster") {
      await pooltaak(msg.id, async () => {
        const invoer = await bron.bouwInvoer(msg.config, { alleenVenster: msg.jaarIndex });
        const { spec, volleSlijtage } = slijtageVoor(invoer);
        const uitkomst: VensterUitkomst = analyseWindow(invoer.windows[0]!, spec, invoer.tariff, {
          metOptimum: msg.metOptimum,
          wearEurPerKwh: volleSlijtage,
        });
        post(
          { type: "venster-uitkomst", id: msg.id, groep: msg.groep, jaarIndex: msg.jaarIndex, uitkomst },
          [...buffersVan(uitkomst.realistic), ...buffersVan(uitkomst.optimal)],
        );
      });
      return;
    }
    if (msg.type === "quick") {
      await pooltaak(msg.id, async () => {
        const invoer = await bron.bouwInvoer(msg.config, { alleenVenster: msg.jaarIndex });
        const { spec } = slijtageVoor(invoer);
        const basis = dispatchBaseline(invoer.windows[0]!.window, invoer.tariff);
        const meting = meetCurvePunt(invoer, spec, 0, msg.fraction, basis.totalCostEur);
        post({ type: "quick", id: msg.id, groep: msg.groep, meting });
      });
      return;
    }
    if (msg.type === "perfect") {
      await pooltaak(msg.id, async () => {
        const invoer = await bron.bouwInvoer(msg.config, { alleenVenster: msg.jaarIndex });
        const { spec } = slijtageVoor(invoer);
        const basis = dispatchBaseline(invoer.windows[0]!.window, invoer.tariff);
        const besparing = perfectVoorspellingBesparing(invoer.windows[0]!, spec, invoer.tariff, basis.totalCostEur);
        post({ type: "perfect", id: msg.id, groep: msg.groep, besparing });
      });
      return;
    }
    if (msg.type === "voegSamen") {
      await pooltaak(msg.id, async () => {
        const t0 = performance.now();
        const invoer = await buildInput(msg.config);
        const result = voegSamen(invoer, msg.uitkomsten, msg.metingen, msg.perfect);
        // De dispatches komen uit dezelfde doorrekening; de dagkiezer moet
        // dezelfde drempel gebruiken als de doorrekening zelf.
        vorige = laatste;
        laatste = {
          sleutel: configSleutel(msg.config),
          invoer,
          spec: slijtageVoor(invoer).spec,
          dispatches: new Map(msg.uitkomsten.map((u, i) => [i, u.realistic])),
          optimaal: new Map(
            msg.uitkomsten.flatMap((u, i): [number, DispatchResult][] => (u.optimal ? [[i, u.optimal]] : [])),
          ),
          basis: new Map(),
        };
        post({ type: "result", id: msg.id, result, elapsedMs: performance.now() - t0 });
      });
      return;
    }
    if (msg.type === "voegSamenScenario") {
      await pooltaak(msg.id, async () => {
        const invoer = await buildInput(msg.config);
        post({ type: "scenario", id: msg.id, result: voegSamenScenario(invoer, msg.uitkomsten, msg.metingen) });
      });
      return;
    }
    if (msg.type === "day") {
      huidigeDag = msg.id;
      await klaarVoorWerk();
      await adempauze();
      if (huidigeDag !== msg.id) return; // er ligt al een nieuwere aanvraag
      const staat = await zorgVoorInvoer(msg.config);
      post({ type: "day", id: msg.id, day: haalDag(staat, msg.date), date: msg.date });
      return;
    }
    if (msg.type === "periode") {
      huidigePeriode[msg.kanaal] = msg.id;
      await klaarVoorWerk();
      await adempauze();
      if (huidigePeriode[msg.kanaal] !== msg.id) return;
      const staat = await zorgVoorInvoer(msg.config);
      post({
        type: "periode",
        id: msg.id,
        kanaal: msg.kanaal,
        periode: haalPeriode(staat, msg.van, msg.tot, msg.resolutie),
      });
      return;
    }
    if (msg.type === "analyse") {
      await klaarVoorWerk();
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
      vorige = laatste;
      laatste = {
        sleutel: configSleutel(msg.config),
        invoer,
        spec: {
          ...invoer.battery,
          wearCostEurPerKwh:
            wearCostPerKwh(invoer.investmentEur, invoer.cycleLife, invoer.battery) *
            (invoer.wearFraction ?? 1),
        },
        dispatches: new Map(dispatches.map((d, i) => [i, d])),
        optimaal: new Map(optimaal.map((d, i) => [i, d])),
        basis: new Map(),
      };

      post({ type: "result", id: msg.id, result, elapsedMs: performance.now() - t0 });
      return;
    }
    if (msg.type === "scenario") {
      // Een tweede volledige doorrekening met een andere tariefopbouw. Hij raakt
      // `laatste` bewust niet aan: de dagkiezer hoort bij het hoofdresultaat, en
      // die zou anders stilletjes op het scenario gaan wijzen.
      huidigScenario = msg.id;
      await klaarVoorWerk();
      await adempauze();
      // Een annulering of een nieuwere aanvraag die intussen binnenkwam wint.
      if (huidigScenario !== msg.id) return;
      const invoer = await buildInput(msg.config);
      // Zonder optimum, voorbeelddagen en gat: de pagina leest daar niets van
      // in het scenario, en het scheelt vijf jaarsimulaties.
      post({ type: "scenario", id: msg.id, result: runScenario(invoer) });
    }
  } catch (err) {
    post({
      type: "error",
      id: "id" in msg ? msg.id : null,
      message: err instanceof Error ? err.message : String(err),
    });
    // Een pooltaak die hier belandt (buiten `pooltaak` om misgegaan) moet de
    // worker toch vrijgeven, anders blijft hij de hele sessie bezet.
    if ("id" in msg && POOLTAKEN.has(msg.type)) post({ type: "klaar", id: msg.id });
  }
};
