/**
 * Provenance (plan `2026-10-23-console-presentation-spaces` D1, "provenance
 * on"): the source and as-of beside a number in presentation mode — UNKNOWN,
 * never blank, when either is missing — and an age that keeps advancing.
 */

import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
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
    expect(chip()).toHaveTextContent("as of 0s ago");
    act(() => {
      vi.advanceTimersByTime(4 * PRESENTATION_CLOCK_TICK_MS);
    });
    expect(chip()).toHaveTextContent("as of 1m ago");
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
