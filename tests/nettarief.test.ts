/**
 * Het tijdsafhankelijke nettarief.
 *
 * De tabel is overgenomen uit een figuur, en een verkeerd overgenomen cel
 * verschuift de uitkomst zonder dat er iets faalt. Deze tests leggen de vorm
 * vast die uit de bron blijkt: welke niveaus voorkomen, waar de winterpiek
 * ligt, en dat de zomermiddag gratis is. Wie de tabel aanpast, moet hier langs.
 */
import { describe, expect, it } from "vitest";
import {
  BASISTARIEF,
  ENERGIEBELASTING_EXCL_BTW,
  NETTARIEF_FACTOREN,
  OPSLAG_2026_INCL_BTW,
  factorVoorMaand,
  gemiddeldNettarief,
  nettariefPerStap,
  piekurenVoorMaand,
  profielVoorMaand,
  heffingToenTekst,
  hoeveelHoger,
  scenarioConfiguratie,
  scenarioHeffing,
} from "../lib/nettarief";
import { standaardConfiguratie } from "../lib/configuratie";
import { buildQuarterAxis, LocalTimeIndex } from "../lib/data/timeaxis";
import { readFileSync } from "node:fs";
import type { Manifest } from "../lib/data/manifest";

/**
 * Figuur 4 letterlijk overgetypt uit het CE Delft-rapport, 00:00 tot 23:00.
 *
 * Dit is de test die ontbrak. De eerste versie van de tabel toetste alleen de
 * structuur — waar de piek ligt, dat de middag gratis is — en dat ging goed
 * terwijl er drie cellen fout stonden: 16:00 en 18:00 waren te duur en 23:00 te
 * goedkoop. Zulke fouten schuiven de uitkomst zonder dat een structuurtest iets
 * merkt. Een cel-voor-celvergelijking met de bron merkt het wel.
 *
 * Figuur 4 is het 2030-niveau, afgerond op hele centen: wegingsfactor maal
 * EUR 0,191. Het model rekent onafgerond, dus de vergelijking rondt af.
 */
const BRON_WINTER = [
  0.13, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.13, 0.13, 0.13, 0.10, 0.10,
  0.10, 0.10, 0.10, 0.10, 0.19, 0.19, 0.19, 0.19, 0.19, 0.19, 0.19, 0.13,
];
const BRON_ZOMER = [
  0.10, 0.10, 0.10, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.00, 0.00,
  0.00, 0.00, 0.00, 0.00, 0.00, 0.06, 0.06, 0.13, 0.13, 0.13, 0.13, 0.13,
];

/** Wegingsfactoren uit bijlage 5 lid 6 van het codewijzigingsvoorstel. */
const FACTOR_WINTER = [
  0.7, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.7, 0.7, 0.7, 0.5, 0.5,
  0.5, 0.5, 0.5, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.7,
];
const FACTOR_ZOMER = [
  0.5, 0.5, 0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.3, 0.3, 0.7, 0.7, 0.7, 0.7, 0.7,
];

const cent = (v: number) => Math.round(v * 100) / 100;

describe("de tabel komt overeen met Figuur 4", () => {
  it("geeft per maand, op centen afgerond, exact de rij uit het rapport (2030)", () => {
    for (const m of [1, 2, 3, 10, 11, 12]) {
      expect(profielVoorMaand(m, 2030).map(cent), `maand ${m}`).toEqual(BRON_WINTER);
    }
    for (const m of [4, 5, 6, 7, 8, 9]) {
      expect(profielVoorMaand(m, 2030).map(cent), `maand ${m}`).toEqual(BRON_ZOMER);
    }
  });

  it("gebruikt letterlijk de wegingsfactoren uit het voorstel", () => {
    for (const m of [1, 2, 3, 10, 11, 12]) expect([...factorVoorMaand(m)]).toEqual(FACTOR_WINTER);
    for (const m of [4, 5, 6, 7, 8, 9]) expect([...factorVoorMaand(m)]).toEqual(FACTOR_ZOMER);
    for (let m = 1; m <= 12; m++) {
      for (const f of factorVoorMaand(m)) expect(NETTARIEF_FACTOREN as readonly number[]).toContain(f);
    }
  });

  it("zet het basistarief van 2029 een stap van 7,5% onder dat van 2030", () => {
    expect(BASISTARIEF[2030]).toBeCloseTo(0.191, 6);
    expect(BASISTARIEF[2029] * 1.075).toBeCloseTo(BASISTARIEF[2030], 9);
    // Standaard is 2029: de uurwaarden zijn de factoren maal dat basistarief.
    for (let u = 0; u < 24; u++) {
      expect(profielVoorMaand(1)[u]).toBeCloseTo(FACTOR_WINTER[u]! * BASISTARIEF[2029], 9);
    }
  });
});

