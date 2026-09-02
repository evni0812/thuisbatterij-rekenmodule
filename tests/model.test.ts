import { describe, expect, it } from "vitest";
import { buildQuarterAxis } from "../lib/data/timeaxis";
import {
  equivalentCycles,
  marginalWearCostPerKwh,
  remainingCapacityFraction,
  roundTripEfficiency,
  usableCapacityKwh,
  wearCostPerKwh,
} from "../lib/model/battery";
import { dispatchBaseline } from "../lib/model/dispatch-baseline";
import { dispatchRolling } from "../lib/model/dispatch-rolling";
import { dispatchOptimal } from "../lib/model/dispatch-optimal";
import { breakdown as breakdownVoorTest } from "../lib/model/analysis";
import { buildPriceSeries } from "../lib/model/tariff";
import { HOURS_PER_STEP, type BatterySpec, type DispatchResult, type TariffSpec, type Window } from "../lib/model/types";

const TARIFF: TariffSpec = {
  purchaseSurchargeEurPerKwh: 0.02,
  energyTaxEurPerKwh: 0.11,
  feedInCostEurPerKwh: 0,
  allowCurtailment: false,
};

function spec(over: Partial<BatterySpec> = {}): BatterySpec {
  return {
    capacityKwh: 10,
    depthOfCharge: 0.95,
    maxChargeKw: 3.6,
    maxDischargeKw: 3.6,
    efficiency: Math.sqrt(0.92),
    standbyWatt: 0,
    wearCostEurPerKwh: 0,
    ...over,
  };
}

/**
 * Bouw een venster met een herhalend dagpatroon: 's nachts goedkoop, overdag
 * zonoverschot met lage prijs, 's avonds duur met een verbruikspiek. Dat is de
 * situatie waarin een thuisbatterij waarde heeft.
 */
function makeWindow(days: number, seed = 1): Window {
  const startMs = buildQuarterAxis("2025-01-01", nDaysLater("2025-01-01", days));
  const n = startMs.length;
  const residual = new Float64Array(n);
  const market = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const q = i % 96;
    const hour = q / 4;
    // Zonoverschot rond het middaguur, verbruikspiek 's ochtends en 's avonds.
    const solar = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)) * 1.2;
    const load = 0.12 + 0.25 * Math.exp(-((hour - 19) ** 2) / 4) + 0.15 * Math.exp(-((hour - 8) ** 2) / 3);
    residual[i] = load - solar;
    // Prijs volgt de klassieke duck curve, met wat variatie tussen dagen.
    const day = Math.floor(i / 96);
    const wobble = 1 + 0.3 * Math.sin((day * seed * 2.7) % (2 * Math.PI));
    market[i] = (0.09 - 0.07 * Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)) + 0.06 * Math.exp(-((hour - 19) ** 2) / 6)) * wobble;
  }
  return { startMs, residualKwh: residual, prices: buildPriceSeries(market, TARIFF) };
}

