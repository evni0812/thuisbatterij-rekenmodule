/**
 * Van het raster van maten naar een investeringsbeslissing.
 *
 * Het raster (lib/model/raster.ts) levert per maat alleen wat de batterij in
 * één jaar bespaart. Dat is bewust: die doorrekening is duur en verandert niet
 * als je aan looptijd, rente of de kostenregel draait. Alles wat hier staat is
 * afleiding op die getallen en kost geen rekentijd van betekenis: elke cel
 * krijgt een investering uit de kostenregel en dezelfde financiële doorrekening
 * als het hoofdantwoord.
 *
 * ── De vorm van de besparingscurve ──────────────────────────────────────────
 * De financiën hebben nodig hoe de besparing terugloopt als de batterij slijt.
 * Voor de gekozen batterij is dat gemeten (drie steunpunten); voor de andere
 * maten niet, want dat zou het raster drie keer zo duur maken. De cel neemt
 * daarom de vórm van de gemeten curve over en schaalt die op zijn eigen
 * niveau. Voor de cel van de gekozen batterij zelf is dat exact de gemeten
 * curve.
 *
 * ── Eén jaar, op het niveau van het gemiddelde ──────────────────────────────
 * Een rastercel wordt doorgerekend op het meest recente volledige jaar; het
 * hoofdantwoord rust op het gemiddelde over alle volledige jaren. Eerder kwam
 * de cel van de eigen batterij daardoor op het beste jaar uit (2025: € 124
 * tegen gemiddeld € 119) en rekende de kaart gunstiger dan het antwoord
 * bovenaan. Nu brengt `rasterNiveau` elke cel op het niveau van het
 * gemiddelde, met de verhouding gemiddelde : rasterjaar van de gekozen
 * batterij. Dat is dezelfde splitsing als bij de besparingscurve: het jaar
 * geeft de verhouding tussen de maten, het gemiddelde het niveau. Alle jaren
 * voor elke maat doorrekenen zou het raster verdubbelen.
 *
 * ── Zonder de overgang naar het nettarief ───────────────────────────────────
 * Het antwoord bovenaan en de cashflow rekenen tot 2029 met de tarieven van nu
 * en daarna met het nettarief (lib/overgang.ts). De kaart doet dat niet: dat
 * vraagt een tweede raster met het nettarief, weer een verdubbeling. Elke cel
 * rekent de tarieven van nu over de hele looptijd, en `RASTER_GRONDSLAG` zegt
 * dat in woorden voor bij de kaart.
 */

import { referentieIndexVan } from "./analysis";
import { computeFinance, type SavingCurvePoint } from "./finance";
import { ankerVan, isVasteAansluiting, kostenVan, kostenregelVan } from "./kosten";
import type { Configuration, GridPoint } from "../worker/protocol";

/**
 * Waarop de kaart van maten rekent, in één zin voor bij de kaart. De cellen
 * wijken daardoor af van het antwoord bovenaan, en de lezer moet weten waarom.
 */
export const RASTER_GRONDSLAG =
  "Gerekend met de tarieven van nu over de hele looptijd, op het niveau van het gemiddelde " +
  "jaar, zonder de overgang naar het nettarief in 2029 die het antwoord bovenaan wel meeneemt.";

/**
 * Factoren die een rastercel van het rasterjaar naar het gemiddelde over de
 * volledige jaren brengen: gemiddelde gedeeld door rasterjaar, voor de
 * besparing en voor de cycli, gemeten op de gekozen batterij.
 */
export interface RasterNiveau {
  besparing: number;
  cycli: number;
}

/** Geen correctie: de cel zoals het rasterjaar hem gaf. */
export const GEEN_NIVEAU: RasterNiveau = { besparing: 1, cycli: 1 };

/**
 * Het niveau uit een hoofdresultaat: gemiddelde over de volledige jaren
 * gedeeld door het jaar waarop raster en huishoudens rekenen
 * (`referentieIndexVan`, hetzelfde jaar als `rasterJaar`). Voor een cel met de
 * maat van de gekozen batterij is de besparing daarna exact het gemiddelde.
 */
