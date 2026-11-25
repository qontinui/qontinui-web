/**
 * The initiative document's schedule blocks, read and written structurally.
 *
 * Plan `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, Phase 7.
 * The project Overview is DERIVED ONLY from coord: its milestones, dates and
 * forecast calendar are declared in the initiative document's frontmatter
 * (`milestones:`, `calendar:`, `programme:`), and the Overview reads them with
 * `backend/app/overview/coord_schedule.py` (`parse_initiative`, `parse_milestones`,
 * `parse_calendar`). This module is the TypeScript twin of that reader, used for
 * two things only:
 *
 * - the editor panel's live "what the overview will read" preview, which must say
 *   what the backend will say; both parsers run the SAME fixture file
 *   (`__fixtures__/initiative-schedule.cases.json`), so a drift fails a test on
 *   either side;
 * - writing the three blocks back into the document body, leaving every other
 *   frontmatter line and the whole prose byte for byte as it was.
 *
 * Nothing here talks to coord. The panel hands the new body to the page's
 * existing save path (`PATCH /coord/prompt-documents/{kind}/{name}`), so coord
 * versions and attributes every change.
 */

export interface MilestoneEntry {
  id: string;
  name: string;
  /** Kept as typed: an unreadable date round-trips and is flagged, never repaired. */
  date: string;
  shown_by: string;
  work_unit: string;
  gate: string;
  decision_record: string;
  /** Keys this panel has no field for; written back as they were. */
  extra?: Record<string, string>;
}

export interface CalendarBreakEntry {
  start: string;
  end: string;
  label: string;
  /** Keys this panel has no field for; written back as they were. */
  extra?: Record<string, string>;
}

export interface CalendarEntry {
  /** As typed; readable only when a number in (0, 1]. */
  working_day_factor: string;
  breaks: CalendarBreakEntry[];
}

export interface ReadMilestone {
  id: string | null;
  name: string;
  date: string;
  shown_by: string;
  work_unit: string | null;
  gate: string | null;
}

export interface ReadCalendar {
  working_day_factor: string;
  breaks: CalendarBreakEntry[];
}

export interface ScheduleRead {
  frontmatterFound: boolean;
  programme: string | null;
  /** `milestones:` list present (it wins over the legacy markdown table). */
  listPresent: boolean;
  /** Every list item that is a structured map, readable or not, for editing. */
  entries: MilestoneEntry[];
  /** What the overview will list as milestones. */
  milestones: ReadMilestone[];
  /** Rows the overview will list as "could not be read", verbatim. */
  milestonesUnreadable: string[];
  /** Unreadable list lines that are not even `key: value`; dropped on save. */
  structuralUnreadable: string[];
  calendar: ReadCalendar | null;
  calendarUnreadable: string[];
  /** A `calendar:` block exists (readable or not). */
  calendarPresent: boolean;
  /** The calendar was written inline (`calendar: {...}`): listed as unreadable. */
  calendarInline: boolean;
}

// ---------------------------------------------------------------------------
// The reader (mirror of backend/app/overview/coord_schedule.py)
// ---------------------------------------------------------------------------

