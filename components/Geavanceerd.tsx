"use client";

/**
 * Alles wat je kunt bijstellen, uitklapbaar en geordend op wat het verandert.
 *
 * De instap blijft drie velden; wie meer wil, klapt dit open. Elke instelling
 * zegt wat hij doet en waarom hij ertoe doet — een tool die om een discontovoet
 * vraagt zonder uit te leggen wat dat is, is geen tool voor een breed publiek.
 *
 * Invoertypes volgen het soort getal: een bedrag of een kilowattuur tik je in,
 * een percentage ook; alleen de spreidingsfactor is een schuif, want dat is
 * een gevoel ("meer pieken") en geen getal dat je kent.
 */

import type { Manifest } from "../lib/data/manifest";
import { netgebiedNaam } from "../lib/data/manifest";
import { centPerKwh, procent } from "../lib/format";
import { PRIJSPEILDATUM, type BatteryPreset } from "../lib/presets";
import { wearCostPerKwh } from "../lib/model/battery";
import { STANDAARD } from "../lib/configuratie";
import { STRATEGIEEN, strategieVoor } from "../lib/strategie";
import type { Instellingen } from "../lib/url-state";

/**
 * Hoeveel instellingen afwijken van de standaard.
 *
 * Zonder dit is de resetknop een gok: je ziet niet of er iets te resetten valt,
 * en na het schuiven aan vier regelaars weet je niet meer welke.
 */
function telAfwijkingen(inst: Instellingen): number {
  return (Object.keys(STANDAARD) as (keyof Instellingen)[]).filter(
    (k) => inst[k] !== STANDAARD[k],
  ).length;
}

/** De heffing van het meest recente prijsjaar in de data, of null zonder manifest. */
function actueleHeffingUit(manifest: Manifest | null): number | null {
  if (!manifest) return null;
  const laatste = Object.keys(manifest.prijzen).sort().at(-1);
  return laatste ? manifest.prijzen[laatste]!.jaarconstante_eur_per_kwh : null;
}