function nDaysLater(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

function saving(
  w: Window,
  s: BatterySpec,
  t: TariffSpec,
  fn: (w: Window, s: BatterySpec, t: TariffSpec) => DispatchResult,
): number {
  return dispatchBaseline(w, t).totalCostEur - fn(w, s, t).totalCostEur;
}

describe("energiebalans", () => {
  it("sluit per kwartier voor beide strategieën", () => {
    const w = makeWindow(7);
    for (const fn of [dispatchOptimal, dispatchRolling]) {
      const r = fn(w, spec(), TARIFF);
      for (let i = 0; i < w.residualKwh.length; i++) {
        const links = w.residualKwh[i]! + r.chargeKwh[i]! - r.dischargeKwh[i]!;
        const rechts = r.gridImportKwh[i]! - r.gridExportKwh[i]! - r.curtailedKwh[i]!;
        expect(Math.abs(links - rechts)).toBeLessThan(1e-9);
      }
    }
  });

  it("houdt de lading binnen de bruikbare capaciteit", () => {
    const w = makeWindow(7);
    const s = spec();
    const usable = usableCapacityKwh(s);
    for (const fn of [dispatchOptimal, dispatchRolling]) {
      const r = fn(w, s, TARIFF);
      for (let i = 0; i < r.socKwh.length; i++) {
        expect(r.socKwh[i]!).toBeGreaterThanOrEqual(-1e-9);
        expect(r.socKwh[i]!).toBeLessThanOrEqual(usable + 1e-9);
      }
    }
  });

  it("respecteert de vermogenslimieten aan de AC-zijde", () => {
    const w = makeWindow(7);
    const s = spec({ maxChargeKw: 2.4, maxDischargeKw: 1.8 });
    for (const fn of [dispatchOptimal, dispatchRolling]) {
      const r = fn(w, s, TARIFF);
      for (let i = 0; i < r.chargeKwh.length; i++) {
        expect(r.chargeKwh[i]!).toBeLessThanOrEqual(2.4 * HOURS_PER_STEP + 1e-9);
        expect(r.dischargeKwh[i]!).toBeLessThanOrEqual(1.8 * HOURS_PER_STEP + 1e-9);
      }
    }
  });

  it("laadt en ontlaadt nooit tegelijk", () => {
    const w = makeWindow(7);
    for (const fn of [dispatchOptimal, dispatchRolling]) {
      const r = fn(w, spec(), TARIFF);
      for (let i = 0; i < r.chargeKwh.length; i++) {
        expect(Math.min(r.chargeKwh[i]!, r.dischargeKwh[i]!)).toBeLessThan(1e-9);
      }
    }
  });
});

describe("monotonie — de test die het oude model faalt", () => {
  /**
   * Het optimum moet strikt monotoon zijn: meer capaciteit of vermogen vergroot
   * alleen de verzameling haalbare plannen, dus het beste plan kan niet
   * slechter worden. Wat overblijft is discretisatieruis van het SoC-grid.
   */
  const OPTIMUM_TOLERANTIE = 0.002; // 0,2% van de besparing

  /**
   * De realistische strategie mag licht niet-monotoon zijn, en dat is geen
   * modelfout maar een echt fenomeen: hij plant op een voorspelling, en met meer
   * vermogen kun je ook harder in de verkeerde richting handelen. Vaker
   * herplannen verandert daar niets aan — gemeten blijft de dip rond 1% bij
   * elke frequentie van eens per dag tot elk kwartier.
   *
   * Het oude Streamlit-model week hier structureel en veel sterker af, doordat
   * de beslissingsregel zélf van de batterijparameters afhing.
   */
  const REALISTISCH_TOLERANTIE = 0.02; // 2%

  function checkMonotoon(
    waarden: number[],
    tolerantie: number,
    label: string,
  ): void {
    for (let i = 1; i < waarden.length; i++) {
      const vorige = waarden[i - 1]!;
      const huidige = waarden[i]!;
      const marge = Math.abs(vorige) * tolerantie + 1e-9;
      expect(
        huidige,
        `${label}: stap ${i} daalde van ${vorige.toFixed(4)} naar ${huidige.toFixed(4)}`,
      ).toBeGreaterThanOrEqual(vorige - marge);
    }
  }

  it("meer capaciteit levert nooit minder besparing op", () => {
    const w = makeWindow(14);
    const caps = [1, 2, 3, 5, 8, 10, 12, 15, 20];
    checkMonotoon(
      caps.map((c) => saving(w, spec({ capacityKwh: c }), TARIFF, dispatchOptimal)),
      OPTIMUM_TOLERANTIE,
      "optimum/capaciteit",
    );
    checkMonotoon(
      caps.map((c) => saving(w, spec({ capacityKwh: c }), TARIFF, dispatchRolling)),
      REALISTISCH_TOLERANTIE,
      "realistisch/capaciteit",
    );
  });

  it("meer vermogen levert nooit minder besparing op", () => {
    const w = makeWindow(14);
    const kws = [0.5, 0.8, 1.2, 2.4, 3.6, 5, 8];
    const pow = (kw: number) => spec({ maxChargeKw: kw, maxDischargeKw: kw });
    checkMonotoon(
      kws.map((k) => saving(w, pow(k), TARIFF, dispatchOptimal)),
      OPTIMUM_TOLERANTIE,
      "optimum/vermogen",
    );
    checkMonotoon(
      kws.map((k) => saving(w, pow(k), TARIFF, dispatchRolling)),
      REALISTISCH_TOLERANTIE,
      "realistisch/vermogen",
    );
  });

  it("de besparing groeit substantieel met de capaciteit", () => {
    // Naast monotonie: het model moet ook echt reageren. Een tienvoudige
    // batterij hoort duidelijk meer op te leveren, niet marginaal meer.
    const w = makeWindow(14);
    const klein = saving(w, spec({ capacityKwh: 2 }), TARIFF, dispatchOptimal);
    const groot = saving(w, spec({ capacityKwh: 20 }), TARIFF, dispatchOptimal);
    expect(groot).toBeGreaterThan(klein * 2);
  });
});

describe("optimum versus heuristiek", () => {
  it("de heuristiek komt nooit boven het optimum uit", () => {
    const w = makeWindow(14);
    for (const cap of [2, 5, 10, 15]) {
      for (const kw of [0.8, 2.4, 3.6]) {
        const s = spec({ capacityKwh: cap, maxChargeKw: kw, maxDischargeKw: kw });
        const opt = saving(w, s, TARIFF, dispatchOptimal);
        const heu = saving(w, s, TARIFF, dispatchRolling);
        expect(heu).toBeLessThanOrEqual(opt + 1e-6);
      }
    }
  });

  it("beide leveren een positieve besparing bij een realistisch profiel", () => {
    const w = makeWindow(14);
    const s = spec();
    expect(saving(w, s, TARIFF, dispatchOptimal)).toBeGreaterThan(0);
    expect(saving(w, s, TARIFF, dispatchRolling)).toBeGreaterThan(0);
  });
});

describe("degeneratie", () => {
  it("een batterij zonder capaciteit geeft exact de baseline", () => {
    const w = makeWindow(7);
    const s = spec({ capacityKwh: 0 });
    const base = dispatchBaseline(w, TARIFF);
    for (const fn of [dispatchOptimal, dispatchRolling]) {
      const r = fn(w, s, TARIFF);
      expect(r.totalCostEur).toBeCloseTo(base.totalCostEur, 9);
      expect(r.equivalentCycles).toBe(0);
    }
  });

  it("een vlakke prijs zonder overschot geeft geen arbitragewinst", () => {
    const n = 96 * 3;
    const startMs = buildQuarterAxis("2025-01-01", "2025-01-04");
    const residual = new Float64Array(n).fill(0.2);   // altijd tekort
    const market = new Float64Array(n).fill(0.08);    // volstrekt vlak
    const w: Window = { startMs, residualKwh: residual, prices: buildPriceSeries(market, TARIFF) };
    const base = dispatchBaseline(w, TARIFF);
    for (const fn of [dispatchOptimal, dispatchRolling]) {
      const r = fn(w, spec(), TARIFF);
      expect(base.totalCostEur - r.totalCostEur).toBeLessThan(1e-6);
    }
  });
});

describe("batterij-boekhouding", () => {
  it("round-trip is het kwadraat van het eenrichtingsrendement", () => {
    expect(roundTripEfficiency(spec({ efficiency: 0.95 }))).toBeCloseTo(0.9025, 9);
  });

  it("telt één volledige laad-ontlaadcyclus als precies 1", () => {
    const s = spec({ capacityKwh: 10, depthOfCharge: 1, efficiency: 0.95 });
    // De cel geeft 10 kWh af; AC-zijdig komt daar 10 * 0.95 van aan.
    expect(equivalentCycles(10 * 0.95, s)).toBeCloseTo(1, 9);
  });

  it("verdeelt de investering over de AC-doorzet van de levensduur", () => {
    const s = spec({ capacityKwh: 10, depthOfCharge: 1, efficiency: 0.95 });
    const w = wearCostPerKwh(5000, 6000, s);
    expect(w).toBeCloseTo(5000 / (6000 * 10 * 0.95), 9);
  });

  it("degradatie neemt de zwaarste van kalender en doorzet", () => {
    expect(remainingCapacityFraction(0, 0, 0.015, 6000)).toBe(1);
    // Na 10 jaar zonder cycli domineert de kalender.
    expect(remainingCapacityFraction(10, 0, 0.015, 6000)).toBeCloseTo(0.9853 ** 0 * Math.pow(0.985, 10), 6);
    // Bij volle cyclusbelasting domineert de doorzet.
    expect(remainingCapacityFraction(1, 6000, 0.015, 6000)).toBeCloseTo(0.8, 9);
  });
});

describe("curtailment", () => {
  it("voorkomt betalen bij een negatieve terugleverprijs", () => {
    const n = 96;
    const startMs = buildQuarterAxis("2025-06-01", "2025-06-02");
    const residual = new Float64Array(n).fill(-0.5);  // permanent overschot
    const market = new Float64Array(n).fill(-0.05);   // negatieve marktprijs
    const zonder: TariffSpec = { ...TARIFF, allowCurtailment: false };
    const met: TariffSpec = { ...TARIFF, allowCurtailment: true };

    const a = dispatchBaseline(
      { startMs, residualKwh: residual, prices: buildPriceSeries(market, zonder) },
      zonder);
    const b = dispatchBaseline(
      { startMs, residualKwh: residual, prices: buildPriceSeries(market, met) },
      met);

    expect(a.totalCostEur).toBeGreaterThan(0);   // je betaalt om terug te leveren
    expect(b.totalCostEur).toBeCloseTo(0, 9);    // afregelen kost niets
  });
});

describe("slijtage telt niet dubbel", () => {
  /**
   * De aanschafprijs mag maar één keer meetellen.
   *
   * De slijtagekosten sturen de dispatch — ze bepalen of een extra cyclus de
   * moeite waard is — maar ze zijn niet iets bovenop de aanschafprijs: ze ZIJN
   * die prijs, uitgesmeerd over de cycli. Die staat al als investering in de
   * businesscase.
   *
   * Toen ze wél van de besparing werden afgetrokken, kreeg een duurdere
   * batterij een hogere schaduwprijs en daarmee een lagere besparing: een
   * FoxESS van 2,1 kWh leek toen minder op te leveren dan een Zendure van
   * 1,92 kWh, puur omdat hij meer kostte.
   */
  it("laat een duurdere batterij niet minder opleveren dan een kleinere goedkopere", () => {
    const w = makeWindow(14);
    const goedkoopKlein = saving(
      w,
      spec({ capacityKwh: 1.92, wearCostEurPerKwh: 0.085 }),
      TARIFF,
      dispatchRolling,
    );
    const duurderGroter = saving(
      w,
      spec({ capacityKwh: 2.1, wearCostEurPerKwh: 0.113 }),
      TARIFF,
      dispatchRolling,
    );
    expect(duurderGroter).toBeGreaterThanOrEqual(goedkoopKlein);
  });

  it("rapporteert dezelfde besparing ongeacht de slijtagedrempel bij gelijk gedrag", () => {
    // Bij een vlakke prijs handelt de batterij niet, dus de slijtagedrempel mag
    // de uitkomst helemaal niet raken.
    const n = 96 * 3;
    const startMs = buildQuarterAxis("2025-01-01", "2025-01-04");
    const residual = new Float64Array(n).fill(0.2);
    const market = new Float64Array(n).fill(0.08);
    const w: Window = {
      startMs,
      residualKwh: residual,
      prices: buildPriceSeries(market, TARIFF),
    };
    const zonder = dispatchRolling(w, spec({ wearCostEurPerKwh: 0 }), TARIFF);
    const met = dispatchRolling(w, spec({ wearCostEurPerKwh: 0.15 }), TARIFF);
    expect(met.totalCostEur).toBeCloseTo(zonder.totalCostEur, 6);
  });
});

describe("uitsplitsing van de besparing", () => {
  /**
   * De post "negatieve prijzen ontlopen" hoort nooit negatief te zijn: je kunt
   * niet minder dan niets ontlopen. Toen het netladen van de batterij er ten
   * onrechte in werd meegeteld, kwam de post op −€2,68 uit — alsof het ontlopen
   * van negatieve prijzen geld kostte.
   */
  it("laat het ontlopen van negatieve prijzen nooit geld kosten", () => {
    // Een venster met flink negatieve prijzen midden op de dag.
    const startMs = buildQuarterAxis("2025-06-01", "2025-06-15");
    const n = startMs.length;
    const residual = new Float64Array(n);
    const market = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const uur = (i % 96) / 4;
      const zon = Math.max(0, Math.sin(((uur - 6) / 12) * Math.PI)) * 1.5;
      residual[i] = 0.15 - zon;
      market[i] = uur > 10 && uur < 16 ? -0.06 : 0.11;
    }
    const tarief: TariffSpec = { ...TARIFF, allowCurtailment: false };
    const w: Window = {
      startMs,
      residualKwh: residual,
      prices: buildPriceSeries(market, tarief),
    };

    const s = spec({ capacityKwh: 5, maxChargeKw: 2.5, maxDischargeKw: 2.5 });
    const base = dispatchBaseline(w, tarief);
    const bat = dispatchRolling(w, s, tarief);
    const b = breakdownVoorTest(w, base, bat, s);

    // Je kunt niet minder dan niets ontlopen.
    expect(b.avoidedNegativeExportEur).toBeGreaterThanOrEqual(0);
    // En de posten tellen nog steeds precies op tot het totaal.
    const som =
      b.selfConsumptionEur + b.arbitrageEur + b.avoidedNegativeExportEur;
    expect(som).toBeCloseTo(b.totalEur, 6);
  });
});

