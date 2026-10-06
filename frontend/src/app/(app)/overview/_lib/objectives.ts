/**
 * What the Objectives page (and the Summary's compact metric list) say about
 * the objectives read — pure functions over `ObjectivesRead`, no React.
 *
 * Plan `2026-10-06-overview-objectives-view` D1, D4, D5, D7, D8. Three rules
 * run through every helper here:
 *
 * - **Unknown is never folded.** A verdict is met, missed or unknown, and a
 *   tally always shows all three.
 * - **An unreadable source is never "no results".** Every gap gets its own
 *   words, naming what could not be read.
 * - **The page states the measurer's verdict, never recomputes it** (D4).
 */

import type {
  CheckpointResultRead,
  CriterionResultRead,
  InitiativeRead,
  MetricRead,
  ObjectivesRead,
  ReportRead,
  SourceRead,
  TallyRead,
  Verdict,
} from "./objectives-api";

// ---------------------------------------------------------------------------
// Words for dates
// ---------------------------------------------------------------------------

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "8 Oct" for `2026-10-08` or an RFC 3339 instant; null when unparseable. */
export function shortDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00Z`)
    : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}

// ---------------------------------------------------------------------------
// Verdicts — a word and a shape, never colour alone (D10)
// ---------------------------------------------------------------------------

export interface VerdictLook {
  word: string;
  /** A shape that carries the meaning without colour. */
  symbol: "✓" | "✕" | "?";
  /**
   * The visual system's semantic contract: red means someone must act (a
   * missed target), amber is the ignorance floor (unknown), and everything
   * nobody must act on stays neutral-positive.
   */
  tone: "success" | "destructive" | "warning";
}

export const VERDICT_LOOK: Record<Verdict, VerdictLook> = {
  met: { word: "Met", symbol: "✓", tone: "success" },
  missed: { word: "Missed", symbol: "✕", tone: "destructive" },
  unknown: { word: "Unknown", symbol: "?", tone: "warning" },
};

/** "1 met · 0 missed · 6 unknown" — all three, always. */
export function tallyText(tally: TallyRead): string {
  return `${tally.met} met · ${tally.missed} missed · ${tally.unknown} unknown`;
}

// ---------------------------------------------------------------------------
// Why a verdict is unknown
// ---------------------------------------------------------------------------

const UNKNOWN_REASONS: Record<string, string> = {
  not_reported: "Not in any report yet",
  results_not_fully_read:
    "The results were not fully read (the findings page came back full)",
  results_unreadable: "The results can't be read",
  reported_prose_only: "Reported in prose only — see the report",
  report_unreadable: "Reported, but the result could not be read",
  could_not_run: "The measurement could not be run",
  probe_error: "The measurement failed",
  no_data: "There was no data to measure",
  not_measurable_yet: "Not measurable yet",
  manual_pending: "Waiting for a measurement by hand",
};

export function unknownReasonText(reason: string | null): string {
  if (!reason) return "No reason given";
  return UNKNOWN_REASONS[reason] ?? reason.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Checkpoints (D5, D6)
// ---------------------------------------------------------------------------

export interface StatusCopy {
  text: string;
  /** Extra plain words — the failed read, the block's error. */
  detail: string | null;
  /** True for every state that is not a readable report. */
  unknown: boolean;
}

/** The line a checkpoint shows under its due date. */
export function checkpointStatusCopy(cp: CheckpointResultRead): StatusCopy {
  const day = shortDay(cp.due);
  const due = day ? `Due ${day}` : "No due date declared";
  switch (cp.status) {
    case "reported":
      return { text: provenanceLine(cp), detail: null, unknown: false };
    case "reported_prose_only":
      return {
        text: "Reported in prose only — open the report",
        detail: null,
        unknown: true,
      };
    case "reported_unreadable":
      return {
        text: "Reported, but the result could not be read",
        detail: cp.status_reason,
        unknown: true,
      };
    case "awaiting":
      return {
        text: `${due} — awaiting the checkpoint report`,
        detail: null,
        unknown: true,
      };
    case "no_report_found":
      return {
        text: `${due} — no report found in the findings of the last 14 days`,
        detail: null,
        unknown: true,
      };
    case "possible_report_unrecorded":
      return {
        text: `${due} — A possible report is listed under Related notes; not yet recorded`,
        detail: null,
        unknown: true,
      };
    case "unreadable":
      return {
        text: `${due} — results can't be read`,
        detail: cp.status_reason,
        unknown: true,
      };
    case "not_fully_read":
      return {
        text: `${due} — results were not fully read`,
        detail: cp.status_reason,
        unknown: true,
      };
  }
}

