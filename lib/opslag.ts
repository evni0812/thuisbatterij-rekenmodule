/**
 * Instellingen bewaren in de browser.
 *
 * Twee lagen. De LAATSTE bewaarde set laadt vanzelf bij een volgend bezoek
 * zonder URL-parameters: wie één keer zijn jaarafrekening heeft ingevuld hoeft
 * dat niet nog een keer te doen. Daarnaast PROFIELEN met een naam — "Thuis",
 * "Ouders" — om te laden en te vergelijken.
 *
 * Een URL met parameters wint altijd van de bewaarde set: een gedeelde link
 * moet laten zien wat de afzender zag, niet wat de ontvanger ooit bewaarde.
 *
 * Alleen wat afwijkt van de standaard wordt bewaard, zoals de URL dat ook doet.
 * Een veld dat gelijk was aan de standaard is dan geen bewuste keuze en volgt de
 * standaard als die verandert. Eerder stond de volledige set opgeslagen, en
 * bleef wie ooit had bewaard voor altijd op de oude aannames rekenen: de
 * standaard voor afregelen ging van aan naar uit en een bewaarde set bleef op
 * "aan" staan. Ontbrekende velden worden bij het lezen aangevuld met de
 * standaard, dus een set van vóór een nieuw veld blijft ook gewoon werken.
 *
 * Versie 1 bewaarde de volledige set. Die wordt bij het eerste lezen omgezet:
 * alleen de velden die afwijken van de huidige standaard blijven staan, en
 * `curtailment` gaat er altijd uit, omdat de oude standaard (aan) niet meer te
 * onderscheiden is van een keuze voor aan.
 */

import { STANDAARD } from "./configuratie";
import { normaliseer } from "./normaliseer";
import type { Instellingen } from "./url-state";

const SLEUTEL = "tbat:instellingen:v2";
const SLEUTEL_V1 = "tbat:instellingen:v1";
export const MAX_PROFIELEN = 8;

export interface Profiel {
  naam: string;
  inst: Instellingen;
  /** ISO-tijdstip van bewaren. */
  bewaard: string;
}

/** Wat er in de browser staat: alleen de afwijkingen van de standaard. */
type Afwijkingen = Partial<Instellingen>;

interface OpgeslagenProfiel {
  naam: string;
  inst: Afwijkingen;
  bewaard: string;
}

interface Opslag {
  laatste?: Afwijkingen;
  laatsteBewaard?: string;
  profielen: OpgeslagenProfiel[];
}

/** De velden waarin een set van de standaard afwijkt. */
export function afwijkingenVan(inst: Instellingen): Afwijkingen {
  const uit: Record<string, unknown> = {};
  for (const k of Object.keys(STANDAARD) as (keyof Instellingen)[]) {
    if (inst[k] !== STANDAARD[k] && inst[k] !== undefined) uit[k] = inst[k];
  }
  return uit as Afwijkingen;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Een ISO-tijdstip, of een lege tekst als het geen tijdstip is. */
function tijdstip(v: unknown): string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : "";
}

/** Lees een opgeslagen opslag (v2), en gooi weg wat er niet in past. */
function leesOpslag(ruw: unknown): Opslag {
  if (!isObject(ruw)) return { profielen: [] };
  const laatsteBewaard = tijdstip(ruw.laatsteBewaard);
  return {
    laatste: isObject(ruw.laatste) ? (ruw.laatste as Afwijkingen) : undefined,
    laatsteBewaard: laatsteBewaard || undefined,
    profielen: Array.isArray(ruw.profielen)
      ? ruw.profielen
          .filter((p): p is Record<string, unknown> => isObject(p) && typeof p.naam === "string" && isObject(p.inst))
          .map((p) => ({ naam: p.naam as string, inst: p.inst as Afwijkingen, bewaard: tijdstip(p.bewaard) }))
      : [],
  };
}

/**
 * Velden die bij het omzetten van versie 1 nooit als bewuste keuze gelden: hun
 * standaard is sindsdien veranderd, en een volledige set uit v1 zegt niet of de
 * waarde gekozen of alleen de toenmalige standaard was. Afregelen ging van aan
 * naar uit, de heffing van "toen" naar "nu".
 */
const NIET_OVERNEMEN_UIT_V1: readonly (keyof Instellingen)[] = ["curtailment", "heffing"];

