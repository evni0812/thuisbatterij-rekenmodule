/**
 * De gedeelde optimalisatiekern: dynamisch programmeren over een SoC-grid.
 *
 * Wordt door twee strategieën gebruikt:
 *   - dispatch-optimal.ts    plant op de WERKELIJKE residual over het hele
 *                            venster: perfect foresight, de bovengrens.
 *   - dispatch-rolling.ts    plant op een VOORSPELDE residual over de bekende
 *                            day-ahead horizon en herplant elke dag: wat een
 *                            echte slimme batterij doet.
 *
 * Plannen en uitvoeren zijn daarom gescheiden. Het plan levert een doel-SoC per
 * kwartier; de uitvoering realiseert dat op de werkelijke residual, binnen de
 * fysieke limieten en met voorrang voor zelfconsumptie.
 *
 * Recursie, met s = lading in de cel en b = AC-zijdige uitwisseling:
 *   g       = residual[t] + b                     (netto netuitwisseling)
 *   kosten  = stepCost(g) + slijtage * max(0,-b)
 *   s'      = s + b*eta   (b > 0)  |  s + b/eta   (b <= 0)
 *   V_t(s)  = min over b van [ kosten + V_{t+1}(s') ]
 *
 * Complexiteit T*N*K met K het aantal bereikbare niveaus per stap.
 */

import {
  maxChargeKwhPerStep,
  maxDischargeKwhPerStep,
  standbyKwhPerStep,
  usableCapacityKwh,
} from "./battery";
import { stepCost } from "./tariff";
import type { BatterySpec, DispatchResult, TariffSpec, Window } from "./types";

/** Ondergrens voor het aantal SoC-niveaus: stappen van 1% van de capaciteit. */
export const DEFAULT_SOC_LEVELS = 101;

/** Bovengrens, om de rekentijd bij extreme verhoudingen te beheersen. */
export const MAX_SOC_LEVELS = 601;

/**
 * Hoeveel gridstappen één kwartier laden of ontladen minstens moet beslaan.
 *
 * Dit is de reden dat het grid niet alleen van de capaciteit mag afhangen. Een
 * grote batterij met een klein vermogen — 15 kWh op 0,8 kW is een gangbare
 * combinatie — verplaatst per kwartier maar 1,3% van zijn capaciteit. Op een
 * grid van 1%-stappen wordt dat naar beneden afgerond op één stap, en gaat er
 * 26% van het laadvermogen verloren in afronding. Het resultaat is dan niet
 * alleen te laag maar ook niet-monotoon: 15 kWh leverde minder op dan 10 kWh.
 */
const MIN_STEPS_PER_TRANSFER = 4;

/**
 * Aantal tussenwaarden waarin het toegestane laad-/ontlaadbereik wordt verdeeld.
 * De uitersten, nul en de residual-dekkende waarde komen daar nog bij.
 */
const ACTION_SUBDIVISIONS = 6;

/**
 * Kies een SoC-grid dat zowel de capaciteit als het vermogen recht doet.
 *
 * @param maxTransferKwh grootste ladingsverandering in de cel per kwartier
 */
export function chooseSocLevels(
  usableKwh: number,
  maxTransferKwh: number,
  requested?: number,
): number {
  if (requested !== undefined) return requested;
  if (usableKwh <= 0 || maxTransferKwh <= 0) return DEFAULT_SOC_LEVELS;
  const needed = Math.ceil((usableKwh * MIN_STEPS_PER_TRANSFER) / maxTransferKwh) + 1;
  return Math.min(MAX_SOC_LEVELS, Math.max(DEFAULT_SOC_LEVELS, needed));
}

/**
 * Plan het optimale SoC-traject over [from, to) op de meegegeven residual.
 *
 * ── Waarom interpolatie ─────────────────────────────────────────────────────
 * Een naïeve DP laat de lading alleen op roosterpunten landen. Dan moet elke
 * laad- of ontlaadstap een geheel aantal gridstappen zijn, en wordt de rest naar
 * beneden afgerond. Hoeveel je daarmee verliest hangt grillig af van de
 * verhouding tussen vermogen en gridstap: bij 15 kWh op 0,8 kW past één kwartier
 * laden in 1,35 gridstappen van 1%, waarvan er maar 1 wordt benut — 26% van het
 * laadvermogen verdwijnt in afronding. Het resultaat is dan niet alleen te laag
 * maar ook niet-monotoon in capaciteit, en een fijner grid helpt niet
 * betrouwbaar: de afrondingsfout springt op en neer met de deelbaarheid.
 *
 * Daarom kiezen we hier de ACTIE (het laad- of ontlaadvermogen) uit een
 * continue verzameling en waarderen we de resulterende lading met lineaire
 * interpolatie tussen de twee omliggende roosterpunten. De vermogenslimieten
 * worden dan exact benut, en de nauwkeurigheid convergeert netjes met het aantal
 * niveaus in plaats van te schommelen.
 *
 * @returns doel-SoC in kWh aan het einde van elk kwartier in het blok
 */
