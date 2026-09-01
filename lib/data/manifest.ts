/** Vorm van public/data/manifest.json, geschreven door scripts/build_assets.py. */

export interface PriceYearInfo {
  uren: number;
  volledig: boolean;
  eerste_uur_utc: string;
  laatste_uur_utc: string;
  ontbrekend: number;
  eerste_ontbrekend: string | null;
  /**
   * allInPrijs minus marktprijs, mediaan over het jaar: energiebelasting plus
   * inkoopvergoeding, inclusief btw. Dient als default voor de tariefopbouw.
   */
  jaarconstante_eur_per_kwh: number;
  jaarconstante_spreiding: number;
  bytes: number;
}

export interface ProfileYearInfo {
  kwartieren: number;
  eerste_dag: string;
  laatste_dag: string;
  volledig_jaar: boolean;
  /** Jaarsom vóór normalisatie; laat zien hoe ver de bron van 1 afweek. */
  ruwe_som_E17: number;
  ruwe_som_E18: number;
  normalisatie_E17: number;
  normalisatie_E18: number;
  /** Niet-null als de factor van een ander jaar is geleend (deeljaar). */
  normalisatie_geleend: string | null;
  bytes: number;
}

export interface Manifest {
  gegenereerd: string;
  categorie: string;
  afnametype: string;
  tijdzone: string;
  legenda: string;
  toelichting: Record<string, string>;
  prijzen: Record<string, PriceYearInfo>;
  profielen: Record<string, Record<string, ProfileYearInfo>>;
  netgebieden: string[];
}

/** Netgebieden met een herkenbare naam in plaats van een EAN-code. */
export const NETGEBIED_NAMEN: Record<string, string> = {
  "871685900000056162": "Liander",
  "871687120000052782": "Stedin",
  "871687400000002254": "Enexis",
  "871687800090000015": "Westland Infra",
  "871687910000219120": "Coteq",
  "871688520000076884": "Rendo",
  "871688600000002202": "Enduris",
  "871689200000010161": "Liander (Randmeren)",
  "871690200000000007": "Stedin (Delta)",
  "871690499910000003": "Enexis (Zuid)",
  "871690910000025589": "Liander (Noord)",
  "871691280000000008": "Enexis (Noord)",
  "871691600019188908": "Stedin (Utrecht)",
  "871692100000010038": "Liander (Gelderland)",
  "871692510000000005": "Enexis (Brabant)",
  "871694600000002173": "Liander (Flevoland)",
  "871694830000000309": "Stedin (Zuid-Holland)",
};

export function netgebiedNaam(ean: string): string {
  return NETGEBIED_NAMEN[ean] ?? ean;
}
