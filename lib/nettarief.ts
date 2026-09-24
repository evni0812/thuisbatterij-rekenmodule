/**
 * Het tijdsafhankelijke nettarief dat er vanaf 2029 aankomt.
 *
 * ── Wat vaststaat ───────────────────────────────────────────────────────────
 * De netbeheerders hebben op 1 mei 2026 bij de ACM een codewijzigingsvoorstel
 * ingediend voor een volume- en tijdsafhankelijk transporttarief voor alle
 * aansluitingen tot 3×80 A (Netbeheer Nederland 2026b). Een derde van het
 * transporttarief wordt een capaciteitscomponent op de doorlaatwaarde van de
 * aansluiting; de rest gaat afhangen van hoeveel je gebruikt, wanneer, en in
 * welk seizoen. Vijf tijdsblokken per dag, vijf tariefhoogten in totaal en
 * hoogstens vier per dag, twee seizoenen: zomer is april tot en met september,
 * winter oktober tot en met maart. Geen onderscheid tussen weekdag en weekend.
 *
 * De ACM beslist naar verwachting voor eind 2026. Invoering is voorzien op
 * 1 januari 2029, "in beginsel": het voorstel kent drie uitwijkgronden naar
 * 1 januari 2030 (sectorafspraken, energiedelen, ministeriële regelingen).
 *
 * ── Wat vaststaat: de wegingsfactoren ───────────────────────────────────────
 * Bijlage 5 van het voorstel geeft per uur en per seizoen een wegingsfactor
 * uit {0; 0,3; 0,5; 0,7; 1,0}. Het tarief van een uur is die factor maal een
 * basistarief. De factoren staan hieronder letterlijk overgenomen.
 *
 * ── Wat NIET vaststaat: het basistarief ─────────────────────────────────────
 * Het voorstel noemt geen bedragen. Het basistarief hieronder is een PROGNOSE
 * van CE Delft (Beheersbare energiekosten voor huishoudens in 2030, september
 * 2026, Figuur 4 en Tabel 8, op basis van Netbeheer Nederland 2026b en 2026c):
 * EUR 0,191 per kWh in 2030, inclusief btw, prijspeil 2025. Geijkt op een
 * huishouden van 3.000 kWh met EUR 335 aan volume- en tijdsafhankelijk
 * transporttarief. Figuur 4 toont de factoren maal dit basistarief, afgerond
 * op hele centen.
 *
 * CE Delft rekent met een stijging van de nettarieven van 7,5% per jaar; voor
 * het eerste jaar, 2029, komt het basistarief dan een stap lager uit.
 *
 * Daarnaast staan er in de CE-doorrekening nog EUR 167 aan capaciteitscomponent
 * (een derde van het transporttarief) en EUR 135 periodieke aansluitvergoeding
 * en meetdienst. Die blijven hier buiten beeld: ze hangen niet van je gedrag af
 * en zijn met en zonder batterij gelijk.
 *
 * ── Alleen op afname ────────────────────────────────────────────────────────
 * Het voorstel is expliciet: het gaat uitsluitend over afgenomen elektriciteit,
 * "aangezien aangeslotenen uitsluitend tarieven betalen voor afname en niet voor
 * invoeding". Een invoedingstarief zou een nieuw voorstel vergen. De schakelaar
 * om het tarief ook op teruglevering te heffen staat daarom standaard uit en is
 * een wat-als.
 *
 * ── De heffing in het scenario ──────────────────────────────────────────────
 * Het nettarief komt bovenop de energiebelasting en de inkoopopslag. De
 * gewone doorrekening rekent standaard met de heffing van nu (12,9 cent in
 * 2026) over alle historische jaren; wie "toen" kiest krijgt de heffing zoals
 * die per uur gold, 13 tot 17 cent. In 2029 en 2030 ligt de energiebelasting volgens CE Delft (Tabel 2) op
 * EUR 0,075 respectievelijk 0,076 per kWh exclusief btw. Het scenario rekent
 * daarom met de heffing van dat jaar in plaats van die van toen; anders stapelt
 * het een nettarief van 2030 op een belasting van 2024, en de besparing
 * schaalt bijna één-op-één met de heffing.
 *
 * ── Waarom dit de businesscase omgooit ──────────────────────────────────────
 * Het winterpiektarief van ruim 19 cent komt bovenop de energieprijs, terwijl het
 * hele prijsverschil op een winterdag nu rond de 10 cent ligt. Tegelijk gaat de
 * zomermiddag naar nul, precies wanneer het net vol zonnestroom staat. Dat is
 * exact het patroon waar een batterij op verdient.
 *
 * Kanttekening: de prognose is gedragsonafhankelijk. Als veel huishoudens de
 * piek gaan mijden, herijken de netbeheerders blokken en factoren jaarlijks, en
 * moeten de overige huishoudens meer opbrengen. Dat zit hier niet in.
 */

