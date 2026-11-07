import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The card's editor and markdown renderer have their own tests; stand them
// in so this one is about what the card SAYS.
vi.mock("@/components/overview/editing/EditableSection", () => ({
  EditableSection: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/overview/MarkdownView", () => ({
  MarkdownView: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../../_lib/metric-text-api", () => ({ saveMetricText: vi.fn() }));

import type {
  CheckpointResultRead,
  MetricRead,
  ReportRead,
} from "../../_lib/objectives-api";
import { MetricCard } from "./MetricCard";

const EDITING = { canEdit: false, projectId: null, viewerId: null };

function report(overrides: Partial<ReportRead> = {}): ReportRead {
  return {
    finding_id: "00000000-0000-4000-8000-000000000001",
    title: "Checkpoint report",
    topic: "example-topic",
    body: "The report.",
    created_at: "2026-10-08T16:10:00Z",
    expires_at: null,
    checkpoint: "checkpoint-1",
    placed_by: ["table"],
    checkpoint_mismatch: null,
    shape: "structured",
    block_error: null,
    block_warnings: [],
    measured_at: "2026-10-08T16:05:00Z",
    document_version: 2,
    gate_id: "00000000-0000-4000-8000-0000000000aa",
    rows: [],
    recorded: false,
    body_unavailable: null,
    ...overrides,
  };
}

function checkpoint(
  overrides: Partial<CheckpointResultRead> = {}
): CheckpointResultRead {
  return {
    id: "checkpoint-1",
    due: null,
    label: null,
    declared: false,
    window_closes_at: null,
    status: "reported",
    status_reason: null,
    report: report(),
    history: [],
    criteria: [],
    tally: { met: 0, missed: 0, unknown: 0 },
    unresolved_results: [],
    ...overrides,
  };
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

const row = {
  id: "1.2",
  verdict: "met" as const,
  value: null,
  unit: null,
  value_text: "14 lands",
  method: null,
  door: null,
  window: null,
  unknown_reason: null,
  cause: null,
  action: null,
  declared: false,
};

describe("a measure whose definition can't be read", () => {
  // The backend serves such a measure with no checkpoints, criteria, target
  // or baseline, and `source_query_type` at its default — none of which is a
  // fact about the document. A report coord's table still places is shown.
  const broken = metric({
    frontmatter_error: "The YAML block is not read: it uses a YAML anchor",
    checkpoint_results: [
      checkpoint({ report: report({ rows: [row] }) }),
      checkpoint({ id: "checkpoint-2", report: report({ rows: [] }) }),
      // A report whose rows the results read could not vouch for: its
      // status line leads with the due date.
      checkpoint({
        id: "checkpoint-3",
        status: "not_fully_read",
        status_reason: "the checkpoint results page came back full",
        report: report({
          finding_id: "00000000-0000-4000-8000-000000000003",
          shape: "rows_unread",
        }),
      }),
    ],
  });

  it("shows its figures and criteria as unknown, never as not declared", () => {
    render(<MetricCard metric={broken} editing={EDITING} />);
    const figures = screen.getByText("Target").closest("dl")!;
    expect(
      within(figures).getAllByText("Unknown (the definition can't be read)")
    ).toHaveLength(2);
    expect(screen.queryByText(/No target declared/)).toBeNull();
    expect(screen.queryByText(/No baseline declared/)).toBeNull();
    expect(screen.queryByText(/declares no criteria/)).toBeNull();
    expect(
      screen.getAllByText(/Criteria: unknown \(the definition can't be read\)/)
        .length
    ).toBeGreaterThan(0);
    // No checkpoint tally claims a count of criteria nobody could declare.
    expect(screen.queryByText(/0 unknown/)).toBeNull();
    // A reported row is never called "not in the document's list".
    expect(screen.queryByText(/not in the document’s list/)).toBeNull();
    expect(
      screen.getByText(/whether the document lists it is unknown/)
    ).toBeInTheDocument();
    // Nor are its checkpoints' due dates, the checkpoints themselves, or the
    // results list a report is recorded in (D1): all the definition's, and
    // none of it was read.
    expect(screen.queryByText(/no due date declared/i)).toBeNull();
    expect(
      screen.queryByText(/named by a report, not by the document/)
    ).toBeNull();
    expect(screen.queryByText(/not yet recorded on the document/)).toBeNull();
    expect(
      screen.getAllByText(/· due date unknown \(the definition can't be read\)/)
    ).toHaveLength(3);
    expect(
      screen.getByText(
        "Due date unknown (the definition can't be read) — results were not fully read"
      )
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Whether the document declares this checkpoint is unknown (the definition can't be read)."
      )
    ).toHaveLength(3);
    expect(
      screen.getAllByText(/whether the document records it is unknown/)
    ).toHaveLength(3);
  });

  it("names no source type for the reading", () => {
    render(<MetricCard metric={broken} editing={EDITING} />);
    expect(screen.queryByText("Source of the reading")).toBeNull();
    expect(screen.queryByText("absent")).toBeNull();
  });
});

describe("how a checkpoint was checked (D10 R8)", () => {
  it("keeps the validator's field paths and the read's reason off the card face", () => {
    const m = metric({
      checkpoints: [{ id: "checkpoint-1", due: "2026-10-08", label: null }],
      checkpoint_results: [
        checkpoint({
          declared: true,
          due: "2026-10-08",
          status: "reported_unreadable",
          status_reason: "tally: states met 2 but the rows hold met 1",
          report: report({
            shape: "unreadable_block",
            block_error: "tally: states met 2 but the rows hold met 1",
            block_warnings: [
              "rows[0].cause: a missed row is expected to give a cause",
            ],
          }),
        }),
      ],
    });
    render(<MetricCard metric={m} editing={EDITING} />);
    const status = screen.getByText(
      "Reported, but the result could not be read"
    );
    expect(status.textContent).not.toMatch(/Why|tally:/);
    const disclosure = screen
      .getByText(/^How this was checked/)
      .closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(
      within(disclosure).getByText(/rows\[0\]\.cause:/)
    ).toBeInTheDocument();
    expect(
      within(disclosure).getByText(/tally: states met 2/)
    ).toBeInTheDocument();
    expect(screen.getByText(/^How this was checked/).textContent).toBe(
      "How this was checked (1 note about the reported result)"
    );
  });
});

describe("recorded reports that could not be shown (N2)", () => {
  const lost = {
    checkpoint: "checkpoint-1",
    finding_id: "00000000-0000-4000-8000-000000000007",
    reason: "read_failed" as const,
    detail: "coord did not answer the findings read (HTTP 503).",
  };

  it("lists a checkpoint's in How this was checked, said once and never on the face", () => {
    const m = metric({
      checkpoints: [{ id: "checkpoint-1", due: "2026-10-08", label: null }],
      checkpoint_results: [
        checkpoint({
          declared: true,
          due: "2026-10-08",
          status: "unreadable",
          // The read joins the entries' details into the status's reason.
          status_reason: lost.detail,
          report: null,
          unresolved_results: [lost],
        }),
      ],
    });
    render(<MetricCard metric={m} editing={EDITING} />);
    expect(
      screen.getByText("Due 8 Oct — results can't be read")
    ).toBeInTheDocument();
    const summary = screen.getByText(/^How this was checked/);
    expect(summary.textContent).toBe(
      "How this was checked (1 recorded report could not be shown)"
    );
    const disclosure = summary.closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    const said = screen.getAllByText(/HTTP 503/);
    expect(said).toHaveLength(1);
    expect(disclosure).toContainElement(said[0]!);
    expect(said[0]!.textContent).toBe(
      "00000000-0000-4000-8000-000000000007: coord did not answer the findings read (HTTP 503)."
    );
    expect(within(disclosure).queryByText("Why")).toBeNull();
  });

  it("lists one naming no checkpoint in the card's own disclosure", () => {
    const m = metric({
      unresolved_results: [
        {
          checkpoint: null,
          finding_id: "not-a-uuid",
          reason: "invalid_id",
          detail: "The recorded finding id is not a uuid.",
        },
      ],
    });
    render(<MetricCard metric={m} editing={EDITING} />);
    const summary = screen.getByText(/^How this was checked/);
    expect(summary.textContent).toBe(
      "How this was checked (1 recorded report could not be shown)"
    );
    const disclosure = summary.closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(
      within(disclosure).getByText(
        "not-a-uuid (names no checkpoint): The recorded finding id is not a uuid."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText(/is not a uuid/)).toHaveLength(1);
  });
});

describe("the gate a criterion was measured under (N5)", () => {
  it("is named in How this was measured, from the row's report", () => {
    const m = metric({
      checkpoints: [{ id: "checkpoint-1", due: "2026-10-08", label: null }],
      criteria: [
        {
          id: "1.2",
          checkpoint: "checkpoint-1",
          target: "Lands",
          method: "M1",
        },
      ],
      checkpoint_results: [
        checkpoint({
          declared: true,
          due: "2026-10-08",
          report: report({ rows: [{ ...row, declared: true }] }),
          criteria: [
            {
              id: "1.2",
              checkpoint: "checkpoint-1",
              target: "Lands",
              method: "M1",
              verdict: "met",
              unknown_reason: null,
              row: { ...row, declared: true },
              measured_at: "2026-10-08T16:05:00Z",
              reported_checkpoint: "checkpoint-1",
              finding_id: "00000000-0000-4000-8000-000000000001",
              earlier: [],
              out_of_date_notice: null,
            },
          ],
          tally: { met: 1, missed: 0, unknown: 0 },
        }),
      ],
    });
    render(<MetricCard metric={m} editing={EDITING} />);
    const gate = screen.getAllByText("Gate")[0]!;
    expect(gate.nextElementSibling?.textContent).toBe(
      "00000000-0000-4000-8000-0000000000aa"
    );
  });
});
