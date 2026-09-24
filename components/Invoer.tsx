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
import { PRESETS, type BatteryPreset } from "../lib/presets";
import { DOELEN, doelInfo } from "../lib/model/doel";
import type { Doel } from "../lib/model/types";
import { STRATEGIEEN, strategieVoor } from "../lib/strategie";
import { centPerKwh, euro, getal, kwh, procent } from "../lib/format";
import { GRENZEN } from "../lib/normaliseer";
import { GetalInvoer } from "./GetalInvoer";

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
  if (preset.capaciteitKwh > dagverbruik * 3 && dagverbruik > 0) {
    uit.push({
      ernst: "info",
      tekst: `Deze batterij (${getal(preset.capaciteitKwh, 2)} kWh) is groot ten opzichte van je ` +
        `dagelijkse afname van ongeveer ${getal(dagverbruik, 1)} kWh. Hij zal zelden vollopen.`,
    });
  }

  if (preset.vermogenKw > 5) {
    uit.push({
      ernst: "info",
      tekst: "Bij dit vermogen kan een gewone 1-fase aansluiting knellen. Controleer wat jouw " +
        "aansluiting aankan.",
    });
  }

  return uit;
}

/**
 * Wat de gekozen slijtagestrategie in centen betekent, met een rekenvoorbeeld:
 * bij inkoop tegen 20 ct moet de verkoop- of vermeden prijs minstens het
 * omzettingsverlies plus de drempel hoger liggen voordat een beurt doorgaat.
 */
export function slijtageHint(deel: number, slijtageprijsEur: number, rondgang: number): string {
  const st = strategieVoor(deel);
  const drempel = slijtageprijsEur * deel;
  const inkoop = 0.2;
  const verlies = rondgang > 0 ? inkoop / rondgang - inkoop : 0;
  const naam = st ? st.naam : `Eigen stand (${procent(deel)})`;
  if (slijtageprijsEur <= 0) return `${naam}: de planner rekent ${procent(deel)} van de slijtageprijs als drempel per geleverde kWh.`;
  return (
    `${naam}: de planner rekent ${procent(deel)} van de slijtageprijs van ${centPerKwh(slijtageprijsEur)} mee, ` +
    `dus ${centPerKwh(drempel)} per geleverde kWh. Bij inkoop tegen ${centPerKwh(inkoop)} gaat een beurt door als de stroom ` +
    `later minstens ${centPerKwh(inkoop + verlies + drempel)} waard is: ${centPerKwh(verlies)} omzettingsverlies plus de drempel.`
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
  onAfname,
  onTeruglevering,
  onZonnepanelen,
  onPreset,
  doel = "rendement",
  onDoel,
  slijtageDeel,
  onSlijtageDeel,
  slijtageprijsEur = 0,
  rondgang = 0.88,
  onBereken,
  verouderd,
  bezig,
}: {
  afnameKwh: number;
  terugleveringKwh: number;
  /** Met (standaard) of zonder zonnepanelen; kiest het gemeten profiel. */
  zonnepanelen?: boolean;
  presetId: string;
  onAfname: (v: number) => void;
  onTeruglevering: (v: number) => void;
  onZonnepanelen?: (v: boolean) => void;
  onPreset: (id: string) => void;
  /** Waar de planner op stuurt; zie lib/model/doel.ts. */
  doel?: Doel;
  onDoel?: (d: Doel) => void;
  /** Deel van de slijtageprijs dat de planner meerekent; zie lib/strategie.ts. */
  slijtageDeel?: number;
  onSlijtageDeel?: (deel: number) => void;
  /** Volle slijtageprijs per geleverde kWh van de gekozen batterij, euro; voor de uitleg in centen. */
  slijtageprijsEur?: number;
  /** Rondgangsrendement van de batterij, 0–1; voor het minimale prijsverschil in de uitleg. */
  rondgang?: number;
  /** Reken door met de huidige invoer. */
  onBereken: () => void;
  /** De invoer is gewijzigd sinds de getoonde uitkomst. */
  verouderd: boolean;
  bezig: boolean;
}) {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;
  const waarschuwingen = controleerInvoer(afnameKwh, terugleveringKwh, preset, zonnepanelen);

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
          Gerekend met een dynamisch energiecontract; wat dat betekent staat
          bij het antwoord.
        </p>
      </div>
      <div className="invoer-velden">
        <Veld
          label="Hoeveel stroom neem je per jaar van het net af?"
          hint="Staat op je jaarafrekening onder 'verbruik' of 'geleverd'. Staan er een normaal- en een daltarief? Tel ze dan op."
          hintId="afname-hint"
        >
          <div className="getal-veld">
            {/* Klemt pas bij het verlaten van het veld (components/GetalInvoer.tsx):
                een leeg veld is "nog niet ingevuld", niet 0. */}
            <GetalInvoer
              waarde={afnameKwh}
              min={GRENZEN.afnameKwh.min}
              max={GRENZEN.afnameKwh.max}
              decimalen={GRENZEN.afnameKwh.decimalen}
              onWaarde={(v) => v !== null && onAfname(v)}
              aria-describedby="afname-hint"
            />
            <span className="eenheid">kWh</span>
          </div>
        </Veld>

        {zonnepanelen ? (
        <Veld
          label="Hoeveel lever je per jaar terug?"
          hint="Staat op je jaarafrekening onder 'teruglevering' of 'ingevoed'. Staan er een normaal- en een daltarief? Tel ze dan op."
          hintId="teruglevering-hint"
        >
          <div className="getal-veld">
            <GetalInvoer
              waarde={terugleveringKwh}
              min={GRENZEN.terugleveringKwh.min}
              max={GRENZEN.terugleveringKwh.max}
              decimalen={GRENZEN.terugleveringKwh.decimalen}
              onWaarde={(v) => v !== null && onTeruglevering(v)}
              aria-describedby="teruglevering-hint"
            />
            <span className="eenheid">kWh</span>
          </div>
        </Veld>
        ) : null}

        <Veld label="Welke batterij?" hint={`${getal(preset.capaciteitKwh, 2)} kWh · ${getal(preset.vermogenKw, 1)} kW · ${euro(preset.prijsEur)}`}>
          <select value={presetId} onChange={(e) => onPreset(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.naam}
              </option>
            ))}
          </select>
        </Veld>
      </div>

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
              const drempel = slijtageprijsEur * st.deel;
              return (
                <button
                  key={st.id}
                  type="button"
                  aria-pressed={strategieVoor(slijtageDeel)?.id === st.id}
                  title={`${st.naam}: ${procent(st.deel)} van de slijtageprijs (${centPerKwh(drempel)} per geleverde kWh) als drempel. ${st.kort}`}
                  className={strategieVoor(slijtageDeel)?.id === st.id ? "segment-knop actief" : "segment-knop"}
                  onClick={() => onSlijtageDeel(st.deel)}
                >
                  {st.naam}
                </button>
              );
            })}
          </div>
          <p className="invoer-keuze-hint">{slijtageHint(slijtageDeel, slijtageprijsEur, rondgang)}</p>
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
