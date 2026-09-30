"use client";

/**
 * Welke batterijmaat loont?
 *
 * Een raster van capaciteit tegen vermogen, gekleurd naar wat elke maat netto
 * oplevert over de looptijd. Elke cel is één doorrekening van een jaar; de
 * investering per cel komt uit de kostenregel (lib/model/kosten.ts), de rest
 * uit dezelfde financiële doorrekening als het antwoord bovenaan
 * (lib/model/dimensionering.ts).
 *
 * ── Waarom netto resultaat voorop ───────────────────────────────────────────
 * Op besparing wint de grootste batterij altijd, en dat is misleidend: de
 * aanschafprijs loopt mee omhoog. De eerdere weergaven "per kWh" en "per kW"
 * waren een omweg om dat zichtbaar te maken zonder de prijs te kennen. Nu de
 * kaart wél weet wat elke maat kost, is de vraag direct te beantwoorden: wat
 * blijft er over. Terugverdientijd en jaarbesparing blijven als schakelaars.
 *
 * De streep tussen 0,8 en 1,2 kW is de grens tussen een stekkerbatterij en een
 * batterij met een eigen groep: daar komt een installateur bij, en die zit in
 * de prijs van elke cel rechts van de streep.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { GridState } from "../lib/useAnalysis";
import type { Configuration, GridPoint } from "../lib/worker/protocol";
import type { SavingCurvePoint } from "../lib/model/finance";
import { rasterGrondslag, advies, rasterFinance, type CelFinance, type RasterNiveau } from "../lib/model/dimensionering";
import { STEKKER_GRENS_KW, isVasteAansluiting, kostenregelVan } from "../lib/model/kosten";
import { euro, getal, jaren, procent } from "../lib/format";
import { Figure, ScrollKader, TipLaag, useTip, type TipInhoud } from "./chart-parts";

type Weergave = "ncw" | "tvt" | "besparing";

interface Modus {
  /** Wat er op de schakelknop staat. */
  knop: string;
  /** De grootheid die het vakje toont; null als die er niet is (nooit terugverdiend). */
  waarde: (c: CelFinance) => number | null;
  /** Het getal in het vakje: kort, want de ruimte is krap. */
  cel: (n: number | null) => string;
  /** Hetzelfde bedrag in lopende tekst, met eenheid. */
  bedrag: (n: number | null) => string;
  /** Hoger is beter (netto, besparing) of lager is beter (terugverdientijd). */
  hoogIsGoed: boolean;
  eenheid: string;
}

/**
 * Eén vaste decimaal, ook bij een rond getal.
 *
 * `getal(n, 1)` laat een nul weg, en dan staat "6" naast "6,8" en zakken de
 * kolommen uit elkaar. In een raster van tweeënveertig getallen die je met
 * elkaar vergelijkt, telt die uitlijning.
 */
const eenDecimaal = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Een heel bedrag met teken, zonder euroteken: "+1.234" of "−321". */
function netto(n: number): string {
  const r = Math.round(n);
  return r < 0 ? `−${getal(-r)}` : `+${getal(r)}`;
}

const MODI: Record<Weergave, Modus> = {
  ncw: {
    knop: "Netto resultaat",
    waarde: (c) => c.npvEur,
    cel: (n) => (n === null ? "—" : netto(n)),
    bedrag: (n) => (n === null ? "—" : `${euro(n)} netto`),
    hoogIsGoed: true,
    eenheid: "netto over de looptijd",
  },
  tvt: {
    knop: "Terugverdientijd",
    waarde: (c) => c.paybackYears,
    cel: (n) => (n === null ? "—" : eenDecimaal.format(n)),
    bedrag: (n) => (n === null ? "niet terugverdiend binnen de looptijd" : `terugverdiend na ${jaren(n)}`),
    hoogIsGoed: false,
    eenheid: "jaar tot de aanschaf terug is",
  },
  besparing: {
    knop: "Besparing per jaar",
    waarde: (c) => c.besparingEur,
    cel: (n) => (n === null ? "—" : String(Math.round(n))),
    bedrag: (n) => (n === null ? "—" : `${euro(n)} per jaar`),
    hoogIsGoed: true,
    eenheid: "besparing per jaar",
  },
};

