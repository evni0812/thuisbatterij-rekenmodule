/**
 * De getallen en het oordeel van stap 4 en 5, zonder opmaak.
 *
 * Niets hier rekent iets nieuws: het leest dezelfde `result`, `overgang` en
 * `grid` als de tabbladen en kiest dezelfde waarden als Antwoord.tsx (hoofdgetal
 * en bandbreedte), Cashflow.tsx (met en zonder nettarief) en BatterijMaat.tsx
 * (de beste maat op netto resultaat). Zo staat er in de stappen nooit een ander
 * getal dan in "Alle cijfers". De functies staan los van React zodat een test
 * ze kan vastpinnen.
 */

import type { AnalysisResult, SavingBreakdown } from "../../lib/model/analysis";
import { advies, celFinance, rasterNiveau } from "../../lib/model/dimensionering";
import { ankerVan, isVasteAansluiting, kostenVan, kostenregelVan } from "../../lib/model/kosten";
import { huishoudPerspectief } from "../../lib/model/co2";
import type { FinanceResult } from "../../lib/model/finance";
import { euro, getal, jaren, jarenReeks, kwh } from "../../lib/format";
import type { Overgang } from "../../lib/overgang";
import type { GridState } from "../../lib/useAnalysis";
import type { Configuration } from "../../lib/worker/protocol";

/* ── Stap 4: het hoofdgetal ────────────────────────────────────────────────── */

export interface Hoofdgetal {
  /** Gemiddelde besparing per jaar, euro. */
  gemiddeldEur: number;
  /** Alleen als de jaren van elkaar verschillen; anders null. */
  band: { minEur: number; maxEur: number } | null;
  /** "2024 en 2025": de jaren waarop het gemiddelde rust. */
  jarenTekst: string;
}

/**
 * Het hoofdgetal zoals Antwoord.tsx het toont. De bandbreedte staat er alleen
 * als er meer dan één volledig jaar is en de jaren meer dan een euro uit elkaar
 * liggen; anders zegt "tussen 105 en 105" niets.
 */
export function hoofdgetal(result: AnalysisResult): Hoofdgetal {
  const volledig = result.perYear.filter((j) => j.isFullYear);
  const spreiding = result.maxSavingEur - result.minSavingEur > 1;
  return {
    gemiddeldEur: result.averageSavingEur,
    band:
      spreiding && volledig.length > 1
        ? { minEur: result.minSavingEur, maxEur: result.maxSavingEur }
        : null,
    jarenTekst: jarenReeks((volledig.length > 0 ? volledig : result.perYear).map((j) => j.year)),
  };
}

export interface Post {
  id: "zelf" | "slim" | "negatief";
  label: string;
  uitleg: string;
  waardeEur: number;
}

/**
 * De posten van de besparing, zoals Uitsplitsing.tsx ze rekent. "Negatieve
 * prijzen ontlopen" valt weg als hij vrijwel nul is. Het omzettingsverlies is
 * geen post: het zit al in "zelf gebruiken" verwerkt (zie SavingBreakdown) en
 * nog eens aftrekken telt het dubbel.
 */
export function posten(b: SavingBreakdown): Post[] {
  const lijst: Post[] = [
    {
      id: "zelf",
      label: "Zelf gebruiken",
      uitleg: "Stroom die je opslaat in plaats van aan het net te leveren, en later zelf gebruikt.",
      waardeEur: b.selfConsumptionEur,
    },
    {
      id: "slim",
      label: "Slim laden en leveren",
      uitleg: "Laden als stroom goedkoop is en gebruiken als hij duur is, los van je eigen opwek.",
      waardeEur: b.arbitrageEur,
    },
    {
      id: "negatief",
      label: "Negatieve prijzen ontlopen",
      uitleg: "Op sommige zonnige uren kost leveren aan het net geld. Wat je opslaat, hoef je niet weg te geven.",
      waardeEur: b.avoidedNegativeExportEur,
    },
  ];
  return Math.abs(b.avoidedNegativeExportEur) < 0.5 ? lijst.slice(0, 2) : lijst;
}

