"use client";

/**
 * The target for a runner the user picked BY ID in a page-local selector.
 *
 * A runner is addressed by its coord device id, never by the IP address or
 * hostname it reports: the runner binds 127.0.0.1 only (qontinui-runner
 * `mcp_api.rs`), so `http://<reported-ip>:<port>` never answers, and a
 * reported address is no proof of WHICH machine answers anyway. The target is
 * resolved per request by `runnerRequest` / `runnerFetch` — loopback only when
 * the runner is proven local, the backend relay otherwise — so a runner that
 * reports only a hostname (or no address at all) is exactly as selectable as
 * any other.
 */

import { useMemo } from "react";
import type { Runner } from "@qontinui/shared-types";
import {
  buildRunnerTarget,
  useActiveRunner,
} from "@/contexts/active-runner-context";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import type { RunnerLocality } from "@/lib/runner/locality";
import type { RunnerTarget } from "@/lib/runner";

/**
 * The target for `runnerId` among `runners`, carrying its measured locality
 * (absent = measured on demand by the resolver). Null when no runner is
 * selected or the id is not listed.
 */
export function runnerTargetById(
  runners: readonly Runner[],
  localityById: ReadonlyMap<string, RunnerLocality>,
  runnerId: string | null
): RunnerTarget | null {
  if (runnerId === null) return null;
  const runner = runners.find((r) => r.id === runnerId);
  if (!runner) return null;
  return buildRunnerTarget(runner, localityById.get(runner.id));
}

/**
 * `runnerTargetById` over the live runner list — the SAME list the page's
 * selector renders (`useRealtimeConnections`), with the locality the active
 * runner provider measured. Stable while the runner's id, port, name and
 * locality are unchanged.
 */
export function useRunnerTargetById(
  runnerId: string | null
): RunnerTarget | null {
  const { runners } = useRealtimeConnections();
  const { localityById } = useActiveRunner();
  const runner = runnerId
    ? (runners.find((r) => r.id === runnerId) ?? null)
    : null;
  const locality = runner ? localityById.get(runner.id) : undefined;
  const id = runner?.id;
  const port = runner?.port;
  const name = runner?.name;
  return useMemo(
    () =>
      id === undefined
        ? null
        : {
            kind: "runner" as const,
            runner: { id, port, name },
            locality,
          },
    [id, port, name, locality]
  );
}
