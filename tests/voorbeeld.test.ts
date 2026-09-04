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
import { describe, expect, it } from "vitest";
import { GET } from "../app/voorbeeld.json/route";
import { MODEL_VERSIE, configSleutel } from "../lib/cache";
import { STANDAARD, standaardConfiguratie } from "../lib/configuratie";
import type { AnalysisResult } from "../lib/model/analysis";

interface Payload {
  versie: number;
  sleutel: string;
  gemaakt: string;
  result: AnalysisResult;
}

/** De route draait de volledige analyse; dat kost een paar seconden. */
const payload: Payload = await (await GET()).json();

describe("het vooruitgerekende antwoord", () => {
  it("draagt de sleutel die de browser voor de standaardinvoer berekent", () => {
    // Dit is de hele afspraak. Faalt deze regel, dan is de preload dood gewicht.
    expect(payload.sleutel).toBe(configSleutel(standaardConfiguratie()));
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
    expect(r.losses).toBeDefined();
    expect(r.priceGap).toBeDefined();
    expect(r.curve.length).toBeGreaterThan(1);
    expect(r.finance.cashflows.length).toBe(STANDAARD.analysejaren);
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
