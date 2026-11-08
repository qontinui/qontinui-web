/**
 * A synthetic report and its view, in the server's own shapes
 * (`generated-types.ts`), for the block tests.
 *
 * Synthetic names only — qontinui-web is a public repository (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D8):
 * the owner is `example-org`, and the confidential term the tests forbid is
 * `Northwind Mutual`. That term is planted only in fields NO block renders
 * (the report's source and session labels, a stop's source path), so the
 * presentation oracle proves the blocks keep them out of the page.
 *
 * Three stops, oldest first, as the server orders them:
 *
 * 1. **Baseline review** — a full review; the first stop, so no changes.
 * 2. **Checkpoint 1** — a light check: a score moved, one became unmeasured,
 *    a figure moved and its verdict changed, an item moved, an item is new,
 *    and an event falls in the interval. The method changed.
 * 3. **Re-review** — a full review again; the method changed back.
 */

import type { components } from "@/lib/api-client/generated-types";

type Schemas = components["schemas"];
export type ReportView = Schemas["ReportView"];
export type ViewSnapshot = Schemas["ViewSnapshot"];
export type SnapshotDoc = Schemas["ReportSnapshotDoc"];
export type SnapshotChanges = Schemas["SnapshotChanges"];
/** Through the view, as `ReportContext` names it: `Schemas["ReportRead"]` is
 *  a name another backend model also uses. */
export type ReportRead = ReportView["report"];

export const SLUG = "platform-review";
export const REPORT_ID = "report-platform-review";
export const CONFIDENTIAL = "Northwind Mutual";
/** An internal identifier planted among an item's technical references. */
export const PLANTED_UUID = "00000000-0000-4000-8000-000000000123";
/** What the server serves in place of a withheld string. */
export const WITHHELD = "[withheld]";

type Cells = Record<
  string,
  { value: number | null; unknown_reason: string | null }
>;

const cell = (value: number | null, unknown_reason: string | null = null) => ({
  value,
  unknown_reason,
});

export function scorecard(rows: {
  intake: Cells;
  billing: Cells;
  overall: Cells;
}): Schemas["SnapshotTable"] {
  return {
    id: "scorecard",
    title: "Architecture scorecard",
    caption: "How each part of the platform scores, by dimension.",
    row_header: "Part",
    scale: { min: 1, max: 5, target: 5, better: "higher" },
    columns: [
      {
        id: "clarity",
        label: "Clarity",
        help: "How easy the part is to understand.",
      },
      {
        id: "leanness",
        label: "Leanness",
        help: "How little the part carries that it does not need.",
      },
    ],
    rows: [
      { id: "intake", label: "Intake", help: null, cells: rows.intake },
      {
        id: "billing",
        label: "Billing",
        help: "Invoices and the ledger.",
        cells: rows.billing,
      },
    ],
    summary_rows: [{ id: "overall", label: "Overall", cells: rows.overall }],
  };
}

