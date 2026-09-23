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
import { useRunnerLocality, type RunnerLocality } from "@/lib/runner/locality";
import {
  NO_RUNNER_TARGET,
  targetKey,
  type RunnerTarget,
} from "@/lib/runner/target";

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
  /**
   * The runner every runner call in this tree targets, resolved per request
   * into loopback (proven local) or the relay (any other listed runner).
   * Referentially stable while it does not change.
   */
  target: RunnerTarget;
}

const ActiveRunnerContext = createContext<ActiveRunnerContextValue | undefined>(
  undefined
);

// ============================================================================
// Helpers
// ============================================================================

const STORAGE_KEY = "qontinui:activeRunnerId";

/** The target for one listed runner, carrying its measured locality. */
export function buildRunnerTarget(
  runner: Runner,
  locality: RunnerLocality | undefined
): RunnerTarget {
  return {
    kind: "runner",
    runner: { id: runner.id, port: runner.port, name: runner.name },
    locality,
  };
}

function pendingTarget(runner?: Runner): RunnerTarget {
  return runner
    ? { kind: "pending", runnerName: runner.name }
    : { kind: "pending" };
}

export interface RunnerTargetResolution {
  /** The runner the UI shows as active (null when none is listed). */
  activeRunner: Runner | null;
  /** What runner calls target. */
  target: RunnerTarget;
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
 * Which runner is active, and the target its calls use.
 *
 * - While the runner list is loading, nothing is known: `pending`. (A
 *   stored selection may name a runner on another machine; the list has to
 *   arrive before anything may reach a loopback port.)
 * - A failed load is not an empty fleet: `list_unavailable`, never the
 *   default base.
 * - A loaded, genuinely empty list claims no runner: the default local base.
 * - An explicit selection that is listed is used as chosen — over loopback if
 *   proven local, over the relay otherwise.
 * - A sole listed runner is unambiguous: it is the target even when it is not
 *   proven local (on a production origin nothing ever is), reached over the
 *   relay.
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
    return { activeRunner: null, target: pendingTarget(), autoLocalId: null };
  }
  if (listState === "failed") {
    return {
      activeRunner: null,
      target: { kind: "unavailable", reason: "list_unavailable" },
      autoLocalId: null,
    };
  }
  if (runners.length === 0) {
    return {
      activeRunner: null,
      target: { kind: "default_local" },
      autoLocalId: null,
    };
  }

  const selected =
    selectedId === null ? undefined : runners.find((r) => r.id === selectedId);
  if (selected) {
    return {
      activeRunner: selected,
      target: buildRunnerTarget(selected, localityById.get(selected.id)),
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
      target: buildRunnerTarget(sticky, locality),
      autoLocalId: locality === "local" ? sticky.id : null,
    };
  }

  const local = runners.find((r) => localityById.get(r.id) === "local");
  if (local) {
    return {
      activeRunner: local,
      target: buildRunnerTarget(local, "local"),
      autoLocalId: local.id,
    };
  }
  const first = runners[0]!;
  const allMeasured = runners.every((r) => localityById.has(r.id));
  if (!allMeasured) {
    return {
      activeRunner: first,
      target: pendingTarget(first),
      autoLocalId: null,
    };
  }
  // Every runner measured, none proven local. A sole runner is the user's
  // only choice; among several, picking `runners[0]` would send work to a
  // machine the user did not pick (plan D2), so they must choose.
  return {
    activeRunner: first,
    target:
      runners.length === 1
        ? buildRunnerTarget(first, localityById.get(first.id))
        : { kind: "unavailable", reason: "selection_required" },
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

  // Resolve the active runner and the target its calls use
  const {
    activeRunner,
    target: resolvedTarget,
    autoLocalId,
  } = resolveRunnerTarget({
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

  // Waiters for a non-pending target: a call made while the target is
  // pending waits (bounded) for the provider to resolve one, instead of
  // failing on page load. Provider-instance state, handed out explicitly on
  // the pending target — not a module global.
  const latestTargetRef = useRef<RunnerTarget>(resolvedTarget);
  const waitersRef = useRef(new Set<(t: RunnerTarget) => void>());
  const settle = useCallback(
    (timeoutMs: number) =>
      new Promise<RunnerTarget>((resolve) => {
        const current = latestTargetRef.current;
        if (current.kind !== "pending") {
          resolve(current);
          return;
        }
        const waiter = (t: RunnerTarget) => {
          clearTimeout(timer);
          resolve(t);
        };
        const timer = setTimeout(() => {
          waitersRef.current.delete(waiter);
          const now = latestTargetRef.current;
          // Still pending: resolve with a settle-less copy so the caller
          // refuses instead of waiting again.
          resolve(now.kind === "pending" ? { ...now, settle: undefined } : now);
        }, timeoutMs);
        waitersRef.current.add(waiter);
      }),
    []
  );

  // One stable object per target+route (plus the runner's name), so effects
  // and callbacks keyed on the target re-run only when it really changes.
  const resolvedKey = `${targetKey(resolvedTarget)}|${
    resolvedTarget.kind === "runner"
      ? `${resolvedTarget.runner.name ?? ""}:${resolvedTarget.locality ?? ""}`
      : resolvedTarget.kind === "pending"
        ? (resolvedTarget.runnerName ?? "")
        : ""
  }`;
  const target = useMemo<RunnerTarget>(
    () =>
      resolvedTarget.kind === "pending"
        ? { ...resolvedTarget, settle }
        : resolvedTarget,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content
    [resolvedKey, settle]
  );

  useEffect(() => {
    latestTargetRef.current = target;
    if (target.kind === "pending") return;
    const waiters = [...waitersRef.current];
    waitersRef.current.clear();
    waiters.forEach((w) => w(target));
  }, [target]);

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
    target,
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

/**
 * The target for runner calls in this tree: pass it to runnerFetch /
 * runnerRequest / useRunnerQuery / useRunnerMutation. Outside an
 * ActiveRunnerProvider it is a pending target that nothing will resolve, so
 * calls refuse (RUNNER_LOCALITY_UNKNOWN) rather than guess a port.
 */
export function useRunnerTarget(): RunnerTarget {
  const context = useContext(ActiveRunnerContext);
  return context?.target ?? NO_RUNNER_TARGET;
}

export function useActiveRunner() {
  const context = useContext(ActiveRunnerContext);
  if (context === undefined) {
    throw new Error(
      "useActiveRunner must be used within an ActiveRunnerProvider"
    );
  }
  return context;
}
