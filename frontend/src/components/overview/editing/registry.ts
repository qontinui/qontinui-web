/**
 * The frontend half of the overview resource registry (plan
 * `2026-09-20-overview-authoring-layer` §2): for each record table a resource
 * holds, its fields with their editor kinds, the labels a reader sees, the
 * empty-state copy and its CSV column mapping.
 *
 * Declarations only. `RecordTable` renders any of them — inline add, edit and
 * remove, sorting, and the CSV paste dialog — and validates every row against
 * the JSON Schema the SERVER serves for the resource (`schemaDef` names the
 * row shape inside it), so the form and the API apply one set of rules. A new
 * table is an entry here, not a new component.
 */

import {
  parseAllocationsCsv,
  parseEffortsCsv,
  parseRolesCsv,
  type ParsedAllocationRow,
  type ParsedEffortRow,
  type ParsedRoleRow,
} from "@/app/(app)/overview/_lib/csv";
import type { CsvResult } from "./csv";

interface BaseField<Row> {
  field: keyof Row & string;
  /** What the reader calls it, in a column header and in a message. */
  label: string;
  /** An empty value is refused rather than stored as nothing. */
  required?: boolean;
}

/**
 * The editor kinds a table field can be:
 *
 * - `code` — a short identifier (trimmed); `text` — free text.
 * - `decimal` — an exact decimal STRING, never a float (the wire convention).
 * - `money` — integer micros in `field`, its ISO currency in `currencyField`;
 *   the two travel together.
 * - `flag` — a yes/no, with the words a reader uses for each.
 * - `date` — a calendar day, `YYYY-MM-DD` on the wire.
 * - `choice` — one of a fixed set of values, each with the reader's word.
 */
export type FieldDeclaration<Row> =
  | (BaseField<Row> & { kind: "code" | "text" })
  | (BaseField<Row> & { kind: "decimal" })
  | (BaseField<Row> & {
      kind: "money";
      currencyField: keyof Row & string;
      /** Shown when there is no amount, e.g. "not priced". */
      emptyLabel: string;
    })
  | (BaseField<Row> & { kind: "flag"; yes: string; no: string })
  | (BaseField<Row> & { kind: "date" })
  | (BaseField<Row> & {
      kind: "choice";
      options: readonly { value: string; label: string }[];
    });

export interface TableDeclaration<Row> {
  /** Registry name of the resource whose served write schema holds the row
   *  shape — its permission and its validation. */
  resource: string;
  /** The row shape's name in that schema's `$defs`. */
  schemaDef: string;
  singular: string;
  plural: string;
  /** Said when the table has no rows. */
  emptyText: string;
  /** The fields that identify a row: no two rows may share all of them. */
  identity: (keyof Row & string)[];
  fields: FieldDeclaration<Row>[];
  /** A row to start an added one from. */
  blank: () => Row;
  csv: {
    label: string;
    help: string;
    placeholder: string;
    parse: (text: string) => CsvResult<Row>;
  };
}

/**
 * A form that creates one record of a resource (`RecordForm`). Same field
 * kinds as a table; the create schema the server serves validates it.
 */
export interface RecordFormDeclaration<Row> {
  /** Registry name of the resource (its catalog entry and permission). */
  resource: string;
  singular: string;
  fields: FieldDeclaration<Row>[];
  /** A field that does not apply given the others (`renews_on` on a monthly
   *  cost) is hidden and sent as the initial value. */
  hidden?: (text: Record<string, string | boolean>, field: string) => boolean;
  /** A line of help under a field, in the reader's words. */
  help?: Partial<Record<keyof Row & string, string>>;
  /** Rules across fields (one date not before another), checked once every
   *  field reads on its own. Answers the problem per field; empty if none. */
  rules?: (row: Row) => Partial<Record<keyof Row & string, string>>;
}

// ---------------------------------------------------------------------------
// The estimate's tables
// ---------------------------------------------------------------------------

export const ESTIMATE_ROLES: TableDeclaration<ParsedRoleRow> = {
  resource: "estimates",
  schemaDef: "RoleWrite",
  singular: "role",
  plural: "roles",
  emptyText: "No roles yet.",
  identity: ["code"],
  fields: [
    { field: "code", label: "Code", kind: "code", required: true },
    { field: "name", label: "Role", kind: "text", required: true },
    { field: "responsibility", label: "What they do", kind: "text" },
    {
      field: "day_rate_micros",
      currencyField: "currency",
      label: "Day rate",
      kind: "money",
      emptyLabel: "not priced",
    },
    {
      field: "client_side",
      label: "Whose",
      kind: "flag",
      yes: "Client’s",
      no: "Ours",
    },
  ],
  blank: () => ({
    code: "",
    name: "",
    responsibility: "",
    day_rate_micros: null,
    currency: null,
    client_side: false,
  }),
  csv: {
    label: "Paste the role table",
    help: "One role per line: code, name, what they do, day rate, currency, and whether they are the client's own person. Only the code is required.",
    placeholder:
      "code,name,responsibility,day_rate,currency,client_side\nDL,Delivery lead,Runs the delivery,900,EUR,no",
    parse: parseRolesCsv,
  },
};

