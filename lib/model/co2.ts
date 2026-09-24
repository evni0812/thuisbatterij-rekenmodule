/**
 * Wat een thuisbatterij scheelt aan CO2.
 *
 * ── Twee perspectieven ──────────────────────────────────────────────────────
 * Het huishouden: elke kWh die je van het net haalt, is op dat uur met een
 * bepaalde uitstoot opgewekt (de emissiefactor van de Nederlandse mix, gram
 * CO2 per kWh, per uur uit het Nationaal Energie Dashboard). Een batterij
 * verschuift afname van de avond (gas, soms kolen) naar de middag (zon) en
 * vervangt afname door eigen zonnestroom. Wat je aan uitstoot uitspaart is
 * het verschil in afname maal de factor op dat uur, opgeteld over het jaar.
 * Teruglevering telt hier niet: wat de buren met jouw stroom doen is hun
 * voetafdruk, niet de jouwe.
 *
 * Nederland: teruggeleverde zonnestroom is níet verloren als iemand anders hem
 * op dat moment gebruikt en daarmee een gascentrale uitspaart. Maar is de mix
 * op dat uur al vrijwel groen, dan is er meer groene stroom dan afname: die
 * kWh gaat de grens over of wordt afgeschakeld, en verdringt in Nederland
 * niets meer. Vanuit Nederland gezien telt teruglevering dus mee als vermeden
 * uitstoot, behalve op uren met een emissiefactor onder een drempel. Die
 * drempel is een keuze, dus hij is instelbaar; om dat zonder herrekenen te
 * kunnen, bewaart dit bestand de afname en teruglevering niet als totaal maar
 * per klasse van emissiefactor.
 *
 * ── Wat hier bewust niet in zit ─────────────────────────────────────────────
 * De factor is de gemiddelde uitstoot van de Nederlandse opwek op dat uur, niet
 * de marginale (wat de duurste centrale zou hebben gedaan). Marginaal is
 * theoretisch scherper maar bestaat niet als meetreeks. En import telt niet in
 * de NED-factor; op uren met veel import uit Duitsland of België onderschat of
 * overschat hij dus.
 */

import type { DispatchResult, Window } from "./types";

/** Breedte van één klasse emissiefactor, gram per kWh. */
export const CO2_KLASSE_G = 20;
/** Aantal klassen; de laatste vangt alles vanaf (KLASSEN − 1) × KLASSE_G. */
export const CO2_KLASSEN = 31;

/** Ondergrens van klasse `k`, gram per kWh. */
export function klasseOndergrens(k: number): number {
  return k * CO2_KLASSE_G;
}

/** De klasse waarin een emissiefactor valt. */
export function klasseVan(gPerKwh: number): number {
  return Math.max(0, Math.min(CO2_KLASSEN - 1, Math.floor(gPerKwh / CO2_KLASSE_G)));
}

/**
 * De CO2-balans van één doorgerekend jaar (of deeljaar).
 *
 * Gewone arrays, geen typed arrays: dit gaat door JSON heen (cache, preload).
 */
export interface Co2Jaar {
  /** Uitstoot van de netafname zonder en met batterij, kg. */
  importBasisKg: number;
  importBatKg: number;
  /** Netafname zonder en met batterij, kWh (voor de gewogen factor). */
  importBasisKwh: number;
  importBatKwh: number;
  /** Teruglevering zonder en met batterij, kWh. */
  exportBasisKwh: number;
  exportBatKwh: number;
  /** Ongewogen gemiddelde emissiefactor over alle kwartieren, g/kWh. */
  gemiddeldeFactorG: number;
  /** Per klasse emissiefactor: afname en teruglevering in kWh, en de uitstoot die de teruglevering elders zou vermijden in kg. */
  klassen: {
    importBasisKwh: number[];
    importBatKwh: number[];
    exportBasisKwh: number[];
    exportBatKwh: number[];
    exportBasisKg: number[];
    exportBatKg: number[];
    /** Aantal kwartieren in de klasse; zegt hoe vaak de mix zo schoon was. */
    kwartieren: number[];
  };
  /** Per kalendermaand (1-12) de uitstoot van de afname zonder en met batterij, kg. */
  perMaand: { month: number; importBasisKg: number; importBatKg: number }[];
  /** Gemiddelde emissiefactor per uur van de dag, winter en zomer, g/kWh. */
  factorPerUur: { winter: number[]; zomer: number[] };
  /** Kwartieren zonder emissiefactor (de NED-reeks loopt achter); die tellen nergens mee. */
  ontbrekendeKwartieren: number;
}

