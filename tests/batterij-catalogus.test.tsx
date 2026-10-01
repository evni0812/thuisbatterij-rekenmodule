// @vitest-environment jsdom
/**
 * De batterijcatalogus: herkomst van de getallen, groepering per merk, laden en
 * leveren los, en de logo's.
 */
import { existsSync, readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatterijBronnen } from "../components/BatterijBronnen";
import { StapBatterij } from "../components/gids/StapBatterij";
import type { GidsData } from "../components/gids/types";
import { Invoer } from "../components/Invoer";
import { STANDAARD, effectieveBatterij, kiesPreset, maakConfiguratie } from "../lib/configuratie";
import { vermogenTekst } from "../lib/format";
import { isVasteAansluiting, vermogenVan } from "../lib/model/kosten";
import { PRESETS, STANDAARD_PRESET_ID, perMerk } from "../lib/presets";

afterEach(cleanup);

const MERK_VOLGORDE = ["Zendure", "Sessy", "AlphaESS", "Anker", "HomeWizard", "Marstek", "Generiek"];
const ZENDURE_BIJ_ANWB = [
  "zendure-800pro2",
  "zendure-1600ac",
  "zendure-2400ac",
  "zendure-2400pro",
  "zendure-3000mix",
];

describe("herkomst van de getallen", () => {
  it("geeft elke preset een rendementbron, stand-bybron, bron-URL en peildatum", () => {
    for (const p of PRESETS) {
      expect(["gemeten", "eigenaren", "afgeleid", "datasheet", "aanname"], p.id).toContain(p.rendementBron);
      expect(["gemeten", "schatting", "fabrieksopgave", "aanname"], p.id).toContain(p.standbyBron);
      expect(p.rendementNoot.length, p.id).toBeGreaterThan(10);
      expect(p.standbyNoot.length, p.id).toBeGreaterThan(10);
      expect(p.bron, p.id).toMatch(/^https:\/\//);
      expect(p.bronnen.length, p.id).toBeGreaterThan(0);
      for (const b of p.bronnen) expect(b.url, p.id).toMatch(/^https:\/\//);
      expect(p.peildatum, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("zet de peildatum van de bijgewerkte prijzen op 1 oktober 2026", () => {
    const ongewijzigd = ["thuisaccu-5kwh", "thuisaccu-10kwh"];
    for (const p of PRESETS) {
      expect(p.peildatum, p.id).toBe(ongewijzigd.includes(p.id) ? "2026-09-24" : "2026-10-01");
    }
  });

  it("bevat bij elke prijs boven 0,8 kW de eigen groep of de installatie", () => {
    for (const p of PRESETS.filter((x) => isVasteAansluiting(x.vermogenKw))) {
      expect(p.prijsNoot, p.id).toMatch(/eigen groep|installatie/);
    }
  });

  it("rekent de prijzen uit prijs plus eigen groep", () => {
    const prijs = (id: string) => kiesPreset(id).prijsEur;
    expect(prijs("zendure-800pro2")).toBe(699);
    expect(prijs("zendure-1600ac")).toBe(729 + 300);
    expect(prijs("zendure-2400ac")).toBe(849 + 300);
    expect(prijs("zendure-2400pro")).toBe(969 + 300);
    expect(prijs("zendure-3000mix")).toBe(1748 + 300);
    expect(prijs("sessy-5kwh")).toBe(3550 + 300);
    expect(prijs("sessy-10kwh")).toBe(5500 + 300);
    expect(prijs("sessy-plus")).toBe(9400 + 600);
    expect(prijs("alphaess-vitapower3600")).toBe(999 + 300);
    expect(prijs("anker-solarbank3")).toBe(1199);
    expect(prijs("anker-solarbank-max")).toBe(1999 + 300);
  });

  it("zet de gecorrigeerde rendementen en stand-bywaarden", () => {
    const r = (id: string) => kiesPreset(id).spec.efficiency ** 2;
    expect(r("zendure-800pro2")).toBeCloseTo(0.84, 9);
    expect(r("zendure-1600ac")).toBeCloseTo(0.876, 9);
    expect(r("zendure-2400ac")).toBeCloseTo(0.88, 9);
    expect(r("anker-solarbank-max")).toBeCloseTo(0.835, 9);
    expect(kiesPreset("zendure-800pro2").rendementBron).toBe("afgeleid");
    expect(kiesPreset("zendure-2400pro").rendementBron).toBe("afgeleid");
    expect(kiesPreset("sessy-5kwh").rendementBron).toBe("eigenaren");
    expect(kiesPreset("sessy-plus").rendementBron).toBe("aanname");
    expect(kiesPreset("zendure-1600ac").standbyWatt).toBe(3);
    expect(kiesPreset("zendure-2400ac").standbyWatt).toBe(3.4);
    expect(kiesPreset("anker-solarbank-max").standbyWatt).toBe(31.6);
    expect(kiesPreset("sessy-5kwh").standbyBron).toBe("fabrieksopgave");
    expect(kiesPreset("alphaess-vitapower3600").standbyBron).toBe("aanname");
    expect(kiesPreset("anker-solarbank-max").cycleLife).toBe(10000);
  });

  it("noemt de bruikbare capaciteit van Sessy zoals het datasheet", () => {
    const p5 = kiesPreset("sessy-5kwh");
    const p10 = kiesPreset("sessy-10kwh");
    expect(p5.capaciteitKwh * p5.spec.depthOfCharge).toBeCloseTo(5.2, 9);
    expect(p10.capaciteitKwh * p10.spec.depthOfCharge).toBeCloseTo(10.4, 9);
  });
});

describe("volgorde en groepering", () => {
  it("houdt de standaard op de Zendure 800 Pro 2", () => {
    expect(STANDAARD_PRESET_ID).toBe("zendure-800pro2");
    expect(STANDAARD.presetId).toBe("zendure-800pro2");
  });

  it("zet de merken in de afgesproken volgorde, Zendure eerst en generiek laatst", () => {
    expect(perMerk().map((g) => g.merk)).toEqual(MERK_VOLGORDE);
    expect(PRESETS[0]!.merk).toBe("Zendure");
    expect(PRESETS.at(-1)!.merk).toBe("Generiek");
  });

  it("laat merken aaneengesloten staan", () => {
    const volgorde = PRESETS.map((p) => p.merk).filter((m, i, a) => i === 0 || a[i - 1] !== m);
    expect(volgorde).toEqual(MERK_VOLGORDE);
  });

  it("zet Zendure van klein naar groot", () => {
    const zendure = perMerk()[0]!.presets;
    expect(zendure.map((p) => p.id)).toEqual(ZENDURE_BIJ_ANWB);
    const prijzen = zendure.map((p) => p.prijsEur);
    expect([...prijzen].sort((a, b) => a - b)).toEqual(prijzen);
  });

  it("markeert precies de vijf Zendure-modellen als verkrijgbaar bij ANWB, met een ANWB-link", () => {
    const bij = PRESETS.filter((p) => p.bijAnwb).map((p) => p.id);
    expect(bij).toEqual(ZENDURE_BIJ_ANWB);
    for (const p of PRESETS) {
      if (p.bijAnwb) expect(p.anwbUrl, p.id).toMatch(/^https:\/\/www\.anwb\.nl\/webwinkel\/p\/\d+\//);
      else expect(p.anwbUrl, p.id).toBeUndefined();
    }
    expect(PRESETS.some((p) => p.id.includes("ab3000l"))).toBe(false);
  });

  it("heeft unieke id's", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});

describe("laden en leveren apart", () => {
  it("geeft Sessy 2,2 kW laden en 1,7 kW leveren in de BatterySpec", () => {
    for (const id of ["sessy-5kwh", "sessy-10kwh"]) {
      const p = kiesPreset(id);
      expect(p.spec.maxChargeKw).toBe(2.2);
      expect(p.spec.maxDischargeKw).toBe(1.7);
      expect(p.laadvermogenKw).toBe(2.2);
      expect(p.ontlaadvermogenKw).toBe(1.7);
      expect(p.vermogenKw).toBe(2.2);
      const cfg = maakConfiguratie({ ...STANDAARD, presetId: id });
      expect(cfg.battery.maxChargeKw).toBe(2.2);
      expect(cfg.battery.maxDischargeKw).toBe(1.7);
      expect(vermogenVan(cfg.battery)).toBe(2.2);
    }
  });

  it("laat de andere modellen symmetrisch, met vermogenKw gelijk aan het hoogste van de twee", () => {
    for (const p of PRESETS) {
      expect(p.vermogenKw, p.id).toBe(Math.max(p.spec.maxChargeKw, p.spec.maxDischargeKw));
      if (!p.id.startsWith("sessy-5") && !p.id.startsWith("sessy-10")) {
        expect(p.laadvermogenKw, p.id).toBe(p.ontlaadvermogenKw);
      }
    }
  });

  it("zet een eigen vermogen op laden én leveren", () => {
    const cfg = maakConfiguratie({ ...STANDAARD, presetId: "sessy-5kwh", vermogenKw: 1.2 });
    expect(cfg.battery.maxChargeKw).toBe(1.2);
    expect(cfg.battery.maxDischargeKw).toBe(1.2);
    const e = effectieveBatterij({ ...STANDAARD, presetId: "sessy-5kwh", vermogenKw: 1.2 });
    expect(e.laadKw).toBe(1.2);
    expect(e.ontlaadKw).toBe(1.2);
    expect(e.aangepast.vermogen).toBe(true);
    // Ook als het getal gelijk is aan het hoogste van de preset.
    const gelijk = maakConfiguratie({ ...STANDAARD, presetId: "sessy-5kwh", vermogenKw: 2.2 });
    expect(gelijk.battery.maxDischargeKw).toBe(2.2);
    expect(effectieveBatterij({ ...STANDAARD, presetId: "sessy-5kwh", vermogenKw: 2.2 }).aangepast.vermogen).toBe(true);
    // Zonder eigen vermogen is er niets aangepast.
    expect(effectieveBatterij({ ...STANDAARD, presetId: "sessy-5kwh" }).aangepast.vermogen).toBe(false);
  });

  it("prijst een eigen maat vanaf het hoogste van de twee", () => {
    // Zelfde maat via een eigen waarde: de prijs blijft die van de preset.
    const e = effectieveBatterij({ ...STANDAARD, presetId: "sessy-5kwh", capaciteitKwh: 5.5 });
    expect(e.prijsEur).toBe(kiesPreset("sessy-5kwh").prijsEur);
    expect(e.vermogenKw).toBe(2.2);
  });

  it("noemt laden en leveren apart in woorden", () => {
    expect(vermogenTekst(2.2, 1.7)).toBe("2,2 kW laden · 1,7 kW leveren");
    expect(vermogenTekst(0.8, 0.8)).toBe("0,8 kW");
  });
});

describe("logo's", () => {
  const metLogo = PRESETS.filter((p) => p.merk !== "Generiek");

  it("geeft elke preset behalve de generieke een logo dat in public/logos bestaat", () => {
    for (const p of metLogo) {
      expect(p.logo, p.id).toMatch(/^\/logos\/[a-z]+\.(svg|png)$/);
      expect(existsSync(`public${p.logo}`), p.id).toBe(true);
    }
    for (const p of PRESETS.filter((x) => x.merk === "Generiek")) expect(p.logo).toBeUndefined();
  });

  it("deelt het logo binnen een merk", () => {
    for (const g of perMerk()) expect(new Set(g.presets.map((p) => p.logo)).size, g.merk).toBe(1);
  });

  it("bevat in de SVG-logo's alleen vectortekening", () => {
    const svgs = [...new Set(metLogo.map((p) => p.logo!).filter((l) => l.endsWith(".svg")))];
    expect(svgs.length).toBeGreaterThanOrEqual(5);
    for (const l of svgs) {
      const tekst = readFileSync(`public${l}`, "utf8");
      expect(tekst, l).toMatch(/^\s*<svg[\s>]/);
      expect(tekst, l).not.toMatch(/<script/i);
      expect(tekst, l).not.toMatch(/foreignObject/i);
      expect(tekst, l).not.toMatch(/\bon[a-z]+\s*=/i);
      expect(tekst, l).not.toMatch(/(xlink:)?href\s*=\s*["']\s*(https?:|\/\/|data:)/i);
      expect(tekst, l).not.toMatch(/url\(\s*["']?\s*(https?:|\/\/)/i);
      expect(tekst, l).not.toMatch(/@import/i);
      // De enige absolute URL is de XML-naamruimte.
      const urls = tekst.match(/https?:\/\/[^"'\s)]+/g) ?? [];
      for (const u of urls) expect(u, l).toBe("http://www.w3.org/2000/svg");
    }
  });

  it("houdt een PNG-logo klein", () => {
    for (const l of [...new Set(metLogo.map((p) => p.logo!).filter((x) => x.endsWith(".png")))]) {
      const bytes = readFileSync(`public${l}`);
      expect(bytes.length, l).toBeLessThan(20_000);
      // PNG-header: breedte op byte 16, hoogte op byte 20.
      expect(bytes.readUInt32BE(20), l).toBeLessThanOrEqual(96);
    }
  });
});

function maakData(presetId = STANDAARD_PRESET_ID): GidsData {
  const inst = { ...STANDAARD, presetId };
  const preset = kiesPreset(presetId);
  return {
    inst,
    zetInst: vi.fn(),
    manifest: null,
    preset,
    capaciteitKwh: preset.capaciteitKwh,
    vermogenKw: preset.vermogenKw,
    prijsEur: preset.prijsEur,
    result: null,
    toon: null,
    scenario: null,
    overgang: null,
    scenarioFout: null,
    grid: null,
    huishoudens: null,
    toonZonnepanelen: true,
    bedragJarenTekst: "",
    bezig: false,
    verouderd: false,
    herbereken: vi.fn(),
    uitleg: () => undefined,
    naarVerdieping: vi.fn(),
    volgende: vi.fn(),
  } as unknown as GidsData;
}

describe("stap 2 per merk", () => {
  it("toont een kopje met logo en merknaam per merk, in volgorde", () => {
    const { container } = render(<StapBatterij {...maakData()} />);
    const koppen = [...container.querySelectorAll(".batterij-merk-naam")];
    expect(koppen.map((k) => k.textContent)).toEqual(MERK_VOLGORDE);
    for (const g of perMerk()) {
      if (g.logo) {
        const img = container.querySelector(`img[alt="${g.merk}"]`) as HTMLImageElement | null;
        expect(img, g.merk).toBeTruthy();
        expect(img!.getAttribute("src")).toBe(g.logo);
        expect(img!.getAttribute("height")).toBe("20");
      }
    }
    // Het generieke merk heeft geen logo, alleen het woord.
    expect(container.querySelector('img[alt="Generiek"]')).toBeNull();
  });

  it("zegt bij Zendure dat het bij ANWB te koop is, en linkt elk model", () => {
    render(<StapBatterij {...maakData()} />);
    expect(screen.getAllByText("Verkrijgbaar bij ANWB")).toHaveLength(1);
    const links = screen.getAllByRole("link", { name: "Bekijk bij ANWB" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(PRESETS.filter((p) => p.bijAnwb).map((p) => p.anwbUrl));
    for (const a of links) {
      expect(a.getAttribute("rel")).toContain("noopener");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("toont op elke kaart het rendement alleen als het niet gemeten is", () => {
    render(<StapBatterij {...maakData()} />);
    const groep = screen.getByRole("group", { name: "Batterij" });
    const knoppen = within(groep).getAllByRole("button");
    expect(knoppen).toHaveLength(PRESETS.length);
    for (const p of PRESETS) {
      const knop = knoppen.find((k) => k.textContent?.includes(p.naam))!;
      if (p.rendementBron === "gemeten") expect(knop.textContent, p.id).not.toMatch(/Rendement \d/);
      else expect(knop.textContent, p.id).toMatch(/Rendement \d+(,\d)?%: /);
    }
    expect(knoppen.find((k) => k.textContent?.includes("Sessy 5 kWh"))!.textContent).toContain("door eigenaren gemeten");
    expect(knoppen.find((k) => k.textContent?.includes("Sessy Plus"))!.textContent).toContain("aanname");
  });

  it("zet laden en leveren van Sessy op de kaart", () => {
    render(<StapBatterij {...maakData()} />);
    const knop = within(screen.getByRole("group", { name: "Batterij" }))
      .getAllByRole("button")
      .find((k) => k.textContent?.includes("Sessy 5 kWh"))!;
    expect(knop.textContent).toContain("2,2 kW laden · 1,7 kW leveren");
    expect(knop.textContent).toContain("waarvan ongeveer 5,2 kWh bruikbaar");
  });

  it("laat voorverkoop en acties op de kaart zien", () => {
    render(<StapBatterij {...maakData()} />);
    const knoppen = within(screen.getByRole("group", { name: "Batterij" })).getAllByRole("button");
    expect(knoppen.find((k) => k.textContent?.includes("Sessy Plus"))!.textContent).toMatch(/Voorverkoop/);
    expect(knoppen.find((k) => k.textContent?.includes("AlphaESS"))!.textContent).toMatch(/Voorverkoop/);
    expect(knoppen.find((k) => k.textContent?.includes("Solarbank 3"))!.textContent).toMatch(/Actieprijs tot 12 oktober/);
  });
});

describe("de keuzelijst bij Invoer", () => {
  it("heeft een optgroup per merk, Zendure met 'bij ANWB'", () => {
    const { container } = render(
      <Invoer
        afnameKwh={2500}
        terugleveringKwh={2000}
        presetId={STANDAARD_PRESET_ID}
        onAfname={() => {}}
        onTeruglevering={() => {}}
        onPreset={() => {}}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
      />,
    );
    const groepen = [...container.querySelectorAll("select optgroup")];
    expect(groepen.map((g) => g.getAttribute("label"))).toEqual([
      "Zendure · bij ANWB",
      "Sessy",
      "AlphaESS",
      "Anker",
      "HomeWizard",
      "Marstek",
      "Generiek",
    ]);
    const opties = [...container.querySelectorAll("select option")].map((o) => (o as HTMLOptionElement).value);
    expect(opties).toEqual(PRESETS.map((p) => p.id));
  });

  it("noemt laden en leveren apart in de hint onder de keuze", () => {
    const { container } = render(
      <Invoer
        afnameKwh={2500}
        terugleveringKwh={2000}
        presetId="sessy-5kwh"
        onAfname={() => {}}
        onTeruglevering={() => {}}
        onPreset={() => {}}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
      />,
    );
    expect(container.textContent).toContain("2,2 kW laden · 1,7 kW leveren");
  });
});

describe("de bronnenlijst", () => {
  it("bevat elke bron-URL van elke preset, per merk", () => {
    const { container } = render(<BatterijBronnen />);
    const hrefs = new Set([...container.querySelectorAll("a")].map((a) => a.getAttribute("href")));
    for (const p of PRESETS) {
      for (const b of p.bronnen) expect(hrefs.has(b.url), `${p.id}: ${b.url}`).toBe(true);
    }
    const koppen = [...container.querySelectorAll(".batterij-bronnen-kop")].map((k) => k.textContent);
    expect(koppen).toEqual(MERK_VOLGORDE);
  });

  it("noemt de nieuwe bronnen uit de opdracht", () => {
    const { container } = render(<BatterijBronnen />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const u of [
      "https://www.sessy.nl/specificaties/",
      "https://forum.sessy.nl/waar-moet-ik-op-letten/rendement-sessy/",
      "https://www.ankersolix.com/nl/products/a17e2",
      "https://www.alphaess.nl/products/alphaess-vitapower-3600-ac",
      "https://energienerds.nl/index.php/2026/08/27/review-zendure-solarflow-3000-mix-ac",
      "https://plugin-batterij.nl/consumentenbond-test-thuisbatterijen-met-stekker/",
    ]) {
      expect(hrefs, u).toContain(u);
    }
  });
});
