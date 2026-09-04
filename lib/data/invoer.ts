/**
 * Van een configuratie naar de invoer van het rekenmodel.
 *
 * Dit stond in de rekenworker, maar er zijn nu twee plekken die het nodig
 * hebben: de worker in de browser, en de build die het standaardantwoord
 * vooruitrekent. Twee kopieën zouden onvermijdelijk uit elkaar lopen, en dan
 * ziet een bezoeker eerst het ene bedrag en na een herberekening het andere.
 *
 * De ophaler is een parameter. In de browser is dat `fetch`; tijdens de build
 * leest een variant de bestanden van schijf, want dan bestaat `/data/...` nog
 * niet als URL.
 */

import {
  expandPricesToQuarters,
  loadManifest,
  loadPriceYear,
  loadProfileYear,
  type Ophaler,
  type PriceYear,
  type ProfileYear,
} from "./loader";
import { addDays, localMidnightUtcMs } from "./timeaxis";
import type { Manifest } from "./manifest";
import type { AnalysisInput } from "../model/analysis";
import {
  buildResidualParts,
  GEEN_SCHALING,
  solveNettingScale,
  type NettingScale,
} from "../model/residual";
import { buildPriceSeries } from "../model/tariff";
import type { Configuration } from "../worker/protocol";

/** Welke kalenderjaren raakt het gekozen venster? */
export function yearsInRange(
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
export function sliceRange(
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
export function laatstePrijsjaar(m: Manifest): string {
  return Object.keys(m.prijzen).sort().at(-1)!;
}

/**
 * Haalt de assets op en bouwt er de modelinvoer mee.
 *
 * Eén exemplaar per omgeving: hij houdt de geladen profielen, prijzen en
 * schaalfactoren vast. Die zijn duur om op te halen en op te lossen, en ze
 * veranderen niet als de gebruiker aan de batterij schuift.
 */
export class Invoerbron {
  private manifest: Manifest | null = null;
  private readonly profielen = new Map<string, ProfileYear>();
  private readonly prijzen = new Map<number, PriceYear>();
  private readonly schalingen = new Map<string, NettingScale>();

  constructor(
    private readonly baseUrl = "/data",
    private readonly haal: Ophaler = fetch,
  ) {}

  async init(): Promise<Manifest> {
    if (!this.manifest) {
      this.manifest = await loadManifest(this.baseUrl, this.haal);
    }
    return this.manifest;
  }

  /** Het manifest, of een fout als init() nog niet is gedraaid. */
  get gegevens(): Manifest {
    if (!this.manifest) throw new Error("de invoerbron is nog niet geïnitialiseerd");
    return this.manifest;
  }

  async profiel(domain: string, year: number): Promise<ProfileYear> {
    const key = `${domain}:${year}`;
    const hit = this.profielen.get(key);
    if (hit) return hit;
    const geladen = await loadProfileYear(
      this.gegevens,
      domain,
      year,
      this.baseUrl,
      this.haal,
    );
    this.profielen.set(key, geladen);
    return geladen;
  }

  async prijs(year: number): Promise<PriceYear> {
    const hit = this.prijzen.get(year);
    if (hit) return hit;
    const geladen = await loadPriceYear(this.gegevens, year, this.baseUrl, this.haal);
    this.prijzen.set(year, geladen);
    return geladen;
  }

  /**
   * Schaalfactoren voor het netten, per netgebied en per stel jaarvolumes.
   *
   * Gebufferd, want de oplossing kost een tiental passes over een jaar en het
   * antwoord verandert alleen als het netgebied of de meterstanden veranderen.
   */
  private async schaling(config: Configuration): Promise<NettingScale> {
    const m = this.gegevens;
    const hh = config.household;
    const key = `${config.domain}:${hh.annualGridImportKwh}:${hh.annualGridExportKwh}`;
    const hit = this.schalingen.get(key);
    if (hit) return hit;

    const jaren = Object.entries(m.profielen[config.domain] ?? {})
      .filter(([, info]) => info.volledig_jaar)
      .map(([y]) => Number(y))
      .sort((a, b) => b - a);
    // Zonder vol jaar valt er niets betrouwbaars op te lossen; dan blijft de
    // reeks ongeschaald en komen de volumes onder de meterstanden uit.
    if (jaren.length === 0) return GEEN_SCHALING;

    const prof = await this.profiel(config.domain, jaren[0]!);
    const scale = solveNettingScale(prof.importFraction, prof.exportFraction, hh);
    this.schalingen.set(key, scale);
    return scale;
  }

  async bouwInvoer(config: Configuration): Promise<AnalysisInput> {
    const m = this.gegevens;
    const jaren = yearsInRange(m, config.domain, config.from, config.to);
    if (jaren.length === 0) {
      throw new Error(
        `geen profieldata voor netgebied ${config.domain} tussen ${config.from} en ${config.to}`,
      );
    }

    // De schaalfactoren die de genette reeks op de meterstanden laten uitkomen
    // worden op één VOL kalenderjaar bepaald en voor alle jaren gebruikt, ook
    // de deeljaren. Een deeljaar zou anders de jaartotalen in een deel van het
    // jaar proppen. Het meest recente volle jaar is het representatiefst.
    const schaling = await this.schaling(config);

    // Zonder historische heffing rekenen we met de heffing van nu: die van het
    // meest recente prijsjaar in de data, tenzij de gebruiker er zelf een opgaf.
    const actueleHeffing =
      config.tariff.energyTaxEurPerKwh > 0
        ? config.tariff.energyTaxEurPerKwh
        : m.prijzen[laatstePrijsjaar(m)]!.jaarconstante_eur_per_kwh;

    const windows: AnalysisInput["windows"] = [];
    for (const year of jaren) {
      const prof = await this.profiel(config.domain, year);
      const price = await this.prijs(year);
      const { start, end, firstDay, lastDay } = sliceRange(
        prof,
        config.from,
        config.to,
      );
      if (end <= start) continue;

      const startMs = prof.startMs.slice(start, end);
      const market = expandPricesToQuarters(startMs, price, "market");

      // Standaard rekenen we met de heffing zoals die op elk uur werkelijk
      // gold: allInPrijs minus marktprijs, per uur, want binnen een jaar
      // verschuift hij (2025: 17,13 ct tot september, daarna 14,29 ct). Dat
      // maakt de uitkomst een tegenfeitelijke doorrekening van wat er echt
      // gebeurd is.
      //
      // Met de heffing van nu wordt dezelfde vraag naar het heden getrokken:
      // wat had deze batterij opgeleverd op de prijzen van toen, maar met de
      // belasting en opslag van vandaag. Dat is wat een koper wil weten.
      let heffing: Float64Array;
      if (config.useHistoricalLevy) {
        const allIn = expandPricesToQuarters(startMs, price, "allIn");
        heffing = new Float64Array(market.length);
        for (let i = 0; i < heffing.length; i++) {
          heffing[i] = allIn[i]! - market[i]!;
        }
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
}
