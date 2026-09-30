"use client";

/**
 * Stap 5: past een thuisbatterij bij jou?
 *
 * Een eerlijk oordeel in één zin, afgeleid uit de getallen, met daaronder een
 * checklist waarop je kan zien wat wel en niet meetelt. Geen verkooppraat: de
 * kop zegt ook als een batterij zich niet terugverdient. Alle getallen komen uit
 * dezelfde doorrekening als de tabbladen (zie ./uitkomst.ts).
 */

import { useEffect, useRef, useState } from "react";
import { euro, jaren } from "../../lib/format";
import { Skelet } from "./StapOpbrengst";
import type { GidsData } from "./types";
import {
  TEKEN_WOORD,
  checklist,
  oordeel,
  type OordeelNiveau,
  type Regel,
  type Teken,
} from "./uitkomst";

const TEKEN_GLYPH: Record<Teken, string> = {
  goed: "✓",
  "let-op": "!",
  nee: "✗",
  info: "i",
};

export function StapPast(p: GidsData) {
  const { result, toon, overgang } = p;
  const [rekenNa, setRekenNa] = useState(false);

  // Een klik op "Reken met deze maat" is een opdracht: de invoer verandert en
  // daarna rekenen we door. Dat kan pas als de gewijzigde invoer in de
  // configuratie zit, dus in een effect, zoals de kaart op "Welke batterij".
  const { herbereken } = p;
  useEffect(() => {
    if (!rekenNa) return;
    setRekenNa(false);
    herbereken();
  }, [rekenNa, herbereken]);

  if (!result || !toon) return <Skelet />;

  const finance = overgang?.finance ?? result.finance;
  const levensduur = toon.calendarLifeYears;
  const uitspraak = oordeel(finance.paybackYears, levensduur);
  const regels = checklist({ result, toon, toonZonnepanelen: p.toonZonnepanelen, grid: p.grid });

  const kiesMaat = (cap: number, kw: number, prijsEur: number) => {
    p.zetInst({ capaciteitKwh: cap, vermogenKw: kw, prijsEur });
    setRekenNa(true);
  };

  return (
    <>
      <section className={`ps-oordeel ps-${uitspraak.niveau}`} aria-labelledby="ps-kop">
        <OordeelIcoon niveau={uitspraak.niveau} />
        <div>
          <h2 id="ps-kop">{uitspraak.kop}</h2>
          <p className="ps-toelichting">{uitspraak.toelichting}</p>
          {!overgang ? (
            <p className="ps-wacht" role="status">
              {p.scenarioFout
                ? "Dit oordeel rekent zonder het nettarief van 2029: dat kon niet worden doorgerekend."
                : "Dit oordeel rekent nog zonder het nettarief van 2029. We rekenen dat nog door."}
            </p>
          ) : null}
        </div>
      </section>

      <dl className="ps-cijfers">
        <div>
          <dt>Aanschaf</dt>
          <dd>{euro(toon.investmentEur)}</dd>
        </div>
        <div>
          <dt>Terugverdientijd</dt>
          <dd>{jaren(finance.paybackYears)}</dd>
        </div>
        <div>
          <dt>Netto resultaat over {toon.analysisYears} jaar</dt>
          <dd className={finance.npvEur >= 0 ? "goed" : "slecht"}>{euro(finance.npvEur)}</dd>
          <dd className="ps-cijfer-noot">
            {finance.npvEur >= 0
              ? "na aftrek van de aanschaf en de rente die je misloopt"
              : "na aftrek van de aanschaf en de rente die je misloopt: je krijgt niet alles terug"}
          </dd>
        </div>
      </dl>

      <section className="uk-blok" aria-labelledby="ps-check">
        <h2 id="ps-check">Waar moet je aan denken?</h2>
        <ul className="ps-lijst">
          {regels.map((r) => (
            <li key={r.id} className={`ps-regel ps-regel-${r.teken}`}>
              <span className="ps-teken" aria-hidden="true">
                {TEKEN_GLYPH[r.teken]}
              </span>
              <div className="ps-regel-tekst">
                <span className="visueel-verborgen">{TEKEN_WOORD[r.teken]}: </span>
                <p>{r.tekst}</p>
                {r.id === "maat" ? <MaatActies regel={r} p={p} onKies={kiesMaat} /> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <VolgendeStappen p={p} />

      <div className="gids-verdieping">
        <button type="button" onClick={() => p.naarVerdieping("aannames", "wat-we-niet-weten")}>
          Wat we niet weten
        </button>
        {p.uitleg("antwoord")}
      </div>
    </>
  );
}

/* ── De regel over een andere maat ─────────────────────────────────────────── */

function MaatActies({
  regel,
  p,
  onKies,
}: {
  regel: Regel;
  p: GidsData;
  onKies: (cap: number, kw: number, prijsEur: number) => void;
}) {
  const m = regel.maat;
  if (!m) return null;
  return (
    <div className="ps-acties">
      {m.soort === "beter" ? (
        <button
          type="button"
          className="knop"
          disabled={p.bezig}
          onClick={() => onKies(m.capaciteitKwh, m.vermogenKw, m.prijsEur)}
        >
          Reken met deze maat
        </button>
      ) : null}
      {m.soort === "wacht" ? null : (
        <button type="button" className="gids-link" onClick={() => p.naarVerdieping("welke-batterij", "maat")}>
          Bekijk alle maten
        </button>
      )}
    </div>
  );
}

/* ── Volgende stappen ──────────────────────────────────────────────────────── */

function VolgendeStappen({ p }: { p: GidsData }) {
  return (
    <section className="uk-blok" aria-labelledby="ps-verder">
      <h2 id="ps-verder">Wat kan je nu doen?</h2>
      <div className="ps-kaarten">
        <DeelKaart />
        <button type="button" className="ps-kaart" onClick={() => p.naarVerdieping("aannames")}>
          <span className="ps-kaart-kop">Bekijk alle cijfers en de verantwoording</span>
          <span className="ps-kaart-tekst">
            De data, het model en wat we niet weten, met de bronnen erbij.
          </span>
        </button>
        <button type="button" className="ps-kaart" onClick={() => p.naarVerdieping("welke-batterij")}>
          <span className="ps-kaart-kop">Vergelijk maten en huishoudens</span>
          <span className="ps-kaart-tekst">
            Welke maat past bij jouw verbruik, en voor wie loont het wel.
          </span>
        </button>
      </div>
    </section>
  );
}

type KopieerStand = "rust" | "gelukt" | "mislukt";

/** Kopieert de link naar het klembord. Zonder klembord-API valt hij terug op een tijdelijk tekstvak. */
async function kopieer(tekst: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tekst);
      return true;
    }
  } catch {
    // val terug op het tekstvak
  }
  try {
    const veld = document.createElement("textarea");
    veld.value = tekst;
    veld.setAttribute("readonly", "");
    veld.style.position = "fixed";
    veld.style.opacity = "0";
    document.body.appendChild(veld);
    veld.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(veld);
    return ok;
  } catch {
    return false;
  }
}

function DeelKaart() {
  const [stand, setStand] = useState<KopieerStand>("rust");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const klik = async () => {
    const ok = await kopieer(window.location.href);
    setStand(ok ? "gelukt" : "mislukt");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStand("rust"), 4000);
  };

  return (
    <div className="ps-kaart ps-kaart-deel">
      <button type="button" className="ps-kaart-knop" onClick={klik}>
        <span className="ps-kaart-kop">Bewaar of deel je uitkomst</span>
        <span className="ps-kaart-tekst">
          Kopieer de link. Wie hem opent, ziet dezelfde invoer en dezelfde uitkomst.
        </span>
      </button>
      <span className={`ps-bevestiging ${stand === "rust" ? "" : "zichtbaar"}`} role="status" aria-live="polite">
        {stand === "gelukt"
          ? "Link gekopieerd"
          : stand === "mislukt"
            ? "Kopiëren lukte niet. Kopieer de link uit de adresbalk."
            : ""}
      </span>
    </div>
  );
}

/* ── Het teken bij het oordeel ─────────────────────────────────────────────── */

function OordeelIcoon({ niveau }: { niveau: OordeelNiveau }) {
  return (
    <svg className="ps-icoon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="28" className="ps-icoon-vlak" />
      {niveau === "ruim" ? (
        <path d="M19 33 l9 9 l18 -20" className="ps-icoon-lijn" />
      ) : niveau === "lang" ? (
        <>
          <circle cx="32" cy="32" r="14" className="ps-icoon-lijn" />
          <path d="M32 24 v9 l6 4" className="ps-icoon-lijn" />
        </>
      ) : (
        <path d="M22 22 l20 20 M42 22 l-20 20" className="ps-icoon-lijn" />
      )}
    </svg>
  );
}
