/**
 * Het vooruitgerekende standaardantwoord.
 *
 * ── Waarom dit bestand bestaat ──────────────────────────────────────────────
 * De preload is een afspraak tussen twee plekken die elkaar niet kennen: de
 * build rekent een antwoord uit en zet er een sleutel bij, de browser berekent
 * diezelfde sleutel en vergelijkt. Lopen ze uit elkaar — een veld erbij in de
 * configuratie, een andere standaardbatterij, een opgehoogd modelversienummer —
 * dan matcht de sleutel niet meer en rekent iedereen weer zelf.
 *
 * Dat faalt volkomen geruisloos: de tool blijft werken, alleen weer traag. Geen
 * foutmelding, geen kapotte test. Precies het soort regressie dat maanden blijft
 * zitten. Deze test draait daarom de échte route-handler en controleert de
 * afspraak van beide kanten.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET } from "../app/voorbeeld.json/route";
import { MODEL_VERSIE, dispatchSleutel } from "../lib/cache";
import { STANDAARD, maakConfiguratie, standaardConfiguratie } from "../lib/configuratie";
import { RASTER_CAPACITEITEN, RASTER_VERMOGENS } from "../lib/model/raster";
import { huishoudensVarianten, type HuishoudenPunt } from "../lib/model/huishoudens";
import { referentieJaar, runAnalysis, type AnalysisResult } from "../lib/model/analysis";
import { doelConfiguratie, type VergelijkingDeel } from "../lib/model/vergelijking";
import { BESPARING_MET_HEFFING_TOEN, scenarioConfiguratie } from "../lib/nettarief";
import { Invoerbron } from "../lib/data/invoer";
import type { Ophaler } from "../lib/data/loader";

interface Payload {
  versie: number;
  sleutel: string;
  gemaakt: string;
  result: AnalysisResult;
  scenario: AnalysisResult;
  huishoudens?: HuishoudenPunt[];
}

/** De route draait de volledige analyse; dat kost een paar seconden. */
const payload: Payload = await (await GET()).json();