/* ── Stap 4: terugverdienen ────────────────────────────────────────────────── */

/**
 * De opgetelde besparing min de aanschaf, per jaar vanaf nu: het beginpunt is de
 * aanschaf (negatief). Dezelfde reeks als de lijn in Cashflow.tsx.
 */
export function cumulatief(finance: FinanceResult, investeringEur: number): number[] {
  return [-investeringEur, ...finance.cashflows.map((c) => c.cumulativeNominalEur)];
}

export interface SparkPad {
  lijn: string;
  vlak: string;
  /** Hoogte van de nullijn, in viewBox-eenheden. */
  nulY: number;
  /** Waar de lijn door nul gaat, of null als dat binnen de looptijd niet gebeurt. */
  punt: { x: number; y: number } | null;
  eind: { x: number; y: number };
}

/**
 * Een lijntje op een gedeelde schaal, zodat twee kaarten naast elkaar eerlijk
 * te vergelijken zijn: dezelfde eurohoogte is dezelfde afstand.
 */
export function sparkPad(
  reeks: readonly number[],
  paybackYears: number | null,
  b: number,
  h: number,
  schaal: { min: number; max: number },
  marge = 4,
): SparkPad {
  const stappen = Math.max(1, reeks.length - 1);
  const span = Math.max(1e-9, schaal.max - schaal.min);
  const x = (j: number) => marge + (j / stappen) * (b - 2 * marge);
  const y = (v: number) => marge + (1 - (v - schaal.min) / span) * (h - 2 * marge);
  const lijn = reeks.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const nulY = y(0);
  const vlak = `${lijn} L${x(stappen).toFixed(1)} ${nulY.toFixed(1)} L${x(0).toFixed(1)} ${nulY.toFixed(1)} Z`;
  return {
    lijn,
    vlak,
    nulY,
    punt:
      paybackYears !== null && paybackYears <= stappen
        ? { x: x(paybackYears), y: nulY }
        : null,
    eind: { x: x(stappen), y: y(reeks[reeks.length - 1] ?? 0) },
  };
}

/** Het bereik van één of twee reeksen, met de nul erbij. */
export function gedeeldeSchaal(...reeksen: (readonly number[] | null)[]): { min: number; max: number } {
  const alle = reeksen.flatMap((r) => (r ? [...r] : []));
  return { min: Math.min(0, ...alle), max: Math.max(0, ...alle) };
}

/** Tekstalternatief bij een lijntje: begin, eind en het nulpunt in woorden. */
export function sparkAlt(reeks: readonly number[], paybackYears: number | null): string {
  if (reeks.length < 2) return "";
  const eindJaar = reeks.length - 1;
  const begin = `De lijn begint bij ${euro(reeks[0]!)}`;
  const eind = `staat na ${eindJaar} jaar op ${euro(reeks[eindJaar]!)}`;
  const nul =
    paybackYears !== null
      ? `en komt na ${jaren(paybackYears)} bij nul`
      : "en komt binnen de looptijd niet bij nul";
  return `Opgetelde besparing min de aanschaf. ${begin}, ${eind} ${nul}.`;
}

/* ── Stap 5: het oordeel ───────────────────────────────────────────────────── */

/** Onder deze terugverdientijd (jaren) verdient de batterij zich "ruim" terug. */
export const RUIM_GRENS_JAAR = 8;

export type OordeelNiveau = "ruim" | "lang" | "niet";

export interface Oordeel {
  niveau: OordeelNiveau;
  /** De kopzin. */
  kop: string;
  /** Eén zin die de kop met de levensduur en de terugverdientijd onderbouwt. */
  toelichting: string;
}

/**
 * Het oordeel uit de terugverdientijd (mét de overgang naar het nettarief, het
 * hoofdgetal van Antwoord.tsx) en de levensduur van de batterij.
 *
 *   korter dan 8 jaar         "ruim binnen zijn levensduur"
 *   van 8 jaar tot levensduur "terug, maar het duurt lang" (grenzen inbegrepen)
 *   langer dan de levensduur  "binnen zijn levensduur niet terug"
 *   nooit                     "binnen de looptijd niet terug"
 *
 * De levensduur is de kalenderlevensduur van de batterij (presets), niet de
 * looptijd van de doorrekening: een batterij die zich na 16 jaar terugverdient
 * terwijl hij er 15 meegaat, verdient zich niet terug.
 */
