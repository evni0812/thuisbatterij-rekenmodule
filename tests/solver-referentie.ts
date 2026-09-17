/**
 * De solver zoals hij was vóór de micro-optimalisaties van september 2026,
 * letterlijk gekopieerd. Alleen voor tests: de nieuwe `planSocPath` moet op
 * elke invoer bit-voor-bit hetzelfde pad geven als deze referentie. Niet
 * aanpassen — als deze afwijkt van de nieuwe, is de nieuwe fout.
 */
import {
  maxChargeKwhPerStep,
  maxDischargeKwhPerStep,
  usableCapacityKwh,
} from "../lib/model/battery";
import type { BatterySpec, TariffSpec } from "../lib/model/types";

const ACTION_SUBDIVISIONS = 6;
const GELIJKSPEL_EUR = 1e-9;

export function planSocPathReferentie(
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
  const curtail = tariff.allowCurtailment;

  let next = new Float64Array(levels);
  let cur = new Float64Array(levels);

  if (valueTerminalSoc) {
    let avgImport = 0;
    for (let t = from; t < to; t++) avgImport += importPrice[t]!;
    avgImport /= n;
    for (let j = 0; j < levels; j++) next[j] = -j * stepKwh * eta * avgImport;
  }

  // De gekozen actie per (stap, niveau), als AC-uitwisseling in kWh. Float32
  // volstaat: een kwartieractie is hooguit enkele kWh en de zeven decimalen van
  // een float32 zitten ver onder de gridstap. Dat halveert het geheugen, en
  // deze tabel is de grootste allocatie van de hele doorrekening — voor een
  // heel jaar 35.040 × niveaus × 4 bytes, dus 14 MB bij 101 niveaus en 56 MB
  // bij de 401 die een grote batterij met klein vermogen nodig heeft.
  const action = new Float32Array(n * levels);
  // Kandidaat-acties in een vooraf gealloceerde buffer: deze lus draait
  // miljoenen keren per jaar, en een groeiende JS-array kost daar meer dan de
  // rekenkunde zelf.
  const cand = new Float64Array(2 * ACTION_SUBDIVISIONS + 4);

  // ── Waarom deze lus niet verder is geoptimaliseerd ──────────────────────
  // Delingen vervangen door vermenigvuldigen met het omgekeerde, en de
  // interpolatie herschrijven als n0 + (n1 − n0)·frac, gaf 10 tot 30% winst —
  // maar ook 12 cent verschil op een jaar. Het laatste bit verschuift, en in
  // een argmin over bijna gelijke kandidaten kantelt dat soms een keuze. Een
  // optimalisatie hoort het antwoord niet te veranderen. Wat bit-exact kon
  // (aanroepen hoisten, floor via `| 0`) bleek binnen de meetruis: V8 doet dat
  // al. Dus staat hier de leesbare versie.
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
        const g = r + b;
        let cost = g > 0 ? g * ip : g < 0 && !(curtail && ep < 0) ? g * ep : 0;
        if (b < 0) cost -= wear * b;

        // Lineaire interpolatie in de waardefunctie: de lading hoeft niet op een
        // roosterpunt te landen.
        const x = Math.max(0, Math.min(levels - 1, nextSoc / stepKwh));
        const i0 = Math.min(levels - 2, Math.floor(x));
        const frac = x - i0;
        const future = next[i0]! * (1 - frac) + next[i0 + 1]! * frac;

        const total = cost + future;
        // Alleen een écht goedkopere kandidaat verdringt de vorige. Bij
        // gelijkspel wint degene die het eerst langskwam, en dat is niets doen:
        // `cand[0]` is nul.
        if (total < best - GELIJKSPEL_EUR) {
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

