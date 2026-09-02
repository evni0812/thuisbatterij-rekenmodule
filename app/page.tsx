"use client";

import { useEffect, useMemo, useState } from "react";
import { Antwoord } from "../components/Antwoord";
import { BatterijMaat } from "../components/BatterijMaat";
import { BesparingPerJaar } from "../components/BesparingPerJaar";
import { Cashflow } from "../components/Cashflow";
import { Dagprofiel } from "../components/Dagprofiel";
import { Geavanceerd } from "../components/Geavanceerd";
import { Invoer } from "../components/Invoer";
import { Prijskloof } from "../components/Prijskloof";
import { Statistieken } from "../components/Statistieken";
import { Uitsplitsing } from "../components/Uitsplitsing";
import { Verantwoording } from "../components/Verantwoording";
import { Verliezen } from "../components/Verliezen";
import { periode } from "../lib/format";
import {
  PRESETS,
  STANDAARD_AFNAME_KWH,
  STANDAARD_ANALYSEJAREN,
  STANDAARD_DISCONTOVOET,
  STANDAARD_KALENDERDEGRADATIE,
  STANDAARD_PRIJSSTIJGING,
  STANDAARD_TERUGLEVERING_KWH,
} from "../lib/presets";
import { useAnalysis } from "../lib/useAnalysis";
import { leesUrl, schrijfUrl, type Instellingen } from "../lib/url-state";
import type { Configuration } from "../lib/worker/protocol";

const STANDAARD: Instellingen = {
  afnameKwh: STANDAARD_AFNAME_KWH,
  terugleveringKwh: STANDAARD_TERUGLEVERING_KWH,
  presetId: PRESETS[1]!.id,
  domein: "871685900000056162",
  van: "",
  tot: "",
  spreiding: 1,
  terugleverkostenCt: 0,
  curtailment: true,
  analysejaren: STANDAARD_ANALYSEJAREN,
  discontovoet: STANDAARD_DISCONTOVOET,
  prijsstijging: STANDAARD_PRIJSSTIJGING,
  degradatie: STANDAARD_KALENDERDEGRADATIE,
  prijsEur: null,
  capaciteitKwh: null,
  vermogenKw: null,
  opwekKwh: null,
};

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

  const preset = PRESETS.find((p) => p.id === inst.presetId) ?? PRESETS[0]!;
  const capaciteit = inst.capaciteitKwh ?? preset.capaciteitKwh;
  const vermogen = inst.vermogenKw ?? preset.vermogenKw;
  const prijs = inst.prijsEur ?? preset.prijsEur;

  const state = useAnalysis(
    useMemo<Configuration | null>(() => {
      if (!geladen) return null;
      return {
        domain: inst.domein,
        from: inst.van || "2023-04-01",
        to: inst.tot || "2026-12-31",
        household: {
          annualGridImportKwh: inst.afnameKwh,
          annualGridExportKwh: inst.terugleveringKwh,
          spreadFactor: inst.spreiding,
        },
        battery: {
          ...preset.spec,
          capacityKwh: capaciteit,
          maxChargeKw: vermogen,
          maxDischargeKw: vermogen,
          wearCostEurPerKwh: 0,
        },
        tariff: {
          purchaseSurchargeEurPerKwh: 0,
          energyTaxEurPerKwh: 0,
          feedInCostEurPerKwh: inst.terugleverkostenCt / 100,
          allowCurtailment: inst.curtailment,
        },
        investmentEur: prijs,
        cycleLife: preset.cycleLife,
        analysisYears: inst.analysejaren,
        priceEscalation: inst.prijsstijging,
        discountRate: inst.discontovoet,
        calendarFadePerYear: inst.degradatie,
        residualValueEur: 0,
        annualProductionKwh: inst.opwekKwh ?? undefined,
        useHistoricalLevy: true,
      };
    }, [geladen, inst, preset, capaciteit, vermogen, prijs]),
  );

  const {
    manifest,
    result,
    busy,
    error,
    grid,
    startGrid,
    dag,
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
          <Antwoord result={result} investeringEur={toonPrijs} bezig={busy} />

          <Statistieken stats={result.stats} opwekBekend={toonOpwekBekend} />

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

          <Dagprofiel
            voorbeelden={result.sampleDays}
            losseDag={dag}
            ontbreekt={dagOntbreekt}
            eersteDag={result.perYear[0]?.firstDay ?? ""}
            laatsteDag={result.perYear[result.perYear.length - 1]?.lastDay ?? ""}
            onVraagDag={vraagDag}
            onWisDag={wisDag}
          />

          <BesparingPerJaar jaren={result.perYear} />

          <BatterijMaat
            grid={grid}
            huidigeCapaciteit={toonCapaciteit}
            huidigVermogen={toonVermogen}
            onStart={startGrid}
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
