import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  InitiativeRead,
  MetricRead,
  ObjectivesRead,
  SourceRead,
} from "../_lib/objectives-api";

/**
 * The Objectives page against a mocked read: the sentences the page itself
 * composes about what could not be read (plan
 * `2026-10-06-overview-objectives-view` D1). An initiative that can't be read
 * shows why, never "declares no objectives"; an objective no shown measure
 * serves says no READABLE one declares it while some measure can't be read,
 * and unknown while coord's document list came back incomplete; a measure
 * published to the wrong project is called that, never missing.
 */

const mocks = vi.hoisted(() => ({ read: null as ObjectivesRead | null }));

vi.mock("../_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({
    projectId: "p1",
    hold: false,
    tenantsError: null,
    viewerId: "u1",
  }),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useCanEdit: () => false,
}));
vi.mock("../_hooks/useObjectives", () => ({
  useObjectives: () => ({
    objectives: { state: "ready", read: mocks.read },
    reload: vi.fn(),
  }),
}));
// A card's editor and markdown renderer have their own tests; stand them in
// so this one is about what the page SAYS.
vi.mock("@/components/overview/editing/EditableSection", () => ({
  EditableSection: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/overview/MarkdownView", () => ({
  MarkdownView: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../_lib/metric-text-api", () => ({ saveMetricText: vi.fn() }));

import OverviewObjectivesPage from "./page";

const OK: SourceRead = {
  status: "ok",
  reason: null,
  affected: [],
  details: {},
};

function degraded(reason: string, affected: string[] = []): SourceRead {
  return { status: "degraded", reason, affected, details: {} };
}

function metric(overrides: Partial<MetricRead> = {}): MetricRead {
  return {
    name: "example-measure",
    title: "Example measure",
    state: "authored",
    version: 2,
    updated_at: null,
    updated_by: null,
    overview_order: null,
    body: "# Example measure\n\nProse.",
    error: null,
    frontmatter_error: null,
    field_errors: {},
    frontmatter_warnings: [],
    metric: null,
    unit: null,
    baseline: null,
    baseline_text: null,
    baseline_as_of: null,
    target: null,
    target_text: null,
    ceiling: null,
    ceiling_text: null,
    floor: null,
    floor_text: null,
    direction: null,
    direction_text: null,
    serves: [],
    serves_unknown: [],
    serves_unchecked: [],
    report_topic: null,
    structured_reporting_since: null,
    source_query_type: "absent",
    checkpoints: [],
    checkpoints_text: null,
    checkpoint_list_complete: true,
    criteria: [],
    results: [],
    extra_fields: [],
    findings_read: "ok",
    checkpoint_results_read: "ok",
    checkpoint_results: [],
    criteria_latest: [],
    tally_latest: { met: 0, missed: 0, unknown: 0 },
    related_notes: [],
    unresolved_results: [],
    current_value: {
      status: "not_measured",
      source_query_type: "absent",
      reason: "This measure has no source coord can run.",
    },
    ...overrides,
  };
}

function initiative(overrides: Partial<InitiativeRead> = {}): InitiativeRead {
  return {
    name: "current-initiative",
    title: "Current initiative",
    state: "authored",
    version: 3,
    updated_at: null,
    updated_by: null,
    error: null,
    status: "live",
    live: true,
    starts: null,
    ends: null,
    objectives: [],
    success_metrics: [],
    missing_metric_names: [],
    frontmatter_error: null,
    field_errors: {},
    frontmatter_warnings: [],
    ...overrides,
  };
}

function read(overrides: Partial<ObjectivesRead> = {}): ObjectivesRead {
  return {
    tenant_id: "t",
    generated_at: "2026-10-09T12:00:00Z",
    initiatives: [],
    earlier_initiatives_count: 0,
    objectives_readable: true,
    document_list_complete: true,
    metrics: [],
    initiative_named_metrics: [],
    other_metrics: [],
    skeletons_hidden: 0,
    void_metric_names: [],
    void_initiative_names: [],
    sources: {
      intent_documents: OK,
      findings: OK,
      findings_by_id: OK,
      checkpoint_results: OK,
    },
    ...overrides,
  };
}

const GOAL = { id: "goal-a", text: "Goal A", metric_names: [] };

function renderPage(r: ObjectivesRead) {
  mocks.read = r;
  return render(<OverviewObjectivesPage />);
}

/** The objective's own group: its heading's section. */
function objectiveGroup(heading: string): HTMLElement {
  return screen.getByRole("heading", { name: heading }).closest("section")!;
}

afterEach(() => {
  cleanup();
  mocks.read = null;
});

describe("an initiative that can't be read declares nothing", () => {
  it("shows an in_scope it could not read, never 'declares no objectives'", () => {
    renderPage(
      read({
        objectives_readable: false,
        initiatives: [
          initiative({
            field_errors: {
              in_scope: "in_scope must be a list of {id, text}.",
            },
          }),
        ],
        sources: {
          ...read().sources,
          intent_documents: degraded(
            "The project's objectives can't be read: initiative/current-initiative: its in_scope could not be read (in_scope must be a list of {id, text})"
          ),
        },
      })
    );
    expect(
      screen.getByText(
        "Which objectives this initiative declares can't be read: in_scope must be a list of {id, text}."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/declares no objectives/)).toBeNull();
  });

  it("shows a document nobody could read with its error, and nothing it might declare", () => {
    renderPage(
      read({
        objectives_readable: false,
        initiatives: [
          initiative({
            state: "unreadable",
            error: "coord answered HTTP 500",
            status: null,
            live: false,
          }),
        ],
        sources: {
          ...read().sources,
          intent_documents: degraded(
            "The project's objectives can't be read: initiative/current-initiative could not be read (coord answered HTTP 500)"
          ),
        },
      })
    );
    expect(
      screen.getByText(
        "This initiative can't be read, so whether it is live and which objectives it declares are unknown: coord answered HTTP 500"
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/declares no objectives/)).toBeNull();
    expect(screen.queryByText(/Status not declared/)).toBeNull();
  });

  it("shows a success_metrics it could not read on the initiative, its objectives still read", () => {
    renderPage(
      read({
        initiatives: [
          initiative({
            objectives: [GOAL],
            field_errors: {
              success_metrics: "success_metrics must be a list of names.",
            },
          }),
        ],
      })
    );
    expect(
      screen.getByText(
        "Which measures this initiative names can't be read: success_metrics must be a list of names."
      )
    ).toBeInTheDocument();
    expect(objectiveGroup("Goal A")).toBeInTheDocument();
    expect(screen.queryByText(/objectives can.t be read/)).toBeNull();
  });
});

describe("an objective no shown measure serves", () => {
  it("says no READABLE measure declares it while some measure can't be read", () => {
    renderPage(
      read({
        initiatives: [initiative({ objectives: [GOAL] })],
        metrics: [
          metric({
            name: "broken",
            title: "Broken measure",
            frontmatter_error: "The YAML block could not be parsed: x",
            checkpoint_list_complete: false,
          }),
          metric({ name: "fine", title: "Fine measure" }),
        ],
        other_metrics: ["broken", "fine"],
        sources: {
          ...read().sources,
          intent_documents: degraded("1 measure(s) could not be fully read", [
            "broken",
          ]),
        },
      })
    );
    expect(
      within(objectiveGroup("Goal A")).getByText(
        "No readable measure declares this objective; 1 measure can't be read."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No measure declared for this objective/)
    ).toBeNull();
  });

  it("says no measure is declared only when every measure was read", () => {
    renderPage(
      read({
        initiatives: [initiative({ objectives: [GOAL] })],
        metrics: [metric({ name: "fine", title: "Fine measure" })],
        other_metrics: ["fine"],
      })
    );
    expect(
      within(objectiveGroup("Goal A")).getByText(
        "No measure declared for this objective yet."
      )
    ).toBeInTheDocument();
  });

  it("says whether one declares it is unknown when the document list came back incomplete", () => {
    renderPage(
      read({
        document_list_complete: false,
        initiatives: [
          initiative({
            objectives: [GOAL],
            success_metrics: ["unlisted"],
            missing_metric_names: ["unlisted"],
          }),
        ],
        metrics: [metric({ name: "fine", title: "Fine measure" })],
        other_metrics: ["fine"],
        sources: {
          ...read().sources,
          intent_documents: degraded(
            "coord's document list is degraded: the store answered a partial page"
          ),
        },
      })
    );
    expect(
      within(objectiveGroup("Goal A")).getByText(
        "Whether a measure declares this objective is unknown: the document list came back incomplete."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "It names a measure whose document this read did not return (the document list came back incomplete): unlisted."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No measure declared for this objective/)
    ).toBeNull();
    expect(screen.queryByText(/no readable document/)).toBeNull();
  });
});

describe("the measures an initiative names", () => {
  it("calls one published to the wrong project void, never missing", () => {
    renderPage(
      read({
        initiatives: [
          initiative({
            success_metrics: ["never-written", "wrong-project"],
            missing_metric_names: ["never-written", "wrong-project"],
          }),
        ],
        void_metric_names: ["wrong-project"],
      })
    );
    expect(
      screen.getByText(
        "It names a measure whose document is marked as published to the wrong project, so it is not shown: wrong-project."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "It names a measure with no readable document: never-written."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no readable document: .*wrong-project/)
    ).toBeNull();
  });
});

describe("a project with no measures", () => {
  it("says none are written when the document list came back whole, whatever else could not be read", () => {
    renderPage(
      read({
        objectives_readable: false,
        initiatives: [
          initiative({
            state: "unreadable",
            error: "coord answered HTTP 500",
            status: null,
            live: false,
          }),
        ],
        sources: {
          ...read().sources,
          intent_documents: degraded(
            "The project's objectives can't be read: initiative/current-initiative could not be read (coord answered HTTP 500)"
          ),
        },
      })
    );
    expect(
      screen.getByText(
        "No measures of success have been written yet. Add one from the Summary."
      )
    ).toBeInTheDocument();
  });

  it("says whether there are any is unknown when the document list came back incomplete", () => {
    renderPage(
      read({
        objectives_readable: false,
        document_list_complete: false,
        sources: {
          ...read().sources,
          intent_documents: degraded(
            "coord's document list is degraded: the store answered a partial page; The project's objectives can't be read: coord's document list is incomplete, so whether an initiative exists is unknown"
          ),
        },
      })
    );
    expect(
      screen.getByText(
        "Whether the project has measures of success is unknown: its documents couldn't be fully read."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/have been written yet/)).toBeNull();
  });
});
