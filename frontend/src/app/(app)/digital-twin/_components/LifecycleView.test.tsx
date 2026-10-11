/**
 * The Lifecycle tab renders the twin of the software-development process: one
 * section per lifecycle stage, a row under every stage it observes (so cell
 * ids are scoped by stage — UI Bridge ids must be unique among mounted
 * elements), and honest coverage: a planned row reads Planned / Not built, a
 * static claim never reads Live, and a stage nothing probes says so in words.
 */

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubspaceProbe, SubspacesProbeResponse } from "../_lib/types";

const state = vi.hoisted(() => ({
  probe: {
    data: undefined as SubspacesProbeResponse | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  uiIds: [] as string[],
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
  useUIElement: ({ id }: { id: string }) => {
    state.uiIds.push(id);
    return { ref: () => {} };
  },
}));

import { LIFECYCLE_STAGES } from "../_lib/lifecycle";
import { manifest } from "../_lib/resolve";
import { LifecycleView } from "./LifecycleView";

/** Every snapshot row answers `implemented` unless overridden. */
function probeAll(
  overrides: Record<string, SubspaceProbe["status"]> = {}
): SubspacesProbeResponse {
  const subspaces: SubspaceProbe[] = manifest.subspaces
    .filter((s) => s.query_kind === "snapshot")
    .map((s) => ({ id: s.id, status: overrides[s.id] ?? "implemented" }));
  return { subspaces, probed: subspaces.length, restricted: false };
}

function stageSection(stage: string): HTMLElement {
  return screen.getByTestId(`digital-twin-stage-${stage}`);
}

beforeEach(() => {
  state.probe = {
    data: probeAll({ deps: "blind" }),
    isLoading: false,
    isError: false,
    error: null,
  };
  state.uiIds = [];
});

describe("LifecycleView", () => {
  it("renders one section per lifecycle stage, in lifecycle order", () => {
    const { container } = render(<LifecycleView />);
    const sections = Array.from(
      container.querySelectorAll<HTMLElement>(
        'section[data-testid^="digital-twin-stage-"]'
      )
    ).map((s) => s.dataset.testid);
    expect(sections).toEqual(
      LIFECYCLE_STAGES.map((s) => `digital-twin-stage-${s.id}`)
    );
    // Each stage registers with the UI Bridge under its own id.
    for (const stage of LIFECYCLE_STAGES) {
      expect(state.uiIds).toContain(`digital-twin-stage-${stage.id}`);
    }
  });

  it("scopes cell ids by stage, so a multi-stage row never duplicates an id", () => {
    const { container } = render(<LifecycleView />);
    const ids = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid]")
    ).map((el) => el.dataset.testid!);
    expect(new Set(ids).size).toBe(ids.length);
    // The matrix's unscoped ids are not mounted by this view.
    expect(ids.filter((id) => id.startsWith("digital-twin-cell-"))).toEqual([]);
    // A row observing five stages renders once under each of them.
    const processLog = manifest.subspaces.find((s) => s.id === "process_log")!;
    for (const stage of processLog.stages) {
      expect(
        within(stageSection(stage)).getByTestId(
          `digital-twin-stage-${stage}-cell-process_log`
        )
      ).toBeInTheDocument();
    }
  });

  it("renders planned and not-built rows as Planned / Not built", () => {
    render(<LifecycleView />);
    expect(
      screen.getByTestId("digital-twin-stage-verify-cell-test")
    ).toHaveTextContent("Planned");
    expect(
      screen.getByTestId("digital-twin-stage-verify-cell-cloud_audit")
    ).toHaveTextContent("Not built");
  });

  it("keeps Live for probe answers and labels unprobed rows as claims", () => {
    render(<LifecycleView />);
    // A snapshot row the probe answered.
    expect(
      screen.getByTestId("digital-twin-stage-release-cell-schema")
    ).toHaveTextContent("Live");
    // A built row with no coord tool: a claim, never Live.
    const dom = screen.getByTestId("digital-twin-stage-verify-cell-dom");
    expect(dom).toHaveTextContent("Built · unprobed");
    expect(dom).not.toHaveTextContent("Live");
    // A built row a coord tool answers on demand.
    expect(
      screen.getByTestId("digital-twin-stage-plan-cell-gates")
    ).toHaveTextContent("Built · ask it");
    // A built row whose coord tool Ask the Twin cannot call says so.
    const cost = screen.getByTestId("digital-twin-stage-operate-cell-cost");
    expect(cost).toHaveTextContent("Built · not askable here");
    expect(cost).not.toHaveTextContent("Built · ask it");
  });

  it("counts live probes per stage and says so when a stage has none", () => {
    render(<LifecycleView />);
    // release: 7 snapshot rows, deps blind → 6 of 7 answering.
    const release = within(stageSection("release"));
    expect(release.getByText("live-probed").parentElement).toHaveTextContent(
      "6/7"
    );
    // intent: nothing at this stage is probed.
    expect(
      within(stageSection("intent")).getByText(/No live probe at this stage/)
    ).toBeInTheDocument();
  });

  it("shows the access notice instead of the stages when restricted", () => {
    state.probe = {
      data: { subspaces: [], probed: 0, restricted: true },
      isLoading: false,
      isError: false,
      error: null,
    };
    const { container } = render(<LifecycleView />);
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid^="digital-twin-stage-"]')
    ).toBeNull();
  });
});
