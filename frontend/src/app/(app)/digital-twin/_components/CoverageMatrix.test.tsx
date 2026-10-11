/**
 * The Completeness matrix's two gauges say what kind of number each one is.
 * The live gauge counts probe answers, fills with the live green, and reads
 * "probing…" while the probe is in flight rather than a 0/N that looks like
 * silence. The built gauge counts manifest CLAIMS, so it is labelled a claim
 * and fills with the claim colour — never the live green.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubspaceProbe, SubspacesProbeResponse } from "../_lib/types";

const state = vi.hoisted(() => ({
  probe: {
    data: undefined as SubspacesProbeResponse | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("../_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => state.probe,
}));
vi.mock("../_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));

import { manifest } from "../_lib/resolve";
import { COUNT_FILLS } from "../_lib/status-presentation";
import { CoverageMatrix } from "./CoverageMatrix";

const SNAPSHOT_IDS = manifest.subspaces
  .filter((s) => s.query_kind === "snapshot")
  .map((s) => s.id);
const CLAIMED_BUILT = manifest.subspaces.filter(
  (s) => s.research_status === "implemented" || s.research_status === "partial"
).length;

/** The fill bar inside the gauge with `testId`. */
function gaugeFill(testId: string): HTMLElement {
  const fill = screen
    .getByTestId(testId)
    .querySelector<HTMLElement>('[data-slot="gauge-fill"]');
  if (!fill) throw new Error(`${testId} renders no fill`);
  return fill;
}

function expectFilledWith(fill: HTMLElement, classes: string) {
  for (const c of classes.split(" ")) expect(fill).toHaveClass(c);
}

beforeEach(() => {
  // Every snapshot probe answers except deps, which is blind.
  const subspaces: SubspaceProbe[] = SNAPSHOT_IDS.map((id) => ({
    id,
    status: id === "deps" ? "blind" : "implemented",
  }));
  state.probe = {
    data: { subspaces, probed: subspaces.length, restricted: false },
    isLoading: false,
    isError: false,
    error: null,
  };
});

describe("CoverageMatrix gauges", () => {
  it("labels the built gauge a manifest claim and fills it with the claim colour", () => {
    render(<CoverageMatrix />);
    const built = screen.getByTestId("digital-twin-gauge-built");
    expect(built).toHaveTextContent("sub-spaces built (manifest claim)");
    expect(built).toHaveTextContent(
      `${CLAIMED_BUILT}/${manifest.subspaces.length}`
    );
    const fill = gaugeFill("digital-twin-gauge-built");
    expectFilledWith(fill, COUNT_FILLS.claim);
    expect(fill).not.toHaveClass(COUNT_FILLS.live);
  });

  it("counts the answering probes on the live gauge and fills it with the live colour", () => {
    render(<CoverageMatrix />);
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${SNAPSHOT_IDS.length - 1}/${SNAPSHOT_IDS.length}`
    );
    expectFilledWith(gaugeFill("digital-twin-gauge-live"), COUNT_FILLS.live);
  });

  it("says probing… on the live gauge while the probe is in flight, never 0/N", () => {
    state.probe = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    };
    render(<CoverageMatrix />);
    const live = screen.getByTestId("digital-twin-gauge-live");
    expect(live).toHaveTextContent("probing…");
    expect(live.textContent).not.toMatch(/\d\/\d/);
    expect(gaugeFill("digital-twin-gauge-live").style.width).toBe("0%");
    // The built gauge is a static claim; it does not wait for the probe.
    expect(screen.getByTestId("digital-twin-gauge-built")).toHaveTextContent(
      `${CLAIMED_BUILT}/${manifest.subspaces.length}`
    );
  });
});
