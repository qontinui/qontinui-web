/**
 * The Costs page's three record tables — categories, recurring costs and
 * cost entries: their declarations for the kit's `RecordTable`, their CSV
 * column mappings, and how a table edit becomes writes.
 *
 * Every row is a record of its own on the authoring contract (its own
 * version, `If-Match` and change-log row), so a table is never saved whole:
 * each change the reader makes (`planWrites`) is one create, update or
 * delete.
 *
 * Pure: no React, no network.
 */

import {
  nonEmptyLines,
  splitCsvLine,
  type CsvIssue,
  type CsvResult,
} from "@/components/overview/editing/csv";
import { isIsoDay } from "@/components/overview/editing/fields";
import type { TableDeclaration } from "@/components/overview/editing/registry";
import { parseAmountToMicros } from "@/components/overview/money";
import type {
  AmountKind,
  Cadence,
  CostCategory,
  CostEntry,
  PeriodState,
  RecurringCost,
} from "./costs-api";

export const CADENCE_LABEL: Record<Cadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Yearly",
};

export const AMOUNT_KIND_LABEL: Record<AmountKind, string> = {
  fixed: "Same each time",
  variable: "Varies",
};

export const PERIOD_STATE_LABEL: Record<PeriodState, string> = {
  recorded: "Recorded",
  scheduled: "Scheduled",
  awaiting_amount: "Amount needed",
};

/**
 * Offered on a project with no categories yet, in one click. Plain headings
 * a business reader recognises; every one can be renamed or removed.
 */
export const STARTER_CATEGORIES: { name: string; description: string }[] = [
  {
    name: "Hardware",
    description: "Servers, parts and equipment — bought once and delivered",
  },
  {
    name: "AI tools",
    description: "Claude Code and other AI subscriptions and usage",
  },
  {
    name: "Cloud hosting",
    description: "AWS and other hosting, storage and networking",
  },
  {
    name: "Source control & CI",
    description: "GitHub plans, Actions minutes and other build services",
  },
  {
    name: "Software & services",
    description: "Other subscriptions, domains and SaaS",
  },
  {
    name: "Legal & registration",
    description:
      "Incorporation, company filings, trademark and name registration, legal advice",
  },
  { name: "Other", description: "Anything that fits no other heading" },
];

