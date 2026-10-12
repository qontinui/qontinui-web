/**
 * Per-instance rows of a runner (machine).
 *
 * Plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 6:
 * the device list carries `instances` (one entry per connected runner
 * instance on the machine — the primary on :9876, secondaries on :9877+).
 * `Runner.instances` is typed by `@qontinui/shared-types` (1.1.0 and later),
 * so the entries are read as that type.
 *
 * The runtime checks that stay exist because the row is JSON that nothing
 * validates on arrival. A backend that predates the field omits it: `null` =
 * not reported (UNKNOWN), never "no instances". An entry with no string
 * `instanceKey` cannot be named, so it is dropped rather than rendered. A
 * `port` that is not a number is left out of the description.
 *
 * Display only: nothing here addresses a secondary instance.
 */

import type { Runner } from "@qontinui/shared-types";

/**
 * One connected runner instance.
 *
 * Derived from `Runner`, because `@qontinui/shared-types` 2.0.0 declares
 * `RunnerInstance` but exports it from no entry point. Once it is exported,
 * import it from the package and drop this alias.
 */
export type RunnerInstance = Runner["instances"][number];

/** The runner's reported instances, or null when the row does not report the field. */
export function readRunnerInstances(runner: Runner): RunnerInstance[] | null {
  if (!Array.isArray(runner.instances)) return null;
  return runner.instances.filter(
    (i: RunnerInstance | null | undefined) => typeof i?.instanceKey === "string"
  );
}

/** "2 instances: primary :9876, runner:abc :9877" — or null when unreported. */
export function describeRunnerInstances(runner: Runner): string | null {
  const instances = readRunnerInstances(runner);
  if (instances === null || instances.length === 0) return null;
  const parts = instances.map((i) =>
    typeof i.port === "number" ? `${i.instanceKey} :${i.port}` : i.instanceKey
  );
  const count =
    instances.length === 1 ? "1 instance" : `${instances.length} instances`;
  return `${count}: ${parts.join(", ")}`;
}
