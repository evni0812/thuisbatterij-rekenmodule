// @vitest-environment jsdom
/**
 * Getallen lezen en corrigeren zoals een Nederlander ze schrijft: punt als
 * duizendtal, komma als decimaal, en een zichtbare regel als het veld iets
 * anders doet dan er stond.
 */
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GetalInvoer, leesGetal } from "../components/GetalInvoer";

afterEach(cleanup);

describe("leesGetal met Nederlandse duizendtallen", () => {
  it("leest een punt met precies drie cijfers als duizendtal in een veld zonder decimalen", () => {
    expect(leesGetal("3.500", 0)).toBe(3500);
    expect(leesGetal("12.345", 0)).toBe(12345);
    expect(leesGetal("1.000.000", 0)).toBe(1000000);
    expect(leesGetal("-3.500", 0)).toBe(-3500);
  });

  it("laat een punt met één, twee of vier cijfers decimaal", () => {
    expect(leesGetal("3.5", 0)).toBe(3.5);
    expect(leesGetal("3.50", 0)).toBe(3.5);
    expect(leesGetal("3.5000", 0)).toBe(3.5);
    expect(leesGetal("3.5", 2)).toBe(3.5);
    expect(leesGetal("2.25", 2)).toBe(2.25);
    expect(leesGetal("0.500", 0)).toBe(0.5);
  });

  it("houdt een punt met drie cijfers decimaal waar het veld decimalen heeft", () => {
    expect(leesGetal("3.500", 2)).toBe(3.5);
    expect(leesGetal("1.234", 4)).toBe(1.234);
    // Zonder opgave van decimalen: een enkele punt is decimaal, zoals altijd.
    expect(leesGetal("3.500")).toBe(3.5);
  });

  it("leest meerdere groepen als duizendtallen, ook als het veld decimalen heeft", () => {
    expect(leesGetal("1.000.000", 2)).toBe(1000000);
    expect(leesGetal("1.234.567", 2)).toBe(1234567);
  });

  it("leest een punt-duizendtal met komma-decimaal overal als één getal", () => {
    expect(leesGetal("1.234,5", 0)).toBe(1234.5);
    expect(leesGetal("1.234,5", 2)).toBe(1234.5);
    expect(leesGetal("1.234.567,89", 2)).toBe(1234567.89);
    expect(leesGetal("12,5", 2)).toBe(12.5);
    expect(leesGetal(",5", 2)).toBe(0.5);
  });

  it("wijst rommel af", () => {
    for (const rommel of ["1.2.3", "1.23.456", "1,2,3", "1.5,3", "12.34,5", "abc", "-", "1e5", ".", ",", "3.500,"]) {
      // "3.500," is wel leesbaar (3500); de rest niet.
      if (rommel === "3.500,") expect(leesGetal(rommel, 0)).toBe(3500);
      else expect(Number.isNaN(leesGetal(rommel, 0)), rommel).toBe(true);
    }
    expect(leesGetal("  ", 0)).toBeNull();
  });
});

function Veld({
  start,
  min = 0,
  max = 30000,
  decimalen = 0,
  magLeeg = false,
  onWaarde = () => {},
}: {
  start: number | null;
  min?: number;
  max?: number;
  decimalen?: number;
  magLeeg?: boolean;
  onWaarde?: (v: number | null) => void;
}) {
  const [waarde, setWaarde] = useState<number | null>(start);
  return (
    <>
      <GetalInvoer
        id="veld"
        waarde={waarde}
        min={min}
        max={max}
        decimalen={decimalen}
        magLeeg={magLeeg}
        eenheid="kWh"
        onWaarde={(v) => {
          onWaarde(v);
          setWaarde(v);
        }}
      />
      <button type="button" onClick={() => setWaarde(42)}>
        reset
      </button>
    </>
  );
}

function tik(el: HTMLInputElement, tekst: string) {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: tekst } });
  fireEvent.blur(el);
}

function melding(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".getal-melding");
}

