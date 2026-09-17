/**
 * De kostenregel: wat een andere maat kost dan de gekozen batterij.
 *
 * Eén generieke regel, verankerd aan de gekozen batterij. De tests bewaken de
 * eigenschappen waar de rest op leunt: bij de eigen maat exact de eigen prijs,
 * de installateur precies één keer bij het oversteken van 0,8 kW, en in
 * stappen rekenen geeft hetzelfde als in één keer.
 */
import { describe, expect, it } from "vitest";
import { dispatchSleutel } from "../lib/cache";
import { STANDAARD, kiesPreset, maakConfiguratie, standaardConfiguratie } from "../lib/configuratie";
import {
  STANDAARD_KOSTENREGEL,
  ankerVan,
  isVasteAansluiting,
  kostenVan,
  kostenregelVan,
  type Anker,
} from "../lib/model/kosten";

const REGEL = STANDAARD_KOSTENREGEL;
const ZENDURE: Anker = { investmentEur: 699, capaciteitKwh: 1.92, vermogenKw: 0.8 };
const THUISACCU: Anker = { investmentEur: 3750, capaciteitKwh: 5, vermogenKw: 2.5 };

describe("de kostenregel", () => {
  it("geeft bij de eigen maat exact de eigen prijs", () => {
    expect(kostenVan(ZENDURE, REGEL, 1.92, 0.8)).toBe(699);
    expect(kostenVan(THUISACCU, REGEL, 5, 2.5)).toBe(3750);
  });

  it("rekent per kilowattuur en per kilowatt erbij", () => {
    expect(kostenVan(ZENDURE, REGEL, 2.92, 0.8)).toBeCloseTo(699 + REGEL.perKwhEur, 9);
    // Meer vermogen binnen de stekkergrens: alleen de omvormer.
    expect(kostenVan({ ...ZENDURE, vermogenKw: 0.5 }, REGEL, 1.92, 0.8)).toBeCloseTo(699 + 0.3 * REGEL.perKwEur, 9);
  });

  it("telt de installateur één keer, bij het oversteken van 0,8 kW", () => {
    expect(isVasteAansluiting(0.8)).toBe(false);
    expect(isVasteAansluiting(1.5)).toBe(true);
    expect(kostenVan(ZENDURE, REGEL, 1.92, 1.5)).toBeCloseTo(699 + 0.7 * REGEL.perKwEur + REGEL.installatieEur, 9);
    // Nog verder omhoog: geen tweede installateur.
    expect(kostenVan(ZENDURE, REGEL, 1.92, 5)).toBeCloseTo(699 + 4.2 * REGEL.perKwEur + REGEL.installatieEur, 9);
  });

  it("trekt de installateur er weer af op de weg terug naar een stekkerbatterij", () => {
    expect(kostenVan(THUISACCU, REGEL, 5, 0.8)).toBeCloseTo(3750 - 1.7 * REGEL.perKwEur - REGEL.installatieEur, 9);
  });

  it("komt nooit onder nul", () => {
    expect(kostenVan({ investmentEur: 100, capaciteitKwh: 10, vermogenKw: 5 }, REGEL, 1, 0.5)).toBe(0);
  });

  it("geeft in stappen dezelfde prijs als in één keer", () => {
    const viaB = kostenVan(ZENDURE, REGEL, 5, 2.5);
    const B: Anker = { investmentEur: viaB, capaciteitKwh: 5, vermogenKw: 2.5 };
    expect(kostenVan(B, REGEL, 10, 3.6)).toBeCloseTo(kostenVan(ZENDURE, REGEL, 10, 3.6), 9);
    // En terug naar het beginpunt.
    expect(kostenVan(B, REGEL, 1.92, 0.8)).toBeCloseTo(699, 9);
  });

  it("leest de regel uit de configuratie, met de standaard als terugval", () => {
    const cfg = standaardConfiguratie();
    expect(kostenregelVan(cfg)).toEqual(REGEL);
    const { kostenPerKwhEur: _a, kostenPerKwEur: _b, installatieEur: _c, ...zonder } = cfg;
    void _a; void _b; void _c;
    expect(kostenregelVan(zonder as typeof cfg)).toEqual(REGEL);
    expect(kostenregelVan({ ...cfg, kostenPerKwhEur: 400 }).perKwhEur).toBe(400);
    expect(ankerVan(cfg)).toEqual({ investmentEur: 699, capaciteitKwh: 1.92, vermogenKw: 0.8 });
  });
});

describe("de configuratie", () => {
  it("houdt de standaardsleutel: de kostenregel is afleiding, geen dispatch", () => {
    const cfg = standaardConfiguratie();
    expect(cfg.investmentEur).toBe(kiesPreset(STANDAARD.presetId).prijsEur);
    const { kostenPerKwhEur: _a, kostenPerKwEur: _b, installatieEur: _c, ...zonder } = cfg;
    void _a; void _b; void _c;
    expect(dispatchSleutel(cfg)).toBe(dispatchSleutel(zonder as typeof cfg));
    expect(dispatchSleutel({ ...cfg, kostenPerKwhEur: 999 })).toBe(dispatchSleutel(cfg));
  });

  it("prijst een overschreven maat met de kostenregel vanaf de preset", () => {
    // Eerder kreeg een Zendure van 5 kWh bij 2,5 kW de prijs van de kleine: 699 euro.
    const cfg = maakConfiguratie({ ...STANDAARD, capaciteitKwh: 5, vermogenKw: 2.5 });
    expect(cfg.investmentEur).toBeCloseTo(699 + 3.08 * REGEL.perKwhEur + 1.7 * REGEL.perKwEur + REGEL.installatieEur, 6);
    expect(cfg.investmentEur).toBeGreaterThan(2000);
  });

  it("laat een eigen prijs vóórgaan op de kostenregel", () => {
    const cfg = maakConfiguratie({ ...STANDAARD, capaciteitKwh: 5, vermogenKw: 2.5, prijsEur: 1800 });
    expect(cfg.investmentEur).toBe(1800);
  });

  it("gebruikt de ingestelde kostenregel", () => {
    const cfg = maakConfiguratie({ ...STANDAARD, capaciteitKwh: 2.92, kostenPerKwh: 500 });
    expect(cfg.investmentEur).toBeCloseTo(699 + 500, 6);
    expect(cfg.kostenPerKwhEur).toBe(500);
  });

  it("rekent de eigen groep in de prijs van de presets boven 0,8 kW", () => {
    for (const p of ["zendure-2400ac", "marstek-venus-e3", "anker-solarbank-max"]) {
      expect(kiesPreset(p).prijsNoot, p).toMatch(/eigen groep/);
    }
    expect(kiesPreset("marstek-venus-e3").prijsEur).toBe(1499);
  });
});
