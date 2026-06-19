"use client";

import { useQuery } from "@tanstack/react-query";
import { runnerProxyGet } from "../_lib/runner-relay";
import type {
  SpecGraphResponse,
  SpecListResponse,
  UiBridgeSnapshot,
} from "../_lib/ui-bridge-types";

/**
 * Hooks for the UI Bridge tab — the twin's UI half. Spec list/graph are the
 * CACHED/processed side (read from the runner's on-disk spec IR, no app run
 * needed); the snapshot is the AUTOMATION-required side (live DOM capture).
 * All go through the device-bridge relay to the paired runner.
 */

/** CACHED: the runner's discovered spec pages for `appId`. */
export function useRunnerSpecList(deviceId: string | null, appId: string) {
  return useQuery({
    queryKey: ["digital-twin", "spec-list", deviceId, appId],
    queryFn: () =>
      runnerProxyGet<SpecListResponse>(
        deviceId as string,
        `apps/${appId}/spec/list`,
        { timeoutMs: 8000 },
      ),
    enabled: !!deviceId,
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
        `apps/${appId}/spec/graph`,
        { timeoutMs: 8000 },
      ),
    enabled: !!deviceId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * AUTOMATION-required: a live UI Bridge snapshot of the runner's connected app.
 * On-demand only (`enabled`) — it requires the app to be running + connected, so
 * we never fire it implicitly.
 */
export function useRunnerSnapshot(deviceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["digital-twin", "snapshot", deviceId],
    queryFn: () =>
      runnerProxyGet<UiBridgeSnapshot>(
        deviceId as string,
        "ui-bridge/control/snapshot",
        { timeoutMs: 10_000 },
      ),
    enabled: enabled && !!deviceId,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
