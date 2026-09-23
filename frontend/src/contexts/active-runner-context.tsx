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
  PICK_HINT,
  targetKey,
  type RunnerTarget,
} from "@/lib/runner/target";
import type {
  PinIneligibility,
  ResolvedRunnerState,
  ResolveWorkClass,
} from "@/lib/runner/resolve";
import { useResolvedRunner } from "@/lib/runner/use-resolved-runner";

// ============================================================================
// Context Types
// ============================================================================

/**
 * The user's pick of a runner: a PREFERENCE coord's resolver checks (plan D1),
 * not a transport. `name` is remembered so an offline pick can still be named.
 */
export interface RunnerPin {
  id: string;
  name: string | null;
}

interface ActiveRunnerContextValue {
  /** The runner reads currently address, or null if none is listed */
  activeRunner: Runner | null;
  /** All selectable runners (healthy or degraded) */
  runners: Runner[];
  /**
   * Store the user's pick (a runner id), or null for "Automatic (coord
   * picks)". It changes no transport: it is the preferred device coord's
   * resolver checks, and calls follow coord's answer.
   */
  selectRunner: (runnerId: string | null) => void;
  /** The stored pick, or null when coord picks automatically. */
  pin: RunnerPin | null;
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
  /** `explicit` — the user has a pick; `auto` — coord picks. */
  selection: "explicit" | "auto";
  /**
   * Coord's answer for this tree's `placeable` work about the CURRENT pick
   * (or the automatic question) — `loading` while that question is in
   * flight. `unavailable` = UNKNOWN.
   */
  resolution: ResolvedRunnerState;
  /** Where NEW placeable work goes (see `dispatchTargetFrom`). */
  dispatch: DispatchTarget;
  /** Where NEW machine-bound work goes (see `machineBoundDispatchFrom`). */
  boundDispatch: DispatchTarget;
  /**
   * Declare a mounted surface that starts machine-bound work; returns the
   * release. Coord is asked the machine-bound question only while one is.
   */
  registerBoundDemand: () => () => void;
}

const ActiveRunnerContext = createContext<ActiveRunnerContextValue | undefined>(
  undefined
);

// ============================================================================
// Helpers
// ============================================================================

const STORAGE_KEY = "qontinui:activeRunnerId";
const STORAGE_NAME_KEY = "qontinui:activeRunnerName";

function readStoredPin(): RunnerPin | null {
  if (typeof window === "undefined") return null;
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return id ? { id, name: localStorage.getItem(STORAGE_NAME_KEY) } : null;
  } catch {
    return null;
  }
}

function writeStoredPin(pin: RunnerPin | null): void {
  try {
    if (pin === null) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_NAME_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, pin.id);
    if (pin.name) localStorage.setItem(STORAGE_NAME_KEY, pin.name);
    else localStorage.removeItem(STORAGE_NAME_KEY);
  } catch {
    /* storage unavailable: the pick lasts for this page only */
  }
}

