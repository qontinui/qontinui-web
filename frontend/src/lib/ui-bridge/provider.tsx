"use client";

/**
 * UI Bridge Provider Wrapper
 *
 * Configures UIBridgeProvider with appropriate features based on environment.
 * Includes AutoRegisterProvider for automatic element registration.
 * Supports both WebSocket and HTTP polling for remote automation.
 *
 * In development, captured browser events are batched and persisted
 * to .dev-logs/browser-events.jsonl via a Next.js API route.
 *
 * Transport modes:
 * - 'auto' (default): Try WebSocket first, fall back to HTTP polling
 * - 'websocket': Use WebSocket only
 * - 'http': Use HTTP polling only
 */

import React, { useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  UIBridgeProvider,
  AutoRegisterProvider,
} from "@qontinui/ui-bridge/react";
import type {
  UIBridgeFeatures,
  UIBridgeConfig,
  BridgeEvent,
} from "@qontinui/ui-bridge/core";
import type {
  BrowserCaptureConfig,
  AnyCapturedEvent,
} from "@qontinui/ui-bridge/debug";
import { CommandRelayListener } from "@qontinui/ui-bridge/react";
import { getGlobalSpecStore } from "@qontinui/ui-bridge/specs";
import { RouteAwarenessProvider } from "./RouteAwarenessProvider";
import { useDiscoveredSpecs } from "./use-discovered-specs";
import { tokenStorage } from "@/services/service-factory";

/**
 * Auth-header hook for the SDK's CommandRelayListener (SDK ≥ 0.10.0).
 *
 * Reads the current bearer token from sessionStorage on every outbound
 * relay request so a token rotation is picked up without remounting the
 * listener. Returns `null` when no token is available — the SDK then
 * falls back to legacy cookie / unauth'd behavior.
 *
 * Required to authenticate against the relay route when
 * `UI_BRIDGE_REQUIRE_AUTH=1` is set in the deployment env (see
 * `app/api/ui-bridge/[...path]/_auth.ts`). Default-off in production,
 * so this hook is a no-op until the env flag is flipped.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.1.2.
 */
function commandRelayAuthHeader(): string | null {
  return tokenStorage.getAccessToken();
}

const isDev = process.env.NODE_ENV === "development";

// Production opt-in for the UI Bridge command relay. When this env var is
// set at build time (e.g. for staging deploys driven by /manual-test-coord),
// the CommandRelayListener mounts even though NODE_ENV is "production".
// Without it, production tabs never register with the bridge and any
// /control/* command fails with "No browser connected".
const remoteCommandsOptIn =
  process.env.NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS === "1";

/**
 * Feature configuration for UI Bridge
 * Render logging is always enabled for state discovery.
 */
const features: UIBridgeFeatures = {
  renderLog: true,
  control: true,
  debug: isDev,
};

/**
 * Configuration for UI Bridge
 */
const config: UIBridgeConfig = {
  verbose: isDev,
  maxLogEntries: 10, // Reduced from 1000 - each entry is a full DOM snapshot (several MB)
  captureChanges: false, // Disable DOM change tracking — causes memory leak (unbounded pendingChanges array)
};

const FLUSH_INTERVAL_MS = 5000;
const EVENTS_ENDPOINT = "/api/dev-debug/browser-events";
const PERF_EVENTS_ENDPOINT = "/api/dev-debug/perf-events";

/**
 * Browser capture configuration.
 * Enables performance-relevant captures: long tasks, long animation frames,
 * network failures, web vitals (LCP, CLS), and memory snapshots.
 */
const browserCaptureConfig: BrowserCaptureConfig = {
  console: true, // Capture console.error() for UI Bridge getConsoleErrors command
  network: true,
  navigation: true,
  longTasks: true,
  longAnimationFrames: false, // Disabled — large events (script attribution arrays), enable on-demand for profiling
  resourceErrors: true,
  wsDisconnections: true,
  hmr: false,
  webVitals: true,
  memory: true,
  memoryIntervalMs: 30000, // Relaxed from 15s — memory trends visible at 30s granularity
  freezeDetector: true,
  freezeIntervalMs: 1000, // Relaxed from 200ms — 3s freeze threshold doesn't need 200ms resolution
  freezeThresholdMs: 3000,
  domMetrics: true,
  domMetricsIntervalMs: 30000, // Relaxed from 10s — DOM node counts don't change fast enough for 10s
  maxEntries: 200, // Reduced from 500 — less memory in BrowserEventCapture's internal buffer
};

/**
 * Loads bundled page specs into the global SpecStore on mount so they are
 * returned by the /control/specs relay command.
 */
