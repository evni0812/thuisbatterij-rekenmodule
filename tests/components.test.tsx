/**
 * Rendertest van de volledige interface met een écht analyseresultaat.
 *
 * De modeltests bewijzen dat de cijfers kloppen; deze test bewijst dat de
 * pagina ze ook zonder fouten toont. Dat vangt de klasse problemen die
 * rekentests missen: een ontbrekende waarde, een lege reeks, een deling door
 * nul in een schaalfunctie.
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Antwoord } from "../components/Antwoord";
import { BatterijMaat } from "../components/BatterijMaat";
import { BesparingPerJaar } from "../components/BesparingPerJaar";
import { Cashflow } from "../components/Cashflow";
import { Dagprofiel } from "../components/Dagprofiel";
import { Geavanceerd } from "../components/Geavanceerd";
import { Prijskloof } from "../components/Prijskloof";
import { Statistieken } from "../components/Statistieken";
import { Uitsplitsing } from "../components/Uitsplitsing";
import { Verantwoording } from "../components/Verantwoording";
import { Verliezen } from "../components/Verliezen";
import { controleerInvoer } from "../components/Invoer";
import { expandPricesToQuarters, loadManifest, loadPriceYear, loadProfileYear } from "../lib/data/loader";
import type { Manifest } from "../lib/data/manifest";
import { addDays, localMidnightUtcMs } from "../lib/data/timeaxis";
import { runAnalysis, type AnalysisResult, type SampleDay } from "../lib/model/analysis";
import { buildResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import { PRESETS } from "../lib/presets";
import { STANDAARD } from "../lib/configuratie";

// Zonder opruimen stapelen de gerenderde DOM's op en vinden queries meerdere
// treffers uit eerdere tests.
afterEach(cleanup);

const DOMAIN = "871685900000056162";

/** Minimale instellingen voor het instellingenpaneel. */
const LEGE_INSTELLINGEN = {
  afnameKwh: 2500, terugleveringKwh: 2000, presetId: "marstek-venus-e3", heffing: "toen" as const,
  domein: DOMAIN, van: "", tot: "", spreiding: 1, terugleverkostenCt: 0,
  curtailment: true, analysejaren: 15, discontovoet: 0.03, prijsstijging: 0.02,
  degradatie: 0.015, prijsEur: null, capaciteitKwh: null, vermogenKw: null,
  opwekKwh: null,
};
let manifest: Manifest;
let result: AnalysisResult;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const buf = readFileSync(`public${String(input)}`);
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body,
      json: async () => JSON.parse(buf.toString("utf8")),
    } as Response;
  }) as typeof fetch;

  manifest = await loadManifest();
  const preset = PRESETS[1]!;
  const jaar = 2025;
  const prof = await loadProfileYear(manifest, DOMAIN, jaar);
  const price = await loadPriceYear(manifest, jaar);
  const start = 0;
  const end = prof.startMs.length;
  void addDays;
  void localMidnightUtcMs;
  const startMs = prof.startMs.slice(start, end);
  const tariff = {
    purchaseSurchargeEurPerKwh: 0,
    energyTaxEurPerKwh: price.levyEurPerKwh,
    feedInCostEurPerKwh: 0,
    allowCurtailment: true,
  };

  result = runAnalysis({
    windows: [
      {
        year: jaar,
        firstDay: prof.firstDay,
        lastDay: prof.lastDay,
        isFullYear: true,
        window: {
          startMs,
          residualKwh: buildResidual(prof.importFraction, prof.exportFraction, {
            annualGridImportKwh: 2500,
            annualGridExportKwh: 2000,
            spreadFactor: 1,
          }),
          prices: buildPriceSeries(
            expandPricesToQuarters(startMs, price, "market"),
            tariff,
          ),
        },
      },
    ],
    battery: { ...preset.spec, wearCostEurPerKwh: 0 },
    tariff,
    investmentEur: preset.prijsEur,
    cycleLife: preset.cycleLife,
    calendarLifeYears: preset.kalenderLevensduurJaren,
    years: 15,
    priceEscalation: 0.02,
    discountRate: 0.03,
    calendarFadePerYear: 0.015,
    residualValueEur: 0,
  });
}, 120_000);

