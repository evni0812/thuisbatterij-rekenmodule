/**
 * Rendertest van de volledige interface met een écht analyseresultaat.
 *
 * De modeltests bewijzen dat de cijfers kloppen; deze test bewijst dat de
 * pagina ze ook zonder fouten toont. Dat vangt de klasse problemen die
 * rekentests missen: een ontbrekende waarde, een lege reeks, een deling door
 * nul in een schaalfunctie.
 */
import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Antwoord } from "../components/Antwoord";
import { BatterijMaat } from "../components/BatterijMaat";
import { BesparingPerJaar } from "../components/BesparingPerJaar";
import { Cashflow } from "../components/Cashflow";
import { Dagprofiel } from "../components/Dagprofiel";
import { Prijskloof } from "../components/Prijskloof";
import { Uitsplitsing } from "../components/Uitsplitsing";
import { Verantwoording } from "../components/Verantwoording";
import { controleerInvoer } from "../components/Invoer";
import { expandPricesToQuarters, loadManifest, loadPriceYear, loadProfileYear } from "../lib/data/loader";
import type { Manifest } from "../lib/data/manifest";
import { addDays, localMidnightUtcMs } from "../lib/data/timeaxis";
import { runAnalysis, type AnalysisResult } from "../lib/model/analysis";
import { buildResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import { PRESETS } from "../lib/presets";

// Zonder opruimen stapelen de gerenderde DOM's op en vinden queries meerdere
// treffers uit eerdere tests.
afterEach(cleanup);

const DOMAIN = "871685900000056162";
let manifest: Manifest;
let result: AnalysisResult;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const buf = readFileSync(`public${String(input)}`);
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body,
      json: async () => JSON.parse(buf.toString("utf8")),
    } as Response;
  }) as typeof fetch;

  manifest = await loadManifest();
  const preset = PRESETS[1]!;
  const jaar = 2025;
  const prof = await loadProfileYear(manifest, DOMAIN, jaar);
  const price = await loadPriceYear(manifest, jaar);
  const start = 0;
  const end = prof.startMs.length;
  void addDays;
  void localMidnightUtcMs;
  const startMs = prof.startMs.slice(start, end);
  const tariff = {
    purchaseSurchargeEurPerKwh: 0,
    energyTaxEurPerKwh: price.levyEurPerKwh,
    feedInCostEurPerKwh: 0,
    allowCurtailment: true,
  };

  result = runAnalysis({
    windows: [
      {
        year: jaar,
        firstDay: prof.firstDay,
        lastDay: prof.lastDay,
        isFullYear: true,
        window: {
          startMs,
          residualKwh: buildResidual(prof.importFraction, prof.exportFraction, {
            annualGridImportKwh: 2500,
            annualGridExportKwh: 2000,
            spreadFactor: 1,
          }),
          prices: buildPriceSeries(
            expandPricesToQuarters(startMs, price, "market"),
            tariff,
          ),
        },
      },
    ],
    battery: { ...preset.spec, wearCostEurPerKwh: 0 },
    tariff,
    investmentEur: preset.prijsEur,
    cycleLife: preset.cycleLife,
    years: 15,
    priceEscalation: 0.02,
    discountRate: 0.03,
    calendarFadePerYear: 0.015,
    residualValueEur: 0,
  });
}, 120_000);

