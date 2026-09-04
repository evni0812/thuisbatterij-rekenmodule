import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * Bestanden achter elkaar, niet naast elkaar.
     *
     * Drie testbestanden rekenen jaren aan kwartieren door en twee daarvan
     * meten hoe lang dat duurt. Draaien ze parallel, dan vechten ze om dezelfde
     * kernen en meet zo'n test niet het model maar de bezetting van de machine:
     * hetzelfde werk kwam op 4,2 seconden uit toen het alleen liep en op 10,8
     * naast de andere bestanden. Sequentieel is de hele suite ongeveer een
     * halve minuut langer, maar de tijdsbudgetten betekenen dan weer iets.
     */
    fileParallelism: false,
    // Modeltests draaien in Node; componenttests hebben een DOM nodig. De
    // environment wordt per bestand gekozen met een docblock-comment.
    environment: "node",
    environmentMatchGlobs: [
      ["tests/components.test.tsx", "jsdom"],
      ["tests/layout.test.tsx", "jsdom"],
    ],
  },
  esbuild: {
    jsx: "automatic",
  },
});
