/**
 * De dag als film: wat er per kwartier tussen zon, huis, batterij en net stroomt.
 *
 * Alles wordt afgeleid uit een `SampleDay`; er wordt niets opnieuw gerekend.
 * De verdeling van laden en ontladen is dezelfde als in `splitsActies` van de
 * dagfiguur (Dagprofiel.tsx), zodat film en figuur hetzelfde zeggen.
 *
 * ── De stromen per kwartier ─────────────────────────────────────────────────
 * Zonder batterij: afname0 = max(residual, 0), overschot0 = max(-residual, 0).
 *
 *   zon → batterij      min(laden, overschot0)
 *   net → batterij      laden − zon → batterij
 *   batterij → huis     min(ontladen, afname0)
 *   batterij → net      ontladen − batterij → huis
 *   net → huis          afname0 − batterij → huis
 *   zon → net           wat er met batterij naar het net gaat, min wat de
 *                       batterij zelf terugleverde
 *
 * De balans sluit op twee plekken: alles wat het huis van buiten nodig had
 * (afname0) komt van het net of uit de batterij, en alles wat met batterij het
 * net op of af gaat (netKwh) is de som van de stromen die het net raken. Het
 * verschil met de zonderbatterijwereld is precies laden en ontladen.
 */

import { getal } from "../../lib/format";
import type { SampleDay } from "../../lib/model/analysis";

/** Onder deze waarde (kWh per kwartier) is een stroom meetruis en tekenen we hem niet. */
export const RUIS = 0.005;

export interface Stromen {
  zonNaarHuis: boolean;
  zonNaarBatterij: number;
  zonNaarNet: number;
  netNaarHuis: number;
  netNaarBatterij: number;
  batterijNaarHuis: number;
  batterijNaarNet: number;
  /** Overschot dat is afgeregeld in plaats van teruggeleverd. */
  afgeregeld: number;
  /** Afname van het huis zonder batterij, en het overschot zonder batterij. */
  afname0: number;
  overschot0: number;
  /** Wat er met batterij van het net komt en naar het net gaat. */
  vanNet: number;
  naarNet: number;
}

/** De stromen van één kwartier. */
export function stromenVan(dag: SampleDay, i: number): Stromen {
  const r = dag.residualKwh[i]!;
  const laden = dag.chargeKwh[i]!;
  const ontladen = dag.dischargeKwh[i]!;
  const net = dag.netKwh[i]!;

  const afname0 = Math.max(r, 0);
  const overschot0 = Math.max(-r, 0);

  const zonNaarBatterij = Math.min(laden, overschot0);
  const netNaarBatterij = laden - zonNaarBatterij;
  const batterijNaarHuis = Math.min(ontladen, afname0);
  const batterijNaarNet = ontladen - batterijNaarHuis;
  const vanNet = Math.max(net, 0);
  const naarNet = Math.max(-net, 0);

  return {
    // De zon dekt het huis zelf als er overschot is; hoeveel is niet bekend
    // (de bruto opwek zit niet in de dag), dus dit is alleen een aan/uit.
    zonNaarHuis: overschot0 > RUIS,
    zonNaarBatterij,
    zonNaarNet: Math.max(naarNet - batterijNaarNet, 0),
    netNaarHuis: afname0 - batterijNaarHuis,
    netNaarBatterij,
    batterijNaarHuis,
    batterijNaarNet,
    afgeregeld: Math.max(overschot0 - zonNaarBatterij - Math.max(naarNet - batterijNaarNet, 0), 0),
    afname0,
    overschot0,
    vanNet,
    naarNet,
  };
}

/** Het grootste dat een enkele stroom op deze dag wordt: de schaal voor de dikte. */
export function grootsteStroom(dag: SampleDay): number {
  let m = 0.05;
  for (let i = 0; i < dag.startMs.length; i++) {
    const s = stromenVan(dag, i);
    m = Math.max(
      m,
      s.zonNaarBatterij,
      s.zonNaarNet,
      s.netNaarHuis,
      s.netNaarBatterij,
      s.batterijNaarHuis,
      s.batterijNaarNet,
    );
  }
  return m;
}

