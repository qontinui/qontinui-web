/**
 * Read a mermaid `gantt` block into phases and tasks — a pure, deterministic
 * function with no clock, no network and no state.
 *
 * Why this exists: a delivery plan usually already exists as a document with a
 * `gantt` chart in it, so importing that chart is the fastest path to a
 * populated estimate (plan
 * `2026-09-19-project-overview-for-business-leaders`, "Design decisions" 10).
 *
 * What it will NOT do: guess. Every line it cannot read becomes an `issue`
 * naming the line and what it expected, and the caller shows the whole result
 * for confirmation before anything is saved. A chart that is half-understood
 * is reported as half-understood rather than imported as if it were whole.
 *
 * Grammar covered (mermaid's own, narrowed):
 *
 *     gantt
 *         dateFormat YYYY-MM-DD
 *         title      Delivery
 *         excludes   weekends
 *         section A0 Mobilisation
 *         Kick-off and access   :a0t1, 2026-01-05, 10d
 *         Environment baseline  :crit, a0t2, after a0t1, 2026-01-30
 *         Go / no-go            :milestone, m1, 2026-01-30, 0d
 *
 * * `section <text>` starts a phase. A leading short upper-case token is read
 *   as the phase CODE (`A0 Mobilisation` → code `A0`, name `Mobilisation`);
 *   without one the phase is coded `P1`, `P2`, … in order.
 * * A task line is `<title> : <meta>`, meta comma-separated: optional status
 *   tags, an optional id, a start (a date or `after <id>`) and an end (a date
 *   or a duration).
 * * Only `dateFormat YYYY-MM-DD` is understood. Any other format is an issue
 *   on the directive rather than a silently misread date.
 * * Durations in `d` and `w` only. With `excludes weekends` they are laid out
 *   over working days, exactly as mermaid renders them; without it, over
 *   calendar days.
 *
 * Dates are inclusive at both ends, matching `overview.phases.planned_end`:
 * a task starting Monday with `5d` ends on the Friday.
 */

export interface ParsedTask {
  /** The id the chart gave it, used to resolve `after`. May be empty. */
  id: string;
  title: string;
  /** ISO `YYYY-MM-DD`. */
  plannedStart: string;
  /** ISO `YYYY-MM-DD`. Equal to the start for a milestone. */
  plannedEnd: string;
  isCritical: boolean;
  /** Tagged `milestone` — a point in time, not a span. */
  isMilestone: boolean;
  /** Tagged `done`, which the importer maps onto the task status. */
  status: "planned" | "in_progress" | "done";
  /** 1-based line number in the source, for the confirmation screen. */
  line: number;
}

export interface ParsedPhase {
  code: string;
  name: string;
  /** Earliest task start, or `null` when the section has no dated task. */
  plannedStart: string | null;
  /** Latest task end. */
  plannedEnd: string | null;
  tasks: ParsedTask[];
}

export interface GanttIssue {
  /** 1-based line number, or 0 for a whole-document issue. */
  line: number;
  /** The source line, so the confirmation screen can quote it. */
  text: string;
  /** Plain-language explanation of what could not be read. */
  message: string;
  /**
   * `error` — the line produced nothing. `warning` — the line WAS imported,
   * but something about it was approximated or ignored.
   */
  severity: "error" | "warning";
}

export interface GanttParseResult {
  /** The chart's `title` directive, when it has one. */
  title: string | null;
  phases: ParsedPhase[];
  issues: GanttIssue[];
  /** True when `excludes weekends` was declared and honoured. */
  excludesWeekends: boolean;
  /** Tasks successfully read, across every phase. */
  taskCount: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|mo|y)$/i;
const STATUS_TAGS = new Set(["done", "active", "crit", "milestone", "vert"]);
/** A leading `A0` / `P1` / `PH2` style token is a phase code. */
const PHASE_CODE = /^[A-Z][A-Z0-9]{0,4}$/;

const DAY_MS = 86_400_000;