describe("het getalveld", () => {
  it("leest 3.500 in een veld zonder decimalen als 3500", () => {
    const zet = vi.fn();
    const { container } = render(<Veld start={100} onWaarde={zet} />);
    const el = container.querySelector("input")!;
    tik(el, "3.500");
    expect(zet).toHaveBeenLastCalledWith(3500);
    expect(el.value).toBe("3500");
    expect(melding(container)).toBeNull();
  });

  it("zegt bij onzin dat het geen getal is en welke waarde blijft, gekoppeld aan het veld", () => {
    const { container } = render(<Veld start={3201} />);
    const el = container.querySelector("input")!;
    tik(el, "abc");
    const m = melding(container)!;
    expect(m.textContent).toBe("Dat is geen getal; we houden 3.201.");
    expect(m.id).toBeTruthy();
    expect(el.getAttribute("aria-describedby")?.split(" ")).toContain(m.id);
    expect(el.value).toBe("3201");
  });

  it("zegt bij een te groot of te klein getal dat het is aangepast, en aan wat", () => {
    const zet = vi.fn();
    const { container } = render(<Veld start={100} onWaarde={zet} />);
    const el = container.querySelector("input")!;
    tik(el, "999999");
    expect(zet).toHaveBeenLastCalledWith(30000);
    expect(melding(container)!.textContent).toBe("Het maximum is 30.000; aangepast.");
    tik(el, "-5");
    expect(zet).toHaveBeenLastCalledWith(0);
    expect(melding(container)!.textContent).toBe("Het minimum is 0; aangepast.");
  });

  it("meldt ook als de waarde al op het maximum stond", () => {
    const { container } = render(<Veld start={30000} />);
    tik(container.querySelector("input")!, "999999");
    expect(melding(container)!.textContent).toBe("Het maximum is 30.000; aangepast.");
  });

  it("laat de melding verdwijnen bij de volgende geldige invoer", () => {
    const { container } = render(<Veld start={3201} />);
    const el = container.querySelector("input")!;
    tik(el, "abc");
    expect(melding(container)).not.toBeNull();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: "2500" } });
    // Al tijdens het typen: wat er staat is weer een getal.
    expect(melding(container)).toBeNull();
    expect(el.getAttribute("aria-describedby")).toBeNull();
    fireEvent.blur(el);
    expect(melding(container)).toBeNull();
    expect(el.value).toBe("2500");
  });

  it("laat de melding los als de waarde van buiten verandert", () => {
    const { container, getByText } = render(<Veld start={3201} />);
    tik(container.querySelector("input")!, "abc");
    expect(melding(container)).not.toBeNull();
    fireEvent.click(getByText("reset"));
    expect(melding(container)).toBeNull();
  });

  it("zegt dat een leeg veld niet mag, tenzij het leeg mag", () => {
    const a = render(<Veld start={3201} />);
    tik(a.container.querySelector("input")!, "");
    expect(melding(a.container)!.textContent).toBe("Dit veld mag niet leeg blijven; we houden 3.201.");
    cleanup();
    const zet = vi.fn();
    const b = render(<Veld start={3201} magLeeg onWaarde={zet} />);
    tik(b.container.querySelector("input")!, "");
    expect(zet).toHaveBeenLastCalledWith(null);
    expect(melding(b.container)).toBeNull();
  });

  it("legt een afgeleide waarde met centen niet vast door het veld te verlaten", () => {
    // Een prijs uit de kostenregel is 3285,2; het veld toont 3285. Erdoorheen
    // tabben is geen invoer en mag er geen eigen prijs van maken.
    const zet = vi.fn();
    const { container } = render(<Veld start={3285.2} max={20000} onWaarde={zet} />);
    const el = container.querySelector("input")!;
    fireEvent.focus(el);
    fireEvent.blur(el);
    expect(zet).not.toHaveBeenCalled();
    // Wél als je er iets anders van maakt.
    tik(el, "3300");
    expect(zet).toHaveBeenLastCalledWith(3300);
  });
});
