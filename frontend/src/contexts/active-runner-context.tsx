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
import type { ResolvedRunnerState } from "@/lib/runner/resolve";
import { useResolvedRunner } from "@/lib/runner/use-resolved-runner";

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
  /**
   * `explicit` — the user chose the active runner; `auto` — coord's resolver
   * did (or, while it is UNKNOWN, the last runner it resolved).
   */
  selection: "explicit" | "auto";
  /**
   * Coord's latest answer for this tree's `placeable` work, with the explicit
   * selection (if any) as the pin. `unavailable` = UNKNOWN.
   */
  resolution: ResolvedRunnerState;
  /** Where NEW work goes (see `dispatchTargetFrom`). */
  dispatch: DispatchTarget;
}

const ActiveRunnerContext = createContext<ActiveRunnerContextValue | undefined>(
  undefined
);

// ============================================================================
// Helpers
// ============================================================================

const STORAGE_KEY = "qontinui:activeRunnerId";

/** This tree's runner calls need no particular capability (library, results, AI). */
const NO_CAPABILITIES: readonly string[] = [];

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
}

/**
 * The runner list's state. `failed` is a first load that errored: the list
 * is empty because nothing was read, not because there are no runners.
 */
export type RunnerListState = "loading" | "failed" | "loaded";

function targetForDevice(
  deviceId: string,
  runners: Runner[],
  localityById: ReadonlyMap<string, RunnerLocality>
): RunnerTargetResolution {
  const listed = runners.find((r) => r.id === deviceId);
  if (listed) {
    return {
      activeRunner: listed,
      target: buildRunnerTarget(listed, localityById.get(listed.id)),
    };
  }
  // Coord named a device the list has not caught up with. It is addressed by
  // its device id through the relay — which reaches only that device — and
  // never over a guessed loopback port.
  return {
    activeRunner: null,
    target: {
      kind: "runner",
      runner: { id: deviceId },
      locality: "unknown",
    },
  };
}

function listedTarget(
  runner: Runner,
  localityById: ReadonlyMap<string, RunnerLocality>
): RunnerTargetResolution {
  return {
    activeRunner: runner,
    target: buildRunnerTarget(runner, localityById.get(runner.id)),
  };
}

/**
 * Which runner is active, and the target its calls use.
 *
 * This is the READ target: what reads, library CRUD, settings, and actions
 * on EXISTING work (stop / resume a run, answer its questions, load an
 * existing chat) talk to. It deliberately keeps a runner through coord
 * outages and "nothing eligible" answers, so it is NOT a decision to start
 * new work there.
 *
 * Every surface that STARTS work — run a workflow / check / macro / shell
 * command / test, start an exploration or recording, AI generation, a new
 * chat or AI session, create a scheduled task, dispatch to a runner — takes
 * the NEW-WORK target instead: `useDispatchTarget()` (the id),
 * `useDispatchRunnerTarget()` (a RunnerTarget for runner calls) or
 * `useDispatchRunnerApi()`. It is the explicit selection or a `resolved`
 * coord answer only; otherwise the action is disabled and coord's outcome is
 * shown.
 *
 * - While the runner list is loading, nothing is known: `pending`. (A
 *   stored selection may name a runner on another machine; the list has to
 *   arrive before anything may reach a loopback port.)
 * - A failed load is not an empty fleet: `list_unavailable`, never the
 *   default base.
 * - A loaded, genuinely empty list claims no runner: the default local base.
 * - An explicit selection that is listed is used as chosen — over loopback if
 *   proven local, over the relay otherwise.
 * - Otherwise COORD chooses (plan D1): `resolved` → that device.
 * - Coord has not answered yet (`loading`): a SOLE listed runner is the
 *   target (the only runner there is — not an order-based pick); with
 *   several, `pending` until coord answers.
 * - Coord answered without a device — UNKNOWN (`unavailable`,
 *   `drain_unreadable`) or "nothing eligible for new work" (`no_capable`,
 *   `all_drained`, `pin_ineligible`). Reads must not blank (plan risk; an
 *   own machine that is drained still serves its library and results), so
 *   the target falls back, in order, to: the LAST device coord resolved
 *   (while listed); a runner PROVEN on this machine by its identity probe;
 *   the SOLE listed runner. Failing all three: `pending` while localities
 *   are still being measured, then `no_eligible_runner` /
 *   `resolver_unavailable`.
 * - It is NEVER `runners[0]` of several — list order is "newest paired
 *   device", the arbitrary policy this plan removes.
 */
