"use client";

import { targetRunnerId, useRunnerTarget } from "@/lib/runner";
import type { AppTwinRead } from "../_lib/twin-aspects";
import { RUNNER_APP_ID } from "../_lib/ui-bridge-types";
import { useBrowserOnline } from "./useBrowserOnline";
import { useRunnerApps, useRunnerSpecGraph } from "./useUiBridge";

/**
 * The UI Bridge app twin, as the Twin map's card reads it: the runner this
 * page targets, its app registry and the state graph of its own interface —
 * through the UI Bridge tab's own hooks and query keys, so the card and the
 * tab share one cache and never disagree (D1). Whether this browser is online
 * names why a read with no answer has none in flight.
 */
export function useAppTwin(): AppTwinRead {
  const deviceId = targetRunnerId(useRunnerTarget());
  const online = useBrowserOnline();
  const apps = useRunnerApps(deviceId);
  const graph = useRunnerSpecGraph(deviceId, RUNNER_APP_ID);
  return { deviceId, online, apps, graph };
}
