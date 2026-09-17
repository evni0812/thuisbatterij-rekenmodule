/**
 * De browsercache: één bundel per configuratie, en het hoofdresultaat mag
 * nooit door een later binnenkomend scenario of raster worden vervangen.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_ITEMS, VELDKLASSE, dispatchDeel, dispatchSleutel, leesCache, schrijfCache, wisAlles } from "../lib/cache";
import { standaardConfiguratie } from "../lib/configuratie";
import type { Configuration } from "../lib/worker/protocol";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import type { AnalysisResult } from "../lib/model/analysis";

/** Een herkenbaar nepresultaat; de cache kijkt niet naar de inhoud. */
function nep(merk: string): AnalysisResult {
  return { averageSavingEur: merk.length, merk } as unknown as AnalysisResult;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("de sleutel", () => {
  it("verschilt zodra een genest veld verschilt", () => {
    // Regressie: de oude sleutel liet geneste velden weg, waardoor elk
    // huishouden met dezelfde batterij dezelfde bundel kreeg.
    const a = maakConfiguratie(STANDAARD);
    const b = maakConfiguratie({ ...STANDAARD, afnameKwh: STANDAARD.afnameKwh + 500 });
    const c = maakConfiguratie({ ...STANDAARD, presetId: "marstek-venus-e3" });
    expect(dispatchSleutel(a)).not.toBe(dispatchSleutel(b));
    expect(dispatchSleutel(a)).not.toBe(dispatchSleutel(c));
  });

  it("hangt niet af van de volgorde waarin het object is opgebouwd", () => {
    const a = maakConfiguratie(STANDAARD);
    const omgekeerd = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(dispatchSleutel(omgekeerd)).toBe(dispatchSleutel(a));
  });
});

describe("de splitsing dispatch/afleiding", () => {
  it("kent elk veld van de configuratie", () => {
    // Het type dwingt dit al af; de test bewaakt dat een optioneel veld dat
    // in de standaardconfiguratie zit ook echt is ingedeeld.
    for (const k of Object.keys(standaardConfiguratie())) {
      expect(VELDKLASSE[k as keyof Configuration], k).toBeDefined();
    }
  });

  it("geeft dezelfde sleutel bij een andere afleiding en een andere bij een andere dispatch", () => {
    const basis = standaardConfiguratie();
    const afleiding: Partial<Configuration>[] = [
      { analysisYears: basis.analysisYears + 5 },
      { priceEscalation: basis.priceEscalation + 0.01 },
      { discountRate: basis.discountRate + 0.01 },
      { calendarFadePerYear: basis.calendarFadePerYear + 0.005 },
      { residualValueEur: basis.residualValueEur + 100 },
      { annualProductionKwh: (basis.annualProductionKwh ?? 0) + 500 },
      { calendarLifeYears: basis.calendarLifeYears + 1 },
    ];
    for (const patch of afleiding) {
      expect(dispatchSleutel({ ...basis, ...patch }), JSON.stringify(patch)).toBe(dispatchSleutel(basis));
    }
    const dispatch: Partial<Configuration>[] = [
      { investmentEur: basis.investmentEur + 1 },
      { cycleLife: basis.cycleLife + 1 },
      { wearFraction: (basis.wearFraction ?? 1) / 2 },
      { household: { ...basis.household, annualGridImportKwh: basis.household.annualGridImportKwh + 1 } },
      { battery: { ...basis.battery, capacityKwh: basis.battery.capacityKwh + 0.1 } },
      { tariff: { ...basis.tariff, feedInCostEurPerKwh: 0.05 } },
      { netTariff: true },
      { afnametype: "AZI" },
      { from: "2025-01-01" },
      { useHistoricalLevy: !basis.useHistoricalLevy },
    ];
    for (const patch of dispatch) {
      expect(dispatchSleutel({ ...basis, ...patch }), JSON.stringify(patch)).not.toBe(dispatchSleutel(basis));
    }
    expect(Object.keys(dispatchDeel(basis))).not.toContain("analysisYears");
  });
});

describe("aanvullen zonder overschrijven", () => {
  const cfg = maakConfiguratie(STANDAARD);

  it("schrijft niets als er nog geen hoofdresultaat is", () => {
    schrijfCache(cfg, { scenario: nep("scenario") });
    expect(leesCache(cfg)).toBeNull();
    expect(window.localStorage.getItem(dispatchSleutel(cfg))).toBeNull();
  });

  it("laat het hoofdresultaat staan als het scenario en het raster later binnenkomen", () => {
    schrijfCache(cfg, { result: nep("hoofd") });
    schrijfCache(cfg, { scenario: nep("scenario"), scenarioJaar: 2029 });
    schrijfCache(cfg, { grid: [[{ capacityKwh: 1, powerKw: 1, savingEur: 1, cyclesPerYear: 1 }]] });
    const bundel = leesCache(cfg)!;
    expect((bundel.result as unknown as { merk: string }).merk).toBe("hoofd");
    expect((bundel.scenario as unknown as { merk: string }).merk).toBe("scenario");
    expect(bundel.scenarioJaar).toBe(2029);
    expect(bundel.grid).toHaveLength(1);
  });

  it("vervangt het hoofdresultaat wél als er een nieuw resultaat komt", () => {
    schrijfCache(cfg, { result: nep("een") });
    schrijfCache(cfg, { result: nep("twee") });
    expect((leesCache(cfg)!.result as unknown as { merk: string }).merk).toBe("twee");
  });
});

describe("opruimen via de index", () => {
  it("houdt precies MAX_ITEMS bundels en gooit de oudste weg", () => {
    const sleutels: string[] = [];
    for (let i = 0; i < MAX_ITEMS + 3; i++) {
      const cfg = maakConfiguratie({ ...STANDAARD, afnameKwh: 1000 + i });
      sleutels.push(dispatchSleutel(cfg));
      schrijfCache(cfg, { result: nep(`r${i}`) });
    }
    const bewaard = sleutels.filter((k) => window.localStorage.getItem(k) !== null);
    expect(bewaard).toHaveLength(MAX_ITEMS);
    // De drie oudste zijn weg, de nieuwste staat er nog.
    expect(window.localStorage.getItem(sleutels[0]!)).toBeNull();
    expect(window.localStorage.getItem(sleutels[2]!)).toBeNull();
    expect(window.localStorage.getItem(sleutels[sleutels.length - 1]!)).not.toBeNull();
    const index = JSON.parse(window.localStorage.getItem("tbat:index")!) as { sleutel: string }[];
    expect(index.map((r) => r.sleutel).sort()).toEqual(bewaard.sort());
  });

  it("neemt bundels van vóór de index op en ruimt ze als eerste op", () => {
    // Een bundel die er al stond zonder in de index te staan.
    window.localStorage.setItem("tbat:v1:oud", JSON.stringify({ result: nep("oud"), opgeslagen: 5 }));
    for (let i = 0; i < MAX_ITEMS; i++) {
      schrijfCache(maakConfiguratie({ ...STANDAARD, afnameKwh: 2000 + i }), { result: nep(`r${i}`) });
    }
    expect(window.localStorage.getItem("tbat:v1:oud")).toBeNull();
  });

  it("wist met wisAlles ook de index", () => {
    schrijfCache(maakConfiguratie(STANDAARD), { result: nep("x") });
    expect(window.localStorage.getItem("tbat:index")).not.toBeNull();
    wisAlles();
    expect(window.localStorage.getItem("tbat:index")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});