export function resolveRunnerTarget({
  listState,
  runners,
  selectedId,
  localityById,
  resolution,
  lastResolvedId = null,
}: {
  listState: RunnerListState;
  runners: Runner[];
  selectedId: string | null;
  localityById: ReadonlyMap<string, RunnerLocality>;
  resolution: ResolvedRunnerState;
  lastResolvedId?: string | null;
}): RunnerTargetResolution {
  if (listState === "loading") {
    return { activeRunner: null, target: pendingTarget() };
  }
  if (listState === "failed") {
    return {
      activeRunner: null,
      target: { kind: "unavailable", reason: "list_unavailable" },
    };
  }
  if (runners.length === 0) {
    return { activeRunner: null, target: { kind: "default_local" } };
  }

  const selected =
    selectedId === null ? undefined : runners.find((r) => r.id === selectedId);
  if (selected) return listedTarget(selected, localityById);

  const sole = runners.length === 1 ? runners[0] : undefined;
  if (resolution.status === "resolved") {
    return targetForDevice(resolution.deviceId, runners, localityById);
  }
  if (resolution.status === "loading") {
    return sole
      ? listedTarget(sole, localityById)
      : { activeRunner: null, target: pendingTarget() };
  }

  const last =
    lastResolvedId === null
      ? undefined
      : runners.find((r) => r.id === lastResolvedId);
  if (last) return listedTarget(last, localityById);
  const provenLocal = runners.find((r) => localityById.get(r.id) === "local");
  if (provenLocal) return listedTarget(provenLocal, localityById);
  if (sole) return listedTarget(sole, localityById);
  if (!runners.every((r) => localityById.has(r.id))) {
    return { activeRunner: null, target: pendingTarget() };
  }
  const nothingEligible =
    resolution.status === "no_capable" ||
    resolution.status === "all_drained" ||
    resolution.status === "pin_ineligible";
  return {
    activeRunner: null,
    target: {
      kind: "unavailable",
      reason: nothingEligible ? "no_eligible_runner" : "resolver_unavailable",
    },
  };
}

// ============================================================================
// Dispatch target — where NEW work goes
// ============================================================================

/**
 * Why the dispatch target is what it is. `explicit` / `resolved` carry a
 * runner; every other reason carries none.
 */
export type DispatchTargetReason =
  | "explicit"
  | "resolved"
  | "no_provider"
  | "list_loading"
  | "list_unavailable"
  | "no_runner"
  | "resolving"
  | "resolver_unavailable"
  | "drain_unreadable"
  | "no_capable"
  | "all_drained"
  | "pin_ineligible";

export interface DispatchTarget {
  /** The runner new work goes to, or null when none may be chosen. */
  runnerId: string | null;
  reason: DispatchTargetReason;
  /** What to tell the user when `runnerId` is null. */
  message: string | null;
}

function refused(
  reason: Exclude<DispatchTargetReason, "explicit" | "resolved">,
  message: string
): DispatchTarget {
  return { runnerId: null, reason, message };
}

/**
 * Where NEW work goes — the ONE place the rule lives: the user's explicit
 * selection, or the device coord RESOLVED for this user (capability-checked,
 * heartbeat-fresh, drain-filtered). Never the read target's fallbacks (the
 * last known runner, a proven-local one, the sole one): those keep reads
 * alive through an outage, but a drained or unverified runner must not be
 * handed new work. Anything else is refused with coord's outcome.
 */
