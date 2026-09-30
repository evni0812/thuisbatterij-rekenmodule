// @vitest-environment jsdom
/**
 * De pagina rond de URL: een vreemde `?tab=` crasht niet, de terugknop volgt de
 * tabbladen, en een periode buiten de data wordt geklemd en gemeld.
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
    "crasht niet op ?tab=%s en opent het standaardtabblad",
    async (naam) => {
      const { container } = await toonPagina(`/?tab=${naam}`);
      expect(gekozen(container)).toBe("Uitkomst");
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
    const { container } = await toonPagina("/");
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

  it("maakt van invoer wijzigen geen stap in de geschiedenis", async () => {
    const { container } = await toonPagina("/");
    await waitFor(() => expect(gekozen(container)).toBe("Uitkomst"));
    const lengte = window.history.length;
    const afname = container.querySelector<HTMLInputElement>('input[aria-describedby="afname-hint"]')!;
    for (const v of ["3000", "3100", "3200"]) {
      fireEvent.focus(afname);
      fireEvent.change(afname, { target: { value: v } });
      fireEvent.blur(afname);
    }
    await waitFor(() => expect(window.location.search).toBe("?af=3200"));
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
    await waitFor(() => expect(window.location.search).toBe(""));
  });
});
