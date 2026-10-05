"use client";

/**
 * Stap 2: welke batterij wil je doorrekenen, en waar stuurt hij op?
 *
 * Kiezen zet alleen de invoer; er wordt niets doorgerekend tot "Volgende".
 * Een eigen maat of prijs uit "Alle cijfers" blijft staan (als "Je eigen
 * batterij") tot je hier een batterij kiest: dat wist de eigen waarden, net
 * als de keuzelijst in "Alle cijfers".
 */

import { DOELEN } from "../../lib/model/doel";
import { isVasteAansluiting } from "../../lib/model/kosten";
import type { Doel } from "../../lib/model/types";
import { euro, getal, vermogenTekst } from "../../lib/format";
import { RENDEMENT_BRON_LABEL, perMerk } from "../../lib/presets";
import { MerkLogo } from "../MerkLogo";
import { controleerInvoer } from "../Invoer";
import type { GidsData } from "./types";

/** Hoogte van de batterij in de tekening: meer capaciteit, hoger. 10 kWh is de grootste. */
function hoogte(kwh: number): number {
  return 12 + Math.min(1, Math.max(0, kwh) / 10) * 70;
}

function BatterijSvg({ kwh }: { kwh: number }) {
  const h = hoogte(kwh);
  const y = 94 - h;
  return (
    <svg className="batterij-plaatje" viewBox="0 0 48 100" aria-hidden="true" focusable="false">
      <line x1="2" y1="94" x2="46" y2="94" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" />
      <rect x="19" y={y - 5} width="10" height="6" rx="1.5" fill="var(--ac)" />
      <rect x="8" y={y} width="32" height={h} rx="5" fill="var(--acs)" stroke="var(--ac)" strokeWidth="2.5" />
      <rect className="batterij-vulling" x="12" y={y + 4} width="24" height={h - 8} rx="2.5" fill="var(--seq-500)" />
      <path
        d={`M26 ${y + h / 2 - 9} L18 ${y + h / 2 + 2} H24 L22 ${y + h / 2 + 10} L30 ${y + h / 2 - 2} H24 Z`}
        fill="#fff"
      />
    </svg>
  );
}

/** Wat de aansluiting betekent, in twee regels. */
function aansluiting(vermogenKw: number, generiek: boolean): { label: string; noot: string | null } {
  if (!isVasteAansluiting(vermogenKw)) return { label: "In het stopcontact", noot: null };
  return {
    label: "Vaste aansluiting door een installateur",
    noot: generiek ? "De installatie zit in de prijs." : "De eigen groep zit in de prijs.",
  };
}

/** Wat elk doel betekent voor wie zonder panelen kijkt: alleen waar het echt anders wordt. */
const ZONDER_PANELEN_ZELFCONSUMPTIE =
  "Zonder zonnepanelen heb je geen eigen overschot om op te slaan. Met Zelfconsumptie blijft de batterij dan vrijwel leeg.";