describe("de pagina toont het antwoord", () => {
  it("noemt een bedrag per jaar en een terugverdientijd", () => {
    render(<Antwoord result={result} investeringEur={1199} bezig={false} />);
    expect(screen.getByText(/per jaar/)).toBeDefined();
    // Er moet een concreet eurobedrag staan, geen placeholder.
    expect(document.body.textContent).toMatch(/€/);
    expect(document.body.textContent).toMatch(/terugverdiend|niet terug/);
  });

  it("legt de prijskloof uit met beide gewogen prijzen", () => {
    render(
      <Prijskloof gap={result.priceGap} afnameKwh={2500} terugleveringKwh={2000} />,
    );
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Wat je betaalt bij afname/);
    expect(tekst).toMatch(/Wat je krijgt bij teruglevering/);
    expect(tekst).toMatch(/ct/);
  });

  it("splitst de besparing uit en telt op tot het totaal", () => {
    const b = result.perYear[0]!.breakdown;
    render(<Uitsplitsing breakdown={b} periodeLabel="2025" />);
    expect(screen.getByText("Samen bespaard")).toBeDefined();
    // Slijtage hoort hier niet tussen: dat is de aanschafprijs, geen extra kost.
    // Het omzettingsverlies staat naast de optelling, met uitleg waarom.
    expect(document.body.textContent).toMatch(/ging.*verloren/);
    expect(document.body.textContent).toMatch(/Slijtage staat er evenmin tussen/);
    expect(screen.getByText(/Zelf verbruiken/)).toBeDefined();
  });

  it("tekent het dagprofiel met beide voorbeelddagen én een datumkiezer", () => {
    render(
      <Dagprofiel
        voorbeelden={result.sampleDays}
        losseDag={null}
        ontbreekt={null}
        eersteDag="2025-01-01"
        laatsteDag="2025-12-31"
        onVraagDag={() => {}}
        onWisDag={() => {}}
      />,
    );
    expect(screen.getAllByRole("tab").length).toBe(2);
    // Elke dag moet opzoekbaar zijn, niet alleen de twee voorbeelden.
    const datum = screen.getByLabelText(/kies zelf een dag/i) as HTMLInputElement;
    expect(datum.type).toBe("date");
    expect(datum.min).toBe("2025-01-01");
    expect(datum.max).toBe("2025-12-31");
    // De kiezer staat op de dag die in beeld is, niet leeg: anders lijkt er
    // niets gekozen terwijl er een voorbeelddag wordt getoond.
    expect(datum.value).toBe(result.sampleDays[0]!.date);
  });

  it("toont de kerncijfers van de dag naast de grafieken", () => {
    render(
      <Dagprofiel
        voorbeelden={result.sampleDays}
        losseDag={null}
        ontbreekt={null}
        eersteDag="2025-01-01"
        laatsteDag="2025-12-31"
        onVraagDag={() => {}}
        onWisDag={() => {}}
      />,
    );
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/bespaard op deze dag/);
    expect(tekst).toMatch(/uit de batterij gehaald/);
    expect(tekst).toMatch(/laadbeurten/);
    expect(tekst).toMatch(/minder van het net/);
    expect(tekst).toMatch(/prijsverschil op deze dag/);
    // De vergelijking met perfecte kennis: dat is waar het verschil tussen de
    // twee strategieën zichtbaar wordt.
    expect(tekst).toMatch(/van wat er in zat/);
    expect(tekst).toMatch(/met perfecte kennis/);
  });

  it("laat met de pijltjes naar de dag ernaast springen", () => {
    const gevraagd: string[] = [];
    render(
      <Dagprofiel
        voorbeelden={result.sampleDays}
        losseDag={null}
        ontbreekt={null}
        eersteDag="2025-01-01"
        laatsteDag="2025-12-31"
        onVraagDag={(d) => gevraagd.push(d)}
        onWisDag={() => {}}
      />,
    );
    const huidig = result.sampleDays[0]!.date;
    fireEvent.click(screen.getByLabelText("Volgende dag"));
    fireEvent.click(screen.getByLabelText("Vorige dag"));
    expect(gevraagd).toEqual([addDays(huidig, 1), addDays(huidig, -1)]);

    // En met de pijltjestoetsen in het datumveld hetzelfde.
    const datum = screen.getByLabelText(/kies zelf een dag/i);
    fireEvent.keyDown(datum, { key: "ArrowRight" });
    expect(gevraagd.at(-1)).toBe(addDays(huidig, 1));
  });

  it("stopt bij de rand van de beschikbare periode", () => {
    const eenDag = result.sampleDays[0]!;
    render(
      <Dagprofiel
        voorbeelden={[eenDag]}
        losseDag={eenDag}
        ontbreekt={null}
        eersteDag={eenDag.date}
        laatsteDag={eenDag.date}
        onVraagDag={() => {}}
        onWisDag={() => {}}
      />,
    );
    expect((screen.getByLabelText("Vorige dag") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Volgende dag") as HTMLButtonElement).disabled).toBe(true);
  });

  it("meldt het als er voor de gekozen dag geen gegevens zijn", () => {
    render(
      <Dagprofiel
        voorbeelden={result.sampleDays}
        losseDag={null}
        ontbreekt="2019-05-04"
        eersteDag="2025-01-01"
        laatsteDag="2025-12-31"
        onVraagDag={() => {}}
        onWisDag={() => {}}
      />,
    );
    expect(document.body.textContent).toMatch(/geen gegevens/);
  });

  it("toont de besparing per jaar", () => {
    render(<BesparingPerJaar jaren={result.perYear} />);
    expect(screen.getByRole("img")).toBeDefined();
  });

  it("toont de cashflow met kerncijfers", () => {
    render(<Cashflow finance={result.finance} investeringEur={1199} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Terugverdientijd/);
    expect(tekst).toMatch(/Contante waarde/);
    expect(tekst).toMatch(/Rendement/);
  });

  it("verantwoordt de bron en de beperkingen", () => {
    render(
      <Verantwoording manifest={manifest} result={result} domein={DOMAIN} />,
    );
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/MFFBAS/);
    expect(tekst).toMatch(/ANWB/);
    // De beperkingen horen er expliciet in te staan, niet weggelaten.
    expect(tekst).toMatch(/gemiddelde over veel huishoudens/);
    expect(tekst).toMatch(/variabele stroomkosten/);
  });

  it("laat het batterijraster starten voordat het rekent", () => {
    render(
      <BatterijMaat
        grid={null}
        huidigeCapaciteit={2.1}
        huidigVermogen={0.8}
        onStart={() => {}}
        onKies={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Reken de maten door/ })).toBeDefined();
  });

  it("toont elk vakje van het raster met zijn bedrag als getal", () => {
    const grid = {
      capacities: [2, 5],
      powers: [0.8, 2.5],
      klaar: true,
      bezig: false,
      rows: [
        [
          { capacityKwh: 2, powerKw: 0.8, savingEur: 40, cyclesPerYear: 150 },
          { capacityKwh: 2, powerKw: 2.5, savingEur: 45, cyclesPerYear: 160 },
        ],
        [
          { capacityKwh: 5, powerKw: 0.8, savingEur: 70, cyclesPerYear: 140 },
          { capacityKwh: 5, powerKw: 2.5, savingEur: 95, cyclesPerYear: 175 },
        ],
      ],
    };
    render(
      <BatterijMaat
        grid={grid}
        huidigeCapaciteit={5}
        huidigVermogen={2.5}
        onStart={() => {}}
        onKies={() => {}}
      />,
    );
    // Kleur mag nooit de enige drager zijn: elk vakje toont zijn getal.
    // Standaard is dat de opbrengst per kWh capaciteit, want daarop is de
    // afnemende meeropbrengst zichtbaar: 40/2 = 20, 95/5 = 19.
    const tabel = screen.getByRole("table");
    for (const perKwh of ["20", "22,5", "14", "19"]) {
      expect(within(tabel).getByText(perKwh)).toBeDefined();
    }

    // Omschakelen naar het totaal geeft de kale jaarbesparing.
    fireEvent.click(screen.getByRole("button", { name: "Totaal" }));
    for (const totaal of ["40", "45", "70", "95"]) {
      expect(within(tabel).getByText(totaal)).toBeDefined();
    }

    // En per kW deelt door het vermogen: 40/0,8 = 50, 95/2,5 = 38.
    fireEvent.click(screen.getByRole("button", { name: "Per kW" }));
    for (const perKw of ["50", "18", "87,5", "38"]) {
      expect(within(tabel).getByText(perKw)).toBeDefined();
    }
  });
});

