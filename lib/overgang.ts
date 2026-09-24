/**
 * De terugverdientijd van een batterij die je vandaag koopt.
 *
 * ── Het probleem ────────────────────────────────────────────────────────────
 * De pagina laat twee doorrekeningen zien: één op de tarieven zoals ze nu zijn,
 * en één met het tijdsafhankelijke nettarief dat vanaf 2029 gaat gelden. Beide
 * rekenen hun terugverdientijd alsof hún tarief de hele levensduur geldt, en
 * geen van beide klopt daarmee voor iemand die vandaag koopt: het nieuwe tarief
 * gaat pas over een paar jaar in, en het huidige verdwijnt dan.
 *
 * De ene terugverdientijd is dus te pessimistisch en de andere te optimistisch.
 * Dit bestand rekent het geval ertussenin: de eerste jaren op het huidige
 * tarief, daarna op het nieuwe, met dezelfde batterij die gewoon doorslijt.
 *
 * ── Vanaf wanneer ────────────────────────────────────────────────────────────
 * De berekening begint op een vaste datum, 1 januari 2027 (BEREKENING_START),
 * niet op vandaag; zie hieronder.
 *
 * ── Waarom dit geen extra simulatie kost ────────────────────────────────────
 * Beide doorrekeningen leveren al een besparingscurve op — besparing als functie
 * van de resterende capaciteit. De financiering leest daar per jaar een punt
 * van af. Twee curven en een omslagjaar is dus alleen een kwestie van per jaar
 * de goede curve pakken; er hoeft geen kwartier opnieuw door de solver.
 */

import { computeFinance, type FinanceResult } from "./model/finance";
import type { AnalysisResult, ScenarioResult } from "./model/analysis";
import { NETTARIEF_JAAR } from "./nettarief";
import { datum, jaren } from "./format";
import type { Configuration } from "./worker/protocol";

/**
 * AANNAME: de businesscase begint op 1 januari 2027, de dag dat de saldering
 * vervalt. Daarvóór levert een batterij bij saldering vrijwel niets op, dus
 * dat is het eerste jaar dat telt, ongeacht wanneer je hem koopt.
 *
 * Eerder hing de omslag aan de datum van vandaag, in hele kalenderjaren: wie
 * in januari of in september 2026 keek kreeg hetzelfde, en wie in januari
 * 2027 keek ineens een jaar minder op het huidige tarief. Het antwoord mocht
 * niet stil van de kalender afhangen. Met een vaste start zijn het precies
 * twee jaar op het huidige tarief (2027 en 2028), daarna het nettarief.
 */
export const BEREKENING_START = "2027-01-01";

/** De ingangsdatum van het nettarief, als datum (zie NETTARIEF_INGANG). */
export const NETTARIEF_INGANGSDATUM = `${NETTARIEF_JAAR}-01-01`;

/** Jaar plus het verstreken deel van dat jaar: 2027-07-02 ≈ 2027,5. */
function jaarMetBreuk(iso: string): number {
  const [j, m, d] = iso.split("-").map(Number) as [number, number, number];
  const begin = Date.UTC(j, 0, 1);
  const lengte = Date.UTC(j + 1, 0, 1) - begin;
  return j + (Date.UTC(j, m - 1, d) - begin) / lengte;
}

/**
 * Jaren op het huidige tarief, vanaf de start van de berekening tot de
 * ingang van het nettarief. Kan een breuk zijn; met de datums hierboven 2.
 */
export function jarenTotNettarief(
  start: string = BEREKENING_START,
  ingang: string = NETTARIEF_INGANGSDATUM,
): number {
  return Math.max(0, jaarMetBreuk(ingang) - jaarMetBreuk(start));
}

export interface Overgang {
  /** Hoeveel jaren de batterij op het huidige tarief draait; kan een breuk zijn. */
  jarenOpHuidigTarief: number;
  /** Het kalenderjaar waarin het nettarief ingaat. */
  ingangsjaar: number;
  /** Waar de berekening begint: `BEREKENING_START`. */
  start: string;
  /** De businesscase over de hele looptijd, met de omslag erin. */
  finance: FinanceResult;
}

/**
 * De businesscase met de tariefwissel erin verwerkt: van `BEREKENING_START`
 * tot de ingang van het nettarief de curve van nu, daarna die van het
 * scenario. `start` is alleen voor tests en wat-als; de app gebruikt de
 * vaste aanname.
 */
export function overgangsFinance(
  huidig: AnalysisResult,
  scenario: ScenarioResult,
  config: Configuration,
  start: string = BEREKENING_START,
): Overgang {
  const jarenOpHuidigTarief = jarenTotNettarief(start);
  return {
    jarenOpHuidigTarief,
    ingangsjaar: NETTARIEF_JAAR,
    start,
    finance: computeFinance({
      curve: huidig.curve,
      curveLater: scenario.curve,
      // 1-gebaseerd: staan er nog twee jaren op het huidige tarief, dan geldt
      // het nieuwe vanaf het derde. Een breuk verdeelt het omslagjaar.
      curveLaterVanafJaar: jarenOpHuidigTarief + 1,
      investmentEur: config.investmentEur,
      years: config.analysisYears,
      priceEscalation: config.priceEscalation,
      discountRate: config.discountRate,
      calendarFadePerYear: config.calendarFadePerYear,
      cycleLife: config.cycleLife,
      residualValueEur: config.residualValueEur,
    }),
  };
}

/**
 * De overgang in woorden, uit de overgang zelf: "vanaf 1 januari 2027 eerst 2
 * jaar". Eén formulering voor het antwoord, het nettarief en de uitleg, zodat
 * ze niet elk hun eigen startjaar uitrekenen.
 */
export function overgangZin(o: Pick<Overgang, "start" | "jarenOpHuidigTarief">): string {
  const duur = o.jarenOpHuidigTarief === 1 ? "een jaar" : jaren(o.jarenOpHuidigTarief);
  return `vanaf ${datum(o.start)} eerst ${duur}`;
}
