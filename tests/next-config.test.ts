import { describe, expect, it } from "vitest";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";

// @ts-expect-error - next.config.mjs heeft geen typedeclaratie
import maakConfig from "../next.config.mjs";

/**
 * De dev-server en een build mogen nooit in dezelfde map schrijven.
 *
 * Doen ze dat wel, dan overschrijft de build de chunks waar de draaiende
 * dev-server naar verwijst en valt die om met "Cannot find module './873.js'".
 * Dat is een vervelende fout om te herkennen: de code is in orde, alleen de
 * map op schijf niet, dus je zoekt in de verkeerde richting.
 *
 * Deze test bewaakt de scheiding op fase in plaats van op een omgevings-
 * variabele. Die vorige opzet lekte langs `vercel.json` en langs elke
 * handmatige `npx next build`, want die zetten de variabele niet.
 */
describe("next.config: gescheiden buildmappen", () => {
  it("geeft de dev-server een eigen map", () => {
    expect(maakConfig(PHASE_DEVELOPMENT_SERVER).distDir).toBe(".next-dev");
  });

  it("laat een build in .next landen, want dat verwacht Vercel", () => {
    expect(maakConfig(PHASE_PRODUCTION_BUILD).distDir).toBe(".next");
  });

  it("houdt dev en build uit elkaar, hoe de fase ook heet", () => {
    const dev = maakConfig(PHASE_DEVELOPMENT_SERVER).distDir;
    for (const fase of [PHASE_PRODUCTION_BUILD, "phase-production-server", "phase-export"]) {
      expect(maakConfig(fase).distDir).not.toBe(dev);
    }
  });

  it("houdt de statische export overeind", () => {
    const config = maakConfig(PHASE_PRODUCTION_BUILD);
    expect(config.output).toBe("export");
    expect(config.staticPageGenerationTimeout).toBe(180);
  });
});
