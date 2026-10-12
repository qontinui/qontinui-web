/**
 * One phase as the Timeline draws it: the estimate's plan, the progress
 * recorded against it (with the version a write must name), its tasks, and
 * the server's forecast for it. Assembled once by the page so every part of
 * it reads the same phase the same way.
 */

import type { PhaseTaskRead } from "../../_lib/estimate-api";
import type { PhaseForecast, PhaseProgress } from "../../_lib/timeline-api";

export interface TimelinePhase {
  progress: PhaseProgress;
  tasks: PhaseTaskRead[];
  /** `null` when the forecast could not be read. */
  forecast: PhaseForecast | null;
}

export function assemblePhases(
  progress: PhaseProgress[],
  tasks: Map<string, PhaseTaskRead[]>,
  forecast: PhaseForecast[] | null
): TimelinePhase[] {
  return progress.map((p) => ({
    progress: p,
    tasks: tasks.get(p.id) ?? [],
    forecast: forecast?.find((f) => f.id === p.id) ?? null,
  }));
}

/** A phase's code, which the UI Bridge ids are keyed on: stable across a
 *  re-plan and unique within an estimate. */
export function phaseKey(phase: TimelinePhase): string {
  return phase.progress.code;
}
