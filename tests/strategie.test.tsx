/**
 * De strategie voor de laadbeurten: welk deel van de slijtageprijs de planner
 * meerekent. Drie standen met een naam, en een schuif ertussen.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Geavanceerd } from "../components/Geavanceerd";
import { Laadbeurten, minimaalPrijsverschil } from "../components/Laadbeurten";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import type { KeyStats } from "../lib/model/analysis";
import { computeFinance } from "../lib/model/finance";
import { PRESETS } from "../lib/presets";
import { STRATEGIEEN, strategieVoor } from "../lib/strategie";

afterEach(cleanup);

describe("de standen", () => {
  it("lopen van zuinig naar maximaal en zijn uniek", () => {
    const delen = STRATEGIEEN.map((s) => s.deel);
    expect(delen).toEqual([1, 0.5, 0.2]);
    for (const s of STRATEGIEEN) expect(strategieVoor(s.deel)?.id).toBe(s.id);
    expect(strategieVoor(0.7)).toBeNull();
  });

  it("gaat standaard op maximaal rendement en komt als wearFraction in de configuratie", () => {
    /**
     * De beurten zijn bij deze batterijen niet het schaarse goed: 6.000 over
     * vijftien kalenderjaren is 400 per jaar, en zelfs zonder drempel haalt de
     * accu er 411. Een hogere drempel laat dan opbrengst liggen die nooit meer
     * terugkomt. Niet nul, want doorzet kost altijd capaciteit; 0,2 is precies
     * het deel dat het model aan de beurten toerekent.
     */
    expect(STANDAARD.slijtageDeel).toBe(0.2);
    expect(strategieVoor(STANDAARD.slijtageDeel)?.id).toBe("maximaal");
    expect(maakConfiguratie(STANDAARD).wearFraction).toBe(0.2);
    expect(maakConfiguratie({ ...STANDAARD, slijtageDeel: 1 }).wearFraction).toBe(1);
  });
});

describe("de knoppen in de instellingen", () => {
  function toon(slijtageDeel: number, onChange = vi.fn()) {
    render(
      <Geavanceerd
        inst={{ ...STANDAARD, slijtageDeel }}
        manifest={null}
        preset={PRESETS[0]!}
        capaciteit={PRESETS[0]!.capaciteitKwh}
        vermogen={PRESETS[0]!.vermogenKw}
        prijs={PRESETS[0]!.prijsEur}
        onChange={onChange}
        onReset={() => {}}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
        open
      />,
    );
    return onChange;
  }

  it("markeert de stand die bij de schuif hoort", () => {
    toon(0.5);
    expect(screen.getByRole("button", { name: "Gebalanceerd" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Zuinig" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("zet de schuif op de waarde van de gekozen stand", () => {
    const onChange = toon(1);
    fireEvent.click(screen.getByRole("button", { name: "Maximaal rendement" }));
    expect(onChange).toHaveBeenCalledWith({ slijtageDeel: 0.2 });
  });

  it("noemt bij een eigen waarde het percentage en de drempel in centen", () => {
    toon(0.7);
    for (const s of STRATEGIEEN) {
      expect(screen.getByRole("button", { name: s.naam }).getAttribute("aria-pressed")).toBe("false");
    }
    expect(screen.getByText(/Eigen waarde: de planner rekent 70%/)).toBeDefined();
  });
});

describe("de laadbeurten over de levensduur", () => {
  /**
   * De figuur hoeft geen echte doorrekening: hij leest de opgetelde beurten uit
   * de cashflow en zet die tegenover de twee levensduren. Een synthetische
   * curve met een vast aantal beurten per jaar is genoeg om beide verhalen te
   * laten zien.
   */
  function toon(cyclesPerYear: number, wearFraction = 1) {
    const config = { ...maakConfiguratie(STANDAARD), wearFraction };
    const finance = computeFinance({
      curve: [
        { capacityFraction: 0.7, savingEur: 70, cyclesPerYear },
        { capacityFraction: 1, savingEur: 100, cyclesPerYear },
      ],
      investmentEur: config.investmentEur,
      years: 15,
      priceEscalation: 0,
      discountRate: 0,
      calendarFadePerYear: 0.015,
      cycleLife: config.cycleLife,
      residualValueEur: 0,
    });
    const stats = { cyclesPerYear, wearCostEurPerKwh: 0.1 } as unknown as KeyStats;
    render(<Laadbeurten finance={finance} stats={stats} config={config} />);
    return { config, finance };
  }

  it("zegt dat de batterij aan zijn leeftijd sterft als de beurten niet opraken", () => {
    const { config } = toon(300);
    expect(300 * config.calendarLifeYears).toBeLessThan(config.cycleLife);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/aan zijn leeftijd/);
    expect(screen.getByText(/beurten raken niet op vóór de kalender/)).toBeDefined();
  });

  it("zegt dat de cellen eerder op zijn als er te veel beurten zijn", () => {
    const { config } = toon(800);
    expect(800 * config.calendarLifeYears).toBeGreaterThan(config.cycleLife);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/eerder dan de kalender/);
  });

  it("toont de drempel als deel van de slijtageprijs", () => {
    toon(300, 0.2);
    // 20% van 10 ct is 2 ct; het bedrag en de noot staan samen in één cel.
    const noot = screen.getByText(/maximaal rendement: 20% van de slijtageprijs/);
    expect(noot.parentElement?.textContent).toMatch(/^2 ct\/kWh/);
  });

  it("rekent het minimale prijsverschil uit het omzettingsverlies en de drempel", () => {
    // Rendement 90% rondgang (η ≈ 0,9487): om 1 kWh te leveren koop je 1,111 in.
    const eta = Math.sqrt(0.9);
    const verschil = minimaalPrijsverschil(0.2, eta, 0.05);
    expect(verschil).toBeCloseTo(0.2 / 0.9 - 0.2 + 0.05, 9);
    // Zonder drempel blijft alleen het verlies over.
    expect(minimaalPrijsverschil(0.2, eta, 0)).toBeCloseTo(0.2 / 0.9 - 0.2, 9);
  });
});