export function planSocPath(
  residual: Float64Array,
  importPrice: Float64Array,
  exportPrice: Float64Array,
  from: number,
  to: number,
  spec: BatterySpec,
  tariff: TariffSpec,
  levels: number,
  socStart: number,
  /**
   * Waardeer lading die aan het einde van het blok overblijft.
   *
   * AAN voor een rollende horizon: het blok is een venster op een langer traject
   * en zonder deze term zou de batterij aan elke horizongrens leeggetrokken
   * worden — een artefact, geen economie.
   *
   * UIT voor het laatste blok van een perfect-foresight run: daar telt alleen
   * wat er werkelijk bespaard is, en restlading is dan gekocht maar nooit
   * gebruikt. Zou je hem toch waarderen, dan optimaliseert de solver naar een
   * doel dat finalize() niet meet en laat hij onderweg kansen liggen.
   */
  valueTerminalSoc = true,
): Float64Array {
  const n = to - from;
  const path = new Float64Array(Math.max(0, n));
  const usable = usableCapacityKwh(spec);
  if (usable <= 0 || n <= 0) return path;

  const stepKwh = usable / (levels - 1);
  const maxIn = maxChargeKwhPerStep(spec);
  const maxOut = maxDischargeKwhPerStep(spec);
  const eta = spec.efficiency;
  const wear = spec.wearCostEurPerKwh;
  const standby = standbyKwhPerStep(spec);
  const curtail = tariff.allowCurtailment;

  let next = new Float64Array(levels);
  let cur = new Float64Array(levels);

  if (valueTerminalSoc) {
    let avgImport = 0;
    for (let t = from; t < to; t++) avgImport += importPrice[t]!;
    avgImport /= n;
    for (let j = 0; j < levels; j++) next[j] = -j * stepKwh * eta * avgImport;
  }

  // De gekozen actie per (stap, niveau), als AC-uitwisseling in kWh.
  const action = new Float64Array(n * levels);
  // Kandidaat-acties in een vooraf gealloceerde buffer: deze lus draait
  // miljoenen keren per jaar, en een groeiende JS-array kost daar meer dan de
  // rekenkunde zelf.
  const cand = new Float64Array(2 * ACTION_SUBDIVISIONS + 4);

  for (let t = to - 1; t >= from; t--) {
    const r = residual[t]!;
    const ip = importPrice[t]!;
    const ep = exportPrice[t]!;
    const local = t - from;

    for (let j = 0; j < levels; j++) {
      const soc = j * stepKwh;
      // Toegestane AC-uitwisseling: begrensd door vermogen én door de ruimte
      // respectievelijk de lading die er is.
      const hi = Math.min(maxIn, (usable - soc) / eta);
      const lo = -Math.min(maxOut, soc * eta);

      let nc = 0;
      cand[nc++] = 0;
      if (hi > 0) cand[nc++] = hi;
      if (lo < 0) cand[nc++] = lo;
      // Precies het overschot opslaan of precies het tekort dekken: die twee
      // punten dragen de zelfconsumptie en verdienen een exacte kandidaat.
      if (r < 0 && -r < hi) cand[nc++] = -r;
      if (r > 0 && -r > lo) cand[nc++] = -r;
      // Een handvol tussenwaarden, zodat ook deelbelading wordt overwogen.
      for (let m = 1; m < ACTION_SUBDIVISIONS; m++) {
        const f = m / ACTION_SUBDIVISIONS;
        if (hi > 0) cand[nc++] = hi * f;
        if (lo < 0) cand[nc++] = lo * f;
      }

      let best = Infinity;
      let bestB = 0;
      for (let c = 0; c < nc; c++) {
        const b = cand[c]!;
        const nextSoc = soc + (b >= 0 ? b * eta : b / eta);
        if (nextSoc < -1e-9 || nextSoc > usable + 1e-9) continue;

        // stepCost() is hier met opzet uitgeschreven: deze regel draait
        // tientallen miljoenen keren per jaar en de aanroep zelf woog mee.
        const g = r + b + standby;
        let cost = g > 0 ? g * ip : g < 0 && !(curtail && ep < 0) ? g * ep : 0;
        if (b < 0) cost -= wear * b;

        // Lineaire interpolatie in de waardefunctie: de lading hoeft niet op een
        // roosterpunt te landen.
        const x = Math.max(0, Math.min(levels - 1, nextSoc / stepKwh));
        const i0 = Math.min(levels - 2, Math.floor(x));
        const frac = x - i0;
        const future = next[i0]! * (1 - frac) + next[i0 + 1]! * frac;

        const total = cost + future;
        if (total < best) {
          best = total;
          bestB = b;
        }
      }
      cur[j] = best;
      action[local * levels + j] = bestB;
    }
    const tmp = next;
    next = cur;
    cur = tmp;
  }

  // Voorwaartse pas: volg de bewaarde acties vanaf de startlading. De lading
  // loopt hier continu, dus we interpoleren ook de actie tussen de twee
  // omliggende roosterpunten.
  let soc = Math.max(0, Math.min(usable, socStart));
  for (let local = 0; local < n; local++) {
    const x = Math.max(0, Math.min(levels - 1, soc / stepKwh));
    const i0 = Math.min(levels - 2, Math.floor(x));
    const frac = x - i0;
    const base = local * levels;
    let b =
      action[base + i0]! * (1 - frac) + action[base + i0 + 1]! * frac;

    // De geïnterpoleerde actie kan de grenzen net overschrijden; knip bij.
    b = Math.min(b, maxIn, (usable - soc) / eta);
    b = Math.max(b, -Math.min(maxOut, soc * eta));

    soc = Math.max(0, Math.min(usable, soc + (b >= 0 ? b * eta : b / eta)));
    path[local] = soc;
  }
  return path;
}

