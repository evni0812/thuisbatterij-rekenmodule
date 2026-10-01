// @vitest-environment jsdom
/**
 * Stap 4 en 5 van de begeleide route.
 *
 * Wat hier vastligt: de stappen tonen dezelfde getallen als de tabbladen
 * (hoofdgetal uit Antwoord, terugverdientijden uit Cashflow/overgang), het
 * oordeel heeft vaste drempels, en de checklist zegt alleen wat de data zegt.
 */
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Antwoord } from "../components/Antwoord";
import { Cashflow } from "../components/Cashflow";
import { StapOpbrengst } from "../components/gids/StapOpbrengst";
import { StapPast } from "../components/gids/StapPast";
import type { GidsData } from "../components/gids/types";
import {
  MIN_WINST_ANDERE_MAAT_EUR,
  RUIM_GRENS_JAAR,
  andereMaat,
  aansluitingRegel,
  checklist,
  co2Regel,
  cumulatief,
  hoofdgetal,
  oordeel,
  panelenRegel,
  posten,
  sparkPad,
} from "../components/gids/uitkomst";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { expandPricesToQuarters, loadManifest, loadPriceYear, loadProfileYear } from "../lib/data/loader";
import { euro, jaren, kwh } from "../lib/format";
import { runAnalysis, type AnalysisResult } from "../lib/model/analysis";
import { celFinance, rasterNiveau } from "../lib/model/dimensionering";
import { co2Jaar } from "../lib/model/co2";
import { buildResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import type { DispatchResult, Window } from "../lib/model/types";
import { overgangsFinance } from "../lib/overgang";
import { PRESETS } from "../lib/presets";
import type { GridState } from "../lib/useAnalysis";
import type { Configuration } from "../lib/worker/protocol";

afterEach(cleanup);

const DOMAIN = "871685900000056162";

const INSTELLINGEN = {
  afnameKwh: 2500, terugleveringKwh: 2000, presetId: "marstek-venus-e3", heffing: STANDAARD.heffing,
  domein: DOMAIN, van: "", tot: "", spreiding: 1, terugleverkostenCt: 0,
  curtailment: true, analysejaren: 15, discontovoet: 0.03,
  prijsstijging: STANDAARD.prijsstijging, slijtageDeel: STANDAARD.slijtageDeel,
  kostenPerKwh: STANDAARD.kostenPerKwh, kostenPerKw: STANDAARD.kostenPerKw,
  installatieEur: STANDAARD.installatieEur, co2Drempel: STANDAARD.co2Drempel, doel: STANDAARD.doel,
  degradatie: 0.015, prijsEur: null, capaciteitKwh: null, vermogenKw: null,
  opwekKwh: null, zonnepanelen: true, standbyWatt: null,
};

let result: AnalysisResult;
let config: Configuration;

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
  const jaar = 2025;
  const prof = await loadProfileYear(manifest, DOMAIN, jaar);
  const price = await loadPriceYear(manifest, jaar);
  const startMs = prof.startMs.slice(0, prof.startMs.length);
  const tariff = {
    purchaseSurchargeEurPerKwh: 0,
    energyTaxEurPerKwh: price.levyEurPerKwh,
    feedInCostEurPerKwh: 0,
    allowCurtailment: true,
  };
  config = maakConfiguratie(INSTELLINGEN);
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
          prices: buildPriceSeries(expandPricesToQuarters(startMs, price, "market"), tariff),
        },
      },
    ],
    battery: { ...preset.spec, wearCostEurPerKwh: 0 },
    tariff,
    investmentEur: config.investmentEur,
    cycleLife: preset.cycleLife,
    calendarLifeYears: preset.kalenderLevensduurJaren,
    years: 15,
    priceEscalation: 0.02,
    discountRate: 0.03,
    calendarFadePerYear: 0.015,
    residualValueEur: 0,
  });
}, 120_000);

/** Een tweede doorrekening met een dubbele besparing: het nettarief van 2029 als scenario. */
function metScenario() {
  const scenario = {
    ...result,
    curve: result.curve.map((p) => ({ ...p, savingEur: p.savingEur * 2, cyclesPerYear: p.cyclesPerYear * 1.2 })),
  };
  return { scenario, overgang: overgangsFinance(result, scenario, config) };
}

