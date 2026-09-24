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
import { MaandVerloop } from "../components/MaandVerloop";
import { Prijskloof } from "../components/Prijskloof";
import { Statistieken } from "../components/Statistieken";
import { Uitsplitsing } from "../components/Uitsplitsing";
import { Verantwoording } from "../components/Verantwoording";
import { Verliezen } from "../components/Verliezen";
import { Verschuiving } from "../components/Verschuiving";
import { Nettarief } from "../components/Nettarief";
import { Wachtscherm } from "../components/Wachtscherm";
import { Co2Antwoord } from "../components/Co2Antwoord";
import { Doelvergelijking } from "../components/Doelvergelijking";
import { deelVan, type VergelijkingDeel } from "../lib/model/vergelijking";
import type { VergelijkingState } from "../lib/useAnalysis";
import type { Doel } from "../lib/model/types";
import { Co2Maanden } from "../components/Co2Maanden";
import { Co2Nederland } from "../components/Co2Nederland";
import { Co2Uren } from "../components/Co2Uren";
import { co2Jaar } from "../lib/model/co2";
import type { DispatchResult, Window } from "../lib/model/types";
import { Uitbreiden } from "../components/Uitbreiden";
import { VoorWie } from "../components/VoorWie";
import { huishoudensVarianten } from "../lib/model/huishoudens";
import { RASTER_GRONDSLAG } from "../lib/model/dimensionering";
import { Verloop } from "../components/Verloop";
import { dagenLater, maandagVan, type PeriodeReeks } from "../lib/model/periode";
import { Tariefblad } from "../components/Tariefblad";
import { Invoer, controleerInvoer, slijtageHint } from "../components/Invoer";
import { expandPricesToQuarters, loadManifest, loadPriceYear, loadProfileYear } from "../lib/data/loader";
import type { Manifest } from "../lib/data/manifest";
import { addDays, localMidnightUtcMs } from "../lib/data/timeaxis";
import { metZelfvoorziening, runAnalysis, type AnalysisResult, type SampleDay } from "../lib/model/analysis";
import { euro, jaren, meerMinder } from "../lib/format";
import { UITLEG } from "../lib/uitleg";
import { buildResidual } from "../lib/model/residual";
import { buildPriceSeries } from "../lib/model/tariff";
import { PRESETS } from "../lib/presets";
import { STANDAARD, maakConfiguratie } from "../lib/configuratie";
import { overgangsFinance } from "../lib/overgang";

// Zonder opruimen stapelen de gerenderde DOM's op en vinden queries meerdere
// treffers uit eerdere tests.
afterEach(cleanup);

const DOMAIN = "871685900000056162";

/** Minimale instellingen voor het instellingenpaneel. */
/**
 * Een volledige set instellingen voor de componenten die er een vragen.
 *
 * De waarden die een standaard hébben komen uit `STANDAARD`, niet uit een
 * kopie hier: anders meldt het instellingenpaneel "1 instelling wijkt af"
 * zodra iemand een standaardwaarde verandert, en faalt een test op iets wat
 * niet stuk is.
 */
