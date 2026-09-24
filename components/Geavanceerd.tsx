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
import { centPerKwh, getal, procent } from "../lib/format";
import { PRIJSPEILDATUM, type BatteryPreset } from "../lib/presets";
import { wearCostPerKwh } from "../lib/model/battery";
import { STANDAARD } from "../lib/configuratie";
import { STRATEGIEEN, strategieVoor } from "../lib/strategie";
import { BESPARING_MET_HEFFING_TOEN, heffingToenTekst } from "../lib/nettarief";
import type { Instellingen } from "../lib/url-state";
import { GRENZEN, MAG_LEEG, klem, type GetalVeld } from "../lib/normaliseer";
import { GetalInvoer } from "./GetalInvoer";

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

/**
 * De zin over de heffing van toen, uit de prijsdata van de volle profieljaren
 * van dit netgebied: de jaren waarop het antwoord rust.
 */
function heffingToenUit(manifest: Manifest | null, domein: string): string | null {
  if (!manifest) return null;
  const jaren = Object.entries(manifest.profielen[domein] ?? {})
    .filter(([, p]) => p.volledig_jaar)
    .map(([j]) => Number(j));
  return heffingToenTekst(manifest.prijzen, jaren);
}

function id(label: string): string {
  return `inst-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

/**
 * Een getal dat je intikt, met eenheid en grenzen.
 *
 * De grenzen komen uit lib/normaliseer.ts: dezelfde die gelden voor een waarde
 * uit de URL of uit een bewaarde set. Het veld zelf (components/GetalInvoer.tsx)
 * klemt pas als je het verlaat, niet bij elke toets.
 */
function Getal({
  label,
  uitleg,
  waarde,
  eenheid,
  veld,
  schaal = 1,
  onChange,
  eenheidVoor = false,
}: {
  label: string;
  uitleg: string;
  /** De waarde zoals de instelling hem bewaart. */
  waarde: number | null;
  eenheid: string;
  /** Welke instelling: bepaalt de grenzen, de afronding en of het veld leeg mag. */
  veld: GetalVeld;
  /** Toon de waarde maal dit getal, zoals een fractie als percentage (100). */
  schaal?: number;
  onChange: (v: number | null) => void;
  /** Zet de eenheid vóór het getal, zoals bij een bedrag. */
  eenheidVoor?: boolean;
}) {
  const veldId = id(label);
  const g = GRENZEN[veld];
  const decimalen = Math.max(0, g.decimalen - Math.round(Math.log10(schaal)));
  return (
    <div className="instelling">
      <label htmlFor={veldId}>{label}</label>
      <div className={eenheidVoor ? "getal-veld klein eenheid-voor" : "getal-veld klein"}>
        {eenheidVoor ? <span className="eenheid">{eenheid}</span> : null}
        <GetalInvoer
          id={veldId}
          waarde={waarde === null ? null : waarde * schaal}
          min={g.min * schaal}
          max={g.max * schaal}
          decimalen={decimalen}
          magLeeg={MAG_LEEG.has(veld)}
          onWaarde={(v) => onChange(v === null ? null : klem(veld, v / schaal))}
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
  veld: GetalVeld;
  onChange: (fractie: number) => void;
}) {
  return (
    <Getal
      label={props.label}
      uitleg={props.uitleg}
      waarde={props.fractie}
      eenheid="%"
      veld={props.veld}
      schaal={100}
      onChange={(v) => {
        if (v !== null) props.onChange(v);
      }}
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
                  <GetalInvoer
                    id="opwek"
                    waarde={inst.opwekKwh}
                    min={GRENZEN.opwekKwh.min}
                    max={GRENZEN.opwekKwh.max}
                    decimalen={GRENZEN.opwekKwh.decimalen}
                    magLeeg
                    placeholder="bijvoorbeeld 3500"
                    onWaarde={(v) => onChange({ opwekKwh: v })}
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
                min={GRENZEN.spreiding.min}
                max={GRENZEN.spreiding.max}
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
                veld="capaciteitKwh"
                label="Capaciteit"
                uitleg="Hoeveel stroom er in past. Groter helpt alleen zolang je hem ook vol krijgt."
                waarde={capaciteit}
                eenheid="kWh"
                onChange={(v) => onChange({ capaciteitKwh: v })}
              />
              <Getal
                veld="vermogenKw"
                label="Laad- en ontlaadvermogen"
                uitleg="Hoe snel hij kan laden en leveren. Te weinig vermogen betekent dat je de zonnepiek niet kunt wegvangen."
                waarde={vermogen}
                eenheid="kW"
                onChange={(v) => onChange({ vermogenKw: v })}
              />
              <Getal
                veld="prijsEur"
                label="Aanschafprijs"
                uitleg="Inclusief installatie. Bepaalt de terugverdientijd, en via de slijtageprijs per laadbeurt ook hoe zuinig de accu met zijn beurten omgaat."
                waarde={prijs}
                eenheid="€"
                eenheidVoor
                onChange={(v) => onChange({ prijsEur: v })}
              />
              {/* De kostenregel voor de kaart van maten: wat een andere maat dan
                  deze batterij zou kosten. Verankerd aan de aanschafprijs
                  hierboven; deze drie zeggen wat er per stap bijkomt. */}
              <Getal
                veld="kostenPerKwh"
                label="Meerprijs per kWh"
                uitleg="Wat elke kilowattuur extra capaciteit kost in de kaart van maten. Uitbreidingsmodules kosten bij vrijwel elk merk 310 tot 450 euro per kWh (peildatum september 2026)."
                waarde={inst.kostenPerKwh}
                eenheid="€"
                eenheidVoor
                onChange={(v) => v !== null && onChange({ kostenPerKwh: v })}
              />
              <Getal
                veld="kostenPerKw"
                label="Meerprijs per kW"
                uitleg="Wat elke kilowatt extra vermogen kost: een grotere omvormer. Een hybride omvormer van 3 tot 5 kW kost 1.000 tot 2.500 euro."
                waarde={inst.kostenPerKw}
                eenheid="€"
                eenheidVoor
                onChange={(v) => v !== null && onChange({ kostenPerKw: v })}
              />
              <Getal
                veld="installatieEur"
                label="Eigen groep door installateur"
                uitleg="Boven 800 W is een vaste aansluiting op een eigen groep de norm; dit is wat een installateur daarvoor rekent. Gangbaar 300 euro, tot 1.200 als de meterkast op de schop moet."
                waarde={inst.installatieEur}
                eenheid="€"
                eenheidVoor
                onChange={(v) => v !== null && onChange({ installatieEur: v })}
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
                veld="degradatie"
                label="Capaciteitsverlies per jaar"
                uitleg="Hoeveel capaciteit hij per jaar kwijtraakt door ouderdom, ook als je hem niet gebruikt. Slijtage door laden en ontladen zit apart in de levensduur hieronder."
                fractie={inst.degradatie}
                onChange={(v) => onChange({ degradatie: v })}
              />
            </div>
            <p className="instelling-noot">
              Vast overgenomen van {preset.naam}: rendement{" "}
              {procent(preset.spec.efficiency ** 2)} heen en terug, bruikbaar deel{" "}
              {procent(preset.spec.depthOfCharge)}, levensduur {getal(preset.cycleLife)} laadbeurten en{" "}
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
                veld="terugleverkostenCt"
                label="Terugleverkosten"
                uitleg="Wat je leverancier per teruggeleverde kilowattuur rekent. ANWB Energie rekent geen terugleverkosten, daarom staat dit standaard op 0; andere leveranciers doen het vaak wel."
                waarde={inst.terugleverkostenCt}
                eenheid="ct/kWh"
                onChange={(v) => v !== null && onChange({ terugleverkostenCt: v })}
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
                  Standaard rekent de tool de uurprijzen van toen met de
                  energiebelasting en opslag van nu: dat past bij een batterij die
                  je vandaag koopt. Kies "van toen" om per uur de heffing te
                  gebruiken die toen gold.
                  {heffingToenUit(manifest, inst.domein) ? (
                    <>
                      {" "}
                      {heffingToenUit(manifest, inst.domein)}. De besparing
                      groeit veel minder hard mee: voor de standaardbatterij met
                      zonnepanelen valt hij ongeveer{" "}
                      {procent(BESPARING_MET_HEFFING_TOEN)} hoger uit.
                    </>
                  ) : null}
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
                  Stopt je installatie met terugleveren als de prijs negatief is?
                  Sommige omvormers en energiemanagementsystemen kunnen dat; de
                  meeste doen het niet vanzelf. Zet dit uit als jouw installatie
                  het niet kan; dan betaal je op die momenten om je stroom kwijt
                  te raken.
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
                veld="analysejaren"
                label="Looptijd"
                uitleg="Over hoeveel jaar je de investering beoordeelt. De accu zelf gaat door tot zijn eigen levensduur op is."
                waarde={inst.analysejaren}
                eenheid="jaar"
                onChange={(v) => v !== null && onChange({ analysejaren: v })}
              />
              <Percentage
                veld="prijsstijging"
                label="Prijsstijging per jaar"
                uitleg="Hoe hard je verwacht dat het gat tussen afname en teruglevering groeit. Standaard 0%: de energiebelasting op stroom daalde de afgelopen jaren (2026: 11,1 ct inclusief btw; het tarief voor 2027 wordt pas eind 2026 vastgesteld) en het PBL geeft voor de groothandelsprijs van stroom in 2030 een brede bandbreedte, 53 tot 90 euro per MWh. Zet hem hoger als je anders verwacht."
                fractie={inst.prijsstijging}
                onChange={(v) => onChange({ prijsstijging: v })}
              />
              <Percentage
                veld="discontovoet"
                label="Rente die je misloopt"
                uitleg="Wat je geld elders had opgebracht. Hiermee worden toekomstige besparingen teruggerekend naar vandaag."
                fractie={inst.discontovoet}
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
