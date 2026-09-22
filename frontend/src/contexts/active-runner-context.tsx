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
import {
  setRunnerTransport,
  RUNNER_API_BASE,
  type RunnerTransport,
} from "@/lib/runner/api-client";
import {
  loopbackBaseForPort,
  useRunnerLocality,
  type RunnerLocality,
} from "@/lib/runner/locality";

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
  /** Whether the runner list is loading, failed to load, or loaded. */
  listState: RunnerListState;
  /**
   * Measured locality of each runner, keyed by runner id — is it on the
   * machine this browser runs on? Absent = not measured yet (render unknown).
   */
  localityById: ReadonlyMap<string, RunnerLocality>;
}

const ActiveRunnerContext = createContext<ActiveRunnerContextValue | undefined>(
  undefined
);

// ============================================================================
// Helpers
// ============================================================================

const STORAGE_KEY = "qontinui:activeRunnerId";

/**
 * The loopback base URL for a runner, or null when it has none from this
 * browser. Only a runner PROVEN local (its port answered device-info with its
 * own id) gets one. There is deliberately no fallback to `RUNNER_API_BASE`:
 * for a runner on another machine that would reach whatever owns :9876 on
 * this box — the wrong-box defect (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 1).
 */
export function buildRunnerApiBase(
  runner: Runner,
  locality: RunnerLocality | undefined
): string | null {
  if (locality !== "local" || runner.port == null) return null;
  return loopbackBaseForPort(runner.port);
}

/**
 * The transport runner calls use for one runner: a loopback base only when it
 * is proven local, otherwise a typed refusal naming why.
 */
export function buildRunnerTransport(
  runner: Runner,
  locality: RunnerLocality | undefined
): RunnerTransport {
  const base = buildRunnerApiBase(runner, locality);
  if (base !== null) return { kind: "loopback", base };
  return {
    kind: "no_loopback",
    reason:
      locality === undefined
        ? "measuring"
        : locality === "not_local"
          ? "not_local"
          : "locality_unknown",
    runnerName: runner.name,
  };
}

const MEASURING: RunnerTransport = { kind: "no_loopback", reason: "measuring" };

export interface RunnerTargetResolution {
  /** The runner the UI shows as active (null when none is listed). */
  activeRunner: Runner | null;
  /** How runner calls reach it from this browser. */
  transport: RunnerTransport;
  /**
   * Set when auto-select chose a runner BECAUSE it is proven local — the
   * provider keeps it as the sticky auto-selection.
   */
  autoLocalId: string | null;
}

/**
 * The runner list's state. `failed` is a first load that errored: the list
 * is empty because nothing was read, not because there are no runners.
 */
export type RunnerListState = "loading" | "failed" | "loaded";

/**
 * Which runner is active, and the transport its calls use.
 *
 * - While the runner list is loading, nothing is known: `measuring`. (A
 *   stored selection may name a runner on another machine; the list has to
 *   arrive before anything may reach a loopback port.)
 * - A failed load is not an empty fleet: `list_unavailable`, never the
 *   default base.
 * - A loaded, genuinely empty list claims no runner: the default local base.
 * - An explicit selection that is listed is used as chosen.
 * - Otherwise (auto-select):
 *   - The sticky auto-selection (a runner previously auto-selected because
 *     it was proven local) stays active while it is listed, not measured
 *     `not_local`, and no OTHER listed runner is proven local — one
 *     inconclusive re-probe must not make the active runner jump to
 *     `runners[0]`, which may be another machine.
 *   - Else the first runner proven local wins. Until one is found, or every
 *     listed runner has been measured, the answer stays `measuring` — a
 *     remote `runners[0]` measured first must not refuse calls that a local
 *     runner still being probed would serve.
 */