describe("het scenario", () => {
  it("rekent met de heffing van het scenariojaar, inclusief de opslag van nu", () => {
    // 0,075 excl. btw (CE Delft, Tabel 2) plus de inkoopopslag van 2026.
    expect(scenarioHeffing(2029)).toBeGreaterThan(0.075 * 1.21);
    expect(scenarioHeffing(2029)).toBeLessThan(0.128848);
    expect(scenarioHeffing(2030)).toBeGreaterThan(scenarioHeffing(2029));
  });

  it("rekent met de energiebelasting uit de tarieventabel", () => {
    // Belastingdienst, ML 040 (aangifte energiebelasting), eerste schijf,
    // exclusief btw.
    expect(ENERGIEBELASTING_EXCL_BTW[2023]).toBe(0.12599);
    expect(ENERGIEBELASTING_EXCL_BTW[2024]).toBe(0.1088);
    expect(ENERGIEBELASTING_EXCL_BTW[2025]).toBe(0.10154);
    expect(ENERGIEBELASTING_EXCL_BTW[2026]).toBe(0.09161);
    // Heffing 2026 in de data (12,885 ct) min 0,09161 × 1,21: 1,80 ct opslag.
    expect(OPSLAG_2026_INCL_BTW).toBeCloseTo(0.018, 5);
    expect(scenarioHeffing(2029)).toBeCloseTo(0.075 * 1.21 + 0.018, 5);
  });

  it("past bij de heffing in de prijsdata van elk volledig jaar", () => {
    // allInPrijs − marktprijs is belasting maal btw plus de inkoopopslag van
    // de leverancier; die opslag ligt tussen 0 en 5 cent. Een verkeerd
    // belastingtarief valt daar buiten.
    const m = JSON.parse(readFileSync("public/data/manifest.json", "utf8")) as Manifest;
    for (const jaar of [2023, 2024, 2025] as const) {
      const heffing = m.prijzen[String(jaar)]!.jaarconstante_eur_per_kwh;
      const opslag = heffing - ENERGIEBELASTING_EXCL_BTW[jaar] * 1.21;
      expect(opslag, String(jaar)).toBeGreaterThan(0);
      expect(opslag, String(jaar)).toBeLessThan(0.05);
    }
  });

  it("leidt overal dezelfde configuratie af", () => {
    const basis = standaardConfiguratie();
    const s = scenarioConfiguratie(basis);
    expect(s.netTariff).toBe(true);
    expect(s.netTariffOnExport).toBe(false);
    expect(s.netTariffYear).toBe(2029);
    expect(s.levyEurPerKwh).toBeCloseTo(scenarioHeffing(2029), 12);
    expect(scenarioConfiguratie(basis, { jaar: 2030, opTeruglevering: true })).toMatchObject({
      netTariffYear: 2030,
      netTariffOnExport: true,
      levyEurPerKwh: scenarioHeffing(2030),
    });
    // De basisconfiguratie blijft onaangeroerd.
    expect(basis.netTariff).toBeUndefined();
  });
});

describe("de piekuren volgen uit de tabel", () => {
  it("zijn precies de uren waarop de bronrij op haar maximum staat", () => {
    const maxW = Math.max(...BRON_WINTER);
    const maxZ = Math.max(...BRON_ZOMER);
    expect([...piekurenVoorMaand(1)]).toEqual(BRON_WINTER.map((v) => v === maxW));
    expect([...piekurenVoorMaand(7)]).toEqual(BRON_ZOMER.map((v) => v === maxZ));
  });
});

