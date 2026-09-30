// @vitest-environment jsdom
/**
 * Stap 3 van de begeleide route: de dag als film.
 *
 * De stromen moeten per kwartier sluiten, het onderschrift moet zeggen wat er
 * gebeurt, zonder panelen komt er geen zon in beeld, en de jaartegels zijn
 * dezelfde als in de figuur "Zomer- en winterdag".
 */
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Verschuiving } from "../components/Verschuiving";
import { Dagfilm } from "../components/gids/Dagfilm";
import { StapDag } from "../components/gids/StapDag";
import type { GidsData } from "../components/gids/types";
import { beschrijf, dagIsStil, kwartierVanUur, stromenVan } from "../components/gids/dag";
import { expandPricesToQuarters, loadManifest, loadPriceYear, loadProfileYear } from "../lib/data/loader";
import type { Manifest } from "../lib/data/manifest";
import { runAnalysis, type AnalysisResult, type SampleDay } from "../lib/model/analysis";
import { buildResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import { PRESETS } from "../lib/presets";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
    calendarLifeYears: preset.kalenderLevensduurJaren,
    years: 15,
    priceEscalation: 0.02,
    discountRate: 0.03,
    calendarFadePerYear: 0.015,
    residualValueEur: 0,
  });
}, 120_000);


/** Een dag van 96 kwartieren, met het opgegeven verloop per kwartier. */
function maakDag(opties: {
  residual: (i: number) => number;
  laden?: (i: number) => number;
  ontladen?: (i: number) => number;
  prijs?: (i: number) => number;
  exportPrijs?: (i: number) => number;
  afgeregeld?: (i: number) => number;
}): SampleDay {
  const n = 96;
  // 13 juli 2025, middernacht in Amsterdam.
  const begin = Date.UTC(2025, 6, 12, 22, 0);
  const rij = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
  const residual = rij(opties.residual);
  const laden = rij(opties.laden ?? (() => 0));
  const ontladen = rij(opties.ontladen ?? (() => 0));
  const afgeregeld = rij(opties.afgeregeld ?? (() => 0));
  let soc = 0;
  return {
    label: "Een gewone zomerdag",
    date: "2025-07-13",
    startMs: rij((i) => begin + i * 15 * 60_000),
    residualKwh: residual,
    netKwh: residual.map((r, i) => r + laden[i]! - ontladen[i]! + afgeregeld[i]!),
    curtailedKwh: afgeregeld,
    socKwh: rij((i) => (soc = Math.max(0, Math.min(2, soc + laden[i]! - ontladen[i]!)))),
    chargeKwh: laden,
    dischargeKwh: ontladen,
    importPrice: rij(opties.prijs ?? (() => 0.15)),
    exportPrice: rij(opties.exportPrijs ?? (() => 0.05)),
    usableCapacityKwh: 2,
    meterExportKwh: [],
    meterImportKwh: [],
    cumulatiefBasisEur: rij(() => 0),
    cumulatiefBatterijEur: rij(() => 0),
    stats: {
      baselineCostEur: 1,
      batteryCostEur: 0.7,
      savingEur: 0.3,
      optimalSavingEur: null,
      gridImportBaselineKwh: 3,
      gridImportBatteryKwh: 2,
      gridExportBaselineKwh: 1,
      gridExportBatteryKwh: 0.5,
      chargedKwh: 1.2,
      deliveredKwh: 1,
      chargedFromSolarKwh: 0.8,
      chargedFromGridKwh: 0.4,
      cycles: 0.5,
      socMaxKwh: 1.5,
      socStartKwh: 0,
      socEndKwh: 0,
      curtailedKwh: 0,
      wearCostEur: 0.05,
      priceMinEurPerKwh: 0.1,
      priceMaxEurPerKwh: 0.32,
      meterImportKwh: null,
      meterExportKwh: null,
    },
  };
}

/** Een gewone dag met panelen: 's middags overschot dat de batterij opvangt, 's avonds levert hij. */
function zomerDag(): SampleDay {
  return maakDag({
    residual: (i) => (i >= 44 && i < 60 ? -0.4 : i >= 76 && i < 88 ? 0.3 : 0.05),
    laden: (i) => (i >= 44 && i < 60 ? 0.3 : 0),
    ontladen: (i) => (i >= 76 && i < 88 ? 0.3 : 0),
    prijs: (i) => (i >= 76 && i < 88 ? 0.32 : 0.12),
  });
}