function toDate(iso: string): Date {
  // UTC throughout: a gantt chart's dates are calendar dates, and a local
  // midnight would shift them by a day either side of a DST boundary.
  const parts = iso.split("-").map(Number);
  return new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** The next day, skipping weekends when the chart excludes them. */
function nextDay(date: Date, skipWeekends: boolean): Date {
  let next = new Date(date.getTime() + DAY_MS);
  while (skipWeekends && isWeekend(next)) {
    next = new Date(next.getTime() + DAY_MS);
  }
  return next;
}

/**
 * The longest duration this will lay out — about twenty years of working
 * days. This runs in the reader's browser on whatever they paste, and the
 * layout below walks a day at a time (it has to: weekends are skipped), so an
 * unbounded `999999999d` would freeze the tab rather than produce a wrong
 * date. A task longer than this is a typo, and is reported as one.
 */
const MAX_DURATION_DAYS = 7500;

/** `start` advanced by `days` INCLUSIVE days: 1 day ends where it starts. */
function addDays(start: Date, days: number, skipWeekends: boolean): Date {
  let cursor = new Date(start.getTime());
  if (skipWeekends) {
    while (isWeekend(cursor)) cursor = new Date(cursor.getTime() + DAY_MS);
  }
  let remaining =
    Math.min(Math.max(1, Math.round(days)), MAX_DURATION_DAYS) - 1;
  while (remaining > 0) {
    cursor = nextDay(cursor, skipWeekends);
    remaining -= 1;
  }
  return cursor;
}

interface DurationResult {
  days: number | null;
  message?: string;
}

function durationInDays(
  token: string,
  excludesWeekends: boolean
): DurationResult {
  const match = DURATION.exec(token);
  if (!match) return { days: null };
  const amount = Number(match[1] ?? "0");
  const unit = (match[2] ?? "").toLowerCase();
  const tooLong = (days: number): DurationResult | null =>
    days > MAX_DURATION_DAYS
      ? {
          days: null,
          message: `a duration of "${token}" is longer than this import will lay out, so the task was left out`,
        }
      : null;
  if (unit === "d") return tooLong(amount) ?? { days: amount };
  if (unit === "w") {
    const days = amount * (excludesWeekends ? 5 : 7);
    return tooLong(days) ?? { days };
  }
  if (unit === "h" || unit === "m" || unit === "s" || unit === "ms") {
    // Shorter than a day: the estimate's grain is a day, so it becomes one.
    return {
      days: 1,
      message: `a duration of "${token}" is shorter than a day, so the task was given a single day`,
    };
  }
  return {
    days: null,
    message: `a duration of "${token}" is not in days or weeks, which is all this import understands`,
  };
}

/**
 * Parse a mermaid `gantt` block. `source` may be the bare block or a markdown
 * fence containing one — the fence markers are stripped.
 */
export function parseMermaidGantt(source: string): GanttParseResult {
  const issues: GanttIssue[] = [];
  const phases: ParsedPhase[] = [];
  let title: string | null = null;
  let excludesWeekends = false;
  let dateFormatSeen = false;

  const rawLines = source.replace(/\r\n?/g, "\n").split("\n");

  // Strip a surrounding markdown fence, keeping line numbers aligned with
  // what the reader pasted.
  const lines = rawLines.map((line) =>
    /^\s*```/.test(line) ? "" : line.replace(/%%.*$/, "")
  );

  let current: ParsedPhase | null = null;
  const endById = new Map<string, Date>();
  let previousEnd: Date | null = null;

  const pushIssue = (
    line: number,
    text: string,
    message: string,
    severity: GanttIssue["severity"] = "error"
  ) => issues.push({ line, text: text.trim(), message, severity });

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const lineNumber = index + 1;
    const line = raw.trim();
    if (line === "") continue;

    const lower = line.toLowerCase();
    if (lower === "gantt") continue;

    if (lower.startsWith("dateformat")) {
      const value = line.slice("dateFormat".length).trim();
      dateFormatSeen = true;
      if (value.toUpperCase() !== "YYYY-MM-DD") {
        pushIssue(
          lineNumber,
          raw,
          `only dates written YYYY-MM-DD can be read, and this chart declares "${value}"`
        );
      }
      continue;
    }
    if (lower.startsWith("title")) {
      title = line.slice("title".length).trim() || null;
      continue;
    }
    if (lower.startsWith("excludes")) {
      const value = line.slice("excludes".length).trim().toLowerCase();
      if (value === "weekends") {
        excludesWeekends = true;
      } else {
        pushIssue(
          lineNumber,
          raw,
          `"${value}" is not understood, so those days were still counted as working days`,
          "warning"
        );
      }
      continue;
    }
    if (
      lower.startsWith("axisformat") ||
      lower.startsWith("todaymarker") ||
      lower.startsWith("tickinterval") ||
      lower.startsWith("weekday") ||
      lower.startsWith("inclusiveenddates") ||
      lower.startsWith("%%")
    ) {
      continue;
    }

    if (lower.startsWith("section")) {
      const text = line.slice("section".length).trim();
      const parts = text.split(/\s+/);
      const head = parts[0] ?? "";
      let code: string;
      let name: string;
      if (parts.length > 1 && PHASE_CODE.test(head)) {
        code = head;
        name = parts.slice(1).join(" ");
      } else {
        code = `P${phases.length + 1}`;
        name = text || code;
      }
      current = {
        code,
        name,
        plannedStart: null,
        plannedEnd: null,
        tasks: [],
      };
      phases.push(current);
      continue;
    }

    // Everything left should be a task line.
    const colon = line.indexOf(":");
    if (colon < 0) {
      pushIssue(
        lineNumber,
        raw,
        "this is not a section, a directive, or a task (a task is `title : dates`)"
      );
      continue;
    }
    const titleText = line.slice(0, colon).trim();
    const meta = line
      .slice(colon + 1)
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "");

    if (titleText === "") {
      pushIssue(lineNumber, raw, "this task has no title");
      continue;
    }
    if (current === null) {
      // Mermaid allows tasks before any section; give them a home rather
      // than dropping them, and say so.
      current = {
        code: `P${phases.length + 1}`,
        name: "Unnamed section",
        plannedStart: null,
        plannedEnd: null,
        tasks: [],
      };
      phases.push(current);
      pushIssue(
        lineNumber,
        raw,
        "this task came before any `section`, so it was put in a phase called “Unnamed section”",
        "warning"
      );
    }

    let isCritical = false;
    let isMilestone = false;
    let status: ParsedTask["status"] = "planned";
    let cursor = 0;
    while (
      cursor < meta.length &&
      STATUS_TAGS.has((meta[cursor] ?? "").toLowerCase())
    ) {
      const tag = (meta[cursor] ?? "").toLowerCase();
      if (tag === "crit") isCritical = true;
      if (tag === "milestone") isMilestone = true;
      if (tag === "done") status = "done";
      if (tag === "active") status = "in_progress";
      cursor += 1;
    }

    const rest = meta.slice(cursor);
    let taskId = "";
    let startToken: string | null = null;
    let endToken: string | null = null;

    const isStart = (token: string) =>
      ISO_DATE.test(token) || /^after\s+/i.test(token);
    const isEnd = (token: string) =>
      ISO_DATE.test(token) || DURATION.test(token);

    if (rest.length >= 3) {
      taskId = rest[0] ?? "";
      startToken = rest[1] ?? null;
      endToken = rest[2] ?? null;
      if (rest.length > 3) {
        pushIssue(
          lineNumber,
          raw,
          `only the first three values after the tags were used; "${rest.slice(3).join(", ")}" was ignored`,
          "warning"
        );
      }
    } else if (rest.length === 2) {
      // Either `id, end` or `start, end`. A token that can start a task is
      // read as a start; anything else is an id.
      const first = rest[0] ?? "";
      const second = rest[1] ?? "";
      if (isStart(first)) {
        startToken = first;
        endToken = second;
      } else {
        taskId = first;
        endToken = second;
      }
    } else if (rest.length === 1) {
      const only = rest[0] ?? "";
      if (isEnd(only)) {
        endToken = only;
      } else {
        pushIssue(
          lineNumber,
          raw,
          `"${only}" is neither a date nor a duration, so this task has no dates`
        );
        continue;
      }
    } else {
      pushIssue(lineNumber, raw, "this task has no dates");
      continue;
    }

    // ---- start ----
    let start: Date | null = null;
    if (startToken === null) {
      if (previousEnd === null) {
        pushIssue(
          lineNumber,
          raw,
          "this task has no start date and nothing before it to follow"
        );
        continue;
      }
      start = nextDay(previousEnd, excludesWeekends);
    } else if (ISO_DATE.test(startToken)) {
      start = toDate(startToken);
    } else if (/^after\s+/i.test(startToken)) {
      const refs = startToken.slice(5).trim().split(/\s+/);
      const ends = refs
        .map((ref) => endById.get(ref))
        .filter((value): value is Date => value !== undefined);
      if (ends.length !== refs.length || ends.length === 0) {
        const missing = refs.filter((ref) => !endById.has(ref));
        pushIssue(
          lineNumber,
          raw,
          `it follows ${missing.map((m) => `"${m}"`).join(", ")}, which this chart does not define before it`
        );
        continue;
      }
      const latest = ends.reduce((a, b) => (a > b ? a : b), ends[0] as Date);
      start = nextDay(latest, excludesWeekends);
    } else {
      pushIssue(
        lineNumber,
        raw,
        `"${startToken}" is neither a date nor “after <task>”`
      );
      continue;
    }

    // ---- end ----
    let end: Date;
    if (endToken === null) {
      pushIssue(lineNumber, raw, "this task has no end date or duration");
      continue;
    }
    if (ISO_DATE.test(endToken)) {
      end = toDate(endToken);
      if (end < start) {
        pushIssue(
          lineNumber,
          raw,
          "it ends before it starts, so it was not imported"
        );
        continue;
      }
    } else {
      const { days, message } = durationInDays(endToken, excludesWeekends);
      if (days === null) {
        pushIssue(
          lineNumber,
          raw,
          message ??
            `"${endToken}" is neither a date nor a duration in days or weeks`
        );
        continue;
      }
      if (message) pushIssue(lineNumber, raw, message, "warning");
      end = isMilestone ? start : addDays(start, days, excludesWeekends);
    }
    if (isMilestone) end = start;

    const task: ParsedTask = {
      id: taskId,
      title: titleText,
      plannedStart: toIso(start),
      plannedEnd: toIso(end),
      isCritical,
      isMilestone,
      status,
      line: lineNumber,
    };
    current.tasks.push(task);
    if (taskId) endById.set(taskId, end);
    previousEnd = end;
  }

  if (!dateFormatSeen && phases.some((p) => p.tasks.length > 0)) {
    issues.push({
      line: 0,
      text: "",
      message:
        "the chart declares no dateFormat; its dates were read as YYYY-MM-DD",
      severity: "warning",
    });
  }

  for (const phase of phases) {
    const starts = phase.tasks.map((t) => t.plannedStart).sort();
    const ends = phase.tasks.map((t) => t.plannedEnd).sort();
    phase.plannedStart = starts[0] ?? null;
    phase.plannedEnd = ends[ends.length - 1] ?? null;
  }

  // A phase code has to be unique — the estimate's own constraint. Two
  // sections that resolve to the same code are suffixed rather than merged,
  // because they are two sections in the source.
  const seen = new Map<string, number>();
  for (const phase of phases) {
    const count = seen.get(phase.code) ?? 0;
    seen.set(phase.code, count + 1);
    if (count > 0) {
      const original = phase.code;
      phase.code = `${original}-${count + 1}`;
      issues.push({
        line: 0,
        text: "",
        message: `two sections are both coded "${original}"; the second was renamed "${phase.code}"`,
        severity: "warning",
      });
    }
  }

  return {
    title,
    phases,
    issues,
    excludesWeekends,
    taskCount: phases.reduce((sum, p) => sum + p.tasks.length, 0),
  };
}

/**
 * The parse result as the estimate content endpoint takes it.
 *
 * Deliberately separate from the parser: the parser answers "what does this
 * chart say", this answers "what would saving it do". Task numbers are
 * `<phase>.<task>` in source order, which is the numbering delivery plans
 * use and the numbering the estimate's uniqueness constraint needs.
 */
export function ganttToPhases(result: GanttParseResult): {
  code: string;
  name: string;
  planned_start: string | null;
  planned_end: string | null;
  tasks: {
    number: string;
    title: string;
    planned_start: string;
    planned_end: string;
    is_critical: boolean;
    status: ParsedTask["status"];
  }[];
}[] {
  return result.phases.map((phase, phaseIndex) => ({
    code: phase.code,
    name: phase.name,
    planned_start: phase.plannedStart,
    planned_end: phase.plannedEnd,
    tasks: phase.tasks.map((task, taskIndex) => ({
      number: `${phaseIndex + 1}.${taskIndex + 1}`,
      title: task.title,
      planned_start: task.plannedStart,
      planned_end: task.plannedEnd,
      is_critical: task.isCritical,
      status: task.status,
    })),
  }));
}
