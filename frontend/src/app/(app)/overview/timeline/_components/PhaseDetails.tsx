"use client";

/**
 * One phase in words — its plan, what actually happened, its gate — and, for
 * someone who may edit, the form that records progress.
 *
 * Recording progress is a write to the `phase_progress` resource: its own
 * version and `If-Match`, so it never conflicts with an estimate Save and an
 * estimate Save never undoes it. A write built on a version somebody else has
 * since moved is a conflict, shown side by side (`ConflictDialog`) — never a
 * silent overwrite. The form refuses, before sending, what the API would:
 * a finish before the start, a finish with no start, a decided gate with no
 * date, a pending one with a date, and any date after tomorrow (UTC).
 *
 * Controls are ABSENT for a reader who may not edit — `canEdit` is the served
 * permission for this project, never `isCoordAdmin`.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChangeLogPanel } from "@/components/overview/editing/ChangeLogPanel";
import { ConflictDialog } from "@/components/overview/editing/ConflictDialog";
import { threeWayMerge } from "@/components/overview/editing/merge";
import type { SaveResult } from "@/components/overview/editing/useResource";
import type { GateStatus } from "../../_lib/estimate-api";
import {
  PHASE_PROGRESS,
  type PhaseProgress,
  type PhaseProgressPatch,
} from "../../_lib/timeline-api";
import {
  GATE,
  GATE_OPTIONS,
  PHASE_STATE_LABEL,
  describeSlip,
  formatDay,
} from "../../_lib/timeline";
import type { TimelinePhase } from "./model";

interface Form {
  actual_start: string;
  actual_end: string;
  gate_status: GateStatus;
  gate_decided_at: string;
  gate_notes: string;
}

const FORM_FIELDS = [
  "actual_start",
  "actual_end",
  "gate_status",
  "gate_decided_at",
  "gate_notes",
] as const satisfies readonly (keyof Form)[];

const FIELD_LABEL: Record<keyof Form, string> = {
  actual_start: "Started on",
  actual_end: "Finished on",
  gate_status: "Gate outcome",
  gate_decided_at: "Decided on",
  gate_notes: "Notes on the gate",
};

/** One field of a form, in words. */
function shown(form: Form, field: keyof Form): string {
  if (field === "gate_status") return GATE[form.gate_status].label;
  if (field === "gate_notes") return form.gate_notes || "none";
  return formatDay(form[field]) ?? "not recorded";
}

/**
 * My form rebuilt on THEIR progress (`threeWayMerge`, against the version my
 * form was opened on): a field I did not touch takes theirs, so neither
 * "Combine them myself" nor "Save mine over theirs" can put back my stale
 * copy of a field only they changed. `both` is what we each changed.
 */
export function rebaseProgress(
  mine: Form,
  base: PhaseProgress,
  theirs: PhaseProgress
): { form: Form; both: (keyof Form)[] } {
  const { merged, both } = threeWayMerge(
    formOf(base),
    mine,
    formOf(theirs),
    FORM_FIELDS
  );
  return { form: merged, both };
}

const INPUT =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function formOf(p: PhaseProgress): Form {
  return {
    actual_start: p.actual_start ?? "",
    actual_end: p.actual_end ?? "",
    gate_status: p.gate_status,
    gate_decided_at: p.gate_decided_at ?? "",
    gate_notes: p.gate_notes,
  };
}

function wire(form: Form): Required<PhaseProgressPatch> {
  return {
    actual_start: form.actual_start || null,
    actual_end: form.actual_end || null,
    gate_status: form.gate_status,
    gate_decided_at: form.gate_decided_at || null,
    gate_notes: form.gate_notes,
  };
}

const DATE_LABEL = {
  actual_start: "The start date",
  actual_end: "The finish date",
  gate_decided_at: "The gate's decision date",
} as const;

/**
 * The server's rules for a phase's progress (`phase_progress_problem`), so
 * the form refuses first.
 *
 * Progress records what has HAPPENED, so no date may be later than tomorrow
 * — the server's rule exactly: today in UTC, plus the one day it allows
 * because "today" east of UTC is already UTC's tomorrow. The browser's own
 * calendar would not do: east of UTC it runs a day ahead in the evening and
 * the form would accept a date the server then refuses. A typo such as next
 * year's date would otherwise mark the phase as running and push the whole
 * forecast out.
 */
export function progressProblem(
  form: Form,
  now: Date = new Date()
): string | null {
  const latest = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  )
    .toISOString()
    .slice(0, 10);
  for (const field of [
    "actual_start",
    "actual_end",
    "gate_decided_at",
  ] as const) {
    const value = form[field];
    // ISO days compare correctly as strings.
    if (value && value > latest)
      return `${DATE_LABEL[field]} is ${formatDay(value)}, which hasn’t happened yet — progress records what has happened, so it can be ${formatDay(latest)} at the latest.`;
  }
  if (form.actual_end && !form.actual_start)
    return "A phase can’t finish without having started — give the day it started.";
  if (
    form.actual_start &&
    form.actual_end &&
    form.actual_end < form.actual_start
  )
    return "It can’t finish before it started.";
  if (form.gate_status === "pending" && form.gate_decided_at)
    return "A gate not decided yet has no decision date — clear it.";
  if (form.gate_status !== "pending" && !form.gate_decided_at)
    return "Give the day the gate was decided.";
  return null;
}