describe("de tariefstructuur", () => {
  it("heeft voor elke maand vierentwintig uren", () => {
    for (let m = 1; m <= 12; m++) {
      expect(profielVoorMaand(m).length, `maand ${m}`).toBe(24);
    }
  });

  it("kent per dag hoogstens vier tariefhoogten, en vijf in totaal", () => {
    // Zoals het voorstel het zegt: winter drie, zomer vier, samen vijf.
    const winter = new Set(factorVoorMaand(1));
    const zomer = new Set(factorVoorMaand(7));
    expect(winter.size).toBe(3);
    expect(zomer.size).toBe(4);
    expect(new Set([...winter, ...zomer]).size).toBe(5);
  });

  it("kent twee profielen: april tot en met september is zomer", () => {
    const zomer = profielVoorMaand(6);
    const winter = profielVoorMaand(12);
    for (const m of [4, 5, 6, 7, 8, 9]) expect(profielVoorMaand(m)).toEqual(zomer);
    for (const m of [1, 2, 3, 10, 11, 12]) expect(profielVoorMaand(m)).toEqual(winter);
    expect(zomer).not.toEqual(winter);
  });

  it("legt de winterpiek op 16 tot en met 22 uur", () => {
    const winter = profielVoorMaand(1, 2030).map(cent);
    for (let u = 16; u <= 22; u++) expect(winter[u], `uur ${u}`).toBe(0.19);
    // Daarbuiten nooit het piektarief; 23:00 valt terug naar 0,13.
    expect(winter[23]).toBe(0.13);
    expect(winter[15]).toBe(0.1);
    expect(Math.max(...winter.filter((_, u) => u < 16 || u > 22))).toBe(0.13);
  });

  it("maakt de zomermiddag gratis, van 10 tot en met 16 uur", () => {
    const zomer = profielVoorMaand(7, 2030).map(cent);
    // Zeven gratis uren, niet zes: het blok loopt door tot en met 16:00.
    for (let u = 10; u <= 16; u++) expect(zomer[u], `uur ${u}`).toBe(0);
    expect(zomer[9]).toBe(0.06);
    expect(zomer[17]).toBe(0.06);
    // De zomerpiek begint pas om 19:00 en is lager dan de winterpiek.
    expect(zomer[18]).toBe(0.06);
    expect(zomer[19]).toBe(0.13);
    expect(zomer[19]!).toBeLessThan(cent(profielVoorMaand(1, 2030)[19]!));
    // En loopt door tot en met 23:00, waar de winter dan al is gezakt.
    expect(zomer[23]).toBe(0.13);
    expect(cent(profielVoorMaand(1, 2030)[23]!)).toBe(0.13);
  });

  it("komt gemiddeld op een plausibel niveau uit", () => {
    // Ongewogen over het jaar: ergens tussen de laagste en de hoogste trede, en
    // in de buurt van wat een huishouden nu aan variabele netkosten kwijt is.
    for (const jaar of [2029, 2030] as const) {
      const gem = gemiddeldNettarief(jaar);
      expect(gem).toBeGreaterThan(0.05);
      expect(gem).toBeLessThan(0.13);
    }
  });
});

describe("de reeks volgt de lokale klok", () => {
  it("zet het blok op wandkloktijd, ook op de dag dat de klok verspringt", () => {
    /**
     * Een tariefblok van 16:00 tot 23:00 is wandkloktijd. In UTC verschuift die
     * grens met de zomertijd mee, dus het opzoeken moet in lokale tijd — net als
     * overal in dit model.
     */
    const as = buildQuarterAxis("2025-10-25", "2025-10-28"); // klok terug op de 26e
    const index = new LocalTimeIndex(as[0]!, as[as.length - 1]!);
    const reeks = nettariefPerStap(as, index);

    expect(reeks.length).toBe(as.length);
    for (let i = 0; i < as.length; i++) {
      const uur = index.localHour(as[i]!);
      const maand = Number(index.localDate(as[i]!).slice(5, 7));
      expect(reeks[i], `kwartier ${i}, lokaal uur ${uur}`).toBe(
        profielVoorMaand(maand)[uur],
      );
    }

    // Op 26 oktober komt lokaal uur 2 twee keer voor; beide keren hetzelfde
    // tarief, en de dag telt 100 kwartieren.
    const opDe26e = [...as].filter((ms) => index.localDate(ms) === "2025-10-26");
    expect(opDe26e.length).toBe(100);
  });

  it("wisselt van profiel op de grens tussen september en oktober", () => {
    const as = buildQuarterAxis("2025-09-29", "2025-10-03");
    const index = new LocalTimeIndex(as[0]!, as[as.length - 1]!);
    const reeks = nettariefPerStap(as, index);

    const middagIn = (datum: string) => {
      for (let i = 0; i < as.length; i++) {
        if (index.localDate(as[i]!) === datum && index.localHour(as[i]!) === 12) {
          return reeks[i]!;
        }
      }
      throw new Error(`geen middag gevonden op ${datum}`);
    };
    // 30 september is nog zomer: middag gratis. 1 oktober is winter: factor 0,5.
    expect(middagIn("2025-09-30")).toBe(0);
    expect(middagIn("2025-10-01")).toBeCloseTo(0.5 * BASISTARIEF[2029], 9);
  });
});

describe("de heffing van toen, in woorden", () => {
  it("komt uit de prijsdata, niet uit een vaste zin", () => {
    /**
     * Er stond "een kwart tot een derde hoger", terwijl de data 18,0 en 17,1
     * cent zei tegen 12,9 nu: 40 en 33% hoger. De zin volgt nu de data.
     */
    const manifest = JSON.parse(readFileSync("public/data/manifest.json", "utf8")) as Manifest;
    expect(heffingToenTekst(manifest.prijzen, [2024, 2025])).toMatch(
      /^In 2024 en 2025 lag de heffing ruim een derde hoger \(17,1 à 18 cent tegen 12,9 cent nu\)$/,
    );
    expect(heffingToenTekst(manifest.prijzen, [1999])).toBeNull();
  });

  it("kiest de dichtstbijzijnde breuk, met ruim of bijna", () => {
    expect(hoeveelHoger(0.25)).toBe("een kwart hoger");
    expect(hoeveelHoger(0.36)).toBe("ruim een derde hoger");
    expect(hoeveelHoger(0.23)).toBe("bijna een kwart hoger");
    expect(hoeveelHoger(0.02)).toBe("2% hoger");
  });
});