export function dispatchTargetFrom({
  listState,
  runners,
  selectedId,
  resolution,
}: {
  listState: RunnerListState;
  runners: readonly Runner[];
  selectedId: string | null;
  resolution: ResolvedRunnerState;
}): DispatchTarget {
  if (listState === "loading") {
    return refused("list_loading", "Loading runners…");
  }
  if (listState === "failed") {
    return refused(
      "list_unavailable",
      "The runner list could not be loaded, so no runner can be chosen."
    );
  }
  if (runners.length === 0) {
    return refused("no_runner", "No runner is paired. Connect a runner first.");
  }
  if (selectedId !== null && runners.some((r) => r.id === selectedId)) {
    return { runnerId: selectedId, reason: "explicit", message: null };
  }
  switch (resolution.status) {
    case "resolved":
      return {
        runnerId: resolution.deviceId,
        reason: "resolved",
        message: null,
      };
    case "loading":
      return refused("resolving", "Choosing a runner…");
    case "unavailable":
      return refused(
        "resolver_unavailable",
        "Which runner should take new work is unknown — the device resolver did not answer. Choose a runner in the runner selector, or retry."
      );
    case "drain_unreadable":
      return refused(
        "drain_unreadable",
        "Coord could not read which runners are drained, so it names none. Retry shortly, or choose a runner."
      );
    case "no_capable":
      return refused(
        "no_capable",
        "None of your runners is online and able to take new work."
      );
    case "all_drained":
      return refused(
        "all_drained",
        "All your runners are drained — taken out of service for new work."
      );
    case "pin_ineligible":
      return refused("pin_ineligible", resolution.detail);
  }
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

  // Coord resolves the target for this tree's (placeable) work. The pin is
  // the user's explicit selection; with none, it is the last device coord
  // chose AUTOMATICALLY (so equally eligible runners do not trade places on
  // every re-ask). An explicit choice never becomes the automatic pin:
  // clearing it returns to coord's free choice. The two modes are separate
  // questions to the hook, so an answer given for one is never read as the
  // other's.
  const selectedListed =
    selectedId !== null && runners.some((r) => r.id === selectedId);
  const runnerIdsKey = runners
    .map((r) => r.id)
    .sort()
    .join(",");
  const [autoPin, setAutoPin] = useState<string | null>(null);
  const { state: resolution, lastResolvedDeviceId } = useResolvedRunner({
    capabilities: NO_CAPABILITIES,
    workClass: "placeable",
    preferred: selectedListed ? selectedId : autoPin,
    scope: selectedListed ? "explicit" : "auto",
    enabled: listState === "loaded" && runners.length > 0,
    refreshKey: runnerIdsKey,
  });
  useEffect(() => {
    if (!selectedListed && lastResolvedDeviceId !== null) {
      setAutoPin(lastResolvedDeviceId);
    }
  }, [selectedListed, lastResolvedDeviceId]);

  // Where new work goes: explicit or resolved only.
  const dispatch = dispatchTargetFrom({
    listState,
    runners,
    selectedId,
    resolution,
  });

  // Resolve the active runner and the target its calls use
  const { activeRunner, target: resolvedTarget } = resolveRunnerTarget({
    listState,
    runners,
    selectedId,
    localityById,
    resolution,
    lastResolvedId: lastResolvedDeviceId,
  });

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
  // explicit choice. With no selection, coord's resolver picks.
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
    selection: selectedListed ? "explicit" : "auto",
    resolution,
    dispatch,
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

/**
 * The NEW-WORK target as something runner calls take: a `RunnerTarget` for
 * the dispatch runner (routed like any other — loopback only when proven
 * local, the relay otherwise), or a refusal.
 *
 * - `target` is ALWAYS safe to pass to runnerFetch / runnerRequest /
 *   useRunnerMutation: when new work is refused it is an `unavailable`
 *   target carrying coord's message, so a call made anyway is refused with
 *   that message rather than sent to a read fallback.
 * - `refusal` is non-null exactly when new work may not be placed; a surface
 *   disables its action and shows `refusal.message`.
 * - With no runner paired at all (`no_runner`) `target` is the same
 *   `default_local` target reads use and `refusal` is null — see below.
 *
 * `no_runner` — why the id-level and transport-level answers differ. With no
 * runner paired at all (a loaded, empty list) there is no device: coord has
 * nothing to resolve and there is no id to address. So the ID-level answer
 * (`useDispatchTarget`) names none — surfaces that need a device id (a chat
 * or AI session is opened by id through the backend) have nothing to open.
 * The TRANSPORT-level answer (`useDispatchRunnerTarget`) is the same
 * `default_local` target reads use: the default runner port on 127.0.0.1,
 * which works on a localhost dev origin (an unpaired dev runner) and is
 * refused `origin_unreachable` on a production origin — never a guessed
 * device. Neither ever picks a listed runner.
 */
export interface DispatchRunnerTarget {
  target: RunnerTarget;
  runnerId: string | null;
  refusal: { reason: DispatchTargetReason; message: string } | null;
}

function unavailableReasonFor(
  reason: DispatchTargetReason
): "list_unavailable" | "resolver_unavailable" | "no_eligible_runner" {
  switch (reason) {
    case "list_unavailable":
      return "list_unavailable";
    case "no_capable":
    case "all_drained":
    case "pin_ineligible":
      return "no_eligible_runner";
    default:
      return "resolver_unavailable";
  }
}

export function useDispatchRunnerTarget(): DispatchRunnerTarget {
  const context = useContext(ActiveRunnerContext);
  const dispatch = context?.dispatch ?? NO_PROVIDER_DISPATCH;
  const runner =
    dispatch.runnerId === null
      ? undefined
      : context?.runners.find((r) => r.id === dispatch.runnerId);
  const locality =
    dispatch.runnerId === null
      ? undefined
      : context?.localityById.get(dispatch.runnerId);
  const readTarget = context?.target;
  const key = [
    dispatch.reason,
    dispatch.runnerId ?? "",
    dispatch.message ?? "",
    runner?.port ?? "",
    runner?.name ?? "",
    locality ?? "",
    dispatch.reason === "no_runner" && readTarget ? targetKey(readTarget) : "",
  ].join("|");
  return useMemo<DispatchRunnerTarget>(
    () => {
      if (dispatch.runnerId !== null) {
        return {
          target: runner
            ? buildRunnerTarget(runner, locality)
            : // Coord resolved a device the list lacks: relay to it by id.
              {
                kind: "runner",
                runner: { id: dispatch.runnerId },
                locality: "unknown",
              },
          runnerId: dispatch.runnerId,
          refusal: null,
        };
      }
      if (dispatch.reason === "no_runner" && readTarget) {
        return { target: readTarget, runnerId: null, refusal: null };
      }
      const message = dispatch.message ?? "No runner can take new work.";
      return {
        target: {
          kind: "unavailable",
          reason: unavailableReasonFor(dispatch.reason),
          message,
        },
        runnerId: null,
        refusal: { reason: dispatch.reason, message },
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content
    [key]
  );
}

/**
 * Coord's outcome when NEW work may not start, else null — for a surface
 * that starts work through a client bound to the read target. That is
 * equivalent to routing through the new-work target: whenever new work IS
 * allowed (explicit selection or a resolved device) the read target
 * addresses that same device, so such a surface only needs this gate
 * (disable the action and show the message when non-null).
 */
export function useNewWorkRefusal(): string | null {
  return useDispatchRunnerTarget().refusal?.message ?? null;
}

const NO_PROVIDER_DISPATCH: DispatchTarget = {
  runnerId: null,
  reason: "no_provider",
  message: "No runner context — new work cannot be placed here.",
};

/**
 * Where NEW work (a workflow dispatch, a new chat / AI session) goes:
 * `{runnerId, reason, message}`. `runnerId` is set ONLY for an explicit
 * selection or a `resolved` coord answer; otherwise it is null and `message`
 * is coord's outcome to show. Safe outside a provider (refuses).
 *
 * `no_runner` — why the id-level and transport-level answers differ. With no
 * runner paired at all (a loaded, empty list) there is no device: coord has
 * nothing to resolve and there is no id to address. So the ID-level answer
 * (`useDispatchTarget`) names none — surfaces that need a device id (a chat
 * or AI session is opened by id through the backend) have nothing to open.
 * The TRANSPORT-level answer (`useDispatchRunnerTarget`) is the same
 * `default_local` target reads use: the default runner port on 127.0.0.1,
 * which works on a localhost dev origin (an unpaired dev runner) and is
 * refused `origin_unreachable` on a production origin — never a guessed
 * device. Neither ever picks a listed runner.
 */
export function useDispatchTarget(): DispatchTarget {
  const context = useContext(ActiveRunnerContext);
  return context?.dispatch ?? NO_PROVIDER_DISPATCH;
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
