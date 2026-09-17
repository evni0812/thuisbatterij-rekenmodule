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
 * ── Waarom dit geen extra simulatie kost ────────────────────────────────────
 * Beide doorrekeningen leveren al een besparingscurve op — besparing als functie
 * van de resterende capaciteit. De financiering leest daar per jaar een punt
 * van af. Twee curven en een omslagjaar is dus alleen een kwestie van per jaar
 * de goede curve pakken; er hoeft geen kwartier opnieuw door de solver.
 */

import { computeFinance, type FinanceResult } from "./model/finance";
import type { AnalysisResult, ScenarioResult } from "./model/analysis";
import { NETTARIEF_JAAR } from "./nettarief";
import type { Configuration } from "./worker/protocol";

export interface Overgang {
  /** Hoeveel hele jaren de batterij nog op het huidige tarief draait. */
  jarenOpHuidigTarief: number;
  /** Het kalenderjaar waarin het nettarief ingaat. */
  ingangsjaar: number;
  /** De businesscase over de hele looptijd, met de omslag erin. */
  finance: FinanceResult;
}

/**
 * De businesscase met de tariefwissel erin verwerkt.
 *
 * `nu` is injecteerbaar zodat een test niet van de kalender afhangt; in de app
 * is het simpelweg vandaag. Ligt het ingangsjaar al achter ons, dan geldt het
 * nieuwe tarief vanaf jaar één en is de uitkomst gelijk aan die van het
 * scenario — precies goed, zonder speciaal geval.
 */
export function overgangsFinance(
  huidig: AnalysisResult,
  scenario: ScenarioResult,
  config: Configuration,
  nu: Date = new Date(),
): Overgang {
  const jarenOpHuidigTarief = Math.max(0, NETTARIEF_JAAR - nu.getFullYear());
  return {
    jarenOpHuidigTarief,
    ingangsjaar: NETTARIEF_JAAR,
    finance: computeFinance({
      curve: huidig.curve,
      curveLater: scenario.curve,
      // 1-gebaseerd: staan er nog drie jaren op het huidige tarief, dan geldt
      // het nieuwe vanaf het vierde.
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
