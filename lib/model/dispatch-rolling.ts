/**
 * Realistische strategie: rollende horizon-optimalisatie.
 *
 * Dit is wat een moderne slimme thuisbatterij daadwerkelijk doet. Hij maakt een
 * plan voor de periode waarvan hij de prijzen kent, voert daar een stukje van
 * uit, en herplant met bijgewerkte lading en een verse verbruiksverwachting.
 *
 * Kennis die de strategie WEL heeft:
 *   - de day-ahead prijzen, tot het einde van morgen in lokale tijd
 *   - de eigen lading, op elk herplanmoment
 * Kennis die hij NIET heeft:
 *   - het werkelijke toekomstige verbruik en de werkelijke opwek; daarvoor
 *     gebruikt hij een voorspelling uit de voorgaande dagen
 *
 * De EPEX day-ahead veiling sluit om 12:00 lokaal en publiceert rond 13:00 de
 * prijzen voor de hele volgende kalenderdag in Nederlandse lokale tijd. Vóór dat
 * moment reikt de horizon tot vanavond 24:00, daarna tot morgen 24:00 — alles
 * bepaald in lokale tijd, want de UTC-grens schuift met de zomertijd mee.
 *
 * Het verschil met dispatch-optimal is precies wat onvolmaakte informatie kost:
 * dezelfde solver, dezelfde batterij, alleen minder kennis.
 *
 * ── Waarom vaak herplannen ──────────────────────────────────────────────────
 * Met één plan per dag werkt de batterij een hele dag door op een voorspelling
 * die er al vroeg naast kan zitten. Meer vermogen vergroot dan de fout in plaats
 * van de opbrengst, waardoor 3,6 kW minder kan opleveren dan 2,4 kW. Door elke
 * paar uur te herplannen — wat echte systemen zelfs elke paar minuten doen —
 * corrigeert de strategie zichzelf zodra de werkelijkheid afwijkt.
 */

import {
  maxChargeKwhPerStep,
  maxDischargeKwhPerStep,
  usableCapacityKwh,
} from "./battery";
import { LocalTimeIndex } from "../data/timeaxis";
import {
  chooseSocLevels,
  emptyResult,
  executePath,
  finalize,
  passThrough,
  planSocPath,
} from "./solver";
import type { BatterySpec, DispatchResult, TariffSpec, Window } from "./types";

/** Uur waarop de day-ahead prijzen voor morgen bekend worden (lokale tijd). */
export const DAY_AHEAD_PUBLICATION_HOUR = 13;

/** Aantal voorgaande dagen waarover het verbruik wordt voorspeld. */
const FORECAST_WINDOW_DAYS = 7;

/**
 * Standaard wordt één keer per etmaal herpland, op het publicatie-uur, zodat
 * elk plan de verse day-ahead prijzen meeneemt en een horizon van ruim 30 uur
 * heeft.
 *
 * Dat moment wordt elke dag opnieuw in lokale tijd opgezocht, niet als "96
 * kwartieren verder". Een etmaal is niet altijd 96 kwartieren: op de dag dat de
 * klok teruggaat zijn het er 100, en wie dan 96 optelt komt op 12:00 uit — vóór
 * de publicatie. Elk plan daarna zag alleen nog de prijzen tot middernacht en
 * nooit meer die van morgen. Voor een venster dat in de zomertijd begon
 * scheelde dat 3% van de besparing over het najaar.
 *
 * Vaker herplannen is gemeten niet beter: van eens per dag tot elk kwartier
 * blijft de restdip in de monotonie rond 1%. Het kost alleen evenredig meer
 * rekentijd — elk kwartier herplannen maakt de doorrekening zes keer zo traag
 * zonder iets op te leveren. De voorspelfout, niet de planfrequentie, is wat de
 * strategie beperkt.
 */
export interface RollingOptions {
  socLevels?: number;
  /**
   * Vast herplaninterval in kwartieren, voor experimenten. Zonder deze optie
   * wordt op elk publicatie-uur herpland.
   */
  replanSteps?: number;
  /** Plan op de werkelijke residual in plaats van op een voorspelling. */
  perfectForecast?: boolean;
}

