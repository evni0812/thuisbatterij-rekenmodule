/**
 * De browsercache: één bundel per configuratie, en het hoofdresultaat mag
 * nooit door een later binnenkomend scenario of raster worden vervangen.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  INDEX_SLEUTEL,
  MAX_ITEMS,
  VELDKLASSE,
  dispatchDeel,
  dispatchSleutel,
  leesCache,
  leesCacheZonderData,
  schrijfCache,
  wisAlles,
} from "../lib/cache";
import { bewaarLaatste, bewaarProfiel, leesLaatste, leesProfielen } from "../lib/opslag";
import { standaardConfiguratie } from "../lib/configuratie";
import type { Configuration } from "../lib/worker/protocol";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import type { AnalysisResult } from "../lib/model/analysis";

/** Een herkenbaar nepresultaat; de cache kijkt alleen of de vorm klopt. */
function nep(merk: string): AnalysisResult {
  return { averageSavingEur: merk.length, merk, perYear: [], finance: {} } as unknown as AnalysisResult;
}

/** De dataversie: `gegenereerd` uit het manifest. */
const DATA = "2026-09-16T19:23:33.824857+00:00";

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
      // De kostenregel raakt alleen de financiën per maat, niet de dispatch.
      { kostenPerKwhEur: (basis.kostenPerKwhEur ?? 0) + 100 },
      { kostenPerKwEur: (basis.kostenPerKwEur ?? 0) + 100 },
      { installatieEur: (basis.installatieEur ?? 0) + 100 },
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
    schrijfCache(cfg, DATA, { scenario: nep("scenario") });
    expect(leesCache(cfg, DATA)).toBeNull();
    expect(window.localStorage.getItem(dispatchSleutel(cfg, DATA))).toBeNull();
  });

  it("laat het hoofdresultaat staan als het scenario en het raster later binnenkomen", () => {
    schrijfCache(cfg, DATA, { result: nep("hoofd") });
    schrijfCache(cfg, DATA, { scenario: nep("scenario"), scenarioJaar: 2029 });
    schrijfCache(cfg, DATA, { grid: [[{ capacityKwh: 1, powerKw: 1, savingEur: 1, cyclesPerYear: 1 }]] });
    schrijfCache(cfg, DATA, { huishoudens: [null] });
    const bundel = leesCache(cfg, DATA)!;
    expect((bundel.result as unknown as { merk: string }).merk).toBe("hoofd");
    expect((bundel.scenario as unknown as { merk: string }).merk).toBe("scenario");
    expect(bundel.scenarioJaar).toBe(2029);
    expect(bundel.grid).toHaveLength(1);
    expect(bundel.huishoudens).toEqual([null]);
  });

  it("vervangt het hoofdresultaat wél als er een nieuw resultaat komt", () => {
    schrijfCache(cfg, DATA, { result: nep("een") });
    schrijfCache(cfg, DATA, { result: nep("twee") });
    expect((leesCache(cfg, DATA)!.result as unknown as { merk: string }).merk).toBe("twee");
  });
});

