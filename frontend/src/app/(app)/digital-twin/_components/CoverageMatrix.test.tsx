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
/** The snapshot sub-spaces coord refuses to a non-system tenant (per qontinui-coord#3128). */
const SYSTEM_TENANT_SUBSPACES = new Set([
  "release",
  "schema",
  "infra",
  "infra_health",
  "config",
  "health",
  "deps",
  "route_serving",
  "client_telemetry",
]);

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

describe("CoverageMatrix restriction", () => {
  // coord 403s a SystemTenant-scoped cell for a non-system tenant while the
  // tenant's other cells answer (per qontinui-coord#3128). The backend raises the
  // grid-level `restricted` flag only when EVERY probed cell is restricted, so
  // one restricted cell must render as that cell — not hide the whole grid.
  it("renders the grid with one restricted cell and no access notice when only one cell is restricted", () => {
    const restrictedId = SNAPSHOT_IDS[0];
    const subspaces: SubspaceProbe[] = SNAPSHOT_IDS.map((id) => ({
      id,
      status: id === restrictedId ? "restricted" : "implemented",
    }));
    state.probe = {
      data: { subspaces, probed: subspaces.length, restricted: false },
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<CoverageMatrix />);

    expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
    for (const id of SNAPSHOT_IDS) {
      expect(screen.getByTestId(`digital-twin-cell-${id}`)).toBeInTheDocument();
    }
    expect(
      screen.getByTestId(`digital-twin-cell-${restrictedId}`)
    ).toHaveTextContent("Restricted");
    expect(
      screen.getByTestId(`digital-twin-cell-${SNAPSHOT_IDS[1]}`)
    ).not.toHaveTextContent("Restricted");
  });

  it("counts restricted cells beside the live gauge, never in its denominator", () => {
    // The split per qontinui-coord#3128: nine SystemTenant cells refused, two answer.
    const subspaces: SubspaceProbe[] = SNAPSHOT_IDS.map((id) => ({
      id,
      status: SYSTEM_TENANT_SUBSPACES.has(id) ? "restricted" : "implemented",
    }));
    state.probe = {
      data: { subspaces, probed: subspaces.length, restricted: false },
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<CoverageMatrix />);

    const live = screen.getByTestId("digital-twin-gauge-live");
    expect(live).toHaveTextContent("2/2");
    expect(live).not.toHaveTextContent(`2/${SNAPSHOT_IDS.length}`);
    expect(live).toHaveTextContent("· 9 restricted");
    expect(gaugeFill("digital-twin-gauge-live").style.width).toBe("100%");
  });

  it("names no restricted count when nothing is restricted", () => {
    render(<CoverageMatrix />);
    expect(screen.getByTestId("digital-twin-gauge-live")).not.toHaveTextContent(
      "restricted"
    );
  });

  it("shows the access notice instead of the grid when every cell is restricted", () => {
    const subspaces: SubspaceProbe[] = SNAPSHOT_IDS.map((id) => ({
      id,
      status: "restricted",
    }));
    state.probe = {
      data: { subspaces, probed: subspaces.length, restricted: true },
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<CoverageMatrix />);

    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`digital-twin-cell-${SNAPSHOT_IDS[0]}`)
    ).not.toBeInTheDocument();
  });
});
