"use client";

/**
 * Een getalveld dat je rustig kunt intikken.
 *
 * De velden klemden eerder bij elke toetsaanslag op hun grenzen. Wie "1500"
 * als aanschafprijs wilde intikken, zag na de "1" het minimum van 100 staan en
 * kwam uit op 20.000; een looptijd van "12" werd 25, en "2.5" kWh werd 0,55.
 * Een leeg veld werd 0, zodat de volgende cijfers erachter kwamen: "03500".
 *
 * Nu houdt het veld zijn eigen tekst zolang je typt, en pas bij het verlaten
 * van het veld of een Enter wordt die tekst een getal: afgerond, binnen de
 * grenzen, en doorgegeven als hij anders is dan wat er stond. Een komma is
 * een decimaalteken, zoals je het in het Nederlands schrijft. Een leeg veld
 * betekent "nog niet ingevuld": bij een veld dat leeg mag zijn (de waarde van
 * de batterij, een onbekende opwek) wordt dat null, anders blijft de vorige
 * waarde staan. Escape zet het veld terug.
 *
 * Wat het veld bij het verlaten corrigeert, gebeurt niet stil: onder het veld
 * staat een korte regel ("Dat is geen getal; we houden 3.201.", "Het maximum is
 * 30.000; aangepast."), gekoppeld met aria-describedby. Ze verdwijnt zodra je
 * iets geldigs intikt, of als de waarde van buiten verandert.
 */

import { useId, useState, type InputHTMLAttributes } from "react";

/** Een getal zoals een mens het intikt: met punt of komma, zonder duizendtallen. */
const GETAL = /^-?\d*(?:\.\d*)?$/;

/** Nederlandse duizendtallen: één tot drie cijfers (niet met een 0 beginnend), dan groepen van precies drie. */
const DUIZENDTALLEN = /^-?[1-9]\d{0,2}(?:\.\d{3})+$/;

/**
 * Lees ingetikte tekst als getal; null als het leeg is, NaN als het geen getal is.
 *
 * Een komma is het decimaalteken en een punt ervoor een duizendtalscheiding
 * ("1.234,5" is 1234,5). Een punt zonder komma is meestal decimaal ("2.5"),
 * behalve als er alleen groepen van precies drie cijfers achter staan én het
 * veld geen decimalen kent ("3.500" is 3500 in een veld voor kWh of euro's),
 * of als er meer dan één punt in staat ("1.000.000"). `decimalen` is het aantal
 * decimalen van het veld; zonder is een enkele punt decimaal.
 */
export function leesGetal(tekst: string, decimalen?: number): number | null {
  const schoon = tekst.trim().replace(/\s+/g, "");
  if (schoon === "") return null;
  if (!/\d/.test(schoon)) return Number.NaN;

  const delen = schoon.split(",");
  if (delen.length > 2) return Number.NaN;
  if (delen.length === 2) {
    let heel = delen[0]!;
    const na = delen[1]!;
    if (heel.includes(".")) {
      if (!DUIZENDTALLEN.test(heel)) return Number.NaN;
      heel = heel.replace(/\./g, "");
    }
    if (!/^-?\d*$/.test(heel) || !/^\d*$/.test(na)) return Number.NaN;
    return Number(`${heel}.${na}`);
  }

  if (DUIZENDTALLEN.test(schoon)) {
    const punten = schoon.split(".").length - 1;
    if (punten > 1 || decimalen === 0) return Number(schoon.replace(/\./g, ""));
  }
  if (!GETAL.test(schoon)) return Number.NaN;
  return Number(schoon);
}

/** Een getal zoals het veld het toont: decimale komma, geen duizendtallen. */
export function toonGetal(waarde: number, decimalen: number): string {
  const f = 10 ** decimalen;
  return String(Math.round(waarde * f) / f).replace(".", ",");
}

/** Een getal voor in een melding: Nederlandse duizendtallen, hoogstens `decimalen` decimalen. */
function meldGetal(v: number, decimalen: number): string {
  return v.toLocaleString("nl-NL", { maximumFractionDigits: Math.max(0, decimalen) });
}

/** Een melding hoort bij de waarde waarmee het veld er na de correctie uitzag. */
interface Melding {
  tekst: string;
  bij: number | null;
}