/** Een volledige set van versie 1 als afwijkingen van de huidige standaard. */
function uitV1(inst: unknown): Afwijkingen {
  const uit = afwijkingenVan(vulAan(isObject(inst) ? (inst as Partial<Instellingen>) : {}));
  for (const k of NIET_OVERNEMEN_UIT_V1) delete uit[k];
  return uit;
}

function migreerV1(ruw: unknown): Opslag {
  const o = leesOpslag(ruw);
  return {
    laatste: o.laatste ? uitV1(o.laatste) : undefined,
    laatsteBewaard: o.laatsteBewaard,
    profielen: o.profielen.map((p) => ({ ...p, inst: uitV1(p.inst) })),
  };
}

function lees(): Opslag {
  if (typeof window === "undefined") return { profielen: [] };
  try {
    const ruw = window.localStorage.getItem(SLEUTEL);
    if (ruw) return leesOpslag(JSON.parse(ruw));
    const oud = window.localStorage.getItem(SLEUTEL_V1);
    if (!oud) return { profielen: [] };
    const o = migreerV1(JSON.parse(oud));
    // Overschrijven en opruimen, anders komt v1 na "wis" weer tevoorschijn.
    if (schrijf(o)) window.localStorage.removeItem(SLEUTEL_V1);
    return o;
  } catch {
    return { profielen: [] };
  }
}

function schrijf(o: Opslag): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(SLEUTEL, JSON.stringify(o));
    return true;
  } catch {
    return false;
  }
}

/** Een opgeslagen profiel als volledige set, met de standaard voor wat niet is bewaard. */
function alsProfiel(p: OpgeslagenProfiel): Profiel {
  return { naam: p.naam, inst: vulAan(p.inst), bewaard: p.bewaard };
}

/**
 * Vul een (oude of onvolledige) set aan met de standaardwaarden.
 *
 * Een waarde van het verkeerde type, een onbekende batterij of een getal buiten
 * de grenzen — een oude of met de hand bewerkte set — gaat door dezelfde
 * controle als een URL (lib/normaliseer.ts): onleesbaar wordt de standaard,
 * te groot of te klein wordt geklemd. De rest van de set blijft bruikbaar.
 */
export function vulAan(inst: Partial<Instellingen>): Instellingen {
  const ruw = typeof inst === "object" && inst !== null ? inst : {};
  return normaliseer({ ...STANDAARD, ...ruw } as Instellingen, STANDAARD);
}

export function leesLaatste(): { inst: Instellingen; bewaard: string | null } | null {
  const o = lees();
  return o.laatste ? { inst: vulAan(o.laatste), bewaard: o.laatsteBewaard ?? null } : null;
}

export function bewaarLaatste(inst: Instellingen): boolean {
  const o = lees();
  return schrijf({ ...o, laatste: afwijkingenVan(inst), laatsteBewaard: new Date().toISOString() });
}

export function vergeetLaatste(): void {
  const o = lees();
  delete o.laatste;
  delete o.laatsteBewaard;
  schrijf(o);
}

export function leesProfielen(): Profiel[] {
  return lees().profielen.map(alsProfiel);
}

/** Bewaar onder een naam; dezelfde naam overschrijft. Hoogstens MAX_PROFIELEN. */
export function bewaarProfiel(naam: string, inst: Instellingen): Profiel[] | null {
  const schoon = naam.trim().slice(0, 40);
  if (!schoon) return null;
  const o = lees();
  const nieuw: OpgeslagenProfiel = { naam: schoon, inst: afwijkingenVan(inst), bewaard: new Date().toISOString() };
  const rest = o.profielen.filter((p) => p.naam !== schoon);
  if (rest.length >= MAX_PROFIELEN) return null;
  const profielen = [nieuw, ...rest];
  return schrijf({ ...o, profielen }) ? profielen.map(alsProfiel) : null;
}

export function verwijderProfiel(naam: string): Profiel[] {
  const o = lees();
  const profielen = o.profielen.filter((p) => p.naam !== naam);
  schrijf({ ...o, profielen });
  return profielen.map(alsProfiel);
}

export function wisOpslag(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SLEUTEL);
    window.localStorage.removeItem(SLEUTEL_V1);
  } catch {
    // niets
  }
}