describe("de regelaar volgt zijn eigen plan", () => {
  /**
   * De correctie voor onverwacht overschot mag het plan niet overrulen.
   *
   * Ze stond eerder aan bij élk overschot, met `charge = max(charge, ...)`.
   * Daardoor vulde de batterij zich bij het eerste ochtendzonnetje — terwijl
   * teruglevering dan nog 11 ct opbracht en de prijs 's middags naar nul zakte.
   * Precies dan had hij moeten laden. Over een jaar scheelde dat 12 euro op 90:
   * de strategie haalde 76% van het optimum in plaats van 88%.
   */
  it("laadt niet gretig bij overschot zolang terugleveren nog wat opbrengt", () => {
    const startMs = buildQuarterAxis("2025-06-01", "2025-06-08");
    const n = startMs.length;
    const residual = new Float64Array(n);
    const market = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const uur = (i % 96) / 4;
      // Overschot de hele ochtend en middag, maar de prijs zakt pas na twaalven.
      residual[i] = uur > 8 && uur < 17 ? -1.0 : 0.2;
      market[i] = uur >= 12 && uur < 16 ? 0.005 : 0.12;
    }
    const w: Window = {
      startMs,
      residualKwh: residual,
      prices: buildPriceSeries(market, TARIFF),
    };
    const s = spec({ capacityKwh: 4, maxChargeKw: 2, maxDischargeKw: 2 });
    const r = dispatchRolling(w, s, TARIFF);

    // Tel het laden vóór en na het moment dat de prijs instort, over de dagen
    // waarop de strategie al historie heeft om op te plannen.
    let vroeg = 0;
    let laat = 0;
    for (let i = 96 * 2; i < n; i++) {
      const uur = (i % 96) / 4;
      if (uur > 8 && uur < 12) vroeg += r.chargeKwh[i]!;
      if (uur >= 12 && uur < 16) laat += r.chargeKwh[i]!;
    }
    // Laden hoort te gebeuren als terugleveren niets meer opbrengt.
    expect(laat).toBeGreaterThan(vroeg);
  });
});

