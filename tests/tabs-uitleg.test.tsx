/**
 * De tabs en de "Hoe is dit berekend?"-dialoog.
 *
 * De tabs moeten met het toetsenbord te bedienen zijn; de dialoog moet zijn
 * vaste opbouw hebben en de getallen van de doorrekening tonen, niet een vast
 * voorbeeld.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Paneel, TABS, TabStapper, Tabs } from "../components/Tabs";
import { Uitleg } from "../components/Uitleg";
import type { UitlegBlok } from "../lib/uitleg";

afterEach(cleanup);

describe("de tabs", () => {
  it("zijn een tablist met vijf tabbladen en één geselecteerd", () => {
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
  it("noemt het vorige en het volgende onderdeel bij naam", () => {
    render(<TabStapper actief="wanneer" onKies={() => {}} />);
    expect(screen.getByRole("button", { name: "Vorige: Waarom" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Volgende: Wat als" })).toBeDefined();
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
