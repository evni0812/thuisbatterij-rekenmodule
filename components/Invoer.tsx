"use client";

/**
 * De instap: drie vragen, en ze staan alle drie op de jaarafrekening.
 *
 * Afname en teruglevering zijn niet alleen de simpelste vraag, ze zijn ook
 * precies de twee schaalfactoren die het model nodig heeft. Daardoor hoeft er
 * niets aangenomen te worden over oriëntatie, instraling of zelfconsumptie: dat
 * zit al in het gemeten gemiddelde profiel van het netgebied.
 */

import type { ReactNode } from "react";
import { perMerk, PRESETS, STANDAARD_PRESET_ID, type BatteryPreset } from "../lib/presets";
import { DOELEN, doelInfo } from "../lib/model/doel";
import type { Doel } from "../lib/model/types";
import { STRATEGIEEN, strategieVoor } from "../lib/strategie";
import { euro, getal, kwh, procent, vermogenTekst } from "../lib/format";
import { GRENZEN } from "../lib/normaliseer";
import { GetalInvoer } from "./GetalInvoer";

/** Rondgang van de standaardbatterij, voor als de aanroeper er geen opgeeft. */
const RONDGANG_STANDAARD = (PRESETS.find((p) => p.id === STANDAARD_PRESET_ID) ?? PRESETS[0]!).spec.efficiency ** 2;

export interface Waarschuwing {
  ernst: "info" | "let-op";
  tekst: string;
}

/**
 * Plausibiliteitscontrole die uitlegt in plaats van blokkeert.
 *
 * De tool corrigeert niets stilzwijgend: ongebruikelijke invoer mag, maar de
 * gebruiker hoort te weten wat het met de uitkomst doet.
 */
export function controleerInvoer(
  afnameKwh: number,
  terugleveringKwh: number,
  preset: BatteryPreset,
  zonnepanelen = true,
  /** De maat waarmee gerekend wordt, als die van de preset afwijkt (lib/configuratie.ts). */
  maat: { capaciteitKwh: number; vermogenKw: number } = preset,
): Waarschuwing[] {
  const uit: Waarschuwing[] = [];

  if (afnameKwh <= 0) {
    uit.push({ ernst: "let-op", tekst: "Vul in hoeveel stroom je per jaar van het net afneemt." });
  } else if (afnameKwh < 500) {
    uit.push({
      ernst: "let-op",
      tekst: "Minder dan 500 kWh afname per jaar is uitzonderlijk laag. Klopt dit getal?",
    });
  } else if (afnameKwh > 12000) {
    uit.push({
      ernst: "info",
      tekst: "Dit is een fors verbruik. Heb je een warmtepomp of laad je een auto thuis? " +
        "Dan wijkt jouw dagpatroon af van het gemiddelde profiel waarmee gerekend wordt.",
    });
  }

  if (!zonnepanelen) {
    uit.push({
      ernst: "info",
      tekst: "Zonder zonnepanelen kan een batterij alleen verdienen aan prijsverschillen over " +
        "de dag: 's nachts of midden op de dag laden, 's avonds leveren. Dat levert veel " +
        "minder op dan het opslaan van eigen zonnestroom.",
    });
  } else if (terugleveringKwh <= 0) {
    uit.push({
      ernst: "info",
      tekst: "Zonder teruglevering valt er weinig op te slaan. Een batterij kan dan alleen " +
        "verdienen aan prijsverschillen, en dat levert veel minder op.",
    });
  } else if (terugleveringKwh > afnameKwh * 2.5 && afnameKwh > 0) {
    uit.push({
      ernst: "info",
      tekst: "Je levert veel meer terug dan je afneemt. Dat kan, maar controleer of je niet " +
        "de opwek van je panelen hebt ingevuld in plaats van wat er naar het net ging.",
    });
  }

  const dagverbruik = afnameKwh / 365;
  if (maat.capaciteitKwh > dagverbruik * 3 && dagverbruik > 0) {
    uit.push({
      ernst: "info",
      tekst: `Deze batterij (${getal(maat.capaciteitKwh, 2)} kWh) is groot ten opzichte van je ` +
        `dagelijkse afname van ongeveer ${getal(dagverbruik, 1)} kWh. Hij zal zelden vollopen.`,
    });
  }

  if (maat.vermogenKw > 5) {
    uit.push({
      ernst: "info",
      tekst: "Bij dit vermogen kan een 1-fase aansluiting knellen. Dat is een huisaansluiting met " +
        "één fase in de meterkast, zoals veel woningen die hebben. Vraag je netbeheerder wat jouw " +
        "aansluiting aankan.",
    });
  }

  return uit;
}

