/**
 * The Lifecycle tab renders the twin of the software-development process: one
 * section per lifecycle stage, a row under every stage it observes (so cell
 * ids AND labels are scoped by stage — UI Bridge targets must be unambiguous
 * among mounted elements), and honest coverage: a planned row reads Planned /
 * Not built, a static claim never reads Live, a stage nothing probes says so
 * in words, and a probe still in flight reads "probing…", never a count.
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
  /** The UI Bridge registry: mounted element + label per id. */
  registry: new Map<string, { el: HTMLElement; label?: string }>(),
  /** Ids registered by two mounted elements at once. */
  duplicates: [] as string[],
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
  // An id resolves to the element its ref is attached to, only while mounted.
  useUIElement: ({ id, label }: { id: string; label?: string }) => ({
    ref: (el: HTMLElement | null) => {
      if (!el) {
        state.registry.delete(id);
        return;
      }
      const prior = state.registry.get(id);
      if (prior && prior.el !== el && prior.el.isConnected) {
        state.duplicates.push(id);
      }
      state.registry.set(id, { el, label });
    },
  }),
}));

import { LIFECYCLE_STAGES } from "../_lib/lifecycle";
import { manifest } from "../_lib/resolve";
import { catalogDeclaring } from "../_lib/test-catalog";
import { LifecycleView } from "./LifecycleView";

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

/** The stages at least one snapshot (live-probed) row observes. */
const PROBED_STAGES = LIFECYCLE_STAGES.map((s) => s.id).filter((stage) =>
  manifest.subspaces.some(
    (s) => s.query_kind === "snapshot" && s.stages.includes(stage)
  )
);

