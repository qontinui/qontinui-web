"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";

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
 */
export function useSDKApps(runnerUrl: string | null) {
  const [apps, setApps] = useState<SDKApp[]>([]);
  const [connections, setConnections] = useState<SDKConnection[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [activeApp, setActiveApp] = useState<SDKConnection | null>(null);

  // Recording state
  const [snapshots, setSnapshots] = useState<SDKSnapshotData[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up polling interval on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  /**
   * Scan for SDK-enabled apps on common dev ports.
   */
  const scanForApps = useCallback(async () => {
    if (!runnerUrl) return;
    setIsScanning(true);
    try {
      const res = await fetch(`${runnerUrl}/ui-bridge/apps/scan`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Scan failed");
      const data = await res.json();
      const result = data.data ?? data;
      const allApps: SDKApp[] = [
        ...(result.web ?? []),
        ...(result.desktop ?? []),
      ];
      setApps(allApps);
      if (allApps.length === 0) {
        toast.info("No SDK-enabled apps found");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      toast.error(msg);
    } finally {
      setIsScanning(false);
    }
  }, [runnerUrl]);

  /**
   * Refresh the list of active SDK connections.
   */
  const refreshConnections = useCallback(async () => {
    if (!runnerUrl) return;
    try {
      const res = await fetch(`${runnerUrl}/ui-bridge/sdk/connections`);
      if (!res.ok) return;
      const data = await res.json();
      const conns: SDKConnection[] = data.data ?? data;
      setConnections(conns);
      const active = conns.find((c) => c.isActive) ?? null;
      setActiveApp(active);
    } catch {
      // silently fail
    }
  }, [runnerUrl]);

  /**
   * Connect to a specific SDK app.
   */
  const connectToApp = useCallback(
    async (appUrl: string) => {
      if (!runnerUrl) return;
      setIsConnecting(true);
      try {
        const res = await fetch(`${runnerUrl}/ui-bridge/sdk/connect`, {
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
        const msg = err instanceof Error ? err.message : "Connection failed";
        toast.error(msg);
      } finally {
        setIsConnecting(false);
      }
    },
    [runnerUrl, refreshConnections]
  );

  /**
   * Switch the active SDK connection.
   */
  const switchActive = useCallback(
    async (appUrl: string) => {
      if (!runnerUrl) return;
      try {
        const res = await fetch(`${runnerUrl}/ui-bridge/sdk/switch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: appUrl }),
        });
        if (res.ok) {
          await refreshConnections();
        }
      } catch {
        toast.error("Failed to switch active app");
      }
    },
    [runnerUrl, refreshConnections]
  );

  /**
   * Capture a single SDK snapshot from the active app.
   */
  const captureSnapshot = useCallback(async (): Promise<SDKSnapshotData | null> => {
    if (!runnerUrl) return null;
    try {
      const res = await fetch(`${runnerUrl}/ui-bridge/sdk/snapshot`);
      if (!res.ok) return null;
      const data: SDKSnapshot = await res.json();
      if (data.success === false || !data.data) return null;
      return data.data;
    } catch {
      return null;
    }
  }, [runnerUrl]);

  /**
   * Start recording — periodically capture SDK snapshots.
   */
  const startRecording = useCallback(
    (intervalMs: number = 2000) => {
      if (isRecording) return;
      setSnapshots([]);
      setIsRecording(true);

      const poll = async () => {
        const snap = await captureSnapshot();
        if (snap) {
          setSnapshots((prev) => [...prev, snap]);
        }
      };

      // Capture immediately
      poll();

      pollingRef.current = setInterval(poll, intervalMs);
    },
    [isRecording, captureSnapshot]
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
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
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
