/**
 * Reading the two tables a delivery plan is actually written in — the role
 * list and the phase × role FTE matrix — pasted as CSV.
 *
 * Pure functions with no clock, no network and no React: the editor holds the
 * result, shows it for confirmation and only then saves. Kept separate from
 * the components on purpose, so the shared overview authoring layer (plan
 * `2026-09-20-overview-authoring-layer`) can reuse the parsing without the UI.
 *
 * A row that cannot be read becomes an `issue` naming its line and what was
 * expected. Nothing is guessed and nothing is dropped silently.
 */

import { parseAmountToMicros } from "@/components/overview/money";

export interface CsvIssue {
  /** 1-based line number in the pasted text. */
  line: number;
  text: string;
  message: string;
  severity: "error" | "warning";
}

export interface ParsedRoleRow {
  code: string;
  name: string;
  responsibility: string;
  day_rate_micros: number | null;
  currency: string | null;
  client_side: boolean;
}

export interface ParsedAllocationRow {
  phase_code: string;
  role_code: string;
  fte: string;
}

export interface CsvResult<T> {
  rows: T[];
  issues: CsvIssue[];
}

/**
 * One CSV line into fields, honouring double quotes and `""` escapes. Written
 * out rather than pulled from a library because the whole input is one pasted
 * table and a dependency for 30 lines is not worth the supply chain.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "," || ch === "\t") {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function nonEmptyLines(text: string): { line: number; text: string }[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((text, index) => ({ line: index + 1, text }))
    .filter((row) => row.text.trim() !== "");
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "client", "client-side"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "", "delivery"]);

/** `true` when the first row names columns rather than holding data. */
function looksLikeHeader(fields: string[]): boolean {
  const first = (fields[0] ?? "").toLowerCase();
  return first === "code" || first === "role" || first === "role code";
}

/**
 * Roles: `code, name, responsibility, day rate, currency, client side`.
 *
 * Only `code` and `name` are required. A rate without a currency is an error
 * rather than a guess — the backend refuses it too, and an amount whose unit
 * nobody recorded is exactly the figure that later gets added to a different
 * currency.
 */
export function parseRolesCsv(text: string): CsvResult<ParsedRoleRow> {
  const issues: CsvIssue[] = [];
  const rows: ParsedRoleRow[] = [];
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return { rows, issues };

  const start = looksLikeHeader(splitCsvLine(lines[0]?.text ?? "")) ? 1 : 0;
  const seen = new Set<string>();

  for (const entry of lines.slice(start)) {
    const fields = splitCsvLine(entry.text);
    const [code, name, responsibility, rate, currency, clientSide] = [
      fields[0] ?? "",
      fields[1] ?? "",
      fields[2] ?? "",
      fields[3] ?? "",
      fields[4] ?? "",
      fields[5] ?? "",
    ];
    if (code === "") {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: "this row has no role code in its first column",
        severity: "error",
      });
      continue;
    }
    if (seen.has(code)) {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: `the role code "${code}" appears more than once`,
        severity: "error",
      });
      continue;
    }

    const clientSideWord = clientSide.toLowerCase();
    let isClientSide = false;
    if (TRUE_WORDS.has(clientSideWord)) isClientSide = true;
    else if (!FALSE_WORDS.has(clientSideWord)) {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: `"${clientSide}" was not read as yes or no, so this role was treated as ours rather than the client's`,
        severity: "warning",
      });
    }

    let micros: number | null = null;
    let iso: string | null = null;
    if (rate !== "") {
      micros = parseAmountToMicros(rate);
      if (micros === null || micros < 0) {
        issues.push({
          line: entry.line,
          text: entry.text,
          message: `"${rate}" was not read as a day rate`,
          severity: "error",
        });
        continue;
      }
      const code3 = currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code3)) {
        issues.push({
          line: entry.line,
          text: entry.text,
          message:
            "a day rate has to name its currency as a three-letter code, e.g. EUR",
          severity: "error",
        });
        continue;
      }
      iso = code3;
    }

    seen.add(code);
    rows.push({
      code,
      name: name || code,
      responsibility,
      day_rate_micros: micros,
      currency: iso,
      client_side: isClientSide,
    });
  }

  return { rows, issues };
}

