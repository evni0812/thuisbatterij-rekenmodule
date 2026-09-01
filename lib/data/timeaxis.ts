/**
 * DST-veilige tijdas voor kwartier- en uurreeksen in Europe/Amsterdam.
 *
 * Waarom dit een eigen module is: Nederlandse dagen hebben 92, 96 of 100
 * kwartieren. De MFFBAS-fracties zijn per kalenderdag genummerd met pos 1..96
 * (of 92/100), waarbij pos 1 altijd lokale middernacht is. De ANWB-prijzen zijn
 * uurwaarden op UTC-instants. Alles wat dag-, maand- of jaargrenzen bepaalt
 * moet in lokale tijd gebeuren; alles wat reeksen koppelt in UTC.
 *
 * Het oude Streamlit-model ging uit van 365 x 24 vaste uren en had daardoor
 * 's zomers een structurele verschuiving van een uur tussen verbruiksprofiel
 * en prijsreeks.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_QUARTER = 15 * MS_PER_MINUTE;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const AMSTERDAM = "Europe/Amsterdam";

/**
 * Offset van Europe/Amsterdam ten opzichte van UTC, in minuten, op een gegeven
 * instant. +60 in de winter, +120 in de zomer.
 *
 * Gebruikt Intl in plaats van een tijdzonebibliotheek: de browser heeft de
 * IANA-database al, en dit blijft correct als de DST-regels ooit wijzigen.
 */
export function amsterdamOffsetMinutes(utcMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: AMSTERDAM,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new Error(`ontbrekend datumdeel: ${type}`);
    return Number(p.value);
  };
  // Intl geeft 24 voor middernacht in sommige runtimes; normaliseer naar 0.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - utcMs) / MS_PER_MINUTE);
}

/**
 * UTC-instant van lokale middernacht op een kalenderdag (YYYY-MM-DD).
 *
 * Middernacht valt in Nederland nooit in het DST-gat, dus deze conversie is
 * eenduidig. We bepalen de offset iteratief omdat de offset zelf van het
 * resultaat afhangt.
 */
export function localMidnightUtcMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`ongeldige datum: ${isoDate}`);
  }
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Eerste schatting met de offset op het naïeve moment, daarna corrigeren.
  let guess = naive - amsterdamOffsetMinutes(naive) * MS_PER_MINUTE;
  guess = naive - amsterdamOffsetMinutes(guess) * MS_PER_MINUTE;
  return guess;
}

/**
 * Aantal kwartieren op een kalenderdag: 92 op de dag dat de klok vooruit gaat,
 * 100 als hij achteruit gaat, anders 96.
 */
export function quartersOnDate(isoDate: string): number {
  const start = localMidnightUtcMs(isoDate);
  const next = localMidnightUtcMs(addDays(isoDate, 1));
  return Math.round((next - start) / MS_PER_QUARTER);
}

/** Kalenderdatum n dagen later, puur op de kalender (geen tijdzone). */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`ongeldige datum: ${isoDate}`);
  }
  const t = Date.UTC(y, m - 1, d) + n * 24 * MS_PER_HOUR;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * UTC-instant van kwartier `pos` (1-based) op een kalenderdag.
 *
 * Ankeren op UTC in plaats van op lokale wandkloktijd: UTC loopt lineair door,
 * ook op DST-dagen, dus `middernacht + (pos-1) * 15min` klopt altijd. Dit is
 * dezelfde afspraak die fetch_profielfracties.py hanteert.
 */
export function quarterUtcMs(isoDate: string, pos: number): number {
  return localMidnightUtcMs(isoDate) + (pos - 1) * MS_PER_QUARTER;
}