type Eigen = {
  waarde: number | null;
  min: number;
  max: number;
  /** Op hoeveel decimalen de waarde wordt afgerond. */
  decimalen: number;
  /** Mag het veld leeg: dan geeft het null door in plaats van de vorige waarde te houden. */
  magLeeg?: boolean;
  onWaarde: (v: number | null) => void;
  /** De eenheid naast het getal ("kWh", "€"); zonder eenheid staat er alleen het getal. */
  eenheid?: string;
  /** Zet de eenheid vóór het getal, zoals bij een bedrag. */
  eenheidVoor?: boolean;
  /** Een smaller veld, voor de instellingen. */
  klein?: boolean;
};

export function GetalInvoer({
  waarde,
  min,
  max,
  decimalen,
  magLeeg = false,
  onWaarde,
  eenheid,
  eenheidVoor = false,
  klein = false,
  ...rest
}: Eigen & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "type">) {
  /** De tekst terwijl je typt; null als het veld de waarde gewoon toont. */
  const [tekst, setTekst] = useState<string | null>(null);
  const [melding, setMelding] = useState<Melding | null>(null);
  const meldingId = useId();
  const getoond = waarde === null || !Number.isFinite(waarde) ? "" : toonGetal(waarde, decimalen);
  const houden = waarde === null || !Number.isFinite(waarde) ? null : meldGetal(waarde, decimalen);

  const legVast = () => {
    if (tekst === null) return;
    setTekst(null);
    // Niets veranderd: het veld verlaten is geen invoer. Anders legt een
    // afgeleide waarde (een prijs uit de kostenregel, met centen) zich vast
    // als eigen keuze zodra je erdoorheen tabt.
    if (tekst === getoond) return;
    const n = leesGetal(tekst, decimalen);
    if (n === null) {
      if (magLeeg) {
        setMelding(null);
        if (waarde !== null) onWaarde(null);
      } else if (houden !== null) {
        setMelding({ tekst: `Dit veld mag niet leeg blijven; we houden ${houden}.`, bij: waarde });
      }
      return;
    }
    if (Number.isNaN(n)) {
      // Onleesbaar: terug naar wat er stond, en zeggen dat we dat deden.
      setMelding({
        tekst: houden === null ? "Dat is geen getal; het veld blijft leeg." : `Dat is geen getal; we houden ${houden}.`,
        bij: waarde,
      });
      return;
    }
    const f = 10 ** decimalen;
    const schoon = Number((Math.round(Math.min(max, Math.max(min, n)) * f) / f).toFixed(decimalen));
    if (n > max) setMelding({ tekst: `Het maximum is ${meldGetal(max, decimalen)}; aangepast.`, bij: schoon });
    else if (n < min) setMelding({ tekst: `Het minimum is ${meldGetal(min, decimalen)}; aangepast.`, bij: schoon });
    else setMelding(null);
    if (schoon !== waarde) onWaarde(schoon);
  };

  const huidig = tekst ?? getoond;
  const ongeldig = tekst !== null && Number.isNaN(leesGetal(tekst, decimalen));
  // Een melding over een waarde die er niet meer staat (het veld is van buiten
  // gereset) hoort er niet meer bij.
  const zichtbaar = melding && Object.is(melding.bij, waarde) ? melding.tekst : null;
  const beschrijving = [rest["aria-describedby"], zichtbaar ? meldingId : undefined].filter(Boolean).join(" ");

  const eenheidSpan = eenheid ? <span className="eenheid">{eenheid}</span> : null;

  return (
    <>
      <div className={["getal-veld", klein && "klein", eenheidVoor && "eenheid-voor"].filter(Boolean).join(" ")}>
        {eenheidVoor ? eenheidSpan : null}
        <input
          {...rest}
          type="text"
          inputMode={decimalen > 0 || min < 0 ? "decimal" : "numeric"}
          autoComplete="off"
          value={huidig}
          aria-invalid={ongeldig || undefined}
          aria-describedby={beschrijving || undefined}
          onFocus={(e) => {
            setTekst(getoond);
            rest.onFocus?.(e);
          }}
          onChange={(e) => {
            setTekst(e.target.value);
            // Zodra wat je intikt weer een getal is, is de vorige melding achterhaald.
            if (!Number.isNaN(leesGetal(e.target.value, decimalen))) setMelding(null);
          }}
          onBlur={(e) => {
            legVast();
            rest.onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") legVast();
            else if (e.key === "Escape") {
              setTekst(null);
              setMelding(null);
            }
            rest.onKeyDown?.(e);
          }}
        />
        {!eenheidVoor ? eenheidSpan : null}
      </div>
      {zichtbaar ? (
        <span id={meldingId} className="invoer-hint getal-melding" role="status">
          {zichtbaar}
        </span>
      ) : null}
    </>
  );
}