export function oordeel(paybackYears: number | null, levensduurJaren: number): Oordeel {
  const duur = `${getal(levensduurJaren)} jaar`;
  if (paybackYears === null) {
    return {
      niveau: "niet",
      kop: "Deze batterij verdient zich binnen de looptijd niet terug",
      toelichting: `Ook na de doorgerekende jaren heeft hij minder opgeleverd dan hij kostte. We rekenen met een levensduur van ${duur}.`,
    };
  }
  if (paybackYears > levensduurJaren) {
    return {
      niveau: "niet",
      kop: "Deze batterij verdient zich binnen zijn levensduur niet terug",
      toelichting: `Terugverdiend na ${jaren(paybackYears)}. We rekenen met een levensduur van ${duur}.`,
    };
  }
  if (paybackYears < RUIM_GRENS_JAAR) {
    return {
      niveau: "ruim",
      kop: "Deze batterij verdient zich ruim binnen zijn levensduur terug",
      toelichting: `Terugverdiend na ${jaren(paybackYears)}. We rekenen met een levensduur van ${duur}.`,
    };
  }
  return {
    niveau: "lang",
    kop: "Deze batterij verdient zich terug, maar het duurt lang",
    toelichting: `Terugverdiend na ${jaren(paybackYears)}. We rekenen met een levensduur van ${duur}, dus er blijft weinig tijd over.`,
  };
}

/* ── Stap 5: de checklist ──────────────────────────────────────────────────── */

export type Teken = "goed" | "let-op" | "nee" | "info";

/** Het woord dat een schermlezer bij het teken hoort; kleur en vorm zeggen het niet alleen. */
export const TEKEN_WOORD: Record<Teken, string> = {
  goed: "Goed",
  "let-op": "Let op",
  nee: "Niet goed",
  info: "Goed om te weten",
};

export interface Regel {
  id: "contract" | "aansluiting" | "panelen" | "co2" | "maat" | "standby";
  teken: Teken;
  tekst: string;
  /** Alleen bij "maat": de andere maat waarmee je kan doorrekenen. */
  maat?: AndereMaat;
}

export const CONTRACT_TEKST =
  "Je hebt een dynamisch energiecontract nodig. Met een vast of variabel contract rekent deze tool niet.";

export const STANDBY_TEKST =
  "Het stand-byverbruik van de batterij (60 tot 220 kWh per jaar) zit er niet in.";

/** Stekker of installateur: op het vermogen van de doorgerekende batterij. */
export function aansluitingRegel(vermogenKw: number): Regel {
  const kw = getal(vermogenKw, 1);
  return isVasteAansluiting(vermogenKw)
    ? {
        id: "aansluiting",
        teken: "let-op",
        tekst: `Bij ${kw} kW heeft de batterij een eigen groep nodig, aangelegd door een installateur. Vraag bij je offerte of dat in de prijs zit.`,
      }
    : {
        id: "aansluiting",
        teken: "goed",
        tekst: `Bij ${kw} kW is dit een stekkerbatterij: je steekt hem zelf in een stopcontact, zonder installateur.`,
      };
}

/**
 * Wat de zonnepanelen met de besparing te maken hebben, uit de uitsplitsing.
 * Zonder besparing valt er geen aandeel uit te rekenen; dan geen regel.
 */
