import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NETGEBIED_NAMEN, netgebiedNaam, type Manifest } from "../lib/data/manifest";

const manifest = JSON.parse(readFileSync("public/data/manifest.json", "utf8")) as Manifest;

describe("de namen van de netgebieden", () => {
  /**
   * Bron: NEDU/CQM, "NEDU steekproef allocatie" (april 2021), Tabel 1, en
   * energiedatawijzer.nl. Een eerdere tabel had twaalf van de zeventien namen
   * fout; deze test legt de koppeling vast zodat dat niet ongemerkt terugkomt.
   */
  it("volgt de NEDU-tabel", () => {
    expect(NETGEBIED_NAMEN).toEqual({
      "871685900000056162": "Liander (Noord-West Nederland)",
      "871687120000052782": "Liander",
      "871687400000002254": "Stedin (Utrecht)",
      "871687800090000015": "Westland Infra",
      "871687910000219120": "Enexis (Brabant)",
      "871688520000076884": "Enexis (Limburg)",
      "871688600000002202": "Stedin (Delfland)",
      "871689200000010161": "Stedin",
      "871690200000000007": "Stedin (Enduris, Zeeland)",
      "871690499910000003": "Enexis (Maastricht)",
      "871690910000025589": "Liander (EWR)",
      "871691280000000008": "Rendo",
      "871691600019188908": "Coteq",
      "871692100000010038": "Stedin (Midden-Holland)",
      "871692510000000005": "Stedin (Schiedam)",
      "871694600000002173": "Stedin (Zuid-Kennemerland)",
      "871694830000000309": "Enexis (Noord)",
    });
  });

  it("geeft elk netgebied in de data een naam", () => {
    for (const ean of manifest.netgebieden) {
      expect(netgebiedNaam(ean), ean).not.toBe(ean);
    }
  });

  it("valt terug op de code bij een onbekend gebied", () => {
    expect(netgebiedNaam("123")).toBe("123");
  });
});
