/**
 * De configuratie in de URL.
 *
 * Elke doorrekening is daarmee deelbaar: een link bevat precies de invoer die
 * tot dat antwoord leidde. Alleen afwijkingen van de standaard komen in de URL,
 * zodat een gewone berekening een schone adresbalk houdt.
 */

import type { Doel } from "./model/types";
import { normaliseerDeel } from "./normaliseer";

export interface Instellingen {
  afnameKwh: number;
  terugleveringKwh: number;
  /**
   * Met zonnepanelen (standaard) rekent de tool met het gemeten profiel van
   * huishoudens mét invoeding; zonder met dat van huishoudens zonder. Beide
   * zijn echte metingen (MFFBAS E1A, afnametype AMI en AZI).
   */
  zonnepanelen: boolean;
  presetId: string;
  domein: string;
  /** Leeg betekent: de volledige beschikbare periode. */
  van: string;
  tot: string;
  spreiding: number;
  terugleverkostenCt: number;
  curtailment: boolean;
  /**
   * Met welke heffing (energiebelasting plus opslag) er gerekend wordt:
   * "toen" is de heffing zoals die op elk uur van de gekozen periode gold,
   * "nu" is die van het meest recente jaar in de data, over alle jaren.
   */
  heffing: "toen" | "nu";
  analysejaren: number;
  discontovoet: number;
  prijsstijging: number;
  degradatie: number;
  /**
   * Deel van de volle slijtageprijs dat de planner per geleverde kWh rekent,
   * 0–1. Zie lib/strategie.ts voor de drie standen.
   */
  slijtageDeel: number;
  /**
   * De kostenregel voor andere maten dan de gekozen batterij: meerprijs per
   * kWh, per kW en de installateur boven 0,8 kW. Zie lib/model/kosten.ts.
   */
  kostenPerKwh: number;
  kostenPerKw: number;
  installatieEur: number;
  /** Drempel voor het Nederlandse CO2-perspectief, g/kWh. Zie lib/model/co2.ts. */
  co2Drempel: number;
  /** Waar de planner op stuurt: rendement, zelfconsumptie of uitstoot. */
  doel: Doel;
  /** Null betekent: neem de waarde van de gekozen batterij over. */
  prijsEur: number | null;
  capaciteitKwh: number | null;
  vermogenKw: number | null;
  /** Bruto jaaropwek van de panelen; null als onbekend. */
  opwekKwh: number | null;
}

/** Korte sleutels, zodat een gedeelde link leesbaar blijft. */
const SLEUTELS: Record<keyof Instellingen, string> = {
  afnameKwh: "af",
  terugleveringKwh: "tl",
  zonnepanelen: "zon",
  presetId: "bat",
  domein: "net",
  van: "van",
  tot: "tot",
  spreiding: "spr",
  terugleverkostenCt: "tlk",
  curtailment: "afr",
  heffing: "hef",
  analysejaren: "jr",
  discontovoet: "disc",
  prijsstijging: "stg",
  degradatie: "deg",
  slijtageDeel: "slt",
  kostenPerKwh: "pkwh",
  kostenPerKw: "pkw",
  installatieEur: "inst",
  co2Drempel: "co2d",
  doel: "doel",
  prijsEur: "prijs",
  capaciteitKwh: "cap",
  vermogenKw: "kw",
  opwekKwh: "opwek",
};

/**
 * Een getal zoals schrijfUrl het wegschrijft: cijfers, hoogstens een minteken
 * en een decimale punt. `Number()` alleen is te ruim: die maakt van een leeg
 * veld 0, van `0x10` 16 en van `1e12` een biljoen.
 */
const GETAL = /^-?\d+(\.\d+)?$/;

/**
 * Lees de instellingen uit de URL, binnen de grenzen van lib/normaliseer.ts.
 *
 * Wat niet te lezen is valt weg (de pagina neemt er de standaard voor), wat
 * buiten de grenzen valt wordt geklemd. De sleutels die niet ongeschonden
 * door de controle kwamen gaan naar `gecorrigeerd`, zodat de pagina kan zeggen
 * dat een link is aangepast; schrijfUrl schoont de adresbalk daarna vanzelf op.
 */
export function leesUrl(gecorrigeerd?: (keyof Instellingen)[]): Partial<Instellingen> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const ruw: Partial<Record<keyof Instellingen, unknown>> = {};

  const getalVelden: (keyof Instellingen)[] = [
    "afnameKwh",
    "terugleveringKwh",
    "spreiding",
    "terugleverkostenCt",
    "analysejaren",
    "discontovoet",
    "prijsstijging",
    "degradatie",
    "slijtageDeel",
    "kostenPerKwh",
    "kostenPerKw",
    "installatieEur",
    "co2Drempel",
    "prijsEur",
    "capaciteitKwh",
    "vermogenKw",
    "opwekKwh",
  ];
  for (const k of getalVelden) {
    const v = p.get(SLEUTELS[k]);
    if (v === null) continue;
    // Onleesbaar: als ongeldig doorgeven, zodat het gemeld wordt.
    ruw[k] = GETAL.test(v.trim()) ? Number(v) : Number.NaN;
  }
  for (const k of ["presetId", "domein", "van", "tot", "heffing", "doel"] as const) {
    const v = p.get(SLEUTELS[k]);
    if (v !== null && v !== "") ruw[k] = v;
  }
  for (const k of ["curtailment", "zonnepanelen"] as const) {
    const v = p.get(SLEUTELS[k]);
    if (v === null) continue;
    ruw[k] = v === "1" ? true : v === "0" ? false : v;
  }

  return normaliseerDeel(ruw, gecorrigeerd);
}

export function schrijfUrl(
  inst: Instellingen,
  standaard: Instellingen,
  /** Losse parameters naast de instellingen, zoals het open tabblad. */
  extra: Record<string, string> = {},
): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) p.set(k, v);

  for (const sleutel of Object.keys(SLEUTELS) as (keyof Instellingen)[]) {
    const waarde = inst[sleutel];
    const basis = standaard[sleutel];
    if (waarde === basis || waarde === null || waarde === "") continue;
    p.set(
      SLEUTELS[sleutel],
      typeof waarde === "boolean" ? (waarde ? "1" : "0") : String(waarde),
    );
  }

  const query = p.toString();
  const doel = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  // replaceState in plaats van pushState: elke schuif zou anders een stap in de
  // geschiedenis worden en de terugknop onbruikbaar maken.
  window.history.replaceState(null, "", doel);
}