export function panelenRegel(b: SavingBreakdown, metPanelen: boolean): Regel | null {
  if (!(b.totalEur > 0)) return null;
  const aandeel = Math.max(0, Math.min(1, b.selfConsumptionEur / b.totalEur));
  const procent = Math.round(aandeel * 100);
  if (metPanelen) {
    return {
      id: "panelen",
      teken: "goed",
      tekst:
        procent >= 100
          ? "Met zonnepanelen komt de hele besparing uit zelf gebruiken van je eigen zonnestroom."
          : `Met zonnepanelen komt ${procent} procent van de besparing uit zelf gebruiken van je eigen zonnestroom. De rest komt uit slim laden en leveren.`,
    };
  }
  const slim = "Je laadt als stroom goedkoop is en gebruikt hem als hij duur is.";
  return {
    id: "panelen",
    teken: "info",
    tekst:
      aandeel < 0.05
        ? `Zonder zonnepanelen komt de besparing alleen uit slim laden en leveren. ${slim}`
        : `Zonder zonnepanelen komt ${procent} procent van de besparing uit zelf gebruiken en de rest uit slim laden en leveren. ${slim}`,
  };
}

/** "3,4 kg" of "120 kg": zoals Co2Antwoord.kg, zonder het component te importeren. */
function kg(n: number): string {
  return `${getal(n, Math.abs(n) < 10 ? 1 : 0)} kg`;
}

/**
 * De CO2-regel, met het teken zoals Co2Antwoord het rekent: winst is zonder
 * min met batterij, en een batterij kan ook méér CO2 veroorzaken (laden op vuile
 * uren, verlies bij laden en ontladen). Zonder emissiedata geen regel.
 */
export function co2Regel(co2: AnalysisResult["co2"]): Regel | null {
  if (!co2) return null;
  const { winstKg } = huishoudPerspectief(co2);
  if (winstKg > 0.5) {
    return {
      id: "co2",
      teken: "goed",
      tekst: `Met de batterij komt er ${kg(winstKg)} minder CO2 vrij per jaar. Dat geldt voor de stroom die je van het net haalt, en is een toerekening met de gemiddelde uitstoot per uur.`,
    };
  }
  if (winstKg < -0.5) {
    return {
      id: "co2",
      teken: "let-op",
      tekst: `Met de batterij komt er ${kg(-winstKg)} meer CO2 vrij per jaar door de stroom die je van het net haalt. Hij laadt vaker op uren met vuilere stroom, en bij laden en ontladen gaat stroom verloren.`,
    };
  }
  return {
    id: "co2",
    teken: "info",
    tekst: "Deze batterij maakt nauwelijks verschil voor je CO2-uitstoot.",
  };
}

/* ── Stap 5: een andere maat ───────────────────────────────────────────────── */

/**
 * Zoveel euro netto moet een andere maat méér opleveren voordat we hem noemen.
 * De maten in het raster rusten op één jaar, op het niveau van het gemiddelde;
 * een verschil van een paar tientjes is rekenruis, geen advies.
 */
export const MIN_WINST_ANDERE_MAAT_EUR = 100;

export type AndereMaat =
  | { soort: "wacht" }
  /** Geen enkele maat komt netto uit de kosten. */
  | { soort: "geen-winst" }
  /** Jouw maat is (bijna) de beste. */
  | { soort: "huidig-beste"; aantalMaten: number }
  | {
      soort: "beter";
      capaciteitKwh: number;
      vermogenKw: number;
      /** Wat hij netto méér oplevert dan jouw batterij, euro over de looptijd. */
      meerEur: number;
      /** Onze schatting uit de kostenregel, euro. */
      prijsEur: number;
      /** Heeft deze maat een installateur nodig terwijl jouw batterij dat niet heeft? */
      metInstallateur: boolean;
      looptijdJaren: number;
    };

/**
 * De beste maat uit het raster op netto resultaat (dezelfde keuze als de kaart
 * op "Welke batterij"), tegenover jouw batterij op dezelfde grondslag: het
 * raster rekent de tarieven van nu over de hele looptijd, zonder de overgang
 * naar het nettarief. Jouw batterij is de cel van jouw maat als die er staat,
 * anders het hoofdresultaat op dezelfde grondslag.
 */