function BundledSpecsLoader() {
  const { specs } = useDiscoveredSpecs();
  React.useEffect(() => {
    if (specs.length === 0) return;
    const store = getGlobalSpecStore();
    for (const spec of specs) {
      // Cast config to satisfy SpecConfig's literal version type
      store.load(spec.specId, spec.config as Parameters<typeof store.load>[1]);
    }
    return () => {
      for (const spec of specs) {
        store.unload(spec.specId);
      }
    };
  }, [specs]);
  return null;
}

interface UIBridgeWrapperProps {
  children: React.ReactNode;
  /**
   * Enable remote command listening for automation.
   * Defaults to true in development, or in production when
   * NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1 is set at build time.
   */
  enableRemoteCommands?: boolean;
}

/**
 * UI Bridge Provider wrapper component.
 *
 * This wraps the application with UIBridgeProvider for state discovery.
 * Render logging is always enabled.
 *
 * Features:
 * - Automatic element registration via AutoRegisterProvider
 * - Remote command listening via WebSocket (primary) or HTTP polling (fallback)
 * - SWC plugin integration for compile-time instrumentation
 * - Browser event persistence to .dev-logs (dev only)
 */
export function UIBridgeWrapper({
  children,
  enableRemoteCommands = isDev || remoteCommandsOptIn,
}: UIBridgeWrapperProps) {
  const bufferRef = useRef<BridgeEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const perfBufferRef = useRef<AnyCapturedEvent[]>([]);
  const perfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timerRef.current = null;
    const batch = bufferRef.current;
    if (batch.length === 0) return;
    bufferRef.current = [];

    const body = JSON.stringify({ events: batch });

    // Use sendBeacon if available (more reliable during unload), else fetch
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        EVENTS_ENDPOINT,
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch(EVENTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  const flushPerf = useCallback(() => {
    perfTimerRef.current = null;
    const batch = perfBufferRef.current;
    if (batch.length === 0) return;
    perfBufferRef.current = [];

    const body = JSON.stringify({ events: batch });

    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        PERF_EVENTS_ENDPOINT,
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch(PERF_EVENTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  const onEvent = useCallback(
    (event: BridgeEvent) => {
      bufferRef.current.push(event);
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS);
      }
    },
    [flush]
  );

  const onBrowserEvent = useCallback(
    (event: AnyCapturedEvent) => {
      perfBufferRef.current.push(event);
      if (!perfTimerRef.current) {
        perfTimerRef.current = setTimeout(flushPerf, FLUSH_INTERVAL_MS);
      }
    },
    [flushPerf]
  );

  // Clear the JSONL files on mount (new session)
  const clearLogsMutation = useMutation({
    mutationFn: async () => {
      const headers = { "Content-Type": "application/json" };
      const body = JSON.stringify({ clear: true });
      await Promise.allSettled([
        fetch(EVENTS_ENDPOINT, { method: "POST", headers, body }),
        fetch(PERF_EVENTS_ENDPOINT, { method: "POST", headers, body }),
      ]);
    },
  });

  useEffect(() => {
    if (!isDev) return;
    clearLogsMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush remaining events on page unload
  useEffect(() => {
    if (!isDev) return;
    const handleUnload = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
      if (perfTimerRef.current) {
        clearTimeout(perfTimerRef.current);
        perfTimerRef.current = null;
      }
      flushPerf();
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      // Also flush on unmount
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
      if (perfTimerRef.current) {
        clearTimeout(perfTimerRef.current);
        perfTimerRef.current = null;
      }
      flushPerf();
    };
  }, [flush, flushPerf]);

  return (
    <UIBridgeProvider
      features={features}
      config={config}
      onEvent={isDev ? onEvent : undefined}
      onBrowserEvent={isDev ? onBrowserEvent : undefined}
      browserCaptureConfig={isDev ? browserCaptureConfig : undefined}
    >
      <BundledSpecsLoader />
      {/* AutoRegisterProvider enables automatic element registration for UI Bridge */}
      {/* All interactive elements (buttons, inputs, links, etc.) are auto-discovered */}
      <AutoRegisterProvider
        enabled={true}
        idStrategy="prefer-existing"
        debounceMs={100}
        excludeSelectors={["[data-no-register]"]}
        contentDiscovery={{ enabled: true, maxContentElements: 200 }}
      >
        {/* Command relay listener for remote automation via SSE.
            authHeader wires the session bearer into the SDK transport so
            the relay's session-bound auth gate (UI_BRIDGE_REQUIRE_AUTH=1)
            sees the token. Default-off — no-op when the gate is off. */}
        <CommandRelayListener
          enabled={enableRemoteCommands}
          authHeader={commandRelayAuthHeader}
        />
        <RouteAwarenessProvider>
          {children as Parameters<typeof AutoRegisterProvider>[0]["children"]}
        </RouteAwarenessProvider>
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
