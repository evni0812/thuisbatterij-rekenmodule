"use client";

/**
 * Stap 3: wat de batterij op een dag doet.
 *
 * Eén dag als film (zomer of winter), de kerngetallen van die dag, en dan de
 * brug naar het jaar: dezelfde jaartegels als de figuur "Zomer- en winterdag"
 * onder "Alle cijfers". Alles komt uit dezelfde doorrekening; hier wordt niets
 * apart uitgerekend.
 */

import { useState } from "react";
import { datum, euroPrecies, getal, kwh } from "../../lib/format";
import type { SampleDay } from "../../lib/model/analysis";
import { jaarcijfersVan, jaartegels } from "../Verschuiving";
import { samenvatting } from "./dag";
import { Dagfilm } from "./Dagfilm";
import type { GidsData } from "./types";

type Soort = "zomer" | "winter";

function vind(dagen: SampleDay[], soort: Soort): SampleDay | undefined {
  return dagen.find((d) => d.label.toLowerCase().includes(soort));
}

/** Zolang er nog geen antwoord is: de vorm van wat komt, geen lege ruimte. */
function Skelet({ bezig }: { bezig: boolean }) {
  return (
    <div className="dag-skelet" role="status" aria-busy="true">
      <p className="gids-lead">
        {bezig
          ? "De doorrekening loopt. Zodra het antwoord er is, zie je hier een dag als film."
          : "Zodra de doorrekening klaar is, zie je hier een dag als film."}
      </p>
      <div className="dag-skelet-film" aria-hidden="true" />
      <div className="dag-skelet-rij" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function StapDag({ result, toonZonnepanelen, bezig, uitleg, naarVerdieping }: GidsData) {
  const [gekozen, zetGekozen] = useState<Soort>("zomer");

  if (!result) return <Skelet bezig={bezig} />;

  const dagen = result.sampleDays;
  const zomer = vind(dagen, "zomer");
  const winter = vind(dagen, "winter");
  const dag = (gekozen === "zomer" ? zomer : winter) ?? zomer ?? winter;

  if (!dag) {
    return (
      <>
        <p className="gids-lead">
          Voor deze periode is er geen voorbeelddag om te laten zien. De jaarcijfers staan wel bij
          Alle cijfers.
        </p>
        <div className="gids-verdieping">
          <button type="button" onClick={() => naarVerdieping("door-het-jaar", "per-maand")}>
            Hoe dit per maand uitvalt
          </button>
        </div>
      </>
    );
  }

  const soort: Soort = dag === zomer ? "zomer" : "winter";
  const som = samenvatting(dag);
  const { jaarcijfers, avondMinder } = jaarcijfersVan(result.seasonProfiles);
  const knopUitleg = uitleg("dagprofiel");
  const netto = som.besparingEur - som.slijtageEur;

  return (
    <>
      <p className="gids-lead">
        Zo ziet een gewone dag eruit, kwartier voor kwartier. Speel hem af of schuif zelf door de
        dag.
      </p>

      {zomer && winter ? (
        <div className="dag-keuze" role="group" aria-label="Kies een dag">
          {(
            [
              ["zomer", "Zomerdag"],
              ["winter", "Winterdag"],
            ] as const
          ).map(([id, tekst]) => (
            <button
              key={id}
              type="button"
              className="dag-keuze-knop"
              aria-pressed={soort === id}
              onClick={() => zetGekozen(id)}
            >
              {tekst}
            </button>
          ))}
        </div>
      ) : null}

      <Dagfilm key={dag.date} dag={dag} metPanelen={toonZonnepanelen} />

      <p className="dag-noot">
        {dag.label}: {datum(dag.date)}. Het prijsverschil op deze dag zit precies in het midden van
        dat seizoen. Dus geen topdag en geen slechte dag.
      </p>

      <section className="dag-getallen" aria-label="Wat de batterij deze dag deed">
        <div className="dag-getal">
          <span className="dag-getal-waarde">{getal(som.opgeslagenKwh, 1)} kWh</span>
          <span className="dag-getal-label">Opgeslagen</span>
          <span className="dag-getal-noot">
            {som.opgeslagenKwh < 0.05
              ? "Er ging bijna niets de batterij in."
              : toonZonnepanelen && som.uitZonKwh >= 0.05 && som.uitNetKwh >= 0.05
                ? `${getal(som.uitZonKwh, 1)} kWh van je panelen en ${getal(som.uitNetKwh, 1)} kWh van het net.`
                : toonZonnepanelen && som.uitZonKwh >= 0.05
                  ? "Stroom van je panelen die je anders aan het net had geleverd."
                  : "Van het net, op een moment dat stroom goedkoop was."}
          </span>
        </div>
        <div className="dag-getal">
          <span className="dag-getal-waarde">{getal(som.zelfGebruiktKwh, 1)} kWh</span>
          <span className="dag-getal-label">Zelf gebruikt uit de batterij</span>
          <span className="dag-getal-noot">
            Die stroom haalde je niet van het net.
            {som.aanNetKwh >= 0.05 ? ` Nog ${getal(som.aanNetKwh, 1)} kWh ging aan het net.` : ""}
          </span>
        </div>
        <div className="dag-getal dag-getal-hoofd">
          <span className="dag-getal-waarde">{euroPrecies(som.besparingEur)}</span>
          <span className="dag-getal-label">
            {som.besparingEur < 0 ? "Het kostte deze dag" : "Bespaard op deze dag"}
          </span>
          <span className="dag-getal-noot">
            {som.slijtageEur >= 0.005
              ? `Na de slijtage van de batterij (${euroPrecies(som.slijtageEur)}) is dat ${euroPrecies(netto)}.`
              : "Zonder slijtage van de batterij."}
          </span>
        </div>
      </section>

      <section className="dag-jaar" aria-labelledby="dag-jaar-kop">
        <h2 id="dag-jaar-kop" className="dag-jaar-kop">
          {avondMinder >= 1
            ? "Met de batterij haal je 's avonds per jaar minder van het net"
            : "De batterij verschuift wat je van het net haalt naar andere uren"}
        </h2>
        {avondMinder >= 1 ? (
          <>
            <div className="gids-groot dag-jaar-groot">{kwh(avondMinder)}</div>
            <p className="dag-jaar-uitleg">
              Dat zijn de zomer- en winterdagen van een heel jaar bij elkaar.{" "}
              {toonZonnepanelen
                ? "Wat je overdag aan het net had geleverd, gebruik je nu 's avonds zelf."
                : "De batterij laadt 's nachts, als stroom goedkoop is, en levert 's avonds."}
            </p>
          </>
        ) : null}
        <div className="stat-grid dag-jaartegels">{jaartegels(jaarcijfers, toonZonnepanelen)}</div>
      </section>

      <div className="gids-verdieping">
        <button type="button" onClick={() => naarVerdieping("door-het-jaar", "dag-en-week")}>
          Een dag of week naar keuze bekijken
        </button>
        <button type="button" onClick={() => naarVerdieping("door-het-jaar", "per-maand")}>
          Hoe dit per maand uitvalt
        </button>
        {knopUitleg}
      </div>
    </>
  );
}