function maakData(deel: Partial<GidsData> = {}): GidsData {
  return {
    inst: STANDAARD,
    zetInst: vi.fn(),
    manifest: null,
    preset: PRESETS[1]!,
    capaciteitKwh: config.battery.capacityKwh,
    vermogenKw: config.battery.maxDischargeKw,
    prijsEur: config.investmentEur,
    result,
    toon: config,
    scenario: null,
    overgang: null,
    scenarioFout: null,
    grid: null,
    huishoudens: null,
    toonZonnepanelen: true,
    bedragJarenTekst: "2025",
    bezig: false,
    verouderd: false,
    herbereken: vi.fn(),
    uitleg: () => undefined,
    naarVerdieping: vi.fn(),
    volgende: vi.fn(),
    ...deel,
  } as GidsData;
}

describe("stap 4: het hoofdgetal", () => {
  it("toont hetzelfde bedrag en dezelfde bandbreedte als Antwoord", () => {
    const h = hoofdgetal(result);
    expect(h.gemiddeldEur).toBe(result.averageSavingEur);
    // Eén volledig jaar: geen bandbreedte, net als in Antwoord.
    expect(h.band).toBeNull();

    render(<Antwoord result={result} scenario={null} overgang={null} investeringEur={config.investmentEur} bezig={false} />);
    const antwoord = document.body.textContent ?? "";
    expect(antwoord).toContain(euro(result.averageSavingEur));
    cleanup();

    const { container } = render(<StapOpbrengst {...maakData()} />);
    // Het zichtbare bedrag is aria-hidden; de schermlezer krijgt het eindbedrag.
    expect(container.querySelector(".gids-groot [aria-hidden]")?.textContent).toBe(euro(result.averageSavingEur));
    expect(container.querySelector(".gids-groot .visueel-verborgen")?.textContent).toBe(euro(result.averageSavingEur));
    expect(container.textContent).toMatch(/per jaar bespaard/);
    expect(container.textContent).toMatch(/Doorgerekend op de uurprijzen van 2025, met de belasting van nu/);
    expect(container.textContent).toMatch(/stand-byverbruik/);
  });

  it("zet de bandbreedte erbij zodra de jaren verschillen, zoals Antwoord", () => {
    const tweeJaar: AnalysisResult = {
      ...result,
      minSavingEur: 100,
      maxSavingEur: 111,
      perYear: [
        { ...result.perYear[0]!, year: 2024 },
        { ...result.perYear[0]!, year: 2025 },
      ],
    };
    const h = hoofdgetal(tweeJaar);
    expect(h.band).toEqual({ minEur: 100, maxEur: 111 });
    expect(h.jarenTekst).toBe("2024 en 2025");
    const { container } = render(<StapOpbrengst {...maakData({ result: tweeJaar })} />);
    expect(container.querySelector(".uk-band")?.textContent).toContain(`Tussen ${euro(100)} en ${euro(111)}, afhankelijk van welk jaar je pakt`);

    cleanup();
    render(<Antwoord result={tweeJaar} scenario={null} overgang={null} investeringEur={1} bezig={false} />);
    const gelijk = (t: string) => t.replace(/\s+/g, " ");
    expect(gelijk(document.body.textContent ?? "")).toContain(
      gelijk(`tussen ${euro(100)} en ${euro(111)}, afhankelijk van welk jaar je pakt`),
    );
  });

  it("laat een skeleton zien zolang er geen resultaat is", () => {
    const { container } = render(<StapOpbrengst {...maakData({ result: null, toon: null })} />);
    expect(container.querySelector(".uk-skelet")).not.toBeNull();
    expect(container.querySelector(".gids-groot")).toBeNull();
  });
});

describe("stap 4: waar het vandaan komt", () => {
  it("telt de posten op tot het hoofdgetal en trekt het verlies er niet nog eens af", () => {
    const lijst = posten(result.breakdown);
    const som = lijst.reduce((s, x) => s + x.waardeEur, 0);
    // Zoals Uitsplitsing: de posten stapelen op tot de besparing.
    expect(som).toBeCloseTo(result.averageSavingEur, 5);
    expect(lijst.map((x) => x.id)).not.toContain("verlies");
    const { container } = render(<StapOpbrengst {...maakData()} />);
    expect(container.querySelector(".uk-balk")?.getAttribute("role")).toBe("img");
    expect(container.textContent).toMatch(/Zelf gebruiken/);
    expect(container.textContent).toMatch(/Slim laden en leveren/);
    expect(container.textContent).toMatch(/verlies bij laden en ontladen/);
  });

  it("laat negatieve prijzen ontlopen weg als het vrijwel nul is", () => {
    const b = { ...result.breakdown, avoidedNegativeExportEur: 0.1 };
    expect(posten(b).map((x) => x.id)).toEqual(["zelf", "slim"]);
    expect(posten({ ...b, avoidedNegativeExportEur: 12 }).map((x) => x.id)).toEqual(["zelf", "slim", "negatief"]);
  });
});

