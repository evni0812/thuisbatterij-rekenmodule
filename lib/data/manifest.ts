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
  /**
   * Deel van de uren waarin marktprijs en allInPrijs op hele centen staan. De
   * ANWB-API rondt sinds 20 juni 2026 af; de build waarschuwt boven 10%.
   * Optioneel, zodat een ouder manifest blijft laden.
   */
  aandeel_hele_centen?: number;
  /** Vanaf welke dag elk uur op hele centen staat, of null. */
  hele_centen_vanaf?: string | null;
  bytes: number;
  /** sha256 van het bestand, hex. Optioneel voor een ouder manifest. */
  sha256?: string;
}

/** Eén jaar emissiefactoren van de stroommix, uurwaarden in g/kWh. */
export interface Co2YearInfo {
  uren: number;
  volledig: boolean;
  eerste_uur_utc: string;
  laatste_uur_utc: string;
  ontbrekend: number;
  gemiddelde_g_per_kwh: number;
  bytes: number;
  sha256?: string;
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
  sha256?: string;
}

export interface Manifest {
  gegenereerd: string;
  categorie: string;
  afnametype: string;
  tijdzone: string;
  legenda: string;
  toelichting: Record<string, string>;
  prijzen: Record<string, PriceYearInfo>;
  /**
   * De emissiefactor van de Nederlandse elektriciteitsmix per uur (NED.nl),
   * bestanden co2-<jaar>.bin. Optioneel: zonder blijft de CO2-balans leeg.
   */
  co2?: Record<string, Co2YearInfo>;
  profielen: Record<string, Record<string, ProfileYearInfo>>;
  /**
   * Dezelfde opbouw voor aansluitingen zónder invoeding (huishoudens zonder
   * zonnepanelen), bestanden met achtervoegsel "-azi". Optioneel, zodat een
   * ouder manifest blijft laden.
   */
  profielen_zonder?: Record<string, Record<string, ProfileYearInfo>>;
  afnametype_zonder?: string;
  netgebieden: string[];
  /**
   * De laatste dag met een volledige dag prijzen; de profielen zijn daarop
   * afgekapt, zodat elk profielkwartier een prijs heeft.
   */
  profielen_tot?: string;
}

/**
 * Welk gemeten profiel er gebruikt wordt: AMI is de aansluiting mét invoeding
 * (huishouden met zonnepanelen), AZI die zonder.
 */
export type Afnametype = "AMI" | "AZI";

/** De profielen van het gevraagde afnametype, of leeg als het manifest ze mist. */
export function profielenVan(
  m: Manifest,
  afnametype: Afnametype = "AMI",
): Record<string, Record<string, ProfileYearInfo>> {
  return afnametype === "AZI" ? (m.profielen_zonder ?? {}) : m.profielen;
}

/**
 * Netgebieden met een herkenbare naam in plaats van een EAN-code.
 *
 * De code is de EAN van het netgebied waarop MFFBAS/EDSN de DYNAMIC-profielen
 * publiceert. Bron van de koppeling code → netbeheerder: NEDU/CQM, "NEDU
 * steekproef allocatie" (april 2021), Tabel 1, gecontroleerd tegen
 * energiedatawijzer.nl. Tussen haakjes de regio of de oude netbeheerder die
 * in het gebied is opgegaan, zodat twee gebieden van dezelfde beheerder uit
 * elkaar te houden zijn.
 *
 * Een eerdere versie van deze tabel was grotendeels verzonnen: twaalf van de
 * zeventien namen klopten niet (Coteq, Rendo en Enduris stonden op gebieden van
 * Enexis en Stedin). tests/manifest.test.ts legt de tabel nu vast.
 */
export const NETGEBIED_NAMEN: Record<string, string> = {
  "871685900000056162": "Liander (Noord-West Nederland)",
  "871687120000052782": "Liander",
  "871687400000002254": "Stedin (Utrecht)",
  "871687800090000015": "Westland Infra",
  "871687910000219120": "Enexis (Brabant)",
  "871688520000076884": "Enexis (Limburg)",
  "871688600000002202": "Stedin (Delfland)",
  "871689200000010161": "Stedin",
  "871690200000000007": "Stedin (Enduris, Zeeland)",
  "871690499910000003": "Enexis (Maastricht)",
  "871690910000025589": "Liander (EWR)",
  "871691280000000008": "Rendo",
  "871691600019188908": "Coteq",
  "871692100000010038": "Stedin (Midden-Holland)",
  "871692510000000005": "Stedin (Schiedam)",
  "871694600000002173": "Stedin (Zuid-Kennemerland)",
  "871694830000000309": "Enexis (Noord)",
};

export function netgebiedNaam(ean: string): string {
  return NETGEBIED_NAMEN[ean] ?? ean;
}
