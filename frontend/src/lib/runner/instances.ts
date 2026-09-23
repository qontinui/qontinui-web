/**
 * Per-instance rows of a runner (machine) — read defensively.
 *
 * Plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 6:
 * the device list carries `instances` (one entry per connected runner
 * instance on the machine — the primary on :9876, secondaries on :9877+).
 * The published `@qontinui/shared-types` this app resolves predates the
 * field, and a backend that predates it omits it, so it is read off the wire
 * row as `unknown` and validated here. `null` = not reported (UNKNOWN), never
 * "no instances".
 *
 * Display only: nothing here addresses a secondary instance.
 */

import type { Runner } from "@qontinui/shared-types";

export interface RunnerInstanceInfo {
  instanceKey: string;
  instanceRole: "primary" | "secondary" | string;
  port: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** The runner's reported instances, or null when the row carries none. */
export function readRunnerInstances(
  runner: Runner
): RunnerInstanceInfo[] | null {
  const raw = (runner as unknown as { instances?: unknown }).instances;
  if (!Array.isArray(raw)) return null;
  const out: RunnerInstanceInfo[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.instanceKey !== "string") continue;
    out.push({
      instanceKey: item.instanceKey,
      instanceRole:
        typeof item.instanceRole === "string" ? item.instanceRole : "unknown",
      port: typeof item.port === "number" ? item.port : null,
    });
  }
  return out;
}

/** "2 instances: primary :9876, runner:abc :9877" — or null when unreported. */
export function describeRunnerInstances(runner: Runner): string | null {
  const instances = readRunnerInstances(runner);
  if (instances === null || instances.length === 0) return null;
  const parts = instances.map((i) =>
    i.port === null ? i.instanceKey : `${i.instanceKey} :${i.port}`
  );
  const count =
    instances.length === 1 ? "1 instance" : `${instances.length} instances`;
  return `${count}: ${parts.join(", ")}`;
}
