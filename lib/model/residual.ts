/**
 * Van profielfracties naar de netto netuitwisseling van één huishouden.
 *
 * De MFFBAS-fracties beschrijven de VORM: welk deel van het jaarvolume in elk
 * kwartier valt. De gebruiker levert de SCHAAL: hoeveel kWh hij per jaar van het
 * net afneemt en hoeveel hij teruglevert. Beide getallen staan op de
 * jaarafrekening, en het zijn precies de twee schaalfactoren die de E17- en
 * E18-reeksen nodig hebben. Er hoeft dus niets aangenomen te worden over
 * oriëntatie, instraling of zelfconsumptiegraad: dat zit al in het gerealiseerde
 * profiel.
 *
 * ── Waarom netto ─────────────────────────────────────────────────────────────
 * E17 en E18 zijn gemiddelden over veel huishoudens. Op één kwartier zijn ze
 * allebei groter dan nul, terwijl één aansluiting op elk moment maar één kant op
 * kan. We trekken ze daarom van elkaar af. Zou je ze apart houden, dan mocht de
 * batterij op hetzelfde kwartier laden én ontladen — energie uit het niets.
 *
 * ── De keerzijde: het gemiddelde is te glad ──────────────────────────────────
 * Datzelfde middelen maakt het profiel vlakker dan een echte aansluiting: pieken
 * en dalen vallen tegen elkaar weg. Een batterij heeft juist waarde bij scherpe
 * verschillen, dus dit onderschat de zelfconsumptie systematisch. De
 * spreidingsfactor maakt die bias instelbaar en zichtbaar in plaats van
 * verborgen.
 *
 * ── Netten kost volume, en dat volume moet terug ─────────────────────────────
 * Wie E17 met de jaarafname schaalt en E18 met de jaarteruglevering en dan
 * aftrekt, houdt minder over dan hij invulde: op de kwartieren waar beide
 * fracties elkaar overlappen, valt een deel tegen elkaar weg. Gemeten op
 * Liander 2025 met 2.500/2.000 kWh bleef er 2.086/1.586 over — ruim 400 kWh
 * die de gebruiker op zijn jaarafrekening ziet, verdween uit het model.
 *
 * Dat is geen eigenschap van het huishouden maar van het middelen. Eén meter
 * kan binnen een kwartier niet tegelijk afnemen en terugleveren, dus de
 * jaartotalen op de afrekening ZIJN al de genette sommen. Het model hoort ze te
 * reproduceren. Daarom worden de twee fracties elk met een extra factor
 * geschaald, zo gekozen dat de genette reeks precies op de meterstanden
 * uitkomt. Zie solveNettingScale(). Het effect is niet klein: 19% meer
 * besparing voor een batterij van 5 kWh, want die 400 kWh vielen precies op de
 * uren waarop een batterij zijn geld verdient.
 */

import { LocalTimeIndex } from "../data/timeaxis";
import type { HouseholdSpec } from "./types";

/**
 * Schaalfactoren op de twee fracties, zodat de genette reeks over een vol jaar
 * exact de ingevulde afname en teruglevering oplevert.
 */
export interface NettingScale {
  importScale: number;
  exportScale: number;
}

export const GEEN_SCHALING: NettingScale = { importScale: 1, exportScale: 1 };

/**
 * Los de schaalfactoren op waarmee de genette reeks de meterstanden reproduceert.
 *
 *   Σ max(0, a·E17·afname − b·E18·teruglevering) = afname
 *   Σ max(0, b·E18·teruglevering − a·E17·afname) = teruglevering
 *
 * Twee vergelijkingen, twee onbekenden, en beide sommen zijn monotoon in a en b.
 * Een vast-punt-iteratie — a met het tekort in de afname vermenigvuldigen, b met
 * dat in de teruglevering — convergeert daardoor in een tiental stappen.
 *
 * Roep dit aan op een VOLLEDIG kalenderjaar. Op een deeljaar zou het de
 * jaartotalen in een deel van het jaar proppen. Deeljaren lenen de factoren van
 * een vol jaar, net zoals de normalisatie in build_assets.py dat doet.
 *
 * Zonder teruglevering (of zonder afname) valt er niets te netten en zijn de
 * factoren 1. Het verschil afname − teruglevering is per constructie al gelijk
 * aan de som van de reeks, dus alleen de verdeling ervan verandert.
 */
