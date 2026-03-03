"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { RunnerConnection } from "@/types/runner";
import { useRealtimeConnectionsContext } from "@/contexts/realtime-connections-context";
import { setRunnerApiBase, RUNNER_API_BASE } from "@/lib/runner/api-client";

// ============================================================================
// Context Types
// ============================================================================

interface ActiveRunnerContextValue {
  /** The currently selected runner, or null if none available */
  activeRunner: RunnerConnection | null;
  /** All connected runners */
  runners: RunnerConnection[];
  /** Select a runner by connection ID, or null to auto-select */
  selectRunner: (connectionId: number | null) => void;
  /** Whether multiple runners are connected */
  isMultiRunner: boolean;
}

const ActiveRunnerContext = createContext<ActiveRunnerContextValue | undefined>(
  undefined
);

// ============================================================================
// Helpers
// ============================================================================

const STORAGE_KEY = "qontinui:activeRunnerId";

function buildRunnerApiBase(runner: RunnerConnection): string {
  if (runner.runner_port) {
    return `http://localhost:${runner.runner_port}`;
  }
  return RUNNER_API_BASE; // fallback to default 9876
}

// ============================================================================
// Provider
// ============================================================================

export function ActiveRunnerProvider({ children }: { children: ReactNode }) {
  const { connections } = useRealtimeConnectionsContext();
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return Number.isNaN(parsed) ? null : parsed;
  });

  // Track previous connections to detect disconnections
  const prevConnectionsRef = useRef<RunnerConnection[]>([]);

  // Only consider runners that are WebSocket-connected
  const runners = useMemo(
    () => connections.filter((c) => c.ws_connected),
    [connections]
  );

  // Resolve the active runner
  const activeRunner = resolveActiveRunner(runners, selectedId);

  // Sync the API base URL whenever the active runner changes
  const prevBaseRef = useRef<string>(RUNNER_API_BASE);
  useEffect(() => {
    const newBase = activeRunner
      ? buildRunnerApiBase(activeRunner)
      : RUNNER_API_BASE;
    if (newBase !== prevBaseRef.current) {
      setRunnerApiBase(newBase);
      prevBaseRef.current = newBase;
    }
  }, [activeRunner]);

  // Auto-select fallback when selected runner disconnects
  useEffect(() => {
    if (selectedId !== null && !runners.some((r) => r.id === selectedId)) {
      // Selected runner is gone — check if it was previously connected
      const wasConnected = prevConnectionsRef.current.some(
        (r) => r.id === selectedId
      );
      if (wasConnected && runners.length > 0) {
        // Auto-select first available runner
        const fallbackId = runners[0]!.id;
        setSelectedId(fallbackId);
        localStorage.setItem(STORAGE_KEY, String(fallbackId));
      } else if (runners.length === 0) {
        setSelectedId(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    prevConnectionsRef.current = runners;
  }, [runners, selectedId]);

  const selectRunner = useCallback((connectionId: number | null) => {
    setSelectedId(connectionId);
    if (connectionId !== null) {
      localStorage.setItem(STORAGE_KEY, String(connectionId));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value: ActiveRunnerContextValue = {
    activeRunner,
    runners,
    selectRunner,
    isMultiRunner: runners.length > 1,
  };

  return (
    <ActiveRunnerContext.Provider value={value}>
      {children}
    </ActiveRunnerContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useActiveRunner() {
  const context = useContext(ActiveRunnerContext);
  if (context === undefined) {
    throw new Error(
      "useActiveRunner must be used within an ActiveRunnerProvider"
    );
  }
  return context;
}

// ============================================================================
// Internal
// ============================================================================

function resolveActiveRunner(
  runners: RunnerConnection[],
  selectedId: number | null
): RunnerConnection | null {
  if (runners.length === 0) return null;

  // If a runner is explicitly selected and still connected, use it
  if (selectedId !== null) {
    const selected = runners.find((r) => r.id === selectedId);
    if (selected) return selected;
  }

  // Auto-select first runner
  return runners[0] ?? null;
}
