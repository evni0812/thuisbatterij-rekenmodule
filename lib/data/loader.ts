/**
 * Laden en decoderen van de statische assets.
 *
 * De bestanden zijn geschreven door scripts/build_assets.py en worden vanaf de
 * CDN geserveerd. Formaat, little-endian:
 *
 *   magic    4 bytes   "TBAT"
 *   versie   uint16
 *   opvulling uint16   zodat de data op een veelvoud van 4 begint
 *   reeksen  uint32    aantal reeksen in het bestand (altijd 2)
 *   lengte   uint32    waarden per reeks
 *   data     float32[] reeksen achter elkaar
 *
 * De opvulling is geen luxe: Float32Array weigert een view te maken op een
 * offset die geen veelvoud van 4 is.
 *
 * De tijdas staat er bewust NIET in: die is deterministisch af te leiden uit de
 * begindatum in het manifest en de zomertijdregels, en zou anders de helft van
 * elk bestand beslaan.
 */

import { buildQuarterAxis, addDays, localMidnightUtcMs, MS_PER_HOUR } from "./timeaxis";
import type { Manifest } from "./manifest";

const MAGIC = 0x54414254; // "TBAT" little-endian gelezen als uint32

export interface BinarySeries {
  length: number;
  series: Float32Array[];
}

export function decodeBinary(buffer: ArrayBuffer): BinarySeries {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error("onbekend bestandsformaat: magic klopt niet");
  }
  const version = view.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`onbekende bestandsversie ${version}`);
  }
  const count = view.getUint32(8, true);
  const length = view.getUint32(12, true);

  const headerBytes = 16;
  const expected = headerBytes + count * length * 4;
  if (buffer.byteLength < expected) {
    throw new Error(
      `bestand te kort: ${buffer.byteLength} bytes, ${expected} verwacht`,
    );
  }

  const series: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    series.push(
      new Float32Array(buffer, headerBytes + i * length * 4, length),
    );
  }
  return { length, series };
}

/** Profielfracties van één netgebied en kalenderjaar. */
export interface ProfileYear {
  year: number;
  /** UTC-milliseconden per kwartier. */
  startMs: Float64Array;
  /** Genormaliseerde afnamefracties (E17). */
  importFraction: Float32Array;
  /** Genormaliseerde invoedingsfracties (E18). */
  exportFraction: Float32Array;
  firstDay: string;
  lastDay: string;
  isFullYear: boolean;
}

/** Uurprijzen van één kalenderjaar, in EUR/kWh inclusief btw. */
export interface PriceYear {
  year: number;
  /** UTC-milliseconden van het eerste uur. */
  firstHourMs: number;
  marketPrice: Float32Array;
  allInPrice: Float32Array;
  /** Mediane allInPrijs − marktprijs: energiebelasting plus opslag. */
  levyEurPerKwh: number;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`kon ${url} niet laden: HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

export async function loadManifest(base = "/data"): Promise<Manifest> {
  const res = await fetch(`${base}/manifest.json`);
  if (!res.ok) throw new Error(`manifest niet gevonden: HTTP ${res.status}`);
  return (await res.json()) as Manifest;
}

export async function loadProfileYear(
  manifest: Manifest,
  domain: string,
  year: number,
  base = "/data",
): Promise<ProfileYear> {
  const info = manifest.profielen[domain]?.[String(year)];
  if (!info) {
    throw new Error(`geen profiel voor netgebied ${domain} in ${year}`);
  }
  const { length, series } = decodeBinary(
    await fetchBuffer(`${base}/profile-${domain}-${year}.bin`),
  );
  const startMs = buildQuarterAxis(info.eerste_dag, addDays(info.laatste_dag, 1));
  if (startMs.length !== length) {
    // Dit betekent dat de zomertijdregels in de browser afwijken van die bij het
    // bouwen van de assets; alles daarna zou stil een uur verschuiven.
    throw new Error(
      `tijdas van ${length} kwartieren verwacht, ${startMs.length} berekend ` +
        `voor ${info.eerste_dag}…${info.laatste_dag}`,
    );
  }
  return {
    year,
    startMs,
    importFraction: series[0]!,
    exportFraction: series[1]!,
    firstDay: info.eerste_dag,
    lastDay: info.laatste_dag,
    isFullYear: info.volledig_jaar,
  };
}

export async function loadPriceYear(
  manifest: Manifest,
  year: number,
  base = "/data",
): Promise<PriceYear> {
  const info = manifest.prijzen[String(year)];
  if (!info) throw new Error(`geen prijzen voor ${year}`);
  const { series } = decodeBinary(
    await fetchBuffer(`${base}/prices-${year}.bin`),
  );
  return {
    year,
    firstHourMs: localMidnightUtcMs(`${year}-01-01`),
    marketPrice: series[0]!,
    allInPrice: series[1]!,
    levyEurPerKwh: info.jaarconstante_eur_per_kwh,
  };
}

/**
 * Rol de uurprijzen uit over een kwartier-tijdas.
 *
 * De prijs is constant binnen het uur; de energiebalans rekent per kwartier.
 * De koppeling gaat via UTC-instants, niet via lokale uren: dat blijft ook op
 * de zomertijdovergangen kloppen, waar een lokaal uur twee keer voorkomt of
 * helemaal ontbreekt.
 */
export function expandPricesToQuarters(
  startMs: Float64Array,
  price: PriceYear,
  which: "market" | "allIn" = "market",
): Float64Array {
  const src = which === "market" ? price.marketPrice : price.allInPrice;
  const out = new Float64Array(startMs.length);
  for (let i = 0; i < startMs.length; i++) {
    const idx = Math.floor((startMs[i]! - price.firstHourMs) / MS_PER_HOUR);
    if (idx < 0 || idx >= src.length) {
      throw new Error(
        `prijsindex ${idx} valt buiten de reeks van ${src.length} uren ` +
          `(kwartier ${i}); prijsjaar en profieljaar sluiten niet op elkaar aan`,
      );
    }
    out[i] = src[idx]!;
  }
  return out;
}