/** "13.15 uur": de klok van een kwartier, in Amsterdamse tijd. */
export function klok(ms: number): string {
  const d = new Date(ms);
  return `${d
    .toLocaleTimeString("nl-NL", {
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/Amsterdam",
    })
    .replace(":", ".")} uur`;
}

/** Het uur (0 tot en met 23) waarin een kwartier valt, in Amsterdamse tijd. */
export function uurVan(ms: number): number {
  return Number(
    new Date(ms).toLocaleTimeString("nl-NL", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Europe/Amsterdam",
    }),
  );
}

/** Het eerste kwartier dat in een bepaald uur valt; null als de dag daar geen heeft. */
export function kwartierVanUur(dag: SampleDay, uur: number): number | null {
  for (let i = 0; i < dag.startMs.length; i++) if (uurVan(dag.startMs[i]!) === uur) return i;
  return null;
}

const STIL = new WeakMap<SampleDay, boolean>();

/** Doet de batterij de hele dag niets? Dan is het prijsverschil te klein geweest. */
export function dagIsStil(dag: SampleDay): boolean {
  let stil = STIL.get(dag);
  if (stil === undefined) {
    stil = dag.chargeKwh.every((v, i) => v + dag.dischargeKwh[i]! < RUIS);
    STIL.set(dag, stil);
  }
  return stil;
}

/** Een prijs in hele centen, "32 cent"; "min 2 cent" als het negatief is. */
export function centen(eurPerKwh: number): string {
  const c = Math.round(eurPerKwh * 100);
  return `${c < 0 ? "min " : ""}${Math.abs(c)} cent`;
}

/** kWh met genoeg decimalen voor een kwartier: "0,3", en "0,05" voor een klein bedrag. */
export function kwhKwartier(waarde: number): string {
  return `${getal(waarde, waarde < 0.095 ? 2 : 1)} kWh`;
}

export type Fase =
  | "laden-zon"
  | "laden-net"
  | "leveren"
  | "zon-net"
  | "wacht"
  | "rust";

export interface Beschrijving {
  fase: Fase;
  /** De klok, "13.15 uur". */
  klok: string;
  /** De zin erachter, zonder de klok. */
  zin: string;
  /** Klok en zin samen, voor een schermlezer en voor het onderschrift. */
  tekst: string;
}

/**
 * Wat er in een kwartier gebeurt, in gewone taal.
 *
 * "Duur" en "goedkoop" zijn relatief aan de dag zelf: boven of onder het
 * gemiddelde van de dag. Een absolute grens zou op de ene dag kloppen en op
 * de andere niet, want de prijs verschilt per dag.
 */