/** Wat er in de kaart staat als je een vakje aanwijst. */
function tipVoor(
  cap: number,
  kw: number,
  fin: CelFinance,
  isBeste: boolean,
  huidig: "exact" | "dichtbij" | null,
  jaar: number | null,
): TipInhoud {
  return {
    titel: `${getal(cap, 1)} kWh bij ${getal(kw, 1)} kW`,
    regels: [
      { label: "Investering", waarde: euro(fin.investeringEur) },
      { label: "Netto resultaat", waarde: euro(fin.npvEur), uitkomst: true },
      { label: "Terugverdientijd", waarde: jaren(fin.paybackYears) },
      { label: "Besparing per jaar", waarde: euro(fin.besparingEur) },
      { label: "Laadbeurten per jaar", waarde: getal(fin.cyclesPerYear) },
    ],
    noot: huidig === "exact"
      ? "Dit is de batterij die je nu hebt ingesteld."
      : huidig === "dichtbij"
        ? "Dit is de maat die het dichtst bij jouw batterij ligt. Klik om met deze maat door te rekenen."
      : isBeste
        ? "Het hoogste netto resultaat in deze tabel. Klik om hiermee door te rekenen."
        : "Op het niveau van het gemiddelde jaar, herhaald over de looptijd. Klik om met deze maat door te rekenen.",
  };
}