/**
 * The FTE matrix: a header row of phase codes, then one row per role.
 *
 *     role,A0,A1,A2
 *     DL,0.5,0.5,1
 *     BE,,2,2
 *
 * An empty cell means "this role is not on that phase" and produces no row —
 * which is not the same as an allocation of 0, and is why blanks are skipped
 * rather than zero-filled.
 */
export function parseAllocationsCsv(
  text: string
): CsvResult<ParsedAllocationRow> {
  const issues: CsvIssue[] = [];
  const rows: ParsedAllocationRow[] = [];
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return { rows, issues };

  const first = lines[0];
  const header = splitCsvLine(first?.text ?? "");
  const phaseCodes = header.slice(1).map((c) => c.trim());
  if (phaseCodes.length === 0 || phaseCodes.every((c) => c === "")) {
    issues.push({
      line: first?.line ?? 1,
      text: first?.text ?? "",
      message:
        "the first row has to name the phases, e.g. `role,A0,A1,A2` — nothing after the first column was found",
      severity: "error",
    });
    return { rows, issues };
  }

  const seen = new Set<string>();
  for (const entry of lines.slice(1)) {
    const fields = splitCsvLine(entry.text);
    const roleCode = (fields[0] ?? "").trim();
    if (roleCode === "") {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: "this row has no role code in its first column",
        severity: "error",
      });
      continue;
    }
    if (seen.has(roleCode)) {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: `the role "${roleCode}" appears more than once`,
        severity: "error",
      });
      continue;
    }
    seen.add(roleCode);

    if (fields.length - 1 > phaseCodes.length) {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: `this row has more values than the ${phaseCodes.length} phases named in the first row; the extra ones were ignored`,
        severity: "warning",
      });
    }

    phaseCodes.forEach((phaseCode, index) => {
      if (phaseCode === "") return;
      const cell = (fields[index + 1] ?? "").trim();
      if (cell === "" || cell === "-") return;
      if (!/^\d*(\.\d+)?$/.test(cell) || cell === ".") {
        issues.push({
          line: entry.line,
          text: entry.text,
          message: `"${cell}" under ${phaseCode} was not read as a number of people`,
          severity: "error",
        });
        return;
      }
      if (Number(cell) === 0) return;
      rows.push({ phase_code: phaseCode, role_code: roleCode, fte: cell });
    });
  }

  return { rows, issues };
}

export interface ParsedEffortRow {
  phase_code: string;
  task_number: string;
  role_code: string;
  planned_person_days: string;
}

/**
 * The task × role person-day split, in long form:
 *
 *     phase,task,role,days
 *     A0,1.1,DL,4
 *     A0,1.1,BE,6
 *
 * Long form rather than a matrix because tasks belong to phases and a single
 * wide table cannot address them without repeating the phase in the header
 * anyway. It is also what a spreadsheet exports when the split is sparse,
 * which it usually is.
 *
 * This is the ONLY source of person-days (the FTE matrix is a separate,
 * independent table), so a row this cannot read is an error rather than a
 * silently missing day.
 */
export function parseEffortsCsv(text: string): CsvResult<ParsedEffortRow> {
  const issues: CsvIssue[] = [];
  const rows: ParsedEffortRow[] = [];
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return { rows, issues };

  const firstCell = (splitCsvLine(lines[0]?.text ?? "")[0] ?? "").toLowerCase();
  const start = firstCell === "phase" ? 1 : 0;
  const seen = new Set<string>();

  for (const entry of lines.slice(start)) {
    const fields = splitCsvLine(entry.text);
    const [phase, task, role, days] = [
      (fields[0] ?? "").trim(),
      (fields[1] ?? "").trim(),
      (fields[2] ?? "").trim(),
      (fields[3] ?? "").trim(),
    ];
    if (phase === "" || task === "" || role === "") {
      issues.push({
        line: entry.line,
        text: entry.text,
        message:
          "each row needs a phase, a task number and a role before its number of days",
        severity: "error",
      });
      continue;
    }
    if (!/^\d*(\.\d+)?$/.test(days) || days === "" || days === ".") {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: `"${days}" was not read as a number of days`,
        severity: "error",
      });
      continue;
    }
    const key = `${phase}:${task}:${role}`;
    if (seen.has(key)) {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: `${role} is already given days on task ${task} of ${phase}`,
        severity: "error",
      });
      continue;
    }
    if (Number(days) === 0) continue;
    if (isFinerThanStored(days)) {
      // Said rather than discovered: the column keeps two decimal places and
      // Postgres rounds silently, so without this the editor's own total
      // changes the moment it is saved and the Team page disagrees with the
      // number the editor showed a second earlier.
      issues.push({
        line: entry.line,
        text: entry.text,
        message: `days are kept to two decimal places, so "${days}" will be stored as ${roundToStoredGrain(days)}`,
        severity: "warning",
      });
    }
    seen.add(key);
    rows.push({
      phase_code: phase,
      task_number: task,
      role_code: role,
      planned_person_days: days,
    });
  }

  return { rows, issues };
}