import type { LocalTimeIndex } from "./data/timeaxis";
import type { Configuration } from "./worker/protocol";

/** Bron van de bedragen, voor in de interface. */
export const NETTARIEF_BRON =
  "CE Delft, geprognosticeerde nettarieven 2030, op basis van Netbeheer Nederland (2026b, 2026c)";

/** Wanneer het stelsel volgens het voorstel ingaat. */
export const NETTARIEF_INGANG = "1 januari 2029";

/** Voor welk jaar het basistarief geldt. */
export type NettariefJaar = 2029 | 2030;

/**
 * Het jaar waarmee de tool rekent: 2029, de beoogde invoeringsdatum.
 *
 * De interface liet je hier eerst tussen 2029 en 2030 kiezen. Dat was een keuze
 * over een aanname in een scenario dat zelf al een aanname is, en hij stond in
 * de weg: wie wil weten wat een batterij oplevert, wil niet eerst beslissen
 * welk prognosejaar hij aanhoudt. 2030 blijft in het model bestaan als de
 * uitwijkdatum uit het voorstel, en als de basis waaruit 2029 volgt.
 */
export const NETTARIEF_JAAR: NettariefJaar = 2029;

/** Geprognosticeerd basistarief 2030, EUR/kWh incl. btw (CE Delft, Tabel 8). */
const BASISTARIEF_2030 = 0.191;
/** Jaarlijkse stijging van de nettarieven waarmee CE Delft rekent. */
const STIJGING_PER_JAAR = 0.075;

/** Het basistarief per jaar: de bovenste trede, wegingsfactor 1,0. */
export const BASISTARIEF: Record<NettariefJaar, number> = {
  2029: BASISTARIEF_2030 / (1 + STIJGING_PER_JAAR),
  2030: BASISTARIEF_2030,
};

/**
 * Wegingsfactoren per uur, winter (oktober tot en met maart). Bijlage 5 lid 6
 * van het voorstel: uur 0 op 0,7; de nacht 0,5; de ochtend 7 tot en met 9 op
 * 0,7; overdag 0,5; de avondpiek 16 tot en met 22 op 1,0; uur 23 weer 0,7.
 * Uur 23 en uur 0 vormen samen één blok, zodat de dag vijf blokken telt.
 */
const WEGING_WINTER: readonly number[] = [
  0.7, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.7, 0.7, 0.7, 0.5, 0.5,
  0.5, 0.5, 0.5, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.7,
];

/**
 * Wegingsfactoren per uur, zomer (april tot en met september). De middag 10
 * tot en met 16 is gratis: zeven uur, want het blok loopt door tot en met
 * 16:00. De avondpiek begint pas om 19:00, loopt tot en met 23:00 en staat op
 * 0,7, niet op 1,0: de zomerpiek is lager dan de winterpiek.
 */
const WEGING_ZOMER: readonly number[] = [
  0.5, 0.5, 0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.3, 0.3, 0.7, 0.7, 0.7, 0.7, 0.7,
];

/** Alle wegingsfactoren die het voorstel kent, oplopend. */
export const NETTARIEF_FACTOREN = [0, 0.3, 0.5, 0.7, 1] as const;

export function isZomer(maand: number): boolean {
  return maand >= 4 && maand <= 9;
}

/** Maand 1–12 naar de 24 wegingsfactoren die die maand gelden. */
export function factorVoorMaand(maand: number): readonly number[] {
  return isZomer(maand) ? WEGING_ZOMER : WEGING_WINTER;
}

/**
 * Maand 1–12 naar het uurprofiel in EUR/kWh: wegingsfactor maal basistarief.
 * Niet afgerond; Figuur 4 van CE Delft toont hetzelfde op hele centen.
 */
export function profielVoorMaand(
  maand: number,
  jaar: NettariefJaar = NETTARIEF_JAAR,
): readonly number[] {
  const basis = BASISTARIEF[jaar];
  return factorVoorMaand(maand).map((f) => f * basis);
}

/**
 * De piekuren: de uren waarop de wegingsfactor van dat seizoen op zijn maximum
 * staat. Winter 16 tot en met 22 uur, zomer 19 tot en met 23 uur.
 *
 * Dit is de definitie achter de statistiek "afname in de piekuren": hoeveel
 * het huishouden op die uren van het net haalt, met en zonder batterij. De
 * definitie hangt niet af van het basistarief of van of het nettarief in de
 * doorrekening meedoet, zodat "nu" en "2029" dezelfde uren meten en het
 * verschil ertussen zuiver het gedrag van de batterij is.
 */
function piekuren(factoren: readonly number[]): readonly boolean[] {
  const max = Math.max(...factoren);
  return factoren.map((v) => v === max);
}

const PIEK_WINTER = piekuren(WEGING_WINTER);
const PIEK_ZOMER = piekuren(WEGING_ZOMER);