export function beschrijf(dag: SampleDay, i: number, metPanelen: boolean): Beschrijving {
  const stil = dagIsStil(dag);
  const s = stromenVan(dag, i);
  const prijs = dag.importPrice[i]!;
  const gemiddeld = dag.importPrice.reduce((a, b) => a + b, 0) / Math.max(1, dag.importPrice.length);
  const duur = prijs >= gemiddeld;
  const cap = Math.max(dag.usableCapacityKwh, 0.001);
  const vol = dag.socKwh[i]! >= cap * 0.98;
  const leeg = dag.socKwh[i]! < cap * 0.05;
  const tijd = klok(dag.startMs[i]!);

  let fase: Fase;
  let zin: string;

  if (s.zonNaarBatterij > RUIS) {
    fase = "laden-zon";
    zin = `Je panelen leveren meer dan je huis gebruikt. De batterij slaat ${kwhKwartier(s.zonNaarBatterij)} op.`;
    if (s.zonNaarNet > RUIS) zin += ` De rest, ${kwhKwartier(s.zonNaarNet)}, gaat naar het net.`;
    else if (s.afgeregeld > RUIS) {
      zin += ` De rest gaat niet naar het net: terugleveren levert nu niets op (${centen(dag.exportPrice[i]!)}).`;
    }
  } else if (s.netNaarBatterij > RUIS) {
    fase = "laden-net";
    zin = duur
      ? `Stroom kost ${centen(prijs)}. De batterij laadt toch ${kwhKwartier(s.netNaarBatterij)} van het net, voor later.`
      : `Stroom is goedkoop (${centen(prijs)}). De batterij laadt ${kwhKwartier(s.netNaarBatterij)} van het net.`;
  } else if (s.batterijNaarHuis + s.batterijNaarNet > RUIS) {
    fase = "leveren";
    const delen: string[] = [];
    if (s.batterijNaarHuis > RUIS) delen.push(`levert ${kwhKwartier(s.batterijNaarHuis)} aan je huis`);
    if (s.batterijNaarNet > RUIS) delen.push(`${kwhKwartier(s.batterijNaarNet)} gaat aan het net`);
    zin = `${duur ? "Stroom is duur" : "Stroom kost"} (${centen(prijs)}). De batterij ${delen.join(" en ")}.`;
    if (s.batterijNaarHuis > RUIS) {
      zin +=
        s.netNaarHuis < 0.02
          ? " Je haalt bijna niets van het net."
          : ` Je haalt nog ${kwhKwartier(s.netNaarHuis)} van het net.`;
    }
  } else if (s.overschot0 > RUIS) {
    fase = "zon-net";
    zin = vol
      ? `Je panelen leveren meer dan je huis gebruikt. De batterij is vol, dus ${kwhKwartier(s.zonNaarNet)} gaat naar het net.`
      : s.zonNaarNet > RUIS
        ? `Je panelen leveren meer dan je huis gebruikt. ${kwhKwartier(s.zonNaarNet)} gaat naar het net, de batterij wacht op een beter moment.`
        : `Je panelen leveren meer dan je huis gebruikt. Terugleveren levert nu niets op (${centen(dag.exportPrice[i]!)}).`;
  } else if (s.afname0 > RUIS) {
    fase = "wacht";
    zin = `Je huis haalt ${kwhKwartier(s.afname0)} van het net (${centen(prijs)}). ${
      stil
        ? "De batterij doet vandaag niets: het prijsverschil is te klein."
        : leeg
          ? "De batterij is leeg."
          : "De batterij bewaart zijn lading voor later."
    }`;
  } else {
    fase = "rust";
    zin = metPanelen
      ? "Je panelen en je huis houden elkaar in evenwicht. De batterij doet niets."
      : "Je huis gebruikt bijna niets. De batterij doet niets.";
  }

  return { fase, klok: tijd, zin, tekst: `${tijd} · ${zin}` };
}

export interface DagSamenvatting {
  /** Wat de batterij die dag in ging, en waarvandaan. */
  opgeslagenKwh: number;
  uitZonKwh: number;
  uitNetKwh: number;
  /** Wat de batterij aan je huis leverde. */
  zelfGebruiktKwh: number;
  /** Wat hij aan het net leverde. */
  aanNetKwh: number;
  /** Het dagbedrag, zonder en met de slijtage eraf. */
  besparingEur: number;
  slijtageEur: number;
}

/** De kerngetallen van de dag: uit `stats` waar die er zijn, de rest uit de stromen. */
export function samenvatting(dag: SampleDay): DagSamenvatting {
  let zelf = 0;
  let aanNet = 0;
  for (let i = 0; i < dag.startMs.length; i++) {
    const s = stromenVan(dag, i);
    zelf += s.batterijNaarHuis;
    aanNet += s.batterijNaarNet;
  }
  return {
    opgeslagenKwh: dag.stats.chargedKwh,
    uitZonKwh: dag.stats.chargedFromSolarKwh,
    uitNetKwh: dag.stats.chargedFromGridKwh,
    zelfGebruiktKwh: zelf,
    aanNetKwh: aanNet,
    besparingEur: dag.stats.savingEur,
    slijtageEur: dag.stats.wearCostEur,
  };
}

/**
 * Het kwartier om te tonen als de film niet speelt (reduced motion, of voordat
 * je iets doet): het moment waarop de batterij het meeste verzet.
 */
export function mooisteKwartier(dag: SampleDay): number {
  let beste = 0;
  let waarde = -1;
  for (let i = 0; i < dag.startMs.length; i++) {
    const w = dag.chargeKwh[i]! + dag.dischargeKwh[i]!;
    if (w > waarde) {
      waarde = w;
      beste = i;
    }
  }
  return beste;
}
