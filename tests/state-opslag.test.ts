// @vitest-environment jsdom
/**
 * Bewaarde instellingen leggen alleen vast wat afwijkt van de standaard. Wie
 * ooit bewaarde, rekent zo niet voor altijd met de aannames van toen: de
 * standaard voor afregelen ging van aan naar uit en een bewaarde volledige set
 * bleef op "aan" staan.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { STANDAARD } from "../lib/configuratie";
import {
  bewaarLaatste,
  bewaarProfiel,
  leesLaatste,
  leesProfielen,
  verwijderProfiel,
  vergeetLaatste,
  wisOpslag,
} from "../lib/opslag";

const V1 = "tbat:instellingen:v1";
const V2 = "tbat:instellingen:v2";

beforeEach(() => {
  wisOpslag();
  window.localStorage.clear();
});

const ruw = (sleutel: string) => JSON.parse(window.localStorage.getItem(sleutel) ?? "null");

describe("alleen afwijkingen bewaren", () => {
  it("schrijft van de laatste set alleen wat van de standaard afwijkt", () => {
    bewaarLaatste({ ...STANDAARD, afnameKwh: 3100, opwekKwh: 3500 });
    const o = ruw(V2);
    expect(o.laatste).toEqual({ afnameKwh: 3100, opwekKwh: 3500 });
    expect(window.localStorage.getItem(V1)).toBeNull();
  });

  it("leest hem terug als volledige set", () => {
    const inst = { ...STANDAARD, afnameKwh: 3100, presetId: "marstek-venus-e3", opwekKwh: 3500, van: "2025-01-01", tot: "2025-12-31" };
    bewaarLaatste(inst);
    expect(leesLaatste()?.inst).toEqual(inst);
  });

  it("laat een veranderde standaard doorwerken in wat eerder is bewaard", () => {
    bewaarLaatste({ ...STANDAARD, afnameKwh: 3100 });
    // Zo is een nieuwe standaard te simuleren: de opgeslagen set noemt curtailment niet,
    // dus hij volgt wat STANDAARD nu zegt.
    const terug = leesLaatste()!.inst;
    expect(terug.curtailment).toBe(STANDAARD.curtailment);
    expect(terug.heffing).toBe(STANDAARD.heffing);
    expect(ruw(V2).laatste).not.toHaveProperty("curtailment");
  });

  it("bewaart een bewuste keuze tegen de standaard in wel", () => {
    bewaarLaatste({ ...STANDAARD, curtailment: !STANDAARD.curtailment });
    expect(ruw(V2).laatste).toEqual({ curtailment: !STANDAARD.curtailment });
    expect(leesLaatste()?.inst.curtailment).toBe(!STANDAARD.curtailment);
  });

  it("bewaart een set zonder afwijkingen als lege set, met tijdstip", () => {
    bewaarLaatste(STANDAARD);
    const terug = leesLaatste();
    expect(terug?.inst).toEqual(STANDAARD);
    expect(terug?.bewaard).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("doet hetzelfde voor profielen, en geeft ze als volledige set terug", () => {
    const lijst = bewaarProfiel("Thuis", { ...STANDAARD, afnameKwh: 1000 })!;
    expect(lijst[0]?.inst).toEqual({ ...STANDAARD, afnameKwh: 1000 });
    expect(ruw(V2).profielen[0].inst).toEqual({ afnameKwh: 1000 });
    expect(leesProfielen()[0]?.inst.afnameKwh).toBe(1000);
    expect(verwijderProfiel("Thuis")).toEqual([]);
  });

  it("houdt de laatste set en de profielen los van elkaar", () => {
    bewaarProfiel("Thuis", { ...STANDAARD, afnameKwh: 1000 });
    bewaarLaatste({ ...STANDAARD, afnameKwh: 2000 });
    expect(leesProfielen()).toHaveLength(1);
    vergeetLaatste();
    expect(leesLaatste()).toBeNull();
    expect(leesProfielen()).toHaveLength(1);
  });
});

describe("een set van versie 1", () => {
  const volledigV1 = {
    ...STANDAARD,
    afnameKwh: 3100,
    // In v1 was afregelen standaard aan: de opgeslagen set zegt "aan", maar dat was
    // geen keuze. Het is niet te onderscheiden van een bewuste keuze, dus gaat het weg.
    curtailment: true,
    heffing: "toen" as const,
  };

  beforeEach(() => {
    window.localStorage.setItem(
      V1,
      JSON.stringify({
        laatste: volledigV1,
        laatsteBewaard: "2026-08-01T10:00:00.000Z",
        profielen: [{ naam: "Oud", inst: volledigV1, bewaard: "2026-07-01T10:00:00.000Z" }],
      }),
    );
  });

  it("wordt bij het lezen omgezet: alleen afwijkingen van de huidige standaard, zonder curtailment en heffing", () => {
    const laatste = leesLaatste()!;
    expect(laatste.inst.afnameKwh).toBe(3100);
    expect(laatste.inst.heffing).toBe(STANDAARD.heffing);
    expect(laatste.inst.curtailment).toBe(STANDAARD.curtailment);
    expect(laatste.bewaard).toBe("2026-08-01T10:00:00.000Z");
    const o = ruw(V2);
    expect(o.laatste).toEqual({ afnameKwh: 3100 });
    expect(o.profielen[0].inst).toEqual({ afnameKwh: 3100 });
    expect(o.profielen[0].bewaard).toBe("2026-07-01T10:00:00.000Z");
  });

  it("ruimt versie 1 op, zodat hij na het wissen niet terugkomt", () => {
    leesLaatste();
    expect(window.localStorage.getItem(V1)).toBeNull();
    wisOpslag();
    expect(leesLaatste()).toBeNull();
    expect(leesProfielen()).toEqual([]);
  });

  it("leest de profielen van versie 1", () => {
    const p = leesProfielen();
    expect(p).toHaveLength(1);
    expect(p[0]?.naam).toBe("Oud");
    expect(p[0]?.inst.curtailment).toBe(STANDAARD.curtailment);
    expect(p[0]?.inst.afnameKwh).toBe(3100);
  });

  it("laat versie 2 winnen als beide er zijn", () => {
    window.localStorage.setItem(V2, JSON.stringify({ laatste: { afnameKwh: 999 }, profielen: [] }));
    expect(leesLaatste()?.inst.afnameKwh).toBe(999);
  });

  it("laat een onleesbare versie 1 staan en gaat verder met een lege opslag", () => {
    window.localStorage.setItem(V1, "{niet json");
    expect(leesLaatste()).toBeNull();
    expect(leesProfielen()).toEqual([]);
  });

  it("wist met wisOpslag beide versies", () => {
    wisOpslag();
    expect(window.localStorage.getItem(V1)).toBeNull();
    expect(window.localStorage.getItem(V2)).toBeNull();
  });
});

describe("een opslag met rommel erin", () => {
  it("negeert een bewaard-tijdstip dat geen tekst is, en een profiel zonder geldige set", () => {
    window.localStorage.setItem(
      V2,
      JSON.stringify({
        laatste: { afnameKwh: 3100 },
        laatsteBewaard: 12345,
        profielen: [
          { naam: "Goed", inst: { afnameKwh: 1000 }, bewaard: { x: 1 } },
          { naam: "Kapot", inst: "tekst", bewaard: "2026-01-01T00:00:00.000Z" },
          { naam: 5, inst: {} },
          null,
        ],
      }),
    );
    expect(leesLaatste()).toEqual({ inst: { ...STANDAARD, afnameKwh: 3100 }, bewaard: null });
    const p = leesProfielen();
    expect(p.map((x) => x.naam)).toEqual(["Goed"]);
    expect(p[0]?.bewaard).toBe("");
  });

  it("negeert een bewaard-tijdstip dat geen tijdstip is", () => {
    window.localStorage.setItem(V2, JSON.stringify({ laatste: {}, laatsteBewaard: "gisteren-ofzo", profielen: [] }));
    expect(leesLaatste()?.bewaard).toBeNull();
  });

  it("overleeft opslag die geen object is", () => {
    for (const waarde of ["null", "[]", '"tekst"', "42"]) {
      window.localStorage.setItem(V2, waarde);
      expect(leesLaatste()).toBeNull();
      expect(leesProfielen()).toEqual([]);
    }
  });
});