describe("invoervalidatie denkt mee", () => {
  const preset = PRESETS[1]!;

  it("zegt niets bij plausibele invoer", () => {
    expect(controleerInvoer(2500, 2000, preset)).toEqual([]);
  });

  it("waarschuwt bij een ontbrekende afname", () => {
    const w = controleerInvoer(0, 2000, preset);
    expect(w.some((x) => x.ernst === "let-op")).toBe(true);
  });

  it("legt uit wat er gebeurt zonder teruglevering", () => {
    const w = controleerInvoer(2500, 0, preset);
    expect(w.some((x) => /weinig op te slaan/.test(x.tekst))).toBe(true);
  });

  it("signaleert een batterij die te groot is voor het verbruik", () => {
    const groot = PRESETS.find((p) => p.capaciteitKwh === 10)!;
    const w = controleerInvoer(800, 400, groot);
    expect(w.some((x) => /zelden vollopen/.test(x.tekst))).toBe(true);
  });

  it("blokkeert niets — het zijn toelichtingen, geen fouten", () => {
    const w = controleerInvoer(20000, 60000, preset);
    expect(w.length).toBeGreaterThan(0);
    // Ook bij extreme invoer blijft de tool doorrekenen.
    expect(w.every((x) => typeof x.tekst === "string")).toBe(true);
  });
});

