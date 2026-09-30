/**
 * De spreidingsfactor verandert de scherpte van het profiel, niet het
 * jaarverbruik: op de echte profielen komt een vol jaar bij elke spreiding
 * weer op de ingevulde meterstanden uit, zonder negatieve kwartierwaarden.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeBinary, type ProfileYear } from "../lib/data/loader";
import type { Manifest } from "../lib/data/manifest";
import { addDays, buildQuarterAxis } from "../lib/data/timeaxis";
import { buildResidualParts, solveNettingScale } from "../lib/model/residual";
import type { HouseholdSpec } from "../lib/model/types";

const DATA = "public/data";
const manifest = JSON.parse(readFileSync(`${DATA}/manifest.json`, "utf8")) as Manifest;

function profileYear(domain: string, year: number): ProfileYear {
  const info = manifest.profielen[domain]![String(year)]!;
  const b = readFileSync(`${DATA}/profile-${domain}-${year}.bin`);
  const { series } = decodeBinary(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
  );
  return {
    year,
    startMs: buildQuarterAxis(info.eerste_dag, addDays(info.laatste_dag, 1)),
    importFraction: series[0]!,
    exportFraction: series[1]!,
    firstDay: info.eerste_dag,
    lastDay: info.laatste_dag,
    isFullYear: info.volledig_jaar,
  };
}

const DOMAIN = "871685900000056162"; // Liander

function tel(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
}

describe("spreidingsfactor en jaartotalen", () => {
  for (const spreiding of [0.5, 1.5, 2]) {
    for (const [af, tl] of [
      [2500, 2000],
      [4000, 6000],
    ] as const) {
      it(`spreiding ${spreiding}, ${af}/${tl} kWh: vol jaar op de meterstanden, geen negatieve waarden`, () => {
        const hh: HouseholdSpec = {
          annualGridImportKwh: af,
          annualGridExportKwh: tl,
          spreadFactor: spreiding,
        };
        for (const year of [2024, 2025]) {
          const prof = profileYear(DOMAIN, year);
          const scale = solveNettingScale(prof.importFraction, prof.exportFraction, hh, prof.startMs);
          const d = buildResidualParts(
            prof.importFraction,
            prof.exportFraction,
            hh,
            prof.startMs,
            scale,
          );
          expect(Math.abs(tel(d.gridImportKwh) / af - 1), `afname ${year}`).toBeLessThan(1e-4);
          expect(Math.abs(tel(d.gridExportKwh) / tl - 1), `teruglevering ${year}`).toBeLessThan(1e-4);
          for (let i = 0; i < d.residualKwh.length; i++) {
            if (d.gridImportKwh[i]! < 0 || d.gridExportKwh[i]! < 0) {
              throw new Error(`negatieve kwartierwaarde op ${i}`);
            }
            // Per kwartier één kant op, en gelijk aan de residual.
            expect(d.gridImportKwh[i]! - d.gridExportKwh[i]!).toBeCloseTo(d.residualKwh[i]!, 12);
          }
        }
      });
    }
  }

  it("zonder tijdas (blokken van 96) komt het jaar er ook op een halve procent bij", () => {
    const hh: HouseholdSpec = { annualGridImportKwh: 2500, annualGridExportKwh: 2000, spreadFactor: 1.5 };
    const prof = profileYear(DOMAIN, 2025);
    const scale = solveNettingScale(prof.importFraction, prof.exportFraction, hh);
    const d = buildResidualParts(prof.importFraction, prof.exportFraction, hh, prof.startMs, scale);
    expect(Math.abs(tel(d.gridImportKwh) / 2500 - 1)).toBeLessThan(0.005);
    expect(Math.abs(tel(d.gridExportKwh) / 2000 - 1)).toBeLessThan(0.005);
  });

  it("laat spreiding 1 ongewijzigd: de componenten blijven de ruwe E17 en E18", () => {
    const hh: HouseholdSpec = { annualGridImportKwh: 2500, annualGridExportKwh: 2000, spreadFactor: 1 };
    const prof = profileYear(DOMAIN, 2025);
    const scale = solveNettingScale(prof.importFraction, prof.exportFraction, hh, prof.startMs);
    const d = buildResidualParts(prof.importFraction, prof.exportFraction, hh, prof.startMs, scale);
    let overlap = 0;
    for (let i = 0; i < d.residualKwh.length; i++) {
      overlap += Math.min(d.gridImportKwh[i]!, d.gridExportKwh[i]!);
    }
    expect(overlap).toBeGreaterThan(100);
  });
});