beforeEach(() => {
  state.probe = {
    data: probeAll({ deps: "blind" }),
    isLoading: false,
    isError: false,
    error: null,
  };
  state.catalog = undefined;
  state.registry.clear();
  state.duplicates = [];
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
      expect(state.registry.has(`digital-twin-stage-${stage.id}`)).toBe(true);
    }
  });

  it("scopes cell ids by stage, so a multi-stage row never duplicates an id", () => {
    const { container } = render(<LifecycleView />);
    const ids = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid]")
    ).map((el) => el.dataset.testid!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.duplicates).toEqual([]);
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

  it("gives every stage copy of a cell its own UI Bridge label", () => {
    render(<LifecycleView />);
    const labels = Array.from(state.registry.values()).map((v) => v.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(
      state.registry.get("digital-twin-stage-plan-cell-process_log")?.label
    ).toBe("Digital Twin sub-space cell: process_log (Plan stage)");
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

  it("says probing… — never a 0/N count or a not-answering bar — while the probe is in flight", () => {
    state.probe = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    };
    const { container } = render(<LifecycleView />);
    expect(PROBED_STAGES.length).toBeGreaterThan(0);
    for (const stage of PROBED_STAGES) {
      expect(
        within(stageSection(stage)).getByText("live-probed").parentElement,
        stage
      ).toHaveTextContent("probing…");
    }
    // No count reads as silence: no "0/N", and no bar segment claims a
    // probed row is "not answering" before any probe has returned.
    expect(container.textContent).not.toMatch(/\b0\/\d/);
    expect(container.querySelectorAll('[title*="not answering"]')).toHaveLength(
      0
    );
    // The in-flight probes get their own neutral segment instead.
    expect(
      container.querySelectorAll('[title$="probing…"]').length
    ).toBeGreaterThan(0);
    // A stage nothing probes still says so — that is a fact, not a pending one.
    expect(
      within(stageSection("intent")).getByText(/No live probe at this stage/)
    ).toBeInTheDocument();
  });

  it("opens the existing detail drawer from a stage cell, with the twin, stages and plan", () => {
    render(<LifecycleView />);
    fireEvent.click(
      screen.getByTestId("digital-twin-stage-plan-cell-process_log")
    );
    const drawer = within(screen.getByRole("dialog"));
    expect(drawer.getByText("Process twin")).toBeInTheDocument();
    expect(
      drawer.getByText("Plan, Implement, Integrate, Release, Learn")
    ).toBeInTheDocument();
    expect(
      drawer.getByText("2026-10-11-process-twin-event-log-and-flow-metrics")
    ).toBeInTheDocument();
    // What the row means on this page — not its raw query_kind.
    expect(drawer.getByText("On this page")).toBeInTheDocument();
    expect(
      drawer.getByText("Manifest claim (no coord tool)")
    ).toBeInTheDocument();
    expect(drawer.queryByText("Query kind")).toBeNull();
  });

  it("warns when coord is unreachable and still renders every stage from the manifest", () => {
    state.probe = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("connect ECONNREFUSED"),
    };
    const { container } = render(<LifecycleView />);
    expect(
      screen.getByText(
        /Could not reach the coordination layer: connect ECONNREFUSED/
      )
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll('section[data-testid^="digital-twin-stage-"]')
    ).toHaveLength(LIFECYCLE_STAGES.length);
    // The probe failed rather than being in flight: nothing reads "probing…",
    // and a probed stage says no live probe is answering.
    expect(screen.queryByText("probing…")).toBeNull();
    expect(
      within(stageSection("release")).getByText(
        "No live probe answering at this stage."
      )
    ).toBeInTheDocument();
  });

  it("renders one refused sub-space as its own Restricted cell, keeping the stages", () => {
    state.probe = {
      data: probeAll({ release: "restricted" }),
      isLoading: false,
      isError: false,
      error: null,
    };
    const { container } = render(<LifecycleView />);
    expect(screen.queryByText("Access restricted")).toBeNull();
    expect(
      container.querySelectorAll('section[data-testid^="digital-twin-stage-"]')
    ).toHaveLength(LIFECYCLE_STAGES.length);
    const release = screen.getByTestId(
      "digital-twin-stage-release-cell-release"
    );
    expect(release).toHaveTextContent("Restricted");
    expect(release).not.toHaveTextContent("Error");
    // A tenant-scoped cell beside it still answers.
    expect(
      screen.getByTestId("digital-twin-stage-learn-cell-memory")
    ).toHaveTextContent("Live");
    // The refused probe is its own bar segment, never "not answering", and it
    // leaves the stage's denominator: 6 of the 6 it may read answer.
    const stage = stageSection("release");
    expect(stage.querySelectorAll('[title*="not answering"]')).toHaveLength(0);
    expect(
      stage.querySelector('[title="1 restricted (not yours to read)"]')
    ).not.toBeNull();
    expect(
      within(stage).getByText("live-probed").parentElement
    ).toHaveTextContent("6/6");
  });

  it("says a twin is all restricted for you, never 0/0", () => {
    const environmentProbes = manifest.subspaces
      .filter((s) => s.query_kind === "snapshot" && s.twin === "environment")
      .map((s) => [s.id, "restricted" as const]);
    expect(environmentProbes.length).toBeGreaterThan(0);
    state.probe = {
      data: probeAll(Object.fromEntries(environmentProbes)),
      isLoading: false,
      isError: false,
      error: null,
    };
    const { container } = render(<LifecycleView />);
    expect(screen.getByText(/all restricted for you/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/(^|\D)0\/0(\D|$)/);
  });

  it("still says no probe is answering when a served report sits beside a silent one", () => {
    // implement: deps (blind — gradable, not answering) + worktree (a report).
    state.probe = {
      data: probeAll({ deps: "blind", worktree: "served" }),
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<LifecycleView />);
    expect(
      within(stageSection("implement")).getByText(
        "No live probe answering at this stage."
      )
    ).toBeInTheDocument();
  });

  it("counts a served report as its own segment, never as not answering", () => {
    state.probe = {
      data: probeAll({ worktree: "served" }),
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<LifecycleView />);
    const stage = stageSection("implement");
    expect(
      screen.getByTestId("digital-twin-stage-implement-cell-worktree")
    ).toHaveTextContent("Served");
    expect(stage.querySelectorAll('[title*="not answering"]')).toHaveLength(0);
    expect(
      stage.querySelector('[title="1 live-probed, a report (not graded)"]')
    ).not.toBeNull();
  });

  it("live-probes a row coord declares and says Not served by coord for one it does not", () => {
    const declared = manifest.subspaces
      .filter((s) => s.query_kind === "snapshot" && s.id !== "schema")
      .map((s) => s.id);
    state.catalog = catalogDeclaring(declared);
    state.probe = {
      data: {
        subspaces: declared.map((id) => ({ id, status: "implemented" })),
        probed: declared.length,
        restricted: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<LifecycleView />);
    expect(
      screen.getByTestId("digital-twin-stage-release-cell-schema")
    ).toHaveTextContent("Not served by coord");
    expect(
      screen.getByTestId("digital-twin-stage-operate-cell-outbound")
    ).toHaveTextContent("Live");
    // release: 7 snapshot rows, schema no longer declared — 6 of 6 live.
    expect(
      within(stageSection("release")).getByText("live-probed").parentElement
    ).toHaveTextContent("6/6");
  });

  it("shows the access notice instead of the stages only when every probe was refused", () => {
    const refused = probeAll(
      Object.fromEntries(
        manifest.subspaces
          .filter((s) => s.query_kind === "snapshot")
          .map((s) => [s.id, "restricted" as const])
      )
    );
    state.probe = {
      data: { ...refused, restricted: true },
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

describe("LifecycleView restriction (the split per qontinui-coord#3128)", () => {
  beforeEach(() => {
    state.probe = {
      data: probeAll(
        Object.fromEntries(
          [...SYSTEM_TENANT_SUBSPACES].map((id) => [id, "restricted" as const])
        )
      ),
      isLoading: false,
      isError: false,
      error: null,
    };
  });

  it("keeps restricted probes out of the live counts and names them apart", () => {
    render(<LifecycleView />);
    // Every snapshot row at the release stage is SystemTenant-scoped.
    const release = stageSection("release");
    expect(release).toHaveTextContent(
      "Every live probe at this stage is restricted for this tenant."
    );
    expect(release).toHaveTextContent("live-probed · 7 restricted");
    // No probe answered because none was allowed to: the live count is a dash,
    // never a 0 that reads as "nothing answered".
    const liveCount = within(release)
      .getByText("live-probed · 7 restricted")
      .parentElement!.querySelector("dd")!;
    expect(liveCount).toHaveTextContent(/^—$/);
    expect(liveCount).not.toHaveTextContent("0");
    expect(release).not.toHaveTextContent("No live probe answering");
    // The access legend entry shows only when something is restricted.
    expect(screen.getByText("restricted (access)")).toBeInTheDocument();
    // Twin cards: the environment twin is wholly refused; the process twin's
    // two probes answer, with nothing restricted to report.
    expect(screen.getByText(/^9 restricted · /)).toBeInTheDocument();
    expect(screen.getByText(/^2\/2 live-probed · /)).toBeInTheDocument();
  });
});
