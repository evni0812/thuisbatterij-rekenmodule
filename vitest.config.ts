import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Modeltests draaien in Node; componenttests hebben een DOM nodig. De
    // environment wordt per bestand gekozen met een docblock-comment.
    environment: "node",
    environmentMatchGlobs: [["tests/components.test.tsx", "jsdom"]],
  },
  esbuild: {
    jsx: "automatic",
  },
});
