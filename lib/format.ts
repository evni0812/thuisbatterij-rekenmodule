/**
 * Getallen opmaken voor een breed publiek.
 *
 * De regel: rond af tot wat betekenis heeft. Een besparing van 78,1834 euro
 * suggereert een precisie die het model niet heeft — het is een doorrekening op
 * historische data, geen factuur.
 */

const euro0 = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const euro2 = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const getal0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const getal1 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

/**
 * Formatters per aantal decimalen, aangemaakt wanneer ze nodig zijn.
 * Intl.NumberFormat is duur om te bouwen en wordt hier in lussen aangeroepen.
 */
const getalCache = new Map<number, Intl.NumberFormat>();

/** Bedragen boven een tientje zonder centen; daaronder mét, want dan tellen ze. */
export function euro(value: number): string {
  return Math.abs(value) >= 10 ? euro0.format(value) : euro2.format(value);
}

export function euroPrecies(value: number): string {
  return euro2.format(value);
}

/**
 * Prijzen per kWh in centen: leesbaarder dan 0,1713 EUR.
 * De eenheid staat er voluit bij, want "17,1 ct" alleen roept de vraag op
 * waarvan.
 */
export function centPerKwh(eurPerKwh: number): string {
  return `${getal1.format(eurPerKwh * 100)} ct/kWh`;
}

export function kwh(value: number): string {
  return `${getal0.format(value)} kWh`;
}

export function procent(fraction: number, decimalen = 0): string {
  const f = new Intl.NumberFormat("nl-NL", {
    style: "percent",
    maximumFractionDigits: decimalen,
  });
  return f.format(fraction);
}

export function getal(value: number, decimalen = 0): string {
  if (decimalen === 0) return getal0.format(value);
  if (decimalen === 1) return getal1.format(value);
  // Eerder viel alles boven één decimaal stil terug op één. Dagtotalen van
  // 0,84 kWh werden dan "0,8" en alles onder 0,05 kWh werd "0".
  let f = getalCache.get(decimalen);
  if (!f) {
    f = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: decimalen });
    getalCache.set(decimalen, f);
  }
  return f.format(value);
}

/** "8 jaar en 4 maanden" leest prettiger dan "8,3 jaar". */
export function jaren(value: number | null): string {
  if (value === null) return "verdient zichzelf niet terug";
  const heel = Math.floor(value);
  const maanden = Math.round((value - heel) * 12);
  if (maanden === 0) return `${heel} jaar`;
  if (maanden === 12) return `${heel + 1} jaar`;
  return `${heel} jaar en ${maanden} ${maanden === 1 ? "maand" : "maanden"}`;
}

const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/** "1 juni 2025" — geen streepjesdatum in lopende tekst. */
export function datum(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MAANDEN[m - 1]} ${y}`;
}

/** Korte periodeaanduiding, bijvoorbeeld "apr – dec 2023". */
export function periode(vanIso: string, totIso: string): string {
  const [y1, m1] = vanIso.split("-").map(Number);
  const [y2, m2] = totIso.split("-").map(Number);
  if (!y1 || !m1 || !y2 || !m2) return `${vanIso} tot ${totIso}`;
  const kort = (m: number) => MAANDEN[m - 1]!.slice(0, 3);
  if (y1 === y2) {
    if (m1 === 1 && m2 === 12) return String(y1);
    return `${kort(m1)} tot ${kort(m2)} ${y1}`;
  }
  return `${kort(m1)} ${y1} tot ${kort(m2)} ${y2}`;
}
