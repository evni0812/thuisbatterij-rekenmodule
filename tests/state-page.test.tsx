// @vitest-environment jsdom
/**
 * De pagina rond de URL: een vreemde `?tab=` crasht niet, de terugknop volgt de
 * tabbladen en de stappen, en een periode buiten de data wordt geklemd en
 * gemeld. Zonder tabblad in de link opent de begeleide route; met een tabblad
 * of figuuranker "Alle cijfers".
 */
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class NepWorker {
  onmessage: unknown = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;
  postMessage(): void {}
  terminate(): void {}
}

const haal = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("voorbeeld.json")) return { ok: false, status: 404 } as Response;
  const buf = readFileSync(`public${url.split("?")[0]}`);
  const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { ok: true, status: 200, arrayBuffer: async () => body, json: async () => JSON.parse(buf.toString("utf8")) } as Response;
}) as typeof fetch;

async function toonPagina(url: string) {
  window.history.replaceState(null, "", url);
  vi.resetModules();
  const { default: Pagina } = await import("../app/page");
  return render(<Pagina />);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("Worker", NepWorker);
  vi.stubGlobal("fetch", haal);
  // jsdom kent scrollIntoView niet.
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tabKnop = (c: HTMLElement, naam: string) =>
  [...c.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === naam)!;
const gekozen = (c: HTMLElement) => c.querySelector('[role="tab"][aria-selected="true"]')?.textContent;

describe("?tab= uit de adresbalk", () => {
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "crasht niet op ?tab=%s en opent de eerste stap",
    async (naam) => {
      const { container } = await toonPagina(`/?tab=${naam}`);
      expect(container.querySelector(".gids")).not.toBeNull();
      expect(container.querySelector("#gids-kop")?.textContent).toBe("Hoe ziet jouw huis eruit?");
      // De tabbladen blijven gemount achter "Alle cijfers".
      expect(container.querySelectorAll('[role="tabpanel"]').length).toBe(7);
    },
  );

  it("opent nog steeds een oude tabnaam", async () => {
    const { container } = await toonPagina("/?tab=wat-als");
    expect(gekozen(container)).toBe("Welke batterij");
  });
});

describe("de terugknop", () => {
  it("duwt een stap bij een tabwissel en volgt hem terug", async () => {
    const { container } = await toonPagina("/?tab=uitkomst");
    await waitFor(() => expect(gekozen(container)).toBe("Uitkomst"));
    const lengte = window.history.length;

    fireEvent.click(tabKnop(container, "Besparing"));
    await waitFor(() => expect(window.location.search).toBe("?tab=besparing"));
    expect(window.history.length).toBe(lengte + 1);
    fireEvent.click(tabKnop(container, "CO2"));
    await waitFor(() => expect(window.location.search).toBe("?tab=co2"));
    expect(window.history.length).toBe(lengte + 2);

    const terug = new Promise<void>((klaar) => window.addEventListener("popstate", () => klaar(), { once: true }));
    act(() => window.history.back());
    await terug;
    await waitFor(() => expect(gekozen(container)).toBe("Besparing"));
    // Terug zetten is geen nieuwe stap.
    expect(window.location.search).toBe("?tab=besparing");
    expect(window.history.length).toBe(lengte + 2);

    const nogEens = new Promise<void>((klaar) => window.addEventListener("popstate", () => klaar(), { once: true }));
    act(() => window.history.back());
    await nogEens;
    await waitFor(() => expect(gekozen(container)).toBe("Uitkomst"));
  });

  it("volgt de stappen terug, ook vanuit Alle cijfers", async () => {
    const { container } = await toonPagina("/");
    await waitFor(() => expect(container.querySelector(".gids")).not.toBeNull());
    const knop = (tekst: RegExp) =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => tekst.test(b.textContent ?? ""))!;

    fireEvent.click(knop(/Kies een batterij/));
    await waitFor(() => expect(window.location.search).toBe("?stap=2"));
    fireEvent.click(knop(/^Alle cijfers$/));
    await waitFor(() => expect(window.location.search).toBe("?tab=uitkomst"));
    expect(gekozen(container)).toBe("Uitkomst");

    const terug = new Promise<void>((klaar) => window.addEventListener("popstate", () => klaar(), { once: true }));
    act(() => window.history.back());
    await terug;
    await waitFor(() =>
      expect(container.querySelector("#gids-kop")?.textContent).toBe("Welke batterij wil je doorrekenen?"),
    );
  });

  it("maakt van invoer wijzigen geen stap in de geschiedenis", async () => {
    const { container } = await toonPagina("/?tab=uitkomst");
    await waitFor(() => expect(gekozen(container)).toBe("Uitkomst"));
    const lengte = window.history.length;
    const afname = container.querySelector<HTMLInputElement>('input[aria-describedby="afname-hint"]')!;
    for (const v of ["3000", "3100", "3200"]) {
      fireEvent.focus(afname);
      fireEvent.change(afname, { target: { value: v } });
      fireEvent.blur(afname);
    }
    await waitFor(() => expect(window.location.search).toBe("?tab=uitkomst&af=3200"));
    expect(window.history.length).toBe(lengte);
  });
});

describe("een periode buiten de data", () => {
  it("wordt op de data geklemd en gemeld", async () => {
    const { container } = await toonPagina("/?van=2027-03-01");
    await waitFor(() => expect(window.location.search).toContain("van=2026-09-12"));
    expect(container.textContent).toContain("Niet alles uit de link was bruikbaar");
    expect(container.textContent).toContain("begin van de periode");
    expect(container.textContent).toContain("beginnen vóór hij eindigt");
  });

  it("meldt een omgekeerde periode en rekent met de hele periode", async () => {
    const { container } = await toonPagina("/?van=2025-09-01&tot=2025-01-01");
    await waitFor(() => expect(container.textContent).toContain("Niet alles uit de link was bruikbaar"));
    expect(container.textContent).toContain("begin van de periode en einde van de periode");
    // Een link met instellingen opent bij het antwoord; wat niet klopte, is weg.
    await waitFor(() => expect(window.location.search).toBe("?stap=4"));
  });
});

describe("de begeleide route", () => {
  it("opent zonder tabblad bij de eerste stap, en een gedeelde doorrekening bij het antwoord", async () => {
    const { container } = await toonPagina("/");
    expect(container.querySelector("#gids-kop")?.textContent).toBe("Hoe ziet jouw huis eruit?");
    cleanup();
    const tweede = await toonPagina("/?af=3100");
    expect(tweede.container.querySelector("#gids-kop")?.textContent).toBe("Wat had hij je opgeleverd?");
  });

  it("opent een figuuranker in Alle cijfers", async () => {
    const { container } = await toonPagina("/#per-maand");
    await waitFor(() => expect(gekozen(container)).toBe("Door het jaar"));
    expect(container.querySelector(".gids")).toBeNull();
  });

  it("laat een gecorrigeerde link ook in de stappen zien", async () => {
    const { container } = await toonPagina("/?van=2027-03-01&stap=1");
    await waitFor(() => expect(container.querySelector(".gids")).not.toBeNull());
    const zichtbaar = container.querySelector("main:not([hidden])")!;
    await waitFor(() => expect(zichtbaar.textContent).toContain("Niet alles uit de link was bruikbaar"));
  });
});
