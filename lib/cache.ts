/**
 * Resultaten bewaren tussen bezoeken.
 *
 * Een volledige doorrekening kost enkele seconden. Bij elke refresh opnieuw
 * beginnen is niet alleen traag maar ook onnodig: dezelfde invoer op dezelfde
 * data geeft altijd hetzelfde antwoord, want er zit geen willekeur in het model.
 *
 * De sleutel is een hash van de hele configuratie plus een versienummer. Dat
 * versienummer moet omhoog zodra het rekenmodel verandert — anders zou een
 * bezoeker een oud antwoord blijven zien na een verbetering.
 */

import type { AnalysisResult } from "./model/analysis";
import type { Configuration } from "./worker/protocol";

/**
 * Ophogen bij elke wijziging die de uitkomst beïnvloedt: de solver, de
 * tariefopbouw, de assets. Anders serveren we verouderde antwoorden.
 */
const MODEL_VERSIE = 4;

const SLEUTEL_PREFIX = "tbat:v" + MODEL_VERSIE + ":";
/** Hoeveel doorrekeningen we bewaren voordat de oudste eruit gaat. */
const MAX_ITEMS = 12;

/** Stabiele hash van de configuratie; sleutelvolgorde mag niet uitmaken. */
export function configSleutel(config: Configuration): string {
  const genormaliseerd = JSON.stringify(config, Object.keys(config).sort());
  // FNV-1a: kort, snel en ruim voldoende om configuraties uit elkaar te houden.
  let h = 0x811c9dc5;
  for (let i = 0; i < genormaliseerd.length; i++) {
    h ^= genormaliseerd.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return SLEUTEL_PREFIX + (h >>> 0).toString(36);
}

interface Bewaard {
  result: AnalysisResult;
  opgeslagen: number;
}

export function leesCache(config: Configuration): AnalysisResult | null {
  if (typeof window === "undefined") return null;
  try {
    const ruw = window.localStorage.getItem(configSleutel(config));
    if (!ruw) return null;
    return (JSON.parse(ruw) as Bewaard).result;
  } catch {
    // Een volle of geblokkeerde opslag mag de tool nooit stukmaken; dan rekenen
    // we gewoon opnieuw.
    return null;
  }
}

export function schrijfCache(config: Configuration, result: AnalysisResult): void {
  if (typeof window === "undefined") return;
  try {
    const bewaard: Bewaard = { result, opgeslagen: Date.now() };
    window.localStorage.setItem(configSleutel(config), JSON.stringify(bewaard));
    ruimOp();
  } catch {
    // Opslag vol: gooi alles van ons weg en probeer het één keer opnieuw.
    try {
      wisAlles();
      window.localStorage.setItem(
        configSleutel(config),
        JSON.stringify({ result, opgeslagen: Date.now() } satisfies Bewaard),
      );
    } catch {
      // Dan niet. De tool werkt ook zonder cache.
    }
  }
}

/** Houd de opslag klein: alleen de meest recente doorrekeningen blijven. */
function ruimOp(): void {
  const eigen: { sleutel: string; opgeslagen: number }[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const sleutel = window.localStorage.key(i);
    if (!sleutel?.startsWith("tbat:")) continue;
    let opgeslagen = 0;
    try {
      opgeslagen = (JSON.parse(window.localStorage.getItem(sleutel)!) as Bewaard)
        .opgeslagen;
    } catch {
      // Onleesbaar of van een oudere modelversie: als eerste weggooien.
    }
    eigen.push({ sleutel, opgeslagen });
  }
  eigen.sort((a, b) => b.opgeslagen - a.opgeslagen);
  for (const { sleutel } of eigen.slice(MAX_ITEMS)) {
    window.localStorage.removeItem(sleutel);
  }
}

export function wisAlles(): void {
  if (typeof window === "undefined") return;
  const teWissen: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const sleutel = window.localStorage.key(i);
    if (sleutel?.startsWith("tbat:")) teWissen.push(sleutel);
  }
  for (const s of teWissen) window.localStorage.removeItem(s);
}