function nullen(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

/** "zomer" is april tot en met september: dezelfde grens als de seizoensprofielen. */
function isZomer(maand: number): boolean {
  return maand >= 4 && maand <= 9;
}

/**
 * De CO2-balans van een venster, uit de netuitwisseling zonder batterij (de
 * basis) en met (de dispatch). Vraagt een window mét `co2GPerKwh`; zonder
 * die reeks is er niets te rekenen en hoort de aanroeper null door te geven.
 */
export function co2Jaar(window: Window, basis: DispatchResult, bat: DispatchResult): Co2Jaar {
  const ef = window.co2GPerKwh;
  if (!ef) throw new Error("het venster heeft geen emissiefactor per kwartier");
  const n = window.startMs.length;
  const kl = {
    importBasisKwh: nullen(CO2_KLASSEN),
    importBatKwh: nullen(CO2_KLASSEN),
    exportBasisKwh: nullen(CO2_KLASSEN),
    exportBatKwh: nullen(CO2_KLASSEN),
    exportBasisKg: nullen(CO2_KLASSEN),
    exportBatKg: nullen(CO2_KLASSEN),
    kwartieren: nullen(CO2_KLASSEN),
  };
  const maanden = new Map<number, { importBasisKg: number; importBatKg: number }>();
  const uurSom = { winter: nullen(24), zomer: nullen(24) };
  const uurTel = { winter: nullen(24), zomer: nullen(24) };

  let importBasisKg = 0;
  let importBatKg = 0;
  let importBasisKwh = 0;
  let importBatKwh = 0;
  let exportBasisKwh = 0;
  let exportBatKwh = 0;
  let efSom = 0;
  let ontbrekend = 0;
  let geteld = 0;

  for (let i = 0; i < n; i++) {
    const g = ef[i]!;
    if (Number.isNaN(g)) {
      ontbrekend += 1;
      continue;
    }
    geteld += 1;
    const impB = basis.gridImportKwh[i]!;
    const impA = bat.gridImportKwh[i]!;
    const expB = basis.gridExportKwh[i]!;
    const expA = bat.gridExportKwh[i]!;
    const kg = g / 1000;

    importBasisKg += impB * kg;
    importBatKg += impA * kg;
    importBasisKwh += impB;
    importBatKwh += impA;
    exportBasisKwh += expB;
    exportBatKwh += expA;
    efSom += g;

    const k = klasseVan(g);
    kl.importBasisKwh[k]! += impB;
    kl.importBatKwh[k]! += impA;
    kl.exportBasisKwh[k]! += expB;
    kl.exportBatKwh[k]! += expA;
    kl.exportBasisKg[k]! += expB * kg;
    kl.exportBatKg[k]! += expA * kg;
    kl.kwartieren[k]! += 1;

    // Lokale tijd voor maand en uur: de factor hoort bij het Nederlandse uur.
    const d = new Date(window.startMs[i]!);
    const delen = LOKAAL.formatToParts(d);
    const maand = Number(delen.find((p) => p.type === "month")!.value);
    const uur = Number(delen.find((p) => p.type === "hour")!.value) % 24;
    const m = maanden.get(maand) ?? { importBasisKg: 0, importBatKg: 0 };
    m.importBasisKg += impB * kg;
    m.importBatKg += impA * kg;
    maanden.set(maand, m);
    const seizoen = isZomer(maand) ? "zomer" : "winter";
    uurSom[seizoen][uur]! += g;
    uurTel[seizoen][uur]! += 1;
  }

  const gemiddelde = (som: number[], tel: number[]) => som.map((s, i) => (tel[i]! > 0 ? s / tel[i]! : 0));

  return {
    importBasisKg,
    importBatKg,
    importBasisKwh,
    importBatKwh,
    exportBasisKwh,
    exportBatKwh,
    gemiddeldeFactorG: geteld > 0 ? efSom / geteld : 0,
    klassen: kl,
    perMaand: [...maanden.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([month, v]) => ({ month, ...v })),
    factorPerUur: {
      winter: gemiddelde(uurSom.winter, uurTel.winter),
      zomer: gemiddelde(uurSom.zomer, uurTel.zomer),
    },
    ontbrekendeKwartieren: ontbrekend,
  };
}

const LOKAAL = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  month: "numeric",
  hour: "numeric",
  hourCycle: "h23",
});

/**
 * Het gemiddelde over een aantal jaren, per veld. Voor de kaart en de
 * kerncijfers: dezelfde grondslag als `averageSavingEur` (het gemiddelde over
 * de volledige jaren). Null als er niets te middelen is.
 */