export function andereMaat(
  grid: GridState | null,
  config: Configuration | null,
  result: AnalysisResult | null,
): AndereMaat {
  if (!grid || !config || !result || !grid.klaar) return { soort: "wacht" };
  const niveau = rasterNiveau(result);
  const raad = advies(grid, config, result.curve, niveau);
  if (!raad) return { soort: "wacht" };

  const cap0 = config.battery.capacityKwh;
  const kw0 = config.battery.maxDischargeKw;
  let huidigNpv = result.finance.npvEur;
  grid.capacities.forEach((cap, r) =>
    grid.powers.forEach((kw, k) => {
      const punt = grid.rows[r]?.[k];
      if (punt && Math.abs(cap - cap0) < 0.05 && Math.abs(kw - kw0) < 0.05) {
        huidigNpv = celFinance(punt, cap, kw, config, result.curve, niveau).npvEur;
      }
    }),
  );

  const { beste } = raad;
  const aantalMaten = grid.capacities.length * grid.powers.length;
  if (beste.fin.npvEur <= 0 && huidigNpv <= 0) return { soort: "geen-winst" };
  const meer = beste.fin.npvEur - huidigNpv;
  if (meer < MIN_WINST_ANDERE_MAAT_EUR) return { soort: "huidig-beste", aantalMaten };
  return {
    soort: "beter",
    capaciteitKwh: beste.capacityKwh,
    vermogenKw: beste.powerKw,
    meerEur: meer,
    prijsEur: Math.round(
      kostenVan(ankerVan(config), kostenregelVan(config), beste.capacityKwh, beste.powerKw),
    ),
    metInstallateur: isVasteAansluiting(beste.powerKw) && !isVasteAansluiting(kw0),
    looptijdJaren: config.analysisYears,
  };
}

export function maatRegel(m: AndereMaat): Regel {
  switch (m.soort) {
    case "wacht":
      return { id: "maat", teken: "info", tekst: "We vergelijken nog andere maten…", maat: m };
    case "geen-winst":
      return {
        id: "maat",
        teken: "nee",
        tekst: "Geen enkele maat in de vergelijking komt netto uit de kosten, ook een kleinere of grotere batterij niet.",
        maat: m,
      };
    case "huidig-beste":
      return {
        id: "maat",
        teken: "goed",
        tekst: `Jouw maat zit dicht bij de maat met het hoogste netto resultaat, van de ${m.aantalMaten} die we vergeleken. Een andere maat levert netto minder dan ${euro(MIN_WINST_ANDERE_MAAT_EUR)} extra op.`,
        maat: m,
      };
    case "beter":
      return {
        id: "maat",
        teken: "let-op",
        tekst: `Een batterij van ${getal(m.capaciteitKwh, 1)} kWh en ${getal(m.vermogenKw, 1)} kW had over de looptijd ${euro(m.meerEur)} meer opgeleverd. Dat rekent met de tarieven van nu, zonder het nettarief van 2029. Onze schatting van de aanschaf is ${euro(m.prijsEur)}${m.metInstallateur ? ", inclusief een eigen groep door een installateur" : ""}.`,
        maat: m,
      };
  }
}

/** Alle regels van de checklist, alleen waar de data er is. */
export function checklist(args: {
  result: AnalysisResult;
  toon: Configuration;
  toonZonnepanelen: boolean;
  grid: GridState | null;
}): Regel[] {
  const { result, toon, toonZonnepanelen, grid } = args;
  const regels: (Regel | null)[] = [
    { id: "contract", teken: "info", tekst: CONTRACT_TEKST },
    aansluitingRegel(toon.battery.maxDischargeKw),
    panelenRegel(result.breakdown, toonZonnepanelen),
    co2Regel(result.co2),
    maatRegel(andereMaat(grid, toon, result)),
    { id: "standby", teken: "let-op", tekst: STANDBY_TEKST },
  ];
  return regels.filter((r): r is Regel => r !== null);
}

/** De grondslag in één zin, onder het hoofdgetal. */
export function grondslagZin(jarenTekst: string, heffingVanNu: boolean): string {
  return `Doorgerekend op de uurprijzen van ${jarenTekst}, met de belasting van ${heffingVanNu ? "nu" : "toen"}.`;
}

/** De verliezen in kWh, voor de noot onder de balk. */
export function verliesNoot(b: SavingBreakdown): string {
  return `Het verlies bij laden en ontladen (${kwh(b.conversionLossKwh)} per jaar) zit hier al in verwerkt.`;
}
