/**
 * Hoe zuinig de planner met de laadbeurten omgaat.
 *
 * De planner rekent per geleverde kWh een schaduwprijs voor slijtage. De volle
 * slijtageprijs is `aanschaf ÷ (beurten × bruikbaar × rendement)`: wat een kWh
 * van de aanschaf opsoupeert als de batterij aan zijn beurten sterft. Maar een
 * thuisbatterij sterft vaak eerder aan ouderdom dan aan doorzet — met 300
 * beurten per jaar is 6.000 beurten pas na twintig jaar op, terwijl de
 * kalender op vijftien staat. Dan kost een extra beurt in werkelijkheid minder
 * dan de volle prijs, en laat een planner die de volle prijs rekent geld liggen.
 *
 * De literatuur (Xu e.a. 2018, Schade 2024, The Mobility House) is het erover
 * eens dat de juiste drempel de MARGINALE slijtage is: wat één beurt extra
 * werkelijk aan levensduur kost. Die hangt af van de vraag of de beurten
 * opraken vóór de kalender, en dat weet je pas achteraf. Daarom is dit een
 * instelling met drie herkenbare standen, uitgedrukt als deel van de volle
 * slijtageprijs dat de planner meerekent.
 */

export type StrategieId = "zuinig" | "gebalanceerd" | "maximaal";

export interface Strategie {
  id: StrategieId;
  naam: string;
  /** Deel van de volle slijtageprijs dat de planner per geleverde kWh rekent. */
  deel: number;
  /** Eén zin over wat de stand doet. */
  kort: string;
}

export const STRATEGIEEN: readonly Strategie[] = [
  {
    id: "zuinig",
    naam: "Zuinig",
    deel: 1,
    kort: "Elke beurt moet zijn eigen slijtage tegen de aanschafprijs terugverdienen. De minste beurten, de langste levensduur, de laagste jaaropbrengst.",
  },
  {
    id: "gebalanceerd",
    naam: "Gebalanceerd",
    deel: 0.5,
    kort: "Een beurt telt voor de helft van de aanschafprijs. Handelt op de duidelijke prijsverschillen en laat de krappe dagen liggen.",
  },
  {
    id: "maximaal",
    naam: "Maximaal rendement",
    deel: 0.2,
    kort: "Alleen het capaciteitsverlies dat er over de levensduur toch komt (20%) telt. De meeste beurten en de hoogste jaaropbrengst; de batterij sterft aan ouderdom met beurten over.",
  },
];

/** De standaardstand: elke beurt betaalt zichzelf terug. */
export const STANDAARD_SLIJTAGEDEEL = 1;

/** Welke stand bij dit deel hoort, of null als het een eigen waarde is. */
export function strategieVoor(deel: number): Strategie | null {
  return STRATEGIEEN.find((s) => Math.abs(s.deel - deel) < 1e-9) ?? null;
}