describe("stap 4: terugverdienen", () => {
  it("noemt de terugverdientijd met en zonder het nettarief, gelijk aan Cashflow", () => {
    const { scenario, overgang } = metScenario();
    expect(overgang.finance.paybackYears).not.toBe(result.finance.paybackYears);

    const { container } = render(<StapOpbrengst {...maakData({ scenario, overgang })} />);
    const kaarten = [...container.querySelectorAll(".uk-kaart")];
    expect(kaarten).toHaveLength(2);
    expect(kaarten[0]!.textContent).toMatch(/Gaat het nettarief van 2029 door/);
    expect(kaarten[0]!.textContent).toContain(jaren(overgang.finance.paybackYears));
    expect(kaarten[1]!.textContent).toMatch(/Blijft het nettarief zoals nu/);
    expect(kaarten[1]!.textContent).toContain(jaren(result.finance.paybackYears));
    expect(container.textContent).toContain(euro(config.investmentEur));
    expect(container.textContent).toMatch(/vanaf 1 januari 2027 eerst 2 jaar/);
    // Elk lijntje heeft een tekstalternatief.
    for (const svg of container.querySelectorAll("svg.uk-spark")) {
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.getAttribute("aria-label")).toMatch(/Opgetelde besparing min de aanschaf/);
    }

    cleanup();
    const cash = render(
      <Cashflow finance={result.finance} overgang={overgang} investeringEur={config.investmentEur} jarenTekst="2025" />,
    );
    const rij = [...cash.container.querySelectorAll("table.looptijd-vergelijking tbody tr")].find((r) =>
      /Terugverdientijd/.test(r.textContent ?? ""),
    )!;
    const cellen = [...rij.querySelectorAll("td")].map((c) => c.textContent);
    expect(cellen).toEqual([jaren(overgang.finance.paybackYears), jaren(result.finance.paybackYears)]);
  });

  it("wacht op het nettarief zonder er een getal voor in de plaats te zetten", () => {
    const { container } = render(<StapOpbrengst {...maakData()} />);
    const kaarten = [...container.querySelectorAll(".uk-kaart")];
    expect(kaarten[0]!.textContent).toMatch(/rekenen het nettarief van 2029 nog door/);
    expect(kaarten[1]!.textContent).toContain(jaren(result.finance.paybackYears));
  });

  it("zegt 'niet terugverdiend binnen de looptijd' als er geen terugverdientijd is", () => {
    const nooit = { ...result, finance: { ...result.finance, paybackYears: null } };
    const { container } = render(<StapOpbrengst {...maakData({ result: nooit })} />);
    expect(container.textContent!.toLowerCase()).toContain(jaren(null));
    expect(jaren(null)).toBe("niet terugverdiend binnen de looptijd");
  });

  it("zet het kader 'Dit is geen voorspelling' neer en de drie verwijzingen", () => {
    const naarVerdieping = vi.fn();
    const uitleg = vi.fn(() => <button type="button">Hoe is dit berekend?</button>);
    const { container } = render(<StapOpbrengst {...maakData({ naarVerdieping, uitleg })} />);
    const kader = container.querySelector(".notitie.waarschuwing")!;
    expect(kader.textContent).toMatch(/Dit is geen voorspelling/);
    expect(kader.textContent).toMatch(/Niemand weet wat de stroomprijzen/);

    fireEvent.click(screen.getByRole("button", { name: "Waar komt de besparing vandaan?" }));
    expect(naarVerdieping).toHaveBeenLastCalledWith("besparing");
    fireEvent.click(screen.getByRole("button", { name: "Over de looptijd" }));
    expect(naarVerdieping).toHaveBeenLastCalledWith("terugverdienen", "looptijd");
    expect(uitleg).toHaveBeenCalledWith("antwoord");
    expect(screen.getByRole("button", { name: "Hoe is dit berekend?" })).toBeTruthy();
  });

  it("rekent het lijntje op een gedeelde schaal", () => {
    const { overgang } = metScenario();
    const a = cumulatief(result.finance, config.investmentEur);
    const b = cumulatief(overgang.finance, config.investmentEur);
    expect(a[0]).toBe(-config.investmentEur);
    expect(a).toHaveLength(result.finance.cashflows.length + 1);
    const schaal = { min: Math.min(0, ...a, ...b), max: Math.max(0, ...a, ...b) };
    const pa = sparkPad(a, result.finance.paybackYears, 240, 76, schaal);
    const pb = sparkPad(b, overgang.finance.paybackYears, 240, 76, schaal);
    // Dezelfde nullijn op dezelfde hoogte.
    expect(pa.nulY).toBeCloseTo(pb.nulY, 6);
    // Het terugverdienpunt ligt op de nullijn.
    if (pa.punt) expect(pa.punt.y).toBe(pa.nulY);
    // Niet terugverdiend: geen punt.
    expect(sparkPad([-100, -50, -20], null, 240, 76, { min: -100, max: 0 }).punt).toBeNull();
  });
});