/**
 * Voer een doel-SoC-traject uit op de werkelijke residual.
 *
 * @param adaptToActual  Corrigeer het plan op basis van wat er werkelijk
 *   gebeurt. Aanzetten wanneer het plan op een VOORSPELLING is gemaakt: dan doet
 *   de regelaar wat elke echte omvormer doet — onverwacht overschot alsnog
 *   opslaan (zelfconsumptie gaat voor, terugleveren levert veel minder op) en
 *   nooit méér ontladen dan het tekort vraagt.
 *
 *   Uitzetten bij perfect foresight: het plan is dan al optimaal op de
 *   werkelijke residual, en elke "correctie" maakt het aantoonbaar slechter.
 *   Met correcties aan is het resultaat niet meer monotoon in capaciteit en
 *   vermogen, en kan de rollende strategie er zelfs bovenuit komen — waarmee de
 *   benchmark waardeloos zou zijn.
 *
 * @returns de lading aan het einde van het blok
 */
export function executePath(
  window: Window,
  socTarget: Float64Array,
  from: number,
  to: number,
  spec: BatterySpec,
  tariff: TariffSpec,
  socStart: number,
  out: DispatchResult,
  adaptToActual = true,
): number {
  const usable = usableCapacityKwh(spec);
  const maxIn = maxChargeKwhPerStep(spec);
  const maxOut = maxDischargeKwhPerStep(spec);
  const eta = spec.efficiency;
  const standby = standbyKwhPerStep(spec);
  let soc = socStart;

  for (let t = from; t < to; t++) {
    const local = t - from;
    const r = window.residualKwh[t]! + standby;
    const ep = window.prices.exportPrice[t]!;

    // Gewenste ladingsverandering volgens het plan.
    let dSoc = socTarget[local]! - soc;
    let charge = dSoc > 0 ? dSoc / eta : 0;
    let discharge = dSoc < 0 ? -dSoc * eta : 0;

    if (adaptToActual) {
      if (r < 0) {
        // Overschot: sla op wat past, ook als het plan dat niet voorzag.
        const surplus = -r;
        charge = Math.max(charge, Math.min(surplus, maxIn, (usable - soc) / eta));
        discharge = 0;
      } else if (r > 0) {
        // Tekort: ontlaad hooguit tot het tekort gedekt is.
        discharge = Math.min(discharge, r);
      }
    }

    charge = Math.min(charge, maxIn, (usable - soc) / eta);
    discharge = Math.min(discharge, maxOut, (soc * eta));
    if (charge > 0 && discharge > 0) discharge = 0;

    soc = Math.max(0, Math.min(usable, soc + charge * eta - discharge / eta));

    const g = r + charge - discharge;
    out.chargeKwh[t] = charge;
    out.dischargeKwh[t] = discharge;
    out.socKwh[t] = soc;

    if (g > 0) {
      out.gridImportKwh[t] = g;
      out.gridExportKwh[t] = 0;
      out.curtailedKwh[t] = 0;
    } else {
      const surplus = -g;
      const curtail = tariff.allowCurtailment && ep < 0 ? surplus : 0;
      out.gridImportKwh[t] = 0;
      out.gridExportKwh[t] = surplus - curtail;
      out.curtailedKwh[t] = curtail;
    }
  }
  return soc;
}