const FRONTMATTER = /^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `text` as one real ISO date, else `null` (a range or `~date` is not one). */
export function validDate(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const cell = text.replace(/[*_`]/g, "").trim();
  if (!DATE.test(cell)) return null;
  const [y = 0, m = 0, d = 0] = cell.split("-").map(Number);
  const probe = new Date(Date.UTC(2000, m - 1, d));
  // Years 0-99 are 19xx to `Date.UTC`; set the year explicitly, as Python's
  // `date.fromisoformat` takes it literally.
  probe.setUTCFullYear(y, m - 1, d);
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return cell;
}

function unquote(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    v[0] === v[v.length - 1] &&
    (v[0] === '"' || v[0] === "'")
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function splitKv(line: string): [string, string] | null {
  const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim());
  return m ? [m[1] ?? "", unquote(m[2] ?? "")] : null;
}

/**
 * Split a flow map's body on commas, with the SAME pattern the backend uses
 * (`_FLOW_SPLIT` in coord_schedule.py), so an apostrophe or a quote that never
 * closes splits where the Overview's reader splits, not where a "smarter" scanner
 * would.
 */
const FLOW_SPLIT = /,(?=(?:[^"']|"[^"]*"|'[^']*')*$)/;
function flowSplit(text: string): string[] {
  return text.split(FLOW_SPLIT).filter((p) => p.trim() !== "");
}

type Item = Record<string, string>;

function parseItems(lines: string[]): { entries: Item[]; unparsed: string[] } {
  const entries: Item[] = [];
  const unparsed: string[] = [];
  let current: Item | null = null;
  let currentRaw: string[] = [];
  const finish = () => {
    if (current) entries.push(current);
    current = null;
    currentRaw = [];
  };
  for (const raw of lines) {
    const stripped = raw.trim();
    if (stripped.startsWith("- ")) {
      finish();
      const item = stripped.slice(2).trim();
      if (item.startsWith("{") && item.endsWith("}")) {
        const parsed: Item = {};
        let ok = true;
        for (const part of flowSplit(item.slice(1, -1))) {
          const kv = splitKv(part);
          if (!kv) {
            ok = false;
            break;
          }
          parsed[kv[0]] = kv[1];
        }
        if (ok && Object.keys(parsed).length > 0) entries.push(parsed);
        else unparsed.push(stripped);
        continue;
      }
      const kv = splitKv(item);
      if (!kv) {
        unparsed.push(stripped);
        continue;
      }
      current = { [kv[0]]: kv[1] };
      currentRaw = [stripped];
    } else if (current) {
      const kv = splitKv(stripped);
      if (!kv) {
        unparsed.push([...currentRaw, stripped].join("\n"));
        current = null;
      } else {
        current[kv[0]] = kv[1];
        currentRaw.push(stripped);
      }
    } else {
      unparsed.push(stripped);
    }
  }
  finish();
  return { entries, unparsed };
}

function describeEntry(entry: Item): string {
  return Object.entries(entry)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

function milestoneId(name: string): string | null {
  const m = /^([A-Z][A-Z0-9-]*)\b/.exec(name);
  return m?.[1] ?? null;
}

/** The `Target date | Milestone | Shown by` table (the tolerated legacy form). */
function parseMilestoneTable(body: string): {
  rows: ReadMilestone[];
  unparsed: string[];
} {
  const rows: ReadMilestone[] = [];
  const unparsed: string[] = [];
  let headerFound = false;
  let inTable = false;
  for (const ln of body.split(/\r?\n/)) {
    const s = ln.trim();
    if (!s.startsWith("|")) {
      if (s.startsWith("#")) inTable = false;
      continue;
    }
    const cells = s
      .replace(/^\|+|\|+$/g, "")
      .split("|")
      .map((c) => c.trim());
    const low = cells.map((c) => c.toLowerCase());
    if (
      cells.length >= 2 &&
      (low[0] ?? "").startsWith("target date") &&
      (low[1] ?? "").includes("milestone")
    ) {
      inTable = headerFound = true;
      continue;
    }
    if (!inTable) {
      if (
        headerFound &&
        cells.length > 0 &&
        /\d{4}-\d{2}-\d{2}/.test(cells[0] ?? "")
      ) {
        unparsed.push(s);
      }
      continue;
    }
    if (
      cells.some(Boolean) &&
      cells.filter(Boolean).every((c) => /^:?-{2,}:?$/.test(c))
    ) {
      continue;
    }
    const date = cells.length > 0 ? validDate(cells[0]) : null;
    if (date && cells.length >= 2 && cells[1]) {
      const name = cells[1].replace(/[*_`]/g, "").trim();
      rows.push({
        id: milestoneId(name),
        name,
        date,
        shown_by: cells[2] ?? "",
        work_unit: null,
        gate: null,
      });
    } else {
      unparsed.push(s);
    }
  }
  return { rows, unparsed };
}

const MILESTONE_KEYS = new Set([
  "id",
  "name",
  "date",
  "target_date",
  "target",
  "shown_by",
  "work_unit",
  "gate",
  "decision_record",
]);

function extrasOf(item: Item, known: Set<string>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(item)) if (!known.has(k)) extra[k] = v;
  return extra;
}

/** The backend reads the date as `date or target_date or target` (empty falls through). */
function dateOf(item: Item): string {
  return item.date || item.target_date || item.target || "";
}

/** `target_date` / `target` are folded into `date` only when `date` is empty;
 *  otherwise they are extra keys and are written back, not dropped. */
