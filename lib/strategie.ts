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
 * De literatuur (Xu e.a. 2018, Schade en Egging-Bratseth 2024, The Mobility House) is het erover
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
    // Heette "Maximaal rendement", maar sinds er een apart doel "Rendement"
    // is (lib/model/doel.ts) zou dat twee keer hetzelfde woord voor twee
    // verschillende keuzes zijn.
    naam: "Volop",
    deel: 0.2,
    kort: "Een beurt telt voor een vijfde (20%) van de slijtageprijs. Veel thuisbatterijen gaan eerder door ouderdom dan door hun laadbeurten achteruit, en dan kost een extra beurt weinig levensduur. De meeste beurten en de hoogste jaaropbrengst.",
  },
];

/**
 * De standaardstand: alleen het capaciteitsverlies dat er toch komt.
 *
 * Stond eerst op 1 — elke beurt moest zijn eigen slijtage tegen de volle
 * aanschafprijs terugverdienen. Dat is de voorzichtige keuze, maar voor de
 * batterijen in deze catalogus is het de verkeerde: zes duizend beurten over
 * vijftien kalenderjaren is vierhonderd per jaar, en zelfs zónder drempel komt
 * de accu niet verder dan 411. De beurten zijn dus niet het schaarse goed, de
 * kalender is dat. Elke beurt die de drempel dan tegenhoudt, is opbrengst die
 * je laat liggen en nooit meer inhaalt.
 *
 * Doorgerekend op vier jaar echte prijzen, Zendure 800 Pro 2 van EUR 699:
 *
 *   deel 1,0   EUR 111,67 per jaar   278 beurten   contante waarde EUR 533
 *   deel 0,5   EUR 115,57            312                          EUR 576
 *   deel 0,2   EUR 118,74            361                          EUR 610
 *   deel 0,0   EUR 120,09            411                          EUR 624
 *
 * Waarom dan 0,2 en niet 0? Omdat 0 betekent dat een beurt gratis is, en dat is
 * ze nooit: de cellen verliezen hoe dan ook capaciteit door doorzet. Twintig
 * procent is precies het capaciteitsverlies dat het model over de levensduur
 * aan de beurten toerekent (lineair naar 80%), dus het is de ondergrens die
 * nog ergens op slaat. De laatste stap van 0,2 naar 0 levert ook maar EUR 14
 * contante waarde op tegenover vijftig extra beurten per jaar.
 *
 * ── Waarom 0,2 ook veilig is ────────────────────────────────────────────────
 * Het model kent geen vervangingsmoment: de capaciteit zakt lineair door onder
 * de 80% en er komt nooit een nieuwe accu. Dat zou een te lage drempel kunnen
 * belonen — maar hier gebeurt dat niet, want de beurten raken niet op:
 *
 *   deel 1,0   278 per jaar   3.833 van 6.000 in vijftien jaar   64%
 *   deel 0,5   312            4.294                              72%
 *   deel 0,2   361            4.965                              83%
 *   deel 0,0   411            5.643                              94%
 *
 * Op 0,2 blijft er ruim een zesde van de beurten over. De soepelheid van het
 * financieringsmodel wordt dus nergens uitgebuit; er is niets om uit te buiten.
 * Op 0,0 wordt die marge wél krap, en dat is de tweede reden om daar niet te
 * gaan zitten.
 *
 * Voor een accu die zijn beurten wél opmaakt binnen de looptijd — meer
 * capaciteit, minder beurten, of zwaarder gebruik — mist het model de klif van
 * een vervanging, en is "Zuinig" de veiliger stand. Die staat er daarom nog.
 */
export const STANDAARD_SLIJTAGEDEEL = 0.2;

/** Welke stand bij dit deel hoort, of null als het een eigen waarde is. */
export function strategieVoor(deel: number): Strategie | null {
  return STRATEGIEEN.find((s) => Math.abs(s.deel - deel) < 1e-9) ?? null;
}
