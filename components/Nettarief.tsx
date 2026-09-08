"use client";

/**
 * Wat het tijdsafhankelijke nettarief met de businesscase doet.
 *
 * Vanaf 1 januari 2029 gaat een groot deel van de netkosten afhangen van
 * wannéér je stroom gebruikt. Dat raakt een thuisbatterij harder dan wat ook:
 * de winteravond wordt duur op precies de uren waarop een accu kan leveren, en
 * de zomermiddag wordt gratis op precies de uren waarop hij kan laden.
 *
 * Deze sectie rekent dezelfde periode nog een keer door met dat tarief erbij,
 * zodat de vergelijking op dezelfde data en dezelfde batterij rust. Dat kost een
 * tweede volledige doorrekening van enkele seconden, dus hij start op verzoek —
 * net als het raster van batterijmaten.
 *
 * Het is nadrukkelijk een scenario. De structuur staat vast, de bedragen niet:
 * het voorstel toont alleen relatieve niveaus. Wat hier staat is een prognose
 * van CE Delft voor 2030, en dat staat er ook bij.
 */

import { useState } from "react";
import type { AnalysisResult } from "../lib/model/analysis";
import {
  NETTARIEF_BRON,
  NETTARIEF_INGANG,
  profielVoorMaand,
} from "../lib/nettarief";
import { euro, getal, jaren, procent } from "../lib/format";
import { Figure } from "./chart-parts";

const UREN = Array.from({ length: 24 }, (_, u) => u);

/** Kleur per niveau: donkerder is duurder. De schaal is sequentieel, één hue. */
function tint(tarief: number): string {
  if (tarief <= 0) return "var(--seq-100)";
  if (tarief <= 0.06) return "var(--seq-200)";
  if (tarief <= 0.1) return "var(--seq-300)";
  if (tarief <= 0.13) return "var(--seq-500)";
  return "var(--seq-700)";
}

export function Nettarief({
  huidig,
  scenario,
  bezig,
  onStart,
}: {
  huidig: AnalysisResult;
  scenario: AnalysisResult | null;
  bezig: boolean;
  onStart: (opTeruglevering: boolean) => void;
}) {
  const [opTeruglevering, setOpTeruglevering] = useState(false);

  const verschil = scenario
    ? scenario.averageSavingEur - huidig.averageSavingEur
    : 0;
  const relatief =
    scenario && huidig.averageSavingEur !== 0
      ? verschil / huidig.averageSavingEur
      : 0;

  return (
    <Figure
      titel={
        scenario
          ? verschil > 0
            ? "Met het nieuwe nettarief wordt een thuisbatterij fors waardevoller"
            : "Met het nieuwe nettarief verandert er weinig aan de businesscase"
          : "Wat doet het nieuwe nettarief met de businesscase?"
      }
      toelichting={
        <>
          Vanaf {NETTARIEF_INGANG} hangt een groot deel van je netkosten af van
          wannéér je stroom gebruikt. De winteravond wordt duur, de zomermiddag
          gratis — precies de uren waarop een batterij levert en laadt.
        </>
      }
    >
      {/* Het tariefblad zelf, want zonder dat is elk bedrag hieronder een
          black box. Twee profielen van 24 uur; dat past en het is te controleren
          tegen de bron. */}
      <div className="tariefblad">
        <div className="tariefblad-rij">
          <span className="tariefblad-naam">winter</span>
          {UREN.map((u) => (
            <span
              key={`w${u}`}
              className="tariefblad-cel"
              style={{ background: tint(profielVoorMaand(1)[u]!) }}
              title={`${u}:00 — ${getal(profielVoorMaand(1)[u]! * 100, 0)} ct/kWh`}
            />
          ))}
        </div>
        <div className="tariefblad-rij">
          <span className="tariefblad-naam">zomer</span>
          {UREN.map((u) => (
            <span
              key={`z${u}`}
              className="tariefblad-cel"
              style={{ background: tint(profielVoorMaand(6)[u]!) }}
              title={`${u}:00 — ${getal(profielVoorMaand(6)[u]! * 100, 0)} ct/kWh`}
            />
          ))}
        </div>
        <div className="tariefblad-rij tariefblad-as">
          <span className="tariefblad-naam" />
          {UREN.map((u) => (
            <span key={`u${u}`} className="tariefblad-cel">
              {u % 6 === 0 ? u : ""}
            </span>
          ))}
        </div>
      </div>
      <p className="tariefblad-legenda">
        Van links naar rechts 00:00 tot 23:00. Lichter is goedkoper: 0 ct in de
        zomermiddag, 19 ct in de winteravond. Winter is oktober tot en met maart.
      </p>

      {scenario ? (
        <dl className="kerncijfers">
          <div>
            <dt>Besparing nu</dt>
            <dd>{euro(huidig.averageSavingEur)}</dd>
          </div>
          <div>
            <dt>Besparing met het nieuwe nettarief</dt>
            <dd className={verschil > 0 ? "goed" : undefined}>
              {euro(scenario.averageSavingEur)}
              <span className="dd-noot">
                {verschil > 0 ? "+" : ""}
                {euro(verschil)} per jaar, {procent(relatief, 0)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Terugverdientijd</dt>
            <dd>
              {jaren(scenario.finance.paybackYears)}
              <span className="dd-noot">
                nu {jaren(huidig.finance.paybackYears)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Laadbeurten per jaar</dt>
            <dd>
              {getal(scenario.stats.cyclesPerYear, 0)}
              <span className="dd-noot">
                nu {getal(huidig.stats.cyclesPerYear, 0)}
              </span>
            </dd>
          </div>
        </dl>
      ) : (
        <button
          type="button"
          className="start-knop"
          onClick={() => onStart(opTeruglevering)}
          disabled={bezig}
        >
          {bezig ? "Bezig met rekenen…" : "Reken dit scenario door"}
        </button>
      )}

      <div className="instelling">
        <label className="schakel">
          <input
            type="checkbox"
            checked={opTeruglevering}
            onChange={(e) => {
              setOpTeruglevering(e.target.checked);
              if (scenario) onStart(e.target.checked);
            }}
          />
          <span>Ook heffen op teruglevering</span>
        </label>
        <p className="instelling-uitleg">
          Of teruglevering ook wordt beprijsd staat niet in het voorstel. Zet je
          dit aan, dan gaat hetzelfde tarief van je terugleververgoeding af.
        </p>
      </div>

      <p className="controle-noot">
        Scenario, geen tariefblad. De structuur van vijf tijdsblokken en twee
        seizoenen komt uit het codewijzigingsvoorstel dat de netbeheerders op
        4 mei 2026 bij de ACM indienden; de ACM besluit naar verwachting voor
        eind 2026. De bedragen zijn nog niet gepubliceerd — het voorstel toont
        alleen relatieve niveaus. Wat hier staat is {NETTARIEF_BRON}. Circa een
        derde van de netkosten blijft vast en valt daarmee buiten deze
        berekening, net als nu: dat deel is met en zonder batterij gelijk.
      </p>
    </Figure>
  );
}