export function solveNettingScale(
  importFraction: Float32Array,
  exportFraction: Float32Array,
  household: HouseholdSpec,
): NettingScale {
  const imp = household.annualGridImportKwh;
  const exp = household.annualGridExportKwh;
  if (imp <= 0 || exp <= 0) return GEEN_SCHALING;
  const n = Math.min(importFraction.length, exportFraction.length);

  let a = 1;
  let b = 1;
  // Relatieve afwijking waarbij we stoppen: 1e-6 op 2.500 kWh is 2,5 Wh, ver
  // onder de float32-ruis van de fracties zelf.
  const tolerantie = 1e-6;
  // De iteratie halveert de fout ruwweg per stap; 100 is een ruime bovengrens
  // die alleen bij pathologische invoer wordt gehaald.
  const maxStappen = 100;

  for (let stap = 0; stap < maxStappen; stap++) {
    let pos = 0;
    let neg = 0;
    for (let i = 0; i < n; i++) {
      const r = a * importFraction[i]! * imp - b * exportFraction[i]! * exp;
      if (r > 0) pos += r;
      else neg -= r;
    }
    if (pos <= 0 || neg <= 0) break;
    const fa = imp / pos;
    const fb = exp / neg;
    a *= fa;
    b *= fb;
    if (Math.abs(fa - 1) < tolerantie && Math.abs(fb - 1) < tolerantie) break;
  }
  return { importScale: a, exportScale: b };
}

/**
 * Bereken de netto netuitwisseling per kwartier.
 *
 * @param startMs  UTC-milliseconden per kwartier. Nodig zodra de
 *   spreidingsfactor afwijkt van 1: die werkt per lokale kalenderdag, en een
 *   dag is niet altijd 96 kwartieren. Zonder tijdas vallen we terug op vaste
 *   blokken van 96, wat alleen buiten de zomertijdovergangen klopt.
 * @param scale  Schaalfactoren uit solveNettingScale(), bepaald op een vol
 *   jaar. Zonder schaling komt de genette reeks onder de meterstanden uit.
 * @returns kWh per kwartier; positief is afname van het net, negatief is
 *   teruglevering
 */
export function buildResidual(
  importFraction: Float32Array,
  exportFraction: Float32Array,
  household: HouseholdSpec,
  startMs?: Float64Array,
  scale: NettingScale = GEEN_SCHALING,
): Float64Array {
  return buildResidualParts(
    importFraction,
    exportFraction,
    household,
    startMs,
    scale,
  ).residualKwh;
}

/**
 * De twee componenten waaruit de residual is samengesteld, elk in kWh per
 * kwartier en al geschaald.
 *
 * ── Wat dit wel en niet is ──────────────────────────────────────────────────
 * `gridExportKwh` is de stroom die de meter naar buiten ging: het deel van de
 * zonopwek dat niet direct in huis werd gebruikt. Het is dus GEEN bruto
 * zonopwek. Wat de panelen produceerden en meteen door de koelkast werd
 * opgegeten, komt nooit langs de meter en zit in geen van beide reeksen. Uit
 * meterdata is de bruto opwek per kwartier niet te herleiden; daarvoor zou je
 * de opbrengstmeting van de omvormer nodig hebben.
 *
 * Ze zijn er wel voor het bekijken van één dag: het verschil tussen "er kwam
 * niets van het dak" en "er kwam veel van het dak maar het ging meteen op"
 * is zichtbaar in deze reeks, en in de netto residual niet.
 */
export interface ResidualParts {
  residualKwh: Float64Array;
  /** Afname van het net per kwartier vóór het netten, kWh (E17). */
  gridImportKwh: Float64Array;
  /** Teruglevering aan het net per kwartier vóór het netten, kWh (E18). */
  gridExportKwh: Float64Array;
}

