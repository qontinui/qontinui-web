"use client";

import { Info } from "lucide-react";

interface TaskRunScopeNoteProps {
  /**
   * The `scope` string from the `GET /task-runs/running` envelope. `null` or
   * empty renders nothing — an absent scope is unknown, not a claim.
   */
  scope: string | null | undefined;
  className?: string;
}

/**
 * Renders the running-task-runs endpoint's own scope statement next to an
 * empty/idle state.
 *
 * An operator once read `/task-runs/running` -> `[]`, concluded the runner was
 * idle, and nearly restarted it while 23 live agent sessions were running. The
 * list is a port-filtered *workflow* task-run ledger, not a session census, and
 * the runner now says so in every response. Showing that sentence wherever the
 * list renders empty is the whole point of the envelope — parsing `scope` and
 * dropping it would reintroduce the defect.
 *
 * Plan: 2026-08-29-no-single-answer-to-is-it-safe-to-restart-the-runner.
 */
export function TaskRunScopeNote({ scope, className }: TaskRunScopeNoteProps) {
  if (!scope) return null;
  return (
    <p
      data-content-role="status"
      data-content-label="task-run scope"
      className={`flex items-start gap-1.5 text-xs text-muted-foreground ${className ?? ""}`}
    >
      <Info className="size-3.5 shrink-0 mt-px" />
      <span>{scope}</span>
    </p>
  );
}