describe("stap 5: het oordeel", () => {
  it("legt de drempels vast", () => {
    expect(RUIM_GRENS_JAAR).toBe(8);
    expect(oordeel(3, 15).niveau).toBe("ruim");
    expect(oordeel(7.99, 15).niveau).toBe("ruim");
    expect(oordeel(8, 15).niveau).toBe("lang");
    expect(oordeel(15, 15).niveau).toBe("lang");
    expect(oordeel(15.01, 15).niveau).toBe("niet");
    expect(oordeel(null, 15).niveau).toBe("niet");
  });

  it("gebruikt de kalenderlevensduur, niet de looptijd van de doorrekening", () => {
    // Een batterij van tien jaar die zich na twaalf jaar terugverdient, verdient zich niet terug.
    expect(oordeel(12, 10).niveau).toBe("niet");
    expect(oordeel(12, 15).niveau).toBe("lang");
    expect(oordeel(12, 10).kop).toMatch(/binnen zijn levensduur niet terug/);
    expect(oordeel(9, 10).toelichting).toMatch(/levensduur van 10 jaar/);
  });

  it("zegt in de kop wat de getallen zeggen", () => {
    expect(oordeel(6, 15).kop).toBe("Deze batterij verdient zich ruim binnen zijn levensduur terug");
    expect(oordeel(11, 15).kop).toBe("Deze batterij verdient zich terug, maar het duurt lang");
    expect(oordeel(null, 15).kop).toBe("Deze batterij verdient zich binnen de looptijd niet terug");
  });

  it("volgt de terugverdientijd met overgang, en noemt dat de overgang nog loopt", () => {
    const { scenario, overgang } = metScenario();
    const { container } = render(<StapPast {...maakData({ scenario, overgang })} />);
    const verwacht = oordeel(overgang.finance.paybackYears, config.calendarLifeYears);
    expect(container.querySelector(".ps-oordeel h2")?.textContent).toBe(verwacht.kop);
    expect(container.querySelector(".ps-wacht")).toBeNull();
    expect(container.querySelector(".ps-cijfers")?.textContent).toContain(euro(overgang.finance.npvEur));
    expect(container.querySelector(".ps-cijfers")?.textContent).toContain(euro(config.investmentEur));

    cleanup();
    const zonder = render(<StapPast {...maakData()} />);
    expect(zonder.container.querySelector(".ps-oordeel h2")?.textContent).toBe(
      oordeel(result.finance.paybackYears, config.calendarLifeYears).kop,
    );
    expect(zonder.container.querySelector(".ps-wacht")?.textContent).toMatch(/nettarief van 2029/);
  });
});