/** D4: "Reported by the 8 Oct checkpoint check" — attested, by whom/when. */
export function provenanceLine(cp: CheckpointResultRead): string {
  const day =
    shortDay(cp.due) ??
    shortDay(cp.report?.measured_at) ??
    shortDay(cp.report?.created_at);
  return day
    ? `Reported by the ${day} checkpoint check`
    : "Reported by a checkpoint check";
}

/** The checkpoint a criterion's shown verdict came from, as a reader says it. */
export function checkpointName(
  metric: MetricRead,
  checkpointId: string | null
): string {
  if (!checkpointId) return "a checkpoint";
  const decl = metric.checkpoints.find((c) => c.id === checkpointId);
  const day = shortDay(decl?.due);
  return day ? `the ${day} checkpoint` : checkpointId.replace(/-/g, " ");
}

/** D7: the notice an earlier verdict carries when a later report has no rows. */
export function outOfDateNotice(item: CriterionResultRead): string | null {
  const later = item.out_of_date_notice;
  if (!later) return null;
  const day = shortDay(later.created_at);
  const how =
    later.shape === "prose_only"
      ? "in prose only"
      : "with a result that could not be read";
  return `A later report${day ? ` (${day})` : ""} exists ${how}; this verdict may be out of date — open the report`;
}

/** The report a checkpoint's newest live head is, plus its history. */
export function reportsOf(cp: CheckpointResultRead): ReportRead[] {
  return cp.report ? [cp.report, ...cp.history] : [...cp.history];
}

/** Every finding id the card renders a report panel for. */
export function reportIdsOf(metric: MetricRead): Set<string> {
  return new Set(
    metric.checkpoint_results.flatMap((c) =>
      reportsOf(c).map((r) => r.finding_id)
    )
  );
}

/** The newest checkpoint with a report, for the Summary's tally line. */
export function latestReportedCheckpoint(
  metric: MetricRead
): CheckpointResultRead | null {
  const reported = metric.checkpoint_results.filter((c) => c.report !== null);
  if (reported.length === 0) return null;
  return reported.reduce((best, c) => {
    const a = Date.parse(best.report?.created_at ?? "") || 0;
    const b = Date.parse(c.report?.created_at ?? "") || 0;
    return b > a ? c : best;
  });
}

// ---------------------------------------------------------------------------
// Target, baseline and current value (D3, D8)
// ---------------------------------------------------------------------------

export interface FigureLine {
  label: string;
  text: string;
  /** The document's own words, not a number — labelled as text. */
  asWritten: boolean;
}

function withUnit(value: number, unit: string | null): string {
  return unit ? `${value} ${unit}` : String(value);
}

function figure(
  label: string,
  value: number | null,
  text: string | null,
  unit: string | null
): FigureLine | null {
  if (value !== null) {
    return { label, text: withUnit(value, unit), asWritten: false };
  }
  if (text && text.trim() && text.trim() !== "null") {
    return { label, text: text.trim(), asWritten: true };
  }
  return null;
}

/** The target (or, without one, a declared ceiling/floor), never "null". */
export function targetLines(metric: MetricRead): FigureLine[] {
  const target = figure(
    "Target",
    metric.target,
    metric.target_text,
    metric.unit
  );
  if (target) return [target];
  const bounds = [
    figure("Ceiling", metric.ceiling, metric.ceiling_text, metric.unit),
    figure("Floor", metric.floor, metric.floor_text, metric.unit),
  ].filter((f): f is FigureLine => f !== null);
  return bounds.length > 0
    ? bounds
    : [{ label: "Target", text: "No target declared", asWritten: false }];
}

export function baselineLine(metric: MetricRead): FigureLine {
  const base = figure(
    "Baseline",
    metric.baseline,
    metric.baseline_text,
    metric.unit
  );
  if (!base) {
    return {
      label: "Baseline",
      text: "No baseline declared",
      asWritten: false,
    };
  }
  const asOf = shortDay(metric.baseline_as_of);
  return asOf ? { ...base, text: `${base.text} (as of ${asOf})` } : base;
}

/** D8: until coord measures, every current value is UNKNOWN with a reason. */
export function currentValueText(metric: MetricRead): {
  text: string;
  reason: string;
} {
  return {
    text: "Current value: not measured yet",
    reason: metric.current_value.reason,
  };
}

