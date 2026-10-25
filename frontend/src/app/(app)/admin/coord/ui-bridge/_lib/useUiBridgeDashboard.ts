"use client";

/**
 * The UI Bridge dashboard's reads, as React Query hooks.
 *
 * The runner reads go through `relayReads.ts` (the call sites the runner's
 * relay allowlist names); the spec list and graph, the live snapshot and the
 * runner's app list are the digital twin's own hooks (`useUiBridge.ts`),
 * reused rather than forked, so both pages share one cache entry per runner.
 * The web registry is a plain web-backend read.
 *
 * Nothing here polls: the dashboard's numbers change when a runner's UI or
 * build changes, so the page re-reads on the operator's refresh. The live
 * snapshot and page health each drive a full `discover` of the runner's
 * window, so they run ONLY when asked — and only for the runner they were
 * asked for: switching runners never fires them implicitly. The occlusion
 * sweep would too, but no relay carries it, so it is not asked at all
 * ({@link occlusionReadOf}).
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import { targetRunnerId, useRunnerTarget } from "@/lib/runner";
import { useActiveRunner } from "@/contexts/active-runner-context";
import {
  usePresentationMode,
  type MachineIdentity,
} from "@/components/presentation";
import type { WebAppConfig } from "./appRegistryStatus";
import {
  OCCLUSION_NOT_RELAYED,
  readOcclusion,
  type OcclusionReading,
} from "./occlusionStatus";
import { readStateOf, type QueryView, type ReadState } from "./readState";
import {
  fetchRunnerComponents,
  fetchRunnerHealth,
  fetchRunnerPageHealth,
  fetchRunnerVisibility,
} from "./relayReads";
import { noRunnerReason } from "./relaySource";

/** Every query key on this page starts with it. */
export const UI_BRIDGE_DASHBOARD_KEY = "ui-bridge-dashboard";

/** The web registry read (backend `fleet_targets.py` `list_apps`). */
export const FLEET_APPS_PATH = "/api/v1/fleet/apps";

const READ_DEFAULTS = {
  refetchOnWindowFocus: false,
  retry: false,
} as const;

/** The runner this page reads, and what names it. */
export interface DashboardRunner {
  /** The device id to relay to, or null when no runner is targeted. */
  readonly deviceId: string | null;
  /** Every identifier the page holds for it — aliased in presentation mode. */
  readonly identity: MachineIdentity;
  /** Why no runner can be read; null when one is targeted. */
  readonly noRunner: string | null;
}

/**
 * The runner the page reads: the tree's runner target (the operator's pick,
 * else coord's), exactly as the digital twin's UI Bridge tab reads it — so a
 * device coord resolved that the web list has not caught up with still counts.
 * Its hostname and name come from the runner list when it carries the device.
 *
 * While presenting, the no-runner reason is the target's fixed phrase, never
 * its refuser's sentence, which can name the runner the operator picked (D3.3;
 * `noRunnerReason`). Every identifier in `identity` is aliased by the caller.
 */
export function useDashboardRunner(): DashboardRunner {
  const { presenting } = usePresentationMode();
  const target = useRunnerTarget();
  const { runners } = useActiveRunner();
  const deviceId = targetRunnerId(target);
  const listed = deviceId ? runners.find((r) => r.id === deviceId) : undefined;
  const hostname = listed?.hostname ?? null;
  const displayName =
    listed?.name ?? (target.kind === "runner" ? target.runner.name : undefined);
  const identity = useMemo<MachineIdentity>(
    () => ({
      deviceId: deviceId ?? undefined,
      hostname: hostname ?? undefined,
      displayName: displayName ?? undefined,
    }),
    [deviceId, hostname, displayName]
  );
  return {
    deviceId,
    identity,
    noRunner: noRunnerReason(target, { quoteMessage: !presenting }),
  };
}

/** `GET /health`, whole — the build and the SDK and trust posture. */
export function useRunnerHealthRead(deviceId: string | null) {
  return useQuery({
    queryKey: [UI_BRIDGE_DASHBOARD_KEY, "health", deviceId],
    queryFn: () => fetchRunnerHealth(deviceId as string),
    enabled: !!deviceId,
    staleTime: 30_000,
    ...READ_DEFAULTS,
  });
}

/** `GET /ui-bridge/control/components` — the component action registry. */
export function useRunnerComponentsRead(deviceId: string | null) {
  return useQuery({
    queryKey: [UI_BRIDGE_DASHBOARD_KEY, "components", deviceId],
    queryFn: () => fetchRunnerComponents(deviceId as string),
    enabled: !!deviceId,
    staleTime: 30_000,
    ...READ_DEFAULTS,
  });
}