describe("stap 5: de checklist", () => {
  it("zegt zonder zonnepanelen dat de besparing uit slim laden en leveren komt", () => {
    const b = { ...result.breakdown, selfConsumptionEur: 0, arbitrageEur: 40, avoidedNegativeExportEur: 0, totalEur: 40 };
    const r = panelenRegel(b, false)!;
    expect(r.tekst).toMatch(/^Zonder zonnepanelen komt de besparing alleen uit slim laden en leveren\./);
    expect(r.tekst).not.toMatch(/zonnestroom/);
    expect(r.teken).toBe("info");

    const regels = checklist({ result: { ...result, breakdown: b }, toon: config, toonZonnepanelen: false, grid: null });
    expect(regels.find((x) => x.id === "panelen")?.tekst).toBe(r.tekst);
  });

  it("noemt met zonnepanelen het aandeel zelf gebruiken uit de uitsplitsing", () => {
    const b = { ...result.breakdown, selfConsumptionEur: 70, arbitrageEur: 30, avoidedNegativeExportEur: 0, totalEur: 100 };
    expect(panelenRegel(b, true)!.tekst).toBe(
      "Met zonnepanelen komt 70 procent van de besparing uit zelf gebruiken van je eigen zonnestroom. De rest komt uit slim laden en leveren.",
    );
    // Zonder besparing geen aandeel, dus geen regel.
    expect(panelenRegel({ ...b, totalEur: 0 }, true)).toBeNull();
  });

  it("kiest tussen stekker en installateur op het vermogen", () => {
    expect(aansluitingRegel(0.8).teken).toBe("goed");
    expect(aansluitingRegel(0.8).tekst).toMatch(/stekkerbatterij/);
    expect(aansluitingRegel(0.9).teken).toBe("let-op");
    expect(aansluitingRegel(3).tekst).toMatch(/installateur/);
  });

  it("noemt het dynamische contract en het stand-byverbruik altijd", () => {
    const regels = checklist({ result, toon: config, toonZonnepanelen: true, grid: null });
    expect(regels.find((x) => x.id === "contract")?.tekst).toMatch(/dynamisch energiecontract nodig.*vast of variabel/);
    // Het stand-byverbruik is van de besparing afgetrokken, met de getallen uit het resultaat.
    const metStandby: AnalysisResult = {
      ...result,
      breakdown: { ...result.breakdown, standbyEur: -19.4, standbyKwh: 80 },
    };
    const standby = checklist({ result: metStandby, toon: { ...config, standbyWatt: 8 }, toonZonnepanelen: true, grid: null }).find(
      (x) => x.id === "standby",
    );
    expect(standby?.tekst).toBe(
      `Het stand-byverbruik van de batterij (8 W, ${kwh(80)} per jaar, ${euro(19.4)}) is al van de besparing afgetrokken.`,
    );
    expect(standby?.teken).toBe("info");
    // Op 0 W is er niets afgetrokken, en dat zegt de regel.
    const nul = checklist({ result, toon: { ...config, standbyWatt: 0 }, toonZonnepanelen: true, grid: null }).find(
      (x) => x.id === "standby",
    );
    expect(nul?.tekst).toMatch(/zonder stand-byverbruik/);
    expect(nul?.teken).toBe("let-op");
  });

  it("zet het stand-byverbruik als aftrekpost bij de posten, zodat ze optellen tot het hoofdgetal", () => {
    const b = { ...result.breakdown, standbyEur: -19.4, standbyKwh: 80, totalEur: result.breakdown.totalEur - 19.4 };
    const lijst = posten(b);
    expect(lijst.at(-1)?.id).toBe("standby");
    expect(lijst.at(-1)?.waardeEur).toBe(-19.4);
    expect(lijst.reduce((s, x) => s + x.waardeEur, 0)).toBeCloseTo(b.totalEur, 9);
    // Bij 0 W staat de post er niet.
    expect(posten({ ...result.breakdown, standbyEur: 0, standbyKwh: 0 }).some((x) => x.id === "standby")).toBe(false);
  });

  describe("CO2 met het teken van Co2Antwoord", () => {
    function venster(ef: number[], residual: number[]): Window {
      const start = Date.UTC(2025, 5, 15, 17, 0);
      return {
        startMs: new Float64Array(ef.map((_, i) => start + i * 900_000)),
        residualKwh: new Float64Array(residual),
        prices: { importPrice: new Float64Array(ef.length), exportPrice: new Float64Array(ef.length) },
        co2GPerKwh: new Float64Array(ef),
      } as unknown as Window;
    }
    function dispatch(imp: number[], exp: number[]): DispatchResult {
      const n = imp.length;
      return {
        gridImportKwh: new Float64Array(imp), gridExportKwh: new Float64Array(exp),
        chargeKwh: new Float64Array(n), dischargeKwh: new Float64Array(n),
        socKwh: new Float64Array(n), curtailedKwh: new Float64Array(n), totalCostEur: 0, equivalentCycles: 0,
      } as unknown as DispatchResult;
    }
    // Zelfde getallen als tests/components.test.tsx.
    const beter = co2Jaar(venster([400, 400, 60, 60], [2, 2, -1, -1]), dispatch([2, 2, 0, 0], [0, 0, 1, 1]), dispatch([0.5, 0.5, 0, 0], [0, 0, 0, 0]));
    const slechter = co2Jaar(venster([60, 60, 400, 400], [10, 10, 10, 10]), dispatch([10, 10, 10, 10], [0, 0, 0, 0]), dispatch([15, 15, 10, 10], [0, 0, 0, 0]));
    const gelijk = co2Jaar(venster([400, 400], [1, 1]), dispatch([1, 1], [0, 0]), dispatch([1, 1], [0, 0]));

    it("zegt minder als de batterij CO2 scheelt", () => {
      const r = co2Regel(beter)!;
      expect(r.teken).toBe("goed");
      expect(r.tekst).toMatch(/1,2 kg minder CO2 vrij per jaar/);
    });

    it("zegt meer, met een waarschuwing, als de batterij CO2 kost", () => {
      const r = co2Regel(slechter)!;
      expect(r.teken).toBe("let-op");
      expect(r.tekst).toMatch(/0,6 kg meer CO2 vrij per jaar/);
      expect(r.tekst).not.toMatch(/minder CO2/);
    });

    it("zegt dat het nauwelijks scheelt als het verschil nul is, en laat de regel weg zonder data", () => {
      expect(co2Regel(gelijk)!.teken).toBe("info");
      expect(co2Regel(null)).toBeNull();
      const zonderCo2 = checklist({ result: { ...result, co2: null }, toon: config, toonZonnepanelen: true, grid: null });
      expect(zonderCo2.some((x) => x.id === "co2")).toBe(false);
    });
  });
});

