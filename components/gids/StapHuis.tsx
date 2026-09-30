"use client";

/**
 * Stap 1: hoe ziet jouw huis eruit?
 *
 * Drie dingen die op de jaarafrekening staan: met of zonder panelen, hoeveel
 * stroom je van het net haalt en (met panelen) hoeveel je teruglevert. Het
 * netgebied staat er compact onder. Deze stap rekent niets: de invoer wordt
 * pas doorgerekend bij "Volgende".
 */

import { useId, useRef, useState } from "react";
import { netgebiedNaam } from "../../lib/data/manifest";
import { getal } from "../../lib/format";
import { GRENZEN } from "../../lib/normaliseer";
import { STANDAARD_AFNAME_KWH, STANDAARD_TERUGLEVERING_KWH } from "../../lib/presets";
import { controleerInvoer } from "../Invoer";
import { GetalInvoer } from "../GetalInvoer";
import type { GidsData } from "./types";

/** Een huis met of zonder panelen, in twee kleuren; puur illustratie. */
function HuisSvg({ metPanelen }: { metPanelen: boolean }) {
  return (
    <svg className="huis-plaatje" viewBox="0 0 160 100" aria-hidden="true" focusable="false">
      <line x1="6" y1="88" x2="154" y2="88" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" />
      {/* het huis */}
      <rect x="34" y="46" width="70" height="42" rx="2" fill="var(--surface-2)" stroke="var(--ac)" strokeWidth="2.5" />
      <polygon points="28,48 69,16 110,48" fill="var(--acs)" stroke="var(--ac)" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="58" y="62" width="14" height="26" rx="1.5" fill="var(--ac)" />
      <rect x="82" y="58" width="14" height="14" rx="1.5" fill="#fff" stroke="var(--ac)" strokeWidth="2" />
      <rect x="40" y="58" width="12" height="12" rx="1.5" fill="#fff" stroke="var(--ac)" strokeWidth="2" />
      {metPanelen ? (
        <>
          {/* panelen op het dak en de zon erboven */}
          <polygon points="50,42 66,30 82,30 66,42" fill="var(--seq-600)" stroke="var(--ac2)" strokeWidth="1.5" strokeLinejoin="round" />
          <polygon points="68,42 84,30 96,30 80,42" fill="var(--seq-500)" stroke="var(--ac2)" strokeWidth="1.5" strokeLinejoin="round" />
          <g className="huis-zon">
            <circle cx="132" cy="26" r="9" fill="var(--winnaar)" stroke="var(--winnaar-rand)" strokeWidth="1.5" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <line
                key={a}
                x1="132"
                y1="10"
                x2="132"
                y2="14"
                stroke="var(--winnaar-rand)"
                strokeWidth="2"
                strokeLinecap="round"
                transform={`rotate(${a} 132 26)`}
              />
            ))}
          </g>
        </>
      ) : (
        <>
          {/* een elektriciteitspaal: alle stroom komt van het net */}
          <line x1="132" y1="88" x2="132" y2="28" stroke="var(--text-secondary)" strokeWidth="3" strokeLinecap="round" />
          <line x1="122" y1="36" x2="142" y2="36" stroke="var(--text-secondary)" strokeWidth="3" strokeLinecap="round" />
          <path d="M132 36 C 118 44, 108 44, 104 52" fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4" className="huis-lijn" />
        </>
      )}
    </svg>
  );
}

function Kaart({
  gekozen,
  onKies,
  metPanelen,
  titel,
  toelichting,
}: {
  gekozen: boolean;
  onKies: () => void;
  metPanelen: boolean;
  titel: string;
  toelichting: string;
}) {
  return (
    <button type="button" className="gids-keuze invoer-kaart huis-kaart" aria-pressed={gekozen} onClick={onKies}>
      <HuisSvg metPanelen={metPanelen} />
      <span className="kaart-titel">{titel}</span>
      <span className="kaart-uitleg">{toelichting}</span>
    </button>
  );
}