export function StapBatterij(data: GidsData) {
  const { inst, zetInst, preset, capaciteitKwh, vermogenKw, prijsEur, naarVerdieping } = data;
  const eigen = inst.capaciteitKwh !== null || inst.vermogenKw !== null || inst.prijsEur !== null;

  // Alleen de meldingen die over de maat van de batterij gaan.
  const zonderMaat = new Set(
    controleerInvoer(inst.afnameKwh, inst.terugleveringKwh, preset, inst.zonnepanelen, {
      capaciteitKwh: 0,
      vermogenKw: 0,
    }).map((w) => w.tekst),
  );
  const waarschuwingen = controleerInvoer(inst.afnameKwh, inst.terugleveringKwh, preset, inst.zonnepanelen, {
    capaciteitKwh,
    vermogenKw,
  }).filter((w) => !zonderMaat.has(w.tekst));

  const kies = (id: string) =>
    zetInst({ presetId: id, capaciteitKwh: null, vermogenKw: null, prijsEur: null, standbyWatt: null });

  return (
    <>
      <p className="gids-lead">
        Capaciteit (kWh) is hoeveel stroom erin past; vermogen (kW) is hoe snel hij laadt en levert.
        Helemaal leeg of vol gaat een batterij niet: we rekenen met het bruikbare deel.
      </p>

      {eigen ? (
        <div className="batterij-eigen" role="status">
          <BatterijSvg kwh={capaciteitKwh} />
          <div>
            <span className="kaart-titel">
              Je eigen batterij: {getal(capaciteitKwh, 2)} kWh · {getal(vermogenKw, 2)} kW · {euro(prijsEur)}
            </span>
            <span className="kaart-uitleg">
              Die maat en prijs heb je bij 'Alle cijfers' ingesteld. Hij blijft gekozen tot je hieronder een andere batterij kiest.
            </span>
          </div>
        </div>
      ) : null}

      {/* Per merk een kopje met logo; binnen een merk van klein naar groot. De
          groep zelf blijft één groep voor schermlezers. */}
      <div className="batterij-merken" role="group" aria-label="Batterij">
        {perMerk().map((g) => (
          <section key={g.merk} className="batterij-merk" aria-labelledby={`merk-${g.merk}`}>
            <div className="batterij-merk-kop">
              <h2 id={`merk-${g.merk}`} className="batterij-merk-naam">
                <MerkLogo merk={g.merk} logo={g.logo} />
                {g.logo ? <span aria-hidden="true">{g.merk}</span> : null}
              </h2>
              {g.bijAnwb ? (
                <span className="batterij-anwb">Verkrijgbaar bij ANWB</span>
              ) : g.deelsBijAnwb ? (
                <span className="batterij-anwb">De meeste bij ANWB</span>
              ) : null}
            </div>
            <div className="gids-keuzes batterij-keuzes">
              {g.presets.map((p) => {
                const a = aansluiting(p.vermogenKw, p.merk === "Generiek");
                return (
                  <div key={p.id} className="batterij-kaart-rij">
                    <button
                      type="button"
                      className="gids-keuze invoer-kaart batterij-kaart"
                      aria-pressed={!eigen && inst.presetId === p.id}
                      onClick={() => kies(p.id)}
                    >
                      <BatterijSvg kwh={p.capaciteitKwh} />
                      <span className="kaart-titel">{p.naam}</span>
                      <span className="batterij-groot">
                        {getal(p.capaciteitKwh, 2)} <small>kWh</small>
                      </span>
                      {/* Het model gebruikt alleen het bruikbare deel (depthOfCharge);
                          dat getal staat in stap 3 bij de batterij, dus hier ook. */}
                      <span className="kaart-noot">
                        waarvan ongeveer {getal(p.capaciteitKwh * p.spec.depthOfCharge, 1)} kWh bruikbaar
                      </span>
                      <span className="kaart-uitleg">
                        {vermogenTekst(p.laadvermogenKw, p.ontlaadvermogenKw)} · {euro(p.prijsEur)}
                      </span>
                      {p.prijsLabel ? <span className="batterij-prijslabel">{p.prijsLabel}</span> : null}
                      <span className={isVasteAansluiting(p.vermogenKw) ? "batterij-label vast" : "batterij-label"}>
                        {a.label}
                      </span>
                      {a.noot ? <span className="kaart-noot">{a.noot}</span> : null}
                      {/* Eerlijk over wat niet gemeten is: alleen als het rendement
                          geen testresultaat is, staat het erbij. */}
                      {p.rendementBron !== "gemeten" ? (
                        <span className="batterij-aanname">
                          Rendement {getal(p.spec.efficiency ** 2 * 100, 1)}%: {RENDEMENT_BRON_LABEL[p.rendementBron]}
                        </span>
                      ) : null}
                    </button>
                    {p.bijAnwb && p.anwbUrl ? (
                      <a className="batterij-anwb-link" href={p.anwbUrl} rel="noopener" target="_blank">
                        Bekijk bij ANWB
                      </a>
                    ) : p.winkel ? (
                      <a className="batterij-anwb-link" href={p.winkel.url} rel="noopener" target="_blank">
                        Niet bij ANWB · bekijk bij {p.winkel.naam}
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
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

      <div className="batterij-doel">
        <h2 className="batterij-kop">Waar stuurt de batterij op?</h2>
        <p className="huis-hint">Weet je het niet? Laat Rendement staan.</p>
        <div className="gids-keuzes batterij-doelen" role="group" aria-label="Doel van de batterij">
          {DOELEN.map((d) => (
            <button
              key={d.id}
              type="button"
              className="gids-keuze invoer-kaart doel-kaart"
              aria-pressed={inst.doel === d.id}
              onClick={() => zetInst({ doel: d.id as Doel })}
            >
              <span className="kaart-titel">{d.naam}</span>
              <span className="kaart-uitleg">{d.kort}</span>
            </button>
          ))}
        </div>
        {!inst.zonnepanelen && inst.doel === "zelfconsumptie" ? (
          <p className="waarschuwingen-los" role="status">
            {ZONDER_PANELEN_ZELFCONSUMPTIE}
          </p>
        ) : null}
      </div>

      <div className="gids-verdieping">
        <button type="button" onClick={() => naarVerdieping("uitkomst", "instellingen")}>
          Een andere maat of eigen prijs
        </button>
        <button type="button" onClick={() => naarVerdieping("welke-batterij")}>
          Welke maat past het best?
        </button>
      </div>
    </>
  );
}
