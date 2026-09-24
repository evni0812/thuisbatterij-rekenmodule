/**
 * Elk vol jaar komt uit op de ingevulde meterstanden.
 *
 * De pagina zegt "geschaald naar jouw jaartotalen". Zolang de nettingschaal
 * alleen op het meest recente jaar werd opgelost, kwam 2024 in het
 * standaardgeval uit op 2.528 in plaats van 2.500 kWh afname, en toonde de
 * pagina gemiddeld 2.514. Deze test legt vast dat elk vol jaar in elk
 * netgebied op de meterstanden uitkomt, vóór afregelen en vóór de batterij.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { Invoerbron } from "../lib/data/invoer";
import type { Ophaler } from "../lib/data/loader";

const haal: Ophaler = async (url) => new Response(new Uint8Array(readFileSync(`public${url}`)));

let bron: Invoerbron;

beforeAll(async () => {
  bron = new Invoerbron("/data", haal);
  await bron.init();
}, 60_000);

/** Afname en teruglevering zoals de meter ze telt: de genette residu. */
function meter(r: Float64Array): { afname: number; teruglevering: number } {
  let afname = 0;
  let teruglevering = 0;
  for (let i = 0; i < r.length; i++) {
    if (r[i]! > 0) afname += r[i]!;
    else teruglevering -= r[i]!;
  }
  return { afname, teruglevering };
}

describe("meterstanden per vol jaar", () => {
  const gevallen = [
    { naam: "standaard", netgebied: STANDAARD.domein, afname: STANDAARD.afnameKwh, teruglevering: STANDAARD.terugleveringKwh },
    { naam: "Stedin Utrecht, veel teruglevering", netgebied: "871687400000002254", afname: 3000, teruglevering: 4500 },
    { naam: "Enexis Noord, weinig teruglevering", netgebied: "871694830000000309", afname: 4200, teruglevering: 600 },
  ];

  for (const g of gevallen) {
    it(`komt elk vol jaar exact uit (${g.naam})`, async () => {
      const cfg = maakConfiguratie({
        ...STANDAARD,
        domein: g.netgebied,
        afnameKwh: g.afname,
        terugleveringKwh: g.teruglevering,
      });
      const invoer = await bron.bouwInvoer(cfg);
      const vol = invoer.windows.filter((w) => w.isFullYear);
      expect(vol.length).toBeGreaterThanOrEqual(2);
      for (const w of vol) {
        const m = meter(w.window.residualKwh);
        expect(m.afname, `afname ${w.year}`).toBeCloseTo(g.afname, 3);
        expect(m.teruglevering, `teruglevering ${w.year}`).toBeCloseTo(g.teruglevering, 3);
      }
    }, 60_000);
  }
});
