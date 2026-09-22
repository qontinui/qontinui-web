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

/** Directives this import has no use for, skipped rather than reported. */
const IGNORED_DIRECTIVES = [
  "axisformat",
  "todaymarker",
  "tickinterval",
  "weekday",
  "inclusiveenddates",
] as const;

const DAY_MS = 86_400_000;

/**
 * True when a directive's VALUE is itself shaped like task metadata: it
 * contains a colon, and what follows that colon is a LIST of at least two
 * comma-separated fields one of which parses as a date or a duration.
 *
 * This does NOT decide the line — the keyword does, exactly as mermaid's own
 * lexer decides it, so `title Delivery plan: 2026-01-05` stays a title and
 * `section A0: 2026-01-05` stays a section. Letting a date anywhere after
 * the FIRST colon win instead turned both of those into a phantom "Unnamed
 * section" and an error; testing the VALUE rather than the whole line is
 * what tells those two apart from `Excludes review :e1, 2026-01-05, 5d`,
 * whose value (`review :e1, 2026-01-05, 5d`) carries a colon of its own.
 *
 * What it is for is the other half of the same problem: when a line matches
 * a directive keyword AND looks like this, the reader is told, so a task the
 * parser swallowed is never swallowed in silence. The far more common
 * collision — a title merely STARTING with a keyword, `Sections signed
 * off :s1, …` — is settled by the word boundary in `directiveValue` and
 * never reaches here.
 */
function looksLikeTaskMeta(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon < 0) return false;
  const tokens = metaTokens(value);
  // A directive whose value merely NAMES dates is not a task: `title
  // Delivery plan: 2026-01-05` and `section Sprint 1: 2026-01-05,
  // 2026-03-31` are a title and a section, and warning on them told the
  // reader to break a chart that was right.
  //
  // Three fields is a task whatever else is true. Two is the hard case,
  // because `Section review :2026-01-05, 2026-01-20` (a task with a start
  // and an end and no id) and `title Delivery plan: 2026-01-05,
  // 2026-03-31` (a delivery window) have the same shape — and requiring a
  // DURATION as well lost the first in silence, which is the one thing this
  // module promises never to do.
  //
  // What separates them is the SPACE: mermaid's task separator is written
  // ` :`, while a colon inside prose attaches to the word before it. A
  // heuristic rather than a law — `Title review:2026-01-05, 2026-01-20`
  // (two dates, no duration, no space) is still missed — but it recovers
  // the common form without warning on either false positive. A task
  // carrying a DURATION is caught whether or not it has the space, on the
  // other arm.
  // The space is looked for in the HEAD — up to and including the first
  // colon — because that is the separator the rule is about. Scanning the
  // whole value also matched a colon further along, so `title Release: v1,
  // see note :below` warned on a separator that is not one.
  const head = value.slice(0, value.indexOf(":") + 1);
  return (
    tokens.length >= 3 ||
    (tokens.length >= 2 && (tokens.some(isDurationToken) || /\s:/.test(head)))
  );
}

/** The comma-separated fields after a value's first colon. */
function metaTokens(value: string): string[] {
  const colon = value.indexOf(":");
  if (colon < 0) return [];
  return value
    .slice(colon + 1)
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");
}

function isDurationToken(token: string): boolean {
  return DURATION.test(token);
}

/**
 * The looser test, for the five directives this import DISCARDS.
 *
 * Their value is never used, so a spurious warning costs nothing and a
 * missed one costs a task — the opposite balance from the directives above,
 * where the value is kept and the warning is advice. `Weekday catch-up :5d`
 * and `Tickinterval review :t1, after a1` are both real task shapes this
 * parser reads elsewhere, and under the strict rule both vanished in
 * silence.
 *
 * Still no warning for a genuine single-field value that carries a colon —
 * `axisFormat %H:%M`, `todayMarker stroke-width:5px` — because one field
 * that is neither a date, a duration nor an `after` is not task meta. A
 * MULTI-property `todayMarker stroke-width:5px,stroke:#0f0` does warn: the
 * split is on the FIRST colon, giving `5px` and `stroke:#0f0` — two fields,
 * and indistinguishable from task meta by any rule here.
 * That is the trade this function is named for — these five directives are
 * discarded, so noise costs a line and silence costs a task.
 */
function couldBeADiscardedTask(value: string): boolean {
  const tokens = metaTokens(value);
  if (tokens.length === 0) return false;
  return (
    tokens.length >= 2 ||
    tokens.some(
      (token) =>
        ISO_DATE.test(token) ||
        isDurationToken(token) ||
        /^after\s+/i.test(token)
    )
  );
}

/**
 * A directive is its keyword followed by WHITESPACE — never a bare prefix.
 *
 * `lower.startsWith("section")` also matches the task line
 * `Sections signed off : s1, 2026-01-05, 5d`, which then becomes a phase
 * named "s signed off :s1, …" and no issue at all. The same trap eats a task
 * titled "Titles and rates" (it silently overwrites the chart title) and one
 * titled "Excludes review". Requiring the boundary is what keeps this
 * module's promise that every unreadable line becomes an issue.
 */
function directiveValue(line: string, keyword: string): string | null {
  const match = new RegExp(`^${keyword}[ \\t]+(.*)$`, "i").exec(line);
  if (match) return (match[1] ?? "").trim();
  // The keyword alone on its line is still the directive, with no value.
  return line.toLowerCase() === keyword ? "" : null;
}

