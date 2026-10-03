"use client";

/**
 * The milestones, editable in place through the kit's `RecordTable`.
 *
 * Every milestone is its own record on the authoring contract, so a change
 * is written as soon as it is made — one create, update or delete per row
 * (`planMilestoneWrites`), each naming the version it was built on. A CSV
 * paste adds and updates (matched by title) and never removes. A write
 * somebody else has overtaken is a conflict shown side by side, never an
 * overwrite. Controls are absent for a reader who may not edit.
 */

import { useCallback, useMemo, useState } from "react";
import { ChangeLogPanel } from "@/components/overview/editing/ChangeLogPanel";
import { ConflictDialog } from "@/components/overview/editing/ConflictDialog";
import { RecordTable } from "@/components/overview/editing/RecordTable";
import {
  VersionConflictError,
  deleteMilestone,
  describeWriteFailure,
} from "@/components/overview/editing/api";
import { useResourceDescriptor } from "@/components/overview/editing/permissions";
import type {
  SaveResult,
  UpdateOptions,
} from "@/components/overview/editing/useResource";
import type { WriteSource } from "@/components/overview/editing/api";
import {
  createBody,
  milestoneRowProblem,
  milestoneTable,
  milestoneToRow,
  otherPhases,
  planMilestoneWrites,
  rebaseMilestone,
  MILESTONE_FIELD_LABEL,
  type MilestoneRow,
  type PhaseChoice,
  type Writable,
} from "../../_lib/milestones";
import { MILESTONES, type Milestone } from "../../_lib/timeline-api";
import {
  MILESTONE_KIND_LABEL,
  MILESTONE_STATUS_LABEL,
  formatDay,
} from "../../_lib/timeline";

/** A write a peer overtook, waiting for the writer's choice. `base` is the
 *  row my edit was built on, so a choice can merge three ways. */
type Pending =
  | {
      kind: "update";
      base: MilestoneRow;
      mine: MilestoneRow;
      theirs: Milestone;
    }
  | { kind: "delete"; theirs: Milestone };

/** A combined copy open in the table's editor, and what we both changed. */
interface Combining {
  id: string;
  title: string;
  reopen: { at: number; row: MilestoneRow };
  both: { field: Writable; mine: string; theirs: string }[];
}

function describe(
  row: MilestoneRow | Milestone,
  phases: { value: string; label: string }[]
): string {
  const phase = phases.find((p) => p.value === row.phase_id);
  return [
    row.title,
    `Due ${formatDay(row.target_date) ?? row.target_date}`,
    `${MILESTONE_STATUS_LABEL[row.status]}${
      row.completed_date ? ` on ${formatDay(row.completed_date)}` : ""
    }`,
    MILESTONE_KIND_LABEL[row.kind],
    phase ? `Phase ${phase.label}` : "No phase",
    row.description ? `Notes: ${row.description}` : "No notes",
  ].join("\n");
}

