"use client";

/**
 * The UI Bridge dashboard's reads, as React Query hooks.
 *
 * The runner reads go through `relayReads.ts` (the call sites the runner's
 * relay allowlist names); the spec list and graph, the live snapshot and the
 * runner's app list are the digital twin's own hooks (`useUiBridge.ts`),
 * reused rather than forked, so both pages share one cache entry per runner.
 * The web registry is a plain web-backend read. Neither app registry is
 * read while presenting ({@link appRegistryReadsOf}).
 *
 * Nothing here polls: the dashboard's numbers change when a runner's UI or
 * build changes, so the page re-reads on the operator's refresh. The live
 * snapshot and page health each drive a full `discover` of the runner's
 * window, so they run ONLY when asked — and only for the runner they were
 * asked for: switching runners never fires them implicitly, and switching
 * back does not resume a request (`useOnDemandRequest`). The occlusion sweep
 * would too, but no relay carries it, so it is not asked at all
 * ({@link occlusionReadOf}).
 */

import { useCallback, useMemo } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import { targetRunnerId, useRunnerTarget } from "@/lib/runner";
import { useActiveRunner } from "@/contexts/active-runner-context";
import {
  usePresentationMode,
  type MachineIdentity,
} from "@/components/presentation";
import { useRunnerApps } from "@/app/(app)/digital-twin/_hooks/useUiBridge";
import type {
  AppListResponse,
  RegisteredApp,
} from "@/app/(app)/digital-twin/_lib/ui-bridge-types";
import {
  RUNNER_APP_LIST_NOT_IN_LENS,
  WEB_REGISTRY_NOT_IN_LENS,
  type RegistryRead,
  type WebAppConfig,
} from "./appRegistryStatus";
import {
  OCCLUSION_NOT_RELAYED,
  readOcclusion,
  type OcclusionReading,
} from "./occlusionStatus";
import {
  NOT_ASKED,
  isRecord,
  queryView,
  readStateOf,
  type QueryView,
  type ReadState,
} from "./readState";
import {
  fetchRunnerComponents,
  fetchRunnerHealth,
  fetchRunnerPageHealth,
  fetchRunnerVisibility,
} from "./relayReads";
import { noRunnerReason } from "./relaySource";
import { useOnDemandRequest } from "./useOnDemandRequest";

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

const healthKey = (deviceId: string | null) =>
  [UI_BRIDGE_DASHBOARD_KEY, "health", deviceId] as const;
const componentsKey = (deviceId: string | null) =>
  [UI_BRIDGE_DASHBOARD_KEY, "components", deviceId] as const;
const fleetAppsKey = () => [UI_BRIDGE_DASHBOARD_KEY, "fleet-apps"] as const;

/**
 * `GET /health`, whole — the build and the SDK and trust posture.
 *
 * With no runner targeted the query has no function at all (`skipToken`), so
 * nothing — not even a `refetch()`, which ignores `enabled` — can send the
 * relay a request with no device id.
 */
export function useRunnerHealthRead(deviceId: string | null) {
  return useQuery({
    queryKey: healthKey(deviceId),
    queryFn:
      deviceId === null ? skipToken : () => fetchRunnerHealth(deviceId),
    staleTime: 30_000,
    ...READ_DEFAULTS,
  });
}

/**
 * `GET /ui-bridge/control/components` — the component action registry. Like
 * the health read, it has no function while no runner is targeted.
 */
export function useRunnerComponentsRead(deviceId: string | null) {
  return useQuery({
    queryKey: componentsKey(deviceId),
    queryFn:
      deviceId === null ? skipToken : () => fetchRunnerComponents(deviceId),
    staleTime: 30_000,
    ...READ_DEFAULTS,
  });
}

/**
 * `GET /api/v1/fleet/apps` — the web's app registry. Not read while
 * presenting: the route is not partitioned by project
 * ({@link appRegistryReadsOf}), so the query has no function then.
 */
export function useFleetAppsRead() {
  const { presenting } = usePresentationMode();
  return useQuery({
    queryKey: fleetAppsKey(),
    queryFn: presenting
      ? skipToken
      : () => httpClient.get<WebAppConfig[]>(FLEET_APPS_PATH),
    staleTime: 60_000,
    ...READ_DEFAULTS,
  });
}

/**
 * The runner's own app list (`GET /apps`) — the digital twin's
 * `useRunnerApps`, reused. Not read while presenting, for the web registry's
 * reason ({@link appRegistryReadsOf}): the hook is handed no device then, so
 * its query is disabled.
 */
export function useRunnerAppListRead(deviceId: string | null) {
  const { presenting } = usePresentationMode();
  return useRunnerApps(presenting ? null : deviceId);
}

