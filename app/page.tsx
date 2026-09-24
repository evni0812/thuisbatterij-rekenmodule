"use client";

import { useEffect, useMemo, useState } from "react";
import { Antwoord } from "../components/Antwoord";
import { BatterijMaat } from "../components/BatterijMaat";
import { BesparingPerJaar } from "../components/BesparingPerJaar";
import { Bewaren } from "../components/Bewaren";
import { Cashflow } from "../components/Cashflow";
import { Co2Antwoord } from "../components/Co2Antwoord";
import { Co2Maanden } from "../components/Co2Maanden";
import { Co2Nederland } from "../components/Co2Nederland";
import { Co2Uren } from "../components/Co2Uren";
import { Laadbeurten } from "../components/Laadbeurten";
import { Dagprofiel } from "../components/Dagprofiel";
import { Doelvergelijking } from "../components/Doelvergelijking";
import { Geavanceerd } from "../components/Geavanceerd";
import { Invoer } from "../components/Invoer";
import { MaandVerloop } from "../components/MaandVerloop";
import { Nettarief } from "../components/Nettarief";
import { Prijskloof } from "../components/Prijskloof";
import { Statistieken } from "../components/Statistieken";
import {
  Paneel,
  STANDAARD_TAB,
  TABS,
  TabStapper,
  Tabs,
  isTabId,
  type TabId,
} from "../components/Tabs";
import { Uitbreiden } from "../components/Uitbreiden";
import { Uitleg } from "../components/Uitleg";
import { Uitsplitsing } from "../components/Uitsplitsing";
import { VoorWie } from "../components/VoorWie";
import { Wachtscherm } from "../components/Wachtscherm";
import { Verantwoording } from "../components/Verantwoording";
import { Verloop } from "../components/Verloop";
import { Verliezen } from "../components/Verliezen";
import { Verschuiving } from "../components/Verschuiving";
import { datum, euro, jarenReeks, periode } from "../lib/format";
import { leesLaatste, leesProfielen, type Profiel } from "../lib/opslag";
import { PRESETS, PRIJSPEILDATUM, geschatteOpwekKwh } from "../lib/presets";
import { STANDAARD, kiesPreset, maakConfiguratie } from "../lib/configuratie";
import { referentieJaar } from "../lib/model/analysis";
import { STANDAARD_CO2_DREMPEL_G } from "../lib/model/co2";
import { ankerVan, kostenVan, kostenregelVan } from "../lib/model/kosten";
import { rasterNiveau } from "../lib/model/dimensionering";
import { wearCostPerKwh } from "../lib/model/battery";
import { UITLEG, type UitlegContext } from "../lib/uitleg";
import { overgangsFinance } from "../lib/overgang";
import { useAnalysis } from "../lib/useAnalysis";
import { leesUrl, schrijfUrl, type Instellingen } from "../lib/url-state";
import { VELDNAAM } from "../lib/normaliseer";
import type { Configuration } from "../lib/worker/protocol";

/** "a", "a en b", "a, b en c": een opsomming in lopende tekst. */
function opsomming(delen: readonly string[]): string {
  if (delen.length <= 1) return delen[0] ?? "";
  return `${delen.slice(0, -1).join(", ")} en ${delen[delen.length - 1]}`;
}

/**
 * De pagina is een verhaal in zes tabbladen, in de volgorde van een gesprek:
 * wat is het antwoord (Start), waarom, wanneer gebeurt het, wat als het anders
 * was, wat scheelt het aan CO2 (Uitstoot), en waar komen de cijfers vandaan
 * (Methode). Elke sectie heeft één plek,
 * één vraag en één knop "Hoe is dit berekend?" met de getallen van deze
 * doorrekening.
 *
 * De panelen blijven gemount; alleen het actieve is zichtbaar. Zo houdt het
 * dagprofiel zijn gekozen dag en hoeft niets opnieuw te renderen als je heen
 * en weer gaat.
 */