/** Zonder panelen: 's nachts laden van het net, 's avonds leveren. */
function nachtDag(): SampleDay {
  return maakDag({
    residual: (i) => (i < 24 ? 0.04 : 0.1),
    laden: (i) => (i >= 4 && i < 20 ? 0.3 : 0),
    ontladen: (i) => (i >= 76 && i < 88 ? 0.1 : 0),
    prijs: (i) => (i < 24 ? 0.08 : i >= 76 && i < 88 ? 0.32 : 0.2),
  });
}

/** Zet de schuif op een kwartier, zoals een gebruiker dat doet. */
function schuifNaar(k: number) {
  fireEvent.change(screen.getByRole("slider", { name: "Tijdstip op de dag" }), { target: { value: String(k) } });
}

function stel(minder: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: minder && /reduced-motion/.test(q),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("de stromen van de dagfilm", () => {
  it("sluiten in elk kwartier van de echte voorbeelddagen", () => {
    expect(result.sampleDays.length).toBeGreaterThan(0);
    for (const dag of result.sampleDays) {
      for (let i = 0; i < dag.startMs.length; i++) {
        const s = stromenVan(dag, i);
        // Wat het huis van buiten nodig heeft, komt van het net of uit de batterij.
        expect(s.netNaarHuis + s.batterijNaarHuis).toBeCloseTo(s.afname0, 9);
        // Wat er met batterij van het net komt, gaat naar het huis of de batterij.
        expect(s.netNaarHuis + s.netNaarBatterij).toBeCloseTo(s.vanNet, 9);
        // Wat er naar het net gaat, komt van de zon of uit de batterij.
        expect(s.zonNaarNet + s.batterijNaarNet).toBeCloseTo(s.naarNet, 9);
        // Het overschot is opgeslagen, teruggeleverd of afgeregeld.
        expect(s.zonNaarBatterij + s.zonNaarNet + dag.curtailedKwh[i]!).toBeCloseTo(s.overschot0, 9);
        // Laden en ontladen zijn samen precies wat de batterij verzet.
        expect(s.zonNaarBatterij + s.netNaarBatterij).toBeCloseTo(dag.chargeKwh[i]!, 9);
        expect(s.batterijNaarHuis + s.batterijNaarNet).toBeCloseTo(dag.dischargeKwh[i]!, 9);
        for (const v of Object.values(s)) if (typeof v === "number") expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("sluiten ook op een dag met afregelen en met laden en leveren tegelijk in de buurt", () => {
    const dag = maakDag({
      residual: (i) => (i >= 44 && i < 56 ? -0.5 : 0.2),
      laden: (i) => (i >= 44 && i < 50 ? 0.2 : 0),
      // Het net krijgt niets: wat niet de batterij in gaat, wordt afgeregeld.
      afgeregeld: (i) => (i >= 44 && i < 56 ? (i < 50 ? 0.3 : 0.5) : 0),
      exportPrijs: (i) => (i >= 44 && i < 56 ? -0.02 : 0.05),
    });
    for (let i = 0; i < 96; i++) {
      const s = stromenVan(dag, i);
      expect(s.zonNaarNet).toBeCloseTo(0, 9);
      expect(s.zonNaarBatterij + s.zonNaarNet + s.afgeregeld).toBeCloseTo(s.overschot0, 9);
      expect(s.netNaarHuis + s.batterijNaarHuis).toBeCloseTo(s.afname0, 9);
    }
    expect(beschrijf(dag, 46, true).zin).toMatch(/De rest gaat niet naar het net/);
    expect(beschrijf(dag, 52, true).fase).toBe("zon-net");
    expect(beschrijf(dag, 52, true).zin).toMatch(/levert nu niets op \(min 2 cent\)/);
  });

  it("splitst laden en ontladen zoals de dagfiguur", () => {
    const dag = zomerDag();
    const middag = stromenVan(dag, 50);
    expect(middag.zonNaarBatterij).toBeCloseTo(0.3, 9);
    expect(middag.netNaarBatterij).toBeCloseTo(0, 9);
    expect(middag.zonNaarNet).toBeCloseTo(0.1, 9);
    const avond = stromenVan(dag, 80);
    expect(avond.batterijNaarHuis).toBeCloseTo(0.3, 9);
    expect(avond.netNaarHuis).toBeCloseTo(0, 9);
  });
});

describe("het onderschrift", () => {
  it("zegt 's middags dat de panelen meer leveren dan het huis gebruikt", () => {
    const dag = zomerDag();
    const b = beschrijf(dag, kwartierVanUur(dag, 13)!, true);
    expect(b.fase).toBe("laden-zon");
    expect(b.tekst).toBe(
      "13.00 uur · Je panelen leveren meer dan je huis gebruikt. De batterij slaat 0,3 kWh op. De rest, 0,1 kWh, gaat naar het net.",
    );
  });

  it("zegt 's avonds dat stroom duur is en de batterij levert", () => {
    const dag = zomerDag();
    const b = beschrijf(dag, kwartierVanUur(dag, 19)!, true);
    expect(b.fase).toBe("leveren");
    expect(b.tekst).toBe(
      "19.00 uur · Stroom is duur (32 cent). De batterij levert 0,3 kWh aan je huis. Je haalt bijna niets van het net.",
    );
  });

  it("noemt zonder panelen het goedkoop laden 's nachts en het leveren 's avonds", () => {
    const dag = nachtDag();
    const nacht = beschrijf(dag, kwartierVanUur(dag, 2)!, false);
    expect(nacht.fase).toBe("laden-net");
    expect(nacht.tekst).toMatch(/^2\.00 uur · Stroom is goedkoop \(8 cent\)\. De batterij laadt 0,3 kWh van het net\.$/);
    const avond = beschrijf(dag, kwartierVanUur(dag, 19)!, false);
    expect(avond.fase).toBe("leveren");
    expect(avond.zin).toMatch(/Stroom is duur \(32 cent\)/);
    // Nergens komt een zon of paneel in een dag zonder panelen voor.
    for (let i = 0; i < 96; i++) expect(beschrijf(dag, i, false).zin).not.toMatch(/panelen leveren/);
  });

  it("zegt op een dag zonder actie waarom de batterij niets doet", () => {
    const dag = maakDag({ residual: () => 0.1 });
    expect(dagIsStil(dag)).toBe(true);
    expect(beschrijf(dag, 40, true).zin).toMatch(/De batterij doet vandaag niets: het prijsverschil is te klein/);
  });

  it("noemt in elke fase van de echte dagen een tijd en een gewone zin", () => {
    for (const dag of result.sampleDays) {
      for (let i = 0; i < dag.startMs.length; i++) {
        const b = beschrijf(dag, i, true);
        expect(b.tekst).toMatch(/^\d{1,2}\.\d{2} uur · [A-Z]/);
        expect(b.tekst).not.toMatch(/NaN|undefined|—|–/);
      }
    }
  });
});

describe("de film", () => {
  it("toont een schema met zon, huis, batterij en net", () => {
    stel(true);
    const { container } = render(<Dagfilm dag={zomerDag()} metPanelen autoplay={false} />);
    for (const k of ["zon", "huis", "batterij", "net"]) {
      expect(container.querySelector(`[data-knoop="${k}"]`)).not.toBeNull();
    }
    const svg = container.querySelector("svg.dagfilm-schema")!;
    expect(svg.getAttribute("viewBox")).toBeTruthy();
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/pijlen/);
  });

  it("laat zonder panelen de zon weg", () => {
    stel(true);
    const { container } = render(<Dagfilm dag={nachtDag()} metPanelen={false} autoplay={false} />);
    expect(container.querySelector('[data-knoop="zon"]')).toBeNull();
    expect(container.querySelector('[data-stroom^="zon"]')).toBeNull();
    expect(container.querySelector('[data-knoop="batterij"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/Zonnepanelen/);
  });

  it("laat het vulniveau van de batterij meebewegen met de lading", () => {
    stel(true);
    const dag = zomerDag();
    const { container } = render(<Dagfilm dag={dag} metPanelen autoplay={false} />);
    const niveau = () =>
      Number(/scaleY\(([\d.]+)\)/.exec(container.querySelector<SVGElement>(".dagfilm-niveau")!.getAttribute("style") ?? "")?.[1]);
    schuifNaar(kwartierVanUur(dag, 4)!);
    const leeg = niveau();
    schuifNaar(kwartierVanUur(dag, 16)!);
    const vol = niveau();
    expect(leeg).toBeLessThan(0.1);
    expect(vol).toBeGreaterThan(0.9);
    expect(container.textContent).toMatch(/van 2 kWh/);
  });

  it("heeft een schuif per kwartier die je met het toetsenbord bedient", () => {
    stel(true);
    render(<Dagfilm dag={zomerDag()} metPanelen autoplay={false} />);
    const schuif = screen.getByRole("slider", { name: "Tijdstip op de dag" }) as HTMLInputElement;
    expect(schuif.type).toBe("range");
    expect(schuif.min).toBe("0");
    expect(schuif.max).toBe("95");
    expect(schuif.step).toBe("1");
    schuifNaar(76);
    expect(schuif.getAttribute("aria-valuetext")).toMatch(/^19\.00 uur, stroom kost 32 cent, batterij \d+% vol$/);
    expect(document.body.textContent).toMatch(/19\.00 uur/);
    expect(document.body.textContent).toMatch(/Stroom is duur \(32 cent\)/);
  });

  it("speelt bij minder beweging niet vanzelf en begint bij het moment waar het om draait", async () => {
    stel(true);
    render(<Dagfilm dag={zomerDag()} metPanelen />);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("button", { name: /Afspelen/ })).toBeTruthy();
    const schuif = screen.getByRole("slider") as HTMLInputElement;
    // Het kwartier met de meeste actie is er een van laden of ontladen, niet middernacht.
    expect(["laden-zon", "leveren"]).toContain(document.querySelector(".dagfilm")!.getAttribute("data-fase"));
    const eerst = schuif.value;
    await new Promise((r) => setTimeout(r, 400));
    expect(schuif.value).toBe(eerst);
  });

  it("speelt zonder die instelling vanzelf af, en stopt met pauze", async () => {
    stel(false);
    render(<Dagfilm dag={zomerDag()} metPanelen />);
    const schuif = screen.getByRole("slider") as HTMLInputElement;
    await waitFor(() => expect(Number(schuif.value)).toBeGreaterThan(2), { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: /Pauze/ }));
    const staat = schuif.value;
    await new Promise((r) => setTimeout(r, 300));
    expect(schuif.value).toBe(staat);
    expect(screen.getByRole("button", { name: /Afspelen/ })).toBeTruthy();
  });

  it("meldt de fase één keer aan een schermlezer, niet bij elk kwartier", () => {
    stel(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<Dagfilm dag={zomerDag()} metPanelen autoplay={false} />);
    const melding = () => document.querySelector('[role="status"][aria-live="polite"]')!.textContent;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const eerst = melding();
    expect(eerst).toMatch(/uur/);

    // Binnen dezelfde fase (laden uit zon, 11.00 tot 15.00 uur) verandert er niets.
    for (const k of [45, 47, 50, 55, 58]) {
      schuifNaar(k);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(melding()).toBe(eerst);
    }
    // Een andere fase wordt wel gemeld, maar pas als hij even blijft staan.
    schuifNaar(80);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(melding()).toBe(eerst);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(melding()).toMatch(/^20\.00 uur · Stroom is duur/);
  });
});

function gidsData(zet: Partial<GidsData> = {}): GidsData {
  return {
    result,
    toonZonnepanelen: true,
    bezig: false,
    uitleg: (id: string) => <button type="button">Hoe is dit berekend? ({id})</button>,
    naarVerdieping: vi.fn(),
    ...zet,
  } as unknown as GidsData;
}

describe("stap 3: wat hij doet", () => {
  it("toont een rustig wachtscherm zolang er geen antwoord is", () => {
    stel(true);
    const { container } = render(<StapDag {...gidsData({ result: null, bezig: true })} />);
    expect(container.querySelector(".dag-skelet")).not.toBeNull();
    expect(container.querySelector(".dagfilm")).toBeNull();
    expect(container.textContent).toMatch(/doorrekening loopt/);
  });

  it("toont de film, de kerngetallen van de dag en de brug naar het jaar", () => {
    stel(true);
    const { container } = render(<StapDag {...gidsData()} />);
    expect(container.querySelector(".dagfilm")).not.toBeNull();
    const tekst = container.textContent ?? "";
    expect(tekst).toMatch(/Opgeslagen/);
    expect(tekst).toMatch(/Zelf gebruikt uit de batterij/);
    expect(tekst).toMatch(/(Bespaard op deze dag|Het kostte deze dag)/);
    expect(tekst).toMatch(/Met de batterij haal je 's avonds per jaar minder van het net/);
    expect(tekst).toMatch(/Een gewone zomerdag: /);
    expect(container.querySelectorAll(".dag-jaartegels .stat").length).toBe(4);
    expect(container.querySelectorAll(".dag-getal").length).toBe(3);
  });

  it("wisselt tussen zomer- en winterdag", () => {
    stel(true);
    const { container } = render(<StapDag {...gidsData()} />);
    expect(container.textContent).toMatch(/Een gewone zomerdag: /);
    fireEvent.click(screen.getByRole("button", { name: "Winterdag" }));
    expect(container.textContent).toMatch(/Een gewone winterdag: /);
    expect(screen.getByRole("button", { name: "Winterdag" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Zomerdag" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("gebruikt dezelfde jaartegels als de figuur Zomer- en winterdag", () => {
    stel(true);
    const stap = render(<StapDag {...gidsData()} />);
    const uitStap = [...stap.container.querySelectorAll(".dag-jaartegels .stat")].map((t) => t.textContent);
    cleanup();
    const figuur = render(<Verschuiving profielen={result.seasonProfiles} zonnepanelen />);
    const uitFiguur = [...figuur.container.querySelectorAll(".stat-grid .stat")].map((t) => t.textContent);
    expect(uitStap.length).toBe(4);
    expect(uitStap).toEqual(uitFiguur);
    cleanup();
    // En zonder panelen: de nachtafname in plaats van de teruglevering.
    const zonder = render(<StapDag {...gidsData({ toonZonnepanelen: false })} />);
    const uitStapZonder = [...zonder.container.querySelectorAll(".dag-jaartegels .stat")].map((t) => t.textContent);
    cleanup();
    const figuurZonder = render(<Verschuiving profielen={result.seasonProfiles} zonnepanelen={false} />);
    const uitFiguurZonder = [...figuurZonder.container.querySelectorAll(".stat-grid .stat")].map((t) => t.textContent);
    expect(uitStapZonder).toEqual(uitFiguurZonder);
  });

  it("zet het hoofdgetal van het jaar gelijk aan de titel van de figuur", () => {
    stel(true);
    const stap = render(<StapDag {...gidsData()} />);
    const groot = stap.container.querySelector(".dag-jaar-groot")!.textContent;
    cleanup();
    const figuur = render(<Verschuiving profielen={result.seasonProfiles} />);
    expect(figuur.container.textContent).toContain(`'s avonds ${groot} per jaar minder van het net`);
  });

  it("wijst onderaan naar de verdieping en heeft de uitleg van het dagprofiel", () => {
    stel(true);
    const naarVerdieping = vi.fn();
    const uitleg = vi.fn((_id: string) => <button type="button">Hoe is dit berekend?</button>);
    const { container } = render(
      <StapDag {...gidsData({ naarVerdieping, uitleg: uitleg as unknown as GidsData["uitleg"] })} />,
    );
    const onder = container.querySelector(".gids-verdieping") as HTMLElement;
    fireEvent.click(within(onder).getByRole("button", { name: "Een dag of week naar keuze bekijken" }));
    expect(naarVerdieping).toHaveBeenLastCalledWith("door-het-jaar", "dag-en-week");
    fireEvent.click(within(onder).getByRole("button", { name: "Hoe dit per maand uitvalt" }));
    expect(naarVerdieping).toHaveBeenLastCalledWith("door-het-jaar", "per-maand");
    expect(uitleg).toHaveBeenCalledWith("dagprofiel");
    expect(within(onder).getByRole("button", { name: "Hoe is dit berekend?" })).toBeTruthy();
  });
});
