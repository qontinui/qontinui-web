"use client";

import { useCallback, useState } from "react";

import { useRealtimeConnectionsContext } from "@/contexts/realtime-connections-context";

/**
 * Pre-dispatch check used by Phase F.3 of the scheduler reliability plan.
 *
 * Wraps a dispatch action so that the caller can simply call
 * ``ensureRunnerOnline(() => doDispatch(runnerId))`` and:
 *
 * - If a runner is already online, the action runs immediately.
 * - If not, ``shouldShowWakeModal`` flips to ``true`` so the consumer can
 *   render :component:`WakeRunnerModal`. Once the modal's ``onDispatch``
 *   fires, the consumer calls ``runQueuedDispatch(runnerId)`` to execute
 *   the queued action with the runner that just came online.
 *
 * The hook is deliberately small — it doesn't render UI itself so that
 * each call site can decide where the modal is mounted.
 */
export interface UseEnsureRunnerOnlineResult {
  /** Whether the wake modal should currently be visible. */
  shouldShowWakeModal: boolean;
  /** Runner UUIDs known to be online right now. */
  onlineRunnerIds: string[];
  /**
   * Run ``action`` if any runner is online, otherwise queue it and surface
   * the wake modal. Returns ``true`` if it ran inline, ``false`` if queued.
   */
  ensureRunnerOnline: (action: (runnerId: string | null) => void) => boolean;
  /** Called from the modal's ``onDispatch`` to release the queued action. */
  runQueuedDispatch: (runnerId: string | null) => void;
  /** Called when the user dismisses the modal without waking. */
  cancelQueuedDispatch: () => void;
}

export function useEnsureRunnerOnline(): UseEnsureRunnerOnlineResult {
  const { runners } = useRealtimeConnectionsContext();
  const [shouldShowWakeModal, setShouldShowWakeModal] = useState(false);
  const [queuedAction, setQueuedAction] = useState<
    ((runnerId: string | null) => void) | null
  >(null);

  const onlineRunnerIds = runners.map((r) => r.id);

  const ensureRunnerOnline = useCallback(
    (action: (runnerId: string | null) => void): boolean => {
      // If we already have a runner, dispatch immediately.
      if (runners.length > 0) {
        const runner = runners[0];
        action(runner ? runner.id : null);
        return true;
      }
      // Queue the action and pop the modal. Wrap in a function-returning
      // setter so React doesn't try to call ``action`` itself.
      setQueuedAction(() => action);
      setShouldShowWakeModal(true);
      return false;
    },
    [runners]
  );

  const runQueuedDispatch = useCallback(
    (runnerId: string | null) => {
      const action = queuedAction;
      setQueuedAction(null);
      setShouldShowWakeModal(false);
      if (action) action(runnerId);
    },
    [queuedAction]
  );

  const cancelQueuedDispatch = useCallback(() => {
    setQueuedAction(null);
    setShouldShowWakeModal(false);
  }, []);

  return {
    shouldShowWakeModal,
    onlineRunnerIds,
    ensureRunnerOnline,
    runQueuedDispatch,
    cancelQueuedDispatch,
  };
}