/**
 * The page's Refresh: re-read every metadata read the page is SHOWING — the
 * runner's health and components, the web registry, and the digital twin's
 * reads the page reuses (the runner's app list, each app's spec list and
 * graph). The live snapshot and page health are not among them: they run
 * only from their own buttons.
 *
 * Only ACTIVE queries are re-read (`refetchQueries({ type: "active" })`). A
 * read the page holds disabled stays unasked: every runner read while no
 * runner is targeted, and both app registries while presenting. A query's
 * own `refetch()` ignores `enabled` and would run it anyway — sending the
 * relay a request with no device id, or making a read the lens does not make.
 */
export function useDashboardRefresh(
  deviceId: string | null
): () => Promise<unknown> {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        [
          healthKey(deviceId),
          componentsKey(deviceId),
          fleetAppsKey(),
          // The digital twin's reads (`useUiBridge.ts`), by their own keys.
          ["digital-twin", "apps", deviceId],
          ["digital-twin", "spec-list", deviceId],
          ["digital-twin", "spec-graph", deviceId],
        ].map((queryKey) =>
          queryClient.refetchQueries({ queryKey, type: "active" })
        )
      ),
    [queryClient, deviceId]
  );
}

/**
 * Page health — and the occlusion sweep, where a relay carries it
 * (`sweepRelayed`) — run together and only on request, for the runner they
 * were requested for. `run()` starts them, and re-runs them once they have
 * answered; its promise settles when every read that was started has. The
 * request ends when the page switches runners (`useOnDemandRequest`), so
 * switching back neither re-runs them nor shows their earlier answer: the
 * views the page reads (`pageHealthView`, `visibilityView`) are not asked
 * until the reads are asked for again.
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
  const { requested, request } = useOnDemandRequest(deviceId);
  const pageHealth = useQuery({
    queryKey: [UI_BRIDGE_DASHBOARD_KEY, "page-health", deviceId],
    queryFn:
      deviceId === null ? skipToken : () => fetchRunnerPageHealth(deviceId),
    enabled: requested,
    staleTime: 0,
    ...READ_DEFAULTS,
  });
  const visibility = useQuery({
    queryKey: [UI_BRIDGE_DASHBOARD_KEY, "visibility", deviceId],
    queryFn:
      deviceId === null ? skipToken : () => fetchRunnerVisibility(deviceId),
    enabled: requested && sweepRelayed,
    staleTime: 0,
    ...READ_DEFAULTS,
  });
  const refetchHealth = pageHealth.refetch;
  const refetchVisibility = visibility.refetch;
  const run = useCallback((): Promise<unknown> | void => {
    if (deviceId === null) return;
    if (!requested) {
      // Enabling the queries starts them; nothing to await here.
      request();
      return;
    }
    return Promise.all(
      sweepRelayed ? [refetchHealth(), refetchVisibility()] : [refetchHealth()]
    );
  }, [
    deviceId,
    requested,
    request,
    sweepRelayed,
    refetchHealth,
    refetchVisibility,
  ]);
  return {
    pageHealth,
    visibility,
    run,
    requested,
    pageHealthView: requested ? queryView(pageHealth) : NOT_ASKED,
    visibilityView: requested ? queryView(visibility) : NOT_ASKED,
  };
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

export interface AppRegistryReadsInput {
  /** Whether the page is presenting (`usePresentationMode`). */
  readonly presenting: boolean;
  /** The web registry's query ({@link useFleetAppsRead}). */
  readonly web: QueryView<WebAppConfig[]>;
  /** The runner's own app list ({@link useRunnerAppListRead}). */
  readonly runner: QueryView<AppListResponse>;
}

/**
 * The two app registries' reads as the page shows them — decided here, and
 * nowhere else.
 *
 * Neither registry is partitioned by project. The web's `GET
 * /api/v1/fleet/apps` returns every row of `project.apps` to any signed-in
 * user (backend `fleet_targets.py` `list_apps`), and the runner's `GET /apps`
 * lists every row of its own database's apps table, which on a runner bound
 * to the shared database is that same table. A lens page fetches only the
 * acting organisation's data (plan `2026-10-23-console-presentation-spaces`
 * D3.4), so while presenting neither is READ — their hooks hold the queries
 * disabled — and neither is SHOWN: a value an operator-mode read left in the
 * cache is not handed on either. Each half is `not-read`, with the reason the
 * panel renders as a labelled UNKNOWN.
 */
export function appRegistryReadsOf({
  presenting,
  web,
  runner,
}: AppRegistryReadsInput): {
  readonly web: RegistryRead<readonly WebAppConfig[]>;
  readonly runner: RegistryRead<readonly RegisteredApp[]>;
} {
  if (presenting) {
    return {
      web: { state: "not-read", reason: WEB_REGISTRY_NOT_IN_LENS },
      runner: { state: "not-read", reason: RUNNER_APP_LIST_NOT_IN_LENS },
    };
  }
  return {
    web: readStateOf(web, (d) => (Array.isArray(d) ? d : null)),
    // A body that is not an object (`null` included) is an answer this page
    // cannot read — UNKNOWN, never a crash.
    runner: readStateOf(runner, (d) =>
      isRecord(d) && Array.isArray(d.apps) ? d.apps : null
    ),
  };
}
