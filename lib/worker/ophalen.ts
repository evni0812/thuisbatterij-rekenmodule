/**
 * Eén keer ophalen, door alle workers gedeeld.
 *
 * Elke worker had zijn eigen Invoerbron en haalde dus zelf zijn manifest en
 * zijn profielen, prijzen en emissiefactoren op. Met vier workers ging elk
 * bestand drie tot vier keer over de lijn: bij eigen invoer 53 verzoeken en
 * 5,7 MB voor 1,5 MB aan data. Op een telefoon met een matige verbinding is
 * dat seconden wachten op bytes die er al waren.
 *
 * Nu vraagt een worker een bestand aan de hoofdthread (`{ type: "haal" }`), en
 * die haalt het één keer op en geeft elke vrager een eigen kopie van de bytes.
 * Een kopie en niet de buffer zelf: een overgedragen ArrayBuffer is daarna
 * leeg voor de afzender, en de volgende worker die hetzelfde jaar vraagt moet
 * hem ook krijgen. Een profieljaar is 280 KB; de kopie kost een fractie van
 * een milliseconde.
 *
 * ── Versies ──────────────────────────────────────────────────────────────────
 * Het manifest wordt altijd opnieuw gevalideerd (`cache: "no-cache"`). De
 * binaire bestanden krijgen `?v=<gegenereerd>` uit dat manifest, zodat ze
 * onbeperkt gecachet mogen worden (vercel.json zet ze op `immutable`): een
 * nieuwe dataversie is een nieuwe URL, en een bezoeker die terugkomt haalt
 * niets opnieuw zolang de data niet is ververst. Een oud manifest kan zo niet
 * met nieuwe bestanden uit de browsercache mengen.
 *
 * ── Time-out ────────────────────────────────────────────────────────────────
 * Een verzoek dat blijft hangen (een wegvallende mobiele verbinding) liet de
 * pagina eeuwig "De gegevens worden geladen…" zeggen. Na de time-out wordt het
 * een fout die de pagina kan melden, met een knop om het opnieuw te proberen.
 */

import type { Manifest } from "../data/manifest";

/** Hoe lang het manifest mag duren; het is klein, dus dit is ruim. */
export const MANIFEST_TIMEOUT_MS = 15_000;
/** Hoe lang één binair bestand mag duren, ook over een trage verbinding. */
export const BESTAND_TIMEOUT_MS = 45_000;

type Haal = (url: string, init?: RequestInit) => Promise<Response>;

export class Gegevensdeler {
  private readonly bestanden = new Map<string, Promise<ArrayBuffer>>();
  private manifestBelofte: Promise<{ manifest: Manifest; bytes: ArrayBuffer }> | null = null;
  /** Hoe vaak er echt over de lijn is gehaald; voor de tests. */
  opgehaald = 0;

  constructor(
    private readonly baseUrl = "/data",
    private readonly haalFn: Haal = (url, init) => fetch(url, init),
    private readonly timeouts = { manifest: MANIFEST_TIMEOUT_MS, bestand: BESTAND_TIMEOUT_MS },
  ) {}

  /** Het manifest, één keer opgehaald; faalt het, dan mag een volgende poging opnieuw. */
  manifest(): Promise<Manifest> {
    return this.manifestMetBytes().then((m) => m.manifest);
  }

  private manifestMetBytes(): Promise<{ manifest: Manifest; bytes: ArrayBuffer }> {
    if (!this.manifestBelofte) {
      const url = `${this.baseUrl}/manifest.json`;
      this.manifestBelofte = this.haalBytes(url, this.timeouts.manifest, { cache: "no-cache" }, "manifest niet gevonden")
        .then((bytes) => ({ bytes, manifest: JSON.parse(new TextDecoder().decode(bytes)) as Manifest }))
        .catch((err) => {
          this.manifestBelofte = null;
          throw err;
        });
    }
    return this.manifestBelofte;
  }

  /** De dataversie: het tijdstip waarop de assets zijn gegenereerd. */
  async versie(): Promise<string> {
    return (await this.manifest()).gegenereerd;
  }

  /**
   * De bytes van een bestand onder `baseUrl`, gedeeld tussen alle vragers.
   * Elke aanroep krijgt een eigen kopie, zodat de vrager hem mag overdragen.
   */
  async haal(url: string): Promise<ArrayBuffer> {
    if (url === `${this.baseUrl}/manifest.json`) {
      return (await this.manifestMetBytes()).bytes.slice(0);
    }
    let belofte = this.bestanden.get(url);
    if (!belofte) {
      belofte = this.manifestMetBytes().then(({ manifest }) =>
        this.haalBytes(
          // De versie in de URL: zie de toelichting bovenaan.
          `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(manifest.gegenereerd)}`,
          this.timeouts.bestand,
          {},
          `kon ${url} niet laden`,
        ),
      );
      // Een mislukte poging blijft niet hangen: de volgende vraag probeert opnieuw.
      belofte.catch(() => this.bestanden.delete(url));
      this.bestanden.set(url, belofte);
    }
    return (await belofte).slice(0);
  }

  private async haalBytes(url: string, timeoutMs: number, init: RequestInit, foutTekst: string): Promise<ArrayBuffer> {
    const afbreken = typeof AbortController !== "undefined" ? new AbortController() : null;
    let verlopen = false;
    const timer = setTimeout(() => {
      verlopen = true;
      afbreken?.abort();
    }, timeoutMs);
    try {
      this.opgehaald++;
      const res = await this.haalFn(url, { ...init, signal: afbreken?.signal });
      if (!res.ok) throw new Error(`${foutTekst}: HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      if (verlopen) throw new Error(`${foutTekst}: het laden duurde langer dan ${Math.round(timeoutMs / 1000)} seconden`);
      if (err instanceof Error && err.message.startsWith(foutTekst)) throw err;
      // Offline of een geblokkeerd verzoek: fetch zegt dan alleen "Failed to fetch".
      throw new Error(`${foutTekst}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
