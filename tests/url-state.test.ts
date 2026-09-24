/**
 * De instellingen in de URL: heen en terug, alleen bij afwijking, en binnen
 * de grenzen van lib/normaliseer.ts — ook als iemand de link met de hand
 * aanpast.
 */
import { describe, expect, it } from "vitest";
import { STANDAARD, maakConfiguratie, standaardConfiguratie } from "../lib/configuratie";
import { GRENZEN, klem, normaliseer } from "../lib/normaliseer";
import { vulAan } from "../lib/opslag";
import { leesUrl, schrijfUrl, type Instellingen } from "../lib/url-state";
import { dispatchSleutel } from "../lib/cache";

function lees(query: string): { uit: Partial<Instellingen>; gecorrigeerd: (keyof Instellingen)[] } {
  window.history.replaceState(null, "", "/" + query);
  const gecorrigeerd: (keyof Instellingen)[] = [];
  return { uit: leesUrl(gecorrigeerd), gecorrigeerd };
}

describe("de kostenregel in de URL", () => {
  it("staat er niet in zolang hij op de standaard staat", () => {
    schrijfUrl({ ...STANDAARD }, STANDAARD);
    expect(window.location.search).toBe("");
  });

  it("komt terug zoals hij is weggeschreven", () => {
    schrijfUrl({ ...STANDAARD, kostenPerKwh: 400, kostenPerKw: 100, installatieEur: 0 }, STANDAARD);
    expect(window.location.search).toContain("pkwh=400");
    expect(window.location.search).toContain("pkw=100");
    expect(window.location.search).toContain("inst=0");
    const terug = leesUrl();
    expect(terug.kostenPerKwh).toBe(400);
    expect(terug.kostenPerKw).toBe(100);
    expect(terug.installatieEur).toBe(0);
    // Wat niet afwijkt, staat er niet in en komt dus ook niet terug.
    expect(terug.prijsEur).toBeUndefined();
  });

  it("neemt het doel mee als het afwijkt, en negeert onzin", () => {
    schrijfUrl({ ...STANDAARD, doel: "uitstoot" }, STANDAARD);
    expect(window.location.search).toContain("doel=uitstoot");
    expect(leesUrl().doel).toBe("uitstoot");
    window.history.replaceState(null, "", "/?doel=maanreis");
    expect(leesUrl().doel).toBeUndefined();
  });
});