describe("slijtage als schaduwprijs", () => {
  /**
   * Een batterij gaat kapot aan het eerste van twee dingen: ouderdom of
   * doorzet. Maakt hij zijn laadbeurten niet op binnen zijn kalenderlevensduur,
   * dan kost een extra beurt niets — hij was toch al afgeschreven op tijd.
   *
   * De drempel stond eerder altijd op de volle aanschafprijs per beurt. Voor een
   * FoxESS S22 was dat 11,3 ct/kWh, waardoor hij 251 beurten per jaar draaide en
   * na vijftien jaar stierf met 40% van zijn 6.000 beurten ongebruikt. Dat kostte
   * 12 euro per jaar aan besparing die er gewoon lag.
   */
  it("rekent niets aan als de laadbeurten toch niet opraken", () => {
    const s = spec({ capacityKwh: 2.1, depthOfCharge: 0.9 });
    // 250 beurten per jaar, 15 jaar: 3.750 van de 6.000. Niet schaars.
    expect(marginalWearCostPerKwh(1199, 6000, s, 250, 15)).toBe(0);
  });

  it("rekent wél af zodra de beurten schaars worden", () => {
    const s = spec({ capacityKwh: 2.1, depthOfCharge: 0.9 });
    // 600 beurten per jaar, 15 jaar: 9.000 van de 6.000. Ruim over.
    const schaars = marginalWearCostPerKwh(1199, 6000, s, 600, 15);
    expect(schaars).toBeGreaterThan(0);
    // En nooit meer dan de volledige prijs per beurt.
    expect(schaars).toBeLessThanOrEqual(wearCostPerKwh(1199, 6000, s));
  });

  it("rekent strenger naarmate de beurten schaarser zijn", () => {
    const s = spec({ capacityKwh: 2.1, depthOfCharge: 0.9 });
    const matig = marginalWearCostPerKwh(1199, 6000, s, 500, 15);
    const nijpend = marginalWearCostPerKwh(1199, 6000, s, 900, 15);
    expect(nijpend).toBeGreaterThan(matig);
  });

  it("laat een batterij die niets kostte vrij cyclen", () => {
    const s = spec();
    expect(marginalWearCostPerKwh(0, 6000, s, 5000, 15)).toBe(0);
  });
});

