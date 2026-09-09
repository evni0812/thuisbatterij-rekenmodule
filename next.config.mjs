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

  /*
   * Ruimte voor /voorbeeld.json, dat bij de build het standaardantwoord en het
   * nettariefscenario doorrekent. Next.js kapt een statische route standaard af
   * op zestig seconden; op de bouwmachine van Vercel is dat te krap gebleken.
   * Honderdtachtig is ruim, en als het daar overheen gaat is er iets anders mis.
   */
  staticPageGenerationTimeout: 180,

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
