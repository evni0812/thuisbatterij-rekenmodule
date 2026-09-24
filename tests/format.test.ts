/**
 * De opmaakfuncties mogen nooit gooien.
 *
 * Ze worden middenin het renderen aangeroepen, dus een uitzondering hier is
 * geen scheef getal maar een lege pagina.
 */
import { describe, expect, it } from "vitest";
import { euro, euroAs, getal } from "../lib/format";

describe("getal", () => {
  it("houdt een ongeldig aantal decimalen binnen het bereik van Intl", () => {
    /*
     * Intl.NumberFormat accepteert 0 tot en met 100 en gooit daarbuiten een
     * RangeError. Ergens stond `getal(x, -1)`, bedoeld als afronden op
     * tientallen; dat haalde het hele tabblad neer met
     * "maximumFractionDigits value is out of range".
     */
    expect(() => getal(1234, -1)).not.toThrow();
    expect(() => getal(1234, 999)).not.toThrow();
    expect(() => getal(1234, Number.NaN)).not.toThrow();
    expect(getal(1234.56, -1)).toBe(getal(1234.56, 0));
  });

  it("rondt af op het gevraagde aantal decimalen", () => {
    expect(getal(1234.5678)).toBe("1.235");
    expect(getal(1234.5678, 1)).toBe("1.234,6");
    expect(getal(0.84, 2)).toBe("0,84");
  });
});

describe("euroAs", () => {
  it("zet geen centen op een as, ook niet onder een tientje", () => {
    // euro() doet dat wel, en dat klopt in een zin maar niet op een schaal
    // die in duizendtallen loopt: daar werd het nullabel "€ 0,00".
    expect(euroAs(0)).not.toMatch(/,\d\d$/);
    expect(euro(0)).toMatch(/,\d\d$/);
    expect(euroAs(-2400)).not.toMatch(/,\d\d$/);
  });
});
