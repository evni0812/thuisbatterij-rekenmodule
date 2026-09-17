/**
 * Instellingen bewaren in de browser: heen en terug, en robuust tegen een
 * oude of bewerkte set.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { STANDAARD } from "../lib/configuratie";
import {
  MAX_PROFIELEN,
  bewaarLaatste,
  bewaarProfiel,
  leesLaatste,
  leesProfielen,
  vergeetLaatste,
  verwijderProfiel,
  vulAan,
  wisOpslag,
} from "../lib/opslag";

beforeEach(() => wisOpslag());

describe("de laatste set", () => {
  it("komt terug zoals hij is bewaard, en is weer weg na vergeten", () => {
    expect(leesLaatste()).toBeNull();
    const inst = { ...STANDAARD, afnameKwh: 3100, presetId: "marstek-venus-e3", opwekKwh: 3500 };
    expect(bewaarLaatste(inst)).toBe(true);
    const terug = leesLaatste();
    expect(terug?.inst).toEqual(inst);
    expect(terug?.bewaard).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    vergeetLaatste();
    expect(leesLaatste()).toBeNull();
  });
});

describe("profielen", () => {
  it("bewaart onder een naam, overschrijft dezelfde naam en verwijdert", () => {
    const a = { ...STANDAARD, afnameKwh: 1000 };
    const b = { ...STANDAARD, afnameKwh: 2000 };
    expect(bewaarProfiel("Thuis", a)?.length).toBe(1);
    expect(bewaarProfiel("Ouders", b)?.length).toBe(2);
    expect(bewaarProfiel("Thuis", b)?.length).toBe(2);
    expect(leesProfielen().find((p) => p.naam === "Thuis")?.inst.afnameKwh).toBe(2000);
    // Het meest recent bewaarde staat voorop.
    expect(leesProfielen()[0]?.naam).toBe("Thuis");
    expect(verwijderProfiel("Ouders").length).toBe(1);
    expect(bewaarProfiel("   ", a)).toBeNull();
  });

  it("houdt op bij het maximum", () => {
    for (let i = 0; i < MAX_PROFIELEN; i++) expect(bewaarProfiel(`p${i}`, STANDAARD)).not.toBeNull();
    expect(bewaarProfiel("een te veel", STANDAARD)).toBeNull();
    // Een bestaande naam mag wel nog worden bijgewerkt.
    expect(bewaarProfiel("p0", { ...STANDAARD, afnameKwh: 1 })).not.toBeNull();
  });
});

describe("een oude of bewerkte set", () => {
  it("wordt aangevuld met de standaard en verliest velden van het verkeerde type", () => {
    const uit = vulAan({ afnameKwh: 4000, heffing: "nu", prijsEur: null, spreiding: "veel" as unknown as number });
    expect(uit.afnameKwh).toBe(4000);
    expect(uit.heffing).toBe("nu");
    expect(uit.prijsEur).toBeNull();
    expect(uit.spreiding).toBe(STANDAARD.spreiding);
    expect(uit.terugleveringKwh).toBe(STANDAARD.terugleveringKwh);
    // Een set van vóór de kostenregel krijgt de standaardwaarden erbij.
    expect(uit.kostenPerKwh).toBe(STANDAARD.kostenPerKwh);
    expect(uit.installatieEur).toBe(STANDAARD.installatieEur);
  });

  it("overleeft rommel in de opslag", () => {
    window.localStorage.setItem("tbat:instellingen:v1", "{niet json");
    expect(leesLaatste()).toBeNull();
    expect(leesProfielen()).toEqual([]);
  });
});