export function rasterNiveau(r: {
  averageSavingEur: number;
  stats: { cyclesPerYear: number };
  perYear: readonly { isFullYear: boolean; realisticSavingEur: number; cyclesPerYear: number }[];
}): RasterNiveau {
  if (r.perYear.length === 0) return GEEN_NIVEAU;
  const jaar = r.perYear[referentieIndexVan(r.perYear)]!;
  return {
    besparing: jaar.realisticSavingEur > 0 ? r.averageSavingEur / jaar.realisticSavingEur : 1,
    cycli: jaar.cyclesPerYear > 0 ? r.stats.cyclesPerYear / jaar.cyclesPerYear : 1,
  };
}

export interface CelFinance {
  investeringEur: number;
  /** Netto contante waarde over de looptijd, euro. */
  npvEur: number;
  paybackYears: number | null;
  irr: number | null;
  /** Besparing per jaar, euro: het rasterjaar op het niveau van het gemiddelde. */
  besparingEur: number;
  cyclesPerYear: number;
}

/** Wat een figuur van het raster nodig heeft; `GridState` past hierop. */
export interface RasterMaten {
  capacities: number[];
  powers: number[];
  rows: (GridPoint[] | null)[];
}

/**
 * De curve van de gekozen batterij in vorm, op het niveau van de cel.
 *
 * Elke steunpunt houdt zijn verhouding tot het punt op volle capaciteit. Heeft
 * de gekozen batterij zelf niets bespaard, dan is er geen vorm te lenen en
 * loopt de besparing recht evenredig met de capaciteit terug.
 */
export function celCurve(
  basis: readonly SavingCurvePoint[],
  savingEur: number,
  cyclesPerYear: number,
): SavingCurvePoint[] {
  if (basis.length === 0) return [{ capacityFraction: 1, savingEur, cyclesPerYear }];
  const vol = basis.find((p) => p.capacityFraction === 1) ?? basis[basis.length - 1]!;
  return basis.map((p) => ({
    capacityFraction: p.capacityFraction,
    savingEur: savingEur * (vol.savingEur > 0 ? p.savingEur / vol.savingEur : p.capacityFraction),
    cyclesPerYear:
      cyclesPerYear * (vol.cyclesPerYear > 0 ? p.cyclesPerYear / vol.cyclesPerYear : p.capacityFraction),
  }));
}

/**
 * De financiën van één maat: investering uit de kostenregel, de rest via
 * dezelfde `computeFinance` en dezelfde velden als het hoofdantwoord
 * (`financeVoor` in lib/model/analysis.ts).
 */
export function celFinance(
  punt: { savingEur: number; cyclesPerYear: number },
  cap: number,
  kw: number,
  config: Configuration,
  curve: readonly SavingCurvePoint[],
  niveau: RasterNiveau = GEEN_NIVEAU,
): CelFinance {
  const investeringEur = kostenVan(ankerVan(config), kostenregelVan(config), cap, kw);
  const besparing = punt.savingEur * niveau.besparing;
  const cycli = punt.cyclesPerYear * niveau.cycli;
  const fin = computeFinance({
    curve: celCurve(curve, besparing, cycli),
    investmentEur: investeringEur,
    years: config.analysisYears,
    priceEscalation: config.priceEscalation,
    discountRate: config.discountRate,
    calendarFadePerYear: config.calendarFadePerYear,
    cycleLife: config.cycleLife,
    residualValueEur: config.residualValueEur,
  });
  return {
    investeringEur,
    npvEur: fin.npvEur,
    paybackYears: fin.paybackYears,
    irr: fin.irr,
    besparingEur: besparing,
    cyclesPerYear: cycli,
  };
}

/** De financiën van het hele raster; null voor rijen die er nog niet zijn. */
export function rasterFinance(
  grid: RasterMaten,
  config: Configuration,
  curve: readonly SavingCurvePoint[],
  niveau: RasterNiveau = GEEN_NIVEAU,
): (CelFinance[] | null)[] {
  return grid.rows.map((rij, r) =>
    rij
      ? rij.map((p, k) => celFinance(p, grid.capacities[r]!, grid.powers[k]!, config, curve, niveau))
      : null,
  );
}

