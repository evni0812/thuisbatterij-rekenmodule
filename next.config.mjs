import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/**
 * De configuratie is een functie van de fase, en dat is geen detail.
 *
 * `next build` en `next dev` schrijven allebei naar dezelfde map en overschrijven
 * elkaars chunks. Draai je een build terwijl de dev-server loopt, dan valt die
 * om met "Cannot find module './873.js'" of een fout over het React Client
 * Manifest: het bestand waar hij naar verwijst is onder zijn handen vervangen.
 *
 * Eerder hing de scheiding aan een omgevingsvariabele die `npm run build` zette.
 * Dat lekte langs elke andere ingang: `vercel.json` roept bewust `next build`
 * aan zonder die variabele, en de README noemt `npx next build --turbopack` als
 * uitweg bij geheugendruk. Beide landen dan alsnog in de map van de dev-server.
 *
 * Door de fase te lezen die Next zelf meegeeft, kán het niet meer botsen. De
 * dev-server krijgt altijd zijn eigen map, elk buildcommando altijd `.next` —
 * ongeacht hoe of door wie het wordt aangeroepen.
 */
const nextConfig = {
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

export default (phase) => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
});