function describe(form: Form): string {
  return [
    `Started: ${formatDay(form.actual_start) ?? "not recorded"}`,
    `Finished: ${formatDay(form.actual_end) ?? "not recorded"}`,
    `Gate: ${GATE[form.gate_status].label}${
      form.gate_decided_at ? `, ${formatDay(form.gate_decided_at)}` : ""
    }`,
    `Notes: ${form.gate_notes || "none"}`,
  ].join("\n");
}

function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

export function PhaseDetails({
  phase,
  canEdit,
  onSave,
  uiBridgeId,
}: {
  phase: TimelinePhase;
  canEdit: boolean;
  onSave: (
    current: PhaseProgress,
    patch: PhaseProgressPatch
  ) => Promise<SaveResult<PhaseProgress>>;
  uiBridgeId: string;
}) {
  const p = phase.progress;
  const gate = GATE[p.gate_status];
  const finish = describeSlip(phase.forecast?.finish_slip_days ?? null);
  const [editing, setEditing] = useState<{
    form: Form;
    base: PhaseProgress;
    error: string | null;
    theirs: PhaseProgress | null;
    /** Fields we both changed, after a combine: Save waits for a choice. */
    both: (keyof Form)[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<PhaseProgress | null>(null);

  // Editing a field both of us changed is choosing its value.
  const set = (patch: Partial<Form>) =>
    editing &&
    setEditing({
      ...editing,
      form: { ...editing.form, ...patch },
      error: null,
      both: editing.both.filter((f) => !(f in patch)),
    });

  // Sends only the fields that differ from `base` — the version the patch
  // names — so a field nobody changed is never written back.
  const save = async (base: PhaseProgress, form: Form) => {
    const problem = progressProblem(form);
    if (problem) {
      setEditing({
        form,
        base,
        error: problem,
        theirs: editing?.theirs ?? null,
        both: editing?.both ?? [],
      });
      return;
    }
    const next = wire(form);
    const was = wire(formOf(base));
    const patch = Object.fromEntries(
      Object.entries(next).filter(([k, v]) => was[k as keyof typeof was] !== v)
    ) as PhaseProgressPatch;
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    setSaving(true);
    const result = await onSave(base, patch);
    setSaving(false);
    if (result.ok) {
      setEditing(null);
    } else if ("conflict" in result) {
      setEditing({ form, base, error: null, theirs: null, both: [] });
      setConflict(result.conflict);
    } else {
      setEditing({ form, base, error: result.error, theirs: null, both: [] });
    }
  };

  return (
    <div className="space-y-3 text-sm" data-ui-bridge-id={uiBridgeId}>
      <dl className="grid gap-1.5 sm:grid-cols-2">
        <Line label="Planned">
          {formatDay(p.planned_start) ?? "no start"} –{" "}
          {formatDay(p.planned_end) ?? "no end"}
        </Line>
        <Line label="Actual">
          <span data-ui-bridge-id={`${uiBridgeId}.actual`}>
            {p.actual_start
              ? `${formatDay(p.actual_start)} – ${
                  p.actual_end ? formatDay(p.actual_end) : "still running"
                }`
              : "Not started"}
          </span>
        </Line>
        {phase.forecast && (
          <Line label="State">
            {PHASE_STATE_LABEL[phase.forecast.state]}
            {phase.forecast.state !== "done" && phase.forecast.forecast_end
              ? `, expected to end ${formatDay(phase.forecast.forecast_end)}`
              : ""}
            {finish && finish.tone !== "on_plan" ? ` (${finish.text})` : ""}
          </Line>
        )}
        <Line label="Gate">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 text-xs font-medium ${gate.pill}`}
            data-ui-bridge-id={`${uiBridgeId}.gate-status`}
            data-gate-status={p.gate_status}
          >
            <span aria-hidden>{gate.symbol}</span>
            {gate.label}
          </span>
          {p.gate_decided_at && (
            <span className="ml-1 text-muted-foreground">
              on {formatDay(p.gate_decided_at)}
            </span>
          )}
        </Line>
      </dl>
      <p className="text-muted-foreground">
        <span className="text-foreground">To pass the gate: </span>
        {p.gate_criteria || "No criteria written in the estimate."}
      </p>
      {p.gate_notes && (
        <p
          className="whitespace-pre-wrap text-foreground"
          data-ui-bridge-id={`${uiBridgeId}.gate-notes`}
        >
          {p.gate_notes}
        </p>
      )}

      {canEdit && !editing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setEditing({
              form: formOf(p),
              base: p,
              error: null,
              theirs: null,
              both: [],
            })
          }
          data-ui-bridge-id={`${uiBridgeId}.record`}
        >
          Record progress
        </Button>
      )}

      {canEdit && editing && (
        <form
          className="space-y-3 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(editing.base, editing.form);
          }}
          data-ui-bridge-id={`${uiBridgeId}.form`}
        >
          {editing.theirs && (
            <div
              role="note"
              className="rounded-md bg-muted/50 p-2 text-xs"
              data-ui-bridge-id={`${uiBridgeId}.form.theirs`}
            >
              <p className="font-medium text-foreground">
                Their version, for reference — what only they changed is already
                in the form:
              </p>
              <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {describe(formOf(editing.theirs))}
              </pre>
            </div>
          )}
          {editing.theirs && editing.both.length > 0 && (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-destructive/40 p-2 text-xs"
              data-ui-bridge-id={`${uiBridgeId}.form.both`}
            >
              <p className="font-medium text-foreground">
                You both changed these — choose which to keep:
              </p>
              <ul className="space-y-1">
                {editing.both.map((field) => {
                  const theirs = editing.theirs!;
                  return (
                    <li
                      key={field}
                      className="flex flex-wrap items-center gap-x-2"
                      data-ui-bridge-id={`${uiBridgeId}.form.both.${field}`}
                    >
                      <span className="text-foreground">
                        {FIELD_LABEL[field]}:
                      </span>
                      <span>yours {shown(editing.form, field)}</span>
                      <span className="text-muted-foreground">
                        · theirs {shown(formOf(theirs), field)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            both: editing.both.filter((f) => f !== field),
                          })
                        }
                        data-ui-bridge-id={`${uiBridgeId}.form.both.${field}.mine`}
                      >
                        Keep mine
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => set({ [field]: formOf(theirs)[field] })}
                        data-ui-bridge-id={`${uiBridgeId}.form.both.${field}.theirs`}
                      >
                        Use theirs
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-muted-foreground">Started on</span>
              <input
                type="date"
                className={INPUT}
                value={editing.form.actual_start}
                onChange={(e) => set({ actual_start: e.target.value })}
                data-ui-bridge-id={`${uiBridgeId}.form.actual-start`}
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">Finished on</span>
              <input
                type="date"
                className={INPUT}
                value={editing.form.actual_end}
                onChange={(e) => set({ actual_end: e.target.value })}
                data-ui-bridge-id={`${uiBridgeId}.form.actual-end`}
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">Gate outcome</span>
              <select
                className={INPUT}
                value={editing.form.gate_status}
                onChange={(e) =>
                  set({ gate_status: e.target.value as GateStatus })
                }
                data-ui-bridge-id={`${uiBridgeId}.form.gate-status`}
              >
                {GATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">Decided on</span>
              <input
                type="date"
                className={INPUT}
                value={editing.form.gate_decided_at}
                onChange={(e) => set({ gate_decided_at: e.target.value })}
                data-ui-bridge-id={`${uiBridgeId}.form.decided-at`}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Notes on the gate</span>
            <textarea
              className={`${INPUT} min-h-16`}
              value={editing.form.gate_notes}
              maxLength={4000}
              onChange={(e) => set({ gate_notes: e.target.value })}
              data-ui-bridge-id={`${uiBridgeId}.form.notes`}
            />
          </label>
          {editing.error && (
            <p
              role="alert"
              className="text-destructive"
              data-ui-bridge-id={`${uiBridgeId}.form.error`}
            >
              {editing.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={saving || editing.both.length > 0}
              data-ui-bridge-id={`${uiBridgeId}.form.save`}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => setEditing(null)}
              data-ui-bridge-id={`${uiBridgeId}.form.cancel`}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <ChangeLogPanel
        resource={PHASE_PROGRESS}
        recordId={p.id}
        updatedBy={p.updated_by}
        updatedAt={p.updated_at}
        uiBridgeId={`${uiBridgeId}.history`}
      />

      {conflict && editing && (
        <ConflictDialog
          open
          mine={describe(editing.form)}
          theirs={describe(formOf(conflict))}
          theirsBy={conflict.updated_by}
          theirsAt={conflict.updated_at}
          onKeepMine={() => {
            // Mine over theirs — but only what I changed: a field only they
            // changed keeps theirs (the patch is against their version).
            const { form } = rebaseProgress(
              editing.form,
              editing.base,
              conflict
            );
            setConflict(null);
            void save(conflict, form);
          }}
          onTakeTheirs={() => {
            setConflict(null);
            setEditing(null);
          }}
          onMerge={() => {
            const { form, both } = rebaseProgress(
              editing.form,
              editing.base,
              conflict
            );
            setEditing({
              form,
              base: conflict,
              theirs: conflict,
              error: null,
              both,
            });
            setConflict(null);
          }}
          uiBridgeId={`${uiBridgeId}.conflict`}
        />
      )}
    </div>
  );
}