export function gemiddeldCo2(jaren: readonly Co2Jaar[]): Co2Jaar | null {
  if (jaren.length === 0) return null;
  const n = jaren.length;
  const mid = (kies: (j: Co2Jaar) => number) => jaren.reduce((s, j) => s + kies(j), 0) / n;
  const midLijst = (kies: (j: Co2Jaar) => number[]) =>
    jaren[0]!.klassen.importBasisKwh.map((_, k) => jaren.reduce((s, j) => s + (kies(j)[k] ?? 0), 0) / n);
  const maanden = new Map<number, { importBasisKg: number; importBatKg: number; n: number }>();
  for (const j of jaren) {
    for (const m of j.perMaand) {
      const v = maanden.get(m.month) ?? { importBasisKg: 0, importBatKg: 0, n: 0 };
      v.importBasisKg += m.importBasisKg;
      v.importBatKg += m.importBatKg;
      v.n += 1;
      maanden.set(m.month, v);
    }
  }
  const uur = (kies: (j: Co2Jaar) => number[]) =>
    Array.from({ length: 24 }, (_, u) => jaren.reduce((s, j) => s + (kies(j)[u] ?? 0), 0) / n);
  return {
    importBasisKg: mid((j) => j.importBasisKg),
    importBatKg: mid((j) => j.importBatKg),
    importBasisKwh: mid((j) => j.importBasisKwh),
    importBatKwh: mid((j) => j.importBatKwh),
    exportBasisKwh: mid((j) => j.exportBasisKwh),
    exportBatKwh: mid((j) => j.exportBatKwh),
    gemiddeldeFactorG: mid((j) => j.gemiddeldeFactorG),
    klassen: {
      importBasisKwh: midLijst((j) => j.klassen.importBasisKwh),
      importBatKwh: midLijst((j) => j.klassen.importBatKwh),
      exportBasisKwh: midLijst((j) => j.klassen.exportBasisKwh),
      exportBatKwh: midLijst((j) => j.klassen.exportBatKwh),
      exportBasisKg: midLijst((j) => j.klassen.exportBasisKg),
      exportBatKg: midLijst((j) => j.klassen.exportBatKg),
      kwartieren: midLijst((j) => j.klassen.kwartieren),
    },
    perMaand: [...maanden.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([month, v]) => ({ month, importBasisKg: v.importBasisKg / v.n, importBatKg: v.importBatKg / v.n })),
    factorPerUur: { winter: uur((j) => j.factorPerUur.winter), zomer: uur((j) => j.factorPerUur.zomer) },
    ontbrekendeKwartieren: mid((j) => j.ontbrekendeKwartieren),
  };
}

/** Het perspectief van het huishouden: wat de batterij aan uitstoot scheelt. */
export interface Huishouden {
  zonderKg: number;
  metKg: number;
  winstKg: number;
  /** Gewogen emissiefactor van de afname zonder en met batterij, g/kWh. */
  factorZonderG: number;
  factorMetG: number;
}

export function huishoudPerspectief(c: Co2Jaar): Huishouden {
  return {
    zonderKg: c.importBasisKg,
    metKg: c.importBatKg,
    winstKg: c.importBasisKg - c.importBatKg,
    factorZonderG: c.importBasisKwh > 0 ? (c.importBasisKg * 1000) / c.importBasisKwh : 0,
    factorMetG: c.importBatKwh > 0 ? (c.importBatKg * 1000) / c.importBatKwh : 0,
  };
}

/** Het perspectief van Nederland, bij een drempel voor "overschot". */
export interface Nederland {
  drempelG: number;
  /** Uitstoot toe te rekenen aan het huishouden: afname min wat de teruglevering elders vermijdt, kg. */
  zonderKg: number;
  metKg: number;
  winstKg: number;
  /** Wat de teruglevering elders vermeed, kg, zonder en met batterij. */
  vermedenZonderKg: number;
  vermedenMetKg: number;
  /** Teruglevering op overschot-uren (onder de drempel), kWh, zonder en met. */
  overschotZonderKwh: number;
  overschotMetKwh: number;
  /** Aandeel van de kwartieren onder de drempel, 0-1. */
  aandeelOverschotUren: number;
}

export function nederlandPerspectief(c: Co2Jaar, drempelG: number): Nederland {
  // Een klasse telt als "nuttig" (de teruglevering verdringt elders opwek) als
  // haar ondergrens op of boven de drempel ligt. De drempel wordt daarmee
  // afgerond op de klassegrens van 20 g/kWh; de schuif loopt in die stappen.
  const nuttig = (k: number) => klasseOndergrens(k) >= drempelG;
  let vermedenZonder = 0;
  let vermedenMet = 0;
  let overschotZonder = 0;
  let overschotMet = 0;
  let kwartierenOnder = 0;
  let kwartieren = 0;
  for (let k = 0; k < CO2_KLASSEN; k++) {
    kwartieren += c.klassen.kwartieren[k]!;
    if (nuttig(k)) {
      vermedenZonder += c.klassen.exportBasisKg[k]!;
      vermedenMet += c.klassen.exportBatKg[k]!;
    } else {
      overschotZonder += c.klassen.exportBasisKwh[k]!;
      overschotMet += c.klassen.exportBatKwh[k]!;
      kwartierenOnder += c.klassen.kwartieren[k]!;
    }
  }
  const zonder = c.importBasisKg - vermedenZonder;
  const met = c.importBatKg - vermedenMet;
  return {
    drempelG,
    zonderKg: zonder,
    metKg: met,
    winstKg: zonder - met,
    vermedenZonderKg: vermedenZonder,
    vermedenMetKg: vermedenMet,
    overschotZonderKwh: overschotZonder,
    overschotMetKwh: overschotMet,
    aandeelOverschotUren: kwartieren > 0 ? kwartierenOnder / kwartieren : 0,
  };
}

/** Standaarddrempel: onder dit niveau is de mix vrijwel zonder fossiel en verdringt extra zon niets meer. */
export const STANDAARD_CO2_DREMPEL_G = 100;