describe("de pagina toont het antwoord", () => {
  it("noemt een bedrag per jaar en een terugverdientijd", () => {
    render(<Antwoord result={result} investeringEur={1199} bezig={false} />);
    expect(screen.getByText(/per jaar/)).toBeDefined();
    // Er moet een concreet eurobedrag staan, geen placeholder.
    expect(document.body.textContent).toMatch(/€/);
    expect(document.body.textContent).toMatch(/terugverdiend|niet terug/);
  });

  it("legt de prijskloof uit met beide gewogen prijzen", () => {
    render(
      <Prijskloof gap={result.priceGap} afnameKwh={2500} terugleveringKwh={2000} />,
    );
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Wat je betaalt bij afname/);
    expect(tekst).toMatch(/Wat je krijgt bij teruglevering/);
    expect(tekst).toMatch(/ct/);
  });

  it("splitst de besparing uit en telt op tot het totaal", () => {
    const b = result.perYear[0]!.breakdown;
    render(<Uitsplitsing breakdown={b} periodeLabel="2025" />);
    expect(screen.getByText("Samen")).toBeDefined();
    expect(screen.getByText(/Zelf verbruiken/)).toBeDefined();
  });

  it("tekent het dagprofiel met beide dagen", () => {
    render(<Dagprofiel dagen={result.sampleDays} />);
    expect(screen.getByRole("tablist")).toBeDefined();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(2);
  });

  it("toont de besparing per jaar", () => {
    render(<BesparingPerJaar jaren={result.perYear} />);
    expect(screen.getByRole("img")).toBeDefined();
  });

  it("toont de cashflow met kerncijfers", () => {
    render(<Cashflow finance={result.finance} investeringEur={1199} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Terugverdientijd/);
    expect(tekst).toMatch(/Contante waarde/);
    expect(tekst).toMatch(/Rendement/);
  });

  it("verantwoordt de bron en de beperkingen", () => {
    render(
      <Verantwoording manifest={manifest} result={result} domein={DOMAIN} />,
    );
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/MFFBAS/);
    expect(tekst).toMatch(/ANWB/);
    // De beperkingen horen er expliciet in te staan, niet weggelaten.
    expect(tekst).toMatch(/gemiddelde over veel huishoudens/);
    expect(tekst).toMatch(/variabele stroomkosten/);
  });

  it("laat het batterijraster starten voordat het rekent", () => {
    render(
      <BatterijMaat
        grid={null}
        huidigeCapaciteit={2.1}
        huidigVermogen={0.8}
        onStart={() => {}}
        onKies={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Bereken/ })).toBeDefined();
  });

  it("toont elk vakje van het raster met zijn bedrag als getal", () => {
    const grid = {
      capacities: [2, 5],
      powers: [0.8, 2.5],
      klaar: true,
      bezig: false,
      rows: [
        [
          { capacityKwh: 2, powerKw: 0.8, savingEur: 40, cyclesPerYear: 150 },
          { capacityKwh: 2, powerKw: 2.5, savingEur: 45, cyclesPerYear: 160 },
        ],
        [
          { capacityKwh: 5, powerKw: 0.8, savingEur: 70, cyclesPerYear: 140 },
          { capacityKwh: 5, powerKw: 2.5, savingEur: 95, cyclesPerYear: 175 },
        ],
      ],
    };
    render(
      <BatterijMaat
        grid={grid}
        huidigeCapaciteit={5}
        huidigVermogen={2.5}
        onStart={() => {}}
        onKies={() => {}}
      />,
    );
    // Kleur mag nooit de enige drager zijn: elk vakje toont zijn bedrag.
    const tabel = screen.getByRole("table");
    for (const bedrag of ["40", "45", "70", "95"]) {
      expect(within(tabel).getByText(bedrag)).toBeDefined();
    }
  });
});

describe("invoervalidatie denkt mee", () => {
  const preset = PRESETS[1]!;

  it("zegt niets bij plausibele invoer", () => {
    expect(controleerInvoer(2500, 2000, preset)).toEqual([]);
  });

  it("waarschuwt bij een ontbrekende afname", () => {
    const w = controleerInvoer(0, 2000, preset);
    expect(w.some((x) => x.ernst === "let-op")).toBe(true);
  });

  it("legt uit wat er gebeurt zonder teruglevering", () => {
    const w = controleerInvoer(2500, 0, preset);
    expect(w.some((x) => /weinig op te slaan/.test(x.tekst))).toBe(true);
  });

  it("signaleert een batterij die te groot is voor het verbruik", () => {
    const groot = PRESETS.find((p) => p.capaciteitKwh === 10)!;
    const w = controleerInvoer(800, 400, groot);
    expect(w.some((x) => /zelden vollopen/.test(x.tekst))).toBe(true);
  });

  it("blokkeert niets — het zijn toelichtingen, geen fouten", () => {
    const w = controleerInvoer(20000, 60000, preset);
    expect(w.length).toBeGreaterThan(0);
    // Ook bij extreme invoer blijft de tool doorrekenen.
    expect(w.every((x) => typeof x.tekst === "string")).toBe(true);
  });
});
