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
import {
  OpDitTabblad,
  Paneel,
  TABS,
  TabStapper,
  Tabs,
  leesTab,
  tabVanAnker,
} from "../components/Tabs";
import { Uitleg } from "../components/Uitleg";
import type { UitlegBlok } from "../lib/uitleg";

afterEach(cleanup);

describe("de tabs", () => {
  it("zijn een tablist met zeven tabbladen en één geselecteerd", () => {
    render(<Tabs actief="uitkomst" onKies={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(TABS.length);
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true").length).toBe(1);
    // Alleen het geselecteerde tabblad zit in de tabvolgorde.
    expect(tabs.filter((t) => t.tabIndex === 0).length).toBe(1);
  });

  it("wisselen met de pijltjestoetsen, rondom", () => {
    const onKies = vi.fn();
    render(<Tabs actief="uitkomst" onKies={onKies} />);
    const eerste = screen.getByRole("tab", { name: "Uitkomst" });
    fireEvent.keyDown(eerste, { key: "ArrowRight" });
    expect(onKies).toHaveBeenLastCalledWith("besparing");
    fireEvent.keyDown(eerste, { key: "ArrowLeft" });
    expect(onKies).toHaveBeenLastCalledWith("aannames");
    fireEvent.keyDown(eerste, { key: "End" });
    expect(onKies).toHaveBeenLastCalledWith("aannames");
    fireEvent.click(screen.getByRole("tab", { name: "Welke batterij" }));
    expect(onKies).toHaveBeenLastCalledWith("welke-batterij");
  });

  it("verbergt de panelen die niet actief zijn, maar houdt ze in de boom", () => {
    render(
      <>
        <Paneel id="uitkomst" actief="besparing">
          <p>uitkomst-inhoud</p>
        </Paneel>
        <Paneel id="besparing" actief="besparing">
          <p>besparing-inhoud</p>
        </Paneel>
      </>,
    );
    const uitkomst = document.getElementById("paneel-uitkomst")!;
    const besparing = document.getElementById("paneel-besparing")!;
    expect(uitkomst.hidden).toBe(true);
    expect(besparing.hidden).toBe(false);
    expect(uitkomst.textContent).toContain("uitkomst-inhoud");
    expect(besparing.getAttribute("aria-labelledby")).toBe("tab-besparing");
  });

  it("sturen een gedeelde link van vóór de herindeling naar het goede tabblad", () => {
    /**
     * Er staan links met ?tab=wat-als in mails en documenten. Die moeten
     * blijven werken, en op het tabblad landen waar de meeste van die
     * figuren nu staan.
     */
    expect(leesTab("start")).toBe("uitkomst");
    expect(leesTab("waarom")).toBe("besparing");
    expect(leesTab("wanneer")).toBe("door-het-jaar");
    expect(leesTab("wat-als")).toBe("welke-batterij");
    expect(leesTab("uitstoot")).toBe("co2");
    expect(leesTab("methode")).toBe("aannames");
    expect(leesTab("terugverdienen")).toBe("terugverdienen");
    expect(leesTab("onzin")).toBeNull();
    expect(leesTab(null)).toBeNull();
  });

  it("vinden het tabblad bij een anker, en elk anker staat maar één keer", () => {
    expect(tabVanAnker("per-maand")).toBe("door-het-jaar");
    expect(tabVanAnker("nettarief")).toBe("terugverdienen");
    expect(tabVanAnker("instellingen")).toBe("uitkomst");
    expect(tabVanAnker("bestaat-niet")).toBeNull();
    expect(tabVanAnker("")).toBeNull();

    const ankers = TABS.flatMap((t) => t.figuren.map((f) => f.id));
    expect(new Set(ankers).size).toBe(ankers.length);
    // Een anker mag niet samenvallen met een tabblad: ?tab= en # zijn
    // verschillende dingen, en een link moet eenduidig zijn.
    for (const t of TABS) expect(ankers).not.toContain(t.id);
  });

  it("geven elk anker een element in de bron, zodat de inhoudsopgave nergens doodloopt", () => {
    /**
     * De inhoudsopgave en de kicker lezen de lijst in Tabs.tsx; de figuren
     * zelf zetten hun anker in hun eigen component. Loopt dat uit elkaar, dan
     * is er een link die nergens heen gaat. Elk anker moet dus als
     * anker="…" of id="…" in een component of in de pagina staan.
     */
    const bronnen = [
      readFileSync("app/page.tsx", "utf8"),
      ...readdirSync("components")
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => readFileSync(`components/${f}`, "utf8")),
    ].join("\n");
    for (const t of TABS) {
      for (const f of t.figuren) {
        expect(
          bronnen.includes(`anker="${f.id}"`) || bronnen.includes(`id="${f.id}"`),
          `anker "${f.id}" (${f.naam}) staat nergens`,
        ).toBe(true);
      }
    }
  });

  it("zetten bovenaan elk tabblad een inhoudsopgave met links naar de figuren", () => {
    render(<OpDitTabblad id="terugverdienen" />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Over de looptijd",
      "Laadbeurten en levensduur",
      "Nettarief van 2029",
    ]);
    expect(links[0]!.getAttribute("href")).toBe("#looptijd");
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
    const { container } = render(<TabStapper actief="uitkomst" onKies={() => {}} />);
    const balk = container.querySelector(".stapper-balk");
    expect(balk).not.toBeNull();
    expect(balk!.querySelector("nav.stapper")).not.toBeNull();
  });

  it("noemt het vorige en het volgende onderdeel bij naam", () => {
    render(<TabStapper actief="door-het-jaar" onKies={() => {}} />);
    expect(screen.getByRole("button", { name: "Vorige: Besparing" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Volgende: Terugverdienen" })).toBeDefined();
  });

  it("houdt elk tablabel kort genoeg voor het venster van de pil", () => {
    /**
     * De pil is een venster van vaste breedte — 12rem, en 11,5rem onder 600px.
     * Vast moet het zijn, anders springt de pil per titel van maat en schuift
     * het spoor niet meer. Maar een titel die er niet in past wordt gewoon
     * afgeknipt: geen foutmelding, geen kapotte test, alleen een half woord op
     * een telefoon.
     *
     * Het smalste venster is 184px bij een basis van 16px, en de titel staat
     * in 1rem vet. Negentien tekens ("Aannames en bronnen") is daar de
     * bovengrens voor; op 360px nagemeten. Loopt een nieuw tabblad hiertegenaan, kies dan
     * een korter woord of verruim beide breedtes in theme.css — en kijk dan
     * zelf op 360px of het klopt, want deze test meet tekens en geen pixels.
     */
    for (const t of TABS) {
      expect(t.label.length, `"${t.label}" past niet in de pil`).toBeLessThanOrEqual(19);
    }
  });

  it("zet de chevrons in de pil, aan weerszijden van het venster", () => {
    /**
     * De twee knoppen en het venster horen één element te zijn. Vallen ze uit
     * elkaar, dan staan er weer drie losse dingen in de balk en wijst de knop
     * niet meer naar de plek waar de titel schuift.
     */
    const { container } = render(<TabStapper actief="besparing" onKies={() => {}} />);
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
     * De pil is een venster: alle titels staan naast elkaar en het
     * spoor schuift op. Staat de verschuiving niet op het juiste veelvoud van
     * honderd procent, dan kijk je door het venster naar de verkeerde titel —
     * of naar twee halve.
     */
    const { container } = render(<TabStapper actief="terugverdienen" onKies={() => {}} />);
    const spoor = container.querySelector<HTMLElement>(".stapper-spoor")!;
    expect(spoor.children.length).toBe(TABS.length);
    expect(spoor.style.transform).toBe("translateX(-300%)");
  });

  it("stapt niet voorbij het eerste en het laatste onderdeel", () => {
    const onKies = vi.fn();
    const { rerender, container } = render(<TabStapper actief="uitkomst" onKies={onKies} />);
    const knoppen = () => [...container.querySelectorAll("button")];
    expect(knoppen()[0]!.disabled).toBe(true);
    expect(knoppen()[1]!.disabled).toBe(false);

    rerender(<TabStapper actief="aannames" onKies={onKies} />);
    expect(knoppen()[0]!.disabled).toBe(false);
    expect(knoppen()[1]!.disabled).toBe(true);
  });

  it("kiest het volgende onderdeel en zet de pagina bovenaan", () => {
    const onKies = vi.fn();
    const scroll = vi.fn();
    window.scrollTo = scroll as unknown as typeof window.scrollTo;
    render(<TabStapper actief="besparing" onKies={onKies} />);
    fireEvent.click(screen.getByRole("button", { name: "Volgende: Door het jaar" }));
    expect(onKies).toHaveBeenCalledWith("door-het-jaar");
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
    // Ook de begeleide stappen in components/gids: daar staan dezelfde claims.
    ...readdirSync("components", { recursive: true })
      .map((f) => `components/${String(f)}`)
      .filter((f) => /\.tsx?$/.test(f)),
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
    // Het profiel is een gemeten gemiddelde, geen werkelijk huishouden.
    ["profielen zoals ze werkelijk waren", /profielen zoals ze werkelijk waren/],
    ["wat er echt gebeurd is", /wat er echt gebeurd is/],
    // Bronnen: alleen wat de bron ook echt zegt, en een link die werkt.
    ["de API als publieke bron", /href="https:\/\/api\.anwb\.nl/],
    ["Schade zonder coauteur", /Schade, <i>/],
    ["eigen groep 300 tot 1.200 euro bij powerplugs", /1\.200 euro \(powerplugs/],
    ["900 kWh per kWp als Milieu Centraal", /900 kWh per kWp \(Milieu Centraal\)/],
  ])("niet: %s", (_naam, patroon) => {
    expect(tekst).not.toMatch(patroon);
  });

  it("noemt de bronnen die in de teksten staan, met een publieke link", () => {
    const pagina = readFileSync("app/page.tsx", "utf8");
    for (const url of [
      "https://www.anwb.nl/energie/actuele-tarieven",
      "https://ce.nl/publicaties/beheersbare-energiekosten-voor-huishoudens-in-2030/",
      "https://thuisbatterijgids.net/",
      "https://www.powerplugs.nl/",
      "https://www.milieucentraal.nl/",
      "https://www.pbl.nl/",
    ]) {
      expect(pagina, url).toContain(url);
    }
    expect(tekst).toMatch(/Schade en R\. Egging-Bratseth/);
  });

  it("noemt de ANWB als afzender en de voorwaarde van een dynamisch contract", () => {
    expect(tekst).toMatch(/Deze tool is van\s+ANWB\. ANWB verkoopt ook energie en thuisbatterijen\./);
    expect(tekst).toMatch(/Deze doorrekening gaat uit van een dynamisch energiecontract/);
  });
});
