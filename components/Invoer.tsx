"use client";

/**
 * De instap: drie vragen, en ze staan alle drie op de jaarafrekening.
 *
 * Afname en teruglevering zijn niet alleen de simpelste vraag, ze zijn ook
 * precies de twee schaalfactoren die het model nodig heeft. Daardoor hoeft er
 * niets aangenomen te worden over oriëntatie, instraling of zelfconsumptie: dat
 * zit al in het gemeten profiel.
 */

import type { ReactNode } from "react";
import { PRESETS, type BatteryPreset } from "../lib/presets";
import { euro, getal, kwh } from "../lib/format";

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

  if (terugleveringKwh <= 0) {
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
  presetId,
  onAfname,
  onTeruglevering,
  onPreset,
  onBereken,
  verouderd,
  bezig,
}: {
  afnameKwh: number;
  terugleveringKwh: number;
  presetId: string;
  onAfname: (v: number) => void;
  onTeruglevering: (v: number) => void;
  onPreset: (id: string) => void;
  /** Reken door met de huidige invoer. */
  onBereken: () => void;
  /** De invoer is gewijzigd sinds de getoonde uitkomst. */
  verouderd: boolean;
  bezig: boolean;
}) {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;
  const waarschuwingen = controleerInvoer(afnameKwh, terugleveringKwh, preset);

  return (
    <div className="invoer">
      <div className="invoer-velden">
        <Veld
          label="Hoeveel stroom neem je per jaar van het net af?"
          hint="Staat op je jaarafrekening onder 'verbruik' of 'geleverd'."
          hintId="afname-hint"
        >
          <div className="getal-veld">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={30000}
              step={50}
              value={afnameKwh}
              onChange={(e) => onAfname(Math.max(0, Number(e.target.value)))}
              aria-describedby="afname-hint"
            />
            <span className="eenheid">kWh</span>
          </div>
        </Veld>

        <Veld
          label="Hoeveel lever je per jaar terug?"
          hint="Staat op je jaarafrekening onder 'teruglevering' of 'ingevoed'."
          hintId="teruglevering-hint"
        >
          <div className="getal-veld">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={30000}
              step={50}
              value={terugleveringKwh}
              onChange={(e) => onTeruglevering(Math.max(0, Number(e.target.value)))}
              aria-describedby="teruglevering-hint"
            />
            <span className="eenheid">kWh</span>
          </div>
        </Veld>

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