/**
 * Wat de gekozen stand voor de laadbeurten betekent, in twee zinnen: alleen de
 * kern, zonder getallen. Het rekenvoorbeeld staat in `slijtageVoorbeeld`.
 */
export function slijtageHint(deel: number): string {
  const st = strategieVoor(deel);
  switch (st?.id) {
    case "zuinig":
      return "Zuinig: de batterij laadt en levert alleen als het prijsverschil groot genoeg is om de slijtage terug te verdienen. Minder laadbeurten, langere levensduur, lagere besparing.";
    case "gebalanceerd":
      return "Gebalanceerd: de batterij telt de helft van de slijtage mee. Hij doet mee met de duidelijke prijsverschillen en laat de krappe dagen liggen.";
    case "maximaal":
      return "Volop: de batterij laadt en levert ook bij een klein prijsverschil. Meer laadbeurten en een hogere besparing, maar ook meer slijtage.";
    default:
      return `Eigen stand (${procent(deel)}): de batterij telt ${procent(deel)} van de slijtage mee bij de keuze om te laden of te leveren.`;
  }
}

/** Een bedrag per kWh in gewone woorden: "24,5 cent per kWh". */
const centPer = (eur: number) => `${getal(eur * 100, 1)} cent per kWh`;

/**
 * Het rekenvoorbeeld bij de gekozen stand, in gewone taal: wat de aansturing
 * meerekent en hoe groot het prijsverschil minstens moet zijn. Bij inkoop
 * tegen 20 cent moet de stroom later minstens het omzettingsverlies plus de
 * drempel meer waard zijn voordat een beurt doorgaat.
 */
export function slijtageVoorbeeld(deel: number, slijtageprijsEur: number, rondgang: number): string {
  const drempel = slijtageprijsEur * deel;
  const inkoop = 0.2;
  const verlies = rondgang > 0 ? inkoop / rondgang - inkoop : 0;
  return (
    `Een voorbeeld: koop je stroom in tegen ${centPer(inkoop)}, dan gaat er bij het omzetten ${centPer(verlies)} verloren. ` +
    (drempel > 0
      ? `De aansturing (de software die bepaalt wanneer de batterij laadt en levert) rekent daar ${centPer(drempel)} aan slijtage bij. `
      : "Slijtage telt dan niet mee. ") +
    `De batterij laadt dan alleen als die stroom je later minstens ${centPer(inkoop + verlies + drempel)} waard is.`
  );
}