export function MilestonesSection({
  milestones,
  phases,
  canEdit,
  create,
  update,
  drop,
  replace,
}: {
  milestones: Milestone[];
  phases: PhaseChoice[];
  canEdit: boolean;
  create: (
    body: Record<string, unknown>,
    options?: { source?: WriteSource }
  ) => Promise<SaveResult<Milestone>>;
  update: (
    current: Milestone,
    patch: Record<string, unknown>,
    options?: UpdateOptions<Milestone>
  ) => Promise<SaveResult<Milestone>>;
  drop: (id: string) => void;
  replace: (item: Milestone) => void;
}) {
  const others = useMemo(
    () => otherPhases(milestones, phases),
    [milestones, phases]
  );
  const table = useMemo(() => milestoneTable(phases, others), [phases, others]);
  // Every phase a row can name, by id, for the conflict dialog's text.
  const phaseOptions = useMemo(
    () => [
      ...phases.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` })),
      ...others.map((o) => ({ value: o.id, label: o.label })),
    ],
    [phases, others]
  );
  const descriptor = useResourceDescriptor(MILESTONES);
  const rows = useMemo(() => milestones.map(milestoneToRow), [milestones]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Every overtaken write waits its turn here: a paste can meet several, and
  // each is put to the writer in order — none is dropped for a later one.
  const [pending, setPending] = useState<Pending[]>([]);
  const enqueue = (conflict: Pending) =>
    setPending((queue) => [...queue, conflict]);
  const head = pending[0] ?? null;
  const settle = () => setPending((queue) => queue.slice(1));
  const [combining, setCombining] = useState<Combining | null>(null);
  // Stable, so the table calls it only when its editor opens or closes —
  // closing it (Done or Cancel) ends the combine.
  const endCombining = useCallback((open: boolean) => {
    if (!open) setCombining(null);
  }, []);

  /** A field's value in words, for the "you both changed" note. */
  const valueText = (row: MilestoneRow, field: Writable): string => {
    const value = row[field];
    if (field === "target_date" || field === "completed_date")
      return formatDay(value as string | null) ?? "none";
    if (field === "status") return MILESTONE_STATUS_LABEL[row.status];
    if (field === "kind") return MILESTONE_KIND_LABEL[row.kind];
    if (field === "phase_id")
      return phaseOptions.find((p) => p.value === value)?.label ?? "No phase";
    return (value as string) || "none";
  };

  const recordOf = (id: string) => milestones.find((m) => m.id === id);

  const remove = async (record: Milestone): Promise<string | null> => {
    try {
      await deleteMilestone<Milestone>(record.id, record.version);
      drop(record.id);
      return null;
    } catch (err) {
      if (err instanceof VersionConflictError) {
        const theirs = err.current as Milestone;
        replace(theirs);
        enqueue({ kind: "delete", theirs });
        return null;
      }
      return `${record.title}: ${describeWriteFailure(err)}`;
    }
  };

  const apply = async (next: MilestoneRow[], how: "edit" | "import") => {
    setCombining(null);
    const source: WriteSource = how === "import" ? "import" : "ui";
    const plan = planMilestoneWrites(rows, next, how);
    const problems: string[] = [];
    // The one rule the served schema cannot express, refused before sending.
    for (const row of [
      ...plan.creates,
      ...plan.updates.map((u) => ({ ...u.row, ...u.patch })),
    ]) {
      const problem = milestoneRowProblem(row);
      if (problem) problems.push(`${row.title}: ${problem}`);
    }
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setBusy(true);
    const failures: string[] = [];
    for (const row of plan.creates) {
      const result = await create(createBody(row), { source });
      if (!result.ok && "error" in result)
        failures.push(`${row.title}: ${result.error}`);
    }
    for (const { row, patch } of plan.updates) {
      const record = recordOf(row.id);
      if (!record) continue;
      const result = await update(record, patch, { source });
      if (!result.ok && "conflict" in result) {
        enqueue({
          kind: "update",
          base: row,
          mine: { ...row, ...patch },
          theirs: result.conflict,
        });
      } else if (!result.ok) {
        failures.push(`${row.title}: ${result.error}`);
      }
    }
    for (const row of plan.deletes) {
      const record = recordOf(row.id);
      if (!record) continue;
      const failure = await remove(record);
      if (failure) failures.push(failure);
    }
    setBusy(false);
    setErrors(failures);
  };

  const latest = milestones.reduce<Milestone | null>(
    (newest, m) => (!newest || m.updated_at > newest.updated_at ? m : newest),
    null
  );

  return (
    <div className="space-y-3" data-ui-bridge-id="overview.timeline.milestones">
      {combining && (
        <div
          role="note"
          className="space-y-1 rounded-md border border-border bg-muted/40 p-2 text-sm"
          data-ui-bridge-id="overview.timeline.milestones.combining"
        >
          <p className="text-foreground">
            “{combining.title}” is open with your changes on top of theirs —
            what only they changed is kept. Check it, then choose Done.
          </p>
          {combining.both.length > 0 && (
            <>
              <p className="font-medium text-foreground">
                You both changed these; the editor holds yours — set theirs if
                theirs is right:
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {combining.both.map((b) => (
                  <li
                    key={b.field}
                    data-ui-bridge-id={`overview.timeline.milestones.combining.both.${b.field}`}
                  >
                    {MILESTONE_FIELD_LABEL[b.field]}: yours {b.mine} · theirs{" "}
                    {b.theirs}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <RecordTable
        table={table}
        rows={rows}
        canEdit={canEdit}
        busy={busy}
        rowSchema={descriptor?.schemas.create}
        onChange={(next, how) => void apply(next, how)}
        onEditingChange={endCombining}
        reopen={combining?.reopen ?? null}
        uiBridgeId="overview.timeline.milestones.table"
      />
      {errors.length > 0 && (
        <ul
          role="alert"
          className="space-y-1 text-sm text-destructive"
          data-ui-bridge-id="overview.timeline.milestones.errors"
        >
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {latest && (
        <ChangeLogPanel
          resource={MILESTONES}
          recordId={null}
          updatedBy={latest.updated_by}
          updatedAt={latest.updated_at}
          uiBridgeId="overview.timeline.milestones.history"
        />
      )}
      {head && (
        <ConflictDialog
          // One dialog per conflict, so the next never inherits this one's state.
          key={`${head.kind}:${head.theirs.id}:${head.theirs.version}`}
          open
          mine={
            head.kind === "update"
              ? describe(head.mine, phaseOptions)
              : "(removed)"
          }
          theirs={describe(head.theirs, phaseOptions)}
          theirsBy={head.theirs.updated_by}
          theirsAt={head.theirs.updated_at}
          onKeepMine={() => {
            const chosen = head;
            settle();
            void (async () => {
              if (chosen.kind === "update") {
                // Mine over theirs — but only the fields I changed: a field
                // only they changed is left as they wrote it.
                const { merged, patch } = rebaseMilestone(
                  chosen.base,
                  chosen.mine,
                  chosen.theirs
                );
                const problem = milestoneRowProblem(merged);
                if (problem) {
                  setErrors([`${merged.title}: ${problem}`]);
                  return;
                }
                if (Object.keys(patch).length === 0) return;
                const result = await update(chosen.theirs, patch);
                // Overtaken again: it is asked again, ahead of the rest.
                if (!result.ok && "conflict" in result)
                  setPending((queue) => [
                    { ...chosen, theirs: result.conflict },
                    ...queue,
                  ]);
                else if (!result.ok) setErrors([result.error]);
              } else {
                const failure = await remove(chosen.theirs);
                if (failure) setErrors([failure]);
              }
            })();
          }}
          onTakeTheirs={settle}
          // Their version is already in the table; combining opens its row
          // in the editor holding the three-way merge of mine onto theirs.
          onMerge={() => {
            const chosen = head;
            settle();
            if (chosen.kind !== "update") return;
            const at = rows.findIndex((r) => r.id === chosen.theirs.id);
            if (at < 0) return;
            const { merged, both } = rebaseMilestone(
              chosen.base,
              chosen.mine,
              chosen.theirs
            );
            const theirs = milestoneToRow(chosen.theirs);
            setCombining({
              id: chosen.theirs.id,
              title: merged.title,
              reopen: { at, row: merged },
              both: both.map((field) => ({
                field,
                mine: valueText(merged, field),
                theirs: valueText(theirs, field),
              })),
            });
          }}
          uiBridgeId="overview.timeline.milestones.conflict"
        />
      )}
    </div>
  );
}
