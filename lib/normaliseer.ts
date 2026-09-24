/**
 * Eén plek voor wat een geldige instelling is.
 *
 * Instellingen komen binnen langs drie wegen: de URL (een gedeelde link, of
 * een die iemand met de hand heeft aangepast), de browseropslag (een set van
 * een oudere versie, of bewerkt), en de invoervelden. Elk van die wegen had
 * zijn eigen idee van wat mocht, en de eerste twee controleerden alleen of er
 * een getal stond. Daardoor kon `?jr=1e7` de tab tien seconden laten bevriezen
 * (tien miljoen cashflowjaren), maakte `?kw=-1` energie uit niets, gaf
 * `?disc=-1` een contante waarde van oneindig en `?stg=5` er een van zes
 * biljoen.
 *
 * Nu leggen `GRENZEN` de ondergrens, bovengrens en afronding per veld één keer
 * vast. De velden in components/Geavanceerd.tsx en components/Invoer.tsx lezen
 * hun min en max hieruit, en `normaliseer` houdt alles wat van buiten komt
 * binnen dezelfde grenzen: leesUrl, vulAan en maakConfiguratie roepen hem aan.
 * Wat de gebruiker in een veld ziet kan dus niet anders zijn dan waarmee
 * gerekend wordt.
 *
 * Bewust: de standaardwaarden liggen ruim binnen de grenzen en veranderen niet
 * door normaliseren (tests/url-state.test.ts bewaakt dat), zodat de hash van
 * de standaardconfiguratie — en daarmee het vooruitgerekende antwoord — blijft
 * wat hij was.
 *
 * Wat hier niet gebeurt: model-gevoelige standaardwaarden meeschrijven in de
 * URL. Een link bevat alleen afwijkingen van de standaard; verandert de
 * standaard in een nieuwe versie, dan krijgt een oude link die nieuwe waarde.
 * Dat is een keuze (een link beschrijft "mijn situatie", niet "de toenmalige
 * aannames van de tool") en geen vergissing.
 */

import { PRESETS } from "./presets";
import { normaliseerCo2Drempel } from "./model/co2";
import { DOELEN } from "./model/doel";
import type { Doel } from "./model/types";
import type { Instellingen } from "./url-state";

/** De getalvelden van de instellingen. */
export type GetalVeld = {
  [K in keyof Instellingen]: Instellingen[K] extends number | null ? K : never;
}[keyof Instellingen];

export interface Grens {
  min: number;
  max: number;
  /** Aantal decimalen waarop de waarde wordt afgerond, in de eenheid van de instelling. */
  decimalen: number;
}

/**
 * De grenzen, in de eenheid waarin de instelling bewaard wordt. Percentages
 * staan er dus als fractie (0,15 = 15%); de velden tonen ze maal honderd.
 *
 * De ondergrenzen zijn realistisch, niet wiskundig: een batterij van 0,1 kWh of
 * een omvormer van 50 W bestaat niet als thuisbatterij, en een negatieve
 * aanschafprijs of looptijd heeft geen betekenis.
 */
export const GRENZEN: Record<GetalVeld, Grens> = {
  afnameKwh: { min: 0, max: 30000, decimalen: 0 },
  terugleveringKwh: { min: 0, max: 30000, decimalen: 0 },
  opwekKwh: { min: 0, max: 30000, decimalen: 0 },
  spreiding: { min: 0.5, max: 2, decimalen: 2 },
  terugleverkostenCt: { min: 0, max: 15, decimalen: 2 },
  analysejaren: { min: 1, max: 30, decimalen: 0 },
  discontovoet: { min: 0, max: 0.15, decimalen: 4 },
  prijsstijging: { min: -0.05, max: 0.1, decimalen: 4 },
  degradatie: { min: 0, max: 0.05, decimalen: 4 },
  slijtageDeel: { min: 0, max: 1, decimalen: 2 },
  kostenPerKwh: { min: 0, max: 2000, decimalen: 0 },
  kostenPerKw: { min: 0, max: 2000, decimalen: 0 },
  installatieEur: { min: 0, max: 3000, decimalen: 0 },
  co2Drempel: { min: 0, max: 400, decimalen: 0 },
  prijsEur: { min: 100, max: 20000, decimalen: 0 },
  capaciteitKwh: { min: 1, max: 30, decimalen: 2 },
  vermogenKw: { min: 0.8, max: 11.5, decimalen: 2 },
};

/** Velden die leeg (null) mogen zijn: "neem de waarde van de batterij", of "onbekend". */
export const MAG_LEEG: ReadonlySet<GetalVeld> = new Set<GetalVeld>([
  "prijsEur",
  "capaciteitKwh",
  "vermogenKw",
  "opwekKwh",
]);

/** Een getal binnen de grenzen van dit veld, afgerond; null of de standaard als het onleesbaar is. */
export function klem(veld: GetalVeld, waarde: number): number {
  const g = GRENZEN[veld];
  let v = Math.min(g.max, Math.max(g.min, waarde));
  if (veld === "co2Drempel") {
    // Zoals nederlandPerspectief hem gebruikt: naar boven afgerond op de
    // volgende klassegrens, zodat wat er staat ook is wat er gerekend wordt.
    // Eén bron voor die regel: normaliseerCo2Drempel in lib/model/co2.ts.
    v = normaliseerCo2Drempel(v);
  }
  const f = 10 ** g.decimalen;
  // Via toFixed in plaats van Math.round(v * f) / f: 0,015 * 10000 is
  // 150,00000000000003, en dat moet gewoon 0,015 blijven.
  return Number((Math.round(v * f) / f).toFixed(g.decimalen));
}

