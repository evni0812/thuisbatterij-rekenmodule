"use client";

/**
 * De tabs in de balk. Een echte tablist: pijltjestoetsen wisselen, Home en End
 * springen naar het eerste en laatste tabblad, Tab verlaat de lijst. De
 * panelen blijven gemount maar verborgen, zodat een gekozen dag in het
 * dagprofiel blijft staan als je heen en weer gaat.
 */

import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * De zeven tabbladen, elk over één onderwerp, en per tabblad de figuren die
 * erop staan. Het label is een zelfstandig naamwoord: wie de balk leest, ziet
 * waar iets over gaat, niet welk soort vraag het beantwoordt. De ondertitel
 * staat als eyebrow boven elk tabblad en noemt wat je er vindt.
 *
 * De figuren hebben een vaste naam en een vast anker. Hun titel is een
 * conclusie die met de invoer meebeweegt ("…in de zomer", "…in de winter");
 * de naam niet, zodat je naar "Per maand" kunt verwijzen en er met
 * `?tab=door-het-jaar#per-maand` direct naartoe kunt linken. Deze lijst is de
 * enige bron: de inhoudsopgave per tabblad, de kicker boven elke figuur en de
 * hash-navigatie lezen hem allemaal.
 */
export const TABS = [
  {
    id: "uitkomst",
    label: "Uitkomst",
    ondertitel: "jouw invoer en wat de batterij oplevert",
    figuren: [
      { id: "antwoord", naam: "Het antwoord" },
      { id: "cijfers", naam: "Cijfers op een rij" },
      { id: "instellingen", naam: "Instellingen" },
      { id: "bewaren", naam: "Bewaren" },
    ],
  },
  {
    id: "besparing",
    label: "Besparing",
    ondertitel: "waar het geld vandaan komt, en wat verloren gaat",
    figuren: [
      { id: "prijsverschil", naam: "Prijsverschil" },
      { id: "opbouw", naam: "Opbouw van de besparing" },
      { id: "verliezen", naam: "Verliezen" },
    ],
  },
  {
    id: "door-het-jaar",
    label: "Door het jaar",
    ondertitel: "per jaar, per maand, per uur en per dag",
    figuren: [
      { id: "per-jaar", naam: "Per jaar" },
      { id: "per-maand", naam: "Per maand" },
      { id: "zomer-en-winter", naam: "Zomer- en winterdag" },
      { id: "verloop", naam: "Verloop over tijd" },
      { id: "dag-en-week", naam: "Een dag of week van dichtbij" },
      { id: "meterprofiel", naam: "Wat door de meter ging" },
    ],
  },
  {
    id: "terugverdienen",
    label: "Terugverdienen",
    ondertitel: "looptijd, laadbeurten en het nettarief van 2029",
    figuren: [
      { id: "looptijd", naam: "Over de looptijd" },
      { id: "laadbeurten", naam: "Laadbeurten en levensduur" },
      { id: "nettarief", naam: "Nettarief van 2029" },
    ],
  },
  {
    id: "welke-batterij",
    label: "Welke batterij",
    ondertitel: "maat, uitbreiden, sturing en voor wie hij loont",
    figuren: [
      { id: "maat", naam: "Maat en vermogen" },
      { id: "uitbreiden", naam: "Uitbreiden" },
      { id: "sturing", naam: "Sturing" },
      { id: "voor-wie", naam: "Voor wie" },
    ],
  },
  {
    id: "co2",
    label: "CO2",
    ondertitel: "wat de batterij scheelt aan uitstoot",
    figuren: [
      { id: "jouw-co2", naam: "Jouw CO2" },
      { id: "co2-per-uur", naam: "CO2 per uur" },
      { id: "co2-per-seizoen", naam: "CO2 per maand" },
      { id: "co2-nederland", naam: "CO2 voor Nederland" },
    ],
  },
  {
    id: "aannames",
    label: "Aannames en bronnen",
    ondertitel: "data, grenzen van het model en bronnen",
    figuren: [
      { id: "data-en-model", naam: "De data en het model" },
      { id: "wat-we-niet-weten", naam: "Wat we niet weten" },
      { id: "bronnen", naam: "Bronnen" },
    ],
  },
] as const;

export type TabId = (typeof TABS)[number]["id"];
export type FiguurId = (typeof TABS)[number]["figuren"][number]["id"];
export const STANDAARD_TAB: TabId = "uitkomst";

export function isTabId(v: string | null | undefined): v is TabId {
  return TABS.some((t) => t.id === v);
}

/**
 * De tabbladen van vóór de herindeling. Gedeelde links met `?tab=wat-als`
 * moeten blijven werken; "wat-als" gaat naar Welke batterij, omdat de meeste
 * figuren van dat oude tabblad daar staan.
 */
const OUDE_TAB_IDS: Record<string, TabId> = {
  start: "uitkomst",
  waarom: "besparing",
  wanneer: "door-het-jaar",
  "wat-als": "welke-batterij",
  uitstoot: "co2",
  methode: "aannames",
};

/** Het tabblad uit een `?tab=`-waarde, ook een van vóór de herindeling. */
export function leesTab(v: string | null | undefined): TabId | null {
  if (isTabId(v)) return v;
  // Alleen eigen sleutels: `?tab=constructor` of `?tab=__proto__` mag niet
  // bij een functie of prototype uitkomen.
  if (v && Object.hasOwn(OUDE_TAB_IDS, v)) return OUDE_TAB_IDS[v] ?? null;
  return null;
}

/** Het tabblad waarop een figuur staat, of null als het anker er geen is. */
export function tabVanAnker(anker: string | null | undefined): TabId | null {
  if (!anker) return null;
  const tab = TABS.find((t) => t.figuren.some((f) => f.id === anker));
  return tab ? tab.id : null;
}