describe("een link die iemand met de hand heeft aangepast", () => {
  it("klemt getallen op de grenzen van de invoervelden", () => {
    // Uit de review: elk van deze gaf een onzinnig of bevriezend antwoord.
    expect(lees("?jr=1e7").uit.analysejaren).toBeUndefined(); // 1e7 is geen getal zoals wij het schrijven
    expect(lees("?jr=10000000").uit.analysejaren).toBe(30);
    expect(lees("?kw=-1").uit.vermogenKw).toBe(0.8);
    expect(lees("?disc=-1").uit.discontovoet).toBe(0);
    expect(lees("?stg=5").uit.prijsstijging).toBe(0.1);
    expect(lees("?prijs=-500").uit.prijsEur).toBe(100);
    expect(lees("?slt=-1").uit.slijtageDeel).toBe(0);
    expect(lees("?cap=-1").uit.capaciteitKwh).toBe(1);
    expect(lees("?tlk=-100").uit.terugleverkostenCt).toBe(0);
    expect(lees("?af=-5000").uit.afnameKwh).toBe(0);
    expect(lees("?co2d=110").uit.co2Drempel).toBe(120);
    expect(lees("?co2d=9999").uit.co2Drempel).toBe(400);
    expect(lees("?jr=2.5").uit.analysejaren).toBe(3);
  });

  it("negeert wat geen getal is zoals schrijfUrl het schrijft", () => {
    for (const q of ["?af=", "?af=0x10", "?af=1e12", "?af=Infinity", "?af=NaN", "?af=2500,5"]) {
      const { uit, gecorrigeerd } = lees(q);
      expect(uit.afnameKwh, q).toBeUndefined();
      // Een leeg veld is geen poging tot een waarde; de rest wel, en die wordt gemeld.
      if (q !== "?af=") expect(gecorrigeerd, q).toContain("afnameKwh");
    }
  });

  it("controleert keuzes, datums, batterij en netgebied", () => {
    expect(lees("?van=2025-02-30").uit.van).toBeUndefined();
    expect(lees("?van=zzz").uit.van).toBeUndefined();
    expect(lees("?van=2025-03-01").uit.van).toBe("2025-03-01");
    const omgekeerd = lees("?van=2026-01-01&tot=2025-01-01").uit;
    expect([omgekeerd.van, omgekeerd.tot]).toEqual(["", ""]);
    expect(lees("?zon=ja").uit.zonnepanelen).toBeUndefined();
    expect(lees("?zon=0").uit.zonnepanelen).toBe(false);
    expect(lees("?afr=true").uit.curtailment).toBeUndefined();
    expect(lees("?hef=later").uit.heffing).toBeUndefined();
    const bat = lees("?bat=onbekend");
    expect(bat.uit.presetId).toBeUndefined();
    expect(bat.gecorrigeerd).toEqual(["presetId"]);
    expect(lees("?net=__proto__").uit.domein).toBeUndefined();
    expect(lees("?net=%3Cimg%20src=x%3E").uit.domein).toBeUndefined();
    expect(lees("?net=871685900000056162").uit.domein).toBe("871685900000056162");
  });

  it("laat een geldige link ongemoeid en meldt niets", () => {
    const inst: Instellingen = {
      ...STANDAARD,
      afnameKwh: 4200,
      capaciteitKwh: 5.12,
      vermogenKw: 2.5,
      prijsEur: 1499,
      discontovoet: 0.045,
      prijsstijging: -0.01,
      analysejaren: 12,
      van: "2024-01-01",
      tot: "2025-12-31",
      doel: "zelfconsumptie",
    };
    schrijfUrl(inst, STANDAARD);
    const gecorrigeerd: (keyof Instellingen)[] = [];
    expect({ ...STANDAARD, ...leesUrl(gecorrigeerd) }).toEqual(inst);
    expect(gecorrigeerd).toEqual([]);
  });
});

describe("normaliseer", () => {
  it("laat de standaard precies zoals hij is, zodat de preload blijft passen", () => {
    expect(normaliseer(STANDAARD, STANDAARD)).toEqual(STANDAARD);
    expect(dispatchSleutel(maakConfiguratie(STANDAARD))).toBe(dispatchSleutel(standaardConfiguratie()));
  });

  it("ligt met elke standaardwaarde binnen zijn eigen grenzen", () => {
    for (const [k, g] of Object.entries(GRENZEN)) {
      const v = STANDAARD[k as keyof Instellingen];
      if (v === null) continue;
      expect(v as number, k).toBeGreaterThanOrEqual(g.min);
      expect(v as number, k).toBeLessThanOrEqual(g.max);
    }
  });

  it("rondt af zonder zwevendekommaruis", () => {
    expect(klem("degradatie", 0.015)).toBe(0.015);
    expect(klem("slijtageDeel", 0.35000000000000003)).toBe(0.35);
    expect(klem("spreiding", 1.2345)).toBe(1.23);
  });

  it("houdt de configuratie voor de worker binnen de grenzen, ook zonder URL", () => {
    const cfg = maakConfiguratie({ ...STANDAARD, analysejaren: 1e7, vermogenKw: -1, discontovoet: -1 });
    expect(cfg.analysisYears).toBe(30);
    expect(cfg.battery.maxChargeKw).toBe(0.8);
    expect(cfg.discountRate).toBe(0);
  });

  it("schoont een oude of bewerkte bewaarde set op", () => {
    const uit = vulAan({
      afnameKwh: -1e9,
      analysejaren: 1e9,
      domein: "<b>x</b>",
      heffing: "later" as unknown as Instellingen["heffing"],
      doel: "maan" as unknown as Instellingen["doel"],
      presetId: 5 as unknown as string,
    });
    expect(uit.afnameKwh).toBe(0);
    expect(uit.analysejaren).toBe(30);
    expect(uit.domein).toBe(STANDAARD.domein);
    expect(uit.heffing).toBe(STANDAARD.heffing);
    expect(uit.doel).toBe(STANDAARD.doel);
    expect(uit.presetId).toBe(STANDAARD.presetId);
  });
});
