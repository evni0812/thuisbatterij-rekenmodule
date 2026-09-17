/**
 * De kostenregel in de URL: heen en terug, en alleen bij afwijking.
 */
import { describe, expect, it } from "vitest";
import { STANDAARD } from "../lib/configuratie";
import { leesUrl, schrijfUrl } from "../lib/url-state";

describe("de kostenregel in de URL", () => {
  it("staat er niet in zolang hij op de standaard staat", () => {
    schrijfUrl({ ...STANDAARD }, STANDAARD);
    expect(window.location.search).toBe("");
  });

  it("komt terug zoals hij is weggeschreven", () => {
    schrijfUrl({ ...STANDAARD, kostenPerKwh: 400, kostenPerKw: 100, installatieEur: 0 }, STANDAARD);
    expect(window.location.search).toContain("pkwh=400");
    expect(window.location.search).toContain("pkw=100");
    expect(window.location.search).toContain("inst=0");
    const terug = leesUrl();
    expect(terug.kostenPerKwh).toBe(400);
    expect(terug.kostenPerKw).toBe(100);
    expect(terug.installatieEur).toBe(0);
    // Wat niet afwijkt, staat er niet in en komt dus ook niet terug.
    expect(terug.prijsEur).toBeUndefined();
  });
});
