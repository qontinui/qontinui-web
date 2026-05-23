"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, Loader2, MonitorPlay, Power } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRealtimeConnectionsContext } from "@/contexts/realtime-connections-context";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import type { RunnerStatusEvent } from "@qontinui/shared-types/tauri-events";

const log = createLogger("WakeRunnerModal");

const WAKE_TIMEOUT_MS = 30_000;

type WakeApiResponse =
  | {
      status: "already_online";
      runner_id: string;
    }
  | {
      status: "wake_required";
      wake_url: string;
      intent_id: string;
      expires_at: string;
    };

interface WakeRunnerModalProps {
  open: boolean;
  onClose: () => void;
  /** Owner user id whose runner should wake up (UUID). */
  userId: string;
  /** Optional task to dispatch once the runner reports back online. */
  taskId?: string;
  /** Called once a wake is confirmed (already-online or runner.woke event). */
  onDispatch: (runnerId: string | null) => void;
}

type Phase = "idle" | "waking" | "failed";

/**
 * Two-CTA modal that surfaces when a user (or scheduled task) wants to
 * dispatch work to a runner that is currently offline.
 *
 * - "Wake runner" calls ``POST /api/v1/runner/{userId}/wake``. If the
 *   server responds ``already_online`` the modal short-circuits and
 *   invokes ``onDispatch`` immediately. If the server responds
 *   ``wake_required`` the modal navigates to the returned
 *   ``qontinui://wake?...`` URL via ``window.location.href`` and shows a
 *   30-second "Waking runner..." spinner. The wake is confirmed either by
 *   a ``runner.woke`` Redis pub/sub event arriving over the per-user
 *   status WebSocket OR by the
 *   :func:`useRealtimeConnectionsContext` hook reporting that a runner
 *   has appeared. Whichever fires first wins.
 *
 * - "Run in cloud" is a deliberate placeholder for the next phase
 *   (cloud fallback execution). It is rendered DISABLED with a
 *   "Coming soon" tooltip so the UI affordance exists today and the
 *   button doesn't need a layout reshuffle when cloud lands.
 */
