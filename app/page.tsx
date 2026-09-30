"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { FiguurNaam } from "../components/chart-parts";
import {
  OpDitTabblad,
  Paneel,
  STANDAARD_TAB,
  TabEyebrow,
  TabStapper,
  Tabs,
  leesTab,
  tabVanAnker,
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
import { STANDAARD, effectieveBatterij, kiesPreset, maakConfiguratie } from "../lib/configuratie";
import { referentieJaar } from "../lib/model/analysis";
import { STANDAARD_CO2_DREMPEL_G } from "../lib/model/co2";
import { ankerVan, kostenVan, kostenregelVan } from "../lib/model/kosten";
import { rasterNiveau } from "../lib/model/dimensionering";
import { wearCostPerKwh } from "../lib/model/battery";
import { UITLEG, type UitlegContext } from "../lib/uitleg";
import { overgangsFinance } from "../lib/overgang";
import { BESPARING_MET_HEFFING_TOEN, heffingToenTekst } from "../lib/nettarief";
import { useAnalysis } from "../lib/useAnalysis";
import { leesUrl, schrijfUrl, type Instellingen } from "../lib/url-state";
import { VELDNAAM, klemOpBeschikbaar } from "../lib/normaliseer";
import type { Configuration } from "../lib/worker/protocol";

/** "a", "a en b", "a, b en c": een opsomming in lopende tekst. */
function opsomming(delen: readonly string[]): string {
  if (delen.length <= 1) return delen[0] ?? "";
  return `${delen.slice(0, -1).join(", ")} en ${delen[delen.length - 1]}`;
}

/**
 * De pagina is een verhaal in zeven tabbladen, elk over één onderwerp: de
 * uitkomst, waar de besparing vandaan komt, hoe die door het jaar valt, of de
 * batterij zich terugverdient, welke batterij het beste past, wat hij scheelt
 * aan CO2, en de aannames en bronnen. Elk tabblad opent met dezelfde kop:
 * het onderwerp, één vraag en een inhoudsopgave. Elke figuur heeft een vaste
 * naam, een conclusie als titel en één knop "Hoe is dit berekend?" met de
 * getallen van deze doorrekening.
 *
 * De panelen blijven gemount; alleen het actieve is zichtbaar. Zo houdt het
 * dagprofiel zijn gekozen dag en hoeft niets opnieuw te renderen als je heen
 * en weer gaat.
 */
export default function Page() {
  const [inst, setInst] = useState<Instellingen>(STANDAARD);
  const [geladen, setGeladen] = useState(false);
  const [tab, setTab] = useState<TabId>(STANDAARD_TAB);
  /**
   * De volgende URL-update hoort bij een tabwissel door de gebruiker en krijgt
   * een eigen stap in de geschiedenis (de terugknop gaat dan naar het vorige
   * tabblad). Invoer wijzigen vervangt alleen de huidige stap.
   */
  const duwTab = useRef(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const kiesTab = useCallback((id: TabId) => {
    if (id !== tabRef.current) duwTab.current = true;
    setTab(id);
  }, []);
  /**
   * Een anker uit de link (`#per-maand`) waar nog naartoe gescrold moet
   * worden. De figuur bestaat pas als zijn tabblad open is en het antwoord er
   * is; tot dan wacht het anker hier.
   */
  const wachtendAnker = useRef<string | null>(null);
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
    // Ook een tabblad van vóór de herindeling (?tab=wat-als) komt goed uit.
    const tabUrl = leesTab(p.get("tab"));
    if (tabUrl) setTab(tabUrl);
    // Een anker wint van het tabblad: het wijst een figuur aan, en die staat
    // maar op één tabblad.
    const anker = window.location.hash.slice(1);
    const tabAnker = tabVanAnker(anker);
    if (tabAnker) {
      setTab(tabAnker);
      wachtendAnker.current = anker;
    }

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

  // Een link naar een figuur op een ander tabblad (of met de hand in de
  // adresbalk) opent eerst dat tabblad; de browser kan niet scrollen naar iets
  // dat verborgen is.
  useEffect(() => {
    const opHash = () => {
      const anker = window.location.hash.slice(1);
      const tabAnker = tabVanAnker(anker);
      if (!tabAnker) return;
      setTab(tabAnker);
      wachtendAnker.current = anker;
    };
    // De terugknop (of vooruit): het tabblad volgt de URL waar de browser naartoe
    // gaat. De invoer niet: die wijzigt de huidige stap alleen, en terug naar
    // een tabblad hoort niet te betekenen dat je invoer terugspringt.
    const opTerug = () => {
      const p = new URLSearchParams(window.location.search);
      const anker = window.location.hash.slice(1);
      const tabAnker = tabVanAnker(anker);
      if (tabAnker) wachtendAnker.current = anker;
      setTab(tabAnker ?? leesTab(p.get("tab")) ?? STANDAARD_TAB);
    };
    window.addEventListener("hashchange", opHash);
    window.addEventListener("popstate", opTerug);
    return () => {
      window.removeEventListener("hashchange", opHash);
      window.removeEventListener("popstate", opTerug);
    };
  }, []);

  useEffect(() => {
    if (!geladen) return;
    // Het anker blijft in de adresbalk zolang het bij het open tabblad hoort,
    // zodat die link direct naar de figuur blijft wijzen. Wie van tabblad
    // wisselt, laat het achter.
    const anker = window.location.hash.slice(1);
    const modus = duwTab.current ? "duw" : "vervang";
    duwTab.current = false;
    schrijfUrl(
      inst,
      STANDAARD,
      tab === STANDAARD_TAB ? {} : { tab },
      tabVanAnker(anker) === tab ? anker : undefined,
      modus,
    );
  }, [inst, geladen, tab]);

  const preset = kiesPreset(inst.presetId);
  // Eén bron voor wat er bij de batterij staat en wat er gerekend wordt: de
  // prijs volgt de kostenregel zodra de maat is aangepast (lib/configuratie.ts).
  const {
    capaciteitKwh: capaciteit,
    vermogenKw: vermogen,
    prijsEur: prijs,
  } = effectieveBatterij(inst);

  const state = useAnalysis(
    useMemo<Configuration | null>(
      () => (geladen ? maakConfiguratie(inst) : null),
      [geladen, inst],
    ),
    // Het raster en de huishoudens staan alleen op "Welke batterij"; zolang dat
    // tabblad dicht is, rekent de telefoon er niet aan.
    { rasterNodig: tab === "welke-batterij" },
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

  // Een periode die buiten de beschikbare data valt (een link met een dag in de
  // toekomst) gaf een technische foutmelding over ontbrekende profieldata.
  // Klem hem op de data van het netgebied, en zeg dat.
  useEffect(() => {
    if (!manifest) return;
    const jaren = Object.values(manifest.profielen[inst.domein] ?? {});
    const vroegste = jaren[0]?.eerste_dag;
    const laatste = jaren[jaren.length - 1]?.laatste_dag;
    if (!vroegste || !laatste) return;
    const klem = klemOpBeschikbaar(inst, { vroegste, laatste });
    if (klem.veranderd.length === 0) return;
    setInst((s) => ({ ...s, van: klem.van, tot: klem.tot }));
    setAangepast((a) => [...a, ...klem.veranderd.filter((k) => !a.includes(k))]);
    // `inst` zelf niet als dependency: alleen deze drie velden bepalen het.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, inst.domein, inst.van, inst.tot]);

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
  // De heffing van toen, uit de prijsdata van de jaren waarop het antwoord
  // rust; zonder antwoord de volle profieljaren van het netgebied.
  const bedragJaren =
    volledigeJaren.length > 0
      ? volledigeJaren.map((j) => j.year)
      : Object.entries(manifest?.profielen[inst.domein] ?? {})
          .filter(([, p]) => p.volledig_jaar)
          .map(([j]) => Number(j));
  const heffingZin = manifest
    ? heffingToenTekst(manifest.prijzen, bedragJaren) ?? null
    : null;
  const bedragJarenTekst = bedragJaren.length > 0 ? jarenReeks(bedragJaren) : "de gekozen periode";
  const datadekking = manifest
    ? (() => {
        const jaren = Object.values(manifest.profielen[inst.domein] ?? {});
        const a = jaren[0]?.eerste_dag;
        const b = jaren[jaren.length - 1]?.laatste_dag;
        return a && b ? `Gegevens van ${datum(a)} tot en met ${datum(b)}` : "";
      })()
    : "";

  // Scrol naar een wachtend anker zodra zijn figuur er is: het tabblad is
  // open en het antwoord binnen.
  useEffect(() => {
    const anker = wachtendAnker.current;
    if (!anker) return;
    const el = document.getElementById(anker);
    if (!el || el.closest("[hidden]")) return;
    wachtendAnker.current = null;
    el.scrollIntoView({ block: "start" });
  }, [tab, result]);

  const wachtOpResultaat = !result ? (
    <div className="notitie">
      <p>
        {fataal ? (
          <>
            De gegevens voor de berekening konden niet worden geladen, dus dit
            tabblad blijft leeg. Op het tabblad Uitkomst kun je het
            opnieuw proberen.
          </>
        ) : error ? (
          <>
            De berekening is mislukt, dus dit tabblad blijft leeg. Op het
            tabblad Uitkomst kun je het opnieuw proberen.
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
        <Tabs actief={tab} onKies={kiesTab} />
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

        {/* ── Uitkomst ───────────────────────────────────────────────────── */}
        <Paneel id="uitkomst" actief={tab}>
          <div className="sectiekop">
            <TabEyebrow id="uitkomst" />
            <h1>Wat had een thuisbatterij je opgeleverd?</h1>
            <p>
              Op 1 januari 2027 stopt het salderen: wat je teruglevert wordt dan
              niet meer afgetrokken van wat je afneemt. Deze tool rekent uit wat
              een thuisbatterij je met een dynamisch contract had bespaard, op de{" "}
              <strong>werkelijke uurprijzen</strong> van ANWB Energie.{" "}
              {inst.zonnepanelen
                ? "Twee getallen van je jaarafrekening zijn genoeg, want we rekenen met het gemeten gemiddelde verbruik in jouw netgebied."
                : "Eén getal van je jaarafrekening is genoeg, want we rekenen met het gemeten gemiddelde verbruik in jouw netgebied."}
            </p>
          </div>
          <OpDitTabblad id="uitkomst" />

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
                uitkomst hieronder rekent daarmee.
                {aangepast.includes("van") || aangepast.includes("tot")
                  ? " Een periode moet beginnen vóór hij eindigt en binnen de beschikbare data vallen."
                  : ""}{" "}
                Kijk{" "}
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
            capaciteitKwh={capaciteit}
            vermogenKw={vermogen}
            prijsEur={prijs}
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
                scenarioFout={scenarioFout}
                doel={toon?.doel}
                actie={uitleg("antwoord")}
              />

              <Statistieken
                stats={result.stats}
                scenarioStats={scenario?.stats ?? null}
                opwekBekend={toonOpwekBekend}
                geschatteOpwek={toon?.annualProductionKwh ?? 0}
                zonnepanelen={toonZonnepanelen}
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

        {/* ── Besparing ──────────────────────────────────────────────────── */}
        <Paneel id="besparing" actief={tab}>
          <div className="sectiekop">
            <TabEyebrow id="besparing" />
            <h2>Waar komt de besparing vandaan?</h2>
            <p>
              Zonder salderen loont een batterij door het prijsverschil tussen
              wat afname kost en wat teruglevering oplevert. Hier zie je hoe groot
              dat prijsverschil is, uit welke posten de besparing bestaat en wat
              er bij laden en ontladen verloren gaat.
            </p>
          </div>
          <OpDitTabblad id="besparing" />
          {wachtOpResultaat}
          {result ? (
            <>
              <Prijskloof
                gap={result.priceGap}
                afregelen={toon?.tariff.allowCurtailment ?? inst.curtailment}
                afnameKwh={toonAfname}
                terugleveringKwh={toonTeruglevering}
                zonnepanelen={toonZonnepanelen}
                omzettingsverlies={1 - (toon?.battery.efficiency ?? preset.spec.efficiency) ** 2}
                actie={uitleg("prijskloof")}
              />
              <Uitsplitsing
                breakdown={result.breakdown}
                afregelen={toon?.tariff.allowCurtailment ?? inst.curtailment}
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

        {/* ── Door het jaar ──────────────────────────────────────────────── */}
        <Paneel id="door-het-jaar" actief={tab}>
          <div className="sectiekop">
            <TabEyebrow id="door-het-jaar" />
            <h2>Wanneer bespaart de batterij het meest?</h2>
            <p>
              Van grof naar fijn: per jaar, per maand, over een gemiddelde
              zomer- en winterdag, en ten slotte één dag of week van dichtbij.
              Hoe grilliger de prijzen, hoe meer een batterij bespaart.
            </p>
          </div>
          <OpDitTabblad id="door-het-jaar" />
          {wachtOpResultaat}
          {result ? (
            <>
              <BesparingPerJaar jaren={result.perYear} actie={uitleg("perJaar")} />
              <MaandVerloop
                maanden={result.perMonth}
                zonnepanelen={toonZonnepanelen}
                actie={uitleg("maandverloop")}
              />
              <Verschuiving
                profielen={result.seasonProfiles ?? []}
                zonnepanelen={toonZonnepanelen}
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
                zonnepanelen={toonZonnepanelen}
                actie={uitleg("dagprofiel")}
              />
            </>
          ) : null}
        </Paneel>

        {/* ── Terugverdienen ─────────────────────────────────────────────── */}
        <Paneel id="terugverdienen" actief={tab}>
          <div className="sectiekop">
            <TabEyebrow id="terugverdienen" />
            <h2>Verdient de batterij zichzelf terug?</h2>
            <p>
              Wat de batterij over zijn looptijd kost en oplevert, hoe lang hij
              meegaat, en wat het nettarief van 2029 verandert als het voorstel
              van de netbeheerders doorgaat.
            </p>
          </div>
          <OpDitTabblad id="terugverdienen" />
          {wachtOpResultaat}
          {result ? (
            <>
              <Cashflow
                finance={result.finance}
                overgang={overgang}
                investeringEur={toonPrijs}
                cycleLife={toon?.cycleLife}
                jarenTekst={bedragJarenTekst}
                actie={uitleg("cashflow")}
              />
              {toon ? (
                <Laadbeurten
                  finance={result.finance}
                  stats={result.stats}
                  config={toon}
                  overgang={overgang}
                  actie={uitleg("beurten")}
                />
              ) : null}
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
            </>
          ) : null}
        </Paneel>

        {/* ── Welke batterij ─────────────────────────────────────────────── */}
        <Paneel id="welke-batterij" actief={tab}>
          <div className="sectiekop">
            <TabEyebrow id="welke-batterij" />
            <h2>Welke batterij past bij jou?</h2>
            <p>
              Dezelfde doorrekening voor andere maten, een ander doel en andere
              huishoudens. Klik op een maat of een doel, dan rekent de hele
              pagina daarmee door.
            </p>
          </div>
          <OpDitTabblad id="welke-batterij" />
          {wachtOpResultaat}
          {result && toon ? (
            <>
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
              <VoorWie huishoudens={huishoudens} result={result} config={toon} actie={uitleg("voorwie")} />
            </>
          ) : null}
        </Paneel>

        {/* ── CO2 ────────────────────────────────────────────────────────── */}
        <Paneel id="co2" actief={tab}>
          <div className="sectiekop">
            <TabEyebrow id="co2" />
            <h2>Wat scheelt de batterij aan CO2?</h2>
            <p>
              Elke kWh van het net is op dat uur met een bepaalde hoeveelheid CO2
              opgewekt: veel als gascentrales draaien, weinig als de zon schijnt
              en het waait. Eerst wat de batterij voor jouw eigen uitstoot doet,
              dan wanneer stroom schoon is en in welke maanden je het meeste
              scheelt, en tot slot wat het voor Nederland als geheel scheelt, want
              daar telt je teruglevering ook mee.
            </p>
          </div>
          <OpDitTabblad id="co2" />
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

        {/* ── Aannames en bronnen ─────────────────────────────────────────── */}
        <Paneel id="aannames" actief={tab}>
          <div className="sectiekop">
            <TabEyebrow id="aannames" />
            <h2>Hoe hard zijn deze cijfers?</h2>
            <p>
              We gebruiken geen prijsvoorspelling: het bedrag is wat de batterij
              in {bedragJarenTekst} had opgeleverd. De terugverdientijd trekt dat
              door naar de toekomst; dat is een aanname. Hieronder staan de
              gegevens, de aannames en de bronnen.
            </p>
          </div>
          <OpDitTabblad id="aannames" />
          {wachtOpResultaat}
          {result && manifest ? (
            <Verantwoording manifest={manifest} result={result} domein={inst.domein} />
          ) : null}

          <section className="figure" id="wat-we-niet-weten">
            <div className="figure-kop">
              <div>
                <FiguurNaam anker="wat-we-niet-weten" />
                <h3>De richting is stevig, de exacte hoogte niet</h3>
                <p className="figure-uitleg">
                  Dit zijn de aannames waar het om draait, gesorteerd op hoeveel
                  ze de uitkomst kunnen veranderen. Het label zegt hoe.
                </p>
              </div>
            </div>
            <ul className="methode-lijst">
              <li>
                <b>Het verleden staat model voor de toekomst.</b> Voor de
                terugverdientijd herhalen we de doorgerekende jaren over de hele
                looptijd, standaard zonder prijsstijging (0 procent per jaar).
                Wat prijzen en belastingen de komende jaren doen, weet niemand.
                De looptijd is een aanname voor de beoordeling, geen
                fabrieksgarantie; die is vaak tien jaar.
                <span className="badge neutraal">aanname</span>
              </li>
              <li>
                <b>Het stand-byverbruik van de batterij zit er niet in.</b> Een
                thuisbatterij gebruikt ook stroom als hij niets doet. Fabrikanten
                en testers noemen 7 tot 25 watt. Dat is 60 tot 220 kWh per jaar.
                Dat is een indicatie, en we trekken het niet van de besparing af.
                De besparing valt daardoor lager uit.
                <span className="badge neutraal">aanname</span>
              </li>
              <li>
                <b>De belasting van nu.</b> De uurprijzen zijn van toen, de
                energiebelasting en opslag van nu. Zo past de uitkomst bij een
                batterij die je vandaag koopt.
                {heffingZin ? (
                  <>
                    {" "}
                    {heffingZin}. Met die hogere heffing is de besparing voor de
                    standaardbatterij met zonnepanelen ongeveer{" "}
                    {Math.round(BESPARING_MET_HEFFING_TOEN * 100)} procent hoger.
                  </>
                ) : null}{" "}
                Bij de geavanceerde instellingen kies je de heffing van toen; het
                nettariefscenario rekent met de belasting van 2029.
                <span className="badge neutraal">aanname</span>
              </li>
              <li>
                <b>Het verbruikspatroon is een gemiddelde.</b> We rekenen met het
                gemeten gemiddelde kwartierpatroon van alle kleinverbruikers in
                jouw netgebied (E1A), met of zonder teruglevering. We schalen dat
                naar jouw jaartotalen. Dat is geen meting van één huishouden.
                Pieken van een waterkoker of laadpaal zijn uitgemiddeld, en een
                warmtepomp of elektrische auto zit er niet apart in. Of de
                uitkomst daardoor te hoog of te laag is, weten we niet. Met de
                schuif ‘Pieken in je verbruik’ zie je hoe gevoelig hij ervoor is.
                <span className="badge let-op">richting onzeker</span>
              </li>
              <li>
                <b>Het nettarief van 2029 is een voorstel.</b> Het nettarief is
                wat je betaalt voor het gebruik van het stroomnet. De
                tijdsblokken en wegingsfactoren komen uit het voorstel van de
                netbeheerders. Het basistarief is een prognose van CE Delft, in
                opdracht van NVDE, Holland Solar, Energie-Nederland en Energy
                Storage NL. De Autoriteit Consument &amp; Markt (ACM) heeft nog
                niet beslist. Invoering is in beginsel 1 januari 2029, mogelijk
                later.
                <span className="badge let-op">richting onzeker</span>
              </li>
              <li>
                <b>Een periode korter dan een jaar.</b> Is je periode korter dan
                een jaar, of zonder volledig kalenderjaar, dan schalen we de
                uitkomst naar een jaar. Dat is 365 gedeeld door het aantal dagen.
                Een periode uit één seizoen geeft daardoor een te hoge of te lage
                besparing.
                <span className="badge let-op">richting onzeker</span>
              </li>
              <li>
                <b>Standaard regelt je installatie niet af bij negatieve prijzen.</b>{" "}
                Je levert dan ook terug als dat geld kost, want de meeste
                omvormers stoppen niet vanzelf. Sommige omvormers en
                energiemanagementsystemen kunnen het wel; zet het dan aan bij de
                geavanceerde instellingen. Zonder batterij kost je dat dan niets
                meer, en valt de besparing lager uit.
                <span className="badge neutraal">zelf in te vullen</span>
              </li>
              <li>
                <b>De aansturing kent de toekomst niet.</b> De aansturing plant
                op de prijzen voor morgen, die rond 13.00 uur bekend worden.
                Daarbij gebruikt ze een eenvoudige verwachting van je verbruik en
                opwek uit de afgelopen dagen. Alleen het optimum dat ter
                vergelijking in de figuren staat, rekent met perfecte kennis
                vooraf.
                <span className="badge neutraal">aanname</span>
              </li>
              <li>
                <b>Terugleverkosten staan standaard op 0 cent.</b> We nemen aan
                dat ANWB Energie geen terugleverkosten (een bedrag per
                teruggeleverde kWh) rekent; andere leveranciers vaak wel. Vul je
                eigen bedrag in bij de geavanceerde instellingen.
                <span className="badge neutraal">aanname</span>
              </li>
              <li>
                <b>Batterijprijzen bewegen.</b> De richtprijzen zijn van{" "}
                {PRIJSPEILDATUM}; vul je eigen offerte in bij de geavanceerde
                instellingen.
                <span className="badge neutraal">zelf in te vullen</span>
              </li>
              <li>
                <b>Afname en teruglevering binnen een kwartier.</b> Per kwartier
                trekken we afname en teruglevering van elkaar af. Eén aansluiting
                gaat binnen een kwartier meestal maar één kant op. Wisselt jouw
                huis vaker van kant, bijvoorbeeld door een wolk of een
                waterkoker, dan is de besparing in werkelijkheid iets hoger. Bij
                een kleine stekkerbatterij is dat effect het grootst.
                <span className="badge goed">kleine invloed</span>
              </li>
              <li>
                <b>Eén leverancier, afgeronde uurprijzen.</b> De prijzen zijn van
                ANWB Energie. Een andere dynamische leverancier rekent een andere
                opslag; dat verschuift de kosten, nauwelijks de besparing. Sinds
                20 juni 2026 rondt ANWB Energie de prijzen af op hele centen.
                Sinds 1 oktober 2025 gelden de prijzen voor morgen per kwartier.
                De tool rekent met het gemiddelde per uur, dus prijsverschillen
                binnen een uur vallen weg.
                <span className="badge goed">kleine invloed</span>
              </li>
              <li>
                <b>CO2 is een toerekening.</b> We rekenen met de gemiddelde
                uitstoot van de Nederlandse opwek per uur, niet met die van de
                centrale die bijspringt. De uitstoot van het maken van de
                batterij is niet meegerekend.
                <span className="badge let-op">richting onzeker</span>
              </li>
              <li>
                <b>Aanmelden en installeren.</b> Een thuisbatterij meld je aan bij
                je netbeheerder via energieleveren.nl. Boven 800 W is een vaste
                aansluiting op een eigen groep door een installateur de norm. Dat
                kost 100 tot 200 euro in een standaardsituatie en 300 tot 600 euro
                bij een volle meterkast. De tool rekent met 300 euro.
                <span className="badge neutraal">zelf in te vullen</span>
              </li>
              <li>
                <b>Wat er verder niet in zit.</b> Vastrecht, belastingvermindering
                en het vaste deel van de netbeheerkosten zijn met en zonder
                batterij gelijk. Terugleverkosten rekenen we alleen als één
                instelbaar bedrag per kWh, zonder staffels per leverancier. Kosten
                voor slimme sturing zitten er niet in.
                <span className="badge goed">kleine invloed</span>
              </li>
            </ul>
          </section>

          <section className="figure" id="bronnen">
            <div className="figure-kop">
              <div>
                <FiguurNaam anker="bronnen" />
                <h3>Waar de data en de aannames vandaan komen</h3>
                <p className="figure-uitleg">
                  Geraadpleegd op 24 september 2026.
                </p>
              </div>
            </div>
            <ul className="methode-lijst">
              <li>
                <b>Uurprijzen:</b> ANWB Energie, actuele dynamische
                energietarieven (
                <a href="https://www.anwb.nl/energie/actuele-tarieven">
                  anwb.nl/energie/actuele-tarieven
                </a>
                ). Sinds 20 juni 2026 afgerond op hele centen. Sinds 1 oktober
                2025 gelden de prijzen voor morgen per kwartier; de tool rekent
                met uurgemiddelden.
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
                <b>Nettarief:</b> het voorstel voor volume- en
                tijdsafhankelijke transporttarieven voor kleinverbruikers
                (codewijziging), dat de netbeheerders op 1 mei 2026 indienden bij
                de Autoriteit Consument &amp; Markt (ACM); de ACM beslist erover
                (BR-2026-2242,{" "}
                <a href="https://www.acm.nl/nl/publicaties/voorstel-codewijziging-volume-en-tijdsafhankelijke-transporttarieven-voor-kleinverbruikers">
                  acm.nl
                </a>
                ).
              </li>
              <li>
                <b>Basistarief en energiebelasting 2029–2030:</b> CE Delft,{" "}
                <i>
                  Beheersbare energiekosten voor huishoudens in 2030 – Ook binnen
                  een kleinere netaansluiting
                </i>
                , M. Teng, L. van Cappellen en L. Vergroesen, september 2026, in
                opdracht van NVDE, Holland Solar, Energie-Nederland en Energy
                Storage NL (
                <a href="https://ce.nl/publicaties/beheersbare-energiekosten-voor-huishoudens-in-2030/">
                  ce.nl
                </a>
                ).
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
                ); C. Schade en R. Egging-Bratseth, <i>Battery degradation:
                Impact on economic dispatch</i>, Energy Storage 6(2), 2024 (
                <a href="https://doi.org/10.1002/est2.588">doi:10.1002/est2.588</a>
                ).
              </li>
              <li>
                <b>Batterijprijzen:</b> richtprijzen van {PRIJSPEILDATUM}:{" "}
                {PRESETS.map((p) => `${p.naam} ${euro(p.prijsEur)} (${p.prijsNoot})`).join("; ")}.
              </li>
              <li>
                <b>Uitbreiding en installatie:</b> prijzen van uitbreidingsbatterijen
                (
                <a href="https://thuisbatterijgids.net/uitbreidingsaccus/">
                  thuisbatterijgids.net
                </a>
                : Zendure AB2000X 312, Anker SOLIX BP2700 316 euro per kWh; een
                extra HomeWizard-unit 443 en een Marstek-unit 234 euro per kWh)
                en van een eigen groep
                door een installateur (
                <a href="https://www.powerplugs.nl/pages/eigen-groep">powerplugs.nl</a>
                : 100 tot 200 euro standaard, 300 tot 600 euro bij een volle
                meterkast of lange kabel).
              </li>
              <li>
                <b>Opwek van zonnepanelen:</b> Milieu Centraal, kosten en
                opbrengst zonnepanelen: 3.000 kWh per jaar voor acht panelen van
                435 wattpiek (
                <a href="https://www.milieucentraal.nl/energie-besparen/zonnepanelen/kosten-en-opbrengst-zonnepanelen/">
                  milieucentraal.nl
                </a>
                ).
              </li>
              <li>
                <b>Prijsontwikkeling:</b> PBL, <i>Klimaat- en Energieverkenning
                2026</i>: groothandelsprijs van stroom in 2030 70 euro per MWh,
                bandbreedte 53 tot 90 (
                <a href="https://www.pbl.nl/publicaties/klimaat-en-energieverkenning-2026">
                  pbl.nl
                </a>
                ).
              </li>
              <li>
                <b>Stand-byverbruik:</b> een indicatie uit fabrikantopgaven en
                tests, bijvoorbeeld Indevolt (7 watt in diepe stand-by, 20 watt
                voor de hoofdunit;{" "}
                <a href="https://blog.indevolt.com/nl/wat-is-standby-verbruik-waarom-verbruikt-een-plug-in-thuisbatterij-ook-stroom-in-stand-by/">
                  indevolt.com
                </a>
                ) en een meting aan de HomeWizard Plug-In Battery (ongeveer 6
                watt;{" "}
                <a href="https://energienerds.nl/index.php/2026/03/26/homewizard-plug-in-battery-review">
                  energienerds.nl
                </a>
                ).
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
      <TabStapper actief={tab} onKies={kiesTab} />

      <footer className="voet">
        <span>
          Bronnen: MFFBAS/EDSN profielfracties · ANWB Energie uurtarieven · NED
          · CE Delft en Netbeheer Nederland (nettarief 2029). Deze tool is van
          ANWB. ANWB verkoopt ook energie en thuisbatterijen. De uitkomsten
          zijn een doorrekening op historische prijzen, geen persoonlijk advies
          en geen garantie.
        </span>
        {manifest ? <span>Gegevens bijgewerkt op {datum(manifest.gegenereerd.slice(0, 10))}</span> : null}
      </footer>
    </div>
  );
}
