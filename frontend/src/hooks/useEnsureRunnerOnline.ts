"use client";

import { useCallback, useState } from "react";

import { useRealtimeConnectionsContext } from "@/contexts/realtime-connections-context";

/**
 * Pre-dispatch check used by Phase F.3 of the scheduler reliability plan.
 *
 * Wraps a dispatch action so that the caller can simply call
 * ``ensureRunnerOnline(() => doDispatch(connId))`` and:
 *
 * - If a runner is already online, the action runs immediately.
 * - If not, ``shouldShowWakeModal`` flips to ``true`` so the consumer can
 *   render :component:`WakeRunnerModal`. Once the modal's ``onDispatch``
 *   fires, the consumer calls ``runQueuedDispatch(connectionId)`` to
 *   execute the queued action with the connection that just came online.
 *
 * The hook is deliberately small — it doesn't render UI itself so that
 * each call site can decide where the modal is mounted.
 */
export interface UseEnsureRunnerOnlineResult {
  /** Whether the wake modal should currently be visible. */
  shouldShowWakeModal: boolean;
  /** Connection IDs known to be online right now. */
  onlineConnectionIds: number[];
  /**
   * Run ``action`` if any runner is online, otherwise queue it and surface
   * the wake modal. Returns ``true`` if it ran inline, ``false`` if queued.
   */
  ensureRunnerOnline: (
    action: (connectionId: number | null) => void
  ) => boolean;
  /** Called from the modal's ``onDispatch`` to release the queued action. */
  runQueuedDispatch: (connectionId: number | null) => void;
  /** Called when the user dismisses the modal without waking. */
  cancelQueuedDispatch: () => void;
}

export function useEnsureRunnerOnline(): UseEnsureRunnerOnlineResult {
  const { connections } = useRealtimeConnectionsContext();
  const [shouldShowWakeModal, setShouldShowWakeModal] = useState(false);
  const [queuedAction, setQueuedAction] = useState<
    ((connectionId: number | null) => void) | null
  >(null);

  const onlineConnectionIds = connections.map((c) => c.id);

  const ensureRunnerOnline = useCallback(
    (action: (connectionId: number | null) => void): boolean => {
      // If we already have a connection, dispatch immediately.
      if (connections.length > 0) {
        const conn = connections[0];
        action(conn ? conn.id : null);
        return true;
      }
      // Queue the action and pop the modal. Wrap in a function-returning
      // setter so React doesn't try to call ``action`` itself.
      setQueuedAction(() => action);
      setShouldShowWakeModal(true);
      return false;
    },
    [connections]
  );

  const runQueuedDispatch = useCallback(
    (connectionId: number | null) => {
      const action = queuedAction;
      setQueuedAction(null);
      setShouldShowWakeModal(false);
      if (action) action(connectionId);
    },
    [queuedAction]
  );

  const cancelQueuedDispatch = useCallback(() => {
    setQueuedAction(null);
    setShouldShowWakeModal(false);
  }, []);

  return {
    shouldShowWakeModal,
    onlineConnectionIds,
    ensureRunnerOnline,
    runQueuedDispatch,
    cancelQueuedDispatch,
  };
}
