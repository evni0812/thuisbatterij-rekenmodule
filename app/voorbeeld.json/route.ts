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
import { MODEL_VERSIE, dispatchSleutel } from "../../lib/cache";
import { standaardConfiguratie } from "../../lib/configuratie";
import { Invoerbron } from "../../lib/data/invoer";
import type { Ophaler } from "../../lib/data/loader";
import { runAnalysis, runScenario } from "../../lib/model/analysis";
import { dispatchBaseline } from "../../lib/model/dispatch-baseline";
import {
  RASTER_CAPACITEITEN,
  RASTER_VERMOGENS,
  prijsPerKwhVan,
  rasterJaar,
  rasterPunt,
} from "../../lib/model/raster";
import type { GridPoint } from "../../lib/worker/protocol";
import { scenarioConfiguratie } from "../../lib/nettarief";

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

  // Het nettariefscenario gaat mee: het staat in het antwoordblok bovenaan, dus
  // daar wachten is het meest zichtbaar. Zonder optimum en voorbeelddagen, net
  // als in de worker; dezelfde afleiding als in de browser (lib/nettarief.ts),
  // anders past het bewaarde scenario nooit bij wat de pagina vraagt.
  const scenario = runScenario(await bron.bouwInvoer(scenarioConfiguratie(config)));

  // Het raster gaat óók mee: tweeënveertig doorrekeningen op één jaar, een
  // twintigtal seconden. Dat paste eerder niet in de zestig seconden die
  // Next.js een statische route gunt en brak de Vercel-build; sinds
  // `staticPageGenerationTimeout` op 180 staat (next.config.mjs) past het
  // ruim. Zonder dit rekende élke bezoeker het raster alsnog zelf, ook met een
  // treffer op de rest. De ontsnapping is er voor het geval een bouwmachine
  // toch te traag blijkt: dan bouwt de pagina zonder raster in plaats van
  // helemaal niet.
  let grid: GridPoint[][] | undefined;
  if (process.env.VOORBEELD_ZONDER_RASTER !== "1") {
    const entry = rasterJaar(invoer);
    const basis = dispatchBaseline(entry.window, invoer.tariff);
    const prijsPerKwh = prijsPerKwhVan(invoer, config.investmentEur);
    grid = RASTER_CAPACITEITEN.map((cap) =>
      RASTER_VERMOGENS.map((kw) =>
        rasterPunt(
          entry,
          basis,
          invoer.battery,
          invoer.tariff,
          cap,
          kw,
          prijsPerKwh,
          config.cycleLife,
          config.wearFraction ?? 1,
        ),
      ),
    );
  }

  return Response.json({
    versie: MODEL_VERSIE,
    sleutel: dispatchSleutel(config),
    gemaakt: new Date().toISOString(),
    result,
    scenario,
    grid,
  });
}
