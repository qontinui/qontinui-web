/**
 * The Completeness matrix's two gauges say what kind of number each one is.
 * The live gauge counts probe answers, fills with the live green, and reads
 * "probing…" while the probe is in flight rather than a 0/N that looks like
 * silence. The built gauge counts manifest CLAIMS, so it is labelled a claim
 * and fills with the claim colour — never the live green.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SubspaceProbe,
  SubspacesProbeResponse,
  TwinCatalogResponse,
} from "../_lib/types";

const state = vi.hoisted(() => ({
  probe: {
    data: undefined as SubspacesProbeResponse | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  /** coord's served catalog; `undefined` = not read (the manifest stands in). */
  catalog: undefined as TwinCatalogResponse | undefined,
}));

vi.mock("../_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => state.probe,
}));
vi.mock("../_hooks/useTwinCatalog", () => ({
  useTwinCatalog: () => ({
    data: state.catalog,
    isLoading: false,
    isError: false,
    error: null,
  }),
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
import { MANIFEST_SNAPSHOT_IDS, catalogDeclaring } from "../_lib/test-catalog";
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
  state.catalog = undefined;
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

/** A probe response: every id answers `implemented` unless overridden. */
function probesFor(
  ids: readonly string[],
  overrides: Record<string, SubspaceProbe> = {},
  restricted = false
): SubspacesProbeResponse {
  const subspaces: SubspaceProbe[] = ids.map(
    (id) => overrides[id] ?? { id, status: "implemented" }
  );
  return { subspaces, probed: subspaces.length, restricted };
}

function setProbe(data: SubspacesProbeResponse) {
  state.probe = { data, isLoading: false, isError: false, error: null };
}

describe("CoverageMatrix per-cell access", () => {
  it("renders one refused sub-space as its own Restricted cell, never the access notice", () => {
    setProbe(
      probesFor(SNAPSHOT_IDS, {
        release: { id: "release", status: "restricted" },
      })
    );
    render(<CoverageMatrix />);
    expect(screen.queryByText("Access restricted")).toBeNull();
    const release = screen.getByTestId("digital-twin-cell-release");
    expect(release).toHaveTextContent("Restricted");
    expect(release).not.toHaveTextContent("Error");
    expect(release.getAttribute("title")).toContain("Qontinui-internal");
    // A refused sub-space is not an observer that failed to respond.
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${SNAPSHOT_IDS.length - 1}/${SNAPSHOT_IDS.length - 1}`
    );
    expect(screen.getByTestId("digital-twin-gauge-notes")).toHaveTextContent(
      "1 restricted (not yours to read)"
    );
    // The operator's other cells stay live beside it.
    expect(screen.getByTestId("digital-twin-cell-memory")).toHaveTextContent(
      "Live"
    );
  });

  it("shows the whole-view access notice only when every probe was refused", () => {
    const all = Object.fromEntries(
      SNAPSHOT_IDS.map((id) => [id, { id, status: "restricted" as const }])
    );
    setProbe(probesFor(SNAPSHOT_IDS, all, true));
    render(<CoverageMatrix />);
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
  });

  it("keeps answered cells visible even when the matrix is flagged restricted", () => {
    setProbe(
      probesFor(
        SNAPSHOT_IDS,
        { release: { id: "release", status: "restricted" } },
        true
      )
    );
    render(<CoverageMatrix />);
    expect(screen.queryByText("Access restricted")).toBeNull();
    expect(screen.getByTestId("digital-twin-cell-schema")).toHaveTextContent(
      "Live"
    );
  });
});

describe("CoverageMatrix joined to coord's catalog", () => {
  it("renders the envelope door and a report door as live cells", () => {
    state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
    setProbe(
      probesFor(MANIFEST_SNAPSHOT_IDS, {
        outbound: {
          id: "outbound",
          status: "partial",
          door_shape: "envelope",
          metrics: {
            coverage: 0.6,
            credibility: 0.9,
            posterior: null,
            staleness_seconds: null,
            provenance: "outbound_budget_observations",
            drift_class: "none",
          },
        },
        worktree: { id: "worktree", status: "served", door_shape: "report" },
      })
    );
    render(<CoverageMatrix />);
    const outbound = screen.getByTestId("digital-twin-cell-outbound");
    expect(outbound).toHaveTextContent("Partial");
    expect(outbound).toHaveTextContent("cov 60%");
    const worktree = screen.getByTestId("digital-twin-cell-worktree");
    expect(worktree).toHaveTextContent("Served");
    expect(worktree).not.toHaveTextContent("Partial");
    // The report door is probed, but it is not counted as an observer that
    // is not responding: it leaves the live gauge's denominator.
    const graded = MANIFEST_SNAPSHOT_IDS.length - 1;
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${graded}/${graded}`
    );
    expect(screen.getByTestId("digital-twin-gauge-notes")).toHaveTextContent(
      "1 served (a report, not graded)"
    );
    // The outbound drawer shows the envelope the probe carried: there is no
    // twin-door raw read for an admin door.
    fireEvent.click(outbound);
    const drawer = within(screen.getByRole("dialog"));
    expect(drawer.getByTestId("digital-twin-drawer-summary")).toHaveTextContent(
      "Coverage 60%, credibility 90%"
    );
    expect(drawer.getByText("Live credibility envelope")).toBeInTheDocument();
  });

  it("names a probe coord declares that the manifest has no row for", () => {
    const catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
    catalog.entries.push({
      ...catalog.entries[0]!,
      id: "zz_new",
      subspace: "zz_new",
    });
    state.catalog = catalog;
    setProbe(probesFor([...MANIFEST_SNAPSHOT_IDS, "zz_new"]));
    render(<CoverageMatrix />);
    expect(
      screen.getByTestId("digital-twin-unlisted-probes")
    ).toHaveTextContent(
      "Declared by coord, not in this page's taxonomy: zz_new"
    );
  });

  it("says Not served by coord for a snapshot row coord does not declare", () => {
    const declared = MANIFEST_SNAPSHOT_IDS.filter((id) => id !== "schema");
    state.catalog = catalogDeclaring(declared);
    setProbe(probesFor(declared));
    render(<CoverageMatrix />);
    const schema = screen.getByTestId("digital-twin-cell-schema");
    expect(schema).toHaveTextContent("Not served by coord");
    expect(schema).not.toHaveTextContent("Error");
    // The live gauge counts only what coord declares.
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${declared.length}/${declared.length}`
    );
  });
});
