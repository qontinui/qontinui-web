import { describe, expect, it } from "vitest";
import {
  baselineLine,
  checkpointStatusCopy,
  definitionHref,
  groupObjectives,
  hiddenCopy,
  outOfDateNotice,
  shortDay,
  sourceNotices,
  summaryMetricRows,
  summaryMetricsFrom,
  summaryStatusOf,
  tallyText,
  targetLines,
  unknownReasonText,
  VERDICT_LOOK,
} from "./objectives";
import type {
  CheckpointResultRead,
  CriterionResultRead,
  InitiativeRead,
  MetricRead,
  ObjectivesRead,
  ReportRead,
  SourceRead,
} from "./objectives-api";

const OK: SourceRead = {
  status: "ok",
  reason: null,
  affected: [],
  details: {},
};

function metric(overrides: Partial<MetricRead> = {}): MetricRead {
  return {
    name: "merge-train-throughput-2026-10",
    title: "Merge-train throughput",
    state: "authored",
    version: 2,
    updated_at: null,
    updated_by: null,
    overview_order: null,
    body: "prose",
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
    report_topic: null,
    structured_reporting_since: null,
    source_query_type: "manual",
    checkpoints: [
      { id: "checkpoint-1", due: "2026-10-08", label: "unblocked" },
    ],
    checkpoints_text: null,
    criteria: [],
    results: [],
    extra_fields: [],
    findings_read: "ok",
    checkpoint_results: [],
    criteria_latest: [],
    tally_latest: { met: 0, missed: 0, unknown: 0 },
    related_notes: [],
    current_value: {
      status: "not_measured",
      source_query_type: "manual",
      reason: "Measured by hand; no automatic reading.",
    },
    ...overrides,
  };
}

function checkpoint(
  overrides: Partial<CheckpointResultRead> = {}
): CheckpointResultRead {
  return {
    id: "checkpoint-1",
    due: "2026-10-08",
    label: "unblocked",
    declared: true,
    window_closes_at: "2026-10-10T00:00:00Z",
    status: "awaiting",
    status_reason: null,
    report: null,
    history: [],
    criteria: [],
    tally: { met: 0, missed: 0, unknown: 7 },
    unresolved_results: [],
    ...overrides,
  };
}

function report(overrides: Partial<ReportRead> = {}): ReportRead {
  return {
    finding_id: "f1",
    title: "Merge-train checkpoint 1",
    topic: "merge-train-metrics",
    body: "the report",
    created_at: "2026-10-08T16:10:00Z",
    expires_at: null,
    checkpoint: "checkpoint-1",
    placed_by: ["block"],
    checkpoint_mismatch: null,
    shape: "structured",
    block_error: null,
    block_warnings: [],
    measured_at: "2026-10-08T16:05:00Z",
    document_version: 2,
    gate_id: null,
    rows: [],
    recorded: true,
    ...overrides,
  };
}

