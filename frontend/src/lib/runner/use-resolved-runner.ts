"use client";

/**
 * `useResolvedRunner` — coord's answer to "which runner runs this?", live.
 *
 * Plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3.
 * One hook for every surface that needs an execution target: it asks the web
 * backend's resolver door (./resolve) and re-asks when its inputs change,
 * when `refreshKey` changes (e.g. the runner list gained or lost a runner),
 * and every RESOLVE_REFRESH_MS.
 *
 * - The first answer is `loading`. A re-ask keeps showing the previous answer
 *   until the new one arrives (no flash back to `loading`).
 * - `lastResolvedDeviceId` is the device of the most recent `resolved` answer
 *   for these capabilities + work class. It SURVIVES an `unavailable` answer:
 *   a resolver outage keeps the last resolved target (plan risk "A resolver
 *   outage must not blank the UI") instead of dropping to a guess. It is
 *   cleared when coord answers authoritatively that nothing is eligible.
 */

import { useCallback, useEffect, useState } from "react";
import {
  requestDeviceResolve,
  type ResolvedRunnerState,
  type ResolveWorkClass,
} from "./resolve";

/** How often a resolution is re-asked while mounted. */
export const RESOLVE_REFRESH_MS = 60_000;

export interface UseResolvedRunnerOptions {
  /** Required capability tokens; [] when the work needs none. */
  capabilities: readonly string[];
  workClass: ResolveWorkClass;
  /** The pin (a coord device id), or null for a pure pool pick. */
  preferred?: string | null;
  /** When false nothing is asked; the last state is kept. Default true. */
  enabled?: boolean;
  /** Any change re-asks at once. */
  refreshKey?: string;
  /**
   * Which question this is, beyond capabilities + work class. A change starts
   * over (loading, no last device) — e.g. "explicit" vs "auto" selection, so
   * a device resolved for an explicit pin is never kept as an automatic pick.
   */
  scope?: string;
  /**
   * Echoed back as `answeredTag` with the answer to the request it was sent
   * with. Unlike `scope`, a change does NOT start over: the previous answer
   * stays visible while the new question is in flight, and the caller tells
   * the two apart by the tag (e.g. which pin an answer was about).
   */
  tag?: string;
}

export interface UseResolvedRunnerResult {
  state: ResolvedRunnerState;
  /** The last device coord resolved for these inputs — kept across outages. */
  lastResolvedDeviceId: string | null;
  /** The `tag` of the request `state` answers; null while nothing answered. */
  answeredTag: string | null;
  /** Re-ask now. */
  refresh: () => void;
}

const LOADING: ResolvedRunnerState = { status: "loading" };

export function useResolvedRunner({
  capabilities,
  workClass,
  preferred = null,
  enabled = true,
  refreshKey = "",
  scope = "",
  tag = "",
}: UseResolvedRunnerOptions): UseResolvedRunnerResult {
  const capabilitiesKey = [...capabilities].sort().join(",");
  const [state, setState] = useState<ResolvedRunnerState>(LOADING);
  const [lastResolvedDeviceId, setLastResolved] = useState<string | null>(null);
  const [answeredTag, setAnsweredTag] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // A different requirement (or scope) is a different question: its last
  // answer does not carry over. (A different pin is the same question.)
  const questionKey = `${scope}|${workClass}|${capabilitiesKey}`;
  const [question, setQuestion] = useState(questionKey);
  if (question !== questionKey) {
    setQuestion(questionKey);
    setState(LOADING);
    setLastResolved(null);
    setAnsweredTag(null);
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const caps = capabilitiesKey === "" ? [] : capabilitiesKey.split(",");
    requestDeviceResolve(
      { capabilities: caps, workClass, preferred },
      controller.signal
    ).then(
      (next) => {
        if (controller.signal.aborted) return;
        setState(next);
        setAnsweredTag(tag);
        if (next.status === "resolved") {
          setLastResolved(next.deviceId);
        } else if (
          next.status === "no_capable" ||
          next.status === "all_drained" ||
          next.status === "pin_ineligible"
        ) {
          // Coord answered: nothing is eligible. The last pick is no longer
          // a safe fallback. (`unavailable` / `drain_unreadable` are UNKNOWN
          // and keep it.)
          setLastResolved(null);
        }
      },
      () => {
        /* aborted: a newer request owns the state */
      }
    );
    const timer = setInterval(refresh, RESOLVE_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [
    enabled,
    scope,
    workClass,
    capabilitiesKey,
    preferred,
    tag,
    refreshKey,
    tick,
    refresh,
  ]);

  return { state, lastResolvedDeviceId, answeredTag, refresh };
}
