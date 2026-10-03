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

import { useMemo, useState } from "react";
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
  type MilestoneRow,
  type PhaseChoice,
} from "../../_lib/milestones";
import { MILESTONES, type Milestone } from "../../_lib/timeline-api";
import {
  MILESTONE_KIND_LABEL,
  MILESTONE_STATUS_LABEL,
  formatDay,
} from "../../_lib/timeline";

/** A write a peer overtook, waiting for the writer's choice. */
type Pending =
  | { kind: "update"; mine: MilestoneRow; theirs: Milestone }
  | { kind: "delete"; theirs: Milestone };

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
  const [pending, setPending] = useState<Pending | null>(null);

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
        setPending({ kind: "delete", theirs });
        return null;
      }
      return `${record.title}: ${describeWriteFailure(err)}`;
    }
  };

  const apply = async (next: MilestoneRow[], how: "edit" | "import") => {
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
        setPending({
          kind: "update",
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
      <RecordTable
        table={table}
        rows={rows}
        canEdit={canEdit}
        busy={busy}
        rowSchema={descriptor?.schemas.create}
        onChange={(next, how) => void apply(next, how)}
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
      {pending && (
        <ConflictDialog
          open
          mine={
            pending.kind === "update"
              ? describe(pending.mine, phaseOptions)
              : "(removed)"
          }
          theirs={describe(pending.theirs, phaseOptions)}
          theirsBy={pending.theirs.updated_by}
          theirsAt={pending.theirs.updated_at}
          onKeepMine={() => {
            const chosen = pending;
            setPending(null);
            void (async () => {
              if (chosen.kind === "update") {
                const result = await update(
                  chosen.theirs,
                  createBody(chosen.mine)
                );
                if (!result.ok && "conflict" in result)
                  setPending({ ...chosen, theirs: result.conflict });
                else if (!result.ok) setErrors([result.error]);
              } else {
                const failure = await remove(chosen.theirs);
                if (failure) setErrors([failure]);
              }
            })();
          }}
          onTakeTheirs={() => setPending(null)}
          // Their version is already in the table; combining is editing it.
          onMerge={() => setPending(null)}
          uiBridgeId="overview.timeline.milestones.conflict"
        />
      )}
    </div>
  );
}
