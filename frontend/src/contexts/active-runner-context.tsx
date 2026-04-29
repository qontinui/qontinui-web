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
import type { Runner } from "@qontinui/shared-types";
import { useRealtimeConnectionsContext } from "@/contexts/realtime-connections-context";
import { setRunnerApiBase, RUNNER_API_BASE } from "@/lib/runner/api-client";

// ============================================================================
// Context Types
// ============================================================================

interface ActiveRunnerContextValue {
  /** The currently selected runner, or null if none available */
  activeRunner: Runner | null;
  /** All selectable runners (healthy or degraded) */
  runners: Runner[];
  /** Select a runner by id (UUID), or null to auto-select */
  selectRunner: (runnerId: string | null) => void;
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

function buildRunnerApiBase(runner: Runner): string {
  if (runner.port) {
    return `http://localhost:${runner.port}`;
  }
  return RUNNER_API_BASE; // fallback to default 9876
}

// ============================================================================
// Provider
// ============================================================================

export function ActiveRunnerProvider({ children }: { children: ReactNode }) {
  const { runners: allRunners } = useRealtimeConnectionsContext();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  // Track previous runners to detect disconnections
  const prevRunnersRef = useRef<Runner[]>([]);

  // Selectable runners: anything heartbeating (healthy or degraded). Fleet-
  // online runners that don't have a live WebSocket are still selectable
  // because the user may want to pick them and then health-check the port.
  const runners = useMemo(
    () =>
      allRunners.filter(
        (r) => r.derivedStatus === "healthy" || r.derivedStatus === "degraded"
      ),
    [allRunners]
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
      const wasConnected = prevRunnersRef.current.some(
        (r) => r.id === selectedId
      );
      if (wasConnected && runners.length > 0) {
        // Auto-select first available runner
        const fallbackId = runners[0]!.id;
        setSelectedId(fallbackId);
        localStorage.setItem(STORAGE_KEY, fallbackId);
      } else if (runners.length === 0) {
        setSelectedId(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    prevRunnersRef.current = runners;
  }, [runners, selectedId]);

  const selectRunner = useCallback((runnerId: string | null) => {
    setSelectedId(runnerId);
    if (runnerId !== null) {
      localStorage.setItem(STORAGE_KEY, runnerId);
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
  runners: Runner[],
  selectedId: string | null
): Runner | null {
  if (runners.length === 0) return null;

  // If a runner is explicitly selected and still connected, use it
  if (selectedId !== null) {
    const selected = runners.find((r) => r.id === selectedId);
    if (selected) return selected;
  }

  // Auto-select first runner
  return runners[0] ?? null;
}
