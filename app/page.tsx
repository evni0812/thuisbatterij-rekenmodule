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
import { datum, periode } from "../lib/format";
import { leesLaatste, leesProfielen, type Profiel } from "../lib/opslag";
import { PRIJSPEILDATUM, geschatteOpwekKwh } from "../lib/presets";
import { STANDAARD, kiesPreset, maakConfiguratie } from "../lib/configuratie";
import { referentieJaar } from "../lib/model/analysis";
import { STANDAARD_CO2_DREMPEL_G } from "../lib/model/co2";
import { ankerVan, kostenVan, kostenregelVan } from "../lib/model/kosten";
import { wearCostPerKwh } from "../lib/model/battery";
import { UITLEG, type UitlegContext } from "../lib/uitleg";
import { overgangsFinance } from "../lib/overgang";
import { useAnalysis } from "../lib/useAnalysis";
import { leesUrl, schrijfUrl, type Instellingen } from "../lib/url-state";
import type { Configuration } from "../lib/worker/protocol";

/**
 * De pagina is een verhaal in vijf tabbladen, in de volgorde van een gesprek:
 * wat is het antwoord (Start), waarom, wanneer gebeurt het, wat als het anders
 * was, en waar komen de cijfers vandaan (Methode). Elke sectie heeft één plek,
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

  // De configuratie staat in de URL, zodat elke doorrekening deelbaar is. Een
  // URL met parameters wint van de bewaarde instellingen: een gedeelde link
  // moet laten zien wat de afzender zag.
  useEffect(() => {
    const uitUrl = leesUrl();
    const p = new URLSearchParams(window.location.search);
    const tabUrl = p.get("tab");
    if (isTabId(tabUrl)) setTab(tabUrl);

    const laatste = leesLaatste();
    if (Object.keys(uitUrl).length === 0 && laatste) {
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
  );

  const {
    manifest,
    result,
    busy,
    error,
    voortgang,
    grid,
    huishoudens,
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
  } = state;

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
    result && toon ? { result, scenario, config: toon, preset, scenarioJaar } : null;
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
        {error ? (
          <>Er ging iets mis bij het rekenen: {error}</>
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
              Vanaf 2027 vervalt de saldering: je krijgt voor teruglevering nog
              maar de kale marktprijs, terwijl afname het volle tarief kost. Deze
              tool rekent met <strong>werkelijk gemeten verbruiksprofielen</strong>{" "}
              en <strong>werkelijke uurtarieven</strong> door wat een batterij je
              in die situatie had bespaard. Drie getallen van je jaarafrekening
              zijn genoeg.
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
              Er ging iets mis bij het rekenen: {error}
            </p>
          ) : null}

          {!result && !error ? (
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
            <h2>Het nettarief van 2029 gooit de businesscase om</h2>
            <p>
              Wat doet het tijdsafhankelijke nettarief dat vanaf 2029 gaat
              gelden, welke maat batterij loont netto en tot waar loont
              uitbreiden, voor wie kan deze batterij uit, hoe zuinig gaat hij met
              zijn laadbeurten om, en hoe ziet de investering er over de
              looptijd uit.
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
              {toon ? (
                <>
                  <BatterijMaat
                    grid={grid}
                    huidigeCapaciteit={toonCapaciteit}
                    huidigVermogen={toonVermogen}
                    config={toon}
                    curve={result.curve}
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
                  <Uitbreiden grid={grid} config={toon} curve={result.curve} actie={uitleg("uitbreiden")} />
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
                  periodeLabel={gemiddeldLabel}
                  actie={uitleg("co2antwoord")}
                />
                <Co2Uren co2={result.co2} profielen={result.seasonProfiles ?? []} actie={uitleg("co2uren")} />
                <Co2Maanden co2={result.co2} actie={uitleg("co2maanden")} />
                <Co2Nederland
                  co2={result.co2}
                  drempel={toon.co2DrempelG ?? STANDAARD_CO2_DREMPEL_G}
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
                <b>Het profiel is een gemiddelde.</b> Jouw huis piekt scherper dan
                het gemiddelde van veel huishoudens. Dat onderschat wat een
                batterij kan opvangen. De schuif "Pieken in je verbruik" maakt dat
                instelbaar.
                <span className="badge let-op">richting zeker, hoogte niet</span>
              </li>
              <li>
                <b>Eén leverancier.</b> De prijzen zijn van ANWB Energie. Een andere
                dynamische leverancier rekent een andere opslag; dat verschuift de
                kosten, nauwelijks de besparing.
                <span className="badge goed">klein effect</span>
              </li>
              <li>
                <b>Het nettarief van 2029 is een scenario.</b> De blokken en
                wegingsfactoren staan in het voorstel; het basistarief is een
                prognose van CE Delft en de ACM heeft nog niet beslist. Invoering
                is "in beginsel" 1 januari 2029, met uitwijk naar 2030.
                <span className="badge let-op">te toetsen eind 2026</span>
              </li>
              <li>
                <b>De energiebelasting daalt.</b> De heffing was in 2024 en 2025 een
                kwart tot een derde hoger dan nu, en de besparing schaalt daar
                bijna één-op-één mee. Kies "van nu" bij de geavanceerde
                instellingen om dat effect te zien; het nettariefscenario rekent
                al met de belasting van 2029.
                <span className="badge let-op">kan lager uitvallen</span>
              </li>
              <li>
                <b>Batterijprijzen bewegen.</b> De richtprijzen zijn van{" "}
                {PRIJSPEILDATUM}; vul je eigen offerte in bij de geavanceerde
                instellingen.
                <span className="badge neutraal">zelf in te vullen</span>
              </li>
              <li>
                <b>Wat er niet in zit.</b> Vastrecht, belastingvermindering en het
                vaste deel van de netbeheerkosten: met en zonder batterij gelijk.
                Terugleverkosten alleen als één instelbaar bedrag per kWh; geen
                staffels per leverancier. Geen kosten voor slimme sturing.
                <span className="badge neutraal">bewust buiten beeld</span>
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
          Bronnen: MFFBAS/EDSN profielfracties · ANWB Energie uurtarieven · CE
          Delft en Netbeheer Nederland (nettarief 2029). Geen commerciële partij,
          geen advies.
        </span>
        {manifest ? <span>Data gegenereerd {datum(manifest.gegenereerd.slice(0, 10))}</span> : null}
      </footer>
    </div>
  );
}
