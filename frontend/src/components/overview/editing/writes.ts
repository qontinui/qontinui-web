/**
 * How a per-record table's change becomes writes — the one planner every
 * overview table whose rows are records of their own shares (the Costs
 * page's three tables, the Timeline's milestones).
 *
 * Every such row has its own version, `If-Match` and change-log row, so a
 * table is never saved whole: each change the reader makes
 * (`planRecordWrites`) is one create, update or delete. What a CSV paste
 * does to each pasted row is decided once, by `classifyImport`, so anything
 * that reports on a paste reads the same classification its writes come
 * from.
 *
 * Pure: no React, no network.
 */

import { earlierLineClash, identityClash, identityKey } from "./fields";
import type { TableDeclaration } from "./registry";

/** What every planned row carries. */
export interface Planned {
  id: string;
  /** Set on a row read from a paste: the columns it actually gave, so an
   *  update writes only those and an empty cell never clears a value. */
  supplied?: readonly string[];
}

export interface Writes<Row> {
  creates: Row[];
  /** `row` is the record as it stood; `patch` only what changed. */
  updates: { row: Row; patch: Partial<Row> }[];
  deletes: Row[];
}

/**
 * What a paste does to one pasted row.
 *
 * - `add` — it matches no existing record (or more than one), so it is
 *   created.
 * - `update` — it matches exactly one record (`match`) and changes the
 *   columns in `patch`.
 * - `unchanged` — it matches exactly one record that already holds what the
 *   row gives; nothing is written.
 * - `refused` — the commit would refuse it (`reason` says why), so it is
 *   left out: it breaks the table's own row rule, or it would add a second
 *   record with an identity already taken.
 *
 * New fates are added here as new `kind`s, so every consumer's exhaustive
 * switch names them.
 */
export type ImportFate<Row> =
  | { kind: "add"; row: Row }
  | { kind: "update"; row: Row; match: Row; patch: Partial<Row> }
  | { kind: "unchanged"; row: Row; match: Row }
  | { kind: "refused"; row: Row; reason: string };

/**
 * The table's own rules, which a paste is held to before anything is
 * written — the same ones a typed change meets.
 *
 * - `rowProblem` — a rule the served schema cannot express. A would-be
 *   create is checked as pasted; an update as the record it would leave
 *   (`{ ...match, ...patch }`), so a stored value can complete it.
 * - `table` — its `identity`: a would-be create may not repeat the identity
 *   of an existing row, nor of an earlier line of the same paste that adds.
 */
export interface ImportRules<Row extends object> {
  rowProblem?: (row: Row) => string | null;
  table?: Pick<TableDeclaration<Row>, "identity" | "fields" | "singular">;
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
 * One fate per row of `pasted`, in order, against `previous` (what the
 * server holds).
 *
 * With `matchKey`, a pasted row whose key matches exactly ONE existing row
 * updates it — comparing only the columns it gave (`supplied`), or every
 * `writable` column when it says nothing — or leaves it unchanged. A key
 * matching no row, or several, is an add: an ambiguous key is a new record,
 * not a guess at which one was meant. Without `matchKey`, every row is an
 * add.
 *
 * With `rules`, a row the commit would refuse is `refused` instead
 * (`ImportRules`). Identities are kept in a key set — every existing row's,
 * plus each add's as it is classified — so a clash is one lookup.
 */
export function classifyImport<Row extends Planned>(
  previous: readonly Row[],
  pasted: readonly Row[],
  writable: readonly string[],
  matchKey?: (row: Row) => string,
  rules: ImportRules<Row> = {}
): ImportFate<Row>[] {
  const { rowProblem, table } = rules;
  const taken = new Set<string>(
    table ? previous.map((p) => identityKey(table, p)) : []
  );
  const added = new Set<string>();
  const byKey = new Map<string, Row[]>();
  if (matchKey) {
    for (const p of previous) {
      const key = matchKey(p);
      const same = byKey.get(key);
      if (same) same.push(p);
      else byKey.set(key, [p]);
    }
  }
  return pasted.map((row): ImportFate<Row> => {
    const same = matchKey ? byKey.get(matchKey(row)) : undefined;
    if (!same || same.length !== 1) {
      const problem = rowProblem?.(row);
      if (problem) return { kind: "refused", row, reason: problem };
      if (table) {
        const key = identityKey(table, row);
        if (taken.has(key))
          return {
            kind: "refused",
            row,
            reason: identityClash(table).message,
          };
        if (added.has(key))
          return { kind: "refused", row, reason: earlierLineClash(table) };
        added.add(key);
      }
      return { kind: "add", row };
    }
    const match = same[0]!;
    const patch = changed(match, row, row.supplied ?? writable);
    if (Object.keys(patch).length === 0)
      return { kind: "unchanged", row, match };
    const problem = rowProblem?.({ ...match, ...patch });
    if (problem) return { kind: "refused", row, reason: problem };
    return { kind: "update", row, match, patch };
  });
}

/**
 * The writes that turn `previous` (what the server holds) into `next`.
 *
 * - An **edit** is the table as the reader left it: a row with no id is
 *   created, a row whose fields moved is updated with only those fields, a
 *   row that is gone is deleted.
 * - An **import** (a CSV paste) never deletes: each pasted row's writes are
 *   its `classifyImport` fate — an add is a create, an update is an update,
 *   an unchanged row is no write at all. With `rules`, a refused row is no
 *   write either; a caller that must refuse the whole batch instead checks
 *   the fates first.
 */
export function planRecordWrites<Row extends Planned>(
  previous: Row[],
  next: Row[],
  how: "edit" | "import",
  writable: readonly string[],
  matchKey?: (row: Row) => string,
  rules?: ImportRules<Row>
): Writes<Row> {
  const plan: Writes<Row> = { creates: [], updates: [], deletes: [] };
  if (how === "import") {
    for (const fate of classifyImport(
      previous,
      next,
      writable,
      matchKey,
      rules
    )) {
      switch (fate.kind) {
        case "add":
          plan.creates.push(fate.row);
          break;
        case "update":
          plan.updates.push({ row: fate.match, patch: fate.patch });
          break;
        case "unchanged":
        case "refused":
          break;
        default: {
          const unhandled: never = fate;
          throw new Error(`Unhandled import fate: ${String(unhandled)}`);
        }
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