describe("opruimen via de index", () => {
  it("houdt precies MAX_ITEMS bundels en gooit de oudste weg", () => {
    const sleutels: string[] = [];
    for (let i = 0; i < MAX_ITEMS + 3; i++) {
      const cfg = maakConfiguratie({ ...STANDAARD, afnameKwh: 1000 + i });
      sleutels.push(dispatchSleutel(cfg, DATA));
      schrijfCache(cfg, DATA, { result: nep(`r${i}`) });
    }
    const bewaard = sleutels.filter((k) => window.localStorage.getItem(k) !== null);
    expect(bewaard).toHaveLength(MAX_ITEMS);
    // De drie oudste zijn weg, de nieuwste staat er nog.
    expect(window.localStorage.getItem(sleutels[0]!)).toBeNull();
    expect(window.localStorage.getItem(sleutels[2]!)).toBeNull();
    expect(window.localStorage.getItem(sleutels[sleutels.length - 1]!)).not.toBeNull();
    const index = JSON.parse(window.localStorage.getItem(INDEX_SLEUTEL)!) as { sleutel: string }[];
    expect(index.map((r) => r.sleutel).sort()).toEqual(bewaard.sort());
  });

  it("neemt bundels van vóór de index op en ruimt ze als eerste op", () => {
    // Een bundel die er al stond zonder in de index te staan.
    window.localStorage.setItem("tbat:v1:oud", JSON.stringify({ result: nep("oud"), opgeslagen: 5 }));
    for (let i = 0; i < MAX_ITEMS; i++) {
      schrijfCache(maakConfiguratie({ ...STANDAARD, afnameKwh: 2000 + i }), DATA, { result: nep(`r${i}`) });
    }
    expect(window.localStorage.getItem("tbat:v1:oud")).toBeNull();
  });

  it("wist met wisAlles ook de index", () => {
    schrijfCache(maakConfiguratie(STANDAARD), DATA, { result: nep("x") });
    expect(window.localStorage.getItem(INDEX_SLEUTEL)).not.toBeNull();
    wisAlles();
    expect(window.localStorage.getItem(INDEX_SLEUTEL)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});

describe("de cache blijft van de bewaarde instellingen af", () => {
  // Regressie: opruimen en wisAlles gooiden alles weg wat met "tbat:" begon,
  // dus ook "tbat:instellingen:v1". Zes doorrekeningen of één volle opslag en
  // de profielen van een bezoeker waren stilzwijgend verdwenen.
  const eigen = { ...STANDAARD, afnameKwh: 4321 };

  it("overleeft meer doorrekeningen dan de cache bewaart", () => {
    bewaarProfiel("Thuis", eigen);
    bewaarLaatste(eigen);
    for (let i = 0; i < MAX_ITEMS + 4; i++) {
      schrijfCache(maakConfiguratie({ ...STANDAARD, afnameKwh: 3000 + i }), DATA, { result: nep(`r${i}`) });
    }
    expect(leesProfielen().map((p) => p.naam)).toEqual(["Thuis"]);
    expect(leesLaatste()?.inst.afnameKwh).toBe(4321);
  });

  it("overleeft een volle opslag", () => {
    bewaarProfiel("Thuis", eigen);
    const origineel = Storage.prototype.setItem;
    let eerste = true;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k.startsWith("tbat:cache:v") && eerste) {
        eerste = false;
        throw new DOMException("vol", "QuotaExceededError");
      }
      return origineel.call(this, k, v);
    };
    try {
      schrijfCache(standaardConfiguratie(), DATA, { result: nep("na quota") });
    } finally {
      Storage.prototype.setItem = origineel;
    }
    expect(leesProfielen().map((p) => p.naam)).toEqual(["Thuis"]);
    // En de tweede poging heeft de bundel alsnog bewaard.
    expect(leesCache(standaardConfiguratie(), DATA)).not.toBeNull();
  });

  it("ruimt het oude schema op zonder de instellingen te raken", () => {
    bewaarLaatste(eigen);
    window.localStorage.setItem("tbat:v14:abc", JSON.stringify({ result: nep("oud"), opgeslagen: 1 }));
    window.localStorage.setItem("tbat:index", JSON.stringify([{ sleutel: "tbat:v14:abc", opgeslagen: 1 }]));
    window.localStorage.setItem("iets:anders", "blijft");
    schrijfCache(standaardConfiguratie(), DATA, { result: nep("nieuw") });
    expect(window.localStorage.getItem("tbat:v14:abc")).toBeNull();
    expect(window.localStorage.getItem("tbat:index")).toBeNull();
    expect(window.localStorage.getItem("iets:anders")).toBe("blijft");
    expect(leesLaatste()?.inst.afnameKwh).toBe(4321);
    wisAlles();
    expect(leesLaatste()?.inst.afnameKwh).toBe(4321);
    expect(window.localStorage.getItem("iets:anders")).toBe("blijft");
  });
});

describe("de dataversie", () => {
  it("zit in de sleutel: nieuwe data is een nieuwe bundel", () => {
    const cfg = standaardConfiguratie();
    expect(dispatchSleutel(cfg, DATA)).not.toBe(dispatchSleutel(cfg, "2026-10-01T00:00:00+00:00"));
    schrijfCache(cfg, DATA, { result: nep("oude data") });
    expect(leesCache(cfg, "2026-10-01T00:00:00+00:00")).toBeNull();
    // Zonder manifest (offline) mag de laatste bundel van deze configuratie
    // wél, van welke dataversie ook.
    expect((leesCacheZonderData(cfg)!.result as unknown as { merk: string }).merk).toBe("oude data");
  });
});

describe("robuust tegen rommel", () => {
  it("geeft een beschadigde bundel niet door en ruimt hem op", () => {
    const cfg = standaardConfiguratie();
    const sleutel = dispatchSleutel(cfg, DATA);
    const rommel = ["{niet json", JSON.stringify({ result: null }), JSON.stringify({ result: { perYear: 3 } }), "12"];
    for (const r of rommel) {
      window.localStorage.setItem(sleutel, r);
      expect(leesCache(cfg, DATA), r).toBeNull();
    }
    window.localStorage.setItem(sleutel, JSON.stringify({ result: nep("x"), grid: "stuk" }));
    expect(leesCache(cfg, DATA)).toBeNull();
    expect(window.localStorage.getItem(sleutel)).toBeNull();
  });

  it("geeft NaN, Infinity en null elk een eigen sleutel", () => {
    const basis = standaardConfiguratie();
    const met = (v: number | null) =>
      dispatchSleutel({ ...basis, household: { ...basis.household, spreadFactor: v as number } });
    const sleutels = new Set([met(Number.NaN), met(Number.POSITIVE_INFINITY), met(null), met(1)]);
    expect(sleutels.size).toBe(4);
  });
});
