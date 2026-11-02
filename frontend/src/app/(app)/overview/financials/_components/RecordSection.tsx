"use client";

/**
 * One of the Costs page's record tables, editable in place through the kit's
 * `RecordTable` — the same contract as the Timeline's milestones, shared by
 * the three tables here.
 *
 * Every row is its own record, so a change is written as soon as it is made:
 * one create, update or delete per row (`planWrites`), each naming the
 * version it was built on. A write somebody else has overtaken is a conflict
 * shown side by side, never an overwrite. Controls are absent for a reader
 * who may not edit.
 */

import { useMemo, useState } from "react";
import { ChangeLogPanel } from "@/components/overview/editing/ChangeLogPanel";
import { ConflictDialog } from "@/components/overview/editing/ConflictDialog";
import { RecordTable } from "@/components/overview/editing/RecordTable";
import {
  VersionConflictError,
  describeWriteFailure,
  type VersionedRecord,
  type WriteSource,
} from "@/components/overview/editing/api";
import { useResourceDescriptor } from "@/components/overview/editing/permissions";
import type { TableDeclaration } from "@/components/overview/editing/registry";
import type {
  SaveResult,
  UpdateOptions,
} from "@/components/overview/editing/useResource";
import { bodyOf, planWrites } from "../../_lib/costs";

interface Audited extends VersionedRecord {
  updated_at: string;
  updated_by: string | null;
}

type Pending<Rec, Row> =
  | { kind: "update"; mine: Row; theirs: Rec }
  | { kind: "delete"; theirs: Rec };

export interface RecordSectionProps<
  Rec extends Audited,
  Row extends { id: string },
> {
  /** Registry name, for the permission, schema and change log. */
  resource: string;
  table: TableDeclaration<Row>;
  records: Rec[];
  toRow: (record: Rec) => Row;
  /** The fields a write may carry. */
  writable: readonly string[];
  /** How a pasted row finds the one it updates; without it a paste adds. */
  matchKey?: (row: Row) => string;
  /** A rule the served schema cannot express, refused before sending. */
  rowProblem?: (row: Row) => string | null;
  /** A row (a create) or a patch (an update) as the API takes it, or the
   *  sentence saying why it cannot be sent. */
  toBody: (
    fields: Partial<Row>,
    mode: "create" | "update"
  ) => Record<string, unknown> | string;
  /** Names the row in a message. */
  label: (row: Row) => string;
  /** The record as text, for the conflict dialog. */
  describe: (row: Row) => string;
  canEdit: boolean;
  create: (
    body: Record<string, unknown>,
    options?: { source?: WriteSource }
  ) => Promise<SaveResult<Rec>>;
  update: (
    current: Rec,
    patch: Record<string, unknown>,
    options?: UpdateOptions<Rec>
  ) => Promise<SaveResult<Rec>>;
  remove: (id: string, version: number) => Promise<void>;
  drop: (id: string) => void;
  replace: (item: Rec) => void;
  /** Called after any write landed, so derived figures can be re-read. */
  onWritten: () => void;
  uiBridgeId: string;
}

