// @vitest-environment jsdom
/**
 * De eerste twee stappen van de begeleide route: jouw huis en jouw batterij.
 *
 * De stappen rekenen niets; ze lezen en schrijven alleen de invoer. Deze test
 * bewaakt dat elke keuze de juiste patch doorgeeft aan `zetInst`, dat de
 * teruglevering verdwijnt zonder panelen en dat een preset kiezen een eigen
 * maat of prijs wist.
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StapBatterij } from "../components/gids/StapBatterij";
import { StapHuis } from "../components/gids/StapHuis";
import type { GidsData } from "../components/gids/types";
import { STANDAARD, kiesPreset } from "../lib/configuratie";
import type { Manifest } from "../lib/data/manifest";
import { PRESETS } from "../lib/presets";
import type { Instellingen } from "../lib/url-state";

afterEach(cleanup);

const MANIFEST = { netgebieden: ["871687120000052782", "871689200000010161"] } as unknown as Manifest;

/** Een `GidsData` met alleen wat deze stappen lezen; de rest is null of een no-op. */
function maakData(inst: Instellingen, over: Partial<GidsData> = {}): GidsData {
  const preset = kiesPreset(inst.presetId);
  return {
    inst,
    zetInst: vi.fn(),
    manifest: MANIFEST,
    preset,
    capaciteitKwh: inst.capaciteitKwh ?? preset.capaciteitKwh,
    vermogenKw: inst.vermogenKw ?? preset.vermogenKw,
    prijsEur: inst.prijsEur ?? preset.prijsEur,
    result: null,
    toon: null,
    scenario: null,
    overgang: null,
    scenarioFout: null,
    grid: null,
    huishoudens: null,
    toonZonnepanelen: inst.zonnepanelen,
    bedragJarenTekst: "",
    bezig: false,
    verouderd: false,
    herbereken: vi.fn(),
    uitleg: () => undefined,
    naarVerdieping: vi.fn(),
    volgende: vi.fn(),
    ...over,
  };
}

describe("stap 1, jouw huis", () => {
  it("zet de keuze voor zonnepanelen als patch en toont wat gekozen is", () => {
    const data = maakData({ ...STANDAARD, zonnepanelen: true });
    render(<StapHuis {...data} />);
    const met = screen.getByRole("button", { name: /Ik heb zonnepanelen/ });
    const zonder = screen.getByRole("button", { name: /Ik heb geen zonnepanelen/ });
    expect(met.getAttribute("aria-pressed")).toBe("true");
    expect(zonder.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(zonder);
    expect(data.zetInst).toHaveBeenCalledWith({ zonnepanelen: false });
  });

  it("laat de teruglevering weg zonder zonnepanelen", () => {
    const { rerender } = render(<StapHuis {...maakData({ ...STANDAARD, zonnepanelen: true })} />);
    expect(screen.getByLabelText(/Hoeveel lever je per jaar terug/)).toBeTruthy();
    expect(screen.getByText(/en levert/).textContent).toContain("2.000 kWh");

    rerender(<StapHuis {...maakData({ ...STANDAARD, zonnepanelen: false })} />);
    expect(screen.queryByLabelText(/Hoeveel lever je per jaar terug/)).toBeNull();
    expect(screen.getByLabelText(/Hoeveel stroom haal je per jaar van het net/)).toBeTruthy();
    expect(screen.getByText(/Je haalt/).textContent).not.toMatch(/terug/);
  });

  it("schrijft afname en teruglevering weg bij het verlaten van het veld", () => {
    const data = maakData({ ...STANDAARD, zonnepanelen: true });
    render(<StapHuis {...data} />);
    const afname = screen.getByLabelText(/Hoeveel stroom haal je per jaar van het net/);
    fireEvent.focus(afname);
    fireEvent.change(afname, { target: { value: "3.200" } });
    fireEvent.blur(afname);
    expect(data.zetInst).toHaveBeenCalledWith({ afnameKwh: 3200 });

    const terug = screen.getByLabelText(/Hoeveel lever je per jaar terug/);
    fireEvent.focus(terug);
    fireEvent.change(terug, { target: { value: "1800" } });
    fireEvent.blur(terug);
    expect(data.zetInst).toHaveBeenCalledWith({ terugleveringKwh: 1800 });
  });

  it("vat de invoer samen in gewone taal, ook na een wijziging", () => {
    function Pagina() {
      const [inst, setInst] = useState<Instellingen>(STANDAARD);
      return <StapHuis {...maakData(inst, { zetInst: (p) => setInst((s) => ({ ...s, ...p })) })} />;
    }
    render(<Pagina />);
    expect(screen.getByText(/Je haalt/).textContent).toBe(
      "Je haalt 2.500 kWh per jaar van het net en levert 2.000 kWh terug.",
    );
    const afname = screen.getByLabelText(/Hoeveel stroom haal je per jaar van het net/);
    fireEvent.focus(afname);
    fireEvent.change(afname, { target: { value: "4000" } });
    fireEvent.blur(afname);
    expect(screen.getByText(/Je haalt/).textContent).toContain("4.000 kWh");
    // Geen voorbeeldmelding meer zodra het getal van jou is.
    expect(screen.queryByText(/voorbeeldgetallen/)).toBeNull();
  });

  it("toont het netgebied compact en laat het wijzigen", () => {
    const data = maakData(STANDAARD);
    render(<StapHuis {...data} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/Netgebied:/).textContent).toContain("Liander");
    fireEvent.click(screen.getByRole("button", { name: "wijzigen" }));
    const kies = screen.getByRole("combobox", { name: "Netgebied" });
    fireEvent.change(kies, { target: { value: "871689200000010161" } });
    expect(data.zetInst).toHaveBeenCalledWith({ domein: "871689200000010161" });
    expect(screen.getByText(/bijvoorbeeld Liander, Stedin of Enexis/)).toBeTruthy();
  });

  it("verwijst naar de instellingen bij Alle cijfers", () => {
    const data = maakData(STANDAARD);
    render(<StapHuis {...data} />);
    fireEvent.click(screen.getByRole("button", { name: /Meer instellingen/ }));
    expect(data.naarVerdieping).toHaveBeenCalledWith("uitkomst", "instellingen");
  });
});