export function WakeRunnerModal({
  open,
  onClose,
  userId,
  taskId,
  onDispatch,
}: WakeRunnerModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dispatchedRef = useRef(false);
  const { runners } = useRealtimeConnectionsContext();
  const watchRunnersRef = useRef(false);

  // Reset state when the modal closes.
  useEffect(() => {
    if (!open) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      dispatchedRef.current = false;
      watchRunnersRef.current = false;
      setPhase("idle");
      setErrorMessage(null);
    }
  }, [open]);

  // Confirm wake when a runner appears in the realtime context. This is
  // the fallback path: the WS event ``runner.woke`` is the canonical signal
  // but if it's missed for any reason, the existing ``runner_connected``
  // event (already piped through ``RealtimeConnectionsProvider``) will
  // surface as a new entry in ``runners`` within a couple of seconds.
  useEffect(() => {
    if (phase !== "waking" || !watchRunnersRef.current) return;
    if (dispatchedRef.current) return;
    if (runners.length === 0) return;
    log.debug("Runner observed during wake; dispatching", {
      runners: runners.length,
    });
    dispatchedRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const runner = runners[0];
    onDispatch(runner ? runner.id : null);
    onClose();
  }, [runners, phase, onDispatch, onClose]);

  // Subscribe to the per-user runner.woke WS event. We piggy-back on the
  // existing /runners/status connection by opening a parallel listener;
  // the realtime-connections context owns the primary one but doesn't
  // surface raw messages to consumers. A short-lived parallel WS keeps the
  // change additive.
  useEffect(() => {
    if (phase !== "waking") return;
    let cancelled = false;
    let ws: WebSocket | null = null;

    const open_ws = async () => {
      try {
        const resp = await httpClient.fetch(
          `${ApiConfig.API_BASE_URL}/api/v1/ws-token`
        );
        if (!resp.ok) return;
        const data = await resp.json();
        const token: string | undefined = data?.token;
        if (!token || cancelled) return;

        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const wsProto = apiUrl.startsWith("https") ? "wss" : "ws";
        const apiHost = apiUrl.replace(/^https?:\/\//, "");
        const wsUrl = `${wsProto}://${apiHost}/api/v1/devices/status?token=${encodeURIComponent(token)}`;

        ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data) as RunnerStatusEvent;
            if (msg.type === "runner.woke") {
              if (dispatchedRef.current) return;
              dispatchedRef.current = true;
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              const rid = msg.runner_id;
              log.debug("runner.woke event received", { runner_id: rid });
              onDispatch(rid);
              onClose();
            }
          } catch {
            // Ignore non-JSON frames.
          }
        };
      } catch (e) {
        log.debug("wake WS open failed", e);
      }
    };

    open_ws();
    return () => {
      cancelled = true;
      if (ws) ws.close();
    };
  }, [phase, onDispatch, onClose]);

  const handleWakeClick = useCallback(async () => {
    setPhase("waking");
    setErrorMessage(null);
    dispatchedRef.current = false;
    watchRunnersRef.current = false;
    try {
      const body: { reason: string; task_id?: string } = {
        reason: "frontend dispatch",
      };
      if (taskId) body.task_id = taskId;
      const resp = await httpClient.fetch(
        `${ApiConfig.API_BASE_URL}/api/v1/runner/${encodeURIComponent(userId)}/wake`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as WakeApiResponse;

      if (data.status === "already_online") {
        log.debug("Runner already online; dispatching directly", {
          runner_id: data.runner_id,
        });
        dispatchedRef.current = true;
        onDispatch(data.runner_id);
        onClose();
        return;
      }

      // wake_required: navigate to the deep link and start watching.
      log.debug("wake_required; navigating to deep link", {
        intent_id: data.intent_id,
      });
      // Note: the realtime-connections context polls on its own (every 30s)
      // and emits ``runner_connected`` events as soon as the runner
      // registers. We just need to start observing the runners list.
      watchRunnersRef.current = true;
      window.location.href = data.wake_url;

      timeoutRef.current = setTimeout(() => {
        if (dispatchedRef.current) return;
        log.debug("Wake timed out");
        setPhase("failed");
        setErrorMessage("Wake failed. Open the runner manually and try again.");
      }, WAKE_TIMEOUT_MS);
    } catch (e) {
      log.debug("Wake request failed", e);
      setPhase("failed");
      setErrorMessage(
        e instanceof Error
          ? `Wake request failed: ${e.message}`
          : "Wake request failed."
      );
    }
  }, [userId, taskId, onDispatch, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudOff className="h-5 w-5" />
            Your runner is offline
          </DialogTitle>
          <DialogDescription>
            We couldn&apos;t reach a live runner for your account. Wake your
            local runner now, or run this task in the cloud.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {phase === "waking" ? (
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>
                Waking runner... this can take up to{" "}
                {Math.round(WAKE_TIMEOUT_MS / 1000)} seconds.
              </span>
            </div>
          ) : null}

          {phase === "failed" && errorMessage ? (
            <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              Wake works while a qontinui-web tab is open and focused. For
              reliable overnight scheduling, enable &quot;Launch on system
              startup&quot; in the runner settings.
            </li>
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={phase === "waking"}
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Run-in-cloud is a deliberate placeholder for the next phase. */}
                  <span tabIndex={0}>
                    <Button variant="outline" disabled>
                      <CloudOff className="mr-2 h-4 w-4" />
                      Run in cloud
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Coming soon</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              onClick={handleWakeClick}
              disabled={phase === "waking"}
              data-testid="wake-runner-button"
            >
              {phase === "waking" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : phase === "failed" ? (
                <Power className="mr-2 h-4 w-4" />
              ) : (
                <MonitorPlay className="mr-2 h-4 w-4" />
              )}
              {phase === "failed" ? "Retry" : "Wake runner"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
