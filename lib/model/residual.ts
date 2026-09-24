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
 * E17 en E18 zijn gemiddelden over veel huishoudens: per energierichting
 * opgeteld over een steekproef van slimme meters. Op één kwartier zijn ze
 * allebei groter dan nul, maar dat is vooral een eigenschap van de groep. De
 * netbeheerders schrijven het zelf: "Een individuele allocatiepunt neemt
 * wellicht alleen af of voedt alleen in binnen een kwartier, echter een groep
 * allocatiepunten kan tegelijkertijd afnemen en invoeden" (Netbeheer
 * Nederland, codewijzigingsvoorstel tussenoplossing profielallocatie,
 * BR-2021-1822, p. 12-14). We trekken ze daarom van elkaar af.
 *
 * Houd je ze apart, dan laadt de batterij uit de teruglevering en levert hij in
 * hetzelfde kwartier aan de afname: hij schuift stroom tussen buren. Gemeten op
 * Liander 2025 (2.500/2.000 kWh, beide varianten op de meterstanden, perfecte
 * vooruitblik) levert dat de Zendure 800 Pro 2 42% meer besparing op (177 in
 * plaats van 125 euro) en 13% voor een batterij van 5 kWh. Die extra komt
 * volledig uit de ruim 400 kWh overlap: de zonnestroom die de batterij opslaat
 * verdubbelt. Eén echt huis doet binnen een kwartier wel eens beide kanten op
 * (een wolk, een waterkoker), maar volgens metingen op seconde- en
 * minuutbasis gaat het om enkele procentpunten zelfconsumptie, en met een
 * batterij is het effect verwaarloosbaar (Tjaden e.a., HTW Berlin 2014; Beck
 * e.a., Applied Energy 2016). Netten zit daarom veel dichter bij één aansluiting
 * dan apart houden. Blijft er bij een echt huis een tiende van de overlap over,
 * dan ligt de besparing zo'n 5% hoger dan hier berekend.
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
 * neemt binnen een kwartier meestal óf af óf levert terug, dus de jaartotalen
 * op de afrekening zijn vrijwel de genette sommen. Het model hoort ze te
 * reproduceren, bij elke verhouding tussen de twee. Daarom worden de twee fracties elk met een extra factor
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
 * ── Eén onbekende, niet twee ─────────────────────────────────────────────────
 * Het verschil van de twee vergelijkingen is de som van de reeks zelf:
 * a·afname·ΣE17 − b·teruglevering·ΣE18 = afname − teruglevering. Dat legt a vast
 * zodra b gekozen is. Blijft over: één vergelijking in b, en de kant met het
 * kleinste volume is monotoon in b. Op de kwartieren waar de kleine kant wint,
 * ligt zijn fractie boven die van de grote kant, dus groeit zijn overschot daar
 * sneller dan a het kan wegnetten. Bisectie vindt de oplossing dan altijd.
 *
 * Er stond een vast-punt-iteratie, en die hield op zodra een van beide kanten
 * op nul uitkwam. Bij een scheve verhouding gebeurde dat al bij de start: bij
 * 100.000 kWh afname tegen 2.000 kWh teruglevering (Liander 2025) had geen enkel
 * kwartier meer een overschot. De teruglevering verdween dan stil uit het
 * model, en de afname kwam uit op 148.213 kWh. Het omslagpunt lag rond een
 * verhouding van 58, en dat valt binnen wat de invoervelden toelaten. Nu komt
 * de teruglevering ook dan terug, geconcentreerd in de zonnigste kwartieren:
 * wie zoveel meer afneemt dan hij teruglevert, levert alleen op die momenten
 * iets terug.
 *
 * Roep dit aan op een VOLLEDIG kalenderjaar. Op een deeljaar zou het de
 * jaartotalen in een deel van het jaar proppen. Deeljaren lenen de factoren van
 * een vol jaar, net zoals de normalisatie in build_assets.py dat doet.
 *
 * Zonder teruglevering (of zonder afname) valt er niets te netten en zijn de
 * factoren 1.
 *
 * @throws als de meterstanden onhaalbaar zijn: dan is er in het hele jaar geen
 *   kwartier waarop de fractie van de kleine kant boven die van de grote ligt.
 *   Bij een gemeten profiel met zon komt dat niet voor, en dan is een stille
 *   uitkomst die niet op de meterstanden uitkomt erger dan een fout.
 */
export function solveNettingScale(
  importFraction: Float32Array,
  exportFraction: Float32Array,
  household: HouseholdSpec,
): NettingScale {
  const imp = household.annualGridImportKwh;
  const exp = household.annualGridExportKwh;
  if (imp <= 0 || exp <= 0) return GEEN_SCHALING;
  // Los op voor de kleine kant; de grote volgt uit de som van de reeks.
  if (imp >= exp) {
    const [a, b] = schaalKleineKant(importFraction, imp, exportFraction, exp);
    return { importScale: a, exportScale: b };
  }
  const [b, a] = schaalKleineKant(exportFraction, exp, importFraction, imp);
  return { importScale: a, exportScale: b };
}

/**
 * Factoren [groot, klein] waarmee Σ max(0, klein·kf·kv − groot·gf·gv) precies
 * kv wordt, met groot zo dat de som van de reeks gv − kv blijft.
 */
function schaalKleineKant(
  grootFractie: Float32Array,
  grootVolume: number,
  kleinFractie: Float32Array,
  kleinVolume: number,
): [number, number] {
  const n = Math.min(grootFractie.length, kleinFractie.length);
  let somGroot = 0;
  let somKlein = 0;
  for (let i = 0; i < n; i++) {
    somGroot += grootFractie[i]!;
    somKlein += kleinFractie[i]!;
  }
  const groot = (klein: number) =>
    (grootVolume - kleinVolume + klein * kleinVolume * somKlein) / (grootVolume * somGroot);
  const overschot = (klein: number) => {
    const g = groot(klein);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const r = klein * kleinFractie[i]! * kleinVolume - g * grootFractie[i]! * grootVolume;
      if (r > 0) s += r;
    }
    return s;
  };

  // Bij klein = 0 is het overschot nul; zoek een bovengrens door te verdubbelen.
  // Bij de standaardinvoer ligt de oplossing rond 1,25, bij een verhouding van
  // duizend rond de 25; 2^40 is alleen haalbaar als het profiel geen zon kent.
  let laag = 0;
  let hoog = 1;
  while (overschot(hoog) < kleinVolume) {
    laag = hoog;
    hoog *= 2;
    if (hoog > 2 ** 40) {
      throw new Error(
        `netting: ${kleinVolume} kWh is met dit profiel niet te halen naast ${grootVolume} kWh`,
      );
    }
  }
  // Tot op 1e-12 relatief: ver onder de float32-ruis van de fracties, en zo
  // scherp dat de uitkomst niet van de startwaarde afhangt.
  while (hoog - laag > 1e-12 * hoog) {
    const midden = (laag + hoog) / 2;
    if (overschot(midden) < kleinVolume) laag = midden;
    else hoog = midden;
  }
  const klein = (laag + hoog) / 2;
  return [groot(klein), klein];
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