describe("kerncijfers en herberekenen", () => {
  it("toont elk cijfer met zijn verandering, niet als los getal", () => {
    render(<Statistieken stats={result.stats} opwekBekend={false} />);
    const tekst = document.body.textContent ?? "";
    // Het verschil is het verhaal: "van X naar Y" zegt wat een batterij doet,
    // een kaal eindgetal niet.
    expect(tekst).toMatch(/Van het net/);
    expect(tekst).toMatch(/Naar het net/);
    expect(tekst).toMatch(/Laadbeurten/);
    expect(tekst).toMatch(/per dag/);
    expect(screen.getAllByLabelText("wordt").length).toBeGreaterThanOrEqual(2);
  });

  it("laat zelfconsumptie en autarkie weg zolang de opwek onbekend is", () => {
    render(<Statistieken stats={result.stats} opwekBekend={false} />);
    const tekst = document.body.textContent ?? "";
    // Ze zijn niet uit meterstanden af te leiden; een geraden getal zou erger
    // zijn dan geen getal.
    expect(tekst).not.toMatch(/Zelfconsumptie/);
    expect(tekst).toMatch(/hoeveel je panelen per jaar opwekken/);
  });

  it("vraagt om een opdracht in plaats van vanzelf te rekenen", () => {
    const opBereken = vi.fn();
    render(
      <Geavanceerd
        inst={{ ...LEGE_INSTELLINGEN }}
        manifest={manifest}
        preset={PRESETS[1]!}
        capaciteit={2.1}
        vermogen={0.8}
        prijs={1199}
        onChange={() => {}}
        onReset={() => {}}
        onBereken={opBereken}
        verouderd
        bezig={false}
      />,
    );
    // Bij gewijzigde invoer hoort de knop om aandacht te vragen: anders kijk je
    // naar een uitkomst die niet meer bij je instellingen hoort.
    expect(screen.getByText("Instellingen gewijzigd")).toBeDefined();
    const knop = screen.getByRole("button", { name: /Bereken opnieuw/ });
    fireEvent.click(knop);
    expect(opBereken).toHaveBeenCalledOnce();
  });
});

describe("de verliezensectie", () => {
  it("noemt alle drie de posten met kilowatturen en een bedrag", () => {
    render(<Verliezen losses={result.losses} afnameKwh={2500} besparingEur={result.averageSavingEur} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Verlies bij het laden/);
    expect(tekst).toMatch(/Verlies bij het ontladen/);
    expect(tekst).toMatch(/Stroom voor de batterij zelf/);
    expect(tekst).toMatch(/Samen verloren/);
    expect(tekst).toMatch(/kWh/);
    expect(tekst).toMatch(/€/);
    // Geen Engelse decimaalpunt in getallen.
    expect(tekst).not.toMatch(/\d\.\d{1,2} kWh/);
  });

  it("toont in de kop een conclusie die bij de cijfers past", () => {
    render(<Verliezen losses={result.losses} afnameKwh={2500} besparingEur={result.averageSavingEur} />);
    const l = result.losses;
    const kop = screen.getByRole("heading", { level: 3 }).textContent ?? "";
    if (l.standbyKwh > l.chargeLossKwh + l.dischargeLossKwh) {
      expect(kop).toMatch(/niet in de omzetting/);
    } else {
      expect(kop).toMatch(/komt er \d+ weer uit/);
    }
  });

  it("laat de balken binnen hun schaal blijven", () => {
    const { container } = render(
      <Verliezen losses={result.losses} afnameKwh={2500} besparingEur={result.averageSavingEur} />,
    );
    const delen = container.querySelectorAll<HTMLElement>(".verlies-deel");
    expect(delen.length).toBe(3);
    for (const d of delen) {
      const pct = Number.parseFloat(d.style.width);
      expect(pct).toBeGreaterThan(0);
      expect(pct).toBeLessThanOrEqual(100.0001);
    }
  });

  it("verdwijnt als er nooit geladen is", () => {
    const leeg = { ...result.losses, chargedKwh: 0 };
    const { container } = render(<Verliezen losses={leeg} afnameKwh={2500} besparingEur={100} />);
    expect(container.textContent).toBe("");
  });
});

