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
 * - `date` — a calendar day, `YYYY-MM-DD` on the wire (no time, no zone).
 * - `select` — one of a fixed set of `options`, shown by its label. A
 *   phase reference is a select whose options the page builds from the
 *   phases it has loaded; an empty choice stores `null`.
 */
export type FieldDeclaration<Row> =
  | (BaseField<Row> & { kind: "code" | "text" })
  | (BaseField<Row> & { kind: "decimal" })
  | (BaseField<Row> & { kind: "date" })
  | (BaseField<Row> & {
      kind: "select";
      options: { value: string; label: string }[];
      /** The label of the empty choice (stored as `null`); offered only
       *  when the field is not required. */
      emptyLabel?: string;
    })
  | (BaseField<Row> & {
      kind: "money";
      currencyField: keyof Row & string;
      /** Shown when there is no amount, e.g. "not priced". */
      emptyLabel: string;
    })
  | (BaseField<Row> & { kind: "flag"; yes: string; no: string });

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
