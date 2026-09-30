/**
 * De periode is een paar dat klopt: begin voor einde, binnen de data. Een
 * omgekeerde of lege periode gaf eerst stilzwijgend de hele periode, of een
 * technische foutmelding over ontbrekende profieldata.
 */
import { describe, expect, it } from "vitest";
import { STANDAARD } from "../lib/configuratie";
import {
  LAATSTE_DAG,
  VROEGSTE_DAG,
  klemOpBeschikbaar,
  klemPeriode,
  normaliseer,
  normaliseerDeel,
} from "../lib/normaliseer";
import type { Instellingen } from "../lib/url-state";

const data = { vroegste: "2023-04-01", laatste: "2026-09-12" };

describe("klemPeriode (de datumvelden)", () => {
  it("schuift het einde mee als het begin voorbij het einde komt", () => {
    expect(klemPeriode("van", "2025-09-01", { van: "2025-01-01", tot: "2025-06-30" }, data)).toEqual({
      van: "2025-09-01",
      tot: "2025-09-01",
    });
  });

  it("schuift het begin mee als het einde voor het begin komt", () => {
    expect(klemPeriode("tot", "2024-12-31", { van: "2025-01-01", tot: "2025-06-30" }, data)).toEqual({
      van: "2024-12-31",
      tot: "2024-12-31",
    });
  });

  it("laat een geldig paar ongemoeid", () => {
    expect(klemPeriode("van", "2025-02-01", { van: "2025-01-01", tot: "2025-06-30" }, data)).toEqual({
      van: "2025-02-01",
      tot: "2025-06-30",
    });
    expect(klemPeriode("tot", "2025-07-31", { van: "2025-01-01", tot: "2025-06-30" }, data)).toEqual({
      van: "2025-01-01",
      tot: "2025-07-31",
    });
  });

  it("klemt op de beschikbare data en laat een leeg veld leeg", () => {
    expect(klemPeriode("van", "2027-03-01", { van: "", tot: "" }, data)).toEqual({ van: "2026-09-12", tot: "" });
    expect(klemPeriode("tot", "2019-01-01", { van: "", tot: "" }, data)).toEqual({ van: "", tot: "2023-04-01" });
    expect(klemPeriode("van", "", { van: "2025-01-01", tot: "2025-06-30" }, data)).toEqual({ van: "", tot: "2025-06-30" });
    // Een leeg einde betekent "tot het eind van de data": het begin hoeft niet mee.
    expect(klemPeriode("van", "2026-01-01", { van: "", tot: "" }, data)).toEqual({ van: "2026-01-01", tot: "" });
  });
});

describe("klemOpBeschikbaar (het manifest van het netgebied)", () => {
  it("klemt een periode buiten de data en meldt welke helft is veranderd", () => {
    expect(klemOpBeschikbaar({ van: "2027-03-01", tot: "" }, data)).toEqual({
      van: "2026-09-12",
      tot: "",
      veranderd: ["van"],
    });
    expect(klemOpBeschikbaar({ van: "2020-01-01", tot: "2030-01-01" }, data)).toEqual({
      van: "2023-04-01",
      tot: "2026-09-12",
      veranderd: ["van", "tot"],
    });
  });

  it("verandert niets aan een periode binnen de data, of aan een lege", () => {
    expect(klemOpBeschikbaar({ van: "2025-01-01", tot: "2025-12-31" }, data).veranderd).toEqual([]);
    expect(klemOpBeschikbaar({ van: "", tot: "" }, data)).toEqual({ van: "", tot: "", veranderd: [] });
  });
});

describe("normaliseer houdt een ongeldig paar tegen", () => {
  it("meldt een omgekeerde periode als aangepast, met beide helften", () => {
    const gecorrigeerd: (keyof Instellingen)[] = [];
    const uit = normaliseerDeel({ van: "2025-09-01", tot: "2025-01-01" }, gecorrigeerd);
    expect(uit.van).toBe("");
    expect(uit.tot).toBe("");
    expect(gecorrigeerd.sort()).toEqual(["tot", "van"]);
  });

  it("meldt het ook als het paar pas ongeldig is nadat één helft wegviel", () => {
    // `tot` is geen datum en valt weg; `van` blijft, en past dan niet bij een standaard
    // waar `tot` bestaat.
    const gecorrigeerd: (keyof Instellingen)[] = [];
    const uit = normaliseer({ ...STANDAARD, van: "2026-06-01", tot: "2026-01-01" }, STANDAARD, gecorrigeerd);
    expect(uit.van).toBe("");
    expect(uit.tot).toBe("");
    expect(gecorrigeerd).toContain("van");
    expect(gecorrigeerd).toContain("tot");
  });

  it("klemt een dag buiten wat we ooit meenemen, en meldt het", () => {
    const gecorrigeerd: (keyof Instellingen)[] = [];
    const uit = normaliseerDeel({ van: "2027-03-01", tot: "2019-01-01" }, gecorrigeerd);
    // van > tot na het klemmen (2026-12-31 > 2023-04-01): de hele periode.
    expect(uit).toEqual({ van: "", tot: "" });
    expect(gecorrigeerd).toContain("van");
    const los: (keyof Instellingen)[] = [];
    expect(normaliseerDeel({ van: "2027-03-01" }, los).van).toBe(LAATSTE_DAG);
    expect(los).toEqual(["van"]);
    const vroeg: (keyof Instellingen)[] = [];
    expect(normaliseerDeel({ tot: "2019-01-01" }, vroeg).tot).toBe(VROEGSTE_DAG);
    expect(vroeg).toEqual(["tot"]);
  });

  it("laat een geldige periode en een lege periode ongemoeid", () => {
    const g: (keyof Instellingen)[] = [];
    expect(normaliseerDeel({ van: "2025-01-01", tot: "2025-12-31" }, g)).toEqual({ van: "2025-01-01", tot: "2025-12-31" });
    expect(normaliseerDeel({ van: "", tot: "" }, g)).toEqual({ van: "", tot: "" });
    expect(g).toEqual([]);
  });
});