/** Maand 1–12 naar 24 booleans: is dit uur een piekuur. */
export function piekurenVoorMaand(maand: number): readonly boolean[] {
  return isZomer(maand) ? PIEK_ZOMER : PIEK_WINTER;
}

export function isPiekuur(maand: number, uur: number): boolean {
  return piekurenVoorMaand(maand)[uur] === true;
}

/**
 * Bouw de nettariefreeks voor een tijdas.
 *
 * Maand en uur worden in LOKALE tijd bepaald, net als overal in dit model: een
 * tariefblok van 16:00 tot 23:00 is wandkloktijd, en de UTC-grens daarvan
 * schuift met de zomertijd mee.
 */
export function nettariefPerStap(
  startMs: Float64Array,
  index: LocalTimeIndex,
  jaar: NettariefJaar = NETTARIEF_JAAR,
): Float64Array {
  const uit = new Float64Array(startMs.length);
  const basis = BASISTARIEF[jaar];
  for (let i = 0; i < startMs.length; i++) {
    const ms = startMs[i]!;
    const maand = Number(index.localDate(ms).slice(5, 7));
    uit[i] = factorVoorMaand(maand)[index.localHour(ms)]! * basis;
  }
  return uit;
}

/** Gemiddeld tarief over een heel jaar, ongewogen; voor de uitleg. */
export function gemiddeldNettarief(jaar: NettariefJaar = NETTARIEF_JAAR): number {
  let som = 0;
  for (let m = 1; m <= 12; m++) {
    for (const v of profielVoorMaand(m, jaar)) som += v;
  }
  return som / (12 * 24);
}

/**
 * Energiebelasting op elektriciteit, eerste schijf, EUR/kWh EXCLUSIEF btw.
 *
 * 2023 tot en met 2026 uit de tarieventabel van de Belastingdienst (ML 040,
 * aangifte energiebelasting); 2027 gelijk aan 2026 zolang er geen nieuw
 * tarief is gepubliceerd; 2029 en 2030 volgens CE Delft (Tabel 2).
 *
 * 2026 stond hier eerst op 0,089: dat is geen tarief uit de tabel, en het
 * trok de afgeleide inkoopopslag op tot 2,1 cent in plaats van 1,8. Alleen
 * 2026, 2029 en 2030 worden gebruikt; de oudere jaren staan erbij ter controle
 * van de heffing in de prijsdata (allInPrijs − marktprijs = belasting maal btw
 * plus opslag), zie tests/nettarief.test.ts.
 */
export const ENERGIEBELASTING_EXCL_BTW: Record<2023 | 2024 | 2025 | 2026 | 2027 | NettariefJaar, number> = {
  2023: 0.12599,
  2024: 0.1088,
  2025: 0.10154,
  2026: 0.09161,
  2027: 0.09161,
  2029: 0.075,
  2030: 0.076,
};

const BTW = 1.21;

/**
 * De inkoopopslag inclusief btw, zoals die in de data van 2026 zit: de
 * jaarconstante van de heffing (allInPrijs minus marktprijs, EUR 0,128848)
 * minus de energiebelasting van 2026 inclusief btw (0,09161 × 1,21 =
 * 0,110848). Dat is 1,80 cent; als vaste aanname in het scenario, zodat de
 * configuratie niet van het manifest afhangt.
 */
export const OPSLAG_2026_INCL_BTW = 0.128848 - ENERGIEBELASTING_EXCL_BTW[2026] * BTW;

/** De heffing van nu (2026), energiebelasting plus opslag incl. btw: EUR 0,128848. */
export const HEFFING_NU = ENERGIEBELASTING_EXCL_BTW[2026] * BTW + OPSLAG_2026_INCL_BTW;

/**
 * De heffing (energiebelasting plus inkoopopslag, incl. btw) waarmee het
 * scenario rekent, EUR/kWh. Ongeveer 10,9 cent in 2029 tegen 12,9 in 2026.
 */
export function scenarioHeffing(jaar: NettariefJaar): number {
  return ENERGIEBELASTING_EXCL_BTW[jaar] * BTW + OPSLAG_2026_INCL_BTW;
}

/**
 * De configuratie van het nettariefscenario, afgeleid van een gewone.
 *
 * Eén plek voor de drie kanten die hem bouwen — de hoofdpagina, de build van
 * het standaardantwoord en de vergelijker — want de cachesleutel is de hash
 * van de configuratie: de kleinste afwijking en het bewaarde antwoord wordt
 * nooit gevonden.
 */
export function scenarioConfiguratie(
  basis: Configuration,
  opties: { jaar?: NettariefJaar; opTeruglevering?: boolean } = {},
): Configuration {
  const jaar = opties.jaar ?? NETTARIEF_JAAR;
  return {
    ...basis,
    netTariff: true,
    netTariffOnExport: opties.opTeruglevering ?? false,
    netTariffYear: jaar,
    levyEurPerKwh: scenarioHeffing(jaar),
  };
}
