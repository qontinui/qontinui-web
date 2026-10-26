/**
 * Provenance (plan `2026-10-23-console-presentation-spaces` D1, "provenance
 * on"): the source and as-of beside a number in presentation mode — UNKNOWN,
 * never blank, when either is missing — and an age that keeps advancing.
 */

import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import { FixedPresentationMode } from "./PresentationModeProvider";
import { PRESENTATION_CLOCK_TICK_MS } from "./presentationClock";
import {
  PROVENANCE_UNKNOWN,
  Provenance,
  provenanceInstant,
} from "./Provenance";

const NOW = new Date("2026-10-23T12:00:00Z");

function presenting(ui: ReactNode) {
  return render(<FixedPresentationMode presenting>{ui}</FixedPresentationMode>);
}

function chip() {
  return document.querySelector("[data-provenance]");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Provenance", () => {
  it("renders nothing in operator mode", () => {
    const { container } = render(
      <FixedPresentationMode presenting={false}>
        <Provenance source="coord fleet health" asOf={NOW} />
      </FixedPresentationMode>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders in operator mode too when persistent", () => {
    render(<Provenance source="coord fleet health" asOf={NOW} persistent />);
    expect(chip()).not.toBeNull();
  });

  it("states the source and the age", () => {
    vi.useFakeTimers({ now: NOW });
    presenting(
      <Provenance
        source="coord fleet health"
        asOf={new Date(NOW.getTime() - 3 * 60_000).toISOString()}
      />
    );
    expect(chip()).toHaveTextContent(
      "source: coord fleet health · as of 3m ago"
    );
    expect(chip()).toHaveAttribute("data-provenance-known", "true");
    expect(chip()?.className).not.toContain("bg-amber");
  });

  it("says UNKNOWN for a missing source — on the ignorance-floor amber", () => {
    presenting(<Provenance source={null} asOf={NOW} />);
    expect(chip()).toHaveTextContent(`source: ${PROVENANCE_UNKNOWN}`);
    expect(chip()).toHaveAttribute("data-provenance-known", "false");
    for (const cls of UNKNOWN_AMBER.split(" ")) {
      expect(chip()?.className).toContain(cls);
    }
  });

  it("says UNKNOWN for a blank source, never a blank", () => {
    presenting(<Provenance source="   " asOf={NOW} />);
    expect(chip()).toHaveTextContent(`source: ${PROVENANCE_UNKNOWN}`);
  });

  it("says UNKNOWN for a missing or unparseable time", () => {
    const { rerender } = presenting(
      <Provenance source="coord" asOf={undefined} />
    );
    expect(chip()).toHaveTextContent(`as of ${PROVENANCE_UNKNOWN}`);
    rerender(
      <FixedPresentationMode presenting>
        <Provenance source="coord" asOf="not a time" />
      </FixedPresentationMode>
    );
    expect(chip()).toHaveTextContent(`as of ${PROVENANCE_UNKNOWN}`);
    expect(chip()).toHaveAttribute("data-provenance-known", "false");
  });

  it("keeps the age advancing on the shared clock", () => {
    vi.useFakeTimers({ now: NOW });
    presenting(<Provenance source="coord" asOf={NOW.toISOString()} />);
    expect(chip()).toHaveTextContent("as of under a minute ago");
    act(() => {
      vi.advanceTimersByTime(4 * PRESENTATION_CLOCK_TICK_MS);
    });
    expect(chip()).toHaveTextContent("as of 1m ago");
  });

  it("never states a seconds count the 15-second tick would leave behind", () => {
    vi.useFakeTimers({ now: NOW });
    presenting(
      <Provenance
        source="coord"
        asOf={new Date(NOW.getTime() - 59_000).toISOString()}
      />
    );
    expect(chip()).toHaveTextContent("as of under a minute ago");
    expect(chip()?.textContent).not.toMatch(/\d+s ago/);
  });

  it("states the instant on the server, and hydrates without a mismatch", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const ui = (
      <FixedPresentationMode presenting>
        <Provenance
          source="coord"
          asOf={new Date(NOW.getTime() - 3 * 60_000).toISOString()}
        />
      </FixedPresentationMode>
    );
    const html = renderToString(ui);
    // UTC, to the minute: the same text on any server and in any browser.
    // (`<!-- -->` is React's separator between adjacent text nodes.)
    const text = html.replace(/<!-- -->/g, "");
    expect(text).toContain("as of 2026-10-23 11:57 UTC");
    expect(text).toContain(
      'title="Source: coord. As of 2026-10-23 11:57 UTC."'
    );
    expect(text).not.toContain("ago");

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, ui);
    });
    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelector("[data-provenance]")).toHaveTextContent(
      "as of 3m ago"
    );
    errors.mockRestore();
    act(() => root?.unmount());
    container.remove();
  });

  it("names the absolute time in its title", () => {
    presenting(<Provenance source="coord" asOf={NOW} />);
    expect(chip()?.getAttribute("title")).toContain("Source: coord.");
    expect(chip()?.getAttribute("title")).toMatch(
      /^Source: coord\. As of .+\.$/
    );
  });

  it("is findable by its source text", () => {
    presenting(<Provenance source="coord fleet health" asOf={NOW} />);
    expect(screen.getByText("source: coord fleet health")).toBeInTheDocument();
  });
});

describe("provenanceInstant", () => {
  it("accepts ISO strings, epoch milliseconds and Dates", () => {
    expect(provenanceInstant("2026-10-23T12:00:00Z")).toBe(NOW.toISOString());
    expect(provenanceInstant(NOW.getTime())).toBe(NOW.toISOString());
    expect(provenanceInstant(NOW)).toBe(NOW.toISOString());
  });

  it("rejects what names no instant", () => {
    for (const bad of [null, undefined, "", "  ", "yesterday", Number.NaN]) {
      expect(provenanceInstant(bad), String(bad)).toBeNull();
    }
    expect(provenanceInstant(new Date("nope"))).toBeNull();
  });
});
