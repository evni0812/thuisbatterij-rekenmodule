/**
 * De tabs en de "Hoe is dit berekend?"-dialoog.
 *
 * De tabs moeten met het toetsenbord te bedienen zijn; de dialoog moet zijn
 * vaste opbouw hebben en de getallen van de doorrekening tonen, niet een vast
 * voorbeeld.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Paneel, TABS, TabStapper, Tabs } from "../components/Tabs";
import { Uitleg } from "../components/Uitleg";
import type { UitlegBlok } from "../lib/uitleg";

afterEach(cleanup);

describe("de tabs", () => {
  it("zijn een tablist met zes tabbladen en één geselecteerd", () => {
    render(<Tabs actief="start" onKies={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(TABS.length);
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true").length).toBe(1);
    // Alleen het geselecteerde tabblad zit in de tabvolgorde.
    expect(tabs.filter((t) => t.tabIndex === 0).length).toBe(1);
  });

  it("wisselen met de pijltjestoetsen, rondom", () => {
    const onKies = vi.fn();
    render(<Tabs actief="start" onKies={onKies} />);
    const eerste = screen.getByRole("tab", { name: "Start" });
    fireEvent.keyDown(eerste, { key: "ArrowRight" });
    expect(onKies).toHaveBeenLastCalledWith("waarom");
    fireEvent.keyDown(eerste, { key: "ArrowLeft" });
    expect(onKies).toHaveBeenLastCalledWith("methode");
    fireEvent.keyDown(eerste, { key: "End" });
    expect(onKies).toHaveBeenLastCalledWith("methode");
    fireEvent.click(screen.getByRole("tab", { name: "Wat als" }));
    expect(onKies).toHaveBeenLastCalledWith("wat-als");
  });

  it("verbergt de panelen die niet actief zijn, maar houdt ze in de boom", () => {
    render(
      <>
        <Paneel id="start" actief="waarom">
          <p>start-inhoud</p>
        </Paneel>
        <Paneel id="waarom" actief="waarom">
          <p>waarom-inhoud</p>
        </Paneel>
      </>,
    );
    const start = document.getElementById("paneel-start")!;
    const waarom = document.getElementById("paneel-waarom")!;
    expect(start.hidden).toBe(true);
    expect(waarom.hidden).toBe(false);
    expect(start.textContent).toContain("start-inhoud");
    expect(waarom.getAttribute("aria-labelledby")).toBe("tab-waarom");
  });
});

describe("de stapper onderaan", () => {
  it("zit in een balk die onderin het scherm kan blijven staan", () => {
    /**
     * De balk is twee lagen: de buitenste draagt de achtergrond over de volle
     * breedte en plakt onderin, de binnenste houdt de maat van de pagina.
     * Verdwijnt die buitenste laag, dan zweeft er een los kaartje in beeld
     * terwijl de inhoud er links en rechts langs schuift.
     */
    const { container } = render(<TabStapper actief="start" onKies={() => {}} />);
    const balk = container.querySelector(".stapper-balk");
    expect(balk).not.toBeNull();
    expect(balk!.querySelector("nav.stapper")).not.toBeNull();
  });

  it("noemt het vorige en het volgende onderdeel bij naam", () => {
    render(<TabStapper actief="wanneer" onKies={() => {}} />);
    expect(screen.getByRole("button", { name: "Vorige: Waarom" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Volgende: Wat als" })).toBeDefined();
  });

  it("houdt elk tablabel kort genoeg voor het venster van de pil", () => {
    /**
     * De pil is een venster van vaste breedte — 8,5rem, en 7,5rem onder 600px.
     * Vast moet het zijn, anders springt de pil per titel van maat en schuift
     * het spoor niet meer. Maar een titel die er niet in past wordt gewoon
     * afgeknipt: geen foutmelding, geen kapotte test, alleen een half woord op
     * een telefoon.
     *
     * Het smalste venster is 120px bij een basis van 16px, en de titel staat
     * in 1rem vet. Elf tekens is daar een veilige bovengrens voor, ook met
     * brede letters als W en M. Loopt een nieuw tabblad hiertegenaan, kies dan
     * een korter woord of verruim beide breedtes in theme.css — en kijk dan
     * zelf op 360px of het klopt, want deze test meet tekens en geen pixels.
     */
    for (const t of TABS) {
      expect(t.label.length, `"${t.label}" past niet in de pil`).toBeLessThanOrEqual(11);
    }
  });

  it("zet de chevrons in de pil, aan weerszijden van het venster", () => {
    /**
     * De twee knoppen en het venster horen één element te zijn. Vallen ze uit
     * elkaar, dan staan er weer drie losse dingen in de balk en wijst de knop
     * niet meer naar de plek waar de titel schuift.
     */
    const { container } = render(<TabStapper actief="waarom" onKies={() => {}} />);
    const pil = container.querySelector(".stapper-pil")!;
    expect(pil).not.toBeNull();

    const kinderen = [...pil.children];
    expect(kinderen.map((k) => k.className)).toEqual([
      "stapper-pijl",
      "stapper-venster",
      "stapper-pijl",
    ]);

    // Beide knoppen zitten écht in de pil, niet ergens anders in de balk.
    for (const knop of container.querySelectorAll("button")) {
      expect(pil.contains(knop)).toBe(true);
    }
  });

  it("zet alle titels op één spoor en schuift naar de actieve", () => {
    /**
     * De pil is een venster: alle vijf de titels staan naast elkaar en het
     * spoor schuift op. Staat de verschuiving niet op het juiste veelvoud van
     * honderd procent, dan kijk je door het venster naar de verkeerde titel —
     * of naar twee halve.
     */
    const { container } = render(<TabStapper actief="wat-als" onKies={() => {}} />);
    const spoor = container.querySelector<HTMLElement>(".stapper-spoor")!;
    expect(spoor.children.length).toBe(TABS.length);
    expect(spoor.style.transform).toBe("translateX(-300%)");
  });

  it("stapt niet voorbij het eerste en het laatste onderdeel", () => {
    const onKies = vi.fn();
    const { rerender, container } = render(<TabStapper actief="start" onKies={onKies} />);
    const knoppen = () => [...container.querySelectorAll("button")];
    expect(knoppen()[0]!.disabled).toBe(true);
    expect(knoppen()[1]!.disabled).toBe(false);

    rerender(<TabStapper actief="methode" onKies={onKies} />);
    expect(knoppen()[0]!.disabled).toBe(false);
    expect(knoppen()[1]!.disabled).toBe(true);
  });

  it("kiest het volgende onderdeel en zet de pagina bovenaan", () => {
    const onKies = vi.fn();
    const scroll = vi.fn();
    window.scrollTo = scroll as unknown as typeof window.scrollTo;
    render(<TabStapper actief="waarom" onKies={onKies} />);
    fireEvent.click(screen.getByRole("button", { name: "Volgende: Wanneer" }));
    expect(onKies).toHaveBeenCalledWith("wanneer");
    // Zonder dit land je onderaan het volgende onderdeel: de knop staat immers
    // onder aan het vorige.
    expect(scroll).toHaveBeenCalled();
  });
});

const BLOK: UitlegBlok = {
  titel: "Testcijfer",
  watZieJe: "Wat je ziet.",
  bronnen: [{ naam: "Bron A", wat: "levert het getal" }],
  stappen: ["Eerst dit.", "Dan dat."],
  voorbeeld: {
    regels: [
      { wat: "Invoer", waarde: "€ 12" },
      { wat: "Uitkomst", waarde: "€ 34", uitkomst: true },
    ],
    toelichting: "Zo dus.",
  },
  letop: ["Let hierop."],
};

describe("hoe is dit berekend", () => {
  it("opent een dialoog met de vaste opbouw en de meegegeven getallen", () => {
    render(<Uitleg blok={BLOK} />);
    const knop = screen.getByRole("button", { name: /Hoe is dit berekend/ });
    expect(knop.getAttribute("aria-haspopup")).toBe("dialog");
    const dialoog = document.querySelector("dialog.uitleg")!;
    expect(dialoog.hasAttribute("open")).toBe(false);
    fireEvent.click(knop);
    expect(dialoog.hasAttribute("open")).toBe(true);

    const koppen = [...dialoog.querySelectorAll("h4")].map((h) => h.textContent);
    expect(koppen).toEqual([
      "Waar de getallen vandaan komen",
      "Stap voor stap",
      "Jouw getallen",
      "Waar je op moet letten",
    ]);
    expect(dialoog.textContent).toContain("Bron A");
    expect(dialoog.querySelectorAll(".uitleg-stappen li").length).toBe(2);
    expect(dialoog.querySelector(".uitleg-uitkomst")?.textContent).toContain("€ 34");
    expect(dialoog.textContent).toContain("Let hierop.");

    fireEvent.click(screen.getByRole("button", { name: "Sluiten" }));
    expect(dialoog.hasAttribute("open")).toBe(false);
  });

  it("heeft als icoon een toegankelijke naam met de titel erin", () => {
    render(<Uitleg blok={BLOK} variant="icoon" />);
    expect(screen.getByRole("button", { name: /Hoe is dit berekend: Testcijfer/ })).toBeDefined();
  });
});

describe("de teksten beweren niets wat niet klopt", () => {
  /**
   * Uit de productiereview: uitspraken die op de pagina stonden en niet te
   * verdedigen waren. Ze mogen niet terugkomen via een oude tekst of een
   * kopie. De lijst is bewust concreet: het zijn de zinnen die er stonden.
   */
  const bestanden = [
    "app/page.tsx",
    "lib/uitleg.tsx",
    "lib/strategie.ts",
    ...readdirSync("components").map((f) => `components/${f}`),
  ];
  const tekst = bestanden.map((f) => readFileSync(f, "utf8")).join("\n");

  it.each([
    ["geen commerciële partij", /Geen commerciële partij/],
    ["advies boven de kaart", /Advies:/],
    ["werkelijk gemeten profielen van één huishouden", /werkelijk gemeten (kwartier|verbruiks)profielen/],
    ["echt verbruik, geen model", /echt verbruik, geen model/],
    ["onbewezen richting van het gemiddelde", /onderschat wat een batterij kan opvangen eerder/],
    ["marginale uitstoot als gunstiger", /Marginaal zou de winst groter maken/],
    ["vrijwel alleen groene stroom", /vrijwel alleen uit zon, wind en kern/],
    ["standby in de verliezen", /elektronica die dag en nacht aan staat/],
    ["stopcontactverbod", /aan een gewoon stopcontact mag maar 800 W/],
    ["alle omvormers regelen af", /Moderne omvormers stoppen met terugleveren/],
    ["nettarief als feit", /gooit de businesscase om/],
    // Eindtoets september 2026: de heffing van toen lag 33 tot 40% hoger, niet
    // "een kwart tot een derde", en de besparing groeit maar 13% mee.
    ["heffing als vaste zin", /kwart tot\s+een derde hoger/],
    ["besparing één-op-één met de heffing", /één-op-één/],
    ["heffing van toen als 13 tot 17 cent", /13 tot 17 cent/],
    ["bedrag tegen een getal geplakt", /tegen\s*\n\s*\{centPerKwh/],
    // Het voorstel komt van de netbeheerders; de ACM beslist erover.
    ["voorstel van de ACM", /voorstel van de\s+ACM/],
    ["drie getallen terwijl er twee gevraagd worden", /Drie getallen van je/],
    ["eigen groep loont niet terwijl hij netto oplevert", /eigen groep door een installateur loont hier niet: de beste maat/],
    ["EB 2027 als vaststaand", /2026 en 2027 vast op/],
    // Kaart van maten en huishoudens rekenen op het niveau van het gemiddelde
    // jaar (rasterGrondslag), niet op één herhaald jaar.
    ["één jaar dat zich herhaalt", /\{jaar(\.year)?\}\s+zich herhaalt|\$\{jaar(\.year)?[^}]*\} zich herhaalt/],
    ["de besparing van één jaar herhaald", /de besparing van \{jaar/],
    ["kaart op één jaar als reden", /De kaart rust op één jaar/],
  ])("niet: %s", (_naam, patroon) => {
    expect(tekst).not.toMatch(patroon);
  });

  it("noemt de ANWB als afzender en de voorwaarde van een dynamisch contract", () => {
    expect(tekst).toMatch(/Deze tool is van de\s+ANWB\. De ANWB verkoopt ook energie en thuisbatterijen\./);
    expect(tekst).toMatch(/Deze doorrekening gaat uit van een dynamisch energiecontract/);
  });
});