/** Leeg resultaat met arrays van de juiste lengte. */
export function emptyResult(n: number): DispatchResult {
  return {
    gridImportKwh: new Float64Array(n),
    gridExportKwh: new Float64Array(n),
    chargeKwh: new Float64Array(n),
    dischargeKwh: new Float64Array(n),
    socKwh: new Float64Array(n),
    curtailedKwh: new Float64Array(n),
    totalCostEur: 0,
    equivalentCycles: 0,
  };
}

/**
 * Vul een resultaat met de ongewijzigde residual load: alles gaat direct het net
 * op of af. Gebruikt wanneer er feitelijk geen batterij is.
 */
export function passThrough(
  window: Window,
  tariff: TariffSpec,
  out: DispatchResult,
): DispatchResult {
  const n = window.residualKwh.length;
  for (let i = 0; i < n; i++) {
    const r = window.residualKwh[i]!;
    if (r > 0) {
      out.gridImportKwh[i] = r;
    } else if (r < 0) {
      const surplus = -r;
      const curtail =
        tariff.allowCurtailment && window.prices.exportPrice[i]! < 0 ? surplus : 0;
      out.gridExportKwh[i] = surplus - curtail;
      out.curtailedKwh[i] = curtail;
    }
  }
  return finalize(window, { ...spec0, wearCostEurPerKwh: 0 }, tariff, out);
}

/** Placeholder-spec voor passThrough: er is geen batterij, dus geen slijtage. */
const spec0 = {
  capacityKwh: 0,
  depthOfCharge: 0,
  maxChargeKw: 0,
  maxDischargeKw: 0,
  efficiency: 1,
  standbyWatt: 0,
  wearCostEurPerKwh: 0,
} satisfies BatterySpec;

/**
 * Tel kosten en cycli op uit de per-kwartier reeksen.
 *
 * ── Waarom slijtage hier NIET meetelt ────────────────────────────────────────
 * De slijtagekosten sturen wel de dispatch: ze zijn de schaduwprijs die bepaalt
 * of een extra cyclus de moeite waard is, en zonder die drempel zou de batterij
 * eindeloos cycelen voor een marginale winst.
 *
 * Maar ze horen niet in de gerapporteerde besparing. Slijtage is niet iets
 * bovenop de aanschafprijs — het IS de aanschafprijs, uitgesmeerd over de
 * cycli. Die prijs staat al als investering in de financiële doorrekening, dus
 * hem hier nog eens aftrekken telt hem twee keer.
 *
 * Het gevolg van die dubbeltelling was zichtbaar: een duurdere batterij kreeg
 * een hogere schaduwprijs en daarmee een lagere gerapporteerde besparing, zodat
 * een FoxESS van 2,1 kWh minder leek op te leveren dan een Zendure van 1,92 kWh.
 * De besparing hier is dus de energiekostenbesparing; wat de batterij kost komt
 * in finance.ts aan bod.
 */
export function finalize(
  window: Window,
  spec: BatterySpec,
  tariff: TariffSpec,
  out: DispatchResult,
): DispatchResult {
  const n = window.residualKwh.length;
  let cost = 0;
  let discharge = 0;
  for (let i = 0; i < n; i++) {
    cost += out.gridImportKwh[i]! * window.prices.importPrice[i]!;
    cost -= out.gridExportKwh[i]! * window.prices.exportPrice[i]!;
    discharge += out.dischargeKwh[i]!;
  }
  out.totalCostEur = cost;
  const usable = usableCapacityKwh(spec);
  out.equivalentCycles = usable > 0 ? discharge / spec.efficiency / usable : 0;
  return out;
}
