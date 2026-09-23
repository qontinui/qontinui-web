"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  isRunnerNeedsLocalError,
  runnerRequest,
  startRunnerPoll,
  type RunnerTarget,
} from "@/lib/runner";

/** How often SDK snapshots are captured while recording (runner cadence). */
const SNAPSHOT_POLL_INTERVAL_MS = 2000;

/**
 * Discovered SDK app from the runner's port scanner.
 * Maps to the runner's DiscoveredApp struct (camelCase).
 */
export interface SDKApp {
  appId: string;
  appName: string;
  appType: string;
  framework?: string;
  url: string;
  port: number;
  basePath: string;
  version?: string;
  capabilities: string[];
  elementCount?: number;
  componentCount?: number;
  discoveredAt: number;
}

/**
 * Connected SDK app info.
 */
export interface SDKConnection {
  url: string;
  app: {
    appId: string;
    appName: string;
    appType: string;
    framework?: string;
    version?: string;
    capabilities: string[];
    port: number;
  };
  connectedAt: number;
  isActive: boolean;
}

/**
 * SDK control snapshot element (from ControlSnapshot).
 */
interface SDKSnapshotElement {
  id: string;
  type: string;
  label?: string;
  actions: string[];
  state: Record<string, unknown>;
  category?: "interactive" | "content";
  contentMetadata?: Record<string, unknown>;
}

/**
 * Parsed SDK snapshot data (the inner data object).
 */
export interface SDKSnapshotData {
  timestamp: number;
  elements: SDKSnapshotElement[];
  components: Array<{ id: string; name: string; actions: string[] }>;
  workflows?: Array<{ id: string; name: string; stepCount: number }>;
}

/**
 * SDK control snapshot response.
 */
export interface SDKSnapshot {
  success: boolean;
  data?: SDKSnapshotData;
  error?: string;
}

/**
 * Hook for discovering and connecting to SDK-enabled apps via the runner.
 *
 * Replaces the old extension-based browser tab discovery with:
 * - Port scanning to find SDK-enabled apps
 * - Direct HTTP connection to SDK apps
 * - Snapshot capture for recording
 *
 * The runner is named by `target` (null = none selected) and every call goes
 * through the resolver: loopback only when the runner is proven local, the
 * relay otherwise. The relay does not carry these routes, so for a runner on
 * another machine the hook reports `needsLocalError` — the typed "needs the
 * runner on this machine" message — instead of failing silently.
 */