// ---------------------------------------------------------------------------
// Sources — every gap named
// ---------------------------------------------------------------------------

export interface SourceNotice {
  key: keyof ObjectivesRead["sources"];
  text: string;
  detail: string | null;
}

const SOURCE_WHAT: Record<keyof ObjectivesRead["sources"], string> = {
  intent_documents: "the project's documents",
  findings: "the checkpoint reports",
  findings_by_id: "the recorded checkpoint reports",
};

function sourceText(what: string, source: SourceRead): string {
  switch (source.status) {
    case "unavailable":
      return `Couldn't read ${what}, so results here are unknown, not empty.`;
    case "truncated":
      return `Only part of ${what} could be read; the rest is shown as unknown.`;
    case "degraded":
      return `Part of ${what} couldn't be read.`;
    case "ok":
      return "";
  }
}

/** One notice per source that is not fully readable. */
export function sourceNotices(read: ObjectivesRead): SourceNotice[] {
  const out: SourceNotice[] = [];
  for (const key of Object.keys(SOURCE_WHAT) as SourceNotice["key"][]) {
    const source = read.sources[key];
    if (!source || source.status === "ok") continue;
    out.push({
      key,
      text: sourceText(SOURCE_WHAT[key], source),
      detail: source.reason,
    });
  }
  return out;
}

