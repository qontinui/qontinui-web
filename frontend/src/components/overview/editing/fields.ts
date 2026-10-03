/**
 * A record-table row to and from the text a person edits, checked against the
 * schema the server serves for it.
 *
 * Pure, so the rules are testable without rendering: `RecordTable` edits a
 * row as text (`rowToText`), turns it back with `textToRow` — which refuses
 * what the API would refuse, naming the field — and runs the same check over
 * every row a CSV paste produced (`rowProblems`), so a pasted value the column
 * cannot hold is caught on its line rather than by the save.
 */

import {
  formatMicros,
  microsToAmountInput,
  parseAmountToMicros,
} from "@/components/overview/money";
import type { JsonSchema } from "./api";
import type { FieldDeclaration, TableDeclaration } from "./registry";
import { checkField } from "./validation";

/** A row as edited: every field as text, a flag as a boolean. A money field
 *  keeps its amount under `field` and its currency under `currencyField`. */
export type RowText = Record<string, string | boolean>;

const DECIMAL = /^\d*(\.\d+)?$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, not just the shape of one (`2026-02-30` is not). */
function isCalendarDay(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The fields a row is read and written through — a table's, or a form's. */
type HasFields<Row> = { fields: FieldDeclaration<Row>[] };

function get(row: object, field: string): unknown {
  return (row as Record<string, unknown>)[field];
}

export function rowToText<Row extends object>(
  table: HasFields<Row>,
  row: Row
): RowText {
  const text: RowText = {};
  for (const field of table.fields) {
    const value = get(row, field.field);
    if (field.kind === "flag") {
      text[field.field] = value === true;
    } else if (field.kind === "money") {
      text[field.field] = microsToAmountInput(value as number | null);
      text[field.currencyField] = String(get(row, field.currencyField) ?? "");
    } else {
      text[field.field] =
        value === null || value === undefined ? "" : String(value);
    }
  }
  return text;
}

function str(text: RowText, field: string): string {
  const value = text[field];
  return typeof value === "string" ? value : "";
}

/** One field's value from its text, or the sentence saying why it can't be. */
function readField<Row>(
  field: FieldDeclaration<Row>,
  text: RowText,
  rowSchema: JsonSchema | undefined
): { values: Record<string, unknown> } | { error: string } {
  const property = rowSchema?.properties?.[field.field];
  const empty = (s: string) => s.trim() === "";
  switch (field.kind) {
    case "flag":
      return { values: { [field.field]: text[field.field] === true } };
    case "code":
    case "text": {
      const raw = str(text, field.field);
      const value = field.kind === "code" ? raw.trim() : raw;
      if (field.required && empty(value))
        return { error: `${field.label} can't be empty.` };
      const problem = checkField(property, value, field.label);
      return problem
        ? { error: problem }
        : { values: { [field.field]: value } };
    }
    case "decimal": {
      const value = str(text, field.field).trim();
      if (value === "") {
        return field.required
          ? { error: `${field.label} can't be empty.` }
          : { values: { [field.field]: null } };
      }
      if (!DECIMAL.test(value) || value === ".")
        return { error: `${field.label} must be a number, e.g. 1.5.` };
      const problem = checkField(property, value, field.label);
      return problem
        ? { error: problem }
        : { values: { [field.field]: value } };
    }
    case "date": {
      const value = str(text, field.field).trim();
      if (value === "") {
        return field.required
          ? { error: `${field.label} can't be empty.` }
          : { values: { [field.field]: null } };
      }
      return isCalendarDay(value)
        ? { values: { [field.field]: value } }
        : { error: `${field.label} must be a date, e.g. 2026-10-03.` };
    }
    case "choice": {
      const value = str(text, field.field);
      if (value === "") {
        return field.required
          ? { error: `Choose the ${field.label.toLowerCase()}.` }
          : { values: { [field.field]: null } };
      }
      return field.options.some((o) => o.value === value)
        ? { values: { [field.field]: value } }
        : { error: `${field.label} isn't one of the choices.` };
    }
    case "money": {
      const amount = str(text, field.field).trim();
      const currency = str(text, field.currencyField).trim().toUpperCase();
      if (amount === "" && currency === "")
        return field.required
          ? { error: `${field.label} can't be empty.` }
          : { values: { [field.field]: null, [field.currencyField]: null } };
      if (amount === "")
        return {
          error: `${field.label} and its currency go together — give both or neither.`,
        };
      const micros = parseAmountToMicros(amount);
      if (micros === null || micros < 0)
        return { error: `${field.label} must be an amount, e.g. 900.` };
      if (!CURRENCY.test(currency))
        return {
          error: `${field.label} needs its currency as a three-letter code, e.g. EUR.`,
        };
      // The served bound is in micros, which is not a figure a reader knows;
      // say what it means instead of quoting it.
      return checkField(property, micros, field.label)
        ? { error: `${field.label} is more than can be recorded.` }
        : {
            values: { [field.field]: micros, [field.currencyField]: currency },
          };
    }
  }
}

/**
 * The row the text describes, or the problem with each field that cannot be
 * read — keyed by field name. `base` supplies anything the table does not
 * show.
 */
export function textToRow<Row extends object>(
  table: HasFields<Row>,
  text: RowText,
  rowSchema: JsonSchema | undefined,
  base: Row
): { row: Row } | { errors: Record<string, string> } {
  const values: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  const errors: Record<string, string> = {};
  for (const field of table.fields) {
    const read = readField(field, text, rowSchema);
    if ("error" in read) errors[field.field] = read.error;
    else Object.assign(values, read.values);
  }
  return Object.keys(errors).length > 0
    ? { errors }
    : { row: values as unknown as Row };
}

/** Every field problem of an existing row, as `textToRow` would find it. */
export function rowProblems<Row extends object>(
  table: TableDeclaration<Row>,
  row: Row,
  rowSchema: JsonSchema | undefined
): string[] {
  const result = textToRow(table, rowToText(table, row), rowSchema, row);
  return "errors" in result ? Object.values(result.errors) : [];
}

/** The identity of a row, as a key: two rows with one key are one too many. */
export function identityKey<Row extends object>(
  table: TableDeclaration<Row>,
  row: Row
): string {
  return table.identity.map((f) => String(get(row, f) ?? "")).join("\u0000");
}

/** How a field reads in the table. */
export function cellText<Row extends object>(
  field: FieldDeclaration<Row>,
  row: Row
): string {
  const value = get(row, field.field);
  switch (field.kind) {
    case "flag":
      return value === true ? field.yes : field.no;
    case "choice":
      return (
        field.options.find((o) => o.value === value)?.label ??
        (value === null || value === undefined || value === ""
          ? "—"
          : String(value))
      );
    case "money":
      return (
        formatMicros(
          value as number | null,
          get(row, field.currencyField) as string | null,
          { maximumFractionDigits: 2 }
        ) ?? field.emptyLabel
      );
    default:
      return value === null || value === undefined || value === ""
        ? "—"
        : String(value);
  }
}

/** A value to sort a column by: numbers as numbers, everything else as text. */
export function sortValue<Row extends object>(
  field: FieldDeclaration<Row>,
  row: Row
): number | string {
  const value = get(row, field.field);
  if (field.kind === "money") return typeof value === "number" ? value : -1;
  if (field.kind === "decimal") {
    const n = Number(value);
    return Number.isFinite(n) ? n : -1;
  }
  if (field.kind === "flag") return value === true ? 1 : 0;
  return String(value ?? "");
}
