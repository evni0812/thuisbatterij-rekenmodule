import { describe, expect, it } from "vitest";
import {
  addDays,
  amsterdamOffsetMinutes,
  buildQuarterAxis,
  dateRange,
  localDateOf,
  localHourOf,
  localMidnightUtcMs,
  quarterUtcMs,
  quartersOnDate,
} from "../lib/data/timeaxis";

describe("amsterdamOffsetMinutes", () => {
  it("geeft +60 in de winter en +120 in de zomer", () => {
    expect(amsterdamOffsetMinutes(Date.UTC(2025, 0, 15, 12))).toBe(60);
    expect(amsterdamOffsetMinutes(Date.UTC(2025, 6, 15, 12))).toBe(120);
  });
});

describe("quartersOnDate", () => {
  // De klok gaat vooruit op de laatste zondag van maart (23 uur = 92 kwartier)
  // en achteruit op de laatste zondag van oktober (25 uur = 100 kwartier).
  it("telt 92 kwartieren als de klok vooruit gaat", () => {
    expect(quartersOnDate("2025-03-30")).toBe(92);
    expect(quartersOnDate("2024-03-31")).toBe(92);
  });

  it("telt 100 kwartieren als de klok achteruit gaat", () => {
    expect(quartersOnDate("2025-10-26")).toBe(100);
    expect(quartersOnDate("2024-10-27")).toBe(100);
  });

  it("telt 96 kwartieren op een gewone dag", () => {
    expect(quartersOnDate("2025-01-15")).toBe(96);
    expect(quartersOnDate("2025-07-15")).toBe(96);
    expect(quartersOnDate("2025-03-29")).toBe(96);
    expect(quartersOnDate("2025-10-25")).toBe(96);
  });
});

describe("localMidnightUtcMs", () => {
  it("ankert op lokale middernacht, niet op UTC-middernacht", () => {
    // Winter: 00:00 CET = 23:00 UTC de dag ervoor.
    expect(localMidnightUtcMs("2025-01-15")).toBe(Date.UTC(2025, 0, 14, 23));
    // Zomer: 00:00 CEST = 22:00 UTC de dag ervoor.
    expect(localMidnightUtcMs("2025-07-15")).toBe(Date.UTC(2025, 6, 14, 22));
  });
});

describe("quarterUtcMs", () => {
  it("loopt lineair door over de voorjaarsovergang", () => {
    // Op 30 maart 2025 springt de lokale klok van 02:00 naar 03:00. In UTC is
    // er geen sprong: pos 8 (01:45 CET) en pos 9 (03:00 CEST) liggen 15 min uit
    // elkaar in UTC.
    const p8 = quarterUtcMs("2025-03-30", 8);
    const p9 = quarterUtcMs("2025-03-30", 9);
    expect(p9 - p8).toBe(15 * 60_000);
    expect(localHourOf(p8)).toBe(1);
    expect(localHourOf(p9)).toBe(3);
  });

  it("dekt het herhaalde uur in het najaar", () => {
    // Op 26 oktober 2025 komt 02:00 lokaal twee keer voor; beide keren staan
    // als aparte posities in de reeks.
    const eersteTwee = quarterUtcMs("2025-10-26", 9);
    const tweedeTwee = quarterUtcMs("2025-10-26", 13);
    expect(localHourOf(eersteTwee)).toBe(2);
    expect(localHourOf(tweedeTwee)).toBe(2);
    expect(tweedeTwee - eersteTwee).toBe(60 * 60_000);
  });

  it("blijft binnen de dag voor elke geldige positie", () => {
    for (const d of ["2025-03-30", "2025-10-26", "2025-06-01"]) {
      const n = quartersOnDate(d);
      expect(localDateOf(quarterUtcMs(d, 1))).toBe(d);
      expect(localDateOf(quarterUtcMs(d, n))).toBe(d);
    }
  });
});

describe("buildQuarterAxis", () => {
  it("telt precies het aantal kwartieren van een heel jaar", () => {
    // 365 dagen, waarvan één van 23 en één van 25 uur: 365*96 - 4 + 4 = 35040.
    const axis = buildQuarterAxis("2025-01-01", "2026-01-01");
    expect(axis.length).toBe(35040);
  });

  it("telt een schrikkeljaar correct", () => {
    const axis = buildQuarterAxis("2024-01-01", "2025-01-01");
    expect(axis.length).toBe(366 * 96);
  });

  it("is strikt oplopend met stappen van 15 minuten", () => {
    const axis = buildQuarterAxis("2025-03-29", "2025-03-31");
    for (let i = 1; i < axis.length; i++) {
      expect(axis[i]! - axis[i - 1]!).toBe(15 * 60_000);
    }
  });
});

describe("dateRange en addDays", () => {
  it("loopt over maand- en jaargrenzen", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(dateRange("2025-01-30", "2025-02-02")).toEqual([
      "2025-01-30",
      "2025-01-31",
      "2025-02-01",
    ]);
  });
});
