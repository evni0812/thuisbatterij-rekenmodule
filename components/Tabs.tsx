"use client";

/**
 * De tabs in de balk. Een echte tablist: pijltjestoetsen wisselen, Home en End
 * springen naar het eerste en laatste tabblad, Tab verlaat de lijst. De
 * panelen blijven gemount maar verborgen, zodat een gekozen dag in het
 * dagprofiel blijft staan als je heen en weer gaat.
 */

import { useRef, type KeyboardEvent } from "react";

export const TABS = [
  { id: "start", label: "Start", vraag: "invoer en het antwoord" },
  { id: "waarom", label: "Waarom", vraag: "waar de besparing vandaan komt" },
  { id: "wanneer", label: "Wanneer", vraag: "van jaar tot dag" },
  { id: "wat-als", label: "Wat als", vraag: "het nettarief, een andere maat, de looptijd" },
  { id: "methode", label: "Methode", vraag: "data, aannames en wat we niet weten" },
] as const;

export type TabId = (typeof TABS)[number]["id"];
export const STANDAARD_TAB: TabId = "start";

export function isTabId(v: string | null | undefined): v is TabId {
  return TABS.some((t) => t.id === v);
}

export function tabpaneelId(id: TabId): string {
  return `paneel-${id}`;
}

export function Tabs({ actief, onKies }: { actief: TabId; onKies: (id: TabId) => void }) {
  const knoppen = useRef<(HTMLButtonElement | null)[]>([]);

  const toets = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let doel: number | null = null;
    if (e.key === "ArrowRight") doel = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") doel = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") doel = 0;
    else if (e.key === "End") doel = TABS.length - 1;
    if (doel === null) return;
    e.preventDefault();
    const tab = TABS[doel]!;
    onKies(tab.id);
    knoppen.current[doel]?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label="Onderdelen van de rekentool">
      {TABS.map((t, i) => {
        const geselecteerd = t.id === actief;
        return (
          <button
            key={t.id}
            ref={(el) => {
              knoppen.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            className="tab"
            aria-selected={geselecteerd}
            aria-controls={tabpaneelId(t.id)}
            tabIndex={geselecteerd ? 0 : -1}
            onClick={() => onKies(t.id)}
            onKeyDown={(e) => toets(e, i)}
            title={t.vraag}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Doorstappen door de vijf onderdelen, onder aan de pagina.
 *
 * De tablist bovenin is er om ergens naartóé te springen; dit is er om verder
 * te lezen. Een verhaal in vijf delen hoort onderaan een "en dan?" te hebben,
 * anders moet je na elke sectie terug naar de balk.
 *
 * ── De pil is een venster ───────────────────────────────────────────────────
 * Alle vijf de titels staan naast elkaar op één spoor; de pil laat er precies
 * één van zien en schuift het spoor op. Daardoor ís de beweging de navigatie:
 * je ziet de titel van waar je was naar links verdwijnen en die van waar je
 * heen gaat binnenkomen, en bij een sprong van twee schuift de tussenliggende
 * titel er zichtbaar doorheen. Een gewone tekstwissel zou hetzelfde zeggen en
 * niets laten zien.
 *
 * Met `prefers-reduced-motion` staat de overgang uit; de titel wisselt dan
 * gewoon. De inhoud is hetzelfde, alleen de animatie vervalt.
 */
export function TabStapper({
  actief,
  onKies,
}: {
  actief: TabId;
  onKies: (id: TabId) => void;
}) {
  const i = TABS.findIndex((t) => t.id === actief);
  const vorige = i > 0 ? TABS[i - 1] : null;
  const volgende = i < TABS.length - 1 ? TABS[i + 1] : null;

  const stap = (id: TabId) => {
    onKies(id);
    // Zonder dit land je onderaan het volgende onderdeel, want de knop stond
    // onderaan het vorige. Direct, niet vloeiend: over een pagina van deze
    // lengte duurt vloeiend seconden.
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  return (
    <nav className="stapper" aria-label="Verder door de onderdelen">
      <button
        type="button"
        className="stapper-knop"
        disabled={!vorige}
        onClick={() => vorige && stap(vorige.id)}
        aria-label={vorige ? `Vorige: ${vorige.label}` : "Geen vorig onderdeel"}
      >
        <Chevron kant="links" />
        <span className="stapper-zij">
          <span className="stapper-richting">Vorige</span>
          <span className="stapper-naam">{vorige ? vorige.label : "—"}</span>
        </span>
      </button>

      <div className="stapper-venster">
        <div
          className="stapper-spoor"
          style={{ transform: `translateX(${-i * 100}%)` }}
        >
          {TABS.map((t) => (
            <span key={t.id} className="stapper-titel" aria-hidden={t.id !== actief}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {/* De aankondiging staat los van het spoor: een schermlezer hoort de
          nieuwe titel één keer, niet alle vijf. */}
      <span className="visueel-verborgen" role="status">
        {TABS[i]?.label}: {TABS[i]?.vraag}
      </span>

      <button
        type="button"
        className="stapper-knop rechts"
        disabled={!volgende}
        onClick={() => volgende && stap(volgende.id)}
        aria-label={volgende ? `Volgende: ${volgende.label}` : "Geen volgend onderdeel"}
      >
        <span className="stapper-zij">
          <span className="stapper-richting">Volgende</span>
          <span className="stapper-naam">{volgende ? volgende.label : "—"}</span>
        </span>
        <Chevron kant="rechts" />
      </button>
    </nav>
  );
}

function Chevron({ kant }: { kant: "links" | "rechts" }) {
  return (
    <svg
      className="stapper-chevron"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={kant === "links" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

export function Paneel({
  id,
  actief,
  children,
}: {
  id: TabId;
  actief: TabId;
  children: React.ReactNode;
}) {
  return (
    <section
      id={tabpaneelId(id)}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      className="paneel"
      hidden={id !== actief}
    >
      {children}
    </section>
  );
}