describe("het vooruitgerekende antwoord", () => {
  it("draagt de sleutel die de browser voor de standaardinvoer berekent", () => {
    // Dit is de hele afspraak. Faalt deze regel, dan is de preload dood gewicht.
    // De browser rekent met `gegenereerd` uit het manifest dat hij ophaalt.
    const manifest = JSON.parse(readFileSync("public/data/manifest.json", "utf8")) as { gegenereerd: string };
    expect(payload.sleutel).toBe(dispatchSleutel(standaardConfiguratie(), manifest.gegenereerd));
    // En een andere dataversie past er niet op: na een dataverversing rekent
    // een bezoeker zelf, tot de volgende build een nieuw antwoord meelevert.
    expect(payload.sleutel).not.toBe(dispatchSleutel(standaardConfiguratie(), "een andere versie"));
    expect(payload.versie).toBe(MODEL_VERSIE);
    // De sleutel draagt het versienummer, zodat een modelwijziging het bestand
    // vanzelf ongeldig maakt.
    expect(payload.sleutel).toContain(`v${MODEL_VERSIE}`);
  });

  it("hoort bij de batterij die een bezoeker als eerste ziet", () => {
    expect(STANDAARD.presetId).toBe("zendure-800pro2");
    expect(standaardConfiguratie().battery.capacityKwh).toBeCloseTo(1.92, 6);
  });

  it("bevat alles wat de pagina meteen wil tonen", () => {
    const r = payload.result;
    // Het antwoord boven de vouw.
    expect(r.averageSavingEur).toBeGreaterThan(0);
    expect(r.finance.paybackYears).not.toBeNull();
    // De secties eronder. Ontbreekt hier iets, dan valt de pagina om op een
    // undefined — precies waar de cacheversie eerder voor is opgehoogd.
    expect(r.perYear.length).toBeGreaterThan(1);
    expect(r.sampleDays.length).toBe(2);
    expect(r.stats).toBeDefined();
    // De piekuurstatistiek is nieuw in versie 10; zonder loopt de tegel stuk.
    expect(r.stats.peakHourImportBaselineKwh).toBeGreaterThan(0);
    expect(r.losses).toBeDefined();
    expect(r.priceGap).toBeDefined();
    expect(r.curve.length).toBeGreaterThan(1);
    expect(r.finance.cashflows.length).toBe(STANDAARD.analysejaren);
  });

  it("levert het nettariefscenario mee, want dat staat in het antwoord", () => {
    /**
     * Het scenario staat in het antwoordblok bovenaan; daarop wachten is het
     * meest zichtbaar. Het kost vier seconden bij de build en die zijn het waard.
     *
     * Het raster zit er sinds september 2026 óók in: met de generatietimeout
     * op 180 seconden passen de tweeënveertig doorrekeningen, en anders rekende
     * elke bezoeker het raster alsnog zelf. `VOORBEELD_ZONDER_RASTER=1` laat
     * het weg als een bouwmachine te traag blijkt.
     */
    expect(payload.scenario.averageSavingEur).toBeGreaterThan(
      payload.result.averageSavingEur,
    );
    expect(payload.scenario.finance.paybackYears).not.toBeNull();
    const grid = (payload as { grid?: { savingEur: number }[][] }).grid!;
    expect(grid).toHaveLength(RASTER_CAPACITEITEN.length);
    for (const rij of grid) expect(rij).toHaveLength(RASTER_VERMOGENS.length);
    // Meer capaciteit levert bij gelijk vermogen niet structureel minder op.
    for (let k = 0; k < RASTER_VERMOGENS.length; k++) {
      for (let r = 1; r < RASTER_CAPACITEITEN.length; r++) {
        expect(grid[r]![k]!.savingEur).toBeGreaterThanOrEqual(grid[r - 1]![k]!.savingEur * 0.97 - 0.01);
      }
    }
  });

  it("levert de reeks huishoudens mee, geijkt aan het hoofdresultaat", () => {
    const h = payload.huishoudens!;
    const varianten = huishoudensVarianten();
    expect(h).toHaveLength(varianten.length);
    expect(h.map((p) => [p.terugleveringKwh, p.zonnepanelen])).toEqual(
      varianten.map((v) => [v.terugleveringKwh, v.zonnepanelen]),
    );
    // Het huishouden met de eigen teruglevering is exact het referentiejaar van
    // het hoofdresultaat: dezelfde simulatie, dezelfde drempel, hetzelfde jaar.
    const eigen = h.find((p) => p.zonnepanelen && p.terugleveringKwh === STANDAARD.terugleveringKwh)!;
    expect(eigen.savingEur).toBeCloseTo(referentieJaar(payload.result).realisticSavingEur, 6);
    expect(eigen.afnameKwh).toBe(STANDAARD.afnameKwh);
    // Zonder zonnepanelen levert de batterij nog wel iets op, maar veel minder.
    const zonder = h.at(-1)!;
    expect(zonder.zonnepanelen).toBe(false);
    expect(zonder.savingEur).toBeGreaterThan(0);
    expect(zonder.savingEur).toBeLessThan(eigen.savingEur);
  });

  it("draagt de CO2-balans, met een winst voor het huishouden", () => {
    // Versie 14: zonder dit veld loopt het tabblad Uitstoot leeg.
    const c = payload.result.co2!;
    expect(c).not.toBeNull();
    expect(c.importBasisKg).toBeGreaterThan(c.importBatKg);
    expect(c.klassen.kwartieren).toHaveLength(31);
    expect(payload.scenario.co2).not.toBeNull();
  });

  it("levert de vergelijking van de doelen mee, met de sleutels die de browser zoekt", () => {
    // De twee niet-gekozen doelen, elk op de tarieven van nu en met het
    // nettarief; het gekozen doel is het antwoord en het scenario zelf.
    const v = (payload as { vergelijking?: { sleutel: string; deel: VergelijkingDeel }[] }).vergelijking!;
    const config = standaardConfiguratie();
    const verwacht = (["zelfconsumptie", "uitstoot"] as const).flatMap((d) => {
      const nu = doelConfiguratie(config, d);
      return [dispatchSleutel(nu), dispatchSleutel(scenarioConfiguratie(nu))];
    });
    expect(v.map((e) => e.sleutel)).toEqual(verwacht);
    // Op de tarieven van nu met de voorbeelddag van het antwoord; met het
    // nettarief zonder dag.
    expect(v[0]!.deel.dag!.date).toBe(payload.result.sampleDays[0]!.date);
    expect(v[1]!.deel.dag).toBeUndefined();
    expect(v[0]!.deel.averageSavingEur).toBeLessThan(payload.result.averageSavingEur);
  });

  it("overleeft de reis door JSON", () => {
    // Het bestand gaat als tekst over de lijn. Typed arrays zouden onderweg in
    // een object met genummerde sleutels veranderen; de voorbeelddagen moeten
    // dus gewone arrays zijn.
    const dag = payload.result.sampleDays[0]!;
    expect(Array.isArray(dag.residualKwh)).toBe(true);
    expect(Array.isArray(dag.socKwh)).toBe(true);
    expect(dag.residualKwh.length).toBeGreaterThan(90);
    expect(dag.stats).toBeDefined();
  });

  it("blijft klein genoeg om sneller te zijn dan zelf rekenen", () => {
    // Vier seconden rekenen vervangen door een download die net zo lang duurt,
    // is geen winst. Ruim onder een megabyte is de grens waaronder dat zeker
    // goed zit, ook op een trage verbinding.
    const bytes = JSON.stringify(payload).length;
    expect(bytes).toBeLessThan(1_000_000);
  });
});

describe("de heffing van toen", () => {
  it("levert de standaardbatterij de meerwaarde op die de pagina noemt", async () => {
    /**
     * Methode en de geavanceerde instellingen zeggen dat de besparing met de
     * heffing van toen "ongeveer 13%" hoger uitvalt. Dat is een gemeten getal
     * (BESPARING_MET_HEFFING_TOEN); verandert het model of de data, dan hoort
     * deze test dat te zien.
     */
    const vanSchijf: Ophaler = async (url) => new Response(new Uint8Array(readFileSync(`public${url}`)));
    const bron = new Invoerbron("/data", vanSchijf);
    await bron.init();
    const toen = runAnalysis(await bron.bouwInvoer(maakConfiguratie({ ...STANDAARD, heffing: "toen" })));
    const meer = toen.averageSavingEur / payload.result.averageSavingEur - 1;
    expect(Math.abs(meer - BESPARING_MET_HEFFING_TOEN)).toBeLessThan(0.01);
  }, 180000);
});