function options<V extends string>(labels: Record<V, string>) {
  return (Object.entries(labels) as [V, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}

function normalise(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

function pick<V extends string>(
  choices: { value: V; label: string }[],
  text: string
): V | null {
  const wanted = normalise(text);
  return (
    choices.find(
      (o) => normalise(o.value) === wanted || normalise(o.label) === wanted
    )?.value ?? null
  );
}

const YES = new Set(["yes", "y", "true", "1", "x"]);
const NO = new Set(["no", "n", "false", "0", ""]);

export interface CategoryChoice {
  id: string;
  name: string;
}

function categoryOptions(categories: CategoryChoice[]) {
  return categories.map((c) => ({ value: c.id, label: c.name }));
}

function findCategory(
  categories: CategoryChoice[],
  name: string
): CategoryChoice | null {
  const wanted = normalise(name);
  return categories.find((c) => normalise(c.name) === wanted) ?? null;
}

function unknownCategory(name: string, categories: CategoryChoice[]): string {
  return `There is no category “${name}”. Use one of: ${
    categories.map((c) => c.name).join(", ") || "add categories first"
  }.`;
}

// ---------------------------------------------------------------------------
// Planning writes
// ---------------------------------------------------------------------------

interface Planned {
  id: string;
  /** Set on a row read from a paste: the columns it actually gave, so an
   *  update writes only those and an empty cell never clears a value. */
  supplied?: string[];
}

export interface Writes<Row> {
  creates: Row[];
  /** `row` is the record as it stood; `patch` only what changed. */
  updates: { row: Row; patch: Partial<Row> }[];
  deletes: Row[];
}

function changed<Row>(
  before: Row,
  after: Row,
  fields: readonly string[]
): Partial<Row> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const a = (before as Record<string, unknown>)[field];
    const b = (after as Record<string, unknown>)[field];
    if (a !== b) patch[field] = b;
  }
  return patch as Partial<Row>;
}

/**
 * The writes that turn `previous` (what the server holds) into `next`.
 *
 * - An **edit** is the table as the reader left it: a row with no id is
 *   created, a row whose fields moved is updated with only those fields, a
 *   row that is gone is deleted.
 * - An **import** (a CSV paste) never deletes. With `matchKey`, a pasted row
 *   matching exactly ONE existing row updates it (only the columns it gave);
 *   every other row is created. Without one, every pasted row is new.
 */
export function planWrites<Row extends Planned>(
  previous: Row[],
  next: Row[],
  how: "edit" | "import",
  writable: readonly string[],
  matchKey?: (row: Row) => string
): Writes<Row> {
  const plan: Writes<Row> = { creates: [], updates: [], deletes: [] };
  if (how === "import") {
    for (const row of next) {
      const same = matchKey
        ? previous.filter((p) => matchKey(p) === matchKey(row))
        : [];
      if (same.length === 1) {
        const patch = changed(same[0]!, row, row.supplied ?? writable);
        if (Object.keys(patch).length > 0)
          plan.updates.push({ row: same[0]!, patch });
      } else {
        plan.creates.push(row);
      }
    }
    return plan;
  }
  const byId = new Map(previous.map((p) => [p.id, p]));
  const kept = new Set<string>();
  for (const row of next) {
    const was = row.id ? byId.get(row.id) : undefined;
    if (!was) {
      plan.creates.push(row);
      continue;
    }
    kept.add(row.id);
    const patch = changed(was, row, writable);
    if (Object.keys(patch).length > 0) plan.updates.push({ row: was, patch });
  }
  plan.deletes = previous.filter((p) => !kept.has(p.id));
  return plan;
}

/** The fields of `row` a create sends. */
export function bodyOf<Row>(
  row: Row,
  writable: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(
    writable.map((f) => [f, (row as Record<string, unknown>)[f]])
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryRow extends Planned {
  version: number;
  name: string;
  description: string;
}

export const CATEGORY_WRITABLE = ["name", "description"] as const;

export function categoryToRow(c: CostCategory): CategoryRow {
  return {
    id: c.id,
    version: c.version,
    name: c.name,
    description: c.description,
  };
}

export const categoryKey = (row: { name: string }) => normalise(row.name);

export function parseCategoriesCsv(text: string): CsvResult<CategoryRow> {
  const issues: CsvIssue[] = [];
  const rows: CategoryRow[] = [];
  const rowLines: number[] = [];
  const lines = nonEmptyLines(text);
  const first = normalise(splitCsvLine(lines[0]?.text ?? "")[0] ?? "");
  for (const entry of lines.slice(
    first === "name" || first === "category" ? 1 : 0
  )) {
    const [name = "", description = ""] = splitCsvLine(entry.text);
    if (!name.trim()) {
      issues.push({
        line: entry.line,
        text: entry.text,
        message: "The first column, the category's name, is empty.",
        severity: "error",
      });
      continue;
    }
    rows.push({
      id: "",
      version: 0,
      name: name.trim(),
      description,
      // The name is how the row is matched, so a paste never rewrites it.
      supplied: description ? ["description"] : [],
    });
    rowLines.push(entry.line);
  }
  return { rows, issues, lines: rowLines };
}

export const CATEGORY_TABLE: TableDeclaration<CategoryRow> = {
  resource: "cost_categories",
  schemaDef: "CostCategoryCreate",
  singular: "category",
  plural: "categories",
  emptyText: "No categories yet.",
  identity: ["name"],
  fields: [
    { field: "name", label: "Category", kind: "text", required: true },
    { field: "description", label: "What goes in it", kind: "text" },
  ],
  blank: () => ({ id: "", version: 0, name: "", description: "" }),
  csv: {
    label: "Paste categories",
    help: "One category per line: name, then what goes in it. A line whose name matches an existing category updates its description; every other line adds one.",
    placeholder:
      "name,description\nHardware,Servers and parts\nLegal & registration,Incorporation and trademarks",
    parse: parseCategoriesCsv,
  },
};

// ---------------------------------------------------------------------------
// Recurring costs
// ---------------------------------------------------------------------------

export interface RecurringRow extends Planned {
  version: number;
  name: string;
  vendor: string;
  category_id: string | null;
  cadence: Cadence;
  amount_kind: AmountKind;
  amount_micros: number | null;
  /** `null` only while a variable cost has no typical amount; a write then
   *  sends the project's base currency (`recurringBody`). */
  currency: string | null;
  start_date: string;
  end_date: string | null;
  notes: string;
}

export const RECURRING_WRITABLE = [
  "name",
  "vendor",
  "category_id",
  "cadence",
  "amount_kind",
  "amount_micros",
  "currency",
  "start_date",
  "end_date",
  "notes",
] as const;

export function recurringToRow(r: RecurringCost): RecurringRow {
  return {
    id: r.id,
    version: r.version,
    name: r.name,
    vendor: r.vendor,
    category_id: r.category_id,
    cadence: r.cadence,
    amount_kind: r.amount_kind,
    amount_micros: r.amount_micros,
    currency: r.currency,
    start_date: r.start_date,
    end_date: r.end_date,
    notes: r.notes,
  };
}

export const recurringKey = (row: { name: string }) => normalise(row.name);

/** The server's cross-field rule, refused before sending. */
export function recurringRowProblem(row: {
  amount_kind: AmountKind;
  amount_micros: number | null;
}): string | null {
  return row.amount_kind === "fixed" && row.amount_micros === null
    ? "A cost that is the same each time needs its amount."
    : null;
}

/** A create body (or a patch) as the API takes it: a currency is always
 *  sent, the project's own when the row names none. */
export function recurringBody(
  fields: Partial<RecurringRow>,
  baseCurrency: string
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...fields };
  delete body.id;
  delete body.version;
  delete body.supplied;
  if ("currency" in body && body.currency === null)
    body.currency = baseCurrency;
  return body;
}

export function parseRecurringCsv(
  text: string,
  categories: CategoryChoice[]
): CsvResult<RecurringRow> {
  const issues: CsvIssue[] = [];
  const rows: RecurringRow[] = [];
  const rowLines: number[] = [];
  const lines = nonEmptyLines(text);
  const first = normalise(splitCsvLine(lines[0]?.text ?? "")[0] ?? "");
  const cadences = options(CADENCE_LABEL);
  const kinds = options(AMOUNT_KIND_LABEL);
  for (const entry of lines.slice(first === "name" ? 1 : 0)) {
    const [
      name = "",
      vendor = "",
      category = "",
      cadence = "",
      kind = "",
      amount = "",
      currency = "",
      start = "",
      end = "",
      notes = "",
    ] = splitCsvLine(entry.text);
    const fail = (message: string) =>
      issues.push({
        line: entry.line,
        text: entry.text,
        message,
        severity: "error",
      });
    if (!name.trim()) {
      fail("The first column, the cost's name, is empty.");
      continue;
    }
    const cadenceValue = cadence ? pick(cadences, cadence) : "monthly";
    if (!cadenceValue) {
      fail(`“${cadence}” is not how often. Use monthly, quarterly or yearly.`);
      continue;
    }
    const micros = amount ? parseAmountToMicros(amount) : null;
    if (amount && (micros === null || micros < 0)) {
      fail(`“${amount}” is not an amount. Write it as 200 or 1,200.50.`);
      continue;
    }
    const kindValue = kind
      ? pick(kinds, kind)
      : micros === null
        ? "variable"
        : "fixed";
    if (!kindValue) {
      fail(`“${kind}” is not one of: ${kinds.map((k) => k.label).join(", ")}.`);
      continue;
    }
    if (kindValue === "fixed" && micros === null) {
      fail("A cost that is the same each time needs its amount.");
      continue;
    }
    if (currency && !/^[A-Za-z]{3}$/.test(currency.trim())) {
      fail(`“${currency}” is not a currency. Use a code such as USD or EUR.`);
      continue;
    }
    if (!isIsoDay(start)) {
      fail(`“${start}” is not a start date. Write it as 2026-01-15.`);
      continue;
    }
    if (end && !isIsoDay(end)) {
      fail(`“${end}” is not an end date. Write it as 2026-12-31.`);
      continue;
    }
    let categoryId: string | null = null;
    if (category) {
      const found = findCategory(categories, category);
      if (!found) {
        fail(unknownCategory(category, categories));
        continue;
      }
      categoryId = found.id;
    }
    rows.push({
      id: "",
      version: 0,
      name: name.trim(),
      vendor: vendor.trim(),
      category_id: categoryId,
      cadence: cadenceValue,
      amount_kind: kindValue,
      amount_micros: micros,
      currency: currency ? currency.trim().toUpperCase() : null,
      start_date: start,
      end_date: end || null,
      notes,
      // The name is how the row is matched, so a paste never rewrites it.
      supplied: [
        "start_date",
        "cadence",
        "amount_kind",
        ...(vendor ? ["vendor"] : []),
        ...(category ? ["category_id"] : []),
        ...(amount ? ["amount_micros"] : []),
        ...(currency ? ["currency"] : []),
        ...(end ? ["end_date"] : []),
        ...(notes ? ["notes"] : []),
      ],
    });
    rowLines.push(entry.line);
  }
  return { rows, issues, lines: rowLines };
}

export function recurringTable(
  categories: CategoryChoice[]
): TableDeclaration<RecurringRow> {
  return {
    resource: "recurring_costs",
    schemaDef: "RecurringCostCreate",
    singular: "recurring cost",
    plural: "recurring costs",
    emptyText: "No recurring costs yet.",
    identity: ["name", "start_date"],
    fields: [
      { field: "name", label: "Cost", kind: "text", required: true },
      { field: "vendor", label: "Paid to", kind: "text" },
      {
        field: "category_id",
        label: "Category",
        kind: "select",
        options: categoryOptions(categories),
        emptyLabel: "No category",
      },
      {
        field: "cadence",
        label: "How often",
        kind: "select",
        required: true,
        options: options(CADENCE_LABEL),
      },
      {
        field: "amount_kind",
        label: "Amount",
        kind: "select",
        required: true,
        options: options(AMOUNT_KIND_LABEL),
      },
      {
        field: "amount_micros",
        currencyField: "currency",
        label: "Each time",
        kind: "money",
        emptyLabel: "varies",
      },
      { field: "start_date", label: "First due", kind: "date", required: true },
      { field: "end_date", label: "Last due", kind: "date" },
      { field: "notes", label: "Notes", kind: "text" },
    ],
    blank: () => ({
      id: "",
      version: 0,
      name: "",
      vendor: "",
      category_id: null,
      cadence: "monthly",
      amount_kind: "fixed",
      amount_micros: null,
      currency: null,
      start_date: "",
      end_date: null,
      notes: "",
    }),
    csv: {
      label: "Paste recurring costs",
      help: "One per line: name, paid to, category, how often (monthly, quarterly, yearly), amount kind (same each time / varies), amount, currency, first due date, last due date, notes. Only the name and the first due date are required; with no amount the cost varies. A line whose name matches an existing cost updates the columns it fills in.",
      placeholder:
        "name,paid to,category,how often,kind,amount,currency,first due,last due,notes\nClaude Code Max,Anthropic,AI tools,monthly,same each time,200,USD,2026-01-15,,\nAWS,Amazon,Cloud hosting,monthly,varies,,USD,2026-01-01,,",
      parse: (text) => parseRecurringCsv(text, categories),
    },
  };
}

// ---------------------------------------------------------------------------
// Cost entries
// ---------------------------------------------------------------------------

export interface EntryRow extends Planned {
  version: number;
  incurred_on: string;
  description: string;
  vendor: string;
  category_id: string | null;
  amount_micros: number | null;
  currency: string | null;
  expects_delivery: boolean;
  received_on: string | null;
  order_ref: string;
  notes: string;
  /** Not edited in the table: which recurring period the entry records. */
  recurring_cost_id: string | null;
  period_start: string | null;
}

export const ENTRY_WRITABLE = [
  "incurred_on",
  "description",
  "vendor",
  "category_id",
  "amount_micros",
  "currency",
  "expects_delivery",
  "received_on",
  "order_ref",
  "notes",
] as const;

export function entryToRow(e: CostEntry): EntryRow {
  return {
    id: e.id,
    version: e.version,
    incurred_on: e.incurred_on,
    description: e.description,
    vendor: e.vendor,
    category_id: e.category_id,
    amount_micros: e.amount_micros,
    currency: e.currency,
    expects_delivery: e.expects_delivery,
    received_on: e.received_on,
    order_ref: e.order_ref,
    notes: e.notes,
    recurring_cost_id: e.recurring_cost_id,
    period_start: e.period_start,
  };
}

/** The server's cross-field rule, refused before sending. */
export function entryRowProblem(row: {
  expects_delivery: boolean;
  received_on: string | null;
}): string | null {
  return row.received_on && !row.expects_delivery
    ? "Only a delivered item has a “received” date — mark it as delivered or clear the date."
    : null;
}

export function parseEntriesCsv(
  text: string,
  categories: CategoryChoice[]
): CsvResult<EntryRow> {
  const issues: CsvIssue[] = [];
  const rows: EntryRow[] = [];
  const rowLines: number[] = [];
  const lines = nonEmptyLines(text);
  const first = normalise(splitCsvLine(lines[0]?.text ?? "")[0] ?? "");
  for (const entry of lines.slice(first === "date" ? 1 : 0)) {
    const [
      day = "",
      description = "",
      vendor = "",
      category = "",
      amount = "",
      currency = "",
      delivered = "",
      received = "",
      orderRef = "",
      notes = "",
    ] = splitCsvLine(entry.text);
    const fail = (message: string) =>
      issues.push({
        line: entry.line,
        text: entry.text,
        message,
        severity: "error",
      });
    if (!isIsoDay(day.trim())) {
      fail(`“${day}” is not a date. Write it as 2026-10-20.`);
      continue;
    }
    if (!description.trim()) {
      fail("The second column, what was bought, is empty.");
      continue;
    }
    const micros = parseAmountToMicros(amount);
    if (micros === null) {
      fail(`“${amount}” is not an amount. Write it as 649 or 1,200.50.`);
      continue;
    }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
      fail(`“${currency}” is not a currency. Use a code such as USD or EUR.`);
      continue;
    }
    const flag = delivered.trim().toLowerCase();
    if (!YES.has(flag) && !NO.has(flag)) {
      fail(`“${delivered}” should be yes (an item to be delivered) or no.`);
      continue;
    }
    if (received && !isIsoDay(received.trim())) {
      fail(`“${received}” is not a date. Write it as 2026-10-25.`);
      continue;
    }
    const expects = YES.has(flag) || Boolean(received.trim());
    let categoryId: string | null = null;
    if (category) {
      const found = findCategory(categories, category);
      if (!found) {
        fail(unknownCategory(category, categories));
        continue;
      }
      categoryId = found.id;
    }
    rows.push({
      id: "",
      version: 0,
      incurred_on: day.trim(),
      description: description.trim(),
      vendor: vendor.trim(),
      category_id: categoryId,
      amount_micros: micros,
      currency: currency.trim().toUpperCase(),
      expects_delivery: expects,
      received_on: received.trim() || null,
      order_ref: orderRef.trim(),
      notes,
      recurring_cost_id: null,
      period_start: null,
    });
    rowLines.push(entry.line);
  }
  return { rows, issues, lines: rowLines };
}

export function entryTable(
  categories: CategoryChoice[]
): TableDeclaration<EntryRow> {
  return {
    resource: "cost_entries",
    schemaDef: "CostEntryCreate",
    singular: "cost",
    plural: "costs",
    emptyText: "No costs recorded yet.",
    identity: ["incurred_on", "description", "vendor", "amount_micros"],
    fields: [
      { field: "incurred_on", label: "Date", kind: "date", required: true },
      { field: "description", label: "What", kind: "text", required: true },
      { field: "vendor", label: "Paid to", kind: "text" },
      {
        field: "category_id",
        label: "Category",
        kind: "select",
        options: categoryOptions(categories),
        emptyLabel: "No category",
      },
      {
        field: "amount_micros",
        currencyField: "currency",
        label: "Amount",
        kind: "money",
        required: true,
        signed: true,
        emptyLabel: "—",
      },
      {
        field: "expects_delivery",
        label: "Delivered item",
        kind: "flag",
        yes: "To be delivered",
        no: "No delivery",
      },
      { field: "received_on", label: "Received", kind: "date" },
      { field: "order_ref", label: "Order / invoice", kind: "text" },
      { field: "notes", label: "Notes", kind: "text" },
    ],
    blank: () => ({
      id: "",
      version: 0,
      incurred_on: "",
      description: "",
      vendor: "",
      category_id: null,
      amount_micros: null,
      currency: null,
      expects_delivery: false,
      received_on: null,
      order_ref: "",
      notes: "",
      recurring_cost_id: null,
      period_start: null,
    }),
    csv: {
      label: "Paste costs",
      help: "One cost per line: date, what, paid to, category, amount, currency, delivered item (yes/no), received date, order or invoice number, notes. Date, what, amount and currency are required; a negative amount is a refund. A paste only adds costs — it never changes or removes one.",
      placeholder:
        "date,what,paid to,category,amount,currency,delivered,received,order,notes\n2026-10-20,AMD Ryzen 9 9950X,Mindfactory,Hardware,649,EUR,yes,,MF-123456,CI server 1\n2026-10-02,Trademark filing (EUIPO),EUIPO,Legal & registration,850,EUR,no,,,",
      parse: (text) => parseEntriesCsv(text, categories),
    },
  };
}