export function useSDKApps(target: RunnerTarget | null) {
  const [apps, setApps] = useState<SDKApp[]>([]);
  const [connections, setConnections] = useState<SDKConnection[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [activeApp, setActiveApp] = useState<SDKConnection | null>(null);

  // Recording state
  const [snapshots, setSnapshots] = useState<SDKSnapshotData[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  // Stops the running snapshot poll (startRunnerPoll's stop function).
  const pollingRef = useRef<(() => void) | null>(null);
  // The typed RUNNER_NEEDS_LOCAL message, when the relay refused a call.
  const [needsLocalError, setNeedsLocalError] = useState<string | null>(null);

  // A different runner: its refusal no longer applies.
  useEffect(() => {
    setNeedsLocalError(null);
  }, [target]);

  // Clean up polling on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      pollingRef.current?.();
    };
  }, []);

  /** Record a relay refusal; true when `err` was one. */
  const noteNeedsLocal = useCallback((err: unknown): boolean => {
    if (!isRunnerNeedsLocalError(err)) return false;
    setNeedsLocalError((err as Error).message);
    return true;
  }, []);

  /**
   * Scan for SDK-enabled apps on common dev ports.
   * Tries the combined scan first, falls back to web-only scan if empty.
   */
  const scanForApps = useCallback(async () => {
    if (!target) return;
    setIsScanning(true);
    try {
      // Try combined scan first
      const res = await runnerRequest(target, "/ui-bridge/apps/scan", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Scan failed");
      const data = await res.json();
      const result = data.data ?? data;
      let allApps: SDKApp[] = [
        ...(result.web ?? []),
        ...(result.desktop ?? []),
      ];

      // Fallback: if combined scan returned empty, try web-only scan
      if (allApps.length === 0) {
        const webRes = await runnerRequest(target, "/ui-bridge/apps/scan/web");
        if (webRes.ok) {
          const webData = await webRes.json();
          allApps = webData.data ?? webData;
        }
      }

      setApps(allApps);
      if (allApps.length === 0) {
        toast.info("No SDK-enabled apps found");
      }
    } catch (err) {
      if (noteNeedsLocal(err)) return;
      const msg = err instanceof Error ? err.message : "Scan failed";
      toast.error(msg);
    } finally {
      setIsScanning(false);
    }
  }, [target, noteNeedsLocal]);

  /**
   * Refresh the list of active SDK connections.
   */
  const refreshConnections = useCallback(async () => {
    if (!target) return;
    try {
      const res = await runnerRequest(target, "/ui-bridge/sdk/connections");
      if (!res.ok) return;
      const data = await res.json();
      const conns: SDKConnection[] = data.data ?? data;
      setConnections(conns);
      const active = conns.find((c) => c.isActive) ?? null;
      setActiveApp(active);
    } catch (err) {
      // A relay refusal is shown; any other failure leaves the list as is.
      noteNeedsLocal(err);
    }
  }, [target, noteNeedsLocal]);

  /**
   * Connect to a specific SDK app.
   */
  const connectToApp = useCallback(
    async (appUrl: string) => {
      if (!target) return;
      setIsConnecting(true);
      try {
        const res = await runnerRequest(target, "/ui-bridge/sdk/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: appUrl }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Connection failed");
        }
        // Refresh connections to get updated state
        await refreshConnections();
        toast.success("Connected to SDK app");
      } catch (err) {
        if (noteNeedsLocal(err)) return;
        const msg = err instanceof Error ? err.message : "Connection failed";
        toast.error(msg);
      } finally {
        setIsConnecting(false);
      }
    },
    [target, refreshConnections, noteNeedsLocal]
  );

  /**
   * Switch the active SDK connection.
   */
  const switchActive = useCallback(
    async (appUrl: string) => {
      if (!target) return;
      try {
        const res = await runnerRequest(target, "/ui-bridge/sdk/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: appUrl }),
        });
        if (res.ok) {
          await refreshConnections();
        }
      } catch (err) {
        if (noteNeedsLocal(err)) return;
        toast.error("Failed to switch active app");
      }
    },
    [target, refreshConnections, noteNeedsLocal]
  );

  /**
   * Capture a single SDK snapshot from the active app. Throws a typed
   * RUNNER_NEEDS_LOCAL error (the relay refused the path); any other failure
   * yields null.
   */
  const fetchSnapshot =
    useCallback(async (): Promise<SDKSnapshotData | null> => {
      if (!target) return null;
      try {
        const res = await runnerRequest(target, "/ui-bridge/sdk/snapshot");
        if (!res.ok) return null;
        const data: SDKSnapshot = await res.json();
        if (data.success === false || !data.data) return null;
        return data.data;
      } catch (err) {
        if (isRunnerNeedsLocalError(err)) throw err;
        return null;
      }
    }, [target]);

  /**
   * Capture a single SDK snapshot from the active app (null on any failure;
   * a relay refusal is recorded in `needsLocalError`).
   */
  const captureSnapshot =
    useCallback(async (): Promise<SDKSnapshotData | null> => {
      try {
        return await fetchSnapshot();
      } catch (err) {
        noteNeedsLocal(err);
        return null;
      }
    }, [fetchSnapshot, noteNeedsLocal]);

  /**
   * Start recording — periodically capture SDK snapshots, at the runner
   * poll cadence for the target's route (re-evaluated every tick). Stops for
   * good, with `needsLocalError` set, when the relay refuses the path.
   */
  const startRecording = useCallback(
    (intervalMs: number = SNAPSHOT_POLL_INTERVAL_MS) => {
      if (isRecording || !target) return;
      setSnapshots([]);
      setIsRecording(true);

      pollingRef.current = startRunnerPoll({
        getTarget: () => target,
        requestedMs: intervalMs,
        immediate: true,
        tick: async () => {
          const snap = await fetchSnapshot();
          if (snap) {
            setSnapshots((prev) => [...prev, snap]);
          }
        },
        onNeedsLocal: (err) => {
          pollingRef.current = null;
          setIsRecording(false);
          setNeedsLocalError(err.message);
        },
      });
    },
    [isRecording, target, fetchSnapshot]
  );

  /**
   * Capture a single snapshot during recording.
   */
  const captureNow = useCallback(async () => {
    const snap = await captureSnapshot();
    if (snap) {
      setSnapshots((prev) => [...prev, snap]);
    }
  }, [captureSnapshot]);

  /**
   * Stop recording.
   */
  const stopRecording = useCallback(() => {
    pollingRef.current?.();
    pollingRef.current = null;
    setIsRecording(false);
  }, []);

  /**
   * Convert captured SDK snapshots to render log format for state discovery.
   */
  const getSnapshotsAsRenderLogs = useCallback(() => {
    const appUrl = activeApp?.url ?? "unknown";
    return snapshots.map((snap, i) => ({
      id: `sdk-snapshot-${i}-${snap.timestamp}`,
      type: "dom_snapshot",
      page_url: appUrl,
      snapshot: {
        root: {
          elements: snap.elements.map((el) => ({
            id: el.id,
            tagName: el.type,
            textContent: el.label ?? null,
            attributes: {
              class: null,
              type: el.type,
              role: el.category ?? null,
              ariaLabel: el.label ?? null,
              href: null,
              name: el.id,
              placeholder: null,
            },
            bbox: { x: 0, y: 0, width: 0, height: 0 },
            isVisible: (el.state as { visible?: boolean })?.visible !== false,
            isEnabled: (el.state as { disabled?: boolean })?.disabled !== true,
            value: (el.state as { value?: string })?.value ?? null,
          })),
          url: appUrl,
          title: activeApp?.app.appName ?? "SDK App",
        },
      },
      timestamp: snap.timestamp,
      trigger: i === 0 ? "initial" : "manual",
    }));
  }, [snapshots, activeApp]);

  /**
   * Reset recording state.
   */
  const resetRecording = useCallback(() => {
    stopRecording();
    setSnapshots([]);
  }, [stopRecording]);

  return {
    // App discovery
    apps,
    isScanning,
    scanForApps,

    // Connections
    connections,
    isConnecting,
    activeApp,
    connectToApp,
    switchActive,
    refreshConnections,

    // The typed "needs the runner on this machine" message (RUNNER_NEEDS_LOCAL)
    needsLocalError,

    // Snapshot capture
    captureSnapshot,

    // Recording
    snapshots,
    isRecording,
    startRecording,
    stopRecording,
    captureNow,
    getSnapshotsAsRenderLogs,
    resetRecording,
  };
}
