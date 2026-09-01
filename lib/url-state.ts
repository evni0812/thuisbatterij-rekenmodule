/**
 * De configuratie in de URL.
 *
 * Elke doorrekening is daarmee deelbaar: een link bevat precies de invoer die
 * tot dat antwoord leidde. Alleen afwijkingen van de standaard komen in de URL,
 * zodat een gewone berekening een schone adresbalk houdt.
 */

export interface Instellingen {
  afnameKwh: number;
  terugleveringKwh: number;
  presetId: string;
  domein: string;
  /** Leeg betekent: de volledige beschikbare periode. */
  van: string;
  tot: string;
  spreiding: number;
  terugleverkostenCt: number;
  curtailment: boolean;
  analysejaren: number;
  discontovoet: number;
  prijsstijging: number;
  degradatie: number;
  /** Null betekent: neem de waarde van de gekozen batterij over. */
  prijsEur: number | null;
  capaciteitKwh: number | null;
  vermogenKw: number | null;
}

/** Korte sleutels, zodat een gedeelde link leesbaar blijft. */
const SLEUTELS: Record<keyof Instellingen, string> = {
  afnameKwh: "af",
  terugleveringKwh: "tl",
  presetId: "bat",
  domein: "net",
  van: "van",
  tot: "tot",
  spreiding: "spr",
  terugleverkostenCt: "tlk",
  curtailment: "afr",
  analysejaren: "jr",
  discontovoet: "disc",
  prijsstijging: "stg",
  degradatie: "deg",
  prijsEur: "prijs",
  capaciteitKwh: "cap",
  vermogenKw: "kw",
};

export function leesUrl(): Partial<Instellingen> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const uit: Partial<Instellingen> = {};

  const getal = (sleutel: string): number | undefined => {
    const v = p.get(sleutel);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const zetGetal = <K extends keyof Instellingen>(key: K, v: number | undefined) => {
    if (v !== undefined) (uit as Record<string, unknown>)[key] = v;
  };

  zetGetal("afnameKwh", getal(SLEUTELS.afnameKwh));
  zetGetal("terugleveringKwh", getal(SLEUTELS.terugleveringKwh));
  zetGetal("spreiding", getal(SLEUTELS.spreiding));
  zetGetal("terugleverkostenCt", getal(SLEUTELS.terugleverkostenCt));
  zetGetal("analysejaren", getal(SLEUTELS.analysejaren));
  zetGetal("discontovoet", getal(SLEUTELS.discontovoet));
  zetGetal("prijsstijging", getal(SLEUTELS.prijsstijging));
  zetGetal("degradatie", getal(SLEUTELS.degradatie));
  zetGetal("prijsEur", getal(SLEUTELS.prijsEur));
  zetGetal("capaciteitKwh", getal(SLEUTELS.capaciteitKwh));
  zetGetal("vermogenKw", getal(SLEUTELS.vermogenKw));

  const preset = p.get(SLEUTELS.presetId);
  if (preset) uit.presetId = preset;
  const net = p.get(SLEUTELS.domein);
  if (net) uit.domein = net;
  const van = p.get(SLEUTELS.van);
  if (van) uit.van = van;
  const tot = p.get(SLEUTELS.tot);
  if (tot) uit.tot = tot;
  const afr = p.get(SLEUTELS.curtailment);
  if (afr !== null) uit.curtailment = afr === "1";

  return uit;
}

export function schrijfUrl(inst: Instellingen, standaard: Instellingen): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();

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
