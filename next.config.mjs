/** @type {import('next').NextConfig} */
const nextConfig = {
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
