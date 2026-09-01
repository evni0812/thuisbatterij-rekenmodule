/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Productiebuilds krijgen hun eigen map.
   *
   * `next build` en `next dev` schrijven anders allebei naar .next en
   * overschrijven elkaars chunks. Draai je een build terwijl de dev-server
   * loopt, dan valt die om met "Cannot find module './833.js'" — de chunk waar
   * hij naar verwijst is onder zijn handen vervangen.
   */
  distDir: process.env.NEXT_BUILD_DIR || ".next",

  // Alles draait in de browser: geen server, geen API-routes. De statische
  // export kan daardoor rechtstreeks vanaf de CDN.
  output: "export",
  images: { unoptimized: true },

  // De rekenworker gebruikt geen Node-modules; expliciet leeg laten zodat een
  // per ongeluk geïmporteerde polyfill niet stilzwijgend in de bundle belandt.
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

export default nextConfig;
