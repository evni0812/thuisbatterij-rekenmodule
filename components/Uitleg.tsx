"use client";

/**
 * "Hoe is dit berekend?" — een knop die een dialoog opent met bron, stappen,
 * een voorbeeld met de echte getallen van deze doorrekening, en de
 * beperkingen. Patroon overgenomen van de Energiecontract Monitor.
 *
 * Native <dialog> met showModal(): focus blijft in de dialoog, de achtergrond
 * is inert, Esc sluit, en een klik op de achtergrond ook. Geen library.
 *
 * Elke uitleg heeft dezelfde vaste opbouw, in dezelfde volgorde. Wie er één
 * heeft gelezen, weet waar hij in de volgende moet kijken.
 */

import { useEffect, useRef } from "react";
import type { UitlegBlok } from "../lib/uitleg";

export function Uitleg({
  blok,
  variant = "knop",
}: {
  blok: UitlegBlok;
  /** "icoon" is alleen het vraagteken, voor in een krappe tegelkop. */
  variant?: "knop" | "icoon";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const klik = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    el.addEventListener("click", klik);
    return () => el.removeEventListener("click", klik);
  }, []);

  const open = () => {
    const el = ref.current;
    if (!el) return;
    // jsdom en oude browsers kennen showModal niet; dan gewoon open.
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  };
  const sluit = () => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.close === "function") el.close();
    else el.removeAttribute("open");
  };

  return (
    <>
      <button
        type="button"
        className={variant === "icoon" ? "uitleg-knop icoon" : "uitleg-knop"}
        onClick={open}
        aria-haspopup="dialog"
        aria-label={variant === "icoon" ? `Hoe is dit berekend: ${blok.titel}` : undefined}
        title={variant === "icoon" ? "Hoe is dit berekend?" : undefined}
      >
        <span aria-hidden="true">?</span>
        {variant === "knop" ? "Hoe is dit berekend?" : null}
      </button>
      <dialog ref={ref} className="uitleg" aria-label={`Uitleg: ${blok.titel}`}>
        <div className="uitleg-kop">
          <h3>{blok.titel}</h3>
          <button type="button" className="uitleg-sluit" onClick={sluit} aria-label="Sluiten">
            ×
          </button>
        </div>
        <div className="uitleg-inhoud">
          <p className="uitleg-lead">{blok.watZieJe}</p>

          <h4>Waar de getallen vandaan komen</h4>
          <ul className="uitleg-bron">
            {blok.bronnen.map((b, i) => (
              <li key={i}>
                <b>{b.naam}</b> — {b.wat}
              </li>
            ))}
          </ul>

          <h4>Stap voor stap</h4>
          <ol className="uitleg-stappen">
            {blok.stappen.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>

          {blok.voorbeeld ? (
            <>
              <h4>Jouw getallen</h4>
              <table className="uitleg-tabel">
                <tbody>
                  {blok.voorbeeld.regels.map((r, i) => (
                    <tr key={i} className={r.uitkomst ? "uitleg-uitkomst" : undefined}>
                      <td>{r.wat}</td>
                      <td className="num">{r.waarde}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {blok.voorbeeld.toelichting ? (
                <p className="uitleg-noot">{blok.voorbeeld.toelichting}</p>
              ) : null}
            </>
          ) : null}

          {blok.letop && blok.letop.length > 0 ? (
            <>
              <h4>Waar je op moet letten</h4>
              <ul className="uitleg-letop">
                {blok.letop.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </>
          ) : null}

          <p className="uitleg-voet">
            De getallen hierboven komen uit jouw doorrekening en veranderen mee met
            je invoer. Alles over de data, het model en wat we niet weten staat op
            het tabblad Methode.
          </p>
        </div>
      </dialog>
    </>
  );
}
