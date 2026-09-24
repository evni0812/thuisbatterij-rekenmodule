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
 * Ontbrekende velden in een bewaarde set worden aangevuld met de standaard,
 * zodat een set van vóór een nieuw veld gewoon blijft werken.
 */

import { STANDAARD } from "./configuratie";
import { normaliseer } from "./normaliseer";
import type { Instellingen } from "./url-state";

const SLEUTEL = "tbat:instellingen:v1";
export const MAX_PROFIELEN = 8;

export interface Profiel {
  naam: string;
  inst: Instellingen;
  /** ISO-tijdstip van bewaren. */
  bewaard: string;
}

interface Opslag {
  laatste?: Instellingen;
  laatsteBewaard?: string;
  profielen: Profiel[];
}

function lees(): Opslag {
  if (typeof window === "undefined") return { profielen: [] };
  try {
    const ruw = window.localStorage.getItem(SLEUTEL);
    if (!ruw) return { profielen: [] };
    const o = JSON.parse(ruw) as Partial<Opslag>;
    return {
      laatste: o.laatste ? vulAan(o.laatste) : undefined,
      laatsteBewaard: o.laatsteBewaard,
      profielen: Array.isArray(o.profielen)
        ? o.profielen
            .filter((p) => p && typeof p.naam === "string" && p.inst)
            .map((p) => ({ naam: p.naam, inst: vulAan(p.inst), bewaard: p.bewaard ?? "" }))
        : [],
    };
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
  return o.laatste ? { inst: o.laatste, bewaard: o.laatsteBewaard ?? null } : null;
}

export function bewaarLaatste(inst: Instellingen): boolean {
  const o = lees();
  return schrijf({ ...o, laatste: inst, laatsteBewaard: new Date().toISOString() });
}

export function vergeetLaatste(): void {
  const o = lees();
  delete o.laatste;
  delete o.laatsteBewaard;
  schrijf(o);
}

export function leesProfielen(): Profiel[] {
  return lees().profielen;
}

/** Bewaar onder een naam; dezelfde naam overschrijft. Hoogstens MAX_PROFIELEN. */
export function bewaarProfiel(naam: string, inst: Instellingen): Profiel[] | null {
  const schoon = naam.trim().slice(0, 40);
  if (!schoon) return null;
  const o = lees();
  const nieuw: Profiel = { naam: schoon, inst, bewaard: new Date().toISOString() };
  const rest = o.profielen.filter((p) => p.naam !== schoon);
  if (rest.length >= MAX_PROFIELEN) return null;
  const profielen = [nieuw, ...rest];
  return schrijf({ ...o, profielen }) ? profielen : null;
}

export function verwijderProfiel(naam: string): Profiel[] {
  const o = lees();
  const profielen = o.profielen.filter((p) => p.naam !== naam);
  schrijf({ ...o, profielen });
  return profielen;
}

export function wisOpslag(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SLEUTEL);
  } catch {
    // niets
  }
}
