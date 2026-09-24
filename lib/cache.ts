/**
 * Resultaten bewaren tussen bezoeken.
 *
 * Een volledige doorrekening kost enkele seconden. Bij elke refresh opnieuw
 * beginnen is niet alleen traag maar ook onnodig: dezelfde invoer op dezelfde
 * data geeft altijd hetzelfde antwoord, want er zit geen willekeur in het model.
 *
 * De sleutel is een hash van de dispatch-velden van de configuratie plus een
 * versienummer en de stand van de data (`gegenereerd` uit het manifest). Velden die alleen de financiën of de zelfvoorzieningscijfers
 * raken (looptijd, rente, prijsstijging, degradatie, restwaarde, jaaropwek)
 * zitten er bewust niet in: daarvoor wordt een bewaard resultaat hergebruikt
 * en alleen de afleiding opnieuw gedaan (`pasAfleidingToe`). Het versienummer
 * moet omhoog zodra het rekenmodel verandert — anders zou een bezoeker een oud
 * antwoord blijven zien na een verbetering.
 */

import type { AnalysisResult, ScenarioResult } from "./model/analysis";
import type { HuishoudenPunt } from "./model/huishoudens";
import type { Configuration, GridPoint } from "./worker/protocol";

/**
 * Alles wat bij één configuratie hoort. Scenario en raster kunnen ontbreken
 * zolang ze nog worden doorgerekend; het hoofdresultaat is er altijd.
 */
export interface Bundel {
  result: AnalysisResult;
  scenario?: ScenarioResult;
  scenarioOpTeruglevering?: boolean;
  /** Voor welk jaar het basistarief in het scenario gold; ontbreekt = 2029. */
  scenarioJaar?: number;
  grid?: GridPoint[][];
  /**
   * De gekozen batterij voor een reeks huishoudens (lib/model/huishoudens.ts);
   * null op een plek die niet doorrekenbaar was. Optioneel: een bundel van
   * vóór dit veld blijft geldig, de achtergrond rekent het dan bij.
   */
  huishoudens?: (HuishoudenPunt | null)[];
}

/**
 * Ophogen bij elke wijziging die de uitkomst beïnvloedt: de solver, de
 * tariefopbouw, de assets. Anders serveren we verouderde antwoorden.
 *
 * Ook ophogen bij een wijziging in de VORM van het resultaat. Versie 7 voegde
 * `stats` toe aan elke voorbeelddag en `gap` aan het resultaat; een bewaard
 * antwoord van versie 6 mist die velden, en de dagweergave liep daarop stuk met
 * "Cannot read properties of undefined". Een nieuw veld is dus net zo goed een
 * reden om deze teller te verhogen als een nieuw getal.
 *
 * Versie 12: het standby-verbruik van de omvormer is uit het model. Het trok
 * elke dag een paar cent van het resultaat af, ongeacht of de batterij
 * handelde; dat hoort bij het bezit en niet bij de handel. Alle bedragen,
 * ook die in het scenario en het raster, veranderen erdoor.
 *
 * Versie 11: het resultaat bevat `seasonProfiles` — het gemiddelde dagprofiel
 * van winter en zomer, zonder en met batterij. Een bewaard antwoord van versie
 * 10 mist dat veld, en de sectie die de verschuiving tekent loopt daarop stuk.
 *
 * Versie 10: de piekuurstatistiek — netafname in de piekuren van het nettarief,
 * zonder en met batterij — kwam in `KeyStats`, `YearAnalysis` en `MonthTotals`;
 * een bewaard antwoord van versie 9 mist die velden. En het nettariefscenario
 * rekent met wegingsfactoren maal een basistarief per jaar in plaats van
 * afgeronde centen, en met de heffing van het scenariojaar in plaats van die
 * van toen; dat verandert de bedragen van het scenario in de bundel.
 *
 * Versie 15: de eindwaarde van de rollende planner trekt de slijtagedrempel af
 * en het laatste plan van een venster waardeert restlading niet meer; de
 * voorspelling kent op de zomertijdwissel geen metingen van na het
 * planmoment; de standaardheffing is die van nu; teruglevering zonder
 * batterij telt na afregelen, met `curtailedKwh` en `curtailedBaselineKwh`/
 * `curtailedBatteryKwh` als nieuwe velden; de rasterassen zijn andere maten.
 * Bedragen, kerncijfers en de vorm van het resultaat veranderen.
 *
 * Versie 14: elk jaar en elk resultaat dragen een CO2-balans (`co2`, uit de
 * emissiefactor per uur van NED.nl). Een bewaard antwoord van versie 13 mist
 * dat veld en het tabblad Uitstoot zou erop stuklopen. De bedragen veranderen
 * niet.
 *
 * Versie 13: de planner rekent standaard met de volle slijtageprijs als
 * drempel, en het deel dat hij meerekent is een instelling (de strategie). De
 * marginale drempel met 20%-ondergrens en proefrun is weg; de batterij handelt
 * minder en de bedragen veranderen.
 *
 * Versie 9: het bewaarde resultaat is een bundel — hoofdresultaat, het
 * nettariefscenario en het raster van maten — zodat een terugkerende bezoeker
 * ook die niet opnieuw hoeft af te wachten. Een bewaard antwoord van versie 8
 * mist die velden.
 *
 * Versie 8: de slijtagedrempel kent een ondergrens en de kalenderlevensduur komt
 * uit de batterij in plaats van uit de analyseperiode. Beide veranderen hoeveel
 * de batterij handelt en dus de bedragen.
 *
 * Versie 7 bevat verder: de schaling die de meterstanden reproduceert, de
 * heffing per uur in plaats van een jaarconstante, en de uitvoerder die bewuste
 * verkoop aan het net doorlaat. Alle drie veranderen de bedragen.
 */
