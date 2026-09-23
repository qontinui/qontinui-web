"use client";

/**
 * Measured runner state, rendered the same way wherever a runner is shown
 * (the sidebar status line, the Run-on picker).
 *
 * Locality is MEASURED (does the runner's port on this machine answer with
 * the runner's own id?), never inferred from `port != null`: a listed port
 * says nothing about whether this browser can reach it. Online/degraded is the
 * heartbeat's `derivedStatus`.
 */

import type { Runner } from "@qontinui/shared-types";
import type { RunnerLocality } from "@/lib/runner/locality";
import { cn } from "@/lib/utils";

export type RunnerDotStatus =
  | RunnerLocality
  | "none"
  | "list_loading"
  | "list_unavailable"
  | "unlisted";

export const RUNNER_DOT_LABEL: Record<RunnerDotStatus, string> = {
  local: "On this machine",
  not_local: "On another machine — not reachable from this browser",
  unknown: "Not confirmed on this machine yet",
  none: "No runner",
  list_loading: "Loading runners",
  list_unavailable: "Runner list unavailable — it could not be loaded",
  unlisted: "Not currently listed",
};

/** Short locality phrase for a runner line ("on this machine", …). */
export const LOCALITY_PHRASE: Record<RunnerLocality, string> = {
  local: "on this machine",
  not_local: "on another machine",
  unknown: "not confirmed on this machine",
};

export function runnerDotClass(status: RunnerDotStatus): string {
  return cn(
    status === "local" && "bg-emerald-500",
    (status === "not_local" || status === "list_unavailable") && "bg-amber-400",
    (status === "unknown" || status === "list_loading") && "bg-neutral-400",
    (status === "none" || status === "unlisted") && "bg-neutral-300"
  );
}

export function RunnerStateDot({ status }: { status: RunnerDotStatus }) {
  return (
    <span
      role="img"
      aria-label={RUNNER_DOT_LABEL[status]}
      title={RUNNER_DOT_LABEL[status]}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        runnerDotClass(status)
      )}
    />
  );
}

/** A listed runner's locality. Not measured yet reads as unknown, never local. */
export function runnerLocality(
  runner: Pick<Runner, "id">,
  localityById: ReadonlyMap<string, RunnerLocality>
): RunnerLocality {
  return localityById.get(runner.id) ?? "unknown";
}

/** Heartbeat state as a word: online, degraded, starting, offline, errored. */
export function heartbeatPhrase(runner: Runner): string {
  switch (runner.derivedStatus) {
    case "healthy":
      return "online";
    case "degraded":
      return "online, degraded";
    default:
      return runner.derivedStatus;
  }
}