export function docAt(
  stop: 1 | 2 | 3,
  overrides: Partial<SnapshotDoc> = {}
): SnapshotDoc {
  const base: Record<1 | 2 | 3, SnapshotDoc> = {
    1: {
      schema: "report-snapshot/v1",
      label: "Baseline review",
      as_of: "2026-10-13T00:00:00Z",
      method: {
        kind: "full_review",
        label: "Independent architecture review",
        note: null,
      },
      summary: "The platform works, but two parts carry more than they need.",
      groups: [
        {
          id: "recommendations",
          label: "Recommendations",
          help: "What the review advised the team to change.",
          due: "2026-12-31",
        },
      ],
      tables: [
        scorecard({
          intake: { clarity: cell(2), leanness: cell(3) },
          billing: { clarity: cell(3), leanness: cell(4) },
          overall: { clarity: cell(2.5), leanness: cell(3.5) },
        }),
      ],
      figures: [
        {
          id: "uptime",
          label: "Uptime",
          help: "The share of the month the platform answered.",
          unit: "%",
          value: 98.5,
          unknown_reason: null,
          baseline: 98.5,
          target: 99,
          better: "higher",
          verdict: "missed",
          source: "the status page's monthly export",
          measured_at: "2026-10-12T00:00:00Z",
        },
        {
          id: "lead-time",
          label: "Lead time",
          help: "Days from a change being written to it reaching users.",
          unit: "days",
          value: 12,
          unknown_reason: null,
          baseline: 12,
          target: 5,
          better: "lower",
          verdict: "missed",
          source: "the delivery dashboard",
          measured_at: "2026-10-12T00:00:00Z",
        },
      ],
      items: [
        {
          id: "r01",
          group: "recommendations",
          label: "Split the intake service",
          help: null,
          status: "planned",
          status_note: null,
          events: [],
          links: [],
        },
        {
          id: "r02",
          group: "recommendations",
          label: "Retire the old billing export",
          help: "Nothing reads it any more.",
          status: "planned",
          status_note: null,
          events: [],
          links: [],
        },
      ],
      notes: [],
    },
    2: {
      schema: "report-snapshot/v1",
      label: "Checkpoint 1",
      as_of: "2026-10-29T00:00:00Z",
      method: {
        kind: "light_check",
        label: "Scripted light check",
        note: "Only the measurable rows were checked.",
      },
      summary: "Intake is clearer; billing was not re-scored this time.",
      groups: [
        {
          id: "recommendations",
          label: "Recommendations",
          help: "What the review advised the team to change.",
          due: "2026-12-31",
        },
      ],
      tables: [
        scorecard({
          intake: { clarity: cell(3), leanness: cell(3) },
          billing: {
            clarity: cell(3),
            leanness: cell(null, "not re-scored by a light check"),
          },
          overall: { clarity: cell(3), leanness: cell(3) },
        }),
      ],
      figures: [
        {
          id: "uptime",
          label: "Uptime",
          help: "The share of the month the platform answered.",
          unit: "%",
          value: 99.2,
          unknown_reason: null,
          baseline: 98.5,
          target: 99,
          better: "higher",
          verdict: "met",
          source: "the status page's monthly export",
          measured_at: "2026-10-28T00:00:00Z",
        },
        {
          id: "lead-time",
          label: "Lead time",
          help: "Days from a change being written to it reaching users.",
          unit: "days",
          value: null,
          unknown_reason: "the dashboard export did not include it",
          baseline: 12,
          target: 5,
          better: "lower",
          verdict: "unknown",
          source: "the delivery dashboard",
          measured_at: null,
        },
      ],
      items: [
        {
          id: "r01",
          group: "recommendations",
          label: "Split the intake service",
          help: null,
          status: "in_progress",
          status_note: "Half of the routes have moved.",
          events: [{ at: "2026-10-20", label: "First routes moved" }],
          links: [
            {
              label: "Pull request 101",
              url: "https://github.com/example-org/platform/pull/101",
            },
            {
              label: `Design notes ${PLANTED_UUID}`,
              url: `/overview/documents/${PLANTED_UUID}`,
            },
          ],
        },
        {
          id: "r02",
          group: "recommendations",
          label: "Retire the old billing export",
          help: "Nothing reads it any more.",
          status: "dropped",
          status_note: "Kept: one partner still reads it.",
          events: [],
          links: [],
        },
        {
          id: "r03",
          group: null,
          label: "Write the on-call guide",
          help: null,
          status: "unknown",
          status_note: null,
          events: [],
          links: [],
        },
      ],
      notes: [],
    },
    3: {
      schema: "report-snapshot/v1",
      label: "Re-review",
      as_of: "2026-11-20T00:00:00Z",
      method: {
        kind: "full_review",
        label: "Independent architecture review",
        note: null,
      },
      summary: "Both parts are leaner; the intake split is done.",
      groups: [
        {
          id: "recommendations",
          label: "Recommendations",
          help: "What the review advised the team to change.",
          due: "2026-12-31",
        },
      ],
      tables: [
        scorecard({
          intake: { clarity: cell(4), leanness: cell(4) },
          billing: { clarity: cell(3), leanness: cell(4) },
          overall: { clarity: cell(3.5), leanness: cell(4) },
        }),
      ],
      figures: [
        {
          id: "uptime",
          label: "Uptime",
          help: "The share of the month the platform answered.",
          unit: "%",
          value: 99.4,
          unknown_reason: null,
          baseline: 98.5,
          target: 99,
          better: "higher",
          verdict: "met",
          source: "the status page's monthly export",
          measured_at: "2026-11-19T00:00:00Z",
        },
        {
          id: "lead-time",
          label: "Lead time",
          help: "Days from a change being written to it reaching users.",
          unit: "days",
          value: 7,
          unknown_reason: null,
          baseline: 12,
          target: 5,
          better: "lower",
          verdict: "missed",
          source: "the delivery dashboard",
          measured_at: "2026-11-19T00:00:00Z",
        },
      ],
      items: [
        {
          id: "r01",
          group: "recommendations",
          label: "Split the intake service",
          help: null,
          status: "done",
          status_note: null,
          events: [
            { at: "2026-10-20", label: "First routes moved" },
            { at: "2026-11-10", label: "Last routes moved" },
          ],
          links: [
            {
              label: "Pull request 101",
              url: "https://github.com/example-org/platform/pull/101",
            },
          ],
        },
        {
          id: "r02",
          group: "recommendations",
          label: "Retire the old billing export",
          help: "Nothing reads it any more.",
          status: "dropped",
          status_note: "Kept: one partner still reads it.",
          events: [],
          links: [],
        },
        {
          id: "r03",
          group: null,
          label: "Write the on-call guide",
          help: null,
          status: "blocked",
          status_note: "Waiting for the rota.",
          events: [],
          links: [],
        },
      ],
      notes: [],
    },
  };
  return { ...base[stop], ...overrides };
}

