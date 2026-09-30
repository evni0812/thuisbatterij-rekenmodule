// @vitest-environment jsdom
/**
 * De terugknop: van tabblad wisselen zet een stap in de geschiedenis, invoer
 * wijzigen vervangt alleen de huidige.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STANDAARD } from "../lib/configuratie";
import { schrijfUrl } from "../lib/url-state";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.restoreAllMocks());

describe("schrijfUrl en de geschiedenis", () => {
  it("vervangt standaard de huidige stap", () => {
    const duw = vi.spyOn(window.history, "pushState");
    const vervang = vi.spyOn(window.history, "replaceState");
    schrijfUrl({ ...STANDAARD, afnameKwh: 3100 }, STANDAARD, {});
    expect(duw).not.toHaveBeenCalled();
    expect(vervang).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?af=3100");
  });

  it("duwt een stap bij een tabwissel", () => {
    const lengte = window.history.length;
    schrijfUrl(STANDAARD, STANDAARD, {});
    schrijfUrl(STANDAARD, STANDAARD, { tab: "besparing" }, undefined, "duw");
    expect(window.location.search).toBe("?tab=besparing");
    expect(window.history.length).toBe(lengte + 1);
  });

  it("duwt geen dubbele stap als de adresbalk er al zo uitziet", () => {
    schrijfUrl(STANDAARD, STANDAARD, { tab: "besparing" }, undefined, "duw");
    const lengte = window.history.length;
    schrijfUrl(STANDAARD, STANDAARD, { tab: "besparing" }, undefined, "duw");
    expect(window.history.length).toBe(lengte);
  });

  it("laat invoer wijzigen op een tabblad de stappen niet vermeerderen", () => {
    schrijfUrl(STANDAARD, STANDAARD, { tab: "besparing" }, undefined, "duw");
    const lengte = window.history.length;
    for (const af of [3000, 3100, 3200]) {
      schrijfUrl({ ...STANDAARD, afnameKwh: af }, STANDAARD, { tab: "besparing" });
    }
    expect(window.history.length).toBe(lengte);
    expect(window.location.search).toBe("?tab=besparing&af=3200");
  });

  it("neemt het anker mee", () => {
    schrijfUrl(STANDAARD, STANDAARD, { tab: "door-het-jaar" }, "per-maand", "duw");
    expect(window.location.search + window.location.hash).toBe("?tab=door-het-jaar#per-maand");
  });

  it("brengt de terugknop naar het vorige tabblad", async () => {
    schrijfUrl(STANDAARD, STANDAARD, {});
    schrijfUrl(STANDAARD, STANDAARD, { tab: "besparing" }, undefined, "duw");
    schrijfUrl(STANDAARD, STANDAARD, { tab: "co2" }, undefined, "duw");
    const terug = new Promise<void>((klaar) => window.addEventListener("popstate", () => klaar(), { once: true }));
    window.history.back();
    await terug;
    expect(window.location.search).toBe("?tab=besparing");
  });
});