/**
 * Indices van de kwartieren waarop de day-ahead prijzen binnenkomen: het eerste
 * kwartier van het publicatie-uur, elke lokale dag.
 */
export function publicationMoments(
  startMs: Float64Array,
  index: LocalTimeIndex,
): number[] {
  const uit: number[] = [];
  let vorigUur = -1;
  for (let i = 0; i < startMs.length; i++) {
    const uur = index.localHour(startMs[i]!);
    if (uur === DAY_AHEAD_PUBLICATION_HOUR && vorigUur !== DAY_AHEAD_PUBLICATION_HOUR) {
      uit.push(i);
    }
    vorigUur = uur;
  }
  return uit;
}

/**
 * Startindex van elke lokale kalenderdag in de reeks.
 *
 * Dagen worden in lokale tijd afgebakend, niet in UTC: anders schuiven de
 * herplanmomenten 's zomers een uur op en vallen de DST-dagen verkeerd.
 */
export function localDayStarts(
  startMs: Float64Array,
  index: LocalTimeIndex,
): number[] {
  const starts: number[] = [];
  let prev = Number.NaN;
  for (let i = 0; i < startMs.length; i++) {
    const d = index.localDayNumber(startMs[i]!);
    if (d !== prev) {
      starts.push(i);
      prev = d;
    }
  }
  return starts;
}

/**
 * Tot waar de prijzen bekend zijn vanaf kwartier `t`.
 *
 * Vóór het publicatie-uur tot het einde van vandaag, daarna tot het einde van
 * morgen — beide grenzen in lokale tijd.
 */
export function knownHorizonEnd(
  t: number,
  startMs: Float64Array,
  dayStarts: number[],
  dayOf: Int32Array,
  n: number,
  index: LocalTimeIndex,
): number {
  const day = dayOf[t]!;
  const hour = index.localHour(startMs[t]!);
  const throughDay = hour < DAY_AHEAD_PUBLICATION_HOUR ? day : day + 1;
  const idx = throughDay + 1;
  return idx < dayStarts.length ? dayStarts[idx]! : n;
}

/**
 * Voorspel de residual load per kwartier uit de voorgaande dagen.
 *
 * Simpel maar realistisch: het gemiddelde van hetzelfde kwartier-van-de-dag over
 * de afgelopen week. Dat vangt het dagpatroon en het seizoen, maar niet het weer
 * van morgen — precies de onzekerheid waar een echte batterij mee leeft.
 *
 * Rond de zomertijdovergangen verschilt het aantal kwartieren per dag, dus we
 * indexeren op positie binnen de dag en slaan posities over die op een eerdere
 * dag niet bestonden.
 *
 * Alleen metingen van vóór het planmoment tellen mee. Het plan voor morgen
 * wordt om 13:00 gemaakt; de rest van vandaag is dan nog niet gemeten en mag
 * dus niet in het gemiddelde voor morgenavond zitten. Het effect was klein
 * (minder dan tien cent per jaar), maar een strategie die "geen kennis van de
 * toekomst" claimt, hoort die ook niet stiekem te hebben.
 *
 * @param from  het planmoment: metingen vanaf deze index zijn nog onbekend
 */
export function forecastResidual(
  actual: Float64Array,
  dayStarts: number[],
  dayOf: Int32Array,
  from: number,
  to: number,
  out: Float64Array,
): void {
  const n = actual.length;
  for (let t = from; t < to; t++) {
    const day = dayOf[t]!;
    const pos = t - dayStarts[day]!;
    const firstDay = Math.max(0, day - FORECAST_WINDOW_DAYS);

    let sum = 0;
    let count = 0;
    for (let prev = firstDay; prev < day; prev++) {
      const idx = dayStarts[prev]! + pos;
      const end = prev + 1 < dayStarts.length ? dayStarts[prev + 1]! : n;
      if (idx < end && idx < from) {
        sum += actual[idx]!;
        count++;
      }
    }
    if (count > 0) {
      out[t] = sum / count;
    } else {
      // Zonder historie (de eerste dag) is het gemiddelde van wat we tot nu toe
      // zagen de beste schatting; is er niets, dan nul.
      const upto = dayStarts[day] ?? 0;
      let all = 0;
      for (let i = 0; i < upto; i++) all += actual[i]!;
      out[t] = upto > 0 ? all / upto : 0;
    }
  }
}