describe("labels in het dagprofiel botsen niet", () => {
  /**
   * Elk label in de rechterkolom is twee regels: een naam en een waarde, twaalf
   * eenheden uit elkaar. Staan twee labels dichter dan een regelhoogte bij
   * elkaar, dan schuift de waarde van het ene over de naam van het andere.
   *
   * Dat gebeurde op twee plekken tegelijk. De lijnlabels werden uit elkaar
   * geduwd met een marge van 15, te weinig voor een label van ruim twintig hoog:
   * zichtbaar zodra "zónder batterij" en "mét batterij" op dezelfde hoogte
   * eindigen, wat elke dag gebeurt waarop de batterij 's avonds leeg is. En de
   * legenda van het actiepaneel zette vier regels vanaf de bovenkant en twee
   * vanaf de onderkant, die bij zes zichtbare reeksen acht eenheden uit elkaar
   * kwamen te staan.
   *
   * Deze test kijkt niet naar die twee oorzaken maar naar het gevolg: geen twee
   * teksten in de labelkolom mogen binnen een regelhoogte van elkaar liggen.
   */
  function maakDag(): SampleDay {
    const n = 96;
    const start = Date.UTC(2025, 5, 21, 22, 0, 0);
    const leeg = () => new Array<number>(n).fill(0);
    const dag: SampleDay = {
      label: "Testdag",
      date: "2025-06-22",
      startMs: Array.from({ length: n }, (_, i) => start + i * 900_000),
      residualKwh: leeg(),
      netKwh: leeg(),
      curtailedKwh: leeg(),
      socKwh: leeg(),
      chargeKwh: leeg(),
      dischargeKwh: leeg(),
      importPrice: leeg(),
      exportPrice: leeg(),
      meterExportKwh: leeg(),
      meterImportKwh: leeg(),
      usableCapacityKwh: 5,
      stats: {
        baselineCostEur: 1.2, batteryCostEur: 0.6, savingEur: 0.6,
        optimalSavingEur: 0.7, gridImportBaselineKwh: 4, gridImportBatteryKwh: 2,
        gridExportBaselineKwh: 6, gridExportBatteryKwh: 3, chargedKwh: 3,
        deliveredKwh: 2.6, chargedFromSolarKwh: 2.5, chargedFromGridKwh: 0.5,
        cycles: 0.6, socMaxKwh: 4.2, socStartKwh: 0, socEndKwh: 0.4,
        curtailedKwh: 0, priceMinEurPerKwh: 0.12, priceMaxEurPerKwh: 0.34,
        meterImportKwh: 4, meterExportKwh: 6,
      },
    };

    for (let i = 0; i < n; i++) {
      const uur = i / 4;
      const zon = uur > 8 && uur < 17;
      dag.importPrice[i] = zon ? 0.14 : 0.3;
      dag.exportPrice[i] = zon ? 0.02 : 0.14;
      dag.residualKwh[i] = zon ? -0.6 : 0.15;
      dag.meterExportKwh[i] = zon ? 0.6 : 0;
      dag.meterImportKwh[i] = zon ? 0 : 0.15;
      // Laden uit eigen zon overdag, ontladen naar het huis 's avonds.
      if (zon) dag.chargeKwh[i] = 0.2;
      if (uur >= 18 && uur < 22) dag.dischargeKwh[i] = 0.15;
      dag.socKwh[i] = Math.min(4.2, Math.max(0, (uur - 8) * 0.35));
    }
    // Eén kwartier laden terwijl er een tekort is: dat komt uit het net.
    dag.chargeKwh[16] = 0.2;
    // Eén kwartier ontladen zonder tekort: dat gaat het net op.
    dag.dischargeKwh[50] = 0.1;
    for (let i = 0; i < n; i++) {
      dag.netKwh[i] = dag.residualKwh[i]! + dag.chargeKwh[i]! - dag.dischargeKwh[i]!;
    }
    return dag;
  }

  it("houdt elke tekst in de labelkolom een regelhoogte uit elkaar", () => {
    const { container } = render(
      <Dagprofiel
        voorbeelden={[maakDag()]}
        losseDag={null}
        ontbreekt={null}
        eersteDag="2025-01-01"
        laatsteDag="2025-12-31"
        onVraagDag={() => {}}
        onWisDag={() => {}}
      />,
    );

    // Alle zes reeksen moeten in beeld zijn, anders toetst dit niets.
    const tekst = container.textContent ?? "";
    for (const naam of [
      "zon naar de meter", "netto over", "uit eigen zon",
      "uit het net", "naar je huis", "naar het net",
    ]) {
      expect(tekst, `reeks "${naam}" ontbreekt in de legenda`).toContain(naam);
    }

    const labels = [
      ...container.querySelectorAll("text.lijn-label, text.lijn-waarde, text.legende-kop"),
    ]
      .map((el) => ({ y: Number(el.getAttribute("y")), t: el.textContent ?? "" }))
      .filter((l) => Number.isFinite(l.y))
      .sort((a, b) => a.y - b.y);

    // De tekst is 10 tot 11,5px; baselines dichter dan tien eenheden overlappen.
    for (let i = 1; i < labels.length; i++) {
      const vorige = labels[i - 1]!;
      const huidige = labels[i]!;
      expect(
        huidige.y - vorige.y,
        `"${vorige.t}" (y=${vorige.y}) en "${huidige.t}" (y=${huidige.y}) overlappen`,
      ).toBeGreaterThanOrEqual(10);
    }
  });
});

