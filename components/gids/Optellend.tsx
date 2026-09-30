"use client";

/**
 * Een bedrag dat optelt tot zijn eindwaarde als het in beeld komt.
 *
 * Het eindbedrag is altijd `euro(waarde)`, precies zoals de rest van de tool het
 * schrijft. Onderweg tonen we hele euro's. Een schermlezer hoort alleen het
 * eindbedrag: cijfers die telkens veranderen zijn ruis. Bij "minder beweging"
 * (prefers-reduced-motion) en waar matchMedia ontbreekt staat meteen het
 * eindbedrag er.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { euro, euroAs } from "../../lib/format";

const DUUR_MS = 900;

// Op de server (statische export) bestaat useLayoutEffect niet als iets nuttigs;
// zo blijft de eerste verf op de client zonder flits van het eindbedrag.
const useVoorVerf = typeof window === "undefined" ? useEffect : useLayoutEffect;

function minderBeweging(): boolean {
  try {
    return (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return true;
  }
}

export function Optellend({ waarde }: { waarde: number }) {
  const [getoond, setGetoond] = useState(waarde);
  const vanaf = useRef<number | null>(null);
  const eerste = useRef(true);

  useVoorVerf(() => {
    // Eerste keer vanaf nul, daarna vanaf wat er stond: een herberekening telt
    // door naar het nieuwe bedrag in plaats van opnieuw te beginnen.
    const begin = eerste.current ? 0 : (vanaf.current ?? waarde);
    eerste.current = false;
    if (minderBeweging() || begin === waarde) {
      vanaf.current = waarde;
      setGetoond(waarde);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tik = (nu: number) => {
      const t = Math.min(1, (nu - t0) / DUUR_MS);
      // ease-out: snel weg, rustig aankomen
      const v = begin + (waarde - begin) * (1 - Math.pow(1 - t, 3));
      vanaf.current = v;
      setGetoond(v);
      if (t < 1) raf = requestAnimationFrame(tik);
    };
    setGetoond(begin);
    raf = requestAnimationFrame(tik);
    return () => cancelAnimationFrame(raf);
  }, [waarde]);

  const klaar = getoond === waarde;
  return (
    <>
      <span aria-hidden="true">{klaar ? euro(waarde) : euroAs(Math.round(getoond))}</span>
      <span className="visueel-verborgen">{euro(waarde)}</span>
    </>
  );
}
