import { describe, expect, it } from "vitest";
import {
  baselineLine,
  checkpointResultsNotice,
  checkpointStatusCopy,
  currentValueText,
  declaresNoObjectives,
  definitionHref,
  DEFINITION_UNKNOWN,
  dueWords,
  groupObjectives,
  hiddenCopy,
  howCheckedCount,
  initiativeFieldProblems,
  initiativeUnreadableText,
  missingMeasureLines,
  noInitiativeWritten,
  noMeasureText,
  outOfDateNotice,
  pageHiddenCopy,
  placementDisagreement,
  shortDay,
  sourceNotices,
  summaryMetricRows,
  summaryMetricsFrom,
  summaryStatusOf,
  tallyText,
  targetLines,
  unknownReasonText,
  unresolvedResultLine,
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
    serves_unchecked: [],
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
    checkpoint_results_read: "ok",
    checkpoint_results: [],
    criteria_latest: [],
    tally_latest: { met: 0, missed: 0, unknown: 0 },
    related_notes: [],
    unresolved_results: [],
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
    body_unavailable: null,
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
          checkpoint_results: OK,
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
          checkpoint_results: OK,
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

  it("says results can't be read when the checkpoint results read failed", () => {
    const copy = checkpointStatusCopy(
      checkpoint({
        status: "checkpoint_results_unreadable",
        status_reason:
          "coord's checkpoint-results reader is not answering (HTTP 404)",
      })
    );
    expect(copy.text).toBe(
      "Due 8 Oct — results can't be read (the checkpoint results read failed)"
    );
    expect(copy.detail).toMatch(/HTTP 404/);
    expect(copy.unknown).toBe(true);
    expect(unknownReasonText("checkpoint_results_unreadable")).toBe(
      "Results can't be read (the checkpoint results read failed)"
    );
  });

  it("names a failed checkpoint results read as its own source notice", () => {
    const notices = sourceNotices(
      read({
        sources: {
          intent_documents: OK,
          findings: OK,
          findings_by_id: OK,
          checkpoint_results: {
            status: "unavailable",
            reason: "available: false",
            affected: ["m"],
            details: {},
          },
        },
      })
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.key).toBe("checkpoint_results");
    expect(notices[0]!.text).toBe(
      "Couldn't read the checkpoint results, so results here are unknown, not empty."
    );
  });

  it("says on the card when the checkpoint results were not (fully) read", () => {
    const withCheckpoint = (read: MetricRead["checkpoint_results_read"]) =>
      metric({
        checkpoint_results: [checkpoint()],
        checkpoint_results_read: read,
      });
    expect(checkpointResultsNotice(withCheckpoint("unavailable"))).toMatch(
      /^Results can't be read: the checkpoint results read failed/
    );
    expect(checkpointResultsNotice(withCheckpoint("truncated"))).toMatch(
      /not fully read/
    );
    expect(checkpointResultsNotice(withCheckpoint("ok"))).toBeNull();
  });

  it("says so for a measure that declares criteria but has no checkpoint rows", () => {
    expect(
      checkpointResultsNotice(
        metric({
          checkpoints: [],
          checkpoint_results: [],
          criteria: [
            { id: "1.1", checkpoint: null, target: "green", method: null },
          ],
          checkpoint_results_read: "unavailable",
        })
      )
    ).toMatch(/^Results can't be read/);
    // A measure with neither checkpoints nor criteria has no results to
    // speak of: its current value says what is unknown (D8).
    expect(
      checkpointResultsNotice(
        metric({
          checkpoints: [],
          checkpoint_results: [],
          criteria: [],
          checkpoint_results_read: "unavailable",
        })
      )
    ).toBeNull();
  });

  it("says 'rows not yet recorded' for a report whose rows are missing", () => {
    const copy = checkpointStatusCopy(
      checkpoint({
        status: "reported_rows_not_recorded",
        report: report({ shape: "rows_not_recorded" }),
      })
    );
    expect(copy.text).toBe("Reported; rows not yet recorded");
    expect(copy.unknown).toBe(true);
    expect(unknownReasonText("rows_not_recorded")).toBe(
      "Reported; rows not yet recorded"
    );
  });

  it("never says 'no checkpoint reported' when the results table can't be read", () => {
    const m = metric({
      checkpoint_results_read: "unavailable",
      checkpoint_results: [
        checkpoint({ status: "checkpoint_results_unreadable" }),
      ],
    });
    expect(summaryStatusOf(m)).toEqual({
      line: "Results can't be read",
      unknown: true,
    });
    const partial = metric({
      checkpoint_results_read: "truncated",
      checkpoint_results: [checkpoint()],
    });
    expect(summaryStatusOf(partial)).toEqual({
      line: "Results only partly read",
      unknown: true,
    });
  });

  it("says so when no due date is declared", () => {
    expect(checkpointStatusCopy(checkpoint({ due: null })).text).toBe(
      "No due date declared — awaiting the checkpoint report"
    );
  });

  it("says a due date is unknown, never undeclared, when the definition can't be read", () => {
    const cp = checkpoint({ due: null, declared: false });
    for (const status of [
      "awaiting",
      "no_report_found",
      "unreadable",
      "checkpoint_results_unreadable",
      "not_fully_read",
    ] as const) {
      const copy = checkpointStatusCopy(
        { ...cp, status },
        { definitionUnreadable: true }
      );
      expect(copy.text).toMatch(
        /^Due date unknown \(the definition can't be read\) — /
      );
      expect(copy.text).not.toMatch(/declared/);
    }
    expect(dueWords(cp, true)).toBe(
      "due date unknown (the definition can't be read)"
    );
    expect(dueWords(cp, false)).toBe("no due date declared");
    // A due date the read does carry is still said.
    expect(dueWords(checkpoint(), true)).toBe("due 8 Oct");
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
          checkpoint_results: OK,
        },
      })
    );
    expect(failed).toEqual({
      state: "failed",
      message: "coord did not answer",
    });
  });

  it("says a figure is unknown, never 'not declared', when the definition can't be read", () => {
    const broken = metric({
      frontmatter_error: "The YAML block could not be parsed: x",
    });
    expect(targetLines(broken)).toEqual([
      { label: "Target", text: DEFINITION_UNKNOWN, asWritten: false },
    ]);
    expect(baselineLine(broken)).toEqual({
      label: "Baseline",
      text: DEFINITION_UNKNOWN,
      asWritten: false,
    });
    expect(DEFINITION_UNKNOWN).toBe("Unknown (the definition can't be read)");
  });

  it("never prints 'null' for a target", () => {
    expect(targetLines(metric({ target_text: "null" }))).toEqual([
      { label: "Target", text: "No target declared", asWritten: false },
    ]);
  });

  it("words 'not fully read' without naming a read it may not have been", () => {
    // Sent for a full findings page, a cut-short checkpoint results read and
    // a report whose rows that read could not vouch for.
    expect(unknownReasonText("results_not_fully_read")).toBe(
      "The results were not fully read"
    );
    expect(unknownReasonText("results_not_fully_read")).not.toMatch(
      /findings page/
    );
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

  it("names a later report whose rows are not yet recorded", () => {
    const item = {
      out_of_date_notice: {
        finding_id: "f2",
        checkpoint: "checkpoint-2",
        created_at: "2026-10-13T10:00:00Z",
        shape: "rows_not_recorded",
      },
    } as CriterionResultRead;
    expect(outOfDateNotice(item)).toBe(
      "A later report (13 Oct) exists whose rows are not yet recorded; this verdict may be out of date — open the report"
    );
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

  it("sets an initiative that can't be read apart, with its error", () => {
    const unreadable = initiative({
      name: "current-initiative",
      state: "unreadable",
      error: "coord did not answer (HTTP 500)",
      status: null,
      live: false,
    });
    const broken = initiative({
      name: "broken-yaml",
      status: null,
      live: false,
      frontmatter_error: "The YAML block could not be parsed: x",
    });
    const old = initiative({ name: "old", status: "done", live: false });
    const model = groupObjectives(
      read({
        initiatives: [unreadable, broken, old],
        objectives_readable: false,
      })
    );
    expect(model.unreadable.map((i) => i.name)).toEqual([
      "current-initiative",
      "broken-yaml",
    ]);
    expect(model.live).toEqual([]);
    expect(model.earlier.map((g) => g.initiative.name)).toEqual(["old"]);
    expect(initiativeUnreadableText(unreadable)).toBe(
      "This initiative can't be read, so whether it is live and which objectives it declares are unknown: coord did not answer (HTTP 500)"
    );
    expect(initiativeUnreadableText(broken)).toMatch(
      /unknown: The YAML block could not be parsed/
    );
    expect(initiativeUnreadableText(unreadable)).not.toMatch(
      /not declared|declares no objectives/
    );
  });

  it("never drops a metric no group placed", () => {
    const model = groupObjectives(
      read({ metrics: [metric({ name: "lost" })] })
    );
    expect(model.other).toEqual([{ name: "lost", primary: true }]);
  });
});

describe("what can't be read declares nothing (review round 2)", () => {
  it("says an in_scope nobody could read can't be read, never 'declares no objectives'", () => {
    const notAList = initiative({
      objectives: [],
      field_errors: { in_scope: "in_scope must be a list of {id, text}." },
    });
    expect(declaresNoObjectives(notAList)).toBe(false);
    expect(initiativeFieldProblems(notAList)).toEqual([
      "Which objectives this initiative declares can't be read: in_scope must be a list of {id, text}.",
    ]);
    // Some items read, one with no id: what it declares is not fully known.
    const partial = initiative({
      objectives: [{ id: "a", text: "A", metric_names: [] }],
      field_errors: { in_scope: "item 2 has no quoted id." },
    });
    expect(initiativeFieldProblems(partial)).toEqual([
      "Not every objective this initiative declares can be read: item 2 has no quoted id.",
    ]);
    const names = initiative({
      field_errors: {
        success_metrics: "success_metrics must be a list of names.",
      },
    });
    expect(initiativeFieldProblems(names)).toEqual([
      "Which measures this initiative names can't be read: success_metrics must be a list of names.",
    ]);
    // An in_scope that was read and holds nothing does declare none.
    expect(declaresNoObjectives(initiative({ objectives: [] }))).toBe(true);
    expect(initiativeFieldProblems(initiative())).toEqual([]);
  });

  it("says no READABLE measure declares an objective while some measure can't be read", () => {
    expect(noMeasureText(read({ metrics: [metric()] }))).toBe(
      "No measure declared for this objective yet."
    );
    expect(
      noMeasureText(
        read({
          metrics: [
            metric({ name: "ok" }),
            metric({ name: "broken", frontmatter_error: "bad yaml" }),
          ],
        })
      )
    ).toBe(
      "No readable measure declares this objective; 1 measure can't be read."
    );
    expect(
      noMeasureText(
        read({
          metrics: [
            metric({ name: "gone", state: "unreadable" }),
            metric({
              name: "serves-broken",
              field_errors: { serves: "serves must be a list of names." },
            }),
          ],
        })
      )
    ).toBe(
      "No readable measure declares this objective; 2 measures can't be read."
    );
  });

  it("says a named measure published to the wrong project is that, not missing", () => {
    const i = initiative({
      missing_metric_names: ["never-written", "wrong-project"],
    });
    expect(missingMeasureLines(i, ["wrong-project"])).toEqual([
      "It names a measure with no readable document: never-written.",
      "It names a measure whose document is marked as published to the wrong project, so it is not shown: wrong-project.",
    ]);
    expect(
      missingMeasureLines(initiative({ missing_metric_names: ["a", "b"] }), [
        "a",
        "b",
      ])
    ).toEqual([
      "It names measures whose documents are marked as published to the wrong project, so they are not shown: a, b.",
    ]);
    expect(missingMeasureLines(initiative(), ["a"])).toEqual([]);
  });
});

describe("hidden documents", () => {
  it("counts void and skeleton documents instead of dropping them silently", () => {
    expect(
      pageHiddenCopy(
        read({
          void_metric_names: ["a", "b", "c"],
          void_initiative_names: ["d"],
          skeletons_hidden: 1,
        })
      )
    ).toEqual([
      "4 documents are marked as published to the wrong project and are not shown.",
      "1 template nobody has filled in yet is not shown; write it from the Summary.",
    ]);
    expect(pageHiddenCopy(read())).toEqual([]);
    expect(hiddenCopy({ voidDocuments: 1, skeletons: 0 })).toEqual([
      "1 document is marked as published to the wrong project and is not shown.",
    ]);
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
      summaryMetricsFrom(
        read({ metrics: [m], void_metric_names: ["void-one"] })
      )
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
      summaryMetricsFrom(read({ metrics: [], void_metric_names: ["void-one"] }))
    );
    expect(rows).toEqual([
      {
        entry: { name: "just-written", updatedAt: "2026-10-06T00:05:00Z" },
        status: { line: "Status unknown", unknown: true },
      },
    ]);
  });

  it("keeps a written measure the read did not return, as status unknown", () => {
    // Not void-named and not returned (a degraded listing, say): the read
    // cannot speak for it, so it is never dropped without a notice.
    const rows = summaryMetricRows(
      [
        { name: "unreturned", updatedAt: "2026-10-01T00:00:00Z" },
        { name: "void-one", updatedAt: "2026-10-01T00:00:00Z" },
      ],
      summaryMetricsFrom(read({ metrics: [], void_metric_names: ["void-one"] }))
    );
    expect(rows).toEqual([
      {
        entry: { name: "unreturned", updatedAt: "2026-10-01T00:00:00Z" },
        status: { line: "Status unknown", unknown: true },
      },
    ]);
  });

  it("keeps a void-named measure changed after the read, as status unknown", () => {
    const rows = summaryMetricRows(
      [{ name: "void-one", updatedAt: "2026-10-06T00:05:00Z" }],
      summaryMetricsFrom(read({ metrics: [], void_metric_names: ["void-one"] }))
    );
    expect(rows.map((r) => r.status)).toEqual([
      { line: "Status unknown", unknown: true },
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

  it("carries the void METRIC names, never a void initiative", () => {
    const status = summaryMetricsFrom(
      read({ void_metric_names: ["a", "b"], void_initiative_names: ["i"] })
    );
    expect(status.state === "ready" && [...status.voidNames]).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("review round 1", () => {
  it("says the definition can't be read instead of the source-type reason", () => {
    const shown = currentValueText(metric({ frontmatter_error: "bad yaml" }));
    expect(shown.reason).not.toContain("Measured by hand");
    expect(shown.reason).toMatch(/definition can.t be read/);
    expect(currentValueText(metric()).reason).toBe(
      "Measured by hand; no automatic reading."
    );
  });

  it("words a results entry that names no checkpoint honestly", () => {
    expect(
      unresolvedResultLine({
        checkpoint: null,
        finding_id: "not-a-uuid",
        reason: "invalid_id",
        detail: "The recorded finding id is not a uuid.",
      })
    ).toBe(
      "not-a-uuid (names no checkpoint): The recorded finding id is not a uuid."
    );
    expect(
      unresolvedResultLine({
        checkpoint: "checkpoint-1",
        finding_id: null,
        reason: "invalid_id",
        detail: "x",
      })
    ).toBe("(no finding id): x");
  });

  it("counts what How this was checked holds on its summary", () => {
    expect(howCheckedCount(0, 0)).toBeNull();
    expect(howCheckedCount(1, 0)).toBe("1 recorded report could not be shown");
    expect(howCheckedCount(2, 1)).toBe(
      "2 recorded reports could not be shown; 1 note about the reported result"
    );
    expect(howCheckedCount(0, 3)).toBe("3 notes about the reported result");
  });

  it("flags a placement disagreement on the checkpoint row", () => {
    expect(placementDisagreement(checkpoint())).toBeNull();
    const cp = checkpoint({
      report: report({ checkpoint_mismatch: "Placed under checkpoint-1 …" }),
    });
    expect(placementDisagreement(cp)).toMatch(/disagree/);
  });

  it("tells 'no initiative written' apart from 'can't be read'", () => {
    expect(noInitiativeWritten(read({ initiatives: [] }))).toBe(true);
    expect(
      noInitiativeWritten(read({ initiatives: [], objectives_readable: false }))
    ).toBe(false);
    expect(noInitiativeWritten(read({ initiatives: [initiative()] }))).toBe(
      false
    );
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