export function BatterijMaat({
  grid,
  huidigeCapaciteit,
  huidigVermogen,
  onKies,
  actie,
  config,
  curve,
  niveau,
  jaar = null,
}: {
  /** Null zolang het raster nog wordt doorgerekend in de achtergrond. */
  grid: GridState | null;
  huidigeCapaciteit: number;
  huidigVermogen: number;
  onKies: (capaciteit: number, vermogen: number) => void;
  /** De knop "Hoe is dit berekend?" in de kop. */
  actie?: ReactNode;
  /** De configuratie van het getoonde resultaat: anker van de kostenregel en de financiële aannames. */
  config: Configuration;
  /** De besparingscurve van de gekozen batterij; elke cel leent er de vorm van. */
  curve: SavingCurvePoint[];
  /** Van het rasterjaar naar het gemiddelde over de volledige jaren (`rasterNiveau`). */
  niveau?: RasterNiveau;
  /** Het jaar waarop het raster rekent, voor de teksten. */
  jaar?: number | null;
}) {
  const [gehoverd, setGehoverd] = useState<{ r: number; k: number } | null>(null);
  const [weergave, setWeergave] = useState<Weergave>("ncw");
  const { kader, tip, toon, wis } = useTip();

  const nb = niveau?.besparing ?? 1;
  const nc = niveau?.cycli ?? 1;
  const fin = useMemo(
    () => (grid ? rasterFinance(grid, config, curve, { besparing: nb, cycli: nc }) : null),
    [grid, config, curve, nb, nc],
  );
  const raad = useMemo(
    () => (grid && grid.klaar ? advies(grid, config, curve, { besparing: nb, cycli: nc }) : null),
    [grid, config, curve, nb, nc],
  );

  if (!grid || !fin) {
    // Het raster draait automatisch in de achtergrond zodra het hoofdantwoord
    // er is; hier staat alleen wat er komt.
    return (
      <Figure
        anker="maat"
        actie={actie}
        titel="Welke maat loont het meest?"
        toelichting={
          <>
            Tweeënveertig combinaties van capaciteit en vermogen, elk een
            volledige doorrekening van een jaar aan kwartierdata, elk met zijn
            eigen prijs. Dat kost een paar seconden en gebeurt op de achtergrond.
          </>
        }
      >
        <p className="raster-wacht">De tabel wordt doorgerekend…</p>
      </Figure>
    );
  }

  const modus = MODI[weergave];
  const regel = kostenregelVan(config);
  const alle = fin.flatMap((r) => r ?? []);
  const waarden = alle.map(modus.waarde).filter((v): v is number => v !== null);
  const min = Math.min(...waarden, 0);
  const max = Math.max(...waarden, Number.MIN_VALUE);

  // Sequentiële schaal over het bereik van de getoonde grootheid: één hue,
  // licht naar donker. Bij terugverdientijd is kort goed, dus keert hij om, en
  // een cel die zich nooit terugverdient krijgt de lichtste stap.
  const STAPPEN = 7;
  const stap = (waarde: number | null): number => {
    if (waarde === null) return 0;
    const t = max > min ? (waarde - min) / (max - min) : 1;
    const u = modus.hoogIsGoed ? t : 1 - t;
    return Math.min(STAPPEN - 1, Math.floor(Math.max(0, Math.min(1, u)) * STAPPEN));
  };

  // Bij het netto resultaat ligt de nul midden in de schaal: plus en min
  // krijgen elk een eigen kleur (teal en oranje), en hoe donkerder, hoe verder
  // van nul. Eén doorlopende schaal maakte "+477" en "−111" bijna even donker
  // en liet alleen het minteken het verschil maken.
  const verdeeld = weergave === "ncw" && min < 0 && max > 0;
  const DEELSTAPPEN = 4;
  const deelStap = (waarde: number | null): string => {
    if (waarde === null) return "stap-0";
    const t = waarde >= 0 ? waarde / max : waarde / min;
    const n = Math.min(DEELSTAPPEN - 1, Math.floor(Math.max(0, Math.min(1, t)) * DEELSTAPPEN));
    return waarde >= 0 ? `winst-${n}` : `verlies-${n}`;
  };

  /** De cel met het hoogste netto resultaat, ongeacht de weergave. */
  const beste = raad?.beste ?? null;
  const isBesteCel = (cap: number, kw: number) =>
    beste !== null && Math.abs(cap - beste.capacityKwh) < 1e-9 && Math.abs(kw - beste.powerKw) < 1e-9;

  // Het vakje van jouw batterij: exact als die maat in de tabel staat, anders
  // het vakje dat er het dichtst bij ligt. Zonder dat laatste zoekt de lezer
  // naar een markering die er niet is.
  let huidigPlek: { r: number; k: number; exact: boolean } | null = null;
  {
    let besteAfstand = Infinity;
    grid.capacities.forEach((cap, r) =>
      grid.powers.forEach((kw, k) => {
        if (!fin[r]?.[k]) return;
        const afstand =
          Math.abs(cap - huidigeCapaciteit) / Math.max(huidigeCapaciteit, 0.1) +
          Math.abs(kw - huidigVermogen) / Math.max(huidigVermogen, 0.1);
        if (afstand < besteAfstand) {
          besteAfstand = afstand;
          huidigPlek = {
            r,
            k,
            exact: Math.abs(cap - huidigeCapaciteit) < 0.05 && Math.abs(kw - huidigVermogen) < 0.05,
          };
        }
      }),
    );
  }

  const actief = gehoverd ? fin[gehoverd.r]?.[gehoverd.k] ?? null : null;
  const actiefPunt: GridPoint | null = gehoverd ? grid.rows[gehoverd.r]?.[gehoverd.k] ?? null : null;

  /** De eerste kolom die een eigen groep vraagt: daar staat de streep. */
  const scheiding = grid.powers.findIndex((kw) => isVasteAansluiting(kw));

  const titel = ((): string => {
    if (!beste || !grid.klaar) return "Welke maat loont het meest?";
    if (weergave === "besparing") return "Meer capaciteit helpt alleen als het vermogen meegroeit";
    if (weergave === "tvt") {
      // De snelst terugverdiende maat, niet de maat met het hoogste netto resultaat.
      let snelst: { cap: number; kw: number; jaren: number } | null = null;
      grid.capacities.forEach((cap, r) =>
        grid.powers.forEach((kw, k) => {
          const j = fin[r]?.[k]?.paybackYears ?? null;
          if (j !== null && (snelst === null || j < snelst.jaren)) snelst = { cap, kw, jaren: j };
        }),
      );
      const s = snelst as { cap: number; kw: number; jaren: number } | null;
      return s
        ? `${getal(s.cap, 1)} kWh bij ${getal(s.kw, 1)} kW is het snelst terugverdiend, na ${jaren(s.jaren)}`
        : "Geen enkele maat is terugverdiend binnen de looptijd";
    }
    return beste.fin.npvEur > 0
      ? `Netto is ${getal(beste.capacityKwh, 1)} kWh bij ${getal(beste.powerKw, 1)} kW de beste maat`
      : "Geen enkele maat komt netto uit de kosten";
  })();

  /**
   * Levert meer vermogen ergens in het raster minder besparing op? Dat gebeurt,
   * en het ziet eruit als een rekenfout. Dat is het niet, maar het verdient
   * uitleg waar de lezer het ziet. Alleen bij de besparing: bij netto resultaat
   * en terugverdientijd is een dip naar rechts gewoon de prijs van het vermogen.
   */
  const vermogenDipt =
    weergave === "besparing" &&
    grid.rows.some((rij) => {
      if (!rij) return false;
      const top = Math.max(...rij.map((p) => p.savingEur));
      // Een halve procent. Daaronder is het discretisatieruis van het SoC-rooster;
      // de echte dip door voorspelfouten is op de kleinste maten zo'n twee procent.
      return rij[rij.length - 1]!.savingEur < top * 0.995;
    });

  // De grondslag hoort in de zin zelf: dit is de hoogste uitkomst in deze
  // doorrekening, geen persoonlijk advies. De maten onderling komen uit één
  // jaar, het niveau uit het gemiddelde (`rasterNiveau`).
  const grondslag = `uurprijzen van ${jaar ?? "het meest recente volledige jaar"} op het niveau van het gemiddelde jaar, belasting en opslag van ${
    config.useHistoricalLevy === false ? "nu" : "toen"
  }`;
  const adviesZin = ((): ReactNode => {
    if (!raad) return null;
    const { beste: b, besteStekker, besteVast, vasteLoont } = raad;
    const plek = (k: { capacityKwh: number; powerKw: number }) =>
      `${getal(k.capacityKwh, 1)} kWh bij ${getal(k.powerKw, 1)} kW`;
    if (b.fin.npvEur <= 0) {
      return (
        <>
          In deze doorrekening ({grondslag}) komt geen enkele maat netto uit de
          kosten; het minst verlies maakt een {isVasteAansluiting(b.powerKw) ? "batterij met eigen groep" : "stekkerbatterij"} van{" "}
          {plek(b)} ({euro(b.fin.npvEur)}).
        </>
      );
    }
    if (vasteLoont && besteVast) {
      return (
        <>
          Hoogste uitkomst in deze doorrekening ({grondslag}): een batterij met
          een eigen groep van {plek(besteVast)}, netto{" "}
          {euro(besteVast.fin.npvEur)} over {config.analysisYears} jaar.
          {besteStekker ? (
            <>
              {" "}
              De eigen groep verdient zich hier terug: de beste stekkerbatterij ({plek(besteStekker)})
              komt op {euro(besteStekker.fin.npvEur)}.
            </>
          ) : null}
        </>
      );
    }
    if (besteStekker) {
      return (
        <>
          Hoogste uitkomst in deze doorrekening ({grondslag}): een
          stekkerbatterij van {plek(besteStekker)}, netto{" "}
          {euro(besteStekker.fin.npvEur)} over {config.analysisYears} jaar.
          {besteVast ? (
            <>
              {" "}
              {/* Op het teken: een eigen groep die netto nog iets oplevert,
                  "loont" wel, alleen minder dan de stekkerbatterij. */}
              {besteVast.fin.npvEur > 0
                ? "Een eigen groep door een installateur geeft hier een lager netto resultaat"
                : "Een eigen groep door een installateur loont hier niet"}
              : de beste maat met meer vermogen ({plek(besteVast)}) komt op{" "}
              {euro(besteVast.fin.npvEur)}.
            </>
          ) : null}
        </>
      );
    }
    return (
      <>
        Hoogste uitkomst in deze doorrekening ({grondslag}): {plek(b)}, netto{" "}
        {euro(b.fin.npvEur)}.
      </>
    );
  })();

  return (
    <Figure
      anker="maat"
      titel={titel}
      toelichting={
        <>
          {weergave === "ncw"
            ? `Euro's over ${config.analysisYears} jaar, na aftrek van de aanschaf en de rente die je misloopt. Een min betekent dat die maat zich niet terugverdient.`
            : weergave === "tvt"
              ? "Na hoeveel jaar elke maat terugverdiend is. Een streepje betekent: niet terugverdiend binnen de looptijd."
              : "De besparing per jaar van elke maat, in euro's."}{" "}
          Elke maat is doorgerekend met jouw verbruik, jouw tarieven en de prijs die bij die maat hoort.{" "}
          {verdeeld
            ? "Blauwgroen is een positief netto resultaat, oranje een negatief; hoe donkerder, hoe groter."
            : "Donkerder is beter."}{" "}
          Klik een vakje om die maat door te rekenen.
          {grid.bezig ? " Nog even geduld, de tabel vult zich." : ""}
        </>
      }
      actie={
        <div className="figure-acties">
          <div className="segment" role="group" aria-label="Wat de tabel toont">
            {(Object.keys(MODI) as Weergave[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={weergave === id}
                className={weergave === id ? "segment-knop actief" : "segment-knop"}
                onClick={() => setWeergave(id)}
              >
                {MODI[id].knop}
              </button>
            ))}
          </div>
          {actie}
        </div>
      }
    >
      {adviesZin ? (
        <p className="advies" role="status">
          {adviesZin}
        </p>
      ) : null}
      <div
        className="chart-hover"
        ref={kader}
        onMouseLeave={() => {
          setGehoverd(null);
          wis();
        }}
      >
        {verdeeld ? (
          <p className="heat-sleutel" aria-hidden="true">
            <span className="heat-sleutel-kop">Negatief</span>
            {["verlies-3", "verlies-2", "verlies-1", "verlies-0", "winst-0", "winst-1", "winst-2", "winst-3"].map((k) => (
              <i key={k} className={`heat-cel ${k}`} />
            ))}
            <span className="heat-sleutel-kop">Positief</span>
          </p>
        ) : null}
        <ScrollKader klasse="heat-wrap" label="Tabel van maten, horizontaal scrollbaar">
          <table className="heat">
            <caption className="heat-caption">
              Rijen: capaciteit in kWh. Kolommen: vermogen in kW. Links van de
              streep staat de stekkerbatterij, die je zelf in een stopcontact
              steekt. Rechts van de streep heeft de batterij een eigen groep
              nodig: een aparte groep in de meterkast, door een installateur
              aangelegd.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="heat-hoek">
                  kWh \ kW
                </th>
                {grid.powers.map((kw, k) => (
                  <th key={kw} scope="col" className={k === scheiding ? "heat-scheiding" : undefined}>
                    {getal(kw, 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.capacities.map((cap, r) => (
                <tr key={cap}>
                  <th scope="row">{getal(cap, 1)}</th>
                  {grid.powers.map((kw, k) => {
                    const cel = fin[r]?.[k];
                    const hp = huidigPlek as { r: number; k: number; exact: boolean } | null;
                    const huidig: "exact" | "dichtbij" | null =
                      hp && hp.r === r && hp.k === k ? (hp.exact ? "exact" : "dichtbij") : null;
                    const isHuidig = huidig !== null;
                    const isBeste = isBesteCel(cap, kw);
                    const w = cel ? modus.waarde(cel) : null;
                    return (
                      <td key={kw} className={k === scheiding ? "heat-scheiding" : undefined}>
                        {cel ? (
                          <button
                            type="button"
                            className={[
                              "heat-cel",
                              verdeeld ? deelStap(w) : `stap-${stap(w)}`,
                              cel.npvEur < 0 ? "negatief" : "",
                              isHuidig ? "huidig" : "",
                              isBeste ? "beste" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onMouseEnter={(e) => {
                              setGehoverd({ r, k });
                              toon(e, tipVoor(cap, kw, cel, isBeste, huidig, jaar));
                            }}
                            onMouseMove={(e) => toon(e, tipVoor(cap, kw, cel, isBeste, huidig, jaar))}
                            onMouseLeave={() => {
                              setGehoverd(null);
                              wis();
                            }}
                            onFocus={(e) => {
                              setGehoverd({ r, k });
                              const box = e.currentTarget.getBoundingClientRect();
                              toon(
                                { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 },
                                tipVoor(cap, kw, cel, isBeste, huidig, jaar),
                              );
                            }}
                            onBlur={() => {
                              setGehoverd(null);
                              wis();
                            }}
                            onClick={() => onKies(cap, kw)}
                            aria-label={`${cap} kWh bij ${kw} kW: ${modus.bedrag(w)}, investering ${euro(
                              cel.investeringEur,
                            )}${isBeste ? ", het hoogste netto resultaat in deze tabel" : ""}${huidig === "dichtbij" ? ", dichtst bij jouw batterij" : ""}`}
                          >
                            {/* Het getal staat er altijd bij: kleur draagt nooit
                                alleen de betekenis. */}
                            <span>{modus.cel(w)}</span>
                          </button>
                        ) : (
                          <span className="heat-cel leeg" aria-hidden="true" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollKader>
        <TipLaag tip={tip} />
      </div>

      <div className="heat-voet">
        {actief && actiefPunt ? (
          <p>
            <strong>
              {getal(actiefPunt.capacityKwh, 1)} kWh bij {getal(actiefPunt.powerKw, 1)} kW
            </strong>{" "}
            kost {euro(actief.investeringEur)} en bespaart {euro(actief.besparingEur)} per jaar:{" "}
            {euro(actief.npvEur)} netto over {config.analysisYears} jaar,{" "}
            {actief.paybackYears === null ? "niet terugverdiend binnen de looptijd" : `terugverdiend na ${jaren(actief.paybackYears)}`}
            , bij {getal(actief.cyclesPerYear)} laadbeurten per jaar.
          </p>
        ) : beste && grid.klaar ? (
          <p>
            Het hoogste netto resultaat is {euro(beste.fin.npvEur)} bij {getal(beste.capacityKwh, 1)} kWh
            en {getal(beste.powerKw, 1)} kW, voor een investering van {euro(beste.fin.investeringEur)}.
            Meer is niet vanzelf beter: elke extra kilowattuur bespaart minder dan de vorige, terwijl de
            prijs gewoon doorloopt.
          </p>
        ) : (
          <p>Wijs een vakje aan voor de details.</p>
        )}
        {vermogenDipt ? (
          <p className="heat-noot">
            Op sommige rijen levert meer vermogen iets minder op. Dat is geen
            rekenfout: de aansturing plant op een verwachting van morgen, en met
            meer vermogen kan de batterij ook harder de verkeerde kant op handelen. Met
            een perfecte verbruiksvoorspelling verdwijnt het effect en loopt elke
            rij netjes op. Een echte batterij gebruikt een weersverwachting en
            zit daar tussenin; deze tool rekent aan de voorzichtige kant.
          </p>
        ) : null}
        <p className="heat-noot">
          Elk vakje: de besparing per jaar van die maat, herhaald over {config.analysisYears} jaar, met{" "}
          {procent(config.discountRate, 1)} rente die je misloopt en de slijtage zoals bij jouw batterij. De
          verhouding tussen de maten komt uit {jaar ?? "het meest recente volledige jaar"}; het niveau uit het
          gemiddelde over de volle jaren, zodat het vakje van jouw eigen maat per jaar bespaart wat het antwoord
          bovenaan zegt. De prijs per vakje volgt uit jouw batterij ({euro(config.investmentEur)}):{" "}
          {euro(regel.perKwhEur)} per kWh en {euro(regel.perKwEur)} per kW erbij, en boven{" "}
          {getal(STEKKER_GRENS_KW, 1)} kW eenmalig {euro(regel.installatieEur)} voor een eigen groep door een
          installateur. Instelbaar bij de geavanceerde instellingen. {rasterGrondslag(config)}
        </p>
      </div>
    </Figure>
  );
}