export function buildResidualParts(
  importFraction: Float32Array,
  exportFraction: Float32Array,
  household: HouseholdSpec,
  startMs?: Float64Array,
  scale: NettingScale = GEEN_SCHALING,
): ResidualParts {
  const n = importFraction.length;
  if (exportFraction.length !== n) {
    throw new Error(
      `afname- en invoedingsreeks verschillen in lengte: ${n} en ${exportFraction.length}`,
    );
  }
  const out = new Float64Array(n);
  const imp = new Float64Array(n);
  const exp = new Float64Array(n);
  const impSchaal = household.annualGridImportKwh * scale.importScale;
  const expSchaal = household.annualGridExportKwh * scale.exportScale;
  for (let i = 0; i < n; i++) {
    imp[i] = importFraction[i]! * impSchaal;
    exp[i] = exportFraction[i]! * expSchaal;
    out[i] = imp[i]! - exp[i]!;
  }

  const spread = household.spreadFactor;
  if (spread !== 1) {
    const grenzen = startMs ? localDayStarts(startMs) : undefined;
    // De componenten krijgen dezelfde behandeling als de netto reeks, anders
    // klopt imp − exp = residual niet meer en zou de dagweergave iets anders
    // tonen dan waarop gerekend is.
    applySpread(out, spread, grenzen);
    applySpread(imp, spread, grenzen);
    applySpread(exp, spread, grenzen);
  }
  return { residualKwh: out, gridImportKwh: imp, gridExportKwh: exp };
}

/** Startindex van elke lokale kalenderdag, plus n als sluitstuk. */
function localDayStarts(startMs: Float64Array): number[] {
  const n = startMs.length;
  if (n === 0) return [0];
  const index = new LocalTimeIndex(startMs[0]!, startMs[n - 1]!);
  const starts: number[] = [];
  let vorige = Number.NaN;
  for (let i = 0; i < n; i++) {
    const d = index.localDayNumber(startMs[i]!);
    if (d !== vorige) {
      starts.push(i);
      vorige = d;
    }
  }
  starts.push(n);
  return starts;
}

/**
 * Vergroot of verklein de uitslagen rond het dagelijkse gemiddelde.
 *
 * Het gemiddelde per dag blijft exact gelijk, dus de jaarvolumes veranderen niet
 * — alleen de scherpte van het profiel. Dat is precies de eigenschap waarin een
 * individuele aansluiting van het gemiddelde afwijkt.
 *
 * Het dagelijkse gemiddelde is de referentie, niet het jaargemiddelde: anders
 * zou opschalen de seizoenen uitvergroten in plaats van het dagpatroon.
 *
 * @param dayStarts  grenzen van de lokale kalenderdagen, inclusief n als
 *   laatste. Zonder grenzen worden blokken van 96 gebruikt; dat verschuift na
 *   een zomertijdovergang een uur, en is alleen goed genoeg voor tests zonder
 *   tijdas.
 */
export function applySpread(
  residual: Float64Array,
  factor: number,
  dayStarts?: number[],
): void {
  const n = residual.length;
  const grenzen = dayStarts ?? vasteBlokken(n, 96);
  for (let d = 0; d + 1 < grenzen.length; d++) {
    const start = grenzen[d]!;
    const end = Math.min(n, grenzen[d + 1]!);
    if (end <= start) continue;
    let sum = 0;
    for (let i = start; i < end; i++) sum += residual[i]!;
    const mean = sum / (end - start);
    for (let i = start; i < end; i++) {
      residual[i] = mean + (residual[i]! - mean) * factor;
    }
  }
}

function vasteBlokken(n: number, lengte: number): number[] {
  const uit: number[] = [];
  for (let i = 0; i < n; i += lengte) uit.push(i);
  uit.push(n);
  return uit;
}

/** Samenvattende volumes van een residual-reeks, in kWh. */
export interface ResidualSummary {
  gridImportKwh: number;
  gridExportKwh: number;
  /** Hoeveel van het jaarvolume in dit venster valt, 0–1. */
  importFractionOfYear: number;
  exportFractionOfYear: number;
}

export function summarizeResidual(
  residual: Float64Array,
  household: HouseholdSpec,
): ResidualSummary {
  let imp = 0;
  let exp = 0;
  for (let i = 0; i < residual.length; i++) {
    const r = residual[i]!;
    if (r > 0) imp += r;
    else exp -= r;
  }
  return {
    gridImportKwh: imp,
    gridExportKwh: exp,
    importFractionOfYear:
      household.annualGridImportKwh > 0 ? imp / household.annualGridImportKwh : 0,
    exportFractionOfYear:
      household.annualGridExportKwh > 0 ? exp / household.annualGridExportKwh : 0,
  };
}