export function RecordSection<Rec extends Audited, Row extends { id: string }>({
  resource,
  table,
  records,
  toRow,
  writable,
  matchKey,
  rowProblem,
  toBody,
  label,
  describe,
  canEdit,
  create,
  update,
  remove,
  drop,
  replace,
  onWritten,
  uiBridgeId,
}: RecordSectionProps<Rec, Row>) {
  const descriptor = useResourceDescriptor(resource);
  const rows = useMemo(() => records.map(toRow), [records, toRow]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Every overtaken write of one save, shown one at a time so none is lost.
  const [conflicts, setConflicts] = useState<Pending<Rec, Row>[]>([]);
  const pending = conflicts[0] ?? null;
  const addConflict = (c: Pending<Rec, Row>) =>
    setConflicts((all) => [...all, c]);
  const settle = () => setConflicts((all) => all.slice(1));

  const recordOf = (id: string) => records.find((r) => r.id === id);

  const removeRecord = async (record: Rec): Promise<string | null> => {
    try {
      await remove(record.id, record.version);
      drop(record.id);
      return null;
    } catch (err) {
      if (err instanceof VersionConflictError) {
        const theirs = err.current as Rec;
        replace(theirs);
        addConflict({ kind: "delete", theirs });
        return null;
      }
      return `${label(toRow(record))}: ${describeWriteFailure(err)}`;
    }
  };

  const apply = async (next: Row[], how: "edit" | "import") => {
    const source: WriteSource = how === "import" ? "import" : "ui";
    const plan = planWrites(rows, next, how, writable, matchKey);
    if (rowProblem) {
      const problems: string[] = [];
      for (const row of [
        ...plan.creates,
        ...plan.updates.map((u) => ({ ...u.row, ...u.patch })),
      ]) {
        const problem = rowProblem(row);
        if (problem) problems.push(`${label(row)}: ${problem}`);
      }
      if (problems.length > 0) {
        setErrors(problems);
        return;
      }
    }
    setBusy(true);
    const failures: string[] = [];
    let wrote = false;
    for (const row of plan.creates) {
      const body = toBody(bodyOf(row, writable) as Partial<Row>, "create");
      if (typeof body === "string") {
        failures.push(`${label(row)}: ${body}`);
        continue;
      }
      const result = await create(body, { source });
      if (result.ok) wrote = true;
      else if ("error" in result)
        failures.push(`${label(row)}: ${result.error}`);
    }
    for (const { row, patch } of plan.updates) {
      const record = recordOf(row.id);
      if (!record) continue;
      const body = toBody(patch, "update");
      if (typeof body === "string") {
        failures.push(`${label(row)}: ${body}`);
        continue;
      }
      const result = await update(record, body, { source });
      if (result.ok) wrote = true;
      else if ("conflict" in result)
        addConflict({
          kind: "update",
          mine: { ...row, ...patch },
          theirs: result.conflict,
        });
      else failures.push(`${label(row)}: ${result.error}`);
    }
    for (const row of plan.deletes) {
      const record = recordOf(row.id);
      if (!record) continue;
      const failure = await removeRecord(record);
      if (failure) failures.push(failure);
      else wrote = true;
    }
    setBusy(false);
    setErrors(failures);
    if (wrote) onWritten();
  };

  const latest = records.reduce<Rec | null>(
    (newest, r) => (!newest || r.updated_at > newest.updated_at ? r : newest),
    null
  );

  return (
    <div className="space-y-3" data-ui-bridge-id={uiBridgeId}>
      <RecordTable
        table={table}
        rows={rows}
        canEdit={canEdit}
        busy={busy}
        rowSchema={descriptor?.schemas.create}
        onChange={(next, how) => void apply(next, how)}
        uiBridgeId={`${uiBridgeId}.table`}
      />
      {errors.length > 0 && (
        <ul
          role="alert"
          className="space-y-1 text-sm text-destructive"
          data-ui-bridge-id={`${uiBridgeId}.errors`}
        >
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {latest && (
        <ChangeLogPanel
          resource={resource}
          recordId={null}
          updatedBy={latest.updated_by}
          updatedAt={latest.updated_at}
          uiBridgeId={`${uiBridgeId}.history`}
        />
      )}
      {pending && (
        <ConflictDialog
          open
          mine={
            pending.kind === "update" ? describe(pending.mine) : "(removed)"
          }
          theirs={describe(toRow(pending.theirs))}
          theirsBy={pending.theirs.updated_by}
          theirsAt={pending.theirs.updated_at}
          onKeepMine={() => {
            const chosen = pending;
            settle();
            void (async () => {
              if (chosen.kind === "update") {
                // The whole row as I left it, onto their version.
                const body = toBody(
                  bodyOf(chosen.mine, writable) as Partial<Row>,
                  "update"
                );
                if (typeof body === "string") {
                  setErrors([body]);
                  return;
                }
                const result = await update(chosen.theirs, body);
                if (!result.ok && "conflict" in result)
                  addConflict({ ...chosen, theirs: result.conflict });
                else if (!result.ok) setErrors([result.error]);
                else onWritten();
              } else {
                const failure = await removeRecord(chosen.theirs);
                if (failure) setErrors([failure]);
                else onWritten();
              }
            })();
          }}
          onTakeTheirs={settle}
          // Their version is already in the table; combining is editing it.
          onMerge={settle}
          uiBridgeId={`${uiBridgeId}.conflict`}
        />
      )}
    </div>
  );
}