function id(label: string): string {
  return `inst-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

/** Een getal dat je intikt, met eenheid en grenzen. */
function Getal({
  label,
  uitleg,
  waarde,
  eenheid,
  min,
  max,
  stap,
  onChange,
  eenheidVoor = false,
}: {
  label: string;
  uitleg: string;
  /** De getoonde waarde, in de eenheid van het veld. */
  waarde: number;
  eenheid: string;
  min: number;
  max: number;
  stap: number;
  onChange: (v: number) => void;
  /** Zet de eenheid vóór het getal, zoals bij een bedrag. */
  eenheidVoor?: boolean;
}) {
  const veldId = id(label);
  return (
    <div className="instelling">
      <label htmlFor={veldId}>{label}</label>
      <div className={eenheidVoor ? "getal-veld klein eenheid-voor" : "getal-veld klein"}>
        {eenheidVoor ? <span className="eenheid">{eenheid}</span> : null}
        <input
          id={veldId}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={stap}
          value={Number.isFinite(waarde) ? waarde : ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(Math.min(max, Math.max(min, n)));
          }}
        />
        {!eenheidVoor ? <span className="eenheid">{eenheid}</span> : null}
      </div>
      <p className="instelling-uitleg">{uitleg}</p>
    </div>
  );
}

/** Een percentage: getoond en ingetikt in procenten, bewaard als fractie. */
function Percentage(props: {
  label: string;
  uitleg: string;
  fractie: number;
  min: number;
  max: number;
  stap: number;
  onChange: (fractie: number) => void;
}) {
  return (
    <Getal
      label={props.label}
      uitleg={props.uitleg}
      waarde={Math.round(props.fractie * 10000) / 100}
      eenheid="%"
      min={props.min}
      max={props.max}
      stap={props.stap}
      onChange={(v) => props.onChange(v / 100)}
    />
  );
}

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
  const veldId = id(label);
  return (
    <div className="instelling">
      <div className="instelling-kop">
        <label htmlFor={veldId}>{label}</label>
        <output htmlFor={veldId}>{formatteer(waarde)}</output>
      </div>
      <input
        id={veldId}
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
  open = false,
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
  /** Uitgeklapt beginnen, bijvoorbeeld als er al afwijkingen zijn. */
  open?: boolean;
}) {
  const gebieden = manifest?.netgebieden ?? [];

  // Welke periode is beschikbaar voor het gekozen netgebied?
  const jaren = manifest ? Object.values(manifest.profielen[inst.domein] ?? {}) : [];
  const vroegste = jaren[0]?.eerste_dag ?? "2023-04-01";
  const laatste = jaren[jaren.length - 1]?.laatste_dag ?? "2026-12-31";
  const afwijkingen = telAfwijkingen(inst);

  // De volle slijtageprijs van de batterij zoals hij nu is ingesteld, zodat de
  // strategie in centen kan zeggen wat de planner per geleverde kWh rekent.
  const volleSlijtage = wearCostPerKwh(prijs, preset.cycleLife, {
    ...preset.spec,
    capacityKwh: capaciteit,
    wearCostEurPerKwh: 0,
  });
  const strategie = strategieVoor(inst.slijtageDeel);

  return (
    <section className="geavanceerd" id="instellingen">
      <details className="uitklap" open={open || afwijkingen > 0}>
        <summary>
          <div className="summary-tekst">
            <h2>Geavanceerde instellingen</h2>
            <span>
              {afwijkingen === 0
                ? "alles op de standaardwaarden"
                : `${afwijkingen} gewijzigd`}
            </span>
          </div>
          {/* Wijzigingen rekenen niet vanzelf door: een volledige doorrekening
              kost seconden, en dan zou elke aanslag er een starten. Je bepaalt
              zelf wanneer. */}
          <div className="bereken-balk">
            {verouderd ? <span className="bereken-hint">Instellingen gewijzigd</span> : null}
            <button
              type="button"
              className={verouderd ? "bereken-knop nadruk" : "bereken-knop"}
              onClick={(e) => {
                e.preventDefault();
                onBereken();
              }}
              disabled={bezig}
            >
              {bezig ? "Bezig met rekenen…" : "Bereken opnieuw"}
            </button>
          </div>
        </summary>

        <div className="geavanceerd-inhoud">
          {/*
            De volgorde volgt de rekenketen: eerst wat er bij jou gebeurt, dan de
            accu die erop reageert, dan de prijzen waartegen dat wordt afgerekend,
            en pas daarna hoe je naar de uitkomst kijkt.

            Die laatste groep staat bewust apart en zegt het ook. De vraag kwam
            waarom de jaaropbrengst verandert als je de rente aanpast; dat doet hij
            niet, maar dat was uit deze indeling niet af te lezen omdat looptijd,
            rente en prijsstijging tussen de fysieke instellingen stonden.
          */}
          <section>
            <h3>Jouw situatie</h3>
            <p className="groep-uitleg">
              Bepaalt hoeveel er te halen valt. Verandert de jaaropbrengst.
            </p>
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
                  een jaar laat vooral het seizoen zien, niet of de batterij zich
                  terugverdient.
                </p>
              </div>

              <div className="instelling">
                <label htmlFor="opwek">Opwek van je panelen</label>
                <div className="getal-veld klein">
                  <input
                    id="opwek"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30000}
                    step={100}
                    value={inst.opwekKwh ?? ""}
                    placeholder="bijvoorbeeld 3500"
                    onChange={(e) =>
                      onChange({
                        opwekKwh: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                  <span className="eenheid">kWh per jaar</span>
                </div>
                <p className="instelling-uitleg">
                  Optioneel, en het enige veld hier dat de uitkomst niet verandert:
                  het zet alleen zelfconsumptie en autarkie aan. Vuistregel:
                  ongeveer 900 kWh per kWp (Milieu Centraal).
                </p>
              </div>

              <Schuif
                label="Pieken in je verbruik"
                uitleg="Het gemeten patroon is een gemiddelde over veel huishoudens en daardoor vlakker dan één huis. Hoger zet de pieken en dalen aan. Je jaarverbruik blijft gelijk."
                waarde={inst.spreiding}
                min={0.5}
                max={2}
                stap={0.05}
                formatteer={(v) => `${v.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}×`}
                onChange={(v) => onChange({ spreiding: v })}
              />
            </div>
          </section>

          <section>
            <h3>De batterij</h3>
            <p className="groep-uitleg">
              Bepaalt wat de accu ermee kan. Verandert de jaaropbrengst.
            </p>
            <div className="instelling-grid">
              <Getal
                label="Capaciteit"
                uitleg="Hoeveel stroom er in past. Groter helpt alleen zolang je hem ook vol krijgt."
                waarde={capaciteit}
                eenheid="kWh"
                min={0.5}
                max={30}
                stap={0.1}
                onChange={(v) => onChange({ capaciteitKwh: v })}
              />
              <Getal
                label="Laad- en ontlaadvermogen"
                uitleg="Hoe snel hij kan laden en leveren. Te weinig vermogen betekent dat je de zonnepiek niet kunt wegvangen."
                waarde={vermogen}
                eenheid="kW"
                min={0.3}
                max={10}
                stap={0.1}
                onChange={(v) => onChange({ vermogenKw: v })}
              />
              <Getal
                label="Aanschafprijs"
                uitleg="Inclusief installatie. Bepaalt de terugverdientijd, en via de slijtageprijs per laadbeurt ook hoe zuinig de accu met zijn beurten omgaat."
                waarde={prijs}
                eenheid="€"
                eenheidVoor
                min={100}
                max={20000}
                stap={10}
                onChange={(v) => onChange({ prijsEur: v })}
              />
              {/* De strategie is een keuze, geen eigenschap van de accu, maar hij
                  hoort hier omdat hij bepaalt hoe de accu met zijn beurten omgaat.
                  Drie standen met een naam, en een schuif voor wie er tussenin
                  wil zitten: de knoppen lichten op als de schuif op hun waarde
                  staat. */}
              <div className="instelling instelling-breed">
                <label>Strategie voor de laadbeurten</label>
                <div className="segment" role="group" aria-label="Strategie voor de laadbeurten">
                  {STRATEGIEEN.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      aria-pressed={strategie?.id === st.id}
                      className={strategie?.id === st.id ? "segment-knop actief" : "segment-knop"}
                      onClick={() => onChange({ slijtageDeel: st.deel })}
                    >
                      {st.naam}
                    </button>
                  ))}
                </div>
                <p className="instelling-uitleg">
                  {strategie
                    ? strategie.kort
                    : `Eigen waarde: de planner rekent ${procent(inst.slijtageDeel)} van de slijtageprijs mee.`}{" "}
                  Een geleverde kWh kost {centPerKwh(volleSlijtage)} aan slijtage tegen de
                  aanschafprijs; de planner rekent daarvan{" "}
                  <strong>{centPerKwh(volleSlijtage * inst.slijtageDeel)}</strong> en
                  handelt alleen als de marge daar bovenuit komt. Minder meerekenen
                  geeft meer beurten en een hogere jaaropbrengst, maar de batterij is
                  eerder op als zijn beurten opraken vóór de kalender.
                </p>
              </div>
              <Schuif
                label="Slijtage die de planner meerekent"
                uitleg="Als deel van de volle slijtageprijs per geleverde kWh. De drie knoppen hierboven zijn vaste standen van deze schuif."
                waarde={inst.slijtageDeel}
                min={0}
                max={1}
                stap={0.05}
                formatteer={(v) => procent(v)}
                onChange={(v) => onChange({ slijtageDeel: Math.round(v * 100) / 100 })}
              />
              {/* Capaciteitsverlies hoort bij de accu, niet bij de doorrekening:
                  het is een fysieke eigenschap, naast rendement en levensduur. */}
              <Percentage
                label="Capaciteitsverlies per jaar"
                uitleg="Hoeveel capaciteit hij per jaar kwijtraakt door ouderdom, ook als je hem niet gebruikt. Slijtage door laden en ontladen zit apart in de levensduur hieronder."
                fractie={inst.degradatie}
                min={0}
                max={5}
                stap={0.25}
                onChange={(v) => onChange({ degradatie: v })}
              />
            </div>
            <p className="instelling-noot">
              Vast overgenomen van {preset.naam}: rendement{" "}
              {procent(preset.spec.efficiency ** 2)} heen en terug, bruikbaar deel{" "}
              {procent(preset.spec.depthOfCharge)}, levensduur {preset.cycleLife} laadbeurten en{" "}
              {preset.kalenderLevensduurJaren} jaar. Prijs: {preset.prijsNoot},
              richtprijs {PRIJSPEILDATUM}.
            </p>
          </section>

          <section>
            <h3>Je contract</h3>
            <p className="groep-uitleg">
              Bepaalt waartegen alles wordt afgerekend. Verandert de jaaropbrengst.
            </p>
            <div className="instelling-grid">
              <Getal
                label="Terugleverkosten"
                uitleg="Wat je leverancier per teruggeleverde kilowattuur rekent. Sinds de saldering wegvalt doen steeds meer leveranciers dat."
                waarde={inst.terugleverkostenCt}
                eenheid="ct/kWh"
                min={0}
                max={15}
                stap={0.5}
                onChange={(v) => onChange({ terugleverkostenCt: v })}
              />

              {/* Een keuze tussen twee even geldige opties, geen aan-uitschakelaar:
                  een vinkje met "reken met de belasting van nu" laat de andere kant
                  naamloos, en dan weet je niet waar je vandaan komt. */}
              <div className="instelling">
                <label>Energiebelasting en opslag</label>
                <div className="segment" role="group" aria-label="Welke heffing">
                  <button
                    type="button"
                    aria-pressed={inst.heffing === "toen"}
                    className={inst.heffing === "toen" ? "segment-knop actief" : "segment-knop"}
                    onClick={() => onChange({ heffing: "toen" })}
                  >
                    Van toen
                  </button>
                  <button
                    type="button"
                    aria-pressed={inst.heffing === "nu"}
                    className={inst.heffing === "nu" ? "segment-knop actief" : "segment-knop"}
                    onClick={() => onChange({ heffing: "nu" })}
                  >
                    Van nu
                    {actueleHeffingUit(manifest) !== null
                      ? ` (${centPerKwh(actueleHeffingUit(manifest)!)})`
                      : ""}
                  </button>
                </div>
                <p className="instelling-uitleg">
                  Standaard geldt per uur de heffing die toen echt gold: het verschil
                  tussen wat je aan de kassa betaalde en de kale marktprijs. In 2024
                  en 2025 lag die een kwart tot een derde hoger dan nu, en de
                  besparing schaalt daar bijna één-op-één mee. Kies "van nu" om de
                  prijzen van toen te combineren met de belasting van vandaag.
                </p>
              </div>

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
                  is. Zet dit uit als jouw installatie dat niet kan; dan betaal je
                  op die momenten om je stroom kwijt te raken.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3>Hoe je ernaar kijkt</h3>
            <p className="groep-uitleg">
              Verandert de terugverdientijd en de contante waarde.{" "}
              <strong>Niet de jaaropbrengst</strong>: wat de batterij fysiek doet
              hangt af van prijzen en verbruik, niet van hoe je de investering
              beoordeelt.
            </p>
            <div className="instelling-grid">
              <Getal
                label="Looptijd"
                uitleg="Over hoeveel jaar je de investering beoordeelt. De accu zelf gaat door tot zijn eigen levensduur op is."
                waarde={inst.analysejaren}
                eenheid="jaar"
                min={5}
                max={25}
                stap={1}
                onChange={(v) => onChange({ analysejaren: Math.round(v) })}
              />
              <Percentage
                label="Prijsstijging per jaar"
                uitleg="Hoe hard je verwacht dat het gat tussen afname en teruglevering groeit. Standaard 0%: de energiebelasting op stroom daalt eerder dan dat hij stijgt (2026 en 2027 vast op 11,1 ct) en PBL noemt de prijsontwikkeling tot 2030 zeer onzeker. Zet hem hoger als je anders verwacht."
                fractie={inst.prijsstijging}
                min={0}
                max={8}
                stap={0.5}
                onChange={(v) => onChange({ prijsstijging: v })}
              />
              <Percentage
                label="Rente die je misloopt"
                uitleg="Wat je geld elders had opgebracht. Hiermee worden toekomstige besparingen teruggerekend naar vandaag."
                fractie={inst.discontovoet}
                min={0}
                max={10}
                stap={0.5}
                onChange={(v) => onChange({ discontovoet: v })}
              />
            </div>
          </section>

          <button
            type="button"
            className="reset"
            onClick={onReset}
            disabled={afwijkingen === 0}
          >
            {afwijkingen === 0
              ? "Alles staat op de standaardwaarden"
              : `Terug naar de standaardwaarden (${afwijkingen} gewijzigd)`}
          </button>
        </div>
      </details>
    </section>
  );
}