const LOADING_RESOLUTION: ResolvedRunnerState = { status: "loading" };

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
 * `useDispatchRunnerApi()`. It is a `resolved` coord answer (or, while coord
 * is UNKNOWN, the user's online pick); otherwise the action is disabled and
 * coord's outcome is shown.
 *
 * The user's pick (`pinId`) is a PREFERENCE, never a short-circuit: it is the
 * preferred device coord checks, and when coord names a device, that device
 * is the target — the pick itself, or coord's pool pick after it released an
 * ineligible one (the surface announces that).
 *
 * - While the runner list is loading, nothing is known: `pending`. (A
 *   stored pick may name a runner on another machine; the list has to
 *   arrive before anything may reach a loopback port.)
 * - A failed load is not an empty fleet: `list_unavailable`, never the
 *   default base.
 * - A loaded, genuinely empty list claims no runner: the default local base.
 * - COORD chooses (plan D1): `resolved` → that device, over loopback if
 *   proven local, over the relay otherwise.
 * - Coord named no device: the user's pick, when it is listed (online).
 * - Coord has not answered yet (`loading`): otherwise a SOLE listed runner
 *   is the target (the only runner there is — not an order-based pick); with
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
  pinId,
  localityById,
  resolution,
  lastResolvedId = null,
}: {
  listState: RunnerListState;
  runners: Runner[];
  pinId: string | null;
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

  // Coord's answer governs whenever it names a device — with or without a
  // pin. The pin is an input to that answer, never a short-circuit past it.
  if (resolution.status === "resolved") {
    return targetForDevice(resolution.deviceId, runners, localityById);
  }

  // No device from coord (not answered yet, UNKNOWN, or nothing eligible).
  // Reads must keep a runner: the user's own pick first (when it is online),
  // then the fallbacks below.
  const pinned =
    pinId === null ? undefined : runners.find((r) => r.id === pinId);
  if (pinned) return listedTarget(pinned, localityById);

  const sole = runners.length === 1 ? runners[0] : undefined;
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
 * Why the dispatch target is what it is. `resolved` and `pin_unchecked`
 * carry a runner; every other reason carries none.
 *
 * - `resolved`      — coord named the device (via the pin, or from the pool
 *                     after releasing a `placeable` pin — see `notice`).
 * - `pin_unchecked` — coord's resolver is UNKNOWN (did not answer) and the
 *                     user's pick is online: new work goes to the pick, and
 *                     the surface says it was not eligibility-checked.
 */
export type DispatchTargetReason =
  | "resolved"
  | "pin_unchecked"
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

/**
 * Something the surface must SAY while new work still goes somewhere — the
 * pin was not used as-is (plan D2: a re-target is never silent).
 */
export type DispatchNotice =
  | {
      /** Coord released the pin for `placeable` work and picked `runnerId`. */
      kind: "pin_released";
      pinId: string;
      runnerId: string;
      reason: PinIneligibility | null;
      text: string;
    }
  | {
      /** Coord did not answer; the pick is used without its eligibility check. */
      kind: "pin_unchecked";
      pinId: string;
      text: string;
    };

/** A `machine_bound` pin coord refused — the surface offers alternatives. */
export interface PinRefusal {
  deviceId: string;
  /** Null when coord answered with a different device instead of a reason. */
  reason: PinIneligibility | null;
  detail: string;
  missingCapabilities: string[];
  /** True when the user picked it; false when it was coord's automatic pick. */
  explicit: boolean;
}

export interface DispatchTarget {
  /** The runner new work goes to, or null when none may be chosen. */
  runnerId: string | null;
  reason: DispatchTargetReason;
  /** What to tell the user when `runnerId` is null. */
  message: string | null;
  /** Set when new work goes somewhere other than the pin as-is. */
  notice: DispatchNotice | null;
  /** Set when a `machine_bound` pin was refused (never re-targeted). */
  pinRefused: PinRefusal | null;
}

function refused(
  reason: Exclude<DispatchTargetReason, "resolved" | "pin_unchecked">,
  message: string,
  pinRefused: PinRefusal | null = null
): DispatchTarget {
  return { runnerId: null, reason, message, notice: null, pinRefused };
}

function allowed(
  runnerId: string,
  reason: "resolved" | "pin_unchecked",
  notice: DispatchNotice | null = null
): DispatchTarget {
  return { runnerId, reason, message: null, notice, pinRefused: null };
}

const PIN_REASON_PHRASE: Record<PinIneligibility, string> = {
  offline: "offline",
  drained: "drained — taken out of service for new work",
  missing_capabilities: "missing a capability this work needs",
  not_a_paired_device: "no longer paired to your account",
};

/** A runner's display name: listed name, else the stored pin name, else a short id. */
export function runnerDisplayName(
  id: string,
  runners: readonly Runner[],
  pin: RunnerPin | null
): string {
  const listed = runners.find((r) => r.id === id);
  if (listed?.name) return listed.name;
  if (pin?.id === id && pin.name) return pin.name;
  return `runner ${id.slice(0, 8)}`;
}

/** What the placeable refusals say (shared by both work classes). */
function nothingEligibleRefusal(
  resolution: ResolvedRunnerState
): DispatchTarget | null {
  switch (resolution.status) {
    case "drain_unreadable":
      return refused(
        "drain_unreadable",
        `Coord could not read which runners are drained, so it names none. Retry shortly, or ${PICK_HINT}.`
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
    default:
      return null;
  }
}

/**
 * Where NEW `placeable` work goes — the ONE place the rule lives: the device
 * coord RESOLVED for this user (capability-checked, heartbeat-fresh,
 * drain-filtered), with the user's pick as the preferred device. The pick is
 * a PREFERENCE: when coord releases it (offline, drained, …) the work goes to
 * coord's pool pick and `notice` says so (plan D2). Only when coord is
 * UNKNOWN does an online pick stand on its own (`pin_unchecked`, announced).
 * Never the read target's fallbacks (the last known runner, a proven-local
 * one, the sole one): those keep reads alive through an outage, but a drained
 * or unverified runner must not be handed new work.
 */
export function dispatchTargetFrom({
  listState,
  runners,
  pin,
  resolution,
}: {
  listState: RunnerListState;
  runners: readonly Runner[];
  pin: RunnerPin | null;
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
  const pinName = pin ? runnerDisplayName(pin.id, runners, pin) : null;
  const pinListed = pin !== null && runners.some((r) => r.id === pin.id);
  switch (resolution.status) {
    case "resolved": {
      if (pin === null || resolution.deviceId === pin.id) {
        return allowed(resolution.deviceId, "resolved");
      }
      // Coord released the pin and picked from the pool: never silent.
      const reason = resolution.pinReleased?.reason ?? null;
      const to = runnerDisplayName(resolution.deviceId, runners, pin);
      return allowed(resolution.deviceId, "resolved", {
        kind: "pin_released",
        pinId: pin.id,
        runnerId: resolution.deviceId,
        reason,
        text: reason
          ? `Your pick ${pinName} is ${PIN_REASON_PHRASE[reason]} — running on ${to}.`
          : `Your pick ${pinName} is not available — running on ${to}.`,
      });
    }
    case "loading":
      return refused(
        "resolving",
        pin ? `Checking ${pinName}…` : "Choosing a runner…"
      );
    case "unavailable":
      if (pin && pinListed) {
        return allowed(pin.id, "pin_unchecked", {
          kind: "pin_unchecked",
          pinId: pin.id,
          text: `The device resolver did not answer — running on your pick ${pinName} without checking it is eligible.`,
        });
      }
      return refused(
        "resolver_unavailable",
        pin
          ? `Your pick ${pinName} is not currently listed, and the device resolver did not answer. Retry, or ${PICK_HINT}.`
          : `Which runner should take new work is unknown — the device resolver did not answer. Retry, or ${PICK_HINT}.`
      );
    case "pin_ineligible":
      // Not a placeable answer; kept typed so nothing is ever dispatched on it.
      return refused("pin_ineligible", resolution.detail);
    default:
      return nothingEligibleRefusal(resolution)!;
  }
}

/**
 * Where NEW `machine_bound` work goes (plan D2): GUI automation and capture
 * act on one machine's screen, so the device is never swapped for another.
 *
 * The device asked about is the user's pick, or — with no pick — the device
 * coord chose for this tree's placeable work (so "Automatic" still names one
 * machine, shown on the surface before anything runs). Coord checks it as a
 * `machine_bound` pin:
 * - eligible → that device;
 * - ineligible → REFUSED with the reason (`pinRefused`); the surface offers
 *   the alternatives and the user picks. Nothing here ever picks one.
 * - a device other than the one asked about → refused as well (coord must
 *   never re-target machine-bound work; the client does not trust it to).
 *
 * The device must also be the one the placeable target names — the one the
 * page's reads address — so a surface's follow-up reads (status, stop,
 * results) hit the machine the work started on. A transient disagreement is
 * `resolving`, never a pick.
 */
export function machineBoundDispatchFrom({
  runners,
  pin,
  placeable,
  resolution,
}: {
  runners: readonly Runner[];
  pin: RunnerPin | null;
  /** The placeable dispatch target for the same tree. */
  placeable: DispatchTarget;
  /** Coord's `machine_bound` answer about `machineBoundPreferred(...)`. */
  resolution: ResolvedRunnerState;
}): DispatchTarget {
  if (
    placeable.reason === "list_loading" ||
    placeable.reason === "list_unavailable" ||
    placeable.reason === "no_runner" ||
    placeable.reason === "no_provider"
  ) {
    return { ...placeable, notice: null };
  }
  const preferred = machineBoundPreferred(pin, placeable);
  if (preferred === null) {
    // No pick, and coord named no device for this tree: its refusal stands.
    return { ...placeable, notice: null };
  }
  const name = runnerDisplayName(preferred, runners, pin);
  const explicit = pin !== null;
  const whose = explicit ? `Your pick ${name}` : `Coord's pick ${name}`;
  switch (resolution.status) {
    case "loading":
      return refused("resolving", `Checking ${name}…`);
    case "resolved":
      if (resolution.deviceId !== preferred) {
        return refused(
          "pin_ineligible",
          `${whose} was not confirmed for this work, and machine-bound work never moves to another runner. Pick a runner under “Run on”.`,
          {
            deviceId: preferred,
            reason: null,
            detail: "",
            missingCapabilities: [],
            explicit,
          }
        );
      }
      if (placeable.runnerId !== preferred) {
        return refused("resolving", `Checking ${name}…`);
      }
      return allowed(preferred, "resolved");
    case "pin_ineligible": {
      const missing = resolution.missingCapabilities;
      return refused(
        "pin_ineligible",
        `${whose} can't run this: it is ${PIN_REASON_PHRASE[resolution.reason]}${
          missing.length > 0 ? ` (missing: ${missing.join(", ")})` : ""
        }. This work runs on one machine's screen, so it is not moved to another runner — pick one below.`,
        {
          deviceId: resolution.deviceId,
          reason: resolution.reason,
          detail: resolution.detail,
          missingCapabilities: missing,
          explicit,
        }
      );
    }
    case "unavailable":
      if (
        placeable.reason === "pin_unchecked" &&
        placeable.runnerId === preferred
      ) {
        return allowed(preferred, "pin_unchecked", placeable.notice);
      }
      return refused(
        "resolver_unavailable",
        `Coord did not answer whether ${name} can run this. Retry shortly.`
      );
    default:
      return nothingEligibleRefusal(resolution)!;
  }
}

/**
 * The device a `machine_bound` question is about: the user's pick, else the
 * device the placeable target names (coord's automatic pick). Null = none.
 */
export function machineBoundPreferred(
  pin: RunnerPin | null,
  placeable: DispatchTarget
): string | null {
  return pin?.id ?? placeable.runnerId;
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
  // The user's pick — a PREFERENCE handed to coord's resolver, never a
  // transport. It survives the runner going offline (coord then says so, and
  // the surface announces where the work goes instead); only the user clears
  // it, by choosing "Automatic".
  const [pin, setPin] = useState<RunnerPin | null>(readStoredPin);

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

  // One locality measurement per runner, shared with the status line and
  // the Run-on pickers.
  const localityById = useRunnerLocality(runners);

  const listReady = listState === "loaded" && runners.length > 0;
  const runnerIdsKey = runners
    .map((r) => r.id)
    .sort()
    .join(",");

  // Coord resolves the target for this tree's (placeable) work. The pin is
  // the user's pick — sent even when that runner is offline, so coord can say
  // so; with none, it is the last device coord chose AUTOMATICALLY (so
  // equally eligible runners do not trade places on every re-ask). A pick
  // never becomes the automatic pin: clearing it returns to coord's free
  // choice.
  //
  // Picking changes NO transport: while coord is asked about the new pick,
  // reads stay on the device coord last named (the answer is kept, tagged
  // with the question it answered), and new work waits — an answer about a
  // previous pick (or the automatic question) is never taken as one about
  // this pick.
  const [autoPin, setAutoPin] = useState<string | null>(null);
  const questionTag = pin ? `pin:${pin.id}` : "auto";
  const {
    state: resolution,
    lastResolvedDeviceId,
    answeredTag,
    refresh: refreshPlaceable,
  } = useResolvedRunner({
    capabilities: NO_CAPABILITIES,
    workClass: "placeable",
    preferred: pin ? pin.id : autoPin,
    tag: questionTag,
    enabled: listReady,
    refreshKey: runnerIdsKey,
  });
  useEffect(() => {
    if (answeredTag === "auto" && resolution.status === "resolved") {
      setAutoPin(resolution.deviceId);
    }
  }, [answeredTag, resolution]);
  // A pick starts the automatic question over (no sticky automatic device).
  const pinId = pin?.id ?? null;
  useEffect(() => {
    if (pinId !== null) setAutoPin(null);
  }, [pinId]);
  const currentResolution: ResolvedRunnerState =
    answeredTag === questionTag ? resolution : LOADING_RESOLUTION;

  // Where new placeable work goes: coord's answer, the pin as a preference.
  const dispatch = dispatchTargetFrom({
    listState,
    runners,
    pin,
    resolution: currentResolution,
  });

  // Machine-bound work (GUI automation, capture) asks coord separately, and
  // only while a surface that starts such work is mounted. Demand starting
  // (0 → 1) AND ending (1 → 0) each start a NEW question: while nothing is
  // mounted the answer is `loading`, so a surface that remounts renders its
  // FIRST frame from `loading`, never from an answer given before it
  // unmounted — a stale `resolved` cannot enable Run even for one render.
  const [boundDemand, setBoundDemand] = useState({ count: 0, generation: 0 });
  const registerBoundDemand = useCallback(() => {
    setBoundDemand((d) => ({
      count: d.count + 1,
      generation: d.count === 0 ? d.generation + 1 : d.generation,
    }));
    return () =>
      setBoundDemand((d) => ({
        count: d.count - 1,
        generation: d.count === 1 ? d.generation + 1 : d.generation,
      }));
  }, []);
  const boundPreferred = machineBoundPreferred(pin, dispatch);
  const { state: boundResolution } = useResolvedRunner({
    capabilities: NO_CAPABILITIES,
    workClass: "machine_bound",
    preferred: boundPreferred,
    scope: `bound:${boundDemand.generation}:${boundPreferred ?? ""}`,
    enabled: boundDemand.count > 0 && listReady && boundPreferred !== null,
    refreshKey: runnerIdsKey,
  });
  // When coord answers the machine-bound question, re-ask the placeable one
  // at once, so the two cannot disagree about the same device until the
  // next periodic refresh (e.g. the machine-bound answer found the pick
  // offline while the placeable answer still names it).
  useEffect(() => {
    if (boundResolution.status !== "loading") refreshPlaceable();
  }, [boundResolution, refreshPlaceable]);
  const boundDispatch = machineBoundDispatchFrom({
    runners,
    pin,
    placeable: dispatch,
    resolution: boundResolution,
  });

  // Resolve the active runner and the target its calls use
  const { activeRunner, target: resolvedTarget } = resolveRunnerTarget({
    listState,
    runners,
    pinId: pin?.id ?? null,
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

  // Keep the stored name of an online pick current, so an offline pick is
  // still named when coord releases or refuses it.
  const pinnedName = pin
    ? (runners.find((r) => r.id === pin.id)?.name ?? null)
    : null;
  useEffect(() => {
    if (pin && pinnedName && pinnedName !== pin.name) {
      const next = { id: pin.id, name: pinnedName };
      setPin(next);
      writeStoredPin(next);
    }
  }, [pin, pinnedName]);

  // Selecting stores the PREFERENCE and nothing else: no base URL, no
  // route, no target is set here. Where calls go follows coord's answer
  // about the pin (see resolveRunnerTarget / dispatchTargetFrom).
  const runnersRef = useRef(runners);
  runnersRef.current = runners;
  const selectRunner = useCallback((runnerId: string | null) => {
    const next =
      runnerId === null
        ? null
        : {
            id: runnerId,
            name:
              runnersRef.current.find((r) => r.id === runnerId)?.name ?? null,
          };
    setPin(next);
    writeStoredPin(next);
  }, []);

  const value: ActiveRunnerContextValue = {
    activeRunner,
    runners,
    selectRunner,
    pin,
    isMultiRunner: runners.length > 1,
    listState,
    localityById,
    target,
    selection: pin ? "explicit" : "auto",
    resolution: currentResolution,
    dispatch,
    boundDispatch,
    registerBoundDemand,
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
  /** Say this on the surface: the pin was not used as-is (plan D2). */
  notice: DispatchNotice | null;
}

/** Options for the new-work hooks: what kind of work the surface starts. */
export interface NewWorkOptions {
  /**
   * `placeable` (default) — any eligible runner will do; a released pick is
   * re-targeted and announced. `machine_bound` — the work acts on one
   * machine's screen (GUI automation, capture): an ineligible pick is
   * refused with the reason, never re-targeted.
   */
  workClass?: ResolveWorkClass;
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

export function useDispatchRunnerTarget(
  options: NewWorkOptions = {}
): DispatchRunnerTarget {
  const context = useContext(ActiveRunnerContext);
  const dispatch = useDispatchTarget(options);
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
    dispatch.notice?.text ?? "",
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
          notice: dispatch.notice,
        };
      }
      if (dispatch.reason === "no_runner" && readTarget) {
        return {
          target: readTarget,
          runnerId: null,
          refusal: null,
          notice: null,
        };
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
        notice: null,
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
 * allowed the read target addresses that same device (for both work
 * classes — see `machineBoundDispatchFrom`), so such a surface only needs
 * this gate (disable the action and show the message when non-null).
 */
export function useNewWorkRefusal(options: NewWorkOptions = {}): string | null {
  return useDispatchRunnerTarget(options).refusal?.message ?? null;
}

const NO_PROVIDER_DISPATCH: DispatchTarget = {
  runnerId: null,
  reason: "no_provider",
  message: "No runner context — new work cannot be placed here.",
  notice: null,
  pinRefused: null,
};

/**
 * Where NEW work (a workflow dispatch, a new chat / AI session) goes:
 * `{runnerId, reason, message, notice, pinRefused}`. `runnerId` is set ONLY
 * for a device coord resolved (or, while coord is UNKNOWN, the user's online
 * pick — announced); otherwise it is null and `message` is coord's outcome to
 * show. Safe outside a provider (refuses).
 *
 * `workClass: "machine_bound"` asks coord whether the pick (or coord's
 * automatic device) can run machine-bound work, while the calling component
 * is mounted; an ineligible pick is refused (`pinRefused`), never moved.
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
export function useDispatchTarget(
  options: NewWorkOptions = {}
): DispatchTarget {
  const context = useContext(ActiveRunnerContext);
  const bound = options.workClass === "machine_bound";
  const register = context?.registerBoundDemand;
  useEffect(() => {
    if (!bound || !register) return;
    return register();
  }, [bound, register]);
  if (!context) return NO_PROVIDER_DISPATCH;
  return bound ? context.boundDispatch : context.dispatch;
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
