// @vitest-environment jsdom
/**
 * Wat de pagina bij de batterij toont is wat de worker rekent: de prijs, de
 * maat, de hint onder de keuze en de waarschuwingen komen uit één bron
 * (`effectieveBatterij` in lib/configuratie.ts).
 *
 * Regressie: een Zendure 800 Pro met 10 kWh liet 699 euro zien in het prijsveld
 * terwijl er met ruim 3.285 euro gerekend werd.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Invoer, controleerInvoer } from "../components/Invoer";
import { STANDAARD, effectieveBatterij, kiesPreset, maakConfiguratie } from "../lib/configuratie";
import { kostenVan } from "../lib/model/kosten";

afterEach(cleanup);

const ZENDURE = "zendure-800pro2";

describe("effectieveBatterij", () => {
  it("geeft zonder overschrijving exact de preset, niets aangepast", () => {
    const p = kiesPreset(STANDAARD.presetId);
    const e = effectieveBatterij(STANDAARD);
    expect(e).toEqual({
      capaciteitKwh: p.capaciteitKwh,
      vermogenKw: p.vermogenKw,
      laadKw: p.laadvermogenKw,
      ontlaadKw: p.ontlaadvermogenKw,
      prijsEur: p.prijsEur,
      aangepast: { capaciteit: false, vermogen: false, prijs: false },
    });
  });

  it("rekent de prijs van een overschreven maat met de kostenregel, niet met de presetprijs", () => {
    const inst = { ...STANDAARD, presetId: ZENDURE, capaciteitKwh: 10 };
    const p = kiesPreset(ZENDURE);
    const e = effectieveBatterij(inst);
    expect(e.capaciteitKwh).toBe(10);
    expect(e.vermogenKw).toBe(p.vermogenKw);
    expect(e.prijsEur).toBeGreaterThan(3000);
    expect(e.prijsEur).not.toBe(p.prijsEur);
    expect(e.prijsEur).toBeCloseTo(
      kostenVan(
        { investmentEur: p.prijsEur, capaciteitKwh: p.capaciteitKwh, vermogenKw: p.vermogenKw },
        { perKwhEur: STANDAARD.kostenPerKwh, perKwEur: STANDAARD.kostenPerKw, installatieEur: STANDAARD.installatieEur },
        10,
        p.vermogenKw,
      ),
      6,
    );
    expect(e.aangepast).toEqual({ capaciteit: true, vermogen: false, prijs: true });
  });

  it("is precies wat maakConfiguratie doorrekent", () => {
    const gevallen = [
      STANDAARD,
      { ...STANDAARD, presetId: ZENDURE, capaciteitKwh: 10 },
      { ...STANDAARD, presetId: ZENDURE, vermogenKw: 2.5 },
      { ...STANDAARD, presetId: ZENDURE, capaciteitKwh: 5, vermogenKw: 2.5 },
      { ...STANDAARD, presetId: ZENDURE, capaciteitKwh: 5, vermogenKw: 2.5, prijsEur: 1800 },
      { ...STANDAARD, presetId: "marstek-venus-e3", capaciteitKwh: 8, kostenPerKwh: 500 },
      // Buiten de grenzen: pagina en worker klemmen hetzelfde.
      { ...STANDAARD, capaciteitKwh: 500, vermogenKw: -3 },
    ];
    for (const inst of gevallen) {
      const cfg = maakConfiguratie(inst);
      const e = effectieveBatterij(inst);
      expect(e.prijsEur, JSON.stringify(inst)).toBe(cfg.investmentEur);
      expect(e.capaciteitKwh).toBe(cfg.battery.capacityKwh);
      expect(e.vermogenKw).toBe(cfg.battery.maxChargeKw);
    }
  });

  it("laat een eigen prijs vóórgaan en markeert alleen die als aangepast", () => {
    const inst = { ...STANDAARD, presetId: ZENDURE, prijsEur: 1234 };
    const e = effectieveBatterij(inst);
    expect(e.prijsEur).toBe(1234);
    expect(e.aangepast).toEqual({ capaciteit: false, vermogen: false, prijs: true });
  });
});

describe("de hint onder de batterijkeuze", () => {
  function toon(props: Partial<React.ComponentProps<typeof Invoer>> = {}) {
    return render(
      <Invoer
        afnameKwh={2500}
        terugleveringKwh={2000}
        presetId={ZENDURE}
        onAfname={() => {}}
        onTeruglevering={() => {}}
        onPreset={() => {}}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
        {...props}
      />,
    ).container;
  }
  const hint = (c: HTMLElement) =>
    [...c.querySelectorAll(".veld-hint")].map((e) => e.textContent).find((t) => t?.includes(" kW"));

  it("toont de presetwaarden zonder 'aangepast' als er niets is overschreven", () => {
    const p = kiesPreset(ZENDURE);
    const t = hint(toon())!;
    expect(t).toMatch(/^1,92 kWh · 0,8 kW · €\s699$/);
    expect(t).not.toContain("aangepast");
    // Met de effectieve waarden gelijk aan de preset ook.
    const gelijk = hint(toon({ capaciteitKwh: p.capaciteitKwh, vermogenKw: p.vermogenKw, prijsEur: p.prijsEur }))!;
    expect(gelijk).toBe(t);
  });

  it("toont de effectieve waarden en zegt wat er aangepast is", () => {
    const inst = { ...STANDAARD, presetId: ZENDURE, capaciteitKwh: 10 };
    const e = effectieveBatterij(inst);
    const t = hint(toon({ capaciteitKwh: e.capaciteitKwh, vermogenKw: e.vermogenKw, prijsEur: e.prijsEur }))!;
    expect(t).toContain("10 kWh (aangepast)");
    expect(t).toContain("0,8 kW ·");
    expect(t).not.toContain("0,8 kW (aangepast)");
    expect(t).toMatch(/€\s[\d.]+ \(aangepast\)$/);
    expect(t).not.toContain("699");
  });

  it("waarschuwt met de effectieve maat, niet met die van de preset", () => {
    const p = kiesPreset(ZENDURE);
    // 25 kWh bij 2.500 kWh per jaar is groot; 1,92 kWh niet.
    expect(controleerInvoer(2500, 2000, p).some((w) => w.tekst.includes("groot"))).toBe(false);
    expect(
      controleerInvoer(2500, 2000, p, true, { capaciteitKwh: 25, vermogenKw: p.vermogenKw }).some((w) =>
        w.tekst.includes("25 kWh"),
      ),
    ).toBe(true);
    expect(
      controleerInvoer(2500, 2000, p, true, { capaciteitKwh: p.capaciteitKwh, vermogenKw: 6 }).some((w) =>
        w.tekst.includes("1-fase"),
      ),
    ).toBe(true);
  });
});