export function resolveRunnerTarget({
  listState,
  runners,
  selectedId,
  stickyAutoId = null,
  localityById,
}: {
  listState: RunnerListState;
  runners: Runner[];
  selectedId: string | null;
  stickyAutoId?: string | null;
  localityById: ReadonlyMap<string, RunnerLocality>;
}): RunnerTargetResolution {
  if (listState === "loading") {
    return { activeRunner: null, transport: MEASURING, autoLocalId: null };
  }
  if (listState === "failed") {
    return {
      activeRunner: null,
      transport: { kind: "no_loopback", reason: "list_unavailable" },
      autoLocalId: null,
    };
  }
  if (runners.length === 0) {
    return {
      activeRunner: null,
      transport: { kind: "loopback", base: RUNNER_API_BASE },
      autoLocalId: null,
    };
  }

  const selected =
    selectedId === null ? undefined : runners.find((r) => r.id === selectedId);
  if (selected) {
    return {
      activeRunner: selected,
      transport: buildRunnerTransport(selected, localityById.get(selected.id)),
      autoLocalId: null,
    };
  }

  const sticky =
    stickyAutoId === null
      ? undefined
      : runners.find((r) => r.id === stickyAutoId);
  const stickyLocality =
    sticky === undefined ? undefined : localityById.get(sticky.id);
  // Stickiness bridges an inconclusive re-measure; it never outranks a
  // runner that IS proven local right now (e.g. a second runner on this box
  // while the sticky one is wedged).
  const anotherProvenLocal =
    sticky !== undefined &&
    stickyLocality !== "local" &&
    runners.some(
      (r) => r.id !== sticky.id && localityById.get(r.id) === "local"
    );
  if (sticky && stickyLocality !== "not_local" && !anotherProvenLocal) {
    const locality = stickyLocality;
    return {
      activeRunner: sticky,
      transport: buildRunnerTransport(sticky, locality),
      autoLocalId: locality === "local" ? sticky.id : null,
    };
  }

  const local = runners.find((r) => localityById.get(r.id) === "local");
  if (local) {
    return {
      activeRunner: local,
      transport: buildRunnerTransport(local, "local"),
      autoLocalId: local.id,
    };
  }
  const first = runners[0]!;
  const allMeasured = runners.every((r) => localityById.has(r.id));
  return {
    activeRunner: first,
    transport: allMeasured
      ? buildRunnerTransport(first, localityById.get(first.id))
      : MEASURING,
    autoLocalId: null,
  };
}

// ============================================================================
// Provider
// ============================================================================

export function ActiveRunnerProvider({ children }: { children: ReactNode }) {
  const {
    runners: allRunners,
    isLoading: listLoading,
    loaded: listLoaded,
    loadError: listLoadError,
  } = useRealtimeConnectionsContext();
  const listState: RunnerListState = listLoaded
    ? "loaded"
    : listLoading || listLoadError === null
      ? "loading"
      : "failed";
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

  // One locality measurement per runner, shared with the selector's dots.
  const localityById = useRunnerLocality(runners);

  // The runner auto-select last chose because it was proven local.
  const [stickyAutoId, setStickyAutoId] = useState<string | null>(null);

  // Resolve the active runner and the transport its calls use
  const { activeRunner, transport, autoLocalId } = resolveRunnerTarget({
    listState,
    runners,
    selectedId,
    stickyAutoId,
    localityById,
  });

  // Keep the sticky auto-selection current: adopt a newly auto-selected local
  // runner; drop one that left the (loaded) list or was measured not_local.
  useEffect(() => {
    if (autoLocalId !== null) {
      setStickyAutoId((prev) => (prev === autoLocalId ? prev : autoLocalId));
      return;
    }
    if (stickyAutoId === null || listState !== "loaded") return;
    const listed = runners.some((r) => r.id === stickyAutoId);
    if (!listed || localityById.get(stickyAutoId) === "not_local") {
      setStickyAutoId(null);
    }
  }, [autoLocalId, stickyAutoId, listState, runners, localityById]);

  // Sync the runner transport whenever it changes (setRunnerTransport
  // ignores a no-op change, so a fresh object per render is fine).
  useEffect(() => {
    setRunnerTransport(transport);
  }, [transport]);

  // Clear the selection when the selected runner disconnects — and only
  // then: it was listed and has left the list. An empty, loading or failed
  // list says nothing about the user's choice, so it never erases it. The
  // selection is dropped rather than moved to another runner: storing
  // `runners[0]` would turn a possibly-remote runner into a permanent
  // explicit choice. With no selection, auto-select picks a runner proven
  // local.
  useEffect(() => {
    if (listState !== "loaded") return;
    if (selectedId !== null && !runners.some((r) => r.id === selectedId)) {
      const wasConnected = prevRunnersRef.current.some(
        (r) => r.id === selectedId
      );
      if (wasConnected) {
        setSelectedId(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    prevRunnersRef.current = runners;
  }, [runners, selectedId, listState]);

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
    listState,
    localityById,
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
