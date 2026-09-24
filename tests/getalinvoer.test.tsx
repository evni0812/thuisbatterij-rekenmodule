// @vitest-environment jsdom
/**
 * Getallen intikken zoals een mens dat doet: cijfer voor cijfer, met een
 * komma, en soms eerst het veld leegmaken.
 *
 * Regressie: de velden klemden bij elke toetsaanslag op hun grenzen. "1500"
 * als aanschafprijs werd 20.000 (na de "1" stond er 100, daarna "1000", enz.),
 * "12" als looptijd werd 25, "2.5" kWh werd 0,55, en een leeggemaakt
 * afnameveld werd 0 zodat de volgende cijfers erachter kwamen ("03500").
 */
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Geavanceerd } from "../components/Geavanceerd";
import { GetalInvoer, leesGetal } from "../components/GetalInvoer";
import { Invoer } from "../components/Invoer";
import { STANDAARD, kiesPreset } from "../lib/configuratie";
import type { Instellingen } from "../lib/url-state";

afterEach(cleanup);

let laatste: Instellingen = STANDAARD;

function Pagina() {
  const [inst, setInst] = useState<Instellingen>(STANDAARD);
  laatste = inst;
  const p = kiesPreset(inst.presetId);
  return (
    <>
      <Invoer
        afnameKwh={inst.afnameKwh}
        terugleveringKwh={inst.terugleveringKwh}
        presetId={inst.presetId}
        onAfname={(v) => setInst((s) => ({ ...s, afnameKwh: v }))}
        onTeruglevering={(v) => setInst((s) => ({ ...s, terugleveringKwh: v }))}
        onPreset={() => {}}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
      />
      <Geavanceerd
        inst={inst}
        manifest={null}
        preset={p}
        capaciteit={inst.capaciteitKwh ?? p.capaciteitKwh}
        vermogen={inst.vermogenKw ?? p.vermogenKw}
        prijs={inst.prijsEur ?? p.prijsEur}
        onChange={(patch) => setInst((s) => ({ ...s, ...patch }))}
        onReset={() => {}}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
        open
      />
    </>
  );
}

/** Tik tekst in zoals een toetsenbord: veld leeg, dan teken voor teken, en weg. */
function tik(el: HTMLInputElement, tekst: string, { verlaat = "blur" as "blur" | "enter" } = {}): string[] {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: "" } });
  const onderweg: string[] = [];
  for (const teken of tekst) {
    fireEvent.change(el, { target: { value: el.value + teken } });
    onderweg.push(el.value);
  }
  if (verlaat === "enter") fireEvent.keyDown(el, { key: "Enter" });
  else fireEvent.blur(el);
  return onderweg;
}

function veld(container: HTMLElement, selector: string): HTMLInputElement {
  const el = container.querySelector(selector);
  if (!el) throw new Error(`geen veld ${selector}`);
  return el as HTMLInputElement;
}

describe("de getalvelden", () => {
  it("laten je 1500 als aanschafprijs intikken", () => {
    const { container } = render(<Pagina />);
    const prijs = veld(container, "#inst-aanschafprijs");
    expect(tik(prijs, "1500")).toEqual(["1", "15", "150", "1500"]);
    expect(laatste.prijsEur).toBe(1500);
    expect(prijs.value).toBe("1500");
  });

  it("laten je 12 jaar looptijd intikken, en klemmen pas bij het verlaten", () => {
    const { container } = render(<Pagina />);
    const looptijd = veld(container, "#inst-looptijd");
    expect(tik(looptijd, "12", { verlaat: "enter" })).toEqual(["1", "12"]);
    expect(laatste.analysejaren).toBe(12);
    tik(looptijd, "99");
    expect(laatste.analysejaren).toBe(30);
    expect(looptijd.value).toBe("30");
  });

  it("accepteren een komma als decimaalteken", () => {
    const { container } = render(<Pagina />);
    const cap = veld(container, "#inst-capaciteit");
    expect(tik(cap, "2,5")).toEqual(["2", "2,", "2,5"]);
    expect(laatste.capaciteitKwh).toBe(2.5);
    expect(cap.value).toBe("2,5");
    tik(cap, "3.25");
    expect(laatste.capaciteitKwh).toBe(3.25);
    const rente = veld(container, "#inst-rente-die-je-misloopt");
    tik(rente, "4,5");
    expect(laatste.discontovoet).toBe(0.045);
    expect(rente.value).toBe("4,5");
  });

  it("maken van een leeg afnameveld geen 0, en van 3500 geen 03500", () => {
    const { container } = render(<Pagina />);
    const af = veld(container, 'input[aria-describedby="afname-hint"]');
    expect(tik(af, "3500")).toEqual(["3", "35", "350", "3500"]);
    expect(laatste.afnameKwh).toBe(3500);
    // Leegmaken en weggaan: de vorige waarde blijft staan.
    tik(af, "");
    expect(laatste.afnameKwh).toBe(3500);
    expect(af.value).toBe("3500");
    // Een bovengrens, zoals elk ander veld.
    tik(af, "99999999");
    expect(laatste.afnameKwh).toBe(30000);
  });

  it("laten een negatieve opwek niet toe, en maken van leeg 'onbekend'", () => {
    const { container } = render(<Pagina />);
    const opwek = veld(container, "#opwek");
    tik(opwek, "-500");
    expect(laatste.opwekKwh).toBe(0);
    tik(opwek, "4200");
    expect(laatste.opwekKwh).toBe(4200);
    tik(opwek, "");
    expect(laatste.opwekKwh).toBeNull();
  });

  it("zetten een leeggemaakte batterijwaarde terug op die van de batterij", () => {
    const { container } = render(<Pagina />);
    const cap = veld(container, "#inst-capaciteit");
    tik(cap, "5");
    expect(laatste.capaciteitKwh).toBe(5);
    tik(cap, "");
    expect(laatste.capaciteitKwh).toBeNull();
    expect(cap.value).toBe(String(kiesPreset(STANDAARD.presetId).capaciteitKwh).replace(".", ","));
  });

  it("negeren onzin en zetten het veld terug", () => {
    const { container } = render(<Pagina />);
    const prijs = veld(container, "#inst-aanschafprijs");
    tik(prijs, "12a");
    expect(laatste.prijsEur).toBeNull();
    expect(prijs.value).toBe("699");
  });
});

describe("leesGetal", () => {
  it("leest wat een mens intikt", () => {
    expect(leesGetal("1500")).toBe(1500);
    expect(leesGetal(" 2,5 ")).toBe(2.5);
    expect(leesGetal("-0.5")).toBe(-0.5);
    expect(leesGetal("")).toBeNull();
    expect(Number.isNaN(leesGetal("1.500,25"))).toBe(true);
    expect(Number.isNaN(leesGetal("-"))).toBe(true);
    expect(Number.isNaN(leesGetal("1e5"))).toBe(true);
  });

  it("toont een externe wijziging (reset) als je niet aan het typen bent", () => {
    function Buiten() {
      const [v, setV] = useState<number | null>(10);
      return (
        <>
          <GetalInvoer id="x" waarde={v} min={0} max={100} decimalen={0} onWaarde={setV} />
          <button onClick={() => setV(42)}>zet</button>
        </>
      );
    }
    const { container, getByText } = render(<Buiten />);
    fireEvent.click(getByText("zet"));
    expect(veld(container, "#x").value).toBe("42");
  });
});