/**
 * The grain `overview.task_efforts.planned_person_days` actually stores:
 * `NUMERIC(10, 2)`. Postgres rounds silently at this precision, so it is
 * also the grain the paste box and the running total have to speak, or the
 * three disagree the moment anything is saved.
 */
const PERSON_DAY_DECIMALS = 2;

/**
 * Total a column of person-day strings exactly.
 *
 * Days are exact decimal strings everywhere else in this feature precisely
 * so no float ever touches them, and `reduce((a, b) => a + Number(b), 0)`
 * threw that away for a label. Summed in hundredths as integers instead —
 * the grain the column stores.
 *
 * Two earlier cuts were wrong in opposite directions, and both are worth
 * naming because the next edit will be tempted by one of them. The first
 * required a leading digit and at most two decimals, so `.5` — which the
 * paste box beside it accepts — made the whole line read "An unreadable
 * number of", reporting a defect in the summing as a defect in the data.
 * The second scaled to the widest fraction in the column, which made the
 * precision budget SHARED: one spreadsheet-exported `0.333333333333333`
 * anywhere in the column overflowed the safe-integer range and refused the
 * whole total. The grain is fixed, so the budget is per-value and the
 * column's length cannot exhaust it.
 *
 * `null` only when a value really is unreadable, so one bad row shows as
 * unreadable rather than as a silently smaller total.
 */
export function sumPersonDays(values: string[]): string | null {
  let hundredths = 0;
  for (const value of values) {
    const parsed = personDayHundredths(value);
    if (parsed === null) return null;
    hundredths += parsed;
  }
  const whole = Math.trunc(hundredths / 100);
  const rest = String(hundredths % 100)
    .padStart(PERSON_DAY_DECIMALS, "0")
    .replace(/0+$/, "");
  return rest === "" ? String(whole) : `${whole}.${rest}`;
}

/**
 * One person-day value as a whole number of hundredths, or `null` when it
 * cannot be read. Accepts exactly what `parseEffortsCsv` accepts, including
 * a bare `.5`; anything finer than the stored grain is ROUNDED here, the
 * same way the database rounds it, and `parseEffortsCsv` says so.
 */
function personDayHundredths(value: string): number | null {
  const match = /^(\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[1] === "" && match[2] === undefined)) return null;
  const whole = Number(match[1] || "0");
  const fraction = match[2] ?? "";
  if (!Number.isSafeInteger(whole)) return null;
  const rounded = Math.round(
    Number(`0.${fraction || "0"}`) * 10 ** PERSON_DAY_DECIMALS
  );
  return whole * 100 + rounded;
}

/** `value` as the store will hold it, for a message that names the figure. */
function roundToStoredGrain(value: string): string {
  const hundredths = personDayHundredths(value);
  return hundredths === null ? value : (sumPersonDays([value]) ?? value);
}

/** True when `value` carries more precision than the store keeps. */
function isFinerThanStored(value: string): boolean {
  const fraction = /^\d*(?:\.(\d+))?$/.exec(value.trim())?.[1] ?? "";
  return fraction.replace(/0+$/, "").length > PERSON_DAY_DECIMALS;
}