describe("stap 5: een andere maat", () => {
  const cap0 = () => config.battery.capacityKwh;
  const kw0 = () => config.battery.maxDischargeKw;

  /** Een raster van 2 × 2 waarin jouw maat linksboven staat. */
  function raster(spaarBeste: number, klaar = true): GridState {
    const rij = (cap: number, s: number[]) => [
      { capacityKwh: cap, powerKw: kw0(), savingEur: s[0]!, cyclesPerYear: 150 },
      { capacityKwh: cap, powerKw: kw0() * 2, savingEur: s[1]!, cyclesPerYear: 150 },
    ];
    return {
      capacities: [cap0(), cap0() * 2],
      powers: [kw0(), kw0() * 2],
      rows: [rij(cap0(), [result.averageSavingEur, result.averageSavingEur]), rij(cap0() * 2, [result.averageSavingEur, spaarBeste])],
      klaar,
      bezig: !klaar,
    };
  }

  it("wacht zolang het raster er niet of niet helemaal is", () => {
    expect(andereMaat(null, config, result).soort).toBe("wacht");
    const half = { ...raster(500), rows: [raster(500).rows[0]!, null] };
    expect(andereMaat(half, config, result).soort).toBe("wacht");
    expect(andereMaat(raster(500, false), config, result).soort).toBe("wacht");
    const regels = checklist({ result, toon: config, toonZonnepanelen: true, grid: null });
    expect(regels.find((x) => x.id === "maat")?.tekst).toBe("We vergelijken nog andere maten…");
  });

  it("noemt de beste maat als die netto meer dan de drempel oplevert", () => {
    const grid = raster(900);
    const m = andereMaat(grid, config, result);
    expect(m.soort).toBe("beter");
    if (m.soort !== "beter") return;
    expect(m.capaciteitKwh).toBe(cap0() * 2);
    expect(m.vermogenKw).toBe(kw0() * 2);
    // Het verschil is dat van het raster zelf, cel tegen cel.
    const niveau = rasterNiveau(result);
    const beste = celFinance(grid.rows[1]![1]!, cap0() * 2, kw0() * 2, config, result.curve, niveau);
    const huidig = celFinance(grid.rows[0]![0]!, cap0(), kw0(), config, result.curve, niveau);
    expect(m.meerEur).toBeCloseTo(beste.npvEur - huidig.npvEur, 6);
    expect(m.meerEur).toBeGreaterThan(MIN_WINST_ANDERE_MAAT_EUR);
    const regel = checklist({ result, toon: config, toonZonnepanelen: true, grid }).find((x) => x.id === "maat")!;
    expect(regel.tekst).toContain("kWh en");
    expect(regel.tekst).toContain(`${euro(m.meerEur)} meer opgeleverd`);
  });

  it("zegt dat jouw maat goed zit als een andere maat niet meer dan de drempel oplevert", () => {
    // Jouw cel levert 400 per jaar (netto positief), de beste 405: een verschil onder de drempel.
    const grid = raster(405);
    grid.rows[0]![0]!.savingEur = 400;
    grid.rows[0]![1]!.savingEur = 400;
    grid.rows[1]![0]!.savingEur = 400;
    const m = andereMaat(grid, config, result);
    expect(m.soort).toBe("huidig-beste");
    const regel = checklist({ result, toon: config, toonZonnepanelen: true, grid }).find((x) => x.id === "maat")!;
    expect(regel.teken).toBe("goed");
    expect(regel.tekst).toMatch(/Jouw maat zit dicht bij de maat met het hoogste netto resultaat, van de 4 die we vergeleken/);
  });

  it("zegt dat geen maat netto uit de kosten komt als alles verlies is", () => {
    const grid = raster(1);
    grid.rows = grid.rows.map((rij) => rij!.map((p) => ({ ...p, savingEur: 1 })));
    const armResult = { ...result, averageSavingEur: 1, curve: result.curve.map((p) => ({ ...p, savingEur: 1 })) };
    expect(andereMaat(grid, config, armResult).soort).toBe("geen-winst");
  });

  it("rekent door met de maat en de prijs uit de kostenregel, zodra de invoer is bijgewerkt", () => {
    const zetInst = vi.fn();
    const herbereken = vi.fn();
    const grid = raster(900);
    const m = andereMaat(grid, config, result);
    if (m.soort !== "beter") throw new Error("verwachtte een betere maat");
    render(<StapPast {...maakData({ grid, zetInst, herbereken })} />);
    fireEvent.click(screen.getByRole("button", { name: "Reken met deze maat" }));
    expect(zetInst).toHaveBeenCalledWith({
      capaciteitKwh: m.capaciteitKwh,
      vermogenKw: m.vermogenKw,
      prijsEur: m.prijsEur,
    });
    // De prijs is niet null: null zou de prijs van de gekozen batterij overnemen.
    expect(zetInst.mock.calls[0]![0].prijsEur).not.toBeNull();
    expect(herbereken).toHaveBeenCalledTimes(1);
  });

  it("verwijst naar de kaart van maten", () => {
    const naarVerdieping = vi.fn();
    render(<StapPast {...maakData({ grid: raster(900), naarVerdieping })} />);
    fireEvent.click(screen.getByRole("button", { name: "Bekijk alle maten" }));
    expect(naarVerdieping).toHaveBeenCalledWith("welke-batterij", "maat");
  });
});