export const MODEL_VERSIE = 15;

/**
 * Alles van de cache staat onder zijn eigen voorvoegsel, `tbat:cache:`.
 *
 * Eerder was dat `tbat:v14:` met de index op `tbat:index`, en ruimden het
 * opruimen en `wisAlles` alles op wat met `tbat:` begon. Maar de bewaarde
 * instellingen en profielen (lib/opslag.ts) staan óók onder `tbat:`, op
 * `tbat:instellingen:v1`. Zes doorrekeningen of één volle opslag waren genoeg
 * om de profielen van een bezoeker stilzwijgend weg te gooien. Nu raakt de
 * cache alleen zijn eigen sleutels, en de sleutels van het oude schema.
 */
const CACHE_PREFIX = "tbat:cache:";
const SLEUTEL_PREFIX = CACHE_PREFIX + "v" + MODEL_VERSIE + ":";
/** Het oude schema: bundels op `tbat:v<n>:…` en de index op `tbat:index`. */
const OUD_SCHEMA = /^tbat:v\d+:/;
const OUDE_INDEX = "tbat:index";
/**
 * Hoeveel doorrekeningen we bewaren voordat de oudste eruit gaat.
 *
 * Een bundel is zo'n 150 KB tekst, en de browser telt die dubbel (UTF-16)
 * tegen een quota van meestal 5 MB. Twaalf bundels liepen daar tegenaan, en
 * dan gooide de opslag-vol-afhandeling álles weg. Zes past ruim.
 */
export const MAX_ITEMS = 6;
/**
 * De index: welke sleutels er zijn en wanneer ze zijn geschreven. Opruimen
 * leest alleen dit lijstje, in plaats van elke bundel te parsen om er één
 * tijdstempel uit te halen; dat kostte tot tientallen milliseconden op de
 * hoofdthread, precies op het moment dat het antwoord verschijnt.
 */
export const INDEX_SLEUTEL = "tbat:cache:index";

/** Is dit een sleutel die de cache beheert (bundel van welke versie ook, of een index)? */
function vanDeCache(sleutel: string): boolean {
  return sleutel.startsWith(CACHE_PREFIX) || OUD_SCHEMA.test(sleutel) || sleutel === OUDE_INDEX;
}