function knownMilestoneKeys(item: Item): Set<string> {
  if (item.date) {
    const keys = new Set(MILESTONE_KEYS);
    keys.delete("target_date");
    keys.delete("target");
    return keys;
  }
  return MILESTONE_KEYS;
}

function entryOf(item: Item): MilestoneEntry {
  return {
    id: item.id ?? "",
    name: item.name ?? "",
    date: dateOf(item),
    shown_by: item.shown_by ?? "",
    work_unit: item.work_unit ?? "",
    gate: item.gate ?? "",
    decision_record: item.decision_record ?? "",
    extra: extrasOf(item, knownMilestoneKeys(item)),
  };
}

function frontmatterLines(text: string): string[] | null {
  const m = FRONTMATTER.exec(text);
  if (!m) return null;
  return m[0].split(/\r?\n/).slice(1);
}

function parseCalendarBlock(lines: string[]): {
  calendar: ReadCalendar | null;
  unreadable: string[];
} {
  const unreadable: string[] = [];
  let factorRaw: string | null = null;
  const breakLines: string[] = [];
  let inBreaks = false;
  let breaksIndent = 0;
  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const stripped = raw.trim();
    if (inBreaks && (stripped.startsWith("- ") || indent > breaksIndent)) {
      breakLines.push(raw);
      continue;
    }
    inBreaks = false;
    const kv = splitKv(stripped);
    if (!kv) unreadable.push(stripped);
    else if (kv[0] === "working_day_factor") factorRaw = kv[1];
    else if (kv[0] === "breaks" && kv[1] === "") {
      inBreaks = true;
      breaksIndent = indent;
    } else unreadable.push(stripped);
  }
  const { entries, unparsed } = parseItems(breakLines);
  unreadable.push(...unparsed);
  const breaks: CalendarBreakEntry[] = [];
  for (const entry of entries) {
    const start = validDate(entry.start);
    const end = validDate(entry.end);
    if (start && end && start <= end) {
      breaks.push({ start, end, label: entry.label ?? "" });
    } else {
      unreadable.push(describeEntry(entry));
    }
  }
  const factor =
    factorRaw !== null && /^(\d+\.?\d*|\.\d+)$/.test(factorRaw.trim())
      ? Number(factorRaw)
      : NaN;
  if (!(Number.isFinite(factor) && factor > 0 && factor <= 1)) {
    unreadable.push(
      factorRaw !== null
        ? `working_day_factor: ${factorRaw}`
        : "working_day_factor is missing"
    );
    return { calendar: null, unreadable };
  }
  return {
    calendar: { working_day_factor: factorRaw as string, breaks },
    unreadable,
  };
}