/** "n documents are marked as published to the wrong project and are not shown". */
export function hiddenCopy(
  read: Pick<ObjectivesRead, "void_hidden" | "skeletons_hidden">
): string[] {
  const lines: string[] = [];
  if (read.void_hidden > 0) {
    lines.push(
      read.void_hidden === 1
        ? "1 document is marked as published to the wrong project and is not shown."
        : `${read.void_hidden} documents are marked as published to the wrong project and are not shown.`
    );
  }
  if (read.skeletons_hidden > 0) {
    lines.push(
      read.skeletons_hidden === 1
        ? "1 template nobody has filled in yet is not shown; write it from the Summary."
        : `${read.skeletons_hidden} templates nobody has filled in yet are not shown; write them from the Summary.`
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Grouping (D1)
// ---------------------------------------------------------------------------

/** The DOM id of a metric's card, the target of every link to it. */
export function metricAnchor(name: string): string {
  return `metric-${name}`;
}

export interface GroupItem {
  name: string;
  /** False: the card is shown elsewhere on the page; render a link to it. */
  primary: boolean;
}

export interface ObjectiveGroupModel {
  id: string;
  text: string;
  items: GroupItem[];
}

export interface InitiativeGroupModel {
  initiative: InitiativeRead;
  objectives: ObjectiveGroupModel[];
}

export interface ObjectivesPageModel {
  live: InitiativeGroupModel[];
  earlier: InitiativeGroupModel[];
  named: GroupItem[];
  other: GroupItem[];
}

/**
 * The page's groups. A metric's FIRST appearance (live objectives in order,
 * then "Measures the initiative names", then "Other measures") is its card;
 * every later appearance is a link to it. Earlier initiatives sit in a
 * disclosure, so their appearances are always links when the card exists.
 */
export function groupObjectives(read: ObjectivesRead): ObjectivesPageModel {
  const shown = new Set(read.metrics.map((m) => m.name));
  const seen = new Set<string>();
  const take = (name: string, allowPrimary = true): GroupItem | null => {
    if (!shown.has(name)) return null;
    const primary = allowPrimary && !seen.has(name);
    seen.add(name);
    return { name, primary };
  };
  const build = (initiative: InitiativeRead, allowPrimary: boolean) => ({
    initiative,
    objectives: initiative.objectives.map((o) => ({
      id: o.id,
      text: o.text,
      items: o.metric_names
        .map((n) => take(n, allowPrimary))
        .filter((i): i is GroupItem => i !== null),
    })),
  });
  const live = read.initiatives
    .filter((i) => i.live)
    .map((i) => build(i, true));
  const named = read.initiative_named_metrics
    .map((n) => take(n))
    .filter((i): i is GroupItem => i !== null);
  const other = read.other_metrics
    .map((n) => take(n))
    .filter((i): i is GroupItem => i !== null);
  // Any shown metric no group placed still gets a card, under "Other".
  for (const metric of read.metrics) {
    if (!seen.has(metric.name))
      other.push({ name: metric.name, primary: true });
    seen.add(metric.name);
  }
  // Earlier initiatives last: every appearance is a link to a card above.
  const earlier = read.initiatives
    .filter((i) => !i.live)
    .map((i) => build(i, false));
  return { live, earlier, named, other };
}

// ---------------------------------------------------------------------------
// The Summary's compact list (D1)
// ---------------------------------------------------------------------------

export interface SummaryMetricStatus {
  /** What the row says about the measure's status — never blank. */
  line: string;
  /** True when the status is not known (the read failed, or the results
   *  could not be fully read). */
  unknown: boolean;
}

export type SummaryMetrics =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | {
      state: "ready";
      byName: Map<string, MetricRead>;
      generatedAt: string;
      /** Void documents the read excluded; the list says how many. */
      voidHidden: number;
    };

const STATUS_UNKNOWN: SummaryMetricStatus = {
  line: "Status unknown",
  unknown: true,
};

/** One metric's status line on the Summary. */
export function summaryStatusOf(metric: MetricRead): SummaryMetricStatus {
  if (metric.state === "unreadable") return STATUS_UNKNOWN;
  if (metric.frontmatter_error) {
    return { line: "Its definition can't be read", unknown: true };
  }
  if (metric.checkpoint_results.length === 0) {
    // D8: a measure with no checkpoints has a current value, not a report.
    return { line: "Current value: not measured yet", unknown: true };
  }
  const unreadable =
    metric.findings_read === "unavailable" ||
    metric.checkpoint_results.some((c) => c.status === "unreadable");
  const partial =
    metric.findings_read === "truncated" ||
    metric.findings_read === "not_read" ||
    metric.checkpoint_results.some((c) => c.status === "not_fully_read");
  const cp = latestReportedCheckpoint(metric);
  const day = shortDay(cp?.due);
  const tally = cp
    ? `${day ? `${day} checkpoint` : "Latest checkpoint"}: ${tallyText(cp.tally)}`
    : null;
  if (unreadable) {
    return {
      line: tally
        ? `${tally} (some results can't be read)`
        : "Results can't be read",
      unknown: true,
    };
  }
  if (partial) {
    return {
      line: tally
        ? `${tally} (results only partly read)`
        : "Results only partly read",
      unknown: true,
    };
  }
  return { line: tally ?? "No checkpoint reported yet", unknown: false };
}

/**
 * Which written metric documents the Summary lists, and what each says.
 *
 * Ready: only the names the objectives read shows (void tombstones are
 * excluded there, so they are excluded here too, and counted) — except a
 * document changed AFTER that read was taken (one just written on the
 * Summary), which the read cannot speak for: it stays, "status unknown".
 * Failed: every written document, void ones included, each "status unknown"
 * — nothing is filtered on evidence the page could not read.
 */
export function summaryMetricRows<
  T extends { name: string; updatedAt?: string | null },
>(
  entries: readonly T[],
  status: SummaryMetrics
): { entry: T; status: SummaryMetricStatus | null }[] {
  if (status.state === "loading") {
    return entries.map((entry) => ({ entry, status: null }));
  }
  if (status.state === "failed") {
    return entries.map((entry) => ({ entry, status: STATUS_UNKNOWN }));
  }
  const readAt = Date.parse(status.generatedAt);
  const newerThanRead = (entry: T) => {
    const at = Date.parse(entry.updatedAt ?? "");
    return Number.isFinite(at) && Number.isFinite(readAt) && at > readAt;
  };
  return entries
    .filter((entry) => status.byName.has(entry.name) || newerThanRead(entry))
    .map((entry) => {
      const metric = status.byName.get(entry.name);
      return {
        entry,
        status: metric ? summaryStatusOf(metric) : STATUS_UNKNOWN,
      };
    });
}

/** Whether the objectives answer can be used for the Summary's metric list. */
export function summaryMetricsFrom(read: ObjectivesRead): SummaryMetrics {
  if (
    read.sources.intent_documents.status === "unavailable" &&
    read.metrics.length === 0
  ) {
    return {
      state: "failed",
      message: read.sources.intent_documents.reason ?? "unavailable",
    };
  }
  return {
    state: "ready",
    byName: new Map(read.metrics.map((m) => [m.name, m])),
    generatedAt: read.generated_at,
    voidHidden: read.void_hidden,
  };
}

/** The coord console's deep link to edit a measure's definition (D2). */
export function definitionHref(name: string): string {
  const qs = new URLSearchParams({ kind: "success_metric", name });
  return `/admin/coord/prompt-documents?${qs.toString()}`;
}
