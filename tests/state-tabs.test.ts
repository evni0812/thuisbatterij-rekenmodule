/**
 * `?tab=` komt uit de adresbalk en mag alles zijn. Alleen echte tabbladen en de
 * oude namen van vóór de herindeling geven een tabblad; namen die toevallig op
 * `Object.prototype` bestaan (`constructor`, `__proto__`) niet.
 */
import { describe, expect, it } from "vitest";
import { isTabId, leesTab } from "../components/Tabs";

describe("leesTab", () => {
  it("geeft geen tabblad voor namen van Object.prototype", () => {
    for (const naam of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "__defineGetter__",
    ]) {
      expect(leesTab(naam), naam).toBeNull();
      expect(isTabId(naam), naam).toBe(false);
    }
  });

  it("blijft de oude en de nieuwe namen lezen", () => {
    expect(leesTab("wat-als")).toBe("welke-batterij");
    expect(leesTab("co2")).toBe("co2");
    expect(leesTab("")).toBeNull();
    expect(leesTab(undefined)).toBeNull();
  });
});