/** Read the initiative document the way the overview will. */
export function readSchedule(text: string): ScheduleRead {
  const out: ScheduleRead = {
    frontmatterFound: false,
    programme: null,
    listPresent: false,
    entries: [],
    milestones: [],
    milestonesUnreadable: [],
    structuralUnreadable: [],
    calendar: null,
    calendarUnreadable: [],
    calendarPresent: false,
    calendarInline: false,
  };
  const match = FRONTMATTER.exec(text);
  if (!match) {
    return out;
  }
  out.frontmatterFound = true;
  const prose = text.slice(match[0].length).replace(/^\s+/, "");
  const scalars: Record<string, string> = {};
  let openKey: "milestones" | "calendar" | null = null;
  const milestoneLines: string[] = [];
  const calendarLines: string[] = [];
  let calendarInline = "";
  for (const raw of frontmatterLines(text) ?? []) {
    if (raw.trim() === "---") break;
    if (!raw.trim()) continue;
    const topLevel = !/^\s/.test(raw) && !raw.trimStart().startsWith("- ");
    if (topLevel) {
      openKey = null;
      const kv = splitKv(raw);
      if (!kv) continue;
      const [key, value] = kv;
      if ((key === "milestones" || key === "calendar") && value === "") {
        openKey = key;
        if (key === "milestones") out.listPresent = true;
        else out.calendarPresent = true;
      } else if (key === "calendar") {
        calendarInline = value;
        out.calendarPresent = true;
        out.calendarInline = true;
      } else {
        scalars[key] = value;
      }
      continue;
    }
    if (openKey === "milestones") milestoneLines.push(raw);
    else if (openKey === "calendar") calendarLines.push(raw);
  }
  out.programme = scalars.programme ?? null;

  if (out.listPresent) {
    const { entries, unparsed } = parseItems(milestoneLines);
    out.structuralUnreadable = unparsed;
    out.milestonesUnreadable = [...unparsed];
    for (const item of entries) {
      out.entries.push(entryOf(item));
      const date = validDate(dateOf(item));
      const name = (item.name ?? "").trim();
      if (date && name) {
        out.milestones.push({
          id: item.id || milestoneId(name),
          name,
          date,
          shown_by: item.shown_by ?? "",
          work_unit: item.work_unit || null,
          gate: item.gate || null,
        });
      } else {
        out.milestonesUnreadable.push(describeEntry(item));
      }
    }
  } else {
    const { rows, unparsed } = parseMilestoneTable(prose);
    out.milestones = rows;
    out.milestonesUnreadable = unparsed;
  }

  if (
    calendarLines.length > 0 ||
    (out.calendarPresent && calendarInline === "")
  ) {
    const { calendar, unreadable } = parseCalendarBlock(calendarLines);
    out.calendar = calendar;
    out.calendarUnreadable = unreadable;
  } else if (calendarInline !== "") {
    out.calendarUnreadable = [`calendar: ${calendarInline}`];
  }
  return out;
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

export interface ScheduleDraft {
  programme: string;
  milestones: MilestoneEntry[];
  /** `null` writes no `calendar:` block (the forecast is then unknown). */
  calendar: CalendarEntry | null;
}

export function blankMilestone(): MilestoneEntry {
  return {
    id: "",
    name: "",
    date: "",
    shown_by: "",
    work_unit: "",
    gate: "",
    decision_record: "",
  };
}

/** The draft the panel starts from: the list when present, else the legacy table. */
export function draftFromBody(text: string): ScheduleDraft {
  const read = readSchedule(text);
  const milestones = read.listPresent
    ? read.entries
    : read.milestones.map((m) => ({
        id: m.id ?? "",
        name: m.name,
        date: m.date,
        shown_by: m.shown_by,
        work_unit: "",
        gate: "",
        decision_record: "",
      }));
  let calendar: CalendarEntry | null = null;
  if (read.calendarPresent) {
    calendar = readCalendarEntry(text);
    if (read.calendarInline) {
      // Carry the declared factor across instead of blanking it; the rest of
      // an inline map (breaks) is listed as unreadable and not carried.
      const inline = /working_day_factor:\s*([0-9.]+)/.exec(
        readInlineCalendar(text)
      );
      if (inline) calendar.working_day_factor = inline[1] ?? "";
    }
  }
  return { programme: read.programme ?? "", milestones, calendar };
}

/** The `calendar:` block as typed (readable or not), for editing. */
const BREAK_KEYS = new Set(["start", "end", "label"]);

function readInlineCalendar(text: string): string {
  for (const raw of frontmatterLines(text) ?? []) {
    if (raw.trim() === "---") break;
    const kv = splitKv(raw);
    if (kv && kv[0] === "calendar") return kv[1];
  }
  return "";
}

function readCalendarEntry(text: string): CalendarEntry {
  const lines: string[] = [];
  let open = false;
  for (const raw of frontmatterLines(text) ?? []) {
    if (raw.trim() === "---") break;
    if (!raw.trim()) continue;
    const topLevel = !/^\s/.test(raw) && !raw.trimStart().startsWith("- ");
    if (topLevel) {
      const kv = splitKv(raw);
      open = kv !== null && kv[0] === "calendar" && kv[1] === "";
      continue;
    }
    if (open) lines.push(raw);
  }
  let factor = "";
  const breakLines: string[] = [];
  let inBreaks = false;
  let breaksIndent = 0;
  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const stripped = raw.trim();
    if (inBreaks && (stripped.startsWith("- ") || indent > breaksIndent)) {
      breakLines.push(raw);
      continue;
    }
    inBreaks = false;
    const kv = splitKv(stripped);
    if (kv && kv[0] === "working_day_factor") factor = kv[1];
    else if (kv && kv[0] === "breaks" && kv[1] === "") {
      inBreaks = true;
      breaksIndent = indent;
    }
  }
  const { entries } = parseItems(breakLines);
  return {
    working_day_factor: factor,
    breaks: entries.map((e) => ({
      extra: extrasOf(e, BREAK_KEYS),
      start: e.start ?? "",
      end: e.end ?? "",
      label: e.label ?? "",
    })),
  };
}