/** Alle kalenderdagen van start (incl.) tot end (excl.). */
export function dateRange(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let cur = startIso;
  while (cur < endIso) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Bouw de kwartier-tijdas voor een datumbereik.
 * Lengte is de som van quartersOnDate() over alle dagen, dus DST-correct.
 */
export function buildQuarterAxis(startIso: string, endIso: string): Float64Array {
  const dates = dateRange(startIso, endIso);
  let total = 0;
  for (const d of dates) total += quartersOnDate(d);

  const axis = new Float64Array(total);
  let i = 0;
  for (const d of dates) {
    const base = localMidnightUtcMs(d);
    const n = quartersOnDate(d);
    for (let q = 0; q < n; q++) axis[i++] = base + q * MS_PER_QUARTER;
  }
  return axis;
}

/** Het hele uur waarin een instant valt, als UTC-milliseconden. */
export function floorToHourMs(utcMs: number): number {
  return Math.floor(utcMs / MS_PER_HOUR) * MS_PER_HOUR;
}

/** Lokale kalenderdatum (YYYY-MM-DD) van een UTC-instant. */
export function localDateOf(utcMs: number): string {
  const shifted = utcMs + amsterdamOffsetMinutes(utcMs) * MS_PER_MINUTE;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** Lokaal uur van de dag (0–23) van een UTC-instant. */
export function localHourOf(utcMs: number): number {
  const shifted = utcMs + amsterdamOffsetMinutes(utcMs) * MS_PER_MINUTE;
  return new Date(shifted).getUTCHours();
}

/**
 * Snelle lokale-tijd lookups voor een vast tijdsbereik.
 *
 * Intl.DateTimeFormat is correct maar duur: enkele microseconden per aanroep.
 * Een jaar heeft 35.040 kwartieren, en de dispatch vraagt voor elk daarvan de
 * lokale dag en het lokale uur — dat kost bijna een seconde aan puur
 * datumformatteren.
 *
 * De offset van Europe/Amsterdam verandert echter maar twee keer per jaar. Door
 * die overgangen één keer met binary search op te zoeken, wordt elke verdere
 * lookup simpele rekenkunde.
 */
export class LocalTimeIndex {
  /** UTC-instants waarop de offset verandert, oplopend. */
  private readonly transitions: number[] = [];
  /** Offset in minuten die geldt vanaf de bijbehorende transitie. */
  private readonly offsets: number[] = [];

  constructor(fromMs: number, toMs: number) {
    const first = amsterdamOffsetMinutes(fromMs);
    this.transitions.push(fromMs);
    this.offsets.push(first);

    // Loop met dagstappen door het bereik; zodra de offset verschilt, zoek het
    // exacte overgangsmoment met binary search op minuutniveau.
    const DAY = 24 * MS_PER_HOUR;
    let prevMs = fromMs;
    let prevOff = first;
    for (let t = fromMs + DAY; t < toMs + DAY; t += DAY) {
      const off = amsterdamOffsetMinutes(Math.min(t, toMs));
      if (off !== prevOff) {
        let lo = prevMs;
        let hi = Math.min(t, toMs);
        while (hi - lo > MS_PER_MINUTE) {
          const mid = lo + Math.floor((hi - lo) / 2);
          if (amsterdamOffsetMinutes(mid) === prevOff) lo = mid;
          else hi = mid;
        }
        this.transitions.push(hi);
        this.offsets.push(off);
        prevOff = off;
      }
      prevMs = Math.min(t, toMs);
    }
  }

  /** Offset in minuten op een instant binnen het bereik. */
  offsetAt(utcMs: number): number {
    // Hooguit een handvol transities, dus lineair terugzoeken is het snelst.
    for (let i = this.transitions.length - 1; i >= 0; i--) {
      if (utcMs >= this.transitions[i]!) return this.offsets[i]!;
    }
    return this.offsets[0]!;
  }

  /** Dagnummer sinds epoch in lokale tijd; opeenvolgende dagen verschillen 1. */
  localDayNumber(utcMs: number): number {
    return Math.floor(
      (utcMs + this.offsetAt(utcMs) * MS_PER_MINUTE) / (24 * MS_PER_HOUR),
    );
  }

  /** Lokaal uur van de dag, 0–23. */
  localHour(utcMs: number): number {
    const shifted = utcMs + this.offsetAt(utcMs) * MS_PER_MINUTE;
    return Math.floor(shifted / MS_PER_HOUR) % 24;
  }

  /** Lokale kalenderdatum (YYYY-MM-DD). */
  localDate(utcMs: number): string {
    const shifted = utcMs + this.offsetAt(utcMs) * MS_PER_MINUTE;
    return new Date(shifted).toISOString().slice(0, 10);
  }
}

export { MS_PER_QUARTER, MS_PER_HOUR, MS_PER_MINUTE };
