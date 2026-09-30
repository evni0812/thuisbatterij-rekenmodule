// @vitest-environment jsdom
/**
 * Bewaren: één melding tegelijk met een eigen timer, en de wisknop vraagt
 * eerst om een tweede klik.
 */
import { cleanup, fireEvent, render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bewaren } from "../components/Bewaren";
import { STANDAARD } from "../lib/configuratie";
import { bewaarLaatste, leesLaatste, wisOpslag } from "../lib/opslag";

beforeEach(() => {
  wisOpslag();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function toon(laatsteBewaard: string | null = null) {
  const onLaatste = vi.fn();
  const onProfielen = vi.fn();
  const r = render(
    <Bewaren
      inst={STANDAARD}
      profielen={[]}
      onProfielen={onProfielen}
      laatsteBewaard={laatsteBewaard}
      onLaatste={onLaatste}
      onLaad={() => {}}
    />,
  );
  return { ...r, onLaatste, onProfielen };
}

describe("de meldingen", () => {
  it("laat een tweede melding niet door de timer van de eerste wegnemen", () => {
    const { getByText, queryByRole, container } = toon();
    fireEvent.click(getByText("Onthoud mijn instellingen"));
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/^Bewaard/);
    act(() => void vi.advanceTimersByTime(2000));
    fireEvent.click(getByText("Onthoud mijn instellingen"));
    // 4 seconden na de eerste, 2 na de tweede: de tweede staat er nog.
    act(() => void vi.advanceTimersByTime(2000));
    expect(queryByRole("status")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1500));
    expect(queryByRole("status")).toBeNull();
  });

  it("zet geen state meer na het verdwijnen van het onderdeel", () => {
    const fout = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByText, unmount } = toon();
    fireEvent.click(getByText("Onthoud mijn instellingen"));
    unmount();
    act(() => void vi.advanceTimersByTime(5000));
    expect(vi.getTimerCount()).toBe(0);
    expect(fout).not.toHaveBeenCalled();
  });
});

describe("bewaarde instellingen wissen", () => {
  beforeEach(() => {
    bewaarLaatste(STANDAARD);
  });

  it("noemt de knop naar wat hij doet, en toont hem alleen als er iets bewaard is", () => {
    const zonder = toon(null);
    expect(zonder.queryByText("Wis bewaarde instellingen")).toBeNull();
    cleanup();
    const met = toon("2026-09-01T10:00:00.000Z");
    expect(met.getByText("Wis bewaarde instellingen")).not.toBeNull();
    expect(met.queryByText("Vergeet")).toBeNull();
  });

  it("wist pas bij de tweede klik", () => {
    const { getByText, onLaatste, queryByText } = toon("2026-09-01T10:00:00.000Z");
    fireEvent.click(getByText("Wis bewaarde instellingen"));
    expect(leesLaatste()).not.toBeNull();
    expect(onLaatste).not.toHaveBeenCalled();
    fireEvent.click(getByText("Zeker weten? Klik nogmaals"));
    expect(leesLaatste()).toBeNull();
    expect(onLaatste).toHaveBeenCalledWith(null);
    expect(queryByText("Bewaarde instellingen gewist.")).not.toBeNull();
  });

  it("vraagt opnieuw om bevestiging als je even wacht", () => {
    const { getByText, onLaatste } = toon("2026-09-01T10:00:00.000Z");
    fireEvent.click(getByText("Wis bewaarde instellingen"));
    act(() => void vi.advanceTimersByTime(6000));
    fireEvent.click(getByText("Wis bewaarde instellingen"));
    expect(leesLaatste()).not.toBeNull();
    expect(onLaatste).not.toHaveBeenCalled();
  });

  it("vraagt opnieuw om bevestiging als de focus weggaat", () => {
    const { getByText } = toon("2026-09-01T10:00:00.000Z");
    fireEvent.click(getByText("Wis bewaarde instellingen"));
    fireEvent.blur(getByText("Zeker weten? Klik nogmaals"));
    expect(getByText("Wis bewaarde instellingen")).not.toBeNull();
  });
});
