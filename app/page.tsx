"use client";

import { useEffect, useMemo, useState } from "react";
import { Antwoord } from "../components/Antwoord";
import { BatterijMaat } from "../components/BatterijMaat";
import { BesparingPerJaar } from "../components/BesparingPerJaar";
import { Cashflow } from "../components/Cashflow";
import { Dagprofiel } from "../components/Dagprofiel";
import { Geavanceerd } from "../components/Geavanceerd";
import { Invoer } from "../components/Invoer";
import { MaandVerloop } from "../components/MaandVerloop";
import { Nettarief } from "../components/Nettarief";
import { Prijskloof } from "../components/Prijskloof";
import { Statistieken } from "../components/Statistieken";
import { Uitsplitsing } from "../components/Uitsplitsing";
import { Verantwoording } from "../components/Verantwoording";
import { Verliezen } from "../components/Verliezen";
import { periode } from "../lib/format";
import { PRESETS } from "../lib/presets";
import {
  STANDAARD,
  kiesPreset,
  maakConfiguratie,
} from "../lib/configuratie";
import { useAnalysis } from "../lib/useAnalysis";
import { leesUrl, schrijfUrl, type Instellingen } from "../lib/url-state";
import type { Configuration } from "../lib/worker/protocol";


export default function Page() {
  const [inst, setInst] = useState<Instellingen>(STANDAARD);
  const [geladen, setGeladen] = useState(false);
  /** Zet een doorrekening in de wacht tot de nieuwe invoer is verwerkt. */
  const [rekenNa, setRekenNa] = useState(false);

  // De configuratie staat in de URL, zodat elke doorrekening deelbaar is.
  useEffect(() => {
    setInst((huidig) => ({ ...huidig, ...leesUrl() }));
    setGeladen(true);
  }, []);

  useEffect(() => {
    if (geladen) schrijfUrl(inst, STANDAARD);
  }, [inst, geladen]);

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
    grid,
    dag,
    dagBezig,
    scenario,
    scenarioOpTeruglevering,
    zetScenarioOpTeruglevering,
    dagOntbreekt,
    vraagDag,
    wisDag,
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
  const toonOpwekBekend = toon?.annualProductionKwh !== undefined;
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

  return (
    <main className="pagina">
      <header className="kop">
        <h1>Wat had een thuisbatterij je opgeleverd?</h1>
        <p className="kop-uitleg">
          Vanaf 2027 vervalt de saldering: je krijgt voor teruglevering nog maar
          de kale marktprijs, terwijl afname het volle tarief kost. Deze tool
          rekent met <strong>werkelijk gemeten verbruiksprofielen</strong> en{" "}
          <strong>werkelijke uurtarieven</strong> door wat een batterij je in die
          situatie had bespaard.
        </p>
      </header>

      <Invoer
        afnameKwh={inst.afnameKwh}
        terugleveringKwh={inst.terugleveringKwh}
        presetId={inst.presetId}
        onAfname={(v) => setInst((s) => ({ ...s, afnameKwh: v }))}
        onTeruglevering={(v) => setInst((s) => ({ ...s, terugleveringKwh: v }))}
        onPreset={(id) =>
          setInst((s) => ({
            ...s,
            presetId: id,
            capaciteitKwh: null,
            vermogenKw: null,
            prijsEur: null,
          }))
        }
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
          {/*
            De pagina is een verhaal in vier delen, in de volgorde van een
            gesprek: wat is het antwoord, waarom, wanneer gebeurt het, en wat als
            het anders was. Elke sectie heeft één plek en één vraag.

            Eerder stonden beschrijving en wat-als door elkaar en sprong de
            tijdschaal van dag naar maand naar jaar. En het belangrijkste inzicht
            — dat het nettarief vanaf 2029 de uitkomst omgooit — stond acht
            secties lager achter een knop.
          */}
          <h2 className="deel-kop" id="antwoord">
            Het antwoord <span>wat deze batterij je had opgeleverd</span>
          </h2>

          <Antwoord
            result={result}
            scenario={scenario}
            investeringEur={toonPrijs}
            bezig={busy}
            heffingVanNu={toon?.useHistoricalLevy === false}
          />

          <Statistieken stats={result.stats} opwekBekend={toonOpwekBekend} />

          <h2 className="deel-kop">
            Waarom <span>waar de besparing vandaan komt</span>
          </h2>

          <Prijskloof
            gap={result.priceGap}
            afnameKwh={toonAfname}
            terugleveringKwh={toonTeruglevering}
          />

          <Uitsplitsing
            breakdown={
              result.perYear.find((j) => j.isFullYear)?.breakdown ??
              result.perYear[0]!.breakdown
            }
            periodeLabel={
              result.perYear.find((j) => j.isFullYear)
                ? String(result.perYear.find((j) => j.isFullYear)!.year)
                : periodeLabel
            }
          />

          <Verliezen
            losses={result.losses}
            afnameKwh={toonAfname}
            besparingEur={result.averageSavingEur}
          />

          <h2 className="deel-kop">
            Wanneer <span>van jaar tot dag</span>
          </h2>

          <BesparingPerJaar jaren={result.perYear} />

          <MaandVerloop maanden={result.perMonth} />

          <Dagprofiel
            voorbeelden={result.sampleDays}
            losseDag={dag}
            ontbreekt={dagOntbreekt}
            bezig={dagBezig}
            eersteDag={result.perYear[0]?.firstDay ?? ""}
            laatsteDag={result.perYear[result.perYear.length - 1]?.lastDay ?? ""}
            onVraagDag={vraagDag}
            onWisDag={wisDag}
          />

          <h2 className="deel-kop">
            Wat als <span>het nettarief, een andere maat, de looptijd</span>
          </h2>

          <Nettarief
            huidig={result}
            scenario={scenario}
            opTeruglevering={scenarioOpTeruglevering}
            onOpTeruglevering={zetScenarioOpTeruglevering}
          />

          <BatterijMaat
            grid={grid}
            huidigeCapaciteit={toonCapaciteit}
            huidigVermogen={toonVermogen}
            onKies={(cap, kw) => {
              // Een klik op een vakje is een expliciete opdracht: meteen
              // doorrekenen. Anders kost de klik je het raster en levert hij
              // niets op, want de rekenknop staat verderop.
              setInst((s) => ({ ...s, capaciteitKwh: cap, vermogenKw: kw }));
              setRekenNa(true);
            }}
          />

          <Cashflow finance={result.finance} investeringEur={toonPrijs} />

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

          {manifest ? (
            <Verantwoording
              manifest={manifest}
              result={result}
              domein={inst.domein}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}