describe("stap 5: volgende stappen", () => {
  it("kopieert de link en bevestigt dat", async () => {
    const schrijf = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: schrijf }, configurable: true });
    render(<StapPast {...maakData()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Bewaar of deel je uitkomst/ }));
    });
    expect(schrijf).toHaveBeenCalledWith(window.location.href);
    expect(document.body.textContent).toMatch(/Link gekopieerd/);
  });

  it("zegt eerlijk dat kopiëren niet lukte", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("geweigerd")) },
      configurable: true,
    });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    render(<StapPast {...maakData()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Bewaar of deel je uitkomst/ }));
    });
    expect(document.body.textContent).toMatch(/Kopiëren lukte niet/);
    expect(document.body.textContent).not.toMatch(/Link gekopieerd/);
  });

  it("verwijst naar de verantwoording en naar de maten en huishoudens", () => {
    const naarVerdieping = vi.fn();
    render(<StapPast {...maakData({ naarVerdieping })} />);
    fireEvent.click(screen.getByRole("button", { name: /Bekijk alle cijfers en de verantwoording/ }));
    expect(naarVerdieping).toHaveBeenLastCalledWith("aannames");
    fireEvent.click(screen.getByRole("button", { name: /Vergelijk maten en huishoudens/ }));
    expect(naarVerdieping).toHaveBeenLastCalledWith("welke-batterij");
  });

  it("laat een skeleton zien zolang er geen resultaat is", () => {
    const { container } = render(<StapPast {...maakData({ result: null, toon: null })} />);
    expect(container.querySelector(".uk-skelet")).not.toBeNull();
    expect(container.querySelector(".ps-oordeel")).toBeNull();
  });
});