describe("de uitsplitsing telt niet dubbel", () => {
  /**
   * Het omzettingsverlies hoort niet als vierde post in de optelling.
   *
   * `minderImport × prijs` is de werkelijke reductie van je afname, en die is al
   * kleiner dan wat je opsloeg — precies door het verlies. Het er apart bij
   * aftrekken telt het twee keer, en omdat arbitrage als residu werd berekend,
   * vulde die het gat op met evenveel nep-arbitrage: 32 euro "slim handelen"
   * naast 32 euro verlies, bij een batterij die geen kilowattuur van het net had
   * gekocht.
   */
  it("meldt geen arbitrage als er nooit uit het net is geladen", () => {
    // Een venster met alleen zonoverschot en avondverbruik: er valt niets in te
    // kopen, want de prijs is 's nachts niet lager dan overdag.
    const startMs = buildQuarterAxis("2025-06-01", "2025-06-15");
    const n = startMs.length;
    const residual = new Float64Array(n);
    const market = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const uur = (i % 96) / 4;
      const zon = Math.max(0, Math.sin(((uur - 6) / 12) * Math.PI)) * 1.2;
      residual[i] = 0.18 - zon;
      market[i] = 0.05;
    }
    const w: Window = {
      startMs,
      residualKwh: residual,
      prices: buildPriceSeries(market, TARIFF),
    };
    const s = spec({ capacityKwh: 5, maxChargeKw: 2.5, maxDischargeKw: 2.5 });
    const base = dispatchBaseline(w, TARIFF);
    const bat = dispatchRolling(w, s, TARIFF);
    const b = breakdownVoorTest(w, base, bat, s);

    let uitNet = 0;
    for (let i = 0; i < n; i++) {
      uitNet += Math.max(0, bat.chargeKwh[i]! - Math.max(0, -residual[i]!));
    }
    expect(uitNet).toBeLessThan(0.5);
    // Geen inkoop, dus vrijwel geen arbitrage.
    expect(Math.abs(b.arbitrageEur)).toBeLessThan(1);
    // En de besparing zit dan vrijwel geheel in zelf verbruiken.
    expect(b.selfConsumptionEur).toBeGreaterThan(b.totalEur * 0.9);
  });

  it("rapporteert het verlies naast de optelling, niet erin", () => {
    const w = makeWindow(14);
    const s = spec();
    const base = dispatchBaseline(w, TARIFF);
    const bat = dispatchRolling(w, s, TARIFF);
    const b = breakdownVoorTest(w, base, bat, s);

    const som =
      b.selfConsumptionEur + b.arbitrageEur + b.avoidedNegativeExportEur;
    expect(som).toBeCloseTo(b.totalEur, 6);
    // Het verlies is echt en positief, maar telt niet mee in die som.
    expect(b.conversionLossKwh).toBeGreaterThan(0);
    expect(b.conversionLossEur).toBeGreaterThan(0);
  });

  it("waardeert verlies uit eigen zon lager dan verlies uit inkoop", () => {
    // Dezelfde hoeveelheid verlies is minder waard als de stroom uit een
    // overschot kwam dat je toch maar voor een paar cent had verkocht.
    const n = 96 * 4;
    const startMs = buildQuarterAxis("2025-06-01", "2025-06-05");
    const market = new Float64Array(n).fill(0.02);

    const zonnig = new Float64Array(n);
    const kaal = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const uur = (i % 96) / 4;
      zonnig[i] = uur > 9 && uur < 15 ? -1.5 : 0.2;
      kaal[i] = 0.2;
    }
    const s = spec({ capacityKwh: 5, maxChargeKw: 2.5, maxDischargeKw: 2.5 });
    const maak = (r: Float64Array) => ({
      startMs,
      residualKwh: r,
      prices: buildPriceSeries(market, TARIFF),
    });

    const wZon = maak(zonnig);
    const bZon = breakdownVoorTest(
      wZon,
      dispatchBaseline(wZon, TARIFF),
      dispatchRolling(wZon, s, TARIFF),
      s,
    );
    // Bij een overschot van 2 ct is elke verloren kilowattuur weinig waard.
    if (bZon.conversionLossKwh > 0.1) {
      const perKwh = bZon.conversionLossEur / bZon.conversionLossKwh;
      expect(perKwh).toBeLessThan(TARIFF.energyTaxEurPerKwh);
    }
  });
});