export function StapHuis(data: GidsData) {
  const { inst, zetInst, manifest, preset, naarVerdieping } = data;
  const met = inst.zonnepanelen;
  const gebieden = manifest?.netgebieden ?? [];
  const [netOpen, setNetOpen] = useState(false);
  const netId = useId();
  const netSelect = useRef<HTMLSelectElement>(null);

  // Alleen wat over de afrekening gaat: de maat van de batterij komt in stap 2.
  const waarschuwingen = controleerInvoer(inst.afnameKwh, inst.terugleveringKwh, preset, met, {
    capaciteitKwh: 0,
    vermogenKw: 0,
  });

  const voorbeeld = inst.afnameKwh === STANDAARD_AFNAME_KWH && (!met || inst.terugleveringKwh === STANDAARD_TERUGLEVERING_KWH);

  return (
    <>
      <p className="gids-lead">Pak je jaarafrekening erbij. Daar staan de getallen die we nodig hebben.</p>

      <div className="gids-keuzes" role="group" aria-label="Zonnepanelen">
        <Kaart
          gekozen={met}
          onKies={() => zetInst({ zonnepanelen: true })}
          metPanelen
          titel="Ik heb zonnepanelen"
          toelichting="Je levert stroom terug aan het net."
        />
        <Kaart
          gekozen={!met}
          onKies={() => zetInst({ zonnepanelen: false })}
          metPanelen={false}
          titel="Ik heb geen zonnepanelen"
          toelichting="Alle stroom komt van het net."
        />
      </div>

      <div className="huis-velden">
        <div className="huis-veld">
          <label htmlFor="gids-afname" className="huis-label">
            Hoeveel stroom haal je per jaar van het net?
          </label>
          <GetalInvoer
            id="gids-afname"
            waarde={inst.afnameKwh}
            min={GRENZEN.afnameKwh.min}
            max={GRENZEN.afnameKwh.max}
            decimalen={GRENZEN.afnameKwh.decimalen}
            eenheid="kWh"
            onWaarde={(v) => v !== null && zetInst({ afnameKwh: v })}
            aria-describedby="gids-afname-hint"
          />
          <span className="huis-hint" id="gids-afname-hint">
            Staat op je jaarafrekening onder 'verbruik' of 'geleverd'. Staan er een normaal- en een daltarief? Tel ze dan op.
          </span>
        </div>

        {met ? (
          <div className="huis-veld">
            <label htmlFor="gids-teruglevering" className="huis-label">
              Hoeveel lever je per jaar terug?
            </label>
            <GetalInvoer
              id="gids-teruglevering"
              waarde={inst.terugleveringKwh}
              min={GRENZEN.terugleveringKwh.min}
              max={GRENZEN.terugleveringKwh.max}
              decimalen={GRENZEN.terugleveringKwh.decimalen}
              eenheid="kWh"
              onWaarde={(v) => v !== null && zetInst({ terugleveringKwh: v })}
              aria-describedby="gids-teruglevering-hint"
            />
            <span className="huis-hint" id="gids-teruglevering-hint">
              Staat op je jaarafrekening onder 'teruglevering' of 'ingevoed'. Staan er een normaal- en een daltarief? Tel ze dan op.
            </span>
          </div>
        ) : null}
      </div>

      {voorbeeld ? (
        <p className="huis-voorbeeld">Dit zijn voorbeeldgetallen. Pas ze aan naar je eigen jaarafrekening.</p>
      ) : null}

      <p className="huis-samenvatting" aria-live="polite">
        Je haalt <strong>{getal(inst.afnameKwh)} kWh</strong> per jaar van het net
        {met ? (
          <>
            {" "}
            en levert <strong>{getal(inst.terugleveringKwh)} kWh</strong> terug
          </>
        ) : null}
        .
      </p>

      {waarschuwingen.length > 0 ? (
        <ul className="waarschuwingen huis-waarschuwingen" role="status">
          {waarschuwingen.map((w) => (
            <li key={w.tekst} className={w.ernst}>
              {w.tekst}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="huis-net">
        <p className="huis-net-regel">
          Netgebied: <strong>{netgebiedNaam(inst.domein)}</strong>
          {gebieden.length > 1 ? (
            <>
              {" · "}
              <button
                type="button"
                className="gids-link"
                aria-expanded={netOpen}
                aria-controls={netId}
                onClick={() => {
                  const open = !netOpen;
                  setNetOpen(open);
                  if (open) setTimeout(() => netSelect.current?.focus(), 0);
                }}
              >
                {netOpen ? "sluiten" : "wijzigen"}
              </button>
            </>
          ) : null}
        </p>
        {netOpen && gebieden.length > 1 ? (
          <div id={netId} className="huis-net-kies">
            <label htmlFor={`${netId}-select`} className="huis-label">
              Netgebied
            </label>
            <select
              id={`${netId}-select`}
              ref={netSelect}
              value={inst.domein}
              onChange={(e) => zetInst({ domein: e.target.value })}
            >
              {gebieden.map((g) => (
                <option key={g} value={g}>
                  {netgebiedNaam(g)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="huis-hint">
          Je netgebied hangt af van je netbeheerder (bijvoorbeeld Liander, Stedin of Enexis); die staat op je jaarafrekening.
        </p>
      </div>

      <div className="gids-verdieping">
        <button type="button" onClick={() => naarVerdieping("uitkomst", "instellingen")}>
          Meer instellingen (periode, contract, afregelen)
        </button>
      </div>
    </>
  );
}