/** One scalar value as the backend's reader gives it back unchanged. */
function emit(value: string): string {
  const v = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (
    v.length >= 2 &&
    v[0] === v[v.length - 1] &&
    (v[0] === '"' || v[0] === "'")
  ) {
    return `"${v}"`;
  }
  return v;
}

function kvLine(key: string, value: string, prefix: string): string {
  const v = emit(value);
  return v === "" ? `${prefix}${key}:` : `${prefix}${key}: ${v}`;
}

function milestoneLines(entries: MilestoneEntry[]): string[] {
  const lines = ["milestones:"];
  for (const e of entries) {
    const keys: [string, string][] = [
      ["id", e.id],
      ["name", e.name],
      ["date", e.date],
      ["shown_by", e.shown_by],
      ["work_unit", e.work_unit],
      ["gate", e.gate],
      ["decision_record", e.decision_record],
    ];
    for (const [k, v] of Object.entries(e.extra ?? {})) keys.push([k, v]);
    // The first key opens the item, so it must exist even when empty.
    const present = keys.filter(([, v], i) => i < 3 || emit(v) !== "");
    present.forEach(([k, v], i) => {
      lines.push(kvLine(k, v, i === 0 ? "  - " : "    "));
    });
  }
  return lines;
}

function calendarLines(calendar: CalendarEntry): string[] {
  const lines = [
    "calendar:",
    kvLine("working_day_factor", calendar.working_day_factor, "  "),
  ];
  if (calendar.breaks.length > 0) {
    lines.push("  breaks:");
    for (const b of calendar.breaks) {
      lines.push(kvLine("start", b.start, "    - "));
      lines.push(kvLine("end", b.end, "      "));
      lines.push(kvLine("label", b.label, "      "));
      for (const [k, v] of Object.entries(b.extra ?? {})) {
        lines.push(kvLine(k, v, "      "));
      }
    }
  }
  return lines;
}

/**
 * Write `draft` into `text`'s frontmatter. The three keys (`programme`,
 * `milestones`, `calendar`) are replaced; every other frontmatter line and the
 * prose are left exactly as they were. A document with no frontmatter gets one.
 */
export function applySchedule(text: string, draft: ScheduleDraft): string {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const fresh: string[] = [];
  const programme = emit(draft.programme);
  if (programme !== "") fresh.push(`programme: ${programme}`);
  if (draft.milestones.length > 0) {
    fresh.push(...milestoneLines(draft.milestones));
  } else {
    // Removing the last row must not bring the legacy table back to life: an
    // empty `milestones:` list wins over the table, and says "none declared".
    const had = readSchedule(text);
    if (had.listPresent || had.milestones.length > 0) fresh.push("milestones:");
  }
  if (draft.calendar !== null) fresh.push(...calendarLines(draft.calendar));

  const match = FRONTMATTER.exec(text);
  if (!match) {
    if (fresh.length === 0) return text;
    return `---${eol}${fresh.join(eol)}${eol}---${eol}${eol}${text}`;
  }
  const block = match[0];
  const bom = block.startsWith("﻿") ? "﻿" : "";
  const lines = block.slice(bom.length).split(/\r?\n/);
  // lines: ["---", ...body lines, "---", ""?]
  const open = lines[0] ?? "---";
  let closeIndex = lines.length - 1;
  while (closeIndex > 0 && !/^---[ \t]*$/.test(lines[closeIndex] ?? ""))
    closeIndex -= 1;
  const close = lines[closeIndex] ?? "---";
  const tail = block.endsWith("\n") ? eol : "";
  const kept: string[] = [];
  let skipping = false;
  for (const raw of lines.slice(1, closeIndex)) {
    const topLevel =
      raw.trim() !== "" &&
      !/^\s/.test(raw) &&
      !raw.trimStart().startsWith("- ");
    if (topLevel) {
      const kv = splitKv(raw);
      const key = kv ? kv[0] : null;
      skipping =
        key === "programme" || key === "milestones" || key === "calendar";
      if (skipping) continue;
    } else if (skipping) {
      continue;
    }
    kept.push(raw);
  }
  const rebuilt = `${bom}${[open, ...kept, ...fresh, close].join(eol)}${tail}`;
  return rebuilt + text.slice(block.length);
}
