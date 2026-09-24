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
 */

import { useState, type InputHTMLAttributes } from "react";

/** Een getal zoals een mens het intikt: met punt of komma, zonder duizendtallen. */
const GETAL = /^-?\d*(?:[.,]\d*)?$/;

/** Lees ingetikte tekst als getal; null als het leeg is, NaN als het geen getal is. */
export function leesGetal(tekst: string): number | null {
  const schoon = tekst.trim().replace(/\s+/g, "");
  if (schoon === "") return null;
  if (!GETAL.test(schoon) || !/\d/.test(schoon)) return Number.NaN;
  return Number(schoon.replace(",", "."));
}

/** Een getal zoals het veld het toont: decimale komma, geen duizendtallen. */
export function toonGetal(waarde: number, decimalen: number): string {
  const f = 10 ** decimalen;
  return String(Math.round(waarde * f) / f).replace(".", ",");
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
};

export function GetalInvoer({
  waarde,
  min,
  max,
  decimalen,
  magLeeg = false,
  onWaarde,
  ...rest
}: Eigen & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "type">) {
  /** De tekst terwijl je typt; null als het veld de waarde gewoon toont. */
  const [tekst, setTekst] = useState<string | null>(null);
  const getoond = waarde === null || !Number.isFinite(waarde) ? "" : toonGetal(waarde, decimalen);

  const legVast = () => {
    if (tekst === null) return;
    const n = leesGetal(tekst);
    setTekst(null);
    if (n === null) {
      if (magLeeg && waarde !== null) onWaarde(null);
      return;
    }
    if (Number.isNaN(n)) return; // onleesbaar: terug naar wat er stond
    const f = 10 ** decimalen;
    const schoon = Number((Math.round(Math.min(max, Math.max(min, n)) * f) / f).toFixed(decimalen));
    if (schoon !== waarde) onWaarde(schoon);
  };

  const huidig = tekst ?? getoond;
  const ongeldig = tekst !== null && Number.isNaN(leesGetal(tekst));

  return (
    <input
      {...rest}
      type="text"
      inputMode={decimalen > 0 || min < 0 ? "decimal" : "numeric"}
      autoComplete="off"
      value={huidig}
      aria-invalid={ongeldig || undefined}
      onFocus={(e) => {
        setTekst(getoond);
        rest.onFocus?.(e);
      }}
      onChange={(e) => setTekst(e.target.value)}
      onBlur={(e) => {
        legVast();
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") legVast();
        else if (e.key === "Escape") setTekst(null);
        rest.onKeyDown?.(e);
      }}
    />
  );
}