export default function Page() {
  const [inst, setInst] = useState<Instellingen>(STANDAARD);
  const [geladen, setGeladen] = useState(false);
  const [tab, setTab] = useState<TabId>(STANDAARD_TAB);
  /** Zet een doorrekening in de wacht tot de nieuwe invoer is verwerkt. */
  const [rekenNa, setRekenNa] = useState(false);
  const [profielen, setProfielen] = useState<Profiel[]>([]);
  const [laatsteBewaard, setLaatsteBewaard] = useState<string | null>(null);
  /** De instellingen kwamen uit de browseropslag, niet uit de URL. */
  const [uitOpslag, setUitOpslag] = useState(false);
  /** Instellingen uit de link die niet klopten en zijn teruggezet of begrensd. */
  const [aangepast, setAangepast] = useState<(keyof Instellingen)[]>([]);

  // De configuratie staat in de URL, zodat elke doorrekening deelbaar is. Een
  // URL met parameters wint van de bewaarde instellingen: een gedeelde link
  // moet laten zien wat de afzender zag.
  useEffect(() => {
    const gecorrigeerd: (keyof Instellingen)[] = [];
    const uitUrl = leesUrl(gecorrigeerd);
    if (gecorrigeerd.length > 0) setAangepast(gecorrigeerd);
    const p = new URLSearchParams(window.location.search);
    const tabUrl = p.get("tab");
    if (isTabId(tabUrl)) setTab(tabUrl);

    const laatste = leesLaatste();
    // Een link met alleen onleesbare instellingen is nog steeds een link: dan
    // de standaard, niet de bewaarde set van de ontvanger.
    if (Object.keys(uitUrl).length === 0 && gecorrigeerd.length === 0 && laatste) {
      setInst(laatste.inst);
      setUitOpslag(true);
    } else {
      setInst((huidig) => ({ ...huidig, ...uitUrl }));
    }
    if (laatste) setLaatsteBewaard(laatste.bewaard);
    setProfielen(leesProfielen());
    setGeladen(true);
  }, []);

  useEffect(() => {
    if (geladen) schrijfUrl(inst, STANDAARD, tab === STANDAARD_TAB ? {} : { tab });
  }, [inst, geladen, tab]);

  const preset = kiesPreset(inst.presetId);
  const capaciteit = inst.capaciteitKwh ?? preset.capaciteitKwh;
  const vermogen = inst.vermogenKw ?? preset.vermogenKw;
  const prijs = inst.prijsEur ?? preset.prijsEur;

  const state = useAnalysis(
    useMemo<Configuration | null>(
      () => (geladen ? maakConfiguratie(inst) : null),
      [geladen, inst],
    ),
    // Het raster en de huishoudens staan alleen op "Wat als"; zolang dat
    // tabblad dicht is, rekent de telefoon er niet aan.
    { rasterNodig: tab === "wat-als" },
  );

  const {
    manifest,
    result,
    busy,
    error,
    voortgang,
    grid,
    huishoudens,
    vergelijking,
    dag,
    dagBezig,
    scenario,
    scenarioJaar,
    dagOntbreekt,
    vraagDag,
    wisDag,
    periode: periodeReeks,
    periodeBezig,
    vraagPeriode,
    week,
    weekBezig,
    vraagWeek,
    herbereken,
    getoondeConfig,
    verouderd,
    fataal,
    probeerOpnieuw,
    scenarioFout,
    uitCache,
  } = state;

  // Een netgebied dat niet in de data staat (een oude of verminkte link) gaf
  // een technische foutmelding. Terug naar het standaardnetgebied, en zeggen.
  useEffect(() => {
    if (!manifest || manifest.netgebieden.includes(inst.domein)) return;
    if (!manifest.netgebieden.includes(STANDAARD.domein)) return;
    setInst((s) => ({ ...s, domein: STANDAARD.domein }));
    setAangepast((a) => (a.includes("domein") ? a : [...a, "domein"]));
  }, [manifest, inst.domein]);

  // Alles wat naast het resultaat wordt getoond, komt uit de configuratie die
  // bij dát resultaat hoort — niet uit de live invoer. Anders staat een verse
  // batterijprijs naast een oude terugverdientijd in dezelfde zin.
  const toon = getoondeConfig;
  const toonPrijs = toon?.investmentEur ?? prijs;
  const toonAfname = toon?.household.annualGridImportKwh ?? inst.afnameKwh;
  const toonTeruglevering =
    toon?.household.annualGridExportKwh ?? inst.terugleveringKwh;
  // De jaaropwek staat er altijd in: vult de bezoeker hem niet in, dan schat de
  // configuratie hem uit de teruglevering. "Bekend" betekent hier dus: het is
  // zijn eigen getal, niet onze schatting — en dat is aan het verschil met die
  // schatting te zien.
  const toonOpwekBekend = toon
    ? Math.abs(
        (toon.annualProductionKwh ?? 0) -
          geschatteOpwekKwh(toon.household.annualGridExportKwh),
      ) > 0.5
    : false;
  const toonCapaciteit = toon?.battery.capacityKwh ?? capaciteit;
  const toonVermogen = toon?.battery.maxChargeKw ?? vermogen;

  const periodeLabel = result
    ? periode(
        result.perYear[0]?.firstDay ?? "",
        result.perYear[result.perYear.length - 1]?.lastDay ?? "",
      )
    : "";

  // Een klik in het batterijraster is een opdracht om door te rekenen; dat kan
  // pas als de gewijzigde invoer in de configuratie is verwerkt.
  useEffect(() => {
    if (!rekenNa) return;
    setRekenNa(false);
    herbereken();
  }, [rekenNa, herbereken]);

  // De terugverdientijd van een batterij die je vandaag koopt: de eerste jaren
  // op het huidige tarief, daarna op het nettarief van 2029. Geen van beide
  // doorrekeningen op zichzelf zegt dat — de een doet alsof het nieuwe tarief
  // er nooit komt, de ander alsof het er al is.
  const overgang =
    result && scenario && toon ? overgangsFinance(result, scenario, toon) : null;

  // De context voor "Hoe is dit berekend?": de getallen van dít resultaat.
  const ctx: UitlegContext | null =
    result && toon ? { result, scenario, config: toon, preset, scenarioJaar, vergelijking } : null;
  const uitleg = (id: keyof typeof UITLEG) => (ctx ? <Uitleg blok={UITLEG[id](ctx)} /> : undefined);

  // Alle jaarcijfers op de pagina rusten op dezelfde grondslag: het gemiddelde
  // over de volledige profieljaren. Eén zin die dat benoemt, zodat elke sectie
  // dezelfde periode noemt als de uitleg erachter.
  const volledigeJaren = result?.perYear.filter((j) => j.isFullYear) ?? [];
  const gemiddeldLabel =
    volledigeJaren.length > 1
      ? `een gemiddeld jaar, ${volledigeJaren[0]!.year} tot en met ${
          volledigeJaren[volledigeJaren.length - 1]!.year
        }`
      : volledigeJaren.length === 1
        ? String(volledigeJaren[0]!.year)
        : periodeLabel;
  // Hetzelfde, maar als bijwoordelijke bepaling voor de CO2-zin ("kostte …").
  const co2PeriodeLabel =
    volledigeJaren.length > 1
      ? `gemiddeld per jaar over ${jarenReeks(volledigeJaren.map((j) => j.year))}`
      : volledigeJaren.length === 1
        ? `in ${volledigeJaren[0]!.year}`
        : `in ${periodeLabel}`;
  // Rekende het getoonde resultaat met het profiel zonder zonnepanelen?
  const toonZonnepanelen = toon ? toon.afnametype !== "AZI" : inst.zonnepanelen;
  const datadekking = manifest
    ? (() => {
        const jaren = Object.values(manifest.profielen[inst.domein] ?? {});
        const a = jaren[0]?.eerste_dag;
        const b = jaren[jaren.length - 1]?.laatste_dag;
        return a && b ? `Data ${datum(a)} tot ${datum(b)}` : "";
      })()
    : "";

  const wachtOpResultaat = !result ? (
    <div className="notitie">
      <p>
        {fataal ? (
          <>
            De gegevens voor de berekening konden niet worden geladen, dus dit
            tabblad blijft leeg. Op het tabblad Start kun je het opnieuw
            proberen.
          </>
        ) : error ? (
          <>
            De berekening is mislukt, dus dit tabblad blijft leeg. Op het
            tabblad Start kun je het opnieuw proberen.
          </>
        ) : (
          <>De doorrekening loopt nog. Dit tabblad vult zich zodra het antwoord er is.</>
        )}
      </p>
    </div>
  ) : null;

  return (
    <div className="schil">
      <header className="balk">
        <a className="balk-merk" href="/">
          Thuisbatterij <span>Rekentool</span>
        </a>
        <Tabs actief={tab} onKies={setTab} />
        {datadekking ? <span className="balk-meta">{datadekking}</span> : null}
      </header>

      <main className="pagina">
        {/* Eén plek, op elk tabblad: wat er gebeurt terwijl er gerekend wordt,
            of dat er nog gerekend móet worden. */}
        <Wachtscherm
          voortgang={voortgang}
          bezig={busy}
          verouderd={verouderd}
          eersteKeer={!result}
          onBereken={herbereken}
        />

        {/* ── Start ──────────────────────────────────────────────────────── */}
        <Paneel id="start" actief={tab}>
          <div className="sectiekop">
            <span className="eyebrow">{TABS[0].label} · {TABS[0].vraag}</span>
            <h1>Wat had een thuisbatterij je opgeleverd?</h1>
            <p>
              Op 1 januari 2027 stopt de salderingsregeling. Met een dynamisch
              contract krijg je voor teruglevering dan de kale marktprijs van dat
              uur, min eventuele terugleverkosten. Voor afname betaal je het volle
              tarief, met belasting. Deze tool rekent door wat een thuisbatterij
              je in die situatie had bespaard, op de{" "}
              <strong>werkelijke uurprijzen</strong> van ANWB Energie en het{" "}
              <strong>gemeten gemiddelde verbruikspatroon</strong> in jouw
              netgebied, geschaald naar jouw jaartotalen. Drie getallen van je
              jaarafrekening zijn genoeg.
            </p>
            <p>
              Deze doorrekening gaat uit van een dynamisch energiecontract en een
              batterij die zelf op de uurprijzen stuurt. Heb je een vast of
              variabel contract? Dan krijg je tot en met 2030 voor teruglevering
              minstens 50% van het kale leveringstarief; die situatie rekent deze
              tool niet door.
            </p>
          </div>

          {uitOpslag ? (
            <div className="notitie" role="status">
              <p>
                <b>Je bewaarde instellingen zijn geladen.</b> Wil je toch met de
                standaardwaarden beginnen? Dan kan dat hier.
              </p>
              <button
                type="button"
                className="knop licht klein"
                onClick={() => {
                  setInst(STANDAARD);
                  setUitOpslag(false);
                }}
              >
                Standaardwaarden
              </button>
            </div>
          ) : null}

          {aangepast.length > 0 ? (
            <div className="notitie" role="status">
              <p>
                <b>Niet alles uit de link was bruikbaar.</b>{" "}
                {aangepast.length === 1 ? "Deze instelling stond" : "Deze instellingen stonden"}{" "}
                er niet goed in en {aangepast.length === 1 ? "is" : "zijn"} vervangen door
                een geldige waarde: {opsomming(aangepast.map((k) => VELDNAAM[k]))}. De
                uitkomst hieronder rekent daarmee. Kijk{" "}
                {aangepast.length === 1 ? "hem" : "ze"} na bij de instellingen als je
                iets anders bedoelde.
              </p>
              <button type="button" className="knop licht klein" onClick={() => setAangepast([])}>
                Begrepen
              </button>
            </div>
          ) : null}

          <Invoer
            afnameKwh={inst.afnameKwh}
            terugleveringKwh={inst.terugleveringKwh}
            zonnepanelen={inst.zonnepanelen}
            presetId={inst.presetId}
            onAfname={(v) => setInst((s) => ({ ...s, afnameKwh: v }))}
            onTeruglevering={(v) => setInst((s) => ({ ...s, terugleveringKwh: v }))}
            onZonnepanelen={(v) => setInst((s) => ({ ...s, zonnepanelen: v }))}
            onPreset={(id) =>
              setInst((s) => ({
                ...s,
                presetId: id,
                capaciteitKwh: null,
                vermogenKw: null,
                prijsEur: null,
              }))
            }
            doel={inst.doel}
            onDoel={(d) => setInst((s) => ({ ...s, doel: d }))}
            slijtageDeel={inst.slijtageDeel}
            onSlijtageDeel={(deel) => setInst((s) => ({ ...s, slijtageDeel: deel }))}
            slijtageprijsEur={wearCostPerKwh(prijs, preset.cycleLife, {
              ...preset.spec,
              capacityKwh: capaciteit,
              maxChargeKw: vermogen,
              maxDischargeKw: vermogen,
              wearCostEurPerKwh: 0,
            })}
            rondgang={preset.spec.efficiency ** 2}
            onBereken={herbereken}
            verouderd={verouderd}
            bezig={busy}
          />

          {error ? (
            <p className="fout" role="alert">
              De berekening is mislukt. Probeer het opnieuw met de knop Reken
              door; lukt dat niet, laad dan de pagina opnieuw.{" "}
              <span className="fout-detail">(Technische melding: {error})</span>
            </p>
          ) : null}

          {fataal ? (
            <div className="notitie" role="alert">
              <p>
                <b>De gegevens voor de berekening konden niet worden geladen.</b>{" "}
                {result && uitCache
                  ? "Hieronder staat je vorige berekening, bewaard in deze browser; die kan op iets oudere gegevens rusten. "
                  : "Zonder die gegevens kan de tool niets uitrekenen. "}
                Controleer je internetverbinding en probeer het opnieuw.{" "}
                <span className="fout-detail">(Technische melding: {fataal})</span>
              </p>
              <button type="button" className="knop licht klein" onClick={probeerOpnieuw}>
                Opnieuw proberen
              </button>
            </div>
          ) : null}

          {!result && !error && !fataal ? (
            <p className="laden">De gegevens worden geladen…</p>
          ) : null}

          {result ? (
            <>
              <Antwoord
                result={result}
                scenario={scenario}
                overgang={overgang}
                investeringEur={toonPrijs}
                bezig={busy}
                heffingVanNu={toon?.useHistoricalLevy === false}
                actie={uitleg("antwoord")}
              />

              <Statistieken
                stats={result.stats}
                scenarioStats={scenario?.stats ?? null}
                opwekBekend={toonOpwekBekend}
                geschatteOpwek={toon?.annualProductionKwh ?? 0}
                context={ctx}
              />
            </>
          ) : null}

          <Geavanceerd
            inst={inst}
            manifest={manifest}
            preset={preset}
            capaciteit={capaciteit}
            vermogen={vermogen}
            prijs={prijs}
            onChange={(patch) => setInst((s) => ({ ...s, ...patch }))}
            onReset={() => setInst(STANDAARD)}
            onBereken={herbereken}
            verouderd={verouderd}
            bezig={busy}
          />

          <Bewaren
            inst={inst}
            profielen={profielen}
            onProfielen={setProfielen}
            laatsteBewaard={laatsteBewaard}
            onLaatste={setLaatsteBewaard}
            onLaad={(geladenInst) => {
              setInst(geladenInst);
              setUitOpslag(false);
              setRekenNa(true);
            }}
          />
        </Paneel>

        {/* ── Waarom ─────────────────────────────────────────────────────── */}
        <Paneel id="waarom" actief={tab}>
          <div className="sectiekop">
            <span className="eyebrow">Waarom · {TABS[1].vraag}</span>
            <h2>Je betaalt veel meer voor stroom dan je ervoor terugkrijgt</h2>
            <p>
              Zonder saldering is het gat tussen wat afname kost en wat
              teruglevering oplevert het hele verdienmodel van een batterij. Hier
              staat hoe groot dat gat is, uit welke posten de besparing bestaat, en
              wat er onderweg verloren gaat.
            </p>
          </div>
          {wachtOpResultaat}
          {result ? (
            <>
              <Prijskloof
                gap={result.priceGap}
                afnameKwh={toonAfname}
                terugleveringKwh={toonTeruglevering}
                actie={uitleg("prijskloof")}
              />
              <Uitsplitsing
                breakdown={result.breakdown}
                periodeLabel={gemiddeldLabel}
                actie={uitleg("uitsplitsing")}
              />
              <Verliezen
                losses={result.losses}
                afnameKwh={toonAfname}
                besparingEur={result.averageSavingEur}
                actie={uitleg("verliezen")}
              />
            </>
          ) : null}
        </Paneel>

        {/* ── Wanneer ────────────────────────────────────────────────────── */}
        <Paneel id="wanneer" actief={tab}>
          <div className="sectiekop">
            <span className="eyebrow">Wanneer · {TABS[2].vraag}</span>
            <h2>Elk jaar levert iets op, maar niet evenveel, en niet in elke maand</h2>
            <p>
              Van grof naar fijn: per profieljaar, door het jaar heen, over de
              uren van een gemiddelde dag, en ten slotte één dag van dichtbij.
              Hoe grilliger de prijzen, hoe meer een batterij verdient; en een
              zomerdag ziet er heel anders uit dan een winterdag.
            </p>
          </div>
          {wachtOpResultaat}
          {result ? (
            <>
              <BesparingPerJaar jaren={result.perYear} actie={uitleg("perJaar")} />
              <MaandVerloop maanden={result.perMonth} actie={uitleg("maandverloop")} />
              <Verschuiving
                profielen={result.seasonProfiles ?? []}
                actie={uitleg("verschuiving")}
              />
              <Verloop
                periode={periodeReeks}
                bezig={periodeBezig}
                eersteDag={result.perYear[0]?.firstDay ?? ""}
                laatsteDag={result.perYear[result.perYear.length - 1]?.lastDay ?? ""}
                onVraag={vraagPeriode}
                onKiesDag={vraagDag}
                actie={uitleg("verloop")}
              />
              <Dagprofiel
                voorbeelden={result.sampleDays}
                losseDag={dag}
                ontbreekt={dagOntbreekt}
                bezig={dagBezig}
                eersteDag={result.perYear[0]?.firstDay ?? ""}
                laatsteDag={result.perYear[result.perYear.length - 1]?.lastDay ?? ""}
                onVraagDag={vraagDag}
                onWisDag={wisDag}
                week={week}
                weekBezig={weekBezig}
                onVraagWeek={vraagWeek}
                actie={uitleg("dagprofiel")}
              />
            </>
          ) : null}
        </Paneel>

        {/* ── Wat als ────────────────────────────────────────────────────── */}
        <Paneel id="wat-als" actief={tab}>
          <div className="sectiekop">
            <span className="eyebrow">Wat als · {TABS[3].vraag}</span>
            <h2>Een ander nettarief, een ander doel of een andere maat verandert de uitkomst</h2>
            <p>
              Wat doet het tijdsafhankelijke nettarief als het voorstel van de
              ACM doorgaat (naar verwachting vanaf 1 januari 2029, mogelijk
              later), wat verandert er als de batterij op zelfconsumptie of
              uitstoot stuurt in plaats van op rendement, welke maat batterij
              loont netto en tot waar loont uitbreiden, voor wie kan deze
              batterij uit, hoe zuinig gaat hij met zijn laadbeurten om, en hoe
              ziet de investering er over de looptijd uit.
            </p>
          </div>
          {wachtOpResultaat}
          {result ? (
            <>
              <Nettarief
                huidig={result}
                scenario={scenario}
                overgang={overgang}
                actie={uitleg("nettarief")}
              />
              {scenarioFout && !scenario ? (
                <p className="fout" role="alert">
                  De berekening met het nettarief van 2029 is mislukt. De cijfers
                  met het huidige tarief kloppen wel. Laad de pagina opnieuw om
                  het nog eens te proberen.{" "}
                  <span className="fout-detail">(Technische melding: {scenarioFout})</span>
                </p>
              ) : null}
              {toon ? (
                <>
                  <Doelvergelijking
                    vergelijking={vergelijking}
                    config={toon}
                    zonnepanelen={toonZonnepanelen}
                    bezig={busy}
                    onKies={(doel) => {
                      // Een expliciete opdracht, net als een klik op de kaart
                      // van maten: het doel in de instellingen en meteen
                      // doorrekenen, zodat de hele pagina meeloopt.
                      setInst((s) => ({ ...s, doel }));
                      setRekenNa(true);
                    }}
                    actie={uitleg("doelen")}
                  />
                  <BatterijMaat
                    grid={grid}
                    huidigeCapaciteit={toonCapaciteit}
                    huidigVermogen={toonVermogen}
                    config={toon}
                    curve={result.curve}
                    niveau={rasterNiveau(result)}
                    jaar={referentieJaar(result).year}
                    onKies={(cap, kw) => {
                      // Een klik op een vakje is een expliciete opdracht: meteen
                      // doorrekenen. Anders kost de klik je het raster en levert
                      // hij niets op, want de rekenknop staat op een ander
                      // tabblad. De prijs gaat mee: de maat uit de kaart met de
                      // prijs die de kaart ervoor rekende, anders rekent de
                      // hoofddoorrekening een grote batterij voor de prijs van de
                      // kleine.
                      const prijs = Math.round(kostenVan(ankerVan(toon), kostenregelVan(toon), cap, kw));
                      setInst((s) => ({ ...s, capaciteitKwh: cap, vermogenKw: kw, prijsEur: prijs }));
                      setRekenNa(true);
                    }}
                    actie={uitleg("batterijmaat")}
                  />
                  <Uitbreiden grid={grid} config={toon} curve={result.curve} niveau={rasterNiveau(result)} actie={uitleg("uitbreiden")} />
                  <VoorWie huishoudens={huishoudens} result={result} config={toon} actie={uitleg("voorwie")} />
                </>
              ) : null}
              {toon ? (
                <Laadbeurten
                  finance={result.finance}
                  stats={result.stats}
                  config={toon}
                  actie={uitleg("beurten")}
                />
              ) : null}
              <Cashflow
                finance={result.finance}
                overgang={overgang}
                investeringEur={toonPrijs}
                actie={uitleg("cashflow")}
              />
            </>
          ) : null}
        </Paneel>

        {/* ── Uitstoot ───────────────────────────────────────────────────── */}
        <Paneel id="uitstoot" actief={tab}>
          <div className="sectiekop">
            <span className="eyebrow">Uitstoot · {TABS[4].vraag}</span>
            <h2>Wat scheelt de batterij aan CO2?</h2>
            <p>
              Elke kWh uit het net is op dat uur met een bepaalde uitstoot
              opgewekt: veel als gascentrales draaien, weinig als de zon
              schijnt en het waait. Eerst wat de batterij voor jouw eigen
              voetafdruk doet, dan wanneer stroom schoon is en waar de winst
              valt, en tot slot wat het voor Nederland als geheel scheelt, want
              daar telt je teruglevering ook mee.
            </p>
          </div>
          {wachtOpResultaat}
          {result && toon ? (
            result.co2 ? (
              <>
                <Co2Antwoord
                  co2={result.co2}
                  periodeLabel={co2PeriodeLabel}
                  zonnepanelen={toonZonnepanelen}
                  doel={toon.doel}
                  actie={uitleg("co2antwoord")}
                />
                <Co2Uren co2={result.co2} profielen={result.seasonProfiles ?? []} actie={uitleg("co2uren")} />
                <Co2Maanden co2={result.co2} zonnepanelen={toonZonnepanelen} actie={uitleg("co2maanden")} />
                <Co2Nederland
                  co2={result.co2}
                  drempel={toon.co2DrempelG ?? STANDAARD_CO2_DREMPEL_G}
                  zonnepanelen={toonZonnepanelen}
                  onDrempel={(g) => setInst((s) => ({ ...s, co2Drempel: g }))}
                  actie={uitleg("co2nederland")}
                />
              </>
            ) : (
              <div className="notitie">
                <p>
                  Voor deze periode zijn er geen emissiefactoren van de stroommix in
                  de data, dus de CO2-balans blijft leeg. De reeks van het Nationaal
                  Energie Dashboard loopt van 2023 tot nu.
                </p>
              </div>
            )
          ) : null}
        </Paneel>

        {/* ── Methode ────────────────────────────────────────────────────── */}
        <Paneel id="methode" actief={tab}>
          <div className="sectiekop">
            <span className="eyebrow">Methode · {TABS[5].vraag}</span>
            <h2>Waar de cijfers vandaan komen, en wat we eerlijk moeten zeggen</h2>
            <p>
              Geen voorspelling maar een doorrekening op wat er echt gebeurd is.
              Hieronder de data, de grenzen van het model, en de aannames die nog
              kunnen bewegen.
            </p>
          </div>
          {wachtOpResultaat}
          {result && manifest ? (
            <Verantwoording manifest={manifest} result={result} domein={inst.domein} />
          ) : null}

          <section className="figure">
            <div className="figure-kop">
              <div>
                <h3>Wat we niet weten</h3>
                <p className="figure-uitleg">
                  De richting van de uitkomst is stevig; de exacte hoogte niet.
                  Dit zijn de aannames waar het om draait.
                </p>
              </div>
            </div>
            <ul className="methode-lijst">
              <li>
                <b>Het verbruikspatroon is een gemiddelde.</b> We rekenen met het
                gemeten gemiddelde kwartierpatroon van alle kleinverbruikers (E1A)
                met, of zonder, teruglevering in jouw netgebied, geschaald naar
                jouw jaartotalen. Dat is geen meting van één huishouden: pieken
                van een waterkoker of een laadpaal zijn uitgemiddeld, en een
                warmtepomp of elektrische auto zit er niet apart in. Of de
                uitkomst daardoor te hoog of te laag is, weten we niet. Met de
                schuif "Pieken in je verbruik" zie je hoe gevoelig hij ervoor is.
                <span className="badge let-op">richting onzeker</span>
              </li>
              <li>
                <b>De batterij kent de toekomst niet.</b> De strategie plant op de
                day-ahead-prijzen, die rond 13.00 uur voor de volgende dag bekend
                worden, en op een eenvoudige verwachting van je verbruik en opwek
                uit de afgelopen dagen. Alleen het optimum dat ter vergelijking
                in de figuren staat, rekent met perfecte kennis vooraf.
                <span className="badge neutraal">aanname</span>
              </li>
              <li>
                <b>Het verleden staat model voor de toekomst.</b> Voor de
                terugverdientijd herhalen we de doorgerekende jaren over de hele
                looptijd, standaard zonder prijsstijging (0% per jaar). De
                looptijd is een aanname voor de beoordeling, geen
                fabrieksgarantie; die is vaak 10 jaar.
                <span className="badge let-op">aanname</span>
              </li>
              <li>
                <b>Eén leverancier, afgeronde uurprijzen.</b> De prijzen zijn van
                ANWB Energie. Een andere dynamische leverancier rekent een andere
                opslag; dat verschuift de kosten, nauwelijks de besparing. Sinds
                20 juni 2026 geeft de ANWB de prijzen afgerond op hele centen. En
                sinds 1 oktober 2025 hebben de day-ahead-prijzen een kwartier als
                eenheid; de tool rekent met het gemiddelde per uur, dus
                prijsverschillen binnen een uur vallen weg.
                <span className="badge goed">klein effect</span>
              </li>
              <li>
                <b>Het nettarief van 2029 is een voorstel.</b> De blokken en
                wegingsfactoren staan in het voorstel van de netbeheerders; het
                basistarief is een prognose van CE Delft, in opdracht van NVDE,
                Holland Solar, Energie-Nederland en Energy Storage NL. De ACM
                heeft nog niet beslist. Invoering is "in beginsel" 1 januari
                2029, mogelijk later.
                <span className="badge let-op">te toetsen eind 2026</span>
              </li>
              <li>
                <b>De belasting van nu.</b> De uurprijzen zijn van toen, de
                energiebelasting en opslag van nu. Zo past de uitkomst bij een
                batterij die je vandaag koopt. In 2024 en 2025 lag de heffing een
                kwart tot een derde hoger, en de besparing schaalt daar bijna
                één-op-één mee. Bij de geavanceerde instellingen kies je "van
                toen"; het nettariefscenario rekent met de belasting van 2029.
                <span className="badge let-op">kan veranderen</span>
              </li>
              <li>
                <b>Terugleverkosten staan standaard op 0 cent.</b> ANWB Energie
                rekent ze niet, andere leveranciers vaak wel. Vul je eigen bedrag
                in bij de geavanceerde instellingen.
                <span className="badge neutraal">zelf in te vullen</span>
              </li>
              <li>
                <b>Afregelen bij negatieve prijzen is een aanname.</b> Het model
                gaat ervan uit dat je installatie stopt met terugleveren als de
                prijs negatief is. Sommige omvormers en
                energiemanagementsystemen kunnen dat; de meeste doen het niet
                vanzelf. Kan jouw installatie het niet, zet het dan uit bij de
                geavanceerde instellingen.
                <span className="badge let-op">aanname</span>
              </li>
              <li>
                <b>Het eigen verbruik van de batterij zit er niet in.</b> Een
                thuisbatterij gebruikt ook stroom als hij niets doet, meestal 7
                tot 25 watt: 60 tot 220 kWh per jaar. Dat is niet van de
                besparing afgetrokken.
                <span className="badge let-op">besparing valt lager uit</span>
              </li>
              <li>
                <b>CO2 is een toerekening.</b> We rekenen met de gemiddelde
                uitstoot van de Nederlandse opwek per uur, niet met de marginale
                uitstoot van de centrale die op- of afregelt. De uitstoot van het
                maken van de batterij is niet meegerekend.
                <span className="badge neutraal">geen meting</span>
              </li>
              <li>
                <b>Batterijprijzen bewegen.</b> De richtprijzen zijn van{" "}
                {PRIJSPEILDATUM}; vul je eigen offerte in bij de geavanceerde
                instellingen.
                <span className="badge neutraal">zelf in te vullen</span>
              </li>
              <li>
                <b>Aanmelden en installeren.</b> Een thuisbatterij meld je aan bij
                je netbeheerder via energieleveren.nl. Boven 800 W is een vaste
                aansluiting op een eigen groep door een installateur de norm; de
                kaart van maten rekent daar een bedrag voor.
                <span className="badge neutraal">niet in de besparing</span>
              </li>
              <li>
                <b>Wat er verder niet in zit.</b> Vastrecht, belastingvermindering
                en het vaste deel van de netbeheerkosten: met en zonder batterij
                gelijk. Terugleverkosten alleen als één instelbaar bedrag per
                kWh; geen staffels per leverancier. Geen kosten voor slimme
                sturing.
                <span className="badge neutraal">bewust buiten beeld</span>
              </li>
            </ul>
          </section>

          <section className="figure">
            <div className="figure-kop">
              <div>
                <h3>Bronnen</h3>
                <p className="figure-uitleg">
                  Waar de data en de aannames vandaan komen. Geraadpleegd op
                  24 september 2026.
                </p>
              </div>
            </div>
            <ul className="methode-lijst">
              <li>
                <b>Uurprijzen:</b> ANWB Energie, dynamische uurtarieven via de
                ANWB-API (
                <a href="https://api.anwb.nl/energy/energy-services/v2/tarieven/electricity">
                  api.anwb.nl
                </a>
                ). Sinds 20 juni 2026 afgerond op hele centen. Sinds 1 oktober
                2025 zijn day-ahead-prijzen per kwartier; de tool rekent met
                uurgemiddelden.
              </li>
              <li>
                <b>Verbruikspatronen:</b> MFFBAS/EDSN, profielfracties per
                kwartier, categorie E1A, met en zonder teruglevering (
                <a href="https://www.energiedatawijzer.nl">energiedatawijzer.nl</a>
                ).
              </li>
              <li>
                <b>CO2 per uur:</b> Nationaal Energie Dashboard, emissiefactor
                van de elektriciteitsmix (type 27, ElectricityMix) (
                <a href="https://ned.nl">ned.nl</a>).
              </li>
              <li>
                <b>Nettarief:</b> ACM, voorstel codewijziging volume- en
                tijdsafhankelijke transporttarieven voor kleinverbruikers,
                BR-2026-2242 (
                <a href="https://www.acm.nl/nl/publicaties/voorstel-codewijziging-volume-en-tijdsafhankelijke-transporttarieven-voor-kleinverbruikers">
                  acm.nl
                </a>
                ). Basistarief: prognose van CE Delft (september 2026), in
                opdracht van NVDE, Holland Solar, Energie-Nederland en Energy
                Storage NL.
              </li>
              <li>
                <b>Energiebelasting 2026:</b> Belastingdienst (
                <a href="https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/overige_belastingen/belastingen_op_milieugrondslag/energiebelasting/energiebelasting">
                  belastingdienst.nl
                </a>
                ).
              </li>
              <li>
                <b>Einde saldering:</b> Rijksoverheid, salderingsregeling (
                <a href="https://www.rijksoverheid.nl/themas/klimaat-milieu-en-natuur/energie-thuis/salderingsregeling">
                  rijksoverheid.nl
                </a>
                ).
              </li>
              <li>
                <b>Slijtage in de aansturing:</b> B. Xu e.a., <i>Factoring the
                Cycle Aging Cost of Batteries Participating in Electricity
                Markets</i>, IEEE Transactions on Power Systems 33(2), 2018 (
                <a href="https://doi.org/10.1109/TPWRS.2017.2733339">
                  doi:10.1109/TPWRS.2017.2733339
                </a>
                ); Schade en Egging-Bratseth, <i>Battery degradation:
                Impact on economic dispatch</i>, Energy Storage 6(2), 2024 (
                <a href="https://doi.org/10.1002/est2.588">doi:10.1002/est2.588</a>
                ).
              </li>
              <li>
                <b>Batterijprijzen:</b> richtprijzen van {PRIJSPEILDATUM}:{" "}
                {PRESETS.map((p) => `${p.naam} ${euro(p.prijsEur)} (${p.prijsNoot})`).join("; ")}.
              </li>
              <li>
                <b>Auto ter vergelijking:</b> 149 g CO2 per km uit de uitlaat voor
                een middelgrote benzineauto (
                <a href="https://co2emissiefactoren.nl">co2emissiefactoren.nl</a>
                , 2025), afgerond op 150 g.
              </li>
            </ul>
          </section>
        </Paneel>
      </main>

      {/* Verder lezen: de tablist bovenin is om ergens naartoe te springen,
          deze is om door te stappen. Eén keer, na de panelen — alleen het
          actieve paneel is zichtbaar, dus hij staat altijd onder wat je leest. */}
      <TabStapper actief={tab} onKies={setTab} />

      <footer className="voet">
        <span>
          Bronnen: MFFBAS/EDSN profielfracties · ANWB Energie uurtarieven · NED
          · CE Delft en Netbeheer Nederland (nettarief 2029). Deze tool is van de
          ANWB. De ANWB verkoopt ook energie en thuisbatterijen. De uitkomsten
          zijn een doorrekening op historische prijzen, geen persoonlijk advies
          en geen garantie.
        </span>
        {manifest ? <span>Data gegenereerd {datum(manifest.gegenereerd.slice(0, 10))}</span> : null}
      </footer>
    </div>
  );
}
