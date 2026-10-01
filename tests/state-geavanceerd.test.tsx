// @vitest-environment jsdom
/**
 * De geavanceerde instellingen: het paneel blijft open zolang je het zelf niet
 * sluit, en de twee datumvelden houden samen een geldige periode.
 */
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Geavanceerd } from "../components/Geavanceerd";
import { STANDAARD, effectieveBatterij, effectiefStandby, kiesPreset } from "../lib/configuratie";
import type { Instellingen } from "../lib/url-state";

afterEach(cleanup);

let laatste: Instellingen = STANDAARD;

function Pagina({ start = STANDAARD }: { start?: Instellingen }) {
  const [inst, setInst] = useState<Instellingen>(start);
  laatste = inst;
  const p = kiesPreset(inst.presetId);
  const b = effectieveBatterij(inst);
  return (
    <>
      <Geavanceerd
        inst={inst}
        manifest={null}
        preset={p}
        capaciteit={b.capaciteitKwh}
        vermogen={b.vermogenKw}
        prijs={b.prijsEur}
        standby={effectiefStandby(inst).watt}
        onChange={(patch) => setInst((s) => ({ ...s, ...patch }))}
        onReset={() => setInst(STANDAARD)}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
      />
      <button type="button" onClick={() => setInst(STANDAARD)}>
        alles terug
      </button>
    </>
  );
}

const details = (c: HTMLElement) => c.querySelector("details")!;

describe("het uitklappaneel", () => {
  it("staat dicht zolang alles op de standaard staat", () => {
    const { container } = render(<Pagina />);
    expect(details(container).open).toBe(false);
  });

  it("klapt open zodra er een afwijking is", () => {
    const { container } = render(<Pagina start={{ ...STANDAARD, spreiding: 1.5 }} />);
    expect(details(container).open).toBe(true);
  });

  it("blijft open als je de laatste afwijking terugzet", () => {
    const { container, getByText } = render(<Pagina start={{ ...STANDAARD, spreiding: 1.5 }} />);
    expect(details(container).open).toBe(true);
    fireEvent.click(getByText("alles terug"));
    expect(laatste.spreiding).toBe(STANDAARD.spreiding);
    expect(details(container).open).toBe(true);
  });

  it("gaat dicht als de gebruiker het zelf sluit, ook met afwijkingen", () => {
    const { container } = render(<Pagina start={{ ...STANDAARD, spreiding: 1.5 }} />);
    const d = details(container);
    d.open = false;
    fireEvent(d, new Event("toggle"));
    expect(d.open).toBe(false);
  });

  it("blijft na zelf sluiten dicht als er nog iets wordt teruggezet", () => {
    const { container, getByText } = render(<Pagina start={{ ...STANDAARD, spreiding: 1.5 }} />);
    const d = details(container);
    d.open = false;
    fireEvent(d, new Event("toggle"));
    fireEvent.click(getByText("alles terug"));
    expect(d.open).toBe(false);
  });
});

describe("de periode", () => {
  const velden = (c: HTMLElement) => {
    const [van, tot] = [...c.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    return { van: van!, tot: tot! };
  };

  it("laat het andere veld zijn grenzen volgen", () => {
    const { container } = render(<Pagina start={{ ...STANDAARD, van: "2025-01-01", tot: "2025-06-30" }} />);
    const { van, tot } = velden(container);
    expect(van.max).toBe("2025-06-30");
    expect(tot.min).toBe("2025-01-01");
    expect(van.min).toBe("2023-04-01");
    expect(tot.max).toBe("2026-12-31");
  });

  it("schuift het einde mee als het begin voorbij het einde komt", () => {
    const { container } = render(<Pagina start={{ ...STANDAARD, van: "2025-01-01", tot: "2025-06-30" }} />);
    const { van } = velden(container);
    fireEvent.change(van, { target: { value: "2025-09-01" } });
    expect(laatste.van).toBe("2025-09-01");
    expect(laatste.tot).toBe("2025-09-01");
    expect(velden(container).tot.value).toBe("2025-09-01");
  });

  it("schuift het begin mee als het einde voor het begin komt", () => {
    const { container } = render(<Pagina start={{ ...STANDAARD, van: "2025-01-01", tot: "2025-06-30" }} />);
    fireEvent.change(velden(container).tot, { target: { value: "2024-11-15" } });
    expect(laatste.tot).toBe("2024-11-15");
    expect(laatste.van).toBe("2024-11-15");
  });

  it("klemt een datum buiten de beschikbare data", () => {
    const { container } = render(<Pagina />);
    fireEvent.change(velden(container).van, { target: { value: "2027-03-01" } });
    expect(laatste.van).toBe("2026-12-31");
    fireEvent.change(velden(container).tot, { target: { value: "2019-01-01" } });
    expect(laatste.tot).toBe("2023-04-01");
    expect(laatste.van).toBe("2023-04-01");
  });

  it("laat een leeggemaakt veld leeg: de hele periode", () => {
    const { container } = render(<Pagina start={{ ...STANDAARD, van: "2025-01-01", tot: "2025-06-30" }} />);
    fireEvent.change(velden(container).van, { target: { value: "" } });
    expect(laatste.van).toBe("");
    expect(laatste.tot).toBe("2025-06-30");
  });
});