/** `GET /api/v1/fleet/apps` — the web's app registry. */
export function useFleetAppsRead() {
  return useQuery({
    queryKey: [UI_BRIDGE_DASHBOARD_KEY, "fleet-apps"],
    queryFn: () => httpClient.get<WebAppConfig[]>(FLEET_APPS_PATH),
    staleTime: 60_000,
    ...READ_DEFAULTS,
  });
}

/**
 * Page health — and the occlusion sweep, where a relay carries it
 * (`sweepRelayed`) — run together and only on request, for the runner they
 * were requested for. `run()` starts them, and re-runs them once they have
 * answered; its promise settles when every read that was started has.
 *
 * `sweepRelayed` is `isRelayed(RUNNER_ROUTES.visibility)`: a fact about the
 * relay's allow-list, not a switch. While it is false the sweep is not asked
 * for — its query stays disabled, and `run()` leaves out its `refetch`, which
 * would otherwise ignore `enabled` — and the page reads the occlusion row
 * from {@link occlusionReadOf}, not from `visibility`.
 */
export function usePageHealthRun(
  deviceId: string | null,
  sweepRelayed: boolean
) {
  const [requestedFor, setRequestedFor] = useState<string | null>(null);
  const enabled = deviceId !== null && requestedFor === deviceId;
  const pageHealth = useQuery({
    queryKey: [UI_BRIDGE_DASHBOARD_KEY, "page-health", deviceId],
    queryFn: () => fetchRunnerPageHealth(deviceId as string),
    enabled,
    staleTime: 0,
    ...READ_DEFAULTS,
  });
  const visibility = useQuery({
    queryKey: [UI_BRIDGE_DASHBOARD_KEY, "visibility", deviceId],
    queryFn: () => fetchRunnerVisibility(deviceId as string),
    enabled: enabled && sweepRelayed,
    staleTime: 0,
    ...READ_DEFAULTS,
  });
  const refetchHealth = pageHealth.refetch;
  const refetchVisibility = visibility.refetch;
  const run = useCallback((): Promise<unknown> | void => {
    if (deviceId === null) return;
    if (requestedFor !== deviceId) {
      // Enabling the queries starts them; nothing to await here.
      setRequestedFor(deviceId);
      return;
    }
    return Promise.all(
      sweepRelayed ? [refetchHealth(), refetchVisibility()] : [refetchHealth()]
    );
  }, [deviceId, requestedFor, sweepRelayed, refetchHealth, refetchVisibility]);
  return { pageHealth, visibility, run, requested: enabled };
}

export interface OcclusionReadInput {
  /** `isRelayed(RUNNER_ROUTES.visibility)` — whether any relay carries the sweep. */
  readonly sweepRelayed: boolean;
  /** Whether page health has been asked for (`usePageHealthRun().requested`). */
  readonly requested: boolean;
  /** The sweep's query. Read ONLY where the sweep was asked for. */
  readonly sweep: QueryView<unknown>;
}

/**
 * The occlusion row's state — decided here, and nowhere else.
 *
 * While no relay carries the sweep, the row is the standing UNKNOWN
 * ({@link OCCLUSION_NOT_RELAYED}) from the moment page health is asked for, and
 * absent before. `sweep` is not consulted on that arm: no answer a runner gives
 * — to the sweep's route, to page health, to anything — can turn the row into
 * a verdict. In particular a page-health body that carries
 * `occlusionDataObserved` (page health's report has no such field today; a
 * future runner might add one) changes nothing, because this function is never
 * handed that body. Coord finding `99796499-8e46-4d69-94ba-a2ac9fe3ea22` and
 * the plan's Phase 6 amendment (2026-10-24) are why: the only producer of the
 * field is a route no relay carries, and the row must not read "clear" until
 * the follow-up that relays it lands. That follow-up flips the route's
 * carriage, and the sweep's honest reading (`readOcclusion`) takes over then.
 */
export function occlusionReadOf({
  sweepRelayed,
  requested,
  sweep,
}: OcclusionReadInput): ReadState<OcclusionReading> {
  if (!sweepRelayed) {
    return requested
      ? { state: "ok", value: OCCLUSION_NOT_RELAYED, stale: false, asOf: null }
      : { state: "idle" };
  }
  return readStateOf(sweep, readOcclusion);
}