export function dispatchRolling(
  window: Window,
  spec: BatterySpec,
  tariff: TariffSpec,
  options: RollingOptions = {},
): DispatchResult {
  const n = window.residualKwh.length;
  const out = emptyResult(n);
  if (usableCapacityKwh(spec) <= 0 || n === 0) {
    return passThrough(window, tariff, out);
  }

  const usable = usableCapacityKwh(spec);
  const maxTransfer = Math.max(
    maxChargeKwhPerStep(spec) * spec.efficiency,
    maxDischargeKwhPerStep(spec) / spec.efficiency,
  );
  const levels = chooseSocLevels(usable, maxTransfer, options.socLevels);
  const replanSteps = options.replanSteps;

  const index = new LocalTimeIndex(
    window.startMs[0]!,
    window.startMs[n - 1]!,
  );
  const dayStarts = localDayStarts(window.startMs, index);
  const dayOf = new Int32Array(n);
  for (let d = 0; d < dayStarts.length; d++) {
    const end = d + 1 < dayStarts.length ? dayStarts[d + 1]! : n;
    for (let i = dayStarts[d]!; i < end; i++) dayOf[i] = d;
  }

  // Eén buffer die we per herplanmoment overschrijven, in plaats van telkens
  // een nieuwe array van jaarlengte te alloceren.
  const planResidual = new Float64Array(n);
  let soc = 0;

  // Herplannen gebeurt op elk publicatie-uur: het moment dat de nieuwe prijzen
  // binnenkomen, niet midden in de nacht. Bij een vast interval (experimenten)
  // begint de reeks op het eerste publicatie-uur en telt daarna door.
  const publicaties = publicationMoments(window.startMs, index);
  let publicatieIdx = 0;
  let volgendeHerplan = publicaties[0] ?? n;

  const naVolgende = (vanaf: number): number => {
    if (replanSteps !== undefined) return vanaf + replanSteps;
    while (publicatieIdx < publicaties.length && publicaties[publicatieIdx]! <= vanaf) {
      publicatieIdx++;
    }
    return publicatieIdx < publicaties.length ? publicaties[publicatieIdx]! : n;
  };

  for (let t = 0; t < n; ) {
    const horizonTo = Math.max(
      t + 1,
      knownHorizonEnd(t, window.startMs, dayStarts, dayOf, n, index),
    );

    if (options.perfectForecast) {
      planResidual.set(window.residualKwh.subarray(t, horizonTo), t);
    } else {
      forecastResidual(window.residualKwh, dayStarts, dayOf, t, horizonTo, planResidual);
    }

    const path = planSocPath(
      planResidual,
      window.prices.importPrice,
      window.prices.exportPrice,
      t,
      horizonTo,
      spec,
      tariff,
      levels,
      soc,
    );

    // Alleen het eerste stuk van het plan wordt uitgevoerd; daarna herplannen we
    // met de werkelijke lading en een bijgewerkte verwachting.
    // Loop tot het volgende herplanmoment, maar nooit voorbij de horizon.
    if (volgendeHerplan <= t) volgendeHerplan = naVolgende(t);
    const execTo = Math.min(volgendeHerplan, horizonTo, n);
    soc = executePath(
      window,
      path.subarray(0, execTo - t),
      t,
      execTo,
      spec,
      tariff,
      soc,
      out,
      true,
      // De uitvoerder moet weten wat het plan bedoelde: eigen tekort dekken of
      // bewust verkopen. Zie executePath().
      planResidual,
    );
    if (execTo >= volgendeHerplan) volgendeHerplan = naVolgende(execTo);
    t = execTo;
  }
  return finalize(window, spec, tariff, out);
}