function Veld({
  label,
  hint,
  hintId,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** Zodat het invoerveld met aria-describedby naar de hint kan wijzen. */
  hintId?: string;
  children: ReactNode;
}) {
  return (
    <label className="veld">
      <span className="veld-label">{label}</span>
      {children}
      {hint ? (
        <span className="veld-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Invoer({
  afnameKwh,
  terugleveringKwh,
  zonnepanelen = true,
  presetId,
  capaciteitKwh,
  vermogenKw,
  laadKw,
  ontlaadKw,
  prijsEur,
  onAfname,
  onTeruglevering,
  onZonnepanelen,
  onPreset,
  doel = "rendement",
  onDoel,
  slijtageDeel,
  onSlijtageDeel,
  slijtageprijsEur = 0,
  rondgang = RONDGANG_STANDAARD,
  onBereken,
  verouderd,
  bezig,
}: {
  afnameKwh: number;
  terugleveringKwh: number;
  /** Met (standaard) of zonder zonnepanelen; kiest het gemeten profiel. */
  zonnepanelen?: boolean;
  presetId: string;
  /**
   * De maat en prijs waarmee gerekend wordt (`effectieveBatterij` in
   * lib/configuratie.ts). Zonder: die van de gekozen batterij.
   */
  capaciteitKwh?: number;
  vermogenKw?: number;
  /** Laad- en ontlaadvermogen waarmee gerekend wordt, als die verschillen; zonder: die van de gekozen batterij. */
  laadKw?: number;
  ontlaadKw?: number;
  prijsEur?: number;
  onAfname: (v: number) => void;
  onTeruglevering: (v: number) => void;
  onZonnepanelen?: (v: boolean) => void;
  onPreset: (id: string) => void;
  /** Waar de aansturing op stuurt; zie lib/model/doel.ts. */
  doel?: Doel;
  onDoel?: (d: Doel) => void;
  /** Deel van de slijtageprijs dat de aansturing meerekent; zie lib/strategie.ts. */
  slijtageDeel?: number;
  onSlijtageDeel?: (deel: number) => void;
  /** Volle slijtageprijs per geleverde kWh van de gekozen batterij, euro; voor de uitleg in centen. */
  slijtageprijsEur?: number;
  /** Van elke kWh die je opslaat, komt dit deel terug (0 tot 1); voor het rekenvoorbeeld in de uitleg. */
  rondgang?: number;
  /** Reken door met de huidige invoer. */
  onBereken: () => void;
  /** De invoer is gewijzigd sinds de getoonde uitkomst. */
  verouderd: boolean;
  bezig: boolean;
}) {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;
  const cap = capaciteitKwh ?? preset.capaciteitKwh;
  const kw = vermogenKw ?? preset.vermogenKw;
  const laad = laadKw ?? (vermogenKw !== undefined && vermogenKw !== preset.vermogenKw ? vermogenKw : preset.laadvermogenKw);
  const ontlaad = ontlaadKw ?? (vermogenKw !== undefined && vermogenKw !== preset.vermogenKw ? vermogenKw : preset.ontlaadvermogenKw);
  const prijs = prijsEur ?? preset.prijsEur;
  const waarschuwingen = controleerInvoer(afnameKwh, terugleveringKwh, preset, zonnepanelen, {
    capaciteitKwh: cap,
    vermogenKw: kw,
  });
  // Wat er staat is wat er gerekend wordt; wijkt dat van de batterij af, dan zeggen we dat.
  const aangepast = (afwijkt: boolean) => (afwijkt ? " (aangepast)" : "");
  const batterijHint =
    `${getal(cap, 2)} kWh${aangepast(cap !== preset.capaciteitKwh)} · ` +
    `${vermogenTekst(laad, ontlaad)}${aangepast(laad !== preset.laadvermogenKw || ontlaad !== preset.ontlaadvermogenKw)} · ` +
    `${euro(prijs)}${aangepast(prijs !== preset.prijsEur)}`;

  return (
    <div className="invoer">
      {/* Een keuze tussen twee gemeten profielen, geen aan-uitschakelaar: beide
          kanten hebben een naam, en de hint zegt waar de data vandaan komt. */}
      <div className="invoer-keuze">
        <div className="segment" role="group" aria-label="Zonnepanelen">
          <button
            type="button"
            aria-pressed={zonnepanelen}
            className={zonnepanelen ? "segment-knop actief" : "segment-knop"}
            onClick={() => onZonnepanelen?.(true)}
          >
            Met zonnepanelen
          </button>
          <button
            type="button"
            aria-pressed={!zonnepanelen}
            className={!zonnepanelen ? "segment-knop actief" : "segment-knop"}
            onClick={() => onZonnepanelen?.(false)}
          >
            Zonder zonnepanelen
          </button>
        </div>
        <p className="invoer-keuze-hint">
          {zonnepanelen
            ? "Gerekend met het gemeten gemiddelde kwartierpatroon van alle kleinverbruikers met teruglevering in je netgebied (MFFBAS), geschaald naar jouw jaartotalen. Geen meting van één huishouden."
            : "Gerekend met het gemeten gemiddelde kwartierpatroon van alle kleinverbruikers zonder teruglevering in je netgebied (MFFBAS), geschaald naar jouw jaarafname. Geen meting van één huishouden."}
        </p>
        <p className="invoer-keuze-hint">
          Gerekend met een dynamisch energiecontract: je betaalt per uur de
          marktprijs. Wat dat betekent en wat je zonder salderen krijgt voor
          teruglevering, staat bij het antwoord.
        </p>
      </div>
      <div className="invoer-velden">
        <Veld
          label="Hoeveel stroom neem je per jaar van het net af?"
          hint="Staat op je jaarafrekening onder 'verbruik' of 'geleverd'. Staan er een normaal- en een daltarief? Tel ze dan op."
          hintId="afname-hint"
        >
          {/* Klemt pas bij het verlaten van het veld (components/GetalInvoer.tsx):
              een leeg veld is "nog niet ingevuld", niet 0. */}
          <GetalInvoer
            waarde={afnameKwh}
            min={GRENZEN.afnameKwh.min}
            max={GRENZEN.afnameKwh.max}
            decimalen={GRENZEN.afnameKwh.decimalen}
            eenheid="kWh"
            onWaarde={(v) => v !== null && onAfname(v)}
            aria-describedby="afname-hint"
          />
        </Veld>

        {zonnepanelen ? (
        <Veld
          label="Hoeveel lever je per jaar terug?"
          hint="Staat op je jaarafrekening onder 'teruglevering' of 'ingevoed'. Staan er een normaal- en een daltarief? Tel ze dan op."
          hintId="teruglevering-hint"
        >
          <GetalInvoer
            waarde={terugleveringKwh}
            min={GRENZEN.terugleveringKwh.min}
            max={GRENZEN.terugleveringKwh.max}
            decimalen={GRENZEN.terugleveringKwh.decimalen}
            eenheid="kWh"
            onWaarde={(v) => v !== null && onTeruglevering(v)}
            aria-describedby="teruglevering-hint"
          />
        </Veld>
        ) : null}

        <Veld label="Welke batterij?" hint={batterijHint}>
          <select value={presetId} onChange={(e) => onPreset(e.target.value)}>
            {perMerk().map((g) => (
              <optgroup key={g.merk} label={g.bijAnwb ? `${g.merk} · bij ANWB` : g.merk}>
                {g.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.naam}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Veld>
      </div>
      <p className="invoer-keuze-hint">
        Capaciteit (kWh) is hoeveel stroom erin past; vermogen (kW) is hoe snel hij laadt en
        levert.
      </p>

      {/* De twee strategiekeuzes, hier bij de batterij in plaats van diep in de
          geavanceerde instellingen: waar de batterij op stuurt, en hoe zuinig hij
          met zijn beurten is. Elke knop draagt zijn eigen uitleg als tooltip; de
          regel eronder zegt wat de gekozen stand in centen betekent. */}
      {onDoel ? (
        <div className="invoer-keuze">
          <span className="veld-label">Waar stuurt de batterij op?</span>
          <div className="segment" role="group" aria-label="Doel van de batterij">
            {DOELEN.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={doel === d.id}
                title={d.kort}
                className={doel === d.id ? "segment-knop actief" : "segment-knop"}
                onClick={() => onDoel(d.id)}
              >
                {d.naam}
              </button>
            ))}
          </div>
          <p className="invoer-keuze-hint">{doelInfo(doel).kort}</p>
        </div>
      ) : null}
      {onSlijtageDeel !== undefined && slijtageDeel !== undefined ? (
        <div className="invoer-keuze">
          <span className="veld-label">Hoe zuinig met de laadbeurten?</span>
          <div className="segment" role="group" aria-label="Slijtagestrategie">
            {STRATEGIEEN.map((st) => {
              return (
                <button
                  key={st.id}
                  type="button"
                  aria-pressed={strategieVoor(slijtageDeel)?.id === st.id}
                  title={`${slijtageHint(st.deel)} ${slijtageVoorbeeld(st.deel, slijtageprijsEur, rondgang)}`}
                  className={strategieVoor(slijtageDeel)?.id === st.id ? "segment-knop actief" : "segment-knop"}
                  onClick={() => onSlijtageDeel(st.deel)}
                >
                  {st.naam}
                </button>
              );
            })}
          </div>
          <p className="invoer-keuze-hint">{slijtageHint(slijtageDeel)}</p>
        </div>
      ) : null}

      {/* De knop staat bij de velden, niet acht secties lager: wie zijn eigen
          getallen intikt moet daar zien dat er nog gerekend moet worden. */}
      <div className="invoer-actie">
        <button
          type="button"
          className={verouderd ? "bereken-knop nadruk" : "bereken-knop"}
          onClick={onBereken}
          disabled={bezig}
        >
          {bezig ? "Bezig met rekenen…" : "Reken door"}
        </button>
        {verouderd ? (
          <p className="invoer-hint" role="status">
            Je invoer is gewijzigd. Het antwoord hieronder hoort nog bij je
            vorige invoer.
          </p>
        ) : null}
      </div>

      {/* De instellingen staan onderaan, zodat de hoofdstroom van de pagina
          schoon blijft. Wie wil bijstellen is vanaf hier één klik verwijderd. */}
      <p className="invoer-sprong">
        <a href="#instellingen">Meer instellingen ↓</a>
      </p>

      {waarschuwingen.length > 0 ? (
        <ul className="waarschuwingen" role="status">
          {waarschuwingen.map((w) => (
            <li key={w.tekst} className={w.ernst}>
              {w.tekst}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export { kwh };