describe("de instellingen zijn geordend op wat ze veranderen", () => {
  /**
   * De vraag kwam waarom de jaaropbrengst zou veranderen als je de rente
   * aanpast. Dat doet hij niet, maar dat was uit het paneel niet af te lezen:
   * looptijd, rente en prijsstijging stonden onder "De doorrekening" tussen
   * instellingen die de uitkomst wél veranderen.
   *
   * De indeling gaat nu op effect. Deze test bewaakt dat de groep die alleen de
   * businesscase raakt dat ook zegt, en dat capaciteitsverlies bij de accu staat
   * en niet bij de doorrekening.
   */
  function toon(over: Partial<typeof LEGE_INSTELLINGEN> = {}) {
    return render(
      <Geavanceerd
        inst={{ ...LEGE_INSTELLINGEN, ...over }}
        manifest={manifest}
        preset={PRESETS[1]!}
        capaciteit={2.1}
        vermogen={0.8}
        prijs={1199}
        onChange={() => {}}
        onReset={() => {}}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
      />,
    );
  }

  it("zegt bij elke groep wat hij beïnvloedt", () => {
    toon();
    const koppen = [...document.querySelectorAll("h3")].map((el) => el.textContent);
    expect(koppen).toEqual([
      "Jouw situatie",
      "De batterij",
      "Je contract",
      "Hoe je ernaar kijkt",
    ]);
    const tekst = document.body.textContent ?? "";
    // De groep die de fysica niet raakt, zegt dat met zoveel woorden.
    expect(tekst).toMatch(/Niet de jaaropbrengst/);
  });

  it("zet capaciteitsverlies bij de batterij, niet bij de doorrekening", () => {
    const { container } = toon();
    const secties = [...container.querySelectorAll("section section")];
    const batterij = secties.find((s) => s.querySelector("h3")?.textContent === "De batterij");
    expect(batterij?.textContent).toMatch(/Capaciteitsverlies per jaar/);
    const kijk = secties.find(
      (s) => s.querySelector("h3")?.textContent === "Hoe je ernaar kijkt",
    );
    expect(kijk?.textContent).not.toMatch(/Capaciteitsverlies/);
  });

  it("laat de heffing als een keuze tussen twee zien, niet als vinkje", () => {
    toon();
    // Een vinkje "reken met de belasting van nu" laat de andere kant naamloos.
    expect(screen.getByRole("button", { name: /Van toen/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Van nu/ })).toBeDefined();
  });

  it("meldt hoeveel instellingen afwijken van de standaard", () => {
    // LEGE_INSTELLINGEN kiest bewust een andere batterij dan de standaard, dus
    // dat is al één afwijking; hier zetten we hem gelijk om vanaf nul te tellen.
    toon({ presetId: STANDAARD.presetId });
    expect(
      screen.getByRole("button", { name: /Alles staat op de standaardwaarden/ }),
    ).toBeDefined();

    cleanup();
    toon({ presetId: STANDAARD.presetId, discontovoet: 0.05, spreiding: 1.4 });
    expect(screen.getByRole("button", { name: /2 gewijzigd/ })).toBeDefined();
  });
});