/**
 * JSON met de sleutels op elk niveau gesorteerd, zodat de volgorde waarin een
 * object is opgebouwd niet uitmaakt voor de hash.
 *
 * Eerder stond hier `JSON.stringify(config, Object.keys(config).sort())`. Een
 * array als tweede argument is een witte lijst die op ÁLLE niveaus geldt, dus
 * de velden van `household`, `battery` en `tariff` vielen eruit: twee
 * configuraties met een andere jaarafname kregen dezelfde sleutel, en een
 * bezoeker die zijn verbruik aanpaste kreeg het bewaarde antwoord van het oude
 * verbruik terug als "uit de cache".
 */
export function stabielJson(waarde: unknown): string {
  if (Array.isArray(waarde)) return `[${waarde.map(stabielJson).join(",")}]`;
  if (waarde !== null && typeof waarde === "object") {
    const o = waarde as Record<string, unknown>;
    const delen = Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stabielJson(o[k])}`);
    return `{${delen.join(",")}}`;
  }
  // JSON kent geen NaN of Infinity en schrijft ze allebei als null. Dan kregen
  // een kapotte invoer en een ontbrekend veld dezelfde sleutel, en deelden ze
  // een bundel. Ze horen er na lib/normaliseer.ts niet meer in te komen, maar
  // de sleutel mag er niet op leunen.
  if (typeof waarde === "number" && !Number.isFinite(waarde)) return `"#${String(waarde)}"`;
  return JSON.stringify(waarde) ?? "null";
}

/**
 * Welke velden van de configuratie de dispatch veranderen en welke alleen
 * de afleiding (financiën en zelfvoorzieningscijfers).
 *
 * `Record<keyof Configuration, …>` dwingt af dat een nieuw veld hier wordt
 * ingedeeld: vergeet je het, dan compileert de tool niet. Een veld ten
 * onrechte als "afleiding" markeren zou een bewaard antwoord tonen bij een
 * configuratie die anders rekent — dus bij twijfel "dispatch".
 */
export const VELDKLASSE: Record<keyof Configuration, "dispatch" | "afleiding"> = {
  domain: "dispatch",
  from: "dispatch",
  to: "dispatch",
  household: "dispatch",
  afnametype: "dispatch",
  battery: "dispatch",
  tariff: "dispatch",
  investmentEur: "dispatch",
  cycleLife: "dispatch",
  wearFraction: "dispatch",
  useHistoricalLevy: "dispatch",
  netTariff: "dispatch",
  netTariffOnExport: "dispatch",
  netTariffYear: "dispatch",
  levyEurPerKwh: "dispatch",
  analysisYears: "afleiding",
  priceEscalation: "afleiding",
  discountRate: "afleiding",
  calendarFadePerYear: "afleiding",
  residualValueEur: "afleiding",
  annualProductionKwh: "afleiding",
  calendarLifeYears: "afleiding",
  kostenPerKwhEur: "afleiding",
  kostenPerKwEur: "afleiding",
  installatieEur: "afleiding",
  co2DrempelG: "afleiding",
  doel: "dispatch",
};

/** De configuratie zonder de afleidingsvelden. */
export function dispatchDeel(config: Configuration): Partial<Configuration> {
  const uit: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (VELDKLASSE[k as keyof Configuration] === "dispatch") uit[k] = v;
  }
  return uit as Partial<Configuration>;
}

/**
 * Stabiele hash van de velden die de dispatch bepalen. Twee configuraties die
 * alleen in looptijd, rente, prijsstijging, degradatie, restwaarde of
 * jaaropwek verschillen, delen dezelfde bundel; de afleiding wordt bij het
 * lezen opnieuw gedaan (`pasAfleidingToe` in lib/model/analysis.ts).
 *
 * Met `dataVersie` — het tijdstip `gegenereerd` uit het manifest — hoort de
 * sleutel ook bij één stand van de data. Zonder die versie kreeg een
 * terugkerende bezoeker na een dataverversing het oude antwoord uit zijn
 * browser, over prijzen die inmiddels waren aangevuld. De cache en het
 * vooruitgerekende antwoord geven hem daarom altijd mee; binnen één sessie
 * (de worker, de vergelijking "is dit dezelfde dispatch?") is hij overbodig,
 * want daar is de data per definitie dezelfde.
 */
export function dispatchSleutel(config: Configuration, dataVersie?: string): string {
  const data = dataVersie ? "d" + fnv(dataVersie) + ":" : "";
  return SLEUTEL_PREFIX + data + fnv(stabielJson(dispatchDeel(config)));
}

/** FNV-1a: kort, snel en ruim voldoende om configuraties uit elkaar te houden. */
function fnv(tekst: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < tekst.length; i++) {
    h ^= tekst.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

interface Bewaard extends Bundel {
  opgeslagen: number;
}

/**
 * Is dit een bruikbare bundel? Een bundel kan half geschreven zijn, met de
 * hand bewerkt, of van een versie waarin een veld anders heette. Die geven we
 * niet door: de pagina zou er op een `undefined` op stuklopen in plaats van
 * gewoon opnieuw te rekenen.
 */
function isBundel(o: unknown): o is Bewaard {
  if (typeof o !== "object" || o === null) return false;
  const r = (o as Bewaard).result as unknown;
  if (typeof r !== "object" || r === null) return false;
  const res = r as Partial<AnalysisResult>;
  if (!Array.isArray(res.perYear) || typeof res.finance !== "object" || res.finance === null) return false;
  const b = o as Bewaard;
  if (b.grid !== undefined && !Array.isArray(b.grid)) return false;
  if (b.huishoudens !== undefined && !Array.isArray(b.huishoudens)) return false;
  if (b.scenario !== undefined && (typeof b.scenario !== "object" || b.scenario === null)) return false;
  return true;
}

function leesSleutel(sleutel: string): Bundel | null {
  if (typeof window === "undefined") return null;
  try {
    const ruw = window.localStorage.getItem(sleutel);
    if (!ruw) return null;
    const bewaard = JSON.parse(ruw) as unknown;
    if (!isBundel(bewaard)) {
      window.localStorage.removeItem(sleutel);
      return null;
    }
    const { result, scenario, scenarioOpTeruglevering, scenarioJaar, grid, huishoudens } = bewaard;
    return { result, scenario, scenarioOpTeruglevering, scenarioJaar, grid, huishoudens };
  } catch {
    // Een volle of geblokkeerde opslag mag de tool nooit stukmaken; dan rekenen
    // we gewoon opnieuw.
    return null;
  }
}

/** De bundel bij deze configuratie en deze stand van de data, of null. */
export function leesCache(config: Configuration, dataVersie: string): Bundel | null {
  return leesSleutel(dispatchSleutel(config, dataVersie));
}

/**
 * De meest recente bundel bij deze configuratie, van welke stand van de data
 * ook. Alleen voor als het manifest niet te laden is (offline, een storing):
 * dan is een antwoord over iets oudere data beter dan geen antwoord, mits de
 * pagina zegt dat het uit een eerdere doorrekening komt.
 */
export function leesCacheZonderData(config: Configuration): Bundel | null {
  if (typeof window === "undefined") return null;
  const eind = ":" + fnv(stabielJson(dispatchDeel(config)));
  const kandidaten = leesIndex()
    .filter((r) => r.sleutel.startsWith(SLEUTEL_PREFIX) && r.sleutel.endsWith(eind))
    .sort((a, b) => b.opgeslagen - a.opgeslagen);
  for (const k of kandidaten) {
    const bundel = leesSleutel(k.sleutel);
    if (bundel) return bundel;
  }
  return null;
}

/**
 * Bewaar een bundel, of vul een bestaande aan. Scenario en raster komen later
 * binnen dan het hoofdresultaat, en mogen dat niet overschrijven met niets.
 *
 * Zonder bestaande bundel wordt alleen een deel mét hoofdresultaat geschreven:
 * een los scenario of raster zonder antwoord is voor niemand bruikbaar, en het
 * zou bij de volgende lezing als hoofdantwoord kunnen worden aangezien.
 */
export function schrijfCache(config: Configuration, dataVersie: string, deel: Partial<Bundel>): void {
  if (typeof window === "undefined") return;
  const bestaand = leesCache(config, dataVersie);
  if (!bestaand && !deel.result) return;
  const bewaard: Bewaard = { ...bestaand!, ...deel, opgeslagen: Date.now() };
  const sleutel = dispatchSleutel(config, dataVersie);
  try {
    window.localStorage.setItem(sleutel, JSON.stringify(bewaard));
    ruimOp(sleutel, bewaard.opgeslagen);
  } catch {
    // Opslag vol: gooi alles van de cache weg — alleen van de cache, de
    // bewaarde instellingen blijven staan — en probeer het één keer opnieuw.
    try {
      wisAlles();
      window.localStorage.setItem(sleutel, JSON.stringify(bewaard));
      ruimOp(sleutel, bewaard.opgeslagen);
    } catch {
      // Dan niet. De tool werkt ook zonder cache.
    }
  }
}

interface IndexRegel {
  sleutel: string;
  opgeslagen: number;
}

/** De index zoals hij in de opslag staat; leeg als hij ontbreekt of stuk is. */
function leesIndex(): IndexRegel[] {
  try {
    const ruw = window.localStorage.getItem(INDEX_SLEUTEL);
    const lijst = ruw ? (JSON.parse(ruw) as unknown) : [];
    return Array.isArray(lijst)
      ? lijst.filter(
          (r): r is IndexRegel =>
            typeof r === "object" && r !== null && typeof (r as IndexRegel).sleutel === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Houd de opslag klein: alleen de meest recente doorrekeningen blijven.
 *
 * Bundels van het oude schema (`tbat:v<n>:`) en van een andere modelversie
 * gaan meteen weg: die worden nooit meer gelezen. Bundels van deze versie die
 * buiten de index om in de opslag staan, worden met tijdstempel nul opgenomen,
 * zodat ze als eerste wijken. Sleutels in de index die niet meer bestaan
 * vallen eruit. Alles wat niet van de cache is — de bewaarde instellingen —
 * blijft onaangeroerd.
 */
function ruimOp(zojuist: string, opgeslagen: number): void {
  const aanwezig = new Set<string>();
  const weg: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !vanDeCache(k) || k === INDEX_SLEUTEL) continue;
    if (k.startsWith(SLEUTEL_PREFIX)) aanwezig.add(k);
    else weg.push(k);
  }
  for (const k of weg) window.localStorage.removeItem(k);
  const index = new Map<string, number>();
  for (const r of leesIndex()) {
    if (aanwezig.has(r.sleutel)) index.set(r.sleutel, Number(r.opgeslagen) || 0);
  }
  for (const k of aanwezig) if (!index.has(k)) index.set(k, 0);
  // De nieuwste is altijd strikt de nieuwste, ook als twee schrijfacties in
  // dezelfde milliseconde vallen; anders is de sortering daar willekeurig.
  let hoogste = 0;
  for (const [k, t] of index) if (k !== zojuist && t > hoogste) hoogste = t;
  index.set(zojuist, Math.max(opgeslagen, hoogste + 1));

  const gesorteerd = [...index.entries()].sort((a, b) => b[1] - a[1]);
  for (const [sleutel] of gesorteerd.slice(MAX_ITEMS)) {
    window.localStorage.removeItem(sleutel);
  }
  const blijft: IndexRegel[] = gesorteerd
    .slice(0, MAX_ITEMS)
    .map(([sleutel, t]) => ({ sleutel, opgeslagen: t }));
  window.localStorage.setItem(INDEX_SLEUTEL, JSON.stringify(blijft));
}

/** Wis de cache: alle bundels en de index, van dit en het oude schema. Niets anders. */
export function wisAlles(): void {
  if (typeof window === "undefined") return;
  const teWissen: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const sleutel = window.localStorage.key(i);
    if (sleutel && vanDeCache(sleutel)) teWissen.push(sleutel);
  }
  for (const s of teWissen) window.localStorage.removeItem(s);
}
