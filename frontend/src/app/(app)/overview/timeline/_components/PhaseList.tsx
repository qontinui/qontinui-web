"use client";

/**
 * The Timeline as a list, grouped by phase — the same facts as the chart, as
 * text. It is the layout a phone gets, and the one a screen reader reads.
 *
 * Per phase: its plan, what happened, its gate (and, for an editor, the form
 * that records them), its tasks with the critical ones marked, and the
 * milestones tied to it. Milestones tied to no phase close the list.
 */

import type { SaveResult } from "@/components/overview/editing/useResource";
import type {
  Milestone,
  PhaseProgress,
  PhaseProgressPatch,
} from "../../_lib/timeline-api";
import {
  MILESTONE_KIND_LABEL,
  MILESTONE_STATUS_LABEL,
  PHASE_STATE_LABEL,
  formatDay,
} from "../../_lib/timeline";
import { phaseKey, type TimelinePhase } from "./model";
import { PhaseDetails } from "./PhaseDetails";

function MilestoneItems({
  milestones,
  uiBridgeId,
}: {
  milestones: Milestone[];
  uiBridgeId: string;
}) {
  if (milestones.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm" data-ui-bridge-id={uiBridgeId}>
      {milestones.map((m) => (
        <li key={m.id} data-ui-bridge-id={`${uiBridgeId}.${m.id}`}>
          <span className="text-foreground">{m.title}</span>{" "}
          <span className="text-muted-foreground">
            · {MILESTONE_KIND_LABEL[m.kind]} · due {formatDay(m.target_date)} ·{" "}
            {MILESTONE_STATUS_LABEL[m.status]}
            {m.completed_date ? ` on ${formatDay(m.completed_date)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PhaseList({
  phases,
  milestones,
  canEdit,
  onSave,
}: {
  phases: TimelinePhase[];
  milestones: Milestone[];
  canEdit: boolean;
  onSave: (
    current: PhaseProgress,
    patch: PhaseProgressPatch
  ) => Promise<SaveResult<PhaseProgress>>;
}) {
  const phaseIds = new Set(phases.map((p) => p.progress.id));
  const loose = milestones.filter(
    (m) => !m.phase_id || !phaseIds.has(m.phase_id)
  );
  return (
    <ol className="space-y-8" data-ui-bridge-id="overview.timeline.list">
      {phases.map((phase) => {
        const key = phaseKey(phase);
        const id = `overview.timeline.list.phase.${key}`;
        const own = milestones.filter((m) => m.phase_id === phase.progress.id);
        return (
          <li key={phase.progress.id} data-ui-bridge-id={id}>
            <h3 className="font-[family-name:var(--font-overview-serif)] text-xl leading-snug text-foreground">
              <span className="font-mono text-sm text-muted-foreground">
                {phase.progress.code}
              </span>{" "}
              {phase.progress.name}
              {phase.forecast && (
                <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                  {PHASE_STATE_LABEL[phase.forecast.state]}
                </span>
              )}
            </h3>
            <div className="mt-2 border-l-2 border-border pl-4">
              <PhaseDetails
                phase={phase}
                canEdit={canEdit}
                onSave={onSave}
                uiBridgeId={`${id}.details`}
              />
              {phase.tasks.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary
                    className="cursor-pointer text-muted-foreground"
                    data-ui-bridge-id={`${id}.tasks-toggle`}
                  >
                    {phase.tasks.length} task
                    {phase.tasks.length === 1 ? "" : "s"}
                  </summary>
                  <ul
                    className="mt-1 space-y-0.5"
                    data-ui-bridge-id={`${id}.tasks`}
                  >
                    {phase.tasks.map((task) => (
                      <li key={task.id}>
                        <span className="font-mono text-xs text-muted-foreground">
                          {task.number}
                        </span>{" "}
                        {task.title}
                        {task.is_critical && (
                          <span className="ml-1 text-xs font-medium text-red-700 dark:text-red-400">
                            Critical
                          </span>
                        )}
                        {task.planned_start && task.planned_end && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {formatDay(task.planned_start)} –{" "}
                            {formatDay(task.planned_end)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-3">
                <MilestoneItems
                  milestones={own}
                  uiBridgeId={`${id}.milestones`}
                />
              </div>
            </div>
          </li>
        );
      })}
      {loose.length > 0 && (
        <li data-ui-bridge-id="overview.timeline.list.unphased">
          <h3 className="font-[family-name:var(--font-overview-serif)] text-xl leading-snug text-foreground">
            Not tied to a phase
          </h3>
          <div className="mt-2 border-l-2 border-border pl-4">
            <MilestoneItems
              milestones={loose}
              uiBridgeId="overview.timeline.list.unphased.milestones"
            />
          </div>
        </li>
      )}
    </ol>
  );
}
