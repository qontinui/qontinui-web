"use client";

import { targetRunnerId, useRunnerTarget } from "@/lib/runner";
import type { AppTwinRead } from "../_lib/twin-aspects";
import { RUNNER_APP_ID } from "../_lib/ui-bridge-types";
import { useRunnerApps, useRunnerSpecGraph } from "./useUiBridge";

/**
 * The UI Bridge app twin, as the Twin map's card reads it: the runner this
 * page targets, its app registry and the state graph of its own interface —
 * through the UI Bridge tab's own hooks and query keys, so the card and the
 * tab share one cache and never disagree (D1).
 */
export function useAppTwin(): AppTwinRead {
  const deviceId = targetRunnerId(useRunnerTarget());
  const apps = useRunnerApps(deviceId);
  const graph = useRunnerSpecGraph(deviceId, RUNNER_APP_ID);
  return { deviceId, apps, graph };
}
