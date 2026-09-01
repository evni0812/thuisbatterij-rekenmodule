"use client";

/**
 * Alles wat je kunt bijstellen, achter één uitklap.
 *
 * De instap blijft drie velden; wie meer wil, vindt hier de volledige controle.
 * Elke instelling zegt wat hij doet en waarom hij ertoe doet — een tool die om
 * een discontovoet vraagt zonder uit te leggen wat dat is, is geen tool voor een
 * breed publiek.
 */

import type { Manifest } from "../lib/data/manifest";
import { netgebiedNaam } from "../lib/data/manifest";
import { euro, procent } from "../lib/format";
import type { BatteryPreset } from "../lib/presets";
import type { Instellingen } from "../lib/url-state";

function Schuif({
  label,
  uitleg,
  waarde,
  min,
  max,
  stap,
  formatteer,
  onChange,
}: {
  label: string;
  uitleg: string;
  waarde: number;
  min: number;
  max: number;
  stap: number;
  formatteer: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = `schuif-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="instelling">
      <div className="instelling-kop">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{formatteer(waarde)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={stap}
        value={waarde}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="instelling-uitleg">{uitleg}</p>
    </div>
  );
}

export function Geavanceerd({
  inst,
  manifest,
  preset,
  capaciteit,
  vermogen,
  prijs,
  onChange,
  onReset,
  onBereken,
  verouderd,
  bezig,
}: {
  inst: Instellingen;
  manifest: Manifest | null;
  preset: BatteryPreset;
  capaciteit: number;
  vermogen: number;
  prijs: number;
  onChange: (patch: Partial<Instellingen>) => void;
  onReset: () => void;
  /** Reken door met de huidige instellingen. */
  onBereken: () => void;
  /** De invoer is gewijzigd sinds de getoonde uitkomst. */
  verouderd: boolean;
  bezig: boolean;
}) {
  const gebieden = manifest?.netgebieden ?? [];

  // Welke periode is beschikbaar voor het gekozen netgebied?
  const jaren = manifest ? Object.values(manifest.profielen[inst.domein] ?? {}) : [];
  const vroegste = jaren[0]?.eerste_dag ?? "2023-04-01";
  const laatste = jaren[jaren.length - 1]?.laatste_dag ?? "2026-12-31";

  return (
    <section className="geavanceerd" id="instellingen">
      <div className="geavanceerd-kop">
        <h2>Instellingen</h2>
        {/* Wijzigingen rekenen niet vanzelf door: een volledige doorrekening
            kost seconden, en dan zou elke sleep van een regelaar er een starten.
            Je bepaalt zelf wanneer. */}
        <div className="bereken-balk">
          {verouderd ? (
            <span className="bereken-hint">Instellingen gewijzigd</span>
          ) : null}
          <button
            type="button"
            className={verouderd ? "bereken-knop nadruk" : "bereken-knop"}
            onClick={onBereken}
            disabled={bezig}
          >
            {bezig ? "Bezig met rekenen…" : "Bereken opnieuw"}
          </button>
        </div>
      </div>

      <div className="geavanceerd-inhoud">
        <section>
          <h3>De batterij</h3>
          <div className="instelling-grid">
            <Schuif
              label="Capaciteit"
              uitleg="Hoeveel stroom er in past. Groter helpt alleen zolang je hem ook vol krijgt."
              waarde={capaciteit}
              min={0.5}
              max={30}
              stap={0.1}
              formatteer={(v) => `${v.toFixed(1)} kWh`}
              onChange={(v) => onChange({ capaciteitKwh: v })}
            />
            <Schuif
              label="Laad- en ontlaadvermogen"
              uitleg="Hoe snel hij kan laden en leveren. Te weinig vermogen betekent dat je de zonnepiek niet kunt wegvangen."
              waarde={vermogen}
              min={0.3}
              max={10}
              stap={0.1}
              formatteer={(v) => `${v.toFixed(1)} kW`}
              onChange={(v) => onChange({ vermogenKw: v })}
            />
            <Schuif
              label="Aanschafprijs"
              uitleg="Inclusief installatie. Dit bepaalt zowel de terugverdientijd als hoe zuinig het model met cycli omgaat."
              waarde={prijs}
              min={200}
              max={15000}
              stap={50}
              formatteer={(v) => euro(v)}
              onChange={(v) => onChange({ prijsEur: v })}
            />
          </div>
          <p className="instelling-noot">
            Rendement {procent(preset.spec.efficiency ** 2)} heen en terug,
            bruikbaar deel {procent(preset.spec.depthOfCharge)}, standby{" "}
            {preset.spec.standbyWatt} W, levensduur {preset.cycleLife} cycli —
            overgenomen van {preset.naam}.
          </p>
        </section>

        <section>
          <h3>Je situatie</h3>
          <div className="instelling-grid">
            <div className="instelling">
              <label htmlFor="netgebied">Netgebied</label>
              <select
                id="netgebied"
                value={inst.domein}
                onChange={(e) => onChange({ domein: e.target.value })}
              >
                {gebieden.map((g) => (
                  <option key={g} value={g}>
                    {netgebiedNaam(g)}
                  </option>
                ))}
              </select>
              <p className="instelling-uitleg">
                De gemeten profielen verschillen per regio, vooral in hoeveel zon
                er op het net staat.
              </p>
            </div>

            <div className="instelling">
              <label htmlFor="van">Periode</label>
              <div className="datum-paar">
                <input
                  id="van"
                  type="date"
                  min={vroegste}
                  max={laatste}
                  value={inst.van || vroegste}
                  onChange={(e) => onChange({ van: e.target.value })}
                />
                <span>tot</span>
                <input
                  type="date"
                  min={vroegste}
                  max={laatste}
                  value={inst.tot || laatste}
                  onChange={(e) => onChange({ tot: e.target.value })}
                />
              </div>
              <p className="instelling-uitleg">
                Beschikbaar van {vroegste} tot {laatste}. Een periode korter dan
                een jaar laat vooral het seizoen zien, niet de businesscase.
              </p>
            </div>

            <div className="instelling">
              <label htmlFor="opwek">Opwek van je panelen</label>
              <div className="getal-veld">
                <input
                  id="opwek"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={30000}
                  step={100}
                  value={inst.opwekKwh ?? ""}
                  placeholder="onbekend"
                  onChange={(e) =>
                    onChange({
                      opwekKwh: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <span className="eenheid">kWh per jaar</span>
              </div>
              <p className="instelling-uitleg">
                Optioneel. Hiermee kunnen zelfconsumptie en autarkie berekend
                worden; die volgen niet uit je meterstanden. Vuistregel: ongeveer
                900 kWh per kWp.
              </p>
            </div>

            <Schuif
              label="Scherpte van je profiel"
              uitleg="Het gemeten profiel is een gemiddelde over veel huishoudens en daardoor vlakker dan één aansluiting. Hoger zet de pieken en dalen aan; je jaarverbruik blijft gelijk."
              waarde={inst.spreiding}
              min={0.5}
              max={2}
              stap={0.05}
              formatteer={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => onChange({ spreiding: v })}
            />
          </div>
        </section>

        <section>
          <h3>Het contract</h3>
          <div className="instelling-grid">
            <Schuif
              label="Terugleverkosten"
              uitleg="Wat je leverancier in rekening brengt per teruggeleverde kilowattuur. Sinds de saldering wegvalt rekenen steeds meer leveranciers dit."
              waarde={inst.terugleverkostenCt}
              min={0}
              max={15}
              stap={0.5}
              formatteer={(v) => `${v.toFixed(1)} ct/kWh`}
              onChange={(v) => onChange({ terugleverkostenCt: v })}
            />
            <div className="instelling">
              <label className="schakel">
                <input
                  type="checkbox"
                  checked={inst.curtailment}
                  onChange={(e) => onChange({ curtailment: e.target.checked })}
                />
                <span>Afregelen bij negatieve prijzen</span>
              </label>
              <p className="instelling-uitleg">
                Moderne omvormers stoppen met terugleveren als de prijs negatief
                is. Zet dit uit als jouw installatie dat niet kan — dan betaal je
                op die momenten om je stroom kwijt te raken.
              </p>
            </div>
          </div>
          <p className="instelling-noot">
            Energiebelasting en inkoopvergoeding worden per jaar overgenomen uit
            de werkelijke tarieven van dat jaar, afgeleid uit het verschil tussen
            het all-in tarief en de kale marktprijs.
          </p>
        </section>

        <section>
          <h3>De doorrekening</h3>
          <div className="instelling-grid">
            <Schuif
              label="Looptijd"
              uitleg="Over hoeveel jaar je de investering beoordeelt."
              waarde={inst.analysejaren}
              min={5}
              max={25}
              stap={1}
              formatteer={(v) => `${v} jaar`}
              onChange={(v) => onChange({ analysejaren: v })}
            />
            <Schuif
              label="Prijsstijging per jaar"
              uitleg="Hoe hard je verwacht dat stroom duurder wordt. Hogere prijzen maken een batterij waardevoller."
              waarde={inst.prijsstijging}
              min={0}
              max={0.08}
              stap={0.005}
              formatteer={(v) => procent(v, 1)}
              onChange={(v) => onChange({ prijsstijging: v })}
            />
            <Schuif
              label="Rente die je misloopt"
              uitleg="Wat je geld elders had opgebracht. Hiermee worden toekomstige besparingen teruggerekend naar vandaag."
              waarde={inst.discontovoet}
              min={0}
              max={0.1}
              stap={0.005}
              formatteer={(v) => procent(v, 1)}
              onChange={(v) => onChange({ discontovoet: v })}
            />
            <Schuif
              label="Slijtage per jaar"
              uitleg="Hoeveel capaciteit de batterij per jaar verliest, ook zonder gebruik."
              waarde={inst.degradatie}
              min={0}
              max={0.05}
              stap={0.0025}
              formatteer={(v) => procent(v, 2)}
              onChange={(v) => onChange({ degradatie: v })}
            />
          </div>
        </section>

        <button type="button" className="reset" onClick={onReset}>
          Alles terugzetten
        </button>
      </div>
    </section>
  );
}
