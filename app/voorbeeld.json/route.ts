/**
 * Het standaardantwoord, vooruitgerekend tijdens de build.
 *
 * Zonder dit kijkt een bezoeker vier seconden naar een leeg scherm terwijl de
 * worker vier profieljaren doorrekent. Het antwoord is voor iedereen hetzelfde
 * zolang niemand iets instelt — er zit geen willekeur in het model — dus het
 * kan net zo goed één keer bij de build worden uitgerekend en als bestand
 * meegeleverd.
 *
 * Twee dingen bewaken dat het niet verouderd raakt:
 *
 *   versie   het modelversienummer uit lib/cache.ts. Verandert het model, dan
 *            verandert dit nummer, en negeert de browser het bestand.
 *   sleutel  de hash van de configuratie waar dit antwoord bij hoort. Wijkt de
 *            configuratie van de bezoeker daarvan af, dan rekent hij gewoon zelf.
 *
 * Het bestand wordt statisch geëxporteerd, dus dit draait bij de build en nooit
 * bij een bezoek.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { MODEL_VERSIE, configSleutel } from "../../lib/cache";
import { standaardConfiguratie } from "../../lib/configuratie";
import { Invoerbron } from "../../lib/data/invoer";
import type { Ophaler } from "../../lib/data/loader";
import { runAnalysis } from "../../lib/model/analysis";

export const dynamic = "force-static";

/**
 * Leest de assets van schijf in plaats van via het netwerk.
 *
 * Tijdens de build bestaat `/data/manifest.json` nog niet als URL; de bestanden
 * staan in `public/data/`. De vorm van een Response aanhouden houdt de loader
 * onwetend van waar zijn bytes vandaan komen.
 */
const vanSchijf: Ophaler = async (url) => {
  const bestand = path.join(process.cwd(), "public", url.replace(/^\//, ""));
  const buf = await readFile(bestand);
  return new Response(new Uint8Array(buf));
};

export async function GET(): Promise<Response> {
  const config = standaardConfiguratie();

  const bron = new Invoerbron("/data", vanSchijf);
  await bron.init();
  const invoer = await bron.bouwInvoer(config);
  const result = runAnalysis(invoer);

  return Response.json({
    versie: MODEL_VERSIE,
    sleutel: configSleutel(config),
    gemaakt: new Date().toISOString(),
    result,
  });
}