const CHANGES_AT_2: SnapshotChanges = {
  previous_seq: 1,
  method_changed: true,
  cells: [
    {
      table_id: "scorecard",
      row_id: "intake",
      column_id: "clarity",
      from: 2,
      to: 3,
      new: false,
    },
    {
      table_id: "scorecard",
      row_id: "billing",
      column_id: "leanness",
      from: 4,
      to: null,
      new: false,
    },
    {
      table_id: "scorecard",
      row_id: "overall",
      column_id: "clarity",
      from: 2.5,
      to: 3,
      new: false,
    },
    {
      table_id: "scorecard",
      row_id: "overall",
      column_id: "leanness",
      from: 3.5,
      to: 3,
      new: false,
    },
  ],
  figures: [
    {
      figure_id: "uptime",
      from: 98.5,
      to: 99.2,
      verdict_from: "missed",
      verdict_to: "met",
      new: false,
    },
    {
      figure_id: "lead-time",
      from: 12,
      to: null,
      verdict_from: "missed",
      verdict_to: "unknown",
      new: false,
    },
  ],
  items: [
    {
      item_id: "r01",
      from_status: "planned",
      to_status: "in_progress",
      new: false,
    },
    {
      item_id: "r02",
      from_status: "planned",
      to_status: "dropped",
      new: false,
    },
    { item_id: "r03", from_status: null, to_status: "unknown", new: true },
  ],
  events: [{ item_id: "r01", at: "2026-10-20", label: "First routes moved" }],
};