/** De kolom waarvan het vermogen het dichtst bij `kw` ligt; bij gelijk de eerste. */
export function dichtsteKolom(powers: readonly number[], kw: number): number {
  let beste = 0;
  for (let k = 1; k < powers.length; k++) {
    if (Math.abs(powers[k]! - kw) < Math.abs(powers[beste]! - kw)) beste = k;
  }
  return beste;
}

export interface Uitbreidingsstap {
  capacityKwh: number;
  fin: CelFinance;
  /**
   * Wat de stap vanaf de vorige capaciteit netto opleverde, per kilowattuur
   * erbij. Null bij de eerste stap.
   */
  marginaalPerKwh: number | null;
}

/**
 * Eén kolom van het raster als uitbreidingspad: stap voor stap meer
 * capaciteit bij hetzelfde vermogen. `omslag` is de eerste stap waarbij de
 * extra kilowatturen netto geld kosten in plaats van opleveren.
 */
export function uitbreidingsstappen(
  grid: RasterMaten,
  kolom: number,
  config: Configuration,
  curve: readonly SavingCurvePoint[],
  niveau: RasterNiveau = GEEN_NIVEAU,
): { stappen: Uitbreidingsstap[]; omslag: number | null } {
  const stappen: Uitbreidingsstap[] = [];
  for (let r = 0; r < grid.rows.length; r++) {
    const rij = grid.rows[r];
    const punt = rij?.[kolom];
    if (!punt) continue;
    const cap = grid.capacities[r]!;
    const fin = celFinance(punt, cap, grid.powers[kolom]!, config, curve, niveau);
    const vorige = stappen[stappen.length - 1];
    stappen.push({
      capacityKwh: cap,
      fin,
      marginaalPerKwh: vorige ? (fin.npvEur - vorige.fin.npvEur) / (cap - vorige.capacityKwh) : null,
    });
  }
  const omslag = stappen.findIndex((s) => s.marginaalPerKwh !== null && s.marginaalPerKwh < 0);
  return { stappen, omslag: omslag === -1 ? null : omslag };
}

export interface Keuze {
  capacityKwh: number;
  powerKw: number;
  fin: CelFinance;
}

export interface Advies {
  /** De maat met het hoogste netto resultaat in het raster. */
  beste: Keuze;
  /** Idem binnen de stekkerbatterijen (tot en met 0,8 kW), als die er zijn. */
  besteStekker: Keuze | null;
  /** Idem binnen de maten met een eigen groep. */
  besteVast: Keuze | null;
  /** Levert de beste vaste maat méér op dan de beste stekkermaat? */
  vasteLoont: boolean;
}

/** Het advies uit een vol raster; null zolang er rijen ontbreken. */
export function advies(
  grid: RasterMaten,
  config: Configuration,
  curve: readonly SavingCurvePoint[],
  niveau: RasterNiveau = GEEN_NIVEAU,
): Advies | null {
  if (grid.rows.length === 0 || grid.rows.some((r) => r === null)) return null;
  const keuzes: Keuze[] = [];
  grid.rows.forEach((rij, r) =>
    rij!.forEach((p, k) =>
      keuzes.push({
        capacityKwh: grid.capacities[r]!,
        powerKw: grid.powers[k]!,
        fin: celFinance(p, grid.capacities[r]!, grid.powers[k]!, config, curve, niveau),
      }),
    ),
  );
  const hoogste = (lijst: Keuze[]): Keuze | null =>
    lijst.reduce<Keuze | null>((b, x) => (b === null || x.fin.npvEur > b.fin.npvEur ? x : b), null);
  const beste = hoogste(keuzes)!;
  const besteStekker = hoogste(keuzes.filter((x) => !isVasteAansluiting(x.powerKw)));
  const besteVast = hoogste(keuzes.filter((x) => isVasteAansluiting(x.powerKw)));
  return {
    beste,
    besteStekker,
    besteVast,
    vasteLoont:
      besteVast !== null && (besteStekker === null || besteVast.fin.npvEur > besteStekker.fin.npvEur),
  };
}
