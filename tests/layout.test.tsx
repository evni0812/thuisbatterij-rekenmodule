/**
 * Layouttest van het dagprofiel.
 *
 * De grafiek is opgebouwd uit drie vaste kolommen — as-labels, plot,
 * lijnlabels — en elk element hoort in precies één kolom. Dat is niet met het
 * oog te controleren bij elke wijziging, maar wel te meten: SVG-tekst heeft
 * coördinaten en een ankerpunt.
 *
 * Deze test bestaat omdat de paneeltitels twee keer over de as-labels heen zijn
 * gaan lopen. Een rendertest die alleen "crasht hij niet" controleert, ving dat
 * niet.
 */
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Dagprofiel } from "../components/Dagprofiel";
import { expandPricesToQuarters, loadManifest, loadPriceYear, loadProfileYear } from "../lib/data/loader";
import { runAnalysis, type SampleDay } from "../lib/model/analysis";
import { buildResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import { PRESETS } from "../lib/presets";

afterEach(cleanup);

let dagen: SampleDay[];

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

  const manifest = await loadManifest();
  const preset = PRESETS[1]!;
  const prof = await loadProfileYear(manifest, "871685900000056162", 2025);
  const price = await loadPriceYear(manifest, 2025);
  const tariff = {
    purchaseSurchargeEurPerKwh: 0,
    energyTaxEurPerKwh: price.levyEurPerKwh,
    feedInCostEurPerKwh: 0,
    allowCurtailment: true,
  };
  dagen = runAnalysis({
    windows: [
      {
        year: 2025,
        firstDay: prof.firstDay,
        lastDay: prof.lastDay,
        isFullYear: true,
        window: {
          startMs: prof.startMs,
          residualKwh: buildResidual(prof.importFraction, prof.exportFraction, {
            annualGridImportKwh: 2500,
            annualGridExportKwh: 2000,
            spreadFactor: 1,
          }),
          prices: buildPriceSeries(expandPricesToQuarters(prof.startMs, price, "market"), tariff),
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
  }).sampleDays;
}, 120_000);

/** Dezelfde kolomgrenzen als het component hanteert. */
const AS_BREEDTE = 62;
const B = 780;
const LABEL_BREEDTE = 132;
const PLOT_RECHTS = B - LABEL_BREEDTE;

function tekenen(): SVGSVGElement {
  const { container } = render(
    <Dagprofiel
      voorbeelden={dagen}
      losseDag={null}
      ontbreekt={null}
      eersteDag="2025-01-01"
      laatsteDag="2025-12-31"
      onVraagDag={() => {}}
      onWisDag={() => {}}
    />,
  );
  return container.querySelector("svg")!;
}

/** Horizontaal bereik van een tekstelement, geschat uit lengte en ankerpunt. */
function bereik(el: SVGTextElement): { van: number; tot: number } {
  const x = Number(el.getAttribute("x"));
  const anker = el.getAttribute("text-anchor") ?? "start";
  // Ruime schatting: 6,6 px per teken bij de gebruikte formaten van 10–12 px.
  const breedte = (el.textContent ?? "").length * 6.6;
  if (anker === "end") return { van: x - breedte, tot: x };
  if (anker === "middle") return { van: x - breedte / 2, tot: x + breedte / 2 };
  return { van: x, tot: x + breedte };
}

describe("kolomindeling van het dagprofiel", () => {
  it("houdt as-labels links van de plot", () => {
    const svg = tekenen();
    const labels = [...svg.querySelectorAll<SVGTextElement>("text.as-label")];
    expect(labels.length).toBeGreaterThan(5);

    for (const el of labels) {
      // De tijdas staat onderaan en is gecentreerd op de plot; die hoort daar.
      if ((el.textContent ?? "").includes(":")) continue;
      const { tot } = bereik(el);
      expect(tot, `as-label "${el.textContent}" steekt de plot in`).toBeLessThanOrEqual(
        AS_BREEDTE,
      );
    }
  });

  it("zet paneeltitels binnen de plot, nooit over de as-labels", () => {
    const svg = tekenen();
    const titels = [...svg.querySelectorAll<SVGTextElement>("text.paneel-titel")];
    expect(titels.length).toBe(3);

    for (const el of titels) {
      const { van, tot } = bereik(el);
      expect(van, `titel "${el.textContent}" begint links van de plot`).toBeGreaterThanOrEqual(
        AS_BREEDTE,
      );
      expect(tot, `titel "${el.textContent}" loopt de labelkolom in`).toBeLessThanOrEqual(
        PLOT_RECHTS,
      );
    }
  });

  it("houdt lijnlabels rechts van de plot en binnen het kader", () => {
    const svg = tekenen();
    const labels = [
      ...svg.querySelectorAll<SVGTextElement>("text.lijn-label, text.lijn-waarde"),
    ];
    expect(labels.length).toBeGreaterThanOrEqual(8);

    for (const el of labels) {
      const { van, tot } = bereik(el);
      expect(van, `lijnlabel "${el.textContent}" ligt over de plot`).toBeGreaterThanOrEqual(
        PLOT_RECHTS,
      );
      expect(tot, `lijnlabel "${el.textContent}" valt buiten het kader`).toBeLessThanOrEqual(B);
    }
  });

  it("laat lijnlabels binnen een paneel niet overlappen", () => {
    const svg = tekenen();
    const namen = [...svg.querySelectorAll<SVGTextElement>("text.lijn-label")];
    const ys = namen.map((el) => Number(el.getAttribute("y"))).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      // Labels van verschillende panelen liggen ver uit elkaar; binnen een
      // paneel moeten ze minstens een regelhoogte los staan.
      const afstand = ys[i]! - ys[i - 1]!;
      expect(afstand, `labels op y=${ys[i - 1]} en y=${ys[i]} overlappen`).toBeGreaterThanOrEqual(
        14,
      );
    }
  });

  it("gebruikt geen legenda meer — elk paneel benoemt zijn eigen lijnen", () => {
    const { container } = render(
      <Dagprofiel
        voorbeelden={dagen}
        losseDag={null}
        ontbreekt={null}
        eersteDag="2025-01-01"
        laatsteDag="2025-12-31"
        onVraagDag={() => {}}
        onWisDag={() => {}}
      />,
    );
    expect(container.querySelector(".legenda")).toBeNull();
    // Maar de identiteit moet er wél zijn, anders is kleur de enige drager.
    const namen = [...container.querySelectorAll("text.lijn-label")].map(
      (el) => el.textContent,
    );
    expect(namen).toContain("je betaalt");
    expect(namen).toContain("je krijgt");
    expect(namen).toContain("mét batterij");
    expect(namen).toContain("zónder batterij");
  });
});