function initiative(overrides: Partial<InitiativeRead> = {}): InitiativeRead {
  return {
    name: "current-initiative",
    title: "Current initiative",
    state: "authored",
    version: 10,
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
    generated_at: "2026-10-06T00:00:00Z",
    initiatives: [],
    earlier_initiatives_count: 0,
    objectives_readable: true,
    metrics: [],
    initiative_named_metrics: [],
    other_metrics: [],
    skeletons_hidden: 0,
    void_hidden: 0,
    sources: { intent_documents: OK, findings: OK, findings_by_id: OK },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Failure arms first
// ---------------------------------------------------------------------------

describe("an unreadable source is never 'no results'", () => {
  it("names an unavailable findings read, with its reason", () => {
    const notices = sourceNotices(
      read({
        sources: {
          intent_documents: OK,
          findings: {
            status: "unavailable",
            reason: "coord did not answer (HTTP 404)",
            affected: ["m"],
            details: {},
          },
          findings_by_id: OK,
        },
      })
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.key).toBe("findings");
    expect(notices[0]!.text).toMatch(/Couldn't read the checkpoint reports/);
    expect(notices[0]!.text).toMatch(/unknown, not empty/);
    expect(notices[0]!.detail).toBe("coord did not answer (HTTP 404)");
  });

  it("gives truncated and degraded their own words", () => {
    const notices = sourceNotices(
      read({
        sources: {
          intent_documents: { ...OK, status: "degraded", reason: "x" },
          findings: { ...OK, status: "truncated", reason: "page full" },
          findings_by_id: OK,
        },
      })
    );
    expect(notices.map((n) => n.text)).toEqual([
      "Part of the project's documents couldn't be read.",
      "Only part of the checkpoint reports could be read; the rest is shown as unknown.",
    ]);
  });

  it("says results can't be read, naming the failed read, never MISSED", () => {
    const copy = checkpointStatusCopy(
      checkpoint({ status: "unreadable", status_reason: "by-id read failed" })
    );
    expect(copy.text).toBe("Due 8 Oct — results can't be read");
    expect(copy.detail).toBe("by-id read failed");
    expect(copy.unknown).toBe(true);
  });

  it("has a copy for every non-reported checkpoint state", () => {
    expect(checkpointStatusCopy(checkpoint()).text).toBe(
      "Due 8 Oct — awaiting the checkpoint report"
    );
    expect(
      checkpointStatusCopy(checkpoint({ status: "no_report_found" })).text
    ).toBe("Due 8 Oct — no report found in the findings of the last 14 days");
    expect(
      checkpointStatusCopy(checkpoint({ status: "possible_report_unrecorded" }))
        .text
    ).toBe(
      "Due 8 Oct — A possible report is listed under Related notes; not yet recorded"
    );
    expect(
      checkpointStatusCopy(checkpoint({ status: "not_fully_read" })).text
    ).toBe("Due 8 Oct — results were not fully read");
    expect(
      checkpointStatusCopy(
        checkpoint({ status: "reported_prose_only", report: report() })
      ).text
    ).toBe("Reported in prose only — open the report");
    const unreadable = checkpointStatusCopy(
      checkpoint({
        status: "reported_unreadable",
        status_reason: "tally: states met 2",
      })
    );
    expect(unreadable.text).toBe("Reported, but the result could not be read");
    expect(unreadable.detail).toBe("tally: states met 2");
  });

  it("says so when no due date is declared", () => {
    expect(checkpointStatusCopy(checkpoint({ due: null })).text).toBe(
      "No due date declared — awaiting the checkpoint report"
    );
  });

  it("treats the Summary's failed objectives read as status unknown, void docs unfiltered", () => {
    const entries = [{ name: "real" }, { name: "void-one" }];
    const rows = summaryMetricRows(entries, {
      state: "failed",
      message: "500",
    });
    expect(rows.map((r) => r.entry.name)).toEqual(["real", "void-one"]);
    expect(rows.every((r) => r.status?.unknown)).toBe(true);
  });

  it("reads an objectives answer whose document list failed as a failure", () => {
    const failed = summaryMetricsFrom(
      read({
        sources: {
          intent_documents: {
            ...OK,
            status: "unavailable",
            reason: "coord did not answer",
          },
          findings: OK,
          findings_by_id: OK,
        },
      })
    );
    expect(failed).toEqual({
      state: "failed",
      message: "coord did not answer",
    });
  });

  it("never prints 'null' for a target", () => {
    expect(targetLines(metric({ target_text: "null" }))).toEqual([
      { label: "Target", text: "No target declared", asWritten: false },
    ]);
  });

  it("gives every unknown reason plain words", () => {
    expect(unknownReasonText("not_reported")).toBe("Not in any report yet");
    expect(unknownReasonText("results_unreadable")).toBe(
      "The results can't be read"
    );
    expect(unknownReasonText(null)).toBe("No reason given");
    expect(unknownReasonText("some_new_reason")).toBe("some new reason");
  });
});

// ---------------------------------------------------------------------------
// Success paths
// ---------------------------------------------------------------------------

describe("verdicts", () => {
  it("carry a word and a shape as well as a tone", () => {
    expect(VERDICT_LOOK.met).toMatchObject({ word: "Met", symbol: "✓" });
    expect(VERDICT_LOOK.missed).toMatchObject({ word: "Missed", symbol: "✕" });
    expect(VERDICT_LOOK.unknown).toMatchObject({
      word: "Unknown",
      symbol: "?",
    });
  });

  it("tallies show all three, unknown never folded", () => {
    expect(tallyText({ met: 1, missed: 0, unknown: 6 })).toBe(
      "1 met · 0 missed · 6 unknown"
    );
  });
});

describe("provenance (D4)", () => {
  it("names the checkpoint by its due day", () => {
    const copy = checkpointStatusCopy(
      checkpoint({ status: "reported", report: report() })
    );
    expect(copy).toEqual({
      text: "Reported by the 8 Oct checkpoint check",
      detail: null,
      unknown: false,
    });
  });
});

describe("D7 out-of-date notice", () => {
  it("names a later prose-only report", () => {
    const item = {
      out_of_date_notice: {
        finding_id: "f2",
        checkpoint: "checkpoint-2",
        created_at: "2026-10-13T10:00:00Z",
        shape: "prose_only",
      },
    } as CriterionResultRead;
    expect(outOfDateNotice(item)).toBe(
      "A later report (13 Oct) exists in prose only; this verdict may be out of date — open the report"
    );
    expect(
      outOfDateNotice({ out_of_date_notice: null } as CriterionResultRead)
    ).toBe(null);
  });
});

describe("target and baseline (D3, D8)", () => {
  it("shows a numeric target with its unit", () => {
    expect(targetLines(metric({ target: 10, unit: "lands/day" }))).toEqual([
      { label: "Target", text: "10 lands/day", asWritten: false },
    ]);
  });

  it("labels a free-text target as written", () => {
    expect(targetLines(metric({ target_text: "see each row" }))[0]).toEqual({
      label: "Target",
      text: "see each row",
      asWritten: true,
    });
  });

  it("shows a ceiling instead of 'No target declared'", () => {
    expect(targetLines(metric({ ceiling: 750 }))).toEqual([
      { label: "Ceiling", text: "750", asWritten: false },
    ]);
  });

  it("labels a free-text baseline as written, with its date", () => {
    expect(
      baselineLine(
        metric({
          baseline_text: "3867.34 (2026-09, org net)",
          baseline_as_of: "2026-09-30",
        })
      )
    ).toEqual({
      label: "Baseline",
      text: "3867.34 (2026-09, org net) (as of 30 Sept)",
      asWritten: true,
    });
    expect(baselineLine(metric()).text).toBe("No baseline declared");
  });
});

describe("grouping (D1)", () => {
  it("makes the second appearance of a metric a link to the first", () => {
    const model = groupObjectives(
      read({
        initiatives: [
          initiative({
            objectives: [
              { id: "a", text: "A", metric_names: ["m"] },
              { id: "b", text: "B", metric_names: ["m"] },
              { id: "c", text: "C", metric_names: [] },
            ],
          }),
          initiative({
            name: "old",
            live: false,
            status: "done",
            objectives: [{ id: "z", text: "Z", metric_names: ["m"] }],
          }),
        ],
        metrics: [
          metric({ name: "m" }),
          metric({ name: "n" }),
          metric({ name: "o" }),
        ],
        initiative_named_metrics: ["n"],
        other_metrics: ["o"],
      })
    );
    const [a, b, c] = model.live[0]!.objectives;
    expect(a!.items).toEqual([{ name: "m", primary: true }]);
    expect(b!.items).toEqual([{ name: "m", primary: false }]);
    expect(c!.items).toEqual([]);
    expect(model.named).toEqual([{ name: "n", primary: true }]);
    expect(model.other).toEqual([{ name: "o", primary: true }]);
    expect(model.earlier[0]!.objectives[0]!.items).toEqual([
      { name: "m", primary: false },
    ]);
  });

  it("never drops a metric no group placed", () => {
    const model = groupObjectives(
      read({ metrics: [metric({ name: "lost" })] })
    );
    expect(model.other).toEqual([{ name: "lost", primary: true }]);
  });
});

describe("hidden documents", () => {
  it("counts void and skeleton documents instead of dropping them silently", () => {
    expect(hiddenCopy(read({ void_hidden: 4, skeletons_hidden: 1 }))).toEqual([
      "4 documents are marked as published to the wrong project and are not shown.",
      "1 template nobody has filled in yet is not shown; write it from the Summary.",
    ]);
    expect(hiddenCopy(read())).toEqual([]);
  });
});

describe("the Summary's compact list", () => {
  it("drops void documents and shows the latest checkpoint tally", () => {
    const m = metric({
      name: "real",
      checkpoint_results: [
        checkpoint({
          status: "reported",
          report: report(),
          tally: { met: 1, missed: 0, unknown: 6 },
        }),
      ],
    });
    const rows = summaryMetricRows(
      [{ name: "real" }, { name: "void-one" }],
      summaryMetricsFrom(read({ metrics: [m] }))
    );
    expect(rows).toEqual([
      {
        entry: { name: "real" },
        status: {
          line: "8 Oct checkpoint: 1 met · 0 missed · 6 unknown",
          unknown: false,
        },
      },
    ]);
  });

  it("keeps a document written after the read, as status unknown", () => {
    const rows = summaryMetricRows(
      [
        { name: "void-one", updatedAt: "2026-10-01T00:00:00Z" },
        { name: "just-written", updatedAt: "2026-10-06T00:05:00Z" },
      ],
      summaryMetricsFrom(read({ metrics: [] }))
    );
    expect(rows).toEqual([
      {
        entry: { name: "just-written", updatedAt: "2026-10-06T00:05:00Z" },
        status: { line: "Status unknown", unknown: true },
      },
    ]);
  });

  it("says a measure without checkpoints is not measured yet (D8)", () => {
    const rows = summaryMetricRows(
      [{ name: "real" }],
      summaryMetricsFrom(read({ metrics: [metric({ name: "real" })] }))
    );
    expect(rows[0]!.status).toEqual({
      line: "Current value: not measured yet",
      unknown: true,
    });
  });

  it("never says 'no checkpoint reported' when the reports can't be read", () => {
    const m = metric({
      findings_read: "unavailable",
      checkpoint_results: [checkpoint({ status: "unreadable" })],
    });
    expect(summaryStatusOf(m)).toEqual({
      line: "Results can't be read",
      unknown: true,
    });
    const partial = metric({
      findings_read: "truncated",
      checkpoint_results: [
        checkpoint({
          status: "reported",
          report: report(),
          tally: { met: 1, missed: 0, unknown: 6 },
        }),
      ],
    });
    expect(summaryStatusOf(partial)).toEqual({
      line: "8 Oct checkpoint: 1 met · 0 missed · 6 unknown (results only partly read)",
      unknown: true,
    });
  });

  it("does not call an unreadable definition 'not measured yet'", () => {
    expect(summaryStatusOf(metric({ frontmatter_error: "bad yaml" }))).toEqual({
      line: "Its definition can't be read",
      unknown: true,
    });
    expect(summaryStatusOf(metric({ state: "unreadable" }))).toEqual({
      line: "Status unknown",
      unknown: true,
    });
  });

  it("says no checkpoint reported only when the read was complete", () => {
    expect(
      summaryStatusOf(metric({ checkpoint_results: [checkpoint()] }))
    ).toEqual({ line: "No checkpoint reported yet", unknown: false });
  });

  it("carries the void count so the Summary can say what it hid", () => {
    const status = summaryMetricsFrom(read({ void_hidden: 4 }));
    expect(status.state === "ready" && status.voidHidden).toBe(4);
  });
});

describe("dates and links", () => {
  it("formats due days in UTC", () => {
    expect(shortDay("2026-10-08")).toBe("8 Oct");
    expect(shortDay("2026-10-08T23:30:00Z")).toBe("8 Oct");
    expect(shortDay("garbage")).toBe(null);
  });

  it("deep-links the console to the measure's definition", () => {
    expect(definitionHref("github-actions-monthly-spend")).toBe(
      "/admin/coord/prompt-documents?kind=success_metric&name=github-actions-monthly-spend"
    );
  });
});
