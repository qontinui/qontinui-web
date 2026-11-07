import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/overview/editing/ChangeLogPanel", () => ({
  ChangeLogPanel: () => null,
}));

import { toIntentEntry, type IntentDocument } from "../_lib/intent";
import type { MetricRead } from "../_lib/objectives-api";
import { MetricSummaryList } from "./MetricSummaryList";

function doc(name: string, title: string): IntentDocument {
  return {
    id: `success_metric:${name}`,
    kind: "success_metric",
    name,
    description: null,
    body: `# ${title}\n\nProse.`,
    frontmatter: null,
    overview_order: null,
    state: "authored",
    error: null,
    status: null,
    withdrawn: false,
    version: 2,
    updated_at: "2026-10-01T00:00:00Z",
    updated_by: null,
  };
}

const entries = [
  toIntentEntry(doc("real-measure", "Real measure")),
  toIntentEntry(doc("void-measure", "Void measure")),
];

describe("the Summary's compact metric list", () => {
  it("when the objectives read fails: says so, lists every measure unfiltered, each status unknown", () => {
    render(
      <MetricSummaryList
        entries={entries}
        status={{ state: "failed", message: "GET /objectives failed: 502" }}
        canEdit={false}
        move={vi.fn()}
      />
    );
    expect(
      screen.getByText("Results and status can’t be read.")
    ).toBeInTheDocument();
    expect(screen.getByText("Real measure")).toBeInTheDocument();
    expect(screen.getByText("Void measure")).toBeInTheDocument();
    expect(screen.getAllByText(/Status unknown/)).toHaveLength(2);
  });

  it("when it succeeds: drops void documents and shows the tally and a link", () => {
    const metric = {
      name: "real-measure",
      checkpoint_results: [
        {
          id: "checkpoint-1",
          due: "2026-10-08",
          report: { created_at: "2026-10-08T16:00:00Z" },
          tally: { met: 2, missed: 1, unknown: 4 },
        },
      ],
    } as unknown as MetricRead;
    render(
      <MetricSummaryList
        entries={entries}
        status={{
          state: "ready",
          byName: new Map([["real-measure", metric]]),
          generatedAt: "2026-10-06T00:00:00Z",
          voidHidden: 1,
        }}
        canEdit
        move={vi.fn()}
      />
    );
    expect(screen.queryByText("Void measure")).toBeNull();
    expect(
      screen.getByText(
        "1 document is marked as published to the wrong project and is not shown."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("8 Oct checkpoint: 2 met · 1 missed · 4 unknown")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "See it on Objectives" })
    ).toHaveAttribute("href", "/overview/objectives#metric-real-measure");
  });
});
