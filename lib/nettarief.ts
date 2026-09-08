/**
 * Het tijdsafhankelijke nettarief dat er vanaf 2029 aankomt.
 *
 * ── Wat vaststaat ───────────────────────────────────────────────────────────
 * De netbeheerders hebben op 4 mei 2026 bij de ACM een voorstel ingediend voor
 * een volume- en tijdsafhankelijk transporttarief voor alle aansluitingen tot
 * 3×80 A. Circa een derde van de netkosten blijft vast; de rest gaat afhangen
 * van hoeveel je gebruikt, wanneer, en in welk seizoen. Vier prijsniveaus, vijf
 * tijdsblokken. De ACM beslist naar verwachting voor eind 2026; invoering is
 * voorzien op 1 januari 2029.
 *
 * ── Wat NIET vaststaat: de bedragen ─────────────────────────────────────────
 * Het voorstel toont alleen relatieve niveaus. De tarieven hieronder zijn dus
 * geen tariefblad maar een PROGNOSE: CE Delft, geprognosticeerde nettarieven in
 * 2030 in euro per kWh per uur per maand, op basis van Netbeheer Nederland
 * 2026b en 2026c. Aangeleverd door Erik.
 *
 * Vandaar ook vijf niveaus (0,00 / 0,06 / 0,10 / 0,13 / 0,19) waar het voorstel
 * er vier noemt: dit is een doorrekening naar 2030, geen overname van het
 * voorstel.
 *
 * De prognose is geijkt op een huishouden van 3.000 kWh per jaar, met een
 * volume- en tijdsafhankelijk transporttarief van EUR 335 inclusief btw. Dat
 * komt volgens de door de ACM gepubliceerde rekenmethodiek uit op ongeveer
 * EUR 0,19/kWh als bovenste trede — het getal dat je in de winteravond terugziet.
 * Daarnaast staan er nog EUR 167 vastrecht (een derde van de transportkosten) en
 * EUR 135 periodieke aansluitvergoeding, en die blijven buiten deze tabel omdat
 * ze niet van je gedrag afhangen.
 *
 * ── Waarom dit de businesscase omgooit ──────────────────────────────────────
 * Het winterpiektarief van 19 ct/kWh komt bovenop de energieprijs, terwijl het
 * hele prijsverschil op een winterdag nu rond de 10 ct ligt. Tegelijk gaat de
 * zomermiddag naar nul, precies wanneer het net vol zonnestroom staat. Dat is
 * exact het patroon waar een batterij op verdient.
 *
 * ── Wat dit betekent voor de rest van de tool ───────────────────────────────
 * De tool laat netbeheerkosten normaal buiten beschouwing: ze zijn met en zonder
 * batterij gelijk, dus ze beïnvloeden de besparing niet. Voor het variabele deel
 * geldt dat straks niet meer. Het vaste deel — die circa een derde — blijft wél
 * buiten beeld en blijft batterij-onafhankelijk.
 */

import type { LocalTimeIndex } from "./data/timeaxis";

/** Bron van de tarieven hieronder, voor in de interface. */
export const NETTARIEF_BRON =
  "CE Delft, geprognosticeerde nettarieven 2030, op basis van Netbeheer Nederland (2026b, 2026c)";

/** Wanneer het stelsel volgens het voorstel ingaat. */
export const NETTARIEF_INGANG = "1 januari 2029";

/**
 * Wintertarief per uur, in EUR/kWh. Geldt in januari, februari, maart, oktober,
 * november en december.
 *
 * Uur 0 is 0,13; de nacht 0,10; de ochtendspits 7 tot en met 9 weer 0,13; overdag
 * 0,10; de avondpiek 16 tot en met 22 op 0,19, en 23 valt terug naar 0,13.
 */
const WINTER: readonly number[] = [
  0.13, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.13, 0.13, 0.13, 0.1, 0.1,
  0.1, 0.1, 0.1, 0.1, 0.19, 0.19, 0.19, 0.19, 0.19, 0.19, 0.19, 0.13,
];

/**
 * Zomertarief per uur, in EUR/kWh. Geldt van april tot en met september.
 *
 * De middag 10 tot en met 16 is gratis: dan staat het net vol zonnestroom en
 * wil de netbeheerder dat je juist afneemt. Zeven uur lang, niet zes — het
 * gratis blok loopt door tot en met 16:00.
 *
 * De avondpiek begint pas om 19:00 en loopt door tot en met 23:00. Dat is later
 * en langer dan in de winter, waar de piek al om 16:00 begint en om 23:00 al
 * weer is gezakt.
 */
const ZOMER: readonly number[] = [
  0.1, 0.1, 0.1, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0, 0,
  0, 0, 0, 0, 0, 0.06, 0.06, 0.13, 0.13, 0.13, 0.13, 0.13,
];

/** Maand 1–12 naar het uurprofiel dat die maand geldt. */
export function profielVoorMaand(maand: number): readonly number[] {
  return maand >= 4 && maand <= 9 ? ZOMER : WINTER;
}

/** Alle voorkomende niveaus, oplopend; voor de legenda. */
export const NETTARIEF_NIVEAUS = [0, 0.06, 0.1, 0.13, 0.19] as const;

/**
 * Bouw de nettariefreeks voor een tijdas.
 *
 * Maand en uur worden in LOKALE tijd bepaald, net als overal in dit model: een
 * tariefblok van 16:00 tot 23:00 is wandkloktijd, en de UTC-grens daarvan
 * schuift met de zomertijd mee.
 */
export function nettariefPerStap(
  startMs: Float64Array,
  index: LocalTimeIndex,
): Float64Array {
  const uit = new Float64Array(startMs.length);
  for (let i = 0; i < startMs.length; i++) {
    const ms = startMs[i]!;
    const maand = Number(index.localDate(ms).slice(5, 7));
    uit[i] = profielVoorMaand(maand)[index.localHour(ms)]!;
  }
  return uit;
}

/** Gemiddeld tarief over een heel jaar, ongewogen; voor de uitleg. */
export function gemiddeldNettarief(): number {
  let som = 0;
  for (let m = 1; m <= 12; m++) {
    for (const v of profielVoorMaand(m)) som += v;
  }
  return som / (12 * 24);
}