export const ESTIMATE_ALLOCATIONS: TableDeclaration<ParsedAllocationRow> = {
  resource: "estimates",
  schemaDef: "AllocationWrite",
  singular: "allocation",
  plural: "allocations",
  emptyText:
    "No allocations yet. A role with no row for a phase is not on that phase.",
  identity: ["phase_code", "role_code"],
  fields: [
    { field: "phase_code", label: "Phase", kind: "code", required: true },
    { field: "role_code", label: "Role", kind: "code", required: true },
    { field: "fte", label: "People (FTE)", kind: "decimal", required: true },
  ],
  blank: () => ({ phase_code: "", role_code: "", fte: "" }),
  csv: {
    label: "Paste the allocation matrix",
    help: "The first row names the phases; each row after it is a role. A blank cell means that role is not on that phase, which is not the same as none of them.",
    placeholder: "role,A0,A1,A2\nDL,0.5,0.5,1\nBE,,2,2",
    parse: parseAllocationsCsv,
  },
};

export const ESTIMATE_EFFORTS: TableDeclaration<ParsedEffortRow> = {
  resource: "estimates",
  schemaDef: "TaskEffortWrite",
  singular: "line",
  plural: "lines",
  emptyText: "No days of work yet.",
  identity: ["phase_code", "task_number", "role_code"],
  fields: [
    { field: "phase_code", label: "Phase", kind: "code", required: true },
    { field: "task_number", label: "Task", kind: "code", required: true },
    { field: "role_code", label: "Role", kind: "code", required: true },
    {
      field: "planned_person_days",
      label: "Days",
      kind: "decimal",
      required: true,
    },
  ],
  blank: () => ({
    phase_code: "",
    task_number: "",
    role_code: "",
    planned_person_days: "",
  }),
  csv: {
    label: "Paste the task effort split",
    help: "One line per role on a task: phase, task number, role, days. This is the only place days of work come from — the allocation matrix is a separate statement of team size and is never used to derive them.",
    placeholder: "phase,task,role,days\nA0,1.1,DL,4\nA0,1.1,BE,6.5",
    parse: parseEffortsCsv,
  },
};

// ---------------------------------------------------------------------------
// Spend: recurring costs (plan
// `2026-10-03-provider-reported-spend-collection-alerts-and-mobile`,
// decisions 10 and 12)
// ---------------------------------------------------------------------------

/** A recurring cost as written: the invoice amount, entered once. */
export interface RecurringCostWrite {
  vendor_id: string;
  description: string;
  unit_amount_micros: number | null;
  currency: string | null;
  quantity: string | null;
  cadence: "monthly" | "annual" | "";
  start_date: string;
  end_date: string | null;
  renews_on: string | null;
  source_note: string | null;
  external_ref: string | null;
}

export const RECURRING_COST_FORM: RecordFormDeclaration<RecurringCostWrite> = {
  resource: "recurring_costs",
  singular: "recurring cost",
  fields: [
    { field: "description", label: "What it is", kind: "text", required: true },
    {
      field: "unit_amount_micros",
      currencyField: "currency",
      label: "Amount per charge",
      kind: "money",
      emptyLabel: "no amount",
      required: true,
    },
    { field: "quantity", label: "Quantity", kind: "decimal" },
    {
      field: "cadence",
      label: "Charged",
      kind: "choice",
      required: true,
      options: [
        { value: "monthly", label: "Every month" },
        { value: "annual", label: "Every year" },
      ],
    },
    {
      field: "start_date",
      label: "First charged on",
      kind: "date",
      required: true,
    },
    { field: "renews_on", label: "Next renewal", kind: "date" },
    { field: "end_date", label: "Ends on", kind: "date" },
    {
      field: "source_note",
      label: "Where the amount comes from",
      kind: "text",
    },
    { field: "external_ref", label: "Reference (e.g. a domain)", kind: "text" },
  ],
  hidden: (text, field) => field === "renews_on" && text.cadence !== "annual",
  rules: (row) => {
    const problems: Partial<Record<keyof RecurringCostWrite, string>> = {};
    // ISO days compare correctly as strings.
    if (row.start_date && row.end_date && row.end_date < row.start_date)
      problems.end_date = "Ends on can't be before the first charge.";
    if (row.start_date && row.renews_on && row.renews_on < row.start_date)
      problems.renews_on = "Next renewal can't be before the first charge.";
    return problems;
  },
  help: {
    unit_amount_micros:
      "The amount on the provider's invoice — not a list price or an estimate.",
    quantity: "Seats or units on the invoice, if it charges per unit.",
    renews_on:
      "Defaults to the anniversary of the first charge when left empty.",
    source_note: "e.g. “3 seats, Business Starter, invoice 2026-09”.",
  },
};

/** A blank entry for `vendorId`, in `currency` — the summary's currency,
 *  which is the only one the server accepts for a recurring cost. */
export function blankRecurringCost(
  vendorId: string,
  currency: string
): RecurringCostWrite {
  return {
    vendor_id: vendorId,
    description: "",
    unit_amount_micros: null,
    currency,
    quantity: null,
    cadence: "",
    start_date: "",
    end_date: null,
    renews_on: null,
    source_note: null,
    external_ref: null,
  };
}
