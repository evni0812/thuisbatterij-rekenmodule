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
  NETTARIEF_NIVEAUS,
  gemiddeldNettarief,
  nettariefPerStap,
  profielVoorMaand,
} from "../lib/nettarief";
import { buildQuarterAxis, LocalTimeIndex } from "../lib/data/timeaxis";

/**
 * Figuur 4 letterlijk overgetypt uit het CE Delft-rapport, 00:00 tot 23:00.
 *
 * Dit is de test die ontbrak. De eerste versie van de tabel toetste alleen de
 * structuur — waar de piek ligt, dat de middag gratis is — en dat ging goed
 * terwijl er drie cellen fout stonden: 16:00 en 18:00 waren te duur en 23:00 te
 * goedkoop. Zulke fouten schuiven de uitkomst zonder dat een structuurtest iets
 * merkt. Een cel-voor-celvergelijking met de bron merkt het wel.
 */
const BRON_WINTER = [
  0.13, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.13, 0.13, 0.13, 0.10, 0.10,
  0.10, 0.10, 0.10, 0.10, 0.19, 0.19, 0.19, 0.19, 0.19, 0.19, 0.19, 0.13,
];
const BRON_ZOMER = [
  0.10, 0.10, 0.10, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.00, 0.00,
  0.00, 0.00, 0.00, 0.00, 0.00, 0.06, 0.06, 0.13, 0.13, 0.13, 0.13, 0.13,
];

describe("de tabel komt overeen met Figuur 4", () => {
  it("geeft per maand exact de rij uit het rapport", () => {
    for (const m of [1, 2, 3, 10, 11, 12]) {
      expect([...profielVoorMaand(m)], `maand ${m}`).toEqual(BRON_WINTER);
    }
    for (const m of [4, 5, 6, 7, 8, 9]) {
      expect([...profielVoorMaand(m)], `maand ${m}`).toEqual(BRON_ZOMER);
    }
  });
});

describe("de tariefstructuur", () => {
  it("heeft voor elke maand vierentwintig uren", () => {
    for (let m = 1; m <= 12; m++) {
      expect(profielVoorMaand(m).length, `maand ${m}`).toBe(24);
    }
  });

  it("gebruikt alleen de vijf niveaus uit de bron", () => {
    for (let m = 1; m <= 12; m++) {
      for (const v of profielVoorMaand(m)) {
        expect(NETTARIEF_NIVEAUS as readonly number[]).toContain(v);
      }
    }
  });

  it("kent twee profielen: april tot en met september is zomer", () => {
    const zomer = profielVoorMaand(6);
    const winter = profielVoorMaand(12);
    for (const m of [4, 5, 6, 7, 8, 9]) expect(profielVoorMaand(m)).toEqual(zomer);
    for (const m of [1, 2, 3, 10, 11, 12]) expect(profielVoorMaand(m)).toEqual(winter);
    expect(zomer).not.toEqual(winter);
  });

  it("legt de winterpiek op 16 tot en met 22 uur", () => {
    const winter = profielVoorMaand(1);
    for (let u = 16; u <= 22; u++) expect(winter[u], `uur ${u}`).toBe(0.19);
    // Daarbuiten nooit het piektarief; 23:00 valt terug naar 0,13.
    expect(winter[23]).toBe(0.13);
    expect(winter[15]).toBe(0.1);
    expect(Math.max(...winter.filter((_, u) => u < 16 || u > 22))).toBe(0.13);
  });

  it("maakt de zomermiddag gratis, van 10 tot en met 16 uur", () => {
    const zomer = profielVoorMaand(7);
    // Zeven gratis uren, niet zes: het blok loopt door tot en met 16:00.
    for (let u = 10; u <= 16; u++) expect(zomer[u], `uur ${u}`).toBe(0);
    expect(zomer[9]).toBe(0.06);
    expect(zomer[17]).toBe(0.06);
    // De zomerpiek begint pas om 19:00 en is lager dan de winterpiek.
    expect(zomer[18]).toBe(0.06);
    expect(zomer[19]).toBe(0.13);
    expect(zomer[19]!).toBeLessThan(profielVoorMaand(1)[19]!);
    // En loopt door tot en met 23:00, waar de winter dan al is gezakt.
    expect(zomer[23]).toBe(0.13);
    expect(profielVoorMaand(1)[23]).toBe(0.13);
  });

  it("komt gemiddeld op een plausibel niveau uit", () => {
    // Ongewogen over het jaar: ergens tussen de laagste en de hoogste trede, en
    // in de buurt van wat een huishouden nu aan variabele netkosten kwijt is.
    const gem = gemiddeldNettarief();
    expect(gem).toBeGreaterThan(0.05);
    expect(gem).toBeLessThan(0.13);
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
    // 30 september is nog zomer: middag gratis. 1 oktober is winter: 10 ct.
    expect(middagIn("2025-09-30")).toBe(0);
    expect(middagIn("2025-10-01")).toBe(0.1);
  });
});