/** De vaste naam van een figuur, voor de kicker boven zijn titel. */
export function figuurNaam(id: FiguurId): string {
  for (const t of TABS) {
    for (const f of t.figuren) if (f.id === id) return f.naam;
  }
  return id;
}

export function tabpaneelId(id: TabId): string {
  return `paneel-${id}`;
}

export function Tabs({ actief, onKies }: { actief: TabId; onKies: (id: TabId) => void }) {
  const knoppen = useRef<(HTMLButtonElement | null)[]>([]);

  // Op een smal scherm scrolt de balk opzij; het gekozen tabblad blijft in
  // beeld, ook als je er met de stapper onderaan naartoe gaat.
  useEffect(() => {
    const i = TABS.findIndex((t) => t.id === actief);
    knoppen.current[i]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [actief]);

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
            title={t.ondertitel}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Doorstappen door de zeven onderdelen, onder aan de pagina.
 *
 * De tablist bovenin is er om ergens naartóé te springen; dit is er om verder
 * te lezen. Een verhaal in zeven delen hoort onderaan een "en dan?" te hebben,
 * anders moet je na elke sectie terug naar de balk.
 *
 * ── De pil is een venster, en bedient zichzelf ──────────────────────────────
 * Alle titels staan naast elkaar op één spoor; de pil laat er precies
 * één van zien en schuift het spoor op. Daardoor ís de beweging de navigatie:
 * je ziet de titel van waar je was naar links verdwijnen en die van waar je
 * heen gaat binnenkomen, en bij een sprong van twee schuift de tussenliggende
 * titel er zichtbaar doorheen. Een gewone tekstwissel zou hetzelfde zeggen en
 * niets laten zien.
 *
 * De chevrons zitten in de pil zelf, aan weerszijden van dat venster. Ze stonden
 * eerst als losse knoppen links en rechts in de balk, met de naam van het vorige
 * en volgende onderdeel erbij. Dat waren drie dingen die om de aandacht vroegen
 * terwijl er één handeling is: een stap vooruit of terug. Nu wijst de knop naar
 * de plek waar de beweging gebeurt — je duwt tegen de rand van het venster en de
 * titel schuift. De namen zelf zijn niet verdwenen: ze zitten in het aria-label
 * en in de tooltip, dus wie wil weten waar hij heen gaat komt er nog bij.
 *
 * Met `prefers-reduced-motion` staat de overgang uit; de titel wisselt dan
 * gewoon. De inhoud is hetzelfde, alleen de animatie vervalt.
 *
 * ── Hij blijft onderin staan ────────────────────────────────────────────────
 * De balk plakt aan de onderkant van het scherm (`position: sticky`), zodat je
 * niet eerst een heel tabblad hoeft af te scrollen om verder te kunnen. Sticky
 * en niet fixed: het element houdt zijn eigen plek in de pagina, dus zodra je
 * onderaan bent laat hij los en staat hij gewoon boven de voettekst. Er hoeft
 * daardoor nergens ruimte te worden vrijgehouden, en er verdwijnt niets
 * permanent achter de balk.
 *
 * De buitenste laag loopt over de volle breedte en draagt de achtergrond; de
 * binnenste houdt dezelfde maat als de pagina erboven. Zonder die twee lagen
 * zou de balk als los kaartje midden in beeld zweven terwijl de inhoud er links
 * en rechts langs schuift.
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
    <div className="stapper-balk">
    <nav className="stapper" aria-label="Verder door de onderdelen">
      <div className="stapper-pil">
        <button
          type="button"
          className="stapper-pijl"
          disabled={!vorige}
          onClick={() => vorige && stap(vorige.id)}
          aria-label={vorige ? `Vorige: ${vorige.label}` : "Geen vorig onderdeel"}
          title={vorige ? `Vorige: ${vorige.label}` : undefined}
        >
          <Chevron kant="links" />
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

        <button
          type="button"
          className="stapper-pijl"
          disabled={!volgende}
          onClick={() => volgende && stap(volgende.id)}
          aria-label={volgende ? `Volgende: ${volgende.label}` : "Geen volgend onderdeel"}
          title={volgende ? `Volgende: ${volgende.label}` : undefined}
        >
          <Chevron kant="rechts" />
        </button>
      </div>

      {/* De aankondiging staat los van het spoor: een schermlezer hoort de
          nieuwe titel één keer, niet alle zeven. */}
      <span className="visueel-verborgen" role="status">
        {TABS[i]?.label}: {TABS[i]?.ondertitel}
      </span>
    </nav>
    </div>
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

/** De eyebrow boven elk tabblad: het label en wat je er vindt. */
export function TabEyebrow({ id }: { id: TabId }) {
  const tab = TABS.find((t) => t.id === id)!;
  return (
    <span className="eyebrow">
      {tab.label} · {tab.ondertitel}
    </span>
  );
}

/**
 * De inhoudsopgave bovenaan een tabblad: de vaste namen van de figuren, als
 * links naar hun anker. Wie een tabblad opent, ziet zonder te scrollen wat
 * erop staat en springt naar het stuk dat hij zoekt.
 */
export function OpDitTabblad({ id }: { id: TabId }) {
  const tab = TABS.find((t) => t.id === id)!;
  return (
    <nav className="op-dit-tabblad" aria-label={`Op het tabblad ${tab.label}`}>
      <span className="op-dit-tabblad-kop">Op dit tabblad</span>
      <ul>
        {tab.figuren.map((f) => (
          <li key={f.id}>
            <a href={`#${f.id}`}>{f.naam}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