describe("stap 2, jouw batterij", () => {
  it("toont alle batterijen met maat, prijs en aansluiting", () => {
    render(<StapBatterij {...maakData(STANDAARD)} />);
    const groep = screen.getByRole("group", { name: "Batterij" });
    const knoppen = within(groep).getAllByRole("button");
    expect(knoppen).toHaveLength(PRESETS.length);
    for (const p of PRESETS) {
      const knop = knoppen.find((k) => k.textContent?.includes(p.naam))!;
      expect(knop).toBeTruthy();
      expect(knop.textContent).toContain(p.vermogenKw > 0.8 ? "Vaste aansluiting door een installateur" : "In het stopcontact");
    }
  });

  it("markeert de gekozen batterij met aria-pressed", () => {
    render(<StapBatterij {...maakData({ ...STANDAARD, presetId: "marstek-venus-e3" })} />);
    const gekozen = screen.getAllByRole("button", { pressed: true });
    const namen = gekozen.map((k) => k.textContent);
    expect(namen.some((t) => t?.includes("Marstek Venus E 3.0"))).toBe(true);
    expect(namen.some((t) => t?.includes("HomeWizard"))).toBe(false);
  });

  it("wist een eigen maat en prijs bij het kiezen van een batterij", () => {
    const data = maakData({ ...STANDAARD, capaciteitKwh: 4.8, vermogenKw: 2, prijsEur: 2000 });
    render(<StapBatterij {...data} />);
    fireEvent.click(screen.getByRole("button", { name: /HomeWizard Plug-In Battery/ }));
    expect(data.zetInst).toHaveBeenCalledWith({
      presetId: "homewizard-plugin",
      capaciteitKwh: null,
      vermogenKw: null,
      prijsEur: null,
    });
  });

  it("toont een eigen batterij als gekozen, en geen preset", () => {
    render(<StapBatterij {...maakData({ ...STANDAARD, capaciteitKwh: 4.8, vermogenKw: 2, prijsEur: 2000 })} />);
    const notitie = screen.getByRole("status", { name: "" });
    expect(notitie.textContent).toContain("Je eigen batterij: 4,8 kWh · 2 kW");
    expect(notitie.textContent).toContain("2.000");
    const groep = screen.getByRole("group", { name: "Batterij" });
    expect(within(groep).queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });

  it("toont geen eigen batterij zonder eigen waarden", () => {
    render(<StapBatterij {...maakData(STANDAARD)} />);
    expect(screen.queryByText(/Je eigen batterij/)).toBeNull();
  });

  it("legt kWh en kW uit", () => {
    render(<StapBatterij {...maakData(STANDAARD)} />);
    expect(
      screen.getByText("Capaciteit (kWh) is hoeveel stroom erin past; vermogen (kW) is hoe snel hij laadt en levert."),
    ).toBeTruthy();
  });

  it("laat het doel kiezen, met Rendement als standaard", () => {
    const data = maakData(STANDAARD);
    render(<StapBatterij {...data} />);
    const groep = screen.getByRole("group", { name: "Doel van de batterij" });
    const [rendement, zelf, uitstoot] = within(groep).getAllByRole("button");
    expect(rendement!.textContent).toContain("Rendement");
    expect(rendement!.getAttribute("aria-pressed")).toBe("true");
    expect(zelf!.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(zelf!);
    expect(data.zetInst).toHaveBeenCalledWith({ doel: "zelfconsumptie" });
    fireEvent.click(uitstoot!);
    expect(data.zetInst).toHaveBeenCalledWith({ doel: "uitstoot" });
    expect(screen.getByText("Weet je het niet? Laat Rendement staan.")).toBeTruthy();
  });

  it("waarschuwt bij Zelfconsumptie zonder zonnepanelen", () => {
    render(<StapBatterij {...maakData({ ...STANDAARD, zonnepanelen: false, doel: "zelfconsumptie" })} />);
    expect(screen.getByText(/geen eigen overschot/)).toBeTruthy();
  });

  it("verwijst naar de instellingen en naar Welke batterij", () => {
    const data = maakData(STANDAARD);
    render(<StapBatterij {...data} />);
    fireEvent.click(screen.getByRole("button", { name: "Een andere maat of eigen prijs" }));
    expect(data.naarVerdieping).toHaveBeenCalledWith("uitkomst", "instellingen");
    fireEvent.click(screen.getByRole("button", { name: "Welke maat past het best?" }));
    expect(data.naarVerdieping).toHaveBeenCalledWith("welke-batterij");
  });
});
