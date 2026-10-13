"use client";

import { useQuery } from "@tanstack/react-query";
import { runnerProxyGet } from "../_lib/runner-relay";
import {
  isValidAppId,
  type AppListResponse,
  type SpecGraphResponse,
  type SpecListResponse,
  type UiBridgeSnapshot,
} from "../_lib/ui-bridge-types";

/**
 * Hooks for the UI Bridge tab — the twin's UI half. Spec list/graph are the
 * CACHED/processed side (read from the runner's on-disk spec IR, no app run
 * needed); the snapshot is the AUTOMATION-required side (live DOM capture).
 * All go through the device-bridge relay to the paired runner, and
 * `runnerProxyGet` hands back the payload (the runner's `{ success, data }`
 * envelope already unwrapped).
 */

/**
 * The relay path for an app's Spec API route. The runner's relay allowlist
 * matches `/apps/{app_id}/…` with exactly one segment for the id, and an id
 * that passes `isValidAppId` is one segment as written. Nothing else is ever
 * built into a path — not even by a manual `refetch()`, which runs a disabled
 * query too. Encoding would not have helped: the relay decodes the path
 * before it checks or forwards it.
 */
function specPath(appId: string, leaf: "list" | "graph"): string {
  if (!isValidAppId(appId)) {
    throw new Error(`"${appId}" is not a valid app id.`);
  }
  return `apps/${appId}/spec/${leaf}`;
}

/**
 * The runner's registered apps (`GET /apps`) — what the App field suggests.
 * A runner whose relay allowlist predates this route answers 403; that, like
 * any other failure, is an error state here and the panel falls back to its
 * static suggestions.
 */
export function useRunnerApps(deviceId: string | null) {
  return useQuery({
    queryKey: ["digital-twin", "apps", deviceId],
    queryFn: () =>
      runnerProxyGet<AppListResponse>(deviceId as string, "apps", {
        timeoutMs: 8000,
      }),
    enabled: !!deviceId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** CACHED: the runner's discovered spec pages for `appId`. */
export function useRunnerSpecList(deviceId: string | null, appId: string) {
  return useQuery({
    queryKey: ["digital-twin", "spec-list", deviceId, appId],
    queryFn: () =>
      runnerProxyGet<SpecListResponse>(
        deviceId as string,
        specPath(appId, "list"),
        { timeoutMs: 8000 }
      ),
    // An empty or malformed App field names no app a runner could have
    // registered: there is nothing to ask for.
    enabled: !!deviceId && isValidAppId(appId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** CACHED: the cross-page state/transition graph for `appId`. */
export function useRunnerSpecGraph(deviceId: string | null, appId: string) {
  return useQuery({
    queryKey: ["digital-twin", "spec-graph", deviceId, appId],
    queryFn: () =>
      runnerProxyGet<SpecGraphResponse>(
        deviceId as string,
        specPath(appId, "graph"),
        { timeoutMs: 8000 }
      ),
    enabled: !!deviceId && isValidAppId(appId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * AUTOMATION-required: a live UI Bridge snapshot of the RUNNER'S OWN window.
 * The runner answers `ui-bridge/control/snapshot` from its own webview
 * (`ui_bridge_request_sync`), not from the app the Spec API reads are about,
 * so the key deliberately has no app id: the App field does not change what
 * this captures. What it captured is whatever `appId` / `page` the snapshot
 * reports. On-demand only (`enabled`) — we never fire it implicitly.
 */
export function useRunnerSnapshot(deviceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["digital-twin", "snapshot", deviceId],
    queryFn: () =>
      runnerProxyGet<UiBridgeSnapshot>(
        deviceId as string,
        "ui-bridge/control/snapshot",
        { timeoutMs: 10_000 }
      ),
    enabled: enabled && !!deviceId,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