/**
 * A calendar date, or `null` when the text is shaped like one but is not a
 * real day.
 *
 * `ISO_DATE` checks the SHAPE only, and `Date.UTC` silently rolls over
 * (`2026-13-45` becomes 2027-02-14, `2026-02-30` becomes 2026-03-02) and
 * remaps years 0-99 into 1900+ (`0099-01-01` becomes 1999-01-01). This
 * module promises an issue rather than a silently misread date, so the
 * result is compared back against the input and a disagreement is a refusal.
 *
 * UTC throughout: a gantt chart's dates are calendar dates, and a local
 * midnight would shift them by a day either side of a DST boundary.
 */
function toDate(iso: string): Date | null {
  const parts = iso.split("-").map(Number);
  const [year, month, day] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  const date = new Date(Date.UTC(year, month - 1, day));
  // `setUTCFullYear` is what undoes the 0-99 remap; without it a two-digit
  // year would fail this comparison for the wrong reason.
  date.setUTCFullYear(year);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
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

/** The first working day on or after `date`, when weekends are excluded. */
function firstWorkingDay(date: Date, skipWeekends: boolean): Date {
  let cursor = new Date(date.getTime());
  while (skipWeekends && isWeekend(cursor)) {
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return cursor;
}

/** `start` advanced by `days` INCLUSIVE days: 1 day ends where it starts. */
function addDays(start: Date, days: number, skipWeekends: boolean): Date {
  let cursor = firstWorkingDay(start, skipWeekends);
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

    // A directive line whose VALUE is shaped like task metadata. The keyword
    // still wins — that is what mermaid does — but the reader is told,
    // because a task read as a directive is a task that vanished.
    //
    // `ambiguous` is computed per directive, from that directive's own
    // value: keyed on the whole line instead, it fired on `title Delivery
    // plan: 2026-01-05` and told the reader to rename a perfectly good
    // title, on the screen whose job is to show what went wrong.
    let ambiguous = false;
    const warnIfAmbiguous = (what: string) => {
      if (!ambiguous) return;
      pushIssue(
        lineNumber,
        raw,
        `this was read as the "${what}" setting because it starts with that word. If it was meant to be a task, give it a different title.`,
        "warning"
      );
    };

    const dateFormat = directiveValue(line, "dateformat");
    if (dateFormat !== null) {
      const value = dateFormat;
      ambiguous = looksLikeTaskMeta(value);
      warnIfAmbiguous("dateFormat");
      if (ambiguous) {
        // The line was almost certainly a task. Taking its meta for a
        // declared date format would suppress the "no dateFormat declared"
        // warning the chart actually deserves, and raise an error quoting
        // task meta as if it were a format string.
        continue;
      }
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
    const titleValue = directiveValue(line, "title");
    if (titleValue !== null) {
      ambiguous = looksLikeTaskMeta(titleValue);
      warnIfAmbiguous("title");
      title = titleValue || null;
      continue;
    }
    const excludesValue = directiveValue(line, "excludes");
    if (excludesValue !== null) {
      ambiguous = looksLikeTaskMeta(excludesValue);
      warnIfAmbiguous("excludes");
      const value = excludesValue.toLowerCase();
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
    // The one branch that DISCARDS a line outright, so the one that most
    // needs the warning. Without it, `Weekday cover :w1, 2026-01-05, 5d` and
    // `Todaymarker review :x1, …` disappeared with no issue of any kind —
    // the same silent loss the word boundary was added to stop, narrowed to
    // the five directives this import has no use for.
    const ignored = IGNORED_DIRECTIVES.map(
      (keyword) => [keyword, directiveValue(line, keyword)] as const
    ).find(([, value]) => value !== null);
    if (ignored !== undefined) {
      ambiguous = couldBeADiscardedTask(ignored[1] ?? "");
      warnIfAmbiguous(ignored[0]);
      continue;
    }

    const sectionText = directiveValue(line, "section");
    if (sectionText !== null) {
      ambiguous = looksLikeTaskMeta(sectionText);
      warnIfAmbiguous("section");
      const text = sectionText;
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
      if (start === null) {
        pushIssue(lineNumber, raw, `"${startToken}" is not a real date`);
        continue;
      }
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
      const parsedEnd = toDate(endToken);
      if (parsedEnd === null) {
        pushIssue(lineNumber, raw, `"${endToken}" is not a real date`);
        continue;
      }
      end = parsedEnd;
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
      if (excludesWeekends && isWeekend(start) && !isMilestone) {
        // The duration is laid out over working days, so a bar that started
        // on a weekend would end a working day later than mermaid draws it
        // while still claiming the weekend start. Move the start to the
        // first working day — and say so, because it is a date the chart
        // did not write.
        //
        // NOT a milestone: that is a point, not a bar (and it reaches this
        // branch because mermaid spells it `:milestone, m1, <date>, 0d`).
        // It has no duration to lay out, and mermaid draws it on the day it
        // was given, weekend or not.
        const moved = firstWorkingDay(start, true);
        pushIssue(
          lineNumber,
          raw,
          `it starts on a weekend, which this chart excludes, so it was moved to ${toIso(moved)}`,
          "warning"
        );
        start = moved;
      }
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