const DOEL_IDS: readonly Doel[] = DOELEN.map((d) => d.id);
const HEFFINGEN: readonly Instellingen["heffing"][] = ["toen", "nu"];

/** Een EAN-code van een netgebied: achttien cijfers. De lijst zelf staat in het manifest. */
export function isNetgebiedCode(s: string): boolean {
  return /^\d{18}$/.test(s);
}

/** Een echte kalenderdag in de vorm JJJJ-MM-DD (dus geen 30 februari). */
export function isDatum(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Houd een (deel van een) set instellingen binnen de grenzen.
 *
 * Een veld dat niet te redden is — het verkeerde type, een onbekende batterij,
 * een onmogelijke datum — valt weg, zodat de aanroeper er de standaard voor
 * neemt. Een getal buiten de grenzen wordt geklemd, niet weggegooid: wie
 * `?af=50000` deelt bedoelt een groot verbruik, geen standaardverbruik.
 *
 * @param gecorrigeerd  als meegegeven, komen hier de instellingen in die niet
 *   ongewijzigd door de controle kwamen, zodat de pagina dat kan melden.
 */
export function normaliseerDeel(
  inst: Partial<Record<keyof Instellingen, unknown>>,
  gecorrigeerd?: (keyof Instellingen)[],
): Partial<Instellingen> {
  const uit: Partial<Record<keyof Instellingen, unknown>> = {};
  const meld = (k: keyof Instellingen) => gecorrigeerd?.push(k);

  for (const [k, v] of Object.entries(inst) as [keyof Instellingen, unknown][]) {
    if (v === undefined) continue;
    if (k in GRENZEN) {
      const veld = k as GetalVeld;
      if (v === null && MAG_LEEG.has(veld)) {
        uit[k] = null;
      } else if (typeof v === "number" && Number.isFinite(v)) {
        const n = klem(veld, v);
        if (n !== v) meld(k);
        uit[k] = n;
      } else {
        meld(k);
      }
      continue;
    }
    switch (k) {
      case "zonnepanelen":
      case "curtailment":
        if (typeof v === "boolean") uit[k] = v;
        else meld(k);
        break;
      case "heffing":
        if (HEFFINGEN.includes(v as Instellingen["heffing"])) uit[k] = v;
        else meld(k);
        break;
      case "doel":
        if (DOEL_IDS.includes(v as Doel)) uit[k] = v;
        else meld(k);
        break;
      case "presetId":
        if (typeof v === "string" && PRESETS.some((p) => p.id === v)) uit[k] = v;
        else meld(k);
        break;
      case "domein":
        if (typeof v === "string" && isNetgebiedCode(v)) uit[k] = v;
        else meld(k);
        break;
      case "van":
      case "tot":
        // Leeg betekent: de hele beschikbare periode.
        if (v === "" || (typeof v === "string" && isDatum(v))) uit[k] = v;
        else meld(k);
        break;
      default:
        // Een veld dat de instellingen niet kennen: weg.
        break;
    }
  }

  // Een periode die eindigt voordat hij begint, bestaat niet; dan de hele
  // beschikbare periode in plaats van een foutmelding over ontbrekende data.
  if (typeof uit.van === "string" && typeof uit.tot === "string" && uit.van && uit.tot && uit.van > uit.tot) {
    meld("van");
    meld("tot");
    uit.van = "";
    uit.tot = "";
  }
  return uit as Partial<Instellingen>;
}

/** Hoe een instelling heet in een melding dat hij is aangepast. */
export const VELDNAAM: Record<keyof Instellingen, string> = {
  afnameKwh: "afname",
  terugleveringKwh: "teruglevering",
  zonnepanelen: "zonnepanelen",
  presetId: "batterij",
  domein: "netgebied",
  van: "begin van de periode",
  tot: "einde van de periode",
  spreiding: "pieken in je verbruik",
  terugleverkostenCt: "terugleverkosten",
  curtailment: "afregelen",
  heffing: "energiebelasting",
  analysejaren: "looptijd",
  discontovoet: "rente",
  prijsstijging: "prijsstijging",
  degradatie: "capaciteitsverlies",
  slijtageDeel: "slijtagestrategie",
  kostenPerKwh: "meerprijs per kWh",
  kostenPerKw: "meerprijs per kW",
  installatieEur: "eigen groep",
  co2Drempel: "CO2-drempel",
  doel: "doel",
  prijsEur: "aanschafprijs",
  capaciteitKwh: "capaciteit",
  vermogenKw: "vermogen",
  opwekKwh: "opwek",
};

/** Een volledige set binnen de grenzen; wat niet te redden is, wordt de standaard. */
export function normaliseer(
  inst: Instellingen,
  standaard: Instellingen,
  gecorrigeerd?: (keyof Instellingen)[],
): Instellingen {
  const schoon = { ...standaard, ...normaliseerDeel(inst, gecorrigeerd) };
  // Een periode is een paar: viel één helft weg, dan past de andere mogelijk
  // niet meer bij de standaard; controleer het paar opnieuw.
  if (schoon.van && schoon.tot && schoon.van > schoon.tot) {
    schoon.van = "";
    schoon.tot = "";
  }
  return schoon;
}