const LEGE_INSTELLINGEN = {
  afnameKwh: 2500, terugleveringKwh: 2000, presetId: "marstek-venus-e3", heffing: STANDAARD.heffing,
  domein: DOMAIN, van: "", tot: "", spreiding: 1, terugleverkostenCt: 0,
  curtailment: true, analysejaren: 15, discontovoet: 0.03,
  prijsstijging: STANDAARD.prijsstijging, slijtageDeel: STANDAARD.slijtageDeel,
  kostenPerKwh: STANDAARD.kostenPerKwh, kostenPerKw: STANDAARD.kostenPerKw,
  installatieEur: STANDAARD.installatieEur, co2Drempel: STANDAARD.co2Drempel, doel: STANDAARD.doel,
  degradatie: 0.015, prijsEur: null, capaciteitKwh: null, vermogenKw: null,
  opwekKwh: null, zonnepanelen: true,
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
    render(<Antwoord result={result} scenario={null} overgang={null} investeringEur={1199} bezig={false} />);
    expect(screen.getAllByText(/per jaar/).length).toBeGreaterThan(0);
    // Er moet een concreet eurobedrag staan, geen placeholder.
    expect(document.body.textContent).toMatch(/€/);
    expect(document.body.textContent).toMatch(/terugverdiend|niet terug/);
  });

  it("zegt erbij dat de terugverdientijd het verleden doortrekt", () => {
    /**
     * Het bedrag is gemeten, de terugverdientijd is dat bedrag doorgetrokken
     * naar de toekomst. Die overgang hoort in de zin zelf te staan en niet
     * alleen in de dialoog erachter: wie alleen de kop leest, leest anders een
     * belofte waar een doorrekening staat.
     */
    render(<Antwoord result={result} scenario={null} overgang={null} investeringEur={699} bezig={false} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/had deze batterij je/);
    expect(tekst).toMatch(/Blijven de komende jaren hierop lijken|blijven lijken/);
    expect(tekst).toMatch(/aanname, geen voorspelling/);
    // De grondslag en de voorwaarden staan in het antwoord zelf, niet alleen in
    // de uitleg: welke jaren, welke heffing, welk contract, en wat er niet in zit.
    expect(tekst).toMatch(/Doorgerekend op de uurprijzen van \d{4}.* met de belasting en\s+opslag van nu/);
    expect(tekst).toMatch(/dynamisch energiecontract/);
    expect(tekst).toMatch(/eigen stroomverbruik van de\s+batterij/);
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
    const b = result.breakdown;
    render(<Uitsplitsing breakdown={b} periodeLabel="2025" />);
    // De waterval sluit af met de som van de posten ervoor.
    expect(screen.getAllByText("Samen bespaard").length).toBeGreaterThan(0);
    // Slijtage hoort hier niet tussen: dat is de aanschafprijs, geen extra kost.
    // Het omzettingsverlies staat naast de optelling, met uitleg waarom.
    expect(document.body.textContent).toMatch(/ging.*verloren/);
    expect(document.body.textContent).toMatch(/Slijtage staat er evenmin tussen/);
    expect(screen.getAllByText(/Zelf verbruiken/).length).toBeGreaterThan(0);
  });

  it("zet de posten van de waterval op elkaar, eindigend op het totaal", () => {
    /**
     * De verbindingslijnen dragen de belofte dat het een optelling is: de ene
     * post begint waar de vorige eindigt. Klopt die optelling niet met het
     * totaal, dan liegt de grafiek en is dat aan niets te zien.
     */
    const b = result.breakdown;
    expect(
      b.selfConsumptionEur + b.arbitrageEur + b.avoidedNegativeExportEur,
    ).toBeCloseTo(b.totalEur, 6);
    // En het totaal is hetzelfde getal als het antwoord bovenaan de pagina:
    // dezelfde grondslag, het gemiddelde over de volledige jaren.
    expect(b.totalEur).toBeCloseTo(result.averageSavingEur, 6);
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
    render(<Cashflow finance={result.finance} overgang={null} investeringEur={1199} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Terugverdientijd/);
    expect(tekst).toMatch(/Contante waarde/);
    expect(tekst).toMatch(/Rendement/);
  });

  it("rekent de uitleg van de cashflow op dezelfde grondslag als de kaart, met de overgang", () => {
    /**
     * De kaart tekende de looptijd mét de overgang naar het nettarief (5 jaar,
     * 18,5%), de dialoog erachter rekende zonder (6 jaar en 11 maanden,
     * 11,3%). Nu rekenen beide met de overgang, en staat het andere getal er
     * als vergelijking bij, met een label dat zegt wat het is.
     */
    const config = maakConfiguratie(LEGE_INSTELLINGEN);
    const scenario = {
      ...result,
      curve: result.curve.map((p) => ({ ...p, savingEur: p.savingEur * 2, cyclesPerYear: p.cyclesPerYear * 1.2 })),
    };
    const overgang = overgangsFinance(result, scenario, config);
    expect(overgang.finance.paybackYears).not.toBe(result.finance.paybackYears);
    const blok = UITLEG.cashflow({ result, scenario, config, preset: PRESETS[1]! });
    const regels = blok.voorbeeld!.regels;
    const tvt = regels.find((r) => /^Terugverdiend na, als het nettarief-voorstel doorgaat/.test(String(r.wat)));
    expect(tvt?.waarde).toBe(jaren(overgang.finance.paybackYears));
    expect(regels.find((r) => r.wat === "Netto contante waarde")?.waarde).toBe(euro(overgang.finance.npvEur));
    expect(
      regels.some(
        (r) =>
          /^Ter vergelijking, als het nettarief blijft zoals nu: terugverdiend na/.test(String(r.wat)) &&
          r.waarde === jaren(result.finance.paybackYears),
      ),
    ).toBe(true);
    // Het opgetelde bedrag is al na aftrek van de aanschaf, en dat staat erbij.
    expect(regels.some((r) => /netto na aftrek van de aanschaf/.test(String(r.wat)))).toBe(true);
    render(
      <Cashflow finance={result.finance} overgang={overgang} investeringEur={config.investmentEur} cycleLife={config.cycleLife} />,
    );
    const tekst = document.body.textContent ?? "";
    expect(tekst).toContain(jaren(overgang.finance.paybackYears));
    // Grote getallen met een duizendtalpunt, en de grondslag van het totaal.
    expect(tekst).toMatch(/Laadbeurten in totaal\d{1,3}(\.\d{3})*/);
    expect(tekst).toMatch(/met het nettarief vanaf 2029 handelt de batterij vaker/);
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

  it("meldt dat het raster wordt doorgerekend, zonder knop", () => {
    /**
     * Het raster stond achter een startknop, en daardoor zag vrijwel niemand de
     * kaart die laat zien of een andere maat beter was geweest. Hij draait nu
     * automatisch in een tweede worker; hier staat alleen wat er komt.
     */
    render(
      <BatterijMaat
        grid={null}
        huidigeCapaciteit={2.1}
        huidigVermogen={0.8}
        onKies={() => {}}
        config={maakConfiguratie(LEGE_INSTELLINGEN)}
        curve={result.curve}
      />,
    );
    expect(document.body.textContent).toMatch(/wordt doorgerekend/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("toont elk vakje van het raster met zijn bedrag als getal, en kent elke maat zijn prijs", () => {
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
    const config = maakConfiguratie(LEGE_INSTELLINGEN);
    render(
      <BatterijMaat
        grid={grid}
        huidigeCapaciteit={5}
        huidigVermogen={2.5}
        onKies={() => {}}
        config={config}
        curve={result.curve}
        jaar={2025}
      />,
    );
    // Kleur mag nooit de enige drager zijn: elk vakje toont zijn getal.
    // Standaard is dat het netto resultaat over de looptijd, met teken.
    const tabel = screen.getByRole("table");
    const cellen = () => [...tabel.querySelectorAll(".heat-cel")].map((el) => el.textContent ?? "");
    expect(cellen()).toHaveLength(4);
    for (const c of cellen()) expect(c, `"${c}"`).toMatch(/^[+−]\d{1,3}(\.\d{3})*$/);

    // Elke cel kent zijn investering uit de kostenregel; die staat in het label
    // en in de kaart bij aanwijzen.
    const eigen = within(tabel).getByRole("button", { name: /^5 kWh bij 2.5 kW/ });
    expect(eigen.getAttribute("aria-label")).toMatch(/investering €\s?1\.461/);
    fireEvent.mouseEnter(eigen, { clientX: 10, clientY: 10 });
    expect(document.body.textContent).toMatch(/Investering/);
    expect(document.body.textContent).toMatch(/Terugverdientijd/);

    // De adviesregel zegt welk type batterij past.
    expect(document.body.textContent).toMatch(/stekkerbatterij|eigen groep/);

    // De streep tussen stekker en eigen groep: één per rij, plus de kop.
    expect(tabel.querySelectorAll("td.heat-scheiding")).toHaveLength(2);
    expect(tabel.querySelectorAll("th.heat-scheiding")).toHaveLength(1);

    // Omschakelen naar de besparing geeft de kale jaarbesparing.
    fireEvent.click(screen.getByRole("button", { name: "Besparing per jaar" }));
    for (const totaal of ["40", "45", "70", "95"]) {
      expect(within(tabel).getByText(totaal)).toBeDefined();
    }

    // En de terugverdientijd in jaren met één decimaal, of een streepje.
    fireEvent.click(screen.getByRole("button", { name: "Terugverdientijd" }));
    for (const c of cellen()) expect(c, `"${c}"`).toMatch(/^(\d+,\d|—)$/);
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
    render(<Statistieken stats={result.stats} opwekBekend={false} geschatteOpwek={2800} />);
    const tekst = document.body.textContent ?? "";
    // Het verschil is het verhaal: "van X naar Y" zegt wat een batterij doet,
    // een kaal eindgetal niet.
    expect(tekst).toMatch(/Van het net/);
    expect(tekst).toMatch(/Naar het net/);
    expect(tekst).toMatch(/Laadbeurten/);
    expect(tekst).toMatch(/per dag/);
    expect(screen.getAllByLabelText("wordt").length).toBeGreaterThanOrEqual(2);
  });

  it("noemt het afgeregelde deel apart bij Naar het net", () => {
    const stats = { ...result.stats, curtailedBaselineKwh: 607, curtailedBatteryKwh: 510 };
    render(<Statistieken stats={stats} opwekBekend={false} geschatteOpwek={2800} />);
    const tegel = screen.getByText("Naar het net").closest(".stat")!;
    expect(tegel.textContent).toMatch(/Afgeregeld bij negatieve prijzen: 607 kWh → 510 kWh/);
  });

  it("laat de afregelregel weg als er niets is afgeregeld", () => {
    const stats = { ...result.stats, curtailedBaselineKwh: 0, curtailedBatteryKwh: 0 };
    render(<Statistieken stats={stats} opwekBekend={false} geschatteOpwek={2800} />);
    const tegel = screen.getByText("Naar het net").closest(".stat")!;
    expect(tegel.textContent).not.toMatch(/Afgeregeld/);
  });

  it("zegt erbij dat eigen verbruik en onafhankelijkheid op een schatting rusten", () => {
    render(<Statistieken stats={result.stats} opwekBekend={false} geschatteOpwek={2800} />);
    const tekst = document.body.textContent ?? "";
    // De twee percentages vragen de bruto opwek, en die staat niet op je
    // jaarafrekening. Ze worden wél getoond — ze zijn het interessantst — maar
    // nooit zonder erbij te zeggen waar het vertrekpunt vandaan komt.
    expect(tekst).toMatch(/rusten op een schatting/);
    expect(tekst).toMatch(/30%/);
    expect(tekst).toMatch(/2\.800 kWh/);
    expect(tekst).toMatch(/je echte jaaropwek in/);
  });

  it("toont eigen verbruik, onafhankelijkheid en piekuren als percentage met hun verandering", () => {
    const metOpwek = {
      ...result.stats,
      selfConsumptionBaseline: 0.3,
      selfConsumptionBattery: 0.62,
      selfSufficiencyBaseline: 0.256,
      selfSufficiencyBattery: 0.35,
    };
    render(<Statistieken stats={metOpwek} opwekBekend geschatteOpwek={2877} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Eigen verbruik/);
    expect(tekst).toMatch(/Onafhankelijk van het net/);
    expect(tekst).toMatch(/Afname in de piekuren/);
    // Het verschil staat erbij, in procentpunten — niet als percentage van een
    // percentage, want dat getal klopt wel en zegt niets.
    expect(tekst).toMatch(/\+32 procentpunt/);
    expect(tekst).toMatch(/\+9,4 procentpunt/);
    expect(tekst).not.toMatch(/rusten op een schatting/);
  });

  it("zegt zonder zonnepanelen niets over zelfvoorziening, en noemt een toename een toename", () => {
    /**
     * Zonder panelen stond er "Onafhankelijk van het net 0% → −3%", "2.500 →
     * 2.586 kWh, -3% minder" en "0 → 10 kWh, 0% minder": een batterij die van
     * het net laadt, neemt met zijn omzettingsverlies iets méér af, en er is
     * geen eigen opwek om zelf te dekken.
     */
    const zonder = metZelfvoorziening(
      {
        ...result.stats,
        gridImportBaselineKwh: 2500,
        gridImportBatteryKwh: 2586,
        gridExportBaselineKwh: 0,
        gridExportBatteryKwh: 10,
        curtailedBaselineKwh: 0,
        curtailedBatteryKwh: 0,
      },
      0,
    );
    expect(zonder.selfSufficiencyBaseline).toBeNull();
    expect(zonder.selfConsumptionBaseline).toBeNull();
    render(<Statistieken stats={zonder} opwekBekend={false} geschatteOpwek={0} zonnepanelen={false} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).not.toMatch(/Onafhankelijk van het net/);
    expect(tekst).not.toMatch(/Eigen verbruik/);
    expect(tekst).not.toMatch(/Naar het net/);
    expect(tekst).not.toMatch(/rusten op een schatting/);
    expect(tekst).toMatch(/3% meer/);
    expect(tekst).not.toMatch(/-\d+% minder/);
    expect(meerMinder(2500, 2586)).toBe("3% meer");
    expect(meerMinder(2500, 2000)).toBe("20% minder");
    expect(meerMinder(0, 10)).toBeNull();
  });

  it("drukt de afname in de piekuren uit als aandeel, zonder en met batterij en onder het nettarief", () => {
    const scenarioStats = {
      ...result.stats,
      peakHourImportBatteryKwh: result.stats.peakHourImportBatteryKwh * 0.5,
    };
    render(<Statistieken stats={result.stats} scenarioStats={scenarioStats} opwekBekend={false} geschatteOpwek={2800} />);
    const tegel = screen.getByText("Afname in de piekuren").closest(".stat")!;
    const tekst = tegel.textContent ?? "";
    // Drie percentages: zonder batterij, met batterij, en onder het scenario.
    expect(tekst.match(/\d+%/g)?.length).toBeGreaterThanOrEqual(3);
    expect(tekst).toMatch(/Met het nettarief van 2029/);
    // Zonder batterij valt een groter deel in de piek dan met.
    const basis = result.stats.peakHourImportBaselineKwh / result.stats.gridImportBaselineKwh;
    const met = result.stats.peakHourImportBatteryKwh / result.stats.gridImportBatteryKwh;
    expect(basis).toBeGreaterThan(0);
    expect(met).toBeLessThan(basis);
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
  it("noemt beide omzettingsposten met kilowatturen en een bedrag", () => {
    render(<Verliezen losses={result.losses} afnameKwh={2500} besparingEur={result.averageSavingEur} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Verlies bij het laden/);
    expect(tekst).toMatch(/Verlies bij het ontladen/);
    expect(tekst).toMatch(/Samen verloren/);
    // Het sluipverbruik hoort hier niet meer bij: het zit niet in het model,
    // want het loopt door of de batterij nu handelt of niet.
    expect(tekst).not.toMatch(/Stroom voor de batterij zelf/);
    expect(tekst).toMatch(/kWh/);
    expect(tekst).toMatch(/€/);
    // Geen Engelse decimaalpunt in getallen.
    expect(tekst).not.toMatch(/\d\.\d{1,2} kWh/);
  });

  it("toont in de kop een conclusie die bij de cijfers past", () => {
    render(<Verliezen losses={result.losses} afnameKwh={2500} besparingEur={result.averageSavingEur} />);
    const kop = screen.getByRole("heading", { level: 3 }).textContent ?? "";
    expect(kop).toMatch(/komt er \d+ weer uit/);
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
      cumulatiefBasisEur: leeg(),
      cumulatiefBatterijEur: leeg(),
      usableCapacityKwh: 5,
      stats: {
        baselineCostEur: 1.2, batteryCostEur: 0.6, savingEur: 0.6,
        optimalSavingEur: 0.7, gridImportBaselineKwh: 4, gridImportBatteryKwh: 2,
        gridExportBaselineKwh: 6, gridExportBatteryKwh: 3, chargedKwh: 3,
        deliveredKwh: 2.6, chargedFromSolarKwh: 2.5, chargedFromGridKwh: 0.5,
        cycles: 0.6, socMaxKwh: 4.2, socStartKwh: 0, socEndKwh: 0.4,
        curtailedKwh: 0, wearCostEur: 0.05, priceMinEurPerKwh: 0.12, priceMaxEurPerKwh: 0.34,
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
    let cb = 0;
    let cm = 0;
    for (let i = 0; i < n; i++) {
      dag.netKwh[i] = dag.residualKwh[i]! + dag.chargeKwh[i]! - dag.dischargeKwh[i]!;
      const r = dag.residualKwh[i]!;
      const m = dag.netKwh[i]!;
      cb += r > 0 ? r * dag.importPrice[i]! : r * dag.exportPrice[i]!;
      cm += m > 0 ? m * dag.importPrice[i]! : m * dag.exportPrice[i]!;
      dag.cumulatiefBasisEur[i] = cb;
      dag.cumulatiefBatterijEur[i] = cm;
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

describe("het geldpaneel sluit aan op de dagcijfers", () => {
  /**
   * De cumulatieve lijnen zijn een tweede weg naar dezelfde getallen: het einde
   * van de lijn moet exact de dagkosten zijn die in de tegels staan. Lopen ze
   * uiteen, dan rekent de grafiek anders dan de cijfers erboven en klopt een van
   * de twee niet — precies het soort verschil dat niemand opmerkt omdat beide op
   * zichzelf plausibel ogen.
   */
  it("eindigt op precies de dagkosten uit de kerncijfers", () => {
    for (const dag of result.sampleDays) {
      const n = dag.startMs.length;
      expect(dag.cumulatiefBasisEur.length).toBe(n);
      expect(dag.cumulatiefBatterijEur.length).toBe(n);
      expect(dag.cumulatiefBasisEur[n - 1]).toBeCloseTo(dag.stats.baselineCostEur, 9);
      expect(dag.cumulatiefBatterijEur[n - 1]).toBeCloseTo(dag.stats.batteryCostEur, 9);
      // En het gat aan het eind is de dagbesparing.
      expect(
        dag.cumulatiefBasisEur[n - 1]! - dag.cumulatiefBatterijEur[n - 1]!,
      ).toBeCloseTo(dag.stats.savingEur, 9);
    }
  });

  it("begint bij nul en loopt monotoon op zolang er alleen afname is", () => {
    // De reeks is cumulatief, dus hij mag alleen dalen op momenten dat er geld
    // binnenkomt: teruglevering tegen een positieve prijs.
    for (const dag of result.sampleDays) {
      const eerste = dag.cumulatiefBasisEur[0]!;
      expect(Math.abs(eerste)).toBeLessThan(1);
      for (let i = 1; i < dag.startMs.length; i++) {
        const stap = dag.cumulatiefBasisEur[i]! - dag.cumulatiefBasisEur[i - 1]!;
        if (dag.residualKwh[i]! > 0) expect(stap).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});

describe("het nettarief van 2029", () => {
  it("zet winter en zomer in twee panelen, met het bedrag in elk blok", () => {
    const { container } = render(<Tariefblad markeerPiek />);
    const tekst = document.body.textContent ?? "";
    // Twee panelen, elk met hun eigen kop: niet samengeperst in één beeld.
    expect(tekst).toMatch(/Winter · oktober tot en met maart/);
    expect(tekst).toMatch(/Zomer · april tot en met september/);
    // De prijs staat als getal in het blok, niet alleen als kleur.
    expect(tekst).toMatch(/17,8 ct/);
    expect(tekst).toMatch(/0 ct/);
    expect(tekst).toMatch(/piek/);
    expect(tekst).toMatch(/gratis/);
    // Waar je vandaan komt: nul per kilowattuur, als nulpunt van de as.
    expect(tekst).toMatch(/nu 0/);
    expect(tekst).toMatch(/vast bedrag per jaar/);
    // Vijf of zes blokken per seizoen, niet vierentwintig staafjes.
    const vlakken = [...container.querySelectorAll("rect")].filter(
      (r) => r.getAttribute("fill")?.startsWith("var(--seq"),
    );
    expect(vlakken.length).toBeLessThanOrEqual(12);
    expect(vlakken.length).toBeGreaterThanOrEqual(10);
  });

  it("legt uit dat je van een vast bedrag naar volume en moment gaat", () => {
    render(
      <Nettarief huidig={result} scenario={result} overgang={null} />,
    );
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/vast bedrag per jaar/);
    expect(tekst).toMatch(/per kilowattuur/);
    expect(tekst).toMatch(/het moment/);
    // De verantwoording staat uitgeklapt, niet in de lopende tekst.
    const uitklap = document.querySelectorAll("details.voetnoot-uitklap");
    expect(uitklap.length).toBe(1);
    // Geen wat-als over een heffing op teruglevering: die bestaat niet, en het
    // voorstel beprijst uitsluitend afname.
    expect(tekst).not.toMatch(/ook op teruglevering/);
  });
});

describe("labels blijven binnen de grafiek", () => {
  /**
   * Het bedrag boven de hoogste staaf van het maandverloop viel buiten de
   * viewBox en werd door de browser afgeknipt: precies het getal waar de
   * grafiek om draait. Deze test kijkt niet naar de marge maar naar het
   * gevolg — geen enkele tekst mag buiten het kader vallen.
   */
  function kader(svg: SVGSVGElement) {
    const [, , breedte, hoogte] = (svg.getAttribute("viewBox") ?? "")
      .split(" ")
      .map(Number);
    return { breedte: breedte!, hoogte: hoogte! };
  }

  it("houdt elk bedrag in het maandverloop binnen de viewBox", () => {
    const { container } = render(<MaandVerloop maanden={result.perMonth} />);
    const svg = container.querySelector("svg")!;
    const { breedte, hoogte } = kader(svg as SVGSVGElement);
    const teksten = [...svg.querySelectorAll("text")];
    expect(teksten.length).toBeGreaterThan(12);
    for (const t of teksten) {
      const y = Number(t.getAttribute("y"));
      const x = Number(t.getAttribute("x"));
      // Een regel van ruim 11px hoog: de bovenkant ligt zo'n 12 boven de baseline.
      expect(y - 12, `"${t.textContent}" steekt boven de grafiek uit`).toBeGreaterThanOrEqual(0);
      expect(y, `"${t.textContent}" valt onder de grafiek`).toBeLessThanOrEqual(hoogte);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(breedte);
    }
  });

  it("houdt de waterval van de uitsplitsing binnen de viewBox", () => {
    const { container } = render(
      <Uitsplitsing breakdown={result.breakdown} periodeLabel="2025" />,
    );
    const svg = container.querySelector("svg")!;
    const { hoogte } = kader(svg as SVGSVGElement);
    for (const t of svg.querySelectorAll("text")) {
      const y = Number(t.getAttribute("y"));
      expect(y - 12).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(hoogte);
    }
    for (const r of svg.querySelectorAll("rect")) {
      const y = Number(r.getAttribute("y"));
      const h = Number(r.getAttribute("height"));
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + h).toBeLessThanOrEqual(hoogte + 0.001);
    }
  });
});

describe("de profielverschuiving", () => {
  it("tekent beide seizoenen met hun uren en een legenda", () => {
    render(<Verschuiving profielen={result.seasonProfiles} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Winter — oktober tot en met maart/);
    expect(tekst).toMatch(/Zomer — april tot en met september/);
    expect(tekst).toMatch(/de batterij levert/);
    // De grijze vorm heet bij naam wat hij is, niet "je profiel".
    expect(tekst).toMatch(/zonder batterij: wat er door de meter ging/);
    // En wat het net eraan heeft, staat als piek voor en na.
    expect(tekst).toMatch(/piek van het net/);
    expect(tekst).toMatch(/piek naar het net/);
  });

  it("verdwijnt als er geen profiel is", () => {
    const { container } = render(<Verschuiving profielen={[]} />);
    expect(container.textContent).toBe("");
  });

  it("telt op tot de jaarafname en jaarteruglevering", () => {
    /**
     * Het seizoensprofiel is een tweede weg naar getallen die elders al staan.
     * Loopt de som van de uren uit de pas met de jaarcijfers, dan telt een van
     * de twee verkeerd — en dat is aan de vorm van de grafiek niet te zien.
     */
    const perDagSom = (kies: (p: (typeof result.seasonProfiles)[number]) => number[]) =>
      result.seasonProfiles.reduce(
        (a, p) => a + kies(p).reduce((x, y) => x + y, 0) * p.days,
        0,
      );
    const jaren = result.perYear.filter((j) => j.isFullYear).length || 1;
    expect(perDagSom((p) => p.importBaseline) / jaren).toBeCloseTo(
      result.stats.gridImportBaselineKwh,
      0,
    );
    expect(perDagSom((p) => p.exportBattery) / jaren).toBeCloseTo(
      result.stats.gridExportBatteryKwh,
      0,
    );
  });

  it("zet de zomer- en wintergrens op dezelfde maanden als het nettarief", () => {
    // Zomer is april tot en met september: 183 dagen per jaar, winter 182 of 183.
    const jaren = result.perYear.filter((j) => j.isFullYear).length || 1;
    const zomer = result.seasonProfiles.find((p) => p.season === "zomer")!;
    expect(zomer.days / jaren).toBeGreaterThan(180);
    expect(zomer.days / jaren).toBeLessThan(186);
  });
});

describe("het maandverloop", () => {
  it("toont elke maand met zijn bedrag, en scheidt zomer van winter", () => {
    render(<MaandVerloop maanden={result.perMonth} />);
    const tekst = document.body.textContent ?? "";
    for (const m of ["jan", "apr", "jul", "okt", "dec"]) {
      expect(tekst).toContain(m);
    }
    expect(tekst).toMatch(/Zomer, april tot oktober/);
    expect(tekst).toMatch(/Winter, oktober tot april/);
    expect(tekst).toMatch(/Beste maand/);
  });

  it("telt op tot de jaarbesparing", () => {
    /**
     * Het maandverloop is een tweede weg naar hetzelfde getal. Loopt de som van
     * de maanden uit de pas met de jaarbesparing, dan rekent een van de twee
     * verkeerd — en dat is aan geen van beide te zien.
     */
    const som = result.perMonth.reduce((a, m) => a + m.savingEur, 0);
    expect(som).toBeCloseTo(result.averageSavingEur, 6);
  });

  it("dekt twaalf maanden bij een volledig jaar", () => {
    expect(result.perMonth.length).toBe(12);
    expect(result.perMonth.map((m) => m.month)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
  });
});

describe("de pagina vertelt het verhaal in vier delen, in die volgorde", () => {
  /**
   * De paginacomponent draait op workers en is hier niet te renderen; de
   * volgorde staat wél letterlijk in de bron. Dat is voldoende om te bewaken
   * dat niemand een sectie terugzet waar hij niet hoort — het antwoord voorop,
   * dan waarom, dan wanneer van grof naar fijn, dan de wat-als-vragen, en pas
   * daarna de instellingen.
   */
  it("zet de tabbladen en de secties in de bedoelde volgorde", () => {
    const bron = readFileSync("app/page.tsx", "utf8");
    const volgorde = [
      '<Paneel id="start"',
      "<Invoer",
      "<Antwoord",
      "<Statistieken",
      "<Geavanceerd",
      "<Bewaren",
      '<Paneel id="waarom"',
      "<Prijskloof",
      "<Uitsplitsing",
      "<Verliezen",
      '<Paneel id="wanneer"',
      "<BesparingPerJaar",
      "<MaandVerloop",
      "<Verschuiving",
      "<Dagprofiel",
      '<Paneel id="wat-als"',
      "<Nettarief",
      "<Doelvergelijking",
      "<BatterijMaat",
      "<Cashflow",
      '<Paneel id="methode"',
      "<Verantwoording",
      "Wat we niet weten",
    ];
    let vanaf = 0;
    for (const stuk of volgorde) {
      const plek = bron.indexOf(stuk, vanaf);
      expect(plek, `"${stuk}" staat niet (op zijn plaats) in app/page.tsx`).toBeGreaterThan(-1);
      vanaf = plek + stuk.length;
    }
  });

  it("laat het nettarief-antwoord in het antwoordblok zien zodra het er is", () => {
    const overgang = overgangsFinance(
      result,
      result,
      maakConfiguratie(LEGE_INSTELLINGEN),
    );
    render(
      <Antwoord
        result={result}
        scenario={result}
        overgang={overgang}
        investeringEur={819}
        bezig={false}
      />,
    );
    const tekst = document.body.textContent ?? "";
    // Het nettarief is een voorstel, geen feit.
    expect(tekst).toMatch(/Als het voorstel van de ACM doorgaat/);
    expect(tekst).toMatch(/mogelijk later/);
    // Eén vetgedrukt hoofdgetal: de terugverdientijd mét de overgang. Die van
    // een ongewijzigd tarief staat erachter als vergelijking.
    const vet = [...document.querySelectorAll(".antwoord-zin strong")].map((el) => el.textContent);
    expect(vet).toEqual([
      overgang.finance.paybackYears === null
        ? "niet terugverdiend"
        : expect.stringMatching(/^terugverdiend na /),
    ]);
    expect(tekst).toMatch(/gaat het voorstel voor het\s+nieuwe nettarief door/);
    expect(tekst).toMatch(/Blijft\s+het nettarief zoals nu/);
    expect(tekst).toMatch(new RegExp(`eerst\\s+${overgang.jarenOpHuidigTarief} jaar\\s+met\\s+het huidige nettarief`));
    // De overgang volgt uit Overgang.start (1 januari 2027) en twee jaar op
    // het huidige tarief, niet uit een eigen rekensom in de component.
    expect(overgang.start).toBe("2027-01-01");
    expect(overgang.jarenOpHuidigTarief).toBe(2);
    expect(tekst).toMatch(/rekent vanaf 1 januari 2027 eerst 2 jaar\s+met\s+het huidige nettarief/);
    // De standaard rekent met de heffing van nu, en dat staat er.
    expect(STANDAARD.heffing).toBe("nu");
    expect(tekst).toMatch(/belasting en\s+opslag van nu/);

    // Zolang het scenario nog loopt staat er een plaatshouder, geen lege regel.
    cleanup();
    render(<Antwoord result={result} scenario={null} overgang={null} investeringEur={819} bezig={false} />);
    expect(document.body.textContent).toMatch(/wordt doorgerekend/);

    // Mislukt het scenario, dan zegt Start dat, in plaats van eeuwig te wachten.
    cleanup();
    render(
      <Antwoord result={result} scenario={null} overgang={null} investeringEur={819} bezig={false} scenarioFout="kapot" />,
    );
    expect(document.body.textContent).not.toMatch(/wordt doorgerekend/);
    expect(document.body.textContent).toMatch(/lukte niet door te rekenen/);
  });
});

describe("het batterijraster is leesbaar", () => {
  const grid = {
    capacities: [1, 2],
    powers: [0.8, 2.5],
    klaar: true,
    bezig: false,
    rows: [
      [
        { capacityKwh: 1, powerKw: 0.8, savingEur: 47.4, cyclesPerYear: 406 },
        { capacityKwh: 1, powerKw: 2.5, savingEur: 46.6, cyclesPerYear: 407 },
      ],
      [
        { capacityKwh: 2, powerKw: 0.8, savingEur: 104.4, cyclesPerYear: 359 },
        { capacityKwh: 2, powerKw: 2.5, savingEur: 103.3, cyclesPerYear: 366 },
      ],
    ],
  };

  /** Een Zendure als anker: 1,92 kWh bij 0,8 kW voor 699 euro. */
  const config = maakConfiguratie({ ...LEGE_INSTELLINGEN, presetId: "zendure-800pro2" });

  function toon() {
    return render(
      <BatterijMaat
        grid={grid}
        huidigeCapaciteit={1}
        huidigVermogen={0.8}
        onKies={() => {}}
        config={config}
        curve={result.curve}
      />,
    );
  }

  it("markeert de cel met het hoogste netto resultaat, en maar één", () => {
    const { container } = toon();
    const beste = container.querySelectorAll(".heat-cel.beste");
    expect(beste.length).toBe(1);
    // 2 kWh bij 0,8 kW: de dubbele besparing voor 320 euro meer, en geen
    // installateur. De vaste kolom kost 300 euro extra voor minder besparing.
    expect(beste[0]!.getAttribute("aria-label")).toMatch(/^2 kWh bij 0.8 kW/);
    expect(beste[0]!.getAttribute("aria-label")).toMatch(/het hoogste netto resultaat in dit raster/);
  });

  it("geeft elk vakje dezelfde vorm, zodat de kolommen uitlijnen", () => {
    const { container } = toon();
    const cellen = [...container.querySelectorAll("table .heat-cel")].map(
      (el) => el.textContent ?? "",
    );
    // Netto met teken en duizendtallen: "+1.234" naast "−321".
    for (const c of cellen) expect(c, `"${c}"`).toMatch(/^[+−]\d{1,3}(\.\d{3})*$/);
  });

  it("noemt een stekkerbatterij als hoogste uitkomst als de eigen groep zich niet terugverdient", () => {
    toon();
    // Geen "Advies:": het is de hoogste uitkomst in deze doorrekening, met de
    // grondslag erbij.
    expect(document.body.textContent).not.toMatch(/Advies/);
    expect(document.body.textContent).toMatch(/Hoogste uitkomst in deze doorrekening \(uurprijzen van .*\): een\s+stekkerbatterij van 2 kWh bij 0,8 kW/);
    expect(document.body.textContent).toMatch(/loont hier niet/);
  });

  it("legt uit waarom meer vermogen soms minder oplevert", () => {
    /**
     * Op rij 1 kWh zakt de besparing van 47,4 naar 46,6 als het vermogen
     * omhooggaat. Dat ziet eruit als een rekenfout en is het niet: de strategie
     * plant op een verwachting, en met meer vermogen kan ze ook harder de
     * verkeerde kant op. Dat hoort erbij te staan waar je het ziet — bij de
     * besparing, want bij netto resultaat is een dip naar rechts gewoon de prijs.
     */
    toon();
    expect(document.body.textContent).not.toMatch(/geen rekenfout/);
    fireEvent.click(screen.getByRole("button", { name: "Besparing per jaar" }));
    expect(document.body.textContent).toMatch(/méér vermogen iets mínder/);
    expect(document.body.textContent).toMatch(/geen rekenfout/);
  });
});

describe("de lijnlabels volgen het aangewezen moment", () => {
  /**
   * Er stonden twee verschillende getallen voor dezelfde reeks op het scherm:
   * de uitleesregel onderaan zei "13:00, afname 22,5 ct" terwijl het label bij
   * de lijn 32,2 ct bleef tonen — de eindstand van de dag. Wat de prijs op het
   * aangewezen moment was, stond dus nergens bij de lijn zelf.
   */
  function prijslabels(container: HTMLElement): string[] {
    const namen = [...container.querySelectorAll("text.lijn-label")];
    return namen
      .filter((el) => /je betaalt|je krijgt/.test(el.textContent ?? ""))
      .map((el) => el.nextElementSibling?.textContent ?? "");
  }

  it("toont zonder aanwijzen de stand aan het einde van de dag", () => {
    const dag = result.sampleDays[0]!;
    const { container } = render(
      <Dagprofiel
        voorbeelden={[dag]}
        losseDag={null}
        ontbreekt={null}
        eersteDag="2025-01-01"
        laatsteDag="2025-12-31"
        onVraagDag={() => {}}
        onWisDag={() => {}}
      />,
    );
    const labels = prijslabels(container);
    expect(labels.length).toBe(2);
    // Het laatste kwartier van de dag, in centen met één decimaal.
    const laatsteAfname = dag.importPrice[dag.importPrice.length - 1]!;
    expect(labels[0]).toContain((laatsteAfname * 100).toFixed(1).replace(".", ","));
  });

  it("springt naar het aangewezen kwartier zodra je de grafiek aanwijst", () => {
    const dag = result.sampleDays[0]!;
    const { container } = render(
      <Dagprofiel
        voorbeelden={[dag]}
        losseDag={null}
        ontbreekt={null}
        eersteDag="2025-01-01"
        laatsteDag="2025-12-31"
        onVraagDag={() => {}}
        onWisDag={() => {}}
      />,
    );
    const svg = container.querySelector("svg")!;
    // De grafiek luistert op de svg; een muisbeweging op een kwart van de breedte
    // zet de cursor ergens in de ochtend.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 860, height: 900, right: 860, bottom: 900, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.mouseMove(svg, { clientX: 300, clientY: 100 });

    const labels = prijslabels(container);
    const laatsteAfname = (dag.importPrice[dag.importPrice.length - 1]! * 100)
      .toFixed(1)
      .replace(".", ",");
    // Het label hoort nu een ander kwartier te tonen dan het einde van de dag.
    // Zijn ze toevallig gelijk, dan zegt deze test niets; dat controleren we.
    const ochtend = dag.importPrice[Math.round((300 - 84) / (628 / (dag.importPrice.length - 1)))];
    if (ochtend !== undefined && Math.abs(ochtend - dag.importPrice[dag.importPrice.length - 1]!) > 0.005) {
      expect(labels[0]).not.toContain(laatsteAfname);
    }
    expect(labels.length).toBe(2);
  });
});

describe("de figuren over dimensionering", () => {
  const config = maakConfiguratie({ ...LEGE_INSTELLINGEN, presetId: "zendure-800pro2" });

  const grid = {
    capacities: [1, 2, 3, 5, 7.5, 10, 15],
    powers: [0.8, 2.5],
    klaar: true,
    bezig: false,
    rows: [1, 2, 3, 5, 7.5, 10, 15].map((cap) =>
      [0.8, 2.5].map((kw) => ({
        capacityKwh: cap,
        powerKw: kw,
        // Een kop die na 3 kWh omslaat, zodat er een omslagpunt te vinden is.
        savingEur: 40 + cap * 26 - cap * cap * 1.6,
        cyclesPerYear: 400 - cap * 8,
      })),
    ),
  };

  function assen(svg: SVGSVGElement) {
    return [...svg.querySelectorAll("text.as-label")].map((e) => e.textContent ?? "");
  }

  it("houdt het laatste aslabel binnen het kader", () => {
    /**
     * "15 kWh" staat gecentreerd op de rechterrand van de plot. Met een marge
     * van 16 px stak het er half buiten en knipte de browser het af: precies
     * het uiteinde van de schaal, dat je nodig hebt om de lijn te lezen.
     */
    const { container } = render(<Uitbreiden grid={grid} config={config} curve={result.curve} />);
    const svg = container.querySelector("svg")!;
    const [, , breedte] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
    for (const e of svg.querySelectorAll("text")) {
      const x = Number(e.getAttribute("x"));
      const halveBreedte = ((e.textContent ?? "").length * 6.4) / 2;
      const anchor = e.getAttribute("text-anchor");
      const rechts = anchor === "middle" ? x + halveBreedte : anchor === "end" ? x : x + halveBreedte * 2;
      expect(rechts, `"${e.textContent}" valt rechts buiten het kader`).toBeLessThanOrEqual(breedte! + 0.5);
      expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it("zegt bij kaart, uitbreiding en voor wie op welke grondslag ze rekenen", () => {
    // Zonder die zin lijkt een cel op de kaart het antwoord bovenaan tegen te
    // spreken: de kaart kent de overgang naar het nettarief niet.
    const { container: u } = render(<Uitbreiden grid={grid} config={config} curve={result.curve} />);
    expect(u.textContent).toContain(RASTER_GRONDSLAG);
    cleanup();
    const { container: m } = render(
      <BatterijMaat grid={grid} huidigeCapaciteit={2} huidigVermogen={0.8} onKies={() => {}} config={config} curve={result.curve} />,
    );
    expect(m.textContent).toContain(RASTER_GRONDSLAG);
    cleanup();
    const varianten = huishoudensVarianten();
    const { container: v } = render(
      <VoorWie
        huishoudens={{
          varianten,
          punten: varianten.map((x) => ({ ...x, afnameKwh: 2500, savingEur: 50, cyclesPerYear: 300 })),
          klaar: true,
          bezig: false,
        }}
        result={result}
        config={config}
      />,
    );
    expect(v.textContent).toContain(RASTER_GRONDSLAG);
  });

  it("zet geen centen op een as die in duizendtallen loopt", () => {
    /**
     * euro() zet centen onder een tientje, wat in een zin klopt maar niet op
     * een as: het nullabel werd "€ 0,00" terwijl de rest van de schaal in hele
     * duizenden stond.
     */
    const { container } = render(<Uitbreiden grid={grid} config={config} curve={result.curve} />);
    const labels = assen(container.querySelector("svg")!);
    expect(labels.length).toBeGreaterThan(2);
    for (const l of labels) {
      expect(l, `"${l}" heeft centen op de as`).not.toMatch(/€.*,\d\d$/);
    }
  });

  it("geeft het huishouden zonder panelen een eigen plek buiten de reeks", () => {
    /**
     * Het stond als ruit op x = 0 en las daardoor als het linkeruiteinde van
     * de lijn — "met panelen, nul teruglevering". Het is een ander gemeten
     * profiel, en dat punt hoort niet op die as te staan.
     */
    const varianten = huishoudensVarianten();
    const huishoudens = {
      varianten,
      punten: varianten.map((v) => ({
        ...v,
        afnameKwh: 2500,
        savingEur: v.zonnepanelen ? 60 + v.terugleveringKwh / 60 : 38,
        cyclesPerYear: 300,
      })),
      klaar: true,
      bezig: false,
    };
    const { container } = render(
      <VoorWie huishoudens={huishoudens} result={result} config={config} />,
    );
    const svg = container.querySelector("svg")!;
    const ruit = svg.querySelector("rect[transform^='rotate(45']")!;
    const eerstePunt = [...svg.querySelectorAll("circle")].reduce(
      (min, c) => Math.min(min, Number(c.getAttribute("cx"))),
      Infinity,
    );
    expect(Number(ruit.getAttribute("x"))).toBeLessThan(eerstePunt - 20);
    expect(document.body.textContent).toMatch(/zonder\s*panelen/);
  });

  it("noemt jouw huishouden niet als derde reeks in de legenda", () => {
    // Het is geen eigen categorie maar jouw plek op de blauwe lijn; in de
    // figuur wijst het label "jij" dat al aan.
    const varianten = huishoudensVarianten();
    const huishoudens = {
      varianten,
      punten: varianten.map((v) => ({
        ...v,
        afnameKwh: 2500,
        savingEur: v.zonnepanelen ? 60 + v.terugleveringKwh / 60 : 38,
        cyclesPerYear: 300,
      })),
      klaar: true,
      bezig: false,
    };
    const { container } = render(
      <VoorWie huishoudens={huishoudens} result={result} config={config} />,
    );
    const legenda = container.querySelectorAll(".legenda li, .legenda-item");
    expect(legenda.length).toBe(2);
  });
});

describe("het nettarief toont de verandering", () => {
  it("zet de oude en de nieuwe waarde naast elkaar", () => {
    /**
     * De cijfers stonden als losse kerncijfers met de oude waarde als voetnoot
     * eronder ("448", klein "nu 361"), zodat je zelf moest uitrekenen wat het
     * nettarief doet. Waar het om gaat is de verandering, dus die hoort in de
     * hoofdregel: van → naar, met het verschil eronder.
     */
    /*
     * Het scenario moet écht van het heden verschillen, anders is elke delta
     * nul en bewijst deze test niets. Met hetzelfde object aan beide kanten
     * glipte een schalingsfout van honderd keer er ongemerkt doorheen.
     */
    const scenario = {
      ...result,
      averageSavingEur: result.averageSavingEur * 1.43,
      stats: {
        ...result.stats,
        cyclesPerYear: result.stats.cyclesPerYear * 1.24,
        // Minder afname in de piekuren: dat is waar het nieuwe tarief op stuurt.
        peakHourImportBatteryKwh: result.stats.peakHourImportBatteryKwh * 0.8,
      },
    };
    const overgang = overgangsFinance(result, scenario, maakConfiguratie(LEGE_INSTELLINGEN));
    const { container } = render(
      <Nettarief huidig={result} scenario={scenario} overgang={overgang} />,
    );
    const verlopen = container.querySelectorAll(".stat-verloop");
    expect(verlopen.length).toBe(4);
    for (const v of verlopen) {
      const van = v.querySelector(".stat-van")?.textContent ?? "";
      const naar = v.querySelector(".stat-naar")?.textContent ?? "";
      expect(van).not.toBe("");
      expect(naar).not.toBe("");
      expect(van, "van en naar tonen hetzelfde: dan valt er niets te zien").not.toBe(naar);
    }
    /*
     * En de chips moeten een verschil tonen dat kán bestaan. Hier stond ooit
     * "−573 procentpunt", omdat procentpunt() fracties verwacht en er
     * percentages in gingen: honderd keer te veel, en net genoeg een getal om
     * niet op te vallen. Twee percentages kunnen hoogstens honderd procentpunt
     * uiteenlopen.
     */
    for (const chip of container.querySelectorAll(".stat-delta")) {
      const tekst = chip.textContent ?? "";
      const m = tekst.match(/([\d.,]+)\s*procentpunt/);
      if (!m) continue;
      const waarde = Number(m[1]!.replace(/\./g, "").replace(",", "."));
      expect(waarde, `"${tekst}" kan geen verschil tussen twee percentages zijn`).toBeLessThanOrEqual(100);
    }

    // En de losse lijst met voetnoten is weg.
    expect(container.querySelector("dl.kerncijfers")).toBeNull();
  });
});

describe("de week bij het dagprofiel", () => {
  /** Een week van 168 uurvakken rond de eerste voorbeelddag. */
  function weekReeks(rondDatum: string): PeriodeReeks {
    const van = maandagVan(rondDatum);
    const vakken = [];
    for (let d = 0; d < 7; d++) {
      const dag = dagenLater(van, d);
      const [y, m, dd] = dag.split("-").map(Number) as [number, number, number];
      for (let u = 0; u < 24; u++) {
        // 's Nachts laden, 's avonds leveren: een ritme dat in de panelen te zien is.
        const laadt = u >= 2 && u < 5;
        const levert = u >= 18 && u < 21;
        vakken.push({
          sleutel: `${dag}T${String(u).padStart(2, "0")}`,
          dag,
          startMs: Date.UTC(y, m - 1, dd, u) - 2 * 3600_000,
          savingEur: levert ? 0.09 : 0,
          wearCostEur: levert ? 0.03 : 0,
          chargedKwh: laadt ? 0.6 : 0,
          deliveredKwh: levert ? 0.5 : 0,
          gridImportBaselineKwh: 0.3,
          gridImportBatteryKwh: laadt ? 0.9 : levert ? 0 : 0.3,
          gridExportBaselineKwh: u >= 11 && u < 15 ? 0.7 : 0,
          gridExportBatteryKwh: u >= 11 && u < 15 ? 0.4 : 0,
          avgImportPrice: 0.22 + (levert ? 0.14 : 0),
          avgExportPrice: 0.09 + (levert ? 0.12 : 0),
          kostenBasisEur: 0.07,
          kostenBatterijEur: levert ? -0.02 : 0.07,
          socEndKwh: laadt ? 1.7 : levert ? 0.2 : 0.9,
          kwartieren: 4,
        });
      }
    }
    return {
      resolutie: "uur" as const,
      van,
      tot: dagenLater(van, 6),
      vakken,
      totaal: {
        savingEur: 1.89,
        wearCostEur: 0.63,
        chargedKwh: 12.6,
        deliveredKwh: 10.5,
        gridImportBaselineKwh: 50.4,
        gridImportBatteryKwh: 44.1,
      },
    };
  }

  function toon(week: PeriodeReeks | null, bezig = false) {
    const vraagWeek = vi.fn();
    const r = render(
      <Dagprofiel
        voorbeelden={result.sampleDays}
        losseDag={null}
        ontbreekt={null}
        eersteDag={result.perYear[0]?.firstDay ?? ""}
        laatsteDag={result.perYear[result.perYear.length - 1]?.lastDay ?? ""}
        onVraagDag={() => {}}
        onWisDag={() => {}}
        week={week}
        weekBezig={bezig}
        onVraagWeek={vraagWeek}
      />,
    );
    return { ...r, vraagWeek };
  }

  it("staat standaard op de dag en vraagt de week alvast op, zodat de knop niets hoeft af te wachten", () => {
    /**
     * Eerst ging de week pas de deur uit als de knop om ging: een tweede
     * optelling over de jaardispatch, en wie alleen naar een dag kijkt hoefde
     * daar niet op te wachten. Dat voelde na de klik als wachten op data die er
     * al was. Nu gaat hij bij het tonen van de dag al weg, en de klik zelf
     * vraagt niets meer.
     */
    const { vraagWeek } = toon(null);
    expect(document.body.textContent).toMatch(/op een dag precies doet/);
    expect(vraagWeek).toHaveBeenCalledTimes(1);
    const [van, tot] = vraagWeek.mock.calls[0]!;
    expect(van).toBe(maandagVan(result.sampleDays[0]!.date));
    expect(tot).toBe(dagenLater(van, 6));

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(vraagWeek).toHaveBeenCalledTimes(1);
  });

  it("zegt dat hij bezig is zolang de week er nog niet is", () => {
    // Anders lijkt de knop niets te doen: de dag blijft dan gewoon staan.
    toon(null, true);
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(document.body.textContent).toMatch(/week wordt opgeteld/i);
  });

  it("tekent de week per uur, met de dagen op de as", () => {
    const { container } = toon(weekReeks(result.sampleDays[0]!.date));
    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    expect(document.body.textContent).toMatch(/in een week precies doet/);

    /*
     * Alleen de labels van het dagprofiel zelf, niet die van elke figuur op de
     * pagina. Onder het profiel hangt sinds kort het meterprofiel, met dezelfde
     * klassen `chart` en `as-label`. Deze test telde die mee en slaagde nog
     * net, omdat dat figuur zijn uren als "ma 00:00" schrijft en niet als
     * "ma 7" — één opmaakwijziging daar en deze test valt om, over iets wat hij
     * helemaal niet onderzoekt.
     */
    const profiel = container.querySelector("svg.chart")!;
    const as = [...profiel.querySelectorAll("text.as-label")].map((e) => e.textContent ?? "");
    expect(as.filter((l) => /^(ma|di|wo|do|vr|za|zo) \d+$/.test(l)).length).toBe(7);
    expect(as.some((l) => /^\d\d:00$/.test(l))).toBe(false);

    // En de weektotalen staan eronder in plaats van de dagcijfers.
    expect(document.body.textContent).toMatch(/Deze week bespaard/);
  });

  it("rekent de netto uitwisseling per uur om, niet per kwartier", () => {
    /**
     * Een kwartier van 0,25 kWh is 1 kW; een uur van 0,25 kWh is 0,25 kW. Die
     * factor stond als constante 4 in het bestand, wat klopte zolang er alleen
     * kwartieren doorheen gingen. Gaat hij mis, dan staat er viermaal te veel
     * vermogen in de uitlezing.
     */
    const { container } = toon(weekReeks(result.sampleDays[0]!.date));
    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    const svg = container.querySelector("svg.chart")!;
    fireEvent.mouseMove(svg, { clientX: 0, clientY: 0 });
    // Een uur met 0,9 kWh afname is 0,9 kW — niet 3,6 kW.
    expect(document.body.textContent).not.toMatch(/3,6 kW/);
  });
});

describe("het verloop gaat niet meer over weken", () => {
  it("biedt alleen nog maand en jaar", () => {
    // De week per uur hoort bij het dagprofiel, waar al staat wat de batterij
    // binnen een dag uitvoert.
    render(
      <Verloop
        periode={null}
        bezig={false}
        eersteDag={result.perYear[0]?.firstDay ?? ""}
        laatsteDag={result.perYear[result.perYear.length - 1]?.lastDay ?? ""}
        onVraag={() => {}}
        onKiesDag={() => {}}
      />,
    );
    const groep = screen.getByRole("group", { name: "Periode" });
    const knoppen = [...groep.querySelectorAll("button")].map((b) => b.textContent);
    expect(knoppen).toEqual(["Maand", "Jaar"]);
  });
});

describe("het wachtscherm", () => {
  /**
   * Tijdens het rekenen dimde alleen het antwoordblok en stond "Bezig met
   * rekenen…" op een knop op het eerste tabblad. Wie op een ander tabblad
   * stond, zag niets gebeuren. Nu staat er één kaart bovenaan met de echte
   * stappen uit de pool, en daarna een balk zolang de invoer is gewijzigd.
   */
  const voortgang = {
    vensters: { klaar: 2, totaal: 4 },
    curve: { klaar: 1, totaal: 2 },
    perfect: false,
    samenvoegen: false,
    deel: 0.45,
    gestart: Date.now() - 3000,
  };

  it("toont tijdens het rekenen de stappen met hun stand en een voortgangsbalk", () => {
    render(<Wachtscherm voortgang={voortgang} bezig verouderd={false} eersteKeer={false} onBereken={() => {}} />);
    expect(document.body.textContent).toMatch(/opnieuw berekend/);
    expect(document.body.textContent).toMatch(/2 van 4/);
    expect(document.body.textContent).toMatch(/1 van 2/);
    const balk = screen.getByRole("progressbar");
    expect(balk.getAttribute("aria-valuenow")).toBe("45");
    // De lopende stap is de eerste die nog niet klaar is: de profieljaren.
    const stappen = [...document.querySelectorAll(".wacht-stappen li")];
    expect(stappen[0]!.className).toBe("bezig");
    expect(stappen[3]!.className).toBe("");
  });

  it("vinkt af wat klaar is en noemt de eerste keer anders", () => {
    render(
      <Wachtscherm
        voortgang={{ ...voortgang, vensters: { klaar: 4, totaal: 4 }, curve: { klaar: 2, totaal: 2 }, perfect: true, deel: 0.9 }}
        bezig
        verouderd={false}
        eersteKeer
        onBereken={() => {}}
      />,
    );
    expect(document.body.textContent).toMatch(/Je antwoord wordt berekend/);
    const stappen = [...document.querySelectorAll(".wacht-stappen li")];
    expect(stappen.slice(0, 3).map((s) => s.className)).toEqual(["klaar", "klaar", "klaar"]);
    expect(stappen[3]!.className).toBe("bezig");
  });

  it("laat zonder stand een onbepaalde balk zien: de gegevens laden nog", () => {
    render(<Wachtscherm voortgang={null} bezig verouderd={false} eersteKeer onBereken={() => {}} />);
    expect(document.body.textContent).toMatch(/worden geladen/);
    expect(screen.getByRole("progressbar").className).toMatch(/onbepaald/);
  });

  it("zet na een gewijzigde invoer een balk met de rekenknop neer", () => {
    const opBereken = vi.fn();
    render(<Wachtscherm voortgang={null} bezig={false} verouderd eersteKeer={false} onBereken={opBereken} />);
    expect(document.body.textContent).toMatch(/Je invoer is gewijzigd/);
    fireEvent.click(screen.getByRole("button", { name: "Reken door" }));
    expect(opBereken).toHaveBeenCalledTimes(1);
  });

  it("is er niet als er niets te wachten of te rekenen valt", () => {
    const { container } = render(
      <Wachtscherm voortgang={null} bezig={false} verouderd={false} eersteKeer={false} onBereken={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("het tabblad Uitstoot", () => {
  /**
   * Een kunstmatig jaar van vier kwartieren op een zomerdag: één vuil uur met
   * afname, twee schone kwartieren met teruglevering (overschot), en de
   * batterij die de teruglevering opslaat en de afname vervangt.
   */
  function venster(ef: number[], residual: number[]): Window {
    const start = Date.UTC(2025, 5, 15, 17, 0); // 19:00 CEST
    return {
      startMs: new Float64Array(ef.map((_, i) => start + i * 900_000)),
      residualKwh: new Float64Array(residual),
      prices: { importPrice: new Float64Array(ef.length), exportPrice: new Float64Array(ef.length) },
      co2GPerKwh: new Float64Array(ef),
    };
  }
  function dispatch(imp: number[], exp: number[]): DispatchResult {
    const n = imp.length;
    return {
      gridImportKwh: new Float64Array(imp), gridExportKwh: new Float64Array(exp),
      chargeKwh: new Float64Array(n), dischargeKwh: new Float64Array(n),
      socKwh: new Float64Array(n), curtailedKwh: new Float64Array(n), totalCostEur: 0, equivalentCycles: 0,
    } as unknown as DispatchResult;
  }
  const co2 = co2Jaar(
    venster([400, 400, 60, 60], [2, 2, -1, -1]),
    dispatch([2, 2, 0, 0], [0, 0, 1, 1]),
    dispatch([0.5, 0.5, 0, 0], [0, 0, 0, 0]),
  );
  const profielen = [
    { season: "winter" as const, days: 10, importBaseline: Array(24).fill(0.3), importBattery: Array(24).fill(0.3), exportBaseline: Array(24).fill(0), exportBattery: Array(24).fill(0) },
    { season: "zomer" as const, days: 10, importBaseline: Array(24).fill(0.3).map((v, u) => (u === 19 ? 0.9 : v)), importBattery: Array(24).fill(0.3).map((v, u) => (u === 19 ? 0.2 : u === 13 ? 0.5 : v)), exportBaseline: Array(24).fill(0), exportBattery: Array(24).fill(0) },
  ];

  it("noemt de winst in kilo's en het aandeel, en zet de tegels neer", () => {
    // Zonder batterij 4 kWh op 400 g = 1,6 kg; met 1 kWh op 400 g = 0,4 kg.
    render(<Co2Antwoord co2={co2} periodeLabel="in 2025" />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/scheelt 1,2 kg CO2 per jaar/);
    expect(tekst).toMatch(/75% minder/);
    expect(tekst).toMatch(/Uitstoot van je netafname/);
    expect(tekst).toMatch(/km rijden/);
  });

  it("zegt het eerlijk als de batterij meer CO2 kost, en praat zonder panelen niet over zonnestroom", () => {
    /**
     * Zonder zonnepanelen laadt de batterij van het net, en als dat op vuile
     * uren gebeurt kost hij per saldo CO2. Dan stond er "scheelt nauwelijks",
     * een groene tegel "minder van het net" en een zin over "je eigen
     * zonnestroom". Alle drie klopten niet.
     */
    const slechter = co2Jaar(
      venster([60, 60, 400, 400], [10, 10, 10, 10]),
      dispatch([10, 10, 10, 10], [0, 0, 0, 0]),
      dispatch([15, 15, 10, 10], [0, 0, 0, 0]),
    );
    render(<Co2Antwoord co2={slechter} periodeLabel="in 2025" zonnepanelen={false} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Met deze batterij stoot je netafname 0,6 kg méér CO2 uit per jaar/);
    expect(tekst).not.toMatch(/nauwelijks/);
    expect(tekst).not.toMatch(/zonnestroom/);
    expect(tekst).toMatch(/kostte in 2025 9,2 kg CO2/);
    const tegel = screen.getByText("Van het net gehaald").closest(".stat")!;
    expect(tegel.textContent).toMatch(/10 kWh meer/);
    expect(tegel.querySelector(".stat-delta.goed")).toBeNull();
    // Het is een toerekening, en dat staat er.
    expect(tekst).toMatch(/toerekening/);
    expect(tekst).toMatch(/stuurt hier op prijs/);

    cleanup();
    render(<Co2Nederland co2={slechter} drempel={100} onDrempel={() => {}} zonnepanelen={false} />);
    const nl = document.body.textContent ?? "";
    expect(nl).toMatch(/Zonder zonnepanelen lever je niets terug/);
    expect(nl).toMatch(/méér CO2 uit per jaar/);
  });

  it("laat voor Nederland de teruglevering onder de drempel als overschot tellen", () => {
    const opDrempel = vi.fn();
    const { rerender } = render(<Co2Nederland co2={co2} drempel={100} onDrempel={opDrempel} />);
    // Teruglevering op 60 g was overschot: verdringt niets, dus NL-winst = huishoudwinst 1,2 kg.
    expect(document.body.textContent).toMatch(/Voor Nederland scheelt de batterij 1,2 kg/);
    expect(document.body.textContent).toMatch(/Overschot onder 100 g\/kWh/);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "40" } });
    expect(opDrempel).toHaveBeenCalledWith(40);
    // Met een lage drempel telde de teruglevering wél: 2 kWh × 60 g = 0,12 kg
    // ging verloren toen de batterij hem opsloeg; winst 1,08 kg.
    rerender(<Co2Nederland co2={co2} drempel={40} onDrempel={opDrempel} />);
    expect(document.body.textContent).toMatch(/scheelt de batterij 1,1 kg/);
  });

  it("tekent de maanden en de uren zonder om te vallen op een kort jaar", () => {
    // Eén maand is te weinig voor een maandgrafiek; dan blijft hij weg.
    const { container } = render(<Co2Maanden co2={co2} />);
    expect(container.textContent).toBe("");
    cleanup();
    render(<Co2Uren co2={co2} profielen={profielen} />);
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/Schoonste uur in de zomer/);
    expect(tekst).toMatch(/19:00/);
    expect(screen.getByRole("img", { name: /Emissiefactor per uur/ })).toBeDefined();
  });
});

describe("de strategiekeuzes bij de invoer", () => {
  function toon(over: Partial<React.ComponentProps<typeof Invoer>> = {}) {
    const onDoel = vi.fn();
    const onSlijtageDeel = vi.fn();
    render(
      <Invoer
        afnameKwh={2500}
        terugleveringKwh={2000}
        presetId="zendure-800pro2"
        onAfname={() => {}}
        onTeruglevering={() => {}}
        onPreset={() => {}}
        onBereken={() => {}}
        verouderd={false}
        bezig={false}
        doel="rendement"
        onDoel={onDoel}
        slijtageDeel={0.2}
        onSlijtageDeel={onSlijtageDeel}
        slijtageprijsEur={0.09}
        rondgang={0.88}
        {...over}
      />,
    );
    return { onDoel, onSlijtageDeel };
  }

  it("zet doel en slijtagestrategie als snelle keuzes bij de batterij", () => {
    const { onDoel, onSlijtageDeel } = toon();
    const doel = screen.getByRole("group", { name: "Doel van de batterij" });
    expect(within(doel).getByRole("button", { name: "Rendement" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(doel).getByRole("button", { name: "Zelfconsumptie" }));
    expect(onDoel).toHaveBeenCalledWith("zelfconsumptie");
    const slijtage = screen.getByRole("group", { name: "Slijtagestrategie" });
    expect(within(slijtage).getByRole("button", { name: "Volop" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(slijtage).getByRole("button", { name: "Zuinig" }));
    expect(onSlijtageDeel).toHaveBeenCalledWith(1);
  });

  it("legt de gekozen stand uit in centen, ook in de tooltip", () => {
    toon();
    // 20% van 9 ct is 1,8 ct; bij inkoop 20 ct en 88% rondgang is het verlies
    // 2,7 ct, dus de stroom moet later minstens 24,5 ct waard zijn.
    const hint = slijtageHint(0.2, 0.09, 0.88);
    expect(hint).toMatch(/Volop: de planner rekent 20% van de slijtageprijs van 9 ct\/kWh/);
    expect(hint).toMatch(/1,8 ct\/kWh per geleverde kWh/);
    expect(hint).toMatch(/minstens 24,5 ct\/kWh/);
    expect(document.body.textContent).toContain(hint);
    const knop = screen.getByRole("button", { name: "Zuinig" });
    expect(knop.getAttribute("title")).toMatch(/100% van de slijtageprijs \(9 ct\/kWh/);
  });

  it("zegt bij een eigen stand dat het een eigen stand is", () => {
    expect(slijtageHint(0.35, 0.09, 0.88)).toMatch(/^Eigen stand \(35%\)/);
  });
});

describe("de drie doelen naast elkaar op Wat als", () => {
  const config = maakConfiguratie(LEGE_INSTELLINGEN);

  function staat(fouten: Partial<Record<Doel, string>> = {}): VergelijkingState {
    const deel = (besparing: number, co2Winst: number): VergelijkingDeel => ({
      ...deelVan(result, result.sampleDays[0] ?? null),
      averageSavingEur: besparing,
      co2: { importBasisKg: 400, importBatKg: 400 - co2Winst },
    });
    const nu = {
      rendement: deel(result.averageSavingEur, 100),
      zelfconsumptie: fouten.zelfconsumptie ? undefined : deel(result.averageSavingEur - 18, 95),
      uitstoot: deel(result.averageSavingEur - 31, 128),
    };
    return { nu, nettarief: { ...nu }, fouten, klaar: true };
  }

  it("zet drie kaarten naast elkaar, met het gekozen doel gemarkeerd", () => {
    const gekozen: Doel[] = [];
    const { container } = render(
      <Doelvergelijking vergelijking={staat()} config={config} onKies={(d) => gekozen.push(d)} />,
    );
    const kaarten = container.querySelectorAll(".doelkaart");
    expect(kaarten).toHaveLength(3);
    const gemarkeerd = container.querySelectorAll(".doelkaart.gekozen");
    expect(gemarkeerd).toHaveLength(1);
    expect(gemarkeerd[0]!.getAttribute("data-doel")).toBe("rendement");
    expect(gemarkeerd[0]!.textContent).toMatch(/Nu gekozen/);
    // De titel is een stelling met de uitkomst.
    expect(container.querySelector("h3")!.textContent).toBe(
      "Sturen op uitstoot kost je €\u00a031 per jaar en scheelt 28 kg CO2 extra",
    );
    // Elke kaart dezelfde cijfers.
    for (const k of kaarten) {
      for (const label of ["Besparing per jaar", "CO2-winst per jaar", "Van het net", "Laadbeurten per jaar", "Terugverdientijd"]) {
        expect(k.textContent).toContain(label);
      }
    }
    // Wisselen gaat via de knop op een niet-gekozen kaart.
    fireEvent.click(screen.getByRole("button", { name: "Reken hiermee: Uitstoot" }));
    expect(gekozen).toEqual(["uitstoot"]);
    expect(within(gemarkeerd[0] as HTMLElement).queryByRole("button")).toBeNull();
    // En de voorbeelddag staat eronder, voor alle drie op dezelfde dag.
    expect(container.querySelectorAll(".doeldag-strook")).toHaveLength(3);
  });

  it("markeert het doel uit de configuratie, niet altijd rendement", () => {
    const { container } = render(
      <Doelvergelijking vergelijking={staat()} config={{ ...config, doel: "uitstoot" }} onKies={() => {}} />,
    );
    const gemarkeerd = container.querySelectorAll(".doelkaart.gekozen");
    expect(gemarkeerd).toHaveLength(1);
    expect(gemarkeerd[0]!.getAttribute("data-doel")).toBe("uitstoot");
  });

  it("toont een plaatshouder zolang er gerekend wordt, en een fout per doel", () => {
    const { container } = render(<Doelvergelijking vergelijking={null} config={config} onKies={() => {}} />);
    expect(container.querySelectorAll(".doelkaart")).toHaveLength(3);
    expect(screen.getAllByText("Wordt doorgerekend…")).toHaveLength(3);
    cleanup();
    render(
      <Doelvergelijking vergelijking={staat({ zelfconsumptie: "kapot" })} config={config} onKies={() => {}} />,
    );
    const fout = screen.getByRole("alert");
    expect(fout.textContent).toMatch(/Dit doel kon niet worden doorgerekend/);
    expect(fout.textContent).toMatch(/kapot/);
    expect(fout.closest(".doelkaart")!.getAttribute("data-doel")).toBe("zelfconsumptie");
  });
});
