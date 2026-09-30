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

import { useEffect, useState } from "react";
import type { Manifest } from "../lib/data/manifest";
import { netgebiedNaam } from "../lib/data/manifest";
import { datum, getal, procent } from "../lib/format";
import { PRIJSPEILDATUM, type BatteryPreset } from "../lib/presets";
import { wearCostPerKwh } from "../lib/model/battery";
import { STANDAARD } from "../lib/configuratie";
import { STRATEGIEEN, strategieVoor } from "../lib/strategie";
import { slijtageHint, slijtageVoorbeeld } from "./Invoer";
import { FiguurNaam } from "./chart-parts";
import { BESPARING_MET_HEFFING_TOEN, heffingToenTekst } from "../lib/nettarief";
import type { Instellingen } from "../lib/url-state";
import { GRENZEN, MAG_LEEG, klem, klemPeriode, type GetalVeld } from "../lib/normaliseer";
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

/** Een bedrag per kWh in gewone woorden: "9 cent per kWh". */
const centPer = (eur: number) => `${getal(eur * 100, 1)} cent per kWh`;

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
      <GetalInvoer
        id={veldId}
        klein
        eenheid={eenheid}
        eenheidVoor={eenheidVoor}
        waarde={waarde === null ? null : waarde * schaal}
        min={g.min * schaal}
        max={g.max * schaal}
        decimalen={decimalen}
        magLeeg={MAG_LEEG.has(veld)}
        onWaarde={(v) => onChange(v === null ? null : klem(veld, v / schaal))}
      />
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

  // Uitgeklapt zodra er afwijkingen zijn, en dan blijft het open tot de
  // gebruiker het zelf sluit. Eerder klapte het dicht op het moment dat je de
  // laatste afwijking terugzette, midden in wat je aan het doen was.
  const [uitgeklapt, setUitgeklapt] = useState(open);
  const heeftAfwijkingen = afwijkingen > 0;
  useEffect(() => {
    if (heeftAfwijkingen) setUitgeklapt(true);
  }, [heeftAfwijkingen]);

  // De periode is een paar: het andere veld volgt met min en max, en typ je
  // een begin na het einde (of andersom), dan schuift het andere mee.
  const vanEffectief = inst.van || vroegste;
  const totEffectief = inst.tot || laatste;
  const zetPeriode = (welke: "van" | "tot", waarde: string) =>
    onChange(klemPeriode(welke, waarde, { van: inst.van, tot: inst.tot }, { vroegste, laatste }));

  // De volle slijtageprijs van de batterij zoals hij nu is ingesteld, zodat de
  // aansturing in centen kan zeggen wat er per geleverde kWh wordt meegerekend.
  const volleSlijtage = wearCostPerKwh(prijs, preset.cycleLife, {
    ...preset.spec,
    capacityKwh: capaciteit,
    wearCostEurPerKwh: 0,
  });
  const strategie = strategieVoor(inst.slijtageDeel);

  return (
    <section className="geavanceerd" id="instellingen">
      <details
        className="uitklap"
        open={uitgeklapt}
        onToggle={(e) => setUitgeklapt(e.currentTarget.open)}
      >
        <summary>
          <div className="summary-tekst">
            <FiguurNaam anker="instellingen" />
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
              {bezig ? "Bezig met rekenen…" : "Reken door"}
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
              Bepaalt hoeveel er te besparen valt. Verandert de jaarbesparing.
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
                  Je netgebied hangt af van je netbeheerder (bijvoorbeeld Liander,
                  Stedin of Enexis); die staat op je jaarafrekening. De gemeten
                  profielen verschillen per regio, vooral in hoeveel zon er op het
                  net staat.
                </p>
              </div>

              <div className="instelling">
                <label htmlFor="van">Periode</label>
                <div className="datum-paar">
                  <input
                    id="van"
                    type="date"
                    min={vroegste}
                    max={totEffectief}
                    value={vanEffectief}
                    onChange={(e) => zetPeriode("van", e.target.value)}
                  />
                  <span>tot</span>
                  <input
                    type="date"
                    min={vanEffectief}
                    max={laatste}
                    value={totEffectief}
                    onChange={(e) => zetPeriode("tot", e.target.value)}
                  />
                </div>
                <p className="instelling-uitleg">
                  Beschikbaar van {datum(vroegste)} tot {datum(laatste)}. Kies je
                  een periode zonder volledig kalenderjaar, dan rekent de tool de
                  uitkomst om naar een jaar (365 gedeeld door het aantal dagen). Een
                  periode korter dan een jaar laat vooral het seizoen zien, niet of
                  de batterij zich terugverdient.
                </p>
              </div>

              <div className="instelling">
                <label htmlFor="opwek">Opwek van je panelen</label>
                <GetalInvoer
                  id="opwek"
                  klein
                  eenheid="kWh per jaar"
                  waarde={inst.opwekKwh}
                  min={GRENZEN.opwekKwh.min}
                  max={GRENZEN.opwekKwh.max}
                  decimalen={GRENZEN.opwekKwh.decimalen}
                  magLeeg
                  placeholder="bijvoorbeeld 3500"
                  onWaarde={(v) => onChange({ opwekKwh: v })}
                />
                <p className="instelling-uitleg">
                  Optioneel. Vul je dit in, dan rekent de tool eigen verbruik en zelf
                  gedekt uit met jouw opwek in plaats van een schatting. Je besparing
                  in euro's verandert er niet door. Ter indicatie: Milieu Centraal
                  rekent met 3.000 kWh per jaar voor acht panelen van 435 Wp, ongeveer
                  860 kWh per kWp.
                </p>
              </div>

              <Schuif
                label="Pieken in je verbruik"
                uitleg="Het gemeten patroon is een gemiddelde over veel huishoudens en daardoor vlakker dan één huis. Zet je dit hoger, dan krijgt je dag meer pieken en dalen. Je jaarverbruik blijft gelijk."
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
              Wat de batterij kan en kost. Maat, vermogen en de keuze voor de
              laadbeurten veranderen de jaarbesparing; prijs en veroudering alleen de
              terugverdientijd.
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
                uitleg="Inclusief installatie. Bepaalt de terugverdientijd. Een duurdere batterij kost per laadbeurt ook meer slijtage."
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
                uitleg="Wat elke kilowattuur extra capaciteit kost in de kaart van maten. Uitbreidingsmodules kosten 234 tot 443 euro per kWh, afhankelijk van het merk (peildatum september 2026)."
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
                uitleg="Boven 800 W is een vaste aansluiting op een eigen groep de norm. Een installateur rekent daarvoor 100 tot 200 euro in een standaardsituatie en 300 tot 600 euro bij een volle meterkast. De tool rekent met 300 euro."
                waarde={inst.installatieEur}
                eenheid="€"
                eenheidVoor
                onChange={(v) => v !== null && onChange({ installatieEur: v })}
              />
              {/* Hoe zuinig de batterij met zijn laadbeurten omgaat is een keuze, geen
                  eigenschap van de batterij, maar hij hoort hier omdat hij bepaalt
                  hoe de aansturing met de slijtage rekent. Drie standen met een
                  naam, en een schuif voor wie er tussenin wil zitten: de knoppen
                  lichten op als de schuif op hun waarde staat. */}
              <div className="instelling instelling-breed">
                <label>Hoe zuinig met de laadbeurten?</label>
                <div className="segment" role="group" aria-label="Hoe zuinig met de laadbeurten">
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
                  {slijtageHint(inst.slijtageDeel)} Een geleverde kWh kost{" "}
                  {centPer(volleSlijtage)} aan slijtage: de aanschafprijs, verdeeld over
                  alle laadbeurten die de batterij aankan. Bij deze stand telt daarvan{" "}
                  {centPer(volleSlijtage * inst.slijtageDeel)} mee.{" "}
                  {slijtageVoorbeeld(inst.slijtageDeel, volleSlijtage, preset.spec.efficiency ** 2)}{" "}
                  Minder meetellen geeft meer laadbeurten en een hogere besparing, maar
                  de batterij is eerder op als zijn laadbeurten opraken voor de kalender.
                </p>
              </div>
              <Schuif
                label="Slijtage die de aansturing meerekent"
                uitleg="Welk deel van de slijtage meetelt bij de keuze om te laden of te leveren; 100% is de volle slijtage. De drie knoppen hierboven zijn vaste standen van deze schuif."
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
              Vast overgenomen van {preset.naam}: van elke 100 kWh die je opslaat,
              komt er {getal(preset.spec.efficiency ** 2 * 100)} terug. Bruikbaar deel{" "}
              {procent(preset.spec.depthOfCharge)}, levensduur {getal(preset.cycleLife)} laadbeurten en{" "}
              {preset.kalenderLevensduurJaren} jaar. Prijs: {preset.prijsNoot},
              richtprijs {PRIJSPEILDATUM}.
            </p>
          </section>

          <section>
            <h3>Je contract</h3>
            <p className="groep-uitleg">
              Bepaalt waartegen alles wordt afgerekend. Verandert de jaarbesparing.
            </p>
            <div className="instelling-grid">
              <Getal
                veld="terugleverkostenCt"
                label="Terugleverkosten"
                uitleg="Wat je leverancier per teruggeleverde kilowattuur rekent. De tool neemt aan dat ANWB Energie geen terugleverkosten rekent, daarom staat dit standaard op 0. Andere leveranciers doen het vaak wel. Voor teruglevering rekent de tool met de marktprijs inclusief btw; ook dat is een aanname."
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
                      ? ` (${centPer(actueleHeffingUit(manifest)!)})`
                      : ""}
                  </button>
                </div>
                <p className="instelling-uitleg">
                  Standaard rekent de tool de uurprijzen van toen met de
                  energiebelasting en opslag van nu: dat past bij een batterij die
                  je vandaag koopt. Kies 'van toen' om per uur de heffing te
                  gebruiken die toen gold.
                  {heffingToenUit(manifest, inst.domein) ? (
                    <>
                      {" "}
                      {heffingToenUit(manifest, inst.domein)}
                      . Met die hogere heffing is de besparing voor de
                      standaardbatterij met zonnepanelen ongeveer{" "}
                      {procent(BESPARING_MET_HEFFING_TOEN)} hoger.
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
                  Regelt je installatie zijn teruglevering terug als de prijs
                  negatief is? Dan lever je op die momenten niets terug en betaal je
                  er niets voor. Sommige omvormers kunnen dat, de meeste doen het
                  niet vanzelf. Daarom staat dit standaard uit: je betaalt dan om je
                  stroom kwijt te raken. Zet het aan als jouw installatie het wel
                  kan.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3>Hoe je ernaar kijkt</h3>
            <p className="groep-uitleg">
              Verandert de terugverdientijd, het netto resultaat en hoeveel minder
              CO2 de batterij voor Nederland betekent.{" "}
              <strong>Niet de jaarbesparing</strong>: wat de batterij doet hangt af
              van prijzen en verbruik, niet van hoe je het beoordeelt.
            </p>
            <div className="instelling-grid">
              <Getal
                veld="analysejaren"
                label="Looptijd"
                uitleg="Over hoeveel jaar je de investering beoordeelt. De batterij zelf gaat door tot zijn eigen levensduur op is."
                waarde={inst.analysejaren}
                eenheid="jaar"
                onChange={(v) => v !== null && onChange({ analysejaren: v })}
              />
              <Percentage
                veld="prijsstijging"
                label="Prijsstijging per jaar"
                uitleg="Hoe hard je verwacht dat het prijsverschil tussen afname en teruglevering groeit. Standaard 0%. De energiebelasting op stroom daalde de afgelopen jaren en is in 2026 11,1 cent per kWh inclusief btw. Het tarief voor 2027 wordt pas eind 2026 vastgesteld. Voor de groothandelsprijs van stroom in 2030 geeft het Planbureau voor de Leefomgeving (PBL) een brede bandbreedte: 53 tot 90 euro per MWh (Klimaat- en Energieverkenning 2026). Zet hem hoger als je anders verwacht."
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
              <Getal
                veld="co2Drempel"
                label="Wanneer telt teruglevering als overschot?"
                uitleg="Op uren waarop de stroom schoner is dan dit, is er vaak meer aanbod dan vraag, en vervangt jouw teruglevering weinig. Die uren tellen niet mee in hoeveel minder CO2 de batterij voor Nederland betekent. Standaard 100 g/kWh; lager telt meer teruglevering als nuttig. Rondt af op stappen van 20."
                waarde={inst.co2Drempel}
                eenheid="g/kWh"
                onChange={(v) => v !== null && onChange({ co2Drempel: v })}
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