const CHANGES_AT_3: SnapshotChanges = {
  previous_seq: 2,
  method_changed: true,
  cells: [
    {
      table_id: "scorecard",
      row_id: "intake",
      column_id: "clarity",
      from: 3,
      to: 4,
      new: false,
    },
    {
      table_id: "scorecard",
      row_id: "intake",
      column_id: "leanness",
      from: 3,
      to: 4,
      new: false,
    },
    {
      table_id: "scorecard",
      row_id: "billing",
      column_id: "leanness",
      from: null,
      to: 4,
      new: false,
    },
    {
      table_id: "scorecard",
      row_id: "overall",
      column_id: "clarity",
      from: 3,
      to: 3.5,
      new: false,
    },
    {
      table_id: "scorecard",
      row_id: "overall",
      column_id: "leanness",
      from: 3,
      to: 4,
      new: false,
    },
  ],
  figures: [
    {
      figure_id: "uptime",
      from: 99.2,
      to: 99.4,
      verdict_from: "met",
      verdict_to: "met",
      new: false,
    },
    {
      figure_id: "lead-time",
      from: null,
      to: 7,
      verdict_from: "unknown",
      verdict_to: "missed",
      new: false,
    },
  ],
  items: [
    {
      item_id: "r01",
      from_status: "in_progress",
      to_status: "done",
      new: false,
    },
    {
      item_id: "r03",
      from_status: "unknown",
      to_status: "blocked",
      new: false,
    },
  ],
  events: [{ item_id: "r01", at: "2026-11-10", label: "Last routes moved" }],
};

export function stopAt(
  seq: 1 | 2 | 3,
  overrides: { data?: SnapshotDoc; changes?: SnapshotChanges | null } = {}
): ViewSnapshot {
  const data = overrides.data ?? docAt(seq);
  const changes =
    "changes" in overrides
      ? (overrides.changes ?? null)
      : seq === 1
        ? null
        : seq === 2
          ? CHANGES_AT_2
          : CHANGES_AT_3;
  return {
    id: `stop-${seq}`,
    seq,
    version: 1,
    label: data.label,
    as_of: data.as_of,
    method_kind: data.method.kind,
    method_label: data.method.label,
    // Never rendered by a block: the term planted here must not reach the page.
    source_path: `reports/${CONFIDENTIAL.toLowerCase().replace(/ /g, "-")}/stop-${seq}.json`,
    content_sha256: "0".repeat(64),
    allowlist_version: 1,
    scope_version: 1,
    created_at: data.as_of,
    created_by: null,
    via_device: null,
    via_session: `published for ${CONFIDENTIAL}`,
    data,
    changes_since_previous: changes,
  };
}

export function reportRead(overrides: Partial<ReportRead> = {}): ReportRead {
  return {
    id: REPORT_ID,
    slug: SLUG,
    title: "Platform review: progress",
    summary: "How the platform has improved since its review.",
    body_md: "",
    // Never rendered by a block.
    source_repo: "example-org/handbook",
    source_path: `reports/${CONFIDENTIAL}/report.md`,
    source_sha: null,
    version: 1,
    created_at: "2026-10-13T00:00:00Z",
    updated_at: "2026-11-20T00:00:00Z",
    created_by: null,
    updated_by: null,
    via_device: null,
    via_session: `published for ${CONFIDENTIAL}`,
    withheld: [],
    ...overrides,
  };
}

export function reportView(
  overrides: Partial<ReportView> & { snapshots?: ViewSnapshot[] } = {}
): ReportView {
  const snapshots = overrides.snapshots ?? [stopAt(1), stopAt(2), stopAt(3)];
  return {
    report: reportRead(),
    snapshots,
    withheld: [],
    shown: snapshots.length,
    total: snapshots.length,
    truncated: false,
    ...overrides,
  };
}

/** A second, unrelated report, for two reports on one page. */
export const OTHER_SLUG = "support-review";
export const OTHER_ID = "report-support-review";

export function otherView(): ReportView {
  const one = stopAt(1, {
    data: docAt(1, { label: "Support baseline" }),
    changes: null,
  });
  const two = stopAt(2, { data: docAt(2, { label: "Support check" }) });
  return reportView({
    report: reportRead({
      id: OTHER_ID,
      slug: OTHER_SLUG,
      title: "Support review: progress",
    }),
    snapshots: [one, two],
  });
}
